async function loadUsers() {
  const tbody = document.getElementById("users-table");
  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Loading…</td></tr>';
  try {
    const users = await apiList("users/");
    tbody.innerHTML = "";
    users.forEach((user) => {
      const tr = document.createElement("tr");

      const usernameTd = document.createElement("td");
      usernameTd.className = "ps-3";
      usernameTd.textContent = user.username;
      tr.appendChild(usernameTd);

      const emailTd = document.createElement("td");
      const emailInput = document.createElement("input");
      emailInput.type = "email";
      emailInput.className = "form-control form-control-sm";
      emailInput.value = user.email || "";
      emailTd.appendChild(emailInput);
      tr.appendChild(emailTd);

      const passwordTd = document.createElement("td");
      const passwordInput = document.createElement("input");
      passwordInput.type = "password";
      passwordInput.className = "form-control form-control-sm";
      passwordInput.placeholder = "(unchanged)";
      passwordTd.appendChild(passwordInput);
      tr.appendChild(passwordTd);

      const superuserTd = document.createElement("td");
      const superuserInput = document.createElement("input");
      superuserInput.type = "checkbox";
      superuserInput.className = "form-check-input";
      superuserInput.checked = !!user.is_superuser;
      superuserTd.appendChild(superuserInput);
      tr.appendChild(superuserTd);

      const actionsTd = document.createElement("td");
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-sm btn-outline-secondary";
      saveBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
      const statusSpan = document.createElement("span");
      statusSpan.className = "small ms-2";

      saveBtn.addEventListener("click", async () => {
        const payload = {
          username: user.username,
          email: emailInput.value,
          is_superuser: superuserInput.checked,
        };
        if (passwordInput.value) payload.password = passwordInput.value;
        statusSpan.textContent = "Saving…";
        statusSpan.className = "small ms-2 text-secondary";
        try {
          await apiRequest(`users/${user.id}/`, { method: "PATCH", body: payload });
          passwordInput.value = "";
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

document.getElementById("btn-add-user").addEventListener("click", async () => {
  const status = document.getElementById("new-user-status");
  const payload = {
    username: document.getElementById("new-username").value,
    email: document.getElementById("new-email").value,
    password: document.getElementById("new-password").value,
    is_superuser: document.getElementById("new-superuser").checked,
  };
  if (!payload.username) {
    status.textContent = "Username is required.";
    status.className = "small mt-2 text-danger";
    return;
  }
  status.textContent = "Saving…";
  status.className = "small mt-2 text-secondary";
  try {
    await apiRequest("users/", { method: "POST", body: payload });
    document.getElementById("new-username").value = "";
    document.getElementById("new-email").value = "";
    document.getElementById("new-password").value = "";
    document.getElementById("new-superuser").checked = false;
    status.textContent = "✓ Added";
    status.className = "small mt-2 text-success";
    loadUsers();
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "small mt-2 text-danger";
  }
});

loadUsers();
