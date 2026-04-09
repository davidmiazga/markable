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
import { HighlightExtension } from "./highlight-ext";
import { Compartment, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { livePreviewExtension } from "./live-preview";
import { formatKeymap } from "./format";

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

const interStack = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Preview mode theme — sets typography via CM6's own style system. */
export const previewTheme = EditorView.theme({
  "&": {
    fontFamily: interStack,
    fontSize: "var(--settings-base-font-size)",
    lineHeight: "1.7",
  },
  ".cm-content": {
    fontFamily: interStack,
  },
  ".cm-line": {
    fontFamily: interStack,
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
export const previewExtensions: Extension = [livePreviewExtension, previewTheme];

/** Compartment that holds the live preview extensions (toggleable). */
export const previewCompartment = new Compartment();

/**
 * Build the extension set for the editor.
 * Live preview starts ON by default.
 */
export function buildExtensions(): Extension[] {
  const extensions: Extension[] = [];

  try {
    extensions.push(markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [HighlightExtension] }));
  } catch (error) {
    console.warn("Failed to load Markdown extension:", error);
  }

  extensions.push(EditorView.lineWrapping);
  extensions.push(Prec.high(keymap.of(formatKeymap)));
  extensions.push(baseTheme);
  extensions.push(syntaxHighlighting(themeHighlight));
  extensions.push(previewCompartment.of(previewExtensions));

  return extensions;
}
