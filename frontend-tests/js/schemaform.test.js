import { beforeAll, describe, expect, it } from "vitest";

// schemaform.js is a classic script (no import/export); it exposes the
// classes/functions this suite needs on `window`. See the comment at the
// bottom of schemaform.js for why that's necessary under vitest.
beforeAll(() => {
  window.jsyaml = {
    dump: (v) => JSON.stringify(v),
    load: (s) => JSON.parse(s),
  };
});

await import("../../pyobs_robotic_backend/frontend/static/frontend/js/schemaform.js");
const { SchemaForm, buildControl, resolvePolymorphicCandidates } = window;

// Trimmed fixture mirroring the real script_tree() response shape (see
// specs/plans/2026-08-20-script-builder.md §3.2): group/subgroup/ClassName
// entries, plus a "$polymorphic" registry where Script candidates reference
// tree entries by `path` and provider candidates inline their schema.
const TREE = {
  utils: {
    log: {
      LogScript: {
        class: "pkg.utils.log.LogScript",
        schema: {
          title: "LogScript",
          type: "object",
          properties: { expression: { type: "string", title: "Expression" } },
          required: ["expression"],
        },
      },
    },
  },
  control: {
    sequential: {
      SequentialRunner: {
        class: "pkg.control.sequential.SequentialRunner",
        schema: {
          title: "SequentialRunner",
          type: "object",
          properties: { check_all_can_run: { type: "boolean", default: true, title: "Check All Can Run" } },
        },
      },
    },
  },
  $polymorphic: {
    "pkg.script.Script": {
      candidates: [
        { class: "pkg.utils.log.LogScript", path: "utils/log/LogScript", title: "LogScript" },
        {
          class: "pkg.control.sequential.SequentialRunner",
          path: "control/sequential/SequentialRunner",
          title: "SequentialRunner",
        },
      ],
    },
    "pkg.exptime.ExposureTimeProvider": {
      candidates: [
        {
          class: "pkg.exptime.StellarExposureTimeProvider",
          title: "StellarExposureTimeProvider",
          schema: {
            type: "object",
            properties: { camera: { type: "string", title: "Camera" } },
            required: ["camera"],
          },
        },
      ],
    },
  },
};

const POLYMORPHIC = resolvePolymorphicCandidates(TREE);

const SCRIPT_DEFS = { Script: { type: "object", properties: {} } };

function scriptFieldSchema(container) {
  return { $ref: "#/$defs/Script", "x-pyobs-polymorphic": { base: "pkg.script.Script", container } };
}

describe("resolvePolymorphicCandidates", () => {
  it("resolves Script candidates' path references against the tree", () => {
    const scriptCandidates = POLYMORPHIC["pkg.script.Script"];
    expect(scriptCandidates).toHaveLength(2);
    const seq = scriptCandidates.find((c) => c.class === "pkg.control.sequential.SequentialRunner");
    expect(seq.schema).toEqual(TREE.control.sequential.SequentialRunner.schema);
  });

  it("passes through inlined provider candidate schemas unchanged", () => {
    const providerCandidates = POLYMORPHIC["pkg.exptime.ExposureTimeProvider"];
    expect(providerCandidates).toHaveLength(1);
    expect(providerCandidates[0].class).toBe("pkg.exptime.StellarExposureTimeProvider");
    expect(providerCandidates[0].schema.properties.camera).toBeDefined();
  });
});

describe("buildControl: polymorphic (single, required)", () => {
  it("defaults to the first candidate and round-trips its fields", () => {
    const resolved = scriptFieldSchema("single");
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, undefined, new Set(), POLYMORPHIC);

    const select = control.querySelector("select");
    expect(select.value).toBe("pkg.utils.log.LogScript");

    const expressionInput = control.querySelector("input[type=text]");
    expressionInput.value = "1 + 1";
    expressionInput.dispatchEvent(new Event("input"));

    expect(getValue()).toEqual({ class: "pkg.utils.log.LogScript", expression: "1 + 1" });
  });

  it("re-renders the nested form when the class selection changes", () => {
    const resolved = scriptFieldSchema("single");
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, undefined, new Set(), POLYMORPHIC);

    const select = control.querySelector("select");
    select.value = "pkg.control.sequential.SequentialRunner";
    select.dispatchEvent(new Event("change"));

    expect(control.querySelector("input[type=text]")).toBeNull();
    expect(getValue()).toEqual({
      class: "pkg.control.sequential.SequentialRunner",
      check_all_can_run: true,
    });
  });

  it("initializes from an existing value by matching candidate fqcn", () => {
    const resolved = scriptFieldSchema("single");
    const value = { class: "pkg.utils.log.LogScript", expression: "existing" };
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, value, new Set(), POLYMORPHIC);

    expect(control.querySelector("select").value).toBe("pkg.utils.log.LogScript");
    expect(control.querySelector("input[type=text]").value).toBe("existing");
    expect(getValue()).toEqual(value);
  });
});

