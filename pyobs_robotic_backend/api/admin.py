from django.contrib import admin

from .models import *


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    pass


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    pass


@admin.register(Constraint)
class ConstraintAdmin(admin.ModelAdmin):
    pass


@admin.register(Merit)
class MeritAdmin(admin.ModelAdmin):
    pass


@admin.register(Target)
class TargetAdmin(admin.ModelAdmin):
    pass


@admin.register(Observation)
class ObservationAdmin(admin.ModelAdmin):
    pass
