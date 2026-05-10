/**
 * tests/folder-view/context-menu.test.ts
 *
 * Integration tests for context menu injection introduced in step_06.
 *
 * Covers:
 *   FR-34: "Open Folder View" injected as the first item when hasFolderView=true.
 *   FR-35: "Create Folder View…" injected between "New Note" and "New Folder"
 *          when hasFolderView=false; absent when hasFolderView=true.
 *   FR-35/FR-36: createFolderViewFile writes starter template and opens editor.
 *   EC-16: createFolderViewFile opens existing file instead of overwriting it.
 *   EC-24: Smart Folder nodes never reach buildDirContextMenuItems.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { _testing } from "../../src/plugins/file-browser/file-browser.plugin";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a minimal directory <li> element.
 *
 * @param path     - The data-path attribute value.
 * @param isSmart  - Whether to add data-smart-folder-id (simulates a Smart Folder node).
 */
function makeDirNode(path = "/vault/A", isSmart = false): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "tree-node tree-node-directory";
  li.setAttribute("data-type", "directory");
  li.setAttribute("data-path", path);
  if (isSmart) {
    li.setAttribute("data-smart-folder-id", "sf-test-001");
  }
  return li;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("buildDirContextMenuItems — folder-view injection", () => {

  // ── FR-34: Open Folder View item ──────────────────────────────────────────

  it("FR-34: hasFolderView=true → first item has label 'Open Folder View'", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true);
    expect(items[0].label).toBe("Open Folder View");
  });

  it("FR-34: 'Open Folder View' appears before the Pin/Unpin item", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true);
    const openFVIdx = items.findIndex(i => i.label === "Open Folder View");
    const pinIdx = items.findIndex(i => i.label === "Pin" || i.label === "Unpin");
    // "Open Folder View" must come before Pin/Unpin.
    expect(openFVIdx).toBeGreaterThanOrEqual(0);
    expect(pinIdx).toBeGreaterThanOrEqual(0);
    expect(openFVIdx).toBeLessThan(pinIdx);
  });

  // ── FR-35: Create Folder View… item ──────────────────────────────────────

  it("FR-35: hasFolderView=false → no 'Open Folder View' item", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false);
    expect(items.some(i => i.label === "Open Folder View")).toBe(false);
  });

  it("FR-35: hasFolderView=false → 'Create Folder View…' item is present", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false);
    expect(items.some(i => i.label === "Create Folder View…")).toBe(true);
  });

  it("FR-35 position: 'Create Folder View…' appears between 'New Note' and 'New Folder'", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false);
    const labels = items.map(i => i.label);
    const noteIdx = labels.indexOf("New Note");
    const createFVIdx = labels.indexOf("Create Folder View…");
    const folderIdx = labels.indexOf("New Folder");
    // All three must exist.
    expect(noteIdx).toBeGreaterThanOrEqual(0);
    expect(createFVIdx).toBeGreaterThanOrEqual(0);
    expect(folderIdx).toBeGreaterThanOrEqual(0);
    // "Create Folder View…" must sit between "New Note" and "New Folder".
    expect(createFVIdx).toBeGreaterThan(noteIdx);
    expect(createFVIdx).toBeLessThan(folderIdx);
  });

  it("FR-35 no duplicate: hasFolderView=true → no 'Create Folder View…' item", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true);
    expect(items.some(i => i.label === "Create Folder View…")).toBe(false);
  });

});

// ── EC-24: Smart Folder exclusion ─────────────────────────────────────────────

describe("EC-24: Smart Folder nodes", () => {

  beforeEach(() => {
    // Seed a real SmartFolderDef so handleContextMenu's sfId lookup succeeds
    // and routes to the smart-folder branch rather than returning early.
    _testing.seedSmartFolders([{
      id: "sf-test-001",
      name: "Test SF",
      rules: [{ type: "tag" as const, operator: "is" as const, value: "research" }],
    }]);

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn().mockReturnValue({ rootPaths: ["/vault"] }),
    };

    // Clean any leftover DOM menu from prior tests.
    _testing.closeContextMenu();
  });

  afterEach(() => {
    _testing.closeContextMenu();
    _testing.seedSmartFolders([]);
  });

  it("EC-24: handleContextMenu on a smart-folder node routes to smart-folder items, not folder-view items", () => {
    // handleContextMenu checks sfId !== null BEFORE the type=directory branch
    // (AD-7 in 00_index.md), so buildDirContextMenuItems is never reached.
    // Verify by calling handleContextMenu directly and inspecting the rendered
    // DOM — showContextMenu appends a .context-menu <ul> to document.body.
    const sfNode = makeDirNode("__smart__/sf-test-001", true);
    const e = new MouseEvent("contextmenu", {
      bubbles: false, cancelable: true, clientX: 10, clientY: 10,
    });

    _testing.handleContextMenu(e, sfNode, "vault-1");

    const menu = document.body.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    const menuText = menu!.textContent ?? "";

    // Smart-folder routing produces smart-folder-specific items.
    expect(menuText).toContain("Edit Filters");

    // Folder-view items must be absent — buildDirContextMenuItems was never called.
    expect(menuText).not.toContain("Open Folder View");
    expect(menuText).not.toContain("Create Folder View");
  });

});

