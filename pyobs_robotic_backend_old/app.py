import datetime

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session
from fastapi import FastAPI
from astropydantic import AstroPydanticTime  # type: ignore
from pyobs.robotic.task import Task
from pyobs.robotic.observation import Observation
from .database import task_to_db, db_to_task, observation_to_db, db_to_observation

from .models import *

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)


def create_db_and_tables():
    Base.metadata.create_all(engine)


app = FastAPI()


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/api/tasks")
async def get_schedulable_tasks() -> list[Task]:
    with Session(engine) as session:
        db_tasks = session.execute(select(DbTask)).all()
        tasks = [db_to_task(db_task[0]) for db_task in db_tasks]
        # return [tasks.model_dump() for tasks in tasks]
        return tasks


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str) -> Task | None:
    with Session(engine) as session:
        db_task = session.execute(select(DbTask).filter_by(id=task_id)).first()
        if db_task is not None:
            return db_to_task(db_task[0])
        return None


@app.put("/api/tasks")
async def add_task(task: Task) -> None:
    with Session(engine) as session:
        task_to_db(session, task)
        session.commit()


@app.get("/api/observations")
async def get_observations(
    start: datetime.datetime | None = None,
    end: datetime.datetime | None = None,
    state: str | None = None,
) -> list[Observation]:
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


@app.put("/api/observations")
async def add_or_update_observation(observation: Observation):
    if observation.id is None:
        await add_observation(observation)
    else:
        await update_observation(observation)


async def add_observation(observation: Observation) -> None:
    with Session(engine) as session:
        observation_to_db(session, observation)
        session.commit()


async def update_observation(observation: Observation) -> None:
    with Session(engine) as session:
        db_observation = session.execute(
            select(DbObservation).filter_by(id=observation.id)
        ).first()
        if db_observation is not None:
            db_observation.start = observation.start
            db_observation.end = observation.end
            db_observation.state = observation.state
            session.commit()


@app.get("/api/tasks/{task_id}/observations")
async def get_observations_for_task(task_id: str) -> list[Observation]:
    with Session(engine) as session:
        db_observations = session.execute(
            select(DbObservation).filter_by(task_id=task_id)
        ).all()
        return [db_to_observation(obs[0]) for obs in db_observations]


@app.get("/api/observations/cancel")
async def cancel_observations(after: datetime.datetime) -> None:
    with Session(engine) as session:
        stmt = (
            update(DbObservation)
            .where(DbObservation.state == "pending", DbObservation.start > after)
            .values(state="canceled")
        )
        session.execute(stmt)
        session.commit()
