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
    path("projects/", views.ProjectList.as_view()),
    path("projects/<int:pk>/", views.ProjectDetail.as_view()),
    path("projects/<int:pk>/tasks/", views.TaskListForProject.as_view()),
    path("tasks/", views.TaskList.as_view()),
    path("tasks/<int:pk>/", views.TaskDetail.as_view()),
    path("tasks/<int:pk>/observations/", views.ObservationListForTask.as_view()),
    path("observations/", views.ObservationList.as_view()),
    path("observations/<int:pk>/", views.ObservationDetail.as_view()),
    path("cancel_observations/", views.CancelObservations.as_view()),
]

urlpatterns = format_suffix_patterns(urlpatterns)
