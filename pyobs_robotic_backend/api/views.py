from rest_framework.request import Request
from typing import Any

from astropy.time import Time
from django.contrib.auth.models import User
from django.http import Http404
from django.utils import timezone
from rest_framework import generics
from rest_framework.decorators import permission_classes, api_view
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

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
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def get_permissions(self):
        self.permission_classes = [IsAdminUser]
        if self.request.method == "GET":
            self.permission_classes = [IsAuthenticated]
        return super().get_permissions()

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        queryset = self.get_queryset()
        if not request.user.is_superuser:
            queryset = queryset.filter(users__in=[request.user])
        serializer = ProjectSerializer(queryset, many=True)
        return Response(serializer.data)


@permission_classes([IsAdminUser])
class ProjectDetail(generics.RetrieveUpdateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer


@permission_classes([IsAuthenticated])
class TaskListForProject(generics.ListCreateAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        project = Project.objects.get(pk=self.kwargs["pk"])
        if project is None or (self.request.user not in project.users.all() and not self.request.user.is_superuser):
            raise Http404
        return project.tasks.all()

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        queryset = self.get_queryset()
        if not request.user.is_superuser:
            queryset = queryset.filter(project__users__in=[request.user.id])
        serializer = TaskSerializer(queryset, many=True)
        return Response(serializer.data)


@permission_classes([IsAuthenticated])
class TaskList(generics.ListAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        queryset = self.get_queryset()
        if not request.user.is_superuser:
            queryset = queryset.filter(project__users__in=[request.user])
        serializer = TaskSerializer(queryset, many=True)
        return Response(serializer.data)


@permission_classes([IsAuthenticated])
class TaskDetail(generics.RetrieveUpdateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        task = Task.objects.get(pk=self.kwargs["pk"])
        if task is None or (self.request.user not in task.project.users.all() and not self.request.user.is_superuser):
            raise Http404
        return Task.objects.all()


class ObservationList(generics.ListCreateAPIView):
    queryset = Observation.objects.all()
    serializer_class = ObservationSerializer
    permission_classes = [IsAuthenticated]

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

    def get_serializer(self, *args, **kwargs):
        if isinstance(self.request.data, list):
            kwargs["many"] = True
        return super().get_serializer(*args, **kwargs)


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
        Observation.objects.filter(end__gte=Time(after).to_datetime(tz), state="pending").update(state="canceled")
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
