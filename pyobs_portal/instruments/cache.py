from typing import Any

from django.core.cache import cache

from .serializers import InstrumentSerializer
from .views import INSTRUMENT_QUERYSET

_CACHE_KEY = "pyobs_portal.instruments.capabilities"
_CACHE_TTL = 300  # seconds -- admin-edited reference data, staleness is cheap
_UNCACHED = object()


def get_instrument_capabilities() -> list[dict[str, Any]]:
    """Serialized `GET /api/instruments/` payload, cached briefly.

    Reuses INSTRUMENT_QUERYSET (views.py) rather than re-declaring the same
    select_related/prefetch_related shape -- one query plan for both the API endpoint and this
    in-process accessor. Re-clones it via `.all()` before evaluating: INSTRUMENT_QUERYSET is a
    single module-level QuerySet object, and passing it to the serializer directly evaluates and
    permanently caches its `_result_cache` on that shared object -- every later call (even past
    this function's own cache TTL) would then keep returning that first-ever result forever,
    ignoring every DB change since. DRF's ListAPIView avoids this itself (its default
    get_queryset() re-clones a class-level queryset via `.all()`); this accessor bypasses that
    view machinery, so it has to do the same re-clone by hand.

    No `None` case (unlike webadmin.py's get_module_classes()): there's no external host to be
    unreachable here, just possibly an empty list -- `instruments` lives in this same Django
    process/DB, so a same-process ORM query has no "unreachable" failure mode to degrade from.
    """
    cached = cache.get(_CACHE_KEY, _UNCACHED)
    if cached is not _UNCACHED:
        return cached
    data = InstrumentSerializer(INSTRUMENT_QUERYSET.all(), many=True).data
    cache.set(_CACHE_KEY, data, _CACHE_TTL)
    return data