describe("buildControl: polymorphic (optional)", () => {
  it("starts unset and getValue() returns null", () => {
    const resolved = scriptFieldSchema("optional");
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, undefined, new Set(), POLYMORPHIC);

    expect(control.querySelector("select").value).toBe("");
    expect(getValue()).toBeNull();
  });

  it("emits a full class dict once a class is picked", () => {
    const resolved = scriptFieldSchema("optional");
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, undefined, new Set(), POLYMORPHIC);

    const select = control.querySelector("select");
    select.value = "pkg.utils.log.LogScript";
    select.dispatchEvent(new Event("change"));

    expect(getValue()).toEqual({ class: "pkg.utils.log.LogScript", expression: "" });
  });
});

describe("buildControl: polymorphic field with a scalar alternative (issue: exposure_time)", () => {
  // Mirrors InstrumentConfig.exposure_time: float | ExposureTimeProvider -- a union mixing a
  // plain scalar with the polymorphic base. schema.py keeps the original anyOf branches
  // alongside the x-pyobs-polymorphic marker specifically so scalarBranchFor() can recover the
  // scalar alternative here.
  const resolved = {
    anyOf: [{ type: "number" }, { $ref: "#/$defs/ExposureTimeProvider" }],
    "x-pyobs-polymorphic": { base: "pkg.exptime.ExposureTimeProvider", container: "single" },
  };
  const defs = { ExposureTimeProvider: { type: "object", properties: {} } };

  it("renders the type selector, not the raw-YAML anyOf fallback", () => {
    const { control } = buildControl(resolved, defs, undefined, new Set(), POLYMORPHIC);
    expect(control.querySelector("select")).not.toBeNull();
    expect(control.querySelector("textarea")).toBeNull();
  });

  it("defaults a bare scalar value to the Fixed value option, not the first candidate class", () => {
    // This is the bug this test used to lock in as "correct": a plain existing number (or no
    // value at all) must never be silently replaced by whichever provider class is first.
    const { control, getValue } = buildControl(resolved, defs, 12.5, new Set(), POLYMORPHIC);

    const select = control.querySelector("select");
    expect(select.value).toBe("__pyobs_scalar__");
    expect(control.querySelector("input[type=number]").value).toBe("12.5");
    expect(getValue()).toBe(12.5);
  });

  it("switches to the polymorphic form when a candidate class is picked", () => {
    const { control, getValue } = buildControl(resolved, defs, undefined, new Set(), POLYMORPHIC);

    const select = control.querySelector("select");
    select.value = "pkg.exptime.StellarExposureTimeProvider";
    select.dispatchEvent(new Event("change"));

    expect(getValue().class).toBe("pkg.exptime.StellarExposureTimeProvider");
  });

  it("initializes from an existing class-dict value by matching candidate fqcn", () => {
    const value = { class: "pkg.exptime.StellarExposureTimeProvider", camera: "cam1" };
    const { control, getValue } = buildControl(resolved, defs, value, new Set(), POLYMORPHIC);

    expect(control.querySelector("select").value).toBe("pkg.exptime.StellarExposureTimeProvider");
    expect(getValue()).toEqual(value);
  });
});

describe("buildControl: polymorphic with no registered candidates", () => {
  it("falls back to the raw-YAML control instead of a dead-end selector", () => {
    const resolved = { $ref: "#/$defs/Script", "x-pyobs-polymorphic": { base: "pkg.unknown.Base", container: "single" } };
    const { control } = buildControl(resolved, SCRIPT_DEFS, undefined, new Set(), POLYMORPHIC);
    expect(control.tagName).toBe("TEXTAREA");
  });
});

