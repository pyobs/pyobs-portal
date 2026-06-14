async function loadTasks(showInactive) {
  const container = document.getElementById("task-groups");
  container.innerHTML = '<p class="text-muted">Loading…</p>';

  try {
    const params = showInactive ? { all: "true" } : {};
    const [tasks, projects] = await Promise.all([apiList("tasks/", params), apiList("projects/")]);

    const projectsByCode = {};
    projects.forEach((p) => (projectsByCode[p.code] = p));

    const byProject = {};
    tasks.forEach((t) => {
      (byProject[t.project] = byProject[t.project] || []).push(t);
    });

    container.innerHTML = "";
    if (!tasks.length) {
      container.innerHTML = '<p class="text-muted">No tasks.</p>';
      return;
    }

    Object.keys(byProject)
      .sort()
      .forEach((code) => {
        const project = projectsByCode[code];
        const card = document.createElement("div");
        card.className = "card border-secondary mb-3";

        const header = document.createElement("div");
        header.className = "card-header";
        header.textContent = project ? `${project.name} (${project.code})` : code;
        card.appendChild(header);

        const body = document.createElement("div");
        body.className = "card-body p-0";
        const table = document.createElement("table");
        table.className = "table table-sm table-hover mb-0";
        table.innerHTML = `
          <thead>
            <tr class="text-muted small">
              <th class="ps-3">Code</th>
              <th>Name</th>
              <th>Duration (s)</th>
              <th>Priority</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        const tbody = table.querySelector("tbody");

        byProject[code]
          .sort((a, b) => a.id.localeCompare(b.id))
          .forEach((task) => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.innerHTML = `
              <td class="ps-3">${task.id}</td>
              <td>${task.name || ""}</td>
              <td>${task.duration}</td>
              <td>${task.priority}</td>
              <td>${task.active ? '<i class="bi bi-check-circle text-success"></i>' : '<i class="bi bi-dash-circle text-muted"></i>'}</td>
            `;
            tr.addEventListener("click", () => {
              window.location.href = `/tasks/${encodeURIComponent(task.id)}/`;
            });
            tbody.appendChild(tr);
          });

        body.appendChild(table);
        card.appendChild(body);
        container.appendChild(card);
      });
  } catch (e) {
    container.innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

document.getElementById("show-inactive").addEventListener("change", (e) => loadTasks(e.target.checked));
loadTasks(false);
