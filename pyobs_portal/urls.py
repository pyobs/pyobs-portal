"""
URL configuration for pyobs_portal project.

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

from django.conf import settings
from django.contrib import admin
from django.urls import path, include
from rest_framework.authtoken import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("pyobs_portal.api.urls")),
    path("api-token-auth/", views.obtain_auth_token),
]

if settings.FRONTEND_ENABLED:
    urlpatterns += [
        path("", include("pyobs_portal.frontend.urls")),
        path("accounts/keycloak/", include("pyobs_auth.urls")),
    ]
