from astropy.time import Time
from sqlalchemy.orm import Session
from pyobs.robotic import Task, Observation, ObservationState
from pyobs.robotic.scheduler.constraints import Constraint
from pyobs.robotic.scheduler.merits import Merit
from pyobs.robotic.scripts import Script

from .models import *


def task_to_db(session: Session, task: Task):
    db_target = None
    if task.target is not None:
        db_target = DbTarget(name=task.target.name)
        session.add(db_target)

    db_task = DbTask(
        id=str(task.id),
        name=task.name,
        project=task.project,
        duration=task.duration,
        priority=task.priority if task.priority is not None else 1.0,
        config=task.config,
        script=task.script.model_dump(mode="json"),
        target=db_target,
    )
    session.add(db_task)

    for constraint in task.constraints:
        db_constraint = DbConstraint(
            task_id=db_task.id,
            type=constraint.__class__.__name__,
            params=constraint.model_dump(mode="json"),
        )
        session.add(db_constraint)

    for merit in task.merits:
        db_merit = DbMerit(
            task_id=db_task.id,
            type=merit.__class__.__name__,
            params=merit.model_dump(mode="json"),
        )
        session.add(db_merit)


def db_to_task(db_task: DbTask) -> Task:
    target = None

    task = Task(
        id=db_task.id,
        name=db_task.name,
        project=db_task.project,
        duration=db_task.duration,
        priority=db_task.priority,
        config=db_task.config,
        script=Script.model_validate(db_task.script),
        target=target,
    )

    for constraint in db_task.constraints:
        task.constraints.append(Constraint.model_validate(constraint.params))

    for merit in db_task.merits:
        task.merits.append(Merit.model_validate(merit.params))

    return task


def observation_to_db(session: Session, observation: Observation):
    db_observation = DbObservation(
        task_id=str(observation.task_id),
        start=observation.start.to_datetime(),
        end=observation.end.to_datetime(),
        state=observation.state,
    )
    session.add(db_observation)


def db_to_observation(db_observation: DbObservation) -> Observation:
    return Observation(
        id=db_observation.id,
        task_id=db_observation.task_id,
        start=Time(db_observation.start),
        end=Time(db_observation.end),
        state=ObservationState(db_observation.state),
    )
