from django.conf import settings
from django.templatetags.static import static


def keycloak(request):
    """Whether Keycloak login is configured - see PYOBS_AUTH in settings.py.

    Keycloak is an optional addon on top of local Django username/password login, not a
    replacement, so templates shouldn't show a login button for it unless it's actually set up.
    """
    pyobs_auth = getattr(settings, "PYOBS_AUTH", {})
    return {
        "keycloak_login_enabled": bool(pyobs_auth.get("SERVER_URL")),
        # IdP hint/label for the one-click IdP login button - see PYOBS_AUTH in settings.py.
        # The template additionally gates on keycloak_login_enabled, so IDP_HINT without
        # SERVER_URL (Keycloak disabled) degrades to no buttons rather than dead links.
        "keycloak_idp_hint": pyobs_auth.get("IDP_HINT", ""),
        "keycloak_idp_label": pyobs_auth.get("IDP_LABEL", ""),
    }


def pyobs_logo(request):
    # Deployments can point these at their own logo via settings/env; default to
    # the bundled pyobs logo. Two variants because the wordmark's "py" is black -
    # invisible on a dark sidebar without a light-on-dark version to swap in.
    return {
        "pyobs_logo_light_url": getattr(settings, "PYOBS_LOGO_LIGHT_URL", None) or static("img/pyobs-logo-light.gif"),
        "pyobs_logo_dark_url": getattr(settings, "PYOBS_LOGO_DARK_URL", None) or static("img/pyobs-logo-dark.gif"),
    }
