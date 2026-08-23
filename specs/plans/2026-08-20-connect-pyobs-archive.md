# Plan: Connect pyobs-robotic-backend to pyobs-archive (observations → data links)

Tracks pyobs/pyobs-robotic-backend#82.
Repos: pyobs-robotic-backend only — the archive's existing frontend and API need no changes
(verified below), and there is no pyobs-core dependency.
Status: implemented (pyobs/pyobs-robotic-backend#89)

## Problem

The backend stores observation history (`Observation` records with `start`, `end`, `state`,
`obsnum`) but has no connection to pyobs-archive, the service that stores and serves the actual
FITS data. Users cannot jump from a completed observation in the backend to its data — they have
to open the archive separately and search for the frames manually. Every observation should link
**directly** to its archived data, both in the API and in the frontend Observations tab.

## What exists today

- `Observation.obsnum` (`CharField(32)`, nullable) plus `start`/`end` — the join key needs no
  schema change (`pyobs_robotic_backend/api/models.py`).
- **The archive's own frontend already deep-links from URL query params — verified in code.**
  `pyobs_archive/frontend/static/js/app.js:329-343`: on page load it reads
  `URLSearchParams(window.location.search)`, pre-fills the search form from `OBSNUM`, `REQNUM`,
  `start`, `end` (among others), and calls `refreshTable()`. So
  `{ARCHIVE_URL}/?OBSNUM={obsnum}&start={start}&end={end}` already shows exactly the right frames
  through the archive's existing, authenticated (Keycloak SSO) UI — **no archive-side change
  needed** to link straight to an observation's data. This supersedes an earlier draft of this
  plan that resolved frame metadata server-side via a `PyobsArchive` client, a DB-backed cache,
  and a periodic refresh task; see "Rejected: server-side resolution" below for why that's more
  than this problem needs.
- pyobs-archive `frames_view` (`pyobs_archive/api/views.py:169-191`, the JSON API backing that
  frontend) filters on `OBSNUM`, `RLEVEL` (exact match only, no `__gt`), and `start`/`end`
  (`DATE_OBS` range), and **always computes `data.count()` regardless of `limit`** — with
  `limit=0` the response is `{"count": N, "results": []}`: a single indexed COUNT query
  (`OBSNUM`/`RLEVEL` are `db_index=True`, `api/models.py:27`), no frame rows serialized. `RLEVEL`
  defaults to `0` for raw frames and is set from the FITS header otherwise
  (`api/models.py:106`), so "any reduced data yet" = `count(no RLEVEL filter) >
  count(RLEVEL=0)`. `IsAuthenticated`, token auth works.
- Backend API: `GET /api/observations/`, `GET /api/observations/<id>/`,
  `GET /api/tasks/<code>/observations/` — all access-scoped to public/member projects
  (`api/views.py`); `ObservationSerializer` fields `id, task, start, end, state, target, obsnum`.
- Frontend Observations tab: `#tab-observations`
  (`frontend/templates/frontend/task_detail.html`), rendered by `loadObservationTable()`
  (`frontend/static/frontend/js/taskeditor.js`, ~L977) — Start/End/State/Target columns only.

## Rejected: server-side resolution, DB cache, periodic refresh

An earlier draft resolved frame *metadata* server-side (via pyobs-core's `PyobsArchive` async
client + a service token), cached the result on `Observation.frames` (JSONField), and kept it
fresh with a `post_save` signal plus an hourly Celery sweep (to pick up reduction products the
pipeline attaches the following morning). Reconsidered because:

- The actual ask (#82: "link observations to their data") is satisfied by a **link**, not by the
  backend re-serving frame metadata it doesn't need to own.
- The motivating concern for the cache — "the observations list returns up to 500 rows per page;
  resolving per row means up to 500 archive calls per page load" — only applies if the backend
  calls the archive *at all* on the list endpoint. A link built from `ARCHIVE_URL` + `obsnum` +
  `start`/`end` is pure string formatting: zero archive calls, so there's nothing to cache and
  nothing that goes stale.
- That also removes the entire cross-repo footprint this plan had: no pyobs-core dependency (no
  `PyobsArchive`/`asgiref.sync.async_to_sync` wrapper needed — nothing here calls that client),
  no `ARCHIVE_TOKEN` service-account provisioning for bulk resolution, no DB migration, no Celery
  task, no periodic sweep, no TTL/staleness reasoning. What's left (below) is a single-repo,
  same-day change.
- A small, deliberate on-demand exception remains for a "does this have data yet" indicator (§3)
  — see "Design decisions" below for why that one case still needs a live archive call, and why
  it's safe against the same N-calls concern the rejected design was built to avoid.

## Design decisions

1. **Link-based access — no backend data endpoints, no redirects, no bytes through the
   backend.** `archive_url` is computed from `ARCHIVE_URL` + `obsnum` + `start`/`end`, exposed on
   `ObservationSerializer`, and rendered as a link in the Observations tab for any observation in
   a terminal-with-data state (`completed`, `aborted`, `failed`). The browser opens it directly;
   the user authenticates against the archive itself through the shared Keycloak SSO (both
   services run `pyobs-auth`) — no per-user token handling on the backend, and computing the URL
   requires no archive call at all, so it's safe to include for every row in a 500-row list page.
2. **Join key: `obsnum` + time window.** `OBSNUM` is a per-night counter in both services, so
   `obsnum` alone can collide across nights — always combine `OBSNUM` with a `DATE_OBS` window
   (observation `start`..`end`, ± 5 minutes). 5 min covers clock skew and any slack between the
   backend's recorded `start`/`end` and the camera's actual exposure timestamps, while staying
   well inside a single night. Fall back to a `start`/`end`-only URL (omit `OBSNUM`) when
   `obsnum` is missing — the archive frontend handles a partial query string fine (unset params
   are simply not applied as filters, per `app.js`'s `params.has(...)` checks).
3. **On-demand data-status check (count + reduced flag), computed live, never cached.** The
   Observations tab additionally wants to show *whether* an observation actually has data (and
   whether it's been reduced yet) without waiting for a click-through. This needs a real archive
   call — a link alone can't answer it — but the two count queries `frames_view` needs
   (`limit=0`, once unfiltered and once with `RLEVEL=0`) are cheap, indexed COUNT queries with no
   row serialization. The N-calls-per-page-load problem that killed the old cached-resolution
   design was about **doing this on the list endpoint**, not about the calls being expensive in
   isolation — so the fix is to scope it to where at most one call happens per user action: a
   dedicated `GET /api/observations/<id>/frames/` endpoint, fetched by the frontend lazily, only
   for the single observation the user is actually looking at (e.g. on row expand), never for an
   entire page of rows at once. Computed synchronously on every request — no DB field, no
   `post_save` signal, no Celery task, no periodic sweep, no TTL. Staleness stops being a
   question because every open re-asks the archive directly; the "reduction pipeline attaches
   files the following morning" concern from the rejected design is a non-issue here too, since
   there's no cache to go stale in the first place.
4. **Auth: static service token, scoped to the narrow on-demand check only.** `frames_view`
   requires `IsAuthenticated`, so §3's two COUNT queries need a token — `ARCHIVE_URL` +
   `ARCHIVE_TOKEN` env vars, mirroring the archive's `ROBOTIC_BACKEND_URL`/
   `ROBOTIC_BACKEND_TOKEN` pattern. Unlike the rejected design, this token now backs only a
   cheap, user-triggered, uncached call — not bulk/scheduled resolution — so its blast radius and
   rate are both small by construction. Plain synchronous `requests.get()` against `frames_view`
   is enough; no `PyobsArchive` client, no `asgiref` wrapper, no pyobs-core version dependency.
   Unset `ARCHIVE_TOKEN` → the data-status endpoint reports `"status": "unavailable"`; `archive_url`
   (decision 1) still renders regardless, since it never needed the token.
5. **Resilience.** Archive timeout/unreachable/5xx on the on-demand check → log a warning, return
   `{"archive_url": …, "status": "unavailable"}` (never a 5xx to the frontend) — the link itself,
   built without any archive call, always renders even when the archive is down.

## Implementation

### 1. Backend configuration

- [x] `settings.py`: `ARCHIVE_URL = os.environ.get("ARCHIVE_URL", "")`,
      `ARCHIVE_TOKEN = os.environ.get("ARCHIVE_TOKEN", "")`.
- [x] README env table + `.env.example`: `ARCHIVE_URL` (optional; unset → no `archive_url` field
      / no links), `ARCHIVE_TOKEN` (optional; unset → `archive_url` still works, data-status
      always reports `"unavailable"`).

### 2. `archive_url` — `pyobs_robotic_backend/api/serializers.py`

- [x] `ObservationSerializer`: add a computed `archive_url` field (`SerializerMethodField`),
      `None` when `settings.ARCHIVE_URL` is unset or the observation isn't in a
      terminal-with-data state; else
      `f"{settings.ARCHIVE_URL}/?start={start}&end={end}"` plus `&OBSNUM={obsnum}` when
      `obsnum` is set (decision 2) — pure string formatting, no I/O, safe on every list row.
- [x] Unit test: field present/absent per state and per `ARCHIVE_URL` config; `OBSNUM` included
      only when set; values URL-encoded.

### 3. Data-status endpoint — `pyobs_robotic_backend/api/{views,urls}.py`

- [x] `GET /api/observations/<id>/frames/` (`ObservationDataStatus`, `IsAuthenticated`, same
      access-scoped queryset as `ObservationDetail`): builds the archive query params from
      `obsnum`/`start`/`end` as in decision 2, issues two synchronous `requests.get()` calls to
      `{ARCHIVE_URL}/frames/` (`limit=0`, `Authorization: Token {ARCHIVE_TOKEN}`) — one
      unfiltered, one with `RLEVEL=0` — and returns
      `{"archive_url": …, "count": total, "reduced": total > raw_only}`. Non-terminal state,
      unset `ARCHIVE_URL`/`ARCHIVE_TOKEN`, or any request exception/non-2xx/timeout →
      `{"archive_url": archive_url_or_null, "status": "unavailable"}` (decision 5), never a
      backend-side 5xx.
- [x] `urls.py`: register the route.
- [x] README API overview: row for the new endpoint.

### 4. Frontend — `frontend/templates/frontend/task_detail.html`,
   `frontend/static/frontend/js/taskeditor.js`

- [x] `#tab-observations`: add a "Data" column to thead/tbody; adjust the "Loading…"/"None." row
      colspan from 4 to 5.
- [x] `loadObservationTable()`: per row — `obs.archive_url` present → render an "open in archive"
      link immediately (opened in a new tab so the Keycloak SSO login chain completes), using
      only data already on the list response (no extra call); `archive_url` absent (non-terminal
      state or `ARCHIVE_URL` unset) → nothing rendered.
- [x] Data-status is **not** fetched for the whole list. Fetch it lazily only when a row is
      expanded/opened (existing row-detail interaction, or a small "check" affordance next to the
      link) via the existing `apiRequest` helper against `observations/${obs.id}/frames/`; render
      "N frames (reduced)" / "N frames (raw only)" / muted "unavailable" next to the link. This
      is the one place a per-row archive call happens, and it's bounded to whichever single row
      the user actually opened — never a bulk fetch across the page.

### 5. Docs

- [x] README: env table, API overview row, frontend feature bullet ("Observations tab links each
      completed observation straight to its archived data in the archive's own UI, with an
      on-demand frame count/reduction-status check").
- [x] `.env.example`: commented `ARCHIVE_URL` / `ARCHIVE_TOKEN`.

## Tests

Following this repo's convention (`pyobs_robotic_backend/api/tests.py`: one flat file, one
`TestCase` per unit — see `ProjectPublicApiTests`, `UpdateMarkerApiTests`):

- `ArchiveUrlSerializerTests`: `archive_url` present/absent per state, per `ARCHIVE_URL` config,
  `OBSNUM` included only when set, values URL-encoded correctly.
- `ObservationDataStatusApiTests` (mocked `requests.get`): access scoping (non-member → 404,
  matching `ObservationDetail`); normal case returns `{count, reduced}` from the two mocked COUNT
  responses; `RLEVEL=0`-only responses → `reduced: false`; archive timeout/connection error/non-2xx
  → `{"status": "unavailable"}`, no 5xx; unset `ARCHIVE_URL`/`ARCHIVE_TOKEN` → `"unavailable"`
  without attempting a request; non-terminal-state observation → `"unavailable"` without a
  request either (mirrors the old design's "only terminal-with-data states are resolved" rule,
  minus the caching).
- Frontend: manual (Observations tab renders links from the list response alone, no archive
  calls on load; expanding a row fetches and renders the count/reduced status; archive down →
  link still shown, status shows "unavailable").

## Consequences

- **Good:** one click from a completed observation to its data, in both API and UI, with zero
  cross-repo changes — the archive's existing frontend and API already do the work.
- **Good:** no DB migration, no Celery task, no periodic sweep, no TTL/staleness reasoning, no
  pyobs-core version dependency — the whole feature is additive within this repo.
- **Good:** the list endpoint never calls the archive; archive unavailability can only ever
  affect the on-demand data-status check for one open row, never the list.
- **Trade-off:** no inline "N frames" indicator across the whole list without a click/expand per
  row — a deliberate trade against re-introducing per-row archive calls at list-load time
  (decision 3). The link itself is always available without this trade-off.
- **Trade-off:** the data links require the archive to be reachable from the user's browser and
  to accept the user's identity (shared Keycloak SSO) — unchanged from the rejected design.
- **Interplay with pyobs-archive#42 (project access control):** if/when `PROJECT_ACCESS_CONTROL`
  lands, the service token used for the on-demand count check bypasses any future per-user
  project filtering (superuser-equivalent for that one query) — same caveat as the rejected
  design had, just now scoped to a count instead of full metadata. The link itself carries no
  token, so once the user's own browser session hits the archive, `#42`'s filtering (if enabled)
  applies to what they can actually open. Revisit the count-check scoping if `#42` lands and this
  bypass becomes a concern.

## Open questions / deferred

- **Project-level "all data" view (deferred, out of scope for #82).** Today's scope is
  per-task: the Observations tab of a task links that task's observations to their frames. A
  project-level view would aggregate archived data across every task/observation of a project
  (all tasks, all nights) into one data browser — a separate feature/issue, as it needs its own
  API surface and UI beyond the task editor.
