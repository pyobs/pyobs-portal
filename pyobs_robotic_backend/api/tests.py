import inspect
from datetime import timedelta
from unittest.mock import Mock, patch

import requests
from astropy.time import Time
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from pyobs.object import get_class_from_string
from pyobs.robotic.observation import ObservationState

from . import schema as schema_module
from .models import Observation, Project, Target, Task
from .serializers import ObservationSerializer, ProjectSerializer, TargetSerializer
from .tasks import mark_window_expired


def _results(data):
    """Unwrap DRF pagination if present."""
    return data["results"] if isinstance(data, dict) and "results" in data else data


class ProjectPublicApiTests(TestCase):
    """Access control for the Project `public` flag (issue #79)."""

    def setUp(self):
        self.admin = User.objects.create_superuser("admin", "admin@example.com", "pw")
        self.alice = User.objects.create_user("alice", "alice@example.com", "pw")
        self.bob = User.objects.create_user("bob", "bob@example.com", "pw")

        self.public_project = Project.objects.create(
            code="PUB", name="Public", public=True
        )
        self.private_project = Project.objects.create(code="PRIV", name="Private")
        self.private_project.users.add(self.alice)

        self.public_task = Task.objects.create(
            code="T1", name="t1", project=self.public_project, duration=60, priority=1.0, script={}
        )
        self.private_task = Task.objects.create(
            code="T2", name="t2", project=self.private_project, duration=60, priority=1.0, script={}
        )

    def login(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_serializer_includes_public(self):
        data = ProjectSerializer(self.public_project).data
        self.assertTrue(data["public"])
        data = ProjectSerializer(self.private_project).data
        self.assertFalse(data["public"])

    def test_project_list_resolves_access(self):
        # Non-member sees public projects only.
        res = self.login(self.bob).get("/api/projects/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual({p["code"] for p in _results(res.data)}, {"PUB"})

        # Member sees private project, plus public ones.
        res = self.login(self.alice).get("/api/projects/")
        self.assertEqual({p["code"] for p in _results(res.data)}, {"PUB", "PRIV"})

        # Superuser sees everything.
        res = self.login(self.admin).get("/api/projects/")
        self.assertEqual({p["code"] for p in _results(res.data)}, {"PUB", "PRIV"})

    def test_anonymous_gets_401(self):
        self.assertEqual(APIClient().get("/api/projects/").status_code, 401)

    def test_project_create_and_update_public_flag(self):
        # Only admins may create/update projects.
        res = self.login(self.bob).post(
            "/api/projects/", {"code": "X", "name": "X", "public": True}, format="json"
        )
        self.assertEqual(res.status_code, 403)

        res = self.login(self.admin).post(
            "/api/projects/",
            {"code": "X", "name": "X", "priority": 1.0, "public": True, "users": []},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Project.objects.get(code="X").public)

        res = self.login(self.admin).patch(
            "/api/projects/X/", {"public": False}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Project.objects.get(code="X").public)

    def test_task_list_resolves_access(self):
        res = self.login(self.bob).get("/api/tasks/")
        self.assertEqual({t["id"] for t in _results(res.data)}, {"T1"})

        res = self.login(self.alice).get("/api/tasks/")
        self.assertEqual({t["id"] for t in _results(res.data)}, {"T1", "T2"})

    def test_task_detail_resolves_access(self):
        self.assertEqual(self.login(self.bob).get("/api/tasks/T1/").status_code, 200)
        self.assertEqual(self.login(self.bob).get("/api/tasks/T2/").status_code, 404)
        self.assertEqual(self.login(self.alice).get("/api/tasks/T2/").status_code, 200)

    def test_task_list_for_project_resolves_access(self):
        res = self.login(self.bob).get("/api/projects/PUB/tasks/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual({t["id"] for t in _results(res.data)}, {"T1"})
        self.assertEqual(self.login(self.bob).get("/api/projects/PRIV/tasks/").status_code, 404)
        self.assertEqual(self.login(self.alice).get("/api/projects/PRIV/tasks/").status_code, 200)

    def test_observations_resolve_access(self):
        now = timezone.now()
        Observation.objects.create(
            task=self.public_task, start=now, end=now, state=ObservationState.PENDING
        )
        Observation.objects.create(
            task=self.private_task, start=now, end=now, state=ObservationState.PENDING
        )

        res = self.login(self.bob).get("/api/observations/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(_results(res.data)), 1)
        self.assertEqual(_results(res.data)[0]["task"], "T1")

        res = self.login(self.alice).get("/api/observations/")
        self.assertEqual({o["task"] for o in _results(res.data)}, {"T1", "T2"})

        # Per-task observation list also respects project access.
        self.assertEqual(
            self.login(self.bob).get("/api/tasks/T1/observations/").status_code, 200
        )
        self.assertEqual(
            self.login(self.bob).get("/api/tasks/T2/observations/").status_code, 404
        )


class TargetSerializerRoundTripTests(SimpleTestCase):
    """Regression tests for the class<->type mapping in TargetSerializer.

    The generic fallback used to derive `type` via lower() and reconstruct the
    class name via .capitalize(), which silently mangled multi-word CamelCase
    class names (e.g. HeliocentricPolarTarget -> "Heliocentricpolar").
    """

    def _round_trip(self, klass, fields):
        payload = {"class": klass, "name": "test", **fields}
        internal = TargetSerializer().to_internal_value(payload)
        instance = Target(name=internal["name"], type=internal["type"], coords=internal["coords"])
        representation = TargetSerializer().to_representation(instance)
        self.assertEqual(representation["class"], klass)
        for key, value in fields.items():
            self.assertEqual(representation[key], value)

    def test_sidereal_round_trip(self):
        self._round_trip(
            "pyobs.robotic.scheduler.targets.SiderealTarget",
            {"ra": 10.0, "dec": 20.0},
        )

    def test_dynamic_round_trip(self):
        payload = {
            "class": "pyobs.robotic.scheduler.targets.DynamicTarget",
            "name": "test",
            "picker": {"class": "pyobs.robotic.scheduler.targets.picker.CsvPicker", "path": "x.csv"},
        }
        internal = TargetSerializer().to_internal_value(payload)
        instance = Target(name=internal["name"], type=internal["type"], coords=internal["coords"])
        representation = TargetSerializer().to_representation(instance)
        self.assertEqual(representation["class"], payload["class"])
        self.assertEqual(representation["picker"], payload["picker"])

    def test_heliocentric_polar_round_trip(self):
        self._round_trip(
            "pyobs.robotic.scheduler.targets.HeliocentricPolarTarget",
            {"mu": 0.5, "psi": 1.2},
        )

    def test_helioprojective_round_trip(self):
        self._round_trip(
            "pyobs.robotic.scheduler.targets.HelioprojectiveTarget",
            {"tx": 100.0, "ty": -50.0},
        )


class UpdateMarkerApiTests(TestCase):
    """last_task_update / last_observation_update derive from the DB (issue #83).

    Markers must reflect every write path — including bulk `QuerySet.update()`,
    which bypasses post_save signals — and be identical across all processes, so
    they are computed from the `updated_at` columns instead of the cache.
    """

    def setUp(self):
        self.user = User.objects.create_user("marker", "marker@example.com", "pw")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _marker(self, endpoint):
        res = self.client.get(endpoint)
        self.assertEqual(res.status_code, 200)
        return res.data

    def _project_and_task(self, code="MKR", member=True):
        project = Project.objects.create(code=code, name=f"Project {code}")
        if member:
            project.users.add(self.user)
        task = Task.objects.create(
            code=f"T-{code}",
            name="t",
            project=project,
            duration=60,
            priority=1.0,
            script={},
        )
        return project, task

    def test_epoch_when_empty(self):
        self.assertEqual(
            self._marker("/api/last_task_update/")["last_task_update"],
            "1970-01-01T00:00:00.000",
        )
        self.assertEqual(
            self._marker("/api/last_observation_update/")["last_observation_update"],
            "1970-01-01T00:00:00.000",
        )

    def test_task_marker_tracks_save(self):
        _, task = self._project_and_task()
        self.assertEqual(
            self._marker("/api/last_task_update/")["last_task_update"],
            Time(task.updated_at).isot,
        )
        task.name = "renamed"
        task.save()
        self.assertEqual(
            self._marker("/api/last_task_update/")["last_task_update"],
            Time(task.updated_at).isot,
        )

    def test_observation_marker_tracks_save(self):
        _, task = self._project_and_task()
        now = timezone.now()
        observation = Observation.objects.create(
            task=task, start=now, end=now, state=ObservationState.PENDING
        )
        self.assertEqual(
            self._marker("/api/last_observation_update/")["last_observation_update"],
            Time(observation.updated_at).isot,
        )

    def test_markers_are_independent(self):
        _, task = self._project_and_task()
        task_marker = self._marker("/api/last_task_update/")["last_task_update"]
        now = timezone.now()
        observation = Observation.objects.create(
            task=task, start=now, end=now, state=ObservationState.PENDING
        )
        # Creating an observation must not move the task marker, and vice versa.
        self.assertEqual(
            self._marker("/api/last_task_update/")["last_task_update"], task_marker
        )
        self.assertEqual(
            self._marker("/api/last_observation_update/")["last_observation_update"],
            Time(observation.updated_at).isot,
        )

    def test_window_expired_bulk_update_stamps_marker(self):
        _, task = self._project_and_task()
        now = timezone.now()
        observation = Observation.objects.create(
            task=task,
            start=now - timedelta(hours=2),
            end=now - timedelta(hours=1),
            state=ObservationState.PENDING,
        )
        before = self._marker("/api/last_observation_update/")["last_observation_update"]

        mark_window_expired()

        observation.refresh_from_db()
        self.assertEqual(observation.state, ObservationState.WINDOW_EXPIRED)
        after = self._marker("/api/last_observation_update/")["last_observation_update"]
        self.assertGreaterEqual(after, before)
        self.assertEqual(after, Time(observation.updated_at).isot)

    def test_mark_window_expired_command_stamps_marker(self):
        # The management command is a second bulk-update path that must also
        # move the marker (mirrors the Celery task).
        _, task = self._project_and_task()
        now = timezone.now()
        observation = Observation.objects.create(
            task=task,
            start=now - timedelta(hours=2),
            end=now - timedelta(hours=1),
            state=ObservationState.PENDING,
        )
        before = self._marker("/api/last_observation_update/")["last_observation_update"]

        call_command("mark_window_expired")

        observation.refresh_from_db()
        self.assertEqual(observation.state, ObservationState.WINDOW_EXPIRED)
        after = self._marker("/api/last_observation_update/")["last_observation_update"]
        self.assertGreaterEqual(after, before)
        self.assertEqual(after, Time(observation.updated_at).isot)

    def test_cancel_bulk_update_stamps_marker(self):
        _, task = self._project_and_task()
        now = timezone.now()
        observation = Observation.objects.create(
            task=task, start=now, end=now + timedelta(hours=1), state=ObservationState.PENDING
        )
        before = self._marker("/api/last_observation_update/")["last_observation_update"]

        res = self.client.get(f"/api/cancel_observations/?after={Time(now - timedelta(minutes=1)).isot}")
        self.assertEqual(res.status_code, 200)

        observation.refresh_from_db()
        self.assertEqual(observation.state, ObservationState.CANCELED)
        after = self._marker("/api/last_observation_update/")["last_observation_update"]
        self.assertGreaterEqual(after, before)
        self.assertEqual(after, Time(observation.updated_at).isot)

    def test_cancel_observations_respects_project_access(self):
        # Non-members must not be able to cancel another project's pending
        # observations, and the marker must not move for them.
        _, task = self._project_and_task(code="OTH", member=False)
        now = timezone.now()
        observation = Observation.objects.create(
            task=task, start=now, end=now + timedelta(hours=1), state=ObservationState.PENDING
        )

        res = self.client.get(f"/api/cancel_observations/?after={Time(now - timedelta(minutes=1)).isot}")
        self.assertEqual(res.status_code, 200)

        observation.refresh_from_db()
        self.assertEqual(observation.state, ObservationState.PENDING)
        self.assertEqual(
            self._marker("/api/last_observation_update/")["last_observation_update"],
            "1970-01-01T00:00:00.000",
        )

    def test_markers_exclude_inaccessible_projects(self):
        # Activity in private projects the user is not a member of must not
        # leak into the update markers.
        _, task = self._project_and_task()
        task_marker = self._marker("/api/last_task_update/")["last_task_update"]
        now = timezone.now()
        observation = Observation.objects.create(
            task=task, start=now, end=now, state=ObservationState.PENDING
        )
        observation_marker = self._marker("/api/last_observation_update/")[
            "last_observation_update"
        ]

        _, hidden_task = self._project_and_task(code="OTH", member=False)
        hidden_task.name = "changed invisibly"
        hidden_task.save()
        Observation.objects.create(
            task=hidden_task,
            start=now + timedelta(minutes=1),
            end=now + timedelta(minutes=2),
            state=ObservationState.PENDING,
        )

        self.assertEqual(
            self._marker("/api/last_task_update/")["last_task_update"], task_marker
        )
        self.assertEqual(
            self._marker("/api/last_observation_update/")["last_observation_update"],
            observation_marker,
        )

    def test_markers_include_public_projects(self):
        # Public projects are visible to every authenticated user without
        # membership, so their activity must move the markers.
        public_project = Project.objects.create(code="PUB", name="Public", public=True)
        public_task = Task.objects.create(
            code="T-PUB",
            name="t",
            project=public_project,
            duration=60,
            priority=1.0,
            script={},
        )
        self.assertEqual(
            self._marker("/api/last_task_update/")["last_task_update"],
            Time(public_task.updated_at).isot,
        )


@override_settings(ARCHIVE_URL="https://archive.example.org")
class ArchiveUrlSerializerTests(TestCase):
    """`archive_url` on ObservationSerializer (issue #82)."""

    def setUp(self):
        project = Project.objects.create(code="ARC", name="Archive")
        self.task = Task.objects.create(
            code="T-ARC",
            name="t",
            project=project,
            duration=60,
            priority=1.0,
            script={},
        )

    def _observation(self, **kwargs):
        now = timezone.now()
        defaults = dict(task=self.task, start=now, end=now + timedelta(minutes=10))
        defaults.update(kwargs)
        return Observation.objects.create(**defaults)

    def test_present_for_terminal_states(self):
        for state in (
            ObservationState.COMPLETED,
            ObservationState.ABORTED,
            ObservationState.FAILED,
        ):
            obs = self._observation(state=state, obsnum="12345")
            url = ObservationSerializer(obs).data["archive_url"]
            self.assertIsNotNone(url)
            self.assertTrue(url.startswith("https://archive.example.org/?"))
            self.assertIn("OBSNUM=12345", url)

    def test_absent_for_non_terminal_states(self):
        for state in (
            ObservationState.PENDING,
            ObservationState.IN_PROGRESS,
            ObservationState.CANCELED,
            ObservationState.WINDOW_EXPIRED,
        ):
            obs = self._observation(state=state, obsnum="12345")
            self.assertIsNone(ObservationSerializer(obs).data["archive_url"])

    @override_settings(ARCHIVE_URL="")
    def test_absent_when_archive_url_unset(self):
        obs = self._observation(state=ObservationState.COMPLETED, obsnum="12345")
        self.assertIsNone(ObservationSerializer(obs).data["archive_url"])

    def test_obsnum_omitted_when_unset(self):
        obs = self._observation(state=ObservationState.COMPLETED, obsnum=None)
        url = ObservationSerializer(obs).data["archive_url"]
        self.assertIsNotNone(url)
        self.assertNotIn("OBSNUM", url)

    def test_values_url_encoded(self):
        obs = self._observation(state=ObservationState.COMPLETED, obsnum="12 345")
        url = ObservationSerializer(obs).data["archive_url"]
        self.assertIn("OBSNUM=12+345", url)


class ObservationDataStatusApiTests(TestCase):
    """GET /api/observations/<id>/frames/ - on-demand archive check (issue #82)."""

    def setUp(self):
        self.alice = User.objects.create_user("ds-alice", "ds-alice@example.com", "pw")
        self.bob = User.objects.create_user("ds-bob", "ds-bob@example.com", "pw")

        self.private_project = Project.objects.create(code="DSPRIV", name="Private")
        self.private_project.users.add(self.alice)
        self.task = Task.objects.create(
            code="T-DS",
            name="t",
            project=self.private_project,
            duration=60,
            priority=1.0,
            script={},
        )
        now = timezone.now()
        self.observation = Observation.objects.create(
            task=self.task,
            start=now,
            end=now + timedelta(minutes=10),
            state=ObservationState.COMPLETED,
            obsnum="777",
        )

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _url(self):
        return f"/api/observations/{self.observation.id}/frames/"

    def test_access_scoping_matches_observation_detail(self):
        self.assertEqual(self._client(self.bob).get(self._url()).status_code, 404)
        self.assertEqual(self._client(self.alice).get(self._url()).status_code, 200)

    @staticmethod
    def _count_response(count):
        resp = Mock(status_code=200)
        resp.json.return_value = {"count": count}
        resp.raise_for_status = Mock()
        return resp

    @override_settings(ARCHIVE_URL="https://archive.example.org", ARCHIVE_TOKEN="tok")
    @patch("pyobs_robotic_backend.api.views.requests.get")
    def test_normal_case_returns_count_and_reduced(self, mock_get):
        mock_get.side_effect = [self._count_response(5), self._count_response(2)]

        res = self._client(self.alice).get(self._url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], 5)
        self.assertTrue(res.data["reduced"])
        self.assertEqual(
            res.data["archive_url"],
            ObservationSerializer(self.observation).data["archive_url"],
        )

    @override_settings(ARCHIVE_URL="https://archive.example.org", ARCHIVE_TOKEN="tok")
    @patch("pyobs_robotic_backend.api.views.requests.get")
    def test_raw_only_reports_not_reduced(self, mock_get):
        mock_get.side_effect = [self._count_response(3), self._count_response(3)]

        res = self._client(self.alice).get(self._url())
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["reduced"])

    @override_settings(ARCHIVE_URL="https://archive.example.org", ARCHIVE_TOKEN="tok")
    @patch("pyobs_robotic_backend.api.views.requests.get")
    def test_malformed_2xx_response_reports_unavailable_not_5xx(self, mock_get):
        # A 2xx response whose body isn't the expected {"count": N} shape (misconfigured
        # ARCHIVE_URL, a proxy error page, ...) must degrade the same way a network failure
        # does, not escape as a 500.
        bad_json = Mock(status_code=200)
        bad_json.raise_for_status = Mock()
        bad_json.json.side_effect = ValueError("not JSON")

        missing_count = Mock(status_code=200)
        missing_count.raise_for_status = Mock()
        missing_count.json.return_value = {}

        for responses in (
            [bad_json, self._count_response(1)],
            [self._count_response(1), missing_count],
        ):
            with self.subTest():
                mock_get.side_effect = responses
                res = self._client(self.alice).get(self._url())
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.data["status"], "unavailable")

    @override_settings(ARCHIVE_URL="https://archive.example.org", ARCHIVE_TOKEN="tok")
    @patch("pyobs_robotic_backend.api.views.requests.get")
    def test_response_never_cached(self, mock_get):
        mock_get.side_effect = [self._count_response(5), self._count_response(2)]
        res = self._client(self.alice).get(self._url())
        self.assertEqual(res["Cache-Control"], "no-store")

    @override_settings(ARCHIVE_URL="https://archive.example.org", ARCHIVE_TOKEN="tok")
    def test_archive_failures_report_unavailable_not_5xx(self):
        for exc in (
            requests.exceptions.Timeout("timeout"),
            requests.exceptions.ConnectionError("connection refused"),
            requests.exceptions.HTTPError("500 server error"),
        ):
            with self.subTest(exc=type(exc).__name__):
                with patch(
                    "pyobs_robotic_backend.api.views.requests.get", side_effect=exc
                ):
                    res = self._client(self.alice).get(self._url())
                    self.assertEqual(res.status_code, 200)
                    self.assertEqual(res.data["status"], "unavailable")

    def test_unset_archive_config_reports_unavailable_without_request(self):
        with patch("pyobs_robotic_backend.api.views.requests.get") as mock_get:
            res = self._client(self.alice).get(self._url())
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data["status"], "unavailable")
            mock_get.assert_not_called()

    @override_settings(ARCHIVE_URL="https://archive.example.org", ARCHIVE_TOKEN="tok")
    def test_non_terminal_state_reports_unavailable_without_request(self):
        self.observation.state = ObservationState.PENDING
        self.observation.save()
        with patch("pyobs_robotic_backend.api.views.requests.get") as mock_get:
            res = self._client(self.alice).get(self._url())
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data["status"], "unavailable")
            mock_get.assert_not_called()


