/**
 * tests/tabs/tab-context-menu.test.ts
 *
 * Unit tests for src/tabs/tab-context-menu.ts.
 *
 * Tests the DOM-level behavior of showTabContextMenu() and closeTabContextMenu():
 *   - Menu is appended to document.body with correct structure
 *   - Four items + one separator
 *   - Disabled state based on tab/manager state
 *   - No menu stacking (second open closes first)
 *   - Menu removed on close
 *   - Action item click calls handler and closes menu
 *   - Outside mousedown closes menu
 *   - Escape key closes menu
 *
 * tabManager and bridge.revealInFinder are mocked so no real state machine runs.
 *
 * Test plan source: docs/specs/tab-context-menu/step_06_tests.md (TCM-01..10)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mocks (declared before the module under test is imported) ──────────────────

// Mock tabManager — only the public API surface used by tab-context-menu.ts.
vi.mock("../../src/tabs/tab-manager", () => ({
  tabManager: {
    closeTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeAllTabs: vi.fn(),
    getTabCount: vi.fn().mockReturnValue(3),
  },
}));

// Mock bridge — revealInFinder is the only function used by the module.
vi.mock("../../src/lib/bridge", () => ({
  revealInFinder: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { showTabContextMenu, closeTabContextMenu } from "../../src/tabs/tab-context-menu";
import { tabManager } from "../../src/tabs/tab-manager";
import { revealInFinder } from "../../src/lib/bridge";
import type { TabEntry } from "../../src/tabs/tab-types";

const mockTabManager = tabManager as unknown as {
  closeTab: ReturnType<typeof vi.fn>;
  closeOtherTabs: ReturnType<typeof vi.fn>;
  closeAllTabs: ReturnType<typeof vi.fn>;
  getTabCount: ReturnType<typeof vi.fn>;
};

const mockRevealInFinder = revealInFinder as ReturnType<typeof vi.fn>;

// ── Test helpers ───────────────────────────────────────────────────────────────

/**
 * Creates a minimal TabEntry for test use.
 * filePath defaults to "/some/file.md" (non-null = Reveal enabled).
 */
function makeTab(overrides?: Partial<TabEntry>): TabEntry {
  return {
    id: "test-tab-id",
    kind: "editor",
    filePath: "/some/file.md",
    title: "file",
    isDirty: false,
    doc: "",
    scrollTop: 0,
    ...overrides,
  };
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset to defaults: 3 tabs, so "Close Other Tabs" is enabled.
  mockTabManager.getTabCount.mockReturnValue(3);
  vi.clearAllMocks();
  // Re-apply after clearAllMocks so the count is available for each test.
  mockTabManager.getTabCount.mockReturnValue(3);

  // Ensure the DOM is empty before each test.
  document.body.innerHTML = "";
});

afterEach(() => {
  // Guarantee any open menu is cleaned up after each test.
  closeTabContextMenu();
  document.body.innerHTML = "";
});

// ── TCM-01 through TCM-10 ──────────────────────────────────────────────────────

