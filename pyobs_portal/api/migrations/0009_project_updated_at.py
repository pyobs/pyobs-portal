# Add `updated_at` to Project, backfill existing rows, then make the column non-null. Mirrors
# 0008_task_observation_updated_at.py's Task/Observation pattern, one field wide (pyobs-core#848:
# a Project edit -- e.g. priority -- never moved /api/last_task_update/, so pyobs-core's
# PortalTaskArchive never re-polled).

from django.db import migrations, models
from django.utils import timezone


def backfill_updated_at(apps, schema_editor):
    Project = apps.get_model("api", "Project")
    Project.objects.update(updated_at=timezone.now())


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0008_task_observation_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, null=True),
        ),
        migrations.RunPython(backfill_updated_at, noop),
        migrations.AlterField(
            model_name="project",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
