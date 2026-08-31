from django.conf import settings as django_settings
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

    def test_new_user_is_created_active(self):
        # Authorization is now the PYOBS_AUTH['REQUIRED_GROUPS'] claims gate, not local
        # activation - see pyobs-core's specs/design/shared-authz-keycloak.md.
        user = resolve_user({"sub": "sub-2", "email": "pending@example.org"})
        self.assertTrue(user.is_active)

    def test_new_user_without_portal_admin_role_is_not_superuser(self):
        user = resolve_user({"sub": "sub-2b", "email": "plain@example.org"})
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)

    def test_user_with_portal_admin_role_is_synced_to_superuser(self):
        user = resolve_user(
            {
                "sub": "sub-2c",
                "email": "admin-person@example.org",
                "resource_access": {"portal": {"roles": ["portal-admin"]}},
            }
        )
        self.assertTrue(user.is_superuser)
        # is_staff must NOT follow is_superuser here - that would additionally unlock the raw
        # Django admin backend, a bigger grant than portal's own is_superuser checks.
        self.assertFalse(user.is_staff)

    def test_portal_admin_role_revoked_between_logins_removes_superuser(self):
        first = resolve_user(
            {
                "sub": "sub-2d",
                "email": "was-admin@example.org",
                "resource_access": {"portal": {"roles": ["portal-admin"]}},
            }
        )
        self.assertTrue(first.is_superuser)

        second = resolve_user({"sub": "sub-2d", "email": "was-admin@example.org"})

        self.assertEqual(first.pk, second.pk)
        self.assertFalse(User.objects.get(pk=first.pk).is_superuser)

    def test_locally_promoted_superuser_is_demoted_without_the_keycloak_role(self):
        """By design: Keycloak is the source of truth for is_superuser once a user has a linked
        Keycloak identity, even if they were promoted locally (createsuperuser, Django admin)."""
        local_admin = User.objects.create(username="local-admin", is_superuser=True)
        KeycloakIdentity.objects.create(user=local_admin, keycloak_sub="sub-2g")

        resolved = resolve_user({"sub": "sub-2g", "email": "local-admin@example.org"})

        self.assertEqual(resolved.pk, local_admin.pk)
        self.assertFalse(User.objects.get(pk=local_admin.pk).is_superuser)

    def test_portal_admin_role_is_scoped_to_the_portal_client(self):
        # a client role on some other client's resource_access entry must not count
        user = resolve_user(
            {
                "sub": "sub-2e",
                "email": "other-client-admin@example.org",
                "resource_access": {"archive": {"roles": ["portal-admin"]}},
            }
        )
        self.assertFalse(user.is_superuser)

    def test_portal_admin_role_lookup_uses_the_configured_client_id_not_a_hardcoded_one(self):
        # resource_access is keyed by whatever Keycloak client id this deployment actually uses
        # (PYOBS_AUTH['CLIENT_ID']/KEYCLOAK_CLIENT_ID) - e.g. monet's real deployment uses
        # "monets-observe", not the settings.py default of "portal". A hardcoded "portal" lookup
        # key would silently never match here.
        with override_settings(
            PYOBS_AUTH={**django_settings.PYOBS_AUTH, "CLIENT_ID": "monets-observe"}
        ):
            user = resolve_user(
                {
                    "sub": "sub-2f",
                    "email": "monet-admin@example.org",
                    "resource_access": {"monets-observe": {"roles": ["portal-admin"]}},
                }
            )
        self.assertTrue(user.is_superuser)

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


@override_settings(
    ADMIN_USERNAME=_TEST_ADMIN_USERNAME, ADMIN_PASSWORD_HASH="pbkdf2_sha256$dummy"
)
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
        User.objects.create(
            username=_TEST_ADMIN_USERNAME, is_staff=False, is_superuser=False
        )

        sync_admin_user(sender=None)

        user = User.objects.get(username=_TEST_ADMIN_USERNAME)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

    @override_settings(ADMIN_USERNAME="", ADMIN_PASSWORD_HASH="")
    def test_sync_does_nothing_when_unconfigured(self):
        sync_admin_user(sender=None)
        self.assertFalse(User.objects.filter(username=_TEST_ADMIN_USERNAME).exists())
