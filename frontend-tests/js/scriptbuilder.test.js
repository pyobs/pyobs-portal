import { beforeAll, describe, expect, it } from "vitest";

// scriptbuilder.js composes ScriptEditor (taskeditor.js) for its Source view
// and SchemaForm/resolvePolymorphicCandidates (schemaform.js) for its
// builder view -- all classic scripts, all exposed on `window` for the same
// reason described in schemaform.js's own window-exposure comment.
beforeAll(() => {
  window.jsyaml = {
    dump: (v) => JSON.stringify(v),
    load: (s) => JSON.parse(s),
  };

  class FakeCodeMirror {
    constructor(textarea) {
      this._value = textarea.value || "";
      this._handlers = {};
    }
    static fromTextArea(textarea) {
      return new FakeCodeMirror(textarea);
    }
    getValue() {
      return this._value;
    }
    setValue(v) {
      this._value = v || "";
      (this._handlers.change || []).forEach((h) => h());
    }
    on(event, handler) {
      (this._handlers[event] ||= []).push(handler);
    }
    refresh() {}
  }
  window.CodeMirror = FakeCodeMirror;
});

await import("../../pyobs_robotic_backend/frontend/static/frontend/js/schemaform.js");
await import("../../pyobs_robotic_backend/frontend/static/frontend/js/taskeditor.js");
await import("../../pyobs_robotic_backend/frontend/static/frontend/js/scriptbuilder.js");
const { ScriptBuilder } = window;

// Trimmed fixture mirroring the real script_tree() response shape (see
// specs/plans/2026-08-20-script-builder.md §3.2 and schemaform.test.js).
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
          properties: {
            scripts: {
              type: "array",
              title: "Scripts",
              items: { $ref: "#/$defs/Script", "x-pyobs-polymorphic": { base: "pkg.script.Script", container: "array" } },
            },
          },
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
  },
};

function makeContainer() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function selectByText(container, text) {
  const btn = [...container.querySelectorAll(".list-group-item")].find((b) => b.textContent === text);
  if (!btn) throw new Error(`no tree item "${text}"`);
  btn.click();
}

describe("ScriptBuilder: empty content", () => {
  it("starts in builder mode with no root selected, getData() returns {}", () => {
    const builder = new ScriptBuilder(makeContainer(), TREE, {});
    expect(builder.mode).toBe("builder");
    expect(builder.getData()).toEqual({});
  });
});

describe("ScriptBuilder: selecting a script type", () => {
  it("picking a leaf from the tree renders its form and getData() carries the class", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");

    const input = container.querySelector('input[type=text]');
    input.value = "1 + 1";
    input.dispatchEvent(new Event("input"));

    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "1 + 1" });
  });

  it("highlights the selected leaf and clears the highlight when switching", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    const logBtn = [...container.querySelectorAll(".list-group-item")].find((b) => b.textContent === "LogScript");
    expect(logBtn.classList.contains("active")).toBe(true);

    selectByText(container, "SequentialRunner");
    expect(logBtn.classList.contains("active")).toBe(false);
  });

  it("a root class with a nested polymorphic field round-trips (SequentialRunner.scripts)", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "SequentialRunner");

    // Add a script to the (initially empty) scripts array; defaults to the
    // first candidate (LogScript), matching schemaform.js's polymorphic
    // control behavior. Scoped to .script-builder-editor: the mode-toggle
    // and mobile tree-toggle buttons also match .btn-outline-secondary.
    container.querySelector(".script-builder-editor .btn-outline-secondary").click();

    expect(builder.getData()).toEqual({
      class: "pkg.control.sequential.SequentialRunner",
      scripts: [{ class: "pkg.utils.log.LogScript", expression: "" }],
    });
  });
});

describe("ScriptBuilder: class invariant", () => {
  it("never emits a class-less dict once a root is selected", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    expect(builder.getData()).toEqual({});
    selectByText(container, "LogScript");
    expect(builder.getData().class).toBe("pkg.utils.log.LogScript");
  });
});

