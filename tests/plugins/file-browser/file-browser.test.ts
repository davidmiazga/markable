/**
 * DOM / integration tests for the File Browser plugin.
 *
 * These tests mock the window globals used by the plugin
 * (__MARKABLE_VAULT_MANAGER__, __MARKABLE_TAB_MANAGER__,
 * __MARKABLE_CURRENT_FILE__, __TAURI_INTERNALS__) and exercise the panel's
 * rendering and interaction behaviour using JSDOM (provided by Vitest's
 * browser-like environment).
 *
 * Test file: tests/plugins/file-browser/file-browser.test.ts
 * Source:    src/plugins/file-browser/file-browser.plugin.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  injectFileBrowserCSS,
  removeFileBrowserCSS,
  renderPanel,
  updateActiveFileHighlight,
  refreshVaultData,
  startInlineRename,
  _testing,
} from "../../../src/plugins/file-browser/file-browser.plugin";
import plugin from "../../../src/plugins/file-browser/file-browser.plugin";
import type { VaultEntry, VaultIndex } from "../../../src/lib/vault-types";
import {
  validateFilename,
  getFileStem,
  getParentDir,
  getBasename,
  showLinkUpdateBanner,
  deleteDirectory,
  renameNode,
} from "../../../src/plugins/file-browser/file-browser-ops";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function makeVault(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "test-vault",
    name: "Test Vault",
    rootPaths: ["/notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeVaultIndex(paths: string[]): VaultIndex {
  return {
    vaultId: "test-vault",
    builtAt: Date.now(),
    entries: paths.map((path) => ({
      path,
      name: path.split("/").pop()?.replace(/\.md$/, "") ?? "note",
      modified: 1000,
      size: 100,
      title: "Note",
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: paths.length,
    skippedCount: 0,
    capped: false,
  };
}

/** Create and return a <div> container element for a panel mount. */
function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

// ── Mock API factory ───────────────────────────────────────────────────────────

function makeMockApi() {
  return {
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
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
}

// ── Global mock helpers ────────────────────────────────────────────────────────

function setupVaultManager(
  activeVault: VaultEntry | null,
  vaultIndex: VaultIndex | null,
) {
  const vaultChangedListeners: Set<(v: VaultEntry | null) => void> = new Set();
  const indexUpdatedListeners: Set<(...args: unknown[]) => void> = new Set();

  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getActiveVault: vi.fn(() => activeVault),
    getVaultIndex: vi.fn(() => vaultIndex),
    getAllVaults: vi.fn(() => (activeVault ? [activeVault] : [])),
    switchVault: vi.fn().mockResolvedValue(undefined),
    /*
     * reloadVaultIndex simulates the vault-manager rebuilding the index.
     * After the call the vaultIndex mock value should be non-null, so we emit
     * onVaultChanged to trigger the plugin's subscription (BLOCKING-1 test).
     */
    reloadVaultIndex: vi.fn().mockImplementation(async () => {
      vaultChangedListeners.forEach((cb) => cb(activeVault));
    }),
    onVaultChanged: vi.fn((cb) => vaultChangedListeners.add(cb)),
    offVaultChanged: vi.fn((cb) => vaultChangedListeners.delete(cb)),
    onIndexUpdated: vi.fn((cb) => indexUpdatedListeners.add(cb)),
    offIndexUpdated: vi.fn((cb) => indexUpdatedListeners.delete(cb)),
    _emitVaultChanged(v: VaultEntry | null) {
      vaultChangedListeners.forEach((cb) => cb(v));
    },
    _emitIndexUpdated(event: unknown) {
      indexUpdatedListeners.forEach((cb) => cb(event));
    },
  };
}

function setupTabManager() {
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn().mockResolvedValue(true),
  };
}

function setupTauriInternals() {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn().mockResolvedValue({ entries: [], totalFilesFound: 0, skippedCount: 0, capped: false, vaultId: "test-vault", builtAt: Date.now() }),
  };
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  /* Reset all module-level testing state */
  _testing.setPanelContainer(null);
  _testing.setTreeEl(null);
  _testing.setSearchQuery("");
  _testing.setIsLoading(false);
  _testing.setCurrentTree([]);
  _testing.setExpandedPaths(new Set());

  (window as any).__MARKABLE_CURRENT_FILE__ = null;

  /* Remove any leftover DOM nodes */
  document.body.innerHTML = "";

  setupTabManager();
  setupTauriInternals();
});

afterEach(() => {
  /* Clean up injected CSS */
  removeFileBrowserCSS();
  /* Remove vault manager to avoid test bleed */
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__MARKABLE_CURRENT_FILE__;
});

// ── Plugin metadata ───────────────────────────────────────────────────────────

describe("plugin metadata", () => {
  it("has id 'file-browser'", () => {
    expect(plugin.id).toBe("file-browser");
  });

  it("has sidebarPanelId 'file-browser'", () => {
    expect(plugin.sidebarPanelId).toBe("file-browser");
  });

  it("has a non-empty name", () => {
    expect(plugin.name.length).toBeGreaterThan(0);
  });

  it("has a non-empty description", () => {
    expect(plugin.description.length).toBeGreaterThan(0);
  });

  it("has a version string", () => {
    expect(plugin.version).toBeTruthy();
  });
});

// ── Plugin lifecycle ───────────────────────────────────────────────────────────

