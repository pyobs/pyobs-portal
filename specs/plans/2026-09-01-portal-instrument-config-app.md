# Plan: `instruments` app for pyobs-portal — static instrument capability data for the script builder

Status: proposed (pyobs/pyobs-portal#116)

**Amended by #140** (pyobs/pyobs-portal#139): `module_name` no longer lives on `Instrument` (§2
below) — it moves to `TelescopeCapability`, `DomeCapability`, and `CameraCapability` each, since
`Instrument.module_name` conflated the grouping's identity with the telescope's, and
`CameraCapability` had no module-name field at all (only its fleet-wide physical `code`). As a
result `InstrumentDetail` (`GET /api/instruments/<module_name>/`, §5) is dropped — nothing
consumed it — and `CameraCapabilityWithInstrumentSerializer`/`instrument_module_name` (§5) is
dropped too, now redundant with the camera's own `module_name`. The rest of this doc (models,
admin permissions, N+1 protection, `InstrumentList`, `GET /api/instruments/cameras/<code>/`)
still reflects the current implementation as designed.

No pyobs-core changes — this models *declared* capability data in the portal's own DB; it does not
touch `ICamera`/`IBinning`/etc. or any live RPC path. Conceptually adjacent to pyobs-core's
`specs/plans/2026-08-24-script-field-interface-annotations.md`
(`../../../pyobs-core/specs/plans/2026-08-24-script-field-interface-annotations.md`) and this
repo's own `2026-08-24-module-ref-dropdowns.md`, which resolve *which module* can fill a field;
this plan resolves *what that module's hardware can do* once picked, for planning-time script
composition. Live module queries remain the source of truth for execution — this is out of scope
to reconcile against (per the issue).

## Problem

The script builder needs static instrument capability data (camera pixel size, binning options,
ROI limits, filter sets, etc.) to help compose scripts offline. Today that data only exists live,
queryable from a running module's interface (`ICamera`, `IBinning`, ...) — fine for execution, not
for planning when modules aren't reachable, or for validating a script before any module needs to
be up at all. It also needs to *estimate task durations* — filter-change time, camera readout
time, dome rotation time, slew rate — none of which any live interface currently exposes either.

## Existing conventions this follows

- Module identity in the portal is a **string** (module name), never a DB-side `Module` row —
  confirmed in `2026-08-24-module-ref-dropdowns.md`: pyobs-web-admin's
  `GET /api/modules/classes/` is the live source of `{module_name: class_fqcn}`, and the portal
  has no local `Module` model to FK against. `Instrument.module_name` below follows the same
  pattern: a plain, portal-local string, not a foreign key to anything live.
- The portal's existing single `api` app (`pyobs_portal/api/`) splits by concern into
  `models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py`, with DRF
  `@api_view`/`permission_classes` view functions and `path()` routing mounted under `api/` in
  the project's top-level `pyobs_portal/urls.py`. The new `instruments` app mirrors this file
  split exactly, as its own Django app (per the issue's own framing and this plan's scoping
  decision — kept isolated from the already-large `api` app rather than added to its
  `models.py`/`admin.py`).
- Settings precedent for optional integrations: flat `os.environ.get(..., default)` pairs,
  documented inline (`ARCHIVE_URL`/`ARCHIVE_TOKEN`, `WEBADMIN_URL`/`WEBADMIN_TOKEN`) — not needed
  here since there's no outbound integration, but the admin-permission group below follows the
  same "provision automatically, degrade to a no-op if already present" spirit via a data
  migration.

## Design

### 1. New app: `pyobs_portal/instruments/`

```
pyobs_portal/instruments/
├── __init__.py
├── apps.py            # InstrumentsConfig
├── models.py
├── admin.py
├── serializers.py
├── views.py            # read-only DRF views (ListAPIView/RetrieveAPIView, see § 5 correction)
├── urls.py
├── migrations/
│   ├── 0001_initial.py
│   └── 0002_instrument_config_group.py   # data migration, see §4
└── tests.py
```

Add `"pyobs_portal.instruments"` to `INSTALLED_APPS` (`settings.py`, alongside
`"pyobs_portal.api"`).

### 2. Models — one per capability type, FK'd to an `Instrument` identity row

```python
class Instrument(models.Model):
    module_name = models.CharField(max_length=255, unique=True)
    display_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)
```

`module_name` is the same string that appears in scripts' module-name fields and in
`GET /api/modules/classes/` — deliberately not validated against either live source (the issue's
"reconciliation is out of scope" point).

