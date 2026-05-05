from sqlmodel import SQLModel, Field, JSON, Relationship


class Target(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    type: str
    coords: dict = Field(sa_type=JSON)


class Task(SQLModel, table=True):
    id: str | None = Field(default=None, primary_key=True)
    name: str
    project: str
    duration: float
    priority: float = 1.0
    constraints: list["Constraint"] = Relationship(back_populates="task")
    merits: list["Merit"] = Relationship(back_populates="task")
    config: dict = Field(sa_type=JSON)
    script: dict = Field(sa_type=JSON)
    target_id: int | None = Field(default=None, foreign_key="target.id")
    target: Target | None = Relationship()


class Constraint(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    task_id: str | None = Field(default=None, foreign_key="task.id")
    task: Task | None = Relationship(back_populates="constraints")
    type: str
    params: dict = Field(sa_type=JSON)


class Merit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    task_id: str | None = Field(default=None, foreign_key="task.id")
    task: Task | None = Relationship(back_populates="merits")
    type: str
    params: dict = Field(sa_type=JSON)
