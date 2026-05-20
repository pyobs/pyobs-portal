import datetime
from django.contrib.auth.models import User
from django.db import models
import logging

log = logging.getLogger(__name__)


class Project(models.Model):
    code = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=30)
    priority = models.FloatField(default=1.0)
    users = models.ManyToManyField(User, related_name="projects", blank=True)

    def __str__(self):
        return f"{self.name} ({self.code})"


class Task(models.Model):
    code = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=30)
    project = models.ForeignKey(Project, related_name="tasks", on_delete=models.CASCADE)
    duration = models.FloatField()
    priority = models.FloatField()
    script = models.JSONField()

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


class Merit(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="merits")
    type = models.CharField(max_length=50)
    params = models.JSONField()


class Target(models.Model):
    task = models.OneToOneField(Task, on_delete=models.CASCADE, related_name="target")
    name = models.CharField(max_length=30)
    type = models.CharField(max_length=30)
    coords = models.JSONField()


class Observation(models.Model):
    task = models.ForeignKey(
        Task, on_delete=models.CASCADE, related_name="observations"
    )
    start = models.DateTimeField()
    end = models.DateTimeField()
    state = models.CharField(max_length=15, default="pending")

    @staticmethod
    def delete_old_observations(until: datetime.datetime):
        observations = Observation.objects.filter(
            start__lt=until.isoformat(),
            end__lt=until.isoformat(),
            state__in=["canceled", "pending"],
        )
        log.info(
            f"There are {observations.count()} observations to be deleted. Only the first 100,000 will be deleted this run"
        )
        total_deleted = 0
        for observation in observations[:100000]:
            num_deleted, _ = observation.delete()
            total_deleted += num_deleted

        log.warning(f"Deleted {total_deleted} observations.")
