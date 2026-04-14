/**
 * Unit tests for src/tabs/renderers/regular-tab-bar.ts — RegularTabBar renderer.
 *
 * Covers every acceptance criterion listed in step_03_regular_tab_bar.md:
 *
 * 1. mount() sets role="tablist" on the container (NFR-3)
 * 2. update() renders one .tab-label per tab (FR-3.2)
 * 3. update() marks the active tab with aria-selected="true" (NFR-3)
 * 4. update() shows dirty dot (.is-dirty) on dirty tab (FR-7, FR-3.2)
 * 5. Clicking a tab label fires onActivate with the correct tab id (FR-3.2)
 * 6. Clicking close button fires onClose, NOT onActivate (FR-5.2)
 * 7. Clicking "+" button fires onNew (FR-5.1, FR-3.2)
 * 8. destroy() clears container and removes mode class and role (NFR-5)
 *
 * No Tauri IPC is involved in the renderer — no bridge mocks are needed here.
 * CSS import inside regular-tab-bar.ts is mocked the same way as minimal-tab-bar tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Module-level mocks ────────────────────────────────────────────────────────
// The renderer imports tabs.css. Vite handles CSS imports at bundle time, but
// vitest/happy-dom cannot parse CSS files. We mock it as an empty module so
// the import does not throw.
vi.mock("../../src/tabs/tabs.css", () => ({}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { RegularTabBar } from "../../src/tabs/renderers/regular-tab-bar";
import type { TabEntry } from "../../src/tabs/tab-types";
import { TAB_SOFT_WARNING_THRESHOLD } from "../../src/tabs/tab-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a minimal TabEntry stub suitable for renderer tests.
 *
 * @param overrides  Partial fields to override the defaults.
 */
function makeTab(overrides: Partial<TabEntry> = {}): TabEntry {
  return {
    id: crypto.randomUUID(),
    filePath: null,
    title: "Untitled",
    isDirty: false,
    // doc is empty string — renderers only read id, title, filePath, isDirty.
    doc: "",
    scrollTop: 0,
    ...overrides,
  };
}

/**
 * Creates an array of n minimal TabEntry stubs.
 * Used for multi-tab tests where individual tab properties are not important.
 *
 * @param n  Number of tabs to create.
 */
function makeTabs(n: number): TabEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeTab({ title: `Tab ${i + 1}`, id: `tab-id-${i}` })
  );
}

// ── Test suite: mount() ───────────────────────────────────────────────────────

describe("RegularTabBar — mount()", () => {
  let container: HTMLElement;
  let renderer: RegularTabBar;
  let onActivate: (id: string) => void;
  let onClose: (id: string) => void;
  let onNew: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onActivate = vi.fn() as unknown as (id: string) => void;
    onClose = vi.fn() as unknown as (id: string) => void;
    onNew = vi.fn() as unknown as () => void;
    renderer = new RegularTabBar(onActivate, onClose, onNew);
  });

  afterEach(() => {
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('sets role="tablist" on the container (NFR-3)', () => {
    renderer.mount(container, makeTabs(1), 0);
    expect(container.getAttribute("role")).toBe("tablist");
  });

  it('adds class "tab-mode-regular" to the container', () => {
    renderer.mount(container, makeTabs(1), 0);
    expect(container.classList.contains("tab-mode-regular")).toBe(true);
  });

  it("renders a .tab-bar-inner element inside the container", () => {
    renderer.mount(container, makeTabs(1), 0);
    const inner = container.querySelector(".tab-bar-inner");
    expect(inner).not.toBeNull();
  });

  it("renders a .tab-new-btn (+ button) after the inner container", () => {
    renderer.mount(container, makeTabs(1), 0);
    const newBtn = container.querySelector(".tab-new-btn");
    expect(newBtn).not.toBeNull();
  });

  it("renders tabs immediately after mount (delegates to update)", () => {
    const tabs = makeTabs(2);
    renderer.mount(container, tabs, 0);
    const labels = container.querySelectorAll(".tab-label");
    expect(labels.length).toBe(2);
  });
});

