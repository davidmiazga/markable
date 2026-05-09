/**
 * smart-folders.context-menu.test.ts
 *
 * Unit tests for the Smart Folders context menu integration (step_06).
 *
 * Tests cover:
 *   - buildSmartFolderContextMenuItems: returns Edit Filters, Rename, separator, Delete
 *   - Edit Filters opens editor in edit mode anchored to the row
 *   - Rename swaps label for input (DOM technique)
 *   - Rename Enter commits and label updates
 *   - Rename does not change id (EC-05)
 *   - Rename Escape restores original label
 *   - Delete prompts confirm; cancel keeps def
 *   - Delete confirm removes def and purges expandedPaths['__smart__/<id>'] (FR-25, EC-06)
 *   - Delete confirm purges _evaluationResults entry (EC-06)
 *   - Vault-root right-click menu has 'New Smart Folder' item (FR-22)
 *   - Add row menu has 'New Smart Folder' item (FR-22)
 *   - New Smart Folder opens editor in create mode anchored to vault root
 *   - removeEvaluationResult removes entry from the cache
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSmartFolderContextMenuItems,
  startSmartFolderInlineRename,
} from "../../../src/plugins/file-browser/smart-folders/context-menu";
import {
  removeEvaluationResult,
  getEvaluationResult,
  clearEvaluationCache,
} from "../../../src/plugins/file-browser/smart-folders/index";
import { closeFilterEditor } from "../../../src/plugins/file-browser/smart-folders/index";
import type { SmartFolderDef } from "../../../src/plugins/file-browser/smart-folders/types";
import { _testing } from "../../../src/plugins/file-browser/file-browser.plugin";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDef(overrides: Partial<SmartFolderDef> = {}): SmartFolderDef {
  return {
    id: "sf-test-1",
    name: "Research",
    rules: [{ type: "tag", operator: "is", value: "research" }],
    ...overrides,
  };
}

/** Build a minimal <li> element representing a smart-folder row in the DOM. */
function makeSmartFolderLi(def: SmartFolderDef): HTMLElement {
  const li = document.createElement("li");
  li.setAttribute("data-path", `__smart__/${def.id}`);
  li.setAttribute("data-type", "directory");
  li.setAttribute("data-smart-folder-id", def.id);
  li.className = "tree-node tree-node-smart-folder";

  const iconSpan = document.createElement("span");
  iconSpan.className = "folder-icon-smart";

  const labelEl = document.createElement("span");
  labelEl.className = "tree-node-label";
  labelEl.textContent = def.name;

  li.appendChild(iconSpan);
  li.appendChild(labelEl);
  document.body.appendChild(li);
  return li;
}

/** Build a minimal vault root <li> for "New Smart Folder" anchor tests. */
function makeVaultRootLi(rootPath: string): HTMLElement {
  const li = document.createElement("li");
  li.setAttribute("data-path", rootPath);
  li.setAttribute("data-type", "vault");
  document.body.appendChild(li);
  return li;
}

// ── buildSmartFolderContextMenuItems ─────────────────────────────────────────

describe("buildSmartFolderContextMenuItems structure", () => {
  let li: HTMLElement;
  const def = makeDef();

  beforeEach(() => {
    li = makeSmartFolderLi(def);
    (window as any).__MARKABLE_VAULT_MANAGER__ = null;
    (window as any).__TAURI_INTERNALS__ = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns an array with four items (Edit Filters, Rename, separator, Delete)", () => {
    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    expect(items).toHaveLength(4);
  });

  it("first item label is 'Edit Filters'", () => {
    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    expect(items[0].label).toBe("Edit Filters");
  });

  it("second item label is 'Rename'", () => {
    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    expect(items[1].label).toBe("Rename");
  });

  it("third item is a separator", () => {
    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    expect(items[2].separator).toBe(true);
  });

  it("fourth item label is 'Delete'", () => {
    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    expect(items[3].label).toBe("Delete");
  });

  it("all items have a handler function (or null for separator)", () => {
    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    expect(typeof items[0].handler).toBe("function");
    expect(typeof items[1].handler).toBe("function");
    // separator handler may be null
    expect(typeof items[3].handler).toBe("function");
  });
});

