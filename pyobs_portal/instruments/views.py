from rest_framework import generics
from rest_framework.decorators import permission_classes
from rest_framework.permissions import IsAuthenticated

from .models import Instrument, CameraCapability
from .serializers import InstrumentSerializer, CameraCapabilityWithInstrumentSerializer


@permission_classes([IsAuthenticated])
class InstrumentList(generics.ListAPIView):
    queryset = Instrument.objects.all()
    serializer_class = InstrumentSerializer


@permission_classes([IsAuthenticated])
class InstrumentDetail(generics.RetrieveAPIView):
    queryset = Instrument.objects.all()
    serializer_class = InstrumentSerializer
    lookup_field = "module_name"


@permission_classes([IsAuthenticated])
class CameraCapabilityDetail(generics.RetrieveAPIView):
    queryset = CameraCapability.objects.all()
    serializer_class = CameraCapabilityWithInstrumentSerializer
    lookup_field = "code"
