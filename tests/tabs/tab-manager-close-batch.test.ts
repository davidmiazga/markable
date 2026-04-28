/**
 * tests/tabs/tab-manager-close-batch.test.ts
 *
 * Unit tests for the batch-close methods added to TabManager:
 *   - closeOtherTabs(id)
 *   - closeAllTabs()
 *
 * These methods are covered by NFR-4 in docs/specs/tab-context-menu/00_index.md.
 * The test plan is defined in docs/specs/tab-context-menu/step_06_tests.md.
 *
 * All Tauri IPC, settings helpers, and live-preview side-effects are mocked so
 * no Tauri bridge is needed. State is injected via a type-assertion helper
 * (the same pattern used by existing tab-manager tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Module-level mocks (must be declared before the module under test) ──

// Mock Tauri webview window so window.close() is testable.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    close: vi.fn(() => Promise.resolve()),
  })),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the bridge module to prevent real IPC calls.
vi.mock("../../src/lib/bridge", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  saveFileDialog: vi.fn(),
  openFileDialog: vi.fn(),
  saveHtmlDialog: vi.fn(),
  updateRecentFilesMenu: vi.fn(() => Promise.resolve()),
  listThemes: vi.fn(),
  readThemeCss: vi.fn(),
  updateThemeMenu: vi.fn(() => Promise.resolve()),
  copyCorePlugins: vi.fn(),
  readResourceFile: vi.fn(),
  revealInFinder: vi.fn(),
}));

// Mock settings helpers — vault presence is controlled per test via mockReturnValue.
vi.mock("../../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
    activeVaultId: undefined,
    vaults: [],
  })),
  updateSettings: vi.fn(() => Promise.resolve()),
  addRecentFile: vi.fn(() => Promise.resolve()),
}));

// Mock live-preview to avoid DOM-heavy imports.
vi.mock("../../src/editor/live-preview", () => ({
  setLivePreviewFilePath: vi.fn(),
  setViewMode: { of: vi.fn(() => ({})) },
  livePreviewExtension: [],
  tablePreviewField: {},
  fencedCodePreviewField: {},
  viewModeField: {},
}));

// Mock sidebar-manager.
vi.mock("../../src/sidebar/sidebar-manager", () => ({
  toggleSide: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { TabManager } from "../../src/tabs/tab-manager";
import type { TabEntry, ITabRenderer } from "../../src/tabs/tab-types";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentSettings } from "../../src/lib/settings";

const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockGetCurrentWebviewWindow = getCurrentWebviewWindow as ReturnType<typeof vi.fn>;

// ── Helper: inject tab state directly into a fresh TabManager ─────────────────

/**
 * Builds a pre-populated TabManager whose internal state is set via type
 * assertion (test-only pattern). The renderer and editorView are nulled so
 * the manager can be exercised without a real DOM.
 *
 * @param tabCount    Number of tabs to pre-populate.
 * @param dirtyFlags  Per-tab dirty state; defaults to all-false when omitted.
 * @returns A TabManager with tabs[0..tabCount-1] and activeIndex=0.
 */
function makeManager(tabCount: number, dirtyFlags?: boolean[]): TabManager {
  const mgr = new TabManager();

  // Access private state via type assertion — this is the established pattern
  // in the existing tests (tests/tabs/tab-manager.test.ts).
  const state = mgr as unknown as {
    tabs: TabEntry[];
    activeIndex: number;
    editorView: unknown;
    renderer: ITabRenderer | null;
    editorContainer: HTMLElement | null;
    mediaViewerEl: HTMLElement | null;
  };

  state.editorView = null;
  state.renderer = null;
  state.editorContainer = null;
  state.mediaViewerEl = null;

  // Build synthetic tabs. Tab-0 is untitled; tab-N (N>0) has a path.
  state.tabs = Array.from({ length: tabCount }, (_, i) => ({
    id: `tab-${i}`,
    kind: "editor" as const,
    filePath: i === 0 ? null : `/path/to/file${i}.md`,
    title: i === 0 ? "Untitled" : `file${i}`,
    isDirty: dirtyFlags?.[i] ?? false,
    doc: "",
    scrollTop: 0,
  }));

  state.activeIndex = 0;
  return mgr;
}

/**
 * Configures the getCurrentSettings mock to report an active vault so that
 * the no-vault window.close() branch is NOT triggered.
 */
