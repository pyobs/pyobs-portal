/**
 * Task detail / edit page.
 *
 * Wires the generic SchemaForm + TypedListEditor + ScriptEditor pieces
 * together against a single Task object, using the same /api/ endpoints
 * pyobs-task-editor talks to.
 */

const CONSTRAINT_PREFIX = "pyobs.robotic.scheduler.constraints.";
const MERIT_PREFIX = "pyobs.robotic.scheduler.merits.";
const TARGET_PREFIX = "pyobs.robotic.scheduler.targets.";

const IGNORED_TASK_FIELDS = new Set(["cost", "target_dependent", "exptime_done"]);

function classToType(klass, prefix) {
  if (!klass) return null;
  return klass.startsWith(prefix) ? klass.slice(prefix.length) : klass.split(".").pop();
}

/** A list of typed, schema-driven items (constraints or merits). */
class TypedListEditor {
  constructor(container, schemas, prefix, items) {
    this.schemas = schemas;
    this.prefix = prefix;
    this.entries = [];

    this.listEl = document.createElement("div");
    this.listEl.className = "d-flex flex-column gap-2 mb-2";
    container.appendChild(this.listEl);

    (items || []).forEach((item) => this._addItem(item));
    this._buildAddControl(container);
  }

  _addItem(data) {
    const klass = data.class;
    const type = classToType(klass, this.prefix);
    const schema = this.schemas[type];

    const card = document.createElement("div");
    card.className = "card bg-body-tertiary border-secondary-subtle mb-0";
    const body = document.createElement("div");
    body.className = "card-body p-2";

    const header = document.createElement("div");
    header.className = "d-flex justify-content-between align-items-center mb-2";
    const titleEl = document.createElement("span");
    titleEl.className = "fw-semibold small";
    titleEl.textContent = type || klass || "(unknown)";
    header.appendChild(titleEl);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-outline-danger";
    removeBtn.innerHTML = '<i class="bi bi-trash"></i>';
    header.appendChild(removeBtn);
    body.appendChild(header);

    let form = null;
    if (schema) {
      const rest = { ...data };
      delete rest.class;
      form = new SchemaForm(schema, schema.$defs || {}, rest, { ignoredFields: IGNORED_TASK_FIELDS });
      body.appendChild(form.element);
    } else {
      const warn = document.createElement("p");
      warn.className = "text-warning small mb-0";
      warn.textContent = `Unknown type: ${klass}`;
      body.appendChild(warn);
    }
    card.appendChild(body);
    this.listEl.appendChild(card);

    const entry = { klass, form };
    removeBtn.addEventListener("click", () => {
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
      card.remove();
      this._refreshSelect();
    });
    this.entries.push(entry);
    this._refreshSelect();
  }

  _refreshSelect() {
    if (!this.select) return;
    const used = new Set(this.entries.map((e) => classToType(e.klass, this.prefix)));
    this.select.innerHTML = "";
    Object.keys(this.schemas)
      .sort()
      .filter((name) => !used.has(name))
      .forEach((name) => {
        const o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        this.select.appendChild(o);
      });
    this.addRow.classList.toggle("d-none", this.select.options.length === 0);
  }

  _buildAddControl(container) {
    this.addRow = document.createElement("div");
    this.addRow.className = "d-flex gap-2";

    this.select = document.createElement("select");
    this.select.className = "form-select form-select-sm w-auto";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-sm btn-outline-secondary";
    addBtn.innerHTML = '<i class="bi bi-plus"></i> Add';
    addBtn.addEventListener("click", () => {
      if (!this.select.value) return;
      this._addItem({ class: this.prefix + this.select.value });
    });

    this.addRow.appendChild(this.select);
    this.addRow.appendChild(addBtn);
    container.appendChild(this.addRow);
    this._refreshSelect();
  }

  getData() {
    return this.entries.map((e) => ({ class: e.klass, ...(e.form ? e.form.getData() : {}) }));
  }
}

/** Single, optional, typed target (sidereal / dynamic / ...). */
class TargetEditor {
  constructor(container, schemas, data) {
    this.schemas = schemas;
    this.type = data ? classToType(data.class, TARGET_PREFIX) : null;

    this.select = document.createElement("select");
    this.select.className = "form-select form-select-sm w-auto mb-2";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(no target)";
    this.select.appendChild(noneOpt);
    Object.keys(schemas)
      .sort()
      .forEach((name) => {
        const o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        this.select.appendChild(o);
      });
    this.select.value = this.type || "";
    container.appendChild(this.select);

    this.formContainer = document.createElement("div");
    container.appendChild(this.formContainer);

    this._render(this.type, data);
    this.select.addEventListener("change", () => this._render(this.select.value || null, null));
  }

