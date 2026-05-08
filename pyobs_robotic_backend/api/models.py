from django.contrib.auth.models import User
from django.db import models


class Project(models.Model):
    code = models.CharField(max_length=10)
    name = models.CharField(max_length=30)
    priority = models.FloatField(default=1.0)
    users = models.ManyToManyField(User, related_name="projects", blank=True)


class Task(models.Model):
    code = models.CharField(max_length=10)
    name = models.CharField(max_length=30)
    project = models.ForeignKey(Project, related_name="tasks", on_delete=models.CASCADE)
    duration = models.FloatField()
    priority = models.FloatField()
    script = models.JSONField()


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
