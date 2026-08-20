# Add `updated_at` to Task and Observation, backfill existing rows, then make
# the columns non-null. The backfill uses `now()` as the one-time best guess
# for pre-existing rows; going forward `auto_now` keeps the field accurate on
# every `save()` (see issue #83).

from django.db import migrations, models
from django.utils import timezone


def backfill_updated_at(apps, schema_editor):
    Task = apps.get_model("api", "Task")
    Observation = apps.get_model("api", "Observation")
    now = timezone.now()
    Task.objects.update(updated_at=now)
    Observation.objects.update(updated_at=now)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0007_project_public"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, null=True),
        ),
        migrations.AddField(
            model_name="observation",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, null=True),
        ),
        migrations.RunPython(backfill_updated_at, noop),
        migrations.AlterField(
            model_name="task",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name="observation",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
