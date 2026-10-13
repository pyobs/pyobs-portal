# Store the scheduler's ranking value of an observation (pyobs-core's Observation.priority, merit times task and
# project priority at planning time), so the mastermind can write it into the FITS header (pyobs-core#962).
# Nullable, existing rows stay NULL.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0009_project_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="observation",
            name="priority",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
