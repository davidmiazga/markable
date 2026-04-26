/**
 * manage-vaults-ui.ts
 *
 * Manage Vaults DOM panel rendered into the Settings panel as a "Vaults" tab.
 *
 * This module is NOT a plugin — it is a UI component imported by the Settings
 * panel code (or invoked via handleAction) when the user opens the Vaults tab.
 *
 * Views:
 *  1. Vault list   — all vaults with name, paths, file count, last-opened.
 *  2. Create form  — name input, root paths, exclude patterns, validation.
 *  3. Edit form    — same as create but pre-filled with an existing entry.
 *  4. Empty state  — shown when no vaults exist yet.
 *
 * Validation (inline, per EC-01/EC-02/EC-03/EC-04):
 *  - Empty name              → "Vault name is required."
 *  - No root paths           → "At least one root path is required."
 *  - Non-existent path       → "Path does not exist." (via validate_vault_paths)
 *  - Path is a file not dir  → "Path is a file, not a folder."
 *  - Overlapping paths       → Yellow warning banner (not an error — EC-04)
 *  - maxIndexSize > 500      → Yellow performance warning badge
 *
 * Dependencies:
 *  - vault-manager.ts  — createVault, updateVault, deleteVault, switchVault,
 *                        getAllVaults, getActiveVault, getVaultIndex
 *  - vault-utils.ts    — checkVaultsForOverlap (path overlap detection)
 *  - validate_vault_paths Tauri command (via invoke)
 */

import { invoke } from "@tauri-apps/api/core";
import type { VaultEntry } from "../../lib/vault-types";
import type { PathValidationResult } from "../../lib/vault-types";
import { buildButton } from "../../settings/settings-fields";
import {
  createVault,
  updateVault,
  deleteVault,
  getAllVaults,
  getActiveVault,
  getVaultIndex,
} from "../../lib/vault-manager";
import { checkVaultsForOverlap } from "../../lib/vault-utils";

// ── Constants ─────────────────────────────────────────────────────────────────

/** maxIndexSize value above which the performance warning badge appears. */
const PERFORMANCE_WARNING_THRESHOLD = 500;

/** Fallback maxIndexSize when the number input is empty or NaN. */
const DEFAULT_MAX_INDEX_SIZE = 500;

/** Default exclude patterns shown in the create form. */
const DEFAULT_EXCLUDE_PATTERNS_TEXT = "node_modules\n.git\n*.log";

// ── Module state ──────────────────────────────────────────────────────────────

/** Which view is currently rendered inside the panel container. */
type PanelView = "list" | "create" | "edit";

let currentView: PanelView = "list";
let editingVaultId: string | null = null;
/** The container element this panel was mounted into. */
let panelRoot: HTMLElement | null = null;
/** Optional callback invoked after a successful vault create or update. */
let _onClose: (() => void) | null = null;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Mount the Manage Vaults panel into `container`.
 *
 * Replaces the container's contents and renders the vault list view.
 * Call this whenever the "Vaults" settings tab becomes visible.
 *
 * When `selectedVaultId` is provided the panel opens directly on the edit
 * form for that vault instead of the default list view. This is used by the
 * vault node's "Edit Vault…" context menu item so the user lands on the
 * correct vault immediately (MEDIUM-4 fix).
 *
 * @param container       - The DOM element to render into.
 * @param selectedVaultId - Optional vault ID to pre-select for editing.
 */
export function mountManageVaultsPanel(container: HTMLElement, selectedVaultId?: string, onClose?: () => void): void {
  panelRoot = container;
  _onClose = onClose ?? null;
  if (selectedVaultId) {
    /* Open the edit form directly for the specified vault. */
    currentView = "edit";
    editingVaultId = selectedVaultId;
  } else {
    currentView = "list";
    editingVaultId = null;
  }
  render();
}

/**
 * Switch the panel to the Create Vault form and re-render.
 * Safe to call from external code (e.g. a "New Vault" action handler).
 */
