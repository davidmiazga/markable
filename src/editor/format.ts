/**
 * Markdown formatting commands for the editor.
 *
 * Each function takes an EditorView and applies a markdown formatting
 * transformation to the current selection or cursor line.
 */

import { EditorView, type KeyBinding } from "@codemirror/view";
import { EditorSelection, Prec } from "@codemirror/state";
import { marked } from "marked";
import { readClipboardText } from "../lib/bridge";

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
    const lastLineNum = state.doc.lineAt(state.selection.main.to).number;
    view.dispatch({ changes });
    const newEnd = view.state.doc.line(lastLineNum).to;
    view.dispatch({ selection: { anchor: newEnd } });
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
    const lastLineNum = state.doc.lineAt(state.selection.main.to).number;
    view.dispatch({ changes });
    const newEnd = view.state.doc.line(lastLineNum).to;
    view.dispatch({ selection: { anchor: newEnd } });
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
    const lastLineNum = state.doc.lineAt(state.selection.main.to).number;
    view.dispatch({ changes });
    const newEnd = view.state.doc.line(lastLineNum).to;
    view.dispatch({ selection: { anchor: newEnd } });
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
    const lastLineNum = state.doc.lineAt(state.selection.main.to).number;
    view.dispatch({ changes });
    const newEnd = view.state.doc.line(lastLineNum).to;
    view.dispatch({ selection: { anchor: newEnd } });
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

/** Insert a horizontal rule with correct blank-line separation. */
export function insertHorizontalRule(view: EditorView) {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.from);

  let pos: number;
  let insert: string;

  if (line.text.trim() !== "") {
    // Cursor on a line with content — split at cursor, blank line before ---
    pos = state.selection.main.from;
    insert = "\n\n---\n";
  } else {
    // Cursor on empty line — check previous line
    const prevHasContent = line.number > 1 && state.doc.line(line.number - 1).text.trim() !== "";
    pos = line.from;
    insert = prevHasContent ? "\n---\n" : "---\n";
  }

  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
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

/**
 * Insert a Markdown link at the cursor or wrap the current selection.
 *
 * Reads the clipboard asynchronously and covers four cases:
 *   - selection + valid URL  → [selection](url)     cursor placed after ')'
 *   - selection + no URL     → [selection]()         cursor placed between '()'
 *   - no selection + valid URL → [](url)             cursor placed between '[]'
 *   - no selection + no URL    → []()                cursor placed between '[]'
 *
 * URL validity test: /^https?:\/\/\S+/ applied to the trimmed clipboard string.
 * On clipboard read failure: falls back to the "no URL" path; logs console.warn.
 * No alert or modal is shown for clipboard errors (EC-L1).
 *
 * @param view - The active CodeMirror EditorView.
 * @returns Promise that resolves after the transaction is dispatched.
 */
export async function insertLink(view: EditorView): Promise<void> {
  let url = "";
  try {
    const raw = await navigator.clipboard.readText();
    const trimmed = raw.trim();
    // Only accept the clipboard content as a URL if it matches the regex (EC-L5).
    if (URL_RE.test(trimmed)) {
      url = trimmed;
    }
  } catch (err) {
    // EC-L1: clipboard permission denied or API unavailable — fall through to
    // the no-URL path without alerting the user.
    console.warn("insertLink: clipboard read failed, using empty URL", err);
  }

  const state = view.state;
  const { from, to } = state.selection.main;
  const hasSelection = from !== to;

  if (hasSelection) {
    const label = state.doc.sliceString(from, to);
    if (url) {
      // AC-L1: selection + valid URL → [label](url), cursor after ')'
      view.dispatch({
        changes: { from, to, insert: `[${label}](${url})` },
        selection: { anchor: from + label.length + url.length + 4 },
      });
    } else {
      // AC-L2: selection + no valid URL → [label](), cursor between '()'
      const insert = `[${label}]()`;
      view.dispatch({
        changes: { from, to, insert },
        // Position the cursor between the parentheses (one character before the closing ')')
        selection: { anchor: from + insert.length - 1 },
      });
    }
  } else {
    if (url) {
      // AC-L3: no selection + valid URL → [](url), cursor between '[]'
      const insert = `[](${url})`;
      view.dispatch({
        changes: { from, to, insert },
        // Position the cursor between the square brackets (one character after '[')
        selection: { anchor: from + 1 },
      });
    } else {
      // AC-L4: no selection + no valid URL → [](), cursor between '[]'
      view.dispatch({
        changes: { from, to, insert: `[]()` },
        selection: { anchor: from + 1 },
      });
    }
  }

  view.focus();
}

