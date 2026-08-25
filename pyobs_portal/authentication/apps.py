from django.apps import AppConfig
from django.db.models.signals import post_migrate


class AuthenticationConfig(AppConfig):
    name = "pyobs_portal.authentication"

    def ready(self):
        from pyobs_portal.authentication.admin_sync import sync_admin_user

        post_migrate.connect(sync_admin_user, sender=self)
