from django.test import SimpleTestCase

from .models import Target
from .serializers import TargetSerializer


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
