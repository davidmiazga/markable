/**
 * quick-commands.ts — Slash-command palette for the editor.
 *
 * Triggered when the user types "/" as the very first character of a line.
 * A floating popup appears with matching commands; keyboard and mouse select.
 *
 * Commands:
 *   /layout        — open the page-layout picker
 *   /block         — open the CodeBlock modal (covers /select, /sidebar, /grid)
 *   /table         — insert a starter 3-column table
 *   /date          — insert today's date (YYYY-MM-DD)
 *   /tasks         — insert a task list item (- [ ] )
 *   /code          — insert a fenced code block
 *   /callout       — insert a NOTE callout
 *   /callout-tip   — insert a TIP callout
 *   /callout-warning   — insert a WARNING callout
 *   /callout-important — insert an IMPORTANT callout
 *   /divider       — insert a horizontal rule
 *   /quote         — insert a blockquote prefix
 *   /sidebar-left  — insert a left-floating sidebar block
 *   /link          — insert a hyperlink placeholder
 *   /image         — insert an image placeholder
 *   /frontmatter   — insert a YAML front-matter block
 */

import { type ViewUpdate, EditorView, keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { insertHorizontalRule, toggleLinePrefix } from "./format";

export interface QuickCommandDeps {
  openLayoutPicker: () => void;
  enterPreviewMode: () => void;
  /** Open the CodeBlock modal. `preselect` jumps the type picker to that block. */
  openCodeBlock: (
    view: EditorView,
    from: number,
    to: number,
    preselect?: "sidebar" | "grid" | "select",
  ) => void;
}

interface QuickCommand {
  name: string;
  description: string;
  apply: (view: EditorView, from: number, to: number) => void;
}

// ── Active plugin reference (for keymap access) ────────────────────────────────
let _active: QuickCommandsPlugin | null = null;

// ── Keymap ─────────────────────────────────────────────────────────────────────
const slashKeymap = keymap.of([
  { key: "ArrowDown",  run: ()     => { if (!_active) return false; _active.move(1);  return true; } },
  { key: "ArrowUp",   run: ()     => { if (!_active) return false; _active.move(-1); return true; } },
  { key: "Enter",     run: (view) => { if (!_active) return false; _active.accept(view); return true; } },
  { key: "Tab",       run: (view) => { if (!_active) return false; _active.accept(view); return true; } },
  { key: "Escape",    run: ()     => { if (!_active) return false; _active.close();  return true; } },
]);

// ── Starters ───────────────────────────────────────────────────────────────────
const TABLE_STARTER   = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n";
const CODE_FENCE      = "```\n\n```";
const SIDEBAR_LEFT    = "```sidebar-left\n\n```";

function callout(type: string): string {
  return `> [!${type}]\n> \n`;
}

// ── Command builder ────────────────────────────────────────────────────────────
function makeCommands(deps: QuickCommandDeps): QuickCommand[] {
  return [
    {
      name: "layout",
      description: "Apply a page layout to this file",
      apply(view, from, to) {
        view.dispatch({ changes: { from, to, insert: "" } });
        deps.openLayoutPicker();
      },
    },
    {
      name: "block",
      description: "Insert a /select, /sidebar, or /grid",
      apply(view, from, to) {
        deps.openCodeBlock(view, from, to);
      },
    },
    {
      name: "table",
      description: "Insert a 3-column table",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: TABLE_STARTER },
          selection: { anchor: from + TABLE_STARTER.length },
        });
        deps.enterPreviewMode();
      },
    },
    {
      name: "tasks",
      description: "Start a task list",
      apply(view, from, to) {
        const insert = "- [ ] \n- [ ] \n- [ ] \n";
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + 6 },
        });
      },
    },
    {
      name: "code",
      description: "Insert a code block",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: CODE_FENCE },
          selection: { anchor: from + 4 },
        });
      },
    },
    {
      name: "callout",
      description: "Insert a NOTE callout",
      apply(view, from, to) {
        const text = callout("NOTE");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        deps.enterPreviewMode();
      },
    },
    {
      name: "callout-tip",
      description: "Insert a TIP callout",
      apply(view, from, to) {
        const text = callout("TIP");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        deps.enterPreviewMode();
      },
    },
    {
      name: "callout-warning",
      description: "Insert a WARNING callout",
      apply(view, from, to) {
        const text = callout("WARNING");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        deps.enterPreviewMode();
      },
    },
    {
      name: "callout-important",
      description: "Insert an IMPORTANT callout",
      apply(view, from, to) {
        const text = callout("IMPORTANT");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        deps.enterPreviewMode();
      },
    },
    {
      name: "divider",
      description: "Insert a horizontal rule",
      apply(view, from, to) {
        view.dispatch({ changes: { from, to, insert: "" } });
        insertHorizontalRule(view);
      },
    },
    {
      name: "quote",
      description: "Insert a blockquote",
      apply(view, from, to) {
        view.dispatch({ changes: { from, to, insert: "" } });
        toggleLinePrefix(view, "> ");
      },
    },
    {
      name: "sidebar-left",
      description: "Insert a left-floating sidebar",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: SIDEBAR_LEFT },
          selection: { anchor: from + SIDEBAR_LEFT.indexOf("\n") + 1 },
        });
        deps.enterPreviewMode();
      },
    },
    {
      name: "link",
      description: "Insert a hyperlink",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: "[]()" },
          selection: { anchor: from + 1 },
        });
      },
    },
    {
      name: "image",
      description: "Insert an image",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: "![]()" },
          selection: { anchor: from + 2 },
        });
      },
    },
    {
      name: "frontmatter",
      description: "Insert YAML front matter",
      apply(view, from, to) {
        const insert = "---\n\n---\n";
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + 4 },
        });
      },
    },
    {
      name: "date",
      description: "Insert today's date",
      apply(view, from, to) {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        view.dispatch({
          changes: { from, to, insert: iso },
          selection: { anchor: from + iso.length },
        });
      },
    },
  ];
}

