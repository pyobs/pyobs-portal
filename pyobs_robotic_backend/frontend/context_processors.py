from django.conf import settings
from django.templatetags.static import static


def pyobs_logo(request):
    # Deployments can point these at their own logo via settings/env; default to
    # the bundled pyobs logo. Two variants because the wordmark's "py" is black -
    # invisible on a dark sidebar without a light-on-dark version to swap in.
    return {
        "pyobs_logo_light_url": getattr(settings, "PYOBS_LOGO_LIGHT_URL", None) or static("img/pyobs-logo-light.gif"),
        "pyobs_logo_dark_url": getattr(settings, "PYOBS_LOGO_DARK_URL", None) or static("img/pyobs-logo-dark.gif"),
    }
