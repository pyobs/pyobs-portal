from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from .cache import get_instrument_capabilities
from .models import (
    BinningOption,
    CameraCapability,
    DomeCapability,
    Filter,
    FilterWheelCapability,
    Instrument,
    RoofCapability,
    TelescopeCapability,
)


class ModelTests(TestCase):
    def setUp(self):
        self.instrument = Instrument.objects.create()
        self.camera = CameraCapability.objects.create(
            instrument=self.instrument, module_name="camera1", code="ef01"
        )

    def test_binning_option_unique_together(self):
        BinningOption.objects.create(camera=self.camera, x=1, y=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            BinningOption.objects.create(camera=self.camera, x=1, y=1)

    def test_filter_unique_together_per_wheel(self):
        wheel = FilterWheelCapability.objects.create(
            camera=self.camera, module_name="wheel1"
        )
        Filter.objects.create(filter_wheel=wheel, name="R")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Filter.objects.create(filter_wheel=wheel, name="R")

    def test_camera_code_globally_unique(self):
        other_instrument = Instrument.objects.create()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CameraCapability.objects.create(
                instrument=other_instrument, module_name="camera2", code="ef01"
            )

    def test_filter_wheel_module_name_globally_unique(self):
        # module_name is required (not nullable) -- a wheel with filter selection exposed
        # through the camera's own module should be entered with the camera's module_name,
        # never left blank: a blank value would make the row permanently unreachable by any
        # script/scheduler lookup (pyobs-core's InstrumentCapabilities indexes by module_name).
        FilterWheelCapability.objects.create(camera=self.camera, module_name="wheel1")
        with self.assertRaises(IntegrityError), transaction.atomic():
            FilterWheelCapability.objects.create(
                camera=self.camera, module_name="wheel1"
            )

    def test_deleting_instrument_cascades_to_capability_rows(self):
        BinningOption.objects.create(camera=self.camera, x=1, y=1)
        TelescopeCapability.objects.create(instrument=self.instrument)
        DomeCapability.objects.create(instrument=self.instrument)
        self.instrument.delete()
        self.assertEqual(CameraCapability.objects.count(), 0)
        self.assertEqual(BinningOption.objects.count(), 0)
        self.assertEqual(TelescopeCapability.objects.count(), 0)
        self.assertEqual(DomeCapability.objects.count(), 0)

    def test_deleting_instrument_cascades_to_roof(self):
        RoofCapability.objects.create(instrument=self.instrument)
        self.instrument.delete()
        self.assertEqual(RoofCapability.objects.count(), 0)

    def test_deleting_camera_only_removes_its_own_children(self):
        BinningOption.objects.create(camera=self.camera, x=1, y=1)
        other_camera = CameraCapability.objects.create(
            instrument=self.instrument, module_name="camera2", code="ef02"
        )
        BinningOption.objects.create(camera=other_camera, x=2, y=2)

        self.camera.delete()

        self.assertEqual(BinningOption.objects.count(), 1)
        self.assertEqual(BinningOption.objects.first().camera, other_camera)
        # sibling instrument row and camera survive
        self.assertTrue(Instrument.objects.filter(pk=self.instrument.pk).exists())
        self.assertTrue(CameraCapability.objects.filter(pk=other_camera.pk).exists())


class InstrumentConfigGroupMigrationTests(TestCase):
    """Covers migrations 0002 and 0007 (run automatically before every test's transaction)."""

    def test_group_created_with_expected_permissions(self):
        group = Group.objects.get(name="instrument-config")
        codenames = {p.codename for p in group.permissions.all()}

        self.assertEqual(
            codenames,
            {
                "add_instrument",
                "change_instrument",
                "add_cameracapability",
                "change_cameracapability",
                "delete_cameracapability",
                "add_binningoption",
                "change_binningoption",
                "delete_binningoption",
                "add_filterwheelcapability",
                "change_filterwheelcapability",
                "delete_filterwheelcapability",
                "add_filter",
                "change_filter",
                "delete_filter",
                "add_telescopecapability",
                "change_telescopecapability",
                "delete_telescopecapability",
                "add_domecapability",
                "change_domecapability",
                "delete_domecapability",
                "add_roofcapability",
                "change_roofcapability",
                "delete_roofcapability",
            },
        )

    def test_get_or_create_does_not_duplicate_group(self):
        # simulate a redeploy re-running the data migration function directly
        from django.apps import apps as django_apps

        module = __import__(
            "pyobs_portal.instruments.migrations.0002_instrument_config_group",
            fromlist=["create_group"],
        )
        module.create_group(django_apps, None)
        self.assertEqual(Group.objects.filter(name="instrument-config").count(), 1)

    def test_roof_permissions_migration_does_not_duplicate(self):
        # simulate a redeploy re-running the 0007 data migration function directly
        from django.apps import apps as django_apps

        module = __import__(
            "pyobs_portal.instruments.migrations.0007_roofcapability_permissions",
            fromlist=["add_roof_permissions"],
        )
        module.add_roof_permissions(django_apps, None)
        group = Group.objects.get(name="instrument-config")
        codenames = [
            p.codename
            for p in group.permissions.filter(content_type__model="roofcapability")
        ]
        self.assertEqual(sorted(codenames), sorted(set(codenames)))


class InstrumentApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="scriptbuilder", password="pw")
        self.instrument = Instrument.objects.create(display_name="Main Camera")
        self.camera = CameraCapability.objects.create(
            instrument=self.instrument,
            module_name="camera1",
            code="ef01",
            model="FLI ProLine PL23042",
            sensor_type="e2v CCD230-42, back-illuminated CCD",
            pixel_size_um=5.4,
        )
        self.wheel = FilterWheelCapability.objects.create(
            camera=self.camera,
            module_name="wheel1",
            model="FLI CFW-2-7",
            filter_change_time_s=3.5,
        )
        Filter.objects.create(filter_wheel=self.wheel, name="R", position=1)

    def test_list_requires_auth(self):
        response = self.client.get("/api/instruments/")
        self.assertEqual(response.status_code, 401)

    def test_list_does_not_n_plus_one(self):
        # a second, fully-populated instrument, so a per-row query would actually show up
        other_instrument = Instrument.objects.create()
        other_camera = CameraCapability.objects.create(
            instrument=other_instrument, module_name="camera2", code="ef02"
        )
        BinningOption.objects.create(camera=other_camera, x=2, y=2)
        other_wheel = FilterWheelCapability.objects.create(
            camera=other_camera, module_name="wheel2"
        )
        Filter.objects.create(filter_wheel=other_wheel, name="V")
        TelescopeCapability.objects.create(instrument=other_instrument)
        DomeCapability.objects.create(instrument=other_instrument)
        RoofCapability.objects.create(instrument=other_instrument, module_name="roof1")

        self.client.force_authenticate(self.user)
        with self.assertNumQueries(6):
            response = self.client.get("/api/instruments/")
        self.assertEqual(response.status_code, 200)

    def test_list_and_nested_shape(self):
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/")
        self.assertEqual(response.status_code, 200)
        data = response.json()["results"]
        self.assertEqual(len(data), 1)
        instrument_data = data[0]
        self.assertIsNone(instrument_data["telescope"])
        self.assertIsNone(instrument_data["dome"])
        self.assertIsNone(instrument_data["roof"])
        camera_data = instrument_data["cameras"][0]
        self.assertEqual(camera_data["module_name"], "camera1")
        self.assertEqual(camera_data["code"], "ef01")
        self.assertEqual(camera_data["model"], "FLI ProLine PL23042")
        self.assertEqual(
            camera_data["sensor_type"], "e2v CCD230-42, back-illuminated CCD"
        )
        self.assertEqual(camera_data["filter_wheels"][0]["module_name"], "wheel1")
        self.assertEqual(camera_data["filter_wheels"][0]["model"], "FLI CFW-2-7")
        self.assertEqual(camera_data["filter_wheels"][0]["filters"][0]["name"], "R")

    def test_list_includes_roof_when_present(self):
        RoofCapability.objects.create(
            instrument=self.instrument, module_name="roof1", open_close_time_s=45.0
        )
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/")
        data = response.json()["results"][0]
        self.assertEqual(data["roof"]["module_name"], "roof1")
        self.assertEqual(data["roof"]["open_close_time_s"], 45.0)

    def test_instrument_detail_route_removed(self):
        # InstrumentDetail (GET /api/instruments/<module_name>/) was dropped in #139/#140 --
        # Instrument no longer has a module_name to look up by. Regression guard against
        # accidentally resurrecting the route.
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/camera1/")
        self.assertEqual(response.status_code, 404)

    def test_camera_lookup_by_code(self):
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/cameras/ef01/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["code"], "ef01")
        self.assertEqual(data["module_name"], "camera1")


class LastInstrumentUpdateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="scriptbuilder", password="pw")

    def test_requires_auth(self):
        response = self.client.get("/api/instruments/last_instrument_update/")
        self.assertEqual(response.status_code, 401)

    def test_epoch_fallback_with_zero_rows(self):
        # Time-parseable, not None -- PortalTaskArchive.last_update_time() unconditionally does
        # Time(res[...]) with no None-check, matching last_task_update/last_observation_update.
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/last_instrument_update/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["last_instrument_update"], "1970-01-01T00:00:00.000"
        )

    def test_moves_on_instrument_edit(self):
        self.client.force_authenticate(self.user)
        instrument = Instrument.objects.create(display_name="A")
        first = self.client.get("/api/instruments/last_instrument_update/").json()[
            "last_instrument_update"
        ]

        instrument.display_name = "B"
        instrument.save()
        second = self.client.get("/api/instruments/last_instrument_update/").json()[
            "last_instrument_update"
        ]

        self.assertGreater(second, first)

    def test_moves_on_deeply_nested_filter_edit(self):
        # regression guard: a Filter three levels down (Instrument -> CameraCapability ->
        # FilterWheelCapability -> Filter) doesn't bubble up to Instrument.updated_at at all --
        # the marker has to Max() over all eight models, not just Instrument, or this edit would
        # never move it.
        self.client.force_authenticate(self.user)
        instrument = Instrument.objects.create()
        camera = CameraCapability.objects.create(
            instrument=instrument, module_name="cam1", code="ef01"
        )
        wheel = FilterWheelCapability.objects.create(
            camera=camera, module_name="wheel1"
        )
        filter_row = Filter.objects.create(filter_wheel=wheel, name="R")
        first = self.client.get("/api/instruments/last_instrument_update/").json()[
            "last_instrument_update"
        ]

        filter_row.name = "V"
        filter_row.save()
        second = self.client.get("/api/instruments/last_instrument_update/").json()[
            "last_instrument_update"
        ]

        self.assertGreater(second, first)

    def test_moves_on_roof_edit(self):
        self.client.force_authenticate(self.user)
        instrument = Instrument.objects.create()
        roof = RoofCapability.objects.create(instrument=instrument, module_name="roof1")
        first = self.client.get("/api/instruments/last_instrument_update/").json()[
            "last_instrument_update"
        ]

        roof.open_close_time_s = 45.0
        roof.save()
        second = self.client.get("/api/instruments/last_instrument_update/").json()[
            "last_instrument_update"
        ]

        self.assertGreater(second, first)


class InstrumentCapabilitiesCacheTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_reflects_current_db_state_not_first_ever_call(self):
        # regression guard for the INSTRUMENT_QUERYSET-is-a-shared-module-level-object bug: the
        # first-ever call must not permanently freeze every later call at that first result
        empty = get_instrument_capabilities()
        self.assertEqual(empty, [])

        Instrument.objects.create(display_name="A")
        cache.clear()  # bypass this function's own TTL to see the fresh DB state immediately
        populated = get_instrument_capabilities()
        self.assertEqual(len(populated), 1)

    def test_result_is_cached_within_ttl(self):
        Instrument.objects.create(display_name="A")
        first = get_instrument_capabilities()

        Instrument.objects.create(display_name="B")
        second = (
            get_instrument_capabilities()
        )  # within TTL, no cache.clear() -- stays cached

        self.assertEqual(first, second)
        self.assertEqual(len(second), 1)


class InstrumentConfigAdminPermissionTests(TestCase):
    def setUp(self):
        self.instrument = Instrument.objects.create()
        self.camera = CameraCapability.objects.create(
            instrument=self.instrument, module_name="camera1", code="ef01"
        )
        self.user = User.objects.create_user(
            username="hwadmin", password="pw", is_staff=True
        )
        self.user.groups.add(Group.objects.get(name="instrument-config"))

    def test_can_add_and_change_instrument_but_not_delete(self):
        self.assertTrue(self.user.has_perm("instruments.add_instrument"))
        self.assertTrue(self.user.has_perm("instruments.change_instrument"))
        self.assertFalse(self.user.has_perm("instruments.delete_instrument"))

    def test_can_delete_capability_child_rows(self):
        self.assertTrue(self.user.has_perm("instruments.delete_binningoption"))
        self.assertTrue(self.user.has_perm("instruments.delete_filter"))
        self.assertTrue(self.user.has_perm("instruments.delete_cameracapability"))
