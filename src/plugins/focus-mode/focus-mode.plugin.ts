/**
 * IIFE entry point for the Focus Mode core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/focus-mode.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules for all .plugin.ts files:
 *   - Only @codemirror/* npm packages may be imported (Vite bundles them).
 *   - App-internal modules (bridge, settings, main, plugin-types) are FORBIDDEN.
 *     They are not present inside the IIFE sandbox at runtime.
 *   - CSS is injected as a <style> tag — CSS file imports do not work in IIFE output.
 *   - The `import type` for MarkablePluginAPI is erased by tsc; no runtime code emitted.
 *
 * CM6 extension logic is duplicated from focus-mode.ts rather than imported,
 * because focus-mode.ts imports a .css file which Vite handles as a virtual module
 * that cannot survive the IIFE sandbox at runtime. The source-of-truth logic in
 * focus-mode.ts is UNCHANGED.
 *
 * Bug #2 fix: The original implementation wrapped the dimming logic in a StateField
 * that defaulted to false and required a StateEffect to activate. PluginManager never
 * dispatched that effect (step_04a was never reached), so the dimming never turned on.
 *
 * The fix removes the StateField/StateEffect toggle entirely. The compartment provided
 * by PluginManager is the on/off mechanism: when the plugin is enabled, api.addExtensions
 * installs the ViewPlugin; when disabled, api.removeExtensions removes it. The ViewPlugin
 * therefore always applies decorations whenever it is present in the compartment.
 *
 * EC-30: Vite build fails with non-zero exit if TypeScript or import errors exist.
 * EC-31: rollupOptions.external:[] in vite.plugins.config.ts ensures no require() calls.
 * EC-32: No app-internal imports; CSS injected via DOM — IIFE is fully self-contained.
 */

// Bug #5 fix: DO NOT import from @codemirror/* directly. The build marks all
// @codemirror/* packages as external. At runtime, main.ts assigns the real CM6
// module objects to window globals (cm-globals.ts) before any plugin IIFE runs.
// Destructuring from those globals ensures this plugin shares the SAME StateField
// slot-ID namespace as the main editor — a bundled copy would create a disjoint set.
//
// Only destructure the names used as runtime values. Do NOT destructure EditorView —
// it is only needed as a type annotation here, and naming it both as a const (from
// the window cast) and as a type import would cause TypeScript to report that the
// const is "used as a type" (TS2749). Import it type-only instead.
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  ViewPlugin,
  Decoration,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
/* eslint-enable @typescript-eslint/no-explicit-any */

