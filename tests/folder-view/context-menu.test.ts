/**
 * tests/folder-view/context-menu.test.ts
 *
 * Integration tests for the unified file/folder context menu (May 2026
 * cleanup). Folder menu structure:
 *   - hasFolderView=false: "Folder View" → New Folder → New Note → Rename → Delete → Pin → Reveal in Finder
 *   - hasFolderView=true:  "Remove Folder View" → "Insert/Edit CodeBlock" → "Apply/Change Page Layout"
 *                          → New Folder → New Note → Rename → Delete → Pin → Reveal in Finder
 *
 * Also covers:
 *   createFolderViewFile / resetFolderViewFile helper behavior (the
 *   functions themselves remain in the codebase; only the menu wiring
 *   changed).
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

describe("buildDirContextMenuItems — unified menu structure", () => {

  // ── Folder View / Remove Folder View first-item toggle ────────────────────

  it("hasFolderView=true → first item is 'Remove Folder View'", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true);
    expect(items[0].label).toBe("Remove Folder View");
  });

  it("hasFolderView=false → first item is 'Folder View'", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false);
    expect(items[0].label).toBe("Folder View");
  });

  // ── CodeBlock + Layout items only present when _folder.md exists ──────────
  //    Labels flip Insert↔Edit / Apply↔Change based on _folder.md content.

  it("hasFolderView=true, no existing codeblock/layout → 'Insert CodeBlock' + 'Apply Page Layout'", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true, false, false);
    const labels = items.map(i => i.label);
    expect(labels).toContain("Insert CodeBlock");
    expect(labels).toContain("Apply Page Layout");
    expect(labels).not.toContain("Edit CodeBlock");
    expect(labels).not.toContain("Edit Page Layout");
  });

  it("hasFolderView=true, existing codeblock/layout → 'Edit CodeBlock' + 'Change Page Layout'", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true, true, true);
    const labels = items.map(i => i.label);
    expect(labels).toContain("Edit CodeBlock");
    expect(labels).toContain("Edit Page Layout");
    expect(labels).not.toContain("Insert CodeBlock");
    expect(labels).not.toContain("Apply Page Layout");
  });

  it("hasFolderView=false → codeblock + layout items are ABSENT regardless of flags", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false, true, true);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain("Insert CodeBlock");
    expect(labels).not.toContain("Edit CodeBlock");
    expect(labels).not.toContain("Apply Page Layout");
    expect(labels).not.toContain("Edit Page Layout");
  });

  // ── Order: New Folder → New Note → Rename → Delete → Pin → Reveal ────────

  it("New Folder appears before New Note in the second group", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false);
    const labels = items.map(i => i.label);
    const newFolderIdx = labels.indexOf("New Folder");
    const newNoteIdx = labels.indexOf("New Note");
    expect(newFolderIdx).toBeGreaterThan(0);
    expect(newFolderIdx).toBeLessThan(newNoteIdx);
  });

  it("Pin appears in the same group as Rename/Delete (after Delete)", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", false);
    const labels = items.map(i => i.label);
    const renameIdx = labels.indexOf("Rename");
    const deleteIdx = labels.indexOf("Delete");
    const pinIdx = labels.findIndex(l => l === "Pin" || l === "Unpin");
    expect(renameIdx).toBeGreaterThan(0);
    expect(deleteIdx).toBe(renameIdx + 1);
    expect(pinIdx).toBe(deleteIdx + 1);
  });

  it("'Reveal in Finder' is the last item", () => {
    const el = makeDirNode("/vault/A");
    const items = _testing.buildDirContextMenuItems(el, "/vault/A", "vault-1", true);
    const nonSep = items.filter(i => !i.separator);
    expect(nonSep[nonSep.length - 1].label).toBe("Reveal in Finder");
  });

  // ── Old labels are completely gone ────────────────────────────────────────

  it("legacy 'Open Folder View' / 'New Folder View…' / 'Reset Folder View…' / 'Open in Finder' labels are absent", () => {
    const el = makeDirNode("/vault/A");
    for (const hasFV of [true, false]) {
      const labels = _testing
        .buildDirContextMenuItems(el, "/vault/A", "vault-1", hasFV)
        .map(i => i.label);
      expect(labels).not.toContain("Open Folder View");
      expect(labels).not.toContain("New Folder View…");
      expect(labels).not.toContain("Reset Folder View…");
      expect(labels).not.toContain("Open in Finder");
    }
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
    expect(menuText).not.toContain("Folder View");
    expect(menuText).not.toContain("Remove Folder View");
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

    expect(writeFileSpy).toHaveBeenCalledWith(
      "write_file",
      { path: "/vault/A/_folder.md", content: _testing.FOLDER_VIEW_STARTER },
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

// (Reset Folder View describe block removed — the menu no longer has a
// "Reset" item. To reset, users invoke "Remove Folder View" then "Folder View".
// resetFolderViewFile() the helper remains in the codebase; its tests below
// continue to cover that function directly.)

// ── resetFolderViewFile ───────────────────────────────────────────────────────

describe("resetFolderViewFile", () => {

  let openFileInTabSpy: Mock;
  let writeFileSpy: Mock;

  beforeEach(() => {
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
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: vi.fn().mockReturnValue({ entries: [], directories: [], nonMdFiles: [] }),
      reloadVaultIndex: vi.fn(),
    };
  });

  it("confirm=true: write_file is called with FOLDER_VIEW_STARTER content", async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockReturnValue(true);
    const container = document.createElement("div");
    await _testing.resetFolderViewFile("/vault/A", container, "vault-1");
    expect(writeFileSpy).toHaveBeenCalledWith(
      "write_file",
      { path: "/vault/A/_folder.md", content: _testing.FOLDER_VIEW_STARTER },
    );
  });

  it("confirm=false: write_file is NOT called", async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockReturnValue(false);
    const container = document.createElement("div");
    await _testing.resetFolderViewFile("/vault/A", container, "vault-1");
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it("success: folder-view tab is opened after write", async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockReturnValue(true);
    const container = document.createElement("div");
    await _testing.resetFolderViewFile("/vault/A", container, "vault-1");
    expect(openFileInTabSpy).toHaveBeenCalledWith("/vault/A/_folder.md");
  });

  it("write_file throws: folder-view tab is NOT opened", async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockReturnValue(true);
    writeFileSpy.mockRejectedValueOnce(new Error("disk full"));
    (window as any).__TAURI_INTERNALS__.invoke = vi.fn((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "write_file") return writeFileSpy(cmd, args);
      return Promise.resolve(undefined);
    });
    const container = document.createElement("div");
    await _testing.resetFolderViewFile("/vault/A", container, "vault-1");
    expect(openFileInTabSpy).not.toHaveBeenCalled();
  });

});
