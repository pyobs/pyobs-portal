"""pyobs-auth USER_RESOLVER for pyobs-portal.

Mirrors pyobs-archive's resolver: Keycloak's `sub` claim is the join key (see pyobs-core's
shared-auth design doc), stored on KeycloakIdentity. First Keycloak login for an existing local
User (matched by email, falling back to username) links the two rather than minting a second,
disconnected User. Newly-minted accounts are active by default: authorization is now the
PYOBS_AUTH['REQUIRED_GROUPS'] claims gate (Keycloak group membership), not local activation - see
pyobs-core's specs/design/shared-authz-keycloak.md.

`is_superuser` is synced from the `portal-admin` Keycloak client role on every resolve (login and
- once pyobs-auth's session-refresh middleware is wired in - token refresh), so portal's existing
`is_superuser`-gated endpoints (pyobs_portal/api/views.py, pyobs_portal/frontend/views.py) keep
working without rewriting them, and a role revoked in Keycloak is picked up here too. Deliberately
NOT synced: `is_staff` - that's the separate flag that unlocks the raw Django admin backend
(`/admin/`, every registered model, no scoping), a bigger grant than portal's own business-logic
superuser checks. The settings-configured ADMIN_USERNAME account (admin_sync.py) sets both
together on purpose (it's a local password account meant to be a full admin, not a Keycloak
user) - this resolver must not copy that pattern for Keycloak-derived users.
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.models import User

from pyobs_portal.authentication.models import KeycloakIdentity

PORTAL_ADMIN_CLIENT_ROLE = "portal-admin"


def _has_portal_admin_role(claims: dict[str, Any]) -> bool:
    resource_access = claims.get("resource_access") or {}
    roles = (resource_access.get("portal") or {}).get("roles") or []
    return PORTAL_ADMIN_CLIENT_ROLE in roles


def resolve_user(claims: dict[str, Any]) -> User | None:
    sub = claims["sub"]

    try:
        user = KeycloakIdentity.objects.get(keycloak_sub=sub).user
    except KeycloakIdentity.DoesNotExist:
        user = None

    if user is None:
        email = claims.get("email")
        username = claims.get("preferred_username") or sub

        user = User.objects.filter(email=email).first() if email else None
        if user is None:
            # Falls back to username since email matching alone misses accounts that predate
            # having an email address set (e.g. an admin-created local User) - without this,
            # User.objects.create() below hits a UNIQUE constraint on username instead of linking
            # the existing account.
            user = User.objects.filter(username=username).first()
        if user is None:
            user = User.objects.create(
                username=username, email=email or "", is_active=True
            )

        KeycloakIdentity.objects.update_or_create(
            user=user, defaults={"keycloak_sub": sub}
        )

    is_superuser = _has_portal_admin_role(claims)
    if user.is_superuser != is_superuser:
        user.is_superuser = is_superuser
        user.save(update_fields=["is_superuser"])

    return user
