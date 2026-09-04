from django.db import models


class Instrument(models.Model):
    """A grouping of one telescope + dome + one or more cameras that work together at a site.

    Purely an admin-UI organizational concept -- it has no module identity of its own. Each
    device-capability model below carries its own ``module_name`` (``CameraCapability``,
    ``TelescopeCapability``, ``DomeCapability``, and ``FilterWheelCapability``), since scripts
    reference cameras, telescopes, and filter wheels as independent modules (an instrument can
    carry more than one camera, e.g. science + guide). ``FilterWheelCapability.module_name`` is
    required, same as every other device here -- a wheel with filter selection exposed through
    the camera's own module (no independent XMPP identity) should be entered with the *camera's*
    module_name, not left blank; a blank value would make the row permanently unreachable by any
    script/scheduler lookup (pyobs-core's ``InstrumentCapabilities`` indexes by module_name). This
    only covers *one* integrated wheel per camera -- ``module_name`` is unique per row, so two
    module-less wheels on the same camera can't both borrow it. In practice a camera exposes at
    most one integrated wheel this way (the SBIG pattern this case models); a camera with more
    than one wheel needing this treatment would need its own design, not just "use the camera's
    name" (``FilterWheelCapability.name`` already exists for the *addressable*, >1-wheel-per-camera
    case -- a different situation from this one).

    ``module_name`` is unique per device *type* (a ``CameraCapability`` and a
    ``TelescopeCapability`` could technically share a name), not enforced across all of them --
    Django can't express a cross-table unique constraint. In practice this shouldn't happen:
    within one pyobs site, module names are unique across the whole XMPP roster, so two device
    rows sharing a name is an invalid site config, not a valid one this app needs to allow.
    """

    display_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_name"]

    def __str__(self) -> str:
        return self.display_name or f"instrument #{self.pk}"


class CameraCapability(models.Model):
    instrument = models.ForeignKey(
        Instrument, on_delete=models.CASCADE, related_name="cameras"
    )
    module_name = models.CharField(max_length=255, unique=True)
    code = models.CharField(
        max_length=4, unique=True
    )  # fleet-wide physical camera ID, e.g. "ef01"
    model = models.CharField(max_length=255, blank=True)  # e.g. "FLI ProLine PL23042"
    sensor_type = models.CharField(
        max_length=255, blank=True
    )  # e.g. "e2v CCD230-42, back-illuminated CCD"
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
    updated_at = models.DateTimeField(auto_now=True)

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
    module_name = models.CharField(max_length=255, unique=True)
    model = models.CharField(max_length=255, blank=True)  # e.g. "FLI CFW-2-7"
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
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "name"]
        unique_together = ("filter_wheel", "name")

    def __str__(self) -> str:
        return self.name


class TelescopeCapability(models.Model):
    instrument = models.OneToOneField(
        Instrument, on_delete=models.CASCADE, related_name="telescope"
    )
    module_name = models.CharField(max_length=255, unique=True)
    aperture_mm = models.FloatField(null=True, blank=True)
    focal_length_mm = models.FloatField(null=True, blank=True)
    mount_type = models.CharField(max_length=255, blank=True)
    slew_rate_deg_per_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"telescope ({self.module_name})"


class DomeCapability(models.Model):
    instrument = models.OneToOneField(
        Instrument, on_delete=models.CASCADE, related_name="dome"
    )
    module_name = models.CharField(max_length=255, unique=True)
    rotate_rate_deg_per_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"dome ({self.module_name})"


class RoofCapability(models.Model):
    """A plain open/close roof (IRoof, no IPointingAltAz) -- no rate/distance concept, just a
    fixed open/close cycle time. Distinct from DomeCapability (a rotating dome): a site has one
    or the other, never both, but that's a real-world constraint this app doesn't need to
    enforce.
    """

    instrument = models.OneToOneField(
        Instrument, on_delete=models.CASCADE, related_name="roof"
    )
    module_name = models.CharField(max_length=255, unique=True)
    open_close_time_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"roof ({self.module_name})"
