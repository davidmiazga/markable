/**
 * smart-folders/context-menu.ts
 *
 * Context-menu items factory for Smart Folder rows (step_06).
 *
 * Responsibilities:
 *   - buildSmartFolderContextMenuItems: returns [Edit Filters, Rename,
 *     separator, Delete] compatible with the existing showContextMenu factory.
 *   - startSmartFolderInlineRename: DOM inline-rename for the smart folder
 *     name (name only — rules are untouched, FR-24). Mirrors the technique
 *     used by startInlineRename in file-browser.plugin.ts.
 *
 * Design constraints:
 *   - Reuses openFilterEditor from index.ts for Edit Filters (AD-9).
 *   - Delete receives an onDelete callback from the plugin layer so this
 *     module stays decoupled from plugin module-level state (same callback
 *     pattern as registerCommitDraftCallback).
 *   - window.confirm for Delete UX matches vault-unmount precedent (step_06 spec).
 *   - No TODO comments; all deferred work is in 00_index.md.
 *
 * @module smart-folders/context-menu
 */

import type { SmartFolderDef } from "./types";
import { openFilterEditor } from "./index";

// ── Local type alias ─────────────────────────────────────────────────────────

/**
 * A single context-menu item — shape matches the existing showContextMenu
 * factory used throughout file-browser.plugin.ts (inlined here per AD-9 note
 * about MenuItem not being exported from the plugin).
 */
export interface SmartFolderMenuItem {
  label: string;
  handler: (() => void) | null;
  disabled?: boolean;
  separator?: boolean;
}

// ── Items factory ─────────────────────────────────────────────────────────────

/**
 * Build the context-menu items shown when a Smart Folder row is right-clicked.
 *
 * Returns four items: Edit Filters, Rename, separator, Delete.
 *
 * The Delete item receives an onDelete callback from the plugin layer
 * (called with the def id after user confirms). The Rename item starts an
 * inline-rename flow directly on the <li> element. The plugin layer supplies
 * an onRename callback that commits the name change to settings.
 *
 * @param el          - The smart-folder <li> DOM element.
 * @param def         - The current SmartFolderDef (for pre-populating forms).
 * @param vaultRootPath - Vault root path used as anchorPath in create mode.
 * @param onDelete    - Optional callback(id) called after user confirms delete.
 * @param onRename    - Optional callback(id, newName) called after Enter commit.
 * @returns Array of menu items compatible with showContextMenu.
 */
export function buildSmartFolderContextMenuItems(
  el: HTMLElement,
  def: SmartFolderDef,
  _vaultRootPath: string,
  onDelete?: (id: string) => void,
  onRename?: (id: string, newName: string) => void,
): SmartFolderMenuItem[] {
  return [
    {
      label: "Edit Filters",
      handler: () => {
        // Use the smart-folder's synthetic path as the anchor (AD-8).
        const anchorPath = el.getAttribute("data-path") ?? "";
        openFilterEditor({ mode: "edit", anchorPath, def });
      },
    },
    {
      label: "Rename",
      handler: () => {
        startSmartFolderInlineRename(el, def, onRename);
      },
    },
    {
      // Visual separator between non-destructive and destructive actions.
      separator: true,
      label: "",
      handler: null,
    },
    {
      label: "Delete",
      handler: () => {
        confirmAndDelete(def, onDelete);
      },
    },
  ];
}

// ── Inline rename ─────────────────────────────────────────────────────────────

/**
 * Start an inline rename flow on the smart folder row.
 *
 * Mirrors startInlineRename in file-browser.plugin.ts:
 *   - Locates .tree-node-label inside el and replaces it with a text input.
 *   - Enter commits (calls onRename callback with the original id and new name).
 *   - Escape or empty value restores the original label without committing.
 *   - Blur restores the label after a 100 ms defer (same as startInlineRename).
 *
 * EC-05: the id is passed directly to onRename — it never changes, so
 * expandedPaths key "__smart__/<id>" survives renames automatically.
 *
 * @param el       - The smart-folder <li> element.
 * @param def      - The current SmartFolderDef (for the pre-filled name).
 * @param onRename - Callback(id, newName) invoked on commit; may be undefined.
 */
export function startSmartFolderInlineRename(
  el: HTMLElement,
  def: SmartFolderDef,
  onRename?: (id: string, newName: string) => void,
): void {
  const labelEl = el.querySelector<HTMLElement>(".tree-node-label");
  if (!labelEl) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-node-rename-input";
  input.value = def.name;

  // Replace the label span with the input in-place.
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  /** Restore the original label without committing. */
  const cancel = (): void => {
    if (document.contains(input)) {
      input.replaceWith(labelEl);
    }
  };

  /** Commit the rename: call onRename with the stable id and trimmed new name. */
  const commit = (): void => {
    const newName = input.value.trim();
    // An empty or unchanged name is treated as cancel.
    if (!newName || newName === def.name) {
      cancel();
      return;
    }
    input.replaceWith(labelEl);
    labelEl.textContent = newName;
    onRename?.(def.id, newName);
  };

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { cancel(); }
  });

  // Blur restores the label after a short defer so that Enter commits first.
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.contains(input)) cancel();
    }, 100);
  });

  // Prevent click-propagation while the input is focused (mirrors startInlineRename).
  input.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
}

// ── Confirm-and-delete helper ─────────────────────────────────────────────────

/**
 * Prompt for confirmation before deleting a Smart Folder.
 *
 * Uses window.confirm (matching vault-unmount UX precedent). If confirmed,
 * calls onDelete with the def id so the plugin layer can purge module-level
 * state (_smartFolders, _expandedPaths, _evaluationResults) and persist.
 *
 * EC-06: expansion-state purge and result-cache purge are the caller's
 * responsibility — this function is decoupled from plugin-layer state.
 *
 * @param def      - The SmartFolderDef to delete.
 * @param onDelete - Callback(id) invoked only when the user confirms.
 */
function confirmAndDelete(
  def: SmartFolderDef,
  onDelete?: (id: string) => void,
): void {
  const confirmed = window.confirm(
    `Delete Smart Folder "${def.name}"? This cannot be undone. Files are not affected.`,
  );
  if (!confirmed) return;
  onDelete?.(def.id);
}
