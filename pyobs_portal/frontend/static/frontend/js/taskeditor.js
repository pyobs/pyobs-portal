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

// Apparent solar angular radius, in arcsec, used to scale the SDO preview marker.
const R_SUN_ARCSEC = 16 * 60;

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

/** Editor for picker (CsvPicker, etc.) within DynamicTarget. */
class PickerEditor {
  constructor(container, pickerSchemas, data) {
    this.pickerSchemas = pickerSchemas;
    this.form = null;

    const typeContainer = document.createElement("div");
    typeContainer.className = "mb-3";

    const label = document.createElement("label");
    label.className = "form-label small";
    label.textContent = "Picker Type";
    typeContainer.appendChild(label);

    this.typeSelect = document.createElement("select");
    this.typeSelect.className = "form-select form-select-sm";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(select picker)";
    this.typeSelect.appendChild(noneOpt);
    Object.keys(pickerSchemas)
      .sort()
      .forEach((name) => {
        const o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        this.typeSelect.appendChild(o);
      });
    typeContainer.appendChild(this.typeSelect);
    container.appendChild(typeContainer);

    this.formContainer = document.createElement("div");
    container.appendChild(this.formContainer);

    if (data && data.class) {
      const pickerType = data.class.split(".").pop();
      this.typeSelect.value = pickerType;
      this._renderPickerForm(pickerType, data);
    }

    this.typeSelect.addEventListener("change", () => this._renderPickerForm(this.typeSelect.value || null, null));
  }

  _renderPickerForm(pickerType, data) {
    this.formContainer.innerHTML = "";
    this.form = null;
    if (!pickerType) return;

    const schema = this.pickerSchemas[pickerType];
    if (!schema) return;

    const rest = data ? { ...data } : {};
    delete rest.class;
    this.form = new SchemaForm(schema, schema.$defs || {}, rest, { ignoredFields: IGNORED_TASK_FIELDS });
    this.formContainer.appendChild(this.form.element);
  }

  getData() {
    if (!this.typeSelect.value || !this.form) return null;
    const pickerType = this.typeSelect.value;
    return {
      class: `pyobs.robotic.scheduler.targets.picker.${pickerType.toLowerCase()}.${pickerType}`,
      ...this.form.getData()
    };
  }
}

function prettyTargetType(name) {
  return name.replace(/Target$/, "").replace(/([A-Z])/g, " $1").trim();
}

/** Single, optional, typed target (sidereal / dynamic / ...). */
class TargetEditor {
  constructor(container, schemas, pickerSchemas, data) {
    this.schemas = schemas;
    this.pickerSchemas = pickerSchemas;
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
        o.textContent = prettyTargetType(name);
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
    this.pickerEditor = null;
    document.getElementById("aladin-wrapper")?.classList.add("d-none");
    document.getElementById("sdo-wrapper")?.classList.add("d-none");
    document.getElementById("visibility-container")?.classList.add("d-none");
    if (typeof window.updateVisibilityPlots === "function") window.updateVisibilityPlots(null, null);
    if (!type) return;
    const schema = this.schemas[type];
    if (!schema) return;

    if (type === "DynamicTarget") {
      // Special handling for DynamicTarget: use PickerEditor for the picker field
      this.pickerEditor = new PickerEditor(this.formContainer, this.pickerSchemas, data?.picker);
    } else {
      const rest = data ? { ...data } : {};
      delete rest.class;
      this.form = new SchemaForm(schema, schema.$defs || {}, rest, { ignoredFields: IGNORED_TASK_FIELDS });
      this.formContainer.appendChild(this.form.element);

      if (type === "SiderealTarget") {
        this._makeCoordsFlexible();
        this._injectSimbadButton();
        this._initAladin();
      } else if (type === "HeliocentricPolarTarget" || type === "HelioprojectiveTarget") {
        this._initSdoViewer(type);
      }
    }
  }

  _initAladin() {
    const wrapper = document.getElementById("aladin-wrapper");
    const container = document.getElementById("aladin-container");
    const loading = document.getElementById("aladin-loading");
    if (!container) { this._updateAladin(); return; }

    wrapper.classList.remove("d-none");

    const tryInit = () => {
      if (typeof A === "undefined") { setTimeout(tryInit, 200); return; }
      A.init.then(() => {
        if (!this._aladin) {
          this._aladin = A.aladin(container, {
            survey: "P/DSS2/color",
            fov: 0.25,
            showReticle: true,
            showZoomControl: true,
            showFullscreenControl: false,
          });
        }
        loading?.classList.add("d-none");
        this._updateAladin();
      });
    };
    tryInit();

    // Fire vis plots immediately without waiting for Aladin
    this._updateAladin();
  }

