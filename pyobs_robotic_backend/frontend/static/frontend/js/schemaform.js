/**
 * Generic JSON-Schema-driven form builder.
 *
 * This is the browser-side counterpart of pyobs-task-editor's
 * modelwidgets.py: instead of walking pydantic `model_fields` to build
 * PySide6 widgets, it walks the JSON Schema returned by
 * /api/schema/{constraints,merits,targets}/ (generated server-side via
 * `model_json_schema()`) and builds Bootstrap form controls.
 *
 * Usage:
 *   const form = new SchemaForm(schema, defs, data, { ignoredFields, polymorphic });
 *   container.appendChild(form.element);
 *   ...
 *   const data = form.getData();
 *
 * `polymorphic` is the `{base: [{class, title, schema}]}` map produced by
 * resolvePolymorphicCandidates() from script_tree()'s `$polymorphic`
 * registry; omit it for schemas with no `x-pyobs-polymorphic` fields
 * (constraints/merits/targets today).
 */

/** Resolve a `$ref` (and merge any sibling keys, e.g. an overriding title). */
function resolveSchema(schema, defs) {
  if (!schema) return schema;
  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop();
    const base = defs[refName] || {};
    const merged = { ...base, ...schema };
    delete merged.$ref;
    return merged;
  }
  if (schema.allOf && schema.allOf.length === 1) {
    return resolveSchema({ ...schema.allOf[0], ...schema, allOf: undefined }, defs);
  }
  return schema;
}

const LABEL_OVERRIDES = { ra: "RA" };

function prettyLabel(name, schema) {
  if (name in LABEL_OVERRIDES) return LABEL_OVERRIDES[name];
  if (schema && schema.title) return schema.title;
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pick a sensible "empty" value for a (resolved) schema, for new list items. */
function defaultValueFor(schema, defs) {
  const resolved = resolveSchema(schema, defs);
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.anyOf) {
    const dt = resolved.anyOf.find((o) => o.format === "date-time");
    if (dt) return new Date().toISOString().slice(0, 19);
    return defaultValueFor(resolved.anyOf[0], defs);
  }
  switch (resolved.type) {
    case "boolean":
      return false;
    case "integer":
    case "number":
      return 0;
    case "string":
      return resolved.format === "date-time" ? new Date().toISOString().slice(0, 19) : "";
    case "array":
      return [];
    case "object": {
      const result = {};
      for (const [name, prop] of Object.entries(resolved.properties || {})) {
        result[name] = defaultValueFor(prop, defs);
      }
      return result;
    }
    default:
      return null;
  }
}

/** Convert an ISO timestamp / Time-ish value to a value usable in <input type=datetime-local>. */
function toDatetimeLocal(value) {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : s.slice(0, 19);
}

class SchemaForm {
  /**
   * @param {object} schema - resolved or unresolved JSON Schema for an object
   * @param {object} defs - the `$defs` map from the root schema document
   * @param {object} data - current values, keyed by property name
   * @param {object} opts - { ignoredFields: Set<string>, polymorphic: object }
   *   `polymorphic` is the flattened `{ base: [{class, title, schema}] }` map
   *   produced by `resolvePolymorphicCandidates()`, threaded down to every
   *   nested control so a polymorphic field can be rendered at any depth.
   */
  constructor(schema, defs, data, opts = {}) {
    this.defs = defs || {};
    this.data = data || {};
    this.ignored = opts.ignoredFields || new Set();
    this.polymorphic = opts.polymorphic || {};
    this.fields = {}; // name -> { getValue, schema }
    this.element = document.createElement("div");
    this._build(resolveSchema(schema, this.defs));
  }

