import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";

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
      if (cursor.name === "EmphasisMark" || cursor.name === "CodeMark" || cursor.name === "StrikethroughMark" || cursor.name === "HighlightMark" || cursor.name === "SuperscriptMark" || cursor.name === "SubscriptMark") {
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

function handleBlockquote(
  node: SyntaxNodeRef,
  state: EditorState,
  activeLines: Set<number>,
  decorations: Range<Decoration>[]
) {
  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(node.to);

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

  return Decoration.set(decorations, true);
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
