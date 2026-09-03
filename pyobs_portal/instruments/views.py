from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from pyobs_portal.api.views import _last_update

from .models import (
    BinningOption,
    CameraCapability,
    DomeCapability,
    Filter,
    FilterWheelCapability,
    Instrument,
    TelescopeCapability,
)
from .serializers import CameraCapabilitySerializer, InstrumentSerializer

# Matches the nested shape InstrumentSerializer walks (cameras -> binnings/filter_wheels ->
# filters, plus telescope/dome) - without this, list/detail responses issue a query per row
# per relation instead of a handful up front.
INSTRUMENT_QUERYSET = Instrument.objects.select_related(
    "telescope", "dome"
).prefetch_related("cameras__binnings", "cameras__filter_wheels__filters")


@permission_classes([IsAuthenticated])
class InstrumentList(generics.ListAPIView):
    queryset = INSTRUMENT_QUERYSET
    serializer_class = InstrumentSerializer


@permission_classes([IsAuthenticated])
class CameraCapabilityDetail(generics.RetrieveAPIView):
    queryset = CameraCapability.objects.all()
    serializer_class = CameraCapabilitySerializer
    lookup_field = "code"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def last_instrument_update(request):
    """Latest `updated_at` across every capability row, for pyobs-core's PortalTaskArchive to
    poll -- mirrors last_task_update/last_observation_update (pyobs_portal/api/views.py).

    Every capability model below has its own auto_now=True updated_at (see the Instrument
    docstring's caveat) because nested-inline admin edits don't bubble up to the parent
    Instrument.updated_at -- this has to Max() over all seven models, not just Instrument, or a
    deep edit (e.g. a Filter three levels down) would never move the marker.

    Not project-scoped (unlike last_task_update's _accessible_projects filtering): instruments
    data isn't per-project, every authenticated user sees the same set, matching the read API's
    own IsAuthenticated-only permission.

    Uses _last_update's epoch fallback (not None) when there are no rows at all, so the response
    is always Time-parseable -- matching last_task_update/last_observation_update exactly, since
    PortalTaskArchive.last_update_time() unconditionally does Time(res[...]) with no None-check.
    """
    marker = max(
        _last_update(Instrument.objects.all()),
        _last_update(CameraCapability.objects.all()),
        _last_update(BinningOption.objects.all()),
        _last_update(FilterWheelCapability.objects.all()),
        _last_update(Filter.objects.all()),
        _last_update(TelescopeCapability.objects.all()),
        _last_update(DomeCapability.objects.all()),
    )
    return Response({"last_instrument_update": marker.isot})