  _build(schema) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    for (const [name, propSchema] of Object.entries(props)) {
      if (this.ignored.has(name)) continue;
      const resolved = resolveSchema(propSchema, this.defs);
      const value = this.data[name];
      const { control, getValue } = buildControl(resolved, this.defs, value, this.ignored, this.polymorphic);
      const row = document.createElement("div");
      row.className = "mb-2";
      const label = document.createElement("label");
      label.className = "form-label small text-secondary mb-1";
      label.textContent = prettyLabel(name, resolved);
      if (required.has(name)) {
        const star = document.createElement("span");
        star.className = "text-danger ms-1";
        star.title = "Required";
        star.textContent = "*";
        label.appendChild(star);
      }
      row.appendChild(label);
      row.appendChild(control);
      if (resolved.description) {
        const help = document.createElement("div");
        help.className = "form-text small mt-1";
        help.textContent = resolved.description;
        row.appendChild(help);
      }
      this.element.appendChild(row);
      this.fields[name] = { getValue, schema: resolved, rowEl: row };
    }
    if (!Object.keys(props).length) {
      const p = document.createElement("p");
      p.className = "text-muted small mb-0";
      p.textContent = "(no configurable fields)";
      this.element.appendChild(p);
    }
  }

  getData() {
    const result = {};
    for (const [name, field] of Object.entries(this.fields)) {
      result[name] = field.getValue();
    }
    return result;
  }

  setFieldValue(name, value) {
    const field = this.fields[name];
    if (!field) return;
    const input = field.rowEl.querySelector("input");
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }
}

/**
 * Build a control (and a getValue() accessor) for a single resolved schema.
 * Returns { control: HTMLElement, getValue: () => any }.
 */
function buildControl(resolved, defs, value, ignored, polymorphic) {
  // Polymorphic script/provider field (backend-annotated) -- checked before
  // the generic anyOf/object branches below, since a polymorphic field's own
  // schema node is often itself an anyOf (e.g. `float | ExposureTimeProvider`)
  // or a bare $ref (e.g. `Script`).
  if (resolved["x-pyobs-polymorphic"]) {
    return buildPolymorphicControl(resolved["x-pyobs-polymorphic"], defs, value, ignored, polymorphic);
  }

  // anyOf: optional fields (X | None), Time fields, or other unions
  if (resolved.anyOf) {
    const nonNull = resolved.anyOf.filter((o) => o.type !== "null");
    const dateTime = nonNull.find((o) => resolveSchema(o, defs).format === "date-time");
    if (dateTime) {
      return buildDateTimeControl(value);
    }
    if (nonNull.length === 1) {
      return buildControl(resolveSchema(nonNull[0], defs), defs, value, ignored, polymorphic);
    }
    // Ambiguous union (e.g. float | SomeProvider) -> raw YAML fallback.
    return buildYamlControl(value);
  }

  if (resolved.enum) {
    return buildEnumControl(resolved, value);
  }

  if (resolved.format === "date-time") {
    return buildDateTimeControl(value);
  }

  switch (resolved.type) {
    case "boolean":
      return buildBoolControl(resolved, value);
    case "integer":
      return buildNumberControl(resolved, value, true);
    case "number":
      return buildNumberControl(resolved, value, false);
    case "string":
      return buildStringControl(resolved, value);
    case "array":
      return buildArrayControl(resolved, defs, value, ignored, polymorphic);
    case "object":
      // Dynamic map (additionalProperties-only, no fixed properties) --
      // e.g. CasesRunner.cases: dict[str, Script].
      if (resolved.additionalProperties && !resolved.properties) {
        return buildMapControl(resolved, defs, value, ignored, polymorphic);
      }
      return buildObjectControl(resolved, defs, value, ignored, polymorphic);
    default:
      return buildYamlControl(value);
  }
}

function buildBoolControl(resolved, value) {
  const wrap = document.createElement("div");
  wrap.className = "form-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.checked = value !== undefined && value !== null ? !!value : !!resolved.default;
  wrap.appendChild(input);
  return { control: wrap, getValue: () => input.checked };
}