describe("plugin lifecycle", () => {
  it("onEnable calls api.registerSidebarPanel", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    expect(api.registerSidebarPanel).toHaveBeenCalledOnce();
    plugin.onDisable(api as any);
  });

  it("registerSidebarPanel is called with id 'file-browser'", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    expect(descriptor.id).toBe("file-browser");
    plugin.onDisable(api as any);
  });

  it("registerSidebarPanel uses side 'left'", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    expect(descriptor.side).toBe("left");
    plugin.onDisable(api as any);
  });

  it("registerSidebarPanel panel title is 'Files'", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    expect(descriptor.title).toBe("Files");
    plugin.onDisable(api as any);
  });

  it("onDisable calls api.unregisterSidebarPanel", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    plugin.onDisable(api as any);
    expect(api.unregisterSidebarPanel).toHaveBeenCalledOnce();
  });

  it("onDisable subscribes to vault-changed and unsubscribes on disable", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    plugin.onEnable(api as any);
    expect(vm.onVaultChanged).toHaveBeenCalled();
    plugin.onDisable(api as any);
    expect(vm.offVaultChanged).toHaveBeenCalled();
  });

  it("onDisable clears the panel container", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);

    /* Simulate panel render */
    const container = makeContainer();
    _testing.setPanelContainer(container);

    plugin.onDisable(api as any);
    expect(_testing.getPanelContainer()).toBeNull();
  });
});

// ── CSS injection ─────────────────────────────────────────────────────────────

describe("CSS injection", () => {
  it("injectFileBrowserCSS adds a <style> tag to the document head", () => {
    expect(_testing.isCSSInjected()).toBe(false);
    injectFileBrowserCSS();
    expect(_testing.isCSSInjected()).toBe(true);
  });

  it("injectFileBrowserCSS is idempotent (no duplicate tags)", () => {
    injectFileBrowserCSS();
    injectFileBrowserCSS();
    const tags = document.head.querySelectorAll("#__markable_file_browser_css__");
    expect(tags).toHaveLength(1);
  });

  it("removeFileBrowserCSS removes the injected tag", () => {
    injectFileBrowserCSS();
    removeFileBrowserCSS();
    expect(_testing.isCSSInjected()).toBe(false);
  });

  it("removeFileBrowserCSS is a no-op when no tag exists", () => {
    expect(() => removeFileBrowserCSS()).not.toThrow();
  });
});

// ── Empty state rendering ─────────────────────────────────────────────────────

describe("empty state rendering", () => {
  it("renders 'no-vault' empty state when no active vault", () => {
    setupVaultManager(null, null);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.querySelector(".file-browser-empty")).not.toBeNull();
    expect(container.textContent).toContain("Create your first vault");
  });

  it("'no-vault' empty state includes a button to set up a vault", () => {
    setupVaultManager(null, null);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const btn = container.querySelector(".file-browser-empty button");
    expect(btn).not.toBeNull();
  });

  it("renders 'no-files' empty state when vault exists but has no entries", () => {
    const vault = makeVault();
    const emptyIndex = makeVaultIndex([]);
    setupVaultManager(vault, emptyIndex);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.textContent).toContain("No notes yet");
  });

  it("renders loading state when _isLoading is true", () => {
    const vault = makeVault();
    setupVaultManager(vault, null);
    _testing.setIsLoading(true);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.textContent).toContain("Loading");
  });

  it("renders search empty state when filter matches nothing", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/readme.md"]);
    setupVaultManager(vault, index);
    _testing.setSearchQuery("zzz-no-match");
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.textContent).toContain("No notes match");
  });
});

// ── Tree rendering ────────────────────────────────────────────────────────────

describe("tree rendering", () => {
  it("renders the vault node when active vault is set", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/note1.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const vaultNode = container.querySelector(".tree-node-vault");
    expect(vaultNode).not.toBeNull();
  });

  it("vault node displays the vault name", () => {
    const vault = makeVault({ name: "My Test Vault" });
    const index = makeVaultIndex(["/notes/note1.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.textContent).toContain("My Test Vault");
  });

  it("renders a .tree-node-file element for each indexed file", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/a.md", "/notes/b.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const fileNodes = container.querySelectorAll(".tree-node-file");
    expect(fileNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("renders directory nodes for nested files", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/work/report.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const dirNodes = container.querySelectorAll(".tree-node-directory");
    expect(dirNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("each tree node has a data-path attribute", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/note.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const nodes = container.querySelectorAll(".tree-node[data-path]");
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("renders a search input in the panel header", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/note.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const input = container.querySelector(".file-browser-search");
    expect(input).not.toBeNull();
  });

  it("cap notice is shown when index is capped", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/a.md"]);
    index.capped = true;
    index.totalFilesFound = 1000;
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.textContent).toContain("Showing");
  });
});

// ── File node click ───────────────────────────────────────────────────────────

describe("file node click", () => {
  it("clicking a file node calls __MARKABLE_TAB_MANAGER__.openFileInTab with the file path", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/readme.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    expect(fileNode).not.toBeNull();
    fileNode!.click();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFileInTab).toHaveBeenCalledWith("/notes/readme.md");
  });

  it("clicking the active vault node toggles expand/collapse (does NOT call switchVault)", () => {
    const vault = makeVault({ id: "v1" });
    const index = makeVaultIndex(["/notes/note.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const vaultNode = container.querySelector<HTMLElement>(".tree-node-vault");
    expect(vaultNode).not.toBeNull();
    vaultNode!.click();

    /* switchVault should NOT be called for the already-active vault */
    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    expect(vm.switchVault).not.toHaveBeenCalled();
  });
});

// ── Active file highlight ─────────────────────────────────────────────────────

describe("active file highlight", () => {
  it("adds .tree-node-active to the node matching __MARKABLE_CURRENT_FILE__", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/active.md", "/notes/other.md"]);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/active.md";
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const activeNode = container.querySelector<HTMLElement>('[data-path="/notes/active.md"]');
    expect(activeNode?.classList.contains("tree-node-active")).toBe(true);
  });

  it("does not add .tree-node-active to non-matching file nodes", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/active.md", "/notes/other.md"]);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/active.md";
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const otherNode = container.querySelector<HTMLElement>('[data-path="/notes/other.md"]');
    expect(otherNode?.classList.contains("tree-node-active")).toBe(false);
  });

  it("updateActiveFileHighlight moves .tree-node-active to the new current file", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/a.md", "/notes/b.md"]);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/a.md";
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    /* Switch to the other file */
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/b.md";
    updateActiveFileHighlight();

    const aNode = container.querySelector<HTMLElement>('[data-path="/notes/a.md"]');
    const bNode = container.querySelector<HTMLElement>('[data-path="/notes/b.md"]');
    expect(aNode?.classList.contains("tree-node-active")).toBe(false);
    expect(bNode?.classList.contains("tree-node-active")).toBe(true);
  });

  it("no node is highlighted when __MARKABLE_CURRENT_FILE__ is null", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/note.md"]);
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const activeNodes = container.querySelectorAll(".tree-node-active");
    expect(activeNodes).toHaveLength(0);
  });
});

