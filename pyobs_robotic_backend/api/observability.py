"""
Observability calculations for the visibility plot endpoint.

Two data products:
  - "night"  : elevation & moon-distance vs time for the next dark night
  - "year"   : elevation at middle-of-dark-time for each night over ~1 year
"""

from __future__ import annotations

import datetime
from typing import Any

import numpy as np
from astroplan import Observer, FixedTarget
from astropy.coordinates import SkyCoord
from astropy.time import Time
import astropy.units as u


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
    """Return (evening_astro_twilight, morning_astro_twilight) for the coming night."""
    # If we are already past noon use today's evening, otherwise yesterday's
    # Use next_setting of the sun below -18 deg (astronomical twilight)
    evening = observer.twilight_evening_astronomical(now, which="next")
    morning = observer.twilight_morning_astronomical(evening, which="next")
    return evening, morning


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------

def night_data(
    ra_deg: float,
    dec_deg: float,
    lat: float,
    lon: float,
    elev: float,
) -> dict[str, Any]:
    """
    Elevation and moon distance for the target over the next dark night.

    Returns a dict ready to be JSON-serialised.
    """
    observer = _make_observer(lat, lon, elev)
    target = FixedTarget(SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg))

    now = Time.now()
    t_eve, t_morn = _next_night(observer, now)

    # ~5-minute sampling
    n_steps = max(int((t_morn - t_eve).to(u.minute).value / 5), 2)
    times = t_eve + np.linspace(0, 1, n_steps) * (t_morn - t_eve)

    altaz_frame = observer.altaz(times)
    target_altaz = target.coord.transform_to(altaz_frame)
    elevation = target_altaz.alt.deg.tolist()

    # Moon distance
    from astropy.coordinates import get_body
    moon_coords = get_body("moon", times)
    moon_dist = moon_coords.separation(target.coord).deg.tolist()

    return {
        "times_utc": [t.isot for t in times],
        "elevation_deg": elevation,
        "moon_distance_deg": moon_dist,
        "twilight_evening_utc": t_eve.isot,
        "twilight_morning_utc": t_morn.isot,
    }


def year_data(
    ra_deg: float,
    dec_deg: float,
    lat: float,
    lon: float,
    elev: float,
) -> dict[str, Any]:
    """
    Elevation at the middle of dark time for each night over the next 365 days.

    Returns a dict ready to be JSON-serialised.
    """
    observer = _make_observer(lat, lon, elev)
    target = FixedTarget(SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg))

    now = Time.now()

    dates: list[str] = []
    elevations: list[float | None] = []

    # Walk through nights; start from tonight's evening
    t_cursor = observer.twilight_evening_astronomical(now, which="next")

    for _ in range(365):
        try:
            t_morn = observer.twilight_morning_astronomical(t_cursor, which="next")
            t_mid = t_cursor + (t_morn - t_cursor) * 0.5

            altaz = observer.altaz(t_mid)
            alt = float(target.coord.transform_to(altaz).alt.deg)

            dates.append(t_mid.datetime.strftime("%Y-%m-%d"))
            elevations.append(round(alt, 2))
        except Exception:
            # Polar nights / no twilight: skip gracefully
            dates.append(t_cursor.datetime.strftime("%Y-%m-%d"))
            elevations.append(None)

        # Advance ~1 day from the current evening to find next evening
        t_cursor = observer.twilight_evening_astronomical(
            t_cursor + 1.01 * u.day, which="next"
        )

    return {
        "dates": dates,
        "elevation_deg": elevations,
    }
