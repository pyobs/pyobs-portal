from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from fastapi import FastAPI
from astropydantic import AstroPydanticTime  # type: ignore
from pyobs.robotic.task import Task
from pyobs.robotic.observation import Observation
from .database import task_to_db, db_to_task

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


@app.get("/tasks")
async def get_schedulable_tasks() -> list:
    with Session(engine) as session:
        db_tasks = session.exec(select(DbTask)).all()
        tasks = [db_to_task(db_task[0]) for db_task in db_tasks]
        return [tasks.model_dump() for tasks in tasks]


@app.get("/tasks/{task_id}")
async def get_task(task_id: str) -> Task | None:
    with Session(engine) as session:
        db_task = session.exec(select(DbTask).filter_by(id=task_id)).first()
        if db_task is not None:
            return db_to_task(db_task[0])
        return None


@app.put("/tasks")
async def add_task(task: Task) -> None:
    with Session(engine) as session:
        task_to_db(session, task)
        session.commit()


@app.get("/observations")
async def get_observations() -> list[Observation]:
    return []


@app.post("/observations/")
async def get_next_observations_for_task(
    task_id: str | None, night: str | None
) -> list[Observation]:
    return []


@app.post("/observations/clear")
async def clear_observations(after: AstroPydanticTime) -> None:
    return


@app.post("/observation/current")
async def get_current_observations() -> Observation | None:
    return None


@app.get("/observation/next")
async def get_next_observations() -> Observation | None:
    return None


@app.post("/observation")
async def update_observation(observation: Observation):
    return {}
