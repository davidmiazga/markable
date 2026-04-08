/**
 * Markdown formatting commands for the editor.
 *
 * Each function takes an EditorView and applies a markdown formatting
 * transformation to the current selection or cursor line.
 */

import { EditorView, type KeyBinding } from "@codemirror/view";

/**
 * Toggle a heading level on the current line(s).
 * If the line already has that heading level, remove it.
 * If the line has a different heading level, replace it.
 */
export function toggleHeading(view: EditorView, level: number) {
  const prefix = "#".repeat(level) + " ";
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const lineStart = state.doc.lineAt(range.from);
    const lineEnd = state.doc.lineAt(range.to);

    for (let i = lineStart.number; i <= lineEnd.number; i++) {
      const line = state.doc.line(i);
      const text = line.text;
      const match = text.match(/^(#{1,6})\s/);

      if (match && match[1].length === level) {
        // Same level — remove heading
        changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
      } else if (match) {
        // Different level — replace prefix
        changes.push({ from: line.from, to: line.from + match[0].length, insert: prefix });
      } else {
        // No heading — add prefix
        changes.push({ from: line.from, to: line.from, insert: prefix });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}

/**
 * Toggle an inline wrap marker (e.g., ** for bold, * for italic).
 * If selection is wrapped, unwrap it. Otherwise, wrap it.
 * If no selection, insert the markers and place cursor between them.
 */
export function toggleInlineWrap(view: EditorView, marker: string) {
  const state = view.state;
  const len = marker.length;

  for (const range of state.selection.ranges) {
    const from = range.from;
    const to = range.to;

    // Check if markers exist around the selection/cursor
    const outerFrom = Math.max(0, from - len);
    const outerTo = Math.min(state.doc.length, to + len);
    const before = state.doc.sliceString(outerFrom, from);
    const after = state.doc.sliceString(to, outerTo);
    const isWrapped = before === marker && after === marker;

    if (isWrapped) {
      // Unwrap — remove markers around selection/cursor
      view.dispatch({
        changes: [
          { from: outerFrom, to: from, insert: "" },
          { from: to, to: outerTo, insert: "" },
        ],
        selection: from === to
          ? { anchor: outerFrom }
          : { anchor: outerFrom, head: outerFrom + (to - from) },
      });
    } else if (from === to) {
      // No selection, not wrapped — insert marker pair, cursor between
      view.dispatch({
        changes: { from, to, insert: marker + marker },
        selection: { anchor: from + len },
      });
    } else {
      // Has selection, not wrapped — wrap it
      view.dispatch({
        changes: [
          { from, to: from, insert: marker },
          { from: to, to, insert: marker },
        ],
        selection: { anchor: from + len, head: to + len },
      });
    }
  }

  view.focus();
}

/**
 * Toggle a line prefix (e.g., "> " for quote, "- " for bullet list).
 * If the line already has the prefix, remove it. Otherwise, add it.
 */
export function toggleLinePrefix(view: EditorView, prefix: string) {
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const lineStart = state.doc.lineAt(range.from);
    const lineEnd = state.doc.lineAt(range.to);

    for (let i = lineStart.number; i <= lineEnd.number; i++) {
      const line = state.doc.line(i);
      if (line.text.startsWith(prefix)) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
      } else {
        changes.push({ from: line.from, to: line.from, insert: prefix });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}

/**
 * Toggle ordered list on current line(s).
 * If lines already have "1. " etc., remove numbering. Otherwise, add it.
 */
export function toggleOrderedList(view: EditorView) {
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];
  const lineStart = state.doc.lineAt(state.selection.main.from);
  const lineEnd = state.doc.lineAt(state.selection.main.to);

  let allOrdered = true;
  for (let i = lineStart.number; i <= lineEnd.number; i++) {
    if (!state.doc.line(i).text.match(/^\d+\.\s/)) {
      allOrdered = false;
      break;
    }
  }

  let num = 1;
  for (let i = lineStart.number; i <= lineEnd.number; i++) {
    const line = state.doc.line(i);
    const match = line.text.match(/^(\d+\.\s)/);

    if (allOrdered && match) {
      changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    } else if (!allOrdered) {
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: `${num}. ` });
      } else {
        changes.push({ from: line.from, to: line.from, insert: `${num}. ` });
      }
      num++;
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}

/**
 * Toggle task list on current line(s).
 * Cycles: plain → "- [ ] " → "- [x] " → plain
 */
export function toggleTaskList(view: EditorView) {
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const lineStart = state.doc.lineAt(range.from);
    const lineEnd = state.doc.lineAt(range.to);

    for (let i = lineStart.number; i <= lineEnd.number; i++) {
      const line = state.doc.line(i);
      const text = line.text;

      if (text.startsWith("- [x] ") || text.startsWith("- [X] ")) {
        // Checked → remove task
        changes.push({ from: line.from, to: line.from + 6, insert: "" });
      } else if (text.startsWith("- [ ] ")) {
        // Unchecked → check
        changes.push({ from: line.from, to: line.from + 6, insert: "- [x] " });
      } else {
        // Plain → unchecked task
        changes.push({ from: line.from, to: line.from, insert: "- [ ] " });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}

/** Insert a code fence block at cursor or wrap selection. */
export function insertCodeFence(view: EditorView) {
  const state = view.state;
  const { from, to } = state.selection.main;

  if (from === to) {
    const fence = "```\n\n```";
    view.dispatch({
      changes: { from, to, insert: fence },
      selection: { anchor: from + 4 },
    });
  } else {
    const selected = state.doc.sliceString(from, to);
    const wrapped = "```\n" + selected + "\n```";
    view.dispatch({
      changes: { from, to, insert: wrapped },
    });
  }
  view.focus();
}

/** Insert a horizontal rule below the current line. */
export function insertHorizontalRule(view: EditorView) {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.from);
  const insert = "\n\n---\n\n";
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: { anchor: line.to + insert.length },
  });
  view.focus();
}

/** Indent selected lines by 2 spaces. */
export function indentLines(view: EditorView) {
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const lineStart = state.doc.lineAt(range.from);
    const lineEnd = state.doc.lineAt(range.to);
    for (let i = lineStart.number; i <= lineEnd.number; i++) {
      const line = state.doc.line(i);
      changes.push({ from: line.from, to: line.from, insert: "  " });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}

/** Outdent selected lines by up to 2 spaces. */
export function outdentLines(view: EditorView) {
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const lineStart = state.doc.lineAt(range.from);
    const lineEnd = state.doc.lineAt(range.to);
    for (let i = lineStart.number; i <= lineEnd.number; i++) {
      const line = state.doc.line(i);
      const match = line.text.match(/^( {1,2})/);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[1].length, insert: "" });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}

/** CodeMirror keybindings for all formatting commands (macOS). */
export const formatKeymap: KeyBinding[] = [
  { key: "Meta-1", mac: "Meta-1", run: (v) => { toggleHeading(v, 1); return true; } },
  { key: "Meta-2", mac: "Meta-2", run: (v) => { toggleHeading(v, 2); return true; } },
  { key: "Meta-3", mac: "Meta-3", run: (v) => { toggleHeading(v, 3); return true; } },
  { key: "Meta-4", mac: "Meta-4", run: (v) => { toggleHeading(v, 4); return true; } },
  { key: "Meta-5", mac: "Meta-5", run: (v) => { toggleHeading(v, 5); return true; } },
  { key: "Meta-6", mac: "Meta-6", run: (v) => { toggleHeading(v, 6); return true; } },
  { key: "Meta-b", mac: "Meta-b", run: (v) => { toggleInlineWrap(v, "**"); return true; } },
  { key: "Meta-i", mac: "Meta-i", run: (v) => { toggleInlineWrap(v, "*"); return true; } },
  { key: "Meta-u", mac: "Meta-u", run: (v) => { toggleInlineWrap(v, "__"); return true; } },
  { key: "Meta-Shift-x", mac: "Meta-Shift-x", run: (v) => { toggleInlineWrap(v, "~~"); return true; } },
  { key: "Meta-Shift-h", mac: "Meta-Shift-h", run: (v) => { toggleInlineWrap(v, "=="); return true; } },
  { key: "Meta-Shift-c", mac: "Meta-Shift-c", run: (v) => { insertCodeFence(v); return true; } },
  { key: "Meta-Shift-.", mac: "Meta-Shift-.", run: (v) => { toggleLinePrefix(v, "> "); return true; } },
  { key: "Meta-Shift-l", mac: "Meta-Shift-l", run: (v) => { toggleLinePrefix(v, "- "); return true; } },
  { key: "Meta-Shift-o", mac: "Meta-Shift-o", run: (v) => { toggleOrderedList(v); return true; } },
  { key: "Meta-Shift-t", mac: "Meta-Shift-t", run: (v) => { toggleTaskList(v); return true; } },
  { key: "Meta-]", mac: "Meta-]", run: (v) => { indentLines(v); return true; } },
  { key: "Meta-[", mac: "Meta-[", run: (v) => { outdentLines(v); return true; } },
  { key: "Meta-Shift-r", mac: "Meta-Shift-r", run: (v) => { insertHorizontalRule(v); return true; } },
  { key: "Meta-Shift-\\", mac: "Meta-Shift-\\", run: (v) => { clearFormatting(v); return true; } },
];

/** Remove all markdown formatting from selected lines. */
export function clearFormatting(view: EditorView) {
  const state = view.state;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const lineStart = state.doc.lineAt(range.from);
    const lineEnd = state.doc.lineAt(range.to);

    for (let i = lineStart.number; i <= lineEnd.number; i++) {
      const line = state.doc.line(i);
      let text = line.text;

      // Remove heading prefix
      text = text.replace(/^#{1,6}\s/, "");
      // Remove blockquote prefix
      text = text.replace(/^>\s/, "");
      // Remove list prefixes
      text = text.replace(/^[-*+]\s(\[[ xX]\]\s)?/, "");
      text = text.replace(/^\d+\.\s/, "");
      // Remove inline markers
      text = text.replace(/\*\*(.+?)\*\*/g, "$1");
      text = text.replace(/\*(.+?)\*/g, "$1");
      text = text.replace(/~~(.+?)~~/g, "$1");
      text = text.replace(/==(.+?)==/g, "$1");
      text = text.replace(/`(.+?)`/g, "$1");

      if (text !== line.text) {
        changes.push({ from: line.from, to: line.to, insert: text });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
  }
}
