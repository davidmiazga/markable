/**
 * bulk-toolbar.ts — Toolbar DOM construction and state machine.
 *
 * ToolbarRefs holds references to the live DOM nodes created by buildToolbar().
 * updateToolbar() is called by every checkbox change to sync visibility and
 * count label.
 *
 * Sub-UI flows (move, delete, YAML) are triggered by the three action buttons.
 * Each replaces mainButtons with a contextual form, then restores mainButtons
 * when the user cancels or completes the action.
 *
 * @module folder-view/bulk-toolbar
 */

import type { SelectionState } from "./bulk-selection";

/**
 * Live DOM references for the bulk-action toolbar.
 *
 * toolbar     — The root <div class="fv-bulk-toolbar">.
 * countLabel  — The <span> that shows "N selected".
 * mainButtons — The <div> containing Move, Delete, Apply YAML buttons.
 * subUi       — The <div> that hosts the active sub-UI (move input,
 *               delete confirm, or YAML form). Empty and hidden when idle.
 */
export interface ToolbarRefs {
  toolbar: HTMLDivElement;
  countLabel: HTMLSpanElement;
  mainButtons: HTMLDivElement;
  subUi: HTMLDivElement;
}

// ── Visibility helpers ────────────────────────────────────────────────────────

/**
 * Clear the sub-UI container and restore main buttons.
 *
 * Removes --visible class from subUi, clears its innerHTML,
 * and restores mainButtons visibility.
 *
 * @param refs - The ToolbarRefs for this toolbar instance.
 */
function hideSubUi(refs: ToolbarRefs): void {
  refs.subUi.classList.remove("fv-bulk-subui--visible");
  refs.subUi.innerHTML = "";
  refs.mainButtons.style.display = "";
}

/**
 * Display an operation result summary in the toolbar sub-UI area.
 *
 * Creates a <div class="fv-bulk-result [fv-bulk-result--error]"> with the
 * summary text set via .textContent. Appended to refs.subUi.
 * Does NOT hide or modify mainButtons — the caller controls that.
 *
 * @param refs    - The ToolbarRefs for this toolbar instance.
 * @param summary - Human-readable result string (may be multi-line).
 * @param isError - true → adds fv-bulk-result--error class.
 */
export function showResult(
  refs: ToolbarRefs,
  summary: string,
  isError: boolean,
): void {
  const div = document.createElement("div");
  div.className = isError
    ? "fv-bulk-result fv-bulk-result--error"
    : "fv-bulk-result";
  // textContent prevents XSS injection from operation error messages (NFR-4).
  div.textContent = summary;
  refs.subUi.appendChild(div);
  refs.subUi.classList.add("fv-bulk-subui--visible");
}

// ── Sub-UI builders ───────────────────────────────────────────────────────────

/**
 * Replace main buttons with the move destination input sub-UI.
 *
 * Sub-UI contains:
 *   - A text input placeholder "Absolute destination folder path"
 *   - "Confirm Move" button (disabled until input is non-empty)
 *   - "Cancel" button
 *
 * Confirm Move click:
 *   1. Disable all buttons (State 7 — operation in progress).
 *   2. Call onMove(destDir).
 *   3. On return: re-enable buttons (caller shows result summary).
 *
 * Cancel click: call hideSubUi(refs).
 *
 * Length justification: builds five DOM nodes (label, text input, Confirm button,
 * Cancel button, input event listener) with distinct wiring rules, plus
 * async state-machine logic for the in-progress state. Splitting would scatter
 * tightly coupled node construction across multiple functions.
 *
 * @param refs           - ToolbarRefs instance.
 * @param selectionState - Shared selection state (read for context, not mutated).
 * @param onMove         - Async callback invoked with the destination path.
 */