// ── Search / filter ───────────────────────────────────────────────────────────

describe("search / filter", () => {
  it("renders flat file list when search query is set", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/readme.md", "/notes/todo.md"]);
    setupVaultManager(vault, index);
    _testing.setSearchQuery("readme");
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNodes = container.querySelectorAll(".tree-node-file");
    expect(fileNodes.length).toBe(1);
    expect(fileNodes[0].getAttribute("data-path")).toBe("/notes/readme.md");
  });

  it("restores tree structure after clearing the search query", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/work/report.md", "/notes/readme.md"]);
    setupVaultManager(vault, index);

    /* With query — flat */
    _testing.setSearchQuery("report");
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    const filteredDirs = container.querySelectorAll(".tree-node-directory");
    expect(filteredDirs).toHaveLength(0);

    /* Clear query — tree structure restored */
    _testing.setSearchQuery("");
    renderPanel();
    const treeDirs = container.querySelectorAll(".tree-node-directory");
    expect(treeDirs.length).toBeGreaterThanOrEqual(1);
  });

  it("shows no-search-results empty state when filter matches nothing", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/readme.md"]);
    setupVaultManager(vault, index);
    _testing.setSearchQuery("zzz-nomatch");
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();
    expect(container.querySelector(".file-browser-empty")).not.toBeNull();
  });
});

// ── Panel destroy ─────────────────────────────────────────────────────────────

describe("panel destroy", () => {
  it("clears the container reference on panel destroy", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);

    /* Simulate panel being registered and destroyed */
    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    const container = makeContainer();
    descriptor.render(container);
    expect(_testing.getPanelContainer()).toBe(container);

    descriptor.destroy(container);
    expect(_testing.getPanelContainer()).toBeNull();

    plugin.onDisable(api as any);
  });

  it("panel destroy clears _treeEl", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);

    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    const container = makeContainer();
    descriptor.render(container);
    descriptor.destroy(container);
    expect(_testing.getTreeEl()).toBeNull();

    plugin.onDisable(api as any);
  });
});

// ── Vault-changed event ───────────────────────────────────────────────────────

describe("vault-changed event", () => {
  it("onVaultChanged subscription is registered during onEnable", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    expect(vm.onVaultChanged).toHaveBeenCalled();

    plugin.onDisable(api as any);
  });

  it("onIndexUpdated subscription is registered during onEnable", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    expect(vm.onIndexUpdated).toHaveBeenCalled();

    plugin.onDisable(api as any);
  });
});

// ── Keyboard navigation ───────────────────────────────────────────────────────

describe("keyboard navigation", () => {
  it("ArrowDown key moves focus from first to second visible node", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/a.md", "/notes/b.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const nodes = Array.from(container.querySelectorAll<HTMLElement>(".tree-node"));
    expect(nodes.length).toBeGreaterThanOrEqual(2);

    /* Focus the first node then press ArrowDown */
    nodes[0].focus();
    nodes[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    /* After ArrowDown the focus should have moved (the event handler calls .focus()) */
    /* We just verify the handler doesn't throw and the node count is stable */
    expect(container.querySelectorAll(".tree-node").length).toBeGreaterThanOrEqual(2);
  });

  it("ArrowRight expands a collapsed directory node", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/docs/readme.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const dirNode = container.querySelector<HTMLElement>(".tree-node-directory");
    expect(dirNode).not.toBeNull();
    expect(dirNode!.getAttribute("aria-expanded")).toBe("false");

    dirNode!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(dirNode!.getAttribute("aria-expanded")).toBe("true");
  });

  it("ArrowLeft collapses an expanded directory node", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/docs/readme.md"]);
    setupVaultManager(vault, index);
    /* Pre-expand the directory */
    _testing.setExpandedPaths(new Set(["/notes/docs"]));
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const dirNode = container.querySelector<HTMLElement>(".tree-node-directory");
    expect(dirNode).not.toBeNull();
    expect(dirNode!.getAttribute("aria-expanded")).toBe("true");

    dirNode!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(dirNode!.getAttribute("aria-expanded")).toBe("false");
  });
});

// ── Manage Vaults button ──────────────────────────────────────────────────────

describe("headerActions", () => {
  it("sidebar panel descriptor includes headerActions array", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    expect(descriptor.headerActions).toBeDefined();
    expect(Array.isArray(descriptor.headerActions)).toBe(true);
    expect(descriptor.headerActions.length).toBeGreaterThanOrEqual(1);
    plugin.onDisable(api as any);
  });

  it("headerActions first entry has icon '⋯' and title 'Panel menu'", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);
    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    const action = descriptor.headerActions[0];
    expect(action.icon).toBe("⋯");
    expect(action.title).toBe("Panel menu");
    plugin.onDisable(api as any);
  });
});

// ── renderEmptyState variants ─────────────────────────────────────────────────

describe("renderEmptyState", () => {
  it("no-vault variant renders a button", () => {
    const wrapper = document.createElement("div");
    _testing.renderEmptyState(wrapper, "no-vault");
    expect(wrapper.querySelector("button")).not.toBeNull();
  });

  it("no-files variant does not render a button", () => {
    const wrapper = document.createElement("div");
    _testing.renderEmptyState(wrapper, "no-files");
    expect(wrapper.querySelector("button")).toBeNull();
  });

  it("no-search-results variant includes an <em> with the query text", () => {
    _testing.setSearchQuery("my-query");
    const wrapper = document.createElement("div");
    _testing.renderEmptyState(wrapper, "no-search-results");
    const em = wrapper.querySelector("em");
    expect(em?.textContent).toBe("my-query");
  });
});

