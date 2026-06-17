from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from pyobs_robotic_backend.api.tasks import mark_window_expired, delete_old_observations


def run():
    scheduler = BlockingScheduler()
    scheduler.add_job(
        mark_window_expired.delay, CronTrigger.from_crontab("*/5 * * * *")
    )
    scheduler.add_job(
        delete_old_observations.delay, CronTrigger.from_crontab("0 * * * *")
    )
    scheduler.start()