export function showCreateVaultForm(): void {
  if (!panelRoot) return;
  currentView = "create";
  editingVaultId = null;
  render();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Clear and re-render the panel based on `currentView`. */
function render(): void {
  if (!panelRoot) return;
  panelRoot.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "manage-vaults-container";

  switch (currentView) {
    case "list":
      renderListView(wrapper);
      break;
    case "create":
      renderFormView(wrapper, null);
      break;
    case "edit": {
      const vault = getAllVaults().find((v) => v.id === editingVaultId) ?? null;
      renderFormView(wrapper, vault);
      break;
    }
  }

  panelRoot.appendChild(wrapper);
}

/** Render the vault list (or empty state). */
function renderListView(container: HTMLElement): void {
  // Header row: section label + "New Vault" button
  const header = document.createElement("div");
  header.className = "manage-vaults-list-header";
  const label = document.createElement("span");
  label.className = "settings-label";
  label.style.margin = "0";
  label.textContent = "Vaults";
  header.appendChild(label);
  header.appendChild(buildButton("New Vault", "primary", () => {
    currentView = "create";
    render();
  }));
  container.appendChild(header);

  const vaults = getAllVaults();
  const activeVault = getActiveVault();

  if (vaults.length === 0) {
    const empty = document.createElement("div");
    empty.className = "manage-vaults-empty";
    empty.innerHTML = "<p>No vaults yet. Create your first vault to get started.</p>";
    container.appendChild(empty);
    return;
  }

  const rows = document.createElement("div");
  rows.className = "vault-list-rows";
  for (const vault of vaults) {
    const row = document.createElement("div");
    row.className = "vault-list-row";
    if (activeVault?.id === vault.id) row.classList.add("active");

    const info = document.createElement("div");
    info.className = "vault-list-row-info";
    const nameEl = document.createElement("div");
    nameEl.className = "vault-list-row-name";
    nameEl.textContent = vault.name;
    info.appendChild(nameEl);
    const pathsEl = document.createElement("div");
    pathsEl.className = "vault-list-row-paths";
    pathsEl.textContent = vault.rootPaths.join(", ");
    info.appendChild(pathsEl);
    row.appendChild(info);

    const meta = document.createElement("div");
    meta.className = "vault-list-row-meta";
    if (activeVault?.id === vault.id) {
      const index = getVaultIndex();
      meta.textContent = index ? `${index.entries.length} files` : "Loading…";
    } else {
      const lastOpened = vault.lastOpened
        ? new Date(vault.lastOpened).toLocaleDateString()
        : "—";
      meta.textContent = `Last: ${lastOpened}`;
    }
    row.appendChild(meta);
    row.addEventListener("click", () => { editingVaultId = vault.id; currentView = "edit"; render(); });
    rows.appendChild(row);
  }
  container.appendChild(rows);
}

// ── Form field builders ───────────────────────────────────────────────────────

/**
 * Build the vault name field.
 *
 * @param vault - Existing vault when editing; null when creating.
 * @returns The field wrapper, the input element, and the inline error element.
 */
function buildNameField(vault: VaultEntry | null): {
  field: HTMLElement;
  input: HTMLInputElement;
  error: HTMLElement;
} {
  const field = createFormField("Vault Name");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input settings-input-wide";
  input.placeholder = "My Notes";
  input.value = vault?.name ?? "";
  field.appendChild(input);
  const error = document.createElement("div");
  error.className = "vault-inline-error";
  field.appendChild(error);
  return { field, input, error };
}

/**
 * Build the root paths field including the dynamic paths list and "Add" button.
 *
 * The returned `paths` array is the live mutable list that the save handler
 * reads when the form is submitted.
 *
 * @param vault - Existing vault when editing; null when creating.
 * @returns The field wrapper, the mutable paths array, and the inline error.
 */
function buildPathsField(vault: VaultEntry | null): {
  field: HTMLElement;
  paths: string[];
  error: HTMLElement;
} {
  const field = createFormField("Root Paths");
  const pathsList = document.createElement("div");
  pathsList.className = "vault-paths-list";
  field.appendChild(pathsList);

  /** Live mutable list of root paths being edited in this form session. */
  const paths: string[] = vault ? [...vault.rootPaths] : [];

  /**
   * Re-render the paths list. Called after each add or remove action.
   * Rebuilds pathsList from the current `paths` array.
   */
  function refreshPaths(): void {
    pathsList.innerHTML = "";
    for (const p of paths) {
      const row = document.createElement("div");
      row.className = "vault-path-entry";

      const text = document.createElement("span");
      text.className = "vault-path-entry-text";
      text.title = p;
      text.textContent = p;
      row.appendChild(text);

      const removeBtn = document.createElement("button");
      removeBtn.className = "vault-path-entry-remove";
      removeBtn.title = "Remove path";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        const idx = paths.indexOf(p);
        if (idx !== -1) paths.splice(idx, 1);
        refreshPaths();
      });
      row.appendChild(removeBtn);

      pathsList.appendChild(row);
    }
  }
  refreshPaths();

  const addPathBtn = document.createElement("button");
  addPathBtn.className = "vault-add-path-btn";
  addPathBtn.textContent = "+ Add Root Path";
  addPathBtn.addEventListener("click", async () => {
    // Use the Tauri open-folder dialog exposed on window.
    const dialog = (window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"] as
      | { openFolder?: () => Promise<string | null> }
      | undefined;

    if (dialog?.openFolder) {
      try {
        const chosen = await dialog.openFolder();
        if (chosen) {
          paths.push(chosen);
          refreshPaths();
        }
      } catch {
        // User cancelled or dialog failed — no-op.
      }
    }
  });
  field.appendChild(addPathBtn);

  const error = document.createElement("div");
  error.className = "vault-inline-error";
  field.appendChild(error);

  return { field, paths, error };
}

