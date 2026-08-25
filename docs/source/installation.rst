Installation
############

Docker Compose is the supported way to run *pyobs-portal* in production. The repository's
`docker-compose.yml
<https://github.com/pyobs/pyobs-portal/blob/develop/docker-compose.yml>`_ sets up six services:

- **web** — the app itself (``ghcr.io/pyobs/pyobs-portal:latest``), migrating, collecting static
  files, and serving via gunicorn.
- **celery** — same image, background task processing.
- **task_scheduler** — same image again, running ``manage.py runscript
  pyobs_portal.task_scheduler`` continuously.
- **rabbitmq** — Celery's message broker.
- **db** — PostgreSQL.
- **nginx** — serves static files and proxies to **web**. Served on port **8097**.

Setup::

    git clone https://github.com/pyobs/pyobs-portal.git
    cd pyobs-portal
    cp .env.example .env
    cp nginx.conf.example nginx.conf
    # edit both: at minimum SECRET_KEY, DJANGO_ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS, the
    # database credentials, and (if you want the frontend) ENABLE_FRONTEND=1
    docker compose up -d

Migrations and static file collection run automatically on startup. Create a superuser::

    docker compose run --rm web uv run python manage.py createsuperuser

or set ``ADMIN_USERNAME``/``ADMIN_PASSWORD_HASH`` in ``.env`` to skip this — see
:doc:`configuration`.

Site-specific hardware drivers
*******************************

The published image only ships ``pyobs-core``. The script builder's module-name dropdowns resolve
real module classes with ``issubclass()`` against ``pyobs.interfaces`` (see :doc:`architecture`),
which means each configured module's class actually has to *import* in this process — so a
site using hardware-specific driver packages (``pyobs-iagvt``, ``pyobs-fli``, ``pyobs-brot``, ...)
needs those installed on top of the base image. Since that's site-specific (and often private), it
doesn't belong in this repo or its published image — build a thin derived image instead, in your
own deployment config repo::

    # deploy/Dockerfile
    FROM ghcr.io/pyobs/pyobs-portal:latest

    # Only needed for a private git dependency, forwarding your SSH agent instead of baking in a key:
    RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
        && rm -rf /var/lib/apt/lists/*

    RUN --mount=type=ssh \
        mkdir -p -m 0700 ~/.ssh && ssh-keyscan gitlab.example.org >> ~/.ssh/known_hosts && \
        uv pip install git+ssh://git@gitlab.example.org/your-org/pyobs-yoursite.git

Point every service that runs this image (``web``, ``celery``, ``task_scheduler``) at that
Dockerfile instead, replacing each ``image: ghcr.io/...`` line with::

    build:
      context: ./deploy
      ssh:
        - default

Build and run with your SSH agent forwarded (make sure the key that can clone your private repo
is loaded first, e.g. ``ssh-add ~/.ssh/id_ed25519``)::

    DOCKER_BUILDKIT=1 docker compose build --ssh default
    docker compose up -d

No SSH agent forwarding is needed if your extra package is public — drop the ``RUN`` block's SSH
setup and just ``uv pip install`` the package directly. See :doc:`architecture` for how such an
extension package's scripts/providers get picked up automatically once installed.

See :doc:`configuration` for every setting ``.env`` can carry, and :doc:`development` for running
it locally without Docker.
