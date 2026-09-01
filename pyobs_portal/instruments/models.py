from django.db import models


class Instrument(models.Model):
    module_name = models.CharField(max_length=255, unique=True)
    display_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["module_name"]

    def __str__(self) -> str:
        return self.display_name or self.module_name


class CameraCapability(models.Model):
    instrument = models.ForeignKey(
        Instrument, on_delete=models.CASCADE, related_name="cameras"
    )
    code = models.CharField(
        max_length=4, unique=True
    )  # fleet-wide physical camera ID, e.g. "ef01"
    pixel_size_um = models.FloatField(null=True, blank=True)
    sensor_width_px = models.PositiveIntegerField(null=True, blank=True)
    sensor_height_px = models.PositiveIntegerField(null=True, blank=True)
    roi_min_width_px = models.PositiveIntegerField(null=True, blank=True)
    roi_min_height_px = models.PositiveIntegerField(null=True, blank=True)
    roi_step_px = models.PositiveIntegerField(null=True, blank=True)
    exposure_time_min_s = models.FloatField(null=True, blank=True)
    exposure_time_max_s = models.FloatField(null=True, blank=True)
    image_types = models.JSONField(
        default=list, blank=True
    )  # e.g. ["object", "bias", "dark", "flat"]
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class BinningOption(models.Model):
    camera = models.ForeignKey(
        CameraCapability, on_delete=models.CASCADE, related_name="binnings"
    )
    x = models.PositiveSmallIntegerField()
    y = models.PositiveSmallIntegerField()
    readout_time_s = models.FloatField(
        null=True, blank=True
    )  # readout varies by binning

    class Meta:
        ordering = ["x", "y"]
        unique_together = ("camera", "x", "y")

    def __str__(self) -> str:
        return f"{self.x}x{self.y}"


class FilterWheelCapability(models.Model):
    camera = models.ForeignKey(
        CameraCapability, on_delete=models.CASCADE, related_name="filter_wheels"
    )
    name = models.CharField(max_length=255, blank=True)  # for cameras with >1 wheel
    filter_change_time_s = models.FloatField(
        null=True, blank=True
    )  # one-position-step estimate
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name or f"filter wheel ({self.camera.code})"


class Filter(models.Model):
    filter_wheel = models.ForeignKey(
        FilterWheelCapability, on_delete=models.CASCADE, related_name="filters"
    )
    name = models.CharField(max_length=255)
    position = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["position", "name"]
        unique_together = ("filter_wheel", "name")

    def __str__(self) -> str:
        return self.name


class TelescopeCapability(models.Model):
    instrument = models.OneToOneField(
        Instrument, on_delete=models.CASCADE, related_name="telescope"
    )
    aperture_mm = models.FloatField(null=True, blank=True)
    focal_length_mm = models.FloatField(null=True, blank=True)
    mount_type = models.CharField(max_length=255, blank=True)
    slew_rate_deg_per_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"telescope ({self.instrument.module_name})"


class DomeCapability(models.Model):
    instrument = models.OneToOneField(
        Instrument, on_delete=models.CASCADE, related_name="dome"
    )
    rotate_rate_deg_per_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"dome ({self.instrument.module_name})"
