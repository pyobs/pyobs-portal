from __future__ import annotations

import importlib
import inspect
import pkgutil
from types import ModuleType
from typing import Any

from pydantic import BaseModel

import pyobs.robotic.scheduler.constraints as constraints_module
import pyobs.robotic.scheduler.merits as merits_module
import pyobs.robotic.scheduler.targets as targets_module
import pyobs.robotic.scripts as scripts_module
from pyobs.robotic.scheduler.constraints.constraint import Constraint
from pyobs.robotic.scheduler.merits.merit import Merit
from pyobs.robotic.scheduler.targets.target import Target
from pyobs.robotic.scripts.script import Script

IGNORED_FIELDS = {"cost", "target_dependent", "exptime_done"}


def _strip_ignored(schema: dict[str, Any]) -> dict[str, Any]:
    schema = dict(schema)
    if "properties" in schema:
        schema["properties"] = {k: v for k, v in schema["properties"].items() if k not in IGNORED_FIELDS}
    if "required" in schema:
        schema["required"] = [f for f in schema["required"] if f not in IGNORED_FIELDS]
    return schema


def _subclasses(module: ModuleType, base: type[BaseModel]) -> dict[str, type[BaseModel]]:
    result: dict[str, type[BaseModel]] = {}
    for name, obj in inspect.getmembers(module):
        if inspect.isclass(obj) and issubclass(obj, base) and obj is not base:
            result[name] = obj
    return result


def _schema_for(cls: type[BaseModel]) -> dict[str, Any] | None:
    try:
        return _strip_ignored(cls.model_json_schema())
    except Exception:
        return None


def constraint_schemas() -> dict[str, Any]:
    result = {}
    for name, cls in _subclasses(constraints_module, Constraint).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def merit_schemas() -> dict[str, Any]:
    result = {}
    for name, cls in _subclasses(merits_module, Merit).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def target_schemas() -> dict[str, Any]:
    result = {}
    for name, cls in _subclasses(targets_module, Target).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def script_tree() -> dict[str, Any]:
    def _scan(package: ModuleType) -> dict[str, Any]:
        results: dict[str, Any] = {}
        for _, name, ispkg in pkgutil.iter_modules(package.__path__):
            full_name = f"{package.__name__}.{name}"
            try:
                mod = importlib.import_module(full_name)
            except Exception:
                continue
            if ispkg:
                sub = _scan(mod)
                if sub:
                    results[name] = sub
            else:
                classes = {}
                for cls_name, cls in inspect.getmembers(mod):
                    if (
                        inspect.isclass(cls)
                        and issubclass(cls, Script)
                        and cls is not Script
                        and cls.__module__ == full_name
                    ):
                        s = _schema_for(cls)
                        if s is not None:
                            classes[cls_name] = {
                                "class": f"{cls.__module__}.{cls.__name__}",
                                "schema": s,
                            }
                if classes:
                    results[name] = classes
        return results

    return _scan(scripts_module)


def validate_script(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"valid": False, "error": "Script must be a YAML/JSON object."}
    try:
        Script.model_validate(data)
        return {"valid": True}
    except Exception as e:
        return {"valid": False, "error": str(e)}


def estimate_duration(data: Any) -> dict[str, Any]:
    """Estimate the duration of a script, given the full task payload.

    The full task dict (not just the script sub-dict) must be passed so that
    scripts like TransitImagingScript can find their TransitMerit and return
    the correct window duration rather than falling back to the base
    ImagingScript calculation (which only sums exposure times).
    """
    if not isinstance(data, dict):
        return {"error": "Script must be a YAML/JSON object."}
    try:
        # If the caller passed the full task dict, validate the whole task
        # and create the script from it so estimate_duration gets TaskData.
        if "script" in data and isinstance(data["script"], dict):
            from pyobs.robotic.task import Task, TaskData

            # target ra/dec may arrive as hms/dms strings; strip them so
            # Task.model_validate doesn't choke (the scheduler converts them
            # at runtime; we only need merits here).
            task_dict = {k: v for k, v in data.items() if k != "target"}
            task = Task.model_validate(task_dict)
            script = task.create_script()
            return {"duration": script.estimate_duration(data=TaskData(task=task), time=None)}
        else:
            # Legacy: called with just the script dict.
            script = Script.model_validate(data)
            return {"duration": script.estimate_duration()}
    except Exception as e:
        return {"error": str(e)}
