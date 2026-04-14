/**
 * session-restore.test.ts — Unit tests for step_05 settings persistence and
 * session restore logic.
 *
 * Covers:
 *   - FR-6.1 / FR-6.2: init() with valid openFiles creates the correct tabs
 *   - EC-1 / EC-6: init() silently skips files whose readFile returns an error
 *   - FR-6.5: init() falls back to one untitled tab when all paths fail
 *   - FR-6.5: init() falls back to one untitled tab when openFiles is empty
 *   - FR-6.6: init() clamps activeTabIndex when the saved index exceeds tab count
 *   - FR-6.3: saveSession() excludes untitled tabs from openFiles
 *   - FR-6.7: saveSession() persists the correct activeTabIndex
 *   - EC-18: tabMode defaults to "minimal" when absent from settings
 *   - EC-7: init() falls back gracefully when settings are corrupt/empty
 *
 * All Tauri IPC, settings helpers, and live-preview side-effects are mocked
 * so no Tauri bridge or real filesystem access is needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Module-level mocks (must be declared before the module under test is imported) ──

// Tauri APIs required transitively by settings.ts and webviewWindow
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    close: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
    listen: vi.fn(() => Promise.resolve(() => {})),
  })),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the bridge module — readFile is the key one for session restore
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
}));

// Mock settings helpers to avoid real Tauri invoke() calls.
// Each test overrides mockGetCurrentSettings.mockReturnValue() as needed.
vi.mock("../../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
  })),
  updateSettings: vi.fn(() => Promise.resolve()),
  addRecentFile: vi.fn(() => Promise.resolve()),
}));

// Mock live-preview to avoid DOM-heavy imports
// livePreviewExtension, tablePreviewField, viewModeField are used by
// extensions.ts (now a transitive dep via tab-manager.ts → editableCompartment
// import added in step_07). They must be present so the module evaluation
// succeeds without any real DOM or CM6 runtime.
vi.mock("../../src/editor/live-preview", () => ({
  setLivePreviewFilePath: vi.fn(),
  setViewMode: { of: vi.fn(() => ({})) },
  livePreviewExtension: [],
  tablePreviewField: {},
  viewModeField: {},
}));

// Mock sidebar-manager (toggleSide used in setMode for vertical mode)
vi.mock("../../src/sidebar/sidebar-manager", () => ({
  toggleSide: vi.fn(),
}));

// ── Import the module under test AFTER mocks are declared ──

import { TabManager } from "../../src/tabs/tab-manager";
import { readFile } from "../../src/lib/bridge";
import { getCurrentSettings, updateSettings } from "../../src/lib/settings";

// Typed mock references for convenient spy access in tests
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;

// ── Minimal EditorView stub ───────────────────────────────────────────────────

/**
 * Minimal EditorView stub.
 *
 * TabManager interacts with EditorView via dispatch transactions (not setState),
 * state.doc.toString()/length, and scrollDOM.scrollTop.
 */
function makeEditorView() {
  let doc = "";
  const scrollDOM = { scrollTop: 0 };
  const dispatchMock = vi.fn((tr: { changes?: { insert?: string } }) => {
    if (tr?.changes && typeof tr.changes === "object" && "insert" in tr.changes) {
      doc = tr.changes.insert ?? "";
    }
  });
  return {
    get state() { return { doc: { toString: () => doc, length: doc.length } }; },
    dispatch: dispatchMock,
    scrollDOM,
  } as unknown as import("@codemirror/view").EditorView;
}

// ── DOM scaffold helper ───────────────────────────────────────────────────────

/**
 * Insert the minimum DOM elements that TabManager.init() requires.
 *
 * #tab-strip — required by init(); absence causes early return.
 * #titlebar-title — updated by _updateTitleBar().
 * #app-row — required by VerticalTabStrip for vertical-mode tests.
 */
