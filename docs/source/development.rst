Development
###########

Plain-machine setup
*******************

Python >=3.12 is required. Docker, PostgreSQL and RabbitMQ are optional for local
use. From a source checkout, create and activate a virtual environment::

    git clone https://github.com/pyobs/pyobs-portal.git
    cd pyobs-portal
    python3 -m venv .venv
    . .venv/bin/activate
    python -m pip install -e .

Set the environment in this shell (the secret below is for development only)::

    export SECRET_KEY=local-development-only
    export DEBUG=1 ENABLE_FRONTEND=1
    export DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
    export SQL_ENGINE=django.db.backends.sqlite3
    export SQL_DATABASE="$PWD/db.sqlite3"
    export STATIC_ROOT="$PWD/collected-static"
    export CELERY_TASK_ALWAYS_EAGER=1 CELERY_TASK_EAGER_PROPAGATES=1
    export CELERY_BROKER_URL=memory://
    export CELERY_RESULT_BACKEND=cache+memory://

Django does not automatically load ``.env``. Use these exports, or explicitly use
``uv run --env-file <path> ...``. Do not copy the Docker environment unchanged.
``pyobs_portal/local_settings.py`` overrides environment-derived settings; the
Python frontend setting there is ``FRONTEND_ENABLED`` (environment: ``ENABLE_FRONTEND``).
Optional ``SITE_LATITUDE``, ``SITE_LONGITUDE`` and ``SITE_ELEVATION`` configure the
observatory dashboard. No hardware or optional service integration is required.

Initialize and run::

    python manage.py migrate
    python manage.py createsuperuser
    python manage.py runserver 127.0.0.1:8000

The UI/login is at ``http://127.0.0.1:8000/`` and the API at
``http://127.0.0.1:8000/api/``. Node/npm are needed for frontend tests, not to run
the UI. Some browser assets and optional lookups use internet services.

For the equivalent uv workflow, use ``uv sync --locked`` and prefix the management
commands with ``uv run`` instead of activating a pip environment. Set the same
environment variables first.

In a second shell with the **same environment and absolute SQLite path**, start
one cleanup scheduler::

    python manage.py runscript pyobs_portal.task_scheduler

It dispatches expiration every five minutes and pruning hourly; eager mode runs
them inline without a Celery worker, beat or broker. Eager mode itself supplies no
clock or durable background processing. An immediate expiration check is::

    python manage.py mark_window_expired

Canceled/window-expired rows older than 14 days are pruned (up to 100,000 per run).
Completed history is retained. For installed wheels use
``python -m django --settings=pyobs_portal.settings`` in place of ``python manage.py``.
Run ``collectstatic --noinput`` for installed-package/DEBUG=0 static verification.
SQLite/eager is a local/test recipe; use the existing production deployment guide
for broker-based service operation.

Priority upgrade audit
**********************

Project and task priorities must be finite values in [0, 9999]. Observation ranking
values have a separate contract. Migration 0011 refuses invalid legacy priorities
without rewriting them. Back up the database and stop writers before upgrading.
Audit before migration in ``python manage.py shell``::

    import math
    from pyobs_portal.api.models import Project, Task
    for model in (Project, Task):
        for row in model.objects.all().iterator():
            if not math.isfinite(row.priority) or not 0 <= row.priority <= 9999:
                print(model.__name__, row.pk, row.priority)

Choose replacement values deliberately. For each repaired row, set ``row.priority``
and call ``row.save(update_fields=["priority", "updated_at"])`` so the scheduler's
change marker advances. Repeat the audit, then retry ``migrate``. Do not clamp or
delete historical data as an automatic migration step.

Deactivation already cancels pending observations. To reconcile old inactive tasks
with stale pending rows, optionally review them and explicitly call
``api.signals.cancel_pending_observations(task)`` from the Django shell (import
from ``pyobs_portal.api.signals``). Task deletion cascades to observation history.

Setting ``ADMIN_USERNAME``/``ADMIN_PASSWORD_HASH`` (see :doc:`configuration`) syncs a matching
superuser automatically after every ``migrate``, skipping the interactive ``createsuperuser``
step.

Backend tests::

    uv run python manage.py test

Frontend
********

The web frontend's own test suite (`Vitest <https://vitest.dev/>`_, in ``frontend-tests/``)::

    npm install
    npm test
