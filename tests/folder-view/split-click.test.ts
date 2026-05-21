/**
 * tests/folder-view/split-click.test.ts
 *
 * Unit tests for split-click behavior introduced in step_03, now updated to
 * reflect the layout-view refactor from step_02_plugin-edits.md.
 *
 * Tests:
 *   T-10 — hasFolderView=true, label click → openFolderViewTab called
 *           (uses __MARKABLE_OPEN_FOLDER_VIEW_TAB__ spy; aria-expanded NOT toggled)
 *   T-11 — chevron click on hasFolderView=true → toggleDirectoryNode fires
 *           (aria-expanded flips); openFolderViewTab NOT called
 *   T-12 — Enter key on hasFolderView=true → openFolderViewTab called
 *   T-13 — _folder.md file click → openFileInTab + exitLayoutView called (FR-05)
 *   T-14 — hasFolderView=false, row click → toggleDirectoryNode (aria-expanded flips);
 *           openFolderViewTab NOT called (preserved from original FR-01 test)
 *
 * Arrow key tests (NFR-05) are preserved unchanged.
 *
 * Strategy: use the _testing accessor to reach internal functions and exercise
 * them against JSDOM elements. Window globals are stubbed in beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _testing } from "../../src/plugins/file-browser/file-browser.plugin";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a minimal directory <li> with chevron + label child elements. */
function makeDirectoryNode(path = "/vault/A", expanded = false): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "tree-node tree-node-directory";
  li.setAttribute("data-type", "directory");
  li.setAttribute("data-path", path);
  li.setAttribute("aria-expanded", expanded ? "true" : "false");
  li.tabIndex = 0;

  const chevron = document.createElement("span");
  chevron.className = "tree-node-chevron";

  const label = document.createElement("span");
  label.className = "tree-node-label";
  label.textContent = "A";

  li.appendChild(chevron);
  li.appendChild(label);
  return li;
}

describe("split-click behavior", () => {
  beforeEach(() => {
    // Reset module state so each test is isolated.
    _testing.setEnabled(true);
    _testing.setPanelContainer(document.createElement("div"));
    _testing.setExpandedPaths(new Set());

    // Stub window globals used by buildActivateHandler / toggleDirectoryNode.
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(() => Promise.resolve()),
      openMediaInTab: vi.fn(),
      exitLayoutView: vi.fn(),
      enterLayoutView: vi.fn(),
    };
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => ({ id: "vault-1", rootPaths: ["/vault"] })),
      getVaultIndex: vi.fn(() => null),
    };
    // Default: openFolderViewTab global is a spy (overridden per test as needed).
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = vi.fn();
  });

  // ── T-14 (FR-01): No folder-view → toggle on any click ───────────────────
  // Preserved unchanged from the original test.

  it("T-14 (FR-01): hasFolderView=false, clicking directory → does NOT route to openFolderViewTab", () => {
    const li = makeDirectoryNode("/vault/A");
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", false);
    li.dispatchEvent(new MouseEvent("click", { bubbles: false }));

    // With hasFolderView=false, toggleDirectoryNode runs and flips aria-expanded.
    expect(li.getAttribute("aria-expanded")).toBe("true");
    // The global openFolderViewTab spy was NOT invoked.
    expect(openFVSpy).not.toHaveBeenCalled();
  });

  // ── T-10: hasFolderView=true, row click → toggle expand/collapse only ────
  //
  // Post May 2026 codefence migration: row click on a directory ALWAYS just
  // toggles expand/collapse, regardless of hasFolderView. The visibility eye
  // badge on the folder is the dedicated trigger for opening the folder view
  // modal. Row click should never call __MARKABLE_OPEN_FOLDER_VIEW_TAB__.

  it("T-10: hasFolderView=true, collapsed row click → expands and does NOT open folder view", () => {
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const li = makeDirectoryNode("/vault/A", false);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(openFVSpy).not.toHaveBeenCalled();
    expect(li.getAttribute("aria-expanded")).toBe("true");
  });

  it("T-10b: hasFolderView=true, expanded row click → collapses and does NOT open folder view", () => {
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const li = makeDirectoryNode("/vault/A", true);  // already expanded
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(li.getAttribute("aria-expanded")).toBe("false");
    expect(openFVSpy).not.toHaveBeenCalled();
  });

  // ── T-11 (FR-03): chevron click → toggleDirectoryNode fires, openFolderViewTab NOT ──

  it("T-11 (FR-03): chevron click on hasFolderView=true node → aria-expanded flips; openFolderViewTab NOT called", () => {
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const li = makeDirectoryNode("/vault/A", false);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    const treeWrapper = document.createElement("div");
    treeWrapper.appendChild(ul);
    document.body.appendChild(treeWrapper);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);

    const chevron = li.querySelector<HTMLElement>(".tree-node-chevron")!;
    // The chevron listener added by attachNodeListeners calls stopPropagation
    // so the click never reaches the row activate handler.
    chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // toggleDirectoryNode fired → aria-expanded flipped.
    expect(li.getAttribute("aria-expanded")).toBe("true");
    // openFolderViewTab was NOT called.
    expect(openFVSpy).not.toHaveBeenCalled();

    document.body.removeChild(treeWrapper);
  });

  // ── T-12: Enter on a directory → same as row click (toggle), NOT folder view ──
  // After the row-click rule change, Enter behaves identically to a row click.

  it("T-12: Enter key on hasFolderView=true node → toggles, does NOT open folder view", () => {
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const li = makeDirectoryNode("/vault/A", false);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);

    li.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(openFVSpy).not.toHaveBeenCalled();
    expect(li.getAttribute("aria-expanded")).toBe("true");
  });

  // ── T-13 (FR-05): _folder.md file click → openFileInTab + exitLayoutView ─

  it("T-13 (FR-05): clicking a _folder.md file node → openFileInTab called + exitLayoutView called", async () => {
    const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;

    // Create a file node (type=file) whose path ends with /_folder.md.
    const li = document.createElement("li");
    li.setAttribute("data-type", "file");
    li.setAttribute("data-path", "/vault/A/_folder.md");

    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    // Build the activate handler and invoke it (simulates a click).
    const handleActivate = _testing.buildActivateHandler(li, "vault-1", false);
    handleActivate(new MouseEvent("click"));

    // openFileInTab is called synchronously (fire-and-forget void).
    expect(tabMgr.openFileInTab).toHaveBeenCalledWith("/vault/A/_folder.md");

    // exitLayoutView is called synchronously immediately after openFileInTab
    // (not in a .then()) — it ensures code view regardless of current tab state.
    expect(tabMgr.exitLayoutView).toHaveBeenCalledOnce();
  });

  // ── NFR-05: ArrowRight on hasFolderView=true → expands ────────────────────

  it("NFR-05: ArrowRight on hasFolderView=true collapsed directory → toggleDirectoryNode (expands)", () => {
    const li = makeDirectoryNode("/vault/A", false);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // ArrowRight calls toggleDirectoryNode which flips aria-expanded.
    expect(li.getAttribute("aria-expanded")).toBe("true");
  });

  // ── NFR-05: ArrowLeft on hasFolderView=true → collapses ───────────────────

  it("NFR-05: ArrowLeft on hasFolderView=true expanded directory → toggleDirectoryNode (collapses)", () => {
    const li = makeDirectoryNode("/vault/A", true);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(li.getAttribute("aria-expanded")).toBe("false");
  });
});

