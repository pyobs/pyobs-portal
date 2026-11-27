# Restricted users: global constraints, bounded merits and priority

Status: proposed (revised 2026-11-27)
Repos: pyobs-core (remove `SolarElevationConstraint.direction`, released first), pyobs-portal
Date: 2026-11-14, revised 2026-11-27
Baseline: pyobs-portal `b2c06aa` (develop, includes #211), pyobs-core `2.30.1`
Issue: pyobs/pyobs-portal#198
Related: pyobs/pyobs-portal#197 (fixed in #211), pyobs/pyobs-core#1126 (RandomMerit mean)

## Goal

On an instance with restrictions enabled, every user is restricted unless they are a superuser
(`portal-admin`) or in the unrestricted group. Restricted users:

- cannot remove or loosen any constraint from the global list `RESTRICTED_CONSTRAINTS`; adding
  extra constraints of known types is always allowed;
- may only use merits within the bounds of `MERIT_RULES` (`ConstantMerit.merit <= 1`,
  `RandomMerit` forbidden until pyobs-core#1126 is released, the 0/1 merits are free);
- must set a target;
- may set task priority only in `0 <= priority <= RESTRICTED_MAX_PRIORITY`.

Violations are rejected with 400 at write time (create, PUT, PATCH).

## Intended behaviour (not risks)

- Checks run only when a task is saved. Stored tasks are not checked retroactively.
- The rules apply to whoever saves. An unrestricted user may loosen constraints on any task,
  including one a restricted user created.
- Restriction is per user, not per project.

## Part 1: pyobs-core (release before the portal work merges)

Remove `direction` from `SolarElevationConstraint`
(`pyobs/robotic/scheduler/constraints/solarelevationconstraint.py`): drop the field, the
rising/setting branch in `__call__` and the `DIR` card in `req_fields`. This is a breaking change
for stored constraints that carry a `direction` key (`extra="forbid"`); versioning of constraint
schemas is deliberately ignored here, the portal strips the key in a data migration (2.2).

- Tests: delete `tests/robotic/scheduler/constraints/test_solarelevation_direction.py`, drop the
  `direction=` arguments in `test_fits_headers.py`, assert that `direction=` now raises
  `ValidationError`.
- Docs (`docs/source/api/robotic/scheduling.rst`, `docs/source/recipes/robotic.rst` SUNALT row),
  CHANGELOG under "Removed" (breaking).
- Release as the next minor version.

A dedicated constraint for "first or second half of the solar day" may replace `direction` later;
it is out of scope here.

## Part 2: pyobs-portal backend

### 2.1 Settings

All read from env, with `local_settings` overrides as for `DEFAULT_CONSTRAINTS`:

- `RESTRICTIONS_ENABLED` (bool, default off). Off means current behaviour for everyone, so other
  deployments are unaffected.
- `RESTRICTED_CONSTRAINTS` (JSON, same format as `DEFAULT_CONSTRAINTS`). Resolved after the
  `local_settings` import; falls back to `DEFAULT_CONSTRAINTS`.
- `RESTRICTED_MAX_PRIORITY` (float, default 1.0).
- `KEYCLOAK_UNRESTRICTED_GROUP` (full group path, e.g. `/pyobs-portal-iag50srv-unrestricted`,
  empty means no sync).
- `pyproject.toml`: `pyobs-core[full]>=<release from Part 1>,<3`, `uv lock`.
- `.env.example`: commented examples.

iag50srv values:

```json
RESTRICTED_CONSTRAINTS=[
  {"class": "pyobs.robotic.scheduler.constraints.MoonSeparationConstraint", "min_distance": 30},
  {"class": "pyobs.robotic.scheduler.constraints.SolarElevationConstraint", "min_elevation": -90, "max_elevation": -18},
  {"class": "pyobs.robotic.scheduler.constraints.AirmassConstraint", "max_airmass": 2.0}
]
```

`DEFAULT_CONSTRAINTS` should be set to the same list so new tasks start pre-filled.

### 2.2 Data migration: strip `direction`

Migration in `api` that removes `direction` from the params of every stored
`SolarElevationConstraint`. Rows with `direction` other than `"both"` become looser; log each
affected task code at WARNING so an admin can review it. Run on iag50srv before the release to see
whether any such tasks exist.

### 2.3 Who is restricted

- Django group `unrestricted` (name constant, created by a data migration).
- `authentication/keycloak.py` `resolve_user`: if `KEYCLOAK_UNRESTRICTED_GROUP` is set, add or
  remove the user's membership in `unrestricted` from the `groups` claim on every resolve, like
  the `is_superuser` sync. Exact path match, as in pyobs-auth's `REQUIRED_GROUPS`. Use a top-level
  Keycloak group whose members are also in the required group (a subgroup path does not, as far
  as known, include the parent path in the claim, so subgroup members would fail the required
  group gate; check in Keycloak).
- Local users without a Keycloak identity: membership is set in the Django admin.
- `api/restrictions.py` `is_restricted(user)`: `RESTRICTIONS_ENABLED and not anonymous and not
  superuser and not in group unrestricted`. Memoised on the user object for the request.

### 2.4 Rules (`api/restrictions.py`)

Hand-written tables keyed by exact class name. `"max"`: submitted <= bound, `"min"`: submitted >=
bound.

`CONSTRAINT_RULES` (bound = the global's value):

| Class | Field rules |
| --- | --- |
| AirmassConstraint | max_airmass: max |
| MoonIlluminationConstraint | max_phase: max |
| MoonSeparationConstraint | min_distance: min |
| SolarElevationConstraint | min_elevation: min, max_elevation: max |
| TimeConstraint | start: min, end: max |

`MERIT_RULES` (bound = fixed value; `None` = type forbidden):

| Class | Rule |
| --- | --- |
| ConstantMerit | merit: max 1.0 |
| RandomMerit | forbidden (until pyobs-core#1126 is released, then std: max with mean 1) |
| AfterTimeMerit, BeforeTimeMerit, FollowMerit, IntervalMerit, PerNightMerit, TimeWindowMerit, TransitMerit | no field rules (return 0 or 1) |

- `parse_constraint(data)` / `parse_merit(data)`: accept the API form `{"class": ..., **params}`
  and the stored form `{type, params}`, build the pydantic model (class defaults for omitted
  fields, typos fail via `extra="forbid"`). Times compared as astropy `Time`.
- `global_constraints()`: parses `RESTRICTED_CONSTRAINTS` once (cached).
- `check_task(attrs, instance) -> dict[str, list[str]]`:
  1. every constraint type is in `CONSTRAINT_RULES` and parses;
  2. for each global G (two globals of the same type are matched separately), at least one
     submitted constraint of type G is at least as strict on every ruled field;
  3. every merit type is in `MERIT_RULES`, not forbidden, and within its bounds;
  4. target is not null;
  5. priority <= `RESTRICTED_MAX_PRIORITY`.

  Messages name the field and the bound, e.g. `AirmassConstraint.max_airmass=2.5 is looser than
  the global limit (must be <= 2.0).`, `Missing required constraint AirmassConstraint
  (max_airmass <= 2.0).`, `ConstantMerit.merit=5 exceeds 1.0.`, `RandomMerit is not allowed.`

### 2.5 System checks (`ApiConfig.ready`)

- Error: a `RESTRICTED_CONSTRAINTS` entry does not parse or has no rule.
- Error: a `TimeConstraint` entry without explicit `start` and `end`.
- Warning: a `TimeConstraint` entry whose `end` is in the past.

### 2.6 Serializers

- `ConstraintSerializer` / `MeritSerializer.to_internal_value`: copy `data` instead of mutating
  it; missing `"class"` raises `ValidationError` (today a `KeyError`, i.e. 500).
- `TaskSerializer.validate`: after the #197 membership check, if the user is restricted run
  `check_task`. Effective constraints, merits, target and priority come from `attrs`, or for a
  partial update from the stored task. `PATCH {"active": false}` alone always passes.
  Errors: `ValidationError({"constraints": [...], "merits": [...], "target": [...],
  "priority": [...]})`, keys only when non-empty.

### 2.7 Endpoints

- `/api/site/`: add `restrictions`, `null` for unrestricted users, else `{"global_constraints":
  [... API form], "constraint_rules": ..., "merit_rules": ..., "max_priority": float}`.
- `/api/me/`: add `restricted: bool`.
- `/api/schema/constraints/` and `/api/schema/merits/`: for restricted users only allowed types.
- `/api/merit_plot/`: for restricted users run `check_task` first, 400 with the same format.

## Part 3: frontend

- New `static/frontend/js/restrictions.js` (same export pattern as `schemaform.js` for Vitest):
  - `boundSchema(schema, type, bounds, rules)`: sets `minimum`/`maximum` per rule (inside `anyOf`
    branches too); times get `min`/`max`.
  - `mergeGlobals(constraints, globals)`: appends a copy of each missing global, marks the first
    item per global type as locked; returns `{items, added}`.
- `taskeditor.js`, if `siteConfig.restrictions`: `mergeGlobals` on load; locked constraint cards
  have no remove button and a "global limit" badge; bounded schemas for constraints, merits and
  priority; forbidden merit types are hidden from the add menu and an existing one shows "not
  allowed for your account; remove before saving"; target "none" is not offered. Notice in a new
  alert slot in `templates/frontend/task_detail.html` when globals were added. Save calls
  `reportValidity()` and shows 400 field errors.

## Part 4: docs

`docs/source/configuration.rst` (all settings from 2.1, Keycloak group setup, intended behaviour,
expired TimeConstraint note), `api.rst` (new fields, 400 format), `frontend.rst` (locked cards),
`.env.example`, CHANGELOG, `specs/index.md`.

## Sequencing (one go)

1. Core: Part 1, release.
2. Portal backend: 2.1 to 2.7 with Django tests.
3. Frontend: Part 3 with Vitest tests.
4. Docs, CHANGELOG, portal release.
5. iag50srv: run 2.2 dry check, set env (2.1), create the Keycloak group, deploy.

## Tests

- pyobs-core: Part 1.
- Django `api/test_restrictions.py`:
  - constraint rules per type: tighter, equal, looser, missing global, extra of a known type,
    unknown type, two globals of the same type, TimeConstraint start/end;
  - merit rules: ConstantMerit at/above 1, RandomMerit rejected, free merits accepted, unknown
    merit rejected;
  - target null rejected; priority above max rejected;
  - tripwires: every `Constraint` and `Merit` subclass has a rule entry;
  - API and stored forms; system checks; settings fallback;
  - `is_restricted`: disabled, superuser, unrestricted group, default restricted;
  - Keycloak sync of `unrestricted` (added, removed, setting empty);
  - API as restricted user: POST, PUT, PATCH partial (stored rows used), PATCH `active=false` on a
    rule-breaking task passes, `active=true` fails, unrestricted save of the same task passes;
  - data migration strips `direction` and logs non-"both" rows;
  - schema endpoint filtering, `/api/site/` and `/api/me/`, `merit_plot` 400, missing `"class"`
    gives 400.
- Vitest `frontend-tests/js/restrictions.test.js`: `boundSchema` per rule kind including `anyOf`;
  `mergeGlobals`; locked card without remove button.

## Risks

- New core constraint or merit types are blocked for restricted users until a rule is added; the
  tripwire tests fail on the core upgrade.
- An expired global `TimeConstraint` end stops all restricted tasks (warning check only).
- Removing `direction` loosens stored rising/setting constraints (logged by the migration).
- Keycloak group changes take effect at the next login or token refresh.
