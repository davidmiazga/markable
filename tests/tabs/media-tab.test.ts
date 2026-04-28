/**
 * tests/tabs/media-tab.test.ts
 *
 * Unit tests for the media-tab feature in TabManager (media-preview-v2).
 *
 * Covers all 16 edge cases from the requirements and the functional
 * behaviours specified in FR-14 of the requirements doc.
 *
 * All Tauri IPC, settings helpers, and live-preview side-effects are mocked
 * so no Tauri bridge or real filesystem access is needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Module-level mocks (must be declared before the module under test is imported) ──

// Tauri webviewWindow — needed transitively by tab-manager.ts
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

// Mock @tauri-apps/api/core with both invoke and convertFileSrc.
// convertFileSrc returns a deterministic URL so _renderMediaViewer tests can
// assert exact src values without a real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => "asset://localhost/" + encodeURIComponent(p)),
}));

// Mock bridge — readFile is used by openFileInTab in the duplicate-path test
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

// Mock settings helpers — each test overrides mockGetCurrentSettings as needed
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

// Mock live-preview — avoids DOM-heavy CM6 extension imports.
// Extensions referenced by extensions.ts (a transitive dep) must be present
// so the module resolves without throwing during test setup.
vi.mock("../../src/editor/live-preview", () => ({
  setLivePreviewFilePath: vi.fn(),
  setViewMode: { of: vi.fn(() => ({})) },
  livePreviewExtension: [],
  tablePreviewField: {},
  fencedCodePreviewField: {},
  viewModeField: {},
}));

// Mock sidebar-manager (toggleSide is called by setMode for vertical mode)
vi.mock("../../src/sidebar/sidebar-manager", () => ({
  toggleSide: vi.fn(),
}));

// ── Import the module under test AFTER mocks are declared ──

import { TabManager } from "../../src/tabs/tab-manager";
import { readFile } from "../../src/lib/bridge";
import { getCurrentSettings, updateSettings } from "../../src/lib/settings";

// Typed mock references for convenient spy access
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;

// ── Minimal EditorView mock ───────────────────────────────────────────────────

/**
 * Minimal EditorView stub that satisfies the API surface TabManager uses:
 *   - state.doc.toString() / state.doc.length — current doc text
 *   - dispatch({ changes, selection, effects }) — doc replacement
 *   - scrollDOM.scrollTop — scroll position save/restore
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
 * Inserts the minimum DOM elements that TabManager.init() requires.
 *
 * #editor is included so init() can store editorContainer and inject
 * #media-viewer — both are essential for all media-tab tests.
 */
