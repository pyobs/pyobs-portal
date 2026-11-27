"""System checks for the restricted-users settings (issue #198)."""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.checks import Error, Warning, register

from pyobs.utils.time import Time


@register()
def check_restricted_constraints(app_configs: Any = None, **kwargs: Any) -> list[Any]:
    from .restrictions import _type_and_params, parse_constraint

    if not getattr(settings, "RESTRICTIONS_ENABLED", False):
        return []

    messages: list[Any] = []
    for i, data in enumerate(getattr(settings, "RESTRICTED_CONSTRAINTS", None) or []):
        where = f"RESTRICTED_CONSTRAINTS[{i}]"
        try:
            typ, model = parse_constraint(data)
        except Exception as exc:
            messages.append(Error(f"{where} does not parse: {exc}", id="api.E001"))
            continue
        if not model.stricter_fields():
            messages.append(
                Error(
                    f"{where}: {typ} cannot be used as a global limit (no field marked as stricter in pyobs-core).",
                    id="api.E002",
                )
            )
            continue
        if typ == "TimeConstraint":
            _, params = _type_and_params(data)
            if "start" not in params or "end" not in params:
                messages.append(
                    Error(f"{where}: TimeConstraint needs explicit start and end (defaults to now).", id="api.E003")
                )
            elif Time(model.end) < Time.now():
                messages.append(
                    Warning(
                        f"{where}: TimeConstraint end is in the past, so no task of a restricted user can be "
                        "scheduled.",
                        id="api.W001",
                    )
                )
    return messages
