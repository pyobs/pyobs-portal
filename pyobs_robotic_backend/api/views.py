from astropy.time import Time
from django.http import Http404
from django.utils import timezone
from rest_framework import generics
from rest_framework.decorators import permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Task, Observation, Project
from .serializers import TaskSerializer, ObservationSerializer, ProjectSerializer


@permission_classes([IsAuthenticated])
class ProjectList(generics.ListCreateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def get_permissions(self):
        self.permission_classes = [IsAdminUser]
        if self.request.method == "GET":
            self.permission_classes = [IsAuthenticated]
        return super().get_permissions()


@permission_classes([IsAdminUser])
class ProjectDetail(generics.RetrieveUpdateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer


@permission_classes([IsAuthenticated])
class TaskList(generics.ListCreateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


@permission_classes([IsAuthenticated])
class TaskDetail(generics.RetrieveUpdateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


@permission_classes([IsAuthenticated])
class ObservationList(generics.ListCreateAPIView):
    queryset = Observation.objects.all()
    serializer_class = ObservationSerializer

    def get_queryset(self):
        tz = timezone.get_current_timezone()
        queryset = Observation.objects.all()
        start = self.request.query_params.get("start")
        if start is not None:
            queryset = queryset.filter(end__gte=Time(start).to_datetime(tz))
        end = self.request.query_params.get("end")
        if end is not None:
            queryset = queryset.filter(start__lte=Time(end).to_datetime(tz))
        state = self.request.query_params.get("state")
        if state is not None:
            queryset = queryset.filter(state=state)

        return queryset


@permission_classes([IsAuthenticated])
class ObservationDetail(generics.RetrieveUpdateAPIView):
    queryset = Observation.objects.all()
    serializer_class = ObservationSerializer


@permission_classes([IsAuthenticated])
class ObservationListForTask(generics.ListAPIView):
    serializer_class = ObservationSerializer

    def get_queryset(self):
        task = Task.objects.get(pk=self.kwargs["pk"])
        if task is None:
            return Http404
        return task.observations.all()


@permission_classes([IsAuthenticated])
class CancelObservations(APIView):
    def get(self, request, format=None):
        after = self.request.query_params.get("after")
        if after is None:
            raise Http404("Please provide a value for after.")
        tz = timezone.get_current_timezone()
        Observation.objects.filter(
            end__gte=Time(after).to_datetime(tz), state="pending"
        ).update(state="canceled")
        return Response({})
