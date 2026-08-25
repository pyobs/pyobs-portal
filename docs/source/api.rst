REST API Reference
###################

Mounted under ``/api/``. Authentication is via token (``Authorization: Token <token>``), Django
session cookie, or a Keycloak Bearer token (if configured, see :doc:`configuration`). Obtain a
static token at ``/api-token-auth/``.

Core resources
**************

``GET``/``POST`` ``/api/users/``, ``GET``/``PATCH`` ``/api/users/<id>/``
    List/create/retrieve/update users. Admin only.

``GET``/``POST`` ``/api/projects/``, ``GET``/``PATCH`` ``/api/projects/<code>/``
    List projects (resolved per user: public + memberships) / create (admin only); projects carry
    a ``public`` flag.

``GET``/``POST`` ``/api/projects/<code>/tasks/``
    List/create tasks for an accessible project.

``GET`` ``/api/tasks/``, ``GET``/``PUT``/``PATCH`` ``/api/tasks/<code>/``
    List tasks (filtered to accessible projects: public + memberships) / retrieve / update
    (``PATCH`` for partial updates).

``GET``/``POST`` ``/api/observations/``, ``GET``/``PATCH`` ``/api/observations/<id>/``
    List (filtered to accessible projects; includes ``archive_url`` when ``ARCHIVE_URL`` is set) /
    create / retrieve / update observations.

``GET`` ``/api/observations/<id>/frames/``
    On-demand frame count / reduction status from pyobs-archive: ``{"archive_url", "count",
    "reduced"}``, or ``{"archive_url", "status": "unavailable"}`` if ``ARCHIVE_TOKEN`` isn't set.
    See :doc:`architecture`.

``GET`` ``/api/tasks/<code>/observations/``
    Observations for a single task.

``POST`` ``/api/cancel_observations/``
    Cancel one or more pending/in-progress observations.

Introspection and helpers
****************************

``GET`` ``/api/me/``
    Current user info.

``GET`` ``/api/last_task_update/``, ``GET`` ``/api/last_observation_update/``
    Timestamp of the last change, for the frontend's polling.

``GET`` ``/api/schema/constraints/``, ``/api/schema/merits/``, ``/api/schema/targets/``, ``/api/schema/pickers/``
    JSON Schema (``model_json_schema()``) for all pyobs-core (+ extension package, see
    :doc:`architecture`) Constraint/Merit/Target/picker subclasses, so the frontend can render
    typed editors without hard-coding fields.

``GET`` ``/api/schema/scripts/``
    Script class tree with schemas (the script builder's type picker).

``GET`` ``/api/schema/modules/``
    Module-interface metadata backing the script builder's module-name dropdowns (see
    :doc:`architecture`).

``POST`` ``/api/validate_script/``
    Validate a script dict against pyobs-core.

``POST`` ``/api/estimate_duration/``
    Estimate a script's duration in seconds.

``GET`` ``/api/site/``
    Observatory location (``SITE_LATITUDE``/``SITE_LONGITUDE``/``SITE_ELEVATION``).

``GET`` ``/api/observability/``
    Target-observability check against site/constraints.

``GET`` ``/api/merit_plot/``
    Merit-function plot data for the task editor's duration/merit visualization.
