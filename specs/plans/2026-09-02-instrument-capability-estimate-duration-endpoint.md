# Plan: wire `instruments` capability data into `estimate_duration/`, add its change marker

Status: proposed (no issue yet; Repos: pyobs-portal, pyobs-core)

This is the pyobs-portal half (§B) of
`../../../pyobs-core/specs/plans/2026-09-01-instrument-capability-duration-estimates.md` — that
plan's §A (pyobs-core side: `InstrumentCapabilities` models, `TaskData` field,
`PortalTaskArchive` polling, the 5 leaf scripts) is out of scope here. This doc only covers what
changes in this repo: a cached in-process accessor for the `instruments` app's data
(`plans/2026-09-01-portal-instrument-config-app.md`, already implemented) and a change marker for
it, mirroring `last_task_update/`.

## Problem

`instruments` app data (`GET /api/instruments/`) already exists and already carries the
duration-estimate fields (`readout_time_s`, `filter_change_time_s`, `slew_rate_deg_per_s`,
`rotate_rate_deg_per_s`). Two things are still missing before either consumer can use it:

1. **`schema.py`'s `estimate_duration()`** (`pyobs_portal/api/schema.py:766-792`) builds a
   `TaskData(task=task)` with no `instrument_capabilities` — the field exists on `TaskData`
   (once pyobs-core's §A.2 lands) but nothing here populates it, so every script's estimate stays
   on today's hardcoded constants even after pyobs-core's leaf-script changes land.
2. **pyobs-core's `PortalTaskArchive`** (§A.4 of the linked plan) needs a cheap marker to poll —
   the same `last_task_update`/`last_observation_update` shape
   (`pyobs_portal/api/views.py:301-317`) — to know when to re-fetch `GET /api/instruments/`
   instead of re-fetching on every scheduling pass.

## Existing conventions this follows

- **`django.core.cache` short-TTL accessor**, same shape as `get_module_classes()`
  (`pyobs_portal/api/webadmin.py:23-25,47-70`): module-level `_CACHE_KEY`/`_CACHE_TTL`/`_UNCACHED`
  sentinel, `cache.get`/`cache.set`. Simpler here: no outbound HTTP call, no `settings.*_URL`
  gate, no `try/except requests.RequestException` — `instruments` lives in this same Django
  process/DB, so failure modes are just "no rows" / "field is `None`", not "unreachable host."
- **`Max(updated_at)` marker in a dedicated view function**, same shape as `last_task_update`
  (`pyobs_portal/api/views.py:301-308`) and `_last_update()` (`:282-289`).
- **New app stays self-contained** — `instruments` already has its own
  `models.py`/`serializers.py`/`views.py`/`urls.py` split
  (`plans/2026-09-01-portal-instrument-config-app.md` §1); the marker view and cache helper both
  belong in `instruments/`, not bolted onto `api/`.

## Design

### 1. Cache helper — `pyobs_portal/instruments/cache.py` (new file)

```python
from typing import Any

from django.core.cache import cache

from .views import INSTRUMENT_QUERYSET
from .serializers import InstrumentSerializer

_CACHE_KEY = "pyobs_portal.instruments.capabilities"
_CACHE_TTL = 300  # seconds -- admin-edited reference data, staleness is cheap
_UNCACHED = object()


def get_instrument_capabilities() -> list[dict[str, Any]]:
    """Serialized `GET /api/instruments/` payload, cached briefly.

    Reuses INSTRUMENT_QUERYSET (views.py) rather than re-declaring the same
    select_related/prefetch_related shape -- one query plan for both the API endpoint and this
    in-process accessor.
    """
    cached = cache.get(_CACHE_KEY, _UNCACHED)
    if cached is not _UNCACHED:
        return cached
    data = InstrumentSerializer(INSTRUMENT_QUERYSET, many=True).data
    cache.set(_CACHE_KEY, data, _CACHE_TTL)
    return data
```

No `None` case here (unlike `get_module_classes()`): there's no external host to be unreachable,
just possibly an empty list. Returns `list[dict]`, matching what
`TaskData.instrument_capabilities` (pyobs-core §A.2) expects to parse — pyobs-core's
`InstrumentCapabilities.model_validate(...)` (§A.1) is the thing that turns "maybe empty list of
loosely-typed dicts" into "matched by module_name or not," so this side stays a thin cached
query, no shaping logic duplicated here.

Cache invalidation is TTL-only (300s), not marker-gated, since this is a same-process ORM query,
not a poll loop — matches the original plan's §B.2 framing ("this cache only serves the portal's
own in-process callers, not something the pyobs-core scheduler polls"; the marker in §2 below is
for pyobs-core's own poll loop, a separate concern from this cache's TTL).

### 2. `last_instrument_update/` marker — `pyobs_portal/instruments/views.py` + `urls.py`

