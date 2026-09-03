from django.urls import path

from . import views

urlpatterns = [
    path("", views.InstrumentList.as_view()),
    path("cameras/<str:code>/", views.CameraCapabilityDetail.as_view()),
    path("last_instrument_update/", views.last_instrument_update),
]
