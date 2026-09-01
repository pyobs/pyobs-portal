# Plan: Full script builder for the task editor

Tracks pyobs/pyobs-portal#81.
Repos: pyobs-portal, pyobs-core.
Status: implemented (pyobs/pyobs-portal#90, #91, #93)

**Update (2026-08-24, pyobs/pyobs-portal#95 / #99):** the always-visible
two-pane tree/editor layout described below (§4.7–8, §14, the mobile drawer in §7 item 8,
and the mobile acceptance criterion) was replaced with mutually-exclusive panes: the type
tree is shown only until a class is picked, then hides in favor of a full-width editor; a
"Delete script" action (with confirmation) clears the form and brings the tree back. This
was a deliberate follow-up (picking a type mid-edit was too easy and silently discarded
in-progress state) and also removed the mobile drawer/toggle entirely, since only one pane
is ever visible on any viewport. The sections below are left as written for history.

**Update (2026-09-01, pyobs/pyobs-portal#128 / #129):** the re-exported short-class-path
alias resolution added in 58e066f (`ScriptBuilder._resolveClass()` against `tree.$aliases`)
only covered the **root** script class. Nested polymorphic classes (`SequentialRunner.scripts`
items, `ParallelRunner.scripts`, `ConditionalRunner.true`/`.false`, `CasesRunner.cases`)
stored under a short alias fell back to the raw-YAML textarea instead of the nested-form
control. Fixed by canonicalizing every nested class on both load paths (`_setContent`,
`_switchToBuilder`), not just the root.

## Decisions (locked 2026-08-20)
- `validate_script/` **is tightened** at the backend (reject class-less / unknown-class payloads).
- **Minimal vitest setup is added** for frontend unit tests (polymorphic + map controls).
- **Backend-first PR**, annotating `schema/scripts/` only (constraints/merits/targets/pickers untouched).
- **CasesRunner map control is in scope.**
- **Must work on mobile.** The two-pane tree/editor layout (§4.7–8) needs a responsive
  fallback (e.g. stacked panes / tree-as-drawer below a breakpoint) — not just a
  desktop-only feature. Verify by hand in a narrow viewport, not just visually reviewed.

## 1. Goal

Replace the raw-YAML `ScriptEditor` on the task page with a **visual, schema-driven
script builder**: browse script types from `GET /api/schema/scripts/`, pick a class,
fill its parameters through generated forms, compose **nested/polymorphic script
fields**, get live validation + duration estimates, and serialize back to the task's
`script` JSON — with the raw YAML editor kept as an optional "source" view.

## 2. What exists today (verified in the code)

### Backend (unchanged — sufficient)
- `api/schema.py::script_tree()` scans `pyobs.robotic.scripts` and returns
  `{group: {subgroup: {ClassName: {"class": "<fqcn>", "schema": {...}}}}}`.
  Currently: `calibration/{darkbias,pointing,skyflats}`, `control/{cases,conditional,parallel,selector,sequential}`,
  `imaging/{autofocus,imaging,transitimaging}`, `utils/{callmodule,debugtrigger,log}`.
- `POST /api/validate_script/` → `{"valid": bool, "error": str?}` via `Script.model_validate`.
- `POST /api/estimate_duration/` → `{"duration": s}`; takes the **full task payload** so
  e.g. `TransitImagingScript` finds its `TransitMerit`.
- `pyobs_portal/api/tests.py` exists → backend changes can be unit-tested.

### Frontend
- `schemaform.js` (`SchemaForm` + `buildControl`) already renders objects, arrays of
  objects/primitives, enums, numbers (min/max/decimals), date-times, and `anyOf`
  (with a raw-YAML fallback for ambiguous unions). Used by constraints/merits/targets.
- `taskeditor.js::ScriptEditor` (line ~527): CodeMirror YAML textarea + "Insert
  template…" dropdown built by walking the script tree; `templateForSchema` +
  `defaultValueFor` build `{class, ...defaults}` templates. `getData()` parses the
  textarea; page save/export/estimate all call `scriptEditor.getData()`.
- `task_detail.html` `#tab-script` → `<div id="script-editor">`; page bootstrap at
  `taskeditor.js:800` constructs `new ScriptEditor(els.script, scriptTree, task.script)`.
- No frontend test infrastructure (confirmed — plain static JS, no build step).

### The key gap (verified by dumping real schemas)
Nested script fields are **polymorphic** (`PolymorphicBaseModel`, serialized as
`{"class": "<fqcn>", ...}`), but the JSON schemas carry **no discriminator**:

- `SequentialRunner.scripts` / `ParallelRunner.scripts`:
  `{"items": {"$ref": "#/$defs/Script"}}` — `$defs.Script` is just the base model
  (only `exptime_done`), so today `SchemaForm` renders it as a useless object/YAML blob.
- `ConditionalRunner.true` / `.false` (optional): `$ref: Script` (+ `null`).
- `CasesRunner.cases`: `additionalProperties: {$ref: #/$defs/Script}` — a **dynamic map
  of name → script**. `SchemaForm` today only renders fixed-`properties` objects and
  arrays, so this shape also needs a new control (see §3.6).
- `InstrumentConfig.exposure_time`: `anyOf [number, $ref ExposureTimeProvider]`.
- `SkyFlatsBasePointing` (used by skyflats scripts): another polymorphic base.

So `SchemaForm` cannot know from the schema alone that a field should become a
"choose a script class + nested form" control. **This is the core design decision.**

## 3. Design decision: backend-annotated polymorphic fields

Emit a custom JSON-Schema keyword from the backend so the existing schema-driven
frontend can render polymorphic fields generically — no frontend heuristics, and it
works for every polymorphic base (`Script`, `ExposureTimeProvider`,
`SkyFlatsBasePointing`, future ones).

**Backend (`api/schema.py`)**

1. **Polymorphic registry + field detection (verified mechanism).** Instead of matching
   `$defs`/`$ref` **names** (ambiguous — the JSON schema drops module paths), derive
   polymorphic fields from the **parent model's `model_fields` annotations**: unwrap
   `list[...]`, `dict[..., ...]`, `X | None` and plain unions via `typing.get_args` /
   `get_origin`; when a member is a `PolymorphicBaseModel` subclass, that's a
   polymorphic field. Verified on real classes: `SequentialRunner.scripts`
   (`list[Script]`), `ConditionalRunner.false` (`Script | None`), `CasesRunner.cases`
   (`dict[str | int | float, Script]` — JSON keys serialize as **strings**),
   `InstrumentConfig.exposure_time` (`float | ExposureTimeProvider`). Register each
   detected base in the registry; collect its concrete subclasses by scanning the
   base's package (module + subpackages), excluding abstract classes
   (`inspect.isabstract`, `cls is not base`). `Script` candidates reuse the
   `script_tree()` entries; provider bases get their own scan
   (`pyobs.robotic.utils.exptime`, `pyobs.robotic.utils.skyflats.pointing`).
2. **Annotate the generated schema** (in `_schema_for(cls)`, applied to script leaves
   **and** nested `$defs`): for each detected polymorphic field, set on the
   corresponding JSON-Schema node —
   `properties[name]` for single/optional fields, `additionalProperties` for map fields,
   `items` for array fields:
   ```json
   "x-pyobs-polymorphic": {
     "base": "pyobs.robotic.scripts.script.Script",
     "container": "single" | "optional" | "array" | "map"
   }
   ```
   Candidates are **not** inlined in the field marker; the frontend resolves them from
   the top-level registry (below), keeping the tree payload small.
   The response shape is now pinned (PR 2 depends on it):
   ```json
   "script_tree()": {
     "calibration": {...}, "control": {...}, "imaging": {...}, "utils": {...},
     "$polymorphic": {
       "pyobs.robotic.scripts.script.Script": {
         "candidates": [{"class": "<fqcn>", "path": "control/sequential/SequentialRunner", "title": "SequentialRunner"}, ...]
       },
       "pyobs.robotic.utils.exptime.exptime.ExposureTimeProvider": {
         "candidates": [{"class": "<fqcn>", "title": "...", "schema": {...}}, ...]
       },
       "...SkyFlatsBasePointing": {"candidates": [{"class": "<fqcn>", "title": "...", "schema": {...}}, ...]}
     }
   }
   ```
   `Script` candidates reference tree entries by `path` (no schema duplication);
   non-Script bases inline their (small) schemas.
3. Keep `script_tree()`'s existing tree shape intact — the YAML preview and any other
   consumers must not break.
4. **Serialization invariant — every script node carries `class`.** Verified behavior:
   `Script.model_validate({})` **succeeds** and returns the bare base `Script`, whose
   `run()` raises `NotImplementedError` — so a class-less dict "validates" but is not
   executable, and today `validate_script/` would show "✓ Valid" for `{}`. Therefore:
   - The builder's `getData()` (and every nested polymorphic control's `getValue()`)
     must always emit `{"class": "<fqcn>", ...}` for any composed script node — never a
     class-less dict.
   - The root is `{}` **only** when no script is configured at all (new-task default,
     `Task.script` is a plain `JSONField` — saving must keep working with `{}`).
   - Tighten `validate_script/` in `api/schema.py`: reject payloads whose top-level (or
     any nested script node) lacks `class` with a clear error (e.g. `"no script class
     selected"`), and map unknown-class `ImportError`/`AttributeError` to a clean
     `"unknown script class '<fqcn>'"` instead of leaking `No module named …`. The
     endpoint is only used by the editor status bar, so task saving is unaffected.
     Add tests: `{}` → invalid with message; unknown class → invalid with message;
     nested `SequentialRunner` with a class-less child → invalid.
5. Tests in `api/tests.py`: markers present on `SequentialRunner.scripts`,
   `ConditionalRunner.true/false`, `InstrumentConfig.exposure_time`, skyflats pointing;
   every candidate validates against its base (`base_cls.model_validate(candidate_sample)`);
   `$polymorphic` contains no abstract classes; tree shape backward-compatible.

**Frontend (`schemaform.js`)**

6. Add `buildPolymorphicControl(baseInfo, value, defs, ignored)`:
   - Renders a **type selector** (dropdown; grouped by module path, with a search
     filter for the root-script picker) + a nested `SchemaForm` for the chosen class.
   - When `anyOf` includes `null` (optional, e.g. `ConditionalRunner.false`), render a
     "none" option / clear checkbox; `getValue()` returns `null` when unset.
   - Initialize from existing `data.class` (match candidate by fqcn); `getValue()`
     returns `{"class": "<fqcn>", ...fields}`.
   - Wire into `buildControl`: handle `x-pyobs-polymorphic` before the generic
     `anyOf`/object branches; keep the YAML fallback for genuinely ambiguous unions.
   - Support recursion depth for nested scripts (SequentialRunner → ImagingScript →
     InstrumentConfig → ExposureTimeProvider). No recursion issues at realistic depth.
   - **Dynamic maps** (`additionalProperties`-only objects, e.g. `CasesRunner.cases`):
     a key-value list editor — each row has a name input, the polymorphic control as
     value, and a remove button; `getValue()` returns `{name: script}`. Generic for any
     `additionalProperties` schema, not just `Script`.

## 4. Frontend builder UI

**New file `frontend/static/frontend/js/scriptbuilder.js` — class `ScriptBuilder`**
(replaces `ScriptEditor`; keep `getData()` / `setContent()` interface so
`taskeditor.js` save/export/estimate wiring is untouched):

7. **Type tree pane** (left): render `schema/scripts/` as a searchable/filterable tree
   (`imaging/…`, `calibration/…`, `control/…`, `utils/…`), reusing the existing
   `_walk` logic; highlight currently-used class; selecting a node sets the root script
   type.
8. **Editor pane** (right): root class selector + `SchemaForm` for the selected class
   (all parameter forms now work: descriptions, required markers, exposure lists,
   nested script fields via the polymorphic control, provider fields).
9. **Validation bar**: debounced (400 ms, same as today) `validate_script/` POST of the
   built script JSON → ✓/✗ status; required-field guidance from `schema.required`;
   schema `description` rendered as help text under controls (units are *not* currently
   emitted by pyobs schemas — see §6).
10. **Estimate duration**: button reusing the existing full-task-payload
    `estimate_duration/` call (extract the handler already at `taskeditor.js:847` so it's
    shared).
11. **Source toggle** (optional, keep the current CodeMirror editor as a "Source" tab/
    toggle): switching to Source dumps the current builder state to YAML; switching back
    rebuilds the form from YAML (with a warning if the YAML doesn't round-trip into the
    same builder state). Keep the existing YAML preview tab on the page as-is.
12. **Unmappable-script fallback:** if the task's `script` data isn't a class-dict or
    `data.class` isn't found in the tree (imported YAML from another pyobs version,
    uninstalled script package, legacy structure), the builder opens in **source view**
    with a warning banner instead of rendering an empty/wrong form — never silently
    drops data.

**`taskeditor.js`**
13. Swap `new ScriptEditor(els.script, scriptTree, task.script)` (line 800) for
    `new ScriptBuilder(els.script, scriptTree, task.script)`; delete the now-dead
    insert-template code path (`ScriptEditor` stays only as the source view). Update the
    `tab-script-nav` show hook to refresh CodeMirror only when source view is active.

**`task_detail.html`**
14. Extend the `#tab-script` card with the two-pane layout containers and a status bar;
    add `scriptbuilder.js` to the script block (after `schemaform.js`); add small CSS
    for the tree pane (scrollable, collapsible groups), including a responsive
    breakpoint (Bootstrap `md`) that collapses the tree pane into a toggleable
    drawer/offcanvas above the editor pane on narrow viewports.

## 5. Acceptance criteria (from the issue)

- [x] Browsable, searchable tree of script types showing nesting structure.
- [x] Selecting a class renders a parameter form from its JSON schema.
- [x] Lists of objects (e.g. `instrument_configs`) editable add/remove-style.
- [x] Polymorphic/nested fields (script-in-script, `exposure_time` provider) editable —
      add/remove/choose sub-script instances, round-tripping `class` correctly.
- [x] Dynamic maps of scripts (`CasesRunner.cases`: name → script) editable key/value-wise.
- [x] Every serialized script node always carries `class` (§3.4); `{}` is emitted only
      when no script is configured, and `validate_script/` reports a clear error for
      class-less/unknown-class payloads instead of "✓ Valid".
- [x] Live validation via `validate_script/`; duration estimate via `estimate_duration/`.
- [x] Saving produces the `script` JSON `TaskRunner` executes (verified by re-opening the
      task and reloading — restores the exact builder state. Executing a smoke task wasn't
      done: no telescope simulator was available in the dev environment used for this check).
- [x] Raw YAML editor available as a source view toggle; YAML preview tab still works.
- [x] Usable on mobile: tree pane and editor pane both reachable and operable on a phone
      viewport (stacked/drawer layout, no fixed-width panes that force horizontal scroll).

## 6. Out of scope / notes / risks

- **Units:** schemas today contain no unit metadata (verified — only 20 `description`
  strings across all script schemas). Render descriptions now; surfacing units would
  require pyobs-core `Field` metadata changes → separate issue.
- **Frontend tests:** decided — add a **minimal vitest setup** (jsdom) with unit tests for
  `schemaform.js` (polymorphic control, dynamic-map control, `anyOf`+`null` handling) and
  `scriptbuilder.js` (getData round-trip, class invariant). The files are classic scripts
  (top-level globals, no build step); expose the classes on `window` (harmless in the
  page) so tests can import them, stub `jsyaml`/`CodeMirror` as needed, and keep the page
  loading unchanged (`<script src>` classic includes). No framework, no bundler in prod.
  Concretely (this repo has no `package.json`/JS tooling at all today — verified):
  - New `package.json` at repo root: `{"devDependencies": {"vitest": "^2", "jsdom": "^25"}}`,
    `"scripts": {"test": "vitest run"}`, `"type": "module"`.
  - `vitest.config.js`: `test: { environment: "jsdom" }`.
  - New `frontend/static/frontend/js/__tests__/` directory: `schemaform.test.js`,
    `scriptbuilder.test.js` — each imports the target file for its `window`-exposed globals
    (e.g. `import "../schemaform.js"; const { SchemaForm } = window;`), stubs `window.jsyaml`
    and `window.CodeMirror` as plain objects with the handful of methods each file actually
    calls (`load`/`dump` for `jsyaml`; the editor constructor + `getValue`/`setValue` for
    `CodeMirror`).
  - CI: **`.github/workflows/test.yml` now exists** (added 2026-08-23, follow-up to
    pyobs/pyobs-portal#89) — runs `manage.py check` + `manage.py test` via `uv` on
    push/PR to `main`/`develop`. Add an `npm ci && npm test` step (or a separate job) to that
    same workflow for vitest, rather than deciding from scratch whether tests run in CI.
  - `.gitignore`: add `node_modules/`.
- **Payload size:** inlining provider schemas adds little; if it grows, reference
  candidates by `path` into the tree instead of duplicating schemas.
- **`testing/` scripts package** isn't installed in the current pyobs-core; the dynamic
  tree handles its presence/absence automatically.
- **`exptime_done`** stays ignored in generated defaults — `schema.py`'s existing
  `IGNORED_FIELDS = {"cost", "target_dependent", "exptime_done"}`, stripped by `_strip_ignored()`
  (corrected from an earlier draft's `IGNORED_TASK_FIELDS`, which doesn't exist in the code).
- **Abstract bases** (`ExposureTimeProvider`, `SkyFlatsBasePointing` themselves) must be
  excluded from candidate lists.
- **External consumer check — resolved, no blocker.** Checked `pyobs-task-editor`
  (`src/pyobs_task_editor/backends.py`): it only calls `/api/me/`, `/api/users/`,
  `/api/projects/`, `/api/tasks/`, `/api/observations/` — `grep` for `validate_script`,
  `estimate_duration`, and `schema/scripts` across the whole repo returns nothing. It writes
  tasks via `add_task`/`update_task` directly, never through `validate_script/`, so tightening
  that endpoint's `{}`/unknown-class behavior (§3.4) has no effect on it. Safe to merge the
  backend PR without coordinating a pyobs-task-editor change.

## 7. Manual QA checklist (no frontend test infra)

1. New task → Script tab → pick `ImagingScript` → required `camera` flagged; fill; ✓ valid.
2. Pick `SequentialRunner` → add two nested `ImagingScript`s; edit nested
   `instrument_configs`; set a nested `exposure_time` provider; validate ✓; estimate
   duration; save; **reopen the task** → builder state restored exactly.
3. Import a task whose YAML contains a nested `ConditionalRunner` with `false: null` →
   renders with "none"; change it; save; re-validate.
4. `CasesRunner`: add several named cases, each a different script type; remove one;
   validate ✓; save; reopen → cases restored.
5. Source toggle: builder → YAML → builder round-trip; YAML preview tab unchanged.
6. No script configured → builder emits `{}`; saving works; the validation bar shows the
   clear "no script class selected" error rather than "✓ Valid".
7. Regression: constraints/merits/targets forms, save, export YAML, clone task, and
   schedule/observations tabs all unaffected.
8. Mobile: narrow browser to phone width (or real device) → tree pane collapses to a
   drawer/toggle, editor pane usable without horizontal scroll, validation bar and
   estimate button remain reachable.

## 8. Implementation order

**PR 1 (backend, small & reviewable):**
1. Polymorphic registry + `x-pyobs-polymorphic` annotation on `schema/scripts/` +
   `validate_script` tightening + tests in `api/tests.py` (§3.1–3.5). The pyobs-task-editor
   dependency check (§6) is already done — no coordination needed before merging.

**PR 2 (frontend core, depends on PR 1's response shape):**
2. Minimal vitest setup (jsdom, `window` exposure of classes) (§6).
3. `buildPolymorphicControl` + dynamic-map control in `schemaform.js` with unit tests
   (§3.6).

**PR 3 (builder UI):**
4. `ScriptBuilder` UI + wiring in `taskeditor.js` / `task_detail.html` (§4.7–4.14).
5. Source-view toggle + polish (search, required markers, status bar).
6. Manual QA (§7); full test suite green; PR with screenshots.
