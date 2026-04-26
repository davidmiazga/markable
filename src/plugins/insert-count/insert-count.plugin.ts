/**
 * insert-count.plugin.ts
 *
 * Insert Count — FC2 #15.
 *
 * A toggleable core plugin that opens a small inline overlay dialog and inserts
 * an auto-incrementing numeric sequence at every cursor position (or at every
 * line in a multi-line selection) in a single CM6 transaction.
 *
 * Architecture overview (docs/specs/insert-count/00_index.md):
 *   AD-01 No CM6 extensions registered — purely imperative command plugin.
 *   AD-02 Inline overlay dialog anchored near the cursor (VS Code style).
 *   AD-03 Global registration via window.__MARKABLE_INSERT_COUNT_OPEN__.
 *   AD-04 Single-transaction insertion — all changes dispatched at once.
 *   AD-05 Three modes: Multi-cursor (A) → Multi-line selection (B) → Single (C).
 *   AD-06 Settings persisted on successful Insert only.
 *   AD-07 Text pattern substitution via "#" token or suffix append.
 *   AD-08 Focus trap keeps Tab inside dialog; Escape always cancels.
 *   AD-09 Post-insertion cursor collapses after last inserted string.
 */

import type { UnifiedPlugin, MarkablePluginAPI } from "../markable-plugin-api";
import {
  applyInsertions,
  validateInputs,
} from "./insert-count.logic";
import type { InsertCountSettings } from "./insert-count.logic";

// ── Global window type augmentation ──────────────────────────────────────────
// Satisfies TypeScript when accessing custom globals at runtime.