function buildNumberControl(resolved, value, isInt) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control form-control-sm";
  if (resolved.minimum !== undefined) input.min = resolved.minimum;
  if (resolved.maximum !== undefined) input.max = resolved.maximum;
  if (resolved.exclusiveMinimum !== undefined) input.min = resolved.exclusiveMinimum;
  if (resolved.exclusiveMaximum !== undefined) input.max = resolved.exclusiveMaximum;
  if (resolved.decimals !== undefined) {
    input.step = String(Math.pow(10, -resolved.decimals));
  } else {
    input.step = isInt ? "1" : "any";
  }
  input.value = value !== undefined && value !== null ? value : (resolved.default ?? 0);
  return {
    control: input,
    getValue: () => {
      const v = input.value === "" ? 0 : Number(input.value);
      return isInt ? Math.trunc(v) : v;
    },
  };
}

function buildStringControl(resolved, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  if (value !== undefined && value !== null) input.value = value;
  else if (resolved.default !== undefined && resolved.default !== null) input.value = resolved.default;
  return { control: input, getValue: () => input.value };
}

function buildEnumControl(resolved, value) {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  for (const opt of resolved.enum) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (value === opt) o.selected = true;
    select.appendChild(o);
  }
  if (value === undefined && resolved.default !== undefined) select.value = resolved.default;
  return { control: select, getValue: () => select.value };
}

function buildDateTimeControl(value) {
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.step = "1";
  input.className = "form-control form-control-sm";
  input.value = toDatetimeLocal(value);
  return {
    control: input,
    getValue: () => (input.value ? input.value : null),
  };
}

/** Raw YAML editor, used as a fallback for shapes we don't render specially. */
function buildYamlControl(value) {
  const textarea = document.createElement("textarea");
  textarea.className = "form-control form-control-sm font-monospace";
  textarea.rows = 3;
  textarea.value = value !== undefined && value !== null ? jsyaml.dump(value) : "";
  return {
    control: textarea,
    getValue: () => {
      const text = textarea.value.trim();
      if (!text) return null;
      try {
        return jsyaml.load(text);
      } catch (e) {
        return null;
      }
    },
  };
}

/** Nested object -> sub-form inside a bordered card. */
function buildObjectControl(resolved, defs, value, ignored, polymorphic) {
  const card = document.createElement("div");
  card.className = "border rounded p-2 border-secondary-subtle";
  const form = new SchemaForm(resolved, defs, value || {}, { ignoredFields: ignored, polymorphic });
  card.appendChild(form.element);
  return { control: card, getValue: () => form.getData() };
}

/** Array of objects, primitives, or polymorphic nodes -> add/remove list. */
function buildArrayControl(resolved, defs, value, ignored, polymorphic) {
  const itemSchema = resolveSchema(resolved.items || {}, defs);

  const wrap = document.createElement("div");
  const list = document.createElement("div");
  list.className = "d-flex flex-column gap-2 mb-2";
  wrap.appendChild(list);

  const items = []; // { element, getValue }

  function addItem(itemValue) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2";

    // Delegates to buildControl's own dispatch (object / polymorphic /
    // primitive) so array items of any of those shapes render correctly,
    // instead of re-implementing the object-vs-primitive branch here.
    const { control, getValue } = buildControl(itemSchema, defs, itemValue, ignored, polymorphic);
    control.classList.add("flex-grow-1");
    row.appendChild(control);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-outline-danger";
    removeBtn.innerHTML = '<i class="bi bi-dash"></i>';
    removeBtn.addEventListener("click", () => {
      const idx = items.findIndex((it) => it.row === row);
      if (idx >= 0) items.splice(idx, 1);
      row.remove();
    });
    row.appendChild(removeBtn);

    items.push({ row, getValue });
    list.appendChild(row);
  }

  (value || []).forEach((v) => addItem(v));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-sm btn-outline-secondary";
  addBtn.innerHTML = '<i class="bi bi-plus"></i> Add';
  addBtn.addEventListener("click", () => addItem(defaultValueFor(itemSchema, defs)));
  wrap.appendChild(addBtn);

  return {
    control: wrap,
    getValue: () => items.map((it) => it.getValue()),
  };
}

