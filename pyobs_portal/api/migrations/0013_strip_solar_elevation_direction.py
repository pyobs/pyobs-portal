"""pyobs-core removed SolarElevationConstraint.direction (pyobs-portal#198).

Stored constraints with a `direction` key no longer validate in the scheduler, so the key is
removed. A "rising" or "setting" direction made the constraint stricter, so those tasks become
looser; they are logged for review.
"""

import logging

from django.db import migrations

log = logging.getLogger(__name__)


def strip_direction(apps, schema_editor):
    Constraint = apps.get_model("api", "Constraint")
    for constraint in Constraint.objects.filter(type="SolarElevationConstraint"):
        params = dict(constraint.params or {})
        if "direction" not in params:
            continue
        direction = params.pop("direction")
        if direction != "both":
            log.warning(
                "Task %s: removed SolarElevationConstraint direction=%r, the task is now less strict.",
                constraint.task_id,
                direction,
            )
        constraint.params = params
        constraint.save(update_fields=["params"])


class Migration(migrations.Migration):
    dependencies = [("api", "0012_unrestricted_group")]

    operations = [migrations.RunPython(strip_direction, migrations.RunPython.noop)]
