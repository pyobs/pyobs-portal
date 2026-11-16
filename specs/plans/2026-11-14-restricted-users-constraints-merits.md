# Restricted users: global constraints and merit whitelist

Status: proposed
Repos: pyobs-core (two new constraint classes, released first), pyobs-portal
Date: 2026-11-14
Baseline: pyobs-portal `8a2dced`, pyobs-core `2.24.0` (portal pins `pyobs-core[full]>=2.23.3,<3`)
Issue: pyobs/pyobs-portal#198
Related: pyobs/pyobs-portal#197 (task create/update does not check project membership), not in scope

## Goal

Admins mark Django groups as restricted. Members of a restricted group:

- cannot remove or loosen any constraint from the global list `RESTRICTED_CONSTRAINTS`; adding extra constraints of known types is always allowed;
- may only use merit types whitelisted for their groups;
- may only set `target_dependent` away from the class default if a group allows it.

Violations are rejected with 400 at write time (create, PUT, PATCH), also when an existing task breaks the rules. Stored tasks are not checked retroactively (accepted). An admin and a restricted user may edit the same task. The rules apply to whoever saves. Unrestricted users and superusers keep current behaviour.

## Part 1: pyobs-core (release before the portal work merges)

Today `SolarElevationConstraint` (`pyobs/robotic/scheduler/constraints/solarelevationconstraint.py`) has `min_elevation`, `max_elevation` and `direction: Literal["rising", "setting", "both"] = "both"`. `__call__` uses `self.direction` to compare against midnight/solar transit, and `req_fields()` writes `SUNALT DIR`. Classes are registered by being exported from `constraints/__init__.py` (`__all__`). `Constraint.create()` resolves the `type` shorthand against that list, and `class` strings resolve through `get_class_from_string`.

Change:

1. New files `solarelevationrisingconstraint.py` and `solarelevationsettingconstraint.py` (one class per file, like the others):
   ```python
   class SolarElevationRisingConstraint(SolarElevationConstraint):
       """Solar elevation constraint, rising sun only."""
       direction: ClassVar[Literal["rising", "setting", "both"]] = "rising"
   ```
   Same for `SolarElevationSettingConstraint` with `"setting"`. Redeclaring an inherited field as `ClassVar` removes it from `model_fields` and the JSON schema (checked with pydantic 2.13.4). `__call__`, `req_fields` (DIR card) and `to_astroplan` are inherited unchanged. With `extra="forbid"` a submitted `direction` key is rejected. If pyrefly flags the ClassVar-over-field override, fall back to a private base `_SolarElevationBase` that holds the elevation fields and logic and reads a `_direction` ClassVar, with all three public classes deriving from it.
2. Export both in `constraints/__init__.py`.
3. Tests in `tests/robotic/scheduler/constraints/`: `direction` absent from `model_fields` and `model_json_schema()`; `direction=` input raises `ValidationError`; evaluation equals `SolarElevationConstraint(direction=...)` on the fixtures of `test_solarelevation_direction.py`; FITS cards include `DIR`; round trip via `model_dump()` and `Constraint.create({"type": "SolarElevationRising", ...})`.
4. `docs/source/api/robotic/scheduling.rst` autoclass entries, `docs/source/recipes/robotic.rst` SUNALT row mentions the new classes, CHANGELOG.
5. Release as 2.25.0. `SolarElevationConstraint` stays as is for stored tasks.

`isinstance(x, SolarElevationConstraint)` is true for the subclasses. The only such check in core is in `Constraint.create`, which is harmless. The portal matches by exact type name.

## Part 2: pyobs-portal backend

### 2.1 Dependency and settings

- `pyproject.toml`: `pyobs-core[full]>=2.25.0,<3`, `uv lock`.
- `pyobs_portal/settings.py`: `RESTRICTED_CONSTRAINTS = None` before the `local_settings` import. After it (next to the existing JSON-string normalisation): if still `None`, read env `RESTRICTED_CONSTRAINTS` (JSON, same format as `DEFAULT_CONSTRAINTS`), otherwise fall back to `DEFAULT_CONSTRAINTS`. Accept a JSON string from `local_settings`. Resolving after the import is needed because `local_settings` may override `DEFAULT_CONSTRAINTS`.
- `DEFAULT_CONSTRAINTS` remains the frontend prefill for everyone.
- `.env.example`: commented example.

### 2.2 Data model and admin

- `api/models.py`: `GroupRestriction(group=OneToOneField(Group, related_name="restriction"), restricted=BooleanField(default=True), allowed_merits=JSONField(default=list, blank=True), allow_target_independent=BooleanField(default=False))`. `allowed_merits` holds short class names (`"ConstantMerit"`). Migration `0012_grouprestriction`.
- `api/admin.py`: unregister `Group`, re-register a `GroupAdmin` subclass with a `GroupRestriction` `StackedInline`. Its form renders `allowed_merits` as `MultipleChoiceField(widget=CheckboxSelectMultiple)`, with choices from `schema._subclasses(merits_module, Merit)`. `clean()` rejects unknown names.
- Keycloak sync (`authentication/keycloak.py`) only touches `is_superuser`, so admin-assigned groups survive logins.

