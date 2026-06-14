/**
 * codeblock-modal.ts — Unified View Modal.
 *
 * Single entry point for picking a file-collection layout (Cards,
 * Table, Collection, Timeline, Kanban, Bookshelf) and producing a
 * `select` codefence. Triggered from two contexts:
 *
 *   - Right-click → "Folder View" on a folder in the file browser.
 *     `openViewModal("create" | "edit", { folderPath, ... })`.
 *   - In-doc "Insert CodeBlock" command on an `.md` editor.
 *     `openViewModal("insert" | "edit", { editor, ... })`.
 *
 * Submit writes `_folder.md` via `writeFolderMdCodeblock` (step_02)
 * for folder-context modes, or dispatches `view.dispatch(...)` for
 * in-doc modes.
 *
 * The legacy type-picker modal (Select / Sidebar / Grid tabs) was
 * deleted in step_09 of the view-modal feature. Sidebar and grid
 * codefences now use the `/sidebar` and `/grid` slash commands
 * (registered in `src/editor/quick-commands.ts` step_07).
 *
 * History: this file was named `codeblock-modal.ts` when it hosted
 * the multi-type picker. The file path is preserved so the six
 * `src/main.ts` import sites do not need to be re-pathed; a future
 * polish-pass may rename it to `view-modal.ts`.
 */

import { attachModalKeyboard } from "./modal-keyboard";
import {
  buildSelectFenceFromState,
  type SelectBuilderInitial,
  type SelectFormState,
  type ContentWidth,
} from "./select-builder";
import type { RuleRowContext } from "./rule-row";
import type { EditorView } from "@codemirror/view";
import type { SmartFolderRule } from "../plugins/file-browser/smart-folders/types";
import {
  VIEW_MODAL_ILLUSTRATIONS,
  VIEW_MODAL_TAB_ORDER,
  type ViewModalLayoutKey,
} from "./view-modal-illustrations";
import { isAnyModalOpen } from "./active-modal";

/**
 * Sentinel id for the legacy modal's overlay. Kept around so
 * `active-modal.ts`'s sentinel list does not need a rename; the new
 * View Modal uses a different id (`VIEW_MODAL_OVERLAY_ID`).
 */
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
/* step_09 (view-modal): the legacy type-picker CSS classes were
   deleted with the legacy modal. The View Modal uses its own
   prefix (defined in VIEW_MODAL_STYLES below). */