describe("showTabContextMenu / closeTabContextMenu", () => {

  /**
   * TCM-01: Calling showTabContextMenu appends a <ul class="context-menu"> to body.
   */
  it("TCM-01: appends a <ul class='context-menu'> to document.body", () => {
    showTabContextMenu(makeTab(), 100, 100);

    const menu = document.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    // The menu must be a direct child of body.
    expect(menu?.parentElement).toBe(document.body);
  });

  /**
   * TCM-02: The menu contains exactly four action items and one separator.
   */
  it("TCM-02: menu has four items and one separator", () => {
    showTabContextMenu(makeTab(), 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    const separators = document.querySelectorAll(".context-menu-separator");

    expect(items.length).toBe(4);
    expect(separators.length).toBe(1);
  });

  /**
   * TCM-03: "Close Other Tabs" is disabled when only one tab is open (EC-01).
   *
   * The second .context-menu-item is "Close Other Tabs". It should have the
   * "disabled" class when getTabCount() returns 1.
   */
  it("TCM-03: 'Close Other Tabs' is disabled when getTabCount() === 1", () => {
    mockTabManager.getTabCount.mockReturnValue(1);

    showTabContextMenu(makeTab(), 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    // Index 1 = "Close Other Tabs" (0=Close Tab, 1=Close Other, 2=Close All, 3=Reveal)
    expect(items[1].classList.contains("disabled")).toBe(true);
  });

  /**
   * TCM-04: "Reveal in Finder" is disabled when tab.filePath is null (EC-07).
   *
   * The last .context-menu-item is "Reveal in Finder".
   */
  it("TCM-04: 'Reveal in Finder' is disabled when tab.filePath is null", () => {
    showTabContextMenu(makeTab({ filePath: null }), 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    // Last item = "Reveal in Finder"
    expect(items[items.length - 1].classList.contains("disabled")).toBe(true);
  });

  /**
   * TCM-05: "Reveal in Finder" is enabled when tab.filePath is set (EC-06).
   */
  it("TCM-05: 'Reveal in Finder' is enabled when tab.filePath is set", () => {
    showTabContextMenu(makeTab({ filePath: "/some/file.md" }), 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    expect(items[items.length - 1].classList.contains("disabled")).toBe(false);
  });

  /**
   * TCM-06: Calling showTabContextMenu a second time closes the first menu (EC-09).
   *
   * Only one .context-menu element should exist in document.body at any time.
   */
  it("TCM-06: second call closes first menu — no menu stacking", () => {
    showTabContextMenu(makeTab(), 50, 50);
    showTabContextMenu(makeTab(), 100, 100);

    const menus = document.querySelectorAll(".context-menu");
    expect(menus.length).toBe(1);
  });

  /**
   * TCM-07: closeTabContextMenu removes the menu element from the DOM.
   */
  it("TCM-07: closeTabContextMenu removes the menu from DOM", () => {
    showTabContextMenu(makeTab(), 100, 100);
    expect(document.querySelector(".context-menu")).not.toBeNull();

    closeTabContextMenu();

    expect(document.querySelector(".context-menu")).toBeNull();
  });

  /**
   * TCM-08: Clicking (mousedown) on the first item ("Close Tab") closes the
   * menu and calls tabManager.closeTab with the correct tab id.
   */
  it("TCM-08: mousedown on 'Close Tab' calls closeTab and closes menu", () => {
    const tab = makeTab({ id: "my-tab" });
    showTabContextMenu(tab, 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    // Index 0 = "Close Tab"
    const closeTabItem = items[0] as HTMLElement;
    closeTabItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(mockTabManager.closeTab).toHaveBeenCalledWith("my-tab");
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  /**
   * TCM-09: A mousedown outside the menu closes it (outside-click dismiss).
   */
  it("TCM-09: mousedown outside the menu closes it", () => {
    showTabContextMenu(makeTab(), 100, 100);
    expect(document.querySelector(".context-menu")).not.toBeNull();

    // Dispatch a mousedown on the document (not inside the menu).
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(document.querySelector(".context-menu")).toBeNull();
  });

  /**
   * TCM-10: Pressing Escape closes the menu.
   */
  it("TCM-10: Escape keydown closes the menu", () => {
    showTabContextMenu(makeTab(), 100, 100);
    expect(document.querySelector(".context-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector(".context-menu")).toBeNull();
  });

  /**
   * Additional: closeTabContextMenu() is idempotent (safe when no menu is open).
   */
  it("closeTabContextMenu() is a no-op when no menu is open", () => {
    // Should not throw.
    expect(() => closeTabContextMenu()).not.toThrow();
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  /**
   * Additional: "Close All Tabs" item calls tabManager.closeAllTabs.
   */
  it("mousedown on 'Close All Tabs' calls closeAllTabs", () => {
    showTabContextMenu(makeTab(), 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    // Index 2 = "Close All Tabs"
    const closeAllItem = items[2] as HTMLElement;
    closeAllItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(mockTabManager.closeAllTabs).toHaveBeenCalledOnce();
  });

  /**
   * Additional: "Reveal in Finder" item calls revealInFinder with the tab's filePath.
   */
  it("mousedown on 'Reveal in Finder' calls revealInFinder with the file path", () => {
    const tab = makeTab({ filePath: "/vault/note.md" });
    showTabContextMenu(tab, 100, 100);

    const items = document.querySelectorAll(".context-menu-item");
    // Last item = "Reveal in Finder"
    const revealItem = items[items.length - 1] as HTMLElement;
    revealItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(mockRevealInFinder).toHaveBeenCalledWith("/vault/note.md");
  });

});
