import { describe, expect, it } from "vitest";

await import("../../pyobs_portal/frontend/static/frontend/js/restrictions.js");
const { boundSchema, constraintBounds, mergeGlobals, meritBounds, formatApiErrors } = window;

const C = "pyobs.robotic.scheduler.constraints.";

const SCHEMAS = {
  AirmassConstraint: {
    properties: { max_airmass: { type: "number", minimum: 1.0, maximum: 9.9, default: 1.3, "x-pyobs-stricter": "lower" } },
  },
  SolarElevationConstraint: {
    properties: {
      min_elevation: { type: "number", minimum: -90, maximum: 90, default: -90, "x-pyobs-stricter": "higher" },
      max_elevation: { type: "number", minimum: -90, maximum: 90, default: -18, "x-pyobs-stricter": "lower" },
    },
  },
  MoonSeparationConstraint: {
    properties: { min_distance: { type: "number", minimum: 0, maximum: 180, default: 30, "x-pyobs-stricter": "higher" } },
  },
  TimeOfDayConstraint: { properties: { windows: { type: "array" } } },
};
const GLOBALS = [
  { class: C + "MoonSeparationConstraint", min_distance: 30 },
  { class: C + "SolarElevationConstraint", max_elevation: -18 },
  { class: C + "AirmassConstraint", max_airmass: 2.0 },
];

describe("constraintBounds", () => {
  it("takes values from the globals and schema defaults for missing fields", () => {
    const b = constraintBounds(GLOBALS, SCHEMAS, C);
    expect(b.AirmassConstraint.max_airmass).toEqual(["max", 2.0]);
    expect(b.MoonSeparationConstraint.min_distance).toEqual(["min", 30]);
    expect(b.SolarElevationConstraint.min_elevation).toEqual(["min", -90]);
    expect(b.SolarElevationConstraint.max_elevation).toEqual(["max", -18]);
  });

  it("ignores types without stricter fields", () => {
    const b = constraintBounds([{ class: C + "TimeOfDayConstraint" }], SCHEMAS, C);
    expect(b).toEqual({});
  });

  it("keeps the stricter bound for two globals of one type", () => {
    const globals = [
      { class: C + "AirmassConstraint", max_airmass: 2.0 },
      { class: C + "AirmassConstraint", max_airmass: 1.5 },
    ];
    expect(constraintBounds(globals, SCHEMAS, C).AirmassConstraint.max_airmass).toEqual(["max", 1.5]);
  });
});

describe("boundSchema", () => {
  it("tightens maximum and minimum without touching the original", () => {
    const s = boundSchema(SCHEMAS.AirmassConstraint, { max_airmass: ["max", 2.0] });
    expect(s.properties.max_airmass.maximum).toBe(2.0);
    expect(s.properties.max_airmass.minimum).toBe(1.0);
    expect(SCHEMAS.AirmassConstraint.properties.max_airmass.maximum).toBe(9.9);
  });

  it("never loosens an existing schema bound", () => {
    const s = boundSchema(SCHEMAS.AirmassConstraint, { max_airmass: ["max", 20] });
    expect(s.properties.max_airmass.maximum).toBe(9.9);
  });

  it("applies to the non-null anyOf branches", () => {
    const schema = { properties: { x: { anyOf: [{ type: "number" }, { type: "null" }] } } };
    const s = boundSchema(schema, { x: ["min", 3] });
    expect(s.properties.x.anyOf[0].minimum).toBe(3);
    expect(s.properties.x.anyOf[1].minimum).toBeUndefined();
  });
});

describe("mergeGlobals", () => {
  it("adds missing global types and locks all global types", () => {
    const items = [{ class: C + "AirmassConstraint", max_airmass: 1.5 }];
    const { items: merged, added, locked } = mergeGlobals(items, GLOBALS, C);
    expect(merged).toHaveLength(3);
    expect(merged[0].max_airmass).toBe(1.5);
    expect(added).toEqual(["MoonSeparationConstraint", "SolarElevationConstraint"]);
    expect([...locked].sort()).toEqual(["AirmassConstraint", "MoonSeparationConstraint", "SolarElevationConstraint"]);
  });

  it("does not mutate the input", () => {
    const items = [];
    mergeGlobals(items, GLOBALS, C);
    expect(items).toHaveLength(0);
  });
});

describe("meritBounds", () => {
  it("caps merit-factor fields", () => {
    const schemas = {
      ConstantMerit: { properties: { merit: { type: "number", "x-pyobs-merit-factor": true } } },
      PerNightMerit: { properties: { count: { type: "integer" } } },
    };
    expect(meritBounds(schemas, 1.0)).toEqual({ ConstantMerit: { merit: ["max", 1.0] } });
  });
});

describe("formatApiErrors", () => {
  it("flattens field errors", () => {
    expect(formatApiErrors({ constraints: ["a", "b"], detail: "x" })).toEqual(["constraints: a", "constraints: b", "x"]);
  });
});

describe("TypedListEditor with restrictions", () => {
  it("renders locked cards without a remove button and bounded inputs", async () => {
    window.jsyaml = window.jsyaml || { dump: (v) => JSON.stringify(v), load: (s) => JSON.parse(s) };
    await import("../../pyobs_portal/frontend/static/frontend/js/schemaform.js");
    window.boundSchema = boundSchema;
    await import("../../pyobs_portal/frontend/static/frontend/js/taskeditor.js");
    const container = document.createElement("div");
    const items = [{ class: C + "AirmassConstraint", max_airmass: 2.0 }, { class: C + "NoSuchConstraint" }];
    new window.TypedListEditor(container, { AirmassConstraint: SCHEMAS.AirmassConstraint }, C, items, {
      locked: new Set(["AirmassConstraint"]),
      bounds: { AirmassConstraint: { max_airmass: ["max", 2.0] } },
      unknownMessage: "not allowed for your account",
    });
    const cards = container.querySelectorAll(".card");
    expect(cards[0].querySelector(".btn-outline-danger")).toBeNull();
    expect(cards[0].textContent).toContain("global limit");
    expect(cards[0].querySelector("input[type=number]").max).toBe("2");
    expect(cards[1].querySelector(".btn-outline-danger")).not.toBeNull();
    expect(cards[1].textContent).toContain("not allowed for your account");
  });
});
