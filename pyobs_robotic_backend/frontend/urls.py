from django.urls import path

from . import views

app_name = "frontend"

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("tasks/", views.task_list, name="task_list"),
    path("tasks/new/", views.task_new, name="task_new"),
    path("tasks/<str:pk>/", views.task_detail, name="task_detail"),
    path("admin-panel/users/", views.admin_users, name="admin_users"),
    path("admin-panel/projects/", views.admin_projects, name="admin_projects"),
]
