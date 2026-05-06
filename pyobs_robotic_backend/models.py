import datetime

from typing import Any

from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


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
    task_id: Mapped[str] = mapped_column(ForeignKey("task.id"))
    task: Mapped["DbTask"] = relationship(back_populates="constraints")
    type: Mapped[str] = mapped_column(String(50))
    params: Mapped[dict[str, Any]]


class DbMerit(Base):
    __tablename__ = "merit"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("task.id"))
    task: Mapped["DbTask"] = relationship(back_populates="merits")
    type: Mapped[str] = mapped_column(String(50))
    params: Mapped[dict[str, Any]]


class DbTask(Base):
    __tablename__ = "task"

    id: Mapped[str] = mapped_column(primary_key=True)
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


class DbObservation(Base):
    __tablename__ = "observation"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("task.id"))
    task: Mapped[DbTask | None] = relationship(back_populates="observations")
    start: Mapped[datetime.datetime]
    end: Mapped[datetime.datetime]
    state: Mapped[str] = mapped_column(String(15))
