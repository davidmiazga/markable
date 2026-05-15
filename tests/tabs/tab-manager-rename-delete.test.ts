/**
 * Tests for TabManager.handleFileRename and TabManager.closeFileByPath.
 *
 * These two methods are the wiring between the file-browser ops layer and the
 * tab-manager so that renames propagate into open tab state and deletes abort
 * when the user declines the unsaved-changes dialog.
 *
 * Mock strategy: identical to tests/tabs/tab-manager.test.ts — all Tauri IPC,
 * settings helpers, and live-preview side-effects are replaced with vi.fn()
 * stubs so no real Tauri bridge is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module-level mocks (declared before the module under test is imported) ────

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

vi.mock("../../src/editor/live-preview", () => ({
  setLivePreviewFilePath: vi.fn(),
  setViewMode: { of: vi.fn(() => ({})) },
  livePreviewExtension: [],
  tablePreviewField: {},
  fencedCodePreviewField: {},
  viewModeField: {},

}));

vi.mock("../../src/sidebar/sidebar-manager", () => ({
  toggleSide: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { TabManager } from "../../src/tabs/tab-manager";
import { getCurrentSettings, updateSettings } from "../../src/lib/settings";
import { setLivePreviewFilePath } from "../../src/editor/live-preview";

const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;
const mockSetLivePreviewFilePath = setLivePreviewFilePath as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal DOM required by TabManager.init(). */
function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app"><div id="editor"></div></div>
  `;
}

/**
 * Inject one or more fake tab entries directly into a TabManager instance
 * without going through init() or openFileInTab().
 *
 * This lets tests exercise handleFileRename / closeFileByPath in isolation
 * without restoring a real session or opening real files.
 *
 * @param tm    - The TabManager instance.
 * @param tabs  - Tab objects to inject. Must include at minimum: id, filePath,
 *               title, isDirty, kind, doc, scrollTop.
 */
function injectTabs(tm: TabManager, tabs: Array<{
  id: string;
  filePath: string | null;
  title: string;
  isDirty: boolean;
  kind?: "editor" | "media";
  doc?: string;
  scrollTop?: number;
}>): void {
  (tm as any).tabs = tabs.map((t) => ({
    kind: "editor",
    doc: "",
    scrollTop: 0,
    ...t,
  }));
  (tm as any).activeIndex = 0;
}

// ── Tests: handleFileRename ───────────────────────────────────────────────────

describe("TabManager — handleFileRename", () => {
  let tm: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    mockUpdateSettings.mockResolvedValue(undefined);
    tm = new TabManager();
  });

  it("test 1: updates filePath and title on a matching tab", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/old.md", title: "old", isDirty: false },
    ]);

    tm.handleFileRename("/vault/old.md", "/vault/new.md");

    const tabs = tm.getTabs();
    expect(tabs[0].filePath).toBe("/vault/new.md");
    // _titleFromPath strips the extension → "new"
    expect(tabs[0].title).toBe("new");
  });

  it("test 2: preserves isDirty: true on a matching tab (EC-6)", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/note.md", title: "note", isDirty: true },
    ]);

    tm.handleFileRename("/vault/note.md", "/vault/renamed.md");

    expect(tm.getTabs()[0].isDirty).toBe(true);
  });

  it("test 3: is a no-op when no tab matches oldPath", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/other.md", title: "other", isDirty: false },
    ]);

    tm.handleFileRename("/vault/nonexistent.md", "/vault/new.md");

    // Path unchanged
    expect(tm.getTabs()[0].filePath).toBe("/vault/other.md");
  });

  it("test 4: getTabs() reflects the new path after the rename", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/a.md", title: "a", isDirty: false },
    ]);

    tm.handleFileRename("/vault/a.md", "/vault/b.md");

    expect(tm.getTabs().find((t) => t.filePath === "/vault/b.md")).toBeDefined();
  });

  it("test 5: updates __MARKABLE_CURRENT_FILE__ and titlebar when the renamed tab is active", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/active.md", title: "active", isDirty: false },
    ]);
    // activeIndex = 0, so tab t1 is the active tab

    tm.handleFileRename("/vault/active.md", "/vault/renamed-active.md");

    expect(
      (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"]
    ).toBe("/vault/renamed-active.md");

    // M1: title bar must also reflect the new name immediately after rename.
    // _updateTitleBar is called inside handleFileRename when the renamed tab is active.
    const titleEl = document.getElementById("titlebar-title");
    // _titleFromPath strips the .md extension → "renamed-active"
    expect(titleEl?.textContent).toBe("renamed-active");
  });

  it("test 6: does NOT update __MARKABLE_CURRENT_FILE__ when the renamed tab is not active", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/active.md", title: "active", isDirty: false },
      { id: "t2", filePath: "/vault/background.md", title: "bg", isDirty: false },
    ]);
    // activeIndex = 0, t1 is active; t2 is background
    (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = "/vault/active.md";

    tm.handleFileRename("/vault/background.md", "/vault/bg-renamed.md");

    // The global must remain pointing at the active tab (t1), not the renamed tab (t2)
    expect(
      (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"]
    ).toBe("/vault/active.md");
  });

  it("test 5b: calls setLivePreviewFilePath when the renamed tab is active", () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/active.md", title: "active", isDirty: false },
    ]);

    tm.handleFileRename("/vault/active.md", "/vault/renamed-active.md");

    expect(mockSetLivePreviewFilePath).toHaveBeenCalledWith("/vault/renamed-active.md");
  });
});

// ── Tests: closeFileByPath ────────────────────────────────────────────────────

describe("TabManager — closeFileByPath", () => {
  let tm: TabManager;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: undefined,
      openFiles: undefined,
      activeTabIndex: undefined,
      recentFiles: [],
    });
    mockUpdateSettings.mockResolvedValue(undefined);
    // Install window.confirm as a permissive stub (user agrees by default).
    (window as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(true);
    // Install window.alert as a no-op stub (alert is called by openFileInTab on error).
    (window as unknown as Record<string, unknown>).alert = vi.fn();

    tm = new TabManager();
  });

  it("test 7: returns true immediately when no tab has the given path (EC-20)", async () => {
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/other.md", title: "other", isDirty: false },
    ]);

    const result = await tm.closeFileByPath("/vault/nonexistent.md");

    expect(result).toBe(true);
  });

  it("test 8: returns true after successfully closing a clean tab", async () => {
    // Two tabs needed so closing one does not hit the last-tab → window.close() path.
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/a.md", title: "a", isDirty: false },
      { id: "t2", filePath: "/vault/b.md", title: "b", isDirty: false },
    ]);
    // Mock window.close to prevent actual window close attempt
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    (getCurrentWebviewWindow as ReturnType<typeof vi.fn>).mockReturnValue({
      close: vi.fn(() => Promise.resolve()),
    });

    const result = await tm.closeFileByPath("/vault/a.md");

    expect(result).toBe(true);
    // Tab should be gone
    expect(tm.getTabs().some((t) => t.filePath === "/vault/a.md")).toBe(false);
  });

  it("test 9: returns false when user cancels the unsaved-changes dialog (EC-9)", async () => {
    // Override confirm to return false (user declines)
    (window as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(false);

    // Two tabs so we don't hit the last-tab window.close() branch
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/a.md", title: "a", isDirty: true },
      { id: "t2", filePath: "/vault/b.md", title: "b", isDirty: false },
    ]);

    const result = await tm.closeFileByPath("/vault/a.md");

    // User declined → method returns false (caller must abort delete)
    expect(result).toBe(false);
    // Tab must still be present
    expect(tm.getTabs().some((t) => t.filePath === "/vault/a.md")).toBe(true);
  });

  it("test 10: returns true when the tab is already gone (EC-20 race safety)", async () => {
    // Inject a tab, then close it manually before calling closeFileByPath
    injectTabs(tm, [
      { id: "t1", filePath: "/vault/a.md", title: "a", isDirty: false },
      { id: "t2", filePath: "/vault/b.md", title: "b", isDirty: false },
    ]);

    // Simulate the race: the tab is removed from the array by some other operation
    // before closeFileByPath is called for the second time.
    (tm as any).tabs = (tm as any).tabs.filter((t: any) => t.id !== "t1");

    const result = await tm.closeFileByPath("/vault/a.md");

    // No tab found → return true (safe no-op, delete can proceed)
    expect(result).toBe(true);
  });
});
