/**
 * List Keybindings — CM6 keymap for Enter, Tab, Shift-Tab, Backspace in lists.
 *
 * Registered at Prec.highest so it runs before all other handlers.
 * Only intercepts keypresses when the cursor is on a list line.
 * Non-list lines fall through to default CM6 behavior.
 */

import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  detectListLine,
  incrementMarker,
  inferListStyle,
  firstMarkerForDepth,
  findListBlockRange,
  type ListStyle,
} from "./list-engine";
import { getCurrentSettings } from "../lib/settings";

// --- Helpers ---

/** Get the full text of the line containing the primary cursor head. */
function getCurrentLine(view: EditorView): { text: string; from: number; to: number; number: number } {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return { text: line.text, from: line.from, to: line.to, number: line.number };
}

/** Get all lines in the document as an array of strings (0-indexed). */
function getDocLines(view: EditorView): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= view.state.doc.lines; i++) {
    lines.push(view.state.doc.line(i).text);
  }
  return lines;
}

/** Get the global fallback list style from settings. */
function getGlobalListStyle(): ListStyle {
  return (getCurrentSettings().listStyle as ListStyle) ?? "standard";
}

/** Infer the list style for the block containing the given line index (0-based). */
function inferStyleForLine(view: EditorView, lineIndex: number): ListStyle {
  const docLines = getDocLines(view);
  const block = findListBlockRange(docLines, lineIndex);
  if (!block) return getGlobalListStyle();
  const blockLines = docLines.slice(block.start, block.end + 1);
  const precedingLine = block.start > 0 ? docLines[block.start - 1] : null;
  return inferListStyle(blockLines, precedingLine, getGlobalListStyle());
}

// --- Enter handler ---

function handleEnter(view: EditorView): boolean {
  const line = getCurrentLine(view);
  const info = detectListLine(line.text);
  if (!info) return false; // Not a list line — let default handle it

  // If the line content after the marker is empty, remove the marker (exit list)
  if (info.content.trim() === "") {
    if (info.depth > 0) {
      // Outdent: remove marker, keep reduced indent
      const newIndent = "  ".repeat(info.depth - 1);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: newIndent },
        selection: { anchor: line.from + newIndent.length },
      });
    } else {
      // At depth 0: clear the line entirely
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
      });
    }
    return true;
  }

  // Generate the next marker
  const nextMark = incrementMarker(info);
  const newLineText = info.indent + nextMark;

  // Insert newline + indent + next marker at cursor position
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: "\n" + newLineText },
    selection: { anchor: pos + 1 + newLineText.length },
  });

  return true;
}

// --- Tab handler ---

function handleTab(view: EditorView): boolean {
  const line = getCurrentLine(view);
  const info = detectListLine(line.text);
  if (!info) return false; // Not a list line

  // Infer the list style for this block
  const style = inferStyleForLine(view, line.number - 1);
  const newDepth = info.depth + 1;

  // Generate the new marker for the deeper depth
  const newMarker = firstMarkerForDepth(style, newDepth);
  const newIndent = info.indent + "  ";

  // Replace the entire line (indent + marker + content) with new version
  const newLine = newIndent + newMarker + info.content;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
    selection: { anchor: line.from + newIndent.length + newMarker.length + info.content.length },
  });

  return true;
}

// --- Shift-Tab handler ---

function handleShiftTab(view: EditorView): boolean {
  const line = getCurrentLine(view);
  const info = detectListLine(line.text);
  if (!info) return false;

  // Can't outdent at depth 0
  if (info.depth === 0) return false;

  // Infer the list style for this block
  const style = inferStyleForLine(view, line.number - 1);
  const newDepth = info.depth - 1;

  // Generate the new marker for the shallower depth
  const newMarker = firstMarkerForDepth(style, newDepth);
  const spacesToRemove = Math.min(2, info.indent.length);
  const newIndent = info.indent.slice(spacesToRemove);

  // Replace the entire line
  const newLine = newIndent + newMarker + info.content;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
    selection: { anchor: line.from + newIndent.length + newMarker.length + info.content.length },
  });

  return true;
}

// --- Backspace handler ---

function handleBackspace(view: EditorView): boolean {
  const line = getCurrentLine(view);
  const info = detectListLine(line.text);
  if (!info) return false;

  // Only intercept if cursor is right at the end of the marker (start of content)
  const pos = view.state.selection.main.head;
  const markerEnd = line.from + info.indent.length + info.marker.length;

  // If content is empty and cursor is at marker end, remove the marker
  if (info.content.trim() === "" && pos === markerEnd) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
    });
    return true;
  }

  return false; // Let default backspace handle other cases
}

// --- Public keymap extension ---

export const listKeymap: Extension = Prec.highest(
  keymap.of([
    { key: "Enter", run: handleEnter },
    { key: "Tab", run: handleTab },
    { key: "Shift-Tab", run: handleShiftTab },
    { key: "Backspace", run: handleBackspace },
  ]),
);