.cbm-form-row {
  display: flex; gap: 8px; align-items: center;
  font-size: 12px; color: var(--text-secondary, #aaa);
  margin-bottom: 8px;
}
.cbm-form-row label { flex-shrink: 0; }
.cbm-form-row input, .cbm-form-row select, .cbm-form-row textarea {
  font-size: 12px; padding: 5px 8px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 4px;
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


// ─────────────────────────────────────────────────────────────────────────────
// Unified View Modal (step_04 / AD-1)
// ─────────────────────────────────────────────────────────────────────────────
//
// `openViewModal` repurposes this file as the canonical Unified View
// Modal entry point. The legacy `openCodeBlockModal` above stays in
// place until step_09 to keep the six `main.ts` import sites green.
//
// Design (per `docs/specs/view-modal/00_index.md`):
//   - One modal, two contexts (right-click create / in-doc insert /
//     edit existing).
//   - Six layout tabs: Cards, Table, Collection, Timeline, Kanban,
//     Bookshelf. Tab order is fixed (FR-10).
//   - Preview area on top (60-65% vertical), tab strip middle, two-column
//     config row below (Path/Filter/Sort left; toggles + Content Width
//     right). Footer with Cancel + action button.
//   - All `_folder.md` writes go through `writeFolderMdCodeblock`
//     (step_02). In-doc insert builds a fence via
//     `buildSelectFenceFromState` and dispatches into the editor.
//   - The legacy `mountSelectForm` is NOT mounted; the modal builds its
//     own DOM and reuses small primitives (`buildSelectFenceFromState`,
//     `buildRuleRow`) so the visual layout matches the mockup exactly.

/** DOM id of the modal overlay. Exported so tests can locate it. */
export const VIEW_MODAL_OVERLAY_ID = "__view-modal-overlay__";

/** DOM id of the modal's injected CSS sentinel. */
const VIEW_MODAL_STYLE_ID = "__vm-styles__";

/** Mode the modal opens in. Drives title bar text and action button label. */
export type ViewModalMode = "create" | "insert" | "edit";

/**
 * Context the caller supplies. `folderPath` is the target for create /
 * edit modes; `editor` is the host for insert mode. `initial` carries
 * prefill values for edit mode. `ruleRowContext` threads tag /
 * extension autocomplete data into the filter row.
 */
export interface ViewModalContext {
  /** Vault-relative folder path (create / edit-folder modes). */
  folderPath?: string;
  /** Host editor view + selection range (insert / edit-codeblock modes). */
  editor?: { view: EditorView; from: number; to: number };
  /** Prefill state for edit mode. */
  initial?: SelectBuilderInitial;
  /** Tag and extension autocomplete suggestions for filter rows. */
  ruleRowContext?: RuleRowContext;
  /**
   * Optional callback fired after the user clicks the action button and
   * the modal has built the codefence body. Used in step_05 to wire
   * the file write / editor dispatch. Returning false aborts close.
   */
  onSubmit?: (state: SelectFormState, mode: ViewModalMode) => void;
}

/**
 * Internal modal state. Held in a module-scoped variable so the
 * `emitViewModalFence` / `getViewModalState` test hooks can introspect.
 * Set to null when the modal is closed.
 */
let currentViewModalState: {
  state: SelectFormState;
  activeTab: ViewModalLayoutKey;
} | null = null;

/* VIEW_MODAL_STYLES_BEGIN */
/**
 * CSS for the View Modal's preview area, tab strip, two-column config
 * row, and toggle / width-pill rows. Theme tokens only (NFR-5 / EC-15)
 * — the css.test.ts grep audits this block for hex literals.
 */
const VIEW_MODAL_STYLES = `
.vm-preview {
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin: 0 0 14px 0;
  min-height: 240px;
  color: var(--text-secondary);
}
.vm-preview svg { width: 100%; max-width: 380px; height: auto; max-height: 240px; }
.vm-tabs {
  display: flex; gap: 4px; margin-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 10px;
}
.vm-tab {
  padding: 7px 14px; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  cursor: pointer; user-select: none;
  border: 1px solid transparent; background: transparent;
  color: var(--text-tertiary);
}
.vm-tab:hover { color: var(--text-secondary); background: var(--bg-hover); }
.vm-tab.is-active {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-color);
}
.vm-config-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.vm-col-left, .vm-col-right { display: flex; flex-direction: column; gap: 14px; }
.vm-field-label {
  font-size: 11px; font-weight: 600; letter-spacing: .04em;
  color: var(--text-tertiary);
  text-transform: uppercase;
  margin-bottom: 5px;
}
.vm-field-caption {
  font-size: 11px; color: var(--text-tertiary);
  font-style: italic; margin-top: 3px;
}
.vm-input, .vm-select {
  width: 100%; box-sizing: border-box;
  font-size: 12px; padding: 6px 8px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 4px;
  font-family: inherit;
}
.vm-filter-status {
  font-size: 12px; color: var(--text-secondary);
  margin-bottom: 6px;
}
.vm-add-filter {
  font-size: 12px; padding: 5px 12px; border-radius: 5px;
  border: 1px solid var(--border-color);
  background: transparent; color: var(--text-secondary);
  cursor: pointer; font-family: inherit;
}
.vm-add-filter:hover { color: var(--text-primary); background: var(--bg-hover); }
.vm-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--text-secondary);
}
.vm-toggle-row label { user-select: none; cursor: pointer; }
.vm-width-pills { display: flex; gap: 6px; }
.vm-width-pill {
  padding: 5px 12px; border-radius: 14px; font-size: 11.5px;
  cursor: pointer; user-select: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary); background: transparent;
  font-family: inherit;
}
.vm-width-pill:hover { color: var(--text-primary); background: var(--bg-hover); }
.vm-width-pill.is-active {
  /* NFR-5: theme-token only. The link-color background gets light text
     in both light and dark themes because --text-primary inverts with
     the theme; this matches the existing .cbm-pill.is-active intent
     without introducing a new on-accent token. */
  background: var(--link-color); border-color: transparent; color: var(--text-primary);
}
`;
/* VIEW_MODAL_STYLES_END */

function injectViewModalStyles(): void {
  if (document.getElementById(VIEW_MODAL_STYLE_ID)) return;
  // Reuse the existing cbm-* injection so the chrome classes the modal
  // depends on (cbm-overlay, cbm-panel, cbm-header, cbm-footer,
  // cbm-btn, cbm-btn-primary) are always present.
  injectStyles();
  const style = document.createElement("style");
  style.id = VIEW_MODAL_STYLE_ID;
  style.textContent = VIEW_MODAL_STYLES.trim();
  document.head.appendChild(style);
}

/**
 * Build the title bar text for a (mode, ctx) pair per Q-1.
 *   - create → "New Folder View"
 *   - insert → "Insert Codeblock"
 *   - edit + folderPath → "Edit Folder View"
 *   - edit + editor → "Edit Codeblock"
 */
function titleForMode(mode: ViewModalMode, ctx: ViewModalContext): string {
  if (mode === "create") return "New Folder View";
  if (mode === "insert") return "Insert Codeblock";
  return ctx.folderPath != null ? "Edit Folder View" : "Edit Codeblock";
}

/**
 * Build the action button label for a mode per FR-40.
 *   - create → "Create" / insert → "Insert" / edit → "Save".
 */
function actionLabelForMode(mode: ViewModalMode): string {
  if (mode === "create") return "Create";
  if (mode === "insert") return "Insert";
  return "Save";
}

/**
 * Open the Unified View Modal. Idempotent: a second call while the
 * modal is open is a no-op.
 *
 * Step_04 surface: builds the DOM and wires the form controls so
 * Path / Sort / toggles / Content Width / tab selection persist into
 * the modal's `SelectFormState`. Submit wiring (writeFolderMdCodeblock
 * for create/edit-folder, view.dispatch for insert/edit-codeblock) is
 * deferred to step_05; this step's submit is a no-op or a callback
 * via `ctx.onSubmit` (used by tests).
 */
export function openViewModal(mode: ViewModalMode, ctx: ViewModalContext): void {
  // EC-12 / AD-8: refuse to stack on any other open modal. Silent no-op
  // — no toast, no console log. The check covers the View Modal's own
  // overlay id too, so a double-open is also a no-op.
  if (isAnyModalOpen()) return;
  if (document.getElementById(VIEW_MODAL_OVERLAY_ID)) return;
  injectViewModalStyles();

  // ── Initial state ──────────────────────────────────────────────────────
  const initial: SelectBuilderInitial = ctx.initial ?? {};
  // Default display: Cards (FR-11). For edit mode, prefilled `initial.display`
  // selects the matching tab; if absent, default to Cards.
  const initialDisplay = (initial.display as ViewModalLayoutKey | undefined) ?? "cards";
  // Validate that the initial display is one of our six tab slugs;
  // anything else (legacy aliases like "view-cards") falls back to Cards.
  const TAB_SLUGS = new Set<string>(VIEW_MODAL_TAB_ORDER.map((t) => t.slug));
  const activeTabInitial: ViewModalLayoutKey = TAB_SLUGS.has(initialDisplay)
    ? initialDisplay
    : "cards";

  const state: SelectFormState = {
    rules: [...(initial.rules ?? [])] as SmartFolderRule[],
    path: initial.path ?? "./",
    display: activeTabInitial,
    displayOption: initial.displayOption ?? "",
    groupBy: initial.groupBy ?? "",
    sort: initial.sort ?? "name-asc",
    order: [...(initial.order ?? [])],
    // Q-2 / FR-31 — fresh-mode defaults flip all three toggles ON.
    // Edit mode honours the prefilled values via `??` fallback.
    showModified: initial.showModified ?? true,
    showExtensions: initial.showExtensions ?? true,
    previewPane: initial.previewPane ?? true,
    kanbanField: initial.kanbanField ?? "",
    contentWidth: initial.contentWidth ?? "normal",
  };

  let activeTab: ViewModalLayoutKey = activeTabInitial;

  // ── DOM construction ───────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = VIEW_MODAL_OVERLAY_ID;
  overlay.className = "cbm-overlay";

  const backdrop = document.createElement("div");
  backdrop.className = "cbm-backdrop";
  backdrop.addEventListener("click", close);
  overlay.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "cbm-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", titleForMode(mode, ctx));
  overlay.appendChild(panel);

  // Header
  const header = document.createElement("div");
  header.className = "cbm-header";
  const titleEl = document.createElement("div");
  titleEl.className = "cbm-title";
  titleEl.textContent = titleForMode(mode, ctx);
  header.appendChild(titleEl);
  const closeBtn = document.createElement("button");
  closeBtn.className = "cbm-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "cbm-body";
  panel.appendChild(body);

  // Preview area
  const previewHost = document.createElement("div");
  previewHost.className = "vm-preview";
  previewHost.innerHTML = VIEW_MODAL_ILLUSTRATIONS[activeTab];
  body.appendChild(previewHost);

  // Tab strip
  const tabs = document.createElement("div");
  tabs.className = "vm-tabs";
  tabs.setAttribute("role", "tablist");
  for (const t of VIEW_MODAL_TAB_ORDER) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "vm-tab" + (t.slug === activeTab ? " is-active" : "");
    tab.dataset.slug = t.slug;
    tab.textContent = t.label;
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => {
      activeTab = t.slug;
      state.display = t.slug;
      // Update preview synchronously — no async work, no rAF (EC-18).
      previewHost.innerHTML = VIEW_MODAL_ILLUSTRATIONS[t.slug];
      // Flip is-active on all tabs.
      for (const el of Array.from(tabs.querySelectorAll<HTMLElement>(".vm-tab"))) {
        el.classList.toggle("is-active", el.dataset.slug === t.slug);
      }
      // Mirror to module-scoped state so test hooks see fresh values.
      if (currentViewModalState) currentViewModalState.activeTab = t.slug;
    });
    tabs.appendChild(tab);
  }
  body.appendChild(tabs);

  // Config row — two columns.
  const configRow = document.createElement("div");
  configRow.className = "vm-config-row";
  const leftCol = document.createElement("div");
  leftCol.className = "vm-col-left";
  const rightCol = document.createElement("div");
  rightCol.className = "vm-col-right";
  configRow.appendChild(leftCol);
  configRow.appendChild(rightCol);
  body.appendChild(configRow);

  // ── Left column: Path / Filter / Sort ──────────────────────────────────

  // Path
  const pathField = document.createElement("div");
  const pathLabel = document.createElement("div");
  pathLabel.className = "vm-field-label";
  pathLabel.textContent = "Path (select files to display)";
  pathField.appendChild(pathLabel);
  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "vm-input";
  pathInput.placeholder = "./";
  pathInput.value = state.path;
  pathInput.dataset.vmField = "path";
  pathInput.addEventListener("input", () => {
    state.path = pathInput.value;
  });
  pathField.appendChild(pathInput);
  leftCol.appendChild(pathField);

  // Filter
  const filterField = document.createElement("div");
  const filterLabel = document.createElement("div");
  filterLabel.className = "vm-field-label";
  filterLabel.textContent = "Filter";
  filterField.appendChild(filterLabel);
  const filterStatus = document.createElement("div");
  filterStatus.className = "vm-filter-status";
  filterStatus.dataset.vmField = "filter-status";
  filterField.appendChild(filterStatus);
  const addFilterBtn = document.createElement("button");
  addFilterBtn.type = "button";
  addFilterBtn.className = "vm-add-filter";
  addFilterBtn.textContent = "+ Add filter";
  addFilterBtn.addEventListener("click", () => {
    // Step_05 wires this to the existing smart-filter-builder modal.
    // For step_04 it appends a blank rule so the count updates.
    state.rules.push({
      type: "tag",
      operator: "is",
      value: "",
    } as unknown as SmartFolderRule);
    refreshFilterStatus();
  });
  filterField.appendChild(addFilterBtn);
  leftCol.appendChild(filterField);

  function refreshFilterStatus(): void {
    if (state.rules.length === 0) {
      filterStatus.textContent = "Show all files";
    } else {
      filterStatus.textContent =
        state.rules.length === 1 ? "1 filter applied" : `${state.rules.length} filters applied`;
    }
  }
  refreshFilterStatus();

  // Sort
  const sortField = document.createElement("div");
  const sortLabel = document.createElement("div");
  sortLabel.className = "vm-field-label";
  sortLabel.textContent = "Sort";
  sortField.appendChild(sortLabel);
  const sortSel = document.createElement("select");
  sortSel.className = "vm-select";
  sortSel.dataset.vmField = "sort";
  const sortOptions = [
    { value: "name-asc", label: "Name ↑" },
    { value: "name-desc", label: "Name ↓" },
  ];
  for (const o of sortOptions) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === state.sort) opt.selected = true;
    sortSel.appendChild(opt);
  }
  sortSel.addEventListener("change", () => {
    state.sort = sortSel.value;
  });
  sortField.appendChild(sortSel);
  leftCol.appendChild(sortField);

  // ── Right column: three toggles + Content Width ────────────────────────

  // Helper to build a labelled checkbox row.
  function buildToggleRow(
    toggleKey: "show-modified" | "show-extensions" | "preview-pane",
    label: string,
    getValue: () => boolean,
    setValue: (v: boolean) => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "vm-toggle-row";
    const lbl = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = getValue();
    cb.dataset.vmToggle = toggleKey;
    const id = `vm-toggle-${toggleKey}`;
    cb.id = id;
    lbl.htmlFor = id;
    lbl.textContent = label;
    cb.addEventListener("change", () => setValue(cb.checked));
    row.appendChild(lbl);
    row.appendChild(cb);
    return row;
  }

  rightCol.appendChild(
    buildToggleRow("show-modified", "Show modified date",
      () => state.showModified,
      (v) => { state.showModified = v; }),
  );
  rightCol.appendChild(
    buildToggleRow("show-extensions", "Show file extensions",
      () => state.showExtensions,
      (v) => { state.showExtensions = v; }),
  );
  rightCol.appendChild(
    buildToggleRow("preview-pane", "Include preview pane",
      () => state.previewPane,
      (v) => { state.previewPane = v; }),
  );

  // Content Width
  const widthField = document.createElement("div");
  const widthLabel = document.createElement("div");
  widthLabel.className = "vm-field-label";
  widthLabel.textContent = "Content width";
  widthField.appendChild(widthLabel);
  const widthPills = document.createElement("div");
  widthPills.className = "vm-width-pills";
  const widthOptions: Array<{ value: ContentWidth; label: string }> = [
    { value: "normal", label: "Normal" },
    { value: "wide", label: "Wide" },
    { value: "full", label: "Full" },
  ];
  for (const w of widthOptions) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "vm-width-pill" + (w.value === state.contentWidth ? " is-active" : "");
    pill.dataset.vmWidth = w.value;
    pill.textContent = w.label;
    pill.addEventListener("click", () => {
      state.contentWidth = w.value;
      for (const p of Array.from(widthPills.querySelectorAll<HTMLElement>(".vm-width-pill"))) {
        p.classList.toggle("is-active", p.dataset.vmWidth === w.value);
      }
    });
    widthPills.appendChild(pill);
  }
  widthField.appendChild(widthPills);
  rightCol.appendChild(widthField);

  // Footer
  const footer = document.createElement("div");
  footer.className = "cbm-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cbm-btn";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);
  footer.appendChild(cancelBtn);
  const primaryBtn = document.createElement("button");
  primaryBtn.className = "cbm-btn cbm-btn-primary";
  primaryBtn.type = "button";
  primaryBtn.textContent = actionLabelForMode(mode);
  primaryBtn.addEventListener("click", () => {
    // EC-4 / FR-18: empty Path on submit substitutes the default "./".
    // The renderer would also fall back if the key were absent, but we
    // emit it explicitly so downstream readers see a deterministic value.
    const submitState: SelectFormState = {
      ...state,
      path: state.path.trim() === "" ? "./" : state.path,
    };
    if (ctx.onSubmit) ctx.onSubmit(submitState, mode);
    close();
  });
  footer.appendChild(primaryBtn);
  panel.appendChild(footer);

  document.body.appendChild(overlay);

  // Module-scoped state for test introspection hooks.
  currentViewModalState = { state, activeTab };

  // Esc keyboard wiring (FR-42 Cancel). Enter-to-submit is handled by
  // the input element's default behaviour (button focus + Enter); the
  // modal-keyboard helper provides Esc-to-close and Tab trapping.
  attachModalKeyboard({
    modal: overlay,
    onClose: close,
  });

  function close(): void {
    document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove();
    currentViewModalState = null;
  }
}

/**
 * Test hook: returns the current modal's form state. Throws when the
 * modal is not mounted. Step_05 builds on this to wire submit logic
 * via `ctx.onSubmit`.
 */
export function getViewModalState(): SelectFormState {
  if (currentViewModalState === null) {
    throw new Error("View Modal is not open");
  }
  return { ...currentViewModalState.state };
}

/**
 * Test hook: builds the codefence body the modal WOULD emit on submit.
 * Pure read — does not mutate state or dispatch any side effects.
 */
export function emitViewModalFence(): string {
  if (currentViewModalState === null) {
    throw new Error("View Modal is not open");
  }
  // Path empty → emit `./` (EC-4 / FR-18 contract).
  const stateForFence: SelectFormState = {
    ...currentViewModalState.state,
    path:
      currentViewModalState.state.path.trim() === ""
        ? "./"
        : currentViewModalState.state.path,
  };
  return buildSelectFenceFromState(stateForFence);
}
