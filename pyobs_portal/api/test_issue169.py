"""Regression coverage for plain-machine setup and observation controls (#169)."""

import importlib
import math
import os
from datetime import timedelta
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, SimpleTestCase, TransactionTestCase, override_settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Project, Task, Observation
from .serializers import ProjectSerializer, TaskSerializer
from .tasks import mark_window_expired, delete_old_observations


class SettingsTests(SimpleTestCase):
    def read_settings(self, **env):
        # Execute settings without any ignored deployment-local Python overrides.
        from pathlib import Path

        source = Path(__file__).resolve().parents[1] / "settings.py"
        text = source.read_text().replace("from .local_settings import *", "pass")
        scope = {
            "__file__": str(source),
            "__name__": "pyobs_portal.settings",
            "__package__": "pyobs_portal",
        }
        with patch.dict(os.environ, env, clear=True):
            exec(compile(text, str(source), "exec"), scope)
        return scope

    def test_database_aliases_and_precedence(self):
        env = dict(
            SQL_ENGINE="django.db.backends.postgresql",
            POSTGRES_DB="pg",
            POSTGRES_USER="pguser",
            POSTGRES_PASSWORD="pgpass",
        )
        db = self.read_settings(**env)["DATABASES"]["default"]
        self.assertEqual(
            (db["NAME"], db["USER"], db["PASSWORD"]), ("pg", "pguser", "pgpass")
        )
        db = self.read_settings(
            **env, SQL_DATABASE="sql", SQL_USER="sqluser", SQL_PASSWORD=""
        )["DATABASES"]["default"]
        self.assertEqual(
            (db["NAME"], db["USER"], db["PASSWORD"]), ("sql", "sqluser", "")
        )
        sqlite = self.read_settings(POSTGRES_DB="ignored")["DATABASES"]["default"]
        self.assertEqual(sqlite["ENGINE"], "django.db.backends.sqlite3")
        self.assertEqual(sqlite["NAME"].name, "db.sqlite3")

    def test_eager_environment(self):
        for value in (None, "0", "1"):
            env = (
                {}
                if value is None
                else dict(
                    CELERY_TASK_ALWAYS_EAGER=value, CELERY_TASK_EAGER_PROPAGATES=value
                )
            )
            settings = self.read_settings(**env)
            self.assertEqual(settings["CELERY_TASK_ALWAYS_EAGER"], value == "1")
            self.assertEqual(settings["CELERY_TASK_EAGER_PROPAGATES"], value == "1")

    def test_scheduler_registers_existing_chores(self):
        from pyobs_portal import task_scheduler

        with patch.object(task_scheduler, "BlockingScheduler") as factory:
            task_scheduler.run()
        scheduler = factory.return_value
        self.assertEqual(scheduler.add_job.call_count, 2)
        scheduler.start.assert_called_once()


