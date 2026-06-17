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
        count = expired.count()
        expired.update(state="window_expired")
        self.stdout.write(
            self.style.SUCCESS(f"Marked {count} pending observations as window_expired")
        )
