/**
 * Tests for tab drag-to-reorder:
 *   - TabManager.reorderTab() logic
 *   - attachTabReorderDrag() pointer-events gesture
 *   - MinimalTabBar / RegularTabBar / VerticalTabStrip integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ close: vi.fn(() => Promise.resolve()) })),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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

vi.mock("../../src/sidebar/sidebar-manager", () => ({ toggleSide: vi.fn() }));
vi.mock("../../src/tabs/tabs.css", () => ({}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { TabManager } from "../../src/tabs/tab-manager";
import { MinimalTabBar } from "../../src/tabs/renderers/minimal-tab-bar";
import { RegularTabBar } from "../../src/tabs/renderers/regular-tab-bar";
import { VerticalTabStrip } from "../../src/tabs/renderers/vertical-tab-strip";
import { attachTabReorderDrag } from "../../src/tabs/tab-reorder-drag";
import { makeTabs } from "./test-helpers";
import { getCurrentSettings, updateSettings } from "../../src/lib/settings";
import { readFile } from "../../src/lib/bridge";

const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEditorView() {
  let doc = "";
  return {
    get state() {
      return { doc: { toString: () => doc, length: doc.length } };
    },
    dispatch: vi.fn((tr: { changes?: { insert?: string } }) => {
      if (tr?.changes && "insert" in tr.changes) doc = tr.changes.insert ?? "";
    }),
    scrollDOM: { scrollTop: 0 },
    focus: vi.fn(),
  } as unknown as import("@codemirror/view").EditorView;
}

function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app-row">
      <div id="editor"></div>
      <div id="sidebar-right"></div>
    </div>
  `;
}

function makeRect(left: number, right: number): DOMRect {
  return {
    left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

// ── TabManager.reorderTab() ───────────────────────────────────────────────────

describe("TabManager.reorderTab()", () => {
  let manager: TabManager;

  beforeEach(async () => {
    setupDom();
    vi.clearAllMocks();
    mockGetCurrentSettings.mockReturnValue({
      tabMode: "minimal",
      openFiles: [],
      activeTabIndex: 0,
      recentFiles: [],
    });
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    mockUpdateSettings.mockResolvedValue(undefined);
    manager = new TabManager();
    await manager.init(makeEditorView());
  });

  it("inserts tab before the target tab (move left-to-right)", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");
    await manager.openFileInTab("/c.md");

    const [a, b, c] = manager.getTabs();
    // Insert a before c → [b, a, c]
    manager.reorderTab(a.id, c.id);

    const result = manager.getTabs();
    expect(result[0].filePath).toBe(b.filePath);
    expect(result[1].filePath).toBe(a.filePath);
    expect(result[2].filePath).toBe(c.filePath);
  });

  it("inserts tab before the target tab (move right-to-left)", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");
    await manager.openFileInTab("/c.md");

    const [a, b, c] = manager.getTabs();
    // Insert c before a → [c, a, b]
    manager.reorderTab(c.id, a.id);

    const result = manager.getTabs();
    expect(result[0].filePath).toBe(c.filePath);
    expect(result[1].filePath).toBe(a.filePath);
    expect(result[2].filePath).toBe(b.filePath);
  });

  it("appends tab at end when insertBeforeId is null", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");
    await manager.openFileInTab("/c.md");

    const [a, b, c] = manager.getTabs();
    // Move a to end → [b, c, a]
    manager.reorderTab(a.id, null);

    const result = manager.getTabs();
    expect(result[0].filePath).toBe(b.filePath);
    expect(result[1].filePath).toBe(c.filePath);
    expect(result[2].filePath).toBe(a.filePath);
  });

  it("keeps the active tab active after reorder", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");
    await manager.openFileInTab("/c.md");

    const [a, , c] = manager.getTabs();
    const bTab = manager.getTabs()[1];
    manager.activateTab(bTab.id);
    expect(manager.getActiveTab()?.id).toBe(bTab.id);

    manager.reorderTab(c.id, a.id);
    expect(manager.getActiveTab()?.id).toBe(bTab.id);
  });

  it("is a no-op when fromId equals insertBeforeId", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");

    const id = manager.getTabs()[0].id;
    const before = manager.getTabs().map((t) => t.id);
    manager.reorderTab(id, id);
    expect(manager.getTabs().map((t) => t.id)).toEqual(before);
  });

  it("is a no-op when fromId is unknown", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    const before = manager.getTabs().map((t) => t.id);
    manager.reorderTab("nonexistent", manager.getTabs()[0].id);
    expect(manager.getTabs().map((t) => t.id)).toEqual(before);
  });

  it("calls saveSession after a successful reorder", async () => {
    mockReadFile.mockResolvedValue({ ok: true, value: "" });
    await manager.openFileInTab("/a.md");
    await manager.openFileInTab("/b.md");

    mockUpdateSettings.mockClear();
    const [a, b] = manager.getTabs();
    manager.reorderTab(a.id, b.id);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpdateSettings).toHaveBeenCalled();
  });
});

// ── attachTabReorderDrag() gesture ────────────────────────────────────────────

describe("attachTabReorderDrag()", () => {
  let el: HTMLElement;
  let targetEl: HTMLElement;
  let onReorder: ((fromId: string, insertBeforeId: string | null) => void) & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    el = document.createElement("button");
    el.className = "tab-dot";
    el.dataset.tabId = "tab-a";
    el.setAttribute("aria-label", "Tab A");

    targetEl = document.createElement("button");
    targetEl.className = "tab-dot";
    targetEl.dataset.tabId = "tab-b";
    targetEl.setAttribute("aria-label", "Tab B");

    document.body.appendChild(el);
    document.body.appendChild(targetEl);

    onReorder = vi.fn() as unknown as
      ((fromId: string, insertBeforeId: string | null) => void) & ReturnType<typeof vi.fn>;
    attachTabReorderDrag(el, "tab-a", ".tab-dot[data-tab-id]", onReorder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("does not fire onReorder for a click (no movement)", () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup",   { button: 0, pointerId: 1, bubbles: true }));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not fire onReorder for a right-click pointerdown", () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 2, pointerId: 1, bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup",   { button: 2, pointerId: 1, bubbles: true }));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("fires onReorder(fromId, insertBeforeId) when cursor is nearest to the 'before' gap", () => {
    // targetEl rect: left=30, right=60. Slots: before(x=30), after(x=60).
    // Cursor at x=40: dist to before=10, dist to after=20 → insert before tab-b.
    vi.spyOn(targetEl, "getBoundingClientRect").mockReturnValue(makeRect(30, 60));

    el.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0, pointerId: 1, clientX: 0, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 40, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 40, clientY: 0, bubbles: true,
    }));

    expect(onReorder).toHaveBeenCalledWith("tab-a", "tab-b");
  });

  it("fires onReorder with null insertBeforeId when cursor is after all tabs", () => {
    // targetEl rect: left=30, right=60. Slots: before(x=30), after(x=60).
    // Cursor at x=80: dist to before=50, dist to after=20 → insert after last tab (null).
    vi.spyOn(targetEl, "getBoundingClientRect").mockReturnValue(makeRect(30, 60));

    el.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0, pointerId: 1, clientX: 0, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 80, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 80, clientY: 0, bubbles: true,
    }));

    expect(onReorder).toHaveBeenCalledWith("tab-a", null);
  });

  it("cleans up ghost and insertion line after drop", () => {
    vi.spyOn(targetEl, "getBoundingClientRect").mockReturnValue(makeRect(30, 60));

    el.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0, pointerId: 1, clientX: 0, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 0, bubbles: true,
    }));

    expect(document.querySelector(".tab-drag-ghost")).toBeNull();
    expect(document.querySelector(".tab-insert-line")).toBeNull();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("cleans up on pointercancel without firing onReorder", () => {
    el.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0, pointerId: 1, clientX: 0, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: 0, bubbles: true,
    }));
    el.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));

    expect(onReorder).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  });
});

// ── Renderer integration: data-tab-id attribute ───────────────────────────────

describe("MinimalTabBar — data-tab-id on dot buttons", () => {
  it("sets data-tab-id on each dot button", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new MinimalTabBar(vi.fn(), undefined, vi.fn());
    const tabs = makeTabs(3);
    renderer.mount(container, tabs, 0);

    const dots = container.querySelectorAll(".tab-dot[data-tab-id]");
    expect(dots.length).toBe(3);
    tabs.forEach((tab, i) => {
      expect((dots[i] as HTMLElement).dataset.tabId).toBe(tab.id);
    });

    renderer.destroy();
    container.remove();
  });
});

describe("RegularTabBar — data-tab-id on label buttons", () => {
  it("sets data-tab-id on each tab label", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new RegularTabBar(vi.fn(), vi.fn(), vi.fn(), vi.fn());
    const tabs = makeTabs(3);
    renderer.mount(container, tabs, 0);

    const labels = container.querySelectorAll(".tab-label[data-tab-id]");
    expect(labels.length).toBe(3);
    tabs.forEach((tab, i) => {
      expect((labels[i] as HTMLElement).dataset.tabId).toBe(tab.id);
    });

    renderer.destroy();
    container.remove();
  });
});

describe("VerticalTabStrip — data-tab-id on column divs", () => {
  it("sets data-tab-id on each tab column", () => {
    const appRow = document.createElement("div");
    appRow.id = "app-row";
    const editor = document.createElement("div");
    editor.id = "editor";
    const tabStrip = document.createElement("div");
    tabStrip.id = "tab-strip";
    const sidebarRight = document.createElement("div");
    sidebarRight.id = "sidebar-right";
    appRow.append(editor, sidebarRight);
    document.body.append(appRow, tabStrip);

    const renderer = new VerticalTabStrip(vi.fn(), vi.fn(), vi.fn());
    const tabs = makeTabs(3);
    renderer.mount(tabStrip, tabs, 1);

    const cols = document.querySelectorAll(".tab-vertical-col[data-tab-id]");
    expect(cols.length).toBe(3);
    tabs.forEach((tab) => {
      const found = document.querySelector(`.tab-vertical-col[data-tab-id="${tab.id}"]`);
      expect(found).not.toBeNull();
    });

    renderer.destroy();
    appRow.remove();
    tabStrip.remove();
  });
});
