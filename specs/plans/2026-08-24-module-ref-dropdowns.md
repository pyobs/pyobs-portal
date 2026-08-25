# Plan: Module-name fields render as dropdowns fed by pyobs-web-admin

Tracks pyobs/pyobs-portal#98.
Depended on pyobs/pyobs-core#808 (interface tagging on script fields).
Repos: pyobs-core (see #808/PR #809) + pyobs-portal. The pyobs-web-admin side is already
merged (see below).
Status: **fully implemented and live.** pyobs-core#808 shipped in pyobs-core 2.0.0.dev94
(released 2026-08-24); the pin here is bumped to `>=2.0.0.dev94` and `uv.lock` updated.
Verified directly against the real dependency: `ImagingScript.camera` now carries
`{"interfaces": ["ICamera", "IBinning", "IWindow", "IExposureTime", "IImageType"]}`,
`DarkBiasScript.camera` carries a different 5-interface set as designed (no collision), and
`module_ref_options()` reports 18 distinct interfaces referenced across the script tree. Full
test suite green (81 backend + 84 frontend) against the real pyobs-core release, not just
fixtures.

## Problem

Script schema fields like `ImagingScript.camera`/`.telescope` are plain `str`/`Optional[str]`
in pyobs-core, with no type-level signal distinguishing them from any other string field
(verified via `ImagingScript.model_fields`). In the script builder they render as free-text
inputs, so a typo in a module name produces a script that only fails at runtime.

## What exists today

- **pyobs-web-admin side is already done** — merged today, commit `e0b8835` (web-admin's own
  issue #65), in direct response to this issue. `GET /api/modules/classes/`
  (`pyobs_web_admin/modules/views.py:api_module_classes`) returns bare JSON
  `{module_name: class_fqcn}` for every configured module on the host, built by
  `services.build_module_classes()` (globs `*.yaml` under `PYOBS_CONFIG_DIR`, reads each
  config's top-level `class:` key through the same include/anchor pre-processor the rest of the
  app uses, so it resolves `class:` arriving via a shared-fragment `{include}` too, not just a
  literal top-level line). Auth: header `X-Hub-Token: <secret>` checked against
  `settings.HUB_CLIENTS` (`[{"name": str, "token": str}, ...]`) by `HubTokenMiddleware`
  (`modules/middleware.py`) using `hmac.compare_digest` — enforced globally by middleware, not a
  per-view decorator, so no new auth code is needed anywhere.
- `pyobs_portal/api/schema.py` already does the template pattern this feature reuses:
  `_annotate_polymorphic(schema, cls)` (L176-224) mutates a model's generated JSON Schema in
  place, keyed off real Python-level type introspection of `field_info.annotation` (not off
  `Field(json_schema_extra=...)`), called from `script_tree()`'s recursive `pkgutil`/`importlib`
  scan over `pyobs.robotic.scripts` (L291-326) right after `_schema_for(cls)`.
  `_check_no_classless_nodes` (L403) shows the existing FQCN-string → class → `issubclass`
  pattern via `pyobs.object.get_class_from_string`.
- `pyobs_portal/api/views.py` has the outbound-HTTP-to-external-service precedent:
  `ObservationDataStatus.get()` (L191-227) — `requests.get(url, headers=..., timeout=5)` +
  `.raise_for_status()`, wrapped in `except (requests.RequestException, KeyError, ValueError,
  TypeError)` that degrades to a soft "unavailable" response rather than a 5xx. Settings
  precedent: `ARCHIVE_URL`/`ARCHIVE_TOKEN` (`settings.py` L244-245), flat
  `os.environ.get(..., "")`, optional/soft-disabled when unset.
- `pyobs.interfaces.interface.get_registered_interface(name) -> type[Interface] | None`
  (pyobs-core) resolves an interface name string to its class via a registry populated by
  `__init_subclass__` — **not** re-exported from `pyobs.interfaces/__init__.py` (that package
  re-exports `Interface` itself plus the individual interface classes, but not the two registry
  functions), so `get_registered_interface`/`Interface` must be imported from
  `pyobs.interfaces.interface` directly. Confirmed by reading `interface.py`'s `__all__` and by
  `hasattr(pyobs.interfaces, "get_registered_interface")` → `False`.

## Design

All line numbers below were correct against a specific point-in-time checkout of each file and
will drift as unrelated commits land; locate insertion points by function/variable name, not by
line number, when implementing.

### Where the interface requirement lives: `Annotated`, tagged in pyobs-core (#808)

A field name alone doesn't determine which interface a module must implement — the same field
name can mean different things on different script classes (`ImagingScript.camera` needs only
`ICamera`; `DarkBiasScript.camera` needs `IData`+`IBinning`+`IWindow`+`IExposureTime`+
`IImageType`). That requirement already exists in pyobs-core's `run()`/`can_run()` code as
literal interface classes passed to `self.comm.proxy(...)`/`has_proxy(...)` — it's just not
machine-readable today.

**Confirmed by direct test** (pydantic 2.13.4, the version this repo pins): pydantic silently
accepts arbitrary classes placed in `Annotated` metadata, doesn't validate against them, and
preserves them in `FieldInfo.metadata`:
```python
class M(BaseModel):
    camera: Annotated[str, ICamera]
model_fields["camera"].metadata  # -> [<class 'ICamera'>]
```
It does **not** put them in `model_json_schema()` output on its own (no
`__get_pydantic_json_schema__` hook on a plain class) — turning that metadata into a
frontend-facing JSON-Schema marker is this repo's job, not pyobs-core's.

**pyobs-core#808** proposes exactly this: tag `camera: Annotated[str, ICamera]`,
`telescope: Annotated[str | None, ITelescope] = None`, and for multi-interface fields
`camera: Annotated[str, IData, IBinning, IWindow, IExposureTime, IImageType]` on
`DarkBiasScript`. Zero behavior change (still plain `str`/`Optional[str]` at runtime) — purely
additive metadata. This repo depends on that issue landing (and a pyobs-core release + version
bump here) before the annotation step below has anything to read.

**Why this beats a hand-maintained table in this repo**: no duplicated, driftable mapping — the
`ImagingScript.camera` vs `DarkBiasScript.camera` collision can't happen by construction, since
each class's own `Annotated` declares its own interfaces, at the point where the actual
`self.comm.proxy(...)` call is made.

### Data delivery: new endpoint, fetched once at page load

`GET /api/schema/modules/`, fetched once when the script builder page loads (same lifecycle as
the existing `/api/schema/scripts/` call) and passed into `SchemaForm` as a new synchronous
constructor option (`opts.moduleRefs`). This keeps `schemaform.js`'s existing "all data available
synchronously at construction" design intact — there is currently no async-fetch pattern
anywhere in that file — and decouples the already-heavy recursive `schema_scripts` scan from an
external call to web-admin on every request.

### Backend (pyobs-portal)

**1. `pyobs_portal/settings.py`** — after `ARCHIVE_URL`/`ARCHIVE_TOKEN`, add the same
flat/optional pair, with a comment in the same style:
```python
# pyobs-web-admin integration (issue #98): WEBADMIN_URL/WEBADMIN_TOKEN back the module-name
# dropdown in the script builder (GET {WEBADMIN_URL}/api/modules/classes/, authenticated via
# X-Hub-Token). Unset either and module-name fields silently fall back to today's free-text
# input -- no error anywhere in the chain.
WEBADMIN_URL = os.environ.get("WEBADMIN_URL", "")
WEBADMIN_TOKEN = os.environ.get("WEBADMIN_TOKEN", "")
```
One robotic-backend per web-admin (per the issue's own framing), so this is flat, not
per-`Project`.

**2. `pyobs_portal/api/webadmin.py`** (new) — mirrors `api/archive.py`'s shape and
`ObservationDataStatus.get()`'s request pattern:
```python
def get_module_classes() -> dict[str, str] | None:
    """GET {WEBADMIN_URL}/api/modules/classes/ with header X-Hub-Token: WEBADMIN_TOKEN,
    timeout=5. Returns the {module_name: class_fqcn} dict on success; None if WEBADMIN_URL
    is unset, on any requests.RequestException, non-2xx, or malformed JSON body. Never raises
    -- logs a warning and degrades, same as the archive integration."""
```
Short-circuit before the request if either setting is missing:
`if not settings.WEBADMIN_URL or not settings.WEBADMIN_TOKEN: return None` — an empty
`X-Hub-Token` would just round-trip a guaranteed 401 from web-admin's `HubTokenMiddleware`, so
skip it rather than making a pointless request.

**3. `pyobs_portal/api/schema.py`** — two additions, following the precedent of
`_annotate_polymorphic` and `script_tree()`:

- `_annotate_module_refs(schema, cls)`: walks `cls.model_fields`, and for each field whose
  `field_info.metadata` contains one or more `Interface` subclasses (`inspect.isclass(m) and
  issubclass(m, Interface)`), injects
  `schema["properties"][field]["x-pyobs-module-ref"] = {"interfaces": [<names>]}` (always a
  list, even length-1). `<names>` must be each interface's **short class name** (`"ICamera"`,
  not the FQCN) — `get_registered_interface` only resolves short names, confirmed directly
  (`get_registered_interface("pyobs.interfaces.ICamera")` returns `None`). Mirrors
  `_polymorphic_field_base`'s real type-introspection approach — no hand-maintained table, no
  JSON-schema-extra dependency on pyobs-core. Call it right after `_annotate_polymorphic(s, cls)`
  in `script_tree()`'s inner loop (L315). No recursion into nested models needed — every
  module-ref field is a direct field on a `Script` subclass. Note: candidate schemas embedded in
  the `$polymorphic` registry (`_polymorphic_registry`, L257-288) are deliberately *not*
  recursively annotated today (see the comment at L280-284) — if a polymorphic candidate type
  ever grows its own `Annotated`-tagged module-ref field, it will be silently unmarked; out of
  scope here but worth a one-line comment at the call site noting the same limitation applies.
  New import: `from pyobs.interfaces.interface import Interface`.
- `module_ref_options(tree: dict[str, Any] | None = None) -> dict[str, list[str]]`: accepts an
  optional prebuilt `script_tree()` result to avoid re-running the full recursive
  `pkgutil`/`importlib` scan a second time when the caller (the new view, see below) already has
  one; defaults to calling `script_tree()` itself if not given, and makes the unit test cheap
  (pass a small hand-built fixture tree instead of scanning the real package). Calls
  `webadmin.get_module_classes()` once; if `None` (unset/unreachable), returns `{}`. Determines
  which interfaces to compute by scanning the tree's schemas for `x-pyobs-module-ref` markers and
  collecting the interface names found (so this stays in sync with whatever pyobs-core declares —
  no separate static list to maintain). For each interface name, resolve it via
  `get_registered_interface` (imported from `pyobs.interfaces.interface`), then for each
  `(module_name, fqcn)` pair from web-admin resolve the class via `get_class_from_string` and
  check `issubclass`, wrapping per-entry resolution in `except Exception: continue` — mirrors
  `_scan_concrete_subclasses`'s defensive style, so one bad/uninstalled driver class doesn't
  break the whole list. Returns **per-interface** lists, not per-field; the AND-intersection for
  multi-interface fields happens on the frontend (cheap, small N, and keeps the payload reusable
  across fields sharing an interface).

**4. `pyobs_portal/api/views.py`** — new view beside `schema_scripts` (locate by
function name, not line number below — this file changes independently of this plan), same
style:
```python
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def schema_modules(request):
    return Response(schema.module_ref_options())
```

**5. `pyobs_portal/api/urls.py`** — add alongside the other schema routes (L40-44):
```python
path("schema/modules/", views.schema_modules),
```

**6. `pyproject.toml`** — bump the `pyobs-core>=2.0.0.dev71` pin once #808 ships in a pyobs-core
release, so `Interface`/the `Annotated` tags are actually present to introspect.

### Frontend

**7. `schemaform.js`** — `buildControl(resolved, defs, value, ignored, polymorphic)` (L196)
gains a 6th param `moduleRefs`, threaded exactly like `polymorphic` at every existing call site:
the anyOf-unwrap recursion, the `SchemaForm` constructor/`_build` (add
`this.moduleRefs = opts.moduleRefs || {}`), and every nested-`SchemaForm` construction reached
via the array/object/map/polymorphic control builders (those builders call back into
`buildControl`/construct nested `SchemaForm`s, so `moduleRefs` must flow through each, same as
`polymorphic` does today). Placement: put the new `x-pyobs-module-ref` check next to the existing
`x-pyobs-polymorphic` check, before the `anyOf` branch. **Verified directly** (not assumed): for
both a required field (`camera: str`) and an optional one (`telescope: str | None`),
`_annotate_module_refs` writes the marker onto the outer property node — `{"anyOf": [...],
"x-pyobs-module-ref": {...}, ...}` for the optional case, confirmed by running
`_schema_for`/`_annotate_module_refs` against a live fixture model. So `buildControl`'s check
fires directly in both cases; no dependency on the anyOf-unwrap-and-recurse path at all (unlike
what an earlier draft of this plan assumed by analogy with the polymorphic marker).

New `buildModuleRefControl(marker, value, moduleRefs)`: renders a plain `<input type="text">`
backed by a `<datalist>` — not a `<select>` — populated with the intersection of `moduleRefs[i]`
across `marker.interfaces`. Mirror `buildStringControl`'s value handling exactly: restore
`value` into `input.value` (including `undefined`/`null` → empty), and `getValue()` returns the
raw string with no transformation — an untouched optional field must round-trip byte-identical
to today, or scriptbuilder.js's dirty-check (`stableStringify` comparison) will misfire a "changed"
warning for a field the user never touched. A datalist-backed input is the deliberate choice over
a `<select>`: it degrades to an ordinary free-text input for free when the intersection is empty
(web-admin down/unconfigured, or no configured module implements the interface — script editing
must never be blocked on web-admin being reachable), and it still allows typing a name not in the
list (module not started yet, config drift) without a separate "custom value" escape hatch a
`<select>` would need.

`isStructuralField()` (L45-55) needs **no change** — confirmed by reading it: module-ref fields
are plain `string`/`Optional[string]`, so `resolved.type === "string"` already routes them
through the normal two-column layout.

**8. `taskeditor.js`** — add `apiRequest("schema/modules/").catch(() => ({}))` (not a bare
`apiRequest("schema/modules/")`) to the existing `Promise.all([...])` in `initTaskEditor`
(alongside `constraintSchemas`, `scriptTree`, etc.), destructure the result as `moduleRefs`, and
pass it into the `new ScriptBuilder(...)` call: `{ onChange: estimateDuration, moduleRefs }`. The
`.catch` matters: `/api/schema/modules/` is *this repo's own* endpoint (not just a proxy to
web-admin — `module_ref_options()` internally re-runs `script_tree()`, the one non-trivial call
in the chain), and it sits in the same `Promise.all` as `scriptTree`/the other schema calls — an
unhandled rejection there would fail the whole task editor page load over a feature that's
supposed to be optional/degradable. The other three `SchemaForm` construction sites in this file
(target/constraint/merit editors) do **not** need `moduleRefs` — module-ref fields only occur on
`Script` subclasses.

**9. `scriptbuilder.js`** — `ScriptBuilder` constructor (L28-30) stores
`this.moduleRefs = opts.moduleRefs || {}` alongside `this.polymorphic`; the
`new SchemaForm(entry.schema, entry.schema.$defs || {}, rest, { polymorphic: this.polymorphic })`
call (L250) becomes `{ polymorphic: this.polymorphic, moduleRefs: this.moduleRefs }`.

### Degradation behavior

With `WEBADMIN_URL` unset (dev/local, or any deployment not yet paired with web-admin):
`get_module_classes()` → `None` → `module_ref_options()` → `{}` → `/api/schema/modules/` → `{}`
→ every `moduleRefs[interface]` lookup is empty on the frontend → `buildModuleRefControl` renders
a plain input with no datalist, functionally identical to today. No error surfaces anywhere. The
same fallback fires if web-admin is reachable but no configured module implements a given
interface, or a class fails to import (bad/uninstalled driver dependency). Also true before
pyobs-core#808 ships: with no `Annotated` interface metadata present yet, `_annotate_module_refs`
simply finds nothing to mark, and every module-name field stays a plain text input — this feature
can be merged and deployed here without breaking anything, ahead of the pyobs-core release.

## Testing

- `api/tests.py`: `webadmin.get_module_classes()` mocked-`requests` cases (success, `WEBADMIN_URL`
  unset → no request + `None`, `RequestException`, non-2xx, malformed body — all → `None`, never
  raises), mirroring the existing `ObservationDataStatus` test pattern.
- `script_tree()` test (once pyobs-core#808 has landed in the pinned version) asserting
  `ImagingScript.camera` gets `{"interfaces": ["ICamera"]}` and `DarkBiasScript.camera` gets the
  5-interface list — proving the two don't collide. Until then, a test with a locally-defined
  fixture `BaseModel` carrying `Annotated[str, ICamera]` can exercise `_annotate_module_refs` in
  isolation without depending on the pyobs-core release.
- `module_ref_options()` test with a mocked `get_module_classes()` fixture (one `ICamera`
  subclass FQCN, one non-camera module), asserting correct per-interface bucketing.
- `GET /api/schema/modules/` DRF-test-client test (401 unauthenticated, 200 + expected shape
  authenticated).
- `frontend-tests/js/schemaform.test.js`: new describe block for `x-pyobs-module-ref` — datalist
  populated correctly from `moduleRefs`; multi-interface AND-intersection with partial overlap;
  empty/missing `moduleRefs[interface]` → plain input, no `list` attribute; typing an arbitrary
  (non-listed) value still round-trips via `getValue()`.

## Verification

- `python manage.py test pyobs_portal.api` for the new backend tests.
- Frontend test runner for the new `schemaform.test.js` cases.
- Manual: run the app with `WEBADMIN_URL` unset — confirm the script builder's camera/telescope
  fields behave exactly as today (plain text input, no regression). Then, once pyobs-core#808 is
  released and pinned here, with a local pyobs-web-admin instance and a matching `HUB_CLIENTS`
  secret, set `WEBADMIN_URL`/`WEBADMIN_TOKEN` and confirm the same fields now suggest real
  configured module names via the datalist, correctly filtered by interface (a non-camera module
  must not appear under `camera`).

## Sequencing

1. ~~pyobs-core#808 (interface tagging) merged and released.~~ **done** — merged via pyobs-core
   PR #809 (commit `696f8bf5`), released as pyobs-core 2.0.0.dev94 (2026-08-24).
2. ~~Bump `pyobs-core` pin here.~~ **done** — `pyproject.toml`/`uv.lock` bumped to
   `>=2.0.0.dev94` and synced; verified directly against the installed release (not a fixture):
   `ImagingScript.camera` → `{"interfaces": ["ICamera", "IBinning", "IWindow", "IExposureTime",
   "IImageType"]}`, `DarkBiasScript.camera` → a different 5-interface set (no collision), 18
   distinct interfaces referenced across the whole script tree.
3. ~~Backend steps 1-6 above.~~ **done** — `api/webadmin.py`, `api/schema.py`
   (`_annotate_module_refs`, `module_ref_options`), `api/views.py` (`schema_modules`),
   `api/urls.py` (`schema/modules/`), `settings.py` (`WEBADMIN_URL`/`WEBADMIN_TOKEN`). 20
   backend tests (16 original + 4 caching), full `pyobs_portal.api` suite (81 tests)
   green against the real pyobs-core release.
4. ~~Frontend steps 7-9 above.~~ **done** — `schemaform.js` (`buildModuleRefControl` +
   `moduleRefs` threaded through `buildControl`/`SchemaForm`/array/object/map/polymorphic
   builders), `taskeditor.js` (fetch + `.catch` fallback), `scriptbuilder.js` (`moduleRefs`
   passthrough). 7 new frontend tests, full suite (84 tests across both spec files) green.

PR #103 merged into `develop` (merge commit `10f09f2`, 2026-08-24). The feature is fully wired
end-to-end in code. The **only remaining item is operational, not code**: a deployment needs
`WEBADMIN_URL`/`WEBADMIN_TOKEN` actually set (matching a `HUB_CLIENTS` entry on that
pyobs-web-admin instance) before the dropdowns show real data instead of falling back to plain
text input — see the manual-verification step above, which nobody has run against a live
web-admin instance yet.

## PR #103 review follow-ups (all addressed)

thusser's review on #103 approved with four non-blocking suggestions, all fixed in the same PR:

1. **Double `script_tree()` scan** — `/api/schema/scripts/` and `/api/schema/modules/` are
   separate requests fired together by the same `Promise.all`, so both independently paid for
   the full recursive `pkgutil`/`importlib` scan. `script_tree()` now caches its result for 5s
   via Django's cache framework (`_SCRIPT_TREE_CACHE_KEY`) — a de-duplication window, not a
   staleness tolerance (module code doesn't change without a process restart). Covered by
   `ScriptTreeCachingTests` (asserts the second call doesn't re-invoke `importlib.import_module`,
   and that a cleared cache does trigger a fresh scan).
2. **Page-load latency when web-admin is configured but unreachable** — `webadmin.py`'s 5s
   `requests.get` timeout ran fresh on every page load. `get_module_classes()` now caches its
   result (success **or** `None`) for 30s, so a down web-admin only costs the timeout once per
   window, not once per page load. Covered by two new cache-reuse tests (success and failure
   paths); existing tests needed `cache.clear()` in `setUp`/mid-loop to keep the mocked-per-call
   assertions valid against the now-cached function.
3. **Nested-model gap in pyobs-core#808's scope** — `_annotate_module_refs` only walks a script
   class's own `model_fields`, no recursion into nested `$defs` models (unlike
   `_annotate_polymorphic`). Documented explicitly in its docstring, and flagged as a comment on
   pyobs-core#808 so that issue's implementation stays scoped to direct `Script` fields (which is
   all the table there already lists) rather than assuming a nested field would "just work" once
   tagged.
4. **Cosmetic** — `module_ref_options()`'s docstring now spells out why `{}` (no key) and
   `{interface: []}` (key present, empty) are two different signals, not an inconsistency; the
   frontend's datalist `id` generation switched from `Math.random()` to a module-level counter
   (`_moduleRefDatalistCounter`).

Steps 3-4 (this repo's own code) were written and merged ahead of #808 landing — the degradation
behavior above means nothing breaks either way — but the feature has no visible effect until the
pin is bumped once pyobs-core#808 ships.