### 2.3 `api/restrictions.py`

- `get_restriction(user) -> Restriction | None`: `None` for anonymous users, superusers, and users in no group with `restricted=True`. Otherwise `Restriction(allowed_merits=union over restricted groups, allow_target_independent=any over restricted groups)`. One query, memoised on the user object for the request. An empty union means no merits are allowed.
- `CONSTRAINT_RULES` (hand-written, keyed by exact class name; `"max"`: submitted <= global, `"min"`: submitted >= global, `"equal"`; equality always passes):

  | Class | Field rules |
  | --- | --- |
  | AirmassConstraint | max_airmass: max |
  | MoonIlluminationConstraint | max_phase: max |
  | MoonSeparationConstraint | min_distance: min |
  | SolarElevationRisingConstraint | min_elevation: min, max_elevation: max |
  | SolarElevationSettingConstraint | min_elevation: min, max_elevation: max |
  | SolarElevationConstraint | min_elevation: min, max_elevation: max, direction: equal |
  | TimeConstraint | start: min, end: max |

  The direction rule on the old class only matters when a global entry uses it. An extra old-class constraint with any direction is just another ANDed constraint. Global configs should use the new classes.
- `parse_constraint(data)`: accepts the API form `{"class": "...X", **params}` and the stored form `{type, params}`, builds `Constraint.model_validate({"class": PREFIX + type, **params})`. Omitted fields take class defaults and typos fail via `extra="forbid"`. Time fields are compared as astropy `Time`.
- `global_constraints()`: parses `settings.RESTRICTED_CONSTRAINTS` once (cached).
- `check_constraints(submitted, restriction) -> list[str]`:
  1. every submitted constraint's type is in `CONSTRAINT_RULES` (unknown types rejected) and parses;
  2. if `not restriction.allow_target_independent`: `target_dependent` must equal the class default. `cost` is not checked: in core both are only read by `CsvPicker` pre-filtering (`csvpicker.py:61`), and `OnDemandScheduler.evaluate_constraints` runs every constraint regardless, so neither can loosen a limit;
  3. for each global G (two globals of the same type are matched separately), at least one submitted constraint with exact type `G.type` is at least as strict on every ruled field. Constraints are ANDed, so one strict-enough instance covers G and the rest are extras.

  Messages name the field and bound, e.g. `AirmassConstraint.max_airmass=2.5 is looser than the global limit (must be <= 2.0).` and `Missing required constraint AirmassConstraint (max_airmass <= 2.0).`
- `check_merits(submitted, restriction) -> list[str]`: every type in `allowed_merits`.
- `rules_for_frontend()`: `CONSTRAINT_RULES` as JSON.

### 2.4 System checks (registered in `ApiConfig.ready`)

- Error: a `RESTRICTED_CONSTRAINTS` entry does not parse, or has no rule.
- Error: a `TimeConstraint` entry without explicit `start` and `end` (both default to `now()`, which would make the limit move).
- Warning: a `TimeConstraint` entry whose `end` is in the past. Once a fixed end expires, every restricted user's task is unschedulable until the setting is updated; this is documented.

### 2.5 Serializers (`api/serializers.py`)

- `ConstraintSerializer` / `MeritSerializer.to_internal_value`: copy `data` instead of mutating it, and raise `ValidationError` when `"class"` is missing (today that is a `KeyError`, i.e. a 500).
- `TaskSerializer.validate(attrs)`: `restriction = get_restriction(self.context["request"].user)`; if `None`, return. If `self.partial and set(attrs) == {"active"} and attrs["active"] is False`, return (deactivation is always allowed). Effective constraints/merits are taken from `attrs`, or for a partial update without them, from the stored rows. Errors: `ValidationError({"constraints": [...], "merits": [...]})` (keys only when non-empty).

### 2.6 Existing bug fixed here: partial update deletes the target

`TaskSerializer.update()` deletes the target and recreates it from `validated_data.pop("target", None)`. A `PATCH {"active": false}` (the tasks-list bulk toggle in `tasks.js`) therefore deletes the task's target today. Change: only touch the target when `"target" in validated_data`. Add a regression test. Can be split into its own issue if preferred; it is a prerequisite for the deactivation path above.

### 2.7 Endpoints (`api/views.py`)

