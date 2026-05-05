from typing import Annotated
from fastapi import FastAPI, Depends
from sqlmodel import Session, SQLModel, create_engine, select
from astropydantic import AstroPydanticTime  # type: ignore
from pyobs.robotic.task import Task
from pyobs.robotic.observation import Observation

from .models import Task as DbTask, Constraint as DbConstraint, Merit as DbMerit

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]

app = FastAPI()


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/tasks")
async def get_schedulable_tasks(session: SessionDep) -> list[Task]:
    db_tasks = session.exec(select(DbTask))
    tasks = (Task(**db_task.model_dump()) for db_task in db_tasks)

    return list(tasks)


@app.get("/tasks/{task_id}")
async def get_tasks(task_id: str) -> Task | None:
    return []


@app.put("/tasks")
async def add_task(task: Task) -> None:
    session = Session(engine)
    db_task = DbTask(
        id=task.id,
        name=task.name,
        project=task.project,
        duration=task.duration,
        priority=task.priority,
        config=task.config,
        script=task.script.model_dump(mode="json"),
        target=task.target.model_dump(mode="json") if task.target is not None else None,
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
        print(merit)
        db_merit = DbMerit(
            task_id=db_task.id,
            type=merit.__class__.__name__,
            params=merit.model_dump(mode="json"),
        )
        session.add(db_merit)

    session.commit()
    session.close()


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
