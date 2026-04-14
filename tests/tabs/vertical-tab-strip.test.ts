/**
 * Unit tests for src/tabs/renderers/vertical-tab-strip.ts — VerticalTabStrip renderer.
 *
 * Covers every acceptance criterion listed in step_04_vertical_tab_strip.md:
 *
 * 1. mount() creates #tab-vertical-strip as first child of #app-row (FR-3.3)
 * 2. mount() adds class "tab-mode-vertical" to the container, hiding #tab-strip (FR-3.3)
 * 3. update() renders exactly one .tab-vertical-item per tab (FR-3.3)
 * 4. update() marks the active tab with aria-selected="true" (NFR-3)
 * 5. update() adds "is-dirty" class to dirty tabs (FR-7, FR-3.3)
 * 6. Clicking a .tab-vertical-item fires onActivate with the correct tab id (FR-3.3)
 * 7. Clicking the .tab-close button fires onClose (FR-5.2)
 * 8. destroy() removes #tab-vertical-strip from the DOM (NFR-5)
 * 9. destroy() removes "tab-mode-vertical" from the container (NFR-5)
 * 10. update() adds "tab-over-limit" class to strip when tab count exceeds threshold (FR-9)
 *
 * No Tauri IPC is involved in the renderer — no bridge mocks are needed here.
 * CSS import inside vertical-tab-strip.ts is mocked the same way as other renderer tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Module-level mocks ────────────────────────────────────────────────────────
// The renderer imports tabs.css. Vite handles CSS imports at bundle time, but
// vitest/happy-dom cannot parse CSS files. We mock it as an empty module so
// the import does not throw.
vi.mock("../../src/tabs/tabs.css", () => ({}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { VerticalTabStrip } from "../../src/tabs/renderers/vertical-tab-strip";
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

describe("VerticalTabStrip — mount()", () => {
  let appRow: HTMLElement;
  let container: HTMLElement;
  let renderer: VerticalTabStrip;
  let onActivate: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create a realistic DOM tree: #app-row and #tab-strip (container).
    appRow = document.createElement("div");
    appRow.id = "app-row";
    document.body.appendChild(appRow);

    container = document.createElement("div");
    container.id = "tab-strip";
    // #tab-strip is NOT inside #app-row in the real layout; it sits above #app.
    // The renderer looks up #app-row by id, not via container's parent.
    document.body.appendChild(container);

    onActivate = vi.fn();
    onClose = vi.fn();
    renderer = new VerticalTabStrip(
      onActivate as (id: string) => void,
      onClose as (id: string) => void,
    );
  });

  afterEach(() => {
    renderer.destroy();
    // Clean up DOM created in beforeEach so tests do not bleed into each other.
    appRow.remove();
    container.remove();
    // Guard: remove any orphaned #tab-vertical-strip that destroy() may have missed.
    document.getElementById("tab-vertical-strip")?.remove();
  });

  it("creates #tab-vertical-strip element in #app-row (FR-3.3)", () => {
    renderer.mount(container, makeTabs(1), 0);
    const strip = document.getElementById("tab-vertical-strip");
    expect(strip).not.toBeNull();
    expect(appRow.contains(strip)).toBe(true);
  });

  it("inserts #tab-vertical-strip as the first child of #app-row (FR-3.3)", () => {
    // Add a sibling element to #app-row so we can verify insertion position.
    const sibling = document.createElement("div");
    sibling.id = "editor";
    appRow.appendChild(sibling);

    renderer.mount(container, makeTabs(1), 0);

    const firstChild = appRow.firstElementChild;
    expect(firstChild?.id).toBe("tab-vertical-strip");
  });

  it('sets role="tablist" on #tab-vertical-strip (NFR-3)', () => {
    renderer.mount(container, makeTabs(1), 0);
    const strip = document.getElementById("tab-vertical-strip");
    expect(strip?.getAttribute("role")).toBe("tablist");
  });

  it('adds class "tab-mode-vertical" to the container, hiding #tab-strip (FR-3.3)', () => {
    renderer.mount(container, makeTabs(1), 0);
    expect(container.classList.contains("tab-mode-vertical")).toBe(true);
  });

  it("renders tabs immediately after mount (delegates to update)", () => {
    const tabs = makeTabs(2);
    renderer.mount(container, tabs, 0);
    const items = document.querySelectorAll(".tab-vertical-item");
    expect(items.length).toBe(2);
  });

  it("logs an error and returns without creating the strip when #app-row is absent", () => {
    // Remove #app-row to simulate a missing element.
    appRow.remove();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderer.mount(container, makeTabs(1), 0);

    expect(document.getElementById("tab-vertical-strip")).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    // Re-attach appRow so afterEach cleanup does not fail.
    document.body.appendChild(appRow);
  });
});

// ── Test suite: update() ──────────────────────────────────────────────────────

describe("VerticalTabStrip — update()", () => {
  let appRow: HTMLElement;
  let container: HTMLElement;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    appRow = document.createElement("div");
    appRow.id = "app-row";
    document.body.appendChild(appRow);

    container = document.createElement("div");
    container.id = "tab-strip";
    document.body.appendChild(container);

    renderer = new VerticalTabStrip(vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(1), 0);
  });

  afterEach(() => {
    renderer.destroy();
    appRow.remove();
    container.remove();
    document.getElementById("tab-vertical-strip")?.remove();
  });

  it("renders exactly one .tab-vertical-item per tab (FR-3.3)", () => {
    renderer.update(makeTabs(3), 0);
    const items = document.querySelectorAll(".tab-vertical-item");
    expect(items.length).toBe(3);
  });

  it('marks the active tab with aria-selected="true" (NFR-3)', () => {
    renderer.update(makeTabs(3), 1); // middle tab is active
    const items = document.querySelectorAll<HTMLElement>(".tab-vertical-item");
    expect(items[0].getAttribute("aria-selected")).toBe("false");
    expect(items[1].getAttribute("aria-selected")).toBe("true");
    expect(items[2].getAttribute("aria-selected")).toBe("false");
  });

  it("marks only the first tab when activeIndex is 0", () => {
    renderer.update(makeTabs(3), 0);
    const items = document.querySelectorAll<HTMLElement>(".tab-vertical-item");
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    expect(items[1].getAttribute("aria-selected")).toBe("false");
    expect(items[2].getAttribute("aria-selected")).toBe("false");
  });

  it("adds is-dirty class to dirty tabs (FR-7, FR-3.3)", () => {
    const tabs = [
      makeTab({ id: "clean", title: "Clean", isDirty: false }),
      makeTab({ id: "dirty", title: "Dirty", isDirty: true }),
    ];
    renderer.update(tabs, 0);
    const items = document.querySelectorAll<HTMLElement>(".tab-vertical-item");
    expect(items[0].classList.contains("is-dirty")).toBe(false);
    expect(items[1].classList.contains("is-dirty")).toBe(true);
  });

  it("renders a .tab-vertical-text span with the tab title (FR-3.3)", () => {
    const tabs = [makeTab({ id: "t1", title: "My Note" })];
    renderer.update(tabs, 0);
    const textEl = document.querySelector<HTMLElement>(".tab-vertical-text");
    expect(textEl?.textContent).toBe("My Note");
  });

  it("renders a .tab-close button inside each item (FR-5.2)", () => {
    renderer.update(makeTabs(2), 0);
    const closeBtns = document.querySelectorAll(
      ".tab-vertical-item .tab-close"
    );
    expect(closeBtns.length).toBe(2);
  });

  it("sets aria-label on each item to the tab title (NFR-3)", () => {
    const tabs = [makeTab({ id: "t1", title: "My Document" })];
    renderer.update(tabs, 0);
    const item = document.querySelector<HTMLElement>(".tab-vertical-item");
    expect(item?.getAttribute("aria-label")).toBe("My Document");
  });

  it("re-render replaces old items (no duplicate elements)", () => {
    renderer.update(makeTabs(2), 0);
    renderer.update(makeTabs(4), 0);
    const items = document.querySelectorAll(".tab-vertical-item");
    expect(items.length).toBe(4);
  });

  it("adds tab-over-limit class to strip when tab count exceeds threshold (FR-9)", () => {
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    const strip = document.getElementById("tab-vertical-strip");
    expect(strip?.classList.contains("tab-over-limit")).toBe(true);
  });

  it("does NOT add tab-over-limit class at exactly the threshold", () => {
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    const strip = document.getElementById("tab-vertical-strip");
    expect(strip?.classList.contains("tab-over-limit")).toBe(false);
  });
});

// ── Test suite: click interactions ────────────────────────────────────────────

describe("VerticalTabStrip — click interactions (FR-3.3, FR-5.2)", () => {
  let appRow: HTMLElement;
  let container: HTMLElement;
  let onActivate: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    appRow = document.createElement("div");
    appRow.id = "app-row";
    document.body.appendChild(appRow);

    container = document.createElement("div");
    container.id = "tab-strip";
    document.body.appendChild(container);

    onActivate = vi.fn();
    onClose = vi.fn();
    renderer = new VerticalTabStrip(
      onActivate as (id: string) => void,
      onClose as (id: string) => void,
    );
  });

  afterEach(() => {
    renderer.destroy();
    appRow.remove();
    container.remove();
    document.getElementById("tab-vertical-strip")?.remove();
  });

  it("calls onActivate with the correct tab id when a .tab-vertical-item is clicked (FR-3.3)", () => {
    const tabs = [
      makeTab({ id: "first-tab", title: "First" }),
      makeTab({ id: "second-tab", title: "Second" }),
    ];
    renderer.mount(container, tabs, 0);
    const items = document.querySelectorAll<HTMLElement>(".tab-vertical-item");
    items[1].click();
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith("second-tab");
  });

  it("calls onClose with the correct tab id when .tab-close is clicked (FR-5.2)", () => {
    const tabs = [makeTab({ id: "close-me", title: "Close Me" })];
    renderer.mount(container, tabs, 0);
    const closeBtn = document.querySelector<HTMLElement>(
      ".tab-vertical-item .tab-close"
    );
    closeBtn?.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("close-me");
  });

  it("does NOT call onActivate when .tab-close is clicked (stopPropagation, FR-5.2)", () => {
    const tabs = [makeTab({ id: "tab-1", title: "Tab 1" })];
    renderer.mount(container, tabs, 0);
    const closeBtn = document.querySelector<HTMLElement>(
      ".tab-vertical-item .tab-close"
    );
    closeBtn?.click();
    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── Test suite: destroy() ─────────────────────────────────────────────────────

describe("VerticalTabStrip — destroy() (NFR-5)", () => {
  let appRow: HTMLElement;
  let container: HTMLElement;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    appRow = document.createElement("div");
    appRow.id = "app-row";
    document.body.appendChild(appRow);

    container = document.createElement("div");
    container.id = "tab-strip";
    document.body.appendChild(container);

    renderer = new VerticalTabStrip(vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(2), 0);
  });

  afterEach(() => {
    appRow.remove();
    container.remove();
    document.getElementById("tab-vertical-strip")?.remove();
  });

  it("removes #tab-vertical-strip from the DOM after destroy() (NFR-5)", () => {
    expect(document.getElementById("tab-vertical-strip")).not.toBeNull();
    renderer.destroy();
    expect(document.getElementById("tab-vertical-strip")).toBeNull();
  });

  it('removes "tab-mode-vertical" class from container after destroy() (NFR-5)', () => {
    expect(container.classList.contains("tab-mode-vertical")).toBe(true);
    renderer.destroy();
    expect(container.classList.contains("tab-mode-vertical")).toBe(false);
  });

  it("is safe to call destroy() when not mounted (no-op, no throw)", () => {
    const fresh = new VerticalTabStrip(vi.fn(), vi.fn());
    expect(() => fresh.destroy()).not.toThrow();
  });

  it("is safe to call destroy() twice (idempotent)", () => {
    renderer.destroy();
    expect(() => renderer.destroy()).not.toThrow();
  });
});
