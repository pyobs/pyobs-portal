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

### Docker

```bash
docker build -t pyobs-robotic-backend .
docker run -p 8000:8000 \
  -e SECRET_KEY=changeme \
  -e DEBUG=0 \
  -e DATABASE=postgres \
  -e SQL_HOST=db \
  -e SQL_DATABASE=pyobs \
  -e SQL_USER=pyobs \
  -e SQL_PASSWORD=secret \
  pyobs-robotic-backend \
  uv run gunicorn pyobs_robotic_backend.wsgi:application --bind 0.0.0.0:8000
```

### Docker Compose

A minimal production-like setup with PostgreSQL, RabbitMQ, a Celery worker, and nginx:

```yaml
services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: pyobs
      POSTGRES_USER: pyobs
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data

  rabbitmq:
    image: rabbitmq:4-alpine
    restart: unless-stopped

  web:
    build: .
    restart: unless-stopped
    command: uv run gunicorn pyobs_robotic_backend.wsgi:application --bind 0.0.0.0:8000
    expose:
      - 8000
    volumes:
      - static_files:/src/static
    environment:
      DATABASE: postgres
      SECRET_KEY: changeme
      DEBUG: 0
      DJANGO_ALLOWED_HOSTS: your.domain.com
      CSRF_TRUSTED_ORIGINS: https://your.domain.com
      SQL_ENGINE: django.db.backends.postgresql
      SQL_DATABASE: pyobs
      SQL_USER: pyobs
      SQL_PASSWORD: secret
      SQL_HOST: db
      SQL_PORT: 5432
      CELERY_BROKER_URL: amqp://rabbitmq//
      CELERY_RESULT_BACKEND: rpc://
      STATIC_ROOT: /src/static
    depends_on:
      - db
      - rabbitmq

  worker:
    build: .
    restart: unless-stopped
    command: uv run celery -A pyobs_robotic_backend worker --loglevel=info
    environment:
      DATABASE: postgres
      SECRET_KEY: changeme
      SQL_ENGINE: django.db.backends.postgresql
      SQL_DATABASE: pyobs
      SQL_USER: pyobs
      SQL_PASSWORD: secret
      SQL_HOST: db
      SQL_PORT: 5432
      CELERY_BROKER_URL: amqp://rabbitmq//
      CELERY_RESULT_BACKEND: rpc://
    depends_on:
      - db
      - rabbitmq

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - static_files:/srv/static:ro
    depends_on:
      - web

volumes:
  postgres_data:
  static_files:
```

Minimal `nginx.conf`:

```nginx
server {
    listen 80;

    location /static/ {
        alias /srv/static/;
    }

    location / {
        proxy_pass http://web:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Before starting for the first time, run migrations and collect static files:

```bash
docker compose run --rm web uv run python manage.py migrate
docker compose run --rm web uv run python manage.py createsuperuser
docker compose run --rm web uv run python manage.py collectstatic --no-input
docker compose up -d
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
