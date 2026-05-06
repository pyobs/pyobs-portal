import datetime

from typing import Any

import bcrypt
from sqlalchemy import String, ForeignKey, JSON, Table, Column
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON}


class DbTarget(Base):
    __tablename__ = "target"

    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[list["DbTask"]] = relationship(back_populates="target")
    name: Mapped[str] = mapped_column(String(30))
    type: Mapped[str] = mapped_column(String(10))
    coords: Mapped[dict[str, Any]]


class DbConstraint(Base):
    __tablename__ = "constraint"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id"))
    task: Mapped["DbTask"] = relationship(back_populates="constraints")
    type: Mapped[str] = mapped_column(String(50))
    params: Mapped[dict[str, Any]]


class DbMerit(Base):
    __tablename__ = "merit"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id"))
    task: Mapped["DbTask"] = relationship(back_populates="merits")
    type: Mapped[str] = mapped_column(String(50))
    params: Mapped[dict[str, Any]]


taskuser_table = Table(
    "association_table",
    Base.metadata,
    Column("user_id", ForeignKey("user.id"), primary_key=True),
    Column("task_id", ForeignKey("task.id"), primary_key=True),
)


class DbTask(Base):
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(30))
    project: Mapped[str] = mapped_column(String(30))
    duration: Mapped[float]
    priority: Mapped[float]
    constraints: Mapped[list["DbConstraint"]] = relationship(back_populates="task")
    merits: Mapped[list["DbMerit"]] = relationship(back_populates="task")
    config: Mapped[dict[str, Any]]
    script: Mapped[dict[str, Any]]
    target_id: Mapped[int | None] = mapped_column(ForeignKey("target.id"))
    target: Mapped["DbTarget | None"] = relationship(back_populates="task")
    observations: Mapped["DbObservation | None"] = relationship(back_populates="task")
    users: Mapped[list["DbUser"]] = relationship(
        secondary=taskuser_table, back_populates="tasks"
    )


class DbObservation(Base):
    __tablename__ = "observation"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("task.id"))
    task: Mapped[DbTask | None] = relationship(back_populates="observations")
    start: Mapped[datetime.datetime]
    end: Mapped[datetime.datetime]
    state: Mapped[str] = mapped_column(String(15))


class DbUser(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50))
    password: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(100))
    token: Mapped[str | None] = mapped_column(String(32))
    tasks: Mapped[list["DbTask"]] = relationship(
        secondary=taskuser_table, back_populates="users"
    )

    @staticmethod
    def create_user(
        session: Session, username: str, password: str, email: str
    ) -> "DbUser":
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
        user = DbUser(username=username, password=hashed.decode("utf-8"), email=email)
        session.add(user)
        return user

    def check_password(self, password: str) -> bool:
        return bcrypt.checkpw(password.encode("utf-8"), self.password.encode("utf-8"))
