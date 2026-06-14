from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required, user_passes_test
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods


def login_view(request):
    error = False
    if request.method == "POST":
        username = request.POST.get("username", "")
        password = request.POST.get("password", "")
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            return redirect(request.POST.get("next") or "frontend:dashboard")
        error = True
    return render(
        request,
        "registration/login.html",
        {"error": error, "next": request.GET.get("next", "")},
    )


@require_http_methods(["POST"])
def logout_view(request):
    logout(request)
    return redirect("frontend:login")


@login_required
def dashboard(request):
    return render(request, "frontend/dashboard.html", {"active": "dashboard"})


@login_required
def task_list(request):
    return render(request, "frontend/tasks_list.html", {"active": "tasks"})


@login_required
def task_detail(request, pk: str):
    return render(request, "frontend/task_detail.html", {"task_id": pk, "active": "tasks"})


@login_required
def task_new(request):
    return render(request, "frontend/task_detail.html", {"task_id": None, "active": "tasks"})


def _is_superuser(user) -> bool:
    return user.is_authenticated and user.is_superuser


@user_passes_test(_is_superuser, login_url="frontend:login")
def admin_users(request):
    return render(request, "frontend/admin_users.html", {"active": "admin_users"})


@user_passes_test(_is_superuser, login_url="frontend:login")
def admin_projects(request):
    return render(request, "frontend/admin_projects.html", {"active": "admin_projects"})