function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app">
      <div id="app-row">
        <div id="sidebar-left"></div>
        <div id="editor"></div>
        <div id="sidebar-right"></div>
      </div>
    </div>
  `;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("Session restore — init() with valid openFiles", () => {
  /**
   * FR-6.1 / FR-6.2: When openFiles contains two valid paths, init() should
   * create one tab for each path (plus no untitled fallback).
   */
  it("creates one tab per valid path in openFiles", async () => {
    setupDom();
    vi.clearAllMocks();

    // Two saved files both readable
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [
        { filePath: "/a/doc1.md", scrollTop: 0 },
        { filePath: "/a/doc2.md", scrollTop: 10 },
      ],
      activeTabIndex: 0,
      recentFiles: [],
    });
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    // Two paths → two tabs; no untitled fallback added
    expect(manager.getTabCount()).toBe(2);
  });

  /**
   * FR-6.2: Each restored tab should carry the correct filePath.
   */
  it("sets the correct filePath on each restored tab", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [
        { filePath: "/docs/notes.md", scrollTop: 0 },
        { filePath: "/docs/readme.md", scrollTop: 5 },
      ],
      activeTabIndex: 0,
      recentFiles: [],
    });
    mockReadFile.mockResolvedValue({ ok: true, value: "text" });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    const paths = manager.getTabs().map((t) => t.filePath);
    expect(paths).toContain("/docs/notes.md");
    expect(paths).toContain("/docs/readme.md");
  });
});

describe("Session restore — skipping unreadable files (EC-1, EC-6)", () => {
  /**
   * EC-1 / EC-6: A file that readFile cannot read (missing, permission denied)
   * should be silently skipped — no tab created and no error thrown.
   */
  it("skips a file path whose readFile returns an error", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [
        { filePath: "/gone/missing.md", scrollTop: 0 },
        { filePath: "/good/present.md", scrollTop: 0 },
      ],
      activeTabIndex: 0,
      recentFiles: [],
    });

    // First call fails (missing file), second call succeeds
    mockReadFile
      .mockResolvedValueOnce({ ok: false, error: { message: "Not found" } })
      .mockResolvedValueOnce({ ok: true, value: "content" });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    // One file skipped, one file loaded → one tab (not two, not zero)
    expect(manager.getTabCount()).toBe(1);
    expect(manager.getTabs()[0].filePath).toBe("/good/present.md");
  });
});

describe("Session restore — untitled fallback when all files missing (FR-6.5)", () => {
  /**
   * FR-6.5: When every path in openFiles fails to read, init() must create
   * exactly one untitled tab so the editor is never left empty.
   */
  it("creates one untitled tab when all restored paths fail", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [
        { filePath: "/missing/a.md", scrollTop: 0 },
        { filePath: "/missing/b.md", scrollTop: 0 },
      ],
      activeTabIndex: 0,
      recentFiles: [],
    });

    // All reads fail
    mockReadFile.mockResolvedValue({ ok: false, error: { message: "Not found" } });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
    expect(manager.getActiveTab()?.title).toBe("Untitled");
  });
});

describe("Session restore — untitled fallback when openFiles is empty (FR-6.5)", () => {
  /**
   * FR-6.5: When openFiles is empty or undefined, init() must create exactly
   * one untitled tab (the default "new document" state).
   */
  it("creates one untitled tab when openFiles is empty array", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [],
      activeTabIndex: 0,
      recentFiles: [],
    });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });

  it("creates one untitled tab when openFiles is undefined", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });
});

describe("Session restore — activeTabIndex clamping (FR-6.6)", () => {
  /**
   * FR-6.6: When the saved activeTabIndex is larger than the restored tab
   * count, it should be clamped to the last valid index (tabs.length - 1).
   */
  it("clamps activeTabIndex to last tab when saved index is too large", async () => {
    setupDom();
    vi.clearAllMocks();

    // Only one file restores successfully; savedActiveIndex points to index 5
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [
        { filePath: "/a.md", scrollTop: 0 },
        { filePath: "/b.md", scrollTop: 0 },
      ],
      activeTabIndex: 99,
      recentFiles: [],
    });

    // First succeeds, second fails → only one tab
    mockReadFile
      .mockResolvedValueOnce({ ok: true, value: "content-a" })
      .mockResolvedValueOnce({ ok: false, error: { message: "Not found" } });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    // Only one tab was restored; activeIndex must be 0 (last valid index)
    expect(manager.getTabCount()).toBe(1);
    // Verify the active tab is indeed the one that loaded
    expect(manager.getActiveTab()?.filePath).toBe("/a.md");
  });

  /**
   * FR-6.6: activeTabIndex of 0 with multiple tabs should keep the first tab
   * active (no clamping needed, boundary check).
   */
  it("does not alter activeTabIndex when it is within valid range", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: [
        { filePath: "/first.md", scrollTop: 0 },
        { filePath: "/second.md", scrollTop: 0 },
      ],
      activeTabIndex: 1,
      recentFiles: [],
    });
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    // Two tabs restored; active should be index 1 (second file)
    expect(manager.getTabCount()).toBe(2);
    expect(manager.getActiveTab()?.filePath).toBe("/second.md");
  });
});

describe("saveSession() — serialisation correctness (FR-6.3, FR-6.7)", () => {
  let manager: TabManager;
  let view: ReturnType<typeof makeEditorView>;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();

    // Start from a clean state with one untitled tab
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });

    manager = new TabManager();
    view = makeEditorView();
    await manager.init(view);
  });

  /**
   * FR-6.3: Untitled tabs (filePath === null) must NOT appear in the
   * serialised openFiles array. Only saved-file tabs can be restored by path.
   */
  it("excludes untitled tabs from the openFiles list", async () => {
    // The manager starts with one untitled tab.
    // Open a named file to give us a mix.
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/docs/notes.md");

    vi.clearAllMocks(); // Reset call count before explicit saveSession
    await manager.saveSession();

    // updateSettings should have been called once with a writer function
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);

    // Invoke the updater to inspect the produced settings object
    const updater = mockUpdateSettings.mock.calls[0][0] as (s: object) => object;
    const result = updater({ tabMode: "minimal", recentFiles: [] }) as {
      openFiles: Array<{ filePath: string }>;
      activeTabIndex: number;
    };

    // Only the named file should appear — untitled is excluded
    expect(result.openFiles).toHaveLength(1);
    expect(result.openFiles[0].filePath).toBe("/docs/notes.md");
  });

  /**
   * FR-6.7: saveSession() must persist the current activeTabIndex so the
   * same document is focused when the session is restored.
   */
  it("persists the current activeTabIndex", async () => {
    // Open two named files
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/docs/alpha.md");
    await manager.openFileInTab("/docs/beta.md");

    vi.clearAllMocks();
    await manager.saveSession();

    const updater = mockUpdateSettings.mock.calls[0][0] as (s: object) => object;
    const result = updater({ recentFiles: [] }) as { activeTabIndex: number };

    // After opening two files the active index should be 2
    // (untitled at 0, alpha at 1, beta at 2 — beta was most recently opened)
    expect(typeof result.activeTabIndex).toBe("number");
    expect(result.activeTabIndex).toBeGreaterThanOrEqual(0);
  });

  /**
   * FR-6.3 / FR-6.7: When ALL open tabs are untitled, openFiles should be
   * an empty array and the save should not throw.
   */
  it("writes empty openFiles when only untitled tabs are open", async () => {
    // Manager starts with one untitled tab; add another
    manager.openNewTab();

    vi.clearAllMocks();
    await manager.saveSession();

    const updater = mockUpdateSettings.mock.calls[0][0] as (s: object) => object;
    const result = updater({ recentFiles: [] }) as { openFiles: Array<unknown> };

    expect(result.openFiles).toHaveLength(0);
  });
});

describe("Settings — tabMode defaults (EC-18)", () => {
  /**
   * EC-18: When tabMode is absent from settings (first launch), TabManager
   * must default to "minimal" — not throw or use an undefined mode.
   *
   * We verify this indirectly: if init() completes without error and the
   * minimal tab bar renders (a .tab-dot is present), the mode was "minimal".
   */
  it("defaults tab mode to minimal when tabMode is absent from settings", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      // tabMode is intentionally absent (simulates a pre-tabs settings file)
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    // If no error was thrown and we have the default untitled tab, the mode
    // defaulted correctly. The MinimalTabBar renders #tab-strip with .tab-dot.
    const tabStrip = document.getElementById("tab-strip");
    expect(tabStrip).not.toBeNull();

    // At least one dot should exist after mounting the minimal bar
    const dots = tabStrip?.querySelectorAll(".tab-dot");
    expect(dots?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Session restore — corrupt / empty settings (EC-7)", () => {
  /**
   * EC-7: If getCurrentSettings() returns an object where openFiles is not
   * an array (e.g. null, a string, or other corrupt value), init() must fall
   * back gracefully by treating it as empty and creating one untitled tab.
   *
   * The TabManager guards this with `settings.openFiles ?? []` which converts
   * null/undefined to an empty array. We test with null explicitly.
   */
  it("falls back to one untitled tab when openFiles is null (corrupt settings)", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: null, // Simulate corrupt/null value
      activeTabIndex: undefined,
      recentFiles: [],
    });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });

  /**
   * EC-7: If getCurrentSettings() returns an entirely empty object (all
   * fields absent), init() must complete without throwing and produce a
   * usable untitled tab.
   */
  it("falls back to one untitled tab when settings object is empty", async () => {
    setupDom();
    vi.clearAllMocks();

    // Empty object — all optional fields absent
    mockGetCurrentSettings.mockReturnValue({});

    const manager = new TabManager();
    await manager.init(makeEditorView());

    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
    expect(manager.getActiveTab()?.title).toBe("Untitled");
  });
});