function mockActiveVault(): void {
  mockGetCurrentSettings.mockReturnValue({
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
    activeVaultId: "vault-1",
    vaults: [{ id: "vault-1", path: "/vault" }],
  });
}

/**
 * Configures the getCurrentSettings mock to report no active vault so that
 * the window.close() branch IS triggered when the last tab closes.
 */
function mockNoVault(): void {
  mockGetCurrentSettings.mockReturnValue({
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
    activeVaultId: undefined,
    vaults: [],
  });
}

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Provide a basic DOM so _applyActiveTab() does not throw on null querySelector.
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app"></div>
  `;

  // Default: no active vault (safest baseline; override per test when needed).
  mockNoVault();
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ── closeOtherTabs tests ───────────────────────────────────────────────────────

describe("TabManager.closeOtherTabs", () => {

  /**
   * TCO-01: No-op when only one tab is open.
   *
   * When there are no "other" tabs, the loop body never executes,
   * and the single tab is left intact.
   *
   * happy-dom does not define window.confirm, so we install a mock and verify
   * it is never called. We delete it afterwards to avoid leaking state.
   */
  it("TCO-01: is a no-op when only one tab is open", async () => {
    const mgr = makeManager(1);
    const confirmMock = vi.fn();
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await mgr.closeOtherTabs("tab-0");

    expect(mgr.getTabCount()).toBe(1);
    // No confirm dialogs should have been shown — there are no other tabs.
    expect(confirmMock).not.toHaveBeenCalled();

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  /**
   * TCO-02: All other clean tabs are closed, leaving only the target.
   */
  it("TCO-02: closes all other clean tabs, leaving only the target tab", async () => {
    const mgr = makeManager(3); // tab-0, tab-1, tab-2 (all clean)

    await mgr.closeOtherTabs("tab-0");

    expect(mgr.getTabCount()).toBe(1);
    expect(mgr.getActiveTab()?.id).toBe("tab-0");
  });

  /**
   * TCO-03: The target tab is never closed even when it is not tab-0.
   */
  it("TCO-03: does not close the target tab when target is not tab-0", async () => {
    const mgr = makeManager(3); // tab-0, tab-1, tab-2 (all clean)

    await mgr.closeOtherTabs("tab-1");

    expect(mgr.getTabCount()).toBe(1);
    expect(mgr.getActiveTab()?.id).toBe("tab-1");
  });

  /**
   * TCO-04: Dirty "other" tabs each receive their own confirm dialog.
   * When the user confirms all, all other tabs are closed.
   *
   * happy-dom does not define window.confirm, so we install it manually.
   */
  it("TCO-04: confirms each dirty tab independently — user confirms all", async () => {
    // tab-0 is kept; tab-1 and tab-2 are dirty "others".
    const mgr = makeManager(3, [false, true, true]);
    const confirmMock = vi.fn().mockReturnValue(true);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await mgr.closeOtherTabs("tab-0");

    // Two confirm dialogs should have been shown (one per dirty tab).
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(mgr.getTabCount()).toBe(1);
    expect(mgr.getActiveTab()?.id).toBe("tab-0");

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  /**
   * TCO-05: Cancelling one dirty tab's dialog leaves that tab open but
   * does not prevent other tabs from being evaluated.
   *
   * Setup: tab-1 is dirty (confirm returns false on first call), tab-2 is clean.
   * Expected: tab-0 (target) + tab-1 (cancel) survive; tab-2 is closed.
   *
   * happy-dom does not define window.confirm, so we install it manually.
   */
  it("TCO-05: cancelled dirty tab survives; remaining tabs are still processed", async () => {
    const mgr = makeManager(3, [false, true, false]); // tab-1 is dirty
    // First confirm call (for tab-1) returns false; no other confirms needed.
    const confirmMock = vi.fn().mockReturnValue(false);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await mgr.closeOtherTabs("tab-0");

    // tab-0 (target) and tab-1 (dirty, cancelled) survive.
    // tab-2 (clean) was closed without a dialog.
    expect(mgr.getTabCount()).toBe(2);

    const remaining = mgr.getTabs().map((t) => t.id);
    expect(remaining).toContain("tab-0");
    expect(remaining).toContain("tab-1");
    expect(remaining).not.toContain("tab-2");

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  /**
   * TCO-06: After close, the target tab becomes the active tab.
   *
   * Even if the target was already the only survivor, activateTab(id) must be
   * called so the active index is correctly set to the surviving tab.
   */
  it("TCO-06: target tab becomes active after other tabs are closed", async () => {
    const mgr = makeManager(3); // tab-0, tab-1, tab-2 (all clean)

    // Make tab-2 the active tab before calling closeOtherTabs.
    const state = mgr as unknown as { activeIndex: number };
    state.activeIndex = 2;

    await mgr.closeOtherTabs("tab-2");

    expect(mgr.getActiveTab()?.id).toBe("tab-2");
  });

  /**
   * TCO-07: Target tab is not currently active — it becomes active after close.
   */
  it("TCO-07: non-active target tab becomes active after other tabs are closed", async () => {
    const mgr = makeManager(3); // tab-0 is active, all clean

    await mgr.closeOtherTabs("tab-1");

    expect(mgr.getTabCount()).toBe(1);
    expect(mgr.getActiveTab()?.id).toBe("tab-1");
  });

  /**
   * TCO-08: Renderer is notified after closeOtherTabs — common-case regression guard.
   *
   * This test covers the bug described in the code review: when the right-clicked
   * tab was already the active tab (the most common case), the old code called
   * activateTab(id) which has an early-return guard (`if (idx === this.activeIndex)
   * return`). That guard caused activateTab to return before calling
   * _notifyRenderer(), leaving all three tab-bar renderers displaying stale DOM.
   *
   * The fix bypasses activateTab() and calls _notifyRenderer() directly, so this
   * test asserts that the renderer's update() method is called with an array
   * containing only the surviving (middle) tab.
   */
  it("TCO-08: renderer is notified with updated tabs array after closeOtherTabs", async () => {
    const mgr = makeManager(3); // tab-0, tab-1, tab-2 (all clean)

    // Build a mock renderer that satisfies ITabRenderer.
    // We record every update() call so we can assert the correct tabs were passed.
    const updateCalls: Array<{ tabs: TabEntry[]; activeIndex: number }> = [];
    const mockRenderer: ITabRenderer = {
      mount: vi.fn(),
      update: vi.fn((tabs: TabEntry[], activeIndex: number) => {
        // Record a snapshot of the tabs array (shallow copy) so we can assert
        // on its contents without it being mutated by later operations.
        updateCalls.push({ tabs: [...tabs], activeIndex });
      }),
      destroy: vi.fn(),
    };

    // Attach the mock renderer AND tabStripEl via type assertion.
    // makeManager() bypasses init(), so tabStripEl is null by default.
    // _notifyRenderer() has a guard: `if (!this.renderer || !this.tabStripEl) return`.
    // Without injecting tabStripEl, the guard fires and update() is never reached,
    // which would make this test a vacuous no-op even when the bug is present.
    // The beforeEach already adds #tab-strip to document.body, so we just look it up.
    const state = mgr as unknown as {
      renderer: ITabRenderer | null;
      tabStripEl: HTMLElement | null;
    };
    state.renderer = mockRenderer;
    state.tabStripEl = document.getElementById("tab-strip");

    // Right-click the middle tab (tab-1) and choose "Close Other Tabs".
    // tab-1 is NOT the active tab (activeIndex is 0), which is the "common case"
    // that revealed the bug: after the splice loop the target ends up at index 0
    // (the same position the active index already tracked), so the old code's
    // activateTab() guard fired and _notifyRenderer() was never reached.
    await mgr.closeOtherTabs("tab-1");

    // The renderer must have been called at least once with the surviving-tabs array.
    expect(mockRenderer.update).toHaveBeenCalled();

    // Find the final update call — the one that reflects the post-close state.
    const lastCall = updateCalls[updateCalls.length - 1];
    expect(lastCall).toBeDefined();

    // Only tab-1 should survive.
    expect(lastCall.tabs).toHaveLength(1);
    expect(lastCall.tabs[0].id).toBe("tab-1");
  });

});

// ── closeAllTabs tests ─────────────────────────────────────────────────────────

describe("TabManager.closeAllTabs", () => {

  /**
   * TCA-01: No-op when the tabs array is already empty.
   *
   * Defensive guard at the top of closeAllTabs().
   */
  it("TCA-01: is a no-op when there are no tabs open", async () => {
    const mgr = makeManager(0);
    const closeSpy = vi.fn(() => Promise.resolve());
    mockGetCurrentWebviewWindow.mockReturnValue({ close: closeSpy });

    await expect(mgr.closeAllTabs()).resolves.toBeUndefined();

    expect(mgr.getTabCount()).toBe(0);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  /**
   * TCA-02: All clean tabs, no active vault — window.close() is called.
   */
  it("TCA-02: calls window.close() when all clean tabs close and no vault is active", async () => {
    mockNoVault();
    const closeSpy = vi.fn(() => Promise.resolve());
    mockGetCurrentWebviewWindow.mockReturnValue({ close: closeSpy });

    const mgr = makeManager(2); // two clean tabs

    await mgr.closeAllTabs();

    expect(closeSpy).toHaveBeenCalledOnce();
  });

  /**
   * TCA-03: All clean tabs, active vault — stays at 0 tabs, no window close.
   */
  it("TCA-03: stays at 0 tabs when vault is active, does not close window", async () => {
    mockActiveVault();
    const closeSpy = vi.fn(() => Promise.resolve());
    mockGetCurrentWebviewWindow.mockReturnValue({ close: closeSpy });

    const mgr = makeManager(2); // two clean tabs

    await mgr.closeAllTabs();

    expect(mgr.getTabCount()).toBe(0);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  /**
   * TCA-04: All dirty tabs, user confirms all — all tabs are closed.
   *
   * happy-dom does not define window.confirm, so we install it manually.
   */
  it("TCA-04: closes all tabs when all are dirty and user confirms each", async () => {
    mockActiveVault(); // prevents window.close() so we can assert count
    const mgr = makeManager(2, [true, true]); // two dirty tabs
    const confirmMock = vi.fn().mockReturnValue(true);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await mgr.closeAllTabs();

    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(mgr.getTabCount()).toBe(0);

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  /**
   * TCA-05: All dirty tabs, user cancels all — nothing is closed.
   *
   * happy-dom does not define window.confirm, so we install it manually.
   */
  it("TCA-05: closes nothing when all tabs are dirty and user cancels each", async () => {
    const mgr = makeManager(2, [true, true]); // two dirty tabs
    const confirmMock = vi.fn().mockReturnValue(false);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await mgr.closeAllTabs();

    expect(confirmMock).toHaveBeenCalledTimes(2);
    // All tabs survive because every confirm was cancelled.
    expect(mgr.getTabCount()).toBe(2);

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  /**
   * TCA-06: Mixed dirty/clean — user cancels dirty tab; clean tabs are closed.
   *
   * Setup: tab-0 clean, tab-1 dirty (cancel), tab-2 clean.
   * Expected: only tab-1 survives.
   *
   * happy-dom does not define window.confirm, so we install it manually.
   */
  it("TCA-06: dirty tab whose confirm is cancelled survives while clean tabs close", async () => {
    mockActiveVault();
    // tab-0 clean, tab-1 dirty, tab-2 clean
    const mgr = makeManager(3, [false, true, false]);
    // First (and only) confirm dialog is for tab-1; user cancels.
    const confirmMock = vi.fn().mockReturnValue(false);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await mgr.closeAllTabs();

    expect(mgr.getTabCount()).toBe(1);
    expect(mgr.getActiveTab()?.id).toBe("tab-1");

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  /**
   * TCA-07: Snapshot pattern — all 5 clean tabs close correctly.
   *
   * A naïve implementation that closes by live index would skip every other tab
   * as the array shrinks. 5 clean tabs all closing is the proof the snapshot
   * pattern works.
   */
  it("TCA-07: snapshot pattern closes all 5 clean tabs without skipping any", async () => {
    mockActiveVault();
    const mgr = makeManager(5); // five clean tabs

    await mgr.closeAllTabs();

    expect(mgr.getTabCount()).toBe(0);
  });

  /**
   * TCA-08: saveSession is called exactly once (not per-tab).
   *
   * When the vault is active, saveSession must be called exactly once
   * after all removals are applied, not once per closed tab.
   */
  it("TCA-08: saveSession is called exactly once", async () => {
    mockActiveVault();
    const mgr = makeManager(2); // two clean tabs

    // Spy on saveSession. mockResolvedValue prevents real IPC calls.
    const saveSpy = vi
      .spyOn(mgr, "saveSession")
      .mockResolvedValue(undefined);

    await mgr.closeAllTabs();

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

});
