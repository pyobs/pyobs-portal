# pyobs-robotic-backend

Backend service for the [pyobs](https://www.pyobs.org) robotic telescope system. It stores and serves the task queue (observations to be scheduled), projects, and observation history consumed by the pyobs scheduler and related tools.

## Features

- **REST API** — Token- and session-authenticated DRF endpoints for tasks, projects, observations, users, and constraints/merits/targets.
- **Web frontend** — Bootstrap 5 dark-theme UI for browsing and editing tasks, with dynamic schema-driven forms for constraints, merits, and targets, and a live-validated YAML script editor.
- **Schema introspection** — `/api/schema/` endpoints expose `model_json_schema()` for all pyobs-core constraint, merit, target, and script classes so the frontend can render typed editors without hard-coding any fields.
- **Celery integration** — Asynchronous task processing via a message broker.
- **Docker-ready** — Ships with a `Dockerfile` and supports PostgreSQL via environment variables.

## Requirements

- Python ≥ 3.13
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
| `SQL_ENGINE` | `django.db.backends.sqlite3` | Database backend |
| `SQL_DATABASE` | `db.sqlite3` | Database name / path |
| `SQL_USER` | `user` | Database user |
| `SQL_PASSWORD` | `password` | Database password |
| `SQL_HOST` | `localhost` | Database host |
| `SQL_PORT` | `5432` | Database port |
| `CELERY_BROKER_URL` | `amqp://` | Celery broker URL |
| `CELERY_RESULT_BACKEND` | `rpc://` | Celery result backend |
| `STATIC_ROOT` | `static/` | Directory for collected static files |

The web frontend is **disabled by default**. To enable it, set `FRONTEND_ENABLED = True` in `local_settings.py`.

## Running

### Development

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

The API is served at `http://localhost:8000/api/`. If the frontend is enabled, the UI is available at `http://localhost:8000/`.

### Docker Compose

A minimal production-like setup with PostgreSQL, RabbitMQ, a Celery worker, and nginx is provided in [`docker-compose.yml`](docker-compose.yml). Copy [`.env.example`](.env.example) to `.env` and [`nginx.conf.example`](nginx.conf.example) to `nginx.conf`, then adjust the values.

Then start everything with:

```bash
docker compose up -d
```

Migrations and static file collection run automatically on startup. To create a superuser:

```bash
docker compose run --rm web uv run python manage.py createsuperuser
```

## API Overview

Authentication is via token (`Authorization: Token <token>`) or Django session cookie. Obtain a token at `/api-token-auth/`.

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/users/` | List / create users (admin only) |
| GET/PATCH | `/api/users/<id>/` | Retrieve / update user (admin only) |
| GET/POST | `/api/projects/` | List / create projects |
| GET/PATCH | `/api/projects/<code>/` | Retrieve / update project |
| GET/POST | `/api/projects/<code>/tasks/` | List / create tasks for a project |
| GET | `/api/tasks/` | List tasks (filtered to current user's projects) |
| GET/PUT | `/api/tasks/<code>/` | Retrieve / update task |
| GET/POST | `/api/observations/` | List / create observations |
| GET/PATCH | `/api/observations/<id>/` | Retrieve / update observation |
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

- **Sidebar** — task list grouped by project; click a task to open it directly.
- **Task editor** — tabbed view with **Task** (general fields, target, constraints, merits), **Script** (YAML editor with live validation and template insertion), **Schedule** (upcoming observations), and **Observations** (completed/cancelled history).
- **Duration estimation** — stopwatch button next to the duration field calls `/api/estimate_duration/` on the current script and fills in the result.
- **Admin panel** — superusers can manage users (including password changes) and projects at `/admin-panel/`.

All data is fetched client-side from the same `/api/` endpoints that [pyobs-task-editor](https://github.com/pyobs/pyobs-task-editor) uses.
