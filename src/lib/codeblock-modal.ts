/**
 * codeblock-modal.ts — Insert or Edit CodeBlock.
 *
 * Unified entry point for inserting any of our custom codefences:
 *   - Sidebar (```sidebar / ```sidebar-left) — floating callout
 *   - Grid (```grid / ```grid-card) — NxM cell grid
 *   - Select (```select) — file collection driven by filter rules
 *
 * The modal shows a type picker at the top; the form below changes to match
 * the chosen type. Sidebar and Grid forms are inline. Picking Select hands
 * off to the existing `openSelectBuilderModal` so we don't duplicate that
 * UI — same UX as today, just a different entry path.
 *
 * Cursor-aware edit: when the caller passes `initial.detected`, the picker
 * starts on the matching type and the form is pre-populated.
 */

import { attachModalKeyboard } from "./modal-keyboard";
import {
  buildSelectFenceFromState,
  mountSelectForm,
  type SelectBuilderInitial,
  type SelectFormState,
} from "./select-builder";
import { buildGridStarterFence } from "./layout-manager";
import type { RuleRowContext } from "./rule-row";

const OVERLAY_ID = "__codeblock-modal-overlay__";
const STYLE_ID   = "__cbm-styles__";

const STYLES = `
.cbm-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 8vh;
  font-family: var(--ui-font, -apple-system, sans-serif);
}
.cbm-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(2px); }
.cbm-panel {
  position: relative; z-index: 1;
  width: min(640px, 90vw); max-height: 84vh; overflow: hidden;
  background: var(--bg-primary, #1d1d2a);
  border: 1px solid var(--border-color, rgba(255,255,255,.12));
  border-radius: 10px; box-shadow: 0 16px 48px rgba(0,0,0,.5);
  display: flex; flex-direction: column; color: var(--text-primary, #e0e0e0);
}
.cbm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.cbm-title { font-size: 14px; font-weight: 600; }
.cbm-close {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-secondary, #aaa); font-size: 22px; line-height: 1;
}
.cbm-close:hover { color: var(--text-primary, #fff); }
.cbm-body { padding: 14px 18px; overflow-y: auto; }
.cbm-section { margin-bottom: 16px; }
.cbm-section-label {
  font-size: 11px; font-weight: 600; letter-spacing: .04em;
  color: var(--text-tertiary, #888);
  text-transform: uppercase; margin-bottom: 6px;
}
.cbm-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.cbm-tab {
  padding: 7px 16px; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  cursor: pointer; user-select: none;
  border: none; background: transparent;
  color: var(--text-tertiary, #666);
}
.cbm-tab:hover { color: var(--text-secondary, #aaa); }
.cbm-tab.is-active {
  background: var(--bg-secondary, rgba(255,255,255,.06));
  color: var(--text-primary, #fff);
}
.cbm-type-desc {
  font-size: 11px; color: var(--text-tertiary, #888);
  font-style: italic; margin-top: 4px; margin-bottom: 10px;
}

.cbm-form-row {
  display: flex; gap: 8px; align-items: center;
  font-size: 12px; color: var(--text-secondary, #aaa);
  margin-bottom: 8px;
}
.cbm-form-row label { flex-shrink: 0; }
.cbm-form-row input, .cbm-form-row select, .cbm-form-row textarea {
  font-size: 12px; padding: 5px 8px;
  background: var(--bg-secondary, #2a2a3a);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  font-family: inherit;
}
.cbm-form-row input[type="number"] { width: 72px; }
.cbm-form-row textarea { width: 100%; min-height: 100px; resize: vertical; font-family: var(--mono-font, ui-monospace, SFMono-Regular, monospace); }
.cbm-pill-row { display: flex; gap: 6px; }
.cbm-pill {
  padding: 5px 12px; border-radius: 14px; font-size: 11.5px;
  cursor: pointer; user-select: none;
  border: 1px solid var(--border-color, rgba(255,255,255,.15));
  color: var(--text-secondary, #aaa); background: transparent;
}
.cbm-pill:hover { color: var(--text-primary, #e0e0e0); background: var(--bg-hover, rgba(255,255,255,.06)); }
.cbm-pill.is-active {
  background: var(--link-color, #4a9eff); border-color: transparent; color: #fff;
}

.cbm-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.cbm-footer-left { margin-right: auto; }
.cbm-btn {
  font-size: 13px; padding: 5px 14px; border-radius: 5px;
  border: 1px solid var(--border-color, #444);
  background: transparent; color: var(--text-primary, #e0e0e0); cursor: pointer;
}
.cbm-btn:hover { background: var(--bg-hover, rgba(255,255,255,.06)); }
.cbm-btn-primary {
  background: var(--link-color, #4a9eff); border-color: var(--link-color, #4a9eff); color: #fff;
}
.cbm-btn-primary:hover { opacity: 0.92; }
.cbm-btn-danger { color: var(--text-danger, #e66); }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES.trim();
  document.head.appendChild(style);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type BlockKind = "sidebar" | "grid" | "select";

export interface SidebarFormState { side: "right" | "left"; body: string; }
export interface GridFormState { cols: number; rows: number; cellStyle: "grid" | "grid-card"; }

export interface CodeBlockModalOptions {
  /** Pre-fill values when editing an existing block. */
  initial?: {
    kind: BlockKind;
    sidebar?: SidebarFormState;
    grid?: GridFormState;
    select?: SelectBuilderInitial;
  };
  onApply: (fence: string) => void;
  onRemove?: () => void;
  /** Forwarded to the select-builder when the user picks Select. */
  ruleRowContext?: RuleRowContext;
}

// ── Fence builders ───────────────────────────────────────────────────────────

export function buildSidebarFence(s: SidebarFormState): string {
  const lang = s.side === "left" ? "sidebar-left" : "sidebar";
  const body = s.body.trim() || "Side note.";
  return ["```" + lang, body, "```"].join("\n");
}

export function buildGridFence(g: GridFormState): string {
  return buildGridStarterFence({ cols: g.cols, rows: g.rows, cellStyle: g.cellStyle });
}

// ── Modal opener ─────────────────────────────────────────────────────────────

const TYPES: Array<{ kind: BlockKind; label: string; desc: string }> = [
  // Select's description moved into the Select form itself (under PATH), so
  // its type-pill description is intentionally empty.
  { kind: "select",  label: "Select",  desc: "" },
  { kind: "sidebar", label: "Sidebar", desc: "Floating callout pinned to the left or right." },
  { kind: "grid",    label: "Grid",    desc: "NxM cell grid with editable markdown per cell." },
];

export function openCodeBlockModal(opts: CodeBlockModalOptions): void {
  if (document.getElementById(OVERLAY_ID)) return;
  injectStyles();

  // ── State ──────────────────────────────────────────────────────────────────
  let kind: BlockKind = opts.initial?.kind ?? "select";

  const sidebarState: SidebarFormState = {
    side: opts.initial?.sidebar?.side ?? "right",
    body: opts.initial?.sidebar?.body ?? "",
  };
  const gridState: GridFormState = {
    cols:      opts.initial?.grid?.cols      ?? 3,
    rows:      opts.initial?.grid?.rows      ?? 3,
    cellStyle: opts.initial?.grid?.cellStyle ?? "grid",
  };
  // Lazy mount the select form; getState set after first render.
  let selectGetState: (() => SelectFormState) | null = null;

  // ── DOM ────────────────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "cbm-overlay";

  const backdrop = document.createElement("div");
  backdrop.className = "cbm-backdrop";
  backdrop.addEventListener("click", close);
  overlay.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "cbm-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Insert or Edit CodeBlock");
  overlay.appendChild(panel);

  // Header
  const header = document.createElement("div");
  header.className = "cbm-header";
  const titleEl = document.createElement("div");
  titleEl.className = "cbm-title";
  titleEl.textContent = opts.initial ? "Edit CodeBlock" : "Insert CodeBlock";
  header.appendChild(titleEl);
  const closeBtn = document.createElement("button");
  closeBtn.className = "cbm-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "cbm-body";
  panel.appendChild(body);

  // ── Type tabs (no "TYPE" section label — the tabs make context obvious)
  const tabs = document.createElement("div");
  tabs.className = "cbm-tabs";
  tabs.setAttribute("role", "tablist");
  body.appendChild(tabs);
  const typeDesc = document.createElement("div");
  typeDesc.className = "cbm-type-desc";
  body.appendChild(typeDesc);

  // ── Form host (no section label — the type pills above make context obvious)
  const formHost = document.createElement("div");
  formHost.className = "cbm-section";
  body.appendChild(formHost);

  function renderForm(): void {
    formHost.innerHTML = "";
    selectGetState = null;
    typeDesc.textContent = TYPES.find((t) => t.kind === kind)?.desc ?? "";
    if (kind === "sidebar") renderSidebarForm();
    else if (kind === "grid") renderGridForm();
    else if (kind === "select") renderSelectForm();
    tabs.querySelectorAll(".cbm-tab").forEach((t) => {
      const tabKind = (t as HTMLElement).dataset.kind as BlockKind | undefined;
      t.classList.toggle("is-active", tabKind === kind);
      t.setAttribute("aria-selected", String(tabKind === kind));
    });
  }

  function renderSidebarForm(): void {
    const sideRow = document.createElement("div");
    sideRow.className = "cbm-form-row";
    const sideLabel = document.createElement("label");
    sideLabel.textContent = "Side";
    sideRow.appendChild(sideLabel);
    const sidePills = document.createElement("div");
    sidePills.className = "cbm-pill-row";
    const sides: Array<{ value: "right" | "left"; label: string }> = [
      { value: "right", label: "Right" },
      { value: "left",  label: "Left" },
    ];
    for (const s of sides) {
      const p = document.createElement("button");
      p.type = "button";
      p.className = "cbm-pill" + (s.value === sidebarState.side ? " is-active" : "");
      p.textContent = s.label;
      p.addEventListener("click", () => {
        sidebarState.side = s.value;
        sidePills.querySelectorAll(".cbm-pill").forEach((x) =>
          x.classList.toggle("is-active", (x as HTMLElement).textContent === s.label),
        );
      });
      sidePills.appendChild(p);
    }
    sideRow.appendChild(sidePills);
    formHost.appendChild(sideRow);

    const bodyRow = document.createElement("div");
    bodyRow.className = "cbm-form-row";
    bodyRow.style.flexDirection = "column";
    bodyRow.style.alignItems = "stretch";
    const bodyLabel = document.createElement("label");
    bodyLabel.textContent = "Markdown body";
    bodyRow.appendChild(bodyLabel);
    const bodyArea = document.createElement("textarea");
    bodyArea.placeholder = "## Pro tip\n\nText here renders inside the sidebar.";
    bodyArea.value = sidebarState.body;
    bodyArea.addEventListener("input", () => { sidebarState.body = bodyArea.value; });
    bodyRow.appendChild(bodyArea);
    formHost.appendChild(bodyRow);
  }

  function renderGridForm(): void {
    const dimRow = document.createElement("div");
    dimRow.className = "cbm-form-row";
    const dimLabel = document.createElement("label");
    dimLabel.textContent = "Size";
    dimRow.appendChild(dimLabel);
    const colsInput = document.createElement("input");
    colsInput.type = "number";
    colsInput.min = "1";
    colsInput.max = "12";
    colsInput.value = String(gridState.cols);
    colsInput.addEventListener("input", () => {
      const n = parseInt(colsInput.value, 10);
      if (Number.isFinite(n) && n >= 1) gridState.cols = n;
    });
    const times = document.createElement("span");
    times.textContent = "×";
    times.style.color = "var(--text-tertiary, #666)";
    const rowsInput = document.createElement("input");
    rowsInput.type = "number";
    rowsInput.min = "1";
    rowsInput.max = "12";
    rowsInput.value = String(gridState.rows);
    rowsInput.addEventListener("input", () => {
      const n = parseInt(rowsInput.value, 10);
      if (Number.isFinite(n) && n >= 1) gridState.rows = n;
    });
    dimRow.appendChild(colsInput);
    dimRow.appendChild(times);
    dimRow.appendChild(rowsInput);
    formHost.appendChild(dimRow);

    const styleRow = document.createElement("div");
    styleRow.className = "cbm-form-row";
    const styleLabel = document.createElement("label");
    styleLabel.textContent = "Cell style";
    styleRow.appendChild(styleLabel);
    const stylePills = document.createElement("div");
    stylePills.className = "cbm-pill-row";
    const styles: Array<{ value: "grid" | "grid-card"; label: string }> = [
      { value: "grid",      label: "Plain" },
      { value: "grid-card", label: "Card" },
    ];
    for (const st of styles) {
      const p = document.createElement("button");
      p.type = "button";
      p.className = "cbm-pill" + (st.value === gridState.cellStyle ? " is-active" : "");
      p.textContent = st.label;
      p.addEventListener("click", () => {
        gridState.cellStyle = st.value;
        stylePills.querySelectorAll(".cbm-pill").forEach((x) =>
          x.classList.toggle("is-active", (x as HTMLElement).textContent === st.label),
        );
      });
      stylePills.appendChild(p);
    }
    styleRow.appendChild(stylePills);
    formHost.appendChild(styleRow);
  }

  function renderSelectForm(): void {
    const mounted = mountSelectForm(formHost, {
      initial: opts.initial?.select,
      ruleRowContext: opts.ruleRowContext,
    });
    selectGetState = mounted.getState;
  }

  for (const t of TYPES) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.className = "cbm-tab" + (t.kind === kind ? " is-active" : "");
    tab.textContent = t.label;
    tab.dataset.kind = t.kind;
    tab.addEventListener("click", () => { kind = t.kind; renderForm(); });
    tabs.appendChild(tab);
  }
  renderForm();

  // Footer
  const footer = document.createElement("div");
  footer.className = "cbm-footer";
  panel.appendChild(footer);
  const footerLeft = document.createElement("div");
  footerLeft.className = "cbm-footer-left";
  if (opts.onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.className = "cbm-btn cbm-btn-danger";
    removeBtn.textContent = "Remove block";
    removeBtn.addEventListener("click", () => {
      close();
      opts.onRemove?.();
    });
    footerLeft.appendChild(removeBtn);
  }
  footer.appendChild(footerLeft);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cbm-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);
  footer.appendChild(cancelBtn);

  const primaryBtn = document.createElement("button");
  primaryBtn.className = "cbm-btn cbm-btn-primary";
  primaryBtn.textContent = opts.initial ? "Save" : "Insert";
  primaryBtn.addEventListener("click", () => {
    let fence: string;
    if (kind === "sidebar") {
      fence = buildSidebarFence(sidebarState);
    } else if (kind === "grid") {
      fence = buildGridFence(gridState);
    } else if (kind === "select") {
      if (!selectGetState) return;
      fence = buildSelectFenceFromState(selectGetState());
    } else {
      return;
    }
    close();
    opts.onApply(fence);
  });
  footer.appendChild(primaryBtn);

  document.body.appendChild(overlay);

  attachModalKeyboard({
    modal: overlay,
    onClose: close,
  });

  function close(): void {
    document.getElementById(OVERLAY_ID)?.remove();
  }
}

