from django.core.management.base import BaseCommand
from django.utils import timezone
from pyobs_robotic_backend.api.models import Observation


class Command(BaseCommand):
    help = "Mark pending observations with end time in the past as window_expired"

    def handle(self, *args, **options):
        now = timezone.now()
        expired = Observation.objects.filter(
            state="pending",
            end__lt=now,
        )
        # QuerySet.update() bypasses auto_now, so stamp updated_at explicitly to
        # keep the last_observation_update marker accurate (issue #83) — mirrors
        # the Celery task in api/tasks.py.
        count = expired.update(state="window_expired", updated_at=now)
        self.stdout.write(
            self.style.SUCCESS(f"Marked {count} pending observations as window_expired")
        )