// Type-only imports are erased by tsc — safe to keep for IDE support.
// EditorView is imported only as a type (not a value); Decoration is the runtime
// value above; DecorationSet and ViewUpdate are types only.
import type { EditorState } from "@codemirror/state";
import type { EditorView, DecorationSet, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Inline CSS ────────────────────────────────────────────────────────────────
// Replaces the focus-mode.css import, which cannot be evaluated inside the IIFE
// sandbox at runtime. A <style> tag is idempotent — the guard on the element id
// prevents duplicate injection across toggle cycles (EC-34).

/**
 * Inject the focus-mode CSS into the document <head>.
 * No-op if already injected (identified by the unique element id).
 */
function injectCSS(): void {
  const id = "__markable_focus_mode_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `.cm-focus-dimmed { opacity: 0.25; transition: opacity 0.15s ease; }`;
  document.head.appendChild(style);
}

/**
 * Remove the injected focus-mode CSS from the document <head>.
 * Called from onDisable so the style is cleaned up when the plugin is toggled off.
 */
function removeCSS(): void {
  document.getElementById("__markable_focus_mode_css__")?.remove();
}

// ── CM6 extension ─────────────────────────────────────────────────────────────
// Duplicated from src/editor/focus-mode.ts to keep this IIFE fully self-contained.
// The original file remains the source of truth and is not modified.
//
// Bug #2 fix: No StateField or StateEffect. The ViewPlugin always applies dimming
// when it is present in the compartment. The compartment is the on/off switch.

/**
 * Determine the contiguous paragraph boundaries for the given document position.
 *
 * A "paragraph" is a run of non-blank lines. Blank lines (whitespace-only) are
 * the paragraph delimiters. This function walks up and down from the cursor's
 * current line until it hits a blank line or a document edge.
 *
 * @param state - Current EditorState.
 * @param pos   - Absolute document position (typically selection.main.head).
 * @returns     Object with `from` and `to` character offsets for the paragraph.
 */
function findParagraphRange(
  state: EditorState,
  pos: number,
): { from: number; to: number } {
  const doc = state.doc;
  const curLine = doc.lineAt(pos);
  let startLine = curLine.number;
  // Walk backward until a blank line or start-of-document.
  while (startLine > 1) {
    const prev = doc.line(startLine - 1);
    if (prev.text.trim() === "") break;
    startLine--;
  }
  let endLine = curLine.number;
  const totalLines = doc.lines;
  // Walk forward until a blank line or end-of-document.
  while (endLine < totalLines) {
    const next = doc.line(endLine + 1);
    if (next.text.trim() === "") break;
    endLine++;
  }
  return {
    from: doc.line(startLine).from,
    to: doc.line(endLine).to,
  };
}

/** Decoration applied to every line outside the active paragraph. */
const dimmedLine = Decoration.line({ class: "cm-focus-dimmed" });

/**
 * ViewPlugin that applies the dimmedLine decoration to all lines outside the
 * current paragraph.
 *
 * Because the compartment is the on/off switch (the plugin is only present when
 * focus mode is enabled), this ViewPlugin always applies dimming — there is no
 * internal boolean guard. Re-runs on document change or selection change.
 */
const focusModeViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }
    update(update: ViewUpdate) {
      // Rebuild decorations on any change that could shift the active paragraph.
      if (update.docChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    buildDecorations(view: EditorView): DecorationSet {
      const head = view.state.selection.main.head;
      const { from: paraFrom, to: paraTo } = findParagraphRange(view.state, head);
      // Build a decoration for every line NOT inside the active paragraph.
      // The `value` type is annotated as `ReturnType<typeof Decoration.line>` to
      // avoid TS2749 — `Decoration` here is a runtime const from the window global,
      // not a type import, so it cannot be used directly as a type annotation.
      const builder: { from: number; value: ReturnType<typeof Decoration.line> }[] = [];
      const doc = view.state.doc;
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (line.from >= paraFrom && line.to <= paraTo) continue;
        builder.push({ from: line.from, value: dimmedLine });
      }
      return Decoration.set(builder.map((d) => d.value.range(d.from)));
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Plugin object ─────────────────────────────────────────────────────────────

/**
 * UnifiedPlugin definition for Focus Mode.
 *
 * onEnable: injects CSS, registers the focusModeViewPlugin via api.addExtensions().
 *   The ViewPlugin immediately starts dimming non-paragraph lines — no effect
 *   dispatch required. The compartment (managed by PluginManager) is the on/off switch.
 *
 * onDisable: removes CM6 extensions and cleans up the injected CSS.
 */
export default {
  id: "focus-mode",
  name: "Focus Mode",
  version: "1.0.0",
  description: "Dim all content except the current paragraph",
  detail:
    "Dims all lines except the paragraph containing your cursor, helping you focus on what you're writing. The active paragraph stays at full opacity while everything else fades. Works at the paragraph/block level — code fences and list items are treated as single blocks.",

  onEnable(api: MarkablePluginAPI): void {
    injectCSS();
    // Register only the ViewPlugin — no StateField needed. The compartment
    // is the on/off switch (Bug #2 fix).
    api.addExtensions([focusModeViewPlugin]);
  },

  onDisable(api: MarkablePluginAPI): void {
    api.removeExtensions();
    removeCSS();
  },
};