// ── Test suite: update() ──────────────────────────────────────────────────────

describe("RegularTabBar — update()", () => {
  let container: HTMLElement;
  let renderer: RegularTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new RegularTabBar(vi.fn(), vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(1), 0);
  });

  afterEach(() => {
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("renders exactly one .tab-label per tab (FR-3.2)", () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 0);
    const labels = container.querySelectorAll(".tab-label");
    expect(labels.length).toBe(3);
  });

  it('marks the active tab with aria-selected="true" (NFR-3)', () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 1); // middle tab is active
    const labels = container.querySelectorAll<HTMLElement>(".tab-label");
    expect(labels[0].getAttribute("aria-selected")).toBe("false");
    expect(labels[1].getAttribute("aria-selected")).toBe("true");
    expect(labels[2].getAttribute("aria-selected")).toBe("false");
  });

  it("marks only the active tab when index is 0", () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 0);
    const labels = container.querySelectorAll<HTMLElement>(".tab-label");
    expect(labels[0].getAttribute("aria-selected")).toBe("true");
    expect(labels[1].getAttribute("aria-selected")).toBe("false");
    expect(labels[2].getAttribute("aria-selected")).toBe("false");
  });

  it("marks a dirty tab with .is-dirty class (FR-7)", () => {
    const tabs = [
      makeTab({ id: "clean", title: "Clean", isDirty: false }),
      makeTab({ id: "dirty", title: "Dirty", isDirty: true }),
    ];
    renderer.update(tabs, 0);
    const labels = container.querySelectorAll<HTMLElement>(".tab-label");
    expect(labels[0].classList.contains("is-dirty")).toBe(false);
    expect(labels[1].classList.contains("is-dirty")).toBe(true);
  });

  it("shows .tab-label-dirty element (dirty dot) on dirty tab", () => {
    const tabs = [
      makeTab({ id: "dirty", title: "Dirty", isDirty: true }),
    ];
    renderer.update(tabs, 0);
    // The dirty dot span should exist in the first (dirty) tab label.
    const dirtyDot = container.querySelector(".tab-label .tab-label-dirty");
    expect(dirtyDot).not.toBeNull();
  });

  it("renders a .tab-label-text span with the tab title inside each label", () => {
    const tabs = [makeTab({ id: "t1", title: "My Note" })];
    renderer.update(tabs, 0);
    const textEl = container.querySelector<HTMLElement>(".tab-label-text");
    expect(textEl?.textContent).toBe("My Note");
  });

  it("renders a .tab-close button inside each tab label", () => {
    renderer.update(makeTabs(2), 0);
    const closeBtns = container.querySelectorAll(".tab-close");
    expect(closeBtns.length).toBe(2);
  });

  it("re-render replaces old labels (no duplicate elements)", () => {
    renderer.update(makeTabs(2), 0);
    renderer.update(makeTabs(4), 0);
    const labels = container.querySelectorAll(".tab-label");
    expect(labels.length).toBe(4);
  });

  it("adds tab-over-limit class to .tab-new-btn when tab count exceeds threshold (FR-9)", () => {
    const tabs = makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1);
    renderer.update(tabs, 0);
    const newBtn = container.querySelector(".tab-new-btn");
    expect(newBtn?.classList.contains("tab-over-limit")).toBe(true);
  });

  it("does NOT add tab-over-limit class at exactly the threshold", () => {
    const tabs = makeTabs(TAB_SOFT_WARNING_THRESHOLD);
    renderer.update(tabs, 0);
    const newBtn = container.querySelector(".tab-new-btn");
    expect(newBtn?.classList.contains("tab-over-limit")).toBe(false);
  });

  it("sets aria-label on outer tab button to the tab title (NFR-3)", () => {
    const tabs = [makeTab({ title: "My Document" })];
    renderer.update(tabs, 0);
    const label = container.querySelector<HTMLElement>(".tab-label");
    expect(label?.getAttribute("aria-label")).toBe("My Document");
  });
});

