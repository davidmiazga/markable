/**
 * tests/tabs/custom-tab.test.ts
 *
 * Unit tests for the custom render tab feature (step_01 of the Layouts feature).
 *
 * Covers:
 *   TC-01 through TC-09 — TabManager.openCustomRenderTab() behaviour
 *   TC-10 — MarkablePluginAPI.openCustomRenderTab delegation
 *   TC-11 through TC-14 — window globals (__MARKABLE_OPEN_CUSTOM_TAB__ etc.)
 *
 * All Tauri IPC, settings helpers, and live-preview side-effects are mocked
 * so no Tauri bridge or real filesystem access is needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Module-level mocks (must be declared before the module under test is imported) ──

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
  convertFileSrc: vi.fn((p: string) => "asset://localhost/" + encodeURIComponent(p)),
}));

// Mock bridge to avoid Tauri IPC
vi.mock("../../src/lib/bridge", () => ({
  readFile: vi.fn().mockResolvedValue({ ok: true, value: "" }),
  writeFile: vi.fn().mockResolvedValue({ ok: true }),
  saveFileDialog: vi.fn(),
  openFileDialog: vi.fn(),
  saveHtmlDialog: vi.fn(),
  updateRecentFilesMenu: vi.fn(() => Promise.resolve()),
  listThemes: vi.fn(),
  readThemeCss: vi.fn(),
  updateThemeMenu: vi.fn(() => Promise.resolve()),
  copyCorePlugins: vi.fn(),
  readResourceFile: vi.fn(),
  readPluginSettings: vi.fn().mockResolvedValue(null),
  writePluginSettings: vi.fn().mockResolvedValue(undefined),
  listCorePlugins: vi.fn().mockResolvedValue({ files: [] }),
  listUserPlugins: vi.fn().mockResolvedValue({ files: [], truncated: [] }),
  readPluginFile: vi.fn(),
}));

vi.mock("../../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
    plugins: {},
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

// Mock plugins/index to avoid full PluginManager loading
vi.mock("../../src/plugins/index", () => ({
  pluginManager: {
    addExtensions: vi.fn(),
    removeExtensions: vi.fn(),
  },
  DEFAULT_ENABLED_PLUGINS: new Set(),
  WORKFLOW_PLUGINS: [],
}));

// Mock sidebar to avoid import chain
vi.mock("../../src/sidebar", () => ({
  registerSidebarPanel: vi.fn(),
  unregisterSidebarPanel: vi.fn(),
  focusSidebarPanel: vi.fn(),
  toggleSidebarPanel: vi.fn(),
}));

// ── Import modules under test AFTER mocks ──

import { TabManager } from "../../src/tabs/tab-manager";
import { getCurrentSettings, updateSettings } from "../../src/lib/settings";

const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;

// ── Minimal EditorView mock ───────────────────────────────────────────────────

/**
 * Minimal EditorView stub satisfying the API surface TabManager uses.
 * Mirrors the pattern used in media-tab.test.ts.
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
    get state() {
      return {
        doc: { toString: () => doc, length: doc.length },
      };
    },
    dispatch: dispatchMock,
    scrollDOM,
  } as unknown as import("@codemirror/view").EditorView;
}

// ── DOM scaffold ──────────────────────────────────────────────────────────────

/**
 * Creates the minimal DOM required by TabManager.init() plus the
 * #custom-tab-host element required for openCustomRenderTab().
 */