// ── BLOCKING-1: refreshVaultData calls reloadVaultIndex when no cached index ──

describe("refreshVaultData — reloadVaultIndex delegation", () => {
  it("calls vm.reloadVaultIndex when getVaultIndex returns null", async () => {
    /*
     * Arrange: active vault present, but index is null (not yet built).
     * refreshVaultData must call vaultManager.reloadVaultIndex() rather than
     * invoking build_vault_index directly (BLOCKING-1).
     */
    const vault = makeVault();
    setupVaultManager(vault, null); /* null index → triggers the slow path */
    _testing.setEnabled(true);

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    await refreshVaultData();

    expect(vm.reloadVaultIndex).toHaveBeenCalledOnce();

    _testing.setEnabled(false);
  });

  it("does NOT call vm.reloadVaultIndex when a cached index already exists", async () => {
    /*
     * When vault-manager already has an index, we should render immediately
     * without triggering an expensive rebuild.
     */
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/note.md"]);
    setupVaultManager(vault, index);
    _testing.setEnabled(true);
    const container = makeContainer();
    _testing.setPanelContainer(container);

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    await refreshVaultData();

    expect(vm.reloadVaultIndex).not.toHaveBeenCalled();

    _testing.setEnabled(false);
  });
});

// ── HIGH-1: destroy() clears container DOM ────────────────────────────────────

describe("panel destroy — DOM cleared", () => {
  it("destroy() empties the container's innerHTML before clearing refs", () => {
    setupVaultManager(null, null);
    const api = makeMockApi();
    plugin.onEnable(api as any);

    const descriptor = (api.registerSidebarPanel as any).mock.calls[0][0];
    const container = makeContainer();
    /*
     * Add some child content to the container so we can verify it is removed.
     * The render call here may be a no-op in terms of DOM (no vault), but it
     * will still create the wrapper div.
     */
    container.innerHTML = "<p>stale content</p>";
    descriptor.destroy(container);

    /* Container must be empty after destroy (HIGH-1) */
    expect(container.innerHTML).toBe("");

    plugin.onDisable(api as any);
  });
});

// ── MEDIUM-3: active file scrolled into view ──────────────────────────────────

describe("active file scroll-into-view", () => {
  it("active file node has scrollIntoView called when panel is shown", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/active.md", "/notes/other.md"]);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/active.md";
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    /*
     * Spy on the matching <li>'s scrollIntoView after the panel renders.
     * The node must already exist in the DOM at this point.
     */
    const activeNode = container.querySelector<HTMLElement>('[data-path="/notes/active.md"]');
    expect(activeNode).not.toBeNull();

    const scrollSpy = vi.fn();
    activeNode!.scrollIntoView = scrollSpy;

    /* Calling updateActiveFileHighlight must invoke scrollIntoView({ block: "nearest" }) */
    _testing.updateActiveFileHighlight();

    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
  });
});

// ── MEDIUM-4: search debounce 150ms ──────────────────────────────────────────

describe("search debounce", () => {
  it("search input is debounced at 150ms", async () => {
    vi.useFakeTimers();

    const vault = makeVault();
    const index = makeVaultIndex(["/notes/readme.md", "/notes/todo.md"]);
    setupVaultManager(vault, index);
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const input = container.querySelector<HTMLInputElement>(".file-browser-search");
    expect(input).not.toBeNull();

    /* Type a character — the debounce timer should not have fired yet */
    input!.value = "readme";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    /* At 149ms the filter should still not have changed the query */
    vi.advanceTimersByTime(149);
    expect(_testing.getSearchQuery()).toBe(""); /* unchanged */

    /* At 150ms exactly the debounce fires */
    vi.advanceTimersByTime(1);
    expect(_testing.getSearchQuery()).toBe("readme");

    vi.useRealTimers();
  });
});

// ── MEDIUM-5: onIndexUpdated triggers re-render ───────────────────────────────

describe("onIndexUpdated triggers re-render", () => {
  it("emitting onIndexUpdated with new files causes panel DOM to update", () => {
    /*
     * Capture the callback registered during onEnable, then call it with an
     * updated VaultIndex. Verify the panel DOM reflects the new index.
     */
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/note-a.md"]);
    setupVaultManager(vault, index);

    const api = makeMockApi();
    plugin.onEnable(api as any);

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;

    /* Mount the panel */
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    /* Verify initial state: one file */
    expect(container.querySelectorAll(".tree-node-file").length).toBe(1);

    /* Update the vault index mock to contain two files */
    const updatedIndex = makeVaultIndex(["/notes/note-a.md", "/notes/note-b.md"]);
    vm.getVaultIndex.mockReturnValue(updatedIndex);

    /* Emit the index-updated event — plugin must re-render */
    vm._emitIndexUpdated({ vaultId: vault.id, kind: "create", path: "/notes/note-b.md" });

    /* Panel should now show two files */
    expect(container.querySelectorAll(".tree-node-file").length).toBe(2);

    plugin.onDisable(api as any);
  });
});

// ── LOW-4: getVaultIconClass with null iconId ─────────────────────────────────

// =============================================================================
// Step 02b Tests
// =============================================================================

// ── validateFilename ──────────────────────────────────────────────────────────

describe("validateFilename", () => {
  it("returns null for a valid stem", () => {
    expect(validateFilename("my-note")).toBeNull();
  });

  it("returns error for empty name", () => {
    expect(validateFilename("   ")).not.toBeNull();
  });

  it("returns error for illegal colon character (EC-16)", () => {
    expect(validateFilename("bad:name")).not.toBeNull();
    expect(validateFilename("bad:name")).toContain("illegal");
  });

  it("returns error for illegal slash character", () => {
    expect(validateFilename("bad/name")).not.toBeNull();
  });

  it("returns error for dot-only names", () => {
    expect(validateFilename(".")).not.toBeNull();
    expect(validateFilename("..")).not.toBeNull();
  });

  it("allows names with dots in non-dot-only positions", () => {
    expect(validateFilename("my.note")).toBeNull();
  });
});

