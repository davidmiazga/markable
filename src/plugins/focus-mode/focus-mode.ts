/**
 * Focus Mode — iA Writer-style paragraph dimming.
 *
 * Dims all lines except the paragraph/block containing the cursor.
 * A "paragraph" is defined as contiguous non-blank lines. Code fences,
 * blockquotes, and list items are treated as single blocks.
 *
 * The extension is always registered. When disabled (default), it does nothing.
 * Toggle via the `setFocusMode` StateEffect.
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

// --- Effect to toggle focus mode on/off ---

export const setFocusMode = StateEffect.define<boolean>();

// --- StateField: tracks whether focus mode is enabled ---

export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFocusMode)) return e.value;
    }
    return value;
  },
});

// --- Paragraph boundary detection ---

/**
 * Find the line range (from, to) of the paragraph/block containing `pos`.
 * A paragraph is a contiguous group of non-blank lines.
 */
function findParagraphRange(
  state: EditorState,
  pos: number,
): { from: number; to: number } {
  const doc = state.doc;
  const curLine = doc.lineAt(pos);

  // Walk backward to find the first line of the paragraph
  let startLine = curLine.number;
  while (startLine > 1) {
    const prev = doc.line(startLine - 1);
    if (prev.text.trim() === "") break;
    startLine--;
  }

  // Walk forward to find the last line of the paragraph
  let endLine = curLine.number;
  const totalLines = doc.lines;
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

// --- Decoration ---

const dimmedLine = Decoration.line({ class: "cm-focus-dimmed" });

// --- ViewPlugin: applies dimmed decoration to non-active lines ---

const focusModePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
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

      // Find active paragraph range from the primary selection head
      const head = view.state.selection.main.head;
      const { from: paraFrom, to: paraTo } = findParagraphRange(
        view.state,
        head,
      );

      const builder: { from: number; value: Decoration }[] = [];
      const doc = view.state.doc;

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        // Skip lines inside the active paragraph
        if (line.from >= paraFrom && line.to <= paraTo) continue;
        builder.push({ from: line.from, value: dimmedLine });
      }

      return Decoration.set(builder.map((d) => d.value.range(d.from)));
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// --- Public extension ---

export const focusModeExtension: Extension = [focusModeField, focusModePlugin];
