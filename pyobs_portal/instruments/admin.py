from django.contrib import admin

from .models import (
    Instrument,
    CameraCapability,
    BinningOption,
    FilterWheelCapability,
    Filter,
    TelescopeCapability,
    DomeCapability,
    RoofCapability,
)


class CameraCapabilityInline(admin.TabularInline):
    model = CameraCapability
    extra = 0
    fields = [
        "module_name",
        "code",
        "pixel_size_um",
        "sensor_width_px",
        "sensor_height_px",
    ]
    show_change_link = True


class TelescopeCapabilityInline(admin.StackedInline):
    model = TelescopeCapability
    extra = 0


class DomeCapabilityInline(admin.StackedInline):
    model = DomeCapability
    extra = 0


class RoofCapabilityInline(admin.StackedInline):
    model = RoofCapability
    extra = 0


@admin.register(Instrument)
class InstrumentAdmin(admin.ModelAdmin):
    list_display = ["__str__", "updated_at"]
    search_fields = ["display_name", "notes"]
    inlines = [
        CameraCapabilityInline,
        TelescopeCapabilityInline,
        DomeCapabilityInline,
        RoofCapabilityInline,
    ]


class BinningOptionInline(admin.TabularInline):
    model = BinningOption
    extra = 0


class FilterWheelCapabilityInline(admin.TabularInline):
    model = FilterWheelCapability
    extra = 0
    fields = ["name", "module_name", "filter_change_time_s"]
    show_change_link = True


@admin.register(CameraCapability)
class CameraCapabilityAdmin(admin.ModelAdmin):
    list_display = [
        "module_name",
        "code",
        "model",
        "sensor_type",
        "instrument",
        "pixel_size_um",
        "updated_at",
    ]
    search_fields = ["module_name", "code", "model", "sensor_type"]
    inlines = [BinningOptionInline, FilterWheelCapabilityInline]


class FilterInline(admin.TabularInline):
    model = Filter
    extra = 0


@admin.register(FilterWheelCapability)
class FilterWheelCapabilityAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "module_name",
        "model",
        "camera",
        "filter_change_time_s",
        "updated_at",
    ]
    search_fields = ["name", "module_name", "model"]
    inlines = [FilterInline]
