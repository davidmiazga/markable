/**
 * quick-commands.ts — Slash-command palette for the editor.
 *
 * Triggered when the user types "/" as the very first character of a line.
 * A floating popup appears with matching commands; keyboard and mouse select.
 *
 * Commands:
 *   /layout  — open the layout picker
 *   /table   — insert a starter 3-column table
 *   /date    — insert today's date (YYYY-MM-DD)
 */

import { type ViewUpdate, EditorView, keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";

export interface QuickCommandDeps {
  openLayoutPicker: () => void;
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

// ── Table starter ──────────────────────────────────────────────────────────────
const TABLE_STARTER = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";

// ── Command builder ────────────────────────────────────────────────────────────
function makeCommands(deps: QuickCommandDeps): QuickCommand[] {
  return [
    {
      name: "layout",
      description: "Apply a layout to this file",
      apply(view, from, to) {
        view.dispatch({ changes: { from, to, insert: "" } });
        deps.openLayoutPicker();
      },
    },
    {
      name: "table",
      description: "Insert a 3-column table",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: TABLE_STARTER },
          selection: { anchor: from + 2 },
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
        "position:fixed;z-index:10000;background:var(--bg-secondary,#2a2a3a);border:1px solid var(--border-color,#444);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:220px;overflow:hidden;";
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
      item.style.cssText =
        `padding:8px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px;` +
        (i === this.selectedIdx ? "background:var(--accent-subtle,rgba(74,158,255,.15));" : "");

      const name = document.createElement("span");
      name.textContent = "/" + cmd.name;
      name.style.cssText = "font-size:13px;color:var(--text-primary,#ccc);font-weight:500;";

      const desc = document.createElement("span");
      desc.textContent = cmd.description;
      desc.style.cssText = "font-size:11px;color:var(--text-secondary,#888);";

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
    const items = this.popup.querySelectorAll<HTMLElement>("div");
    items.forEach((el, i) => {
      el.style.background =
        i === this.selectedIdx ? "var(--accent-subtle,rgba(74,158,255,.15))" : "";
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
