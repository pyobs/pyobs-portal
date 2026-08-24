import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

describe("ScriptBuilder: type picker shows each type's description (issue #100)", () => {
  // A tree entry that carries a schema.description, unlike TREE's LogScript
  // / SequentialRunner -- keeps the shared TREE/selectByText() untouched
  // (its exact-textContent match would break once a description is appended
  // as a sibling node inside the button).
  const TREE_WITH_DESC = {
    utils: {
      log: {
        LogScript: {
          class: "pkg.utils.log.LogScript",
          schema: {
            title: "LogScript",
            type: "object",
            description: "Logs an arbitrary Python expression to the observation log.",
            properties: { expression: { type: "string", title: "Expression" } },
            required: ["expression"],
          },
        },
      },
    },
  };

  it("renders the description below the class name", () => {
    const container = makeContainer();
    new ScriptBuilder(container, TREE_WITH_DESC, {});

    const btn = [...container.querySelectorAll(".list-group-item")][0];
    expect(btn.querySelector(".script-builder-tree-item-desc").textContent).toBe(
      "Logs an arbitrary Python expression to the observation log."
    );
  });

  it("puts the path and description in the tooltip", () => {
    const container = makeContainer();
    new ScriptBuilder(container, TREE_WITH_DESC, {});

    const btn = [...container.querySelectorAll(".list-group-item")][0];
    expect(btn.title).toBe("utils/log/LogScript\n\nLogs an arbitrary Python expression to the observation log.");
  });

  it("omits the description element for a type with no schema description", () => {
    const container = makeContainer();
    new ScriptBuilder(container, TREE, {}); // TREE's LogScript has no description

    const btn = [...container.querySelectorAll(".list-group-item")].find(
      (b) => b.querySelector(".small")?.textContent === "LogScript"
    );
    expect(btn.querySelector(".script-builder-tree-item-desc")).toBeNull();
    expect(btn.title).toBe("utils/log/LogScript");
  });
});

describe("ScriptBuilder: tree/editor pane exclusivity (issue #95)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with only the tree pane visible, editor pane hidden", () => {
    const builder = new ScriptBuilder(makeContainer(), TREE, {});
    expect(builder.treePane.classList.contains("d-none")).toBe(false);
    expect(builder.editorPane.classList.contains("d-none")).toBe(true);
  });

  it("picking a type hides the tree pane and shows the editor pane", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");

    expect(builder.treePane.classList.contains("d-none")).toBe(true);
    expect(builder.editorPane.classList.contains("d-none")).toBe(false);
  });

  it("restoring an existing valid script opens straight into the editor pane, tree hidden", () => {
    const data = { class: "pkg.utils.log.LogScript", expression: "existing" };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    expect(builder.treePane.classList.contains("d-none")).toBe(true);
    expect(builder.editorPane.classList.contains("d-none")).toBe(false);
  });

  it("Delete script asks for confirmation; declining leaves the form untouched", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    const input = container.querySelector("input[type=text]");
    input.value = "in progress";
    input.dispatchEvent(new Event("input"));

    vi.spyOn(window, "confirm").mockReturnValue(false);
    container.querySelector(".script-builder-editor .btn-outline-danger").click();

    expect(builder.treePane.classList.contains("d-none")).toBe(true);
    expect(builder.editorPane.classList.contains("d-none")).toBe(false);
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "in progress" });
  });

  it("Delete script, once confirmed, clears the form and shows the tree again", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    const input = container.querySelector("input[type=text]");
    input.value = "in progress";
    input.dispatchEvent(new Event("input"));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    container.querySelector(".script-builder-editor .btn-outline-danger").click();

    expect(builder.rootClass).toBeNull();
    expect(builder.treePane.classList.contains("d-none")).toBe(false);
    expect(builder.editorPane.classList.contains("d-none")).toBe(true);
    expect(builder.getData()).toEqual({});
  });

  it("after Delete, picking a different type starts a clean form (no leftover state)", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    const input = container.querySelector("input[type=text]");
    input.value = "in progress";
    input.dispatchEvent(new Event("input"));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    container.querySelector(".script-builder-editor .btn-outline-danger").click();
    selectByText(container, "SequentialRunner");

    expect(builder.treePane.classList.contains("d-none")).toBe(true);
    expect(builder.editorPane.classList.contains("d-none")).toBe(false);
    expect(builder.getData()).toEqual({ class: "pkg.control.sequential.SequentialRunner", scripts: [] });
  });
});

