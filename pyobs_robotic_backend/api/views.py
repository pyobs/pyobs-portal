from rest_framework.request import Request
from typing import Any
from rest_framework.pagination import PageNumberPagination
from astropy.time import Time
from django.contrib.auth.models import User
from django.http import Http404
from django.utils import timezone
from rest_framework import generics
from rest_framework.decorators import permission_classes, api_view
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.core.cache import cache
from django_filters.rest_framework import DjangoFilterBackend

from . import schema
from .filters import ObservationFilter
from .models import Task, Observation, Project
from .serializers import (
    TaskSerializer,
    ObservationSerializer,
    ProjectSerializer,
    UserSerializer,
)


@permission_classes([IsAdminUser])
class UserList(generics.ListCreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer


@permission_classes([IsAdminUser])
class UserDetail(generics.RetrieveUpdateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer


@permission_classes([IsAuthenticated])
class ProjectList(generics.ListCreateAPIView):
    serializer_class = ProjectSerializer

    def get_permissions(self):
        self.permission_classes = [IsAdminUser]
        if self.request.method == "GET":
            self.permission_classes = [IsAuthenticated]
        return super().get_permissions()

    def get_queryset(self):
        queryset = Project.objects.all()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(users__in=[self.request.user])
        return queryset


@permission_classes([IsAdminUser])
class ProjectDetail(generics.RetrieveUpdateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer


@permission_classes([IsAuthenticated])
class TaskListForProject(generics.ListCreateAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        project = Project.objects.get(pk=self.kwargs["pk"])
        if project is None or (
            self.request.user not in project.users.all()
            and not self.request.user.is_superuser
        ):
            raise Http404
        queryset = project.tasks.all()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(project__users__in=[self.request.user.id])
        return queryset


@permission_classes([IsAuthenticated])
class TaskList(generics.ListAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        queryset = Task.objects.all()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(project__users__in=[self.request.user])
        if self.request.query_params.get("all") != "true":
            queryset = queryset.filter(active=True)
        return queryset


@permission_classes([IsAuthenticated])
class TaskDetail(generics.RetrieveUpdateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        task = Task.objects.get(pk=self.kwargs["pk"])
        if task is None or (
            self.request.user not in task.project.users.all()
            and not self.request.user.is_superuser
        ):
            raise Http404
        return Task.objects.all()


class LargePagination(PageNumberPagination):
    page_size = 500


class ObservationList(generics.ListCreateAPIView):
    queryset = Observation.objects.all()
    serializer_class = ObservationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = LargePagination
    filter_backends = [DjangoFilterBackend]
    filterset_class = ObservationFilter

    def get_serializer(self, *args, **kwargs):
        if isinstance(self.request.data, list):
            kwargs["many"] = True
        return super().get_serializer(*args, **kwargs)


@permission_classes([IsAuthenticated])
class ObservationDetail(generics.RetrieveUpdateAPIView):
    queryset = Observation.objects.all()
    serializer_class = ObservationSerializer


class ObservationListForTask(generics.ListAPIView):
    serializer_class = ObservationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_class = ObservationFilter

    def get_queryset(self):
        task = Task.objects.get(pk=self.kwargs["pk"])
        if task is None:
            raise Http404
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(
        {
            "id": request.user.id,
            "username": request.user.username,
            "email": request.user.email,
            "is_superuser": request.user.is_superuser,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def last_task_update(request):
    time = cache.get("last_task_update", Time("1970-01-01T00:00:00"), None)
    return Response({"last_task_update": time.isot})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def last_observation_update(request):
    time = cache.get("last_observation_update", Time("1970-01-01T00:00:00"), None)
    return Response({"last_observation_update": time.isot})


# ── Schema introspection for the dynamic frontend forms ─────────────────────


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def schema_constraints(request):
    return Response(schema.constraint_schemas())


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def schema_merits(request):
    return Response(schema.merit_schemas())


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def schema_targets(request):
    return Response(schema.target_schemas())


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def schema_scripts(request):
    return Response(schema.script_tree())


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def validate_script(request):
    return Response(schema.validate_script(request.data))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_duration(request):
    return Response(schema.estimate_duration(request.data))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def site(request):
    from django.conf import settings
    return Response({
        "latitude": getattr(settings, "SITE_LATITUDE", None),
        "longitude": getattr(settings, "SITE_LONGITUDE", None),
        "elevation": getattr(settings, "SITE_ELEVATION", None),
    })