// ── _indexUpdatedCb — EC-06 (positive path) / EC-12 (null guard) ──────────────

describe("_indexUpdatedCb — layout-view refresh logic", () => {
  let refreshLayoutViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refreshLayoutViewSpy = vi.fn();

    // Minimal tab manager: active tab is in layout view for the target file.
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(() => Promise.resolve()),
      enterLayoutView: vi.fn(),
      exitLayoutView: vi.fn(),
      refreshLayoutView: refreshLayoutViewSpy,
      getActiveTab: vi.fn(() => ({ filePath: "/vault/A/_folder.md" })),
      isActiveTabInLayoutView: vi.fn(() => true),
    };

    // Vault manager: active vault with empty index (tree diff will be empty,
    // so renderPanel is effectively a no-op).
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => ({ id: "vault-1", rootPaths: ["/vault"] })),
      getVaultIndex: vi.fn(() => ({ entries: [], directories: [], nonMdFiles: [] })),
      onVaultChanged: vi.fn(),
      onIndexUpdated: vi.fn(),
    };

    _testing.setEnabled(true);
    _testing.setPanelContainer(null);  // no container → renderPanel no-ops
    _testing.setupVaultSubscriptions((window as any).__MARKABLE_VAULT_MANAGER__);
  });

  afterEach(() => {
    _testing.setEnabled(false);
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
  });

  // ── EC-06: positive path ──────────────────────────────────────────────────

  it("EC-06: _indexUpdatedCb with matching active tab + isInLayoutView → refreshLayoutView called", () => {
    const cb = _testing.getIndexUpdatedCb();
    expect(cb).not.toBeNull();

    cb!({ vaultId: "vault-1", eventType: "modified", path: "/vault/A/_folder.md" });

    expect(refreshLayoutViewSpy).toHaveBeenCalledOnce();
    // The argument must be a function (the render fn returned by buildFolderViewRenderFn).
    const [arg] = refreshLayoutViewSpy.mock.calls[0];
    expect(typeof arg).toBe("function");
  });

  // ── EC-12: null/undefined changedPath → early return, no throw ───────────

  it("EC-12: _indexUpdatedCb with undefined changedPath → refreshLayoutView NOT called, no throw", () => {
    const cb = _testing.getIndexUpdatedCb();
    expect(cb).not.toBeNull();

    // Simulate an event with no path field.
    expect(() => cb!({ vaultId: "vault-1", eventType: "modified", path: undefined as any })).not.toThrow();
    expect(refreshLayoutViewSpy).not.toHaveBeenCalled();
  });

  it("EC-12: _indexUpdatedCb with non-_folder.md path → refreshLayoutView NOT called", () => {
    const cb = _testing.getIndexUpdatedCb();
    expect(cb).not.toBeNull();

    cb!({ vaultId: "vault-1", eventType: "modified", path: "/vault/A/some-note.md" });

    expect(refreshLayoutViewSpy).not.toHaveBeenCalled();
  });

  it("EC-06 (negative): active tab path mismatch → refreshLayoutView NOT called", () => {
    // Active tab is a different file.
    (window as any).__MARKABLE_TAB_MANAGER__.getActiveTab.mockReturnValue({
      filePath: "/vault/B/other.md",
    });

    const cb = _testing.getIndexUpdatedCb();
    cb!({ vaultId: "vault-1", eventType: "modified", path: "/vault/A/_folder.md" });

    expect(refreshLayoutViewSpy).not.toHaveBeenCalled();
  });
});
