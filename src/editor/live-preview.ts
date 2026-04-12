import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorState, Range, StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { marked } from "marked";
import { convertFileSrc } from "@tauri-apps/api/core";

// --- View Mode: all lines render in preview (no active line) ---
// Entering view mode: dispatch setViewMode.of(true)
// Exiting view mode: any selection change (click, arrow keys) auto-exits

/** Effect to enter or exit view mode. */
export const setViewMode = StateEffect.define<boolean>();

/** True = all lines in preview (no active/editable line). */
export const viewModeField = StateField.define<boolean>({
  create() { return false; },
  update(value, tr) {
    // Check for explicit view mode toggle first
    let explicitSet = false;
    for (const e of tr.effects) {
      if (e.is(setViewMode)) { value = e.value; explicitSet = true; }
    }
    if (explicitSet) return value;
    // Any user-initiated selection change exits view mode
    if (value && tr.selection) return false;
    return value;
  },
});

/** Current file path — set by main.ts so image widgets can resolve relative paths. */
let _currentFilePath: string | null = null;
export function setLivePreviewFilePath(path: string | null) { _currentFilePath = path; }

function resolveImageSrc(src: string): string {
  // Already a URL (http, https, data)
  if (/^(https?:|data:)/.test(src)) return src;
  // Absolute path
  if (src.startsWith("/")) return convertFileSrc(src);
  // Relative path — resolve against current file's directory
  if (_currentFilePath) {
    const dir = _currentFilePath.replace(/\/[^/]*$/, "");
    return convertFileSrc(`${dir}/${src}`);
  }
  return src;
}

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean) {
    super();
  }

  toDOM(): HTMLElement {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = this.checked;
    cb.className = "cm-live-checkbox";
    cb.disabled = true;
    return cb;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-live-hr";
    return hr;
  }

  eq(): boolean {
    return true;
  }
}



class CalloutTitleWidget extends WidgetType {
  constructor(private title: string) { super(); }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-callout-title";
    span.textContent = this.title;
    return span;
  }

  eq(other: CalloutTitleWidget): boolean { return this.title === other.title; }
}

class ImageWidget extends WidgetType {
  constructor(private src: string, private alt: string, private width?: number, private height?: number) {
    super();
  }

  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = resolveImageSrc(this.src);
    img.alt = this.alt;
    img.className = "cm-live-image";
    if (this.width) img.style.width = `${this.width}px`;
    if (this.height) img.style.height = `${this.height}px`;
    if (this.width && !this.height) img.style.height = "auto";
    return img;
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt &&
           this.width === other.width && this.height === other.height;
  }

  ignoreEvent(): boolean { return true; }
}

function handleImage(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return;

  let alt = "";
  let url = "";

  do {
    if (cursor.name === "URL") {
      url = state.doc.sliceString(cursor.from, cursor.to);
    }
  } while (cursor.nextSibling());

  // Extract alt text from between ! [ and ]
  const fullText = state.doc.sliceString(node.from, node.to);
  const altMatch = fullText.match(/^!\[([^\]]*)\]/);
  if (altMatch) alt = altMatch[1];

  if (!url) return;

  // Parse optional dimensions from alt text: "alt|100x200" or "alt|100"
  // Tolerates optional spaces around | and accepts both x and × (Unicode multiply)
  let cleanAlt = alt;
  let width: number | undefined;
  let height: number | undefined;
  const dimMatch = alt.match(/^(.*?)\s*\|\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*$/);
  if (dimMatch) {
    cleanAlt = dimMatch[1].trim();
    width = parseInt(dimMatch[2], 10);
    if (dimMatch[3]) height = parseInt(dimMatch[3], 10);
  }

  decorations.push(
    Decoration.replace({
      widget: new ImageWidget(url, cleanAlt, width, height),
    }).range(node.from, node.to)
  );
}

class TableWidget extends WidgetType {
  constructor(private markdown: string) {
    super();
  }

