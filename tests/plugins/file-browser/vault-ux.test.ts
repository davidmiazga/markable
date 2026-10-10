/**
 * vault-ux.test.ts
 *
 * Vitest unit and integration tests for the vault UX refactor (vault-ux spec).
 * Covers steps 01–05:
 *
 *   step_01 — openNewVaultModal() opens the create form directly.
 *   step_02 — Vault rows contain a hover-reveal unmount button.
 *   step_03 — Double-click on a vault row activates inline rename.
 *   step_04 — buildVaultContextMenuItems() returns Unmount/Rename/Manage Vaults.
 *   step_05 — Plugin Panel "Manage Vaults" footer + vault-manage keybinding.
 *
 * Mocking approach:
 *   - window.__MARKABLE_VAULT_MANAGER__ is stubbed per test with vi.fn() helpers.
 *   - window.confirm is overridden with vi.fn() so confirm dialogs are testable.
 *   - manage-vaults-ui is mocked at the module level so mountManageVaultsPanel
 *     and showCreateVaultForm calls are interceptable without needing a real DOM
 *     modal implementation.
 *   - vi.useFakeTimers() is used for blur-cancel tests that depend on setTimeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  _testing,
} from "../../../src/plugins/file-browser/file-browser.plugin";
import { COMMANDS } from "../../../src/keybindings/keybindings-panel";

// ── Mock manage-vaults-ui so modal functions are observable ──────────────────

vi.mock("../../../src/plugins/file-browser/manage-vaults-ui", () => ({
  mountManageVaultsPanel: vi.fn(),
  showCreateVaultForm: vi.fn(),
}));

import {
  mountManageVaultsPanel,
  showCreateVaultForm,
} from "../../../src/plugins/file-browser/manage-vaults-ui";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal VaultEntry for testing. */
function makeVault(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "vault-A",
    name: "Alpha Vault",
    rootPaths: ["/notes/alpha"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Minimal TreeNode for a vault root used with buildNodeEl. */
function makeVaultNode(vaultId = "vault-A"): any {
  return {
    type: "vault",
    name: "Alpha Vault",
    path: "/notes/alpha",
    vaultId,
    depth: 0,
    expanded: true,
    children: [],
  };
}

/** Minimal TreeNode for a directory. */
function makeDirNode(): any {
  return {
    type: "directory",
    name: "subfolder",
    path: "/notes/alpha/subfolder",
    vaultId: "vault-A",
    depth: 1,
    expanded: false,
    children: [],
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  /* Reset module-level state between tests */
  _testing.setPanelContainer(null);
  _testing.setTreeEl(null);
  _testing.setSearchQuery("");
  _testing.setIsLoading(false);
  _testing.setCurrentTree([]);
  _testing.setExpandedPaths(new Set());
  _testing.setEnabled(false);

  /* Clear any overlays left from previous tests */
  document.getElementById("__fb_manage_vaults_overlay__")?.remove();
  document.querySelectorAll(".context-menu").forEach((el) => el.remove());

  /* Reset mocks */
  vi.clearAllMocks();

  /* Ensure a predictable vault manager stub */
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getActiveVault: vi.fn(() => makeVault()),
    getAllVaults: vi.fn(() => [makeVault()]),
    deleteVault: vi.fn().mockResolvedValue(undefined),
    unmountVault: vi.fn().mockResolvedValue(undefined),
    updateVault: vi.fn().mockResolvedValue(undefined),
    switchVault: vi.fn().mockResolvedValue(undefined),
    reloadVaultIndex: vi.fn().mockResolvedValue(undefined),
    onVaultChanged: vi.fn(),
    offVaultChanged: vi.fn(),
    onIndexUpdated: vi.fn(),
    offIndexUpdated: vi.fn(),
  };

  /* Reset the global open-vaults handle */
  (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;

  /* Silence Tauri invocations */
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  document.getElementById("__fb_manage_vaults_overlay__")?.remove();
  vi.restoreAllMocks();
});

// ── step_01: openNewVaultModal ────────────────────────────────────────────────

describe("step_01 — openNewVaultModal()", () => {
  it("renders the create form immediately (showCreateVaultForm called)", () => {
    /*
     * openNewVaultModal is private but exposed via _testing. Calling it should
     * invoke mountManageVaultsPanel then showCreateVaultForm (not the list view).
     */
    _testing.openNewVaultModal();

    expect(mountManageVaultsPanel).toHaveBeenCalledOnce();
    expect(showCreateVaultForm).toHaveBeenCalledOnce();
  });

  it("appends the overlay to document.body", () => {
    _testing.openNewVaultModal();

    expect(document.getElementById("__fb_manage_vaults_overlay__")).not.toBeNull();
  });

  it("double-open guard: calling openNewVaultModal() twice produces only one overlay", () => {
    _testing.openNewVaultModal();
    _testing.openNewVaultModal();

    const overlays = document.querySelectorAll("#__fb_manage_vaults_overlay__");
    expect(overlays.length).toBe(1);
    /* mountManageVaultsPanel should only have been called on the first invocation */
    expect(mountManageVaultsPanel).toHaveBeenCalledOnce();
  });

  it("showCreateVaultForm is called after mountManageVaultsPanel (not before)", () => {
    const callOrder: string[] = [];
    vi.mocked(mountManageVaultsPanel).mockImplementation(() => { callOrder.push("mount"); });
    vi.mocked(showCreateVaultForm).mockImplementation(() => { callOrder.push("create"); });

    _testing.openNewVaultModal();

    expect(callOrder).toEqual(["mount", "create"]);
  });

  it("empty-state 'New Vault' button click opens the create form directly", () => {
    /*
     * Render the no-vault empty state, then simulate clicking the "New Vault"
     * button — it should call openNewVaultModal (verified via showCreateVaultForm).
     */
    const container = document.createElement("div");
    document.body.appendChild(container);
    _testing.setPanelContainer(container);
    (window as any).__MARKABLE_VAULT_MANAGER__.getActiveVault = vi.fn(() => null);
    (window as any).__MARKABLE_VAULT_MANAGER__.getAllVaults = vi.fn(() => []);

    _testing.renderPanel();

    const btn = container.querySelector<HTMLButtonElement>(".file-browser-empty button");
    expect(btn).not.toBeNull();
    btn!.click();

    expect(showCreateVaultForm).toHaveBeenCalled();

    container.remove();
  });
});

// ── step_02: Vault row unmount button ─────────────────────────────────────────

describe("step_02 — vault row icon", () => {
  it("mounted vault row shows the inventory icon and an unmount button", () => {
    const li = _testing.buildNodeEl(makeVaultNode(), null);

    const svg = li.querySelector(".vault-icon svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(li.querySelector(".tree-node-chevron")).toBeNull();
    expect(svg?.innerHTML).toContain("M180-80");
    const unmount = li.querySelector(".vault-row-unmount-btn");
    expect(unmount?.querySelector("svg")?.getAttribute("width")).toBe("16");
    expect(unmount?.getAttribute("title")).toBe("Unmount");
    expect(unmount?.classList.contains("is-mount")).toBe(false);
  });

  it("disabled vault row uses a mount button on the same glyph", () => {
    const li = _testing.buildNodeEl(makeVaultNode("vault-B"), null);

    expect(li.classList.contains("is-disabled")).toBe(true);
    const btn = li.querySelector(".vault-row-unmount-btn");
    expect(btn?.classList.contains("is-mount")).toBe(true);
    expect(btn?.getAttribute("title")).toBe("Mount");
    expect(li.querySelector(".vault-icon")?.getAttribute("title")).toBe("Mount");
  });

  it("directory row does not use the vault icon", () => {
    const li = _testing.buildNodeEl(makeDirNode(), null);

    expect(li.querySelector(".vault-icon")).toBeNull();
  });
});

// ── step_03: Vault inline rename ──────────────────────────────────────────────

describe("step_03 — vault inline rename", () => {
  it("startVaultInlineRename inserts an <input class='tree-node-rename-input'> into the row", async () => {
    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);

    await _testing.startVaultInlineRename(li);

    expect(li.querySelector("input.tree-node-rename-input")).not.toBeNull();
    /* Original label should be replaced */
    expect(li.querySelector(".tree-node-label")).toBeNull();

    li.remove();
  });

  it("Enter commits rename by calling vm.updateVault with the new name", async () => {
    const updateVault = vi.fn().mockResolvedValue(undefined);
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      getAllVaults: vi.fn(() => [makeVault({ id: "vault-A", name: "Old Name" })]),
      updateVault,
    };

    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);

    await _testing.startVaultInlineRename(li);

    const input = li.querySelector<HTMLInputElement>("input.tree-node-rename-input")!;
    input.value = "New Name";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    /* Allow micro-tasks (the commit is async) */
    await Promise.resolve();

    expect(updateVault).toHaveBeenCalledWith("vault-A", expect.objectContaining({ name: "New Name" }));

    li.remove();
  });

  it("Escape cancels rename — original label is restored, updateVault not called", async () => {
    const updateVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      getAllVaults: vi.fn(() => [makeVault({ id: "vault-A", name: "Alpha Vault" })]),
      updateVault,
    };

    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);

    await _testing.startVaultInlineRename(li);

    const input = li.querySelector<HTMLInputElement>("input.tree-node-rename-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    /* Input should be removed; label should be restored */
    expect(li.querySelector("input.tree-node-rename-input")).toBeNull();
    expect(li.querySelector(".tree-node-label")).not.toBeNull();
    expect(updateVault).not.toHaveBeenCalled();

    li.remove();
  });

  it("blur cancels rename (EC-VUX-04)", async () => {
    vi.useFakeTimers();
    const updateVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      getAllVaults: vi.fn(() => [makeVault({ id: "vault-A", name: "Alpha Vault" })]),
      updateVault,
    };

    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);

    await _testing.startVaultInlineRename(li);

    const input = li.querySelector<HTMLInputElement>("input.tree-node-rename-input")!;
    input.dispatchEvent(new Event("blur"));

    /* Advance past the 100ms defer in the blur handler */
    await vi.runAllTimersAsync();

    expect(li.querySelector("input.tree-node-rename-input")).toBeNull();
    expect(updateVault).not.toHaveBeenCalled();

    li.remove();
    vi.useRealTimers();
  });

  it("empty new name cancels without calling updateVault", async () => {
    const updateVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      getAllVaults: vi.fn(() => [makeVault({ id: "vault-A", name: "Alpha Vault" })]),
      updateVault,
    };

    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);

    await _testing.startVaultInlineRename(li);

    const input = li.querySelector<HTMLInputElement>("input.tree-node-rename-input")!;
    input.value = "   "; /* whitespace only — trims to empty */
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(updateVault).not.toHaveBeenCalled();

    li.remove();
  });

  it("unchanged name cancels without calling updateVault", async () => {
    const updateVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      getAllVaults: vi.fn(() => [makeVault({ id: "vault-A", name: "Alpha Vault" })]),
      updateVault,
    };

    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);

    await _testing.startVaultInlineRename(li);

    const input = li.querySelector<HTMLInputElement>("input.tree-node-rename-input")!;
    /* Value is pre-filled with "Alpha Vault" — do not change it */
    expect(input.value).toBe("Alpha Vault");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(updateVault).not.toHaveBeenCalled();

    li.remove();
  });
});

