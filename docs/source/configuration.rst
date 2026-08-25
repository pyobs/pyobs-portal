Configuration
#############

All settings are controlled by environment variables. Copy ``pyobs_portal/local_settings.example.py``
to ``pyobs_portal/local_settings.py`` for local overrides, or set the following in your environment
/ ``.env``.

``SECRET_KEY`` (default: ``foo``)
    Django secret key — **change in production**.

``DEBUG`` (default: ``1``)
    Set to ``0`` in production.

``DJANGO_ALLOWED_HOSTS`` (default: ``localhost,127.0.0.1``)
    Comma-separated list of allowed hosts.

``CSRF_TRUSTED_ORIGINS`` (default: ``http://localhost``)
    Comma-separated list of trusted origins.

``CORS_ALLOWED_ORIGINS`` (default: empty)
    Comma-separated list of origins allowed to make cross-origin requests to the API.

``SECURE_CROSS_ORIGIN_OPENER_POLICY`` (default: ``same-origin``)
    Set to ``none`` to disable the ``Cross-Origin-Opener-Policy`` header (needed for HTTP-only
    deployments, since browsers warn/ignore it off HTTPS).

``SQL_ENGINE`` (default: ``django.db.backends.sqlite3``)
    Database backend.

``SQL_DATABASE``, ``SQL_USER``, ``SQL_PASSWORD``, ``SQL_HOST``, ``SQL_PORT``
    Database connection (defaults: ``db.sqlite3`` / ``user`` / ``password`` / ``localhost`` /
    ``5432``).

``CELERY_BROKER_URL`` (default: ``amqp://``), ``CELERY_RESULT_BACKEND`` (default: ``rpc://``)
    Celery broker/result-backend URLs.

``STATIC_ROOT`` (default: ``static/``)
    Directory for collected static files.

``ENABLE_FRONTEND`` (default: ``0``)
    Set to ``1`` to enable the web frontend (see :doc:`frontend`); the REST API is always on
    regardless of this setting.

``SITE_LATITUDE``, ``SITE_LONGITUDE``, ``SITE_ELEVATION`` (no default — set these)
    Observatory location in decimal degrees / metres.

``DEFAULT_CONSTRAINTS``, ``DEFAULT_MERITS`` (default: ``[]``)
    JSON array of constraint/merit objects pre-filled on new tasks in the frontend.

``KEYCLOAK_SERVER_URL`` (default: empty)
    Keycloak login — an optional addon on top of local Django username/password and token auth;
    unset disables it.

``KEYCLOAK_REALM`` (default: ``pyobs``)
    Keycloak realm.

``KEYCLOAK_CLIENT_ID`` / ``KEYCLOAK_CLIENT_SECRET`` (default: ``portal`` / empty)
    This service's Keycloak client credentials.

``KEYCLOAK_REDIRECT_URI``, ``KEYCLOAK_POST_LOGOUT_REDIRECT_URI`` (default: empty)
    Must match the redirect/post-logout-redirect URIs registered for this client in Keycloak.

``KEYCLOAK_IDP_HINT`` / ``KEYCLOAK_IDP_LABEL`` (default: empty)
    Optional one-click IdP login: hint passed to Keycloak as ``kc_idp_hint`` (skips its
    login/IdP-selection page) and the label for the login page's IdP button, e.g. ``gwdg`` /
    ``GWDG``.

``ADMIN_USERNAME`` / ``ADMIN_PASSWORD_HASH`` (default: empty)
    Settings-configured superuser, synced after every ``migrate``; leave unset to use
    ``createsuperuser`` instead. Generate the hash with::

        uv run python -c "from django.contrib.auth.hashers import make_password; print(make_password('yourpassword'))"

``ARCHIVE_URL`` (default: empty)
    Base URL of a `pyobs-archive <https://github.com/pyobs/pyobs-archive>`_ instance; unset
    disables ``archive_url`` links entirely. See :doc:`architecture`.

``ARCHIVE_TOKEN`` (default: empty)
    Service token for the archive's ``frames_view`` API; unset makes the on-demand
    frame-count/reduction check always report ``"unavailable"`` (links still work).

``WEBADMIN_URL`` / ``WEBADMIN_TOKEN`` (default: empty)
    Base URL and service token for a `pyobs-web-admin
    <https://github.com/pyobs/pyobs-web-admin>`_ instance, queried at ``{WEBADMIN_URL}/api/modules/classes/``
    to back the script builder's module-name dropdowns (see :doc:`architecture`). Unset leaves
    those fields as plain text input.

