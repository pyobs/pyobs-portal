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
 *   const form = new SchemaForm(schema, defs, data, { ignoredFields, polymorphic, moduleRefs });
 *   container.appendChild(form.element);
 *   ...
 *   const data = form.getData();
 *
 * `polymorphic` is the `{base: [{class, title, schema}]}` map produced by
 * resolvePolymorphicCandidates() from script_tree()'s `$polymorphic`
 * registry; omit it for schemas with no `x-pyobs-polymorphic` fields
 * (constraints/merits/targets today).
 *
 * `moduleRefs` is the `{interface_name: [module_name, ...]}` map fetched from
 * /api/schema/modules/ (issue #98), threaded down to every nested control so
 * an `x-pyobs-module-ref` field can be rendered at any depth; omit it for
 * schemas with no such fields (or before pyobs-core carries the interface
 * metadata this feature reads -- it degrades to a plain text input either
 * way).
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

/** A polymorphic field's union can mix a plain scalar with its polymorphic base (e.g.
 * `exposure_time: float | ExposureTimeProvider`) -- schema.py's `_annotate_module_refs`
 * marks the whole node `x-pyobs-polymorphic` without discarding the original `anyOf`, so the
 * non-$ref, non-null branch (the scalar alternative) is still sitting right there. Returns its
 * resolved schema, or null if this polymorphic field has no such alternative (the common case,
 * e.g. `Script | None`, where every branch is the polymorphic base itself or null). */
function scalarBranchFor(resolved, defs) {
  if (!Array.isArray(resolved.anyOf)) return null;
  for (const branch of resolved.anyOf) {
    if (!branch || branch.$ref || branch.type === "null") continue;
    return resolveSchema(branch, defs);
  }
  return null;
}

/** True for fields whose control is itself another form (object/array/map/
 * polymorphic) rather than a single scalar input. These get a full-width,
 * label-above row instead of the two-column layout (issue #94 follow-up):
 * squeezing a nested form (e.g. each `InstrumentConfig` in a list) into a
 * col-sm-8 leaves it very little room, especially once nested again inside
 * its own two-column rows. Mirrors buildControl's own dispatch below so the
 * row layout always matches what actually gets rendered.
 *
 * `value` (optional) only matters for a polymorphic field with a scalar alternative (e.g.
 * `exposure_time: float | ExposureTimeProvider`): its row starts two-column/compact -- the
 * "Fixed value" dropdown option plus a plain number input fit fine next to a label, same as
 * any other scalar field -- unless the stored value is already a concrete provider instance
 * (`{class: ..., ...}`), which needs the full-width nested-form treatment from the start. Once
 * built, the control itself flips its own row between the two layouts as the user switches
 * between "Fixed value" and a candidate class (see the "pyobs:field-structural-change" listener
 * in SchemaForm._build()) -- this only decides where it starts. */
function isStructuralField(resolved, defs, value) {
  if (resolved["x-pyobs-polymorphic"]) {
    if (!scalarBranchFor(resolved, defs)) return true;
    return value !== undefined && value !== null && typeof value === "object" && value.class !== undefined;
  }
  if (resolved.anyOf) {
    const nonNull = resolved.anyOf.filter((o) => o.type !== "null");
    if (nonNull.find((o) => resolveSchema(o, defs).format === "date-time")) return false;
    if (nonNull.length === 1) return isStructuralField(resolveSchema(nonNull[0], defs), defs, value);
    return false; // ambiguous union -> a single raw-YAML textarea, not a nested form
  }
  if (resolved.enum || resolved.format === "date-time") return false;
  return resolved.type === "array" || resolved.type === "object";
}

/** Set a field row's layout classes -- shared between SchemaForm._build()'s initial render
 * and its "pyobs:field-structural-change" listener, which re-applies this when a polymorphic
 * field with a scalar alternative switches between its compact and full-width states (see
 * isStructuralField() and buildPolymorphicControl()). */
function applyRowLayout(row, label, content, structural) {
  row.className = structural ? "mb-2" : "row mb-2";
  label.className = structural
    ? "form-label small text-secondary mb-1"
    : "col-sm-4 col-form-label col-form-label-sm small text-secondary mb-1 mb-sm-0";
  content.className = structural ? "" : "col-sm-8";
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
  // A new enum item needs a real member as its default -- falling through to
  // the generic string/number default below (e.g. "") would trip
  // buildEnumControl's issue #101 invalid-value fallback on every "Add"
  // click, same reasoning as buildPolymorphicControl defaulting to its
  // first candidate for a brand-new item.
  if (resolved.enum && resolved.enum.length) return resolved.enum[0];
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

/** Whether `value` looks like a parseable ISO-ish datetime (the same prefix
 * toDatetimeLocal() below matches) -- used to decide whether it's safe to
 * hand to an <input type=datetime-local> at all (issue #101). */
function isParseableDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(value));
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
   * @param {object} opts - { ignoredFields: Set<string>, polymorphic: object, moduleRefs: object }
   *   `polymorphic` is the flattened `{ base: [{class, title, schema}] }` map
   *   produced by `resolvePolymorphicCandidates()`, threaded down to every
   *   nested control so a polymorphic field can be rendered at any depth.
   *   `moduleRefs` is the `{ available, options: { interface_name: [module_name, ...] } }`
   *   result from /api/schema/modules/ (issue #98), threaded the same way.
   */
  constructor(schema, defs, data, opts = {}) {
    this.defs = defs || {};
    this.data = data || {};
    this.ignored = opts.ignoredFields || new Set();
    this.polymorphic = opts.polymorphic || {};
    this.moduleRefs = opts.moduleRefs || { available: false, options: {} };
    this.fields = {}; // name -> { getValue, schema }
    this.element = document.createElement("div");
    this.element.className = "schema-form";
    this._build(resolveSchema(schema, this.defs));
  }

  _build(schema) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    for (const [name, propSchema] of Object.entries(props)) {
      if (this.ignored.has(name)) continue;
      const resolved = resolveSchema(propSchema, this.defs);
      const value = this.data[name];
      const { control, getValue, resolvePath } = buildControl(
        resolved,
        this.defs,
        value,
        this.ignored,
        this.polymorphic,
        this.moduleRefs
      );
      const structural = isStructuralField(resolved, this.defs, value);

      // Two columns (label | field) on wide screens, stacked on narrow/mobile,
      // for scalar fields (issue #94); structural fields (object/array/map/
      // polymorphic) instead get a full-width row -- see isStructuralField().
      const row = document.createElement("div");
      const label = document.createElement("label");
      label.textContent = prettyLabel(name, resolved);
      if (required.has(name)) {
        const star = document.createElement("span");
        star.className = "text-danger ms-1";
        star.title = "Required";
        star.textContent = "*";
        label.appendChild(star);
      }
      row.appendChild(label);
      const content = document.createElement("div");
      applyRowLayout(row, label, content, structural);
      content.appendChild(control);
      // A polymorphic field with a scalar alternative (buildPolymorphicControl,
      // scalarSchema) starts compact but switches its own row full-width the moment a
      // concrete provider class is picked -- a nested form needs the room a col-sm-8
      // can't spare, same reasoning isStructuralField already applies up front for a
      // field whose *stored* value is already a class instance.
      content.addEventListener("pyobs:field-structural-change", (e) => {
        applyRowLayout(row, label, content, e.detail.structural);
      });
      if (resolved.description) {
        const help = document.createElement("div");
        help.className = "form-text small mt-1";
        help.textContent = resolved.description;
        content.appendChild(help);
      }
      row.appendChild(content);
      this.element.appendChild(row);
      this.fields[name] = { getValue, schema: resolved, rowEl: row, resolvePath };
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

  /** Walk a pydantic ValidationError's `loc` path (issue #102, e.g.
   * `["configuration", "instrument_configs", 0, "window", 0]`, as returned
   * by validate_script/) down through this form's fields -- and, via each
   * field's own `resolvePath`, into nested object/array/map/polymorphic
   * sub-forms -- to find the DOM row the error should be flagged against.
   * Degrades gracefully: if a path segment can't be resolved any deeper
   * (e.g. it names a field this builder doesn't decompose further, like a
   * tuple rendered as a single control), returns the nearest ancestor field
   * that *was* resolved rather than nothing, so the error still lands
   * somewhere close to the actual problem instead of being dropped. Returns
   * `null` only if the very first segment doesn't match any field here. */
  resolveFieldPath(loc) {
    if (!loc || !loc.length) return null;
    const [head, ...rest] = loc;
    const field = this.fields[head];
    if (!field) return null;
    if (rest.length && field.resolvePath) {
      const nested = field.resolvePath(rest);
      if (nested) return nested;
    }
    return { rowEl: field.rowEl };
  }
}

/**
 * Build a control (and a getValue() accessor) for a single resolved schema.
 * Returns { control: HTMLElement, getValue: () => any, resolvePath?: (loc)
 * => {rowEl} | null }. `resolvePath` is only present for controls that
 * decompose into further-navigable sub-fields (object/array/map/polymorphic,
 * issue #102) -- absent on leaf controls (primitives, raw YAML fallbacks).
 */
function buildControl(resolved, defs, value, ignored, polymorphic, moduleRefs) {
  // Polymorphic script/provider field (backend-annotated) -- checked before
  // the generic anyOf/object branches below, since a polymorphic field's own
  // schema node is often itself an anyOf (e.g. `float | ExposureTimeProvider`)
  // or a bare $ref (e.g. `Script`).
  if (resolved["x-pyobs-polymorphic"]) {
    return buildPolymorphicControl(
      resolved["x-pyobs-polymorphic"],
      defs,
      value,
      ignored,
      polymorphic,
      moduleRefs,
      scalarBranchFor(resolved, defs)
    );
  }

  // Module-name field (backend-annotated, issue #98) -- same reasoning as
  // the polymorphic check above: `camera: Annotated[str, ICamera]` and
  // `telescope: Annotated[str | None, ITelescope]` both carry the marker on
  // this outer node (confirmed against schema.py's _annotate_module_refs),
  // so this must also be checked before the anyOf branch below.
  if (resolved["x-pyobs-module-ref"]) {
    return buildModuleRefControl(resolved["x-pyobs-module-ref"], value, moduleRefs);
  }

  // anyOf: optional fields (X | None), Time fields, or other unions
  if (resolved.anyOf) {
    const nonNull = resolved.anyOf.filter((o) => o.type !== "null");
    const dateTime = nonNull.find((o) => resolveSchema(o, defs).format === "date-time");
    if (dateTime) {
      return buildDateTimeControl(value);
    }
    if (nonNull.length === 1) {
      return buildControl(resolveSchema(nonNull[0], defs), defs, value, ignored, polymorphic, moduleRefs);
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
      return buildArrayControl(resolved, defs, value, ignored, polymorphic, moduleRefs);
    case "object":
      // Dynamic map (additionalProperties-only, no fixed properties) --
      // e.g. CasesRunner.cases: dict[str, Script].
      if (resolved.additionalProperties && !resolved.properties) {
        return buildMapControl(resolved, defs, value, ignored, polymorphic, moduleRefs);
      }
      return buildObjectControl(resolved, defs, value, ignored, polymorphic, moduleRefs);
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
  // issue #101: a stored value of the wrong type (e.g. a YAML string/bool
  // where a number belongs) would otherwise be silently sanitized away --
  // `input.value = value` on a <input type=number> blanks to "", and
  // getValue() then reads that back as 0, losing the original value before
  // Save is even clicked. Flag it and fall back to raw YAML instead, like
  // buildPolymorphicControl already does for an unmappable class.
  if (value !== undefined && value !== null && (typeof value !== "number" || Number.isNaN(value))) {
    return buildInvalidValueFallback(value, "Stored value doesn't match this field's type (expected a number).");
  }
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

/**
 * Module-name field (`x-pyobs-module-ref` marker, issue #98): a real <select> of module names
 * implementing every interface in `marker.interfaces` (AND semantics -- intersected below,
 * since e.g. DarkBiasScript.camera requires IData+IBinning+IWindow+IExposureTime+IImageType all
 * at once), populated from `moduleRefs.options` (the /api/schema/modules/ result).
 *
 * Falls back to a plain free-text <input> only when `moduleRefs.available` is false
 * (WEBADMIN_URL unset, web-admin unreachable, or its response was unusable) -- script editing
 * must never be blocked on web-admin being reachable. When available, values are restricted to
 * configured modules (issue #98 follow-up): a stored value that isn't in the option list
 * (module since renamed/removed, or edited before web-admin was linked) still gets its own
 * synthetic <option> so it's shown and kept rather than silently swapped for whichever option
 * happens to be first -- validate_script/'s matching server-side check
 * (schema._collect_module_ref_errors) then flags it invalid via the normal {loc, msg}
 * mechanism, which marks this <select> with .is-invalid the same way any other field error does
 * (see ScriptBuilder._applyFieldErrors).
 */
function buildModuleRefControl(marker, value, moduleRefs) {
  const interfaces = marker.interfaces || [];
  const available = !!(moduleRefs && moduleRefs.available);
  const hasValue = value !== undefined && value !== null && value !== "";

  if (!available) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control form-control-sm";
    if (hasValue) input.value = value;
    return { control: input, getValue: () => input.value };
  }

  const options = (moduleRefs && moduleRefs.options) || {};
  const names = interfaces.length
    ? interfaces.map((i) => options[i] || []).reduce((a, b) => a.filter((name) => b.includes(name)))
    : [];

  const select = document.createElement("select");
  select.className = "form-select form-select-sm";

  const blank = document.createElement("option");
  blank.value = "";
  select.appendChild(blank);

  if (hasValue && !names.includes(value)) {
    const invalidOption = document.createElement("option");
    invalidOption.value = value;
    invalidOption.textContent = `${value} (unknown module)`;
    select.appendChild(invalidOption);
  }

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }

  if (hasValue) select.value = value;

  return { control: select, getValue: () => select.value };
}

function buildEnumControl(resolved, value) {
  // issue #101: a stored value outside the enum would otherwise leave no
  // <option> selected, so the native <select> silently falls back to its
  // first option with no indication the value changed. `value` is `null`
  // for a legitimately unset Optional[...] field (buildControl's anyOf
  // branch passes it through as-is) -- not a mismatch, so that's excluded.
  if (value !== undefined && value !== null && !resolved.enum.includes(value)) {
    return buildInvalidValueFallback(value, "Stored value isn't one of this field's allowed options.");
  }
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
  // issue #101: an unparseable stored string would otherwise sanitize to ""
  // the moment the form renders (getValue() then reads back `null`), before
  // Save is even clicked.
  if (value !== undefined && value !== null && !isParseableDateTime(value)) {
    return buildInvalidValueFallback(value, "Stored value isn't a recognizable date/time.");
  }
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

/** Wraps buildYamlControl() with a visible warning for a primitive field
 * (number/enum/date-time) whose stored value doesn't validate against its
 * own schema (issue #101) -- mirrors buildPolymorphicControl's raw-YAML
 * fallback for an unmappable class, so the value is flagged and preserved
 * (round-trips through Save untouched) rather than silently sanitized away,
 * until the user notices and either fixes or replaces it. */
function buildInvalidValueFallback(value, reason) {
  const wrap = document.createElement("div");
  const warn = document.createElement("div");
  warn.className = "small text-warning mb-1";
  warn.textContent = `⚠ ${reason} Preserved as raw YAML below.`;
  wrap.appendChild(warn);
  const { control, getValue } = buildYamlControl(value);
  wrap.appendChild(control);
  return { control: wrap, getValue };
}

/** Nested object -> sub-form inside a bordered card. */
function buildObjectControl(resolved, defs, value, ignored, polymorphic, moduleRefs) {
  const card = document.createElement("div");
  card.className = "border rounded p-2 border-secondary-subtle";
  const form = new SchemaForm(resolved, defs, value || {}, { ignoredFields: ignored, polymorphic, moduleRefs });
  card.appendChild(form.element);
  return { control: card, getValue: () => form.getData(), resolvePath: (loc) => form.resolveFieldPath(loc) };
}

/** Array of objects, primitives, or polymorphic nodes -> add/remove list. */
function buildArrayControl(resolved, defs, value, ignored, polymorphic, moduleRefs) {
  const itemSchema = resolveSchema(resolved.items || {}, defs);

  const wrap = document.createElement("div");
  const list = document.createElement("div");
  list.className = "d-flex flex-column gap-2 mb-2";
  wrap.appendChild(list);

  const items = []; // { row, getValue, resolvePath }

  function addItem(itemValue) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2";

    // Delegates to buildControl's own dispatch (object / polymorphic /
    // primitive) so array items of any of those shapes render correctly,
    // instead of re-implementing the object-vs-primitive branch here.
    const { control, getValue, resolvePath } = buildControl(itemSchema, defs, itemValue, ignored, polymorphic, moduleRefs);
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

    items.push({ row, getValue, resolvePath });
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
    // issue #102: pydantic's array-index loc segments (e.g. `scripts.0...`)
    // map 1:1 onto `items`' insertion order.
    resolvePath: (loc) => {
      const [idx, ...rest] = loc;
      const item = items[Number(idx)];
      if (!item) return null;
      if (rest.length && item.resolvePath) {
        const nested = item.resolvePath(rest);
        if (nested) return nested;
      }
      return { rowEl: item.row };
    },
  };
}

/**
 * Dynamic map (`additionalProperties`-only object, e.g. `CasesRunner.cases`)
 * -> key/value list editor. Generic for any `additionalProperties` schema,
 * not just polymorphic ones: the value control comes from buildControl's own
 * dispatch, so a plain `dict[str, str]` gets a text input per row here too.
 */
function buildMapControl(resolved, defs, value, ignored, polymorphic, moduleRefs) {
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

    const { control, getValue, resolvePath } = buildControl(valueSchema, defs, itemValue, ignored, polymorphic, moduleRefs);
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

    rows.push({ row, keyInput, getValue, resolvePath });
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
    // issue #102: a dict-field loc segment is the actual key string.
    resolvePath: (loc) => {
      const [key, ...rest] = loc;
      const row = rows.find((r) => r.keyInput.value === key);
      if (!row) return null;
      if (rest.length && row.resolvePath) {
        const nested = row.resolvePath(rest);
        if (nested) return nested;
      }
      return { rowEl: row.row };
    },
  };
}

const POLYMORPHIC_SCALAR_OPTION = "__pyobs_scalar__";

/**
 * Polymorphic field (`x-pyobs-polymorphic` marker): a class-selector dropdown
 * (grouped by module path for Script candidates) plus a nested SchemaForm for
 * whichever class is currently selected. `getValue()` always returns
 * `{"class": "<fqcn>", ...fields}` (or `null` for an unset optional field) --
 * never a class-less dict.
 *
 * `scalarSchema` (from `scalarBranchFor()`) is non-null for a field whose union mixes a plain
 * scalar with its polymorphic base (e.g. `exposure_time: float | ExposureTimeProvider`) -- adds
 * a "Fixed value" option alongside the class candidates, rendering `scalarSchema`'s own control
 * (a plain number input here) instead of a nested form. Without this, a field carrying a bare
 * scalar value (never a `{class: ...}` dict) would silently be treated as "no existing value"
 * and default to whichever candidate class happens to be first, discarding the real value on
 * every save without so much as a checkbox to enter a plain number.
 */
function buildPolymorphicControl(marker, defs, value, ignored, polymorphic, moduleRefs, scalarSchema) {
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

  // A field with a scalar alternative lays the dropdown and its "Fixed value" control out on
  // one line (matches its row's compact, two-column layout -- see isStructuralField()); picking
  // a candidate class instead needs the room a nested form takes, so that goes back to stacked,
  // full width. A field with no scalar alternative (e.g. Script | None) is always structural
  // and always stacked -- isCompactMode() is never consulted for it below.
  function isCompactMode(mode) {
    return mode === POLYMORPHIC_SCALAR_OPTION || mode === "";
  }
  function applyWrapLayout(mode) {
    wrap.className = scalarSchema && isCompactMode(mode) ? "d-flex flex-row gap-2 align-items-start" : "d-flex flex-column gap-2";
  }

  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  if (scalarSchema) {
    // .form-select's own width: 100% would otherwise become this flex item's resolved
    // flex-basis (flex-basis: auto takes its value from width when one is set), so the
    // select claims the whole row regardless of flex-grow/shrink -- override both explicitly.
    select.style.flex = "0 0 auto";
    select.style.width = "auto";
  }

  if (isOptional) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    select.appendChild(none);
  }

  if (scalarSchema) {
    const scalarOption = document.createElement("option");
    scalarOption.value = POLYMORPHIC_SCALAR_OPTION;
    scalarOption.textContent = "Fixed value";
    select.appendChild(scalarOption);
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
  if (scalarSchema) nestedWrap.className = "flex-grow-1";
  wrap.appendChild(nestedWrap);
  let current = null; // { getValue, resolvePath? } for whatever's currently rendered below

  function renderNested(mode, data) {
    nestedWrap.innerHTML = "";
    current = null;
    applyWrapLayout(mode);
    if (mode === POLYMORPHIC_SCALAR_OPTION) {
      const built = buildControl(scalarSchema, defs, data, ignored, polymorphic, moduleRefs);
      nestedWrap.appendChild(built.control);
      current = built;
      return;
    }
    const candidate = candidates.find((c) => c.class === mode);
    if (!candidate) return;
    const card = document.createElement("div");
    card.className = "border rounded p-2 border-secondary-subtle";
    const form = new SchemaForm(candidate.schema || {}, defs, data || {}, {
      ignoredFields: ignored,
      polymorphic,
      moduleRefs,
    });
    card.appendChild(form.element);
    nestedWrap.appendChild(card);
    current = { getValue: () => form.getData(), resolvePath: (loc) => form.resolveFieldPath(loc) };
  }

  const initialMode = hasExisting
    ? value.class
    : scalarSchema && !hasClass
      ? POLYMORPHIC_SCALAR_OPTION
      : isOptional
        ? ""
        : candidates[0].class;
  select.value = initialMode;
  renderNested(initialMode, initialMode === POLYMORPHIC_SCALAR_OPTION || hasExisting ? value : undefined);

  select.addEventListener("change", () => {
    renderNested(select.value, undefined);
    if (scalarSchema) {
      wrap.dispatchEvent(
        new CustomEvent("pyobs:field-structural-change", {
          bubbles: true,
          detail: { structural: !isCompactMode(select.value) },
        })
      );
    }
  });

  return {
    control: wrap,
    getValue: () => {
      if (!select.value) return null;
      if (select.value === POLYMORPHIC_SCALAR_OPTION) return current ? current.getValue() : undefined;
      return { class: select.value, ...(current ? current.getValue() : {}) };
    },
    // issue #102: PolymorphicBaseModel's deserialization validator resolves
    // the concrete class and validates *that* model directly, so a loc path
    // continues straight into the concrete class's own fields with no
    // "class"-selection segment of its own -- delegate as-is, not loc.slice(1).
    // The scalar branch has no sub-fields of its own to resolve into, so this
    // naturally returns null there (current.resolvePath is undefined).
    resolvePath: (loc) => (current && current.resolvePath ? current.resolvePath(loc) : null),
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
  window.isStructuralField = isStructuralField;
  window.prettyLabel = prettyLabel;
}
