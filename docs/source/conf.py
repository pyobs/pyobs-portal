# Configuration file for the Sphinx documentation builder.
#
# This file does only contain a selection of the most common options. For a
# full list see the documentation:
# http://www.sphinx-doc.org/en/stable/config

# -- Path setup --------------------------------------------------------------

import os
import sys

sys.path.insert(0, os.path.abspath("../../"))

# -- Django --------------------
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pyobs_portal.settings")
django.setup()

# -- Project information -----------------------------------------------------

project = "pyobs-portal"
copyright = "2026, Tim-Oliver Husser"
author = "Tim-Oliver Husser"

# -- General configuration ---------------------------------------------------

add_module_names = False

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.githubpages",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx.ext.autosectionlabel",
]

# napoleon settings
napoleon_google_docstring = True
napoleon_numpy_docstring = False
napoleon_use_param = False
napoleon_use_ivar = True

# show c'tor parameters in class only
autoclass_content = "both"

# Add any paths that contain templates here, relative to this directory.
templates_path = ["_templates"]

source_suffix = ".rst"
master_doc = "index"
language = "en"
exclude_patterns = []
pygments_style = "sphinx"

# Be a little nitpicky
nitpicky = True
nitpick_ignore = []

# -- Options for HTML output -------------------------------------------------

html_theme = "sphinx_rtd_theme"
html_theme_options = {
    "collapse_navigation": False,
    "sticky_navigation": True,
    "navigation_depth": 4,
    "display_version": False,
    "logo_only": False,
    "prev_next_buttons_location": "bottom",
    "titles_only": False,
    "style_nav_header_background": "#cccccc",
}
html_logo = "_static/pyobs.gif"