`updated_at` (here and on the capability models below) exists because this data is explicitly
*not* reconciled against live module state — the script builder needs some signal for how stale
an entry might be. Caveat: Django admin doesn't re-save the parent `Instrument` row when only a
nested inline (a `CameraCapability`, a `Filter`, …) is edited, so `Instrument.updated_at` reflects
edits to `Instrument`'s own fields only — each capability model needs its own `updated_at` if its
freshness matters independently.

```python
class CameraCapability(models.Model):
    instrument = models.ForeignKey(Instrument, on_delete=models.CASCADE, related_name="cameras")
    code = models.CharField(max_length=4, unique=True)  # fleet-wide physical camera ID, e.g. "ef01"
    pixel_size_um = models.FloatField(null=True, blank=True)
    sensor_width_px = models.PositiveIntegerField(null=True, blank=True)
    sensor_height_px = models.PositiveIntegerField(null=True, blank=True)
    roi_min_width_px = models.PositiveIntegerField(null=True, blank=True)
    roi_min_height_px = models.PositiveIntegerField(null=True, blank=True)
    roi_step_px = models.PositiveIntegerField(null=True, blank=True)
    exposure_time_min_s = models.FloatField(null=True, blank=True)
    exposure_time_max_s = models.FloatField(null=True, blank=True)
    image_types = models.JSONField(default=list, blank=True)  # e.g. ["object", "bias", "dark", "flat"]
    updated_at = models.DateTimeField(auto_now=True)
```

`instrument` is a plain FK, not `OneToOneField` — an instrument can carry more than one camera
(e.g. science + guide), same reasoning as `FilterWheelCapability` below. `code` is the disambiguator:
a real, already-in-use 4-character fleet-wide camera ID (e.g. `"ef01"`) that's unique across the
whole fleet, not just within one instrument — it identifies the physical camera unit and follows
it if swapped between instruments. It's also the more natural lookup key for the API (§5) than an
array index.

```python
class BinningOption(models.Model):
    camera = models.ForeignKey(CameraCapability, on_delete=models.CASCADE, related_name="binnings")
    x = models.PositiveSmallIntegerField()
    y = models.PositiveSmallIntegerField()
    readout_time_s = models.FloatField(null=True, blank=True)  # readout varies by binning

    class Meta:
        unique_together = ("camera", "x", "y")

class FilterWheelCapability(models.Model):
    camera = models.ForeignKey(CameraCapability, on_delete=models.CASCADE, related_name="filter_wheels")
    name = models.CharField(max_length=255, blank=True)  # for cameras with >1 wheel
    filter_change_time_s = models.FloatField(null=True, blank=True)  # one-position-step estimate
    updated_at = models.DateTimeField(auto_now=True)

class Filter(models.Model):
    filter_wheel = models.ForeignKey(FilterWheelCapability, on_delete=models.CASCADE, related_name="filters")
    name = models.CharField(max_length=255)
    position = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["position", "name"]
        unique_together = ("filter_wheel", "name")

class TelescopeCapability(models.Model):
    instrument = models.OneToOneField(Instrument, on_delete=models.CASCADE, related_name="telescope")
    aperture_mm = models.FloatField(null=True, blank=True)
    focal_length_mm = models.FloatField(null=True, blank=True)
    mount_type = models.CharField(max_length=255, blank=True)
    slew_rate_deg_per_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

class DomeCapability(models.Model):
    instrument = models.OneToOneField(Instrument, on_delete=models.CASCADE, related_name="dome")
    rotate_rate_deg_per_s = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
```

`Filter.unique_together` added on `(filter_wheel, name)` — nothing previously stopped two filters
with the same name in one wheel.

`FilterWheelCapability.camera` FKs to `CameraCapability`, not `Instrument` — checked against
LCO's ConfigDB (a production system solving the same static-capability-for-scheduling problem for
a robotic telescope network), which attaches optical-element groups (their filter wheels) to the
camera, since the wheel physically sits in front of one camera. Matters here because
`CameraCapability` is now multi-per-instrument (science + guide, §2 above) — a shared
`Instrument.filter_wheels` would have implied both cameras see the same filters, which isn't
generally true. LCO's model is otherwise more elaborate than this plan needs (separate overhead
fields for slew, instrument-change, config-change, per-exposure fixed cost, plus a general
"mode" system for readout/guiding/acquisition/rotator) — deliberately not adopting that breadth
here, just the one structural correction.