class ScriptTreePolymorphicTests(SimpleTestCase):
    """`x-pyobs-polymorphic` annotations for the visual script builder (issue #81).

    Nested/polymorphic script fields (script-in-script, dynamic exposure_time
    providers, flat-field pointing) carry no discriminator in their raw JSON
    schema, so the frontend can't know they should render as a "choose a
    class + nested form" control. `script_tree()` now annotates each such
    field and adds a top-level `$polymorphic` registry of candidates.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tree = schema_module.script_tree()

    def _node(self, *path):
        node = self.tree
        for key in path:
            node = node[key]
        return node

    def test_sequential_runner_scripts_marked_array_of_script(self):
        marker = self._node(
            "control", "sequential", "SequentialRunner", "schema", "properties", "scripts", "items"
        )["x-pyobs-polymorphic"]
        self.assertEqual(marker, {"base": "pyobs.robotic.scripts.script.Script", "container": "array"})

    def test_parallel_runner_scripts_marked_array_of_script(self):
        marker = self._node(
            "control", "parallel", "ParallelRunner", "schema", "properties", "scripts", "items"
        )["x-pyobs-polymorphic"]
        self.assertEqual(marker, {"base": "pyobs.robotic.scripts.script.Script", "container": "array"})

    def test_conditional_runner_true_required_false_optional(self):
        props = self._node("control", "conditional", "ConditionalRunner", "schema", "properties")
        self.assertEqual(props["true"]["x-pyobs-polymorphic"]["container"], "single")
        self.assertEqual(props["false"]["x-pyobs-polymorphic"]["container"], "optional")

    def test_cases_runner_cases_marked_map_of_script(self):
        marker = self._node(
            "control", "cases", "CasesRunner", "schema", "properties", "cases", "additionalProperties"
        )["x-pyobs-polymorphic"]
        self.assertEqual(marker, {"base": "pyobs.robotic.scripts.script.Script", "container": "map"})

    def test_instrument_config_exposure_time_marked_single_provider(self):
        for subgroup, script in (("imaging", "ImagingScript"), ("transitimaging", "TransitImagingScript")):
            marker = self._node(
                "imaging",
                subgroup,
                script,
                "schema",
                "$defs",
                "InstrumentConfig",
                "properties",
                "exposure_time",
            )["x-pyobs-polymorphic"]
            self.assertEqual(marker["container"], "single")
            self.assertTrue(marker["base"].endswith(".ExposureTimeProvider"), marker["base"])

    def test_pointing_script_pointing_marked_single_provider(self):
        marker = self._node(
            "calibration", "pointing", "PointingScript", "schema", "properties", "pointing"
        )["x-pyobs-polymorphic"]
        self.assertEqual(marker["container"], "single")
        self.assertTrue(marker["base"].endswith(".SkyFlatsBasePointing"), marker["base"])

    def test_skyflats_priorities_marked_single_provider(self):
        marker = self._node(
            "calibration", "skyflats", "SkyFlatsScript", "schema", "properties", "priorities"
        )["x-pyobs-polymorphic"]
        self.assertEqual(marker["container"], "single")
        self.assertTrue(marker["base"].endswith(".SkyflatPriorities"), marker["base"])

    def test_tree_shape_backward_compatible(self):
        # Existing consumers (YAML preview, "insert template" walk) key off
        # {group: {subgroup: {ClassName: {"class": ..., "schema": ...}}}} --
        # the new "$polymorphic" key must be additive only.
        entry = self.tree["calibration"]["darkbias"]["DarkBiasScript"]
        self.assertEqual(entry["class"], "pyobs.robotic.scripts.calibration.darkbias.DarkBiasScript")
        self.assertIn("schema", entry)
        self.assertIn("$polymorphic", self.tree)

    def test_polymorphic_registry_has_no_abstract_candidates(self):
        script_entry = self.tree["$polymorphic"]["pyobs.robotic.scripts.script.Script"]
        self.assertGreater(len(script_entry["candidates"]), 0)
        for candidate in script_entry["candidates"]:
            cls = get_class_from_string(candidate["class"])
            self.assertFalse(inspect.isabstract(cls), candidate["class"])

        # Provider candidates aren't resolved via get_class_from_string here: two of
        # the three provider bases (SkyFlatsBasePointing, SkyflatPriorities) override
        # __module__ to a path that doesn't actually exist (a pre-existing pyobs-core
        # bug, unrelated to this change -- see PR description), so their `class`
        # strings don't round-trip through get_class_from_string either. Re-scan with
        # the same mechanism _polymorphic_registry uses instead.
        for base, package in schema_module._PROVIDER_SCAN_PACKAGES.items():
            candidates = schema_module._scan_concrete_subclasses(package, base)
            self.assertGreater(len(candidates), 0, base)
            for cls in candidates:
                self.assertFalse(inspect.isabstract(cls), cls)

    def test_script_candidates_reference_tree_by_path_not_duplicated_schema(self):
        script_entry = self.tree["$polymorphic"]["pyobs.robotic.scripts.script.Script"]
        classes = {c["class"] for c in script_entry["candidates"]}
        self.assertIn("pyobs.robotic.scripts.control.sequential.SequentialRunner", classes)
        for candidate in script_entry["candidates"]:
            self.assertNotIn("schema", candidate)
            self.assertIn("path", candidate)
            resolved = self.tree
            for part in candidate["path"].split("/"):
                resolved = resolved[part]
            self.assertEqual(resolved["class"], candidate["class"])

    def test_provider_candidates_validate_against_their_base(self):
        # Validated directly against each concrete candidate class rather than
        # `base.model_validate({"class": ..., **sample})`: SkyFlatsBasePointing and
        # SkyflatPriorities candidates override __module__ to a path that doesn't
        # exist (see test_polymorphic_registry_has_no_abstract_candidates), so
        # dispatch-by-class-string is broken for them independent of this change.
        # ArchiveSkyflatPriorities.archive is itself an unannotated polymorphic
        # field (onto `Archive`, out of this PR's scope) -- skipped here.
        samples = {
            "StellarExposureTimeProvider": {"camera": "cam1"},
            "SkyFlatsStaticPointing": {},
            "ConstSkyflatPriorities": {"priorities": {}},
        }
        skipped = {"ArchiveSkyflatPriorities"}
        seen = set()
        for base, package in schema_module._PROVIDER_SCAN_PACKAGES.items():
            for cls in schema_module._scan_concrete_subclasses(package, base):
                if cls.__name__ in skipped:
                    continue
                seen.add(cls.__name__)
                sample = samples.get(cls.__name__)
                self.assertIsNotNone(sample, f"no sample registered for {cls.__name__}")
                cls.model_validate(sample)
        # >= rather than ==: a new pyobs-core release adding another provider
        # subclass should fail loudly above (assertIsNotNone) with an
        # actionable message, not via a silent set-mismatch here.
        self.assertGreaterEqual(seen, set(samples))


class ValidateScriptClasslessTests(SimpleTestCase):
    """`validate_script/` must reject class-less/unknown-class payloads (issue #81).

    `Script.model_validate({})` succeeds today by silently falling back to the
    abstract `Script` base (whose `run()` raises `NotImplementedError`), so
    without this tightening the editor status bar would show "valid" for a
    script that can never actually execute.
    """

    def test_empty_dict_is_invalid(self):
        result = schema_module.validate_script({})
        self.assertFalse(result["valid"])
        self.assertEqual(result["error"], "no script class selected")

    def test_unknown_class_is_invalid_with_clean_message(self):
        result = schema_module.validate_script({"class": "totally.bogus.Class"})
        self.assertFalse(result["valid"])
        self.assertEqual(result["error"], "unknown script class 'totally.bogus.Class'")
        self.assertNotIn("No module named", result["error"])

    def test_nested_classless_child_is_invalid(self):
        result = schema_module.validate_script(
            {
                "class": "pyobs.robotic.scripts.control.sequential.SequentialRunner",
                "scripts": [{"class": "pyobs.robotic.scripts.utils.log.LogScript", "expression": "1"}, {}],
            }
        )
        self.assertFalse(result["valid"])
        self.assertEqual(result["error"], "no script class selected")

    def test_valid_nested_script_is_still_valid(self):
        result = schema_module.validate_script(
            {
                "class": "pyobs.robotic.scripts.control.sequential.SequentialRunner",
                "scripts": [{"class": "pyobs.robotic.scripts.utils.log.LogScript", "expression": "1"}],
            }
        )
        self.assertEqual(result, {"valid": True})

    def test_cases_runner_map_entries_require_class(self):
        result = schema_module.validate_script(
            {
                "class": "pyobs.robotic.scripts.control.cases.CasesRunner",
                "expression": "1",
                "cases": {"a": {"class": "pyobs.robotic.scripts.utils.log.LogScript", "expression": "1"}, "b": {}},
            }
        )
        self.assertFalse(result["valid"])
        self.assertEqual(result["error"], "no script class selected")

    def test_non_script_class_at_top_level_is_unknown(self):
        result = schema_module.validate_script({"class": "pyobs.robotic.scheduler.targets.SiderealTarget"})
        self.assertFalse(result["valid"])
        self.assertIn("unknown script class", result["error"])

    def test_malformed_scripts_field_does_not_crash_the_classless_check(self):
        # `scripts` is supposed to be a list of script dicts; a hand-edited/
        # malformed payload could send anything. The classless pre-check must
        # not raise -- pydantic's own validation reports the real error.
        result = schema_module.validate_script(
            {
                "class": "pyobs.robotic.scripts.control.sequential.SequentialRunner",
                "scripts": "not-a-list",
            }
        )
        self.assertFalse(result["valid"])

    def test_base_script_class_itself_is_rejected(self):
        # The abstract `Script` base validates fine on its own (it isn't
        # abstract in the Python sense -- pydantic doesn't stop it), but its
        # run() raises NotImplementedError. Selecting it directly must be
        # rejected the same as a class-less node, both at top level and nested.
        top_level = schema_module.validate_script({"class": "pyobs.robotic.scripts.script.Script"})
        self.assertFalse(top_level["valid"])

        nested = schema_module.validate_script(
            {
                "class": "pyobs.robotic.scripts.control.sequential.SequentialRunner",
                "scripts": [{"class": "pyobs.robotic.scripts.script.Script"}],
            }
        )
        self.assertFalse(nested["valid"])

    def test_unknown_nested_provider_class_is_attributed_correctly(self):
        # A bogus class nested under a *provider*-typed field (exposure_time)
        # must be reported as itself unknown, not blamed on the outer script.
        result = schema_module.validate_script(
            {
                "class": "pyobs.robotic.scripts.imaging.imaging.ImagingScript",
                "camera": "cam1",
                "configuration": {
                    "instrument_configs": [{"exposure_time": {"class": "totally.bogus.Provider"}}]
                },
            }
        )
        self.assertFalse(result["valid"])
        self.assertEqual(result["error"], "unknown class 'totally.bogus.Provider'")
