/**
 * Right-click an inline #tag in the note to search notes that include or exclude it.
 * Tags inside code spans and fenced code blocks are ignored.
 */

import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const TAG = /(^|\s)#([A-Za-z0-9][A-Za-z0-9_/-]*)/g;
const CODE_NODE = /InlineCode|FencedCode|CodeBlock|CodeText/;

export function inlineTagAt(state: EditorState, offset: number): string | null {
  if (offset < 0 || offset > state.doc.length) return null;
  const blocked = codeRanges(state);
  if (blocked.some(([from, to]) => offset >= from && offset < to)) return null;

  const line = state.doc.lineAt(offset);
  const lineText = line.text;
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(lineText))) {
    const hashAt = match.index + match[1].length;
    const tokenFrom = line.from + hashAt;
    const tokenTo = tokenFrom + 1 + match[2].length;
    if (offset < tokenFrom || offset >= tokenTo) continue;
    if (blocked.some(([from, to]) => tokenFrom >= from && tokenFrom < to)) continue;
    return match[2];
  }
  return null;
}

function codeRanges(state: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (CODE_NODE.test(node.name)) ranges.push([node.from, node.to]);
    },
  });
  return ranges;
}

let _pop: HTMLElement | null = null;

function closeMenu(): void {
  _pop?.remove();
  _pop = null;
}

function ensureCss(): void {
  if (document.getElementById("inline-tag-menu-css")) return;
  const style = document.createElement("style");
  style.id = "inline-tag-menu-css";
  style.textContent = `
.it-pop {
  position: fixed; z-index: 1100; min-width: 180px;
  background: var(--bg-primary); border: 1px solid var(--border-color);
  border-radius: 8px; padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.2);
}
.it-pop button {
  display: block; width: 100%; text-align: left; padding: 6px 8px;
  border: none; background: transparent; color: var(--text-primary);
  cursor: pointer; border-radius: 4px; font-size: 12px;
}
.it-pop button:hover { background: var(--bg-hover, rgba(255,255,255,.06)); }
`;
  document.head.appendChild(style);
}

function searchClause(value: string, exclude: boolean): string {
  const body = /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
  return `${exclude ? "-" : ""}tag:#${body}`;
}

export function openInlineTagMenu(x: number, y: number, tag: string): void {
  closeMenu();
  ensureCss();
  const pop = document.createElement("div");
  pop.className = "it-pop";
  pop.setAttribute("role", "menu");
  const add = (label: string, kind: "include" | "exclude"): void => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = kind === "include" ? "it-search-include" : "it-search-exclude";
    btn.setAttribute("role", "menuitem");
    btn.textContent = label;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeMenu();
      const search = (window as unknown as {
        __MARKABLE_TAG_SEARCH__?: (clause: string, kind: "include" | "exclude") => void;
      }).__MARKABLE_TAG_SEARCH__;
      if (typeof search !== "function") return;
      search(searchClause(tag, kind === "exclude"), kind);
    });
    pop.appendChild(btn);
  };
  add("Search notes with this", "include");
  add("Exclude this from search", "exclude");
  document.body.appendChild(pop);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  _pop = pop;
}

function onPointerDown(event: Event): void {
  if (!_pop) return;
  if (event.target instanceof Node && _pop.contains(event.target)) return;
  closeMenu();
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

/** Open the menu when `pos` sits on a #tag. Returns false for ordinary text and code. */
export function handleInlineTagContext(view: EditorView, pos: number, x: number, y: number): boolean {
  const tag = inlineTagAt(view.state, pos);
  if (!tag) return false;
  openInlineTagMenu(x, y, tag);
  return true;
}

export function inlineTagMenuExtension() {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      let pos: number | null;
      try {
        pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      } catch {
        return false;
      }
      if (pos == null) return false;
      if (!handleInlineTagContext(view, pos, event.clientX, event.clientY)) return false;
      event.preventDefault();
      return true;
    },
  });
}

export function closeInlineTagMenu(): void {
  closeMenu();
}
