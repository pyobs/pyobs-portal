from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from pyobs_portal.authentication.admin_sync import sync_admin_user
from pyobs_portal.authentication.keycloak import resolve_user
from pyobs_portal.authentication.models import KeycloakIdentity

# A distinct, unlikely-to-collide username -- not "admin", since a real local_settings.py
# (e.g. a developer's own ADMIN_USERNAME="admin") would already have synced an "admin" User via
# admin_sync's post_migrate hook by the time the test database exists, before any of this
# module's own override_settings is active.
_TEST_ADMIN_USERNAME = "test-sync-admin"


class ResolveUserTests(TestCase):
    def test_creates_a_new_user_on_first_login(self):
        user = resolve_user(
            {
                "sub": "sub-1",
                "email": "new@example.org",
                "preferred_username": "newperson",
            }
        )

        self.assertEqual(user.username, "newperson")
        self.assertEqual(user.email, "new@example.org")
        self.assertEqual(KeycloakIdentity.objects.get(user=user).keycloak_sub, "sub-1")

    def test_new_user_is_created_inactive(self):
        user = resolve_user({"sub": "sub-2", "email": "pending@example.org"})
        self.assertFalse(user.is_active)

    def test_same_sub_resolves_to_the_same_user_on_a_later_login(self):
        first = resolve_user({"sub": "sub-3", "email": "person@example.org"})
        second = resolve_user({"sub": "sub-3", "email": "person@example.org"})

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(User.objects.filter(email="person@example.org").count(), 1)

    def test_links_an_existing_user_by_email_on_first_keycloak_login(self):
        existing = User.objects.create(username="oldstyle", email="legacy@example.org")

        user = resolve_user({"sub": "sub-4", "email": "legacy@example.org"})

        self.assertEqual(user.pk, existing.pk)
        self.assertEqual(
            KeycloakIdentity.objects.get(user=existing).keycloak_sub, "sub-4"
        )

    def test_links_an_existing_user_by_username_when_email_does_not_match(self):
        # e.g. an admin-created local User with no email address set
        existing = User.objects.create(username="noemail")

        user = resolve_user(
            {
                "sub": "sub-5",
                "email": "noemail@example.org",
                "preferred_username": "noemail",
            }
        )

        self.assertEqual(user.pk, existing.pk)
        self.assertEqual(
            KeycloakIdentity.objects.get(user=existing).keycloak_sub, "sub-5"
        )

    def test_falls_back_to_sub_as_username_without_preferred_username(self):
        user = resolve_user({"sub": "sub-6", "email": "no-username@example.org"})
        self.assertEqual(user.username, "sub-6")


@override_settings(ADMIN_USERNAME=_TEST_ADMIN_USERNAME, ADMIN_PASSWORD_HASH="pbkdf2_sha256$dummy")
class AdminSyncTests(TestCase):
    """admin_sync.sync_admin_user is how the settings-configured admin account (ADMIN_USERNAME/
    ADMIN_PASSWORD_HASH) gets created/kept in sync - wired to run after every
    `manage.py migrate` via the post_migrate signal (AuthenticationConfig.ready()), so a fresh
    deployment doesn't need an interactive `createsuperuser` step."""

    def test_sync_creates_a_staff_superuser_with_the_configured_password_hash(self):
        sync_admin_user(sender=None)

        user = User.objects.get(username=_TEST_ADMIN_USERNAME)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_active)
        self.assertEqual(user.password, "pbkdf2_sha256$dummy")

    def test_sync_updates_an_existing_user_that_drifted(self):
        User.objects.create(username=_TEST_ADMIN_USERNAME, is_staff=False, is_superuser=False)

        sync_admin_user(sender=None)

        user = User.objects.get(username=_TEST_ADMIN_USERNAME)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

    @override_settings(ADMIN_USERNAME="", ADMIN_PASSWORD_HASH="")
    def test_sync_does_nothing_when_unconfigured(self):
        sync_admin_user(sender=None)
        self.assertFalse(User.objects.filter(username=_TEST_ADMIN_USERNAME).exists())
