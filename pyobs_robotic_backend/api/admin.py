from django.contrib import admin

from .models import *


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "priority"]


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "project", "duration", "priority"]


@admin.register(Constraint)
class ConstraintAdmin(admin.ModelAdmin):
    list_display = ["task", "type", "params"]


@admin.register(Merit)
class MeritAdmin(admin.ModelAdmin):
    list_display = ["task", "type", "params"]


@admin.register(Target)
class TargetAdmin(admin.ModelAdmin):
    list_display = ["task", "name", "type", "coords"]


@admin.register(Observation)
class ObservationAdmin(admin.ModelAdmin):
    list_display = ["task", "start", "end", "state"]