declare global {
  interface Window {
    /** Live CM6 EditorView instance. Never call dispatch/doc on CM6 module globals. */
    __MARKABLE_EDITOR_VIEW__: any;
    /**
     * Set to openDialog() when the plugin is enabled; null when disabled.
     * handleAction("edit-insert-count") in main.ts delegates through this global.
     * When null, handleAction shows the "Enable the plugin" alert (EC-02).
     */
    __MARKABLE_INSERT_COUNT_OPEN__: (() => void) | null;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLUGIN_ID = "insert-count";

/** Element ID for the injected <style> tag — used for idempotency guard. */
const CSS_ID = "markable-insert-count-styles";

/**
 * Default settings applied on first run (EC-25) or when loadSettings returns null.
 * FR-02.2: Start=1, Step=1, Wrap="".
 */
const DEFAULT_SETTINGS: InsertCountSettings = {
  start: 1,
  step: 1,
  wrap: "",
};

// ── Module-level state ────────────────────────────────────────────────────────
// These variables live at IIFE module scope — one instance per plugin enable cycle.

/**
 * Last-used settings. Populated in onEnable from persisted data or defaults.
 * Updated in-memory on successful Insert (before the async saveSettings call).
 */
let currentSettings: InsertCountSettings = { ...DEFAULT_SETTINGS };

/**
 * Prevents double-open (EC-19). Set to true when the dialog is appended to
 * the DOM; reset to false when closeDialog() removes it.
 */
let dialogOpen = false;

/**
 * Reference to the live dialog element. Non-null only while dialogOpen is true.
 * Used by onDisable (EC-20) to forcibly close the dialog without inserting.
 */
let dialogEl: HTMLElement | null = null;

/**
 * MarkablePluginAPI instance captured in onEnable.
 * Threaded into applyInsertions() so settings can be persisted after Insert.
 * Set to null in onDisable.
 */
let pluginApi: MarkablePluginAPI | null = null;

// ── CSS constant ──────────────────────────────────────────────────────────────

/**
 * All dialog styles. Uses only CSS variables from :root for theme compatibility
 * (NFR-04). Hex values appear only as fallbacks inside var() declarations.
 */
const INSERT_COUNT_CSS = `
.ic-dialog {
  position: fixed;
  z-index: 9999;
  width: 300px;
  padding: 12px 14px 10px;
  border-radius: 8px;
  background: var(--bg-color, #1e1e1e);
  border: 1px solid var(--border-color, #444);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  font-family: var(--ui-font, system-ui, sans-serif);
  font-size: 13px;
  color: var(--text-color, #d4d4d4);
}
.ic-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.ic-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
  margin-bottom: 3px;
}
.ic-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #444);
  background: var(--input-bg, #2a2a2a);
  color: var(--text-color, #d4d4d4);
  font-family: var(--mono-font, monospace);
  font-size: 13px;
  outline: none;
}
.ic-input:focus {
  border-color: var(--accent-color, #0e86d4);
}
.ic-input--error {
  border-color: var(--error-color, #f44336) !important;
}
.ic-error {
  font-size: 11px;
  color: var(--error-color, #f44336);
  min-height: 14px;
  margin-top: 2px;
}
.ic-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.ic-btn {
  padding: 5px 14px;
  border-radius: 4px;
  font-family: var(--ui-font, system-ui, sans-serif);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.1s;
}
.ic-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ic-btn-secondary {
  background: transparent;
  border-color: var(--border-color, #444);
  color: var(--text-color, #d4d4d4);
}
.ic-btn-secondary:hover:not(:disabled) {
  background: var(--hover-bg, rgba(255,255,255,0.05));
}
.ic-btn-primary {
  background: var(--accent-color, #0e86d4);
  color: #fff;
  border-color: var(--accent-color, #0e86d4);
}
.ic-btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}
`;

// ── CSS helpers ───────────────────────────────────────────────────────────────

/**
 * Inject the dialog stylesheet into <head> once. Idempotent: a second call is
 * a no-op if the style tag already exists (guarded by element ID).
 */
function injectStyles(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = INSERT_COUNT_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the injected stylesheet from <head>. Called in onDisable so the
 * dialog CSS does not linger after the plugin is turned off.
 */
function removeStyles(): void {
  document.getElementById(CSS_ID)?.remove();
}

// ── DOM builder helpers ───────────────────────────────────────────────────────

/**
 * Build a labelled form row with an optional error span below the input.
 *
 * @param label  Human-readable label text.
 * @param input  The input element to associate.
 * @param error  Optional error span. Pass null for fields with no validation.
 */
function buildRow(label: string, input: HTMLElement, error: HTMLElement | null): HTMLElement {
  const row = document.createElement("div");
  row.className = "ic-row";

  const lbl = document.createElement("label");
  lbl.className = "ic-label";
  lbl.textContent = label;
  lbl.setAttribute("for", input.id);

  row.appendChild(lbl);
  row.appendChild(input);
  if (error) row.appendChild(error);
  return row;
}

/**
 * Build the actions bar containing Cancel and Insert buttons.
 *
 * @param cancelBtn  The secondary Cancel button.
 * @param insertBtn  The primary Insert button.
 */
function buildActions(cancelBtn: HTMLElement, insertBtn: HTMLElement): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "ic-actions";
  actions.appendChild(cancelBtn);
  actions.appendChild(insertBtn);
  return actions;
}

// ── Positioning ───────────────────────────────────────────────────────────────

/**
 * Matches the CSS `width: 300px` declared in INSERT_COUNT_CSS.
 *
 * We do NOT use `dialog.offsetWidth` because WKWebView (Tauri's renderer)
 * returns 0 for offsetWidth before the browser has performed layout. Using the
 * CSS constant directly avoids the zero-width fallback and prevents the dialog
 * from being placed flush against the right viewport edge on first open.
 */
const DIALOG_WIDTH = 300;

/**
 * Position the dialog near the cursor using CM6's coordsAtPos().
 * Falls back to viewport center if coordinates are unavailable (e.g. editor
 * not yet rendered, or cursor position outside visible range).
 *
 * Clamping ensures the dialog stays within the viewport even near edges.
 *
 * @param dialog  The dialog element (must already be in the DOM so dimensions are known).
 * @param view    The live CM6 EditorView instance.
 */
function positionDialog(dialog: HTMLElement, view: any): void {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);

  if (!coords) {
    // Fallback: center of viewport.
    dialog.style.top = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    return;
  }

  // Clear any transform from a previous fallback.
  dialog.style.transform = "";

  const MARGIN = 8;
  // Use CSS constant instead of offsetWidth — WKWebView returns 0 before layout.
  const DW = DIALOG_WIDTH;
  const DH = dialog.offsetHeight || 160;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  // Place below cursor by default; flip above if it would overflow the bottom.
  let top = coords.bottom + MARGIN;
  let left = coords.left;

  // Horizontal clamping: keep within viewport with a MARGIN gutter.
  if (left + DW > vpW) left = vpW - DW - MARGIN;
  if (left < MARGIN) left = MARGIN;

  // Vertical flip: if the dialog would overflow the bottom, show above cursor.
  if (top + DH > vpH) top = coords.top - DH - MARGIN;

  dialog.style.top = `${top}px`;
  dialog.style.left = `${left}px`;
}

// ── buildDialogDOM extracted helpers ─────────────────────────────────────────
//
// These three helpers were originally nested functions inside buildDialogDOM.
// They are module-level so buildDialogDOM stays under 60 lines and each piece
// can be reasoned about independently (C-01).

/**
 * Apply or clear validation error state for the Start and Step inputs, then
 * enable or disable the Insert button accordingly.
 *
 * Delegates all validation logic to validateInputs() from the pure logic
 * module — this function is only responsible for DOM side-effects.
 *
 * @param startInput  The "Start at" text input element.
 * @param startError  Inline error span below startInput.
 * @param stepInput   The "Count by" text input element.
 * @param stepError   Inline error span below stepInput.
 * @param insertBtn   The primary Insert button (disabled when invalid).
 * @returns           true when both inputs are valid and insertion may proceed.
 */
function applyValidationUI(
  startInput: HTMLInputElement,
  startError: HTMLElement,
  stepInput: HTMLInputElement,
  stepError: HTMLElement,
  insertBtn: HTMLButtonElement,
): boolean {
  const result = validateInputs(startInput.value, stepInput.value);

  // Apply/clear error state for Start.
  startError.textContent = result.startError;
  startInput.classList.toggle("ic-input--error", !!result.startError);
  // Apply/clear error state for Step.
  stepError.textContent = result.stepError;
  stepInput.classList.toggle("ic-input--error", !!result.stepError);

  insertBtn.disabled = !result.valid;
  return result.valid;
}

/**
 * Return a handler that reads the current dialog input values, validates them,
 * and — if valid — calls closeDialog(true, ...) to apply the insertion.
 *
 * Returning a factory (rather than a bare function) keeps the Insert button
 * click handler and the Enter key handler pointing at the same closure without
 * either capturing stale input references.
 *
 * @param startInput  The "Start at" text input.
 * @param stepInput   The "Count by" text input.
 * @param wrapInput   The "Text pattern" text input.
 * @param insertBtn   The primary Insert button (used for validation check).
 * @param startError  Inline error span for startInput.
 * @param stepError   Inline error span for stepInput.
 * @param view        Live CM6 EditorView — forwarded to closeDialog.
 * @returns           A `() => void` that performs validation then insertion.
 */
function buildDoInsert(
  startInput: HTMLInputElement,
  stepInput: HTMLInputElement,
  wrapInput: HTMLInputElement,
  insertBtn: HTMLButtonElement,
  startError: HTMLElement,
  stepError: HTMLElement,
  view: any,
): () => void {
  return function doInsert(): void {
    if (!applyValidationUI(startInput, startError, stepInput, stepError, insertBtn)) return;
    const config: InsertCountSettings = {
      start: parseInt(startInput.value.trim(), 10),
      step: parseInt(stepInput.value.trim(), 10),
      wrap: wrapInput.value,
    };
    closeDialog(true, view, config);
  };
}

/**
 * Advance (or retreat) focus within the Tab trap.
 *
 * Extracted from wireKeyboardHandlers so that function stays under 20 lines.
 * Wraps from last → first (forward) and first → last (backward).
 *
 * @param focusable  Ordered list of focusable elements for the Tab trap.
 * @param reverse    When true, move backward (Shift-Tab); otherwise forward.
 */
function cycleFocus(focusable: HTMLElement[], reverse: boolean): void {
  const idx = focusable.indexOf(document.activeElement as HTMLElement);
  if (reverse) {
    // Shift-Tab: move backward; wrap from first to last.
    focusable[(idx - 1 + focusable.length) % focusable.length].focus();
  } else {
    // Tab: move forward; wrap from last to first.
    focusable[(idx + 1) % focusable.length].focus();
  }
}

/**
 * Attach keyboard handlers to the dialog container element.
 *
 * All three keys are caught at the container level so they fire regardless of
 * which focusable element is active (AD-08, EC-17, EC-18, FR-02.7).
 *
 *  - Escape → cancel (EC-18).
 *  - Enter  → submit via the supplied onInsert callback (EC-17).
 *  - Tab    → cycle focus through `focusable` elements via cycleFocus (AD-08).
 *
 * @param dialog     The root dialog element to attach the listener to.
 * @param focusable  Ordered list of focusable elements for the Tab trap.
 * @param onInsert   Callback to call when Enter is pressed.
 */
function wireKeyboardHandlers(
  dialog: HTMLElement,
  focusable: HTMLElement[],
  onInsert: () => void,
): void {
  dialog.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // EC-18: Escape always cancels regardless of focused element.
      e.preventDefault(); e.stopPropagation(); closeDialog(false);
    } else if (e.key === "Enter") {
      // EC-17: Enter anywhere in the dialog is equivalent to clicking Insert.
      e.preventDefault(); e.stopPropagation(); onInsert();
    } else if (e.key === "Tab") {
      // AD-08 / FR-02.7: Tab focus trap — delegate to cycleFocus.
      e.preventDefault();
      cycleFocus(focusable, e.shiftKey);
    }
  });
}