/** Insert an image scaffold ![]() at cursor, or wrap selection as alt text. */
export function insertImage(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    const alt = view.state.doc.sliceString(from, to);
    const insert = `![${alt}]()`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length - 1 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: `![]()` },
      selection: { anchor: from + 2 },
    });
  }
  view.focus();
}

/** Insert a 3-column Markdown table template, cursor at first data cell. */
export function insertTable(view: EditorView): void {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.from);
  const prefix = line.text.trim() === "" ? "" : "\n\n";
  const table = `${prefix}| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |\n`;
  const cursorPos = line.to + prefix.length + table.indexOf("| |") + 2;
  view.dispatch({
    changes: { from: line.to, to: line.to, insert: table },
    selection: { anchor: cursorPos },
  });
  view.focus();
}

/**
 * Paste plain text from clipboard, ignoring any rich-text (HTML/RTF) data.
 * Standard macOS "Paste and Match Style" equivalent (Cmd-Shift-V).
 */
export function pasteWithoutFormatting(view: EditorView): void {
  readClipboardText().then((text) => {
    if (!text) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
      userEvent: "input.paste",
      scrollIntoView: true,
    });
    view.focus();
  });
}

/** URL regex shared by insertLink and pasteURLHandler. */
const URL_RE = /^https?:\/\/\S+/;

/**
 * CM6 paste interceptor at highest priority.
 *
 * Must run BEFORE CM6's built-in paste handler (which calls doPaste()
 * and would overwrite our transaction). Prec.highest ensures this.
 * preventDefault() stops CM6's handler from also firing.
 */
