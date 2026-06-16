const selectedTasks = new Set();

function updateBulkBar() {
  const n = selectedTasks.size;
  const bar = document.getElementById("bulk-bar");
  bar.classList.toggle("d-none", n === 0);
  document.getElementById("bulk-count").textContent = `${n} task${n === 1 ? "" : "s"} selected`;
}

async function bulkSetActive(active) {
  const ids = [...selectedTasks];
  await Promise.all(ids.map((id) => apiRequest(`tasks/${encodeURIComponent(id)}/`, { method: "PATCH", body: { active } })));
  loadTasks(document.getElementById("show-inactive").checked);
}

async function loadTasks(showInactive) {
  const container = document.getElementById("task-groups");
  container.innerHTML = '<p class="text-muted">Loading…</p>';
  selectedTasks.clear();
  updateBulkBar();

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
        table.style.tableLayout = "fixed";
        table.innerHTML = `
          <colgroup>
            <col style="width:3%">
            <col style="width:12%">
            <col style="width:44%">
            <col style="width:14%">
            <col style="width:14%">
            <col style="width:13%">
          </colgroup>
          <thead>
            <tr class="text-muted small">
              <th class="ps-3"><input type="checkbox" class="form-check-input select-all-cb"></th>
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
        const selectAll = table.querySelector(".select-all-cb");

        byProject[code]
          .sort((a, b) => a.id.localeCompare(b.id))
          .forEach((task) => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            if (!task.active) tr.classList.add("text-muted", "opacity-50");
            tr.innerHTML = `
              <td class="ps-3"></td>
              <td class="ps-3">${task.id}</td>
              <td>${task.name || ""}</td>
              <td>${task.duration}</td>
              <td>${task.priority}</td>
              <td>${task.active ? '<i class="bi bi-check-circle text-success"></i>' : '<i class="bi bi-dash-circle text-muted"></i>'}</td>
            `;

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "form-check-input";
            cb.dataset.taskId = task.id;
            tr.firstElementChild.appendChild(cb);

            cb.addEventListener("click", (e) => e.stopPropagation());
            cb.addEventListener("change", () => {
              if (cb.checked) selectedTasks.add(task.id);
              else selectedTasks.delete(task.id);
              updateBulkBar();
              const all = [...tbody.querySelectorAll("input[type=checkbox]")];
              selectAll.checked = all.every((c) => c.checked);
              selectAll.indeterminate = !selectAll.checked && all.some((c) => c.checked);
            });

            tr.addEventListener("click", () => {
              window.location.href = `/tasks/${encodeURIComponent(task.id)}/`;
            });
            tbody.appendChild(tr);
          });

        selectAll.addEventListener("change", () => {
          tbody.querySelectorAll("input[type=checkbox]").forEach((cb) => {
            cb.checked = selectAll.checked;
            if (selectAll.checked) selectedTasks.add(cb.dataset.taskId);
            else selectedTasks.delete(cb.dataset.taskId);
          });
          updateBulkBar();
        });

        body.appendChild(table);
        card.appendChild(body);
        container.appendChild(card);
      });
  } catch (e) {
    container.innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

document.getElementById("btn-bulk-activate").addEventListener("click", () => bulkSetActive(true));
document.getElementById("btn-bulk-deactivate").addEventListener("click", () => bulkSetActive(false));

const showInactiveToggle = document.getElementById("show-inactive");
showInactiveToggle.checked = true;
showInactiveToggle.addEventListener("change", (e) => loadTasks(e.target.checked));
loadTasks(true);
