/**
 * soft-warning.test.ts — Dedicated integration tests for FR-9 (soft tab count warning).
 *
 * Verifies that all three renderers (MinimalTabBar, RegularTabBar, VerticalTabStrip)
 * correctly surface and remove the soft warning indicator as the tab count crosses
 * the TAB_SOFT_WARNING_THRESHOLD boundary.
 *
 * Also covers EC-17: when session restore produces more tabs than the threshold,
 * the warning is shown after init() completes.
 *
 * Spec reference: docs/specs/tabs/step_08_soft_warning.md
 *
 * Tests:
 *   1. MinimalTabBar.update with 31 tabs adds tab-over-limit class (FR-9)
 *   2. MinimalTabBar.update with 31 tabs sets data-tab-warning attribute (FR-9)
 *   3. MinimalTabBar.update with 29 tabs does NOT add tab-over-limit (FR-9)
 *   4. RegularTabBar.update with 31 tabs adds tab-over-limit to new button (FR-9)
 *   5. VerticalTabStrip.update with 31 tabs adds tab-over-limit to strip (FR-9)
 *   6. Session restore with 35 tabs shows warning after init() (EC-17)
 *   7. Tab close that brings count from 31 to 30 removes warning indicator (FR-9)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Module-level mocks ─────────────────────────────────────────────────────────
// CSS import in each renderer is mocked so happy-dom does not throw on CSS parsing.
vi.mock("../../src/tabs/tabs.css", () => ({}));

// Tauri APIs required transitively by tab-manager.ts
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

// Bridge mock — readFile used by session restore in TabManager.init()
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

// Settings mock — each test can override mockGetCurrentSettings as needed
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

// Live-preview mock (transitive dep via extensions.ts in tab-manager)
vi.mock("../../src/editor/live-preview", () => ({
  setLivePreviewFilePath: vi.fn(),
  setViewMode: { of: vi.fn(() => ({})) },
  livePreviewExtension: [],
  tablePreviewField: {},
  viewModeField: {},
}));

// Sidebar-manager mock (used in setMode for vertical mode toggle)
vi.mock("../../src/sidebar/sidebar-manager", () => ({
  toggleSide: vi.fn(),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import { MinimalTabBar } from "../../src/tabs/renderers/minimal-tab-bar";
import { RegularTabBar } from "../../src/tabs/renderers/regular-tab-bar";
import { VerticalTabStrip } from "../../src/tabs/renderers/vertical-tab-strip";
import { TabManager } from "../../src/tabs/tab-manager";
import { TAB_SOFT_WARNING_THRESHOLD } from "../../src/tabs/tab-types";
import { readFile } from "../../src/lib/bridge";
import { getCurrentSettings } from "../../src/lib/settings";
import { makeTabs } from "./test-helpers";

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;

/**
 * Creates a minimal EditorView stub with the three properties TabManager reads.
 * No real CM6 instance is needed for these tests.
 */
function makeEditorView() {
  let doc = "";
  const dispatchMock = vi.fn((tr: { changes?: { insert?: string } }) => {
    if (tr?.changes && typeof tr.changes === "object" && "insert" in tr.changes) {
      doc = tr.changes.insert ?? "";
    }
  });
  return {
    get state() { return { doc: { toString: () => doc, length: doc.length } }; },
    dispatch: dispatchMock,
    scrollDOM: { scrollTop: 0 },
  } as unknown as import("@codemirror/view").EditorView;
}

/**
 * Inserts the minimum DOM structure that TabManager.init() requires.
 * #tab-strip is used by all horizontal renderers.
 * #app-row is used by VerticalTabStrip.
 * #titlebar-title is updated by TabManager._updateTitleBar().
 */
function setupDom(): void {
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

// ── Test Suite: MinimalTabBar soft warning ─────────────────────────────────────

describe("MinimalTabBar — soft warning indicator (FR-9, step_08)", () => {
  let container: HTMLElement;
  let renderer: MinimalTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new MinimalTabBar(() => {});
    renderer.mount(container, [], 0);
  });

  afterEach(() => {
    // destroy() removes the tooltip element from document.body and nulls state,
    // ensuring no stale DOM leaks into subsequent tests.
    renderer.destroy();
    container.remove();
  });

  it("adds tab-over-limit class when tab count is one above threshold (FR-9)", () => {
    // The threshold is 30; 31 tabs should trigger the warning.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    expect(container.classList.contains("tab-over-limit")).toBe(true);
  });

  it("sets data-tab-warning attribute when tab count exceeds threshold (FR-9)", () => {
    // The data attribute drives the CSS ::after content that shows the count.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    // The attribute value should include the current tab count.
    expect(container.dataset.tabWarning).toContain(
      String(TAB_SOFT_WARNING_THRESHOLD + 1)
    );
  });

  it("does NOT add tab-over-limit class when tab count is below threshold (FR-9)", () => {
    // 29 tabs — one below the threshold — must not show a warning.
    // This boundary check prevents a false positive at 30 tabs (the spec says > 30).
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD - 1), 0);
    expect(container.classList.contains("tab-over-limit")).toBe(false);
  });

  it("removes tab-over-limit class when count drops from 31 to 30 (FR-9)", () => {
    // First put the strip into the warning state...
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    expect(container.classList.contains("tab-over-limit")).toBe(true);

    // ...then simulate a tab-close that brings the count back to exactly threshold.
    // The warning must disappear (spec: indicator disappears at ≤ 30).
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    expect(container.classList.contains("tab-over-limit")).toBe(false);
  });

  it("removes data-tab-warning attribute when count drops to threshold (FR-9)", () => {
    // Stale CSS content must not persist after the count drops below the threshold.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    expect(container.dataset.tabWarning).toBeUndefined();
  });
});

