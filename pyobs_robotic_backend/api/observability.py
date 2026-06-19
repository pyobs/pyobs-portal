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

    # If the sun is already below the horizon, tonight's sunset is in the past.
    sun_alt = observer.sun_altaz(now).alt.deg
    if sun_alt < 0:
        t_sunset = observer.sun_set_time(now, which="previous")
        t_sunrise = observer.sun_rise_time(now, which="next")
    else:
        t_sunset = observer.sun_set_time(now, which="next")
        t_sunrise = observer.sun_rise_time(t_sunset, which="next")

    # ~5-minute sampling across the full sunset-to-sunrise window
    n_steps = max(int((t_sunrise - t_sunset).to(u.minute).value / 5), 2)
    times = t_sunset + np.linspace(0, 1, n_steps) * (t_sunrise - t_sunset)

    altaz_frame = observer.altaz(times)
    target_altaz = target.coord.transform_to(altaz_frame)
    elevation = target_altaz.alt.deg.tolist()

    from astropy.coordinates import get_body
    moon_coords = get_body("moon", times)
    moon_altaz = moon_coords.transform_to(altaz_frame)
    moon_elevation = moon_altaz.alt.deg.tolist()
    moon_distance = moon_coords.icrs.separation(target.coord).deg.tolist()

    return {
        "times_utc": [t.isot for t in times],
        "elevation_deg": elevation,
        "moon_elevation_deg": moon_elevation,
        "moon_distance_deg": moon_distance,
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
    Elevation at the middle of dark time sampled once per month (15th) over 12 months.

    Returns a dict ready to be JSON-serialised.
    """
    observer = _make_observer(lat, lon, elev)
    target = FixedTarget(SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg))

    year = datetime.datetime.now(datetime.timezone.utc).year

    sample_dts = [
        datetime.datetime(year, month, 15, 12, 0, 0, tzinfo=datetime.timezone.utc)
        for month in range(1, 13)
    ]
    t_samples = Time(sample_dts)

    t_eve = observer.twilight_evening_astronomical(t_samples, which="next")
    t_morn = observer.twilight_morning_astronomical(t_eve, which="next")
    t_mid = t_eve + (t_morn - t_eve) * 0.5

    alts = target.coord.transform_to(observer.altaz(t_mid)).alt.deg

    dates: list[str] = []
    elevations: list[float | None] = []
    for sample_dt, t, alt in zip(sample_dts, t_mid, alts):
        if np.isnan(alt) or np.isnan(t.jd):
            dates.append(sample_dt.strftime("%Y-%m-%d"))
            elevations.append(None)
        else:
            dates.append(t.datetime.strftime("%Y-%m-%d"))
            elevations.append(round(float(alt), 2))

    return {
        "dates": dates,
        "elevation_deg": elevations,
    }
