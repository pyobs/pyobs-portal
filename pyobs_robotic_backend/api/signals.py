from astropy.time import Time
from django.core.cache import cache
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Task, Observation


@receiver(post_save, sender=Task)
def task_save(sender, instance, created, **kwargs):
    cache.set("last_task_update", Time.now(), None)


@receiver(post_save, sender=Observation)
def task_save(sender, instance, created, **kwargs):
    cache.set("last_observation_update", Time.now(), None)
