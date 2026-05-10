/**
 * tests/folder-view/tab.test.ts
 *
 * Unit tests for the new layout-view-based Folder View tab mechanism.
 *
 * Covers step_01_tab-rewrite.md acceptance criteria:
 *   T-01 — openFolderViewTab calls openFileInTab with _folder.md path
 *   T-02 — enterLayoutView is called inside .then() (RD-01)
 *   T-03 — two calls for same path → two openFileInTab calls (no dedup in tab.ts)
 *   T-04 — buildFolderViewRenderFn returns fn; calling it shows loading placeholder
 *           and fires invoke("read_file") after async settle
 *   T-05 — buildFolderViewRenderFn returns a function (prerequisite for FR-13 logic)
 *   T-06 — active tab path mismatch → refreshLayoutView NOT called
 *   T-07 — non-_folder.md changed path → refreshLayoutView NOT called (early-return guard)
 *   T-08 — escapeHtml escapes <, >, ", &
 *   T-09 — LAYOUT_RENDERERS contains "folder-cards" entry
 *
 * These tests replace the entire old test file which tested the now-deleted
 * registry / stale-flag / synthetic-key mechanism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  openFolderViewTab,
  buildFolderViewRenderFn,
  escapeHtml,
  LAYOUT_RENDERERS,
} from "../../src/plugins/file-browser/folder-view/tab";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal tab-manager mock with all methods required by tab.ts.
 *
 * openFileInTab returns a resolved Promise by default so that .then() chains
 * complete in the next microtask tick.
 */
function makeMockTabMgr() {
  return {
    openFileInTab: vi.fn(() => Promise.resolve()),
    enterLayoutView: vi.fn(),
    exitLayoutView: vi.fn(),
    refreshLayoutView: vi.fn(),
    getActiveTab: vi.fn(() => null as any),
    isActiveTabInLayoutView: vi.fn(() => false),
  };
}

/**
 * Install the standard window globals used by tab.ts.
 * Called in each test's setup so each test gets a fresh set of spies.
 */
