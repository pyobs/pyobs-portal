from django.db import migrations


def create_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.get_or_create(name="unrestricted")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0011_alter_project_priority_alter_task_priority_and_more"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [migrations.RunPython(create_group, migrations.RunPython.noop)]
