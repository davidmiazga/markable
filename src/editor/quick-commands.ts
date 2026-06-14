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
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
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
  { key: "Escape",    run: (view) => { if (!_active) return false; _active.cancelOnEsc(view); return true; } },
]);

// ── Starters ───────────────────────────────────────────────────────────────────
const TABLE_STARTER   = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n";
const CODE_FENCE      = "```\n\n```";
const SIDEBAR_LEFT    = "```sidebar-left\n\n```";
const SIDEBAR_FENCE   = "```sidebar\n\n```";
const GRID_FENCE      = "```grid\n\n```";

/**
 * Names of slash commands that opt into the "Esc cancels and removes
 * the typed slash text" behaviour (view-modal EC-10, locked per user
 * directive 2026-06-08).
 *
 * Existing slash commands (e.g. /sidebar-left, /code, /callout) keep
 * the legacy convention of leaving typed text in place after Esc.
 * Only the two NEW commands introduced in step_07 of the Unified View
 * Modal feature opt into the inverse behaviour.
 *
 * Order of operations on Esc when active command opts in:
 *   1. dispatch a change that deletes the slash text range [slashFrom, head)
 *   2. close the popup
 *   3. return cursor to slashFrom (achieved by the change's selection)
 *
 * Stored as a runtime-frozen Set (Object.freeze) — not just a
 * TypeScript-level `ReadonlySet<string>` — so a malicious or buggy
 * plugin that grabs the binding via the module graph cannot mutate the
 * opt-in list at runtime to extend EC-10's "Esc removes typed text"
 * behaviour to other slash commands (Reviewer L-1 hardening,
 * 2026-06-08). `Object.isFrozen(ESC_REMOVES_TYPED_TEXT)` returns true.
 * Lookup is O(1) inside the Esc handler.
 */
const ESC_REMOVES_TYPED_TEXT: ReadonlySet<string> =
  Object.freeze(new Set(["sidebar", "grid"])) as ReadonlySet<string>;

/**
 * Test-only export of the EC-10 opt-in Set. Exposed solely so the
 * regression test in `tests/view-modal/slash-commands.test.ts` can
 * assert that `Object.isFrozen(...)` returns true (Reviewer L-1).
 * Plugins do not bundle this module, so re-exposing the reference here
 * does not widen the runtime attack surface.
 */
export const __TEST_ONLY_ESC_REMOVES_TYPED_TEXT = ESC_REMOVES_TYPED_TEXT;

/**
 * Returns true when `pos` is inside an open fenced or indented code
 * block. The naive line-start regex `^\/(\w*)$` in `update()` would
 * otherwise fire for `/sidebar` typed on the inner blank line of a
 * ```js / ```python / ```... fence, because that blank line still
 * matches the regex.
 *
 * AD-7 in `docs/specs/view-modal/00_index.md` mandates this guard:
 * the slash-trigger must consult the Lezer syntax tree and skip when
 * the cursor's enclosing node is a code context. We mirror the
 * exhaustive list used by `typing-assist.plugin.ts:isProtectedContext`
 * (`FencedCode`, `CodeBlock`, `CodeText`, `InlineCode`) — the same
 * canonical set the existing typography-suppression code uses, so the
 * two share a single mental model of "code-like context".
 *
 * The walk is bounded by `node.parent` — at most ~5 levels in practice
 * for a markdown doc — so the check is effectively O(1) per keystroke.
 */
function isInsideCodeFence(state: EditorState, pos: number): boolean {
  // `resolveInner(pos, -1)` biases to the node ending at `pos` if
  // there's ambiguity; matches the typing-assist plugin's call shape.
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    const { name } = node;
    if (
      name === "FencedCode" ||
      name === "CodeBlock"  ||
      name === "CodeText"   ||
      name === "InlineCode"
    ) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

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
      // step_07 (view-modal): inserts a right-floating sidebar codefence
      // stub. The chooser modal (sidebar / grid / select) is gone post-
      // step_09; users now type the slash command directly. The cursor
      // lands on the inner blank line so the user can start typing the
      // sidebar body immediately. FR-70 / FR-74.
      //
      // Esc behaviour for this command is the inverse of the legacy
      // convention — typed text is removed (EC-10). See
      // ESC_REMOVES_TYPED_TEXT and `QuickCommandsPlugin.cancelOnEsc`.
      //
      // Placed BEFORE /sidebar-left so the exact match `/sidebar` is
      // the first (default-selected) suggestion when the user types
      // the full slug.
      name: "sidebar",
      description: "Insert a right-floating sidebar",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: SIDEBAR_FENCE },
          // Cursor lands at the inner blank line: ```sidebar\n<here>\n```
          selection: { anchor: from + SIDEBAR_FENCE.indexOf("\n") + 1 },
        });
        deps.enterPreviewMode();
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
      // step_07 (view-modal): inserts an NxM grid codefence stub.
      // Configuration (cols × rows, cell style) is deferred (DW-1);
      // for now the stub is empty and the user fills in the body.
      // Same EC-10 Esc-removes-typed-text behaviour as `/sidebar`.
      name: "grid",
      description: "Insert an NxM grid",
      apply(view, from, to) {
        view.dispatch({
          changes: { from, to, insert: GRID_FENCE },
          selection: { anchor: from + GRID_FENCE.indexOf("\n") + 1 },
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

    // EC-9 guard (view-modal, AD-7): suppress the slash menu when the
    // cursor sits inside an open code fence / inline code span. The
    // regex above only checks "/" is at column 0, which still matches
    // the inner blank line of a ```lang fence. Without this guard,
    // typing `/sidebar` on that blank line would pop the slash menu
    // inside a code block — a surprising UX regression.
    if (isInsideCodeFence(state, sel.head)) { this.close(); return; }

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

  /**
   * Handle the Esc key. Legacy convention: close the popup; the user's
   * typed slash text stays in the doc. New behaviour for `/sidebar`
   * and `/grid` (view-modal EC-10, locked per user directive
   * 2026-06-08): the typed slash text is removed and the cursor
   * returns to where the slash started.
   *
   * The selection inversion is performed BEFORE close() because close()
   * resets `slashFrom = -1`, losing the range we need.
   */
  cancelOnEsc(view: EditorView) {
    // Determine if the currently-selected suggestion's name is in the
    // opt-in set. We look at the FILTERED list's first entry — the
    // user's typed text is `before.slice(1)` (the chars after `/`),
    // and the selected chip is `this.filtered[this.selectedIdx]`.
    //
    // The user directive scopes the inverse behaviour to the typed
    // text being `/sidebar` or `/grid`, not to the selected suggestion.
    // We compare against what the user typed (the literal text in the
    // slash range), not against the suggestion list, so partial matches
    // like `/si` do NOT trigger the deletion — only fully-typed
    // `/sidebar` or `/grid` (or a longer prefix that resolves to one).
    let shouldRemove = false;
    if (this.slashFrom >= 0 && !this.inSubPicker) {
      const head = view.state.selection.main.head;
      if (head > this.slashFrom) {
        const typed = view.state
          .sliceDoc(this.slashFrom + 1, head)
          .toLowerCase();
        if (ESC_REMOVES_TYPED_TEXT.has(typed)) shouldRemove = true;
      }
    }

    if (shouldRemove) {
      // Capture the range BEFORE close() resets slashFrom.
      const from = this.slashFrom;
      const head = view.state.selection.main.head;
      this.close();
      view.dispatch({
        changes: { from, to: head, insert: "" },
        selection: { anchor: from },
      });
    } else {
      this.close();
    }
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