describe("ScriptBuilder: setContent() round-trip", () => {
  it("restores an existing valid script and getData() reproduces it", () => {
    const data = { class: "pkg.utils.log.LogScript", expression: "existing" };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    expect(builder.mode).toBe("builder");
    expect(builder.getData()).toEqual(data);
  });

  it("setContent() after construction rebuilds the form from the new data", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    builder.setContent({ class: "pkg.utils.log.LogScript", expression: "from setContent" });
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "from setContent" });
  });
});

describe("ScriptBuilder: unmappable data (§4.12)", () => {
  it("an unknown class opens in source view with a warning, without dropping data", () => {
    const data = { class: "pkg.uninstalled.GoneScript", some_field: 42 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    expect(builder.mode).toBe("source");
    expect(builder.warningEl.classList.contains("d-none")).toBe(false);
    expect(builder.getData()).toEqual(data);
  });

  it("a class-less dict also opens in source view with a warning, without dropping data", () => {
    const data = { some_field: 42 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    expect(builder.mode).toBe("source");
    expect(builder.getData()).toEqual(data);
  });
});

describe("ScriptBuilder: redundant mode clicks are no-ops", () => {
  it("clicking Builder while already in builder mode doesn't touch the form", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    const input = container.querySelector("input[type=text]");
    input.value = "in progress";
    input.dispatchEvent(new Event("input"));

    // The source editor was never synced with this edit (only construction
    // set it, to `{}`) -- if the redundant click weren't a no-op, it would
    // re-parse that stale/empty content and wipe the in-progress edit.
    builder.builderModeBtn.click();

    expect(builder.mode).toBe("builder");
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "in progress" });
  });

  it("clicking Source while already in source mode doesn't touch the editor content", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    builder.sourceModeBtn.click();
    builder.sourceEditor.editor.setValue("not valid json{{{");

    builder.sourceModeBtn.click();

    expect(builder.mode).toBe("source");
    expect(builder.sourceEditor.editor.getValue()).toBe("not valid json{{{");
  });
});

describe("ScriptBuilder: mode toggle", () => {
  it("Builder -> Source dumps the current builder state to YAML", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    builder.sourceModeBtn.click();

    expect(builder.mode).toBe("source");
    expect(JSON.parse(builder.sourceEditor.editor.getValue())).toEqual({
      class: "pkg.utils.log.LogScript",
      expression: "",
    });
  });

  it("Source -> Builder rebuilds the tree/form selection from valid YAML", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    builder.sourceModeBtn.click();
    builder.sourceEditor.editor.setValue(JSON.stringify({ class: "pkg.utils.log.LogScript", expression: "x" }));

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("builder");
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "x" });
  });

  it("Source -> Builder with invalid YAML stays in source view with a warning", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    builder.sourceModeBtn.click();
    builder.sourceEditor.editor.setValue("not json{{{");

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("source");
    expect(builder.warningEl.classList.contains("d-none")).toBe(false);
  });

  it("Source -> Builder with an unknown class stays in source view without dropping data", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    builder.sourceModeBtn.click();
    const unmappable = { class: "pkg.uninstalled.GoneScript", x: 1 };
    builder.sourceEditor.editor.setValue(JSON.stringify(unmappable));

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("source");
    expect(builder.warningEl.classList.contains("d-none")).toBe(false);
    expect(builder.getData()).toEqual(unmappable);
  });
});

describe("ScriptBuilder: refreshView()", () => {
  it("only refreshes the source editor while in source mode", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    let refreshed = 0;
    builder.sourceEditor.editor.refresh = () => refreshed++;

    builder.refreshView(); // builder mode -- no-op
    expect(refreshed).toBe(0);

    builder.sourceModeBtn.click();
    builder.refreshView();
    expect(refreshed).toBe(1);
  });
});
