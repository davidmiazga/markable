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

import type { SmartFolderDef, SmartFolderRule, SmartFolderRuleType } from "./types";
import { attachModalKeyboard } from "../../../lib/modal-keyboard";

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

// ── Operator whitelist per type ───────────────────────────────────────────────

const OPERATORS_BY_TYPE: Record<SmartFolderRuleType, string[]> = {
  tag:         ["is", "is not"],
  path:        ["contains", "does not contain", "starts with", "does not start with"],
  extension:   ["is", "is not"],
  "file-type": ["is", "is not"],
  modified:    ["in last N days", "not in last N days", "before", "after"],
  links:       ["outbound = 0", "outbound >= 1", "outbound >= N",
                "inbound = 0",  "inbound >= 1",  "inbound >= N"],
  title:       ["contains", "does not contain"],
};

const TYPE_LABELS: Record<SmartFolderRuleType, string> = {
  tag:         "Tag",
  path:        "Path",
  extension:   "Extension",
  "file-type": "File Type",
  modified:    "Modified",
  links:       "Links",
  title:       "Title",
};

function defaultValueForType(type: SmartFolderRuleType, op: string): SmartFolderRule["value"] {
  if (type === "file-type") return "images";
  if (op === "outbound = 0" || op === "outbound >= 1" ||
      op === "inbound = 0"  || op === "inbound >= 1")  return null;
  if (op === "outbound >= N" || op === "inbound >= N") return 1;
  if (op === "in last N days" || op === "not in last N days") return 7;
  if (op === "before" || op === "after") return new Date().toISOString().slice(0, 10);
  return "";
}

function isNullValueOp(op: string): boolean {
  return op === "outbound = 0" || op === "outbound >= 1" ||
         op === "inbound = 0"  || op === "inbound >= 1";
}

// ── Value control builders ────────────────────────────────────────────────────

let _datalistCounter = 0;