`DomeCapability` is new (one dome per instrument enclosure — `OneToOneField`, same as
`TelescopeCapability`), added alongside `slew_rate_deg_per_s` so the script builder can estimate
task durations, not just check hardware limits: `filter_change_time_s` (on `FilterWheelCapability`,
above), `readout_time_s` (on `BinningOption`, above — readout time varies by binning, not a
per-camera constant, so it lives on the binning row rather than `CameraCapability`),
`rotate_rate_deg_per_s` (here), and `slew_rate_deg_per_s` (already on `TelescopeCapability`)
together cover the moving parts a script's runtime estimate needs. `DomeCapability`'s rate is
modeled as deg/s rather than a fixed full-rotation time, for consistency with
`slew_rate_deg_per_s` — the script builder multiplies by the actual angle needed either way.

Repeating data (binnings, filters) gets its own FK'd model per the "one model per capability
type" decision; fixed-shape scalar specs (pixel size, ROI step, aperture) stay as fields on the
owning capability row rather than one-row-per-field tables. **This field list is a strawman** —
Tim should adjust names/units/precision against what the script builder and real hardware
actually need before implementation; the shape (Instrument ← 1:1/1:N → per-type capability
models) is the part this plan is committing to.

All numeric fields are `null=True, blank=True`: an instrument entry can be created before every
spec is known, and partial data (e.g. filters known, ROI limits not yet) must not block saving.

### 3. Admin (`admin.py`)

`ModelAdmin`/`TabularInline` for each model, editable through Django admin rather than a custom
UI — this is occasional, structured data entry (fill in specs when an instrument joins the fleet,
tweak rarely after), not a workflow that justifies building bespoke pages, and admin gets the
permission-group scoping and change history for free.

`CameraCapability` is a list-type child of `Instrument` (§2), inlined as `TabularInline` on
`InstrumentAdmin`; `TelescopeCapability` and `DomeCapability` stay `StackedInline` (both still
1:1). Below `CameraCapability`, `BinningOption` and `FilterWheelCapability` would each need to be
inlined too, and `Filter` a level below that — three levels of nesting under `Instrument`, which
vanilla Django admin doesn't support (one level only) and which `django-nested-admin` (the earlier
draft's answer) makes possible but not simple.

