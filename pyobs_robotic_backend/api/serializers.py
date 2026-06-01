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
        print("TargetSerializer.to_internal_value called with:", data)
        if data is None:
            return None
        klass = data.pop("class", "")
        name = data.pop("name")
        # extract type from class name
        if "SiderealTarget" in klass:
            typ = "sidereal"
        elif "DynamicTarget" in klass:
            typ = "dynamic"
        else:
            typ = klass.split(".")[-1].replace("Target", "").lower()
        # everything remaining goes into coords
        return super().to_internal_value({"name": name, "type": typ, "coords": data})

    def to_representation(self, instance):
        klass_map = {
            "sidereal": "pyobs.robotic.scheduler.targets.SiderealTarget",
            "dynamic": "pyobs.robotic.scheduler.targets.DynamicTarget",
        }
        data = {
            "class": klass_map.get(
                instance.type,
                f"pyobs.robotic.scheduler.targets.{instance.type.capitalize()}Target",
            ),
            "name": instance.name,
        }
        data.update(instance.coords)
        return data


class TaskSerializer(serializers.ModelSerializer):
    constraints = ConstraintSerializer(many=True)
    merits = MeritSerializer(many=True)
    target = TargetSerializer(allow_null=True)
    project = serializers.SlugRelatedField(
        slug_field="code", queryset=Project.objects.all()
    )

    class Meta:
        model = Task
        fields = "__all__"

    def to_internal_value(self, data):
        if "class" in data:
            del data["class"]
        data["code"] = data.pop("id")
        return super().to_internal_value(data)

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
            self._create_target(task, target_data)
        return task

    def update(self, task: Task, validated_data):
        merits_data = validated_data.pop("merits")
        constraints_data = validated_data.pop("constraints")
        target_data = validated_data.pop("target", None)
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
            Merit.objects.create(task=task, **merit)

    @staticmethod
    def _create_constraints(task: Task, constraints_data):
        for constraint in constraints_data:
            Constraint.objects.create(task=task, **constraint)

    @staticmethod
    def _create_target(task: Task, target_data):
        if target_data is None:
            return
        Target.objects.create(task=task, **target_data)
