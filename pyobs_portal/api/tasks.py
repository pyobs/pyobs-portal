from celery import shared_task
import logging
from datetime import timedelta
from django.utils import timezone

from pyobs_portal.api.models import Observation

logger = logging.getLogger(__name__)


@shared_task
def mark_window_expired():
    now = timezone.now()
    expired = Observation.objects.filter(state="pending", end__lt=now)
    # QuerySet.update() bypasses auto_now, so stamp updated_at explicitly to
    # keep the last_observation_update marker accurate (issue #83).
    count = expired.update(state="window_expired", updated_at=now)
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
    pks = list(observations.values_list("pk", flat=True)[:100000])
    total_deleted = 0
    chunk_size = 1000
    for i in range(0, len(pks), chunk_size):
        num_deleted, _ = Observation.objects.filter(pk__in=pks[i : i + chunk_size]).delete()
        total_deleted += num_deleted
    logger.warning(f"Deleted {total_deleted} observations.")
