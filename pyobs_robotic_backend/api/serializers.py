import inspect

from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from astropy.coordinates import Angle
import astropy.units as u

import pyobs.robotic.scheduler.targets as _targets_module
from pyobs.robotic.scheduler.targets.target import Target as _TargetModel

from . import archive
from .models import Task, Observation, Merit, Constraint, Project, Target


def _target_type_to_class() -> dict[str, str]:
    """Map lowercase type key (e.g. "sidereal") to the real pyobs target class name."""
    return {
        name.replace("Target", "").lower(): name
        for name, obj in inspect.getmembers(_targets_module)
        if inspect.isclass(obj)
        and issubclass(obj, _TargetModel)
        and obj is not _TargetModel
    }


TARGET_TYPE_TO_CLASS = _target_type_to_class()


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ("id", "username", "email", "is_superuser", "password")

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save()
        return user


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
    archive_url = serializers.SerializerMethodField()

    class Meta:
        model = Observation
        fields = [
            "id",
            "task",
            "start",
            "end",
            "state",
            "target",
            "obsnum",
            "archive_url",
        ]

    def get_archive_url(self, obs: Observation) -> str | None:
        return archive.archive_url(obs)


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
        data = dict(data)  # don't mutate input
        klass = data.pop("class", "")
        name = data.pop("name")
        # extract type from class name
        typ = klass.split(".")[-1].replace("Target", "").lower()
        # parse hms/dms strings for sidereal targets
        if typ == "sidereal":
            if isinstance(data.get("ra"), str):
                data["ra"] = Angle(data["ra"], unit=u.hourangle).deg
            if isinstance(data.get("dec"), str):
                data["dec"] = Angle(data["dec"], unit=u.deg).deg
        # DynamicTarget: keep picker as nested object
        elif typ == "dynamic":
            coords = {k: v for k, v in data.items() if k != "picker"}
            if "picker" in data:
                coords["picker"] = data["picker"]
            return super().to_internal_value(
                {"name": name, "type": typ, "coords": coords}
            )
        # everything else goes into coords
        return super().to_internal_value({"name": name, "type": typ, "coords": data})

    def to_representation(self, instance):
        class_name = TARGET_TYPE_TO_CLASS.get(
            instance.type, f"{instance.type.capitalize()}Target"
        )
        data = {
            "class": f"pyobs.robotic.scheduler.targets.{class_name}",
            "name": instance.name,
        }
        # DynamicTarget: preserve picker as nested object
        if instance.type == "dynamic" and "picker" in instance.coords:
            data["picker"] = instance.coords["picker"]
            coords = {k: v for k, v in instance.coords.items() if k != "picker"}
            data.update(coords)
        else:
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
        if "id" in data:
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
        task = Task.objects.create(**validated_data)
        self._create_constraints(task, constraints_data)
        self._create_merits(task, merits_data)
        if target_data:
            self._create_target(task, target_data)
        return task

    def update(self, task: Task, validated_data):
        merits_data = validated_data.pop("merits", None)
        constraints_data = validated_data.pop("constraints", None)
        target_data = validated_data.pop("target", None)
        super().update(task, validated_data)

        if constraints_data is not None:
            task.constraints.all().delete()
            self._create_constraints(task, constraints_data)
        if merits_data is not None:
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
