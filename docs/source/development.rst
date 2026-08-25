Development
###########

Running locally, without Docker::

    git clone https://github.com/pyobs/pyobs-portal.git
    cd pyobs-portal
    uv sync
    uv run python manage.py migrate
    uv run python manage.py createsuperuser
    uv run python manage.py runserver

The API is served at ``http://localhost:8000/api/``. If the frontend is enabled (see
:doc:`configuration`), the UI is at ``http://localhost:8000/``.

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