// ── ViewPlugin ─────────────────────────────────────────────────────────────────
class QuickCommandsPlugin {
  private popup: HTMLElement | null = null;
  private filtered: QuickCommand[] = [];
  private selectedIdx = 0;
  private slashFrom = -1;

  constructor(private readonly commands: QuickCommand[]) {}

  update(update: ViewUpdate) {
    const { state } = update;
    const sel = state.selection.main;
    if (!sel.empty) { this.close(); return; }

    const line = state.doc.lineAt(sel.head);
    const before = state.sliceDoc(line.from, sel.head);
    const match = before.match(/^\/(\w*)$/);

    if (!match) { this.close(); return; }

    const typed = match[1].toLowerCase();
    this.filtered = this.commands.filter((c) => c.name.startsWith(typed));
    if (this.filtered.length === 0) { this.close(); return; }

    this.slashFrom = line.from;
    this.selectedIdx = Math.min(this.selectedIdx, this.filtered.length - 1);

    if (!this.popup) {
      this.popup = document.createElement("div");
      this.popup.className = "slash-cmd-popup";
      this.popup.style.cssText =
        "position:fixed;z-index:10000;background:var(--bg-secondary,#2a2a3a);border:1px solid var(--border-color,#444);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.4);width:480px;padding:6px;display:flex;flex-wrap:wrap;gap:4px;";
      document.body.appendChild(this.popup);
      _active = this;
    }

    this.render(update.view);
  }

  private render(view: EditorView) {
    if (!this.popup) return;

    const coords = view.coordsAtPos(this.slashFrom);
    if (coords) {
      this.popup.style.top  = `${coords.bottom + 4}px`;
      this.popup.style.left = `${coords.left}px`;
    }

    this.popup.innerHTML = "";
    this.filtered.forEach((cmd, i) => {
      const item = document.createElement("div");
      item.className = "slash-cmd-chip";
      const selected = i === this.selectedIdx;
      item.style.cssText =
        "padding:3px 8px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--border-color,#444);white-space:nowrap;line-height:1.4;" +
        (selected
          ? "background:var(--accent-subtle,rgba(74,158,255,.18));border-color:var(--accent-color,#4a9eff);"
          : "background:transparent;");

      const name = document.createElement("span");
      name.textContent = "/" + cmd.name;
      name.style.cssText = "font-size:12px;color:var(--text-primary,#ccc);font-weight:500;";

      const desc = document.createElement("span");
      desc.textContent = cmd.description;
      desc.style.cssText = "font-size:10px;color:var(--text-secondary,#888);";

      item.appendChild(name);
      item.appendChild(desc);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.acceptAt(view, i);
      });

      this.popup!.appendChild(item);
    });
  }

  move(delta: number) {
    if (!this.popup || this.filtered.length === 0) return;
    this.selectedIdx = (this.selectedIdx + delta + this.filtered.length) % this.filtered.length;
    const items = this.popup.querySelectorAll<HTMLElement>(".slash-cmd-chip");
    items.forEach((el, i) => {
      const selected = i === this.selectedIdx;
      el.style.background = selected ? "var(--accent-subtle,rgba(74,158,255,.18))" : "transparent";
      el.style.borderColor = selected ? "var(--accent-color,#4a9eff)" : "var(--border-color,#444)";
    });
  }

  accept(view: EditorView) {
    this.acceptAt(view, this.selectedIdx);
  }

  private acceptAt(view: EditorView, idx: number) {
    const cmd = this.filtered[idx];
    if (!cmd) return;
    const to = view.state.selection.main.head;
    const from = this.slashFrom;
    this.close();
    cmd.apply(view, from, to);
    view.focus();
  }

  close() {
    this.popup?.remove();
    this.popup = null;
    if (_active === this) _active = null;
    this.selectedIdx = 0;
    this.slashFrom = -1;
  }

  destroy() {
    this.close();
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function buildQuickCommandExtension(deps: QuickCommandDeps): Extension {
  const commands = makeCommands(deps);
  const plugin = new QuickCommandsPlugin(commands);

  return [
    Prec.highest(slashKeymap),
    EditorView.updateListener.of((update) => plugin.update(update)),
  ];
}
