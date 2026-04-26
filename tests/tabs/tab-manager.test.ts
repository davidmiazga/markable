/**
 * Unit tests for src/tabs/tab-manager.ts — TabManager core state.
 *
 * Covers all tab operations defined in step_01_core_state.md:
 * - Tab creation, closure, and activation
 * - Title derivation from file paths
 * - Duplicate-path detection (EC-4)
 * - Last-tab close behavior (EC-2, EC-3)
 * - activeIndex recalculation on close (FR-5.2)
 * - Cmd-9 / out-of-range index handling (FR-5.3, EC-8, EC-9)
 * - Dirty state idempotency (FR-7)
 * - Session serialization — only tabs with filePath (FR-6.2, FR-6.3)
 * - init() session restore skipping missing files (EC-1, EC-6)
 * - init() untitled fallback when all restore files fail (FR-6.5)
 *
 * All Tauri IPC, settings helpers, and live-preview side-effects are mocked
 * so no Tauri bridge is needed. The EditorView/EditorState mocks are minimal
 * stubs that satisfy the API surface used by TabManager.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Module-level mocks (must be declared before the module under test is imported) ──

// Tauri APIs required transitively by settings.ts and webviewWindow
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

// Mock the bridge module — readFile, writeFile, saveFileDialog
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

// Mock settings helpers to avoid real Tauri invoke() calls
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

// Mock live-preview to avoid DOM-heavy imports.
// livePreviewExtension, tablePreviewField, and viewModeField are referenced by
// extensions.ts (which tab-manager.ts now imports for editableCompartment, added
// in step_07). They must be present in the mock so extensions.ts does not throw
// when it is evaluated during the test module resolution phase.
vi.mock("../../src/editor/live-preview", () => ({
  setLivePreviewFilePath: vi.fn(),
  setViewMode: { of: vi.fn(() => ({})) },
  livePreviewExtension: [],
  tablePreviewField: {},
  fencedCodePreviewField: {},
  viewModeField: {},
}));

// Mock sidebar-manager (toggleSide used in setMode for vertical mode)
vi.mock("../../src/sidebar/sidebar-manager", () => ({
  toggleSide: vi.fn(),
}));

// ── Import the module under test AFTER mocks are declared ──

import { TabManager } from "../../src/tabs/tab-manager";
import { TAB_SOFT_WARNING_THRESHOLD } from "../../src/tabs/tab-types";

import { readFile, writeFile, saveFileDialog } from "../../src/lib/bridge";
import { getCurrentSettings, updateSettings, addRecentFile } from "../../src/lib/settings";
import { setLivePreviewFilePath } from "../../src/editor/live-preview";

// Typed mock references for convenient spy access
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
// writeFile and saveFileDialog are imported for the mock but direct calls in
// saveActiveTab / saveActiveTabAs tests are deferred to step_05 integration tests.
// The casts below document the types for future test additions.
void (writeFile as ReturnType<typeof vi.fn>);
void (saveFileDialog as ReturnType<typeof vi.fn>);
const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;
const mockAddRecentFile = addRecentFile as ReturnType<typeof vi.fn>;
const mockSetLivePreviewFilePath = setLivePreviewFilePath as ReturnType<typeof vi.fn>;

// ── Minimal EditorView mock ───────────────────────────────────────────────────

/**
 * Minimal EditorView mock.
 *
 * TabManager interacts with EditorView via:
 *   - state.doc.toString() / state.doc.length — reading current doc text
 *   - dispatch({ changes, selection, effects }) — replacing doc or mode
 *   - scrollDOM.scrollTop — saving/restoring scroll position
 *
 * Tab switching uses dispatch (not setState) so extensions are preserved.
 */