  toDOM(): HTMLElement {
    const lines = this.markdown.split("\n").filter((l) => l.trim().length > 0);
    const isDelim = (line: string) => /^[\|\s:\-]+$/.test(line.trim());
    const parseCells = (line: string): string[] => {
      const parts = line.split("|");
      if (parts[0].trim() === "") parts.shift();
      if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
      return parts;
    };

    const table = document.createElement("table");
    table.className = "cm-live-table";
    let thead: HTMLTableSectionElement | null = null;
    let tbody: HTMLTableSectionElement | null = null;
    let inHeader = true;

    for (const line of lines) {
      if (isDelim(line)) { inHeader = false; continue; }
      const cells = parseCells(line);
      const tr = document.createElement("tr");
      for (const cell of cells) {
        const td = inHeader ? document.createElement("th") : document.createElement("td");
        td.innerHTML = marked.parseInline(cell.trim()) as string;
        tr.appendChild(td);
      }
      if (inHeader) {
        if (!thead) { thead = document.createElement("thead"); table.appendChild(thead); }
        thead.appendChild(tr);
      } else {
        if (!tbody) { tbody = document.createElement("tbody"); table.appendChild(tbody); }
        tbody.appendChild(tr);
      }
    }
    return table;
  }

  eq(other: TableWidget): boolean {
    return this.markdown === other.markdown;
  }

  ignoreEvent(): boolean { return false; }
}

class CopyButtonWidget extends WidgetType {
  constructor(private code: string) {
    super();
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "cm-codeblock-copy";
    btn.setAttribute("aria-label", "Copy code");
    // Two overlapping rounded squares icon
    btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(this.code).then(() => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      });
    });
    return btn;
  }

  eq(other: CopyButtonWidget): boolean {
    return this.code === other.code;
  }

  ignoreEvent(): boolean {
    return true; // Let the button handle its own events
  }
}

function getActiveLines(state: EditorState): Set<number> {
  if (state.field(viewModeField, false)) return new Set();
  const active = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let i = startLine; i <= endLine; i++) {
      active.add(i);
    }
  }
  return active;
}

function handleHeading(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const level = parseInt(node.name.charAt(node.name.length - 1), 10);
  if (isNaN(level) || level < 1 || level > 6) return;

  const line = state.doc.lineAt(node.from);
  decorations.push(
    Decoration.line({ class: `cm-live-h${level}` }).range(line.from)
  );

  const cursor = node.node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "HeaderMark") {
        let hideEnd = cursor.to;
        if (
          hideEnd < node.to &&
          state.doc.sliceString(hideEnd, hideEnd + 1) === " "
        ) {
          hideEnd += 1;
        }
        decorations.push(Decoration.replace({}).range(cursor.from, hideEnd));
      }
    } while (cursor.nextSibling());
  }
}

function handleInlineMarkers(
  node: SyntaxNodeRef,
  decorations: Range<Decoration>[],
  className: string
) {
  const marks: { from: number; to: number }[] = [];
  const cursor = node.node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "EmphasisMark" || cursor.name === "CodeMark" || cursor.name === "StrikethroughMark" || cursor.name === "HighlightMark" || cursor.name === "SuperscriptMark" || cursor.name === "SubscriptMark" || cursor.name === "CommentMark") {
        marks.push({ from: cursor.from, to: cursor.to });
      }
    } while (cursor.nextSibling());
  }

  for (const mark of marks) {
    decorations.push(Decoration.replace({}).range(mark.from, mark.to));
  }

  if (marks.length >= 2) {
    const contentFrom = marks[0].to;
    const contentTo = marks[marks.length - 1].from;
    if (contentFrom < contentTo) {
      decorations.push(
        Decoration.mark({ class: className }).range(contentFrom, contentTo)
      );
    }
  }
}