describe("buildControl: polymorphic with an unmappable existing value", () => {
  it("falls back to raw YAML instead of silently discarding the value", () => {
    // A stale class (uninstalled script package, legacy YAML, ...) --
    // resetting to the first candidate would silently drop the real data.
    const resolved = scriptFieldSchema("single");
    const value = { class: "pkg.uninstalled.GoneScript", some_field: 42 };
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, value, new Set(), POLYMORPHIC);

    expect(control.tagName).toBe("TEXTAREA");
    expect(getValue()).toEqual(value);
  });

  it("does NOT trigger for a classless placeholder from a fresh 'Add'", () => {
    // defaultValueFor() returns {} for a polymorphic field with no default --
    // that's "no value yet", not an unmappable value, and must still default
    // to the first candidate rather than falling back to YAML.
    const resolved = scriptFieldSchema("single");
    const { control, getValue } = buildControl(resolved, SCRIPT_DEFS, {}, new Set(), POLYMORPHIC);

    expect(control.querySelector("select")).not.toBeNull();
    expect(getValue()).toEqual({ class: "pkg.utils.log.LogScript", expression: "" });
  });
});

describe("buildControl: x-pyobs-module-ref (issue #98)", () => {
  it("renders a select populated from moduleRefs.options for a single-interface field", () => {
    const resolved = { type: "string", "x-pyobs-module-ref": { interfaces: ["ICamera"] } };
    const moduleRefs = { available: true, options: { ICamera: ["cam1", "cam2"] } };
    // `control` for an available module-ref field is the <select> itself, not a wrapper.
    const { control: select, getValue } = buildControl(resolved, {}, undefined, new Set(), {}, moduleRefs);

    expect(select.tagName).toBe("SELECT");
    // Blank placeholder plus the two real options.
    expect([...select.options].map((o) => o.value)).toEqual(["", "cam1", "cam2"]);

    select.value = "cam1";
    select.dispatchEvent(new Event("change"));
    expect(getValue()).toBe("cam1");
  });

  it("intersects module lists across multiple required interfaces (AND semantics)", () => {
    // Mirrors DarkBiasScript.camera: IData+IBinning -- only a module in both
    // interfaces' lists is a valid candidate.
    const resolved = { type: "string", "x-pyobs-module-ref": { interfaces: ["IData", "IBinning"] } };
    const moduleRefs = { available: true, options: { IData: ["cam1", "cam2"], IBinning: ["cam2", "cam3"] } };
    const { control: select } = buildControl(resolved, {}, undefined, new Set(), {}, moduleRefs);

    expect([...select.options].map((o) => o.value)).toEqual(["", "cam2"]);
  });

  it("falls back to a plain input (no select) when moduleRefs.available is false", () => {
    const resolved = { type: "string", "x-pyobs-module-ref": { interfaces: ["ICamera"] } };
    const moduleRefs = { available: false, options: {} };
    const { control, getValue } = buildControl(resolved, {}, "typed-value", new Set(), {}, moduleRefs);

    expect(control.tagName).toBe("INPUT");
    expect(getValue()).toBe("typed-value");
  });

  it("falls back to a plain input when moduleRefs is omitted entirely", () => {
    const resolved = { type: "string", "x-pyobs-module-ref": { interfaces: ["ICamera"] } };
    const { control } = buildControl(resolved, {}, undefined, new Set(), {});
    expect(control.tagName).toBe("INPUT");
  });

  it("keeps a stored value that isn't in the option list as its own selected, flagged option", () => {
    // Module since renamed/removed, or edited before web-admin was linked -- must be shown
    // and kept, not silently swapped for whichever option happens to be first (issue #98
    // follow-up; validate_script/'s server-side check is what actually flags it invalid).
    const resolved = { type: "string", "x-pyobs-module-ref": { interfaces: ["ICamera"] } };
    const moduleRefs = { available: true, options: { ICamera: ["cam1"] } };
    const { control: select, getValue } = buildControl(resolved, {}, "not-in-the-list", new Set(), {}, moduleRefs);

    expect(select.value).toBe("not-in-the-list");
    expect([...select.options].map((o) => o.value)).toEqual(["", "not-in-the-list", "cam1"]);
    expect(getValue()).toBe("not-in-the-list");
  });

  it("preserves an existing value that is in the list untouched", () => {
    const resolved = { type: "string", "x-pyobs-module-ref": { interfaces: ["ICamera"] } };
    const moduleRefs = { available: true, options: { ICamera: ["cam1"] } };
    const { control: select, getValue } = buildControl(resolved, {}, "cam1", new Set(), {}, moduleRefs);

    expect(select.value).toBe("cam1");
    expect(getValue()).toBe("cam1");
  });

  it("takes priority over the anyOf branch for an optional field (Optional[str])", () => {
    // Mirrors how _annotate_module_refs places the marker on the outer node
    // for an Optional[...] field, and how the polymorphic marker already
    // relies on this same check-before-anyOf ordering in buildControl.
    const resolved = {
      anyOf: [{ type: "string" }, { type: "null" }],
      "x-pyobs-module-ref": { interfaces: ["ITelescope"] },
    };
    const moduleRefs = { available: true, options: { ITelescope: ["tel1"] } };
    const { control } = buildControl(resolved, {}, undefined, new Set(), {}, moduleRefs);

    expect(control.tagName).toBe("SELECT");
  });
});

