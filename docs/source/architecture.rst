Architecture
############

*pyobs-portal* is a stand-alone Django + Celery service (no ``pyobs-core`` runtime dependency in
the sense of running as a fleet module — it imports ``pyobs-core`` as a library, for its
constraint/merit/target/script class definitions and schemas). It's the system of record for
tasks, projects, and observation history that the pyobs scheduler consumes, plus a REST API and
optional web frontend for humans to author and monitor them.

- **Celery + RabbitMQ** — background task processing (``celery`` service).
- **task_scheduler** — a separate long-running process (``manage.py runscript
  pyobs_portal.task_scheduler``) that the pyobs robotic scheduler talks to for picking the next
  task to run.
- **PostgreSQL** — tasks, projects, observations, users.

Cross-service connections (all via REST, all optional — configured in :doc:`configuration`):

- **pyobs-archive** (``ARCHIVE_URL``/``ARCHIVE_TOKEN``) — completed/aborted/failed observations
  link to their archived data; an on-demand call to the archive's ``frames_view`` API reports
  frame count and reduction status.
- **pyobs-web-admin** (``WEBADMIN_URL``/``WEBADMIN_TOKEN``) — the script builder's module-name
  fields (e.g. ``ImagingScript.camera``/``.telescope``) resolve to dropdowns fed by
  ``GET {WEBADMIN_URL}/api/modules/classes/``, filtered per-field by the ``pyobs.interfaces`` each
  field requires (tagged in pyobs-core via ``Annotated[str, ICamera]``-style metadata).
- **Keycloak** (``KEYCLOAK_SERVER_URL``) — optional SSO alongside local Django username/password
  and DRF token auth.
- **pyobs-task-editor** — a separate client that talks to the same ``/api/`` endpoints as this
  repo's own built-in frontend (see :doc:`frontend`).

Script builder extension packages
************************************

The script builder's class lists (``/api/schema/scripts/``) aren't limited to what pyobs-core
ships. Any **installed** top-level package named ``pyobs_<something>`` is scanned automatically
for the same ``pyobs.robotic.*`` submodules pyobs-core itself uses:

- ``<package>.scripts`` — scanned like ``pyobs.robotic.scripts``, for ``Script`` subclasses.
- ``<package>.utils.exptime`` — for ``ExposureTimeProvider`` subclasses.
- ``<package>.utils.skyflats.pointing`` — for ``SkyFlatsBasePointing`` subclasses.
- ``<package>.utils.skyflats.priorities`` — for ``SkyflatPriorities`` subclasses.

A package missing one of these submodules is skipped for that one, not an error. There is no
setting to enable this — it's purely by installed-package naming convention (see
:doc:`installation` for how to get a site-specific package into the deployed image). A package's
``__init__.py`` commonly re-exports its classes for a shorter public import path; ``script_tree()``
also returns a ``$aliases`` map (short path → canonical path) so a task written against the
shorter form still resolves. See ``pyobs_portal/api/schema.py``
(``_installed_extension_packages``, ``_relative_to_robotic``) for the scan implementation.

In the script builder's type picker, each extension package's scripts appear under their own
top-level branch labeled with the package's distribution name (e.g. ``pyobs-iagvt``), rather than
merged into pyobs-core's own folders. Provider dropdowns (``ExposureTimeProvider`` etc.) list core
and extension candidates together, unlabeled.
