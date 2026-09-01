from rest_framework import serializers

from .models import (
    Instrument,
    CameraCapability,
    BinningOption,
    FilterWheelCapability,
    Filter,
    TelescopeCapability,
    DomeCapability,
)


class FilterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Filter
        fields = ["name", "position", "updated_at"]


class BinningOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = BinningOption
        fields = ["x", "y", "readout_time_s", "updated_at"]


class FilterWheelCapabilitySerializer(serializers.ModelSerializer):
    filters = FilterSerializer(many=True, read_only=True)

    class Meta:
        model = FilterWheelCapability
        fields = ["name", "filter_change_time_s", "updated_at", "filters"]


class CameraCapabilitySerializer(serializers.ModelSerializer):
    binnings = BinningOptionSerializer(many=True, read_only=True)
    filter_wheels = FilterWheelCapabilitySerializer(many=True, read_only=True)

    class Meta:
        model = CameraCapability
        fields = [
            "code",
            "pixel_size_um",
            "sensor_width_px",
            "sensor_height_px",
            "roi_min_width_px",
            "roi_min_height_px",
            "roi_step_px",
            "exposure_time_min_s",
            "exposure_time_max_s",
            "image_types",
            "updated_at",
            "binnings",
            "filter_wheels",
        ]


class TelescopeCapabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = TelescopeCapability
        fields = [
            "aperture_mm",
            "focal_length_mm",
            "mount_type",
            "slew_rate_deg_per_s",
            "updated_at",
        ]


class DomeCapabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = DomeCapability
        fields = ["rotate_rate_deg_per_s", "updated_at"]


class InstrumentSerializer(serializers.ModelSerializer):
    cameras = CameraCapabilitySerializer(many=True, read_only=True)
    telescope = TelescopeCapabilitySerializer(read_only=True)
    dome = DomeCapabilitySerializer(read_only=True)

    class Meta:
        model = Instrument
        fields = [
            "module_name",
            "display_name",
            "notes",
            "updated_at",
            "cameras",
            "telescope",
            "dome",
        ]


class CameraCapabilityWithInstrumentSerializer(CameraCapabilitySerializer):
    """CameraCapability plus its owning instrument's module_name — for the fleet-wide camera-code lookup."""

    instrument_module_name = serializers.CharField(
        source="instrument.module_name", read_only=True
    )

    class Meta(CameraCapabilitySerializer.Meta):
        fields = CameraCapabilitySerializer.Meta.fields + ["instrument_module_name"]
