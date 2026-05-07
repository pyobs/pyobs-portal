from django.contrib.auth.models import User
from rest_framework import serializers
from .models import Task, Observation, Merit, Constraint


class ConstraintSerializer(serializers.ModelSerializer):
    class Meta:
        model = Constraint
        fields = "__all__"

    def to_internal_value(self, data):
        typ = data.pop("class")
        return {"type": typ, "params": data}


class MeritSerializer(serializers.ModelSerializer):
    class Meta:
        model = Merit
        fields = "__all__"

    def to_internal_value(self, data):
        typ = data.pop("class")
        return {"type": typ, "params": data}


class ObservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Observation
        fields = ["id", "task", "start", "end", "state"]


class TaskSerializer(serializers.ModelSerializer):
    constraints = ConstraintSerializer(many=True)
    merits = MeritSerializer(many=True)

    class Meta:
        model = Task
        fields = "__all__"

    def create(self, validated_data):
        merits_data = validated_data.pop("merits")
        constraints_data = validated_data.pop("constraints")
        task = Task.objects.create(**validated_data)
        for merit in merits_data:
            Merit.objects.create(task=task, **merit)
        for constraint in constraints_data:
            Constraint.objects.create(task=task, **constraint)
        return task


class UserSerializer(serializers.ModelSerializer):
    snippets = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Task.objects.all()
    )

    class Meta:
        model = User
        fields = ["id", "username", "tasks"]
