from celery import shared_task
import logging
from datetime import timedelta
from django.utils import timezone

from pyobs_robotic_backend.api.models import Observation

logger = logging.getLogger(__name__)


@shared_task
def mark_window_expired():
    now = timezone.now()
    expired = Observation.objects.filter(state="pending", end__lt=now)
    count = expired.update(state="window_expired")
    logger.info(f"Marked {count} pending observations as window_expired")


@shared_task
def delete_old_observations():
    cutoff = timezone.now() - timedelta(days=14)
    observations = Observation.objects.filter(
        end__lt=cutoff,
        state__in=["canceled", "window_expired"],
    )
    logger.info(
        f"There are {observations.count()} observations to be deleted. Only the first 100,000 will be deleted this run"
    )
    total_deleted = 0
    for observation in observations[:100000]:
        num_deleted, _ = observation.delete()
        total_deleted += num_deleted
    logger.warning(f"Deleted {total_deleted} observations.")
