/**
 * Restricted users in the task editor (issue #198).
 *
 * The backend (api/restrictions.py) is the source of truth and rejects every violation with a
 * 400. These helpers only make the editor show the limits up front: bounded inputs, locked
 * global constraints and a required target.
 */

const STRICTER_KEY = "x-pyobs-stricter";
const MERIT_FACTOR_KEY = "x-pyobs-merit-factor";

/**
 * Field bounds per constraint type from the global constraints.
 * Returns {Type: {field: ["min"|"max", value]}}. Which direction is stricter comes from the
 * pyobs-core schema (`x-pyobs-stricter`: "lower" -> max bound, "higher" -> min bound). A field
 * missing in the global takes the schema default, like the backend does.
 */
function constraintBounds(globals, schemas, prefix) {
  const bounds = {};
  for (const glob of globals || []) {
    const type = (glob.class || "").startsWith(prefix) ? glob.class.slice(prefix.length) : (glob.class || "").split(".").pop();
    const props = (schemas[type] && schemas[type].properties) || {};
    for (const [field, prop] of Object.entries(props)) {
      const direction = prop[STRICTER_KEY];
      if (direction !== "lower" && direction !== "higher") continue;
      const kind = direction === "lower" ? "max" : "min";
      const value = field in glob ? glob[field] : prop.default;
      if (typeof value !== "number") continue;
      bounds[type] = bounds[type] || {};
      // Two globals of the same type: keep the stricter bound.
      const prev = bounds[type][field];
      if (prev) {
        const stricter = kind === "max" ? Math.min(prev[1], value) : Math.max(prev[1], value);
        bounds[type][field] = [kind, stricter];
      } else {
        bounds[type][field] = [kind, value];
      }
    }
  }
  return bounds;
}

/** Copy of a JSON schema with minimum/maximum tightened per {field: ["min"|"max", value]}. */
function boundSchema(schema, fieldBounds) {
  if (!schema || !fieldBounds) return schema;
  const copy = JSON.parse(JSON.stringify(schema));
  const props = copy.properties || {};
  const apply = (node, kind, value) => {
    if (kind === "max") node.maximum = node.maximum === undefined ? value : Math.min(node.maximum, value);
    else node.minimum = node.minimum === undefined ? value : Math.max(node.minimum, value);
  };
  for (const [field, [kind, value]] of Object.entries(fieldBounds)) {
    const node = props[field];
    if (!node) continue;
    if (Array.isArray(node.anyOf)) {
      node.anyOf.filter((b) => b.type !== "null").forEach((b) => apply(b, kind, value));
    } else {
      apply(node, kind, value);
    }
  }
  return copy;
}

/**
 * Add a copy of every global constraint whose type is missing in `items`.
 * Returns {items, added: [types], locked: Set(types)}; every global type is locked (no remove).
 */
function mergeGlobals(items, globals, prefix) {
  const typeOf = (c) => ((c.class || "").startsWith(prefix) ? c.class.slice(prefix.length) : (c.class || "").split(".").pop());
  const result = (items || []).map((c) => ({ ...c }));
  const present = new Set(result.map(typeOf));
  const added = [];
  const locked = new Set();
  for (const glob of globals || []) {
    const type = typeOf(glob);
    locked.add(type);
    if (!present.has(type)) {
      result.push({ ...glob });
      present.add(type);
      added.push(type);
    }
  }
  return { items: result, added, locked };
}

/** Merit bounds: every field marked `x-pyobs-merit-factor` is capped at maxMerit. */
function meritBounds(schemas, maxMerit) {
  const bounds = {};
  for (const [type, schema] of Object.entries(schemas || {})) {
    for (const [field, prop] of Object.entries((schema && schema.properties) || {})) {
      if (prop[MERIT_FACTOR_KEY]) {
        bounds[type] = bounds[type] || {};
        bounds[type][field] = ["max", maxMerit];
      }
    }
  }
  return bounds;
}

/** Human-readable lines from a DRF 400 body ({field: [messages]} or {detail}). */
function formatApiErrors(data) {
  if (!data || typeof data !== "object") return [String(data)];
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    const messages = Array.isArray(value) ? value : [value];
    messages.forEach((m) => lines.push(key === "detail" || key === "non_field_errors" ? String(m) : `${key}: ${typeof m === "string" ? m : JSON.stringify(m)}`));
  }
  return lines;
}

if (typeof window !== "undefined") {
  window.constraintBounds = constraintBounds;
  window.boundSchema = boundSchema;
  window.mergeGlobals = mergeGlobals;
  window.meritBounds = meritBounds;
  window.formatApiErrors = formatApiErrors;
}