/**
 * Build the exclude patterns textarea field.
 *
 * @param vault - Existing vault when editing; null when creating.
 * @returns The field wrapper and the textarea element.
 */
function buildExcludeField(vault: VaultEntry | null): {
  field: HTMLElement;
  textarea: HTMLTextAreaElement;
} {
  const field = createFormField("Exclude Patterns (one per line)");
  const textarea = document.createElement("textarea");
  textarea.className = "settings-input settings-input-wide vault-form-textarea";
  textarea.placeholder = "node_modules\n.git\n*.log";
  textarea.value = vault
    ? vault.excludePatterns.join("\n")
    : DEFAULT_EXCLUDE_PATTERNS_TEXT;
  field.appendChild(textarea);
  return { field, textarea };
}

/**
 * Build the max index size number input field with its performance warning badge.
 *
 * @param vault - Existing vault when editing; null when creating.
 * @returns The field wrapper and the number input element.
 */
function buildMaxSizeField(vault: VaultEntry | null): {
  field: HTMLElement;
  input: HTMLInputElement;
} {
  const field = createFormField("Max Index Size (files)");
  const input = document.createElement("input");
  input.type = "number";
  input.className = "settings-input";
  input.style.width = "100px";
  input.min = "1";
  input.value = String(vault?.maxIndexSize ?? 500);
  field.appendChild(input);

  const perfWarning = document.createElement("div");
  perfWarning.className = "vault-performance-warning";
  perfWarning.textContent = "Vaults over 500 files may affect performance.";
  perfWarning.style.display =
    (vault?.maxIndexSize ?? 500) > PERFORMANCE_WARNING_THRESHOLD ? "block" : "none";
  input.addEventListener("input", () => {
    perfWarning.style.display =
      parseInt(input.value, 10) > PERFORMANCE_WARNING_THRESHOLD ? "block" : "none";
  });
  field.appendChild(perfWarning);

  return { field, input };
}

// ── Save handler ──────────────────────────────────────────────────────────────

/**
 * Synchronous pre-async validation: checks that the vault name is non-empty and
 * that at least one root path has been added.
 *
 * Extracted from handleSave (NEW-6 refactor) so that handleSave stays ≤30 lines
 * and the synchronous validation logic is independently testable.
 *
 * Writes error text directly into the error elements and returns false when any
 * check fails. Returns true only when both fields pass.
 *
 * @param name        - Trimmed vault name string.
 * @param paths       - Current root-paths array.
 * @param nameErrorEl - Inline error element for the name field.
 * @param pathsErrorEl - Inline error element for the paths field.
 * @returns true when both fields are valid; false otherwise.
 */
function validateForm(
  name: string,
  paths: string[],
  nameErrorEl: HTMLElement,
  pathsErrorEl: HTMLElement,
): boolean {
  let valid = true;

  // EC-01: vault name must not be blank.
  if (!name) {
    nameErrorEl.textContent = "Vault name is required.";
    valid = false;
  }

  // EC-02: at least one root path must be provided.
  if (paths.length === 0) {
    pathsErrorEl.textContent = "At least one root path is required.";
    valid = false;
  }

  return valid;
}

/**
 * Invoke the Rust `validate_vault_paths` command for each path in `paths` and
 * report the first failure via `pathsErrorEl`.
 *
 * Extracted from handleSave (NEW-6 refactor) so the async Tauri round-trip is
 * independently testable and handleSave stays ≤30 lines.
 *
 * Best-effort: if the Tauri command itself throws (e.g. in a test environment
 * where the backend is absent) the error is swallowed and the function returns
 * true so the save can continue without crashing.
 *
 * @param paths        - Root paths to validate.
 * @param pathsErrorEl - Inline error element to populate on the first failure.
 * @returns true when all paths are valid (or the command failed gracefully);
 *          false when any path does not exist or is not a directory.
 */