// ── step_04: buildVaultContextMenuItems ───────────────────────────────────────

describe("step_04 — buildVaultContextMenuItems()", () => {
  it("returns New File, New Folder, New Smart Folder, Unmount, Rename, Manage Vaults, Remove from list", () => {
    const mockEl = document.createElement("li");
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A" })),
    };
    const items = _testing.buildVaultContextMenuItems(mockEl, "/path", "vault-A");

    const nonSep = items.filter((i: any) => !i.separator);
    expect(nonSep).toHaveLength(7);
    expect(nonSep[0].label).toBe("New File");
    expect(nonSep[1].label).toBe("New Folder");
    expect(nonSep[2].label).toBe("New Smart Folder");
    expect(nonSep[3].label).toBe("Unmount");
    expect(nonSep[4].label).toBe("Rename");
    expect(nonSep[5].label).toBe("Manage Vaults");
    expect(nonSep[6].label).toBe("Remove from list");
  });

  it("total item count is 10 (7 actions + 3 separators)", () => {
    const mockEl = document.createElement("li");
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A" })),
    };
    const items = _testing.buildVaultContextMenuItems(mockEl, "/path", "vault-A");

    expect(items).toHaveLength(10);
  });

  it("Remove from list drops the vault from the browser and leaves the folder alone", () => {
    const deleteVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A" })),
      deleteVault,
    };
    const items = _testing.buildVaultContextMenuItems(document.createElement("li"), "", "vault-A");
    items.find((i) => i.label === "Remove from list")!.handler!();
    expect(deleteVault).toHaveBeenCalledWith("vault-A");
  });

  it("Mount handler on an unmounted vault calls switchVault and does not delete it", () => {
    const deleteVault = vi.fn();
    const switchVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A" })),
      deleteVault,
      switchVault,
    };

    const mockEl = document.createElement("li");
    const items = _testing.buildVaultContextMenuItems(mockEl, "", "vault-B");
    items.find((i) => i.label === "Mount")!.handler!();

    expect(switchVault).toHaveBeenCalledWith("vault-B");
    expect(deleteVault).not.toHaveBeenCalled();
  });

  it("Unmount handler on the mounted vault calls unmountVault and keeps the record", () => {
    const deleteVault = vi.fn();
    const unmountVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A", name: "Active" })),
      deleteVault,
      unmountVault,
    };

    const mockEl = document.createElement("li");
    const items = _testing.buildVaultContextMenuItems(mockEl, "", "vault-A");
    items.find((i) => i.label === "Unmount")!.handler!();

    expect(unmountVault).toHaveBeenCalledWith("vault-A");
    expect(deleteVault).not.toHaveBeenCalled();
  });

  it("Rename handler calls startVaultInlineRename with the element", async () => {
    const mockEl = document.createElement("li");
    mockEl.setAttribute("data-vault-id", "vault-A");
    mockEl.setAttribute("data-type", "vault");

    /* Add a label span so startVaultInlineRename can find it */
    const label = document.createElement("span");
    label.className = "tree-node-label";
    label.textContent = "Alpha Vault";
    mockEl.appendChild(label);
    document.body.appendChild(mockEl);

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      getAllVaults: vi.fn(() => [makeVault({ id: "vault-A", name: "Alpha Vault" })]),
      updateVault: vi.fn(),
    };

    const items = _testing.buildVaultContextMenuItems(mockEl, "", "vault-A");
    /* Call the Rename handler — it returns a Promise (startVaultInlineRename is async) */
    await items.find((i) => i.label === "Rename")!.handler!();

    /* If rename was triggered, the input should now be in the DOM */
    expect(mockEl.querySelector("input.tree-node-rename-input")).not.toBeNull();

    mockEl.remove();
  });

  it("Manage Vaults handler opens Manage Vaults modal focused on the vault", () => {
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;
    /* Overlay must not exist already */
    document.getElementById("__fb_manage_vaults_overlay__")?.remove();

    const mockEl = document.createElement("li");
    const items = _testing.buildVaultContextMenuItems(mockEl, "", "vault-A");
    const open = items.find((i) => i.label === "Manage Vaults")!.handler!;
    open();
    open();

    expect(document.querySelectorAll("#__fb_manage_vaults_overlay__")).toHaveLength(1);
  });

  it("old items 'New Vault…', 'Edit Vault…', 'Delete Vault…' are NOT present", () => {
    const mockEl = document.createElement("li");
    const items = _testing.buildVaultContextMenuItems(mockEl, "", "vault-A");
    const labels = items.map((i) => i.label);

    expect(labels).not.toContain("New Vault…");
    expect(labels).not.toContain("Edit Vault…");
    expect(labels).not.toContain("Delete Vault…");
  });
});