function showMoveSubUi(
  refs: ToolbarRefs,
  _selectionState: SelectionState,
  onMove: (destDir: string) => Promise<void>,
): void {
  refs.mainButtons.style.display = "none";
  refs.subUi.innerHTML = "";
  refs.subUi.classList.add("fv-bulk-subui--visible");

  const label = document.createElement("span");
  label.className = "fv-bulk-subui__label";
  label.textContent = "Destination:";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "fv-bulk-subui__input";
  input.placeholder = "Absolute destination folder path";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "fv-bulk-toolbar__btn";
  confirmBtn.textContent = "Confirm Move";
  // Disabled until the user types a non-empty path.
  confirmBtn.disabled = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "fv-bulk-toolbar__btn";
  cancelBtn.textContent = "Cancel";

  // Enable Confirm Move only when the input has a non-empty trimmed value.
  input.addEventListener("input", () => {
    confirmBtn.disabled = input.value.trim() === "";
  });

  confirmBtn.addEventListener("click", async () => {
    const destDir = input.value.trim();
    if (!destDir) return;

    // Disable all toolbar buttons during the operation (State 7 per spec).
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;

    await onMove(destDir);

    // Note: when refreshLayoutView() was called inside onMove/onDelete, these nodes
    // are already detached. The assignments are no-ops but serve the failure/retry path.
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
  });

  cancelBtn.addEventListener("click", () => hideSubUi(refs));

  refs.subUi.appendChild(label);
  refs.subUi.appendChild(input);
  refs.subUi.appendChild(confirmBtn);
  refs.subUi.appendChild(cancelBtn);
}

/**
 * Replace main buttons with delete confirmation sub-UI.
 *
 * Sub-UI contains:
 *   - Label: "Delete N item(s)? This cannot be undone."
 *   - "Confirm Delete" button (danger style)
 *   - "Cancel" button
 *
 * Confirm Delete click:
 *   1. Disable all buttons.
 *   2. Call onDelete().
 *   3. On return: re-enable buttons.
 *
 * Cancel click: call hideSubUi(refs).
 *
 * Length justification: builds four DOM nodes (count label, Confirm button,
 * Cancel button, event listeners) plus async in-progress state logic. The
 * count label text is derived from selectionState, which requires co-location
 * with the event wiring.
 *
 * @param refs           - ToolbarRefs instance.
 * @param selectionState - Shared selection state (read to produce count label).
 * @param onDelete       - Async callback invoked when delete is confirmed.
 */
function showDeleteSubUi(
  refs: ToolbarRefs,
  selectionState: SelectionState,
  onDelete: () => Promise<void>,
): void {
  refs.mainButtons.style.display = "none";
  refs.subUi.innerHTML = "";
  refs.subUi.classList.add("fv-bulk-subui--visible");

  const count = selectionState.paths.size;
  const label = document.createElement("span");
  label.className = "fv-bulk-subui__label";
  // textContent keeps the label XSS-safe (NFR-4).
  label.textContent = `Delete ${count} item(s)? This cannot be undone.`;

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "fv-bulk-toolbar__btn fv-bulk-toolbar__btn--danger";
  confirmBtn.textContent = "Confirm Delete";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "fv-bulk-toolbar__btn";
  cancelBtn.textContent = "Cancel";

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;

    await onDelete();

    // Note: when refreshLayoutView() was called inside onMove/onDelete, these nodes
    // are already detached. The assignments are no-ops but serve the failure/retry path.
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
  });

  cancelBtn.addEventListener("click", () => hideSubUi(refs));

  refs.subUi.appendChild(label);
  refs.subUi.appendChild(confirmBtn);
  refs.subUi.appendChild(cancelBtn);
}

