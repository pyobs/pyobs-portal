# pyobs-portal

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

## Documentation

Full installation (Docker Compose, including site-specific hardware-driver images), configuration
(every environment variable), architecture (how this fits into the rest of the pyobs fleet, and
how the script-builder extension mechanism works), REST API reference, and web frontend guide: see
[`docs/source/`](docs/source/) (built with Sphinx — `cd docs && uv run --group dev make html`).

## Development

```bash
git clone https://github.com/pyobs/pyobs-portal.git
cd pyobs-portal
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver
```

See [`docs/source/development.rst`](docs/source/development.rst) for the full local-dev flow
(including the frontend's Vitest suite), and
[`docs/source/installation.rst`](docs/source/installation.rst) for the Docker Compose production
setup.
