# Plan: Connect pyobs-robotic-backend to pyobs-archive (observations → data links)

Tracks pyobs/pyobs-robotic-backend#82.
Repos: pyobs-robotic-backend, pyobs-archive, pyobs-core.
Status: planned

## Problem

The backend stores observation history (`Observation` records with `start`, `end`, `state`,
`obsnum`) but has no connection to pyobs-archive, the service that stores and serves the actual
FITS data. Users cannot jump from a completed observation in the backend to its data — they have
to open the archive separately and search for the frames manually. Every observation should link
**directly** to its archived data (frame detail, FITS download, preview, headers), both in the
API and in the frontend Observations tab.

## What exists today

- `Observation.obsnum` (`CharField(32)`, nullable) plus `start`/`end` — the join key needs no
  schema change (`pyobs_robotic_backend/api/models.py`).
- pyobs-archive `Frame.OBSNUM` (`CharField(30)`, nullable, "per-night") + `DATE_OBS`; `frames_view`
  filters on `OBSNUM` and `start`/`end`, and paginates via `offset`/`limit`
  (`pyobs_archive/api/views.py::filter_frames`), returning `{count, results}`; per-frame
  `get_info()` returns `id`, `basename`, `DATE_OBS`, `FILTER`, `EXPTIME`, `OBSNUM`, `url`
  (`frames/<id>/download/`), … (`pyobs_archive/api/models.py`).
- Per-frame endpoints (all DRF `IsAuthenticated`, token auth works):
  `/frames/<id>/`, `/frames/<id>/download/`, `/frames/<id>/preview/`, `/frames/<id>/headers/`.
