from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = "pyobs_portal.api"

    def ready(self):
        from . import signals  # noqa: F401
