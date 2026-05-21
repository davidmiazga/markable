/**
 * smart-folders/editor-ui.ts
 *
 * Modal filter editor for Smart Folders (step_05).
 *
 * Renders a centered modal overlay — same structure and component classes as
 * the settings panel (.settings-overlay / .settings-panel / .btn etc.) — so
 * the editor has room for all filter controls and feels native to the app.
 *
 * Rule row layout (Mac Finder pattern, FR-23):
 *   [Type ▾] [Operator ▾] [Value control] [−] [+]
 *
 * Design principles:
 *   - Pure DOM, no framework. Follows file-browser plugin idioms.
 *   - Draft state lives in a closure inside buildEditorElement.
 *   - Modal closes on: backdrop click, × button, Cancel button, Escape key.
 *   - Save is disabled until name non-empty AND rules ≥ 1 (FR-26, EC-16).
 *   - Type change resets operator to first valid for new type (FR-23).
 *
 * @module smart-folders/editor-ui
 */

import type { SmartFolderDef, SmartFolderRule } from "./types";
import { attachModalKeyboard } from "../../../lib/modal-keyboard";
import {
  buildRuleRow as sharedBuildRuleRow,
  OPERATORS_BY_TYPE as SHARED_OPERATORS_BY_TYPE,
  type RuleRowContext,
} from "../../../lib/rule-row";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Dependencies injected into the editor at open time.
 *
 * Resolved once by the caller (index.ts) from the evaluator's cached state
 * so the editor can synchronously populate dropdowns.
 */
export interface EditorContext {
  /** Lowercase, leading-dot, sorted distinct extensions for the vault. */
  distinctExtensions: string[];
  /** All known tags + field:value pairs from the last tag scan. */
  knownTags: string[];
  /** Called when the user clicks Save with a valid draft. */
  onSave: (draft: SmartFolderDef) => void;
  /** Called when the user dismisses the modal (Cancel / backdrop / Escape). */
  onCancel: () => void;
}

// Constants and helpers (OPERATORS_BY_TYPE, defaultValueForType, etc.) live in
// src/lib/rule-row.ts and are imported above. EditorContext below is identical
// in shape to the shared RuleRowContext for that reason.

// ── Modal editor builder ──────────────────────────────────────────────────────

/**
 * Build the smart folder filter editor as a full-screen modal overlay.
 *
 * Uses the same .settings-overlay / .settings-panel component classes as the
 * settings panel so styles, spacing, and button variants are consistent.
 *
 * The returned element should be appended to document.body by the caller.
 * Cleanup (removal from body) is the caller's responsibility via onSave /
 * onCancel callbacks.
 *
 * @param initial - SmartFolderDef to seed the form (may have empty name/rules).
 * @param ctx     - Injected dependencies: tag/ext lists, save/cancel callbacks.
 * @returns The overlay HTMLElement, ready for document.body.appendChild.
 */
export function buildEditorElement(initial: SmartFolderDef, ctx: EditorContext): HTMLElement {
  const isEdit = initial.name.length > 0;

  // ── Overlay + backdrop ───────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay sf-modal-overlay";
  overlay.setAttribute("data-sf-editor", "");

  const backdrop = document.createElement("div");
  backdrop.className = "settings-backdrop";
  overlay.appendChild(backdrop);

  // ── Dialog panel ─────────────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "settings-panel sf-modal";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", isEdit ? "Edit Smart Folder" : "New Smart Folder");
  panel.tabIndex = -1;
  overlay.appendChild(panel);

  // ── Header ───────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "settings-header";

  const titleEl = document.createElement("h2");
  titleEl.className = "settings-title";
  titleEl.textContent = isEdit ? "Edit Smart Folder" : "New Smart Folder";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "settings-close-btn";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = "&times;";

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Body ─────────────────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "settings-body";
  panel.appendChild(body);

  // Name field
  const nameRow = document.createElement("div");
  nameRow.className = "settings-row sf-name-row";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "settings-input settings-input-wide sf-name-input";
  nameInput.placeholder = "Folder name…";
  nameInput.value = initial.name;
  nameRow.appendChild(nameInput);
  body.appendChild(nameRow);

  // Filters section label
  const filtersLabel = document.createElement("div");
  filtersLabel.className = "settings-label sf-filters-label";
  filtersLabel.textContent = "Filters";
  body.appendChild(filtersLabel);

  // Rules list
  const rulesList = document.createElement("ul");
  rulesList.className = "smart-folder-rules";
  body.appendChild(rulesList);

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "settings-footer sf-modal-footer";

  const validationMsg = document.createElement("span");
  validationMsg.className = "smart-folder-validation-msg";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save";
  saveBtn.disabled = true;

  footer.appendChild(validationMsg);
  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  panel.appendChild(footer);

  // ── Draft state ───────────────────────────────────────────────────────────────
  let draftRules: SmartFolderRule[] = [...initial.rules];

  function updateSaveEnabled(): void {
    const hasName  = nameInput.value.trim().length > 0;
    const hasRules = draftRules.length > 0;
    saveBtn.disabled = !(hasName && hasRules);
    if (hasName && hasRules) validationMsg.textContent = "";
  }

  nameInput.addEventListener("input", updateSaveEnabled);

  function rebuildRows(): void {
    rulesList.innerHTML = "";
    for (let i = 0; i < draftRules.length; i++) {
      const idx = i;
      const row = sharedBuildRuleRow(
        draftRules[idx],
        ctx as RuleRowContext,
        (next) => { draftRules[idx] = next; updateSaveEnabled(); },
        () => {
          if (draftRules.length <= 1) return;
          draftRules.splice(idx, 1);
          rebuildRows();
          updateSaveEnabled();
        },
        () => {
          const firstOp = SHARED_OPERATORS_BY_TYPE["tag"][0];
          const blank: SmartFolderRule = { type: "tag", operator: firstOp, value: "" } as SmartFolderRule;
          draftRules.splice(idx + 1, 0, blank);
          rebuildRows();
          updateSaveEnabled();
        },
        draftRules.length > 1,
      );
      rulesList.appendChild(row);
    }
  }

  rebuildRows();
  updateSaveEnabled();

  // ── Event handlers ────────────────────────────────────────────────────────────
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name || draftRules.length === 0) {
      validationMsg.textContent = "Enter a name and at least one rule.";
      return;
    }
    ctx.onSave({ id: initial.id, name, rules: draftRules });
  });

  const doCancel = (): void => ctx.onCancel();

  backdrop.addEventListener("click", () => doCancel());
  closeBtn.addEventListener("click", () => doCancel());
  cancelBtn.addEventListener("click", () => doCancel());

  attachModalKeyboard({ modal: overlay, onClose: doCancel });

  return overlay;
}
