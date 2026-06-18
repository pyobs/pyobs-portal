"""
merit_plot.py  –  Compute per-merit and per-constraint values over a night.

Called by the `merit_plot` API view (POST /api/merit_plot/).

The endpoint receives the unsaved task payload (same shape as the task editor
sends to /api/tasks/) plus the site config and returns time-series data ready
for the frontend Plotly chart.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
from typing import Any

import numpy as np
from astroplan import Observer
from astropy.time import Time
import astropy.units as u

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_observer(lat: float, lon: float, elev: float) -> Observer:
    return Observer(
        latitude=lat * u.deg,
        longitude=lon * u.deg,
        elevation=elev * u.m,
    )


def _next_night(observer: Observer, now: Time) -> tuple[Time, Time]:
    evening = observer.twilight_evening_astronomical(now, which="next")
    morning = observer.twilight_morning_astronomical(evening, which="next")
    return evening, morning


# ---------------------------------------------------------------------------
# async evaluation helpers  (constraints and merits use async __call__)
# ---------------------------------------------------------------------------

async def _eval_constraint(constraint: Any, time: Time, task: Any, data: Any) -> bool:
    try:
        return bool(await constraint(time, task, data))
    except Exception:
        return False


async def _eval_merit(merit: Any, time: Time, task: Any, data: Any) -> float:
    try:
        return float(await merit(time, task, data))
    except Exception:
        return 0.0


async def _eval_all(constraints: list, merits: list, task: Any, data: Any, times_astropy: list[Time]) -> dict:
    """Evaluate all constraints and merits at each time step."""
    n = len(times_astropy)
    n_c = len(constraints)
    n_m = len(merits)

    constraint_values = [[False] * n for _ in range(n_c)]
    merit_values = [[0.0] * n for _ in range(n_m)]

    for i, t in enumerate(times_astropy):
        for j, c in enumerate(constraints):
            constraint_values[j][i] = await _eval_constraint(c, t, task, data)
        for j, m in enumerate(merits):
            merit_values[j][i] = await _eval_merit(m, t, task, data)

    return {"constraint_values": constraint_values, "merit_values": merit_values}


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------

def merit_plot_data(payload: dict[str, Any], lat: float, lon: float, elev: float) -> dict[str, Any]:
    """
    Compute per-constraint and per-merit time series for the task editor plot.

    Parameters
    ----------
    payload : dict
        Full task dict as sent by the task editor (constraints, merits, target, …).
    lat, lon, elev : float
        Observatory coordinates (degrees / metres).

    Returns
    -------
    dict with keys:
        times_utc          – list of ISO strings
        twilight_evening   – ISO string
        twilight_morning   – ISO string
        constraints        – list of {name, values: [bool]}
        merits             – list of {name, values: [float]}
        combined           – list of float  (product of all passing merits, 0 if any constraint fails)
    """
    from pyobs.robotic.task import Task
    from pyobs.robotic.scheduler.constraints.constraint import Constraint
    from pyobs.robotic.scheduler.merits.merit import Merit
    from pyobs.robotic.scheduler.dataprovider import DataProvider

    observer = _make_observer(lat, lon, elev)
    now = Time.now()
    t_eve, t_morn = _next_night(observer, now)

    # ~5-minute sampling across the night
    n_steps = max(int((t_morn - t_eve).to(u.minute).value / 5), 2)
    t_grid = t_eve + np.linspace(0, 1, n_steps) * (t_morn - t_eve)

    # --- parse constraints and merits from the payload ---
    raw_constraints = payload.get("constraints") or []
    raw_merits = payload.get("merits") or []

    constraints: list[Any] = []
    constraint_names: list[str] = []
    for raw in raw_constraints:
        try:
            c = Constraint.model_validate(raw, by_alias=True)
            constraints.append(c)
            constraint_names.append(c.name)
        except Exception as exc:
            log.warning("Could not parse constraint %r: %s", raw, exc)

    merits: list[Any] = []
    merit_names: list[str] = []
    for raw in raw_merits:
        try:
            m = Merit.model_validate(raw, by_alias=True)
            merits.append(m)
            merit_names.append(m.name)
        except Exception as exc:
            log.warning("Could not parse merit %r: %s", raw, exc)

    # --- build a minimal Task and DataProvider ---
    # Strip target if it has non-numeric coords (hms/dms strings) so
    # model_validate doesn't fail; target-dependent constraints will just
    # return False / 0.0 gracefully.
    task_dict = {k: v for k, v in payload.items() if k != "target"}
    try:
        task = Task.model_validate(task_dict)
        # Attach the parsed target if present and parseable
        raw_target = payload.get("target")
        if raw_target:
            from pyobs.robotic.scheduler.targets.target import Target
            try:
                task.target = Target.model_validate(raw_target, by_alias=True)
            except Exception:
                pass
    except Exception as exc:
        log.warning("Could not build Task for merit plot: %s", exc)
        task = None

    try:
        from pyobs.robotic.scheduler.dataprovider import DataProvider
        data_provider = DataProvider(observer=observer)
    except Exception as exc:
        log.warning("Could not build DataProvider: %s", exc)
        data_provider = None

    if task is None or data_provider is None:
        return {"error": "Could not build task or data provider for evaluation."}

    # --- async evaluation ---
    async def _run() -> dict:
        return await _eval_all(constraints, merits, task, data_provider, list(t_grid))

    try:
        result = asyncio.run(_run())
    except RuntimeError:
        # Already inside a running loop (shouldn't happen under Django, but just in case)
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(asyncio.run, _run()).result()

    constraint_values = result["constraint_values"]
    merit_values = result["merit_values"]

    # --- combine: product of merits, zeroed where any constraint fails ---
    n = len(t_grid)
    combined = []
    for i in range(n):
        constraints_pass = all(constraint_values[j][i] for j in range(len(constraints)))
        if not constraints_pass:
            combined.append(0.0)
        else:
            product = 1.0
            for j in range(len(merits)):
                product *= merit_values[j][i]
                if product == 0.0:
                    break
            combined.append(round(product, 6))

    return {
        "times_utc": [t.isot for t in t_grid],
        "twilight_evening_utc": t_eve.isot,
        "twilight_morning_utc": t_morn.isot,
        "constraints": [
            {"name": name, "values": [bool(v) for v in constraint_values[j]]}
            for j, name in enumerate(constraint_names)
        ],
        "merits": [
            {"name": name, "values": [round(float(v), 6) for v in merit_values[j]]}
            for j, name in enumerate(merit_names)
        ],
        "combined": combined,
    }