  _render(type, data) {
    this.formContainer.innerHTML = "";
    this.type = type;
    this.form = null;
    document.getElementById("aladin-container")?.classList.add("d-none");
    if (!type) return;
    const schema = this.schemas[type];
    if (!schema) return;
    const rest = data ? { ...data } : {};
    delete rest.class;
    this.form = new SchemaForm(schema, schema.$defs || {}, rest, { ignoredFields: IGNORED_TASK_FIELDS });
    this.formContainer.appendChild(this.form.element);

    if (type === "SiderealTarget") {
      this._makeCoordsFlexible();
      this._injectSimbadButton();
      this._initAladin();
    }
  }

  _initAladin() {
    const container = document.getElementById("aladin-container");
    if (!container || typeof A === "undefined") return;
    container.classList.remove("d-none");
    if (!this._aladin) {
      this._aladin = A.aladin(container, {
        survey: "P/DSS2/color",
        fov: 0.25,
        showReticle: true,
        showZoomControl: true,
        showFullscreenControl: false,
      });
    }
    this._updateAladin();
  }

  _updateAladin() {
    if (!this._aladin || !this.form) return;
    const ra = this.form.fields["ra"]?.getValue();
    const dec = this.form.fields["dec"]?.getValue();
    const raDeg = typeof ra === "number" ? ra : parseHmsToDeg(String(ra ?? ""));
    const decDeg = typeof dec === "number" ? dec : parseDmsToDeg(String(dec ?? ""));
    if (raDeg !== null && decDeg !== null) {
      this._aladin.gotoRaDec(raDeg, decDeg);
    }
  }

  _makeCoordsFlexible() {
    for (const fieldName of ["ra", "dec"]) {
      const field = this.form.fields[fieldName];
      if (!field) continue;
      const numInput = field.rowEl.querySelector("input[type=number]");
      if (!numInput) continue;

      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = numInput.className;
      textInput.placeholder = fieldName === "ra" ? "deg or hms (15:52:56.1)" : "deg or dms (+12:54:44)";
      const initDeg = Number(numInput.value);
      if (!isNaN(initDeg) && numInput.value !== "") {
        textInput.value = fieldName === "ra" ? degToHms(initDeg) : degToDms(initDeg);
      } else {
        textInput.value = numInput.value;
      }
      numInput.replaceWith(textInput);

      const hint = document.createElement("div");
      hint.className = "small text-secondary mt-1";
      field.rowEl.appendChild(hint);

      const parse = fieldName === "ra" ? parseHmsToDeg : parseDmsToDeg;
      const updateHint = () => {
        const v = textInput.value.trim();
        if (!v || !isNaN(Number(v))) { hint.textContent = ""; return; }
        const deg = parse(v);
        hint.textContent = deg !== null ? `= ${deg.toFixed(6)}°` : "";
      };
      textInput.addEventListener("input", updateHint);
      textInput.addEventListener("input", () => this._updateAladin());
      updateHint();

      field.getValue = () => {
        const v = textInput.value.trim();
        const n = Number(v);
        return isNaN(n) || v === "" ? v : n;
      };
    }
  }

  _injectSimbadButton() {
    const nameField = this.form.fields["name"];
    if (!nameField) return;
    const nameInput = nameField.rowEl.querySelector("input");
    if (!nameInput) return;

    const group = document.createElement("div");
    group.className = "input-group input-group-sm";
    nameInput.classList.remove("form-control-sm");
    nameInput.parentNode.insertBefore(group, nameInput);
    group.appendChild(nameInput);

    const statusEl = document.createElement("span");
    statusEl.className = "small ms-1 mt-1 d-block";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-secondary";
    btn.title = "Look up coordinates in Simbad";
    btn.innerHTML = '<i class="bi bi-search"></i> Simbad';
    btn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      btn.disabled = true;
      statusEl.textContent = "Searching…";
      statusEl.className = "small ms-1 mt-1 d-block text-secondary";
      try {
        const result = await simbadSearch(name);
        if (result) {
          const hms = degToHms(result.ra);
          const dms = degToDms(result.dec);
          this.form.setFieldValue("ra", hms);
          this.form.setFieldValue("dec", dms);
          statusEl.textContent = `✓ ${hms}  ${dms}`;
          statusEl.className = "small ms-1 mt-1 d-block text-success";
        } else {
          statusEl.textContent = `No result found for "${name}"`;
          statusEl.className = "small ms-1 mt-1 d-block text-warning";
        }
      } catch (e) {
        statusEl.textContent = `✗ ${e.message}`;
        statusEl.className = "small ms-1 mt-1 d-block text-danger";
      } finally {
        btn.disabled = false;
      }
    });
    group.appendChild(btn);

    const openBtn = document.createElement("a");
    openBtn.className = "btn btn-outline-secondary";
    openBtn.title = "Open in Simbad";
    openBtn.innerHTML = '<i class="bi bi-box-arrow-up-right"></i>';
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    openBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (name) openBtn.href = `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(name)}`;
    });
    group.appendChild(openBtn);

    nameField.rowEl.appendChild(statusEl);
  }

  getData() {
    if (!this.type || !this.form) return null;
    return { class: TARGET_PREFIX + this.type, ...this.form.getData() };
  }
}