/**
 * Attach the click-outside-to-cancel listener to the dialog element.
 *
 * Listens in the capture phase so it fires before CM6 can consume the event.
 * The handler reference is stored on the element itself so closeDialog() can
 * remove it precisely without a stale closure (see AD-09 pattern).
 *
 * @param dialog  The live dialog element to monitor.
 */
function wireClickOutside(dialog: HTMLElement): void {
  function onDocClick(e: MouseEvent): void {
    if (dialogEl && !dialogEl.contains(e.target as Node)) {
      closeDialog(false);
    }
  }
  document.addEventListener("mousedown", onDocClick, { capture: true, once: false });
  // Store the handler so closeDialog() can remove this exact listener.
  (dialog as any).__outsideClickHandler__ = onDocClick;
}

/**
 * Create and return the three text inputs and their error spans.
 *
 * Extracted from buildDialogDOM to keep that function under 60 lines (C-01).
 * Pre-fills values from currentSettings so the dialog remembers the last use.
 *
 * @returns Object containing all five input/error DOM elements.
 */
function buildInputElements(): {
  startInput: HTMLInputElement;
  startError: HTMLElement;
  stepInput: HTMLInputElement;
  stepError: HTMLElement;
  wrapInput: HTMLInputElement;
} {
  const startInput = document.createElement("input") as HTMLInputElement;
  startInput.id = "ic-start"; startInput.type = "text";
  startInput.className = "ic-input"; startInput.value = String(currentSettings.start);
  startInput.setAttribute("inputmode", "numeric");

  const startError = document.createElement("span");
  startError.id = "ic-start-error"; startError.className = "ic-error";

  const stepInput = document.createElement("input") as HTMLInputElement;
  stepInput.id = "ic-step"; stepInput.type = "text";
  stepInput.className = "ic-input"; stepInput.value = String(currentSettings.step);
  stepInput.setAttribute("inputmode", "numeric");

  const stepError = document.createElement("span");
  stepError.id = "ic-step-error"; stepError.className = "ic-error";

  const wrapInput = document.createElement("input") as HTMLInputElement;
  wrapInput.id = "ic-wrap"; wrapInput.type = "text";
  wrapInput.className = "ic-input"; wrapInput.value = currentSettings.wrap;
  wrapInput.placeholder = "(e.g. Prefix # Suffix)";

  return { startInput, startError, stepInput, stepError, wrapInput };
}

