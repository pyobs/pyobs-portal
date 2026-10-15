"""Build/install public artifacts from a disposable tree; never copy real local settings."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="portal-packaging-") as scratch:
        scratch = Path(scratch)
        tree = scratch / "source"
        shutil.copytree(
            root,
            tree,
            ignore=shutil.ignore_patterns(
                ".git",
                ".venv",
                "node_modules",
                "dist",
                "build",
                "*.egg-info",
                "__pycache__",
                ".env*",
                "local_settings.py",
                "*.sqlite3",
                "collected-static",
            ),
        )
        (tree / "pyobs_portal/local_settings.py").write_text(
            "PRIVATE_SENTINEL = 'must-not-ship'\n"
        )
        artifacts = scratch / "artifacts"
        run("uv", "build", str(tree), "--out-dir", str(artifacts))
        wheel = next(artifacts.glob("*.whl"))
        sdist = next(artifacts.glob("*.tar.gz"))
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            assert not any(
                "local_settings.py" in name or name.endswith(".sqlite3")
                for name in names
            )
            assert "pyobs_portal/frontend/templates/frontend/task_detail.html" in names
            assert "pyobs_portal/frontend/static/frontend/js/taskeditor.js" in names
            assert any("api/migrations/0011" in name for name in names)
            metadata = archive.read(
                next(n for n in names if n.endswith(".dist-info/METADATA"))
            ).decode()
            assert "Requires-Dist: pyobs-core[full]" in metadata
        with tarfile.open(sdist) as archive:
            assert not any(n.endswith("/local_settings.py") for n in archive.getnames())
            assert any(n.endswith("/manage.py") for n in archive.getnames())
        run("uv", "build", "--wheel", str(sdist), "--out-dir", str(scratch / "rebuilt"))
        run("uv", "venv", "--python", sys.executable, str(scratch / "editable"))
        run(
            "uv",
            "pip",
            "install",
            "--python",
            str(scratch / "editable/bin/python"),
            "--no-deps",
            "-e",
            str(tree),
        )
        run(
            "uv",
            "pip",
            "install",
            "--python",
            str(scratch / "editable/bin/python"),
            "pip",
        )
        run(
            str(scratch / "editable/bin/python"),
            "-m",
            "pip",
            "install",
            "--no-deps",
            "-e",
            str(tree),
        )
        installed = scratch / "installed"
        run("uv", "pip", "install", "--no-deps", "--target", str(installed), str(wheel))
        env = {
            **os.environ,
            "PYTHONPATH": str(installed),
            "DJANGO_SETTINGS_MODULE": "pyobs_portal.settings",
            "SQL_ENGINE": "django.db.backends.sqlite3",
            "SQL_DATABASE": str(scratch / "db.sqlite3"),
            "ENABLE_FRONTEND": "1",
            "STATIC_ROOT": str(scratch / "static"),
            "DEBUG": "1",
        }
        probe = """import pathlib, django, pyobs_portal
assert pathlib.Path(pyobs_portal.__file__).is_relative_to(pathlib.Path(__import__('os').environ['PYTHONPATH']))
django.setup()
from django.core.management import call_command
from django.template.loader import get_template
from django.contrib.staticfiles import finders
from pyobs_portal.api import schema
get_template('frontend/task_detail.html')
assert finders.find('frontend/js/taskeditor.js')
call_command('check')
call_command('migrate', interactive=False, verbosity=0)
call_command('collectstatic', interactive=False, verbosity=0)
"""
        run(sys.executable, "-c", probe, cwd=scratch, env=env)


if __name__ == "__main__":
    main()
