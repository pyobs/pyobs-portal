"""Link observations to their data in pyobs-archive (issue #82).

archive_url() builds a deep link into the archive's own frontend from ARCHIVE_URL + obsnum +
start/end - pure string formatting, no archive call, safe on every list row. The on-demand
frame-count/reduction check (ObservationDataStatus in views.py) needs a real archive call and
uses archive_query_params() to build the same OBSNUM/start/end filter for pyobs-archive's
frames_view API.
"""

from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings

from pyobs.robotic.observation import ObservationState

# Terminal states that may actually have archived data attached.
ARCHIVE_LINKABLE_STATES = {
    ObservationState.COMPLETED,
    ObservationState.ABORTED,
    ObservationState.FAILED,
}

# OBSNUM is a per-night counter in both services, so it can collide across nights - always
# combine it with a DATE_OBS window padded around the observation's recorded start/end to cover
# clock skew and any slack between that and the camera's actual exposure timestamps.
_WINDOW_PAD = timedelta(minutes=5)


def archive_query_params(obsnum, start, end):
    """Query params identifying an observation's frames in pyobs-archive."""
    params = {
        "start": (start - _WINDOW_PAD).isoformat(),
        "end": (end + _WINDOW_PAD).isoformat(),
    }
    if obsnum:
        params["OBSNUM"] = obsnum
    return params


def archive_url(observation):
    """Deep link into the archive's own frontend for this observation's frames.

    None when ARCHIVE_URL is unset or the observation isn't in a terminal-with-data state.
    """
    base = getattr(settings, "ARCHIVE_URL", "")
    if not base or observation.state not in ARCHIVE_LINKABLE_STATES:
        return None
    params = archive_query_params(
        observation.obsnum, observation.start, observation.end
    )
    return f"{base.rstrip('/')}/?{urlencode(params)}"
