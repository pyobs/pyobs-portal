"""Restricted users (issue #198)."""

import importlib
import logging

import astropy.units as u
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, User
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

import pyobs.robotic.scheduler.constraints as constraints_module
import pyobs.robotic.scheduler.merits as merits_module
from pyobs.robotic.scheduler.constraints import Constraint as CoreConstraint
from pyobs.robotic.scheduler.merits import Merit as CoreMerit
from pyobs.utils.time import Time

from pyobs_portal.authentication.keycloak import resolve_user

from . import restrictions
from .checks import check_restricted_constraints
from .models import Constraint, Merit, Project, Target, Task
from .schema import _subclasses

C = "pyobs.robotic.scheduler.constraints."
M = "pyobs.robotic.scheduler.merits."

GLOBALS = [
    {"class": C + "MoonSeparationConstraint", "min_distance": 30},
    {"class": C + "SolarElevationConstraint", "min_elevation": -90, "max_elevation": -18},
    {"class": C + "AirmassConstraint", "max_airmass": 2.0},
]
RESTRICTED = dict(RESTRICTIONS_ENABLED=True, RESTRICTED_CONSTRAINTS=GLOBALS, RESTRICTED_MAX_PRIORITY=1.0)


def ok_constraints():
    return [dict(c) for c in GLOBALS]


class CoreMetadataTests(SimpleTestCase):
    def test_globals_have_stricter_fields(self):
        for typ, model in restrictions.parse_constraint(GLOBALS[0]), restrictions.parse_constraint(GLOBALS[2]):
            self.assertTrue(model.stricter_fields(), typ)

    def test_merit_defaults(self):
        classes = _subclasses(merits_module, CoreMerit)
        allowed = {name for name, cls in classes.items() if restrictions.merit_allowed_by_default(cls)}
        self.assertNotIn("RandomMerit", allowed)
        self.assertIn("ConstantMerit", allowed)
        self.assertIn("PerNightMerit", allowed)
        self.assertTrue(set(_subclasses(constraints_module, CoreConstraint)))

    def test_api_and_stored_forms_parse_alike(self):
        a = restrictions.parse_constraint({"class": C + "AirmassConstraint", "max_airmass": 1.5})
        b = restrictions.parse_constraint({"type": "AirmassConstraint", "params": {"max_airmass": 1.5}})
        self.assertEqual(a, b)


@override_settings(**RESTRICTED)
class ConstraintCheckTests(SimpleTestCase):
    def check(self, constraints):
        return restrictions.check_constraints(constraints)

    def test_equal_to_globals_passes(self):
        self.assertEqual(self.check(ok_constraints()), [])

    def test_tighter_passes(self):
        c = ok_constraints()
        c[0]["min_distance"] = 45
        c[1]["max_elevation"] = -20
        c[1]["min_elevation"] = -60
        c[2]["max_airmass"] = 1.5
        self.assertEqual(self.check(c), [])

    def test_looser_fails(self):
        c = ok_constraints()
        c[2]["max_airmass"] = 2.5
        errors = self.check(c)
        self.assertEqual(len(errors), 1)
        self.assertIn("AirmassConstraint.max_airmass=2.5 is looser", errors[0])
        self.assertIn("<= 2", errors[0])

    def test_min_rule(self):
        c = ok_constraints()
        c[0]["min_distance"] = 10
        self.assertIn("must be >= 30", self.check(c)[0])

    def test_missing_global_fails(self):
        errors = self.check(ok_constraints()[:2])
        self.assertEqual(len(errors), 1)
        self.assertIn("Missing required constraint AirmassConstraint (max_airmass <= 2)", errors[0])

    def test_omitted_field_takes_class_default(self):
        # SolarElevationConstraint.max_elevation defaults to -18, equal to the global.
        c = ok_constraints()
        c[1] = {"class": C + "SolarElevationConstraint"}
        self.assertEqual(self.check(c), [])

    def test_one_strict_instance_covers_a_looser_extra(self):
        c = ok_constraints() + [{"class": C + "AirmassConstraint", "max_airmass": 3.0}]
        self.assertEqual(self.check(c), [])

    def test_extra_known_types_allowed(self):
        now = Time.now()
        c = ok_constraints() + [
            {"class": C + "MoonIlluminationConstraint", "max_phase": 0.5},
            {"class": C + "TimeConstraint", "start": now.isot, "end": (now + 1 * u.day).isot},
            {"class": C + "TimeOfDayConstraint", "windows": [{"start": "20:00", "end": "23:00"}]},
        ]
        self.assertEqual(self.check(c), [])

    def test_unknown_type_fails(self):
        errors = self.check(ok_constraints() + [{"class": C + "NoSuchConstraint"}])
        self.assertEqual(len(errors), 1)
        self.assertIn("Invalid constraint", errors[0])

    def test_typo_in_field_fails(self):
        errors = self.check(ok_constraints() + [{"class": C + "AirmassConstraint", "max_airmas": 1.0}])
        self.assertEqual(len(errors), 1)

    def test_direction_is_gone(self):
        c = ok_constraints()
        c[1]["direction"] = "both"
        self.assertTrue(self.check(c))

    def test_time_constraint_global(self):
        start = Time("2030-01-01T00:00:00")
        end = Time("2030-02-01T00:00:00")
        glob = [{"class": C + "TimeConstraint", "start": start.isot, "end": end.isot}]
        with override_settings(RESTRICTED_CONSTRAINTS=glob):
            inside = [{"class": C + "TimeConstraint", "start": (start + 1 * u.day).isot, "end": (end - 1 * u.day).isot}]
            self.assertEqual(self.check(inside), [])
            outside = [{"class": C + "TimeConstraint", "start": (start - 1 * u.day).isot, "end": end.isot}]
            self.assertIn("TimeConstraint.start", self.check(outside)[0])

    def test_two_globals_of_same_type(self):
        glob = [
            {"class": C + "AirmassConstraint", "max_airmass": 2.0},
            {"class": C + "AirmassConstraint", "max_airmass": 1.5},
        ]
        with override_settings(RESTRICTED_CONSTRAINTS=glob):
            self.assertEqual(self.check([{"class": C + "AirmassConstraint", "max_airmass": 1.5}]), [])
            self.assertEqual(len(self.check([{"class": C + "AirmassConstraint", "max_airmass": 1.8}])), 1)


