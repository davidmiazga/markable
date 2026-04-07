/**
 * CodeMirror 6 extensions for Markdown editing.
 *
 * Configures syntax highlighting and language support.
 */

import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";

/**
 * Build the extension set for the editor.
 *
 * Returns an array of extensions that can be passed to the editor.
 * If any extension fails to load, logs a warning but continues.
 *
 * @returns Array of CodeMirror extensions
 */
export function buildExtensions(): Extension[] {
  const extensions: Extension[] = [];

  // Markdown language support with syntax highlighting
  try {
    extensions.push(markdown());
  } catch (error) {
    console.warn("Failed to load Markdown extension:", error);
    // Continue without markdown support
  }

  return extensions;
}
