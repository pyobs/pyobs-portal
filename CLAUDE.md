# CLAUDE.md

Entry points for working in this repo.

## What this is

`pyobs-portal` is the backend service for the `pyobs` robotic telescope system: stores and serves
the task queue (observations to be scheduled), projects, and observation history consumed by the
`pyobs` scheduler and related tools. REST API (DRF) + a Bootstrap 5 web frontend with schema-driven
forms fed by `pyobs-core`'s `model_json_schema()` introspection, plus Celery for async processing.

## Design history and planning

This repo keeps its own implementation plans under `specs/plans/`; see `specs/index.md` for the
current list — most non-trivial work here is cross-repo (with `pyobs-core` and/or
`pyobs-archive`), so many entries point into `pyobs-core`'s `specs/` tree instead, tagged with a
`Repos:` line. See `pyobs-core/CLAUDE.md`'s "Cross-repo docs" section for the convention.

## Tooling

- Backend: Django/DRF, managed via `uv`
- Backend tests: `uv run python manage.py test`
- Frontend: Vitest, in `frontend-tests/` (`npm install && npm test`)
- No ruff/pyrefly config in this repo yet; `black` is a dev dependency but not configured
