"""Look up modules configured on the paired pyobs-web-admin host (issue #98).

get_module_classes() feeds schema.module_ref_options(), which filters the result by interface
to back the script builder's module-name dropdowns. Mirrors api/archive.py's shape: a small,
settings-driven, on-demand external call that degrades to `None` rather than raising, so a
missing/unreachable web-admin never breaks anything here -- module-name fields just fall back to
today's free-text input.
"""

import logging

import requests
from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

# A script-builder page load hits this indirectly via /api/schema/modules/ on every visit --
# without caching, a *reachable* web-admin gets re-queried every time (cheap but pointless), and
# an *unreachable* one costs the full request timeout on every single page load. Short enough
# that a newly-configured/recovered web-admin shows up quickly; long enough to absorb repeated
# page loads within the same browsing session.
_CACHE_KEY = "pyobs_portal.api.webadmin.module_classes"
_CACHE_TTL = 30  # seconds
_UNCACHED = object()


def get_module_classes() -> dict[str, str] | None:
    """{module_name: class_fqcn} for every module configured on WEBADMIN_URL, or None.

    None whenever the result can't be trusted: WEBADMIN_URL/WEBADMIN_TOKEN unset (no request
    made), the request fails, a non-2xx response, or a body that isn't a dict of strings. Never
    raises. Both outcomes -- success and None -- are cached briefly (see _CACHE_TTL above), so a
    down web-admin doesn't cost a fresh timeout on every request.
    """
    if not settings.WEBADMIN_URL or not settings.WEBADMIN_TOKEN:
        return None

    cached = cache.get(_CACHE_KEY, _UNCACHED)
    if cached is not _UNCACHED:
        return cached

    url = f"{settings.WEBADMIN_URL.rstrip('/')}/api/modules/classes/"
    headers = {"X-Hub-Token": settings.WEBADMIN_TOKEN}

    try:
        response = requests.get(url, headers=headers, timeout=5)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in data.items()
        ):
            raise ValueError(f"unexpected module-classes response shape: {data!r}")
    except (requests.RequestException, ValueError) as exc:
        log.warning("Module-classes lookup at %s failed: %s", url, exc)
        data = None

    cache.set(_CACHE_KEY, data, _CACHE_TTL)
    return data
