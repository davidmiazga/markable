/**
 * Unit tests for src/tabs/renderers/vertical-tab-strip.ts — VerticalTabStrip renderer.
 *
 * Validates the carousel layout behaviour:
 *
 *   [sidebar] | #tab-vertical-left | #editor | #tab-vertical-right | [sidebar-right]
 *
 * #tab-vertical-left  — columns for tabs[0..activeIndex] (active is the last column)
 * #tab-vertical-right — columns for tabs[activeIndex+1..end], hidden when empty
 *
 * Acceptance criteria covered:
 *   1.  mount() creates #tab-vertical-left before #editor in #app-row
 *   2.  mount() creates #tab-vertical-right after #editor (before #sidebar-right)
 *   3.  mount() adds "tab-mode-vertical" to the container, hiding #tab-strip
 *   4.  update() puts tabs[0..activeIndex] into left strip; tabs after → right strip
 *   5.  The active column is the last element of the left strip
 *   6.  Active column has aria-selected="true" and class "is-active" (NFR-3)
 *   7.  Right strip is hidden (display:none) when there are no after-tabs
 *   8.  Right strip is visible when there are after-tabs
 *   9.  update() adds is-dirty class to dirty tabs (FR-7)
 *   10. Clicking a column fires onActivate with the correct tab id (FR-3.3)
 *   11. Clicking .tab-close fires onClose (FR-5.2)
 *   12. Clicking .tab-close does NOT fire onActivate (stopPropagation, FR-5.2)
 *   13. destroy() removes both strips from the DOM (NFR-5)
 *   14. destroy() removes "tab-mode-vertical" from the container (NFR-5)
 *   15. destroy() is safe to call when not mounted and idempotent (NFR-5)
 *   16. update() adds "tab-over-limit" to left strip when count exceeds threshold (FR-9)
 *   17. Logs error and aborts when #app-row or #editor is absent
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/tabs/tabs.css", () => ({}));

import { VerticalTabStrip, LEFT_STRIP_ID, RIGHT_STRIP_ID } from "../../src/tabs/renderers/vertical-tab-strip";
import { TAB_SOFT_WARNING_THRESHOLD } from "../../src/tabs/tab-types";
import { makeTab, makeTabs } from "./test-helpers";

/**
 * Standard DOM scaffold used by most suites.
 *
 * #app-row
 *   #sidebar-left   (hidden sibling, mirrors real layout)
 *   #editor         (reference node for left-strip insertion)
 *   #sidebar-right  (reference node for right-strip insertion)
 *
 * #tab-strip (container passed to mount — lives outside #app-row, like in HTML)
 */
function buildDom() {
  const appRow = document.createElement("div");
  appRow.id = "app-row";

  const sidebarLeft = document.createElement("div");
  sidebarLeft.id = "sidebar-left";
  appRow.appendChild(sidebarLeft);

  const editor = document.createElement("div");
  editor.id = "editor";
  appRow.appendChild(editor);

  const sidebarRight = document.createElement("div");
  sidebarRight.id = "sidebar-right";
  appRow.appendChild(sidebarRight);

  document.body.appendChild(appRow);

  const container = document.createElement("div");
  container.id = "tab-strip";
  document.body.appendChild(container);

  return { appRow, editor, sidebarRight, container };
}

function teardownDom() {
  document.getElementById("app-row")?.remove();
  document.getElementById("tab-strip")?.remove();
  // Guard: remove any strips that destroy() may have missed.
  document.getElementById(LEFT_STRIP_ID)?.remove();
  document.getElementById(RIGHT_STRIP_ID)?.remove();
}

// ── mount() ───────────────────────────────────────────────────────────────────