/** YAML script editor with live validation and "insert template" menu. */
class ScriptEditor {
  constructor(container, scriptTree, scriptData) {
    this.templateMap = {};

    const toolbar = document.createElement("div");
    toolbar.className = "d-flex justify-content-end mb-2";

    const select = document.createElement("select");
    select.className = "form-select form-select-sm w-auto";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Insert template…";
    select.appendChild(placeholder);
    this._walk(scriptTree, "", select);
    select.addEventListener("change", () => {
      if (!select.value) return;
      this._insertTemplate(this.templateMap[select.value]);
      select.value = "";
    });
    toolbar.appendChild(select);
    container.appendChild(toolbar);

    this.textarea = document.createElement("textarea");
    this.textarea.className = "form-control font-monospace";
    this.textarea.rows = 16;
    this.textarea.spellcheck = false;
    this.textarea.value = scriptData ? jsyaml.dump(scriptData) : "";
    container.appendChild(this.textarea);

    this.status = document.createElement("div");
    this.status.className = "small mt-1";
    container.appendChild(this.status);

    let timer = null;
    this.textarea.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => this._validate(), 400);
    });
    this._validate();
  }

  /** Walk the (possibly nested) script tree, registering leaves in templateMap. */
  _walk(tree, prefix, select) {
    for (const [name, value] of Object.entries(tree)) {
      const isClassesDict = Object.values(value).every((v) => v && typeof v === "object" && "class" in v && "schema" in v);
      if (isClassesDict) {
        for (const [clsName, entry] of Object.entries(value)) {
          const key = `${prefix}${name}/${clsName}`;
          this.templateMap[key] = entry;
          const opt = document.createElement("option");
          opt.value = key;
          opt.textContent = key;
          select.appendChild(opt);
        }
      } else {
        this._walk(value, `${prefix}${name}/`, select);
      }
    }
  }

  _insertTemplate(entry) {
    if (!entry) return;
    const schema = entry.schema || {};
    const defs = schema.$defs || {};
    const template = { class: entry.class, ...templateForSchema(schema, defs) };
    const snippet = jsyaml.dump(template);
    if (!this.textarea.value.trim()) {
      this.textarea.value = snippet;
    } else {
      this.textarea.value += (this.textarea.value.endsWith("\n") ? "" : "\n") + snippet;
    }
    this._validate();
  }

  async _validate() {
    let data;
    try {
      data = jsyaml.load(this.textarea.value) || {};
    } catch (e) {
      this.status.textContent = `✗ Invalid YAML: ${e.message}`;
      this.status.className = "small mt-1 text-danger";
      return;
    }
    try {
      const result = await apiRequest("validate_script/", { method: "POST", body: data });
      if (result.valid) {
        this.status.textContent = "✓ Valid";
        this.status.className = "small mt-1 text-success";
      } else {
        this.status.textContent = `✗ ${result.error}`;
        this.status.className = "small mt-1 text-danger";
      }
    } catch (e) {
      this.status.textContent = `✗ ${e.message}`;
      this.status.className = "small mt-1 text-danger";
    }
  }

  getData() {
    try {
      return jsyaml.load(this.textarea.value) || {};
    } catch (e) {
      return {};
    }
  }
}