// ── closeDialog ───────────────────────────────────────────────────────────────

/**
 * Close the Count Dialog and optionally apply insertions.
 *
 * Always removes the dialog from the DOM, clears module state, and returns
 * keyboard focus to the editor (NFR-05).
 *
 * @param insert  When true, calls applyInsertions() with the supplied config.
 *                When false, no document change occurs (Cancel / Escape / onDisable).
 * @param view    CM6 EditorView. Required when insert=true.
 * @param config  Validated settings from the dialog. Required when insert=true.
 */
function closeDialog(insert: boolean, view?: any, config?: InsertCountSettings): void {
  if (!dialogEl) return;

  // Remove the click-outside listener before detaching the element to avoid
  // a stale reference that fires during or after DOM removal.
  const outsideHandler = (dialogEl as any).__outsideClickHandler__;
  if (outsideHandler) {
    document.removeEventListener("mousedown", outsideHandler, { capture: true });
  }

  dialogEl.remove();
  dialogEl = null;
  dialogOpen = false;

  if (insert && view && config) {
    // Fire-and-forget: the dispatch is synchronous; only saveSettings is async.
    void applyInsertions(view, config, pluginApi);
  }

  // Return focus to the editor after the dialog is gone (NFR-05).
  const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
  editorView?.focus();
}

