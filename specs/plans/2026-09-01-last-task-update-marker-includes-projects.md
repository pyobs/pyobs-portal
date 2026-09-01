# Plan: `/api/last_task_update/` moves on project edits, not just task edits

Status: implemented

Tracks pyobs-core#848. Repos: pyobs-portal (this plan); the consumer-side half — pyobs-core's
`Scheduler` currently ignoring project content in its own change-detection even when the archive
does re-poll — is `pyobs-core/specs/plans/2026-09-01-scheduler-reschedule-on-project-and-task-changes.md`
(separate repo, separate plan). The two are independently landable, see Out of scope.

## Problem

`last_task_update` (`pyobs_portal/api/views.py:299-303`) is the marker
`PortalTaskArchive._poll()` (pyobs-core, `pyobs/robotic/storage/portal/taskarchive.py:60-77`)
gates re-downloading on:

```python
def last_task_update(request):
    queryset = Task.objects.filter(project__in=_accessible_projects(request.user))
    return Response({"last_task_update": _last_update(queryset).isot})
```

`_last_update()` (`:282-289`) is `Max("updated_at")` over that queryset — `Task` rows only.
Editing a `Project` (e.g. raising its `priority` in the admin) touches no `Task` row, so the
marker never moves, and pyobs-core's archive never re-downloads or re-compares — the project
edit is invisible end-to-end regardless of what pyobs-core does with it.

Root cause is one field narrower than "the queryset ignores projects": **`Project`
(`pyobs_portal/api/models.py:10-19`) has no `updated_at` field at all.** Only `Task` does
(`:36`, `auto_now=True`). There's nothing to `Max()` over yet — this needs a migration, not just
a query change.

## Design

### 1. Add `Project.updated_at`

- `pyobs_portal/api/models.py:10-19`: add `updated_at = models.DateTimeField(auto_now=True)`,
  matching `Task.updated_at` (`:36`) exactly.
- New migration. Existing rows get the migration's `auto_now_add`-style backfill (Django sets
  `auto_now` fields to "now" on the row's next save; for the migration itself, backfill with
  `default=now` via `AddField` so existing projects don't end up with a `NULL`/is
  it nullable — `DateTimeField` isn't nullable by default, so the migration needs an explicit
  one-time default, e.g. `django.utils.timezone.now`, for the `AddField` operation only, same as
  Django's own migration-autodetector prompt would ask for). Follow whatever pattern
  `Task.updated_at`'s original migration used, if it predates this and is still in the
  migrations directory — reuse its exact default strategy for consistency.

### 2. `users` (M2M) is not covered by `auto_now`

- `Project.users` (`:14`) is a `ManyToManyField` — membership changes go through a through-table
  row, not a `save()` on the `Project` itself, so `auto_now=True` alone will **not** bump
  `updated_at` when a user is added/removed from a project.
- Decide explicitly (don't silently leave this half-covered): either (a) add an `m2m_changed`
  signal receiver on `Project.users.through` that touches `updated_at` (mirrors how `auto_now`
  behaves for direct field changes), or (b) accept the gap and document it — a `users` change
  affects who can *see* a project (`_accessible_projects()`, `:292-296`) rather than the
  project's own scheduling-relevant content (`priority`, `public`), which is arguably a
  different concern from this issue's "priority change doesn't reschedule" symptom. Leaning
  toward (b) for this plan (scope: #848 is about `priority`/content, not membership) but call it
  out in the PR description so it's a conscious deferral, not an oversight.

### 3. Include projects in the marker queryset

- `last_task_update` (`views.py:301-303`): change to also cover `Project`. Two shapes, pick one
  during implementation:
  - (a) `max(_last_update(task_queryset), _last_update(project_queryset))` — two `Max()`
    queries, simplest, matches `_last_update()`'s existing per-queryset signature unchanged.
  - (b) A single combined queryset/union — more DB-idiomatic but `_last_update()`
    (`:282-289`) currently takes one queryset and one model's `updated_at` column; a union across
    `Task`/`Project` needs its own aggregation shape. Not worth the complexity here — (a) is two
    cheap indexed queries, not a hot path.
- Project accessibility filter: reuse `_accessible_projects(request.user)` (`:292-296`) directly
  as the project queryset (it's already exactly "projects this user may see") rather than
  re-deriving project access from the task queryset's `project__in`.

### 4. Tests (`pyobs_portal/api/tests.py`)

- Editing a project's `priority` (or `public`) moves `last_task_update` forward; editing an
  inaccessible project (one the requesting user can't see) does **not** move the marker for that
  user, matching existing per-user accessibility behavior for tasks.
- Editing a task still moves the marker (no regression on the existing behavior).
- No tasks and no accessible projects → falls back to the epoch (`_last_update`'s existing
  `1970-01-01` fallback, `:289`), matching current empty-queryset behavior.
- If (2) is resolved as (a) signal-based: adding/removing a user from a project's `users` moves
  the marker. If resolved as (b) deferred: explicitly *not* tested (documented as known gap,
  not silently uncovered).

## Acceptance criteria

- [x] `Project.updated_at` field + migration added (`0009_project_updated_at.py`, mirrors
      `0008_task_observation_updated_at.py`'s nullable-add/backfill/non-null-alter shape;
      `makemigrations --check` confirms it matches the model exactly).
- [x] `users` M2M gap explicitly resolved as a documented deferral (option (b) from the design):
      a code comment on `Project.updated_at` plus
      `test_project_membership_change_does_not_move_marker` pin the known gap instead of leaving
      it silently uncovered.
- [x] `/api/last_task_update/` moves when an accessible project's content changes.
- [x] Per-user project accessibility respected in the new project-side query — reuses
      `_accessible_projects(request.user)` directly, option (a) from the design (two `Max()`
      queries combined via `max()`).
- [x] New tests pass (13/13 in `UpdateMarkerApiTests`); full suite (131 tests) green.
- [x] Migration applies cleanly against a fresh DB with the full migration history
      (`manage.py migrate api`, verified).

## Out of scope

- pyobs-core's `Scheduler` still ignoring project content in its own `_need_update` gate even
  once this marker moves and `PortalTaskArchive` re-downloads — separate, required gap, tracked
  in `pyobs-core/specs/plans/2026-09-01-scheduler-reschedule-on-project-and-task-changes.md`.
  This plan's fix is necessary but not sufficient on its own for #848's symptom to actually go
  away in production.
- Same-ID *task* content changes (a task's own priority changing without its ID changing) are
  already covered on the portal side — `Task.updated_at` already exists and is already in the
  marker queryset; that gap is entirely on the pyobs-core consumer side (see the linked plan).