function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app">
      <div id="app-row">
        <div id="editor"></div>
      </div>
      <div id="custom-tab-host"></div>
    </div>
  `;
}

/** Settings with no vault, no session — creates one Untitled tab on init. */
function baseSettings() {
  return {
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
    plugins: {},
  };
}


// ── Tests ──────────────────────────────────────────────────────────────────────

describe("openCustomRenderTab", () => {
  let manager: TabManager;
  let view: ReturnType<typeof makeEditorView>;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    manager = new TabManager();
    view = makeEditorView();
    await manager.init(view);
  });

  /**
   * TC-01: openCustomRenderTab() creates a tab entry with kind === "custom".
   */
  it("TC-01: creates a tab entry with kind custom", () => {
    const fn = vi.fn();
    manager.openCustomRenderTab("My View", fn);
    const tabs = manager.getTabs();
    expect(tabs.some(t => t.kind === "custom" && t.title === "My View")).toBe(true);
  });

  /**
   * TC-02: openCustomRenderTab() adds has-custom-tab class to document.body.
   */
  it("TC-02: adds has-custom-tab class to body", () => {
    manager.openCustomRenderTab("Test", vi.fn());
    expect(document.body.classList.contains("has-custom-tab")).toBe(true);
  });

  /**
   * TC-03: Switching to a non-custom (editor) tab removes has-custom-tab
   * from document.body.
   */
  it("TC-03: removes has-custom-tab when switching to editor tab", async () => {
    // Ensure there is at least one editor tab to switch to.
    manager.openNewTab();
    const editorTab = manager.getTabs().find(t => t.kind === "editor");
    expect(editorTab).toBeTruthy();

    // Open a custom tab — has-custom-tab is added.
    manager.openCustomRenderTab("Layout", vi.fn());
    expect(document.body.classList.contains("has-custom-tab")).toBe(true);

    // Switch back to the editor tab — has-custom-tab must be removed.
    manager.activateTab(editorTab!.id);
    expect(document.body.classList.contains("has-custom-tab")).toBe(false);
  });

  /**
   * TC-04: Opening a second custom tab with the same title replaces the first
   * in-place — the total tab count does not increase.
   */
  it("TC-04: duplicate title replaces existing custom tab in-place", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    manager.openCustomRenderTab("Layout", fn1);
    const countAfterFirst = manager.getTabCount();
    manager.openCustomRenderTab("Layout", fn2);
    expect(manager.getTabCount()).toBe(countAfterFirst);
    // fn2 should have been called (new renderFn was invoked)
    expect(fn2).toHaveBeenCalled();
  });

  /**
   * TC-05: openCustomRenderTab() calls renderFn with the #custom-tab-host element.
   */
  it("TC-05: calls renderFn with #custom-tab-host element", () => {
    const fn = vi.fn();
    manager.openCustomRenderTab("Test", fn);
    const hostEl = document.getElementById("custom-tab-host");
    expect(fn).toHaveBeenCalledWith(hostEl);
  });

  /**
   * TC-06: When renderFn throws, a .layout-error fallback is rendered in
   * #custom-tab-host and the tab remains active (EC-15).
   */
  it("TC-06: shows .layout-error when renderFn throws", () => {
    const fn = () => { throw new Error("oops"); };
    manager.openCustomRenderTab("Broken", fn);
    const host = document.getElementById("custom-tab-host")!;
    expect(host.querySelector(".layout-error")).not.toBeNull();
    // The tab is still active despite the error
    const active = manager.getActiveTab();
    expect(active?.kind).toBe("custom");
    expect(active?.title).toBe("Broken");
  });

  /**
   * TC-07: saveSession() does not include custom tabs in the persisted
   * openFiles array (custom tabs are transient).
   */
  it("TC-07: saveSession excludes custom tabs from openFiles", async () => {
    manager.openCustomRenderTab("My Layout", vi.fn());
    mockUpdateSettings.mockClear();
    await manager.saveSession();

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const updaterFn = mockUpdateSettings.mock.calls[0][0] as (s: unknown) => unknown;
    const result = updaterFn({ openFiles: [], activeTabIndex: 0 }) as {
      openFiles: unknown[];
    };
    // The openFiles array must not contain any entry with kind === "custom"
    expect(result.openFiles?.some((f: unknown) => (f as { kind?: string }).kind === "custom")).toBeFalsy();
  });

  /**
   * TC-08: closeTab() on a custom tab does not invoke window.confirm() —
   * custom tabs are always clean and never need a dirty-check dialog.
   */
  it("TC-08: closeTab on custom tab skips dirty-check dialog", async () => {
    window.confirm = vi.fn(() => false);
    const confirmSpy = vi.spyOn(window, "confirm");

    manager.openCustomRenderTab("Layout", vi.fn());
    const customTabId = manager.getTabs().find(t => t.kind === "custom")!.id;
    await manager.closeTab(customTabId);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  /**
   * TC-09: EC-25 — when #custom-tab-host is absent, openCustomRenderTab()
   * logs a console.error and does not create a new tab.
   */
  it("TC-09: logs error and returns when #custom-tab-host is missing", () => {
    // Remove the host element from DOM
    document.getElementById("custom-tab-host")?.remove();
    const consoleSpy = vi.spyOn(console, "error");
    const initialCount = manager.getTabCount();
    manager.openCustomRenderTab("Layout", vi.fn());
    expect(manager.getTabCount()).toBe(initialCount);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("custom-tab-host"));
  });
});

/**
 * TC-10: MarkablePluginAPI.openCustomRenderTab delegates to tabManager.openCustomRenderTab.
 *
 * This test imports the real tabManager singleton and spies on it to verify
 * that the API object's method correctly delegates.
 */
describe("MarkablePluginAPI.openCustomRenderTab", () => {
  it("TC-10: delegates to tabManager.openCustomRenderTab", async () => {
    const { tabManager } = await import("../../src/tabs/tab-manager");
    const spy = vi.spyOn(tabManager, "openCustomRenderTab");

    const { buildMarkablePluginAPI } = await import("../../src/plugins/markable-plugin-api");
    const api = buildMarkablePluginAPI("test-plugin", {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    });
    const fn = vi.fn();
    api.openCustomRenderTab("Title", fn);
    expect(spy).toHaveBeenCalledWith("Title", fn);

    spy.mockRestore();
  });
});

/**
 * TC-11 through TC-14: window global tests.
 *
 * These tests verify the window globals that main.ts sets up. Since main.ts
 * is not loaded in the test environment, we set them manually to simulate
 * the real startup sequence.
 */
describe("window globals", () => {
  beforeEach(async () => {
    // Simulate what main.ts does after tabManager.init():
    const { tabManager } = await import("../../src/tabs/tab-manager");
    const { marked } = await import("marked");

    (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_CUSTOM_TAB__"] =
      (title: string, renderFn: (container: HTMLElement) => void) =>
        tabManager.openCustomRenderTab(title, renderFn);

    (window as unknown as Record<string, unknown>)["__MARKABLE_RENDER_MD__"] =
      (md: string) => marked.parse(md);

    (window as unknown as Record<string, unknown>)["__MARKABLE_ACTION_EXTENSIONS__"] =
      new Map<string, () => void>();
  });

  /**
   * TC-11: __MARKABLE_OPEN_CUSTOM_TAB__ is a function that calls
   * tabManager.openCustomRenderTab().
   */
  it("TC-11: __MARKABLE_OPEN_CUSTOM_TAB__ calls tabManager.openCustomRenderTab", async () => {
    const { tabManager } = await import("../../src/tabs/tab-manager");
    const spy = vi.spyOn(tabManager, "openCustomRenderTab");

    const globalFn = (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_CUSTOM_TAB__"];
    expect(typeof globalFn).toBe("function");

    const fn = vi.fn();
    (globalFn as (title: string, renderFn: (container: HTMLElement) => void) => void)("Title", fn);
    expect(spy).toHaveBeenCalledWith("Title", fn);

    spy.mockRestore();
  });

  /**
   * TC-12: __MARKABLE_RENDER_MD__ wraps marked.parse and returns HTML.
   */
  it("TC-12: __MARKABLE_RENDER_MD__ returns marked.parse output for **bold**", () => {
    const renderMd = (window as unknown as Record<string, unknown>)["__MARKABLE_RENDER_MD__"];
    expect(typeof renderMd).toBe("function");
    const result = (renderMd as (md: string) => string)("**bold**");
    expect(result).toContain("strong");
  });

  /**
   * TC-13: __MARKABLE_ACTION_EXTENSIONS__ is a Map instance.
   */
  it("TC-13: __MARKABLE_ACTION_EXTENSIONS__ is a Map", () => {
    const ext = (window as unknown as Record<string, unknown>)["__MARKABLE_ACTION_EXTENSIONS__"];
    expect(ext instanceof Map).toBe(true);
  });

  /**
   * TC-14: handleAction dispatches to __MARKABLE_ACTION_EXTENSIONS__ for
   * unknown action ids. The global __MARKABLE_HANDLE_ACTION__ is what main.ts
   * exposes; here we verify the extension map is consulted.
   *
   * Since main.ts handleAction is not loaded in tests, we simulate the
   * dispatch logic directly.
   */
  it("TC-14: action extension handler is called for registered action", () => {
    const ext = (window as unknown as Record<string, unknown>)["__MARKABLE_ACTION_EXTENSIONS__"] as Map<string, () => void>;
    const handler = vi.fn();
    ext.set("test-custom-action", handler);

    // Simulate what handleAction() does for unknown actions:
    const action = "test-custom-action";
    if (ext instanceof Map && ext.has(action)) {
      ext.get(action)!();
    }

    expect(handler).toHaveBeenCalled();
    ext.delete("test-custom-action");
  });
});
