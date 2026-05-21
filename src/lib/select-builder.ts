/**
 * select-builder.ts — Unified modal for inserting / editing a ```select block.
 *
 * Two sections:
 *   1. Filter rows  — reuse the `[Type ▾] [Operator ▾] [Value] [−] [+]` pattern
 *      from `src/lib/rule-row.ts` (same UI as the Smart Folder editor).
 *   2. Display picker + per-display options — five buttons (cards / table /
 *      list / timeline / kanban) plus the option controls that apply to the
 *      chosen display.
 *
 * Output is a ```select codefence string. The host application supplies an
 * `onApply(fence)` callback that decides what to do with it (insert at cursor,
 * replace an existing range, etc.).
 */

import {
  buildRuleRow,
  OPERATORS_BY_TYPE,
  type RuleRowContext,
} from "./rule-row";
import { attachModalKeyboard } from "./modal-keyboard";
import type { SmartFolderRule } from "../plugins/file-browser/smart-folders/types";

const OVERLAY_ID = "__select-builder-overlay__";
const STYLE_ID   = "__sb-styles__";

const STYLES = `
.sb-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 8vh;
  font-family: var(--ui-font, -apple-system, sans-serif);
}
.sb-backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.55); backdrop-filter: blur(2px);
}
.sb-panel {
  position: relative; z-index: 1;
  width: min(720px, 90vw); max-height: 84vh; overflow: hidden;
  background: var(--bg-primary, #1d1d2a);
  border: 1px solid var(--border-color, rgba(255,255,255,.12));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
  color: var(--text-primary, #e0e0e0);
}
.sb-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.sb-title { font-size: 14px; font-weight: 600; }
.sb-close {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-secondary, #aaa); font-size: 22px; line-height: 1;
}
.sb-close:hover { color: var(--text-primary, #fff); }
.sb-body { padding: 12px 18px; overflow-y: auto; }
.sb-section { margin-bottom: 16px; }
.sb-section-label {
  font-size: 11px; font-weight: 600; letter-spacing: .04em;
  color: var(--text-tertiary, #888);
  text-transform: uppercase; margin-bottom: 6px;
}
.sb-rules-list { list-style: none; margin: 0; padding: 0; }
.smart-folder-rule-row {
  display: flex; gap: 6px; align-items: center;
  padding: 5px 0;
}
.sb-section-caption,
.sb-rules-empty {
  font-size: 12px; font-style: italic; color: var(--text-tertiary, #888);
  padding: 0 0 10px 0;
}
.sb-add-rule {
  font-size: 12px; padding: 4px 10px; margin-top: 4px;
  border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border-color, rgba(255,255,255,.15));
  background: transparent; color: var(--text-secondary, #aaa);
}
.sb-add-rule:hover { color: var(--text-primary, #fff); background: var(--bg-hover, rgba(255,255,255,.05)); }

.sb-display-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.sb-display-pill {
  padding: 6px 14px; border-radius: 14px; font-size: 12px;
  cursor: pointer; user-select: none;
  border: 1px solid var(--border-color, rgba(255,255,255,.15));
  color: var(--text-secondary, #aaa); background: transparent;
}
.sb-display-pill:hover { color: var(--text-primary, #e0e0e0); background: var(--bg-hover, rgba(255,255,255,.06)); }
.sb-display-pill.is-active {
  background: var(--link-color, #4a9eff); border-color: transparent; color: #fff;
}

.sb-opts { display: flex; flex-direction: column; gap: 10px; }
.sb-opt-row {
  display: flex; gap: 8px; align-items: center;
  font-size: 12px; color: var(--text-secondary, #aaa);
}
/* Checkbox size + accent-color come from the global rule in styles.css. */
.sb-opt-row input[type="text"], .sb-opt-row select {
  font-size: 12px; padding: 3px 6px;
  background: var(--bg-secondary, #2a2a3a);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
}

.sb-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.sb-footer-left { margin-right: auto; }
.sb-btn {
  font-size: 13px; padding: 5px 14px; border-radius: 5px;
  border: 1px solid var(--border-color, #444);
  background: var(--button-bg, transparent);
  color: var(--text-primary, #e0e0e0); cursor: pointer;
}
.sb-btn:hover { background: var(--bg-hover, rgba(255,255,255,.06)); }
.sb-btn-primary {
  background: var(--link-color, #4a9eff); border-color: var(--link-color, #4a9eff); color: #fff;
}
.sb-btn-primary:hover { background: var(--link-color, #4a9eff); opacity: 0.92; }
.sb-btn-danger { color: var(--text-danger, #e66); }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES.trim();
  document.head.appendChild(style);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type DisplayKind = "cards" | "table" | "list" | "timeline" | "kanban";

export interface SelectBuilderInitial {
  rules?: SmartFolderRule[];
  path?: string;
  display?: DisplayKind;
  sort?: string;
  showModified?: boolean;
  showExtensions?: boolean;
  previewPane?: boolean;
  kanbanField?: string;
}

export interface SelectBuilderOptions {
  /** Pre-fill values (edit mode). When absent, opens in insert mode with defaults. */
  initial?: SelectBuilderInitial;
  /** Called with the new fence string when the user clicks Save. */
  onApply: (fence: string) => void;
  /** Optional "Remove" button. Shown only when supplied. */
  onRemove?: () => void;
  /** Tag and extension suggestions for the filter rows. */
  ruleRowContext?: RuleRowContext;
}

// ── Build the ```select fence string ─────────────────────────────────────────