async function validatePaths(
  paths: string[],
  pathsErrorEl: HTMLElement,
): Promise<boolean> {
  let pathResults: PathValidationResult[] = [];
  try {
    pathResults = await invoke<PathValidationResult[]>("validate_vault_paths", {
      rootPaths: paths,
    });
  } catch { /* Command failure — continue without path validation. */ }

  for (const result of pathResults) {
    if (!result.exists) {
      pathsErrorEl.textContent = `Path does not exist: ${result.path}`;
      return false;
    }
    if (!result.isDirectory) {
      pathsErrorEl.textContent = `Path is a file, not a folder: ${result.path}`;
      return false;
    }
  }
  return true;
}

/**
 * Parse the exclude patterns textarea and max-index-size input into plain
 * values ready to pass to createVault / updateVault.
 *
 * Extracted from handleSave (NEW-6 refactor) so form-value parsing is
 * independently testable and handleSave stays ≤30 lines.
 *
 * @param excludeTextarea - Textarea whose value is one glob pattern per line.
 * @param maxSizeInput    - Number input for the file-count ceiling.
 * @returns Parsed excludePatterns array and maxIndexSize integer.
 */
function buildVaultPatch(
  excludeTextarea: HTMLTextAreaElement,
  maxSizeInput: HTMLInputElement,
): { excludePatterns: string[]; maxIndexSize: number } {
  // Split on newlines, trim whitespace, drop blank entries.
  const excludePatterns = excludeTextarea.value
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  // Fall back to the module default when the field is empty or NaN.
  const maxIndexSize = parseInt(maxSizeInput.value, 10) || DEFAULT_MAX_INDEX_SIZE;
  return { excludePatterns, maxIndexSize };
}

/**
 * Validate form inputs and call createVault or updateVault.
 *
 * Delegates each concern to a dedicated helper to stay ≤30 lines:
 *  - validateForm()   — synchronous empty-field checks (EC-01, EC-02).
 *  - validatePaths()  — async Tauri path-existence check (EC-03).
 *  - buildVaultPatch() — parses textarea + number input into save values.
 *
 * @param vault            - The vault being edited, or null when creating.
 * @param nameInput        - Name text input element.
 * @param nameError        - Inline error element for the name field.
 * @param currentPaths     - Live mutable array of root paths.
 * @param pathsError       - Inline error element for the paths field.
 * @param overlapWarning   - Warning banner element for path overlap (EC-04).
 * @param excludeTextarea  - Textarea for exclude patterns.
 * @param sizeInput        - Number input for max index size.
 * @param saveBtn          - The save/create button (disabled while saving).
 */
async function handleSave(
  vault: VaultEntry | null,
  nameInput: HTMLInputElement,
  nameError: HTMLElement,
  currentPaths: string[],
  pathsError: HTMLElement,
  overlapWarning: HTMLElement,
  excludeTextarea: HTMLTextAreaElement,
  sizeInput: HTMLInputElement,
  saveBtn: HTMLButtonElement
): Promise<void> {
  const isEdit = vault !== null;
  const name = nameInput.value.trim();
  // Clear previous error/warning state, then run the three validation steps.
  nameError.textContent = pathsError.textContent = "";
  overlapWarning.style.display = "none";
  // EC-01/EC-02 — synchronous: name non-empty + at least one root path.
  if (!validateForm(name, currentPaths, nameError, pathsError)) return;
  // EC-03 — async Tauri path-existence check (best-effort: skip on failure).
  if (!await validatePaths(currentPaths, pathsError)) return;
  // EC-04 — overlap warning (non-blocking, does not abort the save).
  const otherVaults = isEdit ? getAllVaults().filter((v) => v.id !== vault!.id) : getAllVaults();
  const { warning } = checkVaultsForOverlap(currentPaths, otherVaults);
  if (warning) { overlapWarning.textContent = warning; overlapWarning.style.display = "block"; }
  // Parse textarea + size input, then persist the vault.
  const { excludePatterns, maxIndexSize } = buildVaultPatch(excludeTextarea, sizeInput);
  saveBtn.disabled = true; saveBtn.textContent = isEdit ? "Saving…" : "Creating…";
  try {
    if (isEdit && vault) {
      await updateVault(vault.id, { name, rootPaths: currentPaths, excludePatterns, maxIndexSize });
    } else {
      // Pass maxIndexSize so the form value is persisted on creation (NEW-1 fix).
      await createVault(name, currentPaths, excludePatterns, maxIndexSize);
    }
    currentView = "list"; editingVaultId = null;
    if (_onClose) { _onClose(); } else { render(); }
  } catch (err) {
    saveBtn.disabled = false; saveBtn.textContent = isEdit ? "Save" : "Create";
    nameError.textContent = err instanceof Error ? err.message : String(err);
  }
}

