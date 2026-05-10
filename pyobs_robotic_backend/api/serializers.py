from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .models import Task, Observation, Merit, Constraint, Project


class ConstraintSerializer(serializers.ModelSerializer):
    class Meta:
        model = Constraint
        fields = "__all__"

    def to_internal_value(self, data):
        typ = data.pop("class")
        return {"type": typ, "params": data}

    def to_representation(self, instance):
        repr = {"class": instance.type}
        repr.update(**instance.params)
        return repr


class MeritSerializer(serializers.ModelSerializer):
    class Meta:
        model = Merit
        fields = "__all__"

    def to_internal_value(self, data):
        typ = data.pop("class")
        return {"type": typ, "params": data}

    def to_representation(self, instance):
        repr = {"class": instance.type}
        repr.update(**instance.params)
        return repr


class ObservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Observation
        fields = ["id", "task", "start", "end", "state"]


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = "__all__"


class TaskSerializer(serializers.ModelSerializer):
    constraints = ConstraintSerializer(many=True)
    merits = MeritSerializer(many=True)
    project = serializers.SlugRelatedField(read_only=True, slug_field="code")

    class Meta:
        model = Task
        fields = "__all__"

    def to_internal_value(self, data):
        if "class" in data:
            del data["class"]
        data["code"] = data.pop("id")
        return data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["id"] = data.pop("code")
        return data

    def create(self, validated_data):
        merits_data = validated_data.pop("merits")
        constraints_data = validated_data.pop("constraints")
        target_data = validated_data.pop("target", None)
        project_code = validated_data.pop("project")
        try:
            project = Project.objects.get(code=project_code)
        except Project.DoesNotExist:
            raise ValidationError("Project not found")
        task = Task.objects.create(project=project, **validated_data)
        for merit in merits_data:
            Merit.objects.create(
                task=task, **MeritSerializer().to_internal_value(merit)
            )
        for constraint in constraints_data:
            Constraint.objects.create(
                task=task, **ConstraintSerializer().to_internal_value(constraint)
            )
        if target_data:
            pass
        return task


class UserSerializer(serializers.ModelSerializer):
    snippets = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Task.objects.all()
    )

    class Meta:
        model = User
        fields = ["id", "username", "tasks"]
