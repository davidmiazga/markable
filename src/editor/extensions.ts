/**
 * CodeMirror 6 extensions for Markdown editing.
 *
 * Configures syntax highlighting, language support, and live preview.
 * The live preview extension lives in a Compartment so it can be toggled.
 */

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Autolink, Superscript, Subscript } from "@lezer/markdown";
import { HighlightExtension } from "./highlight-ext";
import { CommentExtension } from "./comment-ext";
import { FootnoteExtension } from "./footnote-ext";
import { Compartment, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import { livePreviewExtension, tablePreviewField, viewModeField } from "./live-preview";
import { formatKeymap, pasteURLHandler } from "./format";
import { searchTheme } from "./search-theme";
import { listKeymap } from "./list-keybindings";

/** Base theme — overrides basicSetup's hardcoded colors with CSS variables. */
const baseTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-primary)",
    borderRight: "none",
    color: "var(--text-secondary)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-primary)",
  },
  ".cm-content": {
    caretColor: "var(--cursor-color)",
    color: "var(--text-primary)",
  },
});

/** Preview mode theme — sets typography via CM6's own style system. */
export const previewTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--ui-font)",
    fontSize: "var(--settings-base-font-size)",
    lineHeight: "1.7",
  },
  ".cm-content": {
    fontFamily: "var(--ui-font)",
  },
  ".cm-line": {
    fontFamily: "var(--ui-font)",
  },
});

/**
 * Override defaultHighlightStyle colors so our CSS-variable-based
 * theme controls all syntax colors. Headings inherit from the
 * line-decoration classes (.cm-live-h1 etc.) applied by live-preview.
 */
const themeHighlight = HighlightStyle.define([
  { tag: tags.link, color: "var(--link-color)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--link-color)" },
  { tag: tags.heading1, color: "inherit", fontWeight: "inherit" },
  { tag: tags.heading2, color: "inherit", fontWeight: "inherit" },
  { tag: tags.heading3, color: "inherit", fontWeight: "inherit" },
  { tag: tags.heading4, color: "inherit", fontWeight: "inherit" },
  { tag: tags.heading5, color: "inherit", fontWeight: "inherit" },
  { tag: tags.heading6, color: "inherit", fontWeight: "inherit" },
  { tag: tags.strong, color: "inherit" },
  { tag: tags.emphasis, color: "inherit" },
  { tag: tags.strikethrough, color: "inherit" },
  { tag: tags.quote, color: "var(--blockquote-color)", fontStyle: "italic" },
]);

/** All preview-mode extensions bundled together. */
export const previewExtensions: Extension = [livePreviewExtension, tablePreviewField, previewTheme];

/** Compartment that holds the live preview extensions (toggleable). */
export const previewCompartment = new Compartment();

/** Compartment that controls editor editability (toggled for read-only help files). */
export const editableCompartment = new Compartment();

/**
 * Compartment that holds all CM6 extensions contributed by plugins.
 * Managed by PluginManager.addExtensions() / removeExtensions().
 * Initialized empty in buildExtensions(); plugins populate it during restoreAll().
 * EC-18: starts empty — all plugin extensions are added post-init via setEditorView flush.
 */
export const pluginCompartment = new Compartment();

/**
 * FR-2.2 / TC-2: Suppress the CM6 built-in search panel DOM entirely.
 *
 * search() must be registered so that its searchState StateField is
 * present in the editor state — without it, setSearchQuery, findNext,
 * findPrevious, replaceNext, replaceAll, and searchKeymap all silently
 * no-op. However, the default panel factory injects .cm-panels DOM that
 * conflicts with the custom FindWidget.
 *
 * createPanel returns a minimal Panel whose dom is a zero-size hidden div.
 * CM6 mounts this "panel" but it contributes nothing to layout.
 * openSearchPanel / closeSearchPanel are never called from application
 * code (main.ts uses FindWidget.open/close instead), so the togglePanel
 * effect that would make the hidden div visible is never dispatched in
 * normal operation.
 *
 * These are module-level constants, not re-created on each buildExtensions()
 * call. This is safe because Panel.dom is never mutated by CM6.
 */
// Requires DOM at import time. Safe in Tauri WebView and Vitest/happy-dom. Not suitable for SSR.
const _hiddenPanelDom = document.createElement("div");
_hiddenPanelDom.style.cssText = "display:none;width:0;height:0;overflow:hidden;position:absolute";
const _suppressedPanel = { dom: _hiddenPanelDom };

/**
 * Build the extension set for the editor.
 * Live preview starts ON by default.
 */
export function buildExtensions(): Extension[] {
  const extensions: Extension[] = [];

  try {
    extensions.push(markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Autolink, HighlightExtension, CommentExtension, FootnoteExtension, Superscript, Subscript] }));
  } catch (error) {
    console.warn("Failed to load Markdown extension:", error);
  }

  extensions.push(EditorView.lineWrapping);
  extensions.push(Prec.high(keymap.of(formatKeymap)));
  extensions.push(pasteURLHandler);

  // TC-2: search() registers the searchState StateField required by
  // setSearchQuery, findNext, findPrevious, replaceNext, replaceAll.
  // createPanel is overridden to suppress the built-in panel DOM so it
  // never conflicts with the custom FindWidget floating overlay.
  // See docs/specs/find-replace/00_index.md § TC-2 Resolution.
  //
  // IMPORTANT: search() must be registered BEFORE Prec.high(keymap.of(searchKeymap)).
  // CM6 applies extensions in registration order. The `search()` call registers the
  // searchState StateField and panel factory that the searchKeymap commands rely on.
  // If searchKeymap is registered first, its commands (findNext, closeSearchPanel, etc.)
  // will dispatch effects into a state that does not yet have the searchState field,
  // causing them to silently no-op on the first keypress.
  extensions.push(search({ createPanel: () => _suppressedPanel }));

  // TC-3: searchKeymap at Prec.high so it is not shadowed by basicSetup's default keymaps.
  // Verified: Mod-f, Mod-g, Mod-Shift-g, F3, Escape do not conflict with formatKeymap.
  extensions.push(Prec.high(keymap.of(searchKeymap)));
  extensions.push(baseTheme);
  // FR-4.4: searchTheme registered after basicSetup (applied in editor.ts) and after
  // baseTheme so it wins CSS specificity on .cm-panels, .cm-textfield, .cm-button,
  // and match highlights.
  extensions.push(searchTheme);
  extensions.push(syntaxHighlighting(themeHighlight));
  extensions.push(viewModeField);
  extensions.push(listKeymap);
  // Tab/Shift-Tab fallback for non-list lines. List lines are handled by
  // listKeymap above at Prec.high. These insert/remove 2 spaces.
  extensions.push(keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: "  " }, selection: { anchor: from + 2 } });
        return true;
      },
      shift: (view) => {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const spaces = line.text.match(/^ {1,2}/);
        if (!spaces) return false;
        view.dispatch({ changes: { from: line.from, to: line.from + spaces[0].length, insert: "" } });
        return true;
      },
    },
  ]));
  // Plugin-contributed CM6 extensions live inside pluginCompartment.
  // PluginManager.addExtensions() reconfigures this compartment post-init
  // (called from onEnable via the MarkablePluginAPI closure).
  // Starts empty — all plugin extensions are added after setEditorView() is called.
  extensions.push(pluginCompartment.of([]));
  extensions.push(previewCompartment.of(previewExtensions));
  extensions.push(editableCompartment.of(EditorView.editable.of(true)));

  return extensions;
}