describe("VerticalTabStrip — mount()", () => {
  let appRow: HTMLElement;
  let editor: HTMLElement;
  let sidebarRight: HTMLElement;
  let container: HTMLElement;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    ({ appRow, editor, sidebarRight, container } = buildDom());
    renderer = new VerticalTabStrip(vi.fn(), vi.fn());
  });

  afterEach(() => {
    renderer.destroy();
    teardownDom();
  });

  it("creates #tab-vertical-left inside #app-row (criterion 1)", () => {
    renderer.mount(container, makeTabs(1), 0);
    const left = document.getElementById(LEFT_STRIP_ID);
    expect(left).not.toBeNull();
    expect(appRow.contains(left)).toBe(true);
  });

  it("inserts #tab-vertical-left immediately before #editor (criterion 1)", () => {
    renderer.mount(container, makeTabs(1), 0);
    const left = document.getElementById(LEFT_STRIP_ID);
    expect(left?.nextElementSibling?.id).toBe("editor");
  });

  it("creates #tab-vertical-right inside #app-row (criterion 2)", () => {
    renderer.mount(container, makeTabs(2), 0);
    const right = document.getElementById(RIGHT_STRIP_ID);
    expect(right).not.toBeNull();
    expect(appRow.contains(right)).toBe(true);
  });

  it("inserts #tab-vertical-right immediately before #sidebar-right (criterion 2)", () => {
    renderer.mount(container, makeTabs(2), 0);
    const right = document.getElementById(RIGHT_STRIP_ID);
    expect(right?.nextElementSibling?.id).toBe("sidebar-right");
  });

  it('adds "tab-mode-vertical" to the container (criterion 3)', () => {
    renderer.mount(container, makeTabs(1), 0);
    expect(container.classList.contains("tab-mode-vertical")).toBe(true);
  });

  it('sets role="tablist" on both strips (NFR-3)', () => {
    renderer.mount(container, makeTabs(2), 0);
    expect(document.getElementById(LEFT_STRIP_ID)?.getAttribute("role")).toBe("tablist");
    expect(document.getElementById(RIGHT_STRIP_ID)?.getAttribute("role")).toBe("tablist");
  });

  it("renders tabs immediately after mount (delegates to update())", () => {
    renderer.mount(container, makeTabs(3), 1);
    // Tab 0+1 in left, tab 2 in right
    const leftCols = document.querySelectorAll(`#${LEFT_STRIP_ID} .tab-vertical-col`);
    const rightCols = document.querySelectorAll(`#${RIGHT_STRIP_ID} .tab-vertical-col`);
    expect(leftCols.length).toBe(2);
    expect(rightCols.length).toBe(1);
  });

  it("logs an error and creates no strips when #app-row is absent (criterion 17)", () => {
    appRow.remove();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderer.mount(container, makeTabs(1), 0);

    expect(document.getElementById(LEFT_STRIP_ID)).toBeNull();
    expect(document.getElementById(RIGHT_STRIP_ID)).toBeNull();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
    document.body.appendChild(appRow); // restore for teardown
  });

  it("logs an error and creates no strips when #editor is absent (criterion 17)", () => {
    editor.remove();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderer.mount(container, makeTabs(1), 0);

    expect(document.getElementById(LEFT_STRIP_ID)).toBeNull();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
    appRow.appendChild(editor); // restore for teardown
  });
});

// ── update() — carousel split ─────────────────────────────────────────────────