// ── buildDialogDOM ────────────────────────────────────────────────────────────

/**
 * Construct the Count Dialog DOM and wire all event handlers.
 *
 * All interactive elements are built with document.createElement (no innerHTML)
 * to avoid XSS risks and to make the focus trap straightforward.
 *
 * The dialog is NOT appended here — the caller (openDialog) appends it so
 * positionDialog can measure layout after insertion.
 *
 * Heavy logic is delegated to module-level helpers (C-01):
 *   applyValidationUI  — syncs error classes and disables/enables Insert.
 *   buildDoInsert      — factory returning the submit handler.
 *   wireKeyboardHandlers — attaches Escape/Enter/Tab listeners.
 *
 * @param view  CM6 EditorView, forwarded to the Insert action.
 * @returns     The root dialog element with all listeners attached.
 */
function buildDialogDOM(view: any): HTMLElement {
  const dialog = document.createElement("div");
  dialog.id = "markable-insert-count-dialog";
  dialog.className = "ic-dialog";

  // Build inputs via helper — keeps this function under 60 lines (C-01).
  const { startInput, startError, stepInput, stepError, wrapInput } = buildInputElements();

  const cancelBtn = document.createElement("button") as HTMLButtonElement;
  cancelBtn.id = "ic-cancel"; cancelBtn.className = "ic-btn ic-btn-secondary";
  cancelBtn.textContent = "Cancel"; cancelBtn.type = "button";

  const insertBtn = document.createElement("button") as HTMLButtonElement;
  insertBtn.id = "ic-insert"; insertBtn.className = "ic-btn ic-btn-primary";
  insertBtn.textContent = "Insert"; insertBtn.type = "button";

  dialog.append(
    buildRow("Start at", startInput, startError),
    buildRow("Count by", stepInput, stepError),
    buildRow("Text pattern", wrapInput, null),
    buildActions(cancelBtn, insertBtn),
  );

  // Tab focus trap list — order defines Tab cycle sequence (AD-08).
  const focusable: HTMLElement[] = [startInput, stepInput, wrapInput, cancelBtn, insertBtn];

  // Bind a shared validate callback so both inputs share one reference.
  const validate = () => applyValidationUI(startInput, startError, stepInput, stepError, insertBtn);
  startInput.addEventListener("input", validate);
  stepInput.addEventListener("input", validate);
  // Run once so pre-filled defaults show correct initial state.
  validate();

  const doInsert = buildDoInsert(startInput, stepInput, wrapInput, insertBtn, startError, stepError, view);
  insertBtn.addEventListener("click", doInsert);
  cancelBtn.addEventListener("click", () => closeDialog(false));

  wireKeyboardHandlers(dialog, focusable, doInsert);

  // EC-21: Click outside the dialog cancels it.
  wireClickOutside(dialog);

  return dialog;
}

