/**
 * rule-row.ts — shared filter-rule row UI.
 *
 * Extracted from `src/plugins/file-browser/smart-folders/editor-ui.ts` so the
 * same `[Type ▾] [Operator ▾] [Value] [−] [+]` row can be used by both the
 * Smart Folder editor and the Select-builder modal (`src/lib/select-builder.ts`).
 *
 * Pure DOM construction; no framework. Types come from the smart-folders
 * type module (types-only import, no runtime cost).
 */

import type {
  SmartFolderRule,
  SmartFolderRuleType,
} from "../plugins/file-browser/smart-folders/types";

export interface RuleRowContext {
  /** Lowercase, leading-dot, sorted distinct extensions for the vault. */
  distinctExtensions: string[];
  /** All known tags + field:value pairs from the last tag scan. */
  knownTags: string[];
}

export const OPERATORS_BY_TYPE: Record<SmartFolderRuleType, string[]> = {
  tag:         ["is", "is not"],
  path:        ["contains", "does not contain", "starts with", "does not start with"],
  extension:   ["is", "is not"],
  "file-type": ["is", "is not"],
  modified:    ["in last N days", "not in last N days", "before", "after"],
  links:       ["outbound = 0", "outbound >= 1", "outbound >= N",
                "inbound = 0",  "inbound >= 1",  "inbound >= N"],
  title:       ["contains", "does not contain"],
};

export const TYPE_LABELS: Record<SmartFolderRuleType, string> = {
  tag:         "Tag",
  path:        "Path",
  extension:   "Extension",
  "file-type": "File Type",
  modified:    "Modified",
  links:       "Links",
  title:       "Title",
};

export function defaultValueForType(
  type: SmartFolderRuleType,
  op: string,
): SmartFolderRule["value"] {
  if (type === "file-type") return "images";
  if (op === "outbound = 0" || op === "outbound >= 1" ||
      op === "inbound = 0"  || op === "inbound >= 1")  return null;
  if (op === "outbound >= N" || op === "inbound >= N") return 1;
  if (op === "in last N days" || op === "not in last N days") return 7;
  if (op === "before" || op === "after") return new Date().toISOString().slice(0, 10);
  return "";
}

export function isNullValueOp(op: string): boolean {
  return op === "outbound = 0" || op === "outbound >= 1" ||
         op === "inbound = 0"  || op === "inbound >= 1";
}

let _datalistCounter = 0;

export function buildValueControl(
  type: SmartFolderRuleType,
  op: string,
  value: SmartFolderRule["value"],
  ctx: RuleRowContext,
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

export function buildRuleRow(
  rule: SmartFolderRule,
  ctx: RuleRowContext,
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