describe("array of polymorphic scripts (SequentialRunner.scripts-like)", () => {
  const SCHEMA = {
    type: "object",
    properties: {
      scripts: { type: "array", items: scriptFieldSchema("array"), title: "Scripts" },
    },
  };

  it("adds a new item defaulting to the first candidate", () => {
    const form = new SchemaForm(SCHEMA, SCRIPT_DEFS, {}, { polymorphic: POLYMORPHIC });
    form.element.querySelector("button.btn-outline-secondary").click();

    expect(form.getData().scripts).toEqual([{ class: "pkg.utils.log.LogScript", expression: "" }]);
  });

  it("round-trips an existing array of mixed script classes", () => {
    const data = {
      scripts: [
        { class: "pkg.utils.log.LogScript", expression: "a" },
        { class: "pkg.control.sequential.SequentialRunner", check_all_can_run: false },
      ],
    };
    const form = new SchemaForm(SCHEMA, SCRIPT_DEFS, data, { polymorphic: POLYMORPHIC });
    expect(form.getData()).toEqual(data);
  });
});

describe("dynamic map of polymorphic scripts (CasesRunner.cases-like)", () => {
  const SCHEMA = {
    type: "object",
    properties: {
      cases: { type: "object", additionalProperties: scriptFieldSchema("map"), title: "Cases" },
    },
  };

  it("round-trips named entries", () => {
    const data = { cases: { a: { class: "pkg.utils.log.LogScript", expression: "1" } } };
    const form = new SchemaForm(SCHEMA, SCRIPT_DEFS, data, { polymorphic: POLYMORPHIC });
    expect(form.getData()).toEqual(data);
  });

  it("adds a row with a name input and a polymorphic value control", () => {
    const form = new SchemaForm(SCHEMA, SCRIPT_DEFS, {}, { polymorphic: POLYMORPHIC });
    form.element.querySelector("button.btn-outline-secondary").click();

    const nameInput = form.element.querySelector('input[placeholder="name"]');
    nameInput.value = "b";
    nameInput.dispatchEvent(new Event("input"));

    expect(form.getData().cases).toEqual({ b: { class: "pkg.utils.log.LogScript", expression: "" } });
  });

  it("drops rows whose name is left empty", () => {
    const form = new SchemaForm(SCHEMA, SCRIPT_DEFS, {}, { polymorphic: POLYMORPHIC });
    form.element.querySelector("button.btn-outline-secondary").click();
    // Name left blank.
    expect(form.getData().cases).toEqual({});
  });

  it("flags rows with a duplicate name (still last-row-wins in getValue)", () => {
    const data = {
      cases: {
        a: { class: "pkg.utils.log.LogScript", expression: "1" },
        b: { class: "pkg.utils.log.LogScript", expression: "2" },
      },
    };
    const form = new SchemaForm(SCHEMA, SCRIPT_DEFS, data, { polymorphic: POLYMORPHIC });
    const [firstInput, secondInput] = form.element.querySelectorAll('input[placeholder="name"]');
    expect(firstInput.classList.contains("is-invalid")).toBe(false);

    secondInput.value = "a";
    secondInput.dispatchEvent(new Event("input"));

    expect(firstInput.classList.contains("is-invalid")).toBe(true);
    expect(secondInput.classList.contains("is-invalid")).toBe(true);
    expect(Object.keys(form.getData().cases)).toEqual(["a"]);
  });
});

