from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from pyobs_robotic_backend.api.tasks import delete_old_observations


def run():
    scheduler = BlockingScheduler()
    scheduler.add_job(
        delete_old_observations.delay, CronTrigger.from_crontab("* * * * *")
    )
    scheduler.start()
