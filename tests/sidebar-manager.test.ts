/**
 * Unit tests for src/sidebar/sidebar-manager.ts — Sidebar Panel System.
 *
 * Covers the public API (init, register, unregister, toggleSide,
 * restoreFromSettings) and all edge cases enumerated in the architecture spec
 * (EC-1 through EC-23 where testable in happy-dom).
 *
 * Tauri IPC and settings persistence are mocked so no Tauri bridge is needed.
 * The CSS import inside sidebar-manager.ts is a no-op in the Vite/happy-dom
 * test environment.
 *
 * Between each test:
 *   1. The DOM is reset to a minimal scaffold (beforeEach).
 *   2. The module-level state is reset via _resetForTests() (beforeEach).
 *   3. The settings mock is re-initialised to its default state.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ── Module-level mocks — must be defined BEFORE the module under test is imported ──

// Mock Tauri APIs required transitively by settings.ts
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the settings module to avoid real Tauri invoke() calls.
// Each test may re-configure getCurrentSettings via the mockReturnValue helper.
vi.mock("../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({ sidebar: undefined })),
  updateSettings: vi.fn(() => Promise.resolve()),
  updateSettingsInMemory: vi.fn(),
  saveSettingsDebounced: vi.fn(),
  DEFAULT_SIDEBAR_SLOT: { open: false, activeTabId: null, width: 220, panels: {} },
}));

// ── Import AFTER mocking so the module picks up the mock ──

import {
  init,
  register,
  unregister,
  toggleSide,
  restoreFromSettings,
  movePanel,
  movePanelToSide,
  iconizeNonPinnedOrToggle,
  _resetForTests,
} from "../src/sidebar/sidebar-manager";

import {
  getCurrentSettings,
  updateSettings,
  updateSettingsInMemory,
  saveSettingsDebounced,
} from "../src/lib/settings";

// Cast mocked functions for convenient spy access.
const mockGetCurrentSettings = getCurrentSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>;
const mockUpdateSettingsInMemory = updateSettingsInMemory as ReturnType<typeof vi.fn>;
const mockSaveSettingsDebounced = saveSettingsDebounced as ReturnType<typeof vi.fn>;

// ── Helper: build a minimal valid panel descriptor ──────────────────────────

function makeDescriptor(
  id: string,
  side: "left" | "right" = "right",
  overrides: Partial<{
    title: string;
    render: (c: HTMLElement) => void;
    destroy: (c: HTMLElement) => void;
    defaultWidth: number;
  }> = {}
) {
  return {
    id,
    title: overrides.title ?? id,
    side,
    render: overrides.render ?? vi.fn(),
    destroy: overrides.destroy ?? vi.fn(),
    ...(overrides.defaultWidth !== undefined ? { defaultWidth: overrides.defaultWidth } : {}),
  };
}

// ── DOM scaffold and module reset ────────────────────────────────────────────

beforeEach(() => {
  // Minimal app shell matching the expected DOM structure.
  document.body.innerHTML = `
    <div id="titlebar"></div>
    <div id="app">
      <div id="editor"></div>
      <div id="statusbar" class="hidden"></div>
    </div>
  `;

  // Reset module-level state so each test starts from a clean slate.
  _resetForTests();

  // Reset settings mock to the default "no sidebar settings" state.
  mockGetCurrentSettings.mockReturnValue({ sidebar: undefined });
  mockUpdateSettings.mockResolvedValue(undefined);
  mockUpdateSettingsInMemory.mockReturnValue(undefined);
  mockSaveSettingsDebounced.mockReturnValue(undefined);

  // NOTE: Tests that need the sidebar slots to exist MUST call init() themselves.
  // With the eager-slot design, init() creates both #sidebar-left and #sidebar-right
  // immediately (display:none) — the slots exist before any panel is registered.
  // Tests that assert "slot exists but is hidden" should call init() and then
  // check that the slot exists with style.display === "none".
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── describe: init ───────────────────────────────────────────────────────────

describe("SidebarManager — init", () => {
  it("creates #app-row and moves #editor into it", () => {
    init();

    const appRow = document.getElementById("app-row");
    expect(appRow).not.toBeNull();

    const editor = document.getElementById("editor");
    expect(editor?.parentElement?.id).toBe("app-row");
  });

  it("is idempotent — calling init twice does not create duplicate #app-row elements", () => {
    init();
    init();

    const appRows = document.querySelectorAll("#app-row");
    expect(appRows.length).toBe(1);
  });

  it("places #app-row before #statusbar when statusbar exists", () => {
    init();

    const app = document.getElementById("app")!;
    const children = Array.from(app.children).map((c) => c.id);
    const appRowIdx = children.indexOf("app-row");
    const statusbarIdx = children.indexOf("statusbar");

    // #app-row must come before #statusbar.
    expect(appRowIdx).toBeLessThan(statusbarIdx);
  });

  it("creates both #sidebar-left and #sidebar-right eagerly at init() time", () => {
    // Eager-slot design: both slots are created before any panels are registered.
    // They start hidden (display:none) and become visible when a plugin is enabled
    // or the user toggles the sidebar.
    init();

    const leftEl = document.getElementById("sidebar-left") as HTMLElement;
    const rightEl = document.getElementById("sidebar-right") as HTMLElement;

    expect(leftEl).not.toBeNull();
    expect(rightEl).not.toBeNull();
    // Both must start hidden.
    expect(leftEl.style.display).toBe("none");
    expect(rightEl.style.display).toBe("none");
  });

  it("places #sidebar-left before #editor and #editor before #sidebar-right in #app-row", () => {
    init();

    const appRow = document.getElementById("app-row")!;
    const children = Array.from(appRow.children).map((c) => c.id);
    const leftIdx  = children.indexOf("sidebar-left");
    const editorIdx = children.indexOf("editor");
    const rightIdx = children.indexOf("sidebar-right");

    expect(leftIdx).toBeLessThan(editorIdx);
    expect(editorIdx).toBeLessThan(rightIdx);
  });
});

// ── describe: register ───────────────────────────────────────────────────────

describe("SidebarManager — register", () => {
  it("creates #sidebar-right when first right-side panel is registered", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    expect(document.getElementById("sidebar-right")).not.toBeNull();
  });

  it("creates #sidebar-left when first left-side panel is registered", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "left"));

    expect(document.getElementById("sidebar-left")).not.toBeNull();
  });

  it("calls descriptor.render(container) immediately on registration", () => {
    init();
    const renderSpy = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { render: renderSpy }));

    expect(renderSpy).toHaveBeenCalledOnce();
    // The container passed should be a div with class sidebar-panel-content.
    const [container] = renderSpy.mock.calls[0] as [HTMLElement];
    expect(container.className).toBe("sidebar-panel-content");
  });

  it("does not render a tab bar for a single panel", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const tabBar = document.querySelector(".sidebar-tab-bar");
    expect(tabBar).toBeNull();
  });

  it("renders a tab bar when two panels are registered on the same side", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    register("plugin-b", makeDescriptor("panel-2", "right"));

    const tabBar = document.querySelector(".sidebar-tab-bar");
    expect(tabBar).not.toBeNull();
  });

  it("tab bar has one button per panel with correct title text", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right", { title: "Alpha" }));
    register("plugin-b", makeDescriptor("panel-2", "right", { title: "Beta" }));

    const tabs = document.querySelectorAll(".sidebar-tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toBe("Alpha");
    expect(tabs[1].textContent).toBe("Beta");
  });

  it("only the first panel is active (visible) when two panels are registered", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    register("plugin-b", makeDescriptor("panel-2", "right"));

    const wrappers = document.querySelectorAll(".sidebar-panel-wrapper");
    expect(wrappers.length).toBe(2);

    // First wrapper: active → display not "none".
    expect((wrappers[0] as HTMLElement).style.display).not.toBe("none");
    // Second wrapper: inactive → display "none".
    expect((wrappers[1] as HTMLElement).style.display).toBe("none");
  });

  it("logs a warning and rejects duplicate panel ids (EC-12)", () => {
    init();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    register("plugin-a", makeDescriptor("panel-1", "right"));
    const renderSpy2 = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { render: renderSpy2 }));

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("panel-1");
    // Second render() must not have been called.
    expect(renderSpy2).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("shows an error placeholder when render() throws (EC-13)", () => {
    init();
    const throwingRender = () => { throw new Error("boom"); };
    register("plugin-a", makeDescriptor("panel-1", "right", { render: throwingRender }));

    const errorEl = document.querySelector(".sidebar-panel-error");
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toBe("Panel failed to load");
  });

  it("accordion defaults to expanded (contentEl.style.display is not 'none')", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const content = document.querySelector(".sidebar-panel-content") as HTMLElement;
    expect(content.style.display).not.toBe("none");
  });
});

// ── describe: unregister ─────────────────────────────────────────────────────

describe("SidebarManager — unregister", () => {
  it("calls descriptor.destroy(container) before removing from DOM", () => {
    init();
    const destroySpy = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { destroy: destroySpy }));

    // The container should still exist at this point (call is before removal).
    unregister("plugin-a", "panel-1");

    expect(destroySpy).toHaveBeenCalledOnce();
    const [container] = destroySpy.mock.calls[0] as [HTMLElement];
    expect(container.className).toBe("sidebar-panel-content");
  });

  it("calls destroy even when accordion is collapsed (EC-6)", () => {
    init();
    const destroySpy = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { destroy: destroySpy }));

    // Collapse the accordion by clicking the toggle button.
    const toggleBtn = document.querySelector(".sidebar-accordion-toggle") as HTMLElement;
    toggleBtn.click();

    // Verify that the content is now collapsed.
    const content = document.querySelector(".sidebar-panel-content") as HTMLElement;
    expect(content.style.display).toBe("none");

    // Unregister must still call destroy.
    unregister("plugin-a", "panel-1");
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it("proceeds with DOM removal even when destroy() throws (EC-14)", () => {
    init();
    const throwingDestroy = () => { throw new Error("destroy failed"); };
    register("plugin-a", makeDescriptor("panel-1", "right", { destroy: throwingDestroy }));

    // Should not throw.
    expect(() => unregister("plugin-a", "panel-1")).not.toThrow();

    // Wrapper must be removed from DOM.
    const wrapper = document.querySelector(".sidebar-panel-wrapper");
    expect(wrapper).toBeNull();
  });

  it("removes the panel wrapper from the DOM", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    unregister("plugin-a", "panel-1");

    const wrapper = document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]');
    expect(wrapper).toBeNull();
  });

  it("slot stays in DOM (hidden) when last panel is unregistered — eager-slot design", () => {
    // With the eager-slot design the DOM element is never removed.
    // When the last panel unregisters, the slot element stays in the DOM
    // (display:none) with no panel wrappers inside it.
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    unregister("plugin-a", "panel-1");

    // Slot must still exist in the DOM (not removed).
    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(sidebarEl).not.toBeNull();

    // No panel wrappers should remain.
    expect(sidebarEl.querySelectorAll(".sidebar-panel-wrapper").length).toBe(0);
  });

  it("switches active tab to next panel when active panel is unregistered (EC-4)", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right", { title: "Panel 1" }));
    register("plugin-b", makeDescriptor("panel-2", "right", { title: "Panel 2" }));

    // panel-1 is active (first registered). Unregister it.
    // panel-2 (the only remaining panel) should become active.
    unregister("plugin-a", "panel-1");

    const remaining = document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-2"]') as HTMLElement;
    expect(remaining.style.display).not.toBe("none");
  });

  it("is a no-op when panelId was not registered", () => {
    init();
    // Should not throw.
    expect(() => unregister("plugin-a", "nonexistent-panel")).not.toThrow();
  });

  it("is a no-op when pluginId does not match owning plugin (EC-19)", () => {
    init();
    const destroySpy = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { destroy: destroySpy }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unregister("plugin-b", "panel-1"); // wrong pluginId

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("plugin-b");
    expect(destroySpy).not.toHaveBeenCalled();

    // Panel must still be in the DOM.
    expect(document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).not.toBeNull();
    warnSpy.mockRestore();
  });

  it("removes tab bar when panel count drops to 1 after unregistration", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    register("plugin-b", makeDescriptor("panel-2", "right"));

    // Verify tab bar exists with 2 panels.
    expect(document.querySelector(".sidebar-tab-bar")).not.toBeNull();

    // Unregister one panel — count drops to 1 → tab bar should disappear.
    unregister("plugin-b", "panel-2");

    expect(document.querySelector(".sidebar-tab-bar")).toBeNull();
  });
});

// ── describe: toggleSide ─────────────────────────────────────────────────────

describe("SidebarManager — toggleSide", () => {
  it("toggleSide works even when no panels are registered — eager-slot design", () => {
    // With the eager-slot design, toggleSide always works because the slot
    // element exists from init() time. The old EC-8 no-op guard is removed.
    init();
    // No panels registered — slot is present but hidden. toggleSide should
    // show it (since the default open state is false → next state is true).
    expect(() => toggleSide("right")).not.toThrow();

    // Slot must exist (created eagerly by init).
    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(sidebarEl).not.toBeNull();

    // toggleSide should have made the slot visible (display !== "none").
    // The initial closed state (from DEFAULT_SIDEBAR_SLOT / undefined settings)
    // means getCurrentSettings().sidebar?.right?.open === undefined → false,
    // so nextOpen = !false = true → display is set to "".
    expect(sidebarEl.style.display).toBe("");
  });

  it("hides the sidebar element when currently open", () => {
    // Simulate an open sidebar in persisted settings.
    mockGetCurrentSettings.mockReturnValue({
      sidebar: { right: { open: true, activeTabId: null, width: 220, panels: {} } },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // toggleSide() now reads the DOM display property as the source of truth
    // (not settings). The DOM starts closed (display:none) after init(); set it
    // to "" (visible) here to match the "currently open" scenario under test.
    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    sidebarEl.style.display = "";

    toggleSide("right");

    expect(sidebarEl.style.display).toBe("none");
  });

  it("shows the sidebar element when currently hidden", () => {
    // Simulate a closed sidebar in persisted settings.
    mockGetCurrentSettings.mockReturnValue({
      sidebar: { right: { open: false, activeTabId: null, width: 220, panels: {} } },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    toggleSide("right");

    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(sidebarEl.style.display).toBe("");
  });

  it("calls updateSettings with open: false when hiding", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: { right: { open: true, activeTabId: null, width: 220, panels: {} } },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // toggleSide() reads DOM display as source of truth. Set display to ""
    // (visible) to represent the "sidebar is currently open" precondition
    // before calling toggleSide(), which should then hide it (open: false).
    (document.getElementById("sidebar-right") as HTMLElement).style.display = "";

    mockUpdateSettings.mockClear();

    toggleSide("right");

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    // Extract the updater function and call it to inspect the result.
    const updater = mockUpdateSettings.mock.calls[0][0] as (s: object) => object;
    const result = updater({ sidebar: { right: { open: true } } }) as {
      sidebar: { right: { open: boolean } };
    };
    expect(result.sidebar.right.open).toBe(false);
  });

  it("calls updateSettings with open: true when showing", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: { right: { open: false, activeTabId: null, width: 220, panels: {} } },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    mockUpdateSettings.mockClear();

    toggleSide("right");

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const updater = mockUpdateSettings.mock.calls[0][0] as (s: object) => object;
    const result = updater({ sidebar: { right: { open: false } } }) as {
      sidebar: { right: { open: boolean } };
    };
    expect(result.sidebar.right.open).toBe(true);
  });
});

// ── describe: accordion ──────────────────────────────────────────────────────

describe("SidebarManager — accordion", () => {
  it("collapses content area on chevron click (display: none)", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const toggleBtn = document.querySelector(".sidebar-accordion-toggle") as HTMLElement;
    toggleBtn.click();

    const content = document.querySelector(".sidebar-panel-content") as HTMLElement;
    expect(content.style.display).toBe("none");
  });

  it("expands content area on second chevron click", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const toggleBtn = document.querySelector(".sidebar-accordion-toggle") as HTMLElement;
    toggleBtn.click(); // collapse
    toggleBtn.click(); // expand

    const content = document.querySelector(".sidebar-panel-content") as HTMLElement;
    expect(content.style.display).toBe("");
  });

  it("persists accordion state via updateSettings", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    mockUpdateSettings.mockClear();

    const toggleBtn = document.querySelector(".sidebar-accordion-toggle") as HTMLElement;
    toggleBtn.click(); // collapse

    // updateSettings should have been called to persist accordionExpanded: false.
    expect(mockUpdateSettings).toHaveBeenCalled();
    const updater = mockUpdateSettings.mock.calls[0][0] as (s: object) => {
      sidebar: { right: { panels: { "panel-1": { accordionExpanded: boolean } } } };
    };
    const result = updater({ sidebar: {} });
    expect(result.sidebar.right.panels["panel-1"].accordionExpanded).toBe(false);
  });

  it("restores collapsed state from settings on register", () => {
    // Persist collapsed accordion state for panel-1.
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: {
          open: false,
          activeTabId: "panel-1",
          width: 220,
          panels: { "panel-1": { accordionExpanded: false } },
        },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const content = document.querySelector(".sidebar-panel-content") as HTMLElement;
    expect(content.style.display).toBe("none");
  });
});

// ── describe: restoreFromSettings ────────────────────────────────────────────

describe("SidebarManager — restoreFromSettings", () => {
  it("does not make sidebar visible if open: true but no panels registered (EC-11, EC-23)", () => {
    // Eager-slot design: #sidebar-right exists in the DOM after init() but starts
    // hidden. restoreFromSettings() must NOT show an empty sidebar even when
    // settings.sidebar.right.open === true.
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: { open: true, activeTabId: null, width: 220, panels: {} },
      },
    });

    init();
    // No panel registered — sidebar-right exists but must remain hidden.
    restoreFromSettings();

    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(sidebarEl).not.toBeNull(); // slot exists (eager)
    expect(sidebarEl.style.display).toBe("none"); // but must stay hidden (no panels)
  });

  it("applies open: false to hide the sidebar slot", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: { open: false, activeTabId: null, width: 220, panels: {} },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    restoreFromSettings();

    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(sidebarEl.style.display).toBe("none");
  });

  it("applies open: true to show the sidebar slot when panels are registered", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: { open: true, activeTabId: "panel-1", width: 220, panels: {} },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    restoreFromSettings();

    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(sidebarEl.style.display).toBe("");
  });

  it("sets the active panel from persisted activeTabId", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: {
          open: true,
          activeTabId: "panel-2",
          width: 220,
          panels: {},
        },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right", { title: "P1" }));
    register("plugin-b", makeDescriptor("panel-2", "right", { title: "P2" }));

    restoreFromSettings();

    // panel-2 should be active (visible), panel-1 hidden.
    const w1 = document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]') as HTMLElement;
    const w2 = document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-2"]') as HTMLElement;
    expect(w1.style.display).toBe("none");
    expect(w2.style.display).toBe("");
  });
});

// ── describe: toggle cycle stability (NFR-3) ─────────────────────────────────

describe("SidebarManager — toggle cycle stability (NFR-3)", () => {
  it("register → unregister → register produces one sidebar slot, one panel, no duplicate listeners", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    unregister("plugin-a", "panel-1");

    // Re-register the same panel.
    const renderSpy = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { render: renderSpy }));

    // Exactly one #sidebar-right.
    expect(document.querySelectorAll("#sidebar-right").length).toBe(1);

    // Exactly one panel wrapper.
    expect(document.querySelectorAll(".sidebar-panel-wrapper").length).toBe(1);

    // render() was called once for the second registration.
    expect(renderSpy).toHaveBeenCalledOnce();
  });
});

// ── describe: settings writes (NFR-4) ────────────────────────────────────────

describe("SidebarManager — settings writes (NFR-4)", () => {
  it("uses updateSettings (immediate) for accordion toggle", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    mockUpdateSettings.mockClear();

    const toggleBtn = document.querySelector(".sidebar-accordion-toggle") as HTMLElement;
    toggleBtn.click();

    // Immediate updateSettings — not in-memory only.
    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    expect(mockUpdateSettingsInMemory).not.toHaveBeenCalled();
  });

  it("uses updateSettingsInMemory during drag and saveSettingsDebounced on drag end", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Use the right sidebar's handle specifically. With eager-slot init() there
    // are two resize handles (one per sidebar), so we must be explicit.
    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    const handle = sidebarEl.querySelector(".sidebar-resize-handle") as HTMLElement;

    // Simulate a pointerdown → pointermove → pointerup sequence using pointer
    // capture. The SidebarManager resize handler uses hasPointerCapture() to
    // guard both pointermove and pointerup processing.
    //
    // happy-dom supports setPointerCapture; we call it directly to ensure the
    // handler's `hasPointerCapture` check returns true for our synthetic events.
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 400, bubbles: true })
    );
    // Manually capture so hasPointerCapture(1) returns true for subsequent events.
    handle.setPointerCapture(1);

    handle.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 380, bubbles: true })
    );

    // updateSettingsInMemory should be called during drag.
    expect(mockUpdateSettingsInMemory).toHaveBeenCalled();

    handle.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, bubbles: true })
    );

    // saveSettingsDebounced should be called on drag end.
    expect(mockSaveSettingsDebounced).toHaveBeenCalled();
  });

  it("uses updateSettings (immediate) for open/closed toggle", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: { right: { open: false, activeTabId: null, width: 220, panels: {} } },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    mockUpdateSettings.mockClear();

    toggleSide("right");

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    expect(mockUpdateSettingsInMemory).not.toHaveBeenCalledWith(
      expect.anything()
    );
  });
});

// ── describe: eager render (Blocking Item 2) ─────────────────────────────────

describe("SidebarManager — eager render", () => {
  it("render callback is called immediately when panel is registered", () => {
    // All panels must be rendered eagerly at registration time. There is no
    // lazy-render path; the render() call happens synchronously inside
    // register() before the function returns.
    init();
    const renderSpy = vi.fn();
    register("plugin-a", makeDescriptor("panel-1", "right", { render: renderSpy }));

    // render() must have been called exactly once, synchronously, at registration.
    expect(renderSpy).toHaveBeenCalledOnce();
  });
});

// ── describe: resize clamp (EC-15, EC-16) ────────────────────────────────────

describe("SidebarManager — resize clamp", () => {
  // Right sidebar drag math (right sidebar grows leftward):
  //   delta = startX - e.clientX
  //   newWidth = clamp(MIN=150, MAX=600, startWidth + delta)
  //
  // NOTE: happy-dom does not perform CSS layout, so slotEl.offsetWidth is always 0
  // (startWidth=0). The clientX values below are chosen so the computed newWidth
  // overflows the clamp boundaries even with startWidth=0.
  //
  // Minimum clamp: startX=400, clientX=700 → delta=-300, newWidth = 0+(-300)=-300 → 150
  // Maximum clamp: startX=700, clientX=0   → delta=700,  newWidth = 0+700=700      → 600

  it("clamps sidebar width to 150px minimum when drag would produce a narrower width (EC-15)", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    // With eager-slot init(), both sidebars have resize handles. Select the
    // handle specifically from #sidebar-right to avoid ambiguity.
    const handle = sidebarEl.querySelector(".sidebar-resize-handle") as HTMLElement;

    // Set a known starting width so the clamp math is deterministic.
    sidebarEl.style.width = "300px";

    // pointerdown: capture drag start position.
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 400, bubbles: true })
    );
    // Manually apply pointer capture so hasPointerCapture returns true in pointermove.
    handle.setPointerCapture(1);

    // pointermove to clientX=700: delta = 400 - 700 = -300, width = 0 → clamp to 150.
    handle.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 700, bubbles: true })
    );

    expect(sidebarEl.style.width).toBe("150px");
  });

  it("clamps sidebar width to 600px maximum when drag would produce a wider width (EC-16)", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const sidebarEl = document.getElementById("sidebar-right") as HTMLElement;
    // With eager-slot init(), both sidebars have resize handles. Select the
    // handle specifically from #sidebar-right to avoid ambiguity.
    const handle = sidebarEl.querySelector(".sidebar-resize-handle") as HTMLElement;

    // happy-dom does not perform layout, so offsetWidth is always 0 (startWidth=0).
    // We therefore choose clientX values such that:
    //   delta = startX - clientX = 700 - 0 = 700
    //   newWidth = 0 + 700 = 700  → clamped to 600
    sidebarEl.style.width = "300px"; // visual hint for readers; offsetWidth stays 0 in happy-dom

    // pointerdown: capture drag start at clientX=700.
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 700, bubbles: true })
    );
    // Manually apply pointer capture so hasPointerCapture returns true in pointermove.
    handle.setPointerCapture(1);

    // pointermove to clientX=0: delta = 700 - 0 = 700, newWidth = 0+700 = 700 → clamp to 600.
    handle.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 0, bubbles: true })
    );

    expect(sidebarEl.style.width).toBe("600px");
  });
});

// ── describe: movePanel ───────────────────────────────────────────────────────

describe("SidebarManager — movePanel", () => {
  it("moves panel from right to left side", () => {
    // Both sidebars exist from init() time (eager-slot design).
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Right sidebar must exist and contain the panel; left sidebar also exists
    // (both slots are created eagerly) but the panel is not in it yet.
    expect(document.getElementById("sidebar-right")).not.toBeNull();
    expect(document.getElementById("sidebar-left")).not.toBeNull();

    // Panel wrapper must be inside #sidebar-right before the move.
    const rightEl = document.getElementById("sidebar-right")!;
    expect(rightEl.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).not.toBeNull();

    // Perform the move: panel should migrate to the left slot.
    movePanel("panel-1");

    // Panel wrapper must now be inside #sidebar-left.
    const leftEl = document.getElementById("sidebar-left");
    expect(leftEl).not.toBeNull();
    const wrapper = leftEl!.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]');
    expect(wrapper).not.toBeNull();

    // Panel wrapper must no longer be inside #sidebar-right.
    expect(rightEl.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).toBeNull();
  });

  it("persists panelSides to settings after movePanel", () => {
    init();
    register("plugin-a", makeDescriptor("auto-toc", "right"));
    mockUpdateSettings.mockClear();

    movePanel("auto-toc");

    // At least one updateSettings call must include panelSides["auto-toc"] === "left".
    // We find the relevant call by running every updater and checking the result.
    const calls = mockUpdateSettings.mock.calls as Array<[(s: object) => { sidebar: { panelSides?: Record<string, string> } }]>;
    const panelSideValues = calls
      .map(([updater]) => updater({ sidebar: { left: {}, right: {}, panelSides: {} } }))
      .map((result) => result.sidebar?.panelSides?.["auto-toc"]);

    expect(panelSideValues).toContain("left");
  });

  it("respects persisted panelSides on re-register (panel lands on overridden side)", () => {
    // Pre-configure settings so that "test-panel" has been previously moved to
    // the left side, even though its descriptor declares side: "right".
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        left:  { open: false, activeTabId: null, width: 220, panels: {} },
        right: { open: false, activeTabId: null, width: 220, panels: {} },
        panelSides: { "test-panel": "left" },
      },
    });

    init();
    // Register with side: "right" — the persisted override should win.
    register("plugin-a", makeDescriptor("test-panel", "right"));

    // The panel wrapper must be inside #sidebar-left, not #sidebar-right.
    const leftEl = document.getElementById("sidebar-left");
    expect(leftEl).not.toBeNull();
    const wrapper = leftEl!.querySelector('.sidebar-panel-wrapper[data-panel-id="test-panel"]');
    expect(wrapper).not.toBeNull();

    // #sidebar-right exists (eager-slot design) but must NOT contain the panel.
    const rightEl = document.getElementById("sidebar-right");
    expect(rightEl).not.toBeNull();
    expect(rightEl!.querySelector('.sidebar-panel-wrapper[data-panel-id="test-panel"]')).toBeNull();
  });

  it("move button exists in panel header after registration", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const wrapper = document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]');
    expect(wrapper).not.toBeNull();

    // The .sidebar-move-btn must be present inside the wrapper.
    const moveBtn = wrapper!.querySelector(".sidebar-move-btn");
    expect(moveBtn).not.toBeNull();
    expect((moveBtn as HTMLElement).textContent).toBe("⇄");
  });

  it("is a no-op for unknown panelId — does not throw", () => {
    init();
    expect(() => movePanel("nonexistent")).not.toThrow();
  });

  it("old slot stays in DOM (empty) when last panel moves away — eager-slot design", () => {
    // Eager-slot design: the slot DOM element is never removed.
    // When the last panel moves away from a side, the slot stays in the DOM
    // (empty, hidden) — only settings are updated to reflect open: false.
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Confirm right sidebar exists before the move.
    expect(document.getElementById("sidebar-right")).not.toBeNull();

    movePanel("panel-1");

    // Right sidebar must STILL exist in the DOM (not torn down).
    const rightEl = document.getElementById("sidebar-right") as HTMLElement;
    expect(rightEl).not.toBeNull();

    // No panel wrappers should remain in the right slot.
    expect(rightEl.querySelectorAll(".sidebar-panel-wrapper").length).toBe(0);

    // Left sidebar exists and contains the panel.
    const leftEl = document.getElementById("sidebar-left");
    expect(leftEl).not.toBeNull();
    expect(leftEl!.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).not.toBeNull();
  });

  it("saves accordion state to new side slot after movePanel", () => {
    // This test verifies that _setAccordionState uses panel.effectiveSide
    // (not panel.descriptor.side) when persisting accordion state. After a
    // movePanel() call the panel's effectiveSide is "left", but
    // descriptor.side remains "right". Clicking the accordion toggle must
    // write accordionExpanded to sidebar.left.panels["panel-1"], not to
    // sidebar.right.panels["panel-1"].

    init();
    // Register a panel on the right (descriptor.side = "right").
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Move the panel to the left. effectiveSide is now "left".
    movePanel("panel-1");

    // Clear all prior updateSettings calls so only the accordion call is captured.
    mockUpdateSettings.mockClear();

    // Click the accordion toggle to collapse the panel.
    // The toggle button lives inside the wrapper that is now in #sidebar-left.
    const wrapper = document.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]') as HTMLElement;
    const toggleBtn = wrapper.querySelector(".sidebar-accordion-toggle") as HTMLElement;
    toggleBtn.click();

    // updateSettings must have been called at least once (for the accordion persist).
    expect(mockUpdateSettings).toHaveBeenCalled();

    // Run every captured updater and find the one that writes the accordion state.
    // The correct updater will produce sidebar.left.panels["panel-1"].accordionExpanded.
    const calls = mockUpdateSettings.mock.calls as Array<[(s: object) => {
      sidebar: {
        left?: { panels?: Record<string, { accordionExpanded?: boolean }> };
        right?: { panels?: Record<string, { accordionExpanded?: boolean }> };
      };
    }]>;

    // Provide a base settings object that mirrors the state after movePanel:
    // left side exists (panel has been moved there), right side is empty.
    const baseSettings = {
      sidebar: {
        left:  { open: true, activeTabId: "panel-1", width: 220, panels: {} },
        right: { open: false, activeTabId: null, width: 220, panels: {} },
        panelSides: { "panel-1": "left" },
      },
    };

    // Look for an updater whose result places accordionExpanded on the LEFT side.
    const accordionValues = calls
      .map(([updater]) => updater(baseSettings))
      .map((result) => result.sidebar?.left?.panels?.["panel-1"]?.accordionExpanded);

    // Panel starts expanded; clicking once collapses it → accordionExpanded: false.
    expect(accordionValues).toContain(false);

    // Verify the RIGHT side was not written to — would indicate the bug is present.
    const wrongSideValues = calls
      .map(([updater]) => updater(baseSettings))
      .map((result) => result.sidebar?.right?.panels?.["panel-1"]?.accordionExpanded);

    expect(wrongSideValues).not.toContain(false);
  });
});

// ── describe: movePanelToSide ─────────────────────────────────────────────────

describe("SidebarManager — movePanelToSide", () => {
  it("moves panel to the specified side", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Panel is currently on the right. Move explicitly to left.
    movePanelToSide("panel-1", "left");

    const leftEl = document.getElementById("sidebar-left")!;
    expect(leftEl.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).not.toBeNull();

    const rightEl = document.getElementById("sidebar-right")!;
    expect(rightEl.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).toBeNull();
  });

  it("movePanelToSide to same side is a no-op — panel stays, no extra updateSettings calls", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Clear the calls made by register() before testing the same-side no-op.
    mockUpdateSettings.mockClear();

    // Calling movePanelToSide with the current side must be a no-op.
    movePanelToSide("panel-1", "right");

    // No settings writes should have occurred.
    expect(mockUpdateSettings).not.toHaveBeenCalled();

    // Panel must still be in #sidebar-right.
    const rightEl = document.getElementById("sidebar-right")!;
    expect(rightEl.querySelector('.sidebar-panel-wrapper[data-panel-id="panel-1"]')).not.toBeNull();
  });

  it("is a no-op for an unknown panelId — does not throw", () => {
    init();
    expect(() => movePanelToSide("nonexistent", "left")).not.toThrow();
  });

  it("persists panelSides override to settings after movePanelToSide", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    mockUpdateSettings.mockClear();

    movePanelToSide("panel-1", "left");

    // At least one updateSettings call must include panelSides["panel-1"] === "left".
    const calls = mockUpdateSettings.mock.calls as Array<
      [(s: object) => { sidebar: { panelSides?: Record<string, string> } }]
    >;
    const panelSideValues = calls
      .map(([updater]) => updater({ sidebar: { left: {}, right: {}, panelSides: {} } }))
      .map((result) => result.sidebar?.panelSides?.["panel-1"]);

    expect(panelSideValues).toContain("left");
  });
});

// ── describe: icon strip ──────────────────────────────────────────────────────

describe("SidebarManager — icon strip", () => {
  it("register() appends an icon button to the icon strip", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const sidebarEl = document.getElementById("sidebar-right")!;
    const strip = sidebarEl.querySelector(".sidebar-icon-strip");
    expect(strip).not.toBeNull();

    const btn = strip!.querySelector(".sidebar-icon-btn");
    expect(btn).not.toBeNull();
  });

  it("icon button uses descriptor.icon when provided", () => {
    init();
    register("plugin-a", { ...makeDescriptor("panel-1", "right", { title: "Explorer" }), icon: "📁" });

    const btn = document.querySelector(".sidebar-icon-btn")!;
    expect(btn.textContent).toBe("📁");
  });

  it("icon button falls back to title.charAt(0) when icon is absent", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right", { title: "Files" }));

    const btn = document.querySelector(".sidebar-icon-btn")!;
    expect(btn.textContent).toBe("F");
  });

  it("unregister() removes the icon button from the strip", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    expect(document.querySelector(".sidebar-icon-btn")).not.toBeNull();

    unregister("plugin-a", "panel-1");

    expect(document.querySelector(".sidebar-icon-btn")).toBeNull();
  });

  it("clicking icon on iconized panel un-iconizes and activates it", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Pre-iconize by simulating persisted state: set is-iconized on wrapper.
    const wrapper = document.querySelector<HTMLElement>(".sidebar-panel-wrapper")!;
    wrapper.classList.add("is-iconized");
    wrapper.style.display = "none";

    const btn = document.querySelector<HTMLButtonElement>(".sidebar-icon-btn")!;
    btn.click();

    // Panel should be un-iconized and visible.
    expect(wrapper.classList.contains("is-iconized")).toBe(false);
    expect(wrapper.style.display).not.toBe("none");
  });

  it("clicking icon on non-pinned expanded panel iconizes it", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const wrapper = document.querySelector<HTMLElement>(".sidebar-panel-wrapper")!;
    expect(wrapper.classList.contains("is-iconized")).toBe(false);

    const btn = document.querySelector<HTMLButtonElement>(".sidebar-icon-btn")!;
    btn.click();

    expect(wrapper.classList.contains("is-iconized")).toBe(true);
    expect(wrapper.style.display).toBe("none");
  });

  it("clicking icon on pinned panel is a no-op", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: {
          open: true,
          activeTabId: "panel-1",
          width: 220,
          panels: { "panel-1": { accordionExpanded: true, pinned: true } },
        },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const wrapper = document.querySelector<HTMLElement>(".sidebar-panel-wrapper")!;
    const btn = document.querySelector<HTMLButtonElement>(".sidebar-icon-btn")!;
    btn.click();

    // Pinned panel must not become iconized.
    expect(wrapper.classList.contains("is-iconized")).toBe(false);
  });

  it("contentAreaEl is hidden when all panels on a side are iconized", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const contentArea = document.querySelector<HTMLElement>("#sidebar-right .sidebar-content-area")!;

    // Click icon to iconize the single panel.
    const btn = document.querySelector<HTMLButtonElement>(".sidebar-icon-btn")!;
    btn.click();

    expect(contentArea.style.display).toBe("none");
  });

  it("contentAreaEl is restored when a panel is un-iconized", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const contentArea = document.querySelector<HTMLElement>("#sidebar-right .sidebar-content-area")!;
    const btn = document.querySelector<HTMLButtonElement>(".sidebar-icon-btn")!;

    btn.click(); // iconize
    expect(contentArea.style.display).toBe("none");

    btn.click(); // un-iconize
    expect(contentArea.style.display).toBe("");
  });

  it("panel header right-click context menu shows Pin panel option", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const header = document.querySelector<HTMLElement>(".sidebar-panel-header")!;
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));

    const menu = document.querySelector(".sidebar-panel-ctx-menu");
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain("Pin panel");

    // Cleanup
    menu!.remove();
  });

  it("panel header right-click → Pin panel → persists pinned state and adds is-pinned to icon button", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    mockUpdateSettings.mockClear();

    const header = document.querySelector<HTMLElement>(".sidebar-panel-header")!;
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));

    const menuItem = document.querySelector<HTMLElement>(".sidebar-panel-ctx-menu li")!;
    menuItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    // updateSettings should have been called with pinned: true
    expect(mockUpdateSettings).toHaveBeenCalled();
    const calls = mockUpdateSettings.mock.calls as Array<[(s: object) => {
      sidebar: { right: { panels: { "panel-1": { pinned?: boolean } } } };
    }]>;
    const results = calls.map(([updater]) => updater({
      sidebar: { right: { open: true, activeTabId: "panel-1", width: 220, panels: {} } },
    }));
    expect(results.some((r) => r.sidebar?.right?.panels?.["panel-1"]?.pinned === true)).toBe(true);

    // Icon button should have is-pinned class
    const iconBtn = document.querySelector<HTMLButtonElement>(".sidebar-icon-btn")!;
    expect(iconBtn.classList.contains("is-pinned")).toBe(true);

    // Panel wrapper should also have is-pinned (drives the header red dot)
    const wrapper = document.querySelector<HTMLElement>(".sidebar-panel-wrapper")!;
    expect(wrapper.classList.contains("is-pinned")).toBe(true);
  });

  it("iconizeNonPinnedOrToggle iconizes only non-pinned panels", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: {
          open: true,
          activeTabId: "panel-1",
          width: 220,
          panels: {
            "panel-1": { accordionExpanded: true, pinned: true },
            "panel-2": { accordionExpanded: true, pinned: false },
          },
        },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right", { title: "P1" }));
    register("plugin-b", makeDescriptor("panel-2", "right", { title: "P2" }));

    iconizeNonPinnedOrToggle("right");

    const w1 = document.querySelector<HTMLElement>('.sidebar-panel-wrapper[data-panel-id="panel-1"]')!;
    const w2 = document.querySelector<HTMLElement>('.sidebar-panel-wrapper[data-panel-id="panel-2"]')!;

    // panel-1 is pinned — must NOT be iconized.
    expect(w1.classList.contains("is-iconized")).toBe(false);
    // panel-2 is not pinned — must be iconized.
    expect(w2.classList.contains("is-iconized")).toBe(true);
  });

  it("iconizeNonPinnedOrToggle falls back to toggleSide when all panels are pinned", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: {
          open: true,
          activeTabId: "panel-1",
          width: 220,
          panels: { "panel-1": { accordionExpanded: true, pinned: true } },
        },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    // Set slot to visible so toggleSide can close it.
    document.getElementById("sidebar-right")!.style.display = "";

    iconizeNonPinnedOrToggle("right");

    // toggleSide would have toggled the slot visibility.
    expect(document.getElementById("sidebar-right")!.style.display).toBe("none");
  });

  it("restoreFromSettings hides contentAreaEl when all panels are iconized", () => {
    mockGetCurrentSettings.mockReturnValue({
      sidebar: {
        right: {
          open: true,
          activeTabId: "panel-1",
          width: 220,
          panels: { "panel-1": { accordionExpanded: true, iconized: true } },
        },
      },
    });

    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));
    restoreFromSettings();

    const contentArea = document.querySelector<HTMLElement>("#sidebar-right .sidebar-content-area")!;
    expect(contentArea).not.toBeNull();
    expect(contentArea.style.display).toBe("none");
  });

  it("panel wrapper is inside .sidebar-content-area, not directly in the slot root", () => {
    init();
    register("plugin-a", makeDescriptor("panel-1", "right"));

    const sidebarEl = document.getElementById("sidebar-right")!;
    // Direct children of slot root should NOT include panel wrapper.
    const directWrapper = Array.from(sidebarEl.children).find(
      (c) => c.classList.contains("sidebar-panel-wrapper")
    );
    expect(directWrapper).toBeUndefined();

    // Panel wrapper must be inside .sidebar-content-area.
    const contentArea = sidebarEl.querySelector(".sidebar-content-area")!;
    expect(contentArea.querySelector(".sidebar-panel-wrapper")).not.toBeNull();
  });
});
