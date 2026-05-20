from celery import shared_task
import logging
from datetime import timedelta
from django.utils import timezone

from pyobs_robotic_backend.api.models import Observation

logger = logging.getLogger(__name__)


@shared_task
def delete_old_observations():
    cutoff = timezone.now() - timedelta(days=14)
    logger.info(f"Deleting CANCELED observations before cutoff date {cutoff}")
    Observation.delete_old_observations(cutoff)