function handleFencedCode(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return;

  // Collect CodeText range for line decorations
  let codeFrom = -1;
  let codeTo = -1;

  do {
    if (cursor.name === "CodeMark" || cursor.name === "CodeInfo") {
      const line = state.doc.lineAt(cursor.from);
      decorations.push(Decoration.replace({}).range(line.from, line.to));
    } else if (cursor.name === "CodeText") {
      codeFrom = cursor.from;
      codeTo = cursor.to;
    }
  } while (cursor.nextSibling());

  if (codeFrom < 0 || codeTo < 0) return;

  const codeText = state.doc.sliceString(codeFrom, codeTo);

  // Apply line decorations with first/middle/last classes for border-radius
  const firstLine = state.doc.lineAt(codeFrom);
  const lastLine = state.doc.lineAt(codeTo);

  for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
    const line = state.doc.line(ln);
    let cls = "cm-live-codeblock";
    if (ln === firstLine.number && ln === lastLine.number) {
      cls += " cm-live-codeblock-only";
    } else if (ln === firstLine.number) {
      cls += " cm-live-codeblock-first";
    } else if (ln === lastLine.number) {
      cls += " cm-live-codeblock-last";
    }
    decorations.push(Decoration.line({ class: cls }).range(line.from));
  }

  // Copy button widget on the first content line
  decorations.push(
    Decoration.widget({
      widget: new CopyButtonWidget(codeText),
      side: 1, // after line content
    }).range(firstLine.from)
  );
}

/** Matches `> [!type]` or `> [!type] Title` on the first line of a blockquote. */
const CALLOUT_RE = /^>\s*\[!(\w+)\]\s*(.*)/;

function handleBlockquote(
  node: SyntaxNodeRef,
  state: EditorState,
  activeLines: Set<number>,
  decorations: Range<Decoration>[]
) {
  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(node.to);

  // Check if this blockquote is a callout
  const firstLineText = startLine.text;
  const calloutMatch = firstLineText.match(CALLOUT_RE);

  if (calloutMatch) {
    // It's a callout — style as admonition
    const type = calloutMatch[1].toLowerCase();
    const title = calloutMatch[2] || type.charAt(0).toUpperCase() + type.slice(1);

    for (let ln = startLine.number; ln <= endLine.number; ln++) {
      if (activeLines.has(ln)) continue;
      const line = state.doc.line(ln);
      let cls = `cm-live-callout cm-live-callout-${type}`;
      if (ln === startLine.number) cls += " cm-live-callout-first";
      if (ln === endLine.number) cls += " cm-live-callout-last";
      decorations.push(Decoration.line({ class: cls }).range(line.from));

      // Hide the "> " prefix on all lines
      const prefixMatch = line.text.match(/^>\s?/);
      if (prefixMatch) {
        decorations.push(Decoration.replace({}).range(line.from, line.from + prefixMatch[0].length));
      }

      // On the first line, also hide the [!TYPE] marker and restyle the title
      if (ln === startLine.number) {
        const markerMatch = line.text.match(/^>\s*(\[!\w+\]\s*)/);
        if (markerMatch) {
          const markerEnd = line.from + markerMatch[0].length;
          // Hide from after "> " prefix to end of "[!TYPE] "
          const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
          decorations.push(Decoration.replace({}).range(line.from + prefixLen, markerEnd));
          // Style the remaining title text
          if (markerEnd < line.to) {
            decorations.push(
              Decoration.mark({ class: "cm-live-callout-title" }).range(markerEnd, line.to)
            );
          } else if (!calloutMatch[2]) {
            // No title provided — insert the default type name as a widget
            decorations.push(
              Decoration.widget({
                widget: new CalloutTitleWidget(title),
                side: 1,
              }).range(line.from + prefixLen)
            );
          }
        }
      }
    }
    return; // handled as callout, skip normal blockquote styling
  }

  // Normal blockquote (not a callout)
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    if (activeLines.has(ln)) continue;
    const line = state.doc.line(ln);
    decorations.push(Decoration.line({ class: "cm-live-blockquote" }).range(line.from));

    // Hide the "> " prefix
    const text = line.text;
    const match = text.match(/^>\s?/);
    if (match) {
      decorations.push(Decoration.replace({}).range(line.from, line.from + match[0].length));
    }
  }
}