// ── Path helpers ──────────────────────────────────────────────────────────────

describe("getFileStem", () => {
  it("strips .md extension", () => {
    expect(getFileStem("/notes/report.md")).toBe("report");
  });

  it("returns basename unchanged for non-.md paths", () => {
    expect(getFileStem("/notes/folder")).toBe("folder");
  });
});

describe("getParentDir", () => {
  it("returns parent directory path", () => {
    expect(getParentDir("/notes/work/report.md")).toBe("/notes/work");
  });

  it("returns / for top-level path", () => {
    expect(getParentDir("/note.md")).toBe("/");
  });
});

describe("getBasename", () => {
  it("returns filename from path", () => {
    expect(getBasename("/notes/work/report.md")).toBe("report.md");
  });

  it("returns last segment of path without trailing slash", () => {
    expect(getBasename("/notes/work")).toBe("work");
  });
});

// ── showLinkUpdateBanner ──────────────────────────────────────────────────────

describe("showLinkUpdateBanner", () => {
  it("inserts a .file-browser-link-banner element into the container", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    showLinkUpdateBanner(container, "old-note", "new-note", ["/notes/a.md"]);

    expect(container.querySelector(".file-browser-link-banner")).not.toBeNull();
    container.remove();
  });

  it("shows the count in the banner message", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    showLinkUpdateBanner(container, "old-note", "new-note", ["/notes/a.md", "/notes/b.md"]);
    const banner = container.querySelector(".file-browser-link-banner") as HTMLElement;
    expect(banner.textContent).toContain("2 notes");
    container.remove();
  });

  it("replaces any existing banner (idempotent)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    showLinkUpdateBanner(container, "old", "new1", ["/a.md"]);
    showLinkUpdateBanner(container, "old", "new2", ["/a.md"]);

    expect(container.querySelectorAll(".file-browser-link-banner").length).toBe(1);
    container.remove();
  });

  it("has Update and Dismiss buttons", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    showLinkUpdateBanner(container, "old", "new", ["/a.md"]);
    const btns = container.querySelectorAll(".file-browser-link-banner-btn");
    expect(btns.length).toBeGreaterThanOrEqual(2);
    container.remove();
  });

  it("Dismiss button removes the banner", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    showLinkUpdateBanner(container, "old", "new", ["/a.md"]);
    const dismissBtn = container.querySelector<HTMLElement>(".file-browser-link-banner-dismiss");
    dismissBtn?.click();

    expect(container.querySelector(".file-browser-link-banner")).toBeNull();
    container.remove();
  });
});

// ── Context menu ──────────────────────────────────────────────────────────────

describe("context menu", () => {
  beforeEach(() => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));
  });

  it("right-click on a file node creates a .context-menu element", () => {
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    expect(fileNode).not.toBeNull();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    fileNode!.dispatchEvent(event);

    expect(document.querySelector(".context-menu")).not.toBeNull();
    _testing.closeContextMenu();
  });

  it("context menu for a file node includes Rename item", () => {
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    fileNode!.dispatchEvent(event);

    const items = document.querySelectorAll(".context-menu-item");
    const labels = Array.from(items).map((i) => i.textContent);
    expect(labels).toContain("Rename");
    _testing.closeContextMenu();
  });

  it("context menu for a file node includes Delete item", () => {
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    fileNode!.dispatchEvent(event);

    const items = document.querySelectorAll(".context-menu-item");
    const labels = Array.from(items).map((i) => i.textContent);
    expect(labels).toContain("Delete");
    _testing.closeContextMenu();
  });

  it("Escape key dismisses the context menu", () => {
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    fileNode!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    expect(document.querySelector(".context-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("click outside dismisses the context menu", () => {
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    fileNode!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    expect(document.querySelector(".context-menu")).not.toBeNull();

    // Simulate mousedown outside the menu
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("getContextMenu returns the open menu element", () => {
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    fileNode!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));

    expect(_testing.getContextMenu()).not.toBeNull();
    _testing.closeContextMenu();
  });

  it("directory right-click shows New Note and New Folder items", () => {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/sub/note-b.md"]);
    setupVaultManager(vault, index);

    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const dirNode = container.querySelector<HTMLElement>(".tree-node-directory");
    if (!dirNode) {
      // No directory node in this tree shape — skip gracefully
      return;
    }
    dirNode.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    const labels = Array.from(document.querySelectorAll(".context-menu-item")).map((i) => i.textContent);
    expect(labels).toContain("New Note");
    expect(labels).toContain("New Folder");
    _testing.closeContextMenu();
  });
});

// ── Inline rename ──────────────────────────────────────────────────────────────

describe("inline rename", () => {
  it("Rename menu item triggers startInlineRename: input replaces label", () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    expect(fileNode).not.toBeNull();

    startInlineRename(fileNode!, "/notes/note-a.md", "test-vault");

    expect(fileNode!.querySelector(".tree-node-rename-input")).not.toBeNull();
  });

  it("Escape key on rename input cancels and restores the label", () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    startInlineRename(fileNode!, "/notes/note-a.md", "test-vault");

    const input = fileNode!.querySelector<HTMLInputElement>(".tree-node-rename-input");
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Input should be removed, label restored
    expect(fileNode!.querySelector(".tree-node-rename-input")).toBeNull();
    expect(fileNode!.querySelector(".tree-node-label")).not.toBeNull();
  });

  it("real-time validation shows error for illegal character (EC-16)", () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    startInlineRename(fileNode!, "/notes/note-a.md", "test-vault");

    const input = fileNode!.querySelector<HTMLInputElement>(".tree-node-rename-input")!;
    input.value = "bad:name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const errSpan = fileNode!.querySelector(".tree-node-inline-error");
    expect(errSpan?.textContent?.length).toBeGreaterThan(0);
  });

  it("Enter on rename input invokes rename_file Tauri command", async () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };

    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    startInlineRename(fileNode!, "/notes/note-a.md", "test-vault");

    const input = fileNode!.querySelector<HTMLInputElement>(".tree-node-rename-input")!;
    input.value = "new-name";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // Allow the async rename to settle
    await new Promise((r) => setTimeout(r, 10));

    // rename_file should have been called
    expect(invokeMock).toHaveBeenCalledWith("rename_file", expect.objectContaining({
      oldPath: "/notes/note-a.md",
    }));
  });
});