// ── Form view ─────────────────────────────────────────────────────────────────

/**
 * Render the create or edit form. `vault` is null when creating.
 *
 * Delegates each form section to a dedicated builder function to stay ≤30
 * lines. All state (paths array, error elements) lives inside this call frame
 * and is passed explicitly to handleSave.
 *
 * @param container - The wrapper element to append the form into.
 * @param vault     - Existing vault to edit; null when creating a new vault.
 */
function renderFormView(container: HTMLElement, vault: VaultEntry | null): void {
  const isEdit = vault !== null;

  const sectionLabel = document.createElement("span");
  sectionLabel.className = "settings-label";
  sectionLabel.textContent = isEdit ? "Edit Vault" : "New Vault";
  container.appendChild(sectionLabel);

  const form = document.createElement("div");
  form.className = "vault-form";

  const { field: nameField, input: nameInput, error: nameError } = buildNameField(vault);
  const { field: pathsField, paths: currentPaths, error: pathsError } = buildPathsField(vault);
  const { field: excludeField, textarea: excludeTextarea } = buildExcludeField(vault);
  const { field: sizeField, input: sizeInput } = buildMaxSizeField(vault);

  // Overlap warning banner (populated by handleSave, hidden by default).
  const overlapWarning = document.createElement("div");
  overlapWarning.className = "vault-overlap-warning";
  overlapWarning.style.display = "none";

  form.appendChild(nameField);
  form.appendChild(pathsField);
  form.appendChild(overlapWarning);
  form.appendChild(excludeField);
  form.appendChild(sizeField);
  container.appendChild(form);

  container.appendChild(buildActions(vault, isEdit, nameInput, nameError,
    currentPaths, pathsError, overlapWarning, excludeTextarea, sizeInput));
}

/**
 * Build the form action buttons row (Cancel, Save/Create, Delete).
 *
 * Wires the Save button to handleSave and the Delete button to handleDelete.
 *
 * @returns The actions div element.
 */
function buildActions(
  vault: VaultEntry | null,
  isEdit: boolean,
  nameInput: HTMLInputElement,
  nameError: HTMLElement,
  currentPaths: string[],
  pathsError: HTMLElement,
  overlapWarning: HTMLElement,
  excludeTextarea: HTMLTextAreaElement,
  sizeInput: HTMLInputElement
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "vault-form-actions";

  actions.appendChild(buildButton("Cancel", "secondary", () => {
    currentView = "list";
    editingVaultId = null;
    render();
  }));

  const saveBtn = buildButton(isEdit ? "Save" : "Create", "primary", () =>
    handleSave(vault, nameInput, nameError, currentPaths, pathsError,
      overlapWarning, excludeTextarea, sizeInput, saveBtn)
  );
  actions.appendChild(saveBtn);

  if (isEdit && vault) {
    actions.appendChild(buildButton("Delete Vault", "danger", () => handleDelete(vault, nameError)));
  }

  return actions;
}

// ── Delete handler ────────────────────────────────────────────────────────────

/**
 * Prompt for deletion confirmation and call deleteVault on confirm.
 *
 * Shows an inline error message in `errorEl` when deleteVault() throws so
 * the user sees feedback without the UI going silent (MEDIUM-4).
 *
 * @param vault   - The vault to delete.
 * @param errorEl - An existing error element on the form to display failure messages.
 */
async function handleDelete(vault: VaultEntry, errorEl: HTMLElement): Promise<void> {
  const confirmed = window.confirm(
    `Delete vault "${vault.name}"? This will remove it from Markable. Your notes will not be deleted.`
  );
  if (!confirmed) return;

  try {
    await deleteVault(vault.id);
    currentView = "list";
    editingVaultId = null;
    render();
  } catch (err) {
    console.error("[manage-vaults-ui] deleteVault failed:", err);
    // Show the error inline rather than silently swallowing it (MEDIUM-4).
    errorEl.textContent = err instanceof Error
      ? `Failed to delete vault: ${err.message}`
      : "Failed to delete vault. Please try again.";
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Create a labelled form field wrapper `<div class="vault-form-field">`.
 *
 * @param labelText - The visible label text.
 * @returns The wrapper div (caller appends inputs to it).
 */
function createFormField(labelText: string): HTMLElement {
  const field = document.createElement("div");
  field.className = "vault-form-field";

  const label = document.createElement("label");
  label.className = "settings-label";
  label.textContent = labelText;
  field.appendChild(label);

  return field;
}
