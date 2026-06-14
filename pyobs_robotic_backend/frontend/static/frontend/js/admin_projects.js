async function loadProjects() {
  const tbody = document.getElementById("projects-table");
  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Loading…</td></tr>';
  try {
    const projects = await apiList("projects/");
    tbody.innerHTML = "";
    projects.forEach((project) => {
      const tr = document.createElement("tr");

      const codeTd = document.createElement("td");
      codeTd.className = "ps-3";
      codeTd.textContent = project.code;
      tr.appendChild(codeTd);

      const nameTd = document.createElement("td");
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "form-control form-control-sm";
      nameInput.value = project.name;
      nameTd.appendChild(nameInput);
      tr.appendChild(nameTd);

      const priorityTd = document.createElement("td");
      const priorityInput = document.createElement("input");
      priorityInput.type = "number";
      priorityInput.step = "any";
      priorityInput.className = "form-control form-control-sm";
      priorityInput.value = project.priority;
      priorityTd.appendChild(priorityInput);
      tr.appendChild(priorityTd);

      const usersTd = document.createElement("td");
      const usersInput = document.createElement("input");
      usersInput.type = "text";
      usersInput.className = "form-control form-control-sm";
      usersInput.value = (project.users || []).join(", ");
      usersTd.appendChild(usersInput);
      tr.appendChild(usersTd);

      const actionsTd = document.createElement("td");
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-sm btn-outline-secondary";
      saveBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
      const statusSpan = document.createElement("span");
      statusSpan.className = "small ms-2";

      saveBtn.addEventListener("click", async () => {
        const payload = {
          code: project.code,
          name: nameInput.value,
          priority: Number(priorityInput.value),
          users: usersInput.value
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean),
        };
        statusSpan.textContent = "Saving…";
        statusSpan.className = "small ms-2 text-secondary";
        try {
          await apiRequest(`projects/${encodeURIComponent(project.code)}/`, { method: "PATCH", body: payload });
          statusSpan.textContent = "✓ Saved";
          statusSpan.className = "small ms-2 text-success";
        } catch (e) {
          statusSpan.textContent = `✗ ${e.message}`;
          statusSpan.className = "small ms-2 text-danger";
        }
      });

      actionsTd.appendChild(saveBtn);
      actionsTd.appendChild(statusSpan);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${e.message}</td></tr>`;
  }
}

document.getElementById("btn-add-project").addEventListener("click", async () => {
  const status = document.getElementById("new-project-status");
  const payload = {
    code: document.getElementById("new-code").value,
    name: document.getElementById("new-name").value,
    priority: Number(document.getElementById("new-priority").value || 1),
    users: document
      .getElementById("new-users")
      .value.split(",")
      .map((u) => u.trim())
      .filter(Boolean),
  };
  if (!payload.code || !payload.name) {
    status.textContent = "Code and name are required.";
    status.className = "small mt-2 text-danger";
    return;
  }
  status.textContent = "Saving…";
  status.className = "small mt-2 text-secondary";
  try {
    await apiRequest("projects/", { method: "POST", body: payload });
    document.getElementById("new-code").value = "";
    document.getElementById("new-name").value = "";
    document.getElementById("new-priority").value = "1";
    document.getElementById("new-users").value = "";
    status.textContent = "✓ Added";
    status.className = "small mt-2 text-success";
    loadProjects();
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "small mt-2 text-danger";
  }
});

loadProjects();