  _updateAladin() {
    if (!this.form) return;
    const ra = this.form.fields["ra"]?.getValue();
    const dec = this.form.fields["dec"]?.getValue();
    const raDeg = typeof ra === "number" ? ra : parseHmsToDeg(String(ra ?? ""));
    const decDeg = typeof dec === "number" ? dec : parseDmsToDeg(String(dec ?? ""));
    if (raDeg !== null && decDeg !== null) {
      if (this._aladin) this._aladin.gotoRaDec(raDeg, decDeg);
      if (typeof window.updateVisibilityPlots === "function") {
        window.updateVisibilityPlots(raDeg, decDeg);
      }
    } else {
      if (typeof window.updateVisibilityPlots === "function") {
        window.updateVisibilityPlots(null, null);
      }
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

  _initSdoViewer(type) {
    const wrapper = document.getElementById("sdo-wrapper");
    if (!wrapper) return;
    wrapper.classList.remove("d-none");

    document.getElementById("sdo-channel")?.addEventListener("change", () => this._updateSdo());

    // Attach directly to the relevant inputs so updates fire reliably
    const fieldNames = type === "HeliocentricPolarTarget" ? ["mu", "psi"] : ["tx", "ty"];
    for (const name of fieldNames) {
      const input = this.form?.fields[name]?.rowEl?.querySelector("input");
      input?.addEventListener("input", () => this._updateSdo());
    }

    this._updateSdo();
  }

  _updateSdo() {
    const img     = document.getElementById("sdo-img");
    const canvas  = document.getElementById("sdo-canvas");
    const loading = document.getElementById("sdo-loading");
    const channel = document.getElementById("sdo-channel")?.value || "0171";
    if (!img || !canvas) return;

    const { tx, ty } = this._sdoTargetToArcsec();
    const draw = () => this._drawSdoMarker(canvas, tx, ty);

    if (img.dataset.channel !== channel) {
      img.dataset.channel = channel;
      img.dataset.loaded  = "0";
      loading?.classList.remove("d-none");
      img.onload  = () => { loading?.classList.add("d-none"); img.dataset.loaded = "1"; draw(); };
      img.onerror = () => { loading?.classList.add("d-none"); };
      img.src = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_${channel}.jpg`;
    } else if (img.dataset.loaded === "1") {
      draw();
    } else {
      // Image still loading — update onload so it draws with the latest coordinates
      img.onload = () => { loading?.classList.add("d-none"); img.dataset.loaded = "1"; draw(); };
    }
  }

  /** Resolve the current form values to helioprojective cartesian offsets (tx, ty), in arcsec. */
  _sdoTargetToArcsec() {
    if (this.type === "HelioprojectiveTarget") {
      // Direct helioprojective cartesian offset, already in arcsec.
      const tx = parseFloat(this.form?.fields["tx"]?.getValue());
      const ty = parseFloat(this.form?.fields["ty"]?.getValue());
      return { tx, ty };
    }
    if (this.type === "HeliocentricPolarTarget") {
      // mu = cos(heliocentric angle), psi = position angle, both in radians per
      // pyobs.robotic.scheduler.targets.HeliocentricPolarTarget. Mirrors that
      // class's coordinates() conversion to helioprojective tx/ty for the preview.
      const mu  = parseFloat(this.form?.fields["mu"]?.getValue());
      const psi = parseFloat(this.form?.fields["psi"]?.getValue());
      if (isNaN(mu) || isNaN(psi)) return { tx: NaN, ty: NaN };
      const rSunRad = (R_SUN_ARCSEC / 3600) * (Math.PI / 180);
      const dOverRSun = 1 / Math.sin(rSunRad); // d_sun / r_sun, derived from the assumed solar angular radius
      const alpha = Math.acos(mu);
      const theta = Math.atan(Math.sin(alpha) / (dOverRSun - mu)); // radians
      const thetaArcsec = theta * (180 / Math.PI) * 3600;
      return { tx: -thetaArcsec * Math.sin(psi), ty: thetaArcsec * Math.cos(psi) };
    }
    return { tx: NaN, ty: NaN };
  }

  _drawSdoMarker(canvas, tx, ty) {
    const SIZE = 300;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (isNaN(tx) || isNaN(ty)) return;

    // tx/ty: helioprojective cartesian offset from disk center, in arcsec
    // (solar north up, solar west right — same convention as sunpy's Helioprojective frame).
    // Solar radius ≈ 960″, occupying ~450px in the 1024px SDO source image.
    const scale = (450 / R_SUN_ARCSEC) * (SIZE / 1024);  // display px per arcsec

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const x = cx + scale * tx;
    const y = cy - scale * ty;

    ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
    ctx.lineWidth = 1.5;
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r / 2, 0, 2 * Math.PI);
    ctx.stroke();
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
    if (!this.type) return null;
    if (this.type === "DynamicTarget") {
      const picker = this.pickerEditor?.getData();
      return picker ? { class: TARGET_PREFIX + this.type, name: "DynamicTarget", picker } : null;
    }
    if (!this.form) return null;
    return { class: TARGET_PREFIX + this.type, ...this.form.getData() };
  }
}

/** YAML script editor with live validation and "insert template" menu. */
/** Raw-YAML script editor (CodeMirror over a textarea). Composed by
 * ScriptBuilder (scriptbuilder.js) as its "Source" view -- ScriptBuilder owns
 * validation/status display for both its views, so this stays a plain
 * get/set wrapper with an onChange hook rather than validating itself. */
class ScriptEditor {
  constructor(container, scriptData, opts = {}) {
    const ta = document.createElement("textarea");
    ta.value = scriptData ? jsyaml.dump(scriptData) : "";
    container.appendChild(ta);

    this.editor = CodeMirror.fromTextArea(ta, {
      mode: "yaml",
      theme: "material-darker",
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      lineWrapping: true,
      viewportMargin: Infinity,
    });
    setTimeout(() => this.editor.refresh(), 0);

    if (opts.onChange) {
      this.editor.on("change", () => opts.onChange());
    }
  }

  getData() {
    try {
      return jsyaml.load(this.editor.getValue()) || {};
    } catch (e) {
      return {};
    }
  }

  /** Update editor content and refresh. */
  setContent(data) {
    this.editor.setValue(data ? jsyaml.dump(data) : "");
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

  const [constraintSchemas, meritSchemas, targetSchemas, pickerSchemas, scriptTree, moduleRefs, projects, siteConfig] =
    await Promise.all([
      apiRequest("schema/constraints/"),
      apiRequest("schema/merits/"),
      apiRequest("schema/targets/"),
      apiRequest("schema/pickers/"),
      apiRequest("schema/scripts/"),
      // issue #98: module-name dropdowns are an optional enhancement (web-admin
      // may be unreachable/unconfigured) -- never let a failure here break the
      // rest of the task editor page load.
      apiRequest("schema/modules/").catch(() => ({ available: false, options: {} })),
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
    els.title.textContent = task.name ? `${task.name} (${task.id})` : `Task ${task.id}`;
    document.title = `${task.name || task.id} — pyobs Robotic`;
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
      document.title = `Clone of ${cloneFrom} — pyobs Robotic`;
    } else if (importedRaw) {
      sessionStorage.removeItem("importTask");
      task = JSON.parse(importedRaw);
      els.title.textContent = "Import task";
      document.title = "Import task — pyobs Robotic";
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
      document.title = "New task — pyobs Robotic";
    }
    els.code.value = task.id;
    els.code.disabled = false;
    els.project.value = task.project;
  }

  els.name.value = task.name || "";
  els.duration.value = task.duration ?? 0;
  els.priority.value = task.priority ?? 1.0;
  els.active.checked = !!task.active;

  // All fields above are now populated from `task` -- safe to let the user touch them.
  // Re-enabling here (rather than only once every editor/listener below is fully wired,
  // several lines down but still in the same synchronous block since nothing awaits in
  // between) is enough: the browser can't dispatch a click on a still-disabled button
  // until this function yields, which it doesn't again before Save/Export get their
  // listeners attached below.
  els.project.disabled = false;
  els.name.disabled = false;
  els.priority.disabled = false;
  els.active.disabled = false;
  els.exportBtn.disabled = false;
  els.saveBtn.disabled = false;
  document.getElementById("task-form-loading")?.remove();

  // Initialise visibility plots before TargetEditor so window.updateVisibilityPlots
  // exists when the editor fires _updateAladin() during construction.
  if (typeof initVisibilityPlots === "function") {
    initVisibilityPlots(siteConfig);
  }

  const constraintsEditor = new TypedListEditor(els.constraints, constraintSchemas, CONSTRAINT_PREFIX, task.constraints);
  const meritsEditor = new TypedListEditor(els.merits, meritSchemas, MERIT_PREFIX, task.merits);
  const targetEditor = new TargetEditor(els.target, targetSchemas, pickerSchemas, task.target);

  // Runs the same full-task-payload estimate_duration/ call (needed for e.g.
  // TransitImagingScript to find its TransitMerit and return the correct
  // window duration) automatically whenever ScriptBuilder reports an edit
  // (issue #96 -- no more explicit "Estimate duration" button).
  async function estimateDuration() {
    try {
      const payload = {
        id: els.code.value,
        project: els.project.value,
        constraints: constraintsEditor.getData(),
        merits: meritsEditor.getData(),
        script: scriptBuilder.getData(),
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
    }
  }

  const scriptBuilder = new ScriptBuilder(els.script, scriptTree, task.script, {
    onChange: estimateDuration,
    moduleRefs,
  });

  // Initialise merit plot (requires buildPayload, defined below, so we use a closure)
  if (typeof initMeritPlot === "function") {
    initMeritPlot(() => {
      const target = targetEditor.getData();
      // Normalize SiderealTarget RA/Dec from HMS/DMS strings to decimal degrees
      // so the backend can parse them into a Target object for constraint evaluation.
      if (target?.class?.includes("SiderealTarget")) {
        const ra = parseHmsToDeg(String(target.ra ?? ""));
        const dec = parseDmsToDeg(String(target.dec ?? ""));
        if (ra !== null) target.ra = ra;
        if (dec !== null) target.dec = dec;
      }
      return {
        id: els.code.value,
        name: els.name.value,
        project: els.project.value,
        duration: Number(els.duration.value),
        priority: Number(els.priority.value),
        active: els.active.checked,
        constraints: constraintsEditor.getData(),
        merits: meritsEditor.getData(),
        target,
        script: scriptBuilder.getData(),
      };
    }, siteConfig);
  }

  // Refresh merit plot on any constraint / merit change (add, remove, or field edit)
  function _maybeMeritRefresh() {
    if (typeof window.refreshMeritPlot === "function") window.refreshMeritPlot();
  }
  const _patchEditor = (editor) => {
    const origAddItem = editor._addItem.bind(editor);
    editor._addItem = function (data) {
      origAddItem(data);
      _maybeMeritRefresh();
    };
    const obs = new MutationObserver(() => _maybeMeritRefresh());
    obs.observe(editor.listEl, { childList: true });
    editor.listEl.addEventListener("input", _maybeMeritRefresh);
    editor.listEl.addEventListener("change", _maybeMeritRefresh);
  };
  _patchEditor(constraintsEditor);
  _patchEditor(meritsEditor);

  document.getElementById("observations-data-th").classList.toggle("d-none", !siteConfig.archive_enabled);

  if (taskId) {
    loadObservationTable(taskId, els.schedule, ["pending", "in_progress"], true, 1, { end_after: new Date().toISOString() });
    loadObservationTable(taskId, els.observations, ["completed", "aborted", "failed"], false, 1, {}, siteConfig.archive_enabled);
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
    script: scriptBuilder.getData(),
  });

  els.exportBtn.addEventListener("click", () => {
    const payload = buildPayload();
    // Normalize SiderealTarget coordinates to degrees
    if (payload.target && payload.target.class && payload.target.class.includes("SiderealTarget")) {
      const ra = parseHmsToDeg(String(payload.target.ra ?? ""));
      const dec = parseDmsToDeg(String(payload.target.dec ?? ""));
      if (ra !== null) payload.target.ra = ra;
      if (dec !== null) payload.target.dec = dec;
    }
    const yaml = jsyaml.dump(payload);
    const blob = new Blob([yaml], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${payload.id || "task"}.yaml`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("tab-script-nav").addEventListener("show.bs.tab", () => {
    setTimeout(() => scriptBuilder.refreshView(), 0);
  });

  let yamlPreviewEditor = null;
  document.getElementById("tab-yaml-nav").addEventListener("show.bs.tab", () => {
    const container = document.getElementById("yaml-preview-editor");
    if (!yamlPreviewEditor) {
      yamlPreviewEditor = CodeMirror(container, {
        mode: "yaml",
        theme: "material-darker",
        lineNumbers: true,
        indentUnit: 2,
        readOnly: true,
        viewportMargin: Infinity,
      });
    }
    yamlPreviewEditor.setValue(jsyaml.dump(buildPayload()));
    setTimeout(() => yamlPreviewEditor.refresh(), 0);
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

/** Format an ISO-8601 timestamp as "YYYY-MM-DD HH:MM:SS UTC" (always UTC). */
function formatUTCDateTime(iso) {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

const OBS_STATE_BADGE = {
  pending: "text-bg-secondary",
  in_progress: "text-bg-primary",
  completed: "text-bg-success",
  aborted: "text-bg-warning",
  canceled: "text-bg-danger",
  failed: "text-bg-danger",
  window_expired: "text-bg-secondary",
};

async function loadObservationTable(taskId, tableEl, states, ascending, page = 1, extraParams = {}, showData = false) {
  const colspan = showData ? 5 : 4;
  const tbody = tableEl.querySelector("tbody");
  tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted ps-3">Loading…</td></tr>`;

  const card = tableEl.closest(".card");
  card.querySelector(".card-footer")?.remove();

  try {
    const params = new URLSearchParams({ task: taskId, state: states.join(","), page, ...extraParams });
    const data = await apiRequest(`observations/?${params}`);
    const observations = (data.results || []).sort(
      (a, b) => (ascending ? 1 : -1) * (a.start < b.start ? -1 : 1)
    );

    tbody.innerHTML = "";
    if (!observations.length) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted ps-3">None.</td></tr>`;
    } else {
      observations.forEach((obs) => {
        const tr = document.createElement("tr");
        const badge = OBS_STATE_BADGE[obs.state] || "text-bg-secondary";
        tr.innerHTML = `
          <td class="ps-3">${formatUTCDateTime(obs.start)}</td>
          <td>${formatUTCDateTime(obs.end)}</td>
          <td><span class="badge ${badge}">${obs.state}</span></td>
          <td>${obs.target ? (obs.target.name || "") : ""}</td>
          ${showData ? `<td>${renderDataCell(obs)}</td>` : ""}
        `;
        tbody.appendChild(tr);
        if (showData && obs.archive_url) {
          tr.querySelector(".data-status-btn")?.addEventListener("click", (e) =>
            checkDataStatus(obs.id, e.target)
          );
        }
      });
    }

    if (data.previous || data.next) {
      const footer = document.createElement("div");
      footer.className = "card-footer d-flex justify-content-between align-items-center small text-muted py-2";
      footer.innerHTML = `
        <button class="btn btn-sm btn-outline-secondary" ${!data.previous ? "disabled" : ""}>← Previous</button>
        <span>${data.count} total</span>
        <button class="btn btn-sm btn-outline-secondary" ${!data.next ? "disabled" : ""}>Next →</button>
      `;
      const [prevBtn, nextBtn] = footer.querySelectorAll("button");
      prevBtn.addEventListener("click", () => loadObservationTable(taskId, tableEl, states, ascending, page - 1, extraParams, showData));
      nextBtn.addEventListener("click", () => loadObservationTable(taskId, tableEl, states, ascending, page + 1, extraParams, showData));
      card.appendChild(footer);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-danger ps-3">${e.message}</td></tr>`;
  }
}

/** "Open in archive" link plus a lazy "check" affordance for the frame count/reduction status. */
function renderDataCell(obs) {
  if (!obs.archive_url) return "";
  return `
    <a href="${obs.archive_url}" target="_blank" rel="noopener">Open in archive ↗</a>
    <button type="button" class="btn btn-sm btn-link p-0 ms-2 data-status-btn">check</button>
  `;
}

/** Fetches the on-demand frame count/reduction status for one observation (issue #82) and
 * replaces the triggering "check" button with the result, in place. */
async function checkDataStatus(obsId, btn) {
  btn.disabled = true;
  btn.textContent = "checking…";
  try {
    const data = await apiRequest(`observations/${obsId}/frames/`);
    btn.replaceWith(
      data.status === "unavailable"
        ? unavailableDataStatusEl()
        : dataStatusEl(`${data.count} frame${data.count === 1 ? "" : "s"}, ${data.reduced ? "reduced" : "raw only"}`)
    );
  } catch (e) {
    btn.replaceWith(unavailableDataStatusEl());
  }
}

function dataStatusEl(text, muted = false) {
  const span = document.createElement("span");
  span.className = `ms-2${muted ? " text-muted" : ""}`;
  span.textContent = text; // archive-controlled value: never through innerHTML
  return span;
}

function unavailableDataStatusEl() {
  return dataStatusEl("unavailable", true);
}

// ScriptEditor is a `class` (not `var`/`function`), so it isn't a `window`
// property automatically even in a classic <script> -- scriptbuilder.js
// composes it by bare name, which resolves fine in the browser (shared
// classic-script scope) but needs this to resolve under vitest, where each
// file is its own ES module. See schemaform.js's window exposure for the
// same pattern.
if (typeof window !== "undefined") {
  window.ScriptEditor = ScriptEditor;
}