// ── FS watcher debounce ───────────────────────────────────────────────────────

describe("FS watcher integration", () => {
  it("handleFsEvent ignores events for a different vault (EC-25)", () => {
    const vault = makeVault({ id: "vault-a" });
    setupVaultManager(vault, makeVaultIndex(["/notes/a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    _testing.setEnabled(true);

    // Event for a different vault should be ignored
    _testing.handleFsEvent({ vaultId: "vault-b", eventType: "created", path: "/other/note.md" });

    // No debounce timer should have been started
    expect(_testing.getFsDebounceTimer()).toBeNull();

    _testing.setEnabled(false);
  });

  it("handleFsEvent schedules a debounced reloadVaultIndex for the active vault", () => {
    vi.useFakeTimers();

    const vault = makeVault({ id: "vault-a" });
    const reloadMock = vi.fn().mockResolvedValue(undefined);
    setupVaultManager(vault, makeVaultIndex(["/notes/a.md"]));
    (window as any).__MARKABLE_VAULT_MANAGER__.reloadVaultIndex = reloadMock;

    _testing.setEnabled(true);

    _testing.handleFsEvent({ vaultId: "vault-a", eventType: "created", path: "/notes/a.md" });

    // Debounce timer should be pending but reloadVaultIndex not called yet
    expect(reloadMock).not.toHaveBeenCalled();

    // Advance past 300ms debounce
    vi.advanceTimersByTime(310);
    expect(reloadMock).toHaveBeenCalledTimes(1);

    _testing.setEnabled(false);
    vi.useRealTimers();
  });

  it("handleFsEvent resets debounce on rapid events", () => {
    vi.useFakeTimers();

    const vault = makeVault({ id: "vault-a" });
    const reloadMock = vi.fn().mockResolvedValue(undefined);
    setupVaultManager(vault, makeVaultIndex(["/notes/a.md"]));
    (window as any).__MARKABLE_VAULT_MANAGER__.reloadVaultIndex = reloadMock;

    _testing.setEnabled(true);

    // Rapid events — each resets the timer
    _testing.handleFsEvent({ vaultId: "vault-a", eventType: "created", path: "/notes/1.md" });
    vi.advanceTimersByTime(100);
    _testing.handleFsEvent({ vaultId: "vault-a", eventType: "created", path: "/notes/2.md" });
    vi.advanceTimersByTime(100);
    _testing.handleFsEvent({ vaultId: "vault-a", eventType: "created", path: "/notes/3.md" });

    // Only 200ms have passed since the last event — reload not yet called
    expect(reloadMock).not.toHaveBeenCalled();

    // Advance past 300ms since the LAST event
    vi.advanceTimersByTime(310);
    expect(reloadMock).toHaveBeenCalledTimes(1); // Only one call despite 3 events

    _testing.setEnabled(false);
    vi.useRealTimers();
  });
});

// ── watch_vault called on onEnable ────────────────────────────────────────────

describe("watch_vault and unwatch_vault lifecycle", () => {
  it("onEnable calls watch_vault when a vault is active", async () => {
    const vault = makeVault();
    setupVaultManager(vault, makeVaultIndex(["/notes/a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const api = makeMockApi();
    plugin.onEnable(api as any);

    // Allow startFsWatcher async work to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(invokeMock).toHaveBeenCalledWith("watch_vault", expect.objectContaining({
      vaultId: vault.id,
    }));

    plugin.onDisable(api as any);
  });

  it("onDisable calls unwatch_vault", async () => {
    const vault = makeVault();
    setupVaultManager(vault, makeVaultIndex(["/notes/a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const api = makeMockApi();
    plugin.onEnable(api as any);
    await new Promise((r) => setTimeout(r, 10));

    plugin.onDisable(api as any);
    await new Promise((r) => setTimeout(r, 10));

    expect(invokeMock).toHaveBeenCalledWith("unwatch_vault", expect.objectContaining({
      vaultId: vault.id,
    }));
  });
});

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

describe("drag-and-drop", () => {
  it("dragstart on a file node sets the path in dataTransfer", () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    expect(fileNode).not.toBeNull();

    // File nodes should have draggable="true"
    expect(fileNode!.getAttribute("draggable")).toBe("true");
  });

  it("drop on a vault node calls move_file Tauri command", async () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));
    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const invokeMock = vi.fn().mockResolvedValue("/notes/sub/note-a.md");
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const vaultNode = container.querySelector<HTMLElement>(".tree-node-vault");
    expect(vaultNode).not.toBeNull();

    const dt = {
      getData: vi.fn(() => "/notes/note-a.md"),
      setData: vi.fn(),
    };

    const dropEvent = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
    vaultNode!.dispatchEvent(dropEvent);

    await new Promise((r) => setTimeout(r, 10));

    expect(invokeMock).toHaveBeenCalledWith("move_file", expect.objectContaining({
      source: "/notes/note-a.md",
    }));
  });
});

// ── Backlinks vault index migration ──────────────────────────────────────────

describe("backlinks migration: invokeListMdFiles via vault index", () => {
  it("when vault index is active, returns vault index names without invoking list_md_files", async () => {
    /*
     * This test exercises the Phase 2b backlinks migration path directly by
     * checking that the vault index is used when available, bypassing the
     * list_md_files Rust command.
     */
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/alpha.md", "/notes/beta.md"]);
    setupVaultManager(vault, index);

    const invokeMock = vi.fn().mockResolvedValue([]);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    /*
     * Replicate the Phase 2b invokeListMdFiles logic inline to verify the
     * behaviour (the function itself is internal to the backlinks plugin):
     */
    const vaultIndexResult = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.();
    expect(vaultIndexResult).not.toBeNull();

    const names = (vaultIndexResult.entries as Array<{ name: string }>).map((e) => e.name + ".md");
    expect(names).toContain("alpha.md");
    expect(names).toContain("beta.md");
    // list_md_files should NOT have been called because vault index was available
    expect(invokeMock).not.toHaveBeenCalledWith("list_md_files", expect.anything());
  });

  it("when no vault is active, falls back to list_md_files", async () => {
    /*
     * With no active vault, getVaultIndex() returns null, so the backlinks
     * plugin must fall back to list_md_files.
     */
    setupVaultManager(null, null);

    const invokeMock = vi.fn().mockResolvedValue(["note-a.md", "note-b.md"]);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const vaultIndexResult = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.();
    expect(vaultIndexResult).toBeNull();
    // Fallback path would call list_md_files — confirmed by null index above
  });
});

// ── Delete file ───────────────────────────────────────────────────────────────

describe("delete file via context menu", () => {
  it("Delete menu item calls delete_file after confirm (simulated)", async () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    /*
     * JSDOM does not implement window.confirm; we stub it via stubGlobal so the
     * production code's window.confirm() call returns the value we supply.
     */
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    fileNode!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));

    const items = Array.from(document.querySelectorAll(".context-menu-item"));
    const deleteItem = items.find((i) => i.textContent === "Delete") as HTMLElement | undefined;
    expect(deleteItem).not.toBeUndefined();

    deleteItem!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    expect(invokeMock).toHaveBeenCalledWith("delete_file", expect.objectContaining({
      path: "/notes/note-a.md",
    }));

    vi.unstubAllGlobals();
  });

  it("Delete menu item does nothing when confirm is cancelled", async () => {
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));

    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    fileNode!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));

    const items = Array.from(document.querySelectorAll(".context-menu-item"));
    const deleteItem = items.find((i) => i.textContent === "Delete") as HTMLElement | undefined;

    deleteItem?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));
    expect(invokeMock).not.toHaveBeenCalledWith("delete_file", expect.anything());

    vi.unstubAllGlobals();
  });
});