function handleBulletItem(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return;

  // Check if this is a task list item (has Task child)
  let isTask = false;
  let taskChecked = false;
  const cursorCopy = node.node.cursor();
  if (cursorCopy.firstChild()) {
    do {
      if (cursorCopy.name === "Task") {
        isTask = true;
        // Check for TaskMarker inside Task
        const taskCursor = cursorCopy.node.cursor();
        if (taskCursor.firstChild()) {
          do {
            if (taskCursor.name === "TaskMarker") {
              const markerText = state.doc.sliceString(taskCursor.from, taskCursor.to);
              taskChecked = markerText === "[x]" || markerText === "[X]";
            }
          } while (taskCursor.nextSibling());
        }
      }
    } while (cursorCopy.nextSibling());
  }

  if (isTask) {
    // Hide "- [ ] " or "- [x] " prefix
    const line = state.doc.lineAt(node.from);
    const match = line.text.match(/^[-*+]\s\[[ xX]\]\s?/);
    if (match) {
      decorations.push(Decoration.replace({}).range(line.from, line.from + match[0].length));
    }
    // Add checkbox widget
    decorations.push(
      Decoration.widget({
        widget: new CheckboxWidget(taskChecked),
        side: -1,
      }).range(line.from)
    );
    decorations.push(
      Decoration.line({ class: taskChecked ? "cm-live-task cm-live-task-checked" : "cm-live-task" }).range(line.from)
    );
  } else {
    // Regular bullet — hide "- " and apply bullet style
    const line = state.doc.lineAt(node.from);
    const match = line.text.match(/^[-*+]\s/);
    if (match) {
      decorations.push(Decoration.replace({}).range(line.from, line.from + match[0].length));
    }
    decorations.push(Decoration.line({ class: "cm-live-bullet" }).range(line.from));
  }
}

function handleOrderedItem(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const line = state.doc.lineAt(node.from);
  const match = line.text.match(/^(\d+)\.\s/);
  if (match) {
    // Hide the "1. " prefix
    decorations.push(Decoration.replace({}).range(line.from, line.from + match[0].length));
    // Use CSS counter with the actual number
    decorations.push(
      Decoration.line({
        class: "cm-live-ordered",
        attributes: { "data-order": match[1] },
      }).range(line.from)
    );
  }
}

function handleLink(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return;

  // Walk children collecting LinkMark positions and URL range
  let openBracket: { from: number; to: number } | null = null;
  let closeBracket: { from: number; to: number } | null = null;
  let urlEnd = -1;

  do {
    if (cursor.name === "LinkMark") {
      const ch = state.doc.sliceString(cursor.from, cursor.to);
      if (ch === "[" && !openBracket) {
        openBracket = { from: cursor.from, to: cursor.to };
      } else if (ch === "]" && !closeBracket) {
        closeBracket = { from: cursor.from, to: cursor.to };
      } else {
        // "(" or ")" — hide
        decorations.push(Decoration.replace({}).range(cursor.from, cursor.to));
      }
    } else if (cursor.name === "URL" || cursor.name === "LinkTitle") {
      if (urlEnd < cursor.to) urlEnd = cursor.to;
      decorations.push(Decoration.replace({}).range(cursor.from, cursor.to));
    }
  } while (cursor.nextSibling());

  if (!openBracket || !closeBracket) return;

  // Hide the opening [
  decorations.push(Decoration.replace({}).range(openBracket.from, openBracket.to));

  // Hide from closing ] to end of (...) — covers ](url) together
  const hideFrom = closeBracket.from;
  const hideTo = urlEnd > 0 ? node.to : closeBracket.to;
  decorations.push(Decoration.replace({}).range(hideFrom, hideTo));

  // Style the link text
  const textFrom = openBracket.to;
  const textTo = closeBracket.from;
  if (textFrom < textTo) {
    decorations.push(Decoration.mark({ class: "cm-live-link" }).range(textFrom, textTo));
  }
}


function buildTableDecorations(state: EditorState): DecorationSet {
  const activeLines = getActiveLines(state);
  const decorations: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(node.to).number;
      for (let ln = startLine; ln <= endLine; ln++) {
        if (activeLines.has(ln)) return;
      }
      const markdown = state.doc.sliceString(node.from, node.to);
      decorations.push(
        Decoration.replace({ widget: new TableWidget(markdown), block: true })
          .range(node.from, node.to)
      );
      return false;
    },
  });
  return Decoration.set(decorations, true);
}