const ALL_DISPLAYS: DisplayKind[] = ["cards", "table", "list", "timeline", "kanban"];

const DISPLAY_LABELS: Record<DisplayKind, string> = {
  cards:    "Cards",
  table:    "Table",
  list:     "List",
  timeline: "Timeline",
  kanban:   "Kanban",
};

function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text.split("\n").map((line) => (line ? pad + line : line)).join("\n");
}

function serializeRule(rule: SmartFolderRule): string {
  const lines: string[] = [];
  lines.push(`- type: ${rule.type}`);
  lines.push(`  operator: ${rule.operator}`);
  if (rule.value !== null && rule.value !== undefined) {
    lines.push(`  value: ${String(rule.value)}`);
  }
  return lines.join("\n");
}

export function buildSelectFenceFromState(state: {
  rules: SmartFolderRule[];
  path: string;
  display: DisplayKind;
  sort: string;
  showModified: boolean;
  showExtensions: boolean;
  previewPane: boolean;
  kanbanField: string;
}): string {
  const lines: string[] = ["```select"];
  if (state.path && state.path.trim()) lines.push(`path: ${state.path.trim()}`);
  if (state.rules.length > 0) {
    lines.push("where:");
    for (const rule of state.rules) lines.push(indent(serializeRule(rule), 2));
  }
  if (state.display !== "timeline") lines.push(`sort: ${state.sort}`);
  lines.push(`display: ${state.display}`);
  if (!state.showModified) lines.push("show-modified: false");
  if ((state.display === "cards" || state.display === "list") && !state.showExtensions) {
    lines.push("show-extensions: false");
  }
  if (state.previewPane) lines.push("preview-pane: true");
  if (state.display === "kanban" && state.kanbanField.trim()) {
    lines.push(`kanban-field: ${state.kanbanField.trim()}`);
  }
  lines.push("```");
  return lines.join("\n");
}

/**
 * Current state held by a mounted select form. Returned by `mountSelectForm`
 * so the host modal can call `buildSelectFenceFromState(getState())` when
 * the user clicks Save.
 */
export interface SelectFormState {
  rules: SmartFolderRule[];
  path: string;
  display: DisplayKind;
  sort: string;
  showModified: boolean;
  showExtensions: boolean;
  previewPane: boolean;
  kanbanField: string;
}

/**
 * Mount the select form (path + filter rows + display picker + per-display
 * options) into the supplied container. Returns a `getState()` accessor the
 * host modal calls when the user confirms — the host then passes the state
 * to `buildSelectFenceFromState` to produce the final ```select fence.
 *
 * The styles for `.sb-*` classes are injected on first call. This function
 * is the single source of truth for the select form UI — both
 * `openSelectBuilderModal` (legacy) and the unified codeblock modal use it.
 */
