from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .models import Task, Observation, Merit, Constraint, Project, Target


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "is_superuser")


class ConstraintSerializer(serializers.ModelSerializer):
    class Meta:
        model = Constraint
        fields = "__all__"

    def to_internal_value(self, data):
        typ = data.pop("class").split(".")[-1]
        return {"type": typ, "params": data}

    def to_representation(self, instance):
        repr = {"class": "pyobs.robotic.scheduler.constraints." + instance.type}
        repr.update(**instance.params)
        return repr


class MeritSerializer(serializers.ModelSerializer):
    class Meta:
        model = Merit
        fields = "__all__"

    def to_internal_value(self, data):
        typ = data.pop("class").split(".")[-1]
        return {"type": typ, "params": data}

    def to_representation(self, instance):
        repr = {"class": "pyobs.robotic.scheduler.merits." + instance.type}
        repr.update(**instance.params)
        return repr


class ObservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Observation
        fields = ["id", "task", "start", "end", "state"]


class ProjectSerializer(serializers.ModelSerializer):
    users = serializers.SlugRelatedField(
        many=True, slug_field="username", queryset=User.objects.all()
    )

    class Meta:
        model = Project
        fields = "__all__"


class TargetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Target
        fields = ["name", "type", "coords"]

    def to_internal_value(self, data):
        if data is None:
            return None
        klass = data.pop("class")
        if "SiderealTarget" in klass:
            data["type"] = "sidereal"
            data["coords"] = {"ra": data.pop("ra"), "dec": data.pop("dec")}
        return data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        typ = data.pop("type")
        if typ == "sidereal":
            data["class"] = "pyobs.robotic.scheduler.targets.SiderealTarget"
            coords = data.pop("coords")
            data["ra"] = coords["ra"]
            data["dec"] = coords["dec"]

        return data


class TaskSerializer(serializers.ModelSerializer):
    constraints = ConstraintSerializer(many=True)
    merits = MeritSerializer(many=True)
    target = TargetSerializer()
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
        self._create_constraints(task, constraints_data)
        self._create_merits(task, merits_data)
        if target_data:
            pass
        return task

    def update(self, task: Task, validated_data):
        merits_data = validated_data.pop("merits")
        constraints_data = validated_data.pop("constraints")
        target_data = validated_data.pop("target", None)
        project_code = validated_data.pop("project")
        try:
            validated_data["project"] = Project.objects.get(code=project_code)
        except Project.DoesNotExist:
            raise ValidationError("Project not found")
        super().update(task, validated_data)

        task.constraints.all().delete()
        self._create_constraints(task, constraints_data)
        task.merits.all().delete()
        self._create_merits(task, merits_data)
        try:
            task.target.delete()
        except Task.target.RelatedObjectDoesNotExist:
            pass
        self._create_target(task, target_data)

        return task

    @staticmethod
    def _create_merits(task: Task, merits_data):
        for merit in merits_data:
            Merit.objects.create(
                task=task, **MeritSerializer().to_internal_value(merit)
            )

    @staticmethod
    def _create_constraints(task: Task, constraints_data):
        for constraint in constraints_data:
            Constraint.objects.create(
                task=task, **ConstraintSerializer().to_internal_value(constraint)
            )

    @staticmethod
    def _create_target(task: Task, target_data):
        if target_data is None:
            return
        Target.objects.create(
            task=task, **TargetSerializer().to_internal_value(target_data)
        )
