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
 *   const form = new SchemaForm(schema, defs, data);
 *   container.appendChild(form.element);
 *   ...
 *   const data = form.getData();
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
    case "object":
      return {};
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
   * @param {object} opts - { ignoredFields: Set<string> }
   */
  constructor(schema, defs, data, opts = {}) {
    this.defs = defs || {};
    this.data = data || {};
    this.ignored = opts.ignoredFields || new Set();
    this.fields = {}; // name -> { getValue, schema }
    this.element = document.createElement("div");
    this._build(resolveSchema(schema, this.defs));
  }

  _build(schema) {
    const props = schema.properties || {};
    for (const [name, propSchema] of Object.entries(props)) {
      if (this.ignored.has(name)) continue;
      const resolved = resolveSchema(propSchema, this.defs);
      const value = this.data[name];
      const { control, getValue } = buildControl(resolved, this.defs, value, this.ignored);
      const row = document.createElement("div");
      row.className = "mb-2";
      const label = document.createElement("label");
      label.className = "form-label small text-secondary mb-1";
      label.textContent = prettyLabel(name, resolved);
      row.appendChild(label);
      row.appendChild(control);
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
function buildControl(resolved, defs, value, ignored) {
  // anyOf: optional fields (X | None), Time fields, or other unions
  if (resolved.anyOf) {
    const nonNull = resolved.anyOf.filter((o) => o.type !== "null");
    const dateTime = nonNull.find((o) => resolveSchema(o, defs).format === "date-time");
    if (dateTime) {
      return buildDateTimeControl(value);
    }
    if (nonNull.length === 1) {
      return buildControl(resolveSchema(nonNull[0], defs), defs, value, ignored);
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
      return buildBoolControl(value);
    case "integer":
      return buildNumberControl(resolved, value, true);
    case "number":
      return buildNumberControl(resolved, value, false);
    case "string":
      return buildStringControl(resolved, value);
    case "array":
      return buildArrayControl(resolved, defs, value, ignored);
    case "object":
      return buildObjectControl(resolved, defs, value, ignored);
    default:
      return buildYamlControl(value);
  }
}

function buildBoolControl(value) {
  const wrap = document.createElement("div");
  wrap.className = "form-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.checked = !!value;
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
function buildObjectControl(resolved, defs, value, ignored) {
  const card = document.createElement("div");
  card.className = "border rounded p-2 border-secondary-subtle";
  const form = new SchemaForm(resolved, defs, value || {}, { ignoredFields: ignored });
  card.appendChild(form.element);
  return { control: card, getValue: () => form.getData() };
}

/** Array of objects or primitives -> add/remove list. */
function buildArrayControl(resolved, defs, value, ignored) {
  const itemSchema = resolveSchema(resolved.items || {}, defs);
  const isObjectItems = itemSchema.type === "object" || itemSchema.properties;

  const wrap = document.createElement("div");
  const list = document.createElement("div");
  list.className = "d-flex flex-column gap-2 mb-2";
  wrap.appendChild(list);

  const items = []; // { element, getValue }

  function addItem(itemValue) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2";

    let getValue;
    if (isObjectItems) {
      const card = document.createElement("div");
      card.className = "border rounded p-2 border-secondary-subtle flex-grow-1";
      const form = new SchemaForm(itemSchema, defs, itemValue || {}, { ignoredFields: ignored });
      card.appendChild(form.element);
      row.appendChild(card);
      getValue = () => form.getData();
    } else {
      const { control, getValue: gv } = buildControl(itemSchema, defs, itemValue, ignored);
      control.classList.add("flex-grow-1");
      row.appendChild(control);
      getValue = gv;
    }

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