Going with the simpler option instead, per steer to keep this app simple rather than reaching for
LCO-ConfigDB-level generality: no nested-admin dependency. `CameraCapability` is the one inline on
`InstrumentAdmin`; `BinningOption`, `FilterWheelCapability`, and `Filter` (as an inline one level
under `FilterWheelCapability`'s own change page) are edited on their parent row's own admin page,
reached by clicking through from the `Instrument` page rather than all inline on it. One or two
extra clicks for deeply-nested edits (a filter is `Instrument → camera → filter wheel → filter`),
no new dependency, no nesting-depth ceiling to hit later if another level gets added.

### 4. Permission group: `instrument-config`, provisioned by data migration

`0002_instrument_config_group.py` (`RunPython`, with a no-op reverse):

```python
def create_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")

    group, _ = Group.objects.get_or_create(name="instrument-config")

    # Instrument itself: add/change only, no delete — it's what scripts reference by
    # module_name, so removing one is a heavier action than editing capability data.
    instrument_perms = Permission.objects.filter(
        content_type__app_label="instruments",
        content_type__model="instrument",
        codename__in=["add_instrument", "change_instrument"],
    )

    # Capability child rows: add/change/delete — routine data entry (fixing a mistyped
    # filter or binning option) needs to remove a row via the admin inline's delete
    # checkbox, not just edit it, so delete can't be withheld here the way it is above.
    capability_models = ["cameracapability", "binningoption", "filterwheelcapability",
                          "filter", "telescopecapability", "domecapability"]
    capability_perms = Permission.objects.filter(
        content_type__app_label="instruments",
        content_type__model__in=capability_models,
        codename__regex=r"^(add|change|delete)_",
    )

    group.permissions.add(*instrument_perms, *capability_perms)
```

**Implementation correction**: as written above, this migration fails — `Permission` rows for
`instruments`' own models don't exist yet when `0002` runs, because they're normally created by a
`post_migrate` signal that fires once after the *entire* `migrate` run finishes, not after each
individual migration. `Permission.objects.filter(...)` finds nothing and the group ends up with no
permissions (caught by `test_group_created_with_expected_permissions` in §6). Fix: force-create
them first via `django.contrib.auth.management.create_permissions` against the *real* app config
(not the migration's historical `apps`), using the documented `models_module = models_module or
True` workaround for `create_permissions`' early-return guard:

```python
from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions

def create_group(apps, schema_editor):
    app_config = global_apps.get_app_config("instruments")
    app_config.models_module = app_config.models_module or True
    create_permissions(app_config, verbosity=0)
    # ...rest as below, using the migration's own `apps` for Group/Permission
```

`get_or_create` makes this idempotent against re-runs/redeploys. `view_*` isn't granted
explicitly since Django admin grants view implicitly to anyone with change. The split above
(delete withheld only on `Instrument`) replaces an earlier draft of this plan that withheld
delete uniformly across all models — that blocked the group's own reason for existing, since
Django admin requires `delete_<model>` permission to show an inline row's delete checkbox, so a
uniform withholding meant `instrument-config` users could add a wrong filter or binning entry but
never remove one, forcing an escalation to superuser for routine fixes. A user still needs
`is_staff=True` to reach `/admin/` at all; this group only scopes *which* models — and which
actions on them — they can touch once there, same as any other Django admin group.

### 5. Read-only API (`serializers.py`, `views.py`, `urls.py`)

Nested DRF serializers (`Instrument` → `cameras`/`telescope`/`dome`, each `camera` with its own
nested `binnings`/`filter_wheels`, each `filter_wheel` with its `filters`) so the script builder
can fetch one instrument's full capability set — specs and duration-estimate fields alike — in a
single request:

```python
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
        fields = [..., "binnings", "filter_wheels"]  # plus the scalar spec fields from §2

class InstrumentSerializer(serializers.ModelSerializer):
    cameras = CameraCapabilitySerializer(many=True, read_only=True)
    telescope = TelescopeCapabilitySerializer(read_only=True)
    dome = DomeCapabilitySerializer(read_only=True)

    class Meta:
        model = Instrument
        fields = ["module_name", "display_name", "notes", "updated_at",
                  "cameras", "telescope", "dome"]
```

**Implementation correction**: this section originally assumed DRF `ReadOnlyModelViewSet` +
`DefaultRouter`. Checked against the actual `api` app during implementation — it doesn't use
routers at all, just `generics.ListAPIView`/`RetrieveAPIView` classes with explicit `path()`
entries (`api/views.py`/`api/urls.py`). Implemented that way instead, per this plan's own stated
principle (§ Existing conventions) of mirroring the real `api` app rather than generic DRF
defaults:

```python
@permission_classes([IsAuthenticated])
class InstrumentList(generics.ListAPIView):
    queryset = Instrument.objects.all()
    serializer_class = InstrumentSerializer


@permission_classes([IsAuthenticated])
class InstrumentDetail(generics.RetrieveAPIView):
    queryset = Instrument.objects.all()
    serializer_class = InstrumentSerializer
    lookup_field = "module_name"


@permission_classes([IsAuthenticated])
class CameraCapabilityDetail(generics.RetrieveAPIView):
    queryset = CameraCapability.objects.all()
    serializer_class = CameraCapabilityWithInstrumentSerializer
    lookup_field = "code"
```

(`@permission_classes` from `rest_framework.decorators` works as a class decorator too — it just
sets a `permission_classes` class attribute, same as the existing `api` app's `UserList` does.)

Mounted in the project's top-level `pyobs_portal/urls.py`:

```python
path("api/instruments/", include("pyobs_portal.instruments.urls")),
```

with `instruments/urls.py`:

```python
urlpatterns = [
    path("", views.InstrumentList.as_view()),
    path("cameras/<str:code>/", views.CameraCapabilityDetail.as_view()),
    path("<str:module_name>/", views.InstrumentDetail.as_view()),
]
```

giving `GET /api/instruments/` (list, paginated per the project's global
`DEFAULT_PAGINATION_CLASS`), `GET /api/instruments/<module_name>/` (detail), and
`GET /api/instruments/cameras/<code>/` (a camera's capability row plus its owning `instrument`
module name, via `CameraCapabilityWithInstrumentSerializer` — `CameraCapabilitySerializer` plus an
`instrument_module_name` field). The `cameras/` path is listed before `<module_name>/` so it isn't
swallowed by that catch-all.

### 6. Tests (`instruments/tests.py`)

- Model-level: `unique_together` on `BinningOption` and on `Filter` (`filter_wheel`, `name`);
  `CameraCapability.code` global uniqueness (two different instruments, same `code`, rejected);
  cascade deletes (deleting an `Instrument` removes its capability rows; deleting one
  `CameraCapability` — now independently deletable, §4 — removes only that camera's own
  `binnings`/`filter_wheels`/`filters`, not its siblings).
- Migration test: `0002` creates the `instrument-config` group with exactly add/change on
  `Instrument` and add/change/delete on the six capability models, no more, no less; re-running
  is idempotent (`get_or_create`).
- API: `GET /api/instruments/` and `/api/instruments/<module_name>/` — 401 unauthenticated, 200 +
  expected nested shape authenticated; a partially-filled instrument (e.g. no `telescope`/`dome`
  row, or a camera with no `filter_wheels`) serializes with `"telescope": null`/`"dome": null`/
  `"filter_wheels": []`, not a 500; `GET /api/instruments/cameras/<code>/` resolves a camera by
  its fleet-wide code, including its nested `filter_wheels`.
- Admin: a user in `instrument-config` (without `is_staff` superuser rights) has add/change/delete
  `has_perm()` on `CameraCapability`, `BinningOption`, `FilterWheelCapability`, `Filter`,
  `TelescopeCapability`, and `DomeCapability`, and only add/change (not delete) on `Instrument`.
  The test suite asserts this via `has_perm()` rather than a full admin-site walkthrough.

  **Manual walkthrough performed 2026-09-01** (against a throwaway scratch DB, not the dev
  `db.sqlite3`), as a non-superuser member of `instrument-config`: created an `Instrument` with a
  `CameraCapability` inline; clicked through `CameraCapability`'s own page to add a `BinningOption`
  and a `FilterWheelCapability`; clicked through the wheel's own page to add a `Filter`; checked
  the `BinningOption` row's delete checkbox and saved — the row was removed while the camera,
  instrument, and filter survived. Confirmed `Instrument`'s delete link is absent from the change
  page and a direct POST to its `/delete/` URL returns 403. The admin index page for this user
  shows only the `Instruments` app section — `api`/`auth`/`authtoken` are invisible, matching
  group scoping rather than just per-model permission checks.

  One tooling note, not an app finding: an early attempt at the same walkthrough via
  coordinate/ref-based browser automation appeared to silently drop a `BinningOption` save. Traced
  to the automation targeting Django's hidden inline `empty-form` template row instead of the
  newly-added visible row (both matched a fuzzy "binning option X/Y input" query) — not a bug in
  the app. Redone by inspecting the DOM directly (`#binnings-group`, form field names like
  `binnings-0-x`) and driving the real inputs, which is how the results above were obtained.
- `updated_at`: editing a nested capability row bumps that row's own `updated_at` but leaves the
  parent `Instrument.updated_at` unchanged (documents the caveat in §2, not just tests it).

## Acceptance criteria

- `Instrument` + per-type capability models exist, editable via Django admin: `CameraCapability`
  (and `TelescopeCapability`/`DomeCapability`) inline on `Instrument`; `BinningOption`,
  `FilterWheelCapability`, and `Filter` on their own parent-row admin pages one or two clicks
  deeper — no nested-admin dependency (§3).
- A user in the `instrument-config` group (provisioned automatically via migration) can add/edit
  these models — including deleting capability child rows — without needing broader
  `is_staff`/superuser rights; only deleting `Instrument` itself still requires that.
- `GET /api/instruments/`, `/api/instruments/<module_name>/`, and
  `/api/instruments/cameras/<code>/` return nested, read-only capability data for authenticated
  API clients.
- Each `Instrument`/capability row carries its own `updated_at` so API consumers can judge
  staleness.
- Duration-estimate fields are queryable per capability row: `filter_change_time_s`
  (`FilterWheelCapability`), `readout_time_s` (`BinningOption`, per binning), `slew_rate_deg_per_s`
  (`TelescopeCapability`), `rotate_rate_deg_per_s` (`DomeCapability`).
- No live-module querying, no reconciliation against `ICamera`/`IBinning` state — this is
  planning-time data only, entered by hand.

## Out of scope

- Reconciliation/validation against live module state (issue's own follow-up note).
- Any change to pyobs-core interfaces or the `Annotated`-tag mechanism from
  `2026-08-24-script-field-interface-annotations.md` — unrelated; that resolves *which module*,
  this resolves *what it can do*.
- Wiring the script builder frontend to actually *use* this data (e.g. constraining exposure-time
  fields to an instrument's min/max, or filtering filter dropdowns to a chosen instrument's filter
  set) — this plan only ships the data model + admin + read API. Frontend consumption is a
  follow-up once the shape here is validated against real data entry.
- Bulk-import/seed tooling — first-run population is manual admin entry, per the issue.
