import logging

from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import ObservationState, Task

log = logging.getLogger(__name__)


def cancel_pending_observations(task: Task) -> int:
    """Cancels a task's still-pending observations, e.g. when the task is deactivated or
    deleted (pyobs-portal#135) -- otherwise they sit stale, referencing a task the API no
    longer serves. In-progress observations are left running, matching what pyobs-core's
    mastermind self-heal (pyobs-core#852) already assumes."""
    now = timezone.now()
    # QuerySet.update() bypasses auto_now, so stamp updated_at explicitly to keep the
    # last_observation_update marker accurate (same pattern as mark_window_expired/
    # CancelObservations, issue #83).
    count = task.observations.filter(state=ObservationState.PENDING).update(
        state=ObservationState.CANCELED, updated_at=now
    )
    if count:
        log.info("Canceled %d pending observation(s) for task %s.", count, task.code)
    return count


@receiver(post_save, sender=Task)
def cancel_pending_observations_on_deactivate(sender, instance: Task, **kwargs) -> None:
    if not instance.active:
        cancel_pending_observations(instance)


@receiver(pre_delete, sender=Task)
def cancel_pending_observations_on_delete(sender, instance: Task, **kwargs) -> None:
    cancel_pending_observations(instance)