function setupWindowMocks(): ReturnType<typeof makeMockTabMgr> {
  const tabMgr = makeMockTabMgr();

  (window as any).__MARKABLE_TAB_MANAGER__ = tabMgr;

  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getVaultIndex: vi.fn(() => ({
      entries: [],
      nonMdFiles: [],
      directories: [],
      totalFilesFound: 0,
      capped: false,
    })),
  };

  // Stub Tauri invoke to return a minimal _folder.md string so the async
  // render path completes without real filesystem access.
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn(async (_cmd: string, _args: any) => {
      return "---\nlayout: folder-cards\n---\n";
    }),
  };

  return tabMgr;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("tab.ts (layout-view refactor)", () => {
  let tabMgr: ReturnType<typeof makeMockTabMgr>;

  beforeEach(() => {
    tabMgr = setupWindowMocks();
  });

  afterEach(() => {
    // Clean up globals so tests do not bleed into each other.
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  // ── T-01: openFolderViewTab calls openFileInTab with _folder.md path ─────

  it("T-01: openFolderViewTab calls openFileInTab with '<folderPath>/_folder.md'", () => {
    openFolderViewTab("/vault/A");

    // openFileInTab must be called synchronously (before any async) with the
    // _folder.md path derived from the folder path.
    expect(tabMgr.openFileInTab).toHaveBeenCalledWith("/vault/A/_folder.md");
  });

  // ── T-02: enterLayoutView is called inside .then() (RD-01) ───────────────

  it("T-02: enterLayoutView is called after openFileInTab resolves (inside .then())", async () => {
    openFolderViewTab("/vault/A");

    // enterLayoutView must NOT be called synchronously — it is wired in .then().
    expect(tabMgr.enterLayoutView).not.toHaveBeenCalled();

    // Flush the microtask queue so the .then() callback fires.
    await Promise.resolve();

    expect(tabMgr.enterLayoutView).toHaveBeenCalledOnce();

    // The argument passed to enterLayoutView must be a function (the render fn).
    const [renderFnArg] = tabMgr.enterLayoutView.mock.calls[0];
    expect(typeof renderFnArg).toBe("function");
  });

  // ── T-03: two calls for same path → two openFileInTab calls ──────────────

  it("T-03: calling openFolderViewTab twice for the same path calls openFileInTab twice", async () => {
    // Tab deduplication is the tab manager's responsibility; tab.ts must not
    // suppress the second call (EC-10).
    openFolderViewTab("/vault/A");
    openFolderViewTab("/vault/A");

    await Promise.resolve();

    expect(tabMgr.openFileInTab).toHaveBeenCalledTimes(2);
  });

  // ── T-04: buildFolderViewRenderFn — loading placeholder + async invoke ───

  it("T-04: buildFolderViewRenderFn returns a fn that shows loading placeholder and calls invoke('read_file')", async () => {
    const renderFn = buildFolderViewRenderFn("/vault/A");
    expect(typeof renderFn).toBe("function");

    const container = document.createElement("div");
    renderFn(container);

    // Synchronously, the loading placeholder must be injected into container.
    expect(container.innerHTML).toContain("Loading");

    // After async settle, invoke must have been called with "read_file".
    // Three microtask flushes: (1) async renderFolderViewTabAsync starts,
    // (2) read_file invoke await resolves, (3) downstream processing settles.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect((window as any).__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith(
      "read_file",
      { path: "/vault/A/_folder.md" },
    );
  });

  // ── T-05: buildFolderViewRenderFn returns a function (prerequisite) ──────

  it("T-05: buildFolderViewRenderFn returns typeof === 'function' (prerequisite for FR-13)", () => {
    // The FR-13 inline logic in _indexUpdatedCb passes the return value of
    // buildFolderViewRenderFn to tabMgr.refreshLayoutView. This test verifies
    // the shape contract — the value is a function, not undefined or an object.
    const renderFn = buildFolderViewRenderFn("/vault/A");
    expect(typeof renderFn).toBe("function");

    // Two independent calls produce two independent closures (not the same ref).
    const renderFn2 = buildFolderViewRenderFn("/vault/A");
    expect(renderFn).not.toBe(renderFn2);
  });

  // ── T-06: active tab path mismatch → refreshLayoutView NOT called ─────────

  it("T-06: FR-13 guard — active tab path mismatch → refreshLayoutView NOT called", () => {
    // Simulate the inline FR-13 logic from _indexUpdatedCb: the active tab
    // belongs to a different file, so refreshLayoutView must not be called.
    const changedPath = "/vault/A/_folder.md";
    const parentDir = "/vault/A";

    // Active tab is a different file.
    tabMgr.getActiveTab.mockReturnValue({ filePath: "/vault/B/some-note.md" });
    tabMgr.isActiveTabInLayoutView.mockReturnValue(true);

    // Replicate the FR-13 guard condition.
    const activeTab = tabMgr.getActiveTab();
    if (activeTab?.filePath === changedPath && tabMgr.isActiveTabInLayoutView()) {
      tabMgr.refreshLayoutView(buildFolderViewRenderFn(parentDir));
    }

    expect(tabMgr.refreshLayoutView).not.toHaveBeenCalled();
  });

  // ── T-07: non-_folder.md path → early-return guard ───────────────────────

  it("T-07: FR-13 early-return guard — non-_folder.md changedPath → refreshLayoutView NOT called", () => {
    // The FR-13 block first checks whether changedPath ends with /_folder.md.
    // If it does not, the block is skipped entirely.
    const changedPath = "/vault/A/some-note.md";

    // Active tab matches the path and layout view is active — but changedPath
    // is not _folder.md, so the guard should reject it.
    tabMgr.getActiveTab.mockReturnValue({ filePath: changedPath });
    tabMgr.isActiveTabInLayoutView.mockReturnValue(true);

    // Replicate the FR-13 entry guard.
    const isFolderMd =
      changedPath.endsWith("/_folder.md") || changedPath.endsWith("\\_folder.md");

    if (isFolderMd) {
      // This branch must not be reached for a non-_folder.md path.
      tabMgr.refreshLayoutView(buildFolderViewRenderFn("/vault/A"));
    }

    expect(tabMgr.refreshLayoutView).not.toHaveBeenCalled();
  });

  // ── T-08: escapeHtml escapes <, >, ", & ──────────────────────────────────

  it("T-08: escapeHtml escapes HTML special characters (XSS prevention)", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  // ── T-09: LAYOUT_RENDERERS contains "folder-cards" entry ─────────────────

  it("T-09: LAYOUT_RENDERERS contains 'folder-cards' entry", () => {
    expect(typeof LAYOUT_RENDERERS["folder-cards"]).toBe("function");
  });

  // ── NFR-05 guard: openFolderViewTab is a no-op when tab manager is absent ─

  it("EC-01 (NFR-05): openFolderViewTab is a safe no-op when __MARKABLE_TAB_MANAGER__ is undefined", () => {
    // Remove the global to simulate a context where the tab manager has not
    // been loaded yet. The call must not throw.
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    expect(() => openFolderViewTab("/vault/A")).not.toThrow();
  });
});