describe("VerticalTabStrip — update() carousel split (criterion 4–8)", () => {
  let container: HTMLElement;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    ({ container } = buildDom());
    renderer = new VerticalTabStrip(vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(1), 0);
  });

  afterEach(() => {
    renderer.destroy();
    teardownDom();
  });

  it("puts tabs[0..activeIndex] in left strip, tabs after in right strip (criterion 4)", () => {
    // 5 tabs, active = index 2 → left has [0,1,2], right has [3,4]
    renderer.update(makeTabs(5), 2);
    expect(document.querySelectorAll(`#${LEFT_STRIP_ID} .tab-vertical-col`).length).toBe(3);
    expect(document.querySelectorAll(`#${RIGHT_STRIP_ID} .tab-vertical-col`).length).toBe(2);
  });

  it("all tabs in left strip when active is the last tab (criterion 4)", () => {
    const tabs = makeTabs(4);
    renderer.update(tabs, 3); // last tab active
    expect(document.querySelectorAll(`#${LEFT_STRIP_ID} .tab-vertical-col`).length).toBe(4);
    expect(document.querySelectorAll(`#${RIGHT_STRIP_ID} .tab-vertical-col`).length).toBe(0);
  });

  it("only active tab in left strip when active is the first tab (criterion 4)", () => {
    renderer.update(makeTabs(3), 0); // first tab active
    expect(document.querySelectorAll(`#${LEFT_STRIP_ID} .tab-vertical-col`).length).toBe(1);
    expect(document.querySelectorAll(`#${RIGHT_STRIP_ID} .tab-vertical-col`).length).toBe(2);
  });

  it("active column is the last element in the left strip (criterion 5)", () => {
    renderer.update(makeTabs(4), 2);
    const leftCols = document.querySelectorAll<HTMLElement>(`#${LEFT_STRIP_ID} .tab-vertical-col`);
    const last = leftCols[leftCols.length - 1];
    expect(last.classList.contains("is-active")).toBe(true);
  });

  it('active column has aria-selected="true" and class is-active (criterion 6)', () => {
    const tabs = makeTabs(3);
    renderer.update(tabs, 1);
    const leftCols = document.querySelectorAll<HTMLElement>(`#${LEFT_STRIP_ID} .tab-vertical-col`);
    // Column 0 (inactive)
    expect(leftCols[0].getAttribute("aria-selected")).toBe("false");
    expect(leftCols[0].classList.contains("is-active")).toBe(false);
    // Column 1 (active — last in left strip)
    expect(leftCols[1].getAttribute("aria-selected")).toBe("true");
    expect(leftCols[1].classList.contains("is-active")).toBe(true);
  });

  it("right strip is hidden when there are no after-tabs (criterion 7)", () => {
    renderer.update(makeTabs(3), 2); // active is last
    const right = document.getElementById(RIGHT_STRIP_ID) as HTMLElement;
    expect(right.style.display).toBe("none");
  });

  it("right strip is visible when there are after-tabs (criterion 8)", () => {
    renderer.update(makeTabs(3), 0); // active is first, 2 tabs after
    const right = document.getElementById(RIGHT_STRIP_ID) as HTMLElement;
    expect(right.style.display).not.toBe("none");
  });

  it("re-render replaces old columns — no duplicates", () => {
    renderer.update(makeTabs(2), 0);
    renderer.update(makeTabs(4), 1);
    const all = document.querySelectorAll(".tab-vertical-col");
    // Left has [0,1], right has [2,3] → 4 total
    expect(all.length).toBe(4);
  });
});

// ── update() — dirty state & aria ─────────────────────────────────────────────

describe("VerticalTabStrip — update() dirty state & aria", () => {
  let container: HTMLElement;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    ({ container } = buildDom());
    renderer = new VerticalTabStrip(vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(1), 0);
  });

  afterEach(() => {
    renderer.destroy();
    teardownDom();
  });

  it("adds is-dirty class to dirty tabs (criterion 9)", () => {
    const tabs = [
      makeTab({ id: "clean", isDirty: false }),
      makeTab({ id: "dirty", isDirty: true }),
    ];
    renderer.update(tabs, 0); // active=0 (clean), right has dirty
    const rightCol = document.querySelector<HTMLElement>(`#${RIGHT_STRIP_ID} .tab-vertical-col`);
    expect(rightCol?.classList.contains("is-dirty")).toBe(true);
  });

  it("active dirty tab gets is-dirty class in the left strip", () => {
    const tabs = [makeTab({ id: "d", isDirty: true })];
    renderer.update(tabs, 0);
    const activeCol = document.querySelector<HTMLElement>(".tab-vertical-col.is-active");
    expect(activeCol?.classList.contains("is-dirty")).toBe(true);
  });

  it("renders .tab-vertical-text span with the tab title", () => {
    renderer.update([makeTab({ id: "t1", title: "My Note" })], 0);
    const textEl = document.querySelector(".tab-vertical-text");
    expect(textEl?.textContent).toBe("My Note");
  });

  it("renders a .tab-close button inside each column (FR-5.2)", () => {
    renderer.update(makeTabs(3), 1);
    const closeBtns = document.querySelectorAll(".tab-vertical-col .tab-close");
    expect(closeBtns.length).toBe(3);
  });

  it("sets aria-label on each column to the tab title (NFR-3)", () => {
    renderer.update([makeTab({ id: "t1", title: "My Document" })], 0);
    const col = document.querySelector<HTMLElement>(".tab-vertical-col");
    expect(col?.getAttribute("aria-label")).toBe("My Document");
  });

  it("adds tab-over-limit to left strip when count exceeds threshold (criterion 16)", () => {
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD + 1), 0);
    expect(
      document.getElementById(LEFT_STRIP_ID)?.classList.contains("tab-over-limit")
    ).toBe(true);
  });

  it("does NOT add tab-over-limit at exactly the threshold", () => {
    renderer.update(makeTabs(TAB_SOFT_WARNING_THRESHOLD), 0);
    expect(
      document.getElementById(LEFT_STRIP_ID)?.classList.contains("tab-over-limit")
    ).toBe(false);
  });
});

