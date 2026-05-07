from rest_framework import serializers
from .models import Task, Observation


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "code", "name", "project", "duration", "priority", "script"]


class ObservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Observation
        fields = ["id", "task", "start", "end", "state"]