export const tablePreviewField = StateField.define<DecorationSet>({
  create(state) { return buildTableDecorations(state); },
  update(deco, tr) {
    if (tr.docChanged || tr.selection ||
        syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return buildTableDecorations(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide(f) { return EditorView.decorations.from(f); },
});

function handleHorizontalRule(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const line = state.doc.lineAt(node.from);
  // Replace the entire --- with an hr widget
  decorations.push(Decoration.replace({
    widget: new HorizontalRuleWidget(),
  }).range(line.from, line.to));
}

/** Detect YAML front matter. Returns the closing fence line number, or -1 if none. */
export function detectFrontMatter(state: EditorState): number {
  if (state.doc.lines < 3 || state.doc.line(1).text !== "---") return -1;
  for (let i = 2; i <= state.doc.lines; i++) {
    const t = state.doc.line(i).text;
    if (t === "---" || t === "...") return i;
  }
  return -1;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const activeLines = getActiveLines(state);
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  // Front matter decorations (applied before the syntax tree walk)
  const fmEnd = detectFrontMatter(state);
  if (fmEnd > 0) {
    // Check if cursor is anywhere inside the front matter block
    let cursorInFM = false;
    for (let i = 1; i <= fmEnd; i++) {
      if (activeLines.has(i)) { cursorInFM = true; break; }
    }

    if (cursorInFM) {
      // Cursor is in the block — show raw lines with subtle styling
      for (let i = 1; i <= fmEnd; i++) {
        if (activeLines.has(i)) continue; // active line: show plain (no decoration)
        const ln = state.doc.line(i);
        const cls = (i === 1 || i === fmEnd) ? "cm-live-frontmatter-mark" : "cm-live-frontmatter";
        decorations.push(Decoration.line({ class: cls }).range(ln.from));
      }
    } else {
      // Cursor is outside — hide all front matter lines via CSS display:none.
      // CM6's height map won't update, but front matter is always at the top
      // so cursor-click misalignment is not a practical concern.
      for (let i = 1; i <= fmEnd; i++) {
        const ln = state.doc.line(i);
        decorations.push(Decoration.line({ class: "cm-live-frontmatter-hide" }).range(ln.from));
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node): false | void {
        const line = state.doc.lineAt(node.from);
        if (activeLines.has(line.number)) return;
        // Skip all syntax decorations for nodes within the front matter block
        if (fmEnd > 0 && state.doc.lineAt(node.to).number <= fmEnd) return;

        const name = node.name;

        if (name.startsWith("ATXHeading")) {
          handleHeading(node, state, decorations);
        } else if (name === "StrongEmphasis") {
          // Differentiate **bold** from __underline__ by checking marker text
          const firstChild = node.node.firstChild;
          const markerText = firstChild ? state.doc.sliceString(firstChild.from, firstChild.to) : "";
          const cls = markerText === "__" ? "cm-live-underline" : "cm-live-bold";
          handleInlineMarkers(node, decorations, cls);
        } else if (name === "Emphasis") {
          handleInlineMarkers(node, decorations, "cm-live-italic");
        } else if (name === "InlineCode") {
          handleInlineMarkers(node, decorations, "cm-live-code");
        } else if (name === "Strikethrough") {
          handleInlineMarkers(node, decorations, "cm-live-strikethrough");
        } else if (name === "Highlight") {
          handleInlineMarkers(node, decorations, "cm-live-highlight");
        } else if (name === "Superscript") {
          handleInlineMarkers(node, decorations, "cm-live-superscript");
        } else if (name === "Subscript") {
          handleInlineMarkers(node, decorations, "cm-live-subscript");
        } else if (name === "Comment") {
          // Hide the entire comment (marks + content) in preview mode
          decorations.push(Decoration.replace({}).range(node.from, node.to));
        } else if (name === "CommentBlock") {
          // Hide HTML comments (<!-- ... -->) when cursor is not on the line
          const cbLine = state.doc.lineAt(node.from);
          if (!activeLines.has(cbLine.number)) {
            decorations.push(Decoration.replace({}).range(cbLine.from, cbLine.to));
            decorations.push(Decoration.line({ class: "cm-live-html-comment-hide" }).range(cbLine.from));
          }
        } else if (name === "FootnoteRef") {
          // Replace entire [^id] with a clickable superscript widget
          const text = state.doc.sliceString(node.from, node.to);
          const idMatch = text.match(/^\[\^(.+)\]$/);
          if (idMatch) {
            decorations.push(
              Decoration.replace({
                widget: new FootnoteRefWidget(idMatch[1]),
              }).range(node.from, node.to)
            );
          }
        } else if (name === "Blockquote") {
          handleBlockquote(node, state, activeLines, decorations);
          return false; // don't descend, we handle children ourselves
        } else if (name === "ListItem") {
          // Check parent to determine bullet vs ordered
          const parent = node.node.parent;
          if (parent && parent.name === "OrderedList") {
            handleOrderedItem(node, state, decorations);
          } else {
            handleBulletItem(node, state, decorations);
          }
        } else if (name === "Autolink") {
          // Style bare URLs (https://..., www....) as clickable links
          decorations.push(
            Decoration.mark({ class: "cm-live-link cm-live-autolink" }).range(node.from, node.to)
          );
        } else if (name === "Image") {
          handleImage(node, state, decorations);
          return false;
        } else if (name === "Link") {
          handleLink(node, state, decorations);
          return false; // don't descend into link children
        } else if (name === "HorizontalRule") {
          handleHorizontalRule(node, state, decorations);
        } else if (name === "FencedCode") {
          // For multi-line blocks, check if cursor is on ANY line in the block
          const endLine = state.doc.lineAt(node.to).number;
          let cursorInBlock = false;
          for (let ln = line.number; ln <= endLine; ln++) {
            if (activeLines.has(ln)) { cursorInBlock = true; break; }
          }
          if (!cursorInBlock) {
            handleFencedCode(node, state, decorations);
          }
        }
      },
    });
  }

  // Footnote definitions: [^id]: text — style as small, muted text
  // These aren't parsed as special nodes by lezer, so we scan lines directly.
  for (let ln = 1; ln <= state.doc.lines; ln++) {
    if (activeLines.has(ln)) continue;
    const line = state.doc.line(ln);
    const fnMatch = line.text.match(/^\[\^([^\]]+)\]:\s/);
    if (fnMatch) {
      // Style the entire line as a footnote definition
      decorations.push(Decoration.line({ class: "cm-live-footnote-def" }).range(line.from));
      // Hide the [^id]: prefix, show only the definition text
      const prefixEnd = line.from + fnMatch[0].length;
      decorations.push(Decoration.replace({
        widget: new FootnoteDefMarkerWidget(fnMatch[1]),
      }).range(line.from, prefixEnd));
    }
  }

  return Decoration.set(decorations, true);
}

class FootnoteRefWidget extends WidgetType {
  constructor(private id: string) { super(); }

  toDOM(view: EditorView): HTMLElement {
    const sup = document.createElement("sup");
    sup.className = "cm-live-footnote-ref";
    sup.textContent = this.id;
    sup.title = `Jump to footnote ${this.id}`;
    sup.style.cursor = "pointer";
    sup.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Find the line starting with [^id]: and scroll to it without moving cursor
      const doc = view.state.doc;
      const pattern = `[^${this.id}]:`;
      for (let ln = 1; ln <= doc.lines; ln++) {
        const line = doc.line(ln);
        if (line.text.startsWith(pattern)) {
          // Use requestAnimationFrame to scroll after CM6 processes the event
          requestAnimationFrame(() => {
            const coords = view.coordsAtPos(line.from);
            if (coords) {
              view.scrollDOM.scrollTo({
                top: view.scrollDOM.scrollTop + coords.top - view.scrollDOM.getBoundingClientRect().top - 100,
                behavior: "smooth",
              });
            }
          });
          return;
        }
      }
    });
    return sup;
  }

  eq(other: FootnoteRefWidget): boolean { return this.id === other.id; }
  ignoreEvent(): boolean { return false; } // allow click events to reach the widget
}

class FootnoteDefMarkerWidget extends WidgetType {
  constructor(private id: string) { super(); }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-footnote-def-marker";
    span.textContent = `${this.id}. `;
    return span;
  }

  eq(other: FootnoteDefMarkerWidget): boolean { return this.id === other.id; }
}

class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(_update: ViewUpdate) {
    // Always rebuild: the async markdown parser dispatches transactions
    // that don't set docChanged/selectionSet/viewportChanged, so we must
    // rebuild on every update to catch when the syntax tree becomes available.
    this.decorations = buildDecorations(_update.view);
  }
}

export const livePreviewExtension = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
});