describe("buildArrayControl: unaffected by the polymorphic-dispatch rewrite", () => {
  it("round-trips an array of plain objects (instrument_configs-like)", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { count: { type: "integer", title: "Count", default: 1 } },
          },
          title: "Items",
        },
      },
    };
    const data = { items: [{ count: 3 }, { count: 5 }] };
    const form = new SchemaForm(schema, {}, data, { polymorphic: POLYMORPHIC });
    expect(form.getData()).toEqual(data);
  });

  it("round-trips an array of primitives", () => {
    const schema = {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, title: "Names" },
      },
    };
    const data = { names: ["a", "b"] };
    const form = new SchemaForm(schema, {}, data, { polymorphic: POLYMORPHIC });
    expect(form.getData()).toEqual(data);

    form.element.querySelector("button.btn-outline-secondary").click();
    expect(form.getData().names).toEqual(["a", "b", ""]);
  });
});

describe("buildControl: invalid primitive values fall back to raw YAML (issue #101)", () => {
  it("number: a wrong-type stored value (string) is flagged and preserved, not sanitized to 0", () => {
    const { control, getValue } = buildControl({ type: "number" }, {}, "not a number", new Set(), POLYMORPHIC);
    expect(control.querySelector("textarea")).not.toBeNull();
    expect(control.querySelector("input[type=number]")).toBeNull();
    expect(control.textContent).toMatch(/doesn't match this field's type/);
    expect(getValue()).toBe("not a number");
  });

  it("number: NaN is flagged the same way", () => {
    const { control } = buildControl({ type: "number" }, {}, NaN, new Set(), POLYMORPHIC);
    expect(control.querySelector("textarea")).not.toBeNull();
    expect(control.querySelector("input[type=number]")).toBeNull();
  });

  it("number: a valid stored value still gets the normal numeric input", () => {
    const { control, getValue } = buildControl({ type: "number" }, {}, 3.5, new Set(), POLYMORPHIC);
    expect(control.tagName).toBe("INPUT");
    expect(getValue()).toBe(3.5);
  });

  it("number: undefined/null aren't flagged -- they mean 'use the default', not 'invalid'", () => {
    const { control: c1, getValue: g1 } = buildControl({ type: "number", default: 5 }, {}, undefined, new Set(), POLYMORPHIC);
    expect(c1.tagName).toBe("INPUT");
    expect(g1()).toBe(5);
    const { control: c2 } = buildControl({ type: "number" }, {}, null, new Set(), POLYMORPHIC);
    expect(c2.tagName).toBe("INPUT");
  });

  it("enum: a value outside the allowed options is flagged and preserved, not silently defaulted", () => {
    const resolved = { type: "string", enum: ["a", "b", "c"] };
    const { control, getValue } = buildControl(resolved, {}, "z", new Set(), POLYMORPHIC);
    expect(control.querySelector("textarea")).not.toBeNull();
    expect(control.querySelector("select")).toBeNull();
    expect(getValue()).toBe("z");
  });

  it("enum: a valid stored value still gets the normal <select>", () => {
    const resolved = { type: "string", enum: ["a", "b", "c"] };
    const { control, getValue } = buildControl(resolved, {}, "b", new Set(), POLYMORPHIC);
    expect(control.tagName).toBe("SELECT");
    expect(getValue()).toBe("b");
  });

  it("enum: null isn't flagged -- it's a legitimately unset Optional[...] field", () => {
    const resolved = { anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] };
    const { control } = buildControl(resolved, {}, null, new Set(), POLYMORPHIC);
    expect(control.tagName).toBe("SELECT");
  });

  it("enum: a brand-new array item defaults to the first enum member, not the invalid-value fallback", () => {
    const schema = {
      type: "object",
      properties: {
        choice: { type: "array", items: { type: "string", enum: ["a", "b", "c"] }, title: "Choice" },
      },
    };
    const form = new SchemaForm(schema, {}, {}, { polymorphic: POLYMORPHIC });
    form.element.querySelector("button.btn-outline-secondary").click();

    expect(form.element.querySelector("textarea")).toBeNull();
    expect(form.getData().choice).toEqual(["a"]);
  });

  it("date-time: an unparseable stored string is flagged and preserved, not sanitized to null", () => {
    const { control, getValue } = buildControl({ type: "string", format: "date-time" }, {}, "not a date", new Set(), POLYMORPHIC);
    expect(control.querySelector("textarea")).not.toBeNull();
    expect(control.querySelector("input[type=datetime-local]")).toBeNull();
    expect(getValue()).toBe("not a date");
  });

  it("date-time: a valid ISO stored value still gets the normal datetime-local input", () => {
    const { control, getValue } = buildControl(
      { type: "string", format: "date-time" },
      {},
      "2024-01-02T03:04:05",
      new Set(),
      POLYMORPHIC
    );
    expect(control.tagName).toBe("INPUT");
    // jsdom's <input type=datetime-local step=1> normalizes the stored value
    // (e.g. appends ".000"); the point of this test is that it's still the
    // normal input, not the raw-YAML fallback.
    expect(getValue()).toMatch(/^2024-01-02T03:04:05/);
  });
});

