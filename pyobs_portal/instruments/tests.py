from django.contrib.auth.models import User, Group
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    Instrument,
    CameraCapability,
    BinningOption,
    FilterWheelCapability,
    Filter,
    TelescopeCapability,
    DomeCapability,
)


class ModelTests(TestCase):
    def setUp(self):
        self.instrument = Instrument.objects.create(module_name="camera1")
        self.camera = CameraCapability.objects.create(
            instrument=self.instrument, code="ef01"
        )

    def test_binning_option_unique_together(self):
        BinningOption.objects.create(camera=self.camera, x=1, y=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            BinningOption.objects.create(camera=self.camera, x=1, y=1)

    def test_filter_unique_together_per_wheel(self):
        wheel = FilterWheelCapability.objects.create(camera=self.camera)
        Filter.objects.create(filter_wheel=wheel, name="R")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Filter.objects.create(filter_wheel=wheel, name="R")

    def test_camera_code_globally_unique(self):
        other_instrument = Instrument.objects.create(module_name="camera2")
        with self.assertRaises(IntegrityError), transaction.atomic():
            CameraCapability.objects.create(instrument=other_instrument, code="ef01")

    def test_deleting_instrument_cascades_to_capability_rows(self):
        BinningOption.objects.create(camera=self.camera, x=1, y=1)
        TelescopeCapability.objects.create(instrument=self.instrument)
        DomeCapability.objects.create(instrument=self.instrument)
        self.instrument.delete()
        self.assertEqual(CameraCapability.objects.count(), 0)
        self.assertEqual(BinningOption.objects.count(), 0)
        self.assertEqual(TelescopeCapability.objects.count(), 0)
        self.assertEqual(DomeCapability.objects.count(), 0)

    def test_deleting_camera_only_removes_its_own_children(self):
        BinningOption.objects.create(camera=self.camera, x=1, y=1)
        other_camera = CameraCapability.objects.create(
            instrument=self.instrument, code="ef02"
        )
        BinningOption.objects.create(camera=other_camera, x=2, y=2)

        self.camera.delete()

        self.assertEqual(BinningOption.objects.count(), 1)
        self.assertEqual(BinningOption.objects.first().camera, other_camera)
        # sibling instrument row and camera survive
        self.assertTrue(Instrument.objects.filter(pk=self.instrument.pk).exists())
        self.assertTrue(CameraCapability.objects.filter(pk=other_camera.pk).exists())


class InstrumentConfigGroupMigrationTests(TestCase):
    """Covers migration 0002 (run automatically before every test's transaction)."""

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


class InstrumentApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="scriptbuilder", password="pw")
        self.instrument = Instrument.objects.create(
            module_name="camera1", display_name="Main Camera"
        )
        self.camera = CameraCapability.objects.create(
            instrument=self.instrument, code="ef01", pixel_size_um=5.4
        )
        self.wheel = FilterWheelCapability.objects.create(
            camera=self.camera, filter_change_time_s=3.5
        )
        Filter.objects.create(filter_wheel=self.wheel, name="R", position=1)

    def test_list_requires_auth(self):
        response = self.client.get("/api/instruments/")
        self.assertEqual(response.status_code, 401)

    def test_list_does_not_n_plus_one(self):
        # a second, fully-populated instrument, so a per-row query would actually show up
        other_instrument = Instrument.objects.create(module_name="camera2")
        other_camera = CameraCapability.objects.create(
            instrument=other_instrument, code="ef02"
        )
        BinningOption.objects.create(camera=other_camera, x=2, y=2)
        other_wheel = FilterWheelCapability.objects.create(camera=other_camera)
        Filter.objects.create(filter_wheel=other_wheel, name="V")
        TelescopeCapability.objects.create(instrument=other_instrument)
        DomeCapability.objects.create(instrument=other_instrument)

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
        camera_data = instrument_data["cameras"][0]
        self.assertEqual(camera_data["code"], "ef01")
        self.assertEqual(camera_data["filter_wheels"][0]["filters"][0]["name"], "R")

    def test_detail_by_module_name(self):
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/camera1/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["module_name"], "camera1")

    def test_camera_lookup_by_code_includes_instrument(self):
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/instruments/cameras/ef01/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["code"], "ef01")
        self.assertEqual(data["instrument_module_name"], "camera1")


class InstrumentConfigAdminPermissionTests(TestCase):
    def setUp(self):
        self.instrument = Instrument.objects.create(module_name="camera1")
        self.camera = CameraCapability.objects.create(
            instrument=self.instrument, code="ef01"
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