export function mountSelectForm(
  container: HTMLElement,
  opts: {
    initial?: SelectBuilderInitial;
    ruleRowContext?: RuleRowContext;
  } = {},
): { getState: () => SelectFormState } {
  injectStyles();

  const ruleCtx: RuleRowContext = opts.ruleRowContext ?? {
    knownTags: [],
    distinctExtensions: [],
  };
  const initial = opts.initial ?? {};
  const state: SelectFormState = {
    rules:          [...(initial.rules ?? [])] as SmartFolderRule[],
    path:           initial.path ?? "./",
    display:        (initial.display ?? "cards") as DisplayKind,
    sort:           initial.sort ?? "name-asc",
    showModified:   initial.showModified ?? true,
    showExtensions: initial.showExtensions ?? true,
    previewPane:    initial.previewPane ?? false,
    kanbanField:    initial.kanbanField ?? "",
  };

  // ── Path section ───────────────────────────────────────────────────────────
  const pathSec = section("Path");
  const pathCaption = document.createElement("div");
  pathCaption.className = "sb-section-caption";
  pathCaption.textContent = "Select files to display";
  pathSec.appendChild(pathCaption);
  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.placeholder = "./";
  pathInput.value = state.path;
  pathInput.className = "settings-input";
  pathInput.style.cssText = "width:100%;padding:6px 8px;font-size:12px;background:var(--bg-secondary,#2a2a3a);color:var(--text-primary,#e0e0e0);border:1px solid var(--border-color,#444);border-radius:4px;";
  pathInput.addEventListener("input", () => { state.path = pathInput.value; });
  pathSec.appendChild(pathInput);
  container.appendChild(pathSec);

  // ── Filter section ─────────────────────────────────────────────────────────
  const filterSec = section("Filter");
  const rulesList = document.createElement("ul");
  rulesList.className = "sb-rules-list";
  filterSec.appendChild(rulesList);

  function rebuildRows(): void {
    rulesList.innerHTML = "";
    if (state.rules.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sb-rules-empty";
      empty.textContent = "Show all files";
      rulesList.appendChild(empty);
      return;
    }
    for (let i = 0; i < state.rules.length; i++) {
      const idx = i;
      const row = buildRuleRow(
        state.rules[idx],
        ruleCtx,
        (next) => { state.rules[idx] = next; },
        () => { state.rules.splice(idx, 1); rebuildRows(); },
        () => {
          const firstOp = OPERATORS_BY_TYPE["tag"][0];
          const blank = { type: "tag", operator: firstOp, value: "" } as SmartFolderRule;
          state.rules.splice(idx + 1, 0, blank);
          rebuildRows();
        },
        true,
      );
      rulesList.appendChild(row);
    }
  }
  rebuildRows();

  const addRuleBtn = document.createElement("button");
  addRuleBtn.type = "button";
  addRuleBtn.className = "sb-add-rule";
  addRuleBtn.textContent = "+ Add filter";
  addRuleBtn.addEventListener("click", () => {
    const firstOp = OPERATORS_BY_TYPE["tag"][0];
    state.rules.push({ type: "tag", operator: firstOp, value: "" } as SmartFolderRule);
    rebuildRows();
  });
  filterSec.appendChild(addRuleBtn);
  container.appendChild(filterSec);

  // ── Display section ────────────────────────────────────────────────────────
  const displaySec = section("Display");
  const pills = document.createElement("div");
  pills.className = "sb-display-pills";
  displaySec.appendChild(pills);

  const optsHost = document.createElement("div");
  optsHost.className = "sb-opts";
  displaySec.appendChild(optsHost);

  function renderDisplayOptions(): void {
    optsHost.innerHTML = "";

    if (state.display !== "timeline") {
      const sortRow = document.createElement("div");
      sortRow.className = "sb-opt-row";
      const label = document.createElement("label");
      label.textContent = "Sort";
      const sel = document.createElement("select");
      const sortOptions: Array<{ value: string; label: string }> = [
        { value: "name-asc",      label: "Name ↑" },
        { value: "name-desc",     label: "Name ↓" },
        { value: "modified-asc",  label: "Date ↑" },
        { value: "modified-desc", label: "Date ↓" },
      ];
      for (const o of sortOptions) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === state.sort) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => { state.sort = sel.value; });
      sortRow.appendChild(label);
      sortRow.appendChild(sel);
      optsHost.appendChild(sortRow);
    }

    optsHost.appendChild(checkRow("Show modified date", state.showModified, (v) => { state.showModified = v; }));

    if (state.display === "cards" || state.display === "list") {
      optsHost.appendChild(checkRow("Show file extensions", state.showExtensions, (v) => { state.showExtensions = v; }));
    }

    optsHost.appendChild(checkRow("Preview pane above results", state.previewPane, (v) => { state.previewPane = v; }));

    if (state.display === "kanban") {
      const row = document.createElement("div");
      row.className = "sb-opt-row";
      const label = document.createElement("label");
      label.textContent = "Kanban field";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = "status";
      inp.value = state.kanbanField;
      inp.addEventListener("input", () => { state.kanbanField = inp.value; });
      row.appendChild(label);
      row.appendChild(inp);
      optsHost.appendChild(row);
    }
  }

  for (const d of ALL_DISPLAYS) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "sb-display-pill" + (d === state.display ? " is-active" : "");
    pill.textContent = DISPLAY_LABELS[d];
    pill.addEventListener("click", () => {
      state.display = d;
      pills.querySelectorAll(".sb-display-pill").forEach((p) =>
        p.classList.toggle("is-active", (p as HTMLElement).textContent === DISPLAY_LABELS[d]),
      );
      renderDisplayOptions();
    });
    pills.appendChild(pill);
  }
  renderDisplayOptions();
  container.appendChild(displaySec);

  return { getState: () => state };
}

