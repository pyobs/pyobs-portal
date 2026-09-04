from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations


def add_roof_permissions(apps, schema_editor):
    # RoofCapability's own permissions don't exist yet at this point -- same reasoning as
    # 0002_instrument_config_group's create_group: they're normally created by a post_migrate
    # signal that fires only after the *entire* migrate run finishes.
    app_config = global_apps.get_app_config("instruments")
    app_config.models_module = app_config.models_module or True
    create_permissions(app_config, verbosity=0)

    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")

    group = Group.objects.filter(name="instrument-config").first()
    if group is None:
        return

    # Capability child row, same add/change/delete shape as the other capability models in
    # 0002_instrument_config_group.
    roof_perms = Permission.objects.filter(
        content_type__app_label="instruments",
        content_type__model="roofcapability",
        codename__regex=r"^(add|change|delete)_",
    )
    group.permissions.add(*roof_perms)


def remove_roof_permissions(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")

    group = Group.objects.filter(name="instrument-config").first()
    if group is None:
        return

    roof_perms = Permission.objects.filter(
        content_type__app_label="instruments",
        content_type__model="roofcapability",
        codename__regex=r"^(add|change|delete)_",
    )
    group.permissions.remove(*roof_perms)


class Migration(migrations.Migration):
    dependencies = [
        ("instruments", "0006_roofcapability"),
    ]

    operations = [
        migrations.RunPython(add_roof_permissions, remove_roof_permissions),
    ]