class PriorityTests(TestCase):
    def setUp(self):
        self.project = Project.objects.create(code="P", name="Project")
        self.task = Task.objects.create(
            code="T",
            name="Task",
            project=self.project,
            duration=60,
            priority=1,
            script={},
        )
        self.user = User.objects.create_superuser("admin", password="secret")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_serializers_reject_invalid_and_preserve_valid_values(self):
        for serializer, obj in (
            (ProjectSerializer, self.project),
            (TaskSerializer, self.task),
        ):
            for value in (
                -1,
                10000,
                float("nan"),
                float("inf"),
                -float("inf"),
                None,
                "",
                "bad",
            ):
                with self.subTest(serializer=serializer.__name__, value=value):
                    field = serializer(obj, data={"priority": value}, partial=True)
                    self.assertFalse(field.is_valid())
                    self.assertIn("priority", field.errors)
            for value in (0, 0.25, 1, 9999):
                field = serializer(obj, data={"priority": value}, partial=True)
                self.assertTrue(field.is_valid(), field.errors)
                self.assertEqual(field.save().priority, value)

    def test_model_and_database_bounds(self):
        for obj in (self.project, self.task):
            for value in (-1, 10000, float("inf"), float("nan")):
                obj.priority = value
                with self.assertRaises(ValidationError):
                    obj.full_clean(exclude=["script"])
                with self.assertRaises(IntegrityError), transaction.atomic():
                    type(obj).objects.filter(pk=obj.pk).update(priority=value)

    def test_api_create_put_patch(self):
        project_payload = {"code": "NEW", "name": "New", "users": [], "priority": -1}
        self.assertEqual(
            self.client.post(
                "/api/projects/", project_payload, format="json"
            ).status_code,
            400,
        )
        task_payload = dict(
            code="NEW",
            name="New",
            project="P",
            duration=60,
            script={},
            priority=-1,
            constraints=[],
            merits=[],
            target=None,
        )
        self.assertEqual(
            self.client.post(
                "/api/projects/P/tasks/", task_payload, format="json"
            ).status_code,
            400,
        )
        for path, payload in (
            ("/api/projects/P/", {**project_payload, "code": "P"}),
            ("/api/tasks/T/", {**task_payload, "code": "T"}),
        ):
            for method in (self.client.put, self.client.patch):
                before = self.client.get("/api/last_task_update/").data
                self.assertEqual(method(path, payload, format="json").status_code, 400)
                self.assertEqual(self.client.get("/api/last_task_update/").data, before)
            self.assertEqual(
                self.client.patch(path, {"priority": 0}, format="json").status_code, 200
            )

    def test_migration_preflight_uses_historical_data_without_repair(self):
        migration = importlib.import_module(
            "pyobs_portal.api.migrations.0011_alter_project_priority_alter_task_priority_and_more"
        )
        from unittest.mock import Mock

        apps, editor = Mock(), Mock()
        rows = apps.get_model.return_value.objects.using.return_value
        rows.values_list.return_value.iterator.return_value = iter(
            [("BAD", -1), ("OK", 1)]
        )
        with self.assertRaisesRegex(RuntimeError, "Project: 1 invalid priorities.*BAD"):
            migration.check_legacy_priorities(apps, editor)
        rows.update.assert_not_called()


class CancelObservationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("member", password="secret")
        self.project = Project.objects.create(code="P", name="Project")
        self.project.users.add(self.user)
        self.task = Task.objects.create(
            code="T",
            name="Task",
            project=self.project,
            duration=60,
            priority=1,
            script={},
        )
        self.now = timezone.now()
        self.obs = Observation.objects.create(
            task=self.task,
            start=self.now,
            end=self.now + timedelta(minutes=1),
            state="pending",
        )
        self.url = f"/api/observations/{self.obs.pk}/cancel/"
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_cancel_idempotency_and_marker(self):
        previous = self.obs.updated_at
        self.assertEqual(self.client.get(self.url).status_code, 405)
        self.assertEqual(self.client.post(self.url).status_code, 200)
        self.obs.refresh_from_db()
        self.assertEqual(self.obs.state, "canceled")
        self.assertGreater(self.obs.updated_at, previous)
        updated = self.obs.updated_at
        self.assertEqual(self.client.post(self.url).status_code, 200)
        self.obs.refresh_from_db()
        self.assertEqual(updated, self.obs.updated_at)
        self.assertEqual(
            self.client.get("/api/last_observation_update/").status_code, 200
        )

    def test_nonpending_conflicts(self):
        for state in (
            "in_progress",
            "completed",
            "aborted",
            "failed",
            "window_expired",
        ):
            Observation.objects.filter(pk=self.obs.pk).update(state=state)
            result = self.client.post(self.url)
            self.assertEqual(result.status_code, 409)
            self.obs.refresh_from_db()
            self.assertEqual(self.obs.state, state)

    def test_project_access_and_authentication(self):
        self.project.users.clear()
        self.assertEqual(self.client.post(self.url).status_code, 404)
        self.project.public = True
        self.project.save()
        self.assertEqual(self.client.post(self.url).status_code, 200)
        self.project.public = False
        self.project.save()
        self.user.is_superuser = True
        self.user.save()
        self.assertEqual(self.client.post(self.url).status_code, 200)
        self.client.force_authenticate(None)
        self.assertIn(self.client.post(self.url).status_code, (401, 403))

    def test_session_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.login(username="member", password="secret")
        self.assertEqual(client.post(self.url).status_code, 403)
        from django.middleware.csrf import _get_new_csrf_string

        token = _get_new_csrf_string()
        from django.conf import settings

        client.cookies[settings.CSRF_COOKIE_NAME] = token
        self.assertEqual(client.post(self.url, HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_worker_start_between_lookup_and_update(self):
        from . import views

        original = views.get_object_or_404

        def lookup(*args, **kwargs):
            row = original(*args, **kwargs)
            if row.state == "pending":
                Observation.objects.filter(pk=row.pk).update(state="in_progress")
            return row

        with patch.object(views, "get_object_or_404", side_effect=lookup):
            self.assertEqual(self.client.post(self.url).status_code, 409)
        self.obs.refresh_from_db()
        self.assertEqual(self.obs.state, "in_progress")

    def test_deactivation_api_cancels_pending(self):
        self.assertEqual(
            self.client.patch(
                "/api/tasks/T/", {"active": False}, format="json"
            ).status_code,
            200,
        )
        self.obs.refresh_from_db()
        self.assertEqual(self.obs.state, "canceled")

    @override_settings(CELERY_TASK_ALWAYS_EAGER=True, CELERY_TASK_EAGER_PROPAGATES=True)
    def test_eager_cleanup_without_broker(self):
        Observation.objects.filter(pk=self.obs.pk).update(
            start=self.now - timedelta(minutes=2), end=self.now - timedelta(minutes=1)
        )
        old = Observation.objects.create(
            task=self.task,
            start=self.now - timedelta(days=20),
            end=self.now - timedelta(days=19),
            state="canceled",
        )
        with patch(
            "kombu.Connection.connect",
            side_effect=AssertionError("broker connection attempted"),
        ):
            mark_window_expired.delay().get()
            delete_old_observations.delay().get()
        self.obs.refresh_from_db()
        self.assertEqual(self.obs.state, "window_expired")
        self.assertFalse(Observation.objects.filter(pk=old.pk).exists())


class PriorityMigrationTests(TransactionTestCase):
    """Exercise the preflight against real legacy rows and a retry after repair."""

    def test_invalid_legacy_rows_fail_then_repair(self):
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor

        before = [("api", "0010_observation_priority")]
        after = [("api", "0011_alter_project_priority_alter_task_priority_and_more")]
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        legacy = executor.loader.project_state(before).apps
        project_model = legacy.get_model("api", "Project")
        task_model = legacy.get_model("api", "Task")
        project = project_model.objects.create(
            code="LEGACY", name="Legacy", priority=-1
        )
        task_model.objects.create(
            code="LEGACY",
            name="Legacy",
            project=project,
            duration=60,
            priority=10000,
            script={},
        )
        try:
            with self.assertRaisesRegex(
                RuntimeError,
                "Project: 1 invalid priorities.*Task: 1 invalid priorities",
            ):
                MigrationExecutor(connection).migrate(after)
            self.assertEqual(project_model.objects.get(pk="LEGACY").priority, -1)
            project_model.objects.filter(pk="LEGACY").update(priority=0)
            task_model.objects.filter(pk="LEGACY").update(priority=9999)
            MigrationExecutor(connection).migrate(after)
            self.assertEqual(Project.objects.get(pk="LEGACY").priority, 0)
            self.assertEqual(Task.objects.get(pk="LEGACY").priority, 9999)
        finally:
            project_model.objects.filter(pk="LEGACY").update(priority=0)
            task_model.objects.filter(pk="LEGACY").update(priority=1)
            MigrationExecutor(connection).migrate(after)
