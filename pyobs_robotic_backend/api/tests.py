from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from pyobs.robotic.observation import ObservationState

from .models import Observation, Project, Target, Task
from .serializers import ProjectSerializer, TargetSerializer


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
