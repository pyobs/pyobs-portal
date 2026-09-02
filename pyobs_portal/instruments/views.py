from rest_framework import generics
from rest_framework.decorators import permission_classes
from rest_framework.permissions import IsAuthenticated

from .models import Instrument, CameraCapability
from .serializers import InstrumentSerializer, CameraCapabilitySerializer

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