/**
 * Replace main buttons with YAML frontmatter form sub-UI.
 *
 * Sub-UI contains:
 *   - <select> with options "Add / update key" (value "add") and "Remove key"
 *     (value "remove").
 *   - Key <input> (plain text). Apply button disabled when empty (EC-14).
 *   - Value <input>: visible when op is "add", hidden when op is "remove".
 *   - "Apply" button (disabled when key input is empty).
 *   - "Cancel" button.
 *
 * The select's change event:
 *   - Shows/hides the value input.
 *   - Updates the disabled state of Apply if key is empty.
 *
 * Key input's input event:
 *   - Enables/disables Apply when key is non-empty / empty.
 *
 * Apply click:
 *   1. Disable all buttons.
 *   2. Call onYaml(op, key, value).
 *   3. On return: re-enable, restore main buttons.
 *
 * Cancel click: call hideSubUi(refs).
 *
 * Length justification: manages seven DOM nodes (op select, key label, key
 * input, value label, value input, Apply button, Cancel button) whose
 * visibility and enabled states are tightly interdependent. The
 * syncValueVisibility helper cannot be extracted without receiving every node
 * reference as a parameter, which would not reduce cognitive load.
 *
 * @param refs           - ToolbarRefs instance.
 * @param selectionState - Shared selection state (unused here, present for signature consistency).
 * @param onYaml         - Async callback invoked with (op, key, value).
 */
function showYamlSubUi(
  refs: ToolbarRefs,
  _selectionState: SelectionState,
  onYaml: (op: "add" | "remove", key: string, value: string) => Promise<void>,
): void {
  refs.mainButtons.style.display = "none";
  refs.subUi.innerHTML = "";
  refs.subUi.classList.add("fv-bulk-subui--visible");

  const opSelect = document.createElement("select");
  opSelect.className = "fv-bulk-subui__select";

  const addOption = document.createElement("option");
  addOption.value = "add";
  addOption.textContent = "Add / update key";

  const removeOption = document.createElement("option");
  removeOption.value = "remove";
  removeOption.textContent = "Remove key";

  opSelect.appendChild(addOption);
  opSelect.appendChild(removeOption);

  const keyLabel = document.createElement("span");
  keyLabel.className = "fv-bulk-subui__label";
  keyLabel.textContent = "Key:";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "fv-bulk-subui__input";
  keyInput.placeholder = "key";

  const valueLabel = document.createElement("span");
  valueLabel.className = "fv-bulk-subui__label";
  valueLabel.textContent = "Value:";

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "fv-bulk-subui__input fv-bulk-subui__input--short";
  valueInput.placeholder = "value";

  const applyBtn = document.createElement("button");
  applyBtn.className = "fv-bulk-toolbar__btn";
  applyBtn.textContent = "Apply";
  // Disabled until the user types a non-empty key (EC-14).
  applyBtn.disabled = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "fv-bulk-toolbar__btn";
  cancelBtn.textContent = "Cancel";

  // Show/hide value input depending on selected operation.
  const syncValueVisibility = (): void => {
    const isAdd = opSelect.value === "add";
    valueLabel.style.display = isAdd ? "" : "none";
    valueInput.style.display = isAdd ? "" : "none";
  };

  opSelect.addEventListener("change", () => {
    syncValueVisibility();
    applyBtn.disabled = keyInput.value.trim() === "";
  });

  keyInput.addEventListener("input", () => {
    applyBtn.disabled = keyInput.value.trim() === "";
  });

  applyBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) return;

    applyBtn.disabled = true;
    cancelBtn.disabled = true;

    const op = opSelect.value as "add" | "remove";
    const value = opSelect.value === "add" ? valueInput.value : "";
    await onYaml(op, key, value);

    // Re-enable buttons so the user can act on the result summary or retry.
    // Do NOT call hideSubUi here — the result div appended by showResult must
    // remain visible until the user clicks Cancel or a re-render occurs
    // (same lifecycle as Move/Delete; destroying it immediately would give
    // the user zero time to read the summary).
    applyBtn.disabled = false;
    cancelBtn.disabled = false;
  });

  cancelBtn.addEventListener("click", () => hideSubUi(refs));

  refs.subUi.appendChild(opSelect);
  refs.subUi.appendChild(keyLabel);
  refs.subUi.appendChild(keyInput);
  refs.subUi.appendChild(valueLabel);
  refs.subUi.appendChild(valueInput);
  refs.subUi.appendChild(applyBtn);
  refs.subUi.appendChild(cancelBtn);

  // Apply initial visibility (default is "add", so value input is visible).
  syncValueVisibility();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sync toolbar visibility and count label with the current selection state.
 *
 * When selectionState.paths is empty: hide toolbar (remove --visible class).
 * When non-empty: show toolbar (add --visible class), update count label.
 * Also resets any active sub-UI: calls hideSubUi() when the selection becomes
 * empty (handles EC-16 indirectly via rebuildTbody clearing selection first).
 *
 * @param refs           - Live DOM references returned by buildToolbar().
 * @param selectionState - The shared selection state to read from.
 */