// ── openDialog ────────────────────────────────────────────────────────────────

/**
 * Open the Count Dialog near the cursor position.
 *
 * Called by handleAction("edit-insert-count") via the global registered in
 * onEnable. Guards against double-open (EC-19) and missing editor (EC-01).
 */
function openDialog(): void {
  // EC-19: Prevent double-open — bring existing dialog to focus instead.
  if (dialogOpen) {
    dialogEl?.focus();
    return;
  }

  // EC-01: No active editor → silent no-op.
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (!view) return;

  dialogOpen = true;
  dialogEl = buildDialogDOM(view);
  document.body.appendChild(dialogEl);

  // Position after appending so offsetWidth/offsetHeight reflect actual size.
  positionDialog(dialogEl, view);

  // Focus the Start input so the user can immediately type or press Enter.
  dialogEl.querySelector<HTMLInputElement>("#ic-start")?.focus();
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export default {
  id: PLUGIN_ID,
  name: "Insert Count",
  version: "1.0.0",
  description: "Insert an auto-incrementing numeric sequence at cursor positions",
  detail: `Insert Count places an incrementing number at each cursor position or at the start of each selected line.

Modes:
  Multi-cursor (Mode A): multiple cursors — each gets the next value.
  Selection (Mode B): one selection spanning multiple lines — each line gets the next value, inserted at the cursor column.
  Single cursor (Mode C): one cursor, no selection — inserts the Start value once.

Text pattern: use # as a placeholder for the number (e.g. "Step #:" inserts "Step 1:", "Step 2:", ...). If no # is present, the number is appended after the pattern.

Invoke via Edit > Insert Count... (Cmd-Opt-3) or Command Bar.`,

  /**
   * onEnable sequence (FR-06.3):
   *  1. Load persisted settings from disk; apply defaults for null / missing keys (EC-25).
   *  2. Inject dialog CSS (idempotent).
   *  3. Register the global so handleAction can open the dialog.
   */
  async onEnable(api: MarkablePluginAPI): Promise<void> {
    pluginApi = api;

    // 1. Load settings — fall back to defaults if null (EC-25).
    const saved = await api.loadSettings();
    if (saved && typeof saved === "object") {
      currentSettings = {
        start: typeof saved["start"] === "number" ? (saved["start"] as number) : DEFAULT_SETTINGS.start,
        step:  typeof saved["step"]  === "number" ? (saved["step"]  as number) : DEFAULT_SETTINGS.step,
        wrap:  typeof saved["wrap"]  === "string" ? (saved["wrap"]  as string) : DEFAULT_SETTINGS.wrap,
      };
    } else {
      currentSettings = { ...DEFAULT_SETTINGS };
    }

    // 2. Inject CSS (idempotent — guarded by element ID).
    injectStyles();

    // 3. Register global hook for handleAction delegation (AD-03).
    (window as any).__MARKABLE_INSERT_COUNT_OPEN__ = openDialog;
  },

  /**
   * onDisable sequence (FR-06.4):
   *  1. Close any open dialog without inserting (EC-20).
   *  2. Remove injected CSS.
   *  3. Null the global so handleAction falls through to the alert (EC-02).
   */
  async onDisable(_api: MarkablePluginAPI): Promise<void> {
    // 1. Force-close the dialog without inserting (EC-20).
    if (dialogEl) {
      closeDialog(false);
    }

    // 2. Remove dialog CSS.
    removeStyles();

    // 3. Clear global so handleAction shows the "Enable the plugin" alert (EC-02).
    (window as any).__MARKABLE_INSERT_COUNT_OPEN__ = null;

    pluginApi = null;
  },
} satisfies UnifiedPlugin;