// ── createFolderViewFile ───────────────────────────────────────────────────────

describe("createFolderViewFile", () => {

  let openFileInTabSpy: Mock;
  let writeFileSpy: Mock;

  beforeEach(() => {
    // The new openFolderViewTab calls tabMgr.openFileInTab + enterLayoutView
    // (layout-view refactor). Spy on openFileInTab to verify the folder-view
    // tab is opened for the directory after createFolderViewFile completes.
    openFileInTabSpy = vi.fn(() => Promise.resolve());
    writeFileSpy = vi.fn().mockResolvedValue(undefined);

    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: openFileInTabSpy,
      enterLayoutView: vi.fn(),
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn((cmd: string, args: Record<string, unknown>) => {
        if (cmd === "write_file") return writeFileSpy(cmd, args);
        return Promise.resolve(undefined);
      }),
    };
    // Default: vault index has no existing _folder.md.
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: vi.fn().mockReturnValue({ entries: [], directories: [], nonMdFiles: [] }),
      reloadVaultIndex: vi.fn(),
    };
  });

  it("EC-16: when _folder.md already exists in the vault index, write_file is NOT called", async () => {
    // Seed the index with an existing _folder.md entry.
    (window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex.mockReturnValue({
      entries: [{ path: "/vault/A/_folder.md", name: "_folder" }],
      directories: [],
      nonMdFiles: [],
    });

    const container = document.createElement("div");
    await _testing.createFolderViewFile("/vault/A", container, "vault-1");

    // write_file must NOT have been called.
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it("EC-16: when _folder.md already exists, folder-view tab IS opened for the directory", async () => {
    // The refactored openFolderViewTab calls openFileInTab with the _folder.md
    // path (not __MARKABLE_OPEN_CUSTOM_TAB__ with a synthetic key).
    (window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex.mockReturnValue({
      entries: [{ path: "/vault/A/_folder.md", name: "_folder" }],
      directories: [],
      nonMdFiles: [],
    });

    const container = document.createElement("div");
    await _testing.createFolderViewFile("/vault/A", container, "vault-1");

    expect(openFileInTabSpy).toHaveBeenCalledWith("/vault/A/_folder.md");
  });

  it("FR-36: when _folder.md does NOT exist, write_file is called with the starter template", async () => {
    const container = document.createElement("div");
    await _testing.createFolderViewFile("/vault/A", container, "vault-1");

    const STARTER = "---\nlayout: folder-cards\n---\n";
    expect(writeFileSpy).toHaveBeenCalledWith(
      "write_file",
      { path: "/vault/A/_folder.md", content: STARTER },
    );
  });

  it("FR-35: after successful create, folder-view tab is opened for the directory", async () => {
    // The refactored openFolderViewTab calls openFileInTab with the _folder.md
    // path (not __MARKABLE_OPEN_CUSTOM_TAB__ with a synthetic key).
    const container = document.createElement("div");
    await _testing.createFolderViewFile("/vault/A", container, "vault-1");

    expect(openFileInTabSpy).toHaveBeenCalledWith("/vault/A/_folder.md");
  });

  it("error handling: write_file throws → folder-view tab is NOT opened", async () => {
    // Make write_file reject.
    writeFileSpy.mockRejectedValueOnce(new Error("disk full"));
    (window as any).__TAURI_INTERNALS__.invoke = vi.fn((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "write_file") return writeFileSpy(cmd, args);
      return Promise.resolve(undefined);
    });

    const container = document.createElement("div");
    await _testing.createFolderViewFile("/vault/A", container, "vault-1");

    expect(openFileInTabSpy).not.toHaveBeenCalled();
  });

});
