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
 *   /callout       — opens a type-picker sub-popup. The 13 canonical
 *                    Obsidian callout types (note, abstract, info, todo,
 *                    tip, success, question, warning, failure, danger,
 *                    bug, example, quote) appear as chips inside the
 *                    same popup. Keeps the root menu uncluttered.
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
import { CALLOUT_TYPES } from "./callouts";

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
  /** When set, selecting this command swaps the popup into a sub-picker
   *  populated with these entries instead of inserting immediately. Used
   *  for `/callout` → choose canonical type so the root picker stays
   *  short. The sub-picker uses the same chip UI; arrow keys + Enter
   *  navigate it, any keystroke that changes the doc dismisses it. */
  subCommands?: QuickCommand[];
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

/** Build a callout insertion template. `type` is the lowercased canonical
 *  type word; rendered live-preview capitalizes it via the parser's
 *  `written` field. The trailing `> ` line lets the user start typing body
 *  content immediately; cursor is positioned there by the slash command. */
function calloutTemplate(type: string): { text: string; bodyOffset: number } {
  const text = `> [!${type}]\n> `;
  return { text, bodyOffset: text.length };
}

/** One-line picker description per canonical callout type. Plain color
 *  variants are nested under the `plain` drilldown (see PLAIN_COLOR_PICKER)
 *  and use their own friendly chip labels there, so they're omitted here. */
const CALLOUT_DESCRIPTIONS: Record<string, string> = {
  note: "Insert a note callout",
  abstract: "Insert an abstract / summary callout",
  info: "Insert an info callout",
  todo: "Insert a todo callout",
  tip: "Insert a tip / hint callout",
  success: "Insert a success / check callout",
  question: "Insert a question / help callout",
  warning: "Insert a warning / caution callout",
  failure: "Insert a failure callout",
  danger: "Insert a danger / error callout",
  bug: "Insert a bug callout",
  example: "Insert an example callout",
  quote: "Insert a quote / cite callout",
  plain: "Insert a plain callout — pick a color",
};

/**
 * Chips for the second-level color picker shown after `/callout` → `plain`.
 * `canonical` is what gets written into the doc as `[!<canonical>]`; `label`
 * is the chip text (decoupled so the chips read as bare color names instead
 * of "plain-blue", "plain-cyan", …). `default` maps to the bare gray `plain`.
 */
const PLAIN_COLOR_PICKER: ReadonlyArray<{ canonical: string; label: string; description: string }> = [
  { canonical: "plain",        label: "default", description: "Plain callout (gray, no accent)" },
  { canonical: "plain-blue",   label: "blue",    description: "Blue plain callout" },
  { canonical: "plain-cyan",   label: "cyan",    description: "Cyan plain callout" },
  { canonical: "plain-green",  label: "green",   description: "Green plain callout" },
  { canonical: "plain-yellow", label: "yellow",  description: "Yellow plain callout" },
  { canonical: "plain-orange", label: "orange",  description: "Orange plain callout" },
  { canonical: "plain-red",    label: "red",     description: "Red plain callout" },
  { canonical: "plain-purple", label: "purple",  description: "Purple plain callout" },
];

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
      description: "Insert a callout — pick a type",
      // The bare /callout entry never inserts on its own; selecting it
      // swaps the popup into a sub-picker listing the canonical callout
      // types. Keeps the root slash menu uncluttered.
      apply() { /* no-op; subCommands takes over in acceptAt */ },
      // 13 standard types are flat leaves; `plain` is itself a drilldown
      // into the color picker (default + 7 tints) so the type list stays
      // at 14 chips instead of 21. The filter excludes every plain-*
      // canonical because those live under the nested picker.
      subCommands: [
        ...CALLOUT_TYPES
          .filter((c) => !c.startsWith("plain"))
          .map((canonical) => ({
            name: canonical,
            description: CALLOUT_DESCRIPTIONS[canonical] ?? `Insert a ${canonical} callout`,
            apply(view: EditorView, from: number, to: number) {
              const { text, bodyOffset } = calloutTemplate(canonical);
              view.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from + bodyOffset },
              });
              deps.enterPreviewMode();
            },
          })),
        {
          name: "plain",
          description: CALLOUT_DESCRIPTIONS.plain,
          apply() { /* drilldown only — see subCommands below */ },
          subCommands: PLAIN_COLOR_PICKER.map(({ canonical, label, description }) => ({
            name: label,
            description,
            apply(view: EditorView, from: number, to: number) {
              const { text, bodyOffset } = calloutTemplate(canonical);
              view.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from + bodyOffset },
              });
              deps.enterPreviewMode();
            },
          })),
        },
      ],
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
  /** True when the popup is currently showing a parent command's
   *  `subCommands` (e.g. the callout-type picker after `/callout`).
   *  While true, `update()` does not re-filter against typed text — any
   *  doc change dismisses the popup instead. */
  private inSubPicker = false;
  /** Optional caption shown above the chips in sub-picker mode. */
  private subCaption: string | null = null;

  constructor(private readonly commands: QuickCommand[]) {}

  update(update: ViewUpdate) {
    const { state } = update;
    const sel = state.selection.main;
    if (!sel.empty) { this.close(); return; }

    // In sub-picker mode the chip list is frozen on the chosen parent's
    // subCommands. Any doc change (or anything else that would normally
    // re-run the filter) means the user has typed past the popup —
    // dismiss instead of trying to re-filter against the original slash.
    if (this.inSubPicker) {
      if (update.docChanged) { this.close(); return; }
      return;
    }

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

    if (this.inSubPicker && this.subCaption) {
      const caption = document.createElement("div");
      caption.textContent = this.subCaption;
      caption.style.cssText =
        "flex-basis:100%;font-size:11px;color:var(--text-secondary,#888);padding:2px 4px 4px;letter-spacing:0.02em;";
      this.popup.appendChild(caption);
    }

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
      // Root level: chip reads "/name". Sub-picker: bare name (no slash) so
      // it's clear the user is picking a value, not another slash command.
      name.textContent = this.inSubPicker ? cmd.name : "/" + cmd.name;
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

    // Parent commands with a subCommands list act as drilldowns: the
    // popup stays open and swaps in the children as the new chip list.
    // The slashFrom range is preserved so the eventual leaf apply still
    // replaces the original `/parent` text with the chosen template.
    if (cmd.subCommands && cmd.subCommands.length > 0) {
      this.filtered = cmd.subCommands;
      this.selectedIdx = 0;
      this.inSubPicker = true;
      this.subCaption = `Pick a ${cmd.name} type`;
      this.render(view);
      return;
    }

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
    this.inSubPicker = false;
    this.subCaption = null;
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