Every capability row (`Instrument`, `CameraCapability`, `BinningOption`, `FilterWheelCapability`,
`Filter`, `TelescopeCapability`, `DomeCapability`) has its own `auto_now=True` `updated_at`
(`models.py`) precisely because nested-inline admin edits don't bubble up to the parent
`Instrument.updated_at` (documented in `models.py`'s `Instrument` docstring and
`plans/2026-09-01-portal-instrument-config-app.md` §2's caveat) — the marker has to `Max()` over
all seven models, not just `Instrument`.

```python
# instruments/views.py, added alongside INSTRUMENT_QUERYSET/InstrumentList/CameraCapabilityDetail

from django.db.models import Max
from rest_framework.decorators import api_view, permission_classes as api_permission_classes
from rest_framework.response import Response

from .models import BinningOption, Filter, FilterWheelCapability


def _max_updated_at(*querysets):
    values = [qs.aggregate(Max("updated_at"))["updated_at__max"] for qs in querysets]
    present = [v for v in values if v is not None]
    return max(present) if present else None


@api_view(["GET"])
@api_permission_classes([IsAuthenticated])
def last_instrument_update(request):
    marker = _max_updated_at(
        Instrument.objects.all(),
        CameraCapability.objects.all(),
        BinningOption.objects.all(),
        FilterWheelCapability.objects.all(),
        Filter.objects.all(),
        TelescopeCapability.objects.all(),
        DomeCapability.objects.all(),
    )
    return Response({"last_instrument_update": marker.isoformat() if marker else None})
```

No per-user accessibility filter (unlike `last_task_update`'s `_accessible_projects` scoping) —
`instruments` data isn't project-scoped, every authenticated user sees the same set (§3 of the
instrument-config-app plan: read API is `IsAuthenticated` only, no per-row permission).

`None` (not the `1970-01-01` epoch `last_task_update` falls back to, `views.py:289`) when there
are no rows at all — `_last_update()`'s epoch fallback exists so pyobs-core's Time-based
comparison always has a value to diff against for a queryset it expects to be non-empty in
practice; `instruments` data can legitimately be completely empty (fleet not configured in this
app yet) and pyobs-core's `PortalTaskArchive` (§A.4 of the linked plan) already treats a missing
value as "no data" per its own optional/degrade-to-None convention. Confirm this against
pyobs-core's actual marker-comparison code during implementation — if it turns out to require a
`Time`-parseable string unconditionally (matching `last_task_update`'s `.isot` shape exactly), use
the same epoch-fallback shape instead for consistency rather than introducing a second marker
convention.

`instruments/urls.py`:
```python
urlpatterns = [
    path("", views.InstrumentList.as_view()),
    path("cameras/<str:code>/", views.CameraCapabilityDetail.as_view()),
    path("last_instrument_update/", views.last_instrument_update),
]
```

### 3. `schema.py:766-792`'s `estimate_duration()` populates the new `TaskData` field

```python
from pyobs_portal.instruments.cache import get_instrument_capabilities

...
task = Task.model_validate(task_dict)
script = task.create_script()
return {
    "duration": script.estimate_duration(
        data=TaskData(task=task, instrument_capabilities=get_instrument_capabilities()),
        time=None,
    )
}
```

Only the `"script" in data` branch (task-dict path) changes — the legacy bare-script-dict branch
(`schema.py:790-792`) calls `script.estimate_duration()` with no `TaskData` at all today and stays
that way; it has no `task` to build one from.

Depends on pyobs-core's `TaskData.instrument_capabilities: InstrumentCapabilities | None` field
(§A.2 of the linked plan) existing in whatever pyobs-core version this repo's `pyobs` dependency
is pinned to — sequencing note in Non-goals below.

## Non-goals / open questions

- **No pyobs-core changes here** — this repo only ever calls `pyobs.robotic.task.TaskData` and
  `Script.estimate_duration()`, both defined in pyobs-core. This plan assumes pyobs-core's §A.1
  (`InstrumentCapabilities` model) and §A.2 (`TaskData` field) have landed and been released to
  whatever `pyobs` version this repo pins, or dev-installed against a local checkout during
  implementation. Landing order: pyobs-core §A.1/§A.2 first (additive, no portal dependency),
  then this plan's §3 can start passing the field.
- **`get_instrument_capabilities()`'s return shape is exactly `InstrumentSerializer(...).data`**
  — a list of nested dicts, not the flattened module-name-keyed lookup pyobs-core's
  `InstrumentCapabilities` (§A.1) builds. Keeping the shaping logic in pyobs-core (the consumer)
  rather than duplicating a "build module-name dicts" step here, per the original plan's §B.2
  framing that this is "a cached ORM query, not a cached external call" — no reshaping needed on
  this side.
- **`last_instrument_update/`'s `None`-vs-epoch fallback** (§2 above) needs confirming against
  pyobs-core's actual poll/compare code once §A.4 is implemented there — flagged rather than
  guessed at.

## Test plan

- [ ] `get_instrument_capabilities()` returns the same shape as `GET /api/instruments/`'s own
      response body, cached (a DB change within the TTL window isn't reflected until it expires —
      assert via mocking `django.core.cache.cache` or `freezegun`, matching however
      `webadmin.py`'s cache tests do it, if such a precedent test exists)
- [ ] `last_instrument_update/` — 401 unauthenticated; moves when any of the seven models changes
      (one test per model, not just `Instrument`), including a nested `Filter` edit three levels
      deep; returns `None` (or the agreed fallback per §2's open question) with zero rows
- [ ] `estimate_duration/` — with a task whose `camera`/`telescope` module names match an
      `Instrument`'s capability rows, the returned duration differs from the same task estimated
      with no matching row (proves the field is actually threaded through, not just accepted and
      ignored)
- [ ] Cache TTL: two `estimate_duration/` calls within 300s hit the DB once (assert via
      `django.test.utils.CaptureQueriesContext` or a query-count assertion), a third call after
      TTL expiry re-queries

## Acceptance criteria

- `GET /api/instruments/last_instrument_update/` returns a marker that moves on any capability
  row change, including nested ones that don't bubble up to `Instrument.updated_at`.
- `estimate_duration/`'s task-dict branch passes live `instruments` data into `TaskData`, cached
  with a 300s TTL, no behavior change to the legacy bare-script-dict branch.
- No new external calls, no new settings — everything here is same-process ORM + cache, following
  the original plan's framing that this isn't an integration like `webadmin.py`'s.