function buildValueControl(
  type: SmartFolderRuleType,
  op: string,
  value: SmartFolderRule["value"],
  ctx: EditorContext,
  onChange: (v: SmartFolderRule["value"]) => void,
): HTMLElement {
  const span = document.createElement("span");
  span.className = "sf-value";

  if (type === "tag") {
    const listId = `sf-tags-${++_datalistCounter}`;
    const input  = document.createElement("input");
    input.type = "text";
    input.className = "settings-input sf-value-input";
    input.setAttribute("list", listId);
    input.value = (value as string) || "";
    input.addEventListener("input", () => onChange(input.value));

    const dl = document.createElement("datalist");
    dl.id = listId;
    for (const tag of ctx.knownTags) {
      const opt = document.createElement("option");
      opt.value = tag;
      dl.appendChild(opt);
    }
    span.appendChild(input);
    span.appendChild(dl);

  } else if (type === "extension") {
    // Text + datalist: user can type any extension; vault extensions are suggestions.
    // Using a text input (not a select) avoids the "auto-selected option never fires
    // onChange" trap that caused value="" to be saved when the user never clicked.
    const listId = `sf-exts-${++_datalistCounter}`;
    const input  = document.createElement("input");
    input.type  = "text";
    input.className = "settings-input sf-value-input";
    input.setAttribute("list", listId);
    input.placeholder = ".md";
    input.value = (value as string) || "";
    input.addEventListener("input", () => onChange(input.value));

    const dl = document.createElement("datalist");
    dl.id = listId;
    for (const ext of ctx.distinctExtensions) {
      const opt = document.createElement("option");
      opt.value = ext;
      dl.appendChild(opt);
    }
    span.appendChild(input);
    span.appendChild(dl);

  } else if (type === "file-type") {
    const sel = document.createElement("select");
    sel.className = "settings-select sf-value-select";
    const groups = [
      { value: "images", label: "Images" },
      { value: "video",  label: "Video"  },
      { value: "audio",  label: "Audio"  },
    ];
    const current = (value as string) || "images";
    for (const g of groups) {
      const opt = document.createElement("option");
      opt.value = g.value;
      opt.textContent = g.label;
      if (g.value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    span.appendChild(sel);

  } else if (type === "modified") {
    if (op === "in last N days" || op === "not in last N days") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "settings-input sf-value-input sf-value-number";
      input.min  = "1";
      input.step = "1";
      input.value = String(value ?? 7);
      input.addEventListener("input", () => onChange(Math.max(1, Math.round(Number(input.value)))));
      const lbl = document.createElement("span");
      lbl.className = "sf-days-label";
      lbl.textContent = "days";
      span.appendChild(input);
      span.appendChild(lbl);
    } else {
      const input = document.createElement("input");
      input.type = "date";
      input.className = "settings-input sf-value-input";
      input.value = (value as string) || "";
      input.addEventListener("change", () => onChange(input.value));
      span.appendChild(input);
    }

  } else if (type === "links") {
    if (!isNullValueOp(op)) {
      const input = document.createElement("input");
      input.type  = "number";
      input.className = "settings-input sf-value-input sf-value-number";
      input.min   = "1";
      input.step  = "1";
      input.value = String(value ?? 1);
      input.addEventListener("input", () => onChange(Math.max(1, Math.round(Number(input.value)))));
      span.appendChild(input);
    }

  } else {
    // path and title: text input
    const input = document.createElement("input");
    input.type  = "text";
    input.className = "settings-input sf-value-input";
    input.value = (value as string) || "";
    input.addEventListener("input", () => onChange(input.value));
    span.appendChild(input);
  }

  return span;
}

// ── Rule row builder ──────────────────────────────────────────────────────────

function buildRuleRow(
  rule: SmartFolderRule,
  ctx: EditorContext,
  onRowChange: (next: SmartFolderRule) => void,
  onRowRemove: () => void,
  onRowAdd: () => void,
  canRemove: boolean,
): HTMLElement {
  const li = document.createElement("li");
  li.className = "smart-folder-rule-row";

  let currentRule: SmartFolderRule = { ...rule };

  const typeSelect = document.createElement("select");
  typeSelect.className = "settings-select sf-type";
  const types: SmartFolderRuleType[] = ["tag", "path", "extension", "file-type", "modified", "links", "title"];
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = TYPE_LABELS[t];
    if (t === rule.type) opt.selected = true;
    typeSelect.appendChild(opt);
  }

  const opSelect = document.createElement("select");
  opSelect.className = "settings-select sf-operator";

  let valueSpan = buildValueControl(
    currentRule.type, currentRule.operator, currentRule.value, ctx,
    (v) => { currentRule = { ...currentRule, value: v } as SmartFolderRule; onRowChange(currentRule); },
  );

  function rebuildOperators(): void {
    opSelect.innerHTML = "";
    for (const op of OPERATORS_BY_TYPE[currentRule.type]) {
      const opt = document.createElement("option");
      opt.value = op;
      opt.textContent = op;
      if (op === currentRule.operator) opt.selected = true;
      opSelect.appendChild(opt);
    }
  }

  function rebuildValue(): void {
    const newSpan = buildValueControl(
      currentRule.type, currentRule.operator, currentRule.value, ctx,
      (v) => { currentRule = { ...currentRule, value: v } as SmartFolderRule; onRowChange(currentRule); },
    );
    valueSpan.replaceWith(newSpan);
    valueSpan = newSpan;
  }

  rebuildOperators();

  typeSelect.addEventListener("change", () => {
    const newType = typeSelect.value as SmartFolderRuleType;
    const firstOp = OPERATORS_BY_TYPE[newType][0];
    const defaultVal = defaultValueForType(newType, firstOp);
    currentRule = { type: newType, operator: firstOp, value: defaultVal } as SmartFolderRule;
    rebuildOperators();
    rebuildValue();
    onRowChange(currentRule);
  });

  opSelect.addEventListener("change", () => {
    const newOp = opSelect.value;
    const defaultVal = defaultValueForType(currentRule.type, newOp);
    currentRule = { ...currentRule, operator: newOp, value: defaultVal } as SmartFolderRule;
    rebuildValue();
    onRowChange(currentRule);
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "sf-row-remove";
  removeBtn.setAttribute("aria-label", "Remove rule");
  removeBtn.textContent = "−";
  removeBtn.style.display = canRemove ? "" : "none";
  removeBtn.addEventListener("click", onRowRemove);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "sf-row-add";
  addBtn.setAttribute("aria-label", "Add rule");
  addBtn.textContent = "+";
  addBtn.addEventListener("click", onRowAdd);

  li.appendChild(typeSelect);
  li.appendChild(opSelect);
  li.appendChild(valueSpan);
  li.appendChild(removeBtn);
  li.appendChild(addBtn);

  return li;
}

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
      const row = buildRuleRow(
        draftRules[idx],
        ctx,
        (next) => { draftRules[idx] = next; updateSaveEnabled(); },
        () => {
          if (draftRules.length <= 1) return;
          draftRules.splice(idx, 1);
          rebuildRows();
          updateSaveEnabled();
        },
        () => {
          const firstOp = OPERATORS_BY_TYPE["tag"][0];
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
