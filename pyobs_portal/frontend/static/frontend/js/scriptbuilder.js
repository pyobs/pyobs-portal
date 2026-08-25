/**
 * Visual, schema-driven script builder for the task editor's Script tab.
 *
 * Replaces the raw-YAML `ScriptEditor`: browse script types from
 * `GET /api/schema/scripts/` in a searchable tree, pick a class, fill its
 * parameters through `SchemaForm` (including nested/polymorphic script
 * fields via schemaform.js's polymorphic + dynamic-map controls), get live
 * validation, and serialize back to the task's `script` JSON. The raw YAML
 * editor has no general-purpose toggle -- it's used only as the unmappable-
 * script fallback (§4.12: a task's `script` isn't a class-dict, or its class
 * isn't in the tree), opened automatically with a warning and a "Try Builder
 * view" button to attempt remapping once it's fixed.
 *
 * Keeps `ScriptEditor`'s public interface (`getData()` / `setContent()`) so
 * taskeditor.js's save/export/estimate wiring is unaffected; also exposes
 * `refreshView()` for the tab-show hook to refresh CodeMirror only when the
 * Source view is actually active.
 */

/** Stable (key-sorted) JSON stringify, for the "did the YAML round-trip?" check. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

class ScriptBuilder {
  constructor(container, scriptTree, scriptData, opts = {}) {
    this.tree = scriptTree || {};
    this.polymorphic = resolvePolymorphicCandidates(this.tree);
    this.moduleRefs = opts.moduleRefs || { available: false, options: {} };
    this.onChange = opts.onChange || null;
    this.mode = "builder"; // "builder" | "source"
    this.rootClass = null;
    this.form = null;
    this._leafByClass = new Map(); // fqcn -> {class, schema} tree entry
    this._treeLeafButtons = []; // { btn, fqcn, searchText }
    this._validateTimer = null;
    this._changeTimer = null;
    this._fieldErrorEls = []; // { controlEl, msgEl } currently applied by _applyFieldErrors()

    this._buildDom(container);
    this._setContent(scriptData);
  }

  // ── DOM scaffold ──────────────────────────────────────────────────────

  _buildDom(container) {
    container.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2";

    // No general-purpose Builder/Source toggle (issue #97): the visual form
    // already covers every schema-driven script class, so letting users
    // hand-edit arbitrary YAML for a normal, mappable script is unnecessary
    // risk. Source view is now reachable only as the unmappable-script
    // fallback (§4.12, see _setContent), and this button is its sole way
    // back into the builder -- shown only while that fallback is active.
    this.builderModeBtn = document.createElement("button");
    this.builderModeBtn.type = "button";
    this.builderModeBtn.className = "btn btn-sm btn-outline-secondary d-none";
    this.builderModeBtn.textContent = "Try Builder view";
    this.builderModeBtn.addEventListener("click", () => {
      // Only meaningful (and only ever visible) while stuck in the
      // unmappable-fallback source view -- guards against re-parsing stale
      // source content and clobbering an in-progress builder form.
      if (this.mode !== "source") return;
      this.warningEl.classList.add("d-none");
      this._switchToBuilder();
    });
    toolbar.appendChild(this.builderModeBtn);

    const right = document.createElement("div");
    right.className = "d-flex align-items-center gap-2";
    this.statusEl = document.createElement("span");
    this.statusEl.className = "small";
    right.appendChild(this.statusEl);
    toolbar.appendChild(right);
    container.appendChild(toolbar);

    this.warningEl = document.createElement("div");
    this.warningEl.className = "alert alert-warning small py-2 px-3 d-none mb-2";
    container.appendChild(this.warningEl);

    // validate_script/ errors this builder couldn't place next to their
    // actual field (issue #102) -- e.g. a loc path into a shape the form
    // doesn't decompose further. Rare (see _applyFieldErrors()), but listed
    // here rather than dropped.
    this.unresolvedErrorsEl = document.createElement("div");
    this.unresolvedErrorsEl.className = "alert alert-danger small py-2 px-3 d-none mb-2";
    container.appendChild(this.unresolvedErrorsEl);

    // Builder view: mutually-exclusive tree/editor panes -- only one is
    // visible at a time (issue #95: an always-visible tree next to the
    // editor made it too easy to switch root class mid-edit and lose form
    // state). Picking a type in the tree hides it and shows the editor;
    // "Delete script" (in _selectRoot) clears the form and brings the tree
    // back. This also removes the need for a mobile drawer/toggle: whichever
    // pane is active already gets the full width on any viewport.
    this.builderView = document.createElement("div");

    this.treePane = document.createElement("div");
    this.treePane.className = "script-builder-tree";
    this.builderView.appendChild(this.treePane);

    this.editorPane = document.createElement("div");
    this.editorPane.className = "script-builder-editor d-none";
    this.editorPane.addEventListener("input", () => this._scheduleChange());
    this.editorPane.addEventListener("change", () => this._scheduleChange());
    this.editorPane.addEventListener("click", (e) => {
      // Add/remove-row buttons (schemaform.js's array/map controls) don't
      // fire input/change -- re-validate on any button click too.
      if (e.target.closest("button")) this._scheduleChange();
    });
    this.builderView.appendChild(this.editorPane);
    container.appendChild(this.builderView);

    this._buildTree();

    // Source view: composes ScriptEditor (taskeditor.js) for the actual
    // CodeMirror mechanics -- this class owns validation/status for both
    // views, so ScriptEditor here is just a get/set + onChange wrapper.
    this.sourceView = document.createElement("div");
    this.sourceView.className = "d-none";
    container.appendChild(this.sourceView);
    this.sourceEditor = new ScriptEditor(this.sourceView, null, { onChange: () => this._scheduleChange() });
  }

  /** Render the type tree, reusing ScriptEditor's group-detection logic
   * (a node is a set of leaves iff every one of its values is a {class,
   * schema} entry) but as a collapsible/searchable tree instead of a flat
   * <select>. */
  _buildTree() {
    this.treePane.innerHTML = "";

    const lead = document.createElement("p");
    lead.className = "text-secondary small mb-2";
    lead.textContent = "Select a script type to begin.";
    this.treePane.appendChild(lead);

    const search = document.createElement("input");
    search.type = "search";
    search.className = "form-control form-control-sm mb-2";
    search.placeholder = "Search script types…";
    this.treePane.appendChild(search);

    const rootList = document.createElement("div");
    this.treePane.appendChild(rootList);

    const walk = (node, prefix, container) => {
      for (const [name, value] of Object.entries(node)) {
        if (name === "$polymorphic") continue;
        const isLeafGroup =
          value && typeof value === "object" &&
          Object.values(value).every((v) => v && typeof v === "object" && "class" in v && "schema" in v);
        if (isLeafGroup) {
          for (const [clsName, entry] of Object.entries(value)) {
            const path = `${prefix}${name}/${clsName}`;
            const description = entry.schema.description || "";
            this._leafByClass.set(entry.class, entry);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "list-group-item list-group-item-action py-1 px-2";
            // Full path (+ description, if any) as a tooltip -- useful when
            // the description below is truncated to two lines.
            btn.title = description ? `${path}\n\n${description}` : path;

            const nameEl = document.createElement("div");
            nameEl.className = "small";
            nameEl.textContent = clsName;
            btn.appendChild(nameEl);

            if (description) {
              // Issue #100: surface each script type's description in the
              // picker itself (previously shown only after selection, in
              // _selectRoot()'s editor-pane header) -- picking a type hides
              // the tree (#95/#99), so a wrong guess is costly to back out
              // of. Clamped to 2 lines; the full text is in the tooltip.
              const descEl = document.createElement("div");
              descEl.className = "text-secondary script-builder-tree-item-desc";
              descEl.textContent = description;
              btn.appendChild(descEl);
            }

            btn.addEventListener("click", () => {
              this._selectRoot(entry.class);
            });
            container.appendChild(btn);
            this._treeLeafButtons.push({ btn, fqcn: entry.class, searchText: path.toLowerCase() });
          }
        } else if (value && typeof value === "object") {
          const details = document.createElement("details");
          details.open = true;
          details.className = "mb-1";
          const summary = document.createElement("summary");
          summary.className = "small text-secondary text-uppercase fw-semibold py-1";
          summary.textContent = name;
          details.appendChild(summary);
          const list = document.createElement("div");
          list.className = "list-group list-group-flush";
          details.appendChild(list);
          container.appendChild(details);
          walk(value, `${prefix}${name}/`, list);
        }
      }
    };
    walk(this.tree, "", rootList);

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const { btn, searchText } of this._treeLeafButtons) {
        btn.classList.toggle("d-none", !(!q || searchText.includes(q)));
      }
      rootList.querySelectorAll("details").forEach((d) => {
        const anyVisible = [...d.querySelectorAll(".list-group-item")].some((el) => !el.classList.contains("d-none"));
        d.classList.toggle("d-none", !anyVisible);
        if (q) d.open = anyVisible;
      });
    });
  }

  _highlightTree() {
    for (const { btn, fqcn } of this._treeLeafButtons) {
      btn.classList.toggle("active", fqcn === this.rootClass);
    }
  }

  /** Select a root script class and (re)build its parameter form.
   * `data` (if given) seeds the form; a fresh tree-click selection omits it. */
  _selectRoot(fqcn, data) {
    const entry = this._leafByClass.get(fqcn);
    this.rootClass = fqcn;
    this._highlightTree();
    this.editorPane.innerHTML = "";
    this.treePane.classList.add("d-none");
    this.editorPane.classList.remove("d-none");

    const header = document.createElement("div");
    header.className = "d-flex align-items-center justify-content-between gap-2 mb-2";
    const title = document.createElement("div");
    title.className = "fw-semibold";
    title.textContent = fqcn.split(".").pop();
    header.appendChild(title);
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-sm btn-outline-danger";
    deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Delete script';
    deleteBtn.title = "Clear this script and pick a different type";
    deleteBtn.addEventListener("click", () => this._deleteScript());
    header.appendChild(deleteBtn);
    this.editorPane.appendChild(header);

    if (!entry) {
      this.form = null;
      const p = document.createElement("p");
      p.className = "text-danger small";
      p.textContent = `Unknown script class: ${fqcn}`;
      this.editorPane.appendChild(p);
      return;
    }

    if (entry.schema.description) {
      const desc = document.createElement("p");
      desc.className = "text-secondary small";
      desc.textContent = entry.schema.description;
      this.editorPane.appendChild(desc);
    }

    const rest = data && typeof data === "object" ? { ...data } : {};
    delete rest.class;
    this.form = new SchemaForm(entry.schema, entry.schema.$defs || {}, rest, {
      polymorphic: this.polymorphic,
      moduleRefs: this.moduleRefs,
    });
    this.editorPane.appendChild(this.form.element);
  }

  /** Back to the picker: hide the editor, clear the current selection, and
   * show the type tree again -- the only way back once a type is picked
   * (issue #95), so it always goes through the confirmation in
   * _deleteScript() rather than a stray click on the (now-hidden) tree. */
  _showPicker() {
    this.rootClass = null;
    this.form = null;
    this._highlightTree();
    this.editorPane.innerHTML = "";
    this.editorPane.classList.add("d-none");
    this.treePane.classList.remove("d-none");
  }

  /** "Delete script" button: clears the in-progress form and returns to the
   * type picker. Destructive enough (an entire configured script, possibly
   * with nested polymorphic children) to warrant a confirmation. */
  _deleteScript() {
    if (!confirm("Delete this script and start fresh? This clears all configured parameters and the script YAML.")) return;
    this.warningEl.classList.add("d-none");
    this._showPicker();
    this._setSourceText({});
    this._scheduleChange();
  }

  // ── Content / mode ───────────────────────────────────────────────────

  /** Restore builder state from `data` (the task's `script` JSON), opening
   * in source view with a warning if it isn't mappable (§4.12: imported
   * YAML from another pyobs version, an uninstalled script package, or a
   * legacy structure) -- never silently drops data. */
  _setContent(data) {
    this.warningEl.classList.add("d-none");
    const isEmpty = !data || typeof data !== "object" || Object.keys(data).length === 0;

    if (isEmpty) {
      this._showPicker();
      this._setSourceText({});
      this._applyMode("builder");
      this._scheduleValidate();
      return;
    }

    const cls = data.class;
    if (!cls || !this._leafByClass.has(cls)) {
      this.warningEl.textContent = cls
        ? `Unknown script class "${cls}" -- opened as raw YAML so nothing is lost. Install the script package or fix the class name to use the builder.`
        : `This script has no "class" set -- opened as raw YAML so nothing is lost.`;
      this.warningEl.classList.remove("d-none");
      this._setSourceText(data);
      this._applyMode("source");
      this._scheduleValidate();
      return;
    }

    this._selectRoot(cls, data);
    this._setSourceText(data);
    this._applyMode("builder");
    this._scheduleValidate();
  }

  /** Switch to the builder view, rebuilding it from the current YAML.
   * Shows a (non-blocking) warning if the YAML doesn't map to a known class,
   * and a different (also non-blocking) warning if it maps but the rebuilt
   * builder state doesn't exactly match what was there. */
  _switchToBuilder() {
    const parsed = this._parseSource();
    if (parsed === undefined) {
      this.warningEl.textContent = "Invalid YAML -- fix it before switching to the builder view.";
      this.warningEl.classList.remove("d-none");
      return;
    }
    const isEmpty = !parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0;
    const cls = isEmpty ? undefined : parsed.class;

    if (isEmpty) {
      this._showPicker();
    } else if (!cls || !this._leafByClass.has(cls)) {
      this.warningEl.textContent = cls
        ? `Unknown script class "${cls}" -- can't switch to the builder view without dropping data. Fix the class name or install the script package first.`
        : `No "class" set -- can't switch to the builder view without dropping data.`;
      this.warningEl.classList.remove("d-none");
      return;
    } else {
      this._selectRoot(cls, parsed);
    }

    this._applyMode("builder");
    if (!isEmpty && stableStringify(this.getData()) !== stableStringify(parsed)) {
      this.warningEl.textContent = "The builder view doesn't exactly match the YAML you had -- some fields may have changed.";
      this.warningEl.classList.remove("d-none");
    }
    this._scheduleChange();
  }

  _applyMode(mode) {
    this.mode = mode;
    // The "Try Builder view" button is the unmappable-fallback's only way
    // back into the builder, so it only makes sense while stuck in source.
    this.builderModeBtn.classList.toggle("d-none", mode !== "source");
    this.builderView.classList.toggle("d-none", mode !== "builder");
    this.sourceView.classList.toggle("d-none", mode !== "source");
    if (mode === "source") {
      setTimeout(() => this.sourceEditor.editor.refresh(), 0);
    }
  }

  _setSourceText(data) {
    this.sourceEditor.setContent(data && Object.keys(data).length ? data : null);
  }

  /** Unlike ScriptEditor.getData() (which swallows a parse error into `{}`),
   * this distinguishes "invalid YAML" (undefined) from "valid but empty". */
  _parseSource() {
    try {
      return jsyaml.load(this.sourceEditor.editor.getValue()) || {};
    } catch (e) {
      return undefined;
    }
  }

  // ── Validation ───────────────────────────────────────────────────────

  _scheduleValidate() {
    clearTimeout(this._validateTimer);
    this._validateTimer = setTimeout(() => this._validate(), 400);
  }

  /** Like _scheduleValidate(), but also (debounced, same 400 ms) notifies
   * onChange -- used at actual edit sites so the task editor can re-run
   * estimate_duration/ as the user works, without doing so on the initial
   * load in _setContent() and clobbering the task's stored duration. */
  _scheduleChange() {
    this._scheduleValidate();
    clearTimeout(this._changeTimer);
    this._changeTimer = setTimeout(() => {
      if (this.onChange) this.onChange();
    }, 400);
  }

  async _validate() {
    this._clearFieldErrors();
    if (this.mode === "builder" && !this.rootClass) {
      // No type picked yet (fresh empty script, or just back from Delete) --
      // clear the status rather than running validate_script/ against {},
      // which would show "no script class selected" as a red error for a
      // state the user hasn't done anything wrong to reach.
      this.statusEl.textContent = "";
      this.statusEl.className = "small";
      return;
    }
    if (this.mode === "source" && this._parseSource() === undefined) {
      // getData() flattens invalid YAML into {}, which validate_script/
      // would report as "no script class selected" -- misleading when the
      // actual problem is the YAML itself not parsing.
      this.statusEl.textContent = "✗ Invalid YAML";
      this.statusEl.className = "small text-danger";
      return;
    }
    const data = this.getData();
    try {
      const result = await apiRequest("validate_script/", { method: "POST", body: data });
      if (result.valid) {
        this.statusEl.textContent = "✓ Valid";
        this.statusEl.className = "small text-success";
      } else {
        this.statusEl.textContent = `✗ ${result.error}`;
        this.statusEl.className = "small text-danger";
        if (result.errors) this._applyFieldErrors(result.errors);
      }
    } catch (e) {
      this.statusEl.textContent = `✗ ${e.message}`;
      this.statusEl.className = "small text-danger";
    }
  }

  /** Remove whatever _applyFieldErrors() flagged on the previous run --
   * always called first in _validate(), so a fixed field's flag disappears
   * on the next debounced pass even if the overall script is still invalid
   * for other reasons. */
  _clearFieldErrors() {
    for (const { controlEl, msgEl } of this._fieldErrorEls) {
      controlEl?.classList.remove("is-invalid");
      msgEl.remove();
    }
    this._fieldErrorEls = [];
    this.unresolvedErrorsEl.classList.add("d-none");
    this.unresolvedErrorsEl.textContent = "";
  }

  /** Place each validate_script/ error (issue #102: `{loc, msg}`, `loc` a
   * path of field names / list indices / dict keys) next to the actual
   * field it's about, via SchemaForm.resolveFieldPath() -- instead of the
   * old one-line raw pydantic dump in the status bar. Only meaningful in
   * builder mode with a form actually on screen; source-mode/no-form errors
   * still show via the status bar's summary alone. Multiple errors that
   * resolve to the same row (e.g. several missing entries in a tuple field
   * the form doesn't decompose further, all falling back to that field's
   * own row -- see SchemaForm.resolveFieldPath()'s degrade-gracefully
   * behavior) are grouped into one message rather than duplicated. */
  _applyFieldErrors(errors) {
    if (this.mode !== "builder" || !this.form) return;

    const byRow = new Map(); // rowEl -> string[]
    const unresolved = [];
    for (const err of errors) {
      const resolved = this.form.resolveFieldPath(err.loc);
      if (!resolved) {
        unresolved.push(err);
        continue;
      }
      if (!byRow.has(resolved.rowEl)) byRow.set(resolved.rowEl, []);
      byRow.get(resolved.rowEl).push(err.msg);
    }

    for (const [rowEl, messages] of byRow) {
      const controlEl = rowEl.querySelector("input, select, textarea");
      controlEl?.classList.add("is-invalid");
      const msgEl = document.createElement("div");
      msgEl.className = "small text-danger mt-1";
      msgEl.textContent = messages.join(" / ");
      rowEl.insertAdjacentElement("afterend", msgEl);
      this._fieldErrorEls.push({ controlEl, msgEl });
    }

    if (unresolved.length) {
      this.unresolvedErrorsEl.textContent = unresolved.map((err) => `${this._formatLoc(err.loc)}: ${err.msg}`).join("; ");
      this.unresolvedErrorsEl.classList.remove("d-none");
    }
  }

  /** Render a validate_script/ error's `loc` path as something a user
   * recognizes -- e.g. `["configuration", "instrument_configs", 0,
   * "window"]` -> "Configuration → Instrument Configs → item 1 → Window" --
   * for the rare unresolved-error fallback list. */
  _formatLoc(loc) {
    return loc.map((seg) => (typeof seg === "number" ? `item ${seg + 1}` : prettyLabel(seg))).join(" → ");
  }

  // ── Public interface (matches ScriptEditor) ─────────────────────────

  getData() {
    if (this.mode === "source") {
      const parsed = this._parseSource();
      return parsed === undefined ? {} : parsed;
    }
    if (!this.rootClass) return {};
    return { class: this.rootClass, ...(this.form ? this.form.getData() : {}) };
  }

  setContent(data) {
    this._setContent(data);
  }

  /** Refresh CodeMirror's layout -- only meaningful (and only touches the
   * editor) when the Source view is actually active. */
  refreshView() {
    if (this.mode === "source") this.sourceEditor.editor.refresh();
  }
}

if (typeof window !== "undefined") {
  window.ScriptBuilder = ScriptBuilder;
  window.stableStringify = stableStringify;
}