// ── Test Suite: RegularTabBar soft warning ─────────────────────────────────────

describe("RegularTabBar — soft warning indicator (FR-9, step_08)", () => {
  let container: HTMLElement;
  let renderer: RegularTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new RegularTabBar(() => {}, () => {}, () => {});
    renderer.mount(container, [], 0);
  });

  afterEach(() => {
    // Tear down the renderer so no stale DOM elements leak into the next test.
    renderer.destroy();
    container.remove();
  });

  it("adds tab-over-limit class to .tab-new-btn when tab count exceeds threshold (FR-9)", () => {
    // The "+" button turns amber when the user has too many tabs open.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    const newBtn = container.querySelector<HTMLElement>(".tab-new-btn");
    expect(newBtn?.classList.contains("tab-over-limit")).toBe(true);
  });

  it("removes tab-over-limit from .tab-new-btn when count drops to threshold (FR-9)", () => {
    // Closing one tab should clear the amber warning from the "+" button.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    const newBtn = container.querySelector<HTMLElement>(".tab-new-btn");
    expect(newBtn?.classList.contains("tab-over-limit")).toBe(false);
  });

  it("sets title tooltip on .tab-new-btn when over limit (FR-9)", () => {
    // The title attribute is used as a native browser tooltip to hint that
    // the user should consider closing some tabs.
    const count = TAB_SOFT_WARNING_THRESHOLD + 1;
    renderer.update(makeTabs(count), 0);
    const newBtn = container.querySelector<HTMLButtonElement>(".tab-new-btn");
    // The tooltip must include the current tab count.
    expect(newBtn?.title).toContain(String(count));
  });

  it("resets title tooltip on .tab-new-btn when count drops to threshold (FR-9)", () => {
    // After the warning is cleared the tooltip should revert to the default hint.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    const newBtn = container.querySelector<HTMLButtonElement>(".tab-new-btn");
    // The default tooltip must reference Cmd-T so users know the keyboard shortcut.
    expect(newBtn?.title).toContain("Cmd-T");
  });
});

// ── Test Suite: VerticalTabStrip soft warning ─────────────────────────────────

describe("VerticalTabStrip — soft warning indicator (FR-9, step_08)", () => {
  let container: HTMLElement;
  let renderer: VerticalTabStrip;
  let appRow: HTMLElement;
  let leftStrip: HTMLElement | null;

  beforeEach(() => {
    // VerticalTabStrip inserts strips into #app-row relative to #editor.
    // Both elements must exist before mounting.
    appRow = document.createElement("div");
    appRow.id = "app-row";

    const editor = document.createElement("div");
    editor.id = "editor";
    appRow.appendChild(editor);

    document.body.appendChild(appRow);

    container = document.createElement("div");
    document.body.appendChild(container);

    renderer = new VerticalTabStrip(() => {}, () => {});
    renderer.mount(container, [], 0);

    // The over-limit indicator lives on #tab-vertical-left (the left strip).
    leftStrip = document.getElementById("tab-vertical-left");
  });

  afterEach(() => {
    renderer.destroy();
    appRow.remove();
    container.remove();
    document.getElementById("tab-vertical-left")?.remove();
    document.getElementById("tab-vertical-right")?.remove();
  });

  it("adds tab-over-limit class to strip when tab count exceeds threshold (FR-9)", () => {
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    expect(leftStrip?.classList.contains("tab-over-limit")).toBe(true);
  });

  it("removes tab-over-limit from strip when count drops to threshold (FR-9)", () => {
    // A tab close that brings the count back to exactly 30 must clear the warning.
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    expect(leftStrip?.classList.contains("tab-over-limit")).toBe(false);
  });
});

// ── Test Suite: EC-17 — Session restore beyond threshold ──────────────────────

describe("EC-17 — session restore with tab count above soft warning threshold", () => {
  /**
   * When the user had more than TAB_SOFT_WARNING_THRESHOLD tabs open when they
   * last quit, TabManager.init() should restore all of them and the renderer
   * should immediately show the warning indicator without any further user action.
   *
   * This is guaranteed by the design: init() calls _notifyRenderer() after
   * mounting, which calls update(), which checks tabs.length > threshold.
   */
  it("shows warning indicator after init() restores tabs beyond threshold (EC-17)", async () => {
    setupDom();
    vi.clearAllMocks();

    // Simulate the user having 35 open tabs at last quit.
    // Each path resolves to readable content so all tabs are restored.
    const savedPaths = Array.from(
      { length: TAB_SOFT_WARNING_THRESHOLD + 5 },
      (_, i) => ({ filePath: `/docs/note-${i}.md`, scrollTop: 0 })
    );

    mockGetCurrentSettings.mockReturnValue({
      tabMode: "minimal",
      openFiles: savedPaths,
      activeTabIndex: 0,
      recentFiles: [],
    });

    // All readFile calls succeed so all tabs are restored (none silently skipped).
    mockReadFile.mockResolvedValue({ ok: true, value: "# content" });

    const manager = new TabManager();
    await manager.init(makeEditorView());

    // All 35 tabs should have been restored — no hard cap enforced.
    expect(manager.getTabCount()).toBe(TAB_SOFT_WARNING_THRESHOLD + 5);

    // The #tab-strip element should carry tab-over-limit because the renderer's
    // update() ran after init() and found tabs.length > TAB_SOFT_WARNING_THRESHOLD.
    const tabStrip = document.getElementById("tab-strip");
    expect(tabStrip?.classList.contains("tab-over-limit")).toBe(true);
  });
});
