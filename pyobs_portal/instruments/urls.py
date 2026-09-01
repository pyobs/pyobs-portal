from django.urls import path

from . import views

urlpatterns = [
    path("", views.InstrumentList.as_view()),
    path("cameras/<str:code>/", views.CameraCapabilityDetail.as_view()),
    path("<str:module_name>/", views.InstrumentDetail.as_view()),
]
