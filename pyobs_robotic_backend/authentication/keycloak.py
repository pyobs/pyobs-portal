"""pyobs-auth USER_RESOLVER for robotic-backend.

Mirrors pyobs-archive's resolver: Keycloak's `sub` claim is the join key (see pyobs-core's
shared-auth design doc), stored on KeycloakIdentity. No pre-existing account-linking case to
handle here (unlike archive/observation-portal) since robotic-backend has never had an external
identity provider - a token seen for the first time with no matching User by email just mints one.
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.models import User

from pyobs_robotic_backend.authentication.models import KeycloakIdentity


def resolve_user(claims: dict[str, Any]) -> User | None:
    sub = claims["sub"]

    try:
        return KeycloakIdentity.objects.get(keycloak_sub=sub).user
    except KeycloakIdentity.DoesNotExist:
        pass

    email = claims.get("email")
    user = User.objects.filter(email=email).first() if email else None

    if user is None:
        username = claims.get("preferred_username") or sub
        user = User.objects.create(username=username, email=email or "", is_active=True)

    KeycloakIdentity.objects.update_or_create(user=user, defaults={"keycloak_sub": sub})
    return user