function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app">
      <div id="app-row">
        <div id="editor"></div>
      </div>
    </div>
  `;
}

// ── Shared settings helper ────────────────────────────────────────────────────

/**
 * Returns the base settings mock value used by most tests (no vault, no
 * persisted session). Individual tests override as needed.
 */
function baseSettings() {
  return {
    tabMode: undefined,
    openFiles: undefined,
    activeTabIndex: undefined,
    recentFiles: [],
  };
}

/**
 * Returns settings that simulate an active vault, causing init() to stay at
 * 0 tabs instead of creating an Untitled fallback.
 */
function settingsWithVault() {
  return {
    ...baseSettings(),
    activeVaultId: "vault-1",
    vaults: [{ id: "vault-1", name: "Test Vault", rootPaths: ["/vault"], excludePatterns: [], maxIndexSize: 500, created: "", lastOpened: "" }],
  };
}

// ── Group A: openMediaInTab — creation ────────────────────────────────────────

describe("openMediaInTab — creates a kind:media tab", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    manager = new TabManager();
  });

  it("returns true when a new tab is created", async () => {
    const view = makeEditorView();
    await manager.init(view);
    const result = manager.openMediaInTab("/vault/photo.png");
    expect(result).toBe(true);
  });

  it("creates a tab with kind === 'media'", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.kind).toBe("media");
  });

  it("uses the full basename including extension as the title", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.title).toBe("photo.png");
  });

  it("title for a path with no extension is the full filename", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/LICENSE");
    // Auto-close removes the Untitled tab; only the media tab remains
    expect(manager.getActiveTab()?.title).toBe("LICENSE");
  });

  it("sets isDirty to false", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.isDirty).toBe(false);
  });

  it("sets doc to empty string", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.doc).toBe("");
  });

  it("getTabCount() is 1 after auto-close of Untitled tab", async () => {
    // manager starts with 1 Untitled tab; openMediaInTab auto-closes it
    const view = makeEditorView();
    await manager.init(view);
    expect(manager.getTabCount()).toBe(1); // initial Untitled
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getTabCount()).toBe(1); // Untitled replaced by media tab
  });
});

// ── Group B: openMediaInTab — deduplication (EC-01) ──────────────────────────

describe("openMediaInTab — duplicate guard (EC-01)", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    manager = new TabManager();
  });

  it("returns false when the same path is already open as a media tab", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png"); // creates
    const result = manager.openMediaInTab("/vault/photo.png"); // duplicate
    expect(result).toBe(false);
  });

  it("does not create a second tab for the same media path", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getTabCount()).toBe(1);
  });

  it("a kind:editor tab with the same path is NOT treated as a duplicate (EC-15)", async () => {
    // An editor tab for the path exists; opening a media tab for the same path
    // is a different kind and must NOT be deduplicated.
    const view = makeEditorView();
    mockReadFile.mockResolvedValue({ ok: true, value: "# Image Note" });
    await manager.init(view);
    await manager.openFileInTab("/vault/image.md"); // kind: "editor"
    const result = manager.openMediaInTab("/vault/image.md"); // kind: "media"
    expect(result).toBe(true);
    expect(manager.getTabCount()).toBe(2);
  });
});

// ── Group C: openMediaInTab — auto-close Untitled (EC-02 equivalent) ─────────

describe("openMediaInTab — auto-close clean Untitled tab", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    manager = new TabManager();
  });

  it("removes the only Untitled editor tab when opening the first media tab", async () => {
    const view = makeEditorView();
    await manager.init(view);
    expect(manager.getTabCount()).toBe(1); // starts with 1 Untitled
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getTabCount()).toBe(1); // Untitled gone, media tab stays
    expect(manager.getActiveTab()?.kind).toBe("media");
  });

  it("does NOT remove a dirty Untitled tab", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.markActiveTabDirty(); // make the Untitled tab dirty
    manager.openMediaInTab("/vault/photo.png");
    // Both tabs remain because the Untitled is dirty
    expect(manager.getTabCount()).toBe(2);
  });

  it("does NOT remove an Untitled tab when two other tabs exist", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openNewTab(); // now 2 Untitled tabs
    manager.openMediaInTab("/vault/photo.png"); // 3rd tab — no auto-close (tabs.length was 3, not 2 before push)
    expect(manager.getTabCount()).toBe(3);
  });
});

// ── Group D: _applyActiveTab — DOM effects (EC-06, EC-07, EC-08) ─────────────

describe("_applyActiveTab — media tab DOM effects", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    manager = new TabManager();
  });

  it("adds has-media-tab class to #editor when a media tab is active", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    const editorEl = document.getElementById("editor");
    expect(editorEl?.classList.contains("has-media-tab")).toBe(true);
  });

  it("removes has-media-tab class when switching to an editor tab", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    // Open a new editor tab, which makes the editor the active tab
    manager.openNewTab();
    expect(document.getElementById("editor")?.classList.contains("has-media-tab")).toBe(false);
  });

  it("does NOT call editorView.dispatch when applying a media tab", async () => {
    const view = makeEditorView();
    await manager.init(view);
    const dispatchSpy = vi.spyOn(view, "dispatch");
    dispatchSpy.mockClear();
    manager.openMediaInTab("/vault/photo.png");
    // dispatch should not have been called when applying the media tab
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("populates #media-viewer with <img> for a .png file", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    const mv = document.getElementById("media-viewer");
    expect(mv?.querySelector("img")).not.toBeNull();
  });

  it("<img> alt attribute equals the basename", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");
    const img = document.querySelector("#media-viewer img") as HTMLImageElement | null;
    expect(img?.alt).toBe("photo.png");
  });

  it("populates #media-viewer with <embed> for a .pdf file", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/doc.pdf");
    expect(document.querySelector("#media-viewer embed")).not.toBeNull();
  });

  it("<embed> has type='application/pdf'", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/doc.pdf");
    const embed = document.querySelector("#media-viewer embed") as HTMLEmbedElement | null;
    expect(embed?.type).toBe("application/pdf");
  });

  it("renders .mv-unsupported for an unrecognised extension (EC-04)", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/Makefile");
    expect(document.querySelector("#media-viewer .mv-unsupported")).not.toBeNull();
  });

  it("renders <img> for .JPG — case-insensitive extension matching (EC-05)", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/PHOTO.JPG");
    expect(document.querySelector("#media-viewer img")).not.toBeNull();
  });

  it("renders <embed> for .PDF — case insensitive (EC-05)", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/DOC.PDF");
    expect(document.querySelector("#media-viewer embed")).not.toBeNull();
  });

  it("clears #media-viewer innerHTML when switching between media tabs (EC-06, NFR-3)", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/a.png");
    // Open a second media tab — switching should clear the first tab's <img>
    manager.openMediaInTab("/vault/b.pdf");
    const mv = document.getElementById("media-viewer")!;
    // Should have 0 <img> elements (the .png viewer was replaced by .pdf viewer)
    expect(mv.querySelectorAll("img").length).toBe(0);
    expect(mv.querySelectorAll("embed").length).toBe(1);
  });
});

// ── Group E: _captureActiveTab — media tab skipped (EC-08) ───────────────────

describe("_captureActiveTab — skipped for media tabs (EC-08)", () => {
  it("does not read editorView.state.doc.toString when active tab is kind:media", async () => {
    // Setup
    document.body.innerHTML = `
      <div id="titlebar"><span id="titlebar-title"></span></div>
      <div id="tab-strip"></div>
      <div id="app">
        <div id="app-row">
          <div id="editor"></div>
        </div>
      </div>
    `;
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    mockReadFile.mockResolvedValue({ ok: true, value: "# Note" });

    const manager = new TabManager();
    const view = makeEditorView();

    // Spy on doc.toString to detect if _captureActiveTab reads the editor doc
    const docToStringSpy = vi.spyOn(view.state.doc, "toString");

    await manager.init(view);

    // Sequence: open an editor tab, then a media tab (media tab becomes active),
    // then open another editor tab — this triggers _captureActiveTab on the media tab.
    await manager.openFileInTab("/vault/note.md");
    manager.openMediaInTab("/vault/photo.png"); // media tab is now active
    docToStringSpy.mockClear(); // clear spy calls from before this point

    // Opening another editor tab calls _captureActiveTab on the current (media) tab.
    // _captureActiveTab must short-circuit and NOT call doc.toString() for media tabs.
    await manager.openFileInTab("/vault/other.md");

    expect(docToStringSpy).not.toHaveBeenCalled();
  });
});

// ── Group F: saveSession — excludes media tabs (EC-16) ───────────────────────

describe("saveSession — excludes media tabs (EC-16)", () => {
  it("media tab with non-null filePath is excluded from openFiles", async () => {
    document.body.innerHTML = `
      <div id="titlebar"><span id="titlebar-title"></span></div>
      <div id="tab-strip"></div>
      <div id="app">
        <div id="app-row">
          <div id="editor"></div>
        </div>
      </div>
    `;
    vi.clearAllMocks();
    // Use vault settings so init() starts with 0 tabs (no Untitled fallback)
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());
    mockReadFile.mockResolvedValue({ ok: true, value: "# Note" });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    await manager.openFileInTab("/vault/note.md");
    manager.openMediaInTab("/vault/photo.png");

    mockUpdateSettings.mockClear();
    await manager.saveSession();

    // updateSettings is called with a function that merges the new session data.
    // Invoke that function to extract what was written.
    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const updaterFn = mockUpdateSettings.mock.calls[0][0] as (s: unknown) => unknown;
    const result = updaterFn({ openFiles: [], activeTabIndex: 0 }) as {
      openFiles: { filePath: string }[];
    };

    const paths = result.openFiles.map((f) => f.filePath);
    // Editor tab must be included
    expect(paths).toContain("/vault/note.md");
    // Media tab must be excluded even though filePath is non-null
    expect(paths).not.toContain("/vault/photo.png");
  });

  it("editor tabs with file paths are still included in openFiles", async () => {
    document.body.innerHTML = `
      <div id="titlebar"><span id="titlebar-title"></span></div>
      <div id="tab-strip"></div>
      <div id="app">
        <div id="app-row">
          <div id="editor"></div>
        </div>
      </div>
    `;
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());
    mockReadFile.mockResolvedValue({ ok: true, value: "content" });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);
    await manager.openFileInTab("/vault/a.md");
    await manager.openFileInTab("/vault/b.md");

    mockUpdateSettings.mockClear();
    await manager.saveSession();

    const updaterFn = mockUpdateSettings.mock.calls[0][0] as (s: unknown) => unknown;
    const result = updaterFn({ openFiles: [], activeTabIndex: 0 }) as {
      openFiles: { filePath: string }[];
    };
    const paths = result.openFiles.map((f) => f.filePath);
    expect(paths).toContain("/vault/a.md");
    expect(paths).toContain("/vault/b.md");
  });
});

// ── Group G: closeTab — media-specific paths (FR-7, EC-12, EC-13) ────────────

describe("closeTab — media tab behaviour", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    // Use vault settings so closing the last tab stays at 0 (not window.close)
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());
    manager = new TabManager();
  });

  it("does not invoke confirm() when closing a media tab", async () => {
    const view = makeEditorView();
    await manager.init(view);
    // JSDOM does not define window.confirm by default — assign a stub before spying
    // so vi.spyOn can wrap it.
    window.confirm = vi.fn(() => false);
    const confirmSpy = vi.spyOn(window, "confirm");

    manager.openMediaInTab("/vault/photo.png");
    const mediaTabId = manager.getActiveTab()!.id;
    await manager.closeTab(mediaTabId);

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("closing the last media tab (vault active) drops to 0 tabs and removes has-media-tab (EC-13)", async () => {
    const view = makeEditorView();
    await manager.init(view);
    // With vault settings, init() starts with 0 tabs. Open a media tab.
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getTabCount()).toBe(1);

    const mediaTabId = manager.getActiveTab()!.id;
    await manager.closeTab(mediaTabId);

    expect(manager.getTabCount()).toBe(0);
    expect(document.getElementById("editor")?.classList.contains("has-media-tab")).toBe(false);
  });

  it("closing the last media tab (vault active) clears #media-viewer innerHTML (EC-13)", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");

    const mediaTabId = manager.getActiveTab()!.id;
    await manager.closeTab(mediaTabId);

    expect(document.getElementById("media-viewer")?.innerHTML).toBe("");
  });
});

// ── Group H: _renderMediaViewer — error handling (EC-03) ─────────────────────

describe("_renderMediaViewer — error handling (EC-03)", () => {
  let manager: TabManager;

  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(baseSettings());
    manager = new TabManager();
  });

  it("img error event replaces #media-viewer with .mv-load-error", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/photo.png");

    const img = document.querySelector("#media-viewer img") as HTMLImageElement;
    expect(img).not.toBeNull();

    // Simulate the browser firing an error event on the image element
    img.dispatchEvent(new Event("error"));

    expect(document.querySelector("#media-viewer .mv-load-error")).not.toBeNull();
    // The img should be gone — innerHTML was replaced entirely
    expect(document.querySelector("#media-viewer img")).toBeNull();
  });

  it("embed error event replaces #media-viewer with .mv-load-error", async () => {
    const view = makeEditorView();
    await manager.init(view);
    manager.openMediaInTab("/vault/doc.pdf");

    const embed = document.querySelector("#media-viewer embed") as HTMLEmbedElement;
    expect(embed).not.toBeNull();

    embed.dispatchEvent(new Event("error"));

    expect(document.querySelector("#media-viewer .mv-load-error")).not.toBeNull();
    expect(document.querySelector("#media-viewer embed")).toBeNull();
  });
});

// ── Group I: EC-10 — openMediaInTab before init() completes ──────────────────

describe("EC-10 — openMediaInTab before init()", () => {
  it("calling openMediaInTab before init() does not throw", () => {
    const manager = new TabManager();
    // editorContainer is null because init() has not been called
    expect(() => manager.openMediaInTab("/vault/photo.png")).not.toThrow();
  });

  it("tab is pushed to the array even when editorContainer is null", () => {
    const manager = new TabManager();
    manager.openMediaInTab("/vault/photo.png");
    // The tab must exist in the array despite init() not having run
    expect(manager.getTabCount()).toBe(1);
  });
});

// ── Group J: saveActiveTab / saveActiveTabAs — media guard (C-1) ─────────────

describe("saveActiveTab() and saveActiveTabAs() — media tab guards (C-1)", () => {
  /**
   * Both save functions must be no-ops when a media tab is active.
   * Without this guard, Cmd-S would call writeFile with binary file paths and
   * the stale CM6 editor buffer — overwriting the original binary with text.
   */

  it("saveActiveTab() is a no-op when a media tab is active", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());
    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.kind).toBe("media");

    // writeFile must not be called when save is triggered for a media tab
    const { writeFile } = await import("../../src/lib/bridge");
    const writeFileMock = writeFile as ReturnType<typeof vi.fn>;
    writeFileMock.mockClear();

    await manager.saveActiveTab();

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("saveActiveTabAs() is a no-op when a media tab is active", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());
    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.kind).toBe("media");

    // saveFileDialog must not be called when Save As is triggered for a media tab.
    // saveActiveTabAs() calls saveFileDialog() before writeFile(), so guarding on
    // saveFileDialog is sufficient to prove the early return fired.
    const { saveFileDialog } = await import("../../src/lib/bridge");
    const saveFileDialogMock = saveFileDialog as ReturnType<typeof vi.fn>;
    saveFileDialogMock.mockClear();

    await manager.saveActiveTabAs();

    expect(saveFileDialogMock).not.toHaveBeenCalled();
  });
});

// ── Group K: saveSession — scrollTop not written from CM6 view for media (H-1) ─

describe("saveSession — scrollTop not captured from CM6 view when active tab is media (H-1)", () => {
  it("does not write editorView scrollTop to a media tab's scrollTop field", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    manager.openMediaInTab("/vault/photo.png");
    // Confirm media tab is active
    expect(manager.getActiveTab()?.kind).toBe("media");

    // Set a non-zero scrollTop on the EditorView to act as stale editor state
    view.scrollDOM.scrollTop = 999;

    await manager.saveSession();

    // The media tab's scrollTop must remain at the value set at creation (0),
    // not the stale editor scrollDOM value (999). If the guard is missing,
    // saveSession writes 999 here and that value leaks into session persistence.
    expect(manager.getActiveTab()?.scrollTop).toBe(0);
  });
});

// ── Group L: markActiveTabDirty() — media guard (M-1) ────────────────────────

describe("markActiveTabDirty() — no-op when active tab is media (M-1)", () => {
  it("markActiveTabDirty() is a no-op when a media tab is active", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getActiveTab()?.kind).toBe("media");

    // Calling markActiveTabDirty() must not change isDirty on a media tab —
    // media tabs have no editable content and must never be considered dirty.
    manager.markActiveTabDirty();
    expect(manager.getActiveTab()?.isDirty).toBe(false);
  });
});

// ── Group M: EC-09 — vault switch while media tab open ───────────────────────

describe("EC-09 — vault state change while media tab is open", () => {
  /**
   * TabManager has no vault-switch hook — vault changes are managed externally
   * by vault-manager.ts. This test verifies that a media tab's in-memory state
   * remains coherent after settings are updated to reflect a new vault (simulating
   * the settings change that a vault switch causes). The assertion is that the
   * media tab continues to exist with its original properties and that no stale
   * editor state has leaked into it, which is the risk from the missing guards
   * patched in C-1, H-1, and M-1.
   */
  it("media tab survives a settings update (simulated vault switch) without state corruption", async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    manager.openMediaInTab("/vault/photo.png");
    const tabBefore = manager.getActiveTab()!;
    expect(tabBefore.kind).toBe("media");
    expect(tabBefore.filePath).toBe("/vault/photo.png");

    // Simulate a vault switch by updating the settings mock and calling saveSession.
    // This is the closest TabManager-level proxy to a vault switch event because
    // TabManager itself has no vault-change callback.
    mockGetCurrentSettings.mockReturnValue({
      ...settingsWithVault(),
      activeVaultId: "vault-2",
      vaults: [
        { id: "vault-2", name: "New Vault", rootPaths: ["/vault2"], excludePatterns: [], maxIndexSize: 500, created: "", lastOpened: "" },
      ],
    });

    // saveSession is the operation vault-manager triggers after switching
    await manager.saveSession();

    // The media tab must still be intact — no stale scroll or doc state
    const tabAfter = manager.getActiveTab()!;
    expect(tabAfter.kind).toBe("media");
    expect(tabAfter.filePath).toBe("/vault/photo.png");
    // scrollTop must still be 0 (not overwritten with stale CM6 state)
    expect(tabAfter.scrollTop).toBe(0);
    // isDirty must still be false
    expect(tabAfter.isDirty).toBe(false);
  });
});

// ── Group N: EC-14 — rapid successive openMediaInTab calls ───────────────────

describe("EC-14 — rapid successive openMediaInTab calls", () => {
  it("opening two different media files in quick succession creates two tabs with the second active", async () => {
    setupDom();
    vi.clearAllMocks();
    // Use vault settings so init() starts with 0 tabs (no Untitled to auto-close)
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    // Rapid calls — no await between them; both are synchronous
    manager.openMediaInTab("/notes/a.jpg");
    manager.openMediaInTab("/notes/b.png");

    expect(manager.getTabCount()).toBe(2);
    expect(manager.getActiveTab()?.filePath).toBe("/notes/b.png");
  });
});

// ── Group O: EC-12 (window-close variant) — last media tab, no vault ─────────

describe("EC-12 (window-close variant) — closing last media tab with no vault", () => {
  /**
   * When no vault is configured, closing the last tab must close the application
   * window. For media tabs specifically, this must happen WITHOUT showing a
   * confirm() dirty-check dialog (media tabs are never dirty).
   */
  it("closing the last media tab (no vault) calls appWindow.close() without confirm()", async () => {
    setupDom();
    vi.clearAllMocks();
    // No vault — closing last tab should close the window
    mockGetCurrentSettings.mockReturnValue(baseSettings());

    // Capture the mock close function so we can assert it was called
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const mockGetWindow = getCurrentWebviewWindow as ReturnType<typeof vi.fn>;
    const closeMock = vi.fn(() => Promise.resolve());
    mockGetWindow.mockReturnValue({ close: closeMock });

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    // init() creates 1 Untitled editor tab (no vault). Replace it by opening a
    // media tab — the Untitled tab is auto-closed, leaving only the media tab.
    manager.openMediaInTab("/notes/photo.jpg");
    expect(manager.getTabCount()).toBe(1);
    expect(manager.getActiveTab()?.kind).toBe("media");

    window.confirm = vi.fn(() => false);
    const confirmSpy = vi.spyOn(window, "confirm");

    const mediaTabId = manager.getActiveTab()!.id;
    await manager.closeTab(mediaTabId);

    // confirm() must NOT have been called — media tabs have no dirty state
    expect(confirmSpy).not.toHaveBeenCalled();
    // The window must have been closed
    expect(closeMock).toHaveBeenCalledOnce();
  });
});

// ── Group P: EC-02 (close then reopen same file) — L-2 ───────────────────────

describe("EC-02 — close media tab then reopen same file", () => {
  it("closing a media tab then re-clicking the file opens a fresh tab", async () => {
    setupDom();
    vi.clearAllMocks();
    // Use vault settings so closing the last tab stays at 0 tabs (not window.close)
    mockGetCurrentSettings.mockReturnValue(settingsWithVault());

    const manager = new TabManager();
    const view = makeEditorView();
    await manager.init(view);

    // Step 1: open the media tab
    manager.openMediaInTab("/vault/photo.png");
    expect(manager.getTabCount()).toBe(1);
    const firstTabId = manager.getActiveTab()!.id;

    // Step 2: close the tab
    await manager.closeTab(firstTabId);
    expect(manager.getTabCount()).toBe(0);

    // Step 3: reopen the same file — must create a brand new tab (not deduplicate
    // against the now-closed tab, whose id no longer exists in the tab list)
    const result = manager.openMediaInTab("/vault/photo.png");
    expect(result).toBe(true);
    expect(manager.getTabCount()).toBe(1);

    // The new tab must be active
    const newTab = manager.getActiveTab()!;
    expect(newTab.filePath).toBe("/vault/photo.png");
    // The new tab must have a fresh id — not the same as the closed tab
    expect(newTab.id).not.toBe(firstTabId);
  });
});
