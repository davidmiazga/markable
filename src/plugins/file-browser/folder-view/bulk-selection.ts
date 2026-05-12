/**
 * bulk-selection.ts — Shared selection state type and checkbox DOM helpers.
 *
 * SelectionState is created once per renderFolderTable() call and passed
 * by reference to all section builders and row factories. The DOM helpers
 * in this file build the checkbox <td> and <th> elements and keep the
 * selection state and visual state in sync.
 *
 * @module folder-view/bulk-selection
 */

import type { FolderCard } from "./types";

/**
 * Shared mutable selection state for one renderFolderTable() call.
 *
 * paths    — Set of absolute paths currently checked.
 * kindMap  — Maps each known absolute path → "file" | "directory".
 *            Populated when rows are built; read by bulk operation runners
 *            to dispatch the correct Tauri command.
 */
export interface SelectionState {
  paths: Set<string>;
  kindMap: Map<string, "file" | "directory">;
}

/**
 * Create a fresh, empty SelectionState.
 *
 * @returns A new SelectionState with empty paths and kindMap.
 */
export function createSelectionState(): SelectionState {
  return {
    paths: new Set(),
    kindMap: new Map(),
  };
}

/**
 * Recalculate and set the visual state of the master checkbox after any
 * individual row checkbox change.
 *
 * Sets:
 *   - checked + not indeterminate → all section paths are in selectionState.paths
 *   - unchecked + not indeterminate → no section paths are in selectionState.paths
 *   - indeterminate → some but not all section paths are selected (FR-1)
 *
 * @param masterCheckbox  - The master <input type="checkbox"> for this section.
 * @param sectionPaths    - All paths in this section.
 * @param selectionState  - The shared selection state to read from.
 */
export function updateMasterCheckboxState(
  masterCheckbox: HTMLInputElement,
  sectionPaths: string[],
  selectionState: SelectionState,
): void {
  const selectedCount = sectionPaths.filter(p => selectionState.paths.has(p)).length;

  if (selectedCount === 0) {
    masterCheckbox.checked = false;
    masterCheckbox.indeterminate = false;
  } else if (selectedCount === sectionPaths.length) {
    masterCheckbox.checked = true;
    masterCheckbox.indeterminate = false;
  } else {
    // Partial selection: indeterminate state signals "some but not all" to
    // assistive technology and communicates mixed state visually (FR-1).
    masterCheckbox.checked = false;
    masterCheckbox.indeterminate = true;
  }
}

/**
 * Build a <td> containing a row checkbox for one card.
 *
 * Clicking the cell or its checkbox:
 *   1. Stops event propagation (prevents the row click handler from firing).
 *   2. Updates selectionState.paths (adds or removes the card path).
 *   3. Updates the row's fv-row--selected class.
 *   4. Calls updateToolbar().
 *   5. Calls updateMasterCheckboxState() to sync the section master.
 *
 * @param card             - The FolderCard this row represents.
 * @param tr               - The <tr> element this cell belongs to.
 * @param selectionState   - Shared mutable selection state.
 * @param updateToolbar    - Callback to sync toolbar visibility/count.
 * @param masterCheckbox   - The section's master <input> for indeterminate sync.
 * @param sectionPaths     - All paths in this section (for master state calc).
 * @returns The constructed <td> element.
 */
export function buildCheckboxTd(
  card: FolderCard,
  tr: HTMLTableRowElement,
  selectionState: SelectionState,
  updateToolbar: () => void,
  masterCheckbox: HTMLInputElement,
  sectionPaths: string[],
): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "fv-td fv-td-checkbox";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", `Select ${card.name}`);

  // Register this card's kind in the shared map so operation runners can
  // dispatch the correct Tauri command (delete_file vs delete_directory, etc.).
  selectionState.kindMap.set(card.path, card.kind);

  input.addEventListener("change", (event: Event) => {
    // Prevent the change event from bubbling to any row-level handler.
    event.stopPropagation();

    if (input.checked) {
      selectionState.paths.add(card.path);
    } else {
      selectionState.paths.delete(card.path);
    }

    tr.classList.toggle("fv-row--selected", input.checked);
    updateToolbar();
    updateMasterCheckboxState(masterCheckbox, sectionPaths, selectionState);
  });

  // Stop click propagation at the cell level to prevent the row's click
  // handler (which opens the file/folder) from firing when the user clicks
  // the padding area of the checkbox cell rather than the input itself.
  td.addEventListener("click", (event: MouseEvent) => {
    event.stopPropagation();
  });

  td.appendChild(input);
  return td;
}

/**
 * Build a <th> containing the section master checkbox.
 *
 * Clicking master-checked state: deselects all paths in sectionPaths.
 * Clicking master-unchecked or indeterminate state: selects all sectionPaths.
 *
 * Length justification: must synchronize four distinct concerns in a single
 * click handler — the paths Set, rowCheckboxes visual state, row highlight
 * classes, and the toolbar count — while also managing indeterminate state
 * reset. Splitting the handler would require passing all four references into
 * a helper with no readability gain.
 *
 * @param sectionLabel   - Used for aria-label: "Select all ${sectionLabel}".
 * @param sectionPaths   - All paths in this section (determined at build time).
 * @param selectionState - Shared mutable selection state.
 * @param updateToolbar  - Callback to sync toolbar.
 * @param rowCheckboxes  - All row <input> elements in this section
 *                         (for visual sync when master is clicked).
 * @param rows           - All <tr> elements in this section
 *                         (for fv-row--selected class sync).
 * @returns Object with { th, masterInput } so the caller can
 *          pass masterInput to buildCheckboxTd calls.
 */
export function buildMasterCheckboxTh(
  sectionLabel: string,
  sectionPaths: string[],
  selectionState: SelectionState,
  updateToolbar: () => void,
  rowCheckboxes: HTMLInputElement[],
  rows: HTMLTableRowElement[],
): { th: HTMLTableCellElement; masterInput: HTMLInputElement } {
  const th = document.createElement("th");
  th.className = "fv-th fv-th-checkbox";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", `Select all ${sectionLabel}`);

  input.addEventListener("change", () => {
    // true = select all; false = deselect all.
    const selectAll = input.checked;

    for (const path of sectionPaths) {
      if (selectAll) {
        selectionState.paths.add(path);
      } else {
        selectionState.paths.delete(path);
      }
    }

    // Sync all row checkboxes to the new master state.
    for (const rowCb of rowCheckboxes) {
      rowCb.checked = selectAll;
    }

    // Sync all row highlight classes.
    for (const row of rows) {
      row.classList.toggle("fv-row--selected", selectAll);
    }

    // Master is now definitively checked or unchecked — not indeterminate.
    input.indeterminate = false;
    updateToolbar();
  });

  th.appendChild(input);
  return { th, masterInput: input };
}