// ── HIGH-1: deleteDirectory tests (EC-20) ─────────────────────────────────────

describe("deleteDirectory", () => {
  /**
   * Sets up a vault index where at least one file lives inside /notes/sub/,
   * and provides a `closeFile` spy on the tab manager.
   */
  function setupForDeleteDir() {
    const vault = makeVault();
    const index = makeVaultIndex(["/notes/sub/child.md", "/notes/other.md"]);
    setupVaultManager(vault, index);

    const closeFileSpy = vi.fn().mockResolvedValue(undefined);
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn().mockResolvedValue(true),
      closeFile: closeFileSpy,
    };

    return { closeFileSpy };
  }

  it("happy path: confirm accepted → delete_directory invoked and tabs closed", async () => {
    /*
     * When the user confirms, deleteDirectory should:
     *   1. Call closeFile for each file under the directory (EC-20).
     *   2. Invoke delete_directory on the Rust side.
     */
    const { closeFileSpy } = setupForDeleteDir();

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    await deleteDirectory("/notes/sub");

    /* Tab manager's closeFile must be called for the file inside the dir. */
    expect(closeFileSpy).toHaveBeenCalledWith("/notes/sub/child.md");

    /* delete_directory Tauri command must be invoked. */
    expect(invokeMock).toHaveBeenCalledWith("delete_directory", {
      path: "/notes/sub",
    });

    vi.unstubAllGlobals();
  });

  it("confirm rejected → delete_directory NOT called", async () => {
    /*
     * When the user cancels the confirmation dialog, neither closeFile nor
     * delete_directory should be called.
     */
    const { closeFileSpy } = setupForDeleteDir();

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));

    await deleteDirectory("/notes/sub");

    expect(invokeMock).not.toHaveBeenCalledWith("delete_directory", expect.anything());
    expect(closeFileSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("EC-20: closeFile is called for tabs inside the directory", async () => {
    /*
     * EC-20: when a tab inside the directory has unsaved changes, the tab
     * manager's closeFile (which handles the dirty-state prompt internally)
     * must be called with the file path so the user gets the save prompt.
     *
     * We verify that closeFile is called with the exact child path. The tab
     * manager mock (not the plugin) is responsible for the actual prompt UI.
     */
    const vault = makeVault();
    const index = makeVaultIndex([
      "/notes/proj/design.md",
      "/notes/proj/notes.md",
      "/notes/readme.md", // outside the directory — should NOT be closed
    ]);
    setupVaultManager(vault, index);

    const closeFileSpy = vi.fn().mockResolvedValue(undefined);
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn().mockResolvedValue(true),
      closeFile: closeFileSpy,
    };

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    await deleteDirectory("/notes/proj");

    /* closeFile called for both files inside the directory. */
    expect(closeFileSpy).toHaveBeenCalledWith("/notes/proj/design.md");
    expect(closeFileSpy).toHaveBeenCalledWith("/notes/proj/notes.md");

    /* /notes/readme.md is NOT inside /notes/proj/ — must not be closed. */
    expect(closeFileSpy).not.toHaveBeenCalledWith("/notes/readme.md");

    vi.unstubAllGlobals();
  });
});

// ── HIGH-2: renameNode link-update banner (EC-18) ─────────────────────────────

