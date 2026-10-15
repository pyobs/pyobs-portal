"""Keep deployment-local settings out of built distributions."""

from setuptools import setup
from setuptools.command.build_py import build_py


class PublicBuild(build_py):
    def find_package_modules(self, package, package_dir):
        return [
            item
            for item in super().find_package_modules(package, package_dir)
            if not (item[0] == "pyobs_portal" and item[1] == "local_settings")
        ]


setup(cmdclass={"build_py": PublicBuild})