/**
 * Dynamic map (`additionalProperties`-only object, e.g. `CasesRunner.cases`)
 * -> key/value list editor. Generic for any `additionalProperties` schema,
 * not just polymorphic ones: the value control comes from buildControl's own
 * dispatch, so a plain `dict[str, str]` gets a text input per row here too.
 */
function buildMapControl(resolved, defs, value, ignored, polymorphic) {
  const valueSchema = resolveSchema(resolved.additionalProperties, defs);

  const wrap = document.createElement("div");
  const list = document.createElement("div");
  list.className = "d-flex flex-column gap-2 mb-2";
  wrap.appendChild(list);

  const rows = []; // { row, keyInput, getValue }

  // A duplicate name would silently overwrite an earlier row in getValue()'s
  // last-wins map build -- flag it visibly rather than leaving it silent.
  function updateDuplicateWarnings() {
    const counts = new Map();
    for (const r of rows) {
      const key = r.keyInput.value;
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const r of rows) {
      const key = r.keyInput.value;
      const isDup = !!key && counts.get(key) > 1;
      r.keyInput.classList.toggle("is-invalid", isDup);
      r.keyInput.title = isDup ? `Duplicate name "${key}" -- only the last one is kept` : "";
    }
  }

  function addRow(key, itemValue) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2";

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "form-control form-control-sm";
    keyInput.style.maxWidth = "10rem";
    keyInput.placeholder = "name";
    keyInput.value = key || "";
    keyInput.addEventListener("input", updateDuplicateWarnings);
    row.appendChild(keyInput);

    const { control, getValue } = buildControl(valueSchema, defs, itemValue, ignored, polymorphic);
    control.classList.add("flex-grow-1");
    row.appendChild(control);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-outline-danger";
    removeBtn.innerHTML = '<i class="bi bi-dash"></i>';
    removeBtn.addEventListener("click", () => {
      const idx = rows.findIndex((r) => r.row === row);
      if (idx >= 0) rows.splice(idx, 1);
      row.remove();
      updateDuplicateWarnings();
    });
    row.appendChild(removeBtn);

    rows.push({ row, keyInput, getValue });
    list.appendChild(row);
    updateDuplicateWarnings();
  }

  Object.entries(value || {}).forEach(([k, v]) => addRow(k, v));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-sm btn-outline-secondary";
  addBtn.innerHTML = '<i class="bi bi-plus"></i> Add';
  addBtn.addEventListener("click", () => addRow("", defaultValueFor(valueSchema, defs)));
  wrap.appendChild(addBtn);

  return {
    control: wrap,
    // Rows with an empty key are dropped rather than serialized under "" --
    // the caller fills in a name before it's meaningful. A duplicate name is
    // last-row-wins (flagged visibly above via updateDuplicateWarnings).
    getValue: () => {
      const result = {};
      for (const r of rows) {
        const key = r.keyInput.value;
        if (key) result[key] = r.getValue();
      }
      return result;
    },
  };
}

/**
 * Polymorphic field (`x-pyobs-polymorphic` marker): a class-selector dropdown
 * (grouped by module path for Script candidates) plus a nested SchemaForm for
 * whichever class is currently selected. `getValue()` always returns
 * `{"class": "<fqcn>", ...fields}` (or `null` for an unset optional field) --
 * never a class-less dict.
 */
