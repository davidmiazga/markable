/**
 * CodeMirror 6 editor factory.
 *
 * Creates and manages a markdown editor instance.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { buildExtensions } from "./extensions";

/**
 * Create a CodeMirror editor instance.
 *
 * @param target - DOM element to mount the editor into
 * @param initialDoc - Initial document content (default: empty)
 * @returns EditorView instance, or null if creation failed
 *
 * @example
 * ```typescript
 * const target = document.getElementById("editor");
 * const editor = createEditor(target, "# Hello World");
 * if (editor) {
 *   console.log("Editor created successfully");
 * }
 * ```
 */
export function createEditor(
  target: HTMLElement,
  initialDoc: string = ""
): EditorView | null {
  try {
    // Verify target element exists and is in the DOM
    if (!target || !target.parentElement) {
      console.error("Editor target element not found or not in DOM");
      return null;
    }

    // Create editor state with initial document and extensions
    const extensions = buildExtensions();
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [basicSetup, ...extensions],
    });

    // Create and mount the editor view
    const view = new EditorView({
      state,
      parent: target,
    });

    return view;
  } catch (error) {
    console.error("Failed to create editor:", error);
    return null;
  }
}

/**
 * Get the current content from an editor.
 *
 * @param editor - EditorView instance
 * @returns Current document content as string
 *
 * @example
 * ```typescript
 * const content = getEditorContent(editor);
 * console.log(content);
 * ```
 */
export function getEditorContent(editor: EditorView): string {
  return editor.state.doc.toString();
}

/**
 * Set content in an editor, replacing existing content.
 *
 * @param editor - EditorView instance
 * @param content - New content to set
 *
 * @example
 * ```typescript
 * setEditorContent(editor, "# New Content");
 * ```
 */
export function setEditorContent(editor: EditorView, content: string): void {
  const transaction = editor.state.update({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: content,
    },
  });
  editor.dispatch(transaction);
}