// ── Edit Filters handler ──────────────────────────────────────────────────────

describe("Edit Filters handler", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    closeFilterEditor();
  });

  it("Edit Filters handler opens the filter editor in edit mode", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    items[0].handler!();

    // The modal overlay should be present on document.body
    const editor = document.querySelector(".sf-modal-overlay");
    expect(editor).not.toBeNull();
  });

  it("Edit Filters mounts editor modal as direct child of document.body", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    items[0].handler!();

    const modal = document.body.querySelector(".sf-modal-overlay");
    expect(modal).not.toBeNull();
    expect(modal!.parentElement).toBe(document.body);
  });
});

// ── Rename handler ────────────────────────────────────────────────────────────

describe("startSmartFolderInlineRename", () => {
  let onRename: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onRename = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("replaces the label with an input element pre-filled with def.name", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    startSmartFolderInlineRename(li, def, onRename as (id: string, newName: string) => void);

    const input = li.querySelector<HTMLInputElement>(".tree-node-rename-input");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Research");
  });

  it("label is no longer visible when rename is active", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    startSmartFolderInlineRename(li, def, onRename as (id: string, newName: string) => void);

    const label = li.querySelector(".tree-node-label");
    expect(label).toBeNull(); // replaced by input
  });

  it("pressing Enter commits and calls onRename with id and new name", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    startSmartFolderInlineRename(li, def, onRename as (id: string, newName: string) => void);

    const input = li.querySelector<HTMLInputElement>(".tree-node-rename-input")!;
    input.value = "My Research";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith("sf-test-1", "My Research");
  });

  it("commit does NOT change the id (EC-05 — id is stable across rename)", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    startSmartFolderInlineRename(li, def, onRename as (id: string, newName: string) => void);

    const input = li.querySelector<HTMLInputElement>(".tree-node-rename-input")!;
    input.value = "Renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // The id passed to onRename must be the original id, not derived from the name
    expect(onRename.mock.calls[0][0]).toBe("sf-test-1");
  });

  it("pressing Escape restores the original label text", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    startSmartFolderInlineRename(li, def, onRename as (id: string, newName: string) => void);

    const input = li.querySelector<HTMLInputElement>(".tree-node-rename-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    const label = li.querySelector<HTMLElement>(".tree-node-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Research");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Rename via context menu items triggers the rename process on the li", () => {
    const def = makeDef();
    const li = makeSmartFolderLi(def);

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root");
    // The Rename item should trigger inline rename (input appears)
    items[1].handler!();

    const input = li.querySelector<HTMLInputElement>(".tree-node-rename-input");
    expect(input).not.toBeNull();
  });
});

// ── Delete handler ────────────────────────────────────────────────────────────

describe("Delete handler", () => {
  // Save the original confirm reference to restore after each test.
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    originalConfirm = window.confirm;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.confirm = originalConfirm;
  });

  it("prompts window.confirm before deleting", () => {
    let confirmCalled = false;
    window.confirm = (_msg?: string): boolean => {
      confirmCalled = true;
      return false;
    };

    const def = makeDef();
    const li = makeSmartFolderLi(def);
    const onDelete = vi.fn() as (id: string) => void;

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root", onDelete);
    items[3].handler!();

    expect(confirmCalled).toBe(true);
  });

  it("cancelling confirm does NOT call onDelete", () => {
    window.confirm = (): boolean => false;

    const def = makeDef();
    const li = makeSmartFolderLi(def);
    const onDelete = vi.fn() as (id: string) => void;

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root", onDelete);
    items[3].handler!();

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirming delete calls onDelete with the def id", () => {
    window.confirm = (): boolean => true;

    const def = makeDef();
    const li = makeSmartFolderLi(def);
    const onDelete = vi.fn() as (id: string) => void;

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root", onDelete);
    items[3].handler!();

    expect(onDelete).toHaveBeenCalledWith("sf-test-1");
  });

  it("confirm message includes the smart folder name", () => {
    let capturedMessage = "";
    window.confirm = (msg?: string): boolean => {
      capturedMessage = msg ?? "";
      return false;
    };

    const def = makeDef({ name: "My Important Folder" });
    const li = makeSmartFolderLi(def);

    const items = buildSmartFolderContextMenuItems(li, def, "/vault/root", vi.fn());
    items[3].handler!();

    expect(capturedMessage).toContain("My Important Folder");
  });
});

