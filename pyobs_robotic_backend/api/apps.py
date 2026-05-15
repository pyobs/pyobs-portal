from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = "pyobs_robotic_backend.api"

    def ready(self):
        from . import signals

        super().ready()