function parseHmsToDeg(val) {
  const m = val.trim().match(/^(\d+)[h:\s]\s*(\d+)[m:\s]\s*([\d.]+)s?$/i);
  if (m) return (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * 15;
  return null;
}

function parseDmsToDeg(val) {
  const m = val.trim().match(/^([+-]?\d+)[d°:\s]\s*(\d+)[m':\s]\s*([\d.]+)[s"]?$/i);
  if (m) {
    const sign = Number(m[1]) < 0 ? -1 : 1;
    return sign * (Math.abs(Number(m[1])) + Number(m[2]) / 60 + Number(m[3]) / 3600);
  }
  return null;
}

function degToHms(deg) {
  const totalSec = (deg / 15) * 3600;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function degToDms(deg) {
  const sign = deg < 0 ? "-" : "+";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs % 1) * 60);
  const s = (((abs % 1) * 60) % 1) * 60;
  return `${sign}${String(d).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

async function simbadSearch(name) {
  const query = `SELECT ra, dec FROM basic JOIN ident ON ident.oidref = basic.oid WHERE ident.id = '${name.replace(/'/g, "\\'")}'`;
  const url = `https://simbad.cds.unistra.fr/simbad/sim-tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(query)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Simbad returned HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.data && data.data.length > 0) {
    return { ra: data.data[0][0], dec: data.data[0][1] };
  }
  return null;
}

/** Build a minimal-but-valid instance of a schema, for "insert template". */
function templateForSchema(schema, defs) {
  const resolved = resolveSchema(schema, defs);
  const result = {};
  for (const [name, prop] of Object.entries(resolved.properties || {})) {
    if (IGNORED_TASK_FIELDS.has(name)) continue;
    result[name] = defaultValueFor(prop, defs);
  }
  return result;
}

// ── Page bootstrap ──────────────────────────────────────────────────────────

async function initTaskEditor(taskId) {
  const els = {
    code: document.getElementById("field-code"),
    name: document.getElementById("field-name"),
    project: document.getElementById("field-project"),
    duration: document.getElementById("field-duration"),
    priority: document.getElementById("field-priority"),
    active: document.getElementById("field-active"),
    target: document.getElementById("target-editor"),
    constraints: document.getElementById("constraints-editor"),
    merits: document.getElementById("merits-editor"),
    script: document.getElementById("script-editor"),
    schedule: document.getElementById("schedule-table"),
    observations: document.getElementById("observations-table"),
    exportBtn: document.getElementById("btn-export"),
    saveBtn: document.getElementById("btn-save"),
    saveStatus: document.getElementById("save-status"),
    title: document.getElementById("page-title"),
  };

  const [constraintSchemas, meritSchemas, targetSchemas, scriptTree, projects, siteConfig] = await Promise.all([
    apiRequest("schema/constraints/"),
    apiRequest("schema/merits/"),
    apiRequest("schema/targets/"),
    apiRequest("schema/scripts/"),
    apiList("projects/"),
    apiRequest("site/"),
  ]);

  els.project.innerHTML = "";
  projects.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.code;
    o.textContent = `${p.name} (${p.code})`;
    els.project.appendChild(o);
  });

  let task = null;
  if (taskId) {
    task = await apiRequest(`tasks/${encodeURIComponent(taskId)}/`);
    els.title.textContent = `Task ${task.id}`;
    els.code.value = task.id;
    els.code.disabled = true;
    els.project.value = task.project;
  } else {
    const params = new URLSearchParams(window.location.search);
    const cloneFrom = params.get("clone");
    const importedRaw = sessionStorage.getItem("importTask");
    if (cloneFrom) {
      task = await apiRequest(`tasks/${encodeURIComponent(cloneFrom)}/`);
      task.id = params.get("code") || "";
      els.title.textContent = `Clone of ${cloneFrom}`;
    } else if (importedRaw) {
      sessionStorage.removeItem("importTask");
      task = JSON.parse(importedRaw);
      els.title.textContent = "Import task";
    } else {
      task = {
        id: "",
        name: "",
        project: "",
        duration: 0,
        priority: 1.0,
        active: true,
        constraints: siteConfig.default_constraints || [],
        merits: siteConfig.default_merits || [],
        target: null,
        script: {},
      };
      els.title.textContent = "New task";
    }
    els.code.value = task.id;
    els.project.value = task.project;
  }

  els.name.value = task.name || "";
  els.duration.value = task.duration ?? 0;
  els.priority.value = task.priority ?? 1.0;
  els.active.checked = !!task.active;

  const constraintsEditor = new TypedListEditor(els.constraints, constraintSchemas, CONSTRAINT_PREFIX, task.constraints);
  const meritsEditor = new TypedListEditor(els.merits, meritSchemas, MERIT_PREFIX, task.merits);
  const targetEditor = new TargetEditor(els.target, targetSchemas, task.target);
  const scriptEditor = new ScriptEditor(els.script, scriptTree, task.script);

  document.getElementById("btn-estimate-duration").addEventListener("click", async () => {
    const btn = document.getElementById("btn-estimate-duration");
    btn.disabled = true;
    try {
      // Send the full task payload (not just the script) so that scripts like
      // TransitImagingScript can find their TransitMerit and return the correct
      // window duration rather than falling back to summing exposure times.
      const payload = {
        id: els.code.value,
        project: els.project.value,
        constraints: constraintsEditor.getData(),
        merits: meritsEditor.getData(),
        script: scriptEditor.getData(),
      };
      const result = await apiRequest("estimate_duration/", { method: "POST", body: payload });
      if (result.error) {
        els.saveStatus.textContent = `✗ ${result.error}`;
        els.saveStatus.className = "small ms-2 text-danger";
      } else {
        els.duration.value = result.duration;
        els.saveStatus.textContent = `Estimated: ${result.duration} s`;
        els.saveStatus.className = "small ms-2 text-secondary";
      }
    } catch (e) {
      els.saveStatus.textContent = `✗ ${e.message}`;
      els.saveStatus.className = "small ms-2 text-danger";
    } finally {
      btn.disabled = false;
    }
  });

  if (taskId) {
    loadObservationTable(taskId, els.schedule, ["pending", "in_progress"], true);
    loadObservationTable(taskId, els.observations, ["completed", "aborted", "canceled", "failed"], false);
  } else {
    document.getElementById("tab-schedule-nav").classList.add("d-none");
    document.getElementById("tab-observations-nav").classList.add("d-none");
  }

  const buildPayload = () => ({
    id: els.code.value,
    name: els.name.value,
    project: els.project.value,
    duration: Number(els.duration.value),
    priority: Number(els.priority.value),
    active: els.active.checked,
    constraints: constraintsEditor.getData(),
    merits: meritsEditor.getData(),
    target: targetEditor.getData(),
    script: scriptEditor.getData(),
  });

  els.exportBtn.addEventListener("click", () => {
    const payload = buildPayload();
    const yaml = jsyaml.dump(payload);
    const blob = new Blob([yaml], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${payload.id || "task"}.yaml`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.saveBtn.addEventListener("click", async () => {
    const payload = buildPayload();

    els.saveStatus.textContent = "Saving…";
    els.saveStatus.className = "small ms-2 text-secondary";
    try {
      if (taskId) {
        await apiRequest(`tasks/${encodeURIComponent(taskId)}/`, { method: "PUT", body: payload });
      } else {
        await apiRequest(`projects/${encodeURIComponent(payload.project)}/tasks/`, { method: "POST", body: payload });
      }
      els.saveStatus.textContent = "✓ Saved";
      els.saveStatus.className = "small ms-2 text-success";
      loadSidebarTasks();
      if (!taskId) {
        window.location.href = `/tasks/${encodeURIComponent(payload.id)}/`;
      }
    } catch (e) {
      els.saveStatus.textContent = `✗ ${e.message}`;
      els.saveStatus.className = "small ms-2 text-danger";
    }
  });
}

