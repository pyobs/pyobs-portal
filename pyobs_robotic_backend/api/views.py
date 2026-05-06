import datetime

from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from .models import Task


@require_http_methods(["GET", "PUT"])
def get_tasks(request):
    if request.method == "GET":
        tasks = Task.objects.all()
        return tasks
    else:
        pass
        # with Session(engine) as session:
        #    task_to_db(session, task)
        #    session.commit()


@require_http_methods(["GET"])
def get_task(request, task_id: str):
    task = Task.objects.get(code=task_id)
    if task is not None:
        return task
    return None


@require_http_methods(["GET"])
def get_observations(
    request,
    start: datetime.datetime | None = None,
    end: datetime.datetime | None = None,
    state: str | None = None,
):
    """
    with Session(engine) as session:
        stmt = select(DbObservation)

        if start is not None:
            stmt = stmt.filter(DbObservation.end >= start)
        if end is not None:
            stmt = stmt.filter(DbObservation.start <= end)
        if state is not None:
            stmt = stmt.filter(DbObservation.state == state)

        db_observations = session.execute(stmt).all()
        return [db_to_observation(obs[0]) for obs in db_observations]
    """
    pass


@require_http_methods(["PUT"])
def add_or_update_observation(request, observation: Observation):
    if observation.id is None:
        add_observation(observation)
    else:
        update_observation(observation)


def add_observation(request, observation: Observation) -> None:
    # with Session(engine) as session:
    #    observation_to_db(session, observation)
    #    session.commit()
    pass


def update_observation(request, observation: Observation) -> None:
    """
    with Session(engine) as session:
        db_observation = session.execute(
            select(DbObservation).filter_by(id=observation.id)
        ).first()
        if db_observation is not None:
            db_observation.start = observation.start
            db_observation.end = observation.end
            db_observation.state = observation.state
            session.commit()
    """
    pass


@require_http_methods(["GET"])
def get_observations_for_task(request, task_id: str):
    with Session(engine) as session:
        db_observations = session.execute(
            select(DbObservation).filter_by(task_id=task_id)
        ).all()
        return [db_to_observation(obs[0]) for obs in db_observations]


@require_http_methods(["GET"])
def cancel_observations(request, after: datetime.datetime):
    with Session(engine) as session:
        stmt = (
            update(DbObservation)
            .where(DbObservation.state == "pending", DbObservation.start > after)
            .values(state="canceled")
        )
        session.execute(stmt)
        session.commit()