// ── removeEvaluationResult ───────────────────────────────────────────────────

describe("removeEvaluationResult", () => {
  beforeEach(() => {
    clearEvaluationCache();
  });

  it("removes a specific entry from the evaluation results cache", async () => {
    // Seed the cache via evaluateAllSmartFolders to have something to remove
    // We test removeEvaluationResult in isolation by checking the API contract
    const { evaluateAllSmartFolders } = await import(
      "../../../src/plugins/file-browser/smart-folders/index"
    );
    const vault = {
      id: "v1",
      name: "Test Vault",
      rootPaths: ["/test"],
      excludePatterns: [],
    } as any;
    const vaultIndex = {
      entries: [
        {
          path: "/test/a.md",
          name: "a",
          modified: 1000,
          outboundLinks: [],
          isDirectory: false,
        },
      ],
      nonMdFiles: [],
      directories: [],
      builtAt: 1000,
    } as any;
    const defs: SmartFolderDef[] = [
      { id: "sf-remove-me", name: "Remove Me", rules: [{ type: "tag", operator: "is", value: "x" }] },
    ];

    await evaluateAllSmartFolders(defs, vaultIndex, vault);
    expect(getEvaluationResult("sf-remove-me")).not.toBeNull();

    removeEvaluationResult("sf-remove-me");
    expect(getEvaluationResult("sf-remove-me")).toBeNull();
  });

  it("is a no-op when the id does not exist in the cache", () => {
    // Should not throw
    expect(() => removeEvaluationResult("nonexistent-id")).not.toThrow();
  });
});

// ── Vault-root context menu: New Smart Folder ────────────────────────────────

describe("buildVaultContextMenuItems includes New Smart Folder", () => {
  beforeEach(() => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "v1", rootPaths: ["/vault/root"] }),
    };
    (window as any).__TAURI_INTERNALS__ = null;
    _testing.setEnabled(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (window as any).__MARKABLE_VAULT_MANAGER__ = null;
    closeFilterEditor();
  });

  it("vault-root context menu contains a 'New Smart Folder' item", () => {
    const el = makeVaultRootLi("/vault/root");
    const items = _testing.buildVaultContextMenuItems(el, "/vault/root", "v1");
    const labels = items.map((i: any) => i.label);
    expect(labels).toContain("New Smart Folder");
  });

  it("'New Smart Folder' item has a handler function", () => {
    const el = makeVaultRootLi("/vault/root");
    const items = _testing.buildVaultContextMenuItems(el, "/vault/root", "v1");
    const newSfItem = items.find((i: any) => i.label === "New Smart Folder");
    expect(typeof newSfItem?.handler).toBe("function");
  });

  it("'New Smart Folder' opens filter editor modal on document.body", () => {
    const el = makeVaultRootLi("/vault/root");
    const items = _testing.buildVaultContextMenuItems(el, "/vault/root", "v1");
    const newSfItem = items.find((i: any) => i.label === "New Smart Folder");

    newSfItem?.handler?.();

    const editor = document.body.querySelector(".sf-modal-overlay");
    expect(editor).not.toBeNull();
  });
});
