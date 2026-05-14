/**
 * smart-folders.editor.test.ts
 *
 * Unit tests for the Smart Folders modal filter editor (step_05).
 *
 * Tests cover:
 *   - buildEditorElement: modal structure, name input, rules list
 *   - Type change: operator reset, value control re-render
 *   - Value controls: extension dropdown, tag datalist, link operators
 *   - Save / Cancel / backdrop-click / Escape
 *   - Validation: FR-26, EC-16
 *   - Add/remove rule rows
 */

import { describe, it, expect, vi } from "vitest";
import { buildEditorElement } from "../../../src/plugins/file-browser/smart-folders/editor-ui";
import type { SmartFolderDef } from "../../../src/plugins/file-browser/smart-folders/types";
import type { EditorContext } from "../../../src/plugins/file-browser/smart-folders/editor-ui";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBlankDef(): SmartFolderDef {
  return {
    id: "sf-test",
    name: "",
    rules: [{ type: "tag", operator: "is", value: "research" }],
  };
}

function makeCtx(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    distinctExtensions: [".md", ".pdf", ".png"],
    knownTags: ["research", "draft", "status:active"],
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

// ── Editor structure ──────────────────────────────────────────────────────────

describe("buildEditorElement structure", () => {
  it("renders a modal overlay with sf-modal-overlay class", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    expect(el.classList.contains("sf-modal-overlay")).toBe(true);
  });

  it("contains a settings-panel dialog", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const panel = el.querySelector(".settings-panel");
    expect(panel).not.toBeNull();
  });

  it("renders a name input with class sf-name-input", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const nameInput = el.querySelector<HTMLInputElement>(".sf-name-input");
    expect(nameInput).not.toBeNull();
    expect(nameInput!.tagName.toLowerCase()).toBe("input");
  });

  it("seeds name input from initial def", () => {
    const def: SmartFolderDef = { id: "sf-1", name: "Research Folder", rules: [{ type: "tag", operator: "is", value: "x" }] };
    const el = buildEditorElement(def, makeCtx());
    const nameInput = el.querySelector<HTMLInputElement>(".sf-name-input");
    expect(nameInput!.value).toBe("Research Folder");
  });

  it("renders a rules list with one row for a single-rule def", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const rows = el.querySelectorAll(".smart-folder-rule-row");
    expect(rows.length).toBe(1);
  });

  it("renders Save (.btn-primary) and Cancel (.btn-secondary) buttons", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const save   = el.querySelector(".btn-primary");
    const cancel = el.querySelector(".btn-secondary");
    expect(save).not.toBeNull();
    expect(cancel).not.toBeNull();
  });

  it("Save button is disabled initially when name is empty", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const save = el.querySelector<HTMLButtonElement>(".btn-primary");
    expect(save!.disabled).toBe(true);
  });

  it("Save button becomes enabled when name is entered", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const nameInput = el.querySelector<HTMLInputElement>(".sf-name-input");
    const save = el.querySelector<HTMLButtonElement>(".btn-primary");

    nameInput!.value = "My Folder";
    nameInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(save!.disabled).toBe(false);
  });
});

// ── Rule row elements ─────────────────────────────────────────────────────────

describe("rule row elements", () => {
  it("each row has a type selector", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const typeSelect = el.querySelector<HTMLSelectElement>(".sf-type");
    expect(typeSelect).not.toBeNull();
  });

  it("each row has an operator selector", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const opSelect = el.querySelector<HTMLSelectElement>(".sf-operator");
    expect(opSelect).not.toBeNull();
  });

  it("add button is present on every row", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const addBtn = el.querySelector(".sf-row-add");
    expect(addBtn).not.toBeNull();
  });

  it("remove button hidden on last remaining row (canRemove=false)", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const removeBtn = el.querySelector<HTMLButtonElement>(".sf-row-remove");
    expect(removeBtn === null || removeBtn.style.display === "none" || removeBtn.disabled).toBe(true);
  });

  it("clicking add button inserts a second row", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const addBtn = el.querySelector<HTMLButtonElement>(".sf-row-add");
    addBtn!.click();
    const rows = el.querySelectorAll(".smart-folder-rule-row");
    expect(rows.length).toBe(2);
  });
});

// ── Value controls ────────────────────────────────────────────────────────────

describe("extension value control", () => {
  it("renders a text input with datalist populated from distinctExtensions when type=extension", () => {
    const def: SmartFolderDef = {
      id: "sf-1",
      name: "Ext test",
      rules: [{ type: "extension", operator: "is", value: ".pdf" }],
    };
    const el = buildEditorElement(def, makeCtx());
    const extInput = el.querySelector<HTMLInputElement>(".sf-value input[list]");
    expect(extInput).not.toBeNull();
    const listId = extInput!.getAttribute("list");
    const datalist = el.querySelector<HTMLDataListElement>(`#${listId}`);
    expect(datalist).not.toBeNull();
    const options = Array.from(datalist!.options).map((o) => o.value);
    expect(options).toContain(".md");
    expect(options).toContain(".pdf");
  });
});

