# pyobs-robotic-backend

Backend service for the [pyobs](https://www.pyobs.org) robotic telescope system. It stores and serves the task queue (observations to be scheduled), projects, and observation history consumed by the pyobs scheduler and related tools.

## Features

- **REST API** — Token- and session-authenticated DRF endpoints for tasks, projects, observations, users, and constraints/merits/targets.
- **Web frontend** — Bootstrap 5 dark-theme UI for browsing and editing tasks, with dynamic schema-driven forms for constraints, merits, and targets, and a live-validated YAML script editor.
- **Schema introspection** — `/api/schema/` endpoints expose `model_json_schema()` for all pyobs-core constraint, merit, target, and script classes so the frontend can render typed editors without hard-coding any fields.
- **Celery integration** — Asynchronous task processing via a message broker.
- **Docker-ready** — Ships with a `Dockerfile` and supports PostgreSQL via environment variables.

## Requirements

- Python ≥ 3.12
- [pyobs-core](https://github.com/pyobs/pyobs-core) ≥ 1.46.0
- PostgreSQL (production) or SQLite (development)
- A Celery-compatible message broker (e.g. RabbitMQ)

## Installation

```bash
# Using uv (recommended)
uv sync

# Or pip
pip install -e .
```

## Configuration

All settings are controlled by environment variables. Copy `pyobs_robotic_backend/local_settings.example.py` to `pyobs_robotic_backend/local_settings.py` for local overrides, or set the following in your environment / Docker compose file:

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `foo` | Django secret key — **change in production** |
| `DEBUG` | `1` | Set to `0` in production |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated list of allowed hosts |
| `CSRF_TRUSTED_ORIGINS` | `http://localhost` | Comma-separated list of trusted origins |
| `CORS_ALLOWED_ORIGINS` | (empty) | Comma-separated list of origins allowed to make cross-origin requests to the API |
| `SECURE_CROSS_ORIGIN_OPENER_POLICY` | `same-origin` | Set to `none` to disable the `Cross-Origin-Opener-Policy` header (needed for HTTP-only deployments, since browsers warn/ignore it off HTTPS) |
| `SQL_ENGINE` | `django.db.backends.sqlite3` | Database backend |
| `SQL_DATABASE` | `db.sqlite3` | Database name / path |
| `SQL_USER` | `user` | Database user |
| `SQL_PASSWORD` | `password` | Database password |
| `SQL_HOST` | `localhost` | Database host |
| `SQL_PORT` | `5432` | Database port |
| `CELERY_BROKER_URL` | `amqp://` | Celery broker URL |
| `CELERY_RESULT_BACKEND` | `rpc://` | Celery result backend |
| `STATIC_ROOT` | `static/` | Directory for collected static files |
| `ENABLE_FRONTEND` | `0` | Set to `1` to enable the web frontend |
| `SITE_LATITUDE` | — | Observatory latitude in decimal degrees |
| `SITE_LONGITUDE` | — | Observatory longitude in decimal degrees |
| `SITE_ELEVATION` | — | Observatory elevation in metres |
| `DEFAULT_CONSTRAINTS` | `[]` | JSON array of constraint objects pre-filled on new tasks |
| `DEFAULT_MERITS` | `[]` | JSON array of merit objects pre-filled on new tasks |
| `KEYCLOAK_SERVER_URL` | (empty) | Keycloak login (optional addon on top of local Django username/password and Token auth; unset disables it) |
| `KEYCLOAK_REALM` | `pyobs` | Keycloak realm |
| `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` | `robotic-backend` / (empty) | This service's Keycloak client credentials |
| `KEYCLOAK_REDIRECT_URI` | (empty) | Must match the redirect URI registered for this client in Keycloak |
| `KEYCLOAK_POST_LOGOUT_REDIRECT_URI` | (empty) | Must match a "Valid post logout redirect URI" registered for this client in Keycloak |
| `KEYCLOAK_IDP_HINT` / `KEYCLOAK_IDP_LABEL` | (empty) | Optional one-click IdP login: hint passed to Keycloak as `kc_idp_hint` (skips its login/IdP-selection page) and the label for the login page's IdP button, e.g. `gwdg` / `GWDG` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | (empty) | Settings-configured superuser, synced after every `migrate`; leave unset to use `createsuperuser` instead |
| `ARCHIVE_URL` | (empty) | Base URL of a [pyobs-archive](https://github.com/pyobs/pyobs-archive) instance; unset disables `archive_url` links entirely |
| `ARCHIVE_TOKEN` | (empty) | Service token for the archive's `frames_view` API; unset makes the on-demand frame-count/reduction check always report `"unavailable"` (links still work) |

## Running

### Development

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

The API is served at `http://localhost:8000/api/`. If the frontend is enabled, the UI is available at `http://localhost:8000/`.

Setting `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` (generate the hash with
`uv run python -c "from django.contrib.auth.hashers import make_password; print(make_password('yourpassword'))"`)
syncs a matching superuser automatically after every `migrate`, skipping the interactive
`createsuperuser` step above.

### Docker Compose

A production-ready setup with PostgreSQL, RabbitMQ, a Celery worker, and nginx is provided in [`docker-compose.yml`](docker-compose.yml). The application image is pulled from `ghcr.io/pyobs/pyobs-robotic-backend:latest`. Copy [`.env.example`](.env.example) to `.env` and [`nginx.conf.example`](nginx.conf.example) to `nginx.conf`, then adjust the values.

The UI is served by nginx on port **8097**.

Then start everything with:

```bash
docker compose up -d
```

Migrations and static file collection run automatically on startup. To create a superuser:

```bash
docker compose run --rm web uv run python manage.py createsuperuser
```

Or set `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` in `.env` to skip this — a matching superuser is
synced automatically as part of the migration step above.

### Building a site-specific image

The published image only ships `pyobs-core`. Some features need more than that to work fully at
a given site: in particular, the script builder's module-name dropdowns (`WEBADMIN_URL`, see
`.env.example`) resolve real module classes with `issubclass()` against `pyobs.interfaces` to
filter them, which means each configured module's class has to actually *import* in this
process. If your modules use a hardware-specific driver package (`pyobs-iagvt`, `pyobs-fli`,
`pyobs-brot`, ...), that package needs to be installed on top of the base image — and since it's
site-specific (and often private), it doesn't belong in this repo or its published image. Build
a thin derived image instead, in your own deployment config repo, alongside your `docker-compose.yml`:

```dockerfile
# deploy/Dockerfile
FROM ghcr.io/pyobs/pyobs-robotic-backend:latest

# Only needed for a private git dependency, forwarding your SSH agent instead of baking in a key:
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=ssh \
    mkdir -p -m 0700 ~/.ssh && ssh-keyscan gitlab.example.org >> ~/.ssh/known_hosts && \
    uv pip install git+ssh://git@gitlab.example.org/your-org/pyobs-yoursite.git
```

Then point every service in your `docker-compose.yml` that runs this image (`web`, `celery`,
`task_scheduler`) at that Dockerfile instead, replacing each `image: ghcr.io/...` line with:

```yaml
    build:
      context: ./deploy
      ssh:
        - default
```

Build and run with your SSH agent forwarded (`--ssh default` picks up `$SSH_AUTH_SOCK`; make
sure the key that can clone your private repo is loaded first, e.g. `ssh-add ~/.ssh/id_ed25519`):

```bash
DOCKER_BUILDKIT=1 docker compose build --ssh default
docker compose up -d
```

No `--mount=type=ssh`/SSH agent forwarding is needed if your extra package is public — drop that
`RUN` block's SSH setup and just `uv pip install` the package directly.

## API Overview

Authentication is via token (`Authorization: Token <token>`), Django session cookie, or a Keycloak Bearer token (if configured). Obtain a static token at `/api-token-auth/`.

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/users/` | List / create users (admin only) |
| GET/PATCH | `/api/users/<id>/` | Retrieve / update user (admin only) |
| GET/POST | `/api/projects/` | List projects (resolved per user: public + memberships) / create (admin only); projects carry a `public` flag |
| GET/PATCH | `/api/projects/<code>/` | Retrieve / update project (admin only) |
| GET/POST | `/api/projects/<code>/tasks/` | List / create tasks for an accessible project |
| GET | `/api/tasks/` | List tasks (filtered to accessible projects: public + memberships) |
| GET/PUT/PATCH | `/api/tasks/<code>/` | Retrieve / update task (PATCH for partial updates) |
| GET/POST | `/api/observations/` | List / create observations (list filtered to accessible projects); includes `archive_url` when `ARCHIVE_URL` is set |
| GET/PATCH | `/api/observations/<id>/` | Retrieve / update observation (filtered to accessible projects) |
| GET | `/api/observations/<id>/frames/` | On-demand frame count / reduction status from pyobs-archive (`{"archive_url", "count", "reduced"}`, or `{"archive_url", "status": "unavailable"}`) |
| GET | `/api/me/` | Current user info |
| GET | `/api/last_task_update/` | Timestamp of last task change |
| GET | `/api/last_observation_update/` | Timestamp of last observation change |
| GET | `/api/schema/constraints/` | JSON Schema for all Constraint subclasses |
| GET | `/api/schema/merits/` | JSON Schema for all Merit subclasses |
| GET | `/api/schema/targets/` | JSON Schema for all Target subclasses |
| GET | `/api/schema/scripts/` | Script class tree with schemas |
| POST | `/api/validate_script/` | Validate a script dict against pyobs-core |
| POST | `/api/estimate_duration/` | Estimate script duration in seconds |

## Web Frontend

The browser UI is mounted at `/` and requires a login. Features:

- **Sidebar** — task list grouped by project; click a task to open it. Upload icon imports a task from YAML; `+` creates a new task.
- **Task overview** — tabular view of all tasks grouped by project with bulk activate/deactivate via checkboxes.
- **Task editor** — tabbed view with **Task** (general fields, target, constraints, merits), **Script** (YAML editor with live validation and template insertion), **Schedule** (upcoming observations), and **Observations** (completed/cancelled history). Each completed/aborted/failed observation links straight to its archived data in the archive’s own UI, with an on-demand frame count/reduction-status check.
  - **Sidereal target** — RA/Dec fields accept decimal degrees or hms/dms (e.g. `15:52:56.12` / `+12:54:44`). A Simbad name-search button resolves object names and populates the coordinates. An [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/) DSS sky view is shown below the target form and pans live as coordinates change.
  - **Duration estimation** — stopwatch button calls `/api/estimate_duration/` on the current script.
  - **Clone** — copies the current task to a new code, opening a pre-filled editor without saving.
  - **Export YAML** — downloads the current form state as a `.yaml` file.
  - **Import YAML** — available in the sidebar and task overview; opens a pre-filled editor from a `.yaml` file without saving.
- **Default constraints/merits** — set `DEFAULT_CONSTRAINTS` / `DEFAULT_MERITS` to pre-fill new tasks with site-specific defaults.
- **Admin panel** — superusers can manage users (including password changes) and projects at `/admin-panel/`.

All data is fetched client-side from the same `/api/` endpoints that [pyobs-task-editor](https://github.com/pyobs/pyobs-task-editor) uses.