// ── Modal opener (legacy, retained for direct callers) ──────────────────────

export function openSelectBuilderModal(opts: SelectBuilderOptions): void {
  if (document.getElementById(OVERLAY_ID)) return;
  injectStyles();

  // ── DOM shell ──────────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "sb-overlay";

  const backdrop = document.createElement("div");
  backdrop.className = "sb-backdrop";
  backdrop.addEventListener("click", close);
  overlay.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "sb-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Select block builder");
  overlay.appendChild(panel);

  // Header
  const header = document.createElement("div");
  header.className = "sb-header";
  const title = document.createElement("div");
  title.className = "sb-title";
  title.textContent = opts.initial ? "Edit Select Block" : "Insert Select Block";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.className = "sb-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Body — mount the shared form
  const body = document.createElement("div");
  body.className = "sb-body";
  panel.appendChild(body);

  const form = mountSelectForm(body, { initial: opts.initial, ruleRowContext: opts.ruleRowContext });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "sb-footer";
  panel.appendChild(footer);

  const footerLeft = document.createElement("div");
  footerLeft.className = "sb-footer-left";
  if (opts.onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.className = "sb-btn sb-btn-danger";
    removeBtn.textContent = "Remove block";
    removeBtn.addEventListener("click", () => {
      close();
      opts.onRemove?.();
    });
    footerLeft.appendChild(removeBtn);
  }
  footer.appendChild(footerLeft);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "sb-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);
  footer.appendChild(cancelBtn);

  const saveBtn = document.createElement("button");
  saveBtn.className = "sb-btn sb-btn-primary";
  saveBtn.textContent = opts.initial ? "Save" : "Insert";
  saveBtn.addEventListener("click", () => {
    const fence = buildSelectFenceFromState(form.getState());
    close();
    opts.onApply(fence);
  });
  footer.appendChild(saveBtn);

  document.body.appendChild(overlay);

  attachModalKeyboard({ modal: overlay, onClose: close });

  function close(): void {
    document.getElementById(OVERLAY_ID)?.remove();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function section(labelText: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "sb-section";
  const label = document.createElement("div");
  label.className = "sb-section-label";
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}

function checkRow(labelText: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "sb-opt-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  row.appendChild(cb);
  row.appendChild(document.createTextNode(labelText));
  return row;
}
