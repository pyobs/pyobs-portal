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
        fields = [
            "name",
            "module_name",
            "filter_change_time_s",
            "updated_at",
            "filters",
        ]


class CameraCapabilitySerializer(serializers.ModelSerializer):
    binnings = BinningOptionSerializer(many=True, read_only=True)
    filter_wheels = FilterWheelCapabilitySerializer(many=True, read_only=True)

    class Meta:
        model = CameraCapability
        fields = [
            "module_name",
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
            "module_name",
            "aperture_mm",
            "focal_length_mm",
            "mount_type",
            "slew_rate_deg_per_s",
            "updated_at",
        ]


class DomeCapabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = DomeCapability
        fields = ["module_name", "rotate_rate_deg_per_s", "updated_at"]


class InstrumentSerializer(serializers.ModelSerializer):
    cameras = CameraCapabilitySerializer(many=True, read_only=True)
    telescope = TelescopeCapabilitySerializer(read_only=True)
    dome = DomeCapabilitySerializer(read_only=True)

    class Meta:
        model = Instrument
        fields = [
            "display_name",
            "notes",
            "updated_at",
            "cameras",
            "telescope",
            "dome",
        ]