class MeritCheckTests(SimpleTestCase):
    def test_constant_merit_bounded(self):
        self.assertEqual(restrictions.check_merits([{"class": M + "ConstantMerit", "merit": 1.0}]), [])
        self.assertEqual(restrictions.check_merits([{"class": M + "ConstantMerit", "merit": 0.5}]), [])
        errors = restrictions.check_merits([{"class": M + "ConstantMerit", "merit": 5}])
        self.assertIn("ConstantMerit can raise the task's merit by a factor of up to 5 (must be <= 1)", errors[0])

    def test_random_merit_forbidden(self):
        errors = restrictions.check_merits([{"class": M + "RandomMerit"}])
        self.assertIn("RandomMerit can raise", errors[0])
        self.assertEqual(restrictions.check_merits([{"class": M + "RandomMerit", "std": 0}]), [])

    def test_free_merits(self):
        merits = [{"class": M + "PerNightMerit", "count": 1}, {"class": M + "IntervalMerit", "interval": 3600}]
        self.assertEqual(restrictions.check_merits(merits), [])

    def test_unknown_merit(self):
        self.assertEqual(len(restrictions.check_merits([{"class": M + "NoSuchMerit"}])), 1)


class SystemCheckTests(SimpleTestCase):
    def ids(self, globals_):
        with override_settings(RESTRICTIONS_ENABLED=True, RESTRICTED_CONSTRAINTS=globals_):
            return [m.id for m in check_restricted_constraints()]

    def test_valid_globals(self):
        self.assertEqual(self.ids(GLOBALS), [])

    def test_disabled(self):
        with override_settings(RESTRICTIONS_ENABLED=False, RESTRICTED_CONSTRAINTS=[{"class": "x.Nope"}]):
            self.assertEqual(check_restricted_constraints(), [])

    def test_unparsable(self):
        self.assertEqual(self.ids([{"class": C + "AirmassConstraint", "max_airmas": 2}]), ["api.E001"])

    def test_no_rule(self):
        self.assertEqual(self.ids([{"class": C + "TimeOfDayConstraint"}]), ["api.E002"])

    def test_time_constraint_without_start_end(self):
        self.assertEqual(self.ids([{"class": C + "TimeConstraint"}]), ["api.E003"])

    def test_time_constraint_expired(self):
        glob = [{"class": C + "TimeConstraint", "start": "2020-01-01T00:00:00", "end": "2020-02-01T00:00:00"}]
        self.assertEqual(self.ids(glob), ["api.W001"])