describe("ScriptBuilder: status bar while no type is picked", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no status for a fresh empty script, rather than validate_script/'s \"no script class selected\"", async () => {
    const builder = new ScriptBuilder(makeContainer(), TREE, {});
    await builder._validate();
    expect(builder.statusEl.textContent).toBe("");
    expect(builder.statusEl.className).toBe("small");
  });

  it("Delete clears any stale status rather than leaving a red error behind", async () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    // Simulate a prior successful validation before deleting.
    builder.statusEl.textContent = "✓ Valid";
    builder.statusEl.className = "small text-success";

    vi.spyOn(window, "confirm").mockReturnValue(true);
    container.querySelector(".script-builder-editor .btn-outline-danger").click();
    await builder._validate();

    expect(builder.statusEl.textContent).toBe("");
    expect(builder.statusEl.className).toBe("small");
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

describe("ScriptBuilder: no general-purpose Builder/Source toggle (issue #97)", () => {
  it("a normal, mappable script has no Source button to switch away to", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");

    expect(builder.sourceModeBtn).toBeUndefined();
    expect(builder.builderModeBtn.classList.contains("d-none")).toBe(true);
  });

  it("clicking the (hidden) builderModeBtn while already in builder mode is a no-op", () => {
    const container = makeContainer();
    const builder = new ScriptBuilder(container, TREE, {});
    selectByText(container, "LogScript");
    const input = container.querySelector("input[type=text]");
    input.value = "in progress";
    input.dispatchEvent(new Event("input"));

    // The source editor was never synced with this edit (only construction
    // set it, to `{}`) -- if this weren't a no-op, it would re-parse that
    // stale/empty content and wipe the in-progress edit.
    builder.builderModeBtn.click();

    expect(builder.mode).toBe("builder");
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "in progress" });
  });
});

describe("ScriptBuilder: unmappable-fallback recovery (\"Try Builder view\")", () => {
  it("the fallback shows a visible 'Try Builder view' button", () => {
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);

    expect(builder.mode).toBe("source");
    expect(builder.builderModeBtn.classList.contains("d-none")).toBe(false);
    expect(builder.builderModeBtn.textContent).toBe("Try Builder view");
  });

  it("rebuilds the tree/form selection once the class is fixed to a valid one", () => {
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    builder.sourceEditor.editor.setValue(JSON.stringify({ class: "pkg.utils.log.LogScript", expression: "x" }));

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("builder");
    expect(builder.builderModeBtn.classList.contains("d-none")).toBe(true);
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "x" });
  });

  it("stays in source view with a warning if the YAML is still invalid", () => {
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    builder.sourceEditor.editor.setValue("not json{{{");

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("source");
    expect(builder.warningEl.classList.contains("d-none")).toBe(false);
  });

  it("stays in source view without dropping data if the class is still unknown", () => {
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    const stillUnmappable = { class: "pkg.uninstalled.StillGone", x: 2 };
    builder.sourceEditor.editor.setValue(JSON.stringify(stillUnmappable));

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("source");
    expect(builder.warningEl.classList.contains("d-none")).toBe(false);
    expect(builder.getData()).toEqual(stillUnmappable);
  });

  it("warns (non-blocking) when a field doesn't survive the rebuild", () => {
    // The schema only knows about `expression`; extra_field is silently
    // dropped by SchemaForm, which only reads its own schema.properties --
    // the switch still succeeds, but the stableStringify mismatch must be
    // surfaced so the user notices before saving.
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    builder.sourceEditor.editor.setValue(
      JSON.stringify({ class: "pkg.utils.log.LogScript", expression: "x", extra_field: "dropped" })
    );

    builder.builderModeBtn.click();

    expect(builder.mode).toBe("builder");
    expect(builder.warningEl.classList.contains("d-none")).toBe(false);
    expect(builder.warningEl.textContent).toMatch(/doesn't exactly match/);
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "x" });
  });

  it("clicking 'Try Builder view' while already in builder mode is a no-op (defensive: the button is hidden then)", () => {
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    builder.sourceEditor.editor.setValue(JSON.stringify({ class: "pkg.utils.log.LogScript", expression: "x" }));
    builder.builderModeBtn.click();
    expect(builder.mode).toBe("builder");

    builder.sourceEditor.editor.setValue("not valid json{{{"); // stale, unsynced content
    builder.builderModeBtn.click();

    expect(builder.mode).toBe("builder");
    expect(builder.getData()).toEqual({ class: "pkg.utils.log.LogScript", expression: "x" });
  });
});

describe("ScriptBuilder: source-view validation status", () => {
  it("shows an Invalid YAML message rather than getData()'s {} fallback misreporting via validate_script/", async () => {
    const data = { class: "pkg.uninstalled.GoneScript", x: 1 };
    const builder = new ScriptBuilder(makeContainer(), TREE, data);
    builder.sourceEditor.editor.setValue("not valid json{{{");

    await builder._validate();

    expect(builder.statusEl.textContent).toBe("✗ Invalid YAML");
  });
});

describe("ScriptBuilder: refreshView()", () => {
  it("only refreshes the source editor while in source mode", () => {
    const builder = new ScriptBuilder(makeContainer(), TREE, {});
    let refreshed = 0;
    builder.sourceEditor.editor.refresh = () => refreshed++;

    builder.refreshView(); // builder mode -- no-op
    expect(refreshed).toBe(0);

    builder.setContent({ class: "pkg.uninstalled.GoneScript", x: 1 }); // unmappable -- forces source mode
    builder.refreshView();
    expect(refreshed).toBe(1);
  });
});
