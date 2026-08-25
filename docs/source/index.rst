pyobs-portal
############

Backend service for the `pyobs <https://www.pyobs.org>`_ robotic telescope system. It stores and
serves the task queue (observations to be scheduled), projects, and observation history consumed
by the pyobs scheduler and related tools — via a REST API, a Django admin panel, and (optionally)
a built-in Bootstrap web frontend for browsing and editing tasks.

.. toctree::
   :maxdepth: 1

   installation
   configuration
   architecture
   api
   frontend
   development
