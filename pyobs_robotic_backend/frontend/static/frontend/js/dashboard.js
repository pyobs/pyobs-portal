async function loadDashboard() {
  try {
    const [projects, tasks] = await Promise.all([apiList("projects/"), apiList("tasks/")]);

    document.getElementById("stat-projects").textContent = projects.length;
    document.getElementById("stat-tasks").textContent = tasks.length;

    const tbody = document.getElementById("projects-table");
    tbody.innerHTML = "";
    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No projects.</td></tr>';
    } else {
      projects.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${p.code}</td><td>${p.name}</td><td>${p.priority}</td>`;
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    document.getElementById("projects-table").innerHTML =
      `<tr><td colspan="3" class="text-danger">${e.message}</td></tr>`;
  }

  try {
    const [pending, completed] = await Promise.all([
      apiList("observations/", { state: "pending" }),
      apiList("observations/", { state: "completed" }),
    ]);
    document.getElementById("stat-pending").textContent = pending.length;
    document.getElementById("stat-completed").textContent = completed.length;
  } catch (e) {
    /* observation stats are best-effort */
  }
}

loadDashboard();
