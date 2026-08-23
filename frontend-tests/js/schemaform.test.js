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
    // Note: buildBoolControl doesn't apply the schema `default` for an unset
    // value (unlike the other primitive controls) -- pre-existing behavior,
    // unrelated to the polymorphic control itself.
    expect(getValue()).toEqual({
      class: "pkg.control.sequential.SequentialRunner",
      check_all_can_run: false,
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

describe("buildControl: polymorphic takes priority over an ambiguous anyOf", () => {
  it("renders the type selector, not the raw-YAML anyOf fallback", () => {
    // Mirrors InstrumentConfig.exposure_time: float | ExposureTimeProvider.
    const resolved = {
      anyOf: [{ type: "number" }, { $ref: "#/$defs/ExposureTimeProvider" }],
      "x-pyobs-polymorphic": { base: "pkg.exptime.ExposureTimeProvider", container: "single" },
    };
    const defs = { ExposureTimeProvider: { type: "object", properties: {} } };
    const { control, getValue } = buildControl(resolved, defs, undefined, new Set(), POLYMORPHIC);

    expect(control.querySelector("select")).not.toBeNull();
    expect(control.querySelector("textarea")).toBeNull();
    expect(getValue().class).toBe("pkg.exptime.StellarExposureTimeProvider");
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