- pyobs-core `PyobsArchive` (`pyobs/robotic/utils/archive/pyobs_archive.py`) — async (aiohttp,
  30 s timeout), token header, `list_frames()` already pages through the archive's
  `offset`/`limit` until `count` is reached (a large frame set per observation is fetched fully,
  not truncated). The `obsnum` filter this plan needs (pyobs/pyobs-core#791) **has since landed
  and released** (PR #792, `pyobs-core` `2.0.0.dev87`+, current `dev92`): `list_frames()` /
  `list_options()` take `obsnum: str | None = None` and `_build_query()` emits
  `params["OBSNUM"] = obsnum`. This repo's own `pyproject.toml` still pins
  `pyobs-core>=2.0.0.dev71` and `uv.lock` resolves to `dev72` — pre-fix — so §1 below is just a
  pin bump + `uv lock`, not new upstream work.
- Backend API: `GET /api/observations/`, `GET /api/observations/<id>/`,
  `GET /api/tasks/<code>/observations/` — all access-scoped to public/member projects
  (`api/views.py`); `ObservationSerializer` fields `id, task, start, end, state, target, obsnum`.
- Frontend Observations tab: `#tab-observations`
  (`frontend/templates/frontend/task_detail.html`), rendered by `loadObservationTable()`
  (`frontend/static/frontend/js/taskeditor.js`, ~L977) — Start/End/State/Target columns only.
- Scheduling exists: Celery tasks (`api/tasks.py`: `mark_window_expired`,
  `delete_old_observations`) plus a periodic APScheduler process (`task_scheduler.py`) that
  dispatches them on cron triggers — the natural place for a periodic frame-refresh job.

## Design decisions

1. **Server-side resolution of metadata; data links point straight to the archive.** Frame
   *metadata* is resolved server-side via `PyobsArchive` (service token, no CORS concerns) and
   served by the backend. The actual data (frame page, FITS download, preview, headers) is
   **always linked directly to the archive** — no backend data endpoints, no redirects, no bytes
   through the backend. The user's browser authenticates against the archive itself (shared
   Keycloak SSO; both services run `pyobs-auth`).
2. **Join key: `obsnum` + time window.** `OBSNUM` is a per-night counter in both services, so
   `obsnum` alone can collide across nights — always combine `OBSNUM` with a `DATE_OBS` window
   (observation `start`..`end`, ± 5 minutes). 5 min covers clock skew and any slack between the
   backend's recorded `start`/`end` and the camera's actual exposure timestamps, while staying
   well inside a single night — the thing `OBSNUM` needs the window for in the first place. Fall
   back to time-window-only matching when `obsnum` is missing.
3. **Refresh-based resolution with a DB-backed cache (no N+1, no LocMemCache).** The
   observations list returns up to 500 rows per page; resolving per row on the list means up to
   500 archive calls per page load. Instead: store resolved frame info on the `Observation` row
   (JSONField + `frames_updated_at`); the list serializer reads the cache with no archive calls;
   a dedicated `GET /api/observations/<id>/frames/` endpoint resolves on demand and refreshes on
   a TTL. **The cache is a refresh, not a final answer:** an observation's frame list keeps
   growing — the reduction pipeline attaches new files (higher `RLEVEL` products, related
   frames) to the archive the following morning, after the observation completed — so the
   completion-time resolve is only the first fill; later files appear via TTL-based
   re-resolution on read plus a periodic sweep (section 6). Use the DB, not the per-process
   `LocMemCache` whose staleness pitfall was the root cause of #83.
4. **Reuse `PyobsArchive`** behind an `asgiref.sync.async_to_sync` wrapper; the only pyobs-core
   change is adding the `obsnum` filter parameter (upstream, small). Fallback if a pyobs-core
   release is blocked: build the query URL directly in the backend client behind the same
   wrapper interface.
5. **Auth: static service token; users cross-auth via Keycloak.** Server-to-server calls
   (metadata resolution) use a static `ARCHIVE_TOKEN` — `ARCHIVE_URL` + `ARCHIVE_TOKEN` env
   vars, mirroring the archive's `ROBOTIC_BACKEND_URL`/`ROBOTIC_BACKEND_TOKEN` pattern. Unset →
   feature off, no links, no archive calls. When the user opens the archive links (decision 1),
   the browser authenticates against the archive through the shared Keycloak SSO — no per-user
   token handling on the backend.
6. **Resilience.** Archive timeouts/unavailability/5xx are non-fatal: log a warning, return the
   stale cache or an empty `frames` list — the observations list/detail endpoints never fail
   because the archive is down.

## Implementation

### 1. pyobs-core: `PyobsArchive` `OBSNUM` filter — done upstream (pyobs/pyobs-core#791, closed)

- [x] `pyobs/robotic/utils/archive/pyobs_archive.py`: `obsnum: str | None = None` on
      `list_frames()` and `list_options()`, threaded into `_build_query()`, which emits
      `params["OBSNUM"] = obsnum`.
- [x] Abstract signatures in `pyobs/robotic/utils/archive/archive.py`
      (`Archive.list_frames`/`list_options`) consistent.
- [x] pyobs-core test: `test_list_options_passes_obsnum_to_query` /
      `test_list_frames_passes_obsnum_to_query`
      (`tests/robotic/utils/archive/test_pyobs_archive.py`).
- [ ] **Remaining:** bump `pyobs-core>=2.0.0.dev87` (or later — `dev92` is current) in
      `pyproject.toml` + `uv lock` here.

### 2. Backend configuration

- [ ] `settings.py`: `ARCHIVE_URL = os.environ.get("ARCHIVE_URL", "")`,
      `ARCHIVE_TOKEN = os.environ.get("ARCHIVE_TOKEN", "")`,
      `FRAMES_CACHE_TTL = int(os.environ.get("FRAMES_CACHE_TTL", 3600))` (seconds; default 1 h).
- [ ] README env table + `.env.example`: `ARCHIVE_URL`, `ARCHIVE_TOKEN`, `FRAMES_CACHE_TTL`
      (all optional; unset `ARCHIVE_URL`/`ARCHIVE_TOKEN` disables the feature).

### 3. Archive client wrapper — `pyobs_robotic_backend/api/archive.py`

- [ ] `resolve_frames(observation) -> list[dict] | None`: `None` when the archive is
      disabled/unreachable, `[]` when enabled but no frames match, else a list of frame dicts.
- [ ] Instantiate `PyobsArchive(url=settings.ARCHIVE_URL, token=settings.ARCHIVE_TOKEN)`, run
      via `asgiref.sync.async_to_sync`.
- [ ] Query: `obsnum` present → `list_frames(obsnum=…, start=…, end=…)`; else →
      `list_frames(start=…, end=…)` (astropy `Time` from `start`/`end`, UTC).
- [ ] Map `PyobsArchiveFrameInfo` → `{id, basename, dateobs, filter, binning, url}` where `url`
      is the absolute archive frame-page URL (`urljoin(ARCHIVE_URL, f"frames/{id}/")`); the
      frontend links straight to the archive (download/preview/headers live on the archive's
      own frame page).
- [ ] Wrap everything in try/except (aiohttp errors, timeouts, JSON errors): log a warning,
      return the cached value or `None` — never raise into the request.

### 4. Model: frames cache — `pyobs_robotic_backend/api/models.py`

- [ ] `Observation.frames = models.JSONField(null=True, blank=True)` and
      `Observation.frames_updated_at = models.DateTimeField(null=True, blank=True)`; migration
      `api/migrations/0009_observation_frames.py` (current head is `0008_task_observation_updated_at.py`).
- [ ] Only terminal-with-data states (`completed`, `aborted`, `failed`) are resolved;
      `pending`/`in_progress`/`canceled`/`window_expired` keep `frames` `null` without archive
      calls.

### 5. API — `pyobs_robotic_backend/api/{serializers,views,urls}.py`

- [ ] `ObservationSerializer`: add read-only `frames` field (serializes the cached list; `null`
      → not resolved yet).
- [ ] `GET /api/observations/<id>/frames/` (`ObservationFrames`, `IsAuthenticated`, same
      access-scoped queryset as `ObservationDetail`): resolve lazily via the wrapper (the client
      pages through the archive's `offset`/`limit` automatically), store + stamp
      `frames_updated_at`, return `{"frames": […], "archive_enabled": bool}`; **paginate the
      cached list via `offset`/`limit`** (default page 25, plus `count`); refresh when the cache
      is older than `FRAMES_CACHE_TTL` (settings, default 1 h — matches the periodic sweep
      cadence in §6, so a read-triggered refresh and the sweep never fight over freshness). No
      data endpoints — download/preview/
      headers are served by the archive and linked directly.
- [ ] `urls.py`: register the frames route.
- [ ] README API overview: row for the new endpoint.

### 6. Frame refresh tasks — `pyobs_robotic_backend/api/tasks.py`, `task_scheduler.py`

- [ ] `@shared_task refresh_observation_frames(obs_id)`: resolve + store via the wrapper
      (idempotent; archive errors → leave `frames` unchanged, log; skips non-terminal states).
- [ ] `post_save` receiver on `Observation` (e.g. `api/signals.py`, wired in `api/apps.py`):
      on transition into terminal-with-data, `refresh_observation_frames.delay(pk)` — **first
      fill only**; this alone is not enough, because the pipeline attaches new files to the
      archive the following morning (see decision 3).
- [ ] `@shared_task sweep_stale_observation_frames()`: query terminal-with-data observations
      from the last 7 days where `frames_updated_at` is `null` or older than
      `settings.FRAMES_CACHE_TTL`, and `.delay()` `refresh_observation_frames` for each —
      matches the existing pattern of thin periodic tasks fanning out to the per-row task
      (`mark_window_expired`, `delete_old_observations`).
- [ ] Periodic sweep in `task_scheduler.py`: `scheduler.add_job(sweep_stale_observation_frames.delay,
      CronTrigger.from_crontab("0 * * * *"))` — hourly, matching `FRAMES_CACHE_TTL`'s default (a
      tighter cadence than the TTL would just re-do work the TTL check already prevents; looser
      would leave next-morning reduction products unlinked longer than the cache claims to be
      fresh). Re-resolves terminal observations from the last 7 days (covers the
      "attached the following morning" case with margin for a delayed reduction run) whose
      `frames_updated_at` is older than `FRAMES_CACHE_TTL` or still `null`.

### 7. Frontend — `frontend/templates/frontend/task_detail.html`,
   `frontend/static/frontend/js/taskeditor.js`

- [ ] `#tab-observations`: add a "Data" column to thead/tbody; adjust the "Loading…"/"None."
      row colspan from 4 to 5.
- [ ] `loadObservationTable()`: per row — `obs.frames` non-empty → "open in archive" links
      (frame page in the archive, opened in a new tab so the Keycloak SSO login chain completes;
      download/preview/headers live on the archive's own frame page); empty list → muted "—";
      `null` + terminal-with-data state → lazily fetch `observations/${obs.id}/frames/` via the
      existing `apiRequest` (small "loading" indicator, concurrency-capped), then render; on
      failure → muted "unavailable". Archive disabled → nothing rendered.

### 8. Docs

- [ ] README: env table, API overview rows, frontend feature bullet ("Observations tab links
      each completed observation to its archived frames: preview, headers, FITS download").
- [ ] `.env.example`: commented `ARCHIVE_URL` / `ARCHIVE_TOKEN`.

## Tests

pyobs-core's `_build_query`/`list_frames(obsnum=…)` coverage is already in on `develop`
(`test_list_options_passes_obsnum_to_query`, `test_list_frames_passes_obsnum_to_query`) — no new
pyobs-core tests needed here. Following this repo's convention
(`pyobs_robotic_backend/api/tests.py`: one flat file, one `TestCase` per unit — see
`ProjectPublicApiTests`, `UpdateMarkerApiTests`):

- `ArchiveClientWrapperTests` (`api/archive.py`, mocked `PyobsArchive`): obsnum + window query;
  time-window fallback; archive down → `None`/`[]` without raising; pagination/`count` handling.
- `ObservationFramesApiTests`: `/frames/` endpoint access scoping (non-member → 404),
  offset/limit pagination, `FRAMES_CACHE_TTL` refresh, cache persistence, disabled (no
  `ARCHIVE_URL`) → `archive_enabled: false`; frame dicts carry the correct absolute archive
  URLs; `ObservationSerializer` includes `frames`.
- `ObservationFramesRefreshTaskTests`: `refresh_observation_frames` resolves and stores; the
  `post_save` signal fires only on transitions into terminal-with-data; TTL re-resolution picks
  up newly attached frames (mock a second archive result after the TTL);
  `sweep_stale_observation_frames` only touches rows both within the 7-day window and past the
  TTL (or `null`), and fans out one `refresh_observation_frames.delay()` per matched row.
- Frontend: manual (Observations tab renders links; archive down → muted, list still loads).

## Consequences

- **Good:** one click from a completed observation to its data (preview/headers/FITS) in both
  API and UI.
- **Good:** single auth point (service token); archive unavailability never breaks the
  observations list.
- **Good:** list endpoints stay cheap (DB cache, no N+1, no LocMemCache).
- **Neutral:** cached frame info can be stale up to the TTL; the archive stays the source of
  truth and is re-queried on TTL/refresh — which also picks up pipeline products attached the
  following morning.
- **Trade-off:** the data links require the archive to be reachable from the user's browser and
  to accept the user's identity (shared Keycloak SSO); with token-only archive auth the links
  would 401 in the browser — the backend only ever resolves metadata with the service token.
- **Interplay with pyobs-archive#42 (project access control):** the service token bypasses any
  future per-user filtering for metadata resolution, but the linked data is fetched by the
  user's own browser, so #42's per-user filtering applies directly to it. Keep the backend's
  access scoping on the metadata endpoints; revisit when #42 lands.

## Open questions / deferred

- **Project-level "all data" view (deferred, out of scope for #82).** Today's scope is
  per-task: the Observations tab of a task links that task's observations to their frames. A
  project-level view would aggregate archived data across every task/observation of a project
  (all tasks, all nights) into one data browser — a separate feature/issue, as it needs its own
  API surface and UI beyond the task editor.