- `/api/site/`: add `restrictions`, which is `null` for unrestricted users, else `{"global_constraints": [... API form], "allowed_merits": [...], "allow_target_independent": bool, "rules": rules_for_frontend()}`.
- `/api/me/`: add `restricted: bool`.
- `/api/schema/merits/`: for restricted users only allowed types. `/api/schema/constraints/`: for restricted users only types in `CONSTRAINT_RULES`.
- `/api/merit_plot/`: for restricted users run both checks first, 400 `{"error": "...", "constraints": [...], "merits": [...]}`.

## Part 3: frontend

- New `static/frontend/js/restrictions.js` (same export pattern as `schemaform.js` so Vitest can import it):
  - `boundSchema(schema, type, globalParams, rules)`: sets `minimum`/`maximum` from the global value per rule (inside `anyOf` branches too); `"equal"` becomes a single-value `enum`; times get `min`/`max` on the date-time input.
  - `mergeGlobals(constraints, globals)`: appends a copy of each global whose type is missing; marks the first item per global type as locked; returns `{items, added}`.
- `taskeditor.js`: if `siteConfig.restrictions`, run `mergeGlobals` on load, pass `{locked, rules, globals}` to the constraints `TypedListEditor`. Locked cards have no remove button and a "global limit" badge, and use the bounded schema. In the merits editor, cards with a disallowed type show "not allowed for your account; remove before saving". If `target_dependent` is not allowed, the field is read-only. When globals were auto-added, show a notice in a new alert slot in `templates/frontend/task_detail.html` (plus a `<script>` tag for `restrictions.js`). The save handler calls `reportValidity()` before PUT/POST and shows 400 field errors from the API.
- `schemaform.js`: expected unchanged; verify bounds survive the nullable/`anyOf` rendering path (lines ~340-370).
- Saving with `active` unticked in the editor sends a full PUT and is checked; deactivation without checks goes through the task list toggle (PATCH). Documented.

## Part 4: docs

`docs/source/configuration.rst` (`RESTRICTED_CONSTRAINTS`, group setup, the expired-TimeConstraint note), `api.rst` (new response fields, 400 format), `frontend.rst` (locked cards), `.env.example`, CHANGELOG, this entry in `specs/index.md`.

## Sequencing

1. M1 core: Part 1, release pyobs-core 2.25.0.
2. M2 portal backend: 2.1 to 2.7 with Django tests. Can be developed against a local core checkout, merged only after 2.25.0 is on PyPI.
3. M3 frontend: Part 3 with Vitest tests.
4. M4 docs and CHANGELOG, portal release.

#197 should land before or alongside M2. Without it, a restricted user can still create tasks in projects they do not belong to (the rules apply, but the project boundary does not).

## Tests

- pyobs-core: see Part 1 step 3.
- Django `api/test_restrictions.py`:
  - rules per type: tighter, equal, looser, missing global, extra of a known type, unknown type, two globals of the same type, old-class direction equal/different, TimeConstraint start/end, `target_dependent` with and without the group flag;
  - tripwire: every `Constraint` subclass from `schema._subclasses` has a `CONSTRAINT_RULES` entry;
  - normalisation of API and stored forms;
  - system checks (unparsable entry, missing rule, TimeConstraint without start/end, expired end warning);
  - settings fallback to `DEFAULT_CONSTRAINTS`;
  - group resolution: none, one restricted, two restricted (union), restricted=False, superuser in a restricted group;
  - API as restricted user: POST, PUT, PATCH constraints only, PATCH merits only (stored rows used), PATCH `active=false` on a rule-breaking task passes, PATCH `active=true` on it fails, admin save of the same task passes;
  - PATCH keeps the target (2.6);
  - schema endpoint filtering, `/api/site/` and `/api/me/` fields, `merit_plot` 400;
  - missing `"class"` gives 400, not 500;
  - admin form rejects unknown merit names.
- Vitest `frontend-tests/js/restrictions.test.js`: `boundSchema` per rule kind including `anyOf`; `mergeGlobals` adds missing types and locks the first per type; a locked card renders without a remove button.

## Risks

- New core constraint types are blocked for restricted users until a rule is added; the tripwire test fails on the core upgrade.
- An expired global `TimeConstraint` end silently stops all restricted tasks (warning check only).
- Write-time only: tasks saved before a group was restricted, or before a global changed, keep running unchanged.
- #197 is open: project membership is not enforced on task writes.
- Restriction is per user: tasks in shared projects follow whoever saved last.

## Open assumptions (to confirm with Tim)

1. `allow_target_independent` means the group may set `target_dependent=false`. Note that this flag only steers `CsvPicker` pre-filtering and never bypasses a limit. If "allow non-target tasks" meant tasks without a target, that is a different feature: target-dependent globals (AirmassConstraint, MoonSeparationConstraint) return False when `task.target is None`, so such tasks never schedule.
2. Class names `SolarElevationRisingConstraint` / `SolarElevationSettingConstraint`.
3. The old `SolarElevationConstraint` stays accepted for restricted users, with `direction` required to equal the global's when it is matched against a global of that class.