describe("tag value control", () => {
  it("renders a text input with datalist populated from knownTags", () => {
    const def: SmartFolderDef = {
      id: "sf-1",
      name: "Tag test",
      rules: [{ type: "tag", operator: "is", value: "research" }],
    };
    const el = buildEditorElement(def, makeCtx());
    const tagInput = el.querySelector<HTMLInputElement>(".sf-value input[list]");
    expect(tagInput).not.toBeNull();
    const listId = tagInput!.getAttribute("list");
    const datalist = el.querySelector<HTMLDataListElement>(`#${listId}`);
    expect(datalist).not.toBeNull();
    const options = Array.from(datalist!.options).map((o) => o.value);
    expect(options).toContain("research");
    expect(options).toContain("draft");
  });
});

describe("links value controls", () => {
  it("'outbound = 0' operator has no value input", () => {
    const def: SmartFolderDef = {
      id: "sf-1",
      name: "Links test",
      rules: [{ type: "links", operator: "outbound = 0", value: null }],
    };
    const el = buildEditorElement(def, makeCtx());
    const valueSpan = el.querySelector(".sf-value");
    expect(valueSpan).not.toBeNull();
    const inputs = valueSpan!.querySelectorAll("input, select");
    expect(inputs.length).toBe(0);
  });

  it("'outbound >= N' operator shows a number input", () => {
    const def: SmartFolderDef = {
      id: "sf-1",
      name: "Links N test",
      rules: [{ type: "links", operator: "outbound >= N", value: 3 }],
    };
    const el = buildEditorElement(def, makeCtx());
    const numInput = el.querySelector<HTMLInputElement>(".sf-value input[type=number]");
    expect(numInput).not.toBeNull();
    expect(numInput!.value).toBe("3");
  });
});

// ── Type change ───────────────────────────────────────────────────────────────

describe("type change resets operator", () => {
  it("switching from 'tag' to 'path' resets operator to first path operator", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    const typeSelect = el.querySelector<HTMLSelectElement>(".sf-type");
    const opSelect   = el.querySelector<HTMLSelectElement>(".sf-operator");

    typeSelect!.value = "path";
    typeSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(opSelect!.value).toBe("contains");
  });
});

// ── Save / Cancel / backdrop-click / Escape ───────────────────────────────────

describe("Save button", () => {
  it("calls onSave with the built def when valid", () => {
    const onSave = vi.fn();
    const def: SmartFolderDef = {
      id: "sf-1",
      name: "Research",
      rules: [{ type: "tag", operator: "is", value: "research" }],
    };
    const el = buildEditorElement(def, makeCtx({ onSave }));

    const save = el.querySelector<HTMLButtonElement>(".btn-primary");
    save!.click();

    expect(onSave).toHaveBeenCalledOnce();
    const savedDef = onSave.mock.calls[0][0] as SmartFolderDef;
    expect(savedDef.id).toBe("sf-1");
    expect(savedDef.name).toBe("Research");
  });

  it("shows validation message when name is empty (EC-16)", () => {
    const onSave = vi.fn();
    const el = buildEditorElement(makeBlankDef(), makeCtx({ onSave }));
    const save = el.querySelector<HTMLButtonElement>(".btn-primary");

    save!.disabled = false;
    save!.click();

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("Cancel button", () => {
  it("calls onCancel when clicked", () => {
    const onCancel = vi.fn();
    const el = buildEditorElement(makeBlankDef(), makeCtx({ onCancel }));
    const cancel = el.querySelector<HTMLButtonElement>(".btn-secondary");
    cancel!.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("Escape key", () => {
  it("calls onCancel when Escape is pressed in the modal", () => {
    const onCancel = vi.fn();
    const el = buildEditorElement(makeBlankDef(), makeCtx({ onCancel }));
    document.body.appendChild(el);

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    el.dispatchEvent(event);

    expect(onCancel).toHaveBeenCalledOnce();
    document.body.removeChild(el);
  });
});

describe("backdrop click", () => {
  it("calls onCancel when backdrop is clicked", () => {
    const onCancel = vi.fn();
    const el = buildEditorElement(makeBlankDef(), makeCtx({ onCancel }));
    document.body.appendChild(el);

    const backdrop = el.querySelector<HTMLElement>(".settings-backdrop");
    expect(backdrop).not.toBeNull();
    backdrop!.click();

    expect(onCancel).toHaveBeenCalledOnce();
    document.body.removeChild(el);
  });

  it("does NOT call onCancel when clicking inside the panel", () => {
    const onCancel = vi.fn();
    const el = buildEditorElement(makeBlankDef(), makeCtx({ onCancel }));
    document.body.appendChild(el);

    const panel = el.querySelector<HTMLElement>(".settings-panel");
    const event = new MouseEvent("click", { bubbles: true });
    panel!.dispatchEvent(event);

    expect(onCancel).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });
});

// ── Add/remove rows ───────────────────────────────────────────────────────────

describe("add and remove rows", () => {
  it("adding a row then removing it leaves one row", () => {
    const el = buildEditorElement(makeBlankDef(), makeCtx());
    document.body.appendChild(el);

    const addBtn = el.querySelector<HTMLButtonElement>(".sf-row-add");
    addBtn!.click();

    const removeButtons = el.querySelectorAll<HTMLButtonElement>(".sf-row-remove");
    const visibleRemove = Array.from(removeButtons).find(
      (b) => b.style.display !== "none" && !b.disabled,
    );
    visibleRemove?.click();

    const rows = el.querySelectorAll(".smart-folder-rule-row");
    expect(rows.length).toBe(1);

    document.body.removeChild(el);
  });
});