describe("SchemaForm.resolveFieldPath(): walks a validate_script/ error loc to a DOM row (issue #102)", () => {
  const SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string", title: "Name" },
      nested: {
        type: "object",
        title: "Nested",
        properties: { count: { type: "integer", title: "Count" } },
      },
      items: {
        type: "array",
        title: "Items",
        items: { type: "object", properties: { x: { type: "integer", title: "X" } } },
      },
      cases: { type: "object", additionalProperties: { type: "string" }, title: "Cases" },
      script: scriptFieldSchema("single"),
    },
  };
  const DATA = {
    name: "a",
    nested: { count: 1 },
    items: [{ x: 1 }, { x: 2 }],
    cases: { foo: "bar" },
    script: { class: "pkg.utils.log.LogScript", expression: "existing" },
  };

  function makeForm() {
    return new SchemaForm(SCHEMA, SCRIPT_DEFS, DATA, { polymorphic: POLYMORPHIC });
  }

  it("resolves a top-level scalar field", () => {
    const form = makeForm();
    expect(form.resolveFieldPath(["name"])).toEqual({ rowEl: form.fields.name.rowEl });
  });

  it("resolves into a nested object field's own sub-row", () => {
    const form = makeForm();
    const resolved = form.resolveFieldPath(["nested", "count"]);
    expect(resolved.rowEl).not.toBe(form.fields.nested.rowEl);
    expect(resolved.rowEl.querySelector("input[type=number]")).not.toBeNull();
  });

  it("resolves an array item by numeric index", () => {
    const form = makeForm();
    const resolved = form.resolveFieldPath(["items", 1, "x"]);
    const secondItemInput = form.fields.items.rowEl.querySelectorAll("input[type=number]")[1];
    expect(resolved.rowEl.contains(secondItemInput)).toBe(true);
  });

  it("falls back to the array field's own row for an out-of-range index", () => {
    const form = makeForm();
    expect(form.resolveFieldPath(["items", 99, "x"])).toEqual({ rowEl: form.fields.items.rowEl });
  });

  it("resolves a dynamic-map entry by its key", () => {
    const form = makeForm();
    const resolved = form.resolveFieldPath(["cases", "foo"]);
    const valueInput = [...form.fields.cases.rowEl.querySelectorAll("input")].find((i) => i.value === "bar");
    expect(resolved.rowEl.contains(valueInput)).toBe(true);
  });

  it("falls back to the map field's own row for an unknown key", () => {
    const form = makeForm();
    expect(form.resolveFieldPath(["cases", "missing"])).toEqual({ rowEl: form.fields.cases.rowEl });
  });

  it("resolves through a polymorphic field with no 'class'-selection segment of its own", () => {
    const form = makeForm();
    const resolved = form.resolveFieldPath(["script", "expression"]);
    expect(resolved.rowEl.querySelector("input[type=text]").value).toBe("existing");
  });

  it("returns null when the first segment doesn't match any field", () => {
    const form = makeForm();
    expect(form.resolveFieldPath(["nonexistent"])).toBeNull();
  });

  it("returns null for an empty loc", () => {
    const form = makeForm();
    expect(form.resolveFieldPath([])).toBeNull();
  });
});