async function loadObservationTable(taskId, tableEl, states, ascending) {
  const tbody = tableEl.querySelector("tbody");
  tbody.innerHTML = '<tr><td colspan="4" class="text-muted ps-3">Loading…</td></tr>';
  try {
    const all = await Promise.all(states.map((s) => apiList("observations/", { task: taskId, state: s })));
    const observations = all.flat();
    tbody.innerHTML = "";
    if (!observations.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted ps-3">None.</td></tr>';
      return;
    }
    const stateBadge = {
      pending: "text-bg-secondary",
      in_progress: "text-bg-primary",
      completed: "text-bg-success",
      aborted: "text-bg-warning",
      canceled: "text-bg-danger",
      failed: "text-bg-danger",
    };
    observations
      .sort((a, b) => (ascending ? 1 : -1) * (a.start < b.start ? -1 : 1))
      .forEach((obs) => {
        const tr = document.createElement("tr");
        const badge = stateBadge[obs.state] || "text-bg-secondary";
        tr.innerHTML = `
          <td class="ps-3">${new Date(obs.start).toLocaleString()}</td>
          <td>${new Date(obs.end).toLocaleString()}</td>
          <td><span class="badge ${badge}">${obs.state}</span></td>
          <td>${obs.target ? (obs.target.name || "") : ""}</td>
        `;
        tbody.appendChild(tr);
      });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-danger ps-3">${e.message}</td></tr>`;
  }
}