export const pasteURLHandler = Prec.highest(
  EditorView.domEventHandlers({
    paste(event: ClipboardEvent, view: EditorView) {
      const data = event.clipboardData;
      if (!data) return false;
      const text = (data.getData("text/plain") || "").trim();
      if (!URL_RE.test(text)) return false;

      const { from, to } = view.state.selection.main;
      if (from === to) return false;

      event.preventDefault();
      const label = view.state.doc.sliceString(from, to);
      const inserted = `[${label}](${text})`;
      const endPos = from + inserted.length;

      view.dispatch({
        changes: { from, to, insert: inserted },
        selection: EditorSelection.cursor(endPos),
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    },
  })
);

/**
 * Move the line(s) covered by the primary selection one position upward.
 *
 * Operates on selection.main only, consistent with toggleOrderedList.
 * A multi-line selection is moved as a single block — all lines between
 * lineAt(main.from) and lineAt(main.to) inclusive swap with the single
 * line immediately above the block.
 *
 * Implementation note: ranges use [line.from .. line.to] (exclusive of the
 * trailing '\n') so that the newline separator characters remain in place and
 * no newlines are gained or lost (EC-M7).
 *
 * @param view - The active CodeMirror EditorView.
 */
export function moveLineUp(view: EditorView): void {
  const state = view.state;
  const main = state.selection.main;

  const firstLine = state.doc.lineAt(main.from);
  const lastLine  = state.doc.lineAt(main.to);

  // EC-M1 / EC-M3 / EC-M5: no-op when the block starts at the first line.
  if (firstLine.number === 1) return;

  const aboveLine = state.doc.line(firstLine.number - 1);
  // Extract text content only — newlines are NOT included in the sliced range.
  const aboveText = state.doc.sliceString(aboveLine.from, aboveLine.to);
  const blockText = state.doc.sliceString(firstLine.from, lastLine.to);

  // Preserve the caret's visual offset within the moved block.
  // Offsets are computed from main.from (Math.min(anchor, head)) rather than
  // firstLine.from so that backward selections — where main.anchor sits on the
  // LAST selected line and its raw offset would exceed the block length — still
  // produce correct post-move positions (EC-M3 backward-selection fix).
  const anchorOffUp = main.anchor - main.from;
  const headOffUp   = main.head   - main.from;

  // Single transaction: replace aboveLine's text with blockText, and the
  // block's text with aboveText. The '\n' between lines stays untouched.
  view.dispatch({
    changes: [
      { from: aboveLine.from, to: aboveLine.to, insert: blockText },
      { from: firstLine.from, to: lastLine.to,  insert: aboveText },
    ],
    selection: {
      anchor: aboveLine.from + anchorOffUp,
      head:   aboveLine.from + headOffUp,
    },
  });

  view.focus();
}

/**
 * Move the line(s) covered by the primary selection one position downward.
 *
 * Mirror of moveLineUp. Operates on selection.main only.
 * No-op if the last selected line is already the last line of the document.
 *
 * After the swap, the block now starts at firstLine.from + belowText.length + 1
 * (the +1 accounts for the '\n' that separates what was the below-line from the
 * moved block).
 *
 * @param view - The active CodeMirror EditorView.
 */
export function moveLineDown(view: EditorView): void {
  const state = view.state;
  const main = state.selection.main;

  const firstLine = state.doc.lineAt(main.from);
  const lastLine  = state.doc.lineAt(main.to);

  // EC-M2 / EC-M4 / EC-M5: no-op when the block ends at the last line.
  if (lastLine.number === state.doc.lines) return;

  const belowLine = state.doc.line(lastLine.number + 1);
  const belowText = state.doc.sliceString(belowLine.from, belowLine.to);
  const blockText = state.doc.sliceString(firstLine.from, lastLine.to);

  // After the swap the block occupies positions starting at:
  //   firstLine.from + belowText.length + 1
  // (+1 for the '\n' between the former below-line and the moved block).
  const newBlockStart = firstLine.from + belowText.length + 1;

  // Offsets are computed from main.from rather than firstLine.from for the
  // same backward-selection reason documented in moveLineUp (EC-M3 fix).
  const anchorOffDown = main.anchor - main.from;
  const headOffDown   = main.head   - main.from;

  view.dispatch({
    changes: [
      { from: firstLine.from, to: lastLine.to,  insert: belowText },
      { from: belowLine.from, to: belowLine.to, insert: blockText },
    ],
    selection: {
      anchor: newBlockStart + anchorOffDown,
      head:   newBlockStart + headOffDown,
    },
  });

  view.focus();
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
  { key: "Meta->", mac: "Meta->", run: (v) => { toggleLinePrefix(v, "> "); return true; } },
  { key: "Meta-Shift--", mac: "Meta-Shift--", run: (v) => { toggleLinePrefix(v, "- "); return true; } },
  { key: "Meta-Shift-1", mac: "Meta-Shift-1", run: (v) => { toggleOrderedList(v); return true; } },
  { key: "Meta-Shift-;", mac: "Meta-Shift-;", run: (v) => { toggleTaskList(v); return true; } },
  { key: "Meta-]", mac: "Meta-]", run: (v) => { indentLines(v); return true; } },
  { key: "Meta-[", mac: "Meta-[", run: (v) => { outdentLines(v); return true; } },
  { key: "Meta-Shift-r", mac: "Meta-Shift-r", run: (v) => { insertHorizontalRule(v); return true; } },
  { key: "Meta-Shift-\\", mac: "Meta-Shift-\\", run: (v) => { clearFormatting(v); return true; } },
  // Cmd-K: wrap selection with [](), cursor between parens for URL paste.
  { key: "Meta-k", mac: "Meta-k", run: (v) => {
    const { from, to } = v.state.selection.main;
    if (from !== to) {
      const label = v.state.doc.sliceString(from, to);
      const insert = `[${label}]()`;
      v.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length - 1 },
      });
    } else {
      v.dispatch({
        changes: { from, to, insert: `[]()` },
        selection: { anchor: from + 1 },
      });
    }
    return true;
  }},
  // AC-M1/AC-M2: Opt-Up/Down move the selected line block up or down one line.
  { key: "Alt-ArrowUp",   mac: "Alt-ArrowUp",   run: (v) => { moveLineUp(v);   return true; } },
  { key: "Alt-ArrowDown", mac: "Alt-ArrowDown",  run: (v) => { moveLineDown(v); return true; } },
  // Cmd-Shift-I: insert image scaffold. Cmd-Shift-T: insert table.
  { key: "Meta-Shift-i", mac: "Meta-Shift-i", run: (v) => { insertImage(v); return true; } },
  { key: "Meta-Shift-t", mac: "Meta-Shift-t", run: (v) => { insertTable(v); return true; } },
  // Cmd-Shift-V: paste without formatting (plain text only, ignores HTML/RTF).
  { key: "Meta-Alt-v", mac: "Meta-Alt-v", run: (v) => { pasteWithoutFormatting(v); return true; } },
  // Cmd-Alt-C: copy as HTML; Cmd-Alt-T: copy as plain text.
  { key: "Meta-Alt-c", mac: "Meta-Alt-c", run: (v) => { copyAsHtml(v); return true; } },
  { key: "Meta-Alt-t", mac: "Meta-Alt-t", run: (v) => { copyAsPlainText(v); return true; } },
  // Superscript (^), Subscript (~), Inline Math ($), Block Math ($$).
  { key: "Meta-Shift-6", mac: "Meta-Shift-6", run: (v) => { toggleInlineWrap(v, "^"); return true; } },
  { key: "Meta-Shift-9", mac: "Meta-Shift-9", run: (v) => { toggleInlineWrap(v, "~"); return true; } },
  { key: "Meta-Shift-m", mac: "Meta-Shift-m", run: (v) => { insertInlineMath(v); return true; } },
  // YAML front matter.
  { key: "Meta-Shift-f", mac: "Meta-Shift-f", run: (v) => { insertFrontMatter(v); return true; } },
];