export function updateToolbar(
  refs: ToolbarRefs,
  selectionState: SelectionState,
): void {
  const count = selectionState.paths.size;

  if (count === 0) {
    refs.toolbar.classList.remove("fv-bulk-toolbar--visible");
    hideSubUi(refs);
  } else {
    refs.toolbar.classList.add("fv-bulk-toolbar--visible");
    // textContent prevents XSS injection from path-derived count display (NFR-4).
    refs.countLabel.textContent = `${count} selected`;
  }
}

/**
 * Build the sticky bulk-action toolbar DOM and wire button click handlers.
 *
 * The toolbar starts hidden (display:none). Call updateToolbar() after any
 * selection change to sync visibility and count.
 *
 * @param selectionState  - Shared selection state (read-only in this fn).
 * @param onMove          - Called with (destDir: string) when Confirm Move is clicked.
 * @param onDelete        - Called with no args when Confirm Delete is clicked.
 * @param onYaml          - Called with (op, key, value) when Apply is clicked.
 *                          op is "add" | "remove"; value is "" when op is "remove".
 * @returns ToolbarRefs holding references to live DOM nodes.
 *
 * Length justification: constructs seven distinct DOM sub-trees (count label,
 * move button, delete button, yaml button, move sub-UI, delete sub-UI, yaml
 * sub-UI) each with unique wiring. Splitting into sub-functions would require
 * threading ToolbarRefs across multiple factory boundaries with no clarity gain.
 */
export function buildToolbar(
  selectionState: SelectionState,
  onMove: (destDir: string) => Promise<void>,
  onDelete: () => Promise<void>,
  onYaml: (op: "add" | "remove", key: string, value: string) => Promise<void>,
): ToolbarRefs {
  const toolbar = document.createElement("div") as HTMLDivElement;
  toolbar.className = "fv-bulk-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Bulk actions");

  const countLabel = document.createElement("span") as HTMLSpanElement;
  countLabel.className = "fv-bulk-toolbar__count";
  countLabel.textContent = "0 selected";

  const mainButtons = document.createElement("div") as HTMLDivElement;

  const moveBtn = document.createElement("button");
  moveBtn.className = "fv-bulk-toolbar__btn";
  moveBtn.textContent = "Move";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "fv-bulk-toolbar__btn fv-bulk-toolbar__btn--danger";
  deleteBtn.textContent = "Delete";

  const yamlBtn = document.createElement("button");
  yamlBtn.className = "fv-bulk-toolbar__btn";
  yamlBtn.textContent = "File properties";

  mainButtons.appendChild(moveBtn);
  mainButtons.appendChild(deleteBtn);
  mainButtons.appendChild(yamlBtn);

  const subUi = document.createElement("div") as HTMLDivElement;
  subUi.className = "fv-bulk-subui";

  const refs: ToolbarRefs = { toolbar, countLabel, mainButtons, subUi };

  // Wire button click handlers to the corresponding sub-UI builders.
  moveBtn.addEventListener("click", () => showMoveSubUi(refs, selectionState, onMove));
  deleteBtn.addEventListener("click", () => showDeleteSubUi(refs, selectionState, onDelete));
  yamlBtn.addEventListener("click", () => showYamlSubUi(refs, selectionState, onYaml));

  toolbar.appendChild(countLabel);
  toolbar.appendChild(mainButtons);
  toolbar.appendChild(subUi);

  return refs;
}