function makeEditorView() {
  let doc = "";
  const scrollDOM = { scrollTop: 0 };
  const dispatchMock = vi.fn((tr: { changes?: { insert?: string } }) => {
    // Simulate doc replacement so state.doc.toString() reflects the new text.
    if (tr?.changes && typeof tr.changes === "object" && "insert" in tr.changes) {
      doc = tr.changes.insert ?? "";
    }
  });
  return {
    get state() {
      return {
        doc: { toString: () => doc, length: doc.length },
      };
    },
    dispatch: dispatchMock,
    scrollDOM,
  } as unknown as import("@codemirror/view").EditorView;
}

// ── DOM scaffold helpers ──────────────────────────────────────────────────────

/** Insert the minimum DOM elements that TabManager reads during init(). */
function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app"></div>
  `;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("TAB_SOFT_WARNING_THRESHOLD constant", () => {
  it("is 30", () => {
    expect(TAB_SOFT_WARNING_THRESHOLD).toBe(30);
  });
});

describe("TabManager — _titleFromPath (via openFileInTab)", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    manager = new TabManager();
  });

  it("returns 'Untitled' for null path", async () => {
    const view = makeEditorView();
    await manager.init(view);
    // The initial untitled tab should have title "Untitled"
    expect(manager.getActiveTab()?.title).toBe("Untitled");
  });

  it("strips path components and extension for a full path", async () => {
    const view = makeEditorView();
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.init(view);
    await manager.openFileInTab("/foo/bar/doc.md");
    expect(manager.getActiveTab()?.title).toBe("doc");
  });

  it("strips multiple extensions correctly (last dot only)", async () => {
    const view = makeEditorView();
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.init(view);
    await manager.openFileInTab("/foo/archive.tar.gz");
    expect(manager.getActiveTab()?.title).toBe("archive.tar");
  });

  it("returns bare name when no extension is present", async () => {
    const view = makeEditorView();
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.init(view);
    await manager.openFileInTab("/foo/README");
    expect(manager.getActiveTab()?.title).toBe("README");
  });
});

describe("TabManager — openNewTab", () => {
  let manager: TabManager;
  let view: ReturnType<typeof makeEditorView>;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
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

  it("creates a new untitled tab and increments count", () => {
    expect(manager.getTabCount()).toBe(1);
    manager.openNewTab();
    expect(manager.getTabCount()).toBe(2);
  });

  it("new tab is active after openNewTab", () => {
    manager.openNewTab();
    expect(manager.getActiveTab()?.title).toBe("Untitled");
    expect(manager.getActiveTab()?.isDirty).toBe(false);
  });

  it("new tab has a filePath of null (untitled)", () => {
    manager.openNewTab();
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });

  it("new tab has a unique id", () => {
    manager.openNewTab();
    const ids = manager.getTabs().map((t) => t.id);
    // Set size equals array length → all unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("calls saveSession (updateSettings) after openNewTab", () => {
    manager.openNewTab();
    // saveSession fires asynchronously but updateSettings should be scheduled
    expect(mockUpdateSettings).toHaveBeenCalled();
  });
});

describe("TabManager — openFileInTab", () => {
  let manager: TabManager;
  let view: ReturnType<typeof makeEditorView>;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
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

  it("opens a new tab and returns true on first open", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "hello" });
    const result = await manager.openFileInTab("/a/file.md");
    expect(result).toBe(true);
    expect(manager.getTabCount()).toBe(2); // untitled + new
  });

  it("activates existing tab and returns false on duplicate open (EC-4)", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "hello" });
    await manager.openFileInTab("/a/file.md");
    // Open a second tab so we can test that the first is re-activated
    manager.openNewTab();
    expect(manager.getTabCount()).toBe(3);

    const result = await manager.openFileInTab("/a/file.md");
    expect(result).toBe(false);
    expect(manager.getActiveTab()?.filePath).toBe("/a/file.md");
  });

  it("does not add a new tab on duplicate open (EC-4)", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "hello" });
    await manager.openFileInTab("/a/file.md");
    const countBefore = manager.getTabCount();
    await manager.openFileInTab("/a/file.md");
    expect(manager.getTabCount()).toBe(countBefore);
  });

  it("calls addRecentFile when a new file is opened", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/path/to/note.md");
    expect(mockAddRecentFile).toHaveBeenCalledWith("/path/to/note.md");
  });

  it("calls setLivePreviewFilePath after opening a file", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/path/to/note.md");
    expect(mockSetLivePreviewFilePath).toHaveBeenCalledWith("/path/to/note.md");
  });

  it("returns false and does not create a tab when readFile fails", async () => {
    mockReadFile.mockResolvedValue({ ok: false, error: { message: "not found" } });
    // happy-dom does not provide window.alert; install a no-op before calling
    // code that invokes it, to prevent "alert is not a function" errors.
    (window as unknown as Record<string, unknown>).alert = vi.fn();
    const countBefore = manager.getTabCount();
    const result = await manager.openFileInTab("/missing/file.md");
    expect(result).toBe(false);
    expect(manager.getTabCount()).toBe(countBefore);
    delete (window as unknown as Record<string, unknown>).alert;
  });
});

describe("TabManager — closeTab", () => {
  let manager: TabManager;
  let view: ReturnType<typeof makeEditorView>;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
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

  it("calls window close when the last tab is closed (EC-2)", async () => {
    // The mock for getCurrentWebviewWindow returns a fresh object on each call,
    // so we must capture the reference before the code under test calls it.
    // Re-configure the mock to return a stable object with a tracked close fn.
    const closeMock = vi.fn(() => Promise.resolve());
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    (getCurrentWebviewWindow as ReturnType<typeof vi.fn>).mockReturnValue({ close: closeMock });

    const id = manager.getActiveTab()!.id;
    await manager.closeTab(id);
    expect(closeMock).toHaveBeenCalled();
  });

  it("shows confirm dialog when closing the last dirty tab (EC-3)", async () => {
    // happy-dom does not define window.confirm, so we install it as a plain fn.
    const confirmMock = vi.fn().mockReturnValue(false);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    manager.markActiveTabDirty();
    const id = manager.getActiveTab()!.id;
    await manager.closeTab(id);
    expect(confirmMock).toHaveBeenCalled();
    // User cancelled: tab should still be present
    expect(manager.getTabCount()).toBe(1);

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  it("proceeds with close when user confirms dirty last tab (EC-3)", async () => {
    const closeMock = vi.fn(() => Promise.resolve());
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    (getCurrentWebviewWindow as ReturnType<typeof vi.fn>).mockReturnValue({ close: closeMock });

    // Install window.confirm that returns true (user confirms close)
    (window as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(true);

    manager.markActiveTabDirty();
    const id = manager.getActiveTab()!.id;
    await manager.closeTab(id);
    // Tab array is cleared before close(); getTabCount() returns 0
    expect(manager.getTabCount()).toBe(0);
    expect(closeMock).toHaveBeenCalled();

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  it("removes the tab when closing a non-last clean tab", async () => {
    // Need two tabs to close one without triggering window close
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/a/file.md");
    expect(manager.getTabCount()).toBe(2);

    const fileTabId = manager.getActiveTab()!.id;
    await manager.closeTab(fileTabId);
    expect(manager.getTabCount()).toBe(1);
  });

  it("shows confirm dialog for dirty non-last tab and cancels (EC-3 variant)", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/a/file.md");
    const fileTabId = manager.getActiveTab()!.id;
    manager.markActiveTabDirty();

    // Install window.confirm as happy-dom does not provide it.
    const confirmMock = vi.fn().mockReturnValue(false);
    (window as unknown as Record<string, unknown>).confirm = confirmMock;

    await manager.closeTab(fileTabId);
    expect(confirmMock).toHaveBeenCalled();
    expect(manager.getTabCount()).toBe(2); // cancel: tab survives

    delete (window as unknown as Record<string, unknown>).confirm;
  });

  it("recalculates activeIndex when closing a tab left of the active (FR-5.2)", async () => {
    // Open two more tabs: [untitled(0), file-a(1), file-b(2)]
    mockReadFile.mockResolvedValue({ ok: true, value: "x" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");

    // Activate file-b (index 2)
    expect(manager.getActiveTab()?.filePath).toBe("/b.md");

    // Close file-a (index 1, which is left of active index 2)
    const tabs = manager.getTabs();
    const fileAId = tabs.find((t) => t.filePath === "/a.md")!.id;
    await manager.closeTab(fileAId);

    // Active tab should still be /b.md (index shifted from 2 to 1)
    expect(manager.getActiveTab()?.filePath).toBe("/b.md");
  });

  it("activates the tab before the closed one when closing the active tab at end", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "x" });
    await manager.openFileInTab("/a.md");

    // Active is /a.md at index 1. Close it.
    const id = manager.getActiveTab()!.id;
    await manager.closeTab(id);

    // Should fall back to the untitled tab (index 0)
    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });

  it("ignores closeTab calls with an unknown id", async () => {
    const countBefore = manager.getTabCount();
    await manager.closeTab("nonexistent-id");
    expect(manager.getTabCount()).toBe(countBefore);
  });
});

describe("TabManager — activateTabByIndex", () => {
  let manager: TabManager;
  let view: ReturnType<typeof makeEditorView>;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    manager = new TabManager();
    view = makeEditorView();
    await manager.init(view);
    // Open two more tabs so we have 3 total: [untitled, a.md, b.md]
    mockReadFile.mockResolvedValue({ ok: true, value: "x" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");
  });

  it("activates last tab when index >= 9 (FR-5.3 Cmd-9 convention)", () => {
    manager.activateTabByIndex(9);
    expect(manager.getActiveTab()?.filePath).toBe("/b.md"); // last tab
  });

  it("activates last tab with exactly 1 tab via Cmd-9 (EC-9)", async () => {
    // Close all but the untitled tab
    const tabs = manager.getTabs();
    await manager.closeTab(tabs[2].id);
    await manager.closeTab(tabs[1].id);
    // Only untitled remains
    manager.activateTabByIndex(9);
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });

  it("is a no-op when index is out of range (EC-8)", () => {
    const activeBefore = manager.getActiveTab()?.id;
    manager.activateTabByIndex(5); // 3 tabs, one-based 5 → out of range
    expect(manager.getActiveTab()?.id).toBe(activeBefore);
  });

  it("activates tab at one-based index 1", () => {
    manager.activateTabByIndex(1);
    expect(manager.getActiveTab()?.filePath).toBeNull(); // index 0 = untitled
  });

  it("activates tab at one-based index 2", () => {
    manager.activateTabByIndex(2);
    expect(manager.getActiveTab()?.filePath).toBe("/a.md");
  });
});

describe("TabManager — markActiveTabDirty / markActiveTabClean", () => {
  let manager: TabManager;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);
  });

  it("markActiveTabDirty sets isDirty to true", () => {
    manager.markActiveTabDirty();
    expect(manager.getActiveTab()?.isDirty).toBe(true);
  });

  it("markActiveTabDirty is idempotent — calling twice changes nothing (FR-7)", () => {
    manager.markActiveTabDirty();
    const tabIdAfterFirst = manager.getActiveTab()?.id;
    manager.markActiveTabDirty(); // second call should be a no-op
    expect(manager.getActiveTab()?.isDirty).toBe(true);
    expect(manager.getActiveTab()?.id).toBe(tabIdAfterFirst);
  });

  it("markActiveTabClean sets isDirty to false", () => {
    manager.markActiveTabDirty();
    manager.markActiveTabClean();
    expect(manager.getActiveTab()?.isDirty).toBe(false);
  });

  it("markActiveTabClean is idempotent — calling on clean tab is a no-op (FR-7)", () => {
    // Tab starts clean; second call should not throw
    expect(() => manager.markActiveTabClean()).not.toThrow();
    expect(manager.getActiveTab()?.isDirty).toBe(false);
  });
});

describe("TabManager — saveSession", () => {
  let manager: TabManager;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);
  });

  it("omits untitled tabs (filePath === null) from session (FR-6.2)", async () => {
    // After init there is one untitled tab; saveSession should write openFiles: []
    await manager.saveSession();

    // Find the updateSettings call that writes openFiles
    const calls = mockUpdateSettings.mock.calls;
    const sessionCall = calls.find((call) => {
      // The updater receives a dummy settings object; call the updater to see output
      const updater = call[0] as (s: Record<string, unknown>) => Record<string, unknown>;
      const result = updater({ recentFiles: [] });
      return "openFiles" in result;
    });
    expect(sessionCall).toBeDefined();
    const updater = sessionCall![0] as (s: Record<string, unknown>) => Record<string, unknown>;
    const result = updater({ recentFiles: [] });
    expect(result.openFiles).toEqual([]); // untitled tab not persisted
  });

  it("includes tabs with a filePath in session (FR-6.3)", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });
    await manager.openFileInTab("/my/doc.md");
    vi.clearAllMocks();

    await manager.saveSession();
    const calls = mockUpdateSettings.mock.calls;
    const sessionCall = calls[0];
    const updater = sessionCall[0] as (s: Record<string, unknown>) => Record<string, unknown>;
    const result = updater({ recentFiles: [] });
    expect((result.openFiles as Array<{ filePath: string }>)[0].filePath).toBe("/my/doc.md");
  });
});

describe("TabManager — init() session restore", () => {
  it("skips files that fail readFile during restore (EC-1, EC-6)", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: "minimal",
      openFiles: [
        { filePath: "/missing/file.md", scrollTop: 0 },
      ],
      activeTabIndex: 0,
      recentFiles: [],
    });

    // readFile returns failure (file missing / no permission)
    mockReadFile.mockResolvedValue({
      ok: false,
      error: { message: "no such file" },
    });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    // All restore files failed → should fall back to one untitled tab (FR-6.5)
    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
  });

  it("falls back to an untitled tab when openFiles is empty (FR-6.5)", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: "minimal",
      openFiles: [],
      activeTabIndex: 0,
      recentFiles: [],
    });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.filePath).toBeNull();
    expect(manager.getActiveTab()?.title).toBe("Untitled");
  });

  it("restores tabs successfully when readFile succeeds", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: "minimal",
      openFiles: [
        { filePath: "/notes/a.md", scrollTop: 42 },
        { filePath: "/notes/b.md", scrollTop: 0 },
      ],
      activeTabIndex: 1,
      recentFiles: [],
    });

    mockReadFile.mockResolvedValue({ ok: true, value: "restored content" });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    expect(manager.getTabCount()).toBe(2);
    expect(manager.getTabs()[0].filePath).toBe("/notes/a.md");
    expect(manager.getTabs()[1].filePath).toBe("/notes/b.md");
  });

  it("clamps activeTabIndex to valid range (FR-6.6)", async () => {
    setupDom();
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: "minimal",
      openFiles: [{ filePath: "/a.md", scrollTop: 0 }],
      activeTabIndex: 99, // out of range
      recentFiles: [],
    });

    mockReadFile.mockResolvedValue({ ok: true, value: "content" });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    // Index 99 clamped to last valid index (0, since only one tab restored)
    expect(manager.getActiveTab()?.filePath).toBe("/a.md");
  });

  it("early-returns gracefully when #tab-strip is absent from DOM", async () => {
    // No tab-strip in DOM → init should log error and return, not throw
    document.body.innerHTML = `
      <div id="titlebar"><span id="titlebar-title"></span></div>
      <div id="app"></div>
    `;
    vi.clearAllMocks();

    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });

    const manager = new TabManager();
    const view = makeEditorView();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await manager.init(view);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("TabManager — getActiveFilePath", () => {
  it("returns null for untitled tab", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);
    expect(manager.getActiveFilePath()).toBeNull();
  });

  it("returns filePath after opening a file", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);
    mockReadFile.mockResolvedValue({ ok: true, value: "x" });
    await manager.openFileInTab("/docs/readme.md");
    expect(manager.getActiveFilePath()).toBe("/docs/readme.md");
  });
});

// ── EC-10/EC-11: setMode vertical ↔ other toggleSide interaction ───────────────
//
// EC-10: switching to vertical calls toggleSide("left") exactly once to hide
//         the left sidebar (DOM-check guard prevents double-toggle).
// EC-11: switching away from vertical calls toggleSide("left") exactly once to
//         allow the sidebar to be re-opened by the user (does NOT force-open it;
//         that is intentional per the spec — we only undo our own hide).

import { toggleSide } from "../../src/sidebar/sidebar-manager";

describe("EC-10 / EC-11: setMode vertical sidebar toggleSide interaction", () => {
  const mockToggleSide = toggleSide as ReturnType<typeof vi.fn>;

  function makeSettingsDefaults() {
    return {
      tabMode: undefined as undefined,
      openFiles: undefined as undefined,
      activeTabIndex: undefined as undefined,
      recentFiles: [] as string[],
    };
  }

  function setupDomWithSidebarLeft(sidebarVisible: boolean) {
    document.body.innerHTML = `
      <div id="titlebar"><span id="titlebar-title"></span></div>
      <div id="tab-strip"></div>
      <div id="app">
        <div id="app-row">
          <div id="sidebar-left" style="display:${sidebarVisible ? "flex" : "none"}"></div>
          <div id="editor"></div>
          <div id="sidebar-right" style="display:none"></div>
        </div>
      </div>
    `;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(makeSettingsDefaults());
    mockUpdateSettings.mockResolvedValue(undefined);
  });

  it("EC-10: setMode('vertical') calls toggleSide('left') once when sidebar is visible", async () => {
    setupDomWithSidebarLeft(true); // sidebar is open
    const manager = new TabManager();
    await manager.init(makeEditorView());

    await manager.setMode("vertical");

    expect(mockToggleSide).toHaveBeenCalledTimes(1);
    expect(mockToggleSide).toHaveBeenCalledWith("left");
  });

  it("EC-10: setMode('vertical') does NOT call toggleSide when sidebar is already hidden", async () => {
    setupDomWithSidebarLeft(false); // sidebar already closed
    const manager = new TabManager();
    await manager.init(makeEditorView());

    await manager.setMode("vertical");

    expect(mockToggleSide).not.toHaveBeenCalled();
  });

  it("EC-11: setMode from vertical to minimal calls toggleSide('left') once when sidebar was hidden by us", async () => {
    setupDomWithSidebarLeft(true); // sidebar open → vertical hides it
    const manager = new TabManager();
    await manager.init(makeEditorView());

    await manager.setMode("vertical"); // hides sidebar → toggleSide called once
    mockToggleSide.mockClear();

    // After vertical hides it, sidebar is now "none" — switching away should call toggleSide
    const sidebarEl = document.getElementById("sidebar-left")!;
    sidebarEl.style.display = "none"; // simulate what the real toggleSide would do

    await manager.setMode("minimal");

    expect(mockToggleSide).toHaveBeenCalledTimes(1);
    expect(mockToggleSide).toHaveBeenCalledWith("left");
  });

  it("EC-11: setMode from vertical to minimal does NOT call toggleSide when sidebar was already visible", async () => {
    setupDomWithSidebarLeft(false); // sidebar already hidden (user closed it manually)
    const manager = new TabManager();
    await manager.init(makeEditorView());

    await manager.setMode("vertical"); // sidebar was hidden → no toggleSide on enter
    mockToggleSide.mockClear();

    // Sidebar is still hidden → leaving vertical should not call toggleSide
    await manager.setMode("minimal");

    expect(mockToggleSide).not.toHaveBeenCalled();
  });
});
