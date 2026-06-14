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
from rest_framework.urlpatterns import format_suffix_patterns

from pyobs_robotic_backend.api import views

urlpatterns = [
    path("users/", views.UserList.as_view()),
    path("users/<int:pk>/", views.UserDetail.as_view()),
    path("projects/", views.ProjectList.as_view()),
    path("projects/<str:pk>/", views.ProjectDetail.as_view()),
    path("projects/<str:pk>/tasks/", views.TaskListForProject.as_view()),
    path("tasks/", views.TaskList.as_view()),
    path("tasks/<str:pk>/", views.TaskDetail.as_view()),
    path("tasks/<str:pk>/observations/", views.ObservationListForTask.as_view()),
    path("observations/", views.ObservationList.as_view()),
    path("observations/<int:pk>/", views.ObservationDetail.as_view()),
    path("cancel_observations/", views.CancelObservations.as_view()),
    path("me/", views.me),
    path("last_task_update/", views.last_task_update),
    path("last_observation_update/", views.last_observation_update),
    path("schema/constraints/", views.schema_constraints),
    path("schema/merits/", views.schema_merits),
    path("schema/targets/", views.schema_targets),
    path("schema/scripts/", views.schema_scripts),
    path("validate_script/", views.validate_script),
    path("estimate_duration/", views.estimate_duration),
]

urlpatterns = format_suffix_patterns(urlpatterns)
