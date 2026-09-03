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
 * A polymorphic field with a scalar alternative (e.g. `exposure_time: float |
 * ExposureTimeProvider`) is the one exception: its row is never structural -- the dropdown
 * always stays in the two-column layout's right column, same as any other scalar field,
 * regardless of whether "Fixed value" or a candidate class is selected. A candidate class's
 * nested form still needs full width, but buildPolymorphicControl() gets that by returning it
 * as `extra` -- a separate block SchemaForm._build() places right after this (always
 * two-column) row -- rather than by changing the row itself. An earlier version instead toggled
 * the whole row full-width on a class pick, which needed a "pyobs:field-structural-change"
 * event every field row's listener reacted to; an unstopped bubble from one field's toggle
 * corrupted every ancestor row's layout too (confirmed live: exposure_time flipping back to
 * "Fixed value" was collapsing the enclosing "Instrument Configs" array row) -- gone now that
 * the row never needs to change in the first place. */
function isStructuralField(resolved, defs) {
  if (resolved["x-pyobs-polymorphic"]) return !scalarBranchFor(resolved, defs);
  if (resolved.anyOf) {
    const nonNull = resolved.anyOf.filter((o) => o.type !== "null");
    if (nonNull.find((o) => resolveSchema(o, defs).format === "date-time")) return false;
    if (nonNull.length === 1) return isStructuralField(resolveSchema(nonNull[0], defs), defs);
    return false; // ambiguous union -> a single raw-YAML textarea, not a nested form
  }
  if (resolved.enum || resolved.format === "date-time") return false;
  // A fixed-length tuple (pydantic `tuple[int, int]` -> JSON Schema `prefixItems`, not `items`,
  // issue: ImaginScript's `binning` field) renders as a compact row of scalar controls via
  // buildTupleControl -- same two-column treatment as any other scalar field, not the full-width
  // add/remove array UI a dynamic-length array gets.
  if (resolved.type === "array" && resolved.prefixItems) return false;
  // A dynamic-length array is full-width only when its items are themselves forms -- nested
  // objects/polymorphic nodes (e.g. each `InstrumentConfig` in a list, `SequentialRunner`'s
  // `scripts`), which genuinely need more room than col-sm-8 can spare. An array of plain
  // scalars (`DarkBiasScript.exptimes: list[float]`) instead renders as compact per-item
  // inputs via buildArrayControl and keeps the two-column row like any other scalar field --
  // before this, the whole row (including the optional set/unset checkbox and the description
  // under it) spanned the full form width. Mirrors buildArrayControl's own dispatch on the
  // items schema.
  if (resolved.type === "array") {
    return isStructuralField(resolveSchema(resolved.items || {}, defs), defs);
  }
  return resolved.type === "object";
}

/** Set a field row's layout classes, given whether isStructuralField() says this field's row is
 * full-width or two-column. Used once, at SchemaForm._build()'s initial render. */
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
      const { control, getValue, resolvePath, extra, descriptionHandled } = buildControl(
        resolved,
        this.defs,
        value,
        this.ignored,
        this.polymorphic,
        this.moduleRefs
      );
      const structural = isStructuralField(resolved, this.defs);

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
      // Checkbox controls (bool / optional set-unset) consume their description as an inline
      // label next to the box (see buildBoolControl / buildOptionalControl) and flag it via
      // `descriptionHandled`; every other control gets the description as help text below.
      if (resolved.description && !descriptionHandled) {
        const help = document.createElement("div");
        help.className = "form-text small mt-1";
        // pre-wrap (not a plain block) so a multi-line description (e.g. a docstring with
        // blank-line-separated paragraphs, pyobs-core#811) keeps its line breaks instead of
        // collapsing to one run-on line -- textContent alone strips nothing, but the browser's
        // default white-space handling for a <div> does.
        help.style.whiteSpace = "pre-wrap";
        help.textContent = resolved.description;
        content.appendChild(help);
      }
      row.appendChild(content);
      this.element.appendChild(row);
      // `extra` (buildPolymorphicControl, a scalar-alternative field like exposure_time): a
      // candidate class's nested form, placed full-width right after this row instead of
      // squeezed into its col-sm-8 -- see buildPolymorphicControl's own comment for why.
      if (extra) this.element.appendChild(extra);
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
      const branch = resolveSchema(nonNull[0], defs);
      // Any nullable field (e.g. InstrumentConfig.window: tuple[...] | None, optical_filter: str |
      // None, or a plain Optional[SomeConfig]) needs its own control: collapsing straight into
      // buildControl(branch) below would lose the null/unset state entirely -- e.g. a brand-new or
      // previously-null tuple has no array to read, so every element falls back to 0, and
      // (0,0,0,0) is indistinguishable from an explicit zero-origin/zero-size value even though it
      // means something very different downstream (None -> full frame for `window`). Same defect
      // for a plain string (falls back to ""), enum (falls back to its first option), object
      // (renders with every sub-field defaulted) -- see buildOptionalControl.
      const isNullable = nonNull.length !== resolved.anyOf.length;
      if (isNullable) {
        return buildOptionalControl(branch, defs, value, ignored, polymorphic, moduleRefs, resolved.description);
      }
      return buildControl(branch, defs, value, ignored, polymorphic, moduleRefs);
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
      // Fixed-length tuple (`prefixItems`, e.g. pydantic's `tuple[int, int]`) -- a dynamic-length
      // array has `items` instead and goes through buildArrayControl below.
      if (resolved.prefixItems) {
        return buildTupleControl(resolved, defs, value, ignored, polymorphic, moduleRefs);
      }
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
  if (resolved.description) {
    // Render the field description as this checkbox's inline label (Bootstrap's standard
    // form-check pattern, `[x] text`), instead of letting SchemaForm._build() drop it as
    // help text below the control -- a lone box with its explanatory text stacked under it
    // read as "the label is below the checkbox" rather than beside it.
    const label = document.createElement("label");
    label.className = "form-check-label small text-secondary";
    label.textContent = resolved.description;
    wrap.appendChild(label);
  }
  return { control: wrap, getValue: () => input.checked, descriptionHandled: true };
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
 *
 * issue #132: with exactly one candidate module and no stored value, that module is preselected
 * instead of leaving the blank option active -- but only when `marker.required` (from
 * schema._annotate_module_refs) is true. A field with a default (almost always `None`, e.g.
 * ImagingScript.telescope/filters/autoguider/acquisition) is frequently *meant* to stay unset --
 * their docstrings read "Required if ..." -- so auto-filling it would silently turn "not
 * applicable to this exposure" into an explicit module reference the user never chose.
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
  else if (marker.required && names.length === 1) select.value = names[0];

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

