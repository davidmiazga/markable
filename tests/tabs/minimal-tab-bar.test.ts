/**
 * Unit tests for src/tabs/renderers/minimal-tab-bar.ts — MinimalTabBar renderer.
 *
 * Covers every acceptance criterion listed in step_02_minimal_tab_bar.md:
 *
 * 1. mount() sets role="tablist" on the container (NFR-3)
 * 2. update() renders one .tab-dot per tab (FR-3.1)
 * 3. update() marks the active tab with aria-selected="true" (NFR-3)
 * 4. update() marks a dirty tab with .is-dirty class (FR-7)
 * 5. update() adds "tab-over-limit" class when tab count exceeds threshold (FR-9)
 * 6. Clicking a dot calls the onActivate callback with the correct tab id (FR-3.1)
 * 7. destroy() clears container innerHTML (NFR-5)
 * 8. destroy() removes the tooltip element from document.body (NFR-5)
 *
 * The CSS import inside minimal-tab-bar.ts is mocked globally in vitest setup
 * via ?inline so it does not throw in the happy-dom environment.
 *
 * No Tauri IPC is involved in the renderer — no bridge mocks are needed here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Module-level mocks ────────────────────────────────────────────────────────
// The renderer imports tabs.css. Vite handles CSS imports at bundle time, but
// vitest/happy-dom cannot parse CSS files. We mock the CSS file as an empty
// module so the import does not throw.
vi.mock("../../src/tabs/tabs.css", () => ({}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { MinimalTabBar } from "../../src/tabs/renderers/minimal-tab-bar";
import { TAB_SOFT_WARNING_THRESHOLD } from "../../src/tabs/tab-types";
import { makeTab, makeTabs } from "./test-helpers";

// ── Test suite ────────────────────────────────────────────────────────────────

describe("MinimalTabBar — mount()", () => {
  let container: HTMLElement;
  let renderer: MinimalTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new MinimalTabBar(vi.fn());
  });

  afterEach(() => {
    // Clean up to prevent DOM state leaking between tests.
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('sets role="tablist" on the container (NFR-3)', () => {
    renderer.mount(container, makeTabs(1), 0);
    expect(container.getAttribute("role")).toBe("tablist");
  });

  it('adds class "tab-mode-minimal" to the container', () => {
    renderer.mount(container, makeTabs(1), 0);
    expect(container.classList.contains("tab-mode-minimal")).toBe(true);
  });

  it("renders dots immediately after mount (delegates to update)", () => {
    const tabs = makeTabs(2);
    renderer.mount(container, tabs, 0);
    const dots = container.querySelectorAll(".tab-dot");
    expect(dots.length).toBe(2);
  });
});

describe("MinimalTabBar — update()", () => {
  let container: HTMLElement;
  let renderer: MinimalTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new MinimalTabBar(vi.fn());
    renderer.mount(container, makeTabs(1), 0);
  });

  afterEach(() => {
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("renders exactly one .tab-dot per tab (FR-3.1)", () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 0);
    const dots = container.querySelectorAll(".tab-dot");
    expect(dots.length).toBe(3);
  });

  it('marks the active tab dot with aria-selected="true" (NFR-3)', () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 1); // middle tab is active
    const dots = container.querySelectorAll<HTMLElement>(".tab-dot");
    expect(dots[0].getAttribute("aria-selected")).toBe("false");
    expect(dots[1].getAttribute("aria-selected")).toBe("true");
    expect(dots[2].getAttribute("aria-selected")).toBe("false");
  });

  it("marks only the active tab when index is 0", () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 0);
    const dots = container.querySelectorAll<HTMLElement>(".tab-dot");
    expect(dots[0].getAttribute("aria-selected")).toBe("true");
    expect(dots[1].getAttribute("aria-selected")).toBe("false");
    expect(dots[2].getAttribute("aria-selected")).toBe("false");
  });

  it("marks a dirty tab with .is-dirty class (FR-7)", () => {
    const tabs = [
      makeTab({ id: "clean", title: "Clean", isDirty: false }),
      makeTab({ id: "dirty", title: "Dirty", isDirty: true }),
    ];
    renderer.update(tabs, 0);
    const dots = container.querySelectorAll<HTMLElement>(".tab-dot");
    expect(dots[0].classList.contains("is-dirty")).toBe(false);
    expect(dots[1].classList.contains("is-dirty")).toBe(true);
  });

  it("sets aria-label to tab title on each dot (NFR-3)", () => {
    const tabs = [makeTab({ title: "My Note" })];
    renderer.update(tabs, 0);
    const dot = container.querySelector<HTMLElement>(".tab-dot");
    expect(dot?.getAttribute("aria-label")).toBe("My Note");
  });

  it("adds tab-over-limit class when tab count exceeds threshold (FR-9)", () => {
    // Create one more tab than the threshold to trigger the warning.
    const tabs = makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1);
    renderer.update(tabs, 0);
    expect(container.classList.contains("tab-over-limit")).toBe(true);
  });

  it("does NOT add tab-over-limit class at exactly the threshold", () => {
    const tabs = makeTabs(TAB_SOFT_WARNING_THRESHOLD);
    renderer.update(tabs, 0);
    // Exactly at threshold: no warning yet (spec says > threshold).
    expect(container.classList.contains("tab-over-limit")).toBe(false);
  });

  it("sets data-tab-warning when over limit", () => {
    const tabs = makeTabs(TAB_SOFT_WARNING_THRESHOLD + 5);
    renderer.update(tabs, 0);
    expect(container.dataset.tabWarning).toContain("tabs open");
  });

  it("re-render with new tabs replaces old dots (no duplicate elements)", () => {
    renderer.update(makeTabs(2), 0);
    renderer.update(makeTabs(4), 0);
    const dots = container.querySelectorAll(".tab-dot");
    expect(dots.length).toBe(4);
  });
});

describe("MinimalTabBar — click interaction (FR-3.1)", () => {
  let container: HTMLElement;
  let onActivate: (id: string) => void;
  let renderer: MinimalTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // Cast through unknown so the mock satisfies the typed callback signature.
    onActivate = vi.fn() as unknown as (id: string) => void;
    renderer = new MinimalTabBar(onActivate);
  });

  afterEach(() => {
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("calls onActivate with the correct tab id when a dot is clicked", () => {
    const tabs = [
      makeTab({ id: "first-tab", title: "First" }),
      makeTab({ id: "second-tab", title: "Second" }),
    ];
    renderer.mount(container, tabs, 0);
    const dots = container.querySelectorAll<HTMLElement>(".tab-dot");
    dots[1].click();
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith("second-tab");
  });

  it("calls onActivate for the first dot when clicked", () => {
    const tabs = [makeTab({ id: "only-tab", title: "Only" })];
    renderer.mount(container, tabs, 0);
    const dot = container.querySelector<HTMLElement>(".tab-dot");
    dot?.click();
    expect(onActivate).toHaveBeenCalledWith("only-tab");
  });

  it("uses buttons (keyboard-accessible) for each dot", () => {
    renderer.mount(container, makeTabs(2), 0);
    const buttons = container.querySelectorAll("button.tab-dot");
    expect(buttons.length).toBe(2);
  });
});

describe("MinimalTabBar — destroy() (NFR-5)", () => {
  let container: HTMLElement;
  let renderer: MinimalTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new MinimalTabBar(vi.fn());
    renderer.mount(container, makeTabs(2), 0);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("clears container innerHTML after destroy()", () => {
    // Verify there is content before destroy.
    expect(container.innerHTML).not.toBe("");
    renderer.destroy();
    expect(container.innerHTML).toBe("");
  });

  it('removes "tab-mode-minimal" class from container after destroy()', () => {
    renderer.destroy();
    expect(container.classList.contains("tab-mode-minimal")).toBe(false);
  });

  it('removes role="tablist" from container after destroy()', () => {
    renderer.destroy();
    expect(container.getAttribute("role")).toBeNull();
  });

  it("removes the tooltip element from document.body after destroy()", () => {
    // The renderer appends a tooltip div to document.body on mount.
    // After destroy() it must be removed so there is no dangling element.
    renderer.destroy();
    const tooltip = document.body.querySelector("#tab-tooltip");
    expect(tooltip).toBeNull();
  });
});

describe("MinimalTabBar — tooltip element in DOM", () => {
  let container: HTMLElement;
  let renderer: MinimalTabBar;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = new MinimalTabBar(vi.fn());
  });

  afterEach(() => {
    renderer.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("adds a #tab-tooltip element to document.body after mount()", () => {
    renderer.mount(container, makeTabs(1), 0);
    const tooltip = document.body.querySelector("#tab-tooltip");
    expect(tooltip).not.toBeNull();
  });

  it("does not create duplicate tooltip elements on repeated mount() calls", () => {
    // Calling destroy() and mount() again should only result in one tooltip.
    renderer.mount(container, makeTabs(1), 0);
    renderer.destroy();
    renderer.mount(container, makeTabs(1), 0);
    const tooltips = document.body.querySelectorAll("#tab-tooltip");
    expect(tooltips.length).toBe(1);
  });
});