describe("row layout: two-column for scalars, full-width for structural fields", () => {
  it("a scalar field (string) gets the two-column row", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string", title: "Name" } },
    };
    const form = new SchemaForm(schema, {}, {}, { polymorphic: POLYMORPHIC });
    const row = form.fields.name.rowEl;
    expect(row.classList.contains("row")).toBe(true);
    expect(row.querySelector("label").classList.contains("col-sm-4")).toBe(true);
    expect(row.children[1].classList.contains("col-sm-8")).toBe(true);
  });

  it("an array-of-objects field (instrument_configs-like) gets a full-width row", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { count: { type: "integer", title: "Count", default: 1 } } },
          title: "Items",
        },
      },
    };
    const form = new SchemaForm(schema, {}, { items: [{ count: 3 }] }, { polymorphic: POLYMORPHIC });
    const row = form.fields.items.rowEl;
    expect(row.classList.contains("row")).toBe(false);
    expect(row.querySelector("label").classList.contains("col-sm-4")).toBe(false);
    expect(row.children[1].classList.contains("col-sm-8")).toBe(false);

    // ...but the nested object's own fields (e.g. "count" inside each array
    // item) still get the two-column treatment -- only the array/object
    // field itself goes full-width, not everything underneath it.
    const nestedInput = row.querySelector('input[type=number]');
    const nestedLabel = nestedInput.closest(".row").querySelector("label");
    expect(nestedLabel.classList.contains("col-sm-4")).toBe(true);
  });

  it("a polymorphic field gets a full-width row", () => {
    const schema = { type: "object", properties: { script: scriptFieldSchema("single") } };
    const form = new SchemaForm(schema, SCRIPT_DEFS, {}, { polymorphic: POLYMORPHIC });
    const row = form.fields.script.rowEl;
    expect(row.classList.contains("row")).toBe(false);
    expect(row.children[1].classList.contains("col-sm-8")).toBe(false);
  });

  describe("a polymorphic field with a scalar alternative (exposure_time-like)", () => {
    const exptimeSchema = {
      anyOf: [{ type: "number" }, { $ref: "#/$defs/ExposureTimeProvider" }],
      "x-pyobs-polymorphic": { base: "pkg.exptime.ExposureTimeProvider", container: "single" },
      title: "Exposure Time",
    };
    const exptimeDefs = { ExposureTimeProvider: { type: "object", properties: {} } };

    function makeExptimeForm(value) {
      const schema = { type: "object", properties: { exposure_time: exptimeSchema } };
      return new SchemaForm(schema, exptimeDefs, { exposure_time: value }, { polymorphic: POLYMORPHIC });
    }

    it("starts two-column/compact for a bare scalar value, dropdown and number on one line", () => {
      const form = makeExptimeForm(12.5);
      const row = form.fields.exposure_time.rowEl;

      expect(row.classList.contains("row")).toBe(true);
      expect(row.querySelector("label").classList.contains("col-sm-4")).toBe(true);
      const content = row.children[1];
      expect(content.classList.contains("col-sm-8")).toBe(true);
      expect(content.querySelector("select").parentElement.classList.contains("flex-row")).toBe(true);
      expect(content.querySelector("input[type=number]")).not.toBeNull();
    });

    it("starts full-width for an existing concrete provider value", () => {
      const form = makeExptimeForm({ class: "pkg.exptime.StellarExposureTimeProvider", camera: "cam1" });
      const row = form.fields.exposure_time.rowEl;

      expect(row.classList.contains("row")).toBe(false);
      expect(row.children[1].classList.contains("col-sm-8")).toBe(false);
    });

    it("switches the row to full-width the moment a candidate class is picked", () => {
      const form = makeExptimeForm(12.5);
      const row = form.fields.exposure_time.rowEl;
      const select = row.querySelector("select");

      select.value = "pkg.exptime.StellarExposureTimeProvider";
      select.dispatchEvent(new Event("change"));

      expect(row.classList.contains("row")).toBe(false);
      expect(row.children[1].classList.contains("col-sm-8")).toBe(false);
      expect(form.getData()).toEqual({
        exposure_time: { class: "pkg.exptime.StellarExposureTimeProvider", camera: "" },
      });
    });

    it("switches back to the compact two-column row when Fixed value is re-selected", () => {
      const form = makeExptimeForm({ class: "pkg.exptime.StellarExposureTimeProvider", camera: "cam1" });
      const row = form.fields.exposure_time.rowEl;
      const select = row.querySelector("select");

      select.value = "__pyobs_scalar__";
      select.dispatchEvent(new Event("change"));

      expect(row.classList.contains("row")).toBe(true);
      expect(row.children[1].classList.contains("col-sm-8")).toBe(true);
      expect(form.getData().exposure_time).toBe(0);
    });
  });
});
