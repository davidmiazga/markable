/**
 * Vitest tests for src/editor/find-widget.ts (FindWidget).
 *
 * Tests are grouped by functional area:
 *   Group 1:  Construction and lifecycle
 *   Group 2:  open() behavior
 *   Group 3:  close() behavior
 *   Group 4:  clearQuery()
 *   Group 5:  setPreFill()
 *   Group 6:  Toggle button state (matchCase, wholeWord, regexp)
 *   Group 7:  Keyboard handlers in the find input
 *   Group 8:  Escape key handler
 *   Group 9:  Chevron toggle (replace row expand/collapse)
 *   Group 10: Navigation and replace button dispatches
 *   Group 11: Close button
 *   Group 12: Count label state (EC-3, EC-4, EC-6, EC-7)
 *   Group 13: Position persistence (FR-8, EC-23, EC-26, TC-6)
 *   Group 14: Settings schema assertions
 *   Group 15: Viewport clamping via drag (FR-7.6, EC-21, EC-22)
 *
 * Constraint: happy-dom provides a DOM but CM6's EditorView cannot be
 * instantiated without a real browser layout engine. All CM6 commands and
 * settings IPC are mocked. DOM manipulation, event handling, open/close state,
 * toggle state, and position logic are fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Module-level mocks — must be defined BEFORE imports
// ---------------------------------------------------------------------------

// Mock Tauri APIs (required transitively by settings.ts)
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

// Mock settings module — FindWidget calls getCurrentSettings() and updateSettings()
vi.mock("../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({ findWidget: null })),
  updateSettings: vi.fn(() => Promise.resolve()),
}));

// Mock @codemirror/search — commands require a live CM6 EditorState which is
// not available in happy-dom. SearchQuery.valid flag is controlled by opts.
//
// IMPORTANT: SearchQuery must be a real constructor function (not an arrow
// function) because find-widget.ts calls `new SearchQuery(...)`. Arrow
// functions cannot be called with `new` in JavaScript.
vi.mock("@codemirror/search", () => {
  // Constructor function (not arrow) so `new SearchQuery(opts)` works.
  function SearchQueryMock(this: Record<string, unknown>, opts: Record<string, unknown>) {
    this.search = opts.search ?? "";
    this.caseSensitive = opts.caseSensitive ?? false;
    this.wholeWord = opts.wholeWord ?? false;
    this.regexp = opts.regexp ?? false;
    this.replace = opts.replace ?? "";
    // Simulate invalid=true when the search looks like an invalid regexp.
    // "[invalid" is the canonical invalid-regexp test value in the spec.
    this.valid = !(opts.regexp && typeof opts.search === "string" && opts.search === "[invalid");
    // Default getCursor: returns no matches (done: true immediately).
    this.getCursor = vi.fn(() => ({
      next: vi.fn(() => ({ done: true })),
      value: { to: 0 },
    }));
  }

  return {
    SearchQuery: vi.fn().mockImplementation(function(this: Record<string, unknown>, opts: Record<string, unknown>) {
      SearchQueryMock.call(this, opts);
    }),
    setSearchQuery: { of: vi.fn(() => ({ type: "setSearchQuery" })) },
    getSearchQuery: vi.fn(),
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    replaceNext: vi.fn(() => true),
    replaceAll: vi.fn(() => true),
    search: vi.fn(() => ({})),
    searchKeymap: [],
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFindWidget } from "../src/editor/find-widget";
import type { FindWidget } from "../src/editor/find-widget";

// ---------------------------------------------------------------------------
// Helper: makeViewMock()
//
// Creates a minimal EditorView mock satisfying FindWidget's runtime usage.
// All CM6 methods that FindWidget calls are represented as vi.fn() stubs.
// ---------------------------------------------------------------------------

function makeViewMock(
  overrides: Partial<{
    selFrom: number;
    selTo: number;
    docText: string;
  }> = {}
) {
  const { selFrom = 0, selTo = 0, docText = "" } = overrides;
  return {
    focus: vi.fn(),
    dispatch: vi.fn(),
    state: {
      selection: { main: { from: selFrom, to: selTo } },
      doc: {
        toString: () => docText,
        length: docText.length,
      },
      sliceDoc: vi.fn((from: number, to: number) => docText.slice(from, to)),
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: getWidgetRoot()
//
// Retrieves the last .find-widget element appended to document.body.
// Each test creates a fresh widget, so `querySelector` returns the most
// recently added one.
// ---------------------------------------------------------------------------

function getWidgetElements(_widget: FindWidget) {
  // The widget root is appended to document.body on construction.
  const root = document.body.querySelector<HTMLDivElement>(".find-widget:last-child")!;
  return {
    root,
    findInput: root.querySelector<HTMLInputElement>(".find-widget-input")!,
    replaceInput: root.querySelector<HTMLInputElement>(".find-widget-replace-input")!,
    countLabel: root.querySelector<HTMLSpanElement>(".find-widget-count")!,
    toggleMatchCase: root.querySelector<HTMLButtonElement>('[data-name="matchCase"]')!,
    toggleWholeWord: root.querySelector<HTMLButtonElement>('[data-name="wholeWord"]')!,
    toggleRegexp: root.querySelector<HTMLButtonElement>('[data-name="regexp"]')!,
    chevronBtn: root.querySelector<HTMLButtonElement>(".find-widget-chevron")!,
    replaceRow: root.querySelector<HTMLDivElement>(".find-widget-replace-row")!,
    replaceOneBtn: root.querySelector<HTMLButtonElement>(".find-widget-replace-one")!,
    replaceAllBtn: root.querySelector<HTMLButtonElement>(".find-widget-replace-all")!,
    prevBtn: root.querySelector<HTMLButtonElement>(".find-widget-prev")!,
    nextBtn: root.querySelector<HTMLButtonElement>(".find-widget-next")!,
    closeBtn: root.querySelector<HTMLButtonElement>(".find-widget-close")!,
  };
}

// ---------------------------------------------------------------------------
// Group 1: Construction and lifecycle
// ---------------------------------------------------------------------------

describe("Group 1: Construction and lifecycle", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    // Clean up widgets appended to document.body between tests.
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("appends root element to document.body on construction", () => {
    const { root } = getWidgetElements(widget);
    expect(document.body.contains(root)).toBe(true);
  });

  it("root is display:none after construction (FR-10.1)", () => {
    const { root } = getWidgetElements(widget);
    expect(root.style.display).toBe("none");
  });

  it("isOpen() returns false before open() is called", () => {
    expect(widget.isOpen()).toBe(false);
  });

  it("isOpen() returns true after open('find')", () => {
    widget.open("find");
    expect(widget.isOpen()).toBe(true);
  });

  it("isOpen() returns false after close()", () => {
    widget.open("find");
    widget.close();
    expect(widget.isOpen()).toBe(false);
  });

  it("root has role='dialog' and aria-label='Find'", () => {
    const { root } = getWidgetElements(widget);
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-label")).toBe("Find");
  });

  it("destroy() removes the root element from document.body", () => {
    // CRITICAL-1: Confirms that destroy() cleans up the DOM reference so the
    // FindWidget instance can be garbage-collected and does not leak the root
    // element into the page.
    const { root } = getWidgetElements(widget);
    expect(document.body.contains(root)).toBe(true);
    widget.destroy();
    // After destroy() the root must no longer be present in the document tree.
    expect(document.body.contains(root)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 2: open() behavior
// ---------------------------------------------------------------------------

describe("Group 2: open() behavior", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("open('find') makes widget visible", () => {
    widget.open("find");
    const { root } = getWidgetElements(widget);
    expect(root.style.display).not.toBe("none");
  });

  it("open('find') hides the replace row", () => {
    widget.open("find");
    const { replaceRow } = getWidgetElements(widget);
    expect(replaceRow.style.display).toBe("none");
  });

  it("open('replace') makes widget visible", () => {
    widget.open("replace");
    const { root } = getWidgetElements(widget);
    expect(root.style.display).not.toBe("none");
  });

  it("open('replace') shows the replace row", () => {
    widget.open("replace");
    const { replaceRow } = getWidgetElements(widget);
    expect(replaceRow.style.display).not.toBe("none");
  });

  it("open('find') sets aria-label to 'Find'", () => {
    widget.open("find");
    const { root } = getWidgetElements(widget);
    expect(root.getAttribute("aria-label")).toBe("Find");
  });

  it("open('replace') sets aria-label to 'Find & Replace'", () => {
    widget.open("replace");
    const { root } = getWidgetElements(widget);
    expect(root.getAttribute("aria-label")).toBe("Find & Replace");
  });

  it("EC-2: calling open() twice does not change the widget's top/left position", () => {
    widget.open("find");
    const { root } = getWidgetElements(widget);
    // Simulate the user having dragged the widget to a custom position.
    root.style.top = "200px";
    root.style.left = "300px";
    root.style.right = "auto";
    // Second open() call on an already-open widget must not reinitialize position.
    widget.open("find");
    expect(root.style.top).toBe("200px");
  });

  it("EC-2: second open() call does not throw", () => {
    widget.open("find");
    expect(() => widget.open("find")).not.toThrow();
  });

  it("MEDIUM-3: calling open('replace') on an already-open find-mode widget expands the replace row", () => {
    // When the widget is open in find-only mode and the user invokes
    // Cmd-Shift-F (or the menu item), the replace row must be revealed
    // without reinitializing the widget's position.
    widget.open("find");
    const { replaceRow, root } = getWidgetElements(widget);
    // Simulate the user having dragged the widget so position is non-default.
    root.style.top = "200px";
    root.style.left = "300px";
    root.style.right = "auto";
    // Confirm replace row is hidden in find mode.
    expect(replaceRow.style.display).toBe("none");
    // Switch to replace mode while already open.
    widget.open("replace");
    // Replace row must now be visible.
    expect(replaceRow.style.display).not.toBe("none");
    // Position must not have been reset.
    expect(root.style.top).toBe("200px");
    expect(root.style.left).toBe("300px");
  });
});

// ---------------------------------------------------------------------------
// Group 3: close() behavior
// ---------------------------------------------------------------------------

describe("Group 3: close() behavior", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("close() sets display:none on the root", () => {
    widget.open("find");
    widget.close();
    const { root } = getWidgetElements(widget);
    expect(root.style.display).toBe("none");
  });

  it("close() calls view.focus() to return focus to editor (FR-10.3)", () => {
    widget.open("find");
    widget.close();
    expect(view.focus).toHaveBeenCalledOnce();
  });

  it("close() is idempotent — calling twice does not throw", () => {
    expect(() => {
      widget.close();
      widget.close();
    }).not.toThrow();
  });

  it("close() when already closed does not call view.focus() again", () => {
    widget.open("find");
    widget.close();
    const callCount = (view.focus as ReturnType<typeof vi.fn>).mock.calls.length;
    widget.close(); // second call, widget already closed
    expect((view.focus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });
});

// ---------------------------------------------------------------------------
// Group 4: clearQuery()
// ---------------------------------------------------------------------------

describe("Group 4: clearQuery()", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("clearQuery() clears find input value", () => {
    widget.open("find");
    const { findInput } = getWidgetElements(widget);
    findInput.value = "hello";
    widget.clearQuery();
    expect(findInput.value).toBe("");
  });

  it("clearQuery() clears replace input value", () => {
    widget.open("replace");
    const { replaceInput } = getWidgetElements(widget);
    replaceInput.value = "world";
    widget.clearQuery();
    expect(replaceInput.value).toBe("");
  });

  it("clearQuery() clears count label text", () => {
    widget.open("find");
    const { countLabel } = getWidgetElements(widget);
    countLabel.textContent = "3 of 10";
    widget.clearQuery();
    expect(countLabel.textContent).toBe("");
  });

  it("clearQuery() removes no-results class from count label", () => {
    widget.open("find");
    const { countLabel } = getWidgetElements(widget);
    countLabel.classList.add("no-results");
    widget.clearQuery();
    expect(countLabel.classList.contains("no-results")).toBe(false);
  });

  it("clearQuery() dispatches an empty SearchQuery to CM6 view (FR-11.1)", async () => {
    widget.clearQuery();
    // The dispatch call must have occurred at least once with an effect.
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ effects: expect.anything() })
    );
    // We verify via the mock: SearchQuery was called with search: ''
    // (The vi.mock above replaces SearchQuery with a vi.fn)
    const { SearchQuery } = await import("@codemirror/search");
    const mockSearchQuery = SearchQuery as ReturnType<typeof vi.fn>;
    const calls = mockSearchQuery.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toMatchObject({ search: "" });
  });
});

// ---------------------------------------------------------------------------
// Group 5: setPreFill()
// ---------------------------------------------------------------------------

describe("Group 5: setPreFill() (FR-5.1, FR-5.2, FR-5.3)", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("setPreFill() sets the find input value to the provided text", () => {
    widget.setPreFill("hello world");
    const { findInput } = getWidgetElements(widget);
    expect(findInput.value).toBe("hello world");
  });

  it("EC-13: setPreFill() with multi-line text uses only the first line (LF)", () => {
    widget.setPreFill("line one\nline two\nline three");
    const { findInput } = getWidgetElements(widget);
    expect(findInput.value).toBe("line one");
  });

  it("EC-13: setPreFill() handles CRLF — splits on LF, first segment is 'line one\\r' or normalized", () => {
    // On Windows, lines end with \r\n. split('\n')[0] yields "line one\r".
    // The trailing \r is benign. Note: happy-dom may normalize the \r from input
    // values. We assert that only the first line content is present (not "line two").
    widget.setPreFill("line one\r\nline two");
    const { findInput } = getWidgetElements(widget);
    // The result must not contain "line two" — only the content up to the first newline.
    expect(findInput.value).not.toContain("line two");
    // The result must start with "line one" (with or without trailing \r).
    expect(findInput.value.replace(/\r$/, "")).toBe("line one");
  });

  it("setPreFill() with a single-line string sets the value unchanged", () => {
    widget.setPreFill("single line");
    const { findInput } = getWidgetElements(widget);
    expect(findInput.value).toBe("single line");
  });

  it("setPreFill() does not call open() — widget remains hidden", () => {
    widget.setPreFill("test");
    expect(widget.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 6: Toggle button state (FR-9.5, EC-19, EC-20)
// ---------------------------------------------------------------------------

describe("Group 6: Toggle button state", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find");
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("match case toggle button adds 'active' class on first click", () => {
    const { toggleMatchCase } = getWidgetElements(widget);
    toggleMatchCase.click();
    expect(toggleMatchCase.classList.contains("active")).toBe(true);
  });

  it("match case toggle button removes 'active' class on second click", () => {
    const { toggleMatchCase } = getWidgetElements(widget);
    toggleMatchCase.click();
    toggleMatchCase.click();
    expect(toggleMatchCase.classList.contains("active")).toBe(false);
  });

  it("whole word toggle button adds/removes 'active' class", () => {
    const { toggleWholeWord } = getWidgetElements(widget);
    toggleWholeWord.click();
    expect(toggleWholeWord.classList.contains("active")).toBe(true);
    toggleWholeWord.click();
    expect(toggleWholeWord.classList.contains("active")).toBe(false);
  });

  it("regexp toggle button adds/removes 'active' class", () => {
    const { toggleRegexp } = getWidgetElements(widget);
    toggleRegexp.click();
    expect(toggleRegexp.classList.contains("active")).toBe(true);
    toggleRegexp.click();
    expect(toggleRegexp.classList.contains("active")).toBe(false);
  });

  it("EC-19: toggling match case dispatches setSearchQuery to the view", () => {
    const { toggleMatchCase, findInput } = getWidgetElements(widget);
    findInput.value = "test";
    vi.clearAllMocks();
    toggleMatchCase.click();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("EC-20: toggling whole word dispatches setSearchQuery to the view", () => {
    const { toggleWholeWord, findInput } = getWidgetElements(widget);
    findInput.value = "test";
    vi.clearAllMocks();
    toggleWholeWord.click();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("regexp toggle dispatches setSearchQuery to the view", () => {
    const { toggleRegexp, findInput } = getWidgetElements(widget);
    findInput.value = "test";
    vi.clearAllMocks();
    toggleRegexp.click();
    expect(view.dispatch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Group 7: Keyboard handlers in find input (FR-6.6, FR-6.7, FR-6.8)
// ---------------------------------------------------------------------------

describe("Group 7: Keyboard handlers in find input", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find");
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("FR-6.6: Enter in find input calls findNext(view)", async () => {
    const { findNext } = await import("@codemirror/search");
    const { findInput } = getWidgetElements(widget);
    findInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(findNext).toHaveBeenCalledWith(view);
  });

  it("FR-6.7: Shift-Enter in find input calls findPrevious(view)", async () => {
    const { findPrevious } = await import("@codemirror/search");
    const { findInput } = getWidgetElements(widget);
    findInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    );
    expect(findPrevious).toHaveBeenCalledWith(view);
  });

  it("FR-6.8: Tab in find input prevents default when replace row is visible", () => {
    widget.close();
    widget.open("replace");
    const { findInput } = getWidgetElements(widget);
    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    findInput.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
  });

  it("Tab in find input does NOT prevent default when replace row is hidden", () => {
    const { findInput } = getWidgetElements(widget);
    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    findInput.dispatchEvent(tabEvent);
    // When replace row is hidden, Tab should not be intercepted.
    expect(tabEvent.defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 8: Escape key handler (FR-6.5, EC-17, EC-27)
// ---------------------------------------------------------------------------

describe("Group 8: Escape key handler", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("FR-6.5: Escape key dispatched on widget root calls close()", () => {
    widget.open("find");
    const { root } = getWidgetElements(widget);
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    expect(widget.isOpen()).toBe(false);
  });

  it("EC-17: calling close() when widget is already closed does not throw", () => {
    expect(() => widget.close()).not.toThrow();
    expect(widget.isOpen()).toBe(false);
  });

  it("EC-27: Escape dispatched from replace input bubbles up and closes widget", () => {
    widget.open("replace");
    const { replaceInput } = getWidgetElements(widget);
    replaceInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    expect(widget.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 9: Chevron toggle (FR-3.5)
// ---------------------------------------------------------------------------

describe("Group 9: Chevron toggle (replace row expand/collapse)", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find"); // start with replace row hidden
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("chevron click shows replace row when it was hidden", () => {
    const { chevronBtn, replaceRow } = getWidgetElements(widget);
    expect(replaceRow.style.display).toBe("none");
    chevronBtn.click();
    expect(replaceRow.style.display).not.toBe("none");
  });

  it("chevron click hides replace row when it was visible", () => {
    widget.close();
    widget.open("replace"); // start with replace row visible
    const { chevronBtn, replaceRow } = getWidgetElements(widget);
    expect(replaceRow.style.display).not.toBe("none");
    chevronBtn.click();
    expect(replaceRow.style.display).toBe("none");
  });

  it("chevron gains 'expanded' class when replace row is shown", () => {
    const { chevronBtn } = getWidgetElements(widget);
    chevronBtn.click();
    expect(chevronBtn.classList.contains("expanded")).toBe(true);
  });

  it("chevron loses 'expanded' class when replace row is hidden", () => {
    widget.close();
    widget.open("replace");
    const { chevronBtn } = getWidgetElements(widget);
    chevronBtn.click(); // collapse
    expect(chevronBtn.classList.contains("expanded")).toBe(false);
  });

  it("chevron aria-expanded is 'true' when expanded", () => {
    const { chevronBtn } = getWidgetElements(widget);
    chevronBtn.click();
    expect(chevronBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("chevron aria-expanded is 'false' when collapsed", () => {
    const { chevronBtn } = getWidgetElements(widget);
    expect(chevronBtn.getAttribute("aria-expanded")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Group 10: Navigation and replace button dispatches (FR-4.2 – FR-4.5, EC-28)
// ---------------------------------------------------------------------------

describe("Group 10: Navigation and replace button dispatches", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find");
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("FR-4.2: next button calls findNext(view)", async () => {
    const { findNext } = await import("@codemirror/search");
    const { nextBtn } = getWidgetElements(widget);
    nextBtn.click();
    expect(findNext).toHaveBeenCalledWith(view);
  });

  it("FR-4.3: prev button calls findPrevious(view)", async () => {
    const { findPrevious } = await import("@codemirror/search");
    const { prevBtn } = getWidgetElements(widget);
    prevBtn.click();
    expect(findPrevious).toHaveBeenCalledWith(view);
  });

  it("FR-4.4: replace one button calls replaceNext(view)", async () => {
    const { replaceNext } = await import("@codemirror/search");
    widget.close();
    widget.open("replace");
    const { replaceOneBtn } = getWidgetElements(widget);
    replaceOneBtn.click();
    expect(replaceNext).toHaveBeenCalledWith(view);
  });

  it("FR-4.5: replace all button calls replaceAll(view)", async () => {
    const { replaceAll } = await import("@codemirror/search");
    widget.close();
    widget.open("replace");
    const { replaceAllBtn } = getWidgetElements(widget);
    replaceAllBtn.click();
    expect(replaceAll).toHaveBeenCalledWith(view);
  });

  it("EC-28: findNext with zero matches (returns false) does not throw", async () => {
    const { findNext } = await import("@codemirror/search");
    // Simulate CM6 returning false (no match found) — should not cause a throw.
    (findNext as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const { nextBtn } = getWidgetElements(widget);
    expect(() => nextBtn.click()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Group 11: Close button (FR-3.2)
// ---------------------------------------------------------------------------

describe("Group 11: Close button", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find");
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("close button click closes the widget", () => {
    const { closeBtn } = getWidgetElements(widget);
    closeBtn.click();
    expect(widget.isOpen()).toBe(false);
  });

  it("close button click calls view.focus()", () => {
    const { closeBtn } = getWidgetElements(widget);
    closeBtn.click();
    expect(view.focus).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Group 12: Count label state (FR-12.1 – FR-12.4, EC-3, EC-4, EC-6, EC-7)
// ---------------------------------------------------------------------------

describe("Group 12: Count label state", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find");
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it.skip("EC-15: document is empty (zero characters) — widget opens, zero matches, no error; count label hidden for empty term, 'No results' for non-empty term", () => {
    // EC-15 requires creating a CM6 EditorView whose document has zero
    // characters. The happy-dom environment cannot instantiate a real
    // EditorView (no browser layout engine), so this case is exercised only
    // in the integration test suite. The _updateCount() code path for this
    // scenario is the same as EC-3 (zero matches with non-empty term) and
    // EC-4 (empty term), both of which are covered by adjacent real tests.
    // See _updateCount() in find-widget.ts for the EC-15 comment near the
    // `if (!term)` branch.
  });

  it("EC-4: empty find input results in empty count label", () => {
    const { findInput, countLabel } = getWidgetElements(widget);
    findInput.value = "";
    findInput.dispatchEvent(new Event("input"));
    expect(countLabel.textContent).toBe("");
  });

  it("EC-3: zero matches shows 'No results' and error CSS class on find input", async () => {
    // The default SearchQuery mock already returns zero matches (getCursor done:true).
    // This exercises the zero-match branch in _updateCount.
    const { findInput, countLabel } = getWidgetElements(widget);
    findInput.value = "no-match-xyz";
    findInput.dispatchEvent(new Event("input"));
    expect(countLabel.textContent).toBe("No results");
    expect(findInput.classList.contains("find-widget-no-results")).toBe(true);
  });

  it("EC-3: 'No results' adds 'no-results' class to count label", () => {
    const { findInput, countLabel } = getWidgetElements(widget);
    findInput.value = "no-match-xyz";
    findInput.dispatchEvent(new Event("input"));
    expect(countLabel.classList.contains("no-results")).toBe(true);
  });

  it("EC-6: invalid regexp shows 'Invalid' count and invalid-regexp class on input", async () => {
    // SearchQuery mock returns valid:false when search === "[invalid" and regexp is true.
    // Must use a regular function (not arrow) as the constructor mock.
    const { SearchQuery } = await import("@codemirror/search");
    (SearchQuery as ReturnType<typeof vi.fn>).mockImplementationOnce(
      function(this: Record<string, unknown>, opts: Record<string, unknown>) {
        this.search = opts.search ?? "";
        this.valid = false; // explicitly invalid
        this.getCursor = vi.fn(() => ({
          next: vi.fn(() => ({ done: true })),
          value: { to: 0 },
        }));
      }
    );
    const { toggleRegexp, findInput, countLabel } = getWidgetElements(widget);
    toggleRegexp.click(); // enable regexp mode
    vi.clearAllMocks();
    findInput.value = "[invalid";
    findInput.dispatchEvent(new Event("input"));
    expect(countLabel.textContent).toBe("Invalid");
    expect(findInput.classList.contains("find-widget-invalid-regexp")).toBe(true);
  });

  it("EC-25: incomplete regexp '[abc' invalid state — same code path as EC-6", async () => {
    // EC-25 is covered by the same query.valid=false branch as EC-6.
    // This test documents the equivalence.
    //
    // Order matters: the toggle click triggers _dispatchQuery() which calls
    // new SearchQuery(). We must apply mockImplementationOnce AFTER the toggle
    // click (and after vi.clearAllMocks) so the mock is consumed by the
    // input event dispatch, not the toggle dispatch.
    const { SearchQuery } = await import("@codemirror/search");
    const { toggleRegexp, findInput, countLabel } = getWidgetElements(widget);
    toggleRegexp.click(); // enable regexp — this dispatch uses default mock
    vi.clearAllMocks();
    // Apply the invalid-mock for the upcoming input event dispatch only.
    (SearchQuery as ReturnType<typeof vi.fn>).mockImplementationOnce(
      function(this: Record<string, unknown>, opts: Record<string, unknown>) {
        this.search = opts.search ?? "";
        this.valid = false;
        this.getCursor = vi.fn(() => ({
          next: vi.fn(() => ({ done: true })),
          value: { to: 0 },
        }));
      }
    );
    findInput.value = "[abc";
    findInput.dispatchEvent(new Event("input"));
    expect(countLabel.textContent).toBe("Invalid");
  });

  it("EC-7: zero-width regexp pattern shows '999+' and terminates the count loop", async () => {
    // Mock a SearchQuery whose cursor never returns done:true for the first 1002
    // calls, simulating an infinite-match pattern like ".*".
    //
    // Order matters: the toggle click triggers _dispatchQuery() which calls
    // new SearchQuery(). We must apply mockImplementationOnce AFTER the toggle
    // click so the mock is consumed by the input event dispatch, not the toggle.
    const { SearchQuery } = await import("@codemirror/search");
    let callCount = 0;
    const { toggleRegexp, findInput, countLabel } = getWidgetElements(widget);
    toggleRegexp.click(); // enable regexp — this dispatch uses default mock
    vi.clearAllMocks();
    callCount = 0;
    // Apply the infinite-cursor mock for the upcoming input event dispatch only.
    (SearchQuery as ReturnType<typeof vi.fn>).mockImplementationOnce(
      function(this: Record<string, unknown>, opts: Record<string, unknown>) {
        this.search = opts.search ?? "";
        this.valid = true;
        this.getCursor = vi.fn(() => ({
          next: vi.fn(() => {
            callCount++;
            return { done: callCount > 1001 };
          }),
          value: { to: 0 },
        }));
      }
    );
    findInput.value = ".*";
    findInput.dispatchEvent(new Event("input"));
    expect(countLabel.textContent).toBe("999+");
    // The loop must have terminated at or before the 1001 cap.
    expect(callCount).toBeLessThanOrEqual(1002);
  });
});

// ---------------------------------------------------------------------------
// Group 13: Position persistence (FR-8, EC-23, EC-26, TC-6)
// ---------------------------------------------------------------------------

describe("Group 13: Position persistence", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    view = makeViewMock();
    // Reset the getCurrentSettings mock to the default (findWidget: null).
    const { getCurrentSettings } = await import("../src/lib/settings");
    (getCurrentSettings as ReturnType<typeof vi.fn>).mockReturnValue({ findWidget: null });
    widget = createFindWidget(view as never);
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("FR-8.1: open() uses default position (right:16px, top:54px) when findWidget is null", async () => {
    widget.open("find");
    const { root } = getWidgetElements(widget);
    expect(root.style.right).toBe("16px");
    expect(root.style.top).toBe("54px");
    expect(root.style.left).toBe("auto");
  });

  it("FR-8.3: open() restores saved position from settings when findWidget is set", async () => {
    const { getCurrentSettings } = await import("../src/lib/settings");
    (getCurrentSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      findWidget: { x: 100, y: 200 },
    });
    // Mock offsetWidth/offsetHeight for visibility check.
    const { root } = getWidgetElements(widget);
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    Object.defineProperty(window, "innerWidth", { get: () => 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => 800, configurable: true });
    widget.open("find");
    expect(root.style.left).toBe("100px");
    expect(root.style.top).toBe("200px");
  });

  it("EC-23: saved position that is off-screen falls back to the default position", async () => {
    const { getCurrentSettings } = await import("../src/lib/settings");
    (getCurrentSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      findWidget: { x: -500, y: -500 },
    });
    const { root } = getWidgetElements(widget);
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    Object.defineProperty(window, "innerWidth", { get: () => 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => 800, configurable: true });
    widget.open("find");
    // _isPositionVisible(-500, -500) returns false → default position used.
    expect(root.style.right).toBe("16px");
    expect(root.style.top).toBe("54px");
  });

  it("MEDIUM-2: partial findWidget saved position {x: 100} (missing y) falls back to default position", async () => {
    // Defends against settings files written by a future schema migration or
    // corruption that contains only one coordinate. Without the typeof guards
    // in _restorePosition(), style.top would be set to "NaNpx".
    const { getCurrentSettings } = await import("../src/lib/settings");
    (getCurrentSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      // Partial object: y is missing, simulating a partially-written settings file.
      findWidget: { x: 100 },
    });
    const { root } = getWidgetElements(widget);
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    Object.defineProperty(window, "innerWidth", { get: () => 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => 800, configurable: true });
    widget.open("find");
    // _restorePosition() must reject the partial record and use the default.
    expect(root.style.right).toBe("16px");
    expect(root.style.top).toBe("54px");
    // style.top must never be "NaNpx".
    expect(root.style.top).not.toContain("NaN");
  });

  it("EC-26: widget re-opens at the saved drag position after a close/open cycle", async () => {
    const { getCurrentSettings } = await import("../src/lib/settings");
    (getCurrentSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      findWidget: { x: 300, y: 150 },
    });
    const { root } = getWidgetElements(widget);
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    Object.defineProperty(window, "innerWidth", { get: () => 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => 800, configurable: true });
    widget.open("find");
    widget.close();
    widget.open("find");
    expect(root.style.left).toBe("300px");
    expect(root.style.top).toBe("150px");
  });
});

// ---------------------------------------------------------------------------
// Group 14: Settings schema assertions (TC-6)
// ---------------------------------------------------------------------------

describe("Group 14: Settings schema (TC-6)", () => {
  it("DEFAULT_SETTINGS.findWidget is null (FR-8.1)", async () => {
    // Use importActual to bypass the vi.mock() that only exposes getCurrentSettings
    // and updateSettings. The actual module exports DEFAULT_SETTINGS.
    const actual = await vi.importActual<typeof import("../src/lib/settings")>(
      "../src/lib/settings"
    );
    expect(actual.DEFAULT_SETTINGS.findWidget).toBeNull();
  });

  it("FindWidgetPosition interface has x and y number fields (TC-6)", async () => {
    // This is primarily a TypeScript compile-time check: if the interface were
    // removed or fields renamed, tsc --noEmit would fail. The runtime assertion
    // below confirms that DEFAULT_SETTINGS.findWidget is typed as null (matching
    // the FindWidgetPosition | null union).
    const actual = await vi.importActual<typeof import("../src/lib/settings")>(
      "../src/lib/settings"
    );
    // FindWidgetPosition shape: { x: number, y: number }.
    const pos: import("../src/lib/settings").FindWidgetPosition = { x: 100, y: 200 };
    expect(typeof pos.x).toBe("number");
    expect(typeof pos.y).toBe("number");
    // DEFAULT_SETTINGS must have the findWidget field.
    expect(actual.DEFAULT_SETTINGS).toHaveProperty("findWidget");
    expect(actual.DEFAULT_SETTINGS.findWidget).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 15: Viewport clamping via drag (FR-7.6, EC-21, EC-22)
// ---------------------------------------------------------------------------

describe("Group 15: Viewport clamping via drag", () => {
  let widget: FindWidget;
  let view: ReturnType<typeof makeViewMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    view = makeViewMock();
    widget = createFindWidget(view as never);
    widget.open("find");
    // Set predictable viewport dimensions for clamping tests.
    Object.defineProperty(window, "innerWidth", { get: () => 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => 800, configurable: true });
  });

  afterEach(() => {
    document.body.querySelectorAll(".find-widget").forEach((el) => el.remove());
  });

  it("EC-22: dragging widget to negative X clamps to 0", () => {
    const { root } = getWidgetElements(widget);
    // Mock getBoundingClientRect so drag-start math works.
    root.getBoundingClientRect = vi.fn(() => ({
      left: 10, top: 60, right: 330, bottom: 160,
      width: 320, height: 100, x: 10, y: 60,
      toJSON: () => ({}),
    }));
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    // Start drag.
    root.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 70, bubbles: true })
    );
    // Move far to the left (negative clientX).
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: -500, clientY: 70 })
    );
    const left = parseFloat(root.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    // End drag.
    document.dispatchEvent(new MouseEvent("mouseup"));
  });

  it("EC-22: dragging widget to X beyond viewport right edge clamps to max", () => {
    const { root } = getWidgetElements(widget);
    root.getBoundingClientRect = vi.fn(() => ({
      left: 10, top: 60, right: 330, bottom: 160,
      width: 320, height: 100, x: 10, y: 60,
      toJSON: () => ({}),
    }));
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    root.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 70, bubbles: true })
    );
    // Move far to the right.
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 5000, clientY: 70 })
    );
    const left = parseFloat(root.style.left);
    // Max X = innerWidth (1200) - offsetWidth (320) = 880.
    expect(left).toBeLessThanOrEqual(880);
    document.dispatchEvent(new MouseEvent("mouseup"));
  });

  it("drag end calls updateSettings with the final position", async () => {
    const { updateSettings } = await import("../src/lib/settings");
    const { root } = getWidgetElements(widget);
    root.getBoundingClientRect = vi.fn(() => ({
      left: 10, top: 60, right: 330, bottom: 160,
      width: 320, height: 100, x: 10, y: 60,
      toJSON: () => ({}),
    }));
    Object.defineProperty(root, "offsetWidth", { get: () => 320, configurable: true });
    Object.defineProperty(root, "offsetHeight", { get: () => 100, configurable: true });
    vi.clearAllMocks();
    root.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 70, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 200, clientY: 150 })
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    // updateSettings must have been called with the final position.
    expect(updateSettings).toHaveBeenCalledOnce();
  });

  it("drag suppresses text selection on document.body (FR-7.5)", () => {
    const { root } = getWidgetElements(widget);
    root.getBoundingClientRect = vi.fn(() => ({
      left: 10, top: 60, right: 330, bottom: 160,
      width: 320, height: 100, x: 10, y: 60,
      toJSON: () => ({}),
    }));
    root.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 70, bubbles: true })
    );
    expect(document.body.style.userSelect).toBe("none");
    document.dispatchEvent(new MouseEvent("mouseup"));
  });

  it("drag restores text selection on document.body after mouseup (FR-7.5)", () => {
    const { root } = getWidgetElements(widget);
    root.getBoundingClientRect = vi.fn(() => ({
      left: 10, top: 60, right: 330, bottom: 160,
      width: 320, height: 100, x: 10, y: 60,
      toJSON: () => ({}),
    }));
    root.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 70, bubbles: true })
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(document.body.style.userSelect).toBe("");
  });
});
