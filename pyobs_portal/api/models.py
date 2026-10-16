import logging

from django.contrib.auth.models import User
from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from .validators import validate_finite

from pyobs.robotic.observation import ObservationState

PRIORITY_VALIDATORS = [validate_finite, MinValueValidator(0), MaxValueValidator(9999)]

log = logging.getLogger(__name__)


class Project(models.Model):
    code = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=30)
    priority = models.FloatField(default=1.0, validators=PRIORITY_VALIDATORS)
    users = models.ManyToManyField(User, related_name="projects", blank=True)
    public = models.BooleanField(
        default=False,
        help_text="Public projects are accessible to every authenticated user; "
        "private projects only to their members.",
    )
    # NOTE: auto_now only bumps on a direct save() of this row -- it does NOT fire when `users`
    # membership changes (that's a through-table write, pyobs-core#848). A project's own content
    # (priority, public, ...) is covered; a pure membership change to an otherwise-unchanged
    # project is not reflected here.
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(priority__gte=0, priority__lte=9999),
                name="project_priority_range",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"


class Task(models.Model):
    code = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=30)
    project = models.ForeignKey(Project, related_name="tasks", on_delete=models.CASCADE)
    duration = models.FloatField()
    priority = models.FloatField(validators=PRIORITY_VALIDATORS)
    script = models.JSONField()
    active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(priority__gte=0, priority__lte=9999),
                name="task_priority_range",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"


class Constraint(models.Model):
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="constraints",
    )
    type = models.CharField(max_length=50)
    params = models.JSONField()

    class Meta:
        ordering = ["task", "type"]


class Merit(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="merits")
    type = models.CharField(max_length=50)
    params = models.JSONField()

    class Meta:
        ordering = ["task", "type"]


class Target(models.Model):
    task = models.OneToOneField(Task, on_delete=models.CASCADE, related_name="target")
    name = models.CharField(max_length=30)
    type = models.CharField(max_length=30)
    coords = models.JSONField()

    class Meta:
        ordering = ["task", "name"]


class Observation(models.Model):
    task = models.ForeignKey(
        Task, on_delete=models.CASCADE, related_name="observations"
    )
    start = models.DateTimeField()
    end = models.DateTimeField()
    state = models.CharField(
        max_length=15,
        choices=[(s, s) for s in ObservationState],
        default=ObservationState.PENDING,
    )
    target = models.JSONField(null=True, blank=True)
    obsnum = models.CharField(max_length=32, null=True, blank=True)
    # The scheduler's ranking value for this slot at planning time (merit times task priority times project
    # priority), as sent by pyobs-core's Observation.priority. NULL if the scheduler does not set one.
    priority = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start"]