function buildPolymorphicControl(marker, defs, value, ignored, polymorphic) {
  const candidates = (polymorphic && polymorphic[marker.base]) || [];
  const isOptional = marker.container === "optional";
  // `value.class` presence, not just "value is an object", is what
  // distinguishes a genuine (possibly unmappable) existing value from the
  // classless `{}` placeholder that "Add" buttons create via
  // defaultValueFor() for a brand-new item -- that one should default to the
  // first candidate below, not trip the unmappable-value fallback.
  const hasClass = value !== undefined && value !== null && typeof value === "object" && value.class !== undefined;
  const hasExisting = hasClass && candidates.some((c) => c.class === value.class);

  if (!candidates.length || (hasClass && !hasExisting)) {
    // No candidates for this base, or an existing value whose class isn't
    // among them (stale class, uninstalled script package, legacy YAML --
    // the §4.12 "unmappable" scenarios) -- fall back to raw YAML rather than
    // silently discarding the data by resetting to the first candidate.
    return buildYamlControl(value);
  }

  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-column gap-2";

  const select = document.createElement("select");
  select.className = "form-select form-select-sm";

  if (isOptional) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    select.appendChild(none);
  }

  const groups = new Map(); // groupLabel ("" = ungrouped) -> candidates
  for (const c of candidates) {
    const groupLabel = c.path ? c.path.split("/").slice(0, -1).join("/") : "";
    if (!groups.has(groupLabel)) groups.set(groupLabel, []);
    groups.get(groupLabel).push(c);
  }
  for (const [groupLabel, group] of groups) {
    const target = groupLabel ? document.createElement("optgroup") : select;
    if (groupLabel) {
      target.label = groupLabel;
      select.appendChild(target);
    }
    for (const c of group) {
      const option = document.createElement("option");
      option.value = c.class;
      option.textContent = c.title;
      target.appendChild(option);
    }
  }

  wrap.appendChild(select);

  const nestedWrap = document.createElement("div");
  wrap.appendChild(nestedWrap);
  let currentForm = null;

  function renderNested(cls, data) {
    nestedWrap.innerHTML = "";
    currentForm = null;
    const candidate = candidates.find((c) => c.class === cls);
    if (!candidate) return;
    const card = document.createElement("div");
    card.className = "border rounded p-2 border-secondary-subtle";
    currentForm = new SchemaForm(candidate.schema || {}, defs, data || {}, {
      ignoredFields: ignored,
      polymorphic,
    });
    card.appendChild(currentForm.element);
    nestedWrap.appendChild(card);
  }

  const initialClass = hasExisting ? value.class : isOptional ? "" : candidates[0].class;
  select.value = initialClass;
  renderNested(initialClass, hasExisting ? value : undefined);

  select.addEventListener("change", () => {
    renderNested(select.value, undefined);
  });

  return {
    control: wrap,
    getValue: () => {
      if (!select.value) return null;
      return { class: select.value, ...(currentForm ? currentForm.getData() : {}) };
    },
  };
}

/**
 * Flatten `script_tree()`'s `$polymorphic` registry into
 * `{ base: [{class, title, schema}] }`, resolving `Script` candidates' `path`
 * references against the tree itself (they reference tree entries instead of
 * duplicating schemas -- see specs/plans/2026-08-20-script-builder.md §3.2).
 */
function resolvePolymorphicCandidates(tree) {
  const registry = (tree && tree.$polymorphic) || {};
  const result = {};
  for (const [base, entry] of Object.entries(registry)) {
    result[base] = (entry.candidates || []).map((c) => {
      if (c.schema) return c;
      let node = tree;
      for (const part of c.path.split("/")) {
        node = node && node[part];
      }
      return { class: c.class, title: c.title, schema: (node && node.schema) || {} };
    });
  }
  return result;
}

// Classic scripts (loaded via <script src>, no build step) don't expose their
// top-level `class`/`function` declarations as `window` properties on their
// own -- only `var`/function declarations do that automatically. Exposing
// them explicitly is harmless in the page (nothing currently reads these) and
// lets vitest import this file and reach them via the shared jsdom `window`.
if (typeof window !== "undefined") {
  window.SchemaForm = SchemaForm;
  window.buildControl = buildControl;
  window.resolveSchema = resolveSchema;
  window.defaultValueFor = defaultValueFor;
  window.resolvePolymorphicCandidates = resolvePolymorphicCandidates;
}