/**
 * Copy selected text (or full document if no selection) as plain text.
 * Converts Markdown → HTML via marked, then strips tags via DOM textContent.
 */
export function copyAsPlainText(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const markdown = from === to
    ? view.state.doc.toString()
    : view.state.doc.sliceString(from, to);
  const html = marked.parse(markdown) as string;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const plain = (tmp.textContent ?? tmp.innerText ?? "").trim();
  navigator.clipboard.writeText(plain).catch((err) => {
    console.warn("copyAsPlainText: clipboard write failed", err);
  });
}

/**
 * Copy selected text (or full document if no selection) as rendered HTML.
 * Uses marked for Markdown → HTML conversion.
 */
export function copyAsHtml(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const markdown = from === to
    ? view.state.doc.toString()
    : view.state.doc.sliceString(from, to);
  const html = marked.parse(markdown) as string;
  navigator.clipboard.writeText(html).catch((err) => {
    console.warn("copyAsHtml: clipboard write failed", err);
  });
}

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

/** Wrap selection (or cursor) with inline math: $...$. Cursor placed inside. */
export function insertInlineMath(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    const sel = view.state.doc.sliceString(from, to);
    const insert = `$${sel}$`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length - 1 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: "$$" },
      selection: { anchor: from + 1 },
    });
  }
  view.focus();
}

/** Insert a block math fence: $$\n\n$$. Cursor placed on inner blank line. */
export function insertMathBlock(view: EditorView): void {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const onEmpty = line.text.trim() === "";
  const insert = onEmpty ? "$$\n\n$$\n" : "\n$$\n\n$$\n";
  const pos = onEmpty ? line.from : from;
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.indexOf("\n") + 1 },
  });
  view.focus();
}

/**
 * Insert a YAML front matter block at the top of the document.
 * If front matter already exists, moves the cursor to the first content line inside it.
 */
export function insertFrontMatter(view: EditorView): void {
  const state = view.state;

  // If front matter already present, move cursor inside it.
  if (state.doc.lines >= 1 && state.doc.line(1).text === "---") {
    for (let i = 2; i <= state.doc.lines; i++) {
      const t = state.doc.line(i).text;
      if (t === "---" || t === "...") {
        const inside = state.doc.line(Math.min(2, i - 1));
        view.dispatch({ selection: { anchor: inside.from } });
        view.focus();
        return;
      }
    }
  }

  // Prepend front matter; cursor lands on the blank content line.
  view.dispatch({
    changes: { from: 0, to: 0, insert: "---\n\n---\n" },
    selection: { anchor: 4 }, // position of line 2 (after "---\n")
  });
  view.focus();
}
