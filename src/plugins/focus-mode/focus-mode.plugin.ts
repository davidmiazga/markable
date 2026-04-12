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
 * EC-30: Vite build fails with non-zero exit if TypeScript or import errors exist.
 * EC-31: rollupOptions.external:[] in vite.plugins.config.ts ensures no require() calls.
 * EC-32: No app-internal imports; CSS injected via DOM — IIFE is fully self-contained.
 */

import {
  StateField,
  StateEffect,
  type Extension,
  type EditorState,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
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

/** StateEffect used to enable or disable focus mode via EditorView.dispatch. */
const setFocusMode = StateEffect.define<boolean>();

/**
 * StateField that tracks whether focus mode is active.
 * Defaults to false — dim nothing until the effect fires.
 * The effect is dispatched by PluginManager._enablePlugin in step_04a after
 * addExtensions registers the field in the compartment.
 */
const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFocusMode)) return e.value;
    }
    return value;
  },
});

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
 * current paragraph when focus mode is active.
 *
 * Re-runs on: document change, selection change, or focus mode toggle.
 * When focus mode is off (focusModeField === false), returns Decoration.none.
 */
const focusModeViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }
    update(update: ViewUpdate) {
      // Rebuild decorations on any change that could shift the active paragraph.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.startState.field(focusModeField) !==
          update.state.field(focusModeField)
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    buildDecorations(view: EditorView): DecorationSet {
      const enabled = view.state.field(focusModeField);
      if (!enabled) return Decoration.none;
      const head = view.state.selection.main.head;
      const { from: paraFrom, to: paraTo } = findParagraphRange(view.state, head);
      // Build a decoration for every line NOT inside the active paragraph.
      const builder: { from: number; value: Decoration }[] = [];
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

/**
 * Combined CM6 extension: the StateField (persists enabled state across
 * transactions) and the ViewPlugin (computes dimming decorations).
 */
const focusModeExtension: Extension = [focusModeField, focusModeViewPlugin];

// ── Plugin object ─────────────────────────────────────────────────────────────

/**
 * UnifiedPlugin definition for Focus Mode.
 *
 * onEnable: injects CSS, registers the CM6 extension via the API.
 *   The StateField defaults to false (no dimming) until PluginManager._enablePlugin
 *   (step_04a) dispatches setFocusMode.of(true) through the EditorView after
 *   addExtensions completes. The IIFE itself does not hold an EditorView reference.
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
    api.addExtensions([focusModeExtension]);
    // The StateField defaults to false (dim nothing) after compartment registration.
    // PluginManager._enablePlugin (step_04a) dispatches setFocusMode.of(true) through
    // the live EditorView after this call returns, activating the dimming effect.
    // In Chunk 2 the IIFE output is never executed at runtime (static path unchanged);
    // this onEnable exists to verify the build pipeline is correct.
  },

  onDisable(api: MarkablePluginAPI): void {
    api.removeExtensions();
    removeCSS();
  },
};