class SettingsFallbackTests(SimpleTestCase):
    def test_falls_back_to_default_constraints(self):
        import os
        from unittest.mock import patch

        import pyobs_portal.settings as settings_module

        env = {"DEFAULT_CONSTRAINTS": '[{"class": "x.AirmassConstraint"}]'}
        with patch.dict(os.environ, env):
            os.environ.pop("RESTRICTED_CONSTRAINTS", None)
            reloaded = importlib.reload(settings_module)
            try:
                self.assertEqual(reloaded.RESTRICTED_CONSTRAINTS, reloaded.DEFAULT_CONSTRAINTS)
            finally:
                importlib.reload(settings_module)


class IsRestrictedTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("u", "u@example.com", "pw")
        self.admin = User.objects.create_superuser("a", "a@example.com", "pw")

    def fresh(self, user):
        return User.objects.get(pk=user.pk)

    @override_settings(RESTRICTIONS_ENABLED=False)
    def test_disabled(self):
        self.assertFalse(restrictions.is_restricted(self.fresh(self.user)))

    @override_settings(RESTRICTIONS_ENABLED=True)
    def test_default_restricted(self):
        self.assertTrue(restrictions.is_restricted(self.fresh(self.user)))

    @override_settings(RESTRICTIONS_ENABLED=True)
    def test_superuser(self):
        self.assertFalse(restrictions.is_restricted(self.fresh(self.admin)))

    @override_settings(RESTRICTIONS_ENABLED=True)
    def test_unrestricted_group(self):
        self.user.groups.add(Group.objects.get(name=restrictions.UNRESTRICTED_GROUP))
        self.assertFalse(restrictions.is_restricted(self.fresh(self.user)))


class KeycloakGroupSyncTests(TestCase):
    GROUP = "/pyobs-portal-test-unrestricted"

    def in_group(self, user):
        return user.groups.filter(name=restrictions.UNRESTRICTED_GROUP).exists()

    @override_settings(KEYCLOAK_UNRESTRICTED_GROUP=GROUP)
    def test_added_and_removed(self):
        user = resolve_user({"sub": "s1", "email": "s1@example.org", "groups": ["/x", self.GROUP]})
        self.assertTrue(self.in_group(user))
        user = resolve_user({"sub": "s1", "email": "s1@example.org", "groups": ["/x"]})
        self.assertFalse(self.in_group(user))

    @override_settings(KEYCLOAK_UNRESTRICTED_GROUP=GROUP)
    def test_subgroup_path_does_not_match(self):
        user = resolve_user({"sub": "s2", "email": "s2@example.org", "groups": [self.GROUP + "/child"]})
        self.assertFalse(self.in_group(user))

    @override_settings(KEYCLOAK_UNRESTRICTED_GROUP="")
    def test_not_configured_leaves_membership(self):
        user = resolve_user({"sub": "s3", "email": "s3@example.org", "groups": []})
        user.groups.add(Group.objects.get(name=restrictions.UNRESTRICTED_GROUP))
        user = resolve_user({"sub": "s3", "email": "s3@example.org", "groups": []})
        self.assertTrue(self.in_group(user))


