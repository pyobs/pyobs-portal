from rest_framework.request import Request
from typing import Any
from rest_framework.pagination import PageNumberPagination
from astropy.time import Time
from django.contrib.auth.models import User
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
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
from .models import Task, Observation, ObservationState, Project
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


def accessible_projects_q(user: User) -> Q:
    """Query for the projects a user may access: public projects plus their memberships."""
    return Q(public=True) | Q(users__in=[user])


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
            queryset = queryset.filter(accessible_projects_q(self.request.user))
        return queryset.distinct()


@permission_classes([IsAdminUser])
class ProjectDetail(generics.RetrieveUpdateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer


@permission_classes([IsAuthenticated])
class TaskListForProject(generics.ListCreateAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        project = get_object_or_404(Project, pk=self.kwargs["pk"])
        if not (
            self.request.user.is_superuser
            or project.public
            or self.request.user in project.users.all()
        ):
            raise Http404
        return project.tasks.all()


@permission_classes([IsAuthenticated])
class TaskList(generics.ListAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        queryset = Task.objects.all()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(
                Q(project__public=True) | Q(project__users__in=[self.request.user])
            )
        if self.request.query_params.get("all") != "true":
            queryset = queryset.filter(active=True)
        return queryset.distinct()


@permission_classes([IsAuthenticated])
class TaskDetail(generics.RetrieveUpdateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        task = get_object_or_404(Task, pk=self.kwargs["pk"])
        if not (
            self.request.user.is_superuser
            or task.project.public
            or self.request.user in task.project.users.all()
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

    def get_queryset(self):
        queryset = Observation.objects.all()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(
                Q(task__project__public=True)
                | Q(task__project__users__in=[self.request.user])
            )
        return queryset.distinct()

    def get_serializer(self, *args, **kwargs):
        if isinstance(self.request.data, list):
            kwargs["many"] = True
        return super().get_serializer(*args, **kwargs)


@permission_classes([IsAuthenticated])
class ObservationDetail(generics.RetrieveUpdateAPIView):
    queryset = Observation.objects.all()
    serializer_class = ObservationSerializer

    def get_queryset(self):
        queryset = Observation.objects.all()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(
                Q(task__project__public=True)
                | Q(task__project__users__in=[self.request.user])
            )
        return queryset.distinct()


class ObservationListForTask(generics.ListAPIView):
    serializer_class = ObservationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_class = ObservationFilter

    def get_queryset(self):
        task = get_object_or_404(Task, pk=self.kwargs["pk"])
        if not (
            self.request.user.is_superuser
            or task.project.public
            or self.request.user in task.project.users.all()
        ):
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
            end__gte=Time(after).to_datetime(tz), state=ObservationState.PENDING
        ).update(state=ObservationState.CANCELED)
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
def schema_pickers(request):
    return Response(schema.picker_schemas())


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
        "default_constraints": getattr(settings, "DEFAULT_CONSTRAINTS", []),
        "default_merits": getattr(settings, "DEFAULT_MERITS", []),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def observability(request):
    """
    Return visibility data for a sky position at the configured observatory site.

    Query params: ra (deg), dec (deg)
    Returns: { night: {...}, year: {...} }
    """
    from django.conf import settings
    from .observability import night_data, year_data

    lat = getattr(settings, "SITE_LATITUDE", None)
    lon = getattr(settings, "SITE_LONGITUDE", None)
    elev = getattr(settings, "SITE_ELEVATION", None) or 0.0

    if lat is None or lon is None:
        return Response(
            {"error": "Observatory site coordinates not configured (SITE_LATITUDE / SITE_LONGITUDE)."},
            status=400,
        )

    try:
        ra = float(request.query_params["ra"])
        dec = float(request.query_params["dec"])
    except (KeyError, ValueError):
        return Response({"error": "ra and dec query parameters are required (degrees)."}, status=400)

    try:
        night = night_data(ra, dec, lat, lon, elev)
        year = year_data(ra, dec, lat, lon, elev)
    except Exception as exc:
        return Response({"error": str(exc)}, status=500)

    return Response({"night": night, "year": year})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merit_plot(request):
    """
    Evaluate constraints and merits over the coming night for an unsaved task.

    Body: full task dict (same shape as the task editor payload).
    Returns: { times_utc, twilight_evening_utc, twilight_morning_utc,
               constraints: [{name, values}], merits: [{name, values}],
               combined: [float] }
    """
    from django.conf import settings
    from .merit_plot import merit_plot_data

    lat = getattr(settings, "SITE_LATITUDE", None)
    lon = getattr(settings, "SITE_LONGITUDE", None)
    elev = getattr(settings, "SITE_ELEVATION", None) or 0.0

    if lat is None or lon is None:
        return Response(
            {"error": "Observatory site coordinates not configured (SITE_LATITUDE / SITE_LONGITUDE)."},
            status=400,
        )

    if not isinstance(request.data, dict):
        return Response({"error": "Request body must be a JSON object."}, status=400)

    try:
        result = merit_plot_data(request.data, lat, lon, elev)
    except Exception as exc:
        return Response({"error": str(exc)}, status=500)

    if "error" in result:
        return Response(result, status=400)

    return Response(result)
