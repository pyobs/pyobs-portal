from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations


def create_group(apps, schema_editor):
    # Permissions for models created in 0001 don't exist yet at this point: they're normally
    # created by a post_migrate signal that fires only after the *entire* migrate run finishes,
    # not after each individual migration. Force-create them now so the queries below find rows.
    app_config = global_apps.get_app_config("instruments")
    app_config.models_module = app_config.models_module or True
    create_permissions(app_config, verbosity=0)

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
    capability_models = [
        "cameracapability",
        "binningoption",
        "filterwheelcapability",
        "filter",
        "telescopecapability",
        "domecapability",
    ]
    capability_perms = Permission.objects.filter(
        content_type__app_label="instruments",
        content_type__model__in=capability_models,
        codename__regex=r"^(add|change|delete)_",
    )

    group.permissions.add(*instrument_perms, *capability_perms)


def remove_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name="instrument-config").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("instruments", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_group, remove_group),
    ]
