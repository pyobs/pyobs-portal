"""
URL configuration for pyobs_robotic_backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path

from pyobs_robotic_backend.api import views

urlpatterns = [
    path("tasks/", views.get_tasks, name="list_tasks"),
    path("tasks/{task_id}", views.get_task, name="task_details"),
    path(
        "tasks/{task_id}/observations",
        views.get_observations_for_task,
        name="task_observations",
    ),
    path("tasks/", views.add_task, name="add_task"),
    path("/observations", views.get_observations, name="list_observations"),
    path("/observations", views.add_or_update_observation, name="add_observation"),
    path("/observations/cancel", views.cancel_observations, name="cancel_observations"),
]
