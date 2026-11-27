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

``RESTRICTIONS_ENABLED`` (default: ``0``)
    Set to ``1`` to restrict users, see `Restricted users`_ below.

``RESTRICTED_CONSTRAINTS`` (default: ``DEFAULT_CONSTRAINTS``)
    JSON array of global constraints, same format as ``DEFAULT_CONSTRAINTS``. Restricted users
    cannot remove or loosen them.

``RESTRICTED_MAX_PRIORITY`` (default: ``1.0``)
    Highest task priority a restricted user may set.

``KEYCLOAK_UNRESTRICTED_GROUP`` (default: empty)
    Full path of a Keycloak group, e.g. ``/pyobs-portal-unrestricted``. Its members are synced
    into the Django group ``unrestricted`` on every login. Empty leaves that group to the Django
    admin.

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


Restricted users
****************

With ``RESTRICTIONS_ENABLED=1``, every user is restricted except superusers (Keycloak client role
``portal-admin``) and members of the Django group ``unrestricted``. When a restricted user saves a
task (create, ``PUT``, ``PATCH``):

- every constraint in ``RESTRICTED_CONSTRAINTS`` must be present with a value at least as strict
  (e.g. ``max_airmass`` lower or equal, ``min_distance`` higher or equal, a ``TimeConstraint``
  window inside the global one). Which direction is stricter is declared per field in pyobs-core.
  Extra constraints of any type are always allowed, since constraints are ANDed;
- every merit must have ``max_value()`` at most 1, since merits are multiplied: ``ConstantMerit.merit``
  at most 1, ``RandomMerit`` only with ``std=0``, the other merits (which only return 0 or 1) are
  free;
- a target is required;
- the priority must be at most ``RESTRICTED_MAX_PRIORITY``.

Violations are rejected with 400. Deactivating a task (``PATCH {"active": false}``) is always
allowed. The task editor shows the limits up front: global constraints are added and locked,
inputs are bounded and the target is required.

Intended behaviour:

- the rules are checked only when a task is saved, not for tasks stored earlier;
- they apply to whoever saves, so an unrestricted user may loosen a restricted user's task;
- restriction is per user, not per project.

Keycloak setup: create a top-level group (e.g. ``/pyobs-portal-unrestricted``), add trusted users
to it (they must also stay in the group of ``KEYCLOAK_REQUIRED_GROUP``) and set
``KEYCLOAK_UNRESTRICTED_GROUP`` to its path. The match is exact, so a subgroup path does not
count. Changes take effect at the user's next login.

A global ``TimeConstraint`` needs explicit ``start`` and ``end``. Once its ``end`` has passed, no
task of a restricted user can be scheduled until the setting is updated (``manage.py check``
warns). Only constraint classes with fields marked as stricter in pyobs-core can be globals
(``manage.py check`` reports others); ``TimeOfDayConstraint`` for example can only be an extra
constraint. Merit classes from extension packages need to implement ``max_value()``, otherwise
they are rejected for restricted users.

Local and PostgreSQL settings
*****************************

With ``SQL_ENGINE=django.db.backends.postgresql``, ``POSTGRES_DB``,
``POSTGRES_USER`` and ``POSTGRES_PASSWORD`` are fallbacks for ``SQL_DATABASE``,
``SQL_USER`` and ``SQL_PASSWORD`` respectively. Explicit SQL variables win, even
when empty. SQLite ignores PostgreSQL aliases. ``SQL_HOST``/``SQL_PORT`` are unchanged.
``DATABASE=postgres`` controls the Docker entrypoint readiness check, not Django's engine.

``CELERY_TASK_ALWAYS_EAGER=1`` executes dispatched tasks inline;
``CELERY_TASK_EAGER_PROPAGATES=1`` surfaces their exceptions. Both default to 0.
A periodic scheduler is still required. See :doc:`development` for a complete recipe.