/**
 * Fixed-length tuple (`prefixItems`, e.g. pydantic's `tuple[int, int]` -> ImaginScript's
 * `binning`, or `tuple[int, int, int, int]` -> `window`) -> one compact control per element,
 * laid out in a row with no add/remove buttons (the length can't change). Without this, these
 * fell through to buildArrayControl's `resolved.items || {}` (undefined for a tuple schema),
 * rendering each element as a full-size raw-YAML textarea instead of e.g. a plain number input.
 */
function buildTupleControl(resolved, defs, value, ignored, polymorphic, moduleRefs) {
  const itemSchemas = resolved.prefixItems.map((s) => resolveSchema(s, defs));

  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-row gap-2";

  const items = itemSchemas.map((itemSchema, i) => {
    const itemValue = Array.isArray(value) ? value[i] : undefined;
    const { control, getValue, resolvePath } = buildControl(itemSchema, defs, itemValue, ignored, polymorphic, moduleRefs);
    wrap.appendChild(control);
    return { getValue, resolvePath };
  });

  return {
    control: wrap,
    getValue: () => items.map((it) => it.getValue()),
    resolvePath: (loc) => {
      const [idx, ...rest] = loc;
      const item = items[Number(idx)];
      if (!item) return null;
      return rest.length && item.resolvePath ? item.resolvePath(rest) : null;
    },
  };
}

/** Any nullable field whose non-null branch has its own "empty" value that isn't None -- a
 * fixed-length tuple (`window: tuple[int,int,int,int] | None`, where None means "full frame"
 * downstream, not a zero-origin/zero-size window), a plain string (`optical_filter: str | None`,
 * where None differs from ""), an enum, a number/bool, or a plain nested object. A checkbox
 * tracks the set/unset state explicitly instead of inferring it from the branch control's value,
 * so a brand-new or previously-null field round-trips as `null` rather than silently becoming
 * that branch's zero-ish default.
 *
 * `description` is the outer field's description (the non-null branch's schema doesn't carry
 * it): when present, it renders as the checkbox's inline label (same reasoning as
 * buildBoolControl -- `[x] text`, not text under the box), with the branch control below it on
 * its own line. Without a description the checkbox and the branch control stay side by side as
 * before (`[x] [control]`). */