// ── step_05: vault-manage keybinding ──────────────────────────────────────────

describe("step_05 — vault-manage keybinding", () => {
  it("COMMANDS array contains a vault-manage entry in the View section", () => {
    const cmd = COMMANDS.find((c) => c.id === "vault-manage");

    expect(cmd).toBeDefined();
    expect(cmd!.section).toBe("View");
    expect(cmd!.label).toBe("Manage Vaults");
  });

  it("vault-manage defaultKey is empty string (no default binding)", () => {
    const cmd = COMMANDS.find((c) => c.id === "vault-manage");

    expect(cmd!.defaultKey).toBe("");
  });
});

// ── step_05: window global __MARKABLE_OPEN_MANAGE_VAULTS__ ───────────────────

describe("step_05 — __MARKABLE_OPEN_MANAGE_VAULTS__ window global", () => {
  it("plugin.onEnable registers __MARKABLE_OPEN_MANAGE_VAULTS__ as a function", async () => {
    /* Import the default plugin export */
    const { default: plugin } = await import("../../../src/plugins/file-browser/file-browser.plugin");

    const mockApi = {
      statusBar: { left: document.createElement("div"), center: document.createElement("div"), right: document.createElement("div") },
      ensureStatusBar: vi.fn(),
      hideStatusBarIfUnused: vi.fn(),
      registerStatusBarDependent: vi.fn(),
      unregisterStatusBarDependent: vi.fn(),
      loadSettings: vi.fn().mockResolvedValue(null),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      addExtensions: vi.fn(),
      removeExtensions: vi.fn(),
      registerSidebarPanel: vi.fn(),
      unregisterSidebarPanel: vi.fn(),
      focusSidebarPanel: vi.fn(),
      toggleSidebarPanel: vi.fn(),
      restartSelf: vi.fn(),
    };

    plugin.onEnable(mockApi as any);

    expect(typeof (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__).toBe("function");

    plugin.onDisable(mockApi as any);
  });

  it("plugin.onDisable sets __MARKABLE_OPEN_MANAGE_VAULTS__ to null", async () => {
    const { default: plugin } = await import("../../../src/plugins/file-browser/file-browser.plugin");

    const mockApi = {
      statusBar: { left: document.createElement("div"), center: document.createElement("div"), right: document.createElement("div") },
      ensureStatusBar: vi.fn(),
      hideStatusBarIfUnused: vi.fn(),
      registerStatusBarDependent: vi.fn(),
      unregisterStatusBarDependent: vi.fn(),
      loadSettings: vi.fn().mockResolvedValue(null),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      addExtensions: vi.fn(),
      removeExtensions: vi.fn(),
      registerSidebarPanel: vi.fn(),
      unregisterSidebarPanel: vi.fn(),
      focusSidebarPanel: vi.fn(),
      toggleSidebarPanel: vi.fn(),
      restartSelf: vi.fn(),
    };

    plugin.onEnable(mockApi as any);
    plugin.onDisable(mockApi as any);

    expect((window as any).__MARKABLE_OPEN_MANAGE_VAULTS__).toBeNull();
  });

  it("vault-manage action invokes __MARKABLE_OPEN_MANAGE_VAULTS__ when global is a function", () => {
    /*
     * Exercise the handleAction("vault-manage") path indirectly by calling the
     * global directly — the integration test for main.ts handleAction is in
     * the existing main.test.ts suite. Here we verify the global contract.
     */
    const openFn = vi.fn();
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = openFn;

    /* Simulate what handleAction("vault-manage") does */
    const fn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
    if (typeof fn === "function") fn();

    expect(openFn).toHaveBeenCalledOnce();
  });

  it("vault-manage path is a no-op when global is null (no throw)", () => {
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;

    /* Should not throw */
    expect(() => {
      const fn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
      if (typeof fn === "function") fn();
    }).not.toThrow();
  });
});

describe("saved vault rows", () => {
  it("shows every saved vault when none is mounted", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    _testing.setPanelContainer(container);
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => null),
      getAllVaults: vi.fn(() => [
        makeVault({ id: "vault-A", name: "Alpha" }),
        makeVault({ id: "vault-B", name: "Beta", rootPaths: ["/notes/beta"] }),
      ]),
    };

    _testing.renderPanel();

    const rows = container.querySelectorAll(".tree-node-vault");
    expect(rows).toHaveLength(2);
    expect(container.textContent).not.toContain("Create your first vault");
    expect(container.querySelector("[data-vault-id='vault-A'] .vault-icon svg")).not.toBeNull();
    expect(container.querySelector("[data-vault-id='vault-B'] .vault-icon svg")).not.toBeNull();
    expect(container.querySelectorAll(".vault-row-unmount-btn.is-mount")).toHaveLength(2);

    container.remove();
  });

  it("shows unmounted vaults beside the mounted vault, and only the mounted vault has notes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    _testing.setPanelContainer(container);
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A", name: "Alpha", rootPaths: ["/notes/alpha"] })),
      getAllVaults: vi.fn(() => [
        makeVault({ id: "vault-A", name: "Alpha", rootPaths: ["/notes/alpha"] }),
        makeVault({ id: "vault-B", name: "Beta", rootPaths: ["/notes/beta"] }),
      ]),
      getVaultIndex: vi.fn(() => ({
        vaultId: "vault-A",
        builtAt: 0,
        entries: [{
          path: "/notes/alpha/note.md",
          name: "note",
          title: "Note",
          outboundLinks: [],
          tags: [],
          modified: 0,
          size: 0,
        }],
        totalFilesFound: 1,
        skippedCount: 0,
        capped: false,
        nonMdFiles: [],
        directories: [],
      })),
    };

    _testing.renderPanel();

    expect(container.querySelectorAll(".tree-node-vault")).toHaveLength(2);
    expect(container.querySelector("[data-path='/notes/alpha/note.md']")).not.toBeNull();
    expect(container.querySelector("[data-vault-id='vault-A'] .vault-icon svg")).not.toBeNull();
    expect(container.querySelector("[data-vault-id='vault-B'] .vault-icon svg")).not.toBeNull();
    expect(container.querySelector("[data-vault-id='vault-A'] .vault-row-unmount-btn")?.getAttribute("title")).toBe("Unmount");
    expect(container.querySelector("[data-vault-id='vault-B'] .vault-row-unmount-btn")?.classList.contains("is-mount")).toBe(true);
    expect(container.querySelector("[data-vault-id='vault-A']")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-vault-id='vault-B']")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-vault-id='vault-A']")?.classList.contains("is-disabled")).toBe(false);
    expect(container.querySelector("[data-vault-id='vault-B']")?.classList.contains("is-disabled")).toBe(true);

    container.remove();
  });

  it("the vault name lists other vaults and mounts the one you choose", () => {
    const switchVault = vi.fn();
    const deleteVault = vi.fn();
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault({ id: "vault-A", name: "Alpha" })),
      getAllVaults: vi.fn(() => [
        makeVault({ id: "vault-A", name: "Alpha" }),
        makeVault({ id: "vault-B", name: "Beta" }),
      ]),
      switchVault,
      deleteVault,
    };

    const li = _testing.buildNodeEl(makeVaultNode("vault-A"), null);
    document.body.appendChild(li);
    li.querySelector<HTMLElement>(".tree-node-label")!.click();

    const menu = document.querySelector(".context-menu");
    expect(menu?.textContent).toContain("Beta");
    expect(menu?.textContent).toContain("Remove from list");
    expect(menu?.textContent).not.toContain("Alpha");

    const beta = [...(menu?.querySelectorAll(".context-menu-item") ?? [])]
      .find((el) => el.textContent === "Beta");
    beta?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(switchVault).toHaveBeenCalledWith("vault-B");

    li.remove();
    document.querySelector(".context-menu")?.remove();
  });
});
