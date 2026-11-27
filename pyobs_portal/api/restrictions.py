"""Restricted users (issue #198).

With ``RESTRICTIONS_ENABLED``, every authenticated user except superusers and members of the
Django group ``unrestricted`` is restricted. For restricted users, task writes must:

- contain, for every entry of ``RESTRICTED_CONSTRAINTS``, a constraint of the same type that is at
  least as strict. Which direction is stricter comes from pyobs-core (``Constraint.stricter_fields``,
  the ``x-pyobs-stricter`` schema key). Extra constraints of any type are allowed: constraints are
  ANDed, so an extra one can only make a task harder to schedule;
- only use merits whose ``Merit.max_value()`` is at most ``MAX_MERIT`` (merits are multiplied, so a
  larger value would raise the task's ranking);
- have a target;
- keep the priority at or below ``RESTRICTED_MAX_PRIORITY``.

The rules are checked when a task is saved and apply to whoever saves it, so an unrestricted user
may loosen a task a restricted user created. This is intended.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from pydantic import BaseModel

import pyobs.robotic.scheduler.constraints as constraints_module
import pyobs.robotic.scheduler.merits as merits_module
from pyobs.robotic.scheduler.constraints import Constraint
from pyobs.robotic.scheduler.merits import Merit

from .schema import _subclasses

UNRESTRICTED_GROUP = "unrestricted"
CONSTRAINT_PREFIX = "pyobs.robotic.scheduler.constraints."
MAX_MERIT = 1.0


def is_restricted(user: Any) -> bool:
    """Whether the rules apply to this user. Memoised on the user object."""
    if not getattr(settings, "RESTRICTIONS_ENABLED", False):
        return False
    if user is None or not user.is_authenticated or user.is_superuser:
        return False
    cached = getattr(user, "_pyobs_restricted", None)
    if cached is None:
        cached = not user.groups.filter(name=UNRESTRICTED_GROUP).exists()
        user._pyobs_restricted = cached
    return cached


def _type_and_params(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Accept the API form {"class": "...X", **params} and the stored form {type, params}."""
    if "class" not in data and "type" in data:
        return str(data["type"]), dict(data.get("params") or {})
    params = dict(data)
    cls = params.pop("class", None)
    if not cls:
        raise ValueError('missing "class"')
    return str(cls).split(".")[-1], params


def _parse(data: dict[str, Any], classes: dict[str, type[BaseModel]]) -> tuple[str, Any]:
    typ, params = _type_and_params(data)
    if typ not in classes:
        raise ValueError(f"unknown type {typ}")
    return typ, classes[typ].model_validate(params)


def parse_constraint(data: dict[str, Any]) -> tuple[str, Constraint]:
    return _parse(data, _subclasses(constraints_module, Constraint))


def parse_merit(data: dict[str, Any]) -> tuple[str, Merit]:
    return _parse(data, _subclasses(merits_module, Merit))


def global_constraints() -> list[tuple[str, Constraint]]:
    return [parse_constraint(c) for c in getattr(settings, "RESTRICTED_CONSTRAINTS", None) or []]


def _fmt(value: Any) -> str:
    isot = getattr(value, "isot", None)
    if isot is not None:
        return str(isot)
    return f"{value:g}" if isinstance(value, float) else str(value)


def _bounds_text(model: Constraint) -> str:
    return ", ".join(
        f"{field} {'<=' if direction == 'lower' else '>='} {_fmt(getattr(model, field))}"
        for field, direction in model.stricter_fields().items()
    )


def _looser(typ: str, submitted: Constraint, glob: Constraint) -> list[str]:
    errors = []
    for field, direction in glob.stricter_fields().items():
        value, bound = getattr(submitted, field), getattr(glob, field)
        ok = value <= bound if direction == "lower" else value >= bound
        if not ok:
            op = "<=" if direction == "lower" else ">="
            errors.append(
                f"{typ}.{field}={_fmt(value)} is looser than the global limit (must be {op} {_fmt(bound)})."
            )
    return errors


def check_constraints(constraints: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    parsed: list[tuple[str, Constraint]] = []
    for data in constraints:
        try:
            parsed.append(parse_constraint(data))
        except Exception as exc:
            errors.append(f"Invalid constraint: {exc}")

    # Constraints are ANDed, so one submitted constraint at least as strict as a global covers it.
    for gtyp, gmodel in global_constraints():
        candidates = [model for typ, model in parsed if typ == gtyp]
        if not candidates:
            errors.append(f"Missing required constraint {gtyp} ({_bounds_text(gmodel)}).")
            continue
        problems = [_looser(gtyp, m, gmodel) for m in candidates]
        if all(problems):
            errors.extend(problems[0])
    return errors


def check_merits(merits: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for data in merits:
        try:
            typ, model = parse_merit(data)
        except Exception as exc:
            errors.append(f"Invalid merit: {exc}")
            continue
        value = model.max_value()
        if value > MAX_MERIT:
            errors.append(
                f"{typ} can raise the task's merit by a factor of up to {_fmt(float(value))} "
                f"(must be <= {_fmt(MAX_MERIT)})."
            )
    return errors


def check_task(
    constraints: list[dict[str, Any]], merits: list[dict[str, Any]], has_target: bool, priority: float | None
) -> dict[str, list[str]]:
    """All rule violations for a restricted user's task, keyed like the serializer fields."""
    errors = {
        "constraints": check_constraints(constraints),
        "merits": check_merits(merits),
        "target": [] if has_target else ["A target is required for your account."],
        "priority": [],
    }
    max_priority = float(getattr(settings, "RESTRICTED_MAX_PRIORITY", 1.0))
    if priority is not None and priority > max_priority:
        errors["priority"].append(f"Priority {_fmt(float(priority))} exceeds the maximum of {_fmt(max_priority)}.")
    return {key: value for key, value in errors.items() if value}


def merit_allowed_by_default(cls: type[Merit]) -> bool:
    """Whether a merit type is usable at all: its default instance stays within MAX_MERIT.

    Used to hide e.g. RandomMerit from the editor. Types that need parameters to be built are
    kept; the write check still rejects bad values.
    """
    try:
        return cls().max_value() <= MAX_MERIT
    except Exception:
        return True


def _api_form(data: dict[str, Any]) -> dict[str, Any]:
    typ, params = _type_and_params(data)
    return {"class": CONSTRAINT_PREFIX + typ, **params}


def frontend_config(user: Any) -> dict[str, Any] | None:
    """The `restrictions` block of /api/site/, or None for unrestricted users.

    The stricter direction per field and the merit-factor fields come with the JSON schemas.
    """
    if not is_restricted(user):
        return None
    return {
        "global_constraints": [_api_form(c) for c in getattr(settings, "RESTRICTED_CONSTRAINTS", None) or []],
        "max_merit": MAX_MERIT,
        "max_priority": float(getattr(settings, "RESTRICTED_MAX_PRIORITY", 1.0)),
    }
