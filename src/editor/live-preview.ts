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
      if (cursor.name === "EmphasisMark" || cursor.name === "CodeMark" || cursor.name === "StrikethroughMark" || cursor.name === "HighlightMark") {
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

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const activeLines = getActiveLines(state);
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const line = state.doc.lineAt(node.from);
        if (activeLines.has(line.number)) return;

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