@override_settings(**RESTRICTED)
class RestrictedApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("r", "r@example.com", "pw")
        self.free = User.objects.create_user("f", "f@example.com", "pw")
        self.free.groups.add(Group.objects.get(name=restrictions.UNRESTRICTED_GROUP))
        self.project = Project.objects.create(code="P", name="P")
        self.project.users.add(self.user, self.free)
        # A stored task that breaks the rules (no constraints at all).
        self.bad = Task.objects.create(code="BAD", name="b", project=self.project, duration=60, priority=1.0, script={})
        Target.objects.create(task=self.bad, name="X", type="sidereal", coords={"ra": 1.0, "dec": 2.0})

    def login(self, user):
        client = APIClient()
        client.force_authenticate(user=User.objects.get(pk=user.pk))
        return client

    def body(self, code="NEW", **kwargs):
        data = {
            "id": code,
            "name": "n",
            "project": "P",
            "duration": 60,
            "priority": 1.0,
            "script": {},
            "constraints": ok_constraints(),
            "merits": [],
            "target": {"class": "pyobs.robotic.scheduler.targets.SiderealTarget", "name": "X", "ra": 1.0, "dec": 2.0},
        }
        data.update(kwargs)
        return data

    def post(self, user, data):
        return self.login(user).post("/api/projects/P/tasks/", data, format="json")

    def test_valid_task_created(self):
        res = self.post(self.user, self.body())
        self.assertEqual(res.status_code, 201, res.content)

    def test_looser_constraint_rejected(self):
        c = ok_constraints()
        c[2]["max_airmass"] = 3.0
        res = self.post(self.user, self.body(constraints=c))
        self.assertEqual(res.status_code, 400)
        self.assertIn("constraints", res.json())

    def test_missing_target_rejected(self):
        res = self.post(self.user, self.body(target=None))
        self.assertEqual(res.status_code, 400)
        self.assertIn("target", res.json())

    def test_priority_capped(self):
        res = self.post(self.user, self.body(priority=2.0))
        self.assertEqual(res.status_code, 400)
        self.assertIn("priority", res.json())

    def test_forbidden_merit_rejected(self):
        res = self.post(self.user, self.body(merits=[{"class": M + "RandomMerit"}]))
        self.assertEqual(res.status_code, 400)
        self.assertIn("merits", res.json())

    def test_missing_class_is_400(self):
        res = self.post(self.user, self.body(merits=[{"merit": 1.0}]))
        self.assertEqual(res.status_code, 400)

    def test_unrestricted_user_may_loosen(self):
        c = ok_constraints()
        c[2]["max_airmass"] = 3.0
        res = self.post(self.free, self.body(constraints=c, priority=5.0, target=None))
        self.assertEqual(res.status_code, 201, res.content)

    def test_patch_uses_stored_rows(self):
        # Stored task has no constraints, so a PATCH of the name is checked against that.
        res = self.login(self.user).patch("/api/tasks/BAD/", {"name": "x"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("constraints", res.json())

    def test_patch_constraints_only(self):
        res = self.login(self.user).patch("/api/tasks/BAD/", {"constraints": ok_constraints()}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(Target.objects.filter(task=self.bad).exists())

    def test_deactivating_rule_breaking_task_allowed(self):
        res = self.login(self.user).patch("/api/tasks/BAD/", {"active": False}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = self.login(self.user).patch("/api/tasks/BAD/", {"active": True}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_unrestricted_save_of_same_task(self):
        res = self.login(self.free).patch("/api/tasks/BAD/", {"name": "x"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_site_and_me(self):
        site = self.login(self.user).get("/api/site/").json()
        self.assertEqual(len(site["restrictions"]["global_constraints"]), 3)
        self.assertEqual(site["restrictions"]["max_priority"], 1.0)
        self.assertEqual(site["restrictions"]["max_merit"], 1.0)
        self.assertTrue(self.login(self.user).get("/api/me/").json()["restricted"])
        self.assertIsNone(self.login(self.free).get("/api/site/").json()["restrictions"])
        self.assertFalse(self.login(self.free).get("/api/me/").json()["restricted"])

    def test_schema_carries_stricter_metadata(self):
        schemas = self.login(self.user).get("/api/schema/constraints/").json()
        self.assertEqual(schemas["AirmassConstraint"]["properties"]["max_airmass"]["x-pyobs-stricter"], "lower")
        self.assertIn("TimeOfDayConstraint", schemas)

    def test_schema_endpoints_filtered(self):
        merits = self.login(self.user).get("/api/schema/merits/").json()
        self.assertNotIn("RandomMerit", merits)
        self.assertIn("ConstantMerit", merits)
        self.assertIn("RandomMerit", self.login(self.free).get("/api/schema/merits/").json())

    @override_settings(SITE_LATITUDE=51.5, SITE_LONGITUDE=9.9)
    def test_merit_plot_rejects(self):
        res = self.login(self.user).post("/api/merit_plot/", self.body(constraints=[]), format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("constraints", res.json())


class StripDirectionMigrationTests(TestCase):
    def test_strips_and_logs(self):
        project = Project.objects.create(code="M", name="M")
        task = Task.objects.create(code="T", name="t", project=project, duration=60, priority=1.0, script={})
        both = Constraint.objects.create(
            task=task, type="SolarElevationConstraint", params={"max_elevation": -18, "direction": "both"}
        )
        rising = Constraint.objects.create(
            task=task, type="SolarElevationConstraint", params={"max_elevation": -12, "direction": "rising"}
        )
        other = Merit.objects.create(task=task, type="ConstantMerit", params={"merit": 1.0})

        module = importlib.import_module("pyobs_portal.api.migrations.0013_strip_solar_elevation_direction")
        with self.assertLogs(module.log, logging.WARNING) as logs:
            module.strip_direction(django_apps, None)

        both.refresh_from_db()
        rising.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(both.params, {"max_elevation": -18})
        self.assertEqual(rising.params, {"max_elevation": -12})
        self.assertEqual(other.params, {"merit": 1.0})
        self.assertEqual(len(logs.records), 1)
        self.assertIn("rising", logs.output[0])