// ── click interactions ────────────────────────────────────────────────────────

describe("VerticalTabStrip — click interactions (criterion 10–12)", () => {
  let container: HTMLElement;
  let onActivate: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    ({ container } = buildDom());
    onActivate = vi.fn();
    onClose = vi.fn();
    renderer = new VerticalTabStrip(
      onActivate as (id: string) => void,
      onClose as (id: string) => void,
    );
  });

  afterEach(() => {
    renderer.destroy();
    teardownDom();
  });

  it("calls onActivate with the correct id when a left-strip column is clicked (criterion 10)", () => {
    const tabs = [
      makeTab({ id: "first", title: "First" }),
      makeTab({ id: "second", title: "Second" }),
    ];
    renderer.mount(container, tabs, 1); // active=1, both in left strip
    const leftCols = document.querySelectorAll<HTMLElement>(`#${LEFT_STRIP_ID} .tab-vertical-col`);
    leftCols[0].click(); // click the inactive column
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith("first");
  });

  it("calls onActivate with the correct id when a right-strip column is clicked (criterion 10)", () => {
    const tabs = [
      makeTab({ id: "active-tab", title: "Active" }),
      makeTab({ id: "right-tab", title: "Right" }),
    ];
    renderer.mount(container, tabs, 0); // active=0, right-tab in right strip
    const rightCol = document.querySelector<HTMLElement>(`#${RIGHT_STRIP_ID} .tab-vertical-col`);
    rightCol?.click();
    expect(onActivate).toHaveBeenCalledWith("right-tab");
  });

  it("calls onClose with the correct id when .tab-close is clicked (criterion 11)", () => {
    const tabs = [makeTab({ id: "close-me", title: "Close Me" })];
    renderer.mount(container, tabs, 0);
    const closeBtn = document.querySelector<HTMLElement>(".tab-vertical-col .tab-close");
    closeBtn?.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("close-me");
  });

  it("does NOT call onActivate when .tab-close is clicked (criterion 12)", () => {
    const tabs = [makeTab({ id: "tab-1" })];
    renderer.mount(container, tabs, 0);
    const closeBtn = document.querySelector<HTMLElement>(".tab-vertical-col .tab-close");
    closeBtn?.click();
    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── destroy() ─────────────────────────────────────────────────────────────────

describe("VerticalTabStrip — destroy() (criterion 13–15)", () => {
  let container: HTMLElement;
  let renderer: VerticalTabStrip;

  beforeEach(() => {
    ({ container } = buildDom());
    renderer = new VerticalTabStrip(vi.fn(), vi.fn());
    renderer.mount(container, makeTabs(3), 1);
  });

  afterEach(() => {
    teardownDom();
  });

  it("removes #tab-vertical-left from the DOM (criterion 13)", () => {
    expect(document.getElementById(LEFT_STRIP_ID)).not.toBeNull();
    renderer.destroy();
    expect(document.getElementById(LEFT_STRIP_ID)).toBeNull();
  });

  it("removes #tab-vertical-right from the DOM (criterion 13)", () => {
    expect(document.getElementById(RIGHT_STRIP_ID)).not.toBeNull();
    renderer.destroy();
    expect(document.getElementById(RIGHT_STRIP_ID)).toBeNull();
  });

  it('removes "tab-mode-vertical" class from container (criterion 14)', () => {
    expect(container.classList.contains("tab-mode-vertical")).toBe(true);
    renderer.destroy();
    expect(container.classList.contains("tab-mode-vertical")).toBe(false);
  });

  it("is safe to call destroy() before mount() — no throw (criterion 15)", () => {
    const fresh = new VerticalTabStrip(vi.fn(), vi.fn());
    expect(() => fresh.destroy()).not.toThrow();
  });

  it("is safe to call destroy() twice — idempotent (criterion 15)", () => {
    renderer.destroy();
    expect(() => renderer.destroy()).not.toThrow();
  });
});