// ── Test suite: click interactions ────────────────────────────────────────────

describe("RegularTabBar — click interactions (FR-3.2, FR-5.1, FR-5.2)", () => {
  let container: HTMLElement;
  let onActivate: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let onNew: ReturnType<typeof vi.fn>;
  let renderer: RegularTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onActivate = vi.fn();
    onClose = vi.fn();
    onNew = vi.fn();
    renderer = new RegularTabBar(
      onActivate as (id: string) => void,
      onClose as (id: string) => void,
      onNew as () => void,
    );
  });

  afterEach(() => {
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("calls onActivate with correct tab id when a tab label is clicked (FR-3.2)", () => {
    const tabs = [
      makeTab({ id: "first-tab", title: "First" }),
      makeTab({ id: "second-tab", title: "Second" }),
    ];
    renderer.mount(container, tabs, 0);
    const labels = container.querySelectorAll<HTMLElement>(".tab-label");
    labels[1].click();
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith("second-tab");
  });

  it("calls onActivate for the first tab label when clicked", () => {
    const tabs = [makeTab({ id: "only-tab", title: "Only" })];
    renderer.mount(container, tabs, 0);
    const label = container.querySelector<HTMLElement>(".tab-label");
    label?.click();
    expect(onActivate).toHaveBeenCalledWith("only-tab");
  });

  it("calls onClose with the correct tab id when close button is clicked (FR-5.2)", () => {
    const tabs = [
      makeTab({ id: "close-me", title: "Close Me" }),
    ];
    renderer.mount(container, tabs, 0);
    const closeBtn = container.querySelector<HTMLElement>(".tab-close");
    closeBtn?.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("close-me");
  });

  it("does NOT call onActivate when close button is clicked (FR-5.2 stopPropagation)", () => {
    const tabs = [
      makeTab({ id: "tab-1", title: "Tab 1" }),
    ];
    renderer.mount(container, tabs, 0);
    const closeBtn = container.querySelector<HTMLElement>(".tab-close");
    closeBtn?.click();
    // onActivate must NOT have been called — stopPropagation guards against this.
    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onNew when the + button is clicked (FR-5.1)", () => {
    renderer.mount(container, makeTabs(1), 0);
    const newBtn = container.querySelector<HTMLElement>(".tab-new-btn");
    newBtn?.click();
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("uses buttons (keyboard-accessible) for tab labels", () => {
    renderer.mount(container, makeTabs(2), 0);
    const buttons = container.querySelectorAll("button.tab-label");
    expect(buttons.length).toBe(2);
  });
});

// ── Test suite: destroy() ─────────────────────────────────────────────────────

describe("RegularTabBar — destroy() (NFR-5)", () => {
  let container: HTMLElement;
  let renderer: RegularTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new RegularTabBar(vi.fn(), vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(2), 0);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("clears container innerHTML after destroy()", () => {
    expect(container.innerHTML).not.toBe("");
    renderer.destroy();
    expect(container.innerHTML).toBe("");
  });

  it('removes "tab-mode-regular" class from container after destroy()', () => {
    renderer.destroy();
    expect(container.classList.contains("tab-mode-regular")).toBe(false);
  });

  it('removes role="tablist" from container after destroy()', () => {
    renderer.destroy();
    expect(container.getAttribute("role")).toBeNull();
  });

  it("is safe to call destroy() when not mounted (no-op / no throw)", () => {
    const fresh = new RegularTabBar(vi.fn(), vi.fn(), vi.fn());
    // destroy() before mount() should not throw.
    expect(() => fresh.destroy()).not.toThrow();
  });
});