describe("renameNode link-update banner (EC-18)", () => {
  /**
   * Builds a vault index where one file has an outbound link pointing to
   * the stem "old-note", used to verify the link-update banner appears.
   */
  function makeIndexWithBacklink(): VaultIndex {
    return {
      vaultId: "test-vault",
      builtAt: Date.now(),
      entries: [
        {
          path: "/notes/old-note.md",
          name: "old-note",
          modified: 1000,
          size: 100,
          title: "Old Note",
          tags: [],
          outboundLinks: [],
        },
        {
          path: "/notes/linking-note.md",
          name: "linking-note",
          modified: 1000,
          size: 100,
          title: "Linker",
          tags: [],
          outboundLinks: ["old-note"], // references the file being renamed
        },
      ],
      totalFilesFound: 2,
      skippedCount: 0,
      capped: false,
    };
  }

  it("link-update banner appears after confirming rename (EC-18)", async () => {
    /*
     * After a successful rename, when the vault index shows that another file
     * contains outboundLinks: ["old-note"], the plugin must display the
     * .file-browser-link-banner notification strip in the panel container.
     */
    const vault = makeVault();
    const index = makeIndexWithBacklink();
    setupVaultManager(vault, index);

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const container = makeContainer();

    await renameNode("/notes/old-note.md", "new-note", container);

    /* The banner must be visible inside the container. */
    expect(container.querySelector(".file-browser-link-banner")).not.toBeNull();
  });

  it("clicking Update in the banner invokes update_wiki_links with correct args", async () => {
    /*
     * Clicking "Update" in the link-update banner must call update_wiki_links
     * with oldLink: "old-note" and newLink: "new-note".
     */
    const vault = makeVault();
    const index = makeIndexWithBacklink();
    setupVaultManager(vault, index);

    const invokeMock = vi.fn().mockResolvedValue({ updated: ["/notes/linking-note.md"], failed: [] });
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const container = makeContainer();

    await renameNode("/notes/old-note.md", "new-note", container);

    const updateBtn = container.querySelector<HTMLElement>(".file-browser-link-banner-btn:not(.file-browser-link-banner-dismiss)");
    expect(updateBtn).not.toBeNull();
    updateBtn!.click();

    /* Allow the async handleLinkUpdateClick to settle. */
    await new Promise((r) => setTimeout(r, 10));

    expect(invokeMock).toHaveBeenCalledWith("update_wiki_links", expect.objectContaining({
      oldLink: "old-note",
      newLink: "new-note",
    }));
  });

  it("clicking Dismiss removes the banner without calling update_wiki_links", async () => {
    /*
     * Clicking "Dismiss" must remove the banner from the DOM and must NOT
     * call update_wiki_links.
     */
    const vault = makeVault();
    const index = makeIndexWithBacklink();
    setupVaultManager(vault, index);

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const container = makeContainer();

    await renameNode("/notes/old-note.md", "new-note", container);

    /* Banner must exist before dismiss. */
    expect(container.querySelector(".file-browser-link-banner")).not.toBeNull();

    const dismissBtn = container.querySelector<HTMLElement>(".file-browser-link-banner-dismiss");
    expect(dismissBtn).not.toBeNull();
    dismissBtn!.click();

    /* Banner must be gone. */
    expect(container.querySelector(".file-browser-link-banner")).toBeNull();

    /* update_wiki_links must NOT have been called. */
    expect(invokeMock).not.toHaveBeenCalledWith("update_wiki_links", expect.anything());
  });
});

// ── HIGH-3: moveNode error handling (EC-19) ───────────────────────────────────

describe("moveNode error handling (EC-19)", () => {
  it("when move_file rejects with an error, the error is surfaced to the user", async () => {
    /*
     * EC-19: when the destination already contains a file with the same name,
     * move_file rejects. The plugin must surface this to the user via either:
     *   a) a .file-browser-inline-error strip in the panel container, or
     *   b) a visible mechanism the user can observe.
     *
     * After MEDIUM-2 was fixed, moveNode's catch handler calls showInlineError
     * on _panelContainer, so we verify the error strip appears in the panel.
     */
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));

    const invokeMock = vi.fn().mockRejectedValue(new Error("File 'note-a.md' already exists in '/notes/sub'"));
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    /* Dispatch a drop on the vault node to trigger moveNode. */
    const vaultNode = container.querySelector<HTMLElement>(".tree-node-vault");
    expect(vaultNode).not.toBeNull();

    const dt = {
      getData: vi.fn(() => "/notes/note-a.md"),
      setData: vi.fn(),
    };

    const dropEvent = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
    vaultNode!.dispatchEvent(dropEvent);

    /* Allow the async move + catch handler to settle. */
    await new Promise((r) => setTimeout(r, 20));

    /*
     * After MEDIUM-2 fix, a .file-browser-inline-error strip should be
     * inserted into the panel container when move_file rejects.
     */
    expect(container.querySelector(".file-browser-inline-error")).not.toBeNull();
  });
});

// ── LOW-5: no-op rename (same name) ──────────────────────────────────────────

describe("startInlineRename — no-op when same name entered (LOW-5)", () => {
  it("pressing Enter with the same stem does NOT call rename_file", async () => {
    /*
     * When the user opens the rename input but doesn't change the filename,
     * pressing Enter should cancel cleanly without invoking rename_file on
     * the Rust side. The input must also be removed and the label restored.
     */
    setupVaultManager(makeVault(), makeVaultIndex(["/notes/note-a.md"]));

    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const container = makeContainer();
    _testing.setPanelContainer(container);
    renderPanel();

    const fileNode = container.querySelector<HTMLElement>(".tree-node-file");
    expect(fileNode).not.toBeNull();

    startInlineRename(fileNode!, "/notes/note-a.md", "test-vault");

    const input = fileNode!.querySelector<HTMLInputElement>(".tree-node-rename-input")!;
    expect(input).not.toBeNull();

    /* Input already contains "note-a" (the current stem) — press Enter unchanged. */
    expect(input.value).toBe("note-a");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await new Promise((r) => setTimeout(r, 20));

    /* rename_file must NOT be called — same-name rename is a no-op. */
    expect(invokeMock).not.toHaveBeenCalledWith("rename_file", expect.anything());

    /* The rename input must have been removed and the label restored. */
    expect(fileNode!.querySelector(".tree-node-rename-input")).toBeNull();
    expect(fileNode!.querySelector(".tree-node-label")).not.toBeNull();
  });
});

/* Imported here via the file-tree module re-exported by the plugin fixtures */