function buildOptionalControl(branchSchema, defs, value, ignored, polymorphic, moduleRefs, description) {
  const isSet = value !== undefined && value !== null;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "form-check-input mt-1 flex-shrink-0";
  checkbox.checked = isSet;

  const area = document.createElement("div");
  area.style.display = checkbox.checked ? "" : "none";

  const built = buildControl(branchSchema, defs, isSet ? value : undefined, ignored, polymorphic, moduleRefs);
  area.appendChild(built.control);

  checkbox.addEventListener("change", () => {
    area.style.display = checkbox.checked ? "" : "none";
  });

  const wrap = document.createElement("div");
  if (description) {
    wrap.className = "d-flex flex-column gap-2";
    const head = document.createElement("div");
    head.className = "d-flex flex-row align-items-start gap-2";
    head.appendChild(checkbox);
    const label = document.createElement("label");
    label.className = "form-check-label small text-secondary";
    label.textContent = description;
    head.appendChild(label);
    wrap.appendChild(head);
    wrap.appendChild(area);
  } else {
    wrap.className = "d-flex flex-row align-items-start gap-2";
    wrap.appendChild(checkbox);
    area.className = "flex-grow-1";
    wrap.appendChild(area);
  }

  return {
    control: wrap,
    getValue: () => (checkbox.checked ? built.getValue() : null),
    resolvePath: (loc) => (checkbox.checked && built.resolvePath ? built.resolvePath(loc) : null),
    descriptionHandled: true,
  };
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

  const select = document.createElement("select");
  select.className = "form-select form-select-sm";

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

  // issue #102: PolymorphicBaseModel's deserialization validator resolves the concrete class
  // and validates *that* model directly, so a loc path continues straight into the concrete
  // class's own fields with no "class"-selection segment of its own -- both branches below
  // delegate to `current.resolvePath` as-is, not loc.slice(1).
  let current = null; // { getValue, resolvePath? } for whatever candidate/value is current

  if (!scalarSchema) {
    // No scalar alternative (e.g. `Script | None`): unchanged from before this field type had
    // one at all -- the dropdown and the selected candidate's nested form stack vertically,
    // inside this field's own row, itself always full-width (isStructuralField()).
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    wrap.appendChild(select);
    const nestedWrap = document.createElement("div");
    wrap.appendChild(nestedWrap);

    function renderNested(mode, data) {
      nestedWrap.innerHTML = "";
      current = null;
      const candidate = candidates.find((c) => c.class === mode);
      if (!candidate) return;
      const card = document.createElement("div");
      card.className = "border rounded p-2 border-secondary-subtle";
      const form = new SchemaForm(candidate.schema || {}, { ...defs, ...(candidate.schema && candidate.schema.$defs) }, data || {}, {
        ignoredFields: ignored,
        polymorphic,
        moduleRefs,
      });
      card.appendChild(form.element);
      nestedWrap.appendChild(card);
      current = { getValue: () => form.getData(), resolvePath: (loc) => form.resolveFieldPath(loc) };
    }

    // issue #132: an optional field with exactly one registered candidate is preselected too --
    // otherwise it defaults to "(none)" even though there's nothing else to pick.
    const initialMode = hasExisting
      ? value.class
      : isOptional && candidates.length !== 1
        ? ""
        : candidates[0].class;
    select.value = initialMode;
    renderNested(initialMode, hasExisting ? value : undefined);
    select.addEventListener("change", () => renderNested(select.value, undefined));

    return {
      control: wrap,
      getValue: () => {
        if (!select.value) return null;
        return { class: select.value, ...(current ? current.getValue() : {}) };
      },
      resolvePath: (loc) => (current && current.resolvePath ? current.resolvePath(loc) : null),
    };
  }

  // With a scalar alternative (e.g. `exposure_time: float | ExposureTimeProvider`): the
  // dropdown stays in this field's row's own two-column right column always, same as any other
  // scalar field, regardless of what's selected -- "Fixed value" renders inline next to it, but
  // a candidate class's nested form is returned as `extra`, a separate block
  // SchemaForm._build() places full-width right after this field's row instead of squeezing it
  // into that row's col-sm-8 (not needed for "Fixed value": a single control fits fine inline).
  select.style.flex = "0 0 auto"; // .form-select's own width: 100% would otherwise become this
  select.style.width = "auto"; // flex item's resolved flex-basis, claiming the whole line.

  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-row gap-2 align-items-start";
  wrap.appendChild(select);
  const inlineArea = document.createElement("div");
  inlineArea.className = "flex-grow-1";
  wrap.appendChild(inlineArea);

  const fullWidthArea = document.createElement("div");
  fullWidthArea.className = "mt-2";

  function render(mode, data) {
    inlineArea.innerHTML = "";
    fullWidthArea.innerHTML = "";
    current = null;
    if (mode === POLYMORPHIC_SCALAR_OPTION) {
      const built = buildControl(scalarSchema, defs, data, ignored, polymorphic, moduleRefs);
      inlineArea.appendChild(built.control);
      current = built;
      return;
    }
    const candidate = candidates.find((c) => c.class === mode);
    if (!candidate) return; // "" (none), for a field that's somehow both optional and scalar-alternative
    const card = document.createElement("div");
    card.className = "border rounded p-2 border-secondary-subtle";
    const form = new SchemaForm(candidate.schema || {}, { ...defs, ...(candidate.schema && candidate.schema.$defs) }, data || {}, {
      ignoredFields: ignored,
      polymorphic,
      moduleRefs,
    });
    card.appendChild(form.element);
    fullWidthArea.appendChild(card);
    current = { getValue: () => form.getData(), resolvePath: (loc) => form.resolveFieldPath(loc) };
  }

  const initialMode = hasExisting ? value.class : !hasClass ? POLYMORPHIC_SCALAR_OPTION : isOptional ? "" : candidates[0].class;
  select.value = initialMode;
  render(initialMode, initialMode === POLYMORPHIC_SCALAR_OPTION || hasExisting ? value : undefined);
  select.addEventListener("change", () => render(select.value, undefined));

  return {
    control: wrap,
    extra: fullWidthArea,
    getValue: () => {
      if (!select.value) return null;
      if (select.value === POLYMORPHIC_SCALAR_OPTION) return current ? current.getValue() : undefined;
      return { class: select.value, ...(current ? current.getValue() : {}) };
    },
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
