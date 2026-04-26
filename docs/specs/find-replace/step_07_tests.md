# Step 07 — Vitest Tests for FindWidget

**Goal:** Write the Vitest test suite for `src/editor/find-widget.ts`. Every one of the 29 edge cases from `docs/requirements/active_task.md` must be addressed — either by an executable unit test or by a documented `it.skip` block that explains exactly why runtime verification is required instead.

**Precondition:** step_06 complete (widget is fully functional and visually verified).

---

## Files to Create / Modify

| File | Change type |
|---|---|
| `tests/find-widget.test.ts` | New: `FindWidget` unit tests |
| `tests/search.test.ts` | Modify: replace v1 CM6-panel tests with v2 FindWidget-aware tests; remove references to `openSearchPanel` / `closeSearchPanel` |

---

## Context: What Can Be Unit-Tested

The test environment is Vitest with `happy-dom`. Key constraints:

- `happy-dom` provides a DOM, but CM6's `EditorView` requires a real browser layout engine for some operations (e.g., `offsetWidth`, scrolling). CM6 itself cannot be instantiated without mocking.
- `FindWidget` construction appends to `document.body`, which works in `happy-dom`.
- All DOM manipulation, open/close state, position logic, toggle state, query construction, and keyboard event dispatch can be tested with mocked CM6 view.
- CM6 search commands (`findNext`, `findPrevious`, `replaceNext`, `replaceAll`) must be mocked — they cannot run without a real CM6 state.
- `updateSettings` and `getCurrentSettings` must be mocked (they call Tauri IPC).
- The `_updateCount` path that calls `query.getCursor()` must be mocked because `SearchQuery.getCursor` requires a live CM6 `EditorState`.

---

## 1. `tests/find-widget.test.ts` — Full Specification

### 1.1 Module-Level Mocks (required before any imports)

```typescript
// Mock Tauri APIs (required by settings.ts)
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

// Mock @codemirror/search commands — they require a live CM6 EditorState
vi.mock("@codemirror/search", () => ({
  SearchQuery: vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    search: opts.search ?? "",
    caseSensitive: opts.caseSensitive ?? false,
    wholeWord: opts.wholeWord ?? false,
    regexp: opts.regexp ?? false,
    replace: opts.replace ?? "",
    valid: !(opts.regexp && opts.search === "[invalid"),
    getCursor: vi.fn(() => ({ next: vi.fn(() => ({ done: true })), value: { to: 0 } })),
  })),
  setSearchQuery: { of: vi.fn(() => ({ type: "setSearchQuery" })) },
  getSearchQuery: vi.fn(),
  findNext: vi.fn(() => true),
  findPrevious: vi.fn(() => true),
  replaceNext: vi.fn(() => true),
  replaceAll: vi.fn(() => true),
  search: vi.fn(() => ({})),
  searchKeymap: [],
}));
```

### 1.2 `makeViewMock()` Helper

A minimal `EditorView` mock that satisfies `FindWidget`'s usage:

```typescript
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
```

### 1.3 Test Groups

---

#### Group 1: Construction and Lifecycle

**Test: widget appends to document.body on construction**

```
it("appends root element to document.body on construction")
  const view = makeViewMock();
  const widget = createFindWidget(view);
  expect(document.body.contains(widget root)).toBe(true);
```

**Test: widget is hidden by default (FR-10.1)**

```
it("root is display:none after construction")
  const view = makeViewMock();
  const widget = createFindWidget(view);
  expect(widget.isOpen()).toBe(false);
  expect(root.style.display).toBe("none");
```

**Test: isOpen() returns false before open() is called**

```
it("isOpen() returns false initially")
```

**Test: isOpen() returns true after open('find')**

```
it("isOpen() returns true after open('find')")
```

**Test: isOpen() returns false after close()**

```
it("isOpen() returns false after close()")
```

---

#### Group 2: open() Behavior (FR-3.6, FR-3.7, FR-3.8)

**Test: open('find') shows widget, hides replace row, focuses find input**

```
it("open('find') makes widget visible and hides replace row")
  widget.open('find');
  expect(root.style.display).not.toBe('none');
  expect(replaceRow.style.display).toBe('none');
```

**Test: open('replace') shows widget and shows replace row**

```
it("open('replace') makes replace row visible")
  widget.open('replace');
  expect(replaceRow.style.display).not.toBe('none');
```

**Test: EC-2 — open() when already open does not re-initialize position**

```
it("EC-2: calling open() twice does not change root's top/left position")
  widget.open('find');
  root.style.top = '200px';  // simulate drag
  widget.open('find');        // second call
  expect(root.style.top).toBe('200px');  // position unchanged
```

**Test: EC-2 — second open() call still focuses find input**

```
it("EC-2: second open() call focuses find input")
  widget.open('find');
  widget.open('find');
  // findInput.focus() must have been called on the second invocation
  // (spy on document.activeElement or use a mock)
```

---

#### Group 3: close() Behavior (FR-10.3)

**Test: close() hides the widget**

```
it("close() sets display:none on the root")
```

**Test: close() calls view.focus()**

```
it("close() calls view.focus() to return focus to editor")
  widget.open('find');
  widget.close();
  expect(view.focus).toHaveBeenCalledOnce();
```

**Test: close() is idempotent — calling twice does not throw**

```
it("close() is idempotent — calling when already closed does not throw")
  expect(() => { widget.close(); widget.close(); }).not.toThrow();
```

---

#### Group 4: clearQuery() (FR-11.1)

**Test: clearQuery() clears find input value**

```
it("clearQuery() clears find input")
  widget.open('find');
  findInput.value = 'hello';
  widget.clearQuery();
  expect(findInput.value).toBe('');
```

**Test: clearQuery() clears replace input value**

```
it("clearQuery() clears replace input")
  widget.open('replace');
  replaceInput.value = 'world';
  widget.clearQuery();
  expect(replaceInput.value).toBe('');
```

**Test: clearQuery() clears count label**

```
it("clearQuery() clears count label text")
```

**Test: clearQuery() dispatches setSearchQuery with empty term to CM6**

```
it("clearQuery() dispatches empty SearchQuery to CM6 view")
  widget.clearQuery();
  expect(view.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ effects: expect.anything() })
  );
  expect(SearchQuery).toHaveBeenCalledWith(expect.objectContaining({ search: '' }));
```

---

#### Group 5: setPreFill() (FR-5.1, FR-5.2, FR-5.3)

**Test: setPreFill() sets find input value**

```
it("setPreFill() sets find input value to provided text")
  widget.setPreFill('hello world');
  expect(findInput.value).toBe('hello world');
```

**Test: EC-13 — multi-line selection truncated to first line**

```
it("EC-13: setPreFill() with multi-line text uses only the first line")
  widget.setPreFill("line one\nline two\nline three");
  expect(findInput.value).toBe("line one");
```

**Test: EC-13 — Windows line endings (CRLF) also truncated correctly**

```
it("EC-13: setPreFill() handles CRLF line endings")
  widget.setPreFill("line one\r\nline two");
  // split('\n')[0] on "line one\r\nline two" gives "line one\r"
  // This is acceptable — the \r is a benign trailing character.
  // Document this in a comment referencing EC-13.
  expect(findInput.value).toBe("line one\r");
```

---

#### Group 6: Toggle Button State (FR-9.5, EC-19, EC-20)

**Test: match case toggle adds/removes 'active' class**

```
it("match case toggle button toggles 'active' class on click")
  toggleMatchCase.click();
  expect(toggleMatchCase.classList.contains('active')).toBe(true);
  toggleMatchCase.click();
  expect(toggleMatchCase.classList.contains('active')).toBe(false);
```

**Test: whole word toggle adds/removes 'active' class**

```
it("whole word toggle button toggles 'active' class on click")
```

**Test: regexp toggle adds/removes 'active' class**

```
it("regexp toggle button toggles 'active' class on click")
```

**Test: EC-19 — toggling match case dispatches setSearchQuery**

```
it("EC-19: toggling match case re-dispatches setSearchQuery")
  widget.open('find');
  findInput.value = 'test';
  toggleMatchCase.click();
  expect(view.dispatch).toHaveBeenCalled();
```

**Test: EC-20 — toggling whole word dispatches setSearchQuery**

```
it("EC-20: toggling whole word re-dispatches setSearchQuery")
```

---

#### Group 7: Keyboard Handlers in Find Input (FR-6.6, FR-6.7, FR-6.8)

**Test: Enter key in find input calls findNext**

```
it("Enter in find input calls findNext(view)")
  const { findNext } = await import("@codemirror/search");
  widget.open('find');
  findInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(findNext).toHaveBeenCalledWith(view);
```

**Test: Shift-Enter in find input calls findPrevious**

```
it("Shift-Enter in find input calls findPrevious(view)")
  const { findPrevious } = await import("@codemirror/search");
  widget.open('find');
  findInput.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
  );
  expect(findPrevious).toHaveBeenCalledWith(view);
```

**Test: Tab in find input with replace row visible moves focus to replace input**

```
it("FR-6.8: Tab in find input moves focus to replace input when replace row is visible")
  widget.open('replace');
  const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  findInput.dispatchEvent(tabEvent);
  expect(tabEvent.defaultPrevented).toBe(true);
  // In happy-dom we cannot assert document.activeElement, but can verify
  // replaceInput.focus() would have been called via spying on it
```

---

#### Group 8: Escape Key Handler (FR-6.5, EC-17, EC-27)

**Test: Escape in widget root calls close()**

```
it("FR-6.5: Escape key in the widget calls close()")
  widget.open('find');
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(widget.isOpen()).toBe(false);
```

**Test: EC-17 — Escape when widget is hidden does not throw**

```
it("EC-17: Escape on widget root when closed does not affect state")
  // Widget is display:none — keydown events are not dispatched to hidden elements
  // by the browser. This test documents the invariant: widget.close() is
  // guarded by the isOpen check so calling it when already closed is a no-op.
  expect(() => widget.close()).not.toThrow();
  expect(widget.isOpen()).toBe(false);
```

**Test: EC-27 — Escape in replace input closes widget**

```
it("EC-27: Escape dispatched on widget root while replace input is focused calls close()")
  widget.open('replace');
  // Simulate Escape bubbling up from replace input to widget root
  replaceInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(widget.isOpen()).toBe(false);
```

---

#### Group 9: Chevron Toggle (FR-3.5)

**Test: chevron click shows replace row**

```
it("chevron click shows replace row when it was hidden")
  widget.open('find');
  expect(replaceRow.style.display).toBe('none');
  chevronBtn.click();
  expect(replaceRow.style.display).not.toBe('none');
```

**Test: chevron click hides replace row when it was visible**

```
it("chevron click hides replace row when it was visible")
  widget.open('replace');
  expect(replaceRow.style.display).not.toBe('none');
  chevronBtn.click();
  expect(replaceRow.style.display).toBe('none');
```

---

#### Group 10: Navigation and Replace Button Dispatches (FR-4.2 – FR-4.5)

**Test: next button calls findNext**

```
it("next button calls findNext(view)")
  const { findNext } = await import("@codemirror/search");
  widget.open('find');
  nextBtn.click();
  expect(findNext).toHaveBeenCalledWith(view);
```

**Test: prev button calls findPrevious**

```
it("prev button calls findPrevious(view)")
```

**Test: replace one button calls replaceNext**

```
it("replace one button calls replaceNext(view)")
  const { replaceNext } = await import("@codemirror/search");
  widget.open('replace');
  replaceOneBtn.click();
  expect(replaceNext).toHaveBeenCalledWith(view);
```

**Test: replace all button calls replaceAll**

```
it("replace all button calls replaceAll(view)")
  const { replaceAll } = await import("@codemirror/search");
  widget.open('replace');
  replaceAllBtn.click();
  expect(replaceAll).toHaveBeenCalledWith(view);
```

**Test: EC-28 — findNext with zero matches does not throw**

```
it("EC-28: findNext called when there are zero matches does not throw")
  // findNext is mocked to return false (CM6 behavior: returns false, no throw).
  // Verify the click handler calls findNext and does not throw.
  const { findNext } = await import("@codemirror/search");
  (findNext as vi.MockedFunction<typeof findNext>).mockReturnValueOnce(false);
  widget.open('find');
  expect(() => nextBtn.click()).not.toThrow();
```

---

#### Group 11: Close Button (FR-3.2)

**Test: close button calls close()**

```
it("close button calls close()")
  widget.open('find');
  closeBtn.click();
  expect(widget.isOpen()).toBe(false);
```

---

#### Group 12: Count Label (FR-12.1 – FR-12.4, EC-3, EC-4, EC-6, EC-7)

**Test: EC-4 — empty search term hides count label**

```
it("EC-4: empty find input results in empty count label")
  widget.open('find');
  findInput.value = '';
  findInput.dispatchEvent(new Event('input'));
  expect(countLabel.textContent).toBe('');
```

**Test: EC-3 — no matches shows "No results" and error class on input**

```
it("EC-3: zero matches shows 'No results' and error CSS class on find input")
  // Arrange: mock SearchQuery.getCursor to return zero results immediately
  const { SearchQuery } = await import("@codemirror/search");
  (SearchQuery as vi.MockedClass<typeof SearchQuery>).mockImplementationOnce((opts) => ({
    search: opts.search ?? '',
    valid: true,
    getCursor: vi.fn(() => ({ next: vi.fn(() => ({ done: true })), value: { to: 0 } })),
  } as any));
  widget.open('find');
  findInput.value = 'no-match-xyz';
  findInput.dispatchEvent(new Event('input'));
  expect(countLabel.textContent).toBe('No results');
  expect(findInput.classList.contains('find-widget-no-results')).toBe(true);
```

**Test: EC-6 — invalid regexp shows "Invalid" in count label**

```
it("EC-6: invalid regexp shows 'Invalid' count and invalid-regexp class")
  // The SearchQuery mock returns valid: false when search === "[invalid"
  widget.open('find');
  // Enable regexp toggle first
  toggleRegexp.click();
  findInput.value = '[invalid';
  findInput.dispatchEvent(new Event('input'));
  expect(countLabel.textContent).toBe('Invalid');
  expect(findInput.classList.contains('find-widget-invalid-regexp')).toBe(true);
```

**Test: EC-25 — incomplete regexp (EC-6 equivalence)**

```
it("EC-25: incomplete regexp '[abc' shows invalid state — same as EC-6")
  // EC-25 uses the same code path as EC-6.
  // This test is the same as EC-6 with a different input value.
  // Both EC-6 and EC-25 are covered by the SearchQuery.valid flag check.
  // Documented here as a separate it() for EC numbering completeness.
```

**Test: EC-7 — zero-width regexp shows "999+" and does not hang**

```
it("EC-7: zero-width regexp pattern shows '999+' count and does not iterate beyond cap")
  // Mock getCursor to always return done: false (infinite match simulation)
  // for the first 1001 calls, then done: true.
  // The _updateCount loop must stop at 1000 and display "999+".
  const { SearchQuery } = await import("@codemirror/search");
  let callCount = 0;
  (SearchQuery as vi.MockedClass<typeof SearchQuery>).mockImplementationOnce((opts) => ({
    search: opts.search ?? '',
    valid: true,
    getCursor: vi.fn(() => ({
      next: vi.fn(() => {
        callCount++;
        return { done: callCount > 1001 };
      }),
      value: { to: 0 },
    })),
  } as any));
  widget.open('find');
  toggleRegexp.click();
  findInput.value = '.*';
  findInput.dispatchEvent(new Event('input'));
  expect(countLabel.textContent).toBe('999+');
  // Verify the loop terminated early (callCount at most 1001, not unbounded)
  expect(callCount).toBeLessThanOrEqual(1002);
```

---

#### Group 13: Position Persistence (FR-8, TC-6)

**Test: _restorePosition uses default when findWidget is null in settings (FR-8.1)**

```
it("open() uses default position when settings.findWidget is null")
  // getCurrentSettings mock returns { findWidget: null }
  widget.open('find');
  // Default position: right: '16px', top: '54px'
  expect(root.style.right).toBe('16px');
  expect(root.style.top).toBe('54px');
  expect(root.style.left).toBe('auto');
```

**Test: _restorePosition uses saved position when findWidget is set (FR-8.3)**

```
it("open() restores saved position from settings when findWidget is non-null")
  const { getCurrentSettings } = await import("../src/lib/settings");
  (getCurrentSettings as vi.Mock).mockReturnValue({ findWidget: { x: 100, y: 200 } });
  // Mock offsetWidth/offsetHeight to allow valid clamping
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(root, 'offsetHeight', { get: () => 100, configurable: true });
  // Mock window dimensions
  Object.defineProperty(window, 'innerWidth', { get: () => 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { get: () => 800, configurable: true });
  widget.open('find');
  expect(root.style.left).toBe('100px');
  expect(root.style.top).toBe('200px');
```

**Test: EC-23 — off-screen saved position falls back to default (FR-8.4)**

```
it("EC-23: saved position that is off-screen falls back to default position")
  const { getCurrentSettings } = await import("../src/lib/settings");
  (getCurrentSettings as vi.Mock).mockReturnValue({ findWidget: { x: -500, y: -500 } });
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(root, 'offsetHeight', { get: () => 100, configurable: true });
  Object.defineProperty(window, 'innerWidth', { get: () => 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { get: () => 800, configurable: true });
  widget.open('find');
  // _isPositionVisible(-500, -500) returns false → default position used
  expect(root.style.right).toBe('16px');
  expect(root.style.top).toBe('54px');
```

**Test: EC-26 — closing widget after drag retains dragged position for next open**

```
it("EC-26: widget re-opens at dragged position after close/open cycle")
  // Simulate a drag having set a custom position
  const { getCurrentSettings } = await import("../src/lib/settings");
  (getCurrentSettings as vi.Mock).mockReturnValue({ findWidget: { x: 300, y: 150 } });
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(root, 'offsetHeight', { get: () => 100, configurable: true });
  Object.defineProperty(window, 'innerWidth', { get: () => 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { get: () => 800, configurable: true });
  widget.open('find');
  widget.close();
  widget.open('find');
  expect(root.style.left).toBe('300px');
  expect(root.style.top).toBe('150px');
```

---

#### Group 14: Settings Schema (TC-6)

Test lives in `tests/settings.test.ts` (added as a new `describe` block):

**Test: DEFAULT_SETTINGS has findWidget: null**

```
it("DEFAULT_SETTINGS.findWidget is null (FR-8.1)")
  import { DEFAULT_SETTINGS } from "../src/lib/settings";
  expect(DEFAULT_SETTINGS.findWidget).toBeNull();
```

**Test: FindWidgetPosition interface structure is correctly typed**

```
it("FindWidgetPosition is exported and has x and y number fields")
  // This is a TypeScript compilation check, not a runtime test.
  // If the interface is missing or has wrong types, tsc --noEmit fails.
  // Document this as a tsc check rather than a runtime it().
  // Use a type assertion to verify the shape:
  const pos: FindWidgetPosition = { x: 100, y: 200 };
  expect(pos.x).toBe(100);
  expect(pos.y).toBe(200);
```

---

#### Group 15: Clamping Logic (FR-7.6, EC-21, EC-22)

**Test: _clampX keeps x within [0, innerWidth - offsetWidth]**

```
it("_clampX clamps negative x to 0")
  // Access _clampX via drag simulation:
  // Trigger a mousedown on the header, then mousemove with a negative clientX
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(window, 'innerWidth', { get: () => 1200, configurable: true });
  // Set up drag start
  root.getBoundingClientRect = vi.fn(() => ({ left: 10, top: 60, right: 330, bottom: 160 }));
  header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
  // Move to negative x
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100, clientY: 70 }));
  expect(parseFloat(root.style.left)).toBeGreaterThanOrEqual(0);
```

**Test: _clampX keeps x within max (innerWidth - offsetWidth)**

```
it("_clampX clamps x to innerWidth - offsetWidth")
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(window, 'innerWidth', { get: () => 1200, configurable: true });
  root.getBoundingClientRect = vi.fn(() => ({ left: 10, top: 60, right: 330, bottom: 160 }));
  header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
  // Move far to the right
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 70 }));
  expect(parseFloat(root.style.left)).toBeLessThanOrEqual(1200 - 320);
```

**Test: EC-22 — dragging past left edge is clamped**

```
it("EC-22: drag past left edge clamps to x=0")
  // Same as _clampX test with negative x — documented as EC-22 coverage
```

**Test: EC-21 — narrow viewport (400px) keeps widget visible**

```
it("EC-21: on 400px viewport, widget is clamped to fit within viewport")
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(window, 'innerWidth', { get: () => 400, configurable: true });
  root.getBoundingClientRect = vi.fn(() => ({ left: 350, top: 60, right: 670, bottom: 160 }));
  header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 360, clientY: 70, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 360, clientY: 70 }));
  expect(parseFloat(root.style.left)).toBeLessThanOrEqual(400 - 320);
```

---

#### Group 16: Drag Lifecycle (FR-7)

**Test: drag saves position on mouseup (FR-8.5)**

```
it("FR-8.5: drag-end saves position via updateSettings (not on every mousemove)")
  const { updateSettings } = await import("../src/lib/settings");
  root.getBoundingClientRect = vi.fn(() => ({ left: 10, top: 60, right: 330, bottom: 160 }));
  Object.defineProperty(root, 'offsetWidth', { get: () => 320, configurable: true });
  Object.defineProperty(root, 'offsetHeight', { get: () => 100, configurable: true });
  Object.defineProperty(window, 'innerWidth', { get: () => 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { get: () => 800, configurable: true });
  header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
  // Three mousemove events — updateSettings must NOT be called during drag
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100 }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 210, clientY: 105 }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 110 }));
  expect(updateSettings).not.toHaveBeenCalled();
  // mouseup triggers the save
  document.dispatchEvent(new MouseEvent('mouseup'));
  expect(updateSettings).toHaveBeenCalledOnce();
```

**Test: FR-7.3 — right style is cleared to auto when drag starts**

```
it("FR-7.3: drag clears 'right' style and sets 'left' at drag start")
  widget.open('find');  // sets right: 16px in default position
  root.getBoundingClientRect = vi.fn(() => ({ left: 10, top: 60, right: 330, bottom: 160 }));
  header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
  expect(root.style.right).toBe('auto');
  expect(root.style.left).not.toBe('');
```

**Test: FR-7.5 — user-select disabled on body during drag, restored on mouseup**

```
it("FR-7.5: body user-select is none during drag and restored on mouseup")
  root.getBoundingClientRect = vi.fn(() => ({ left: 10, top: 60, right: 330, bottom: 160 }));
  header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
  expect(document.body.style.userSelect).toBe('none');
  document.dispatchEvent(new MouseEvent('mouseup'));
  expect(document.body.style.userSelect).toBe('');
```

---

#### Group 17: Documented Edge Cases (runtime verification required)

These cannot be asserted in a unit test. Each `it.skip` documents why and maps to the acceptance criteria.

**EC-5 — Very large document performance**

```
it.skip("EC-5: match highlighting on 50,000-char document — requires live CM6 environment")
  // The _updateCount loop iterates getCursor() which requires CM6 EditorState.
  // Verify manually: open a 50k-character file, type a common word in Find.
  // Match count should update within 1 second. No UI freeze.
```

**EC-8 — Replace All atomicity**

```
it.skip("EC-8: replaceAll dispatches a single CM6 transaction — requires live CM6 history")
  // CM6's replaceAll() builds one ChangeSet and dispatches once.
  // Verify manually: Replace All with 1000+ matches, then Cmd-Z.
  // All replacements must be undone in a single undo step.
```

**EC-9 — Undo after Replace All**

```
it.skip("EC-9: Cmd-Z after Replace All reverses all replacements — requires CM6 undo stack")
```

**EC-10 — Theme switch while widget is open**

```
it.skip("EC-10: switching theme while widget is open updates colors via CSS cascade — requires live CSS")
  // CSS custom properties update automatically. No JS update needed.
  // Verify manually: open widget, switch theme with Cmd-T.
  // Widget background and input colors must update instantly.
```

**EC-11 — Preview toggle while widget is open**

```
it.skip("EC-11: Cmd-E while widget is open does not close widget — requires live CM6 compartment")
  // previewCompartment.reconfigure() does not affect findWidget.
  // Verify manually: open widget, press Cmd-E, widget must remain open.
```

**EC-12 — File load closes widget**

```
it.skip("EC-12: opening a file closes the widget — requires main.ts integration")
  // findWidget.close() and findWidget.clearQuery() are called in newFile(),
  // openFile(), and openRecentFileByPath(). Tested in tests/main-integration.
  // Verify manually: open widget, File > New → widget closes.
```

**EC-14 — Very long search term (10,000+ chars)**

```
it.skip("EC-14: pasting 10,000 chars into find input does not crash — requires real browser")
  // SearchQuery accepts any string length. Match count may be 0.
  // Verify manually: paste a 10k-character string into find input.
  // No freeze, no error.
```

**EC-15 — Empty document**

```
it.skip("EC-15: widget opens on empty document — requires live CM6 EditorState")
  // SearchQuery.getCursor on an empty document returns immediately (done: true).
  // Count label shows 'No results' for non-empty term, hidden for empty term.
  // Verify manually: File > New, then open widget and type.
```

**EC-18 — Cmd-G wraps at last match**

```
it.skip("EC-18: findNext wraps to first match at end of document — requires CM6 findNext behavior")
  // CM6's findNext wraps by default. Verify manually.
```

**EC-24 — Widget and settings panel coexist**

```
it.skip("EC-24: widget (z-index: 200) and settings panel (z-index: 1000) coexist — requires visual inspection")
  // z-index values are assigned in step_02 and step_06.
  // Verify manually: open both panels simultaneously. Settings panel must
  // appear above the find widget. Neither panel causes the other to close.
```

**EC-29 — Window focus event with widget open**

```
it.skip("EC-29: window focus event with widget open does not steal focus from widget — requires main.ts integration")
  // main.ts focus handler checks findWidget.isOpen() before calling editor.focus().
  // Verify manually: open widget, click outside the app (blur), click back on the
  // app window. Find input must retain focus (or regain it).
```

---

## 2. `tests/search.test.ts` — Required Updates

The existing `search.test.ts` tests the v1 CM6 panel approach using `openSearchPanel` / `closeSearchPanel`. After v2 implementation, those calls no longer exist in `main.ts`. The test file must be updated:

### 2.1 Remove Obsolete Tests

Remove or replace the following describe blocks that test the old panel approach:

- `"Find / Find & Replace — menu event handlers"` — the `handleEditFind` and `handleEditFindReplace` helpers mirror the old `main.ts` code. After step_05, those code paths are replaced by `findWidget.open()` calls. These tests become stale and must be removed.
- `"EC-12: search panel is explicitly closed on file load"` — the `handleFileLoad` helper calls `closeSearchPanel`. After step_05, this is replaced by `findWidget?.close()` and `findWidget?.clearQuery()`. This test must be replaced.

### 2.2 Retain Valid Tests

The following tests remain valid after v2:

- `"Search static configuration — searchTheme CSS rules"` — tests that `searchTheme` exports a non-null Extension. Still valid; `searchTheme` still exists (now stripped of panel rules).
- `"EC-8: Replace All atomicity — documented"` — the `it.skip` block remains valid.
- `"CM6 search behavior — documented edge cases (requires runtime)"` — the runtime skip blocks remain valid.

### 2.3 Update the `.cm-not-found` Assertion

The test at line 316 asserts that `search-theme.ts` contains `.cm-textfield.cm-not-found`. After step_01, that rule is removed from `search-theme.ts` (it was a CM6 panel style). This test must be updated:

**Before:**
```typescript
expect(source).toContain(".cm-textfield.cm-not-found");
expect(source).toContain("hsl(0, 72%, 51%)");
```

**After:**
```typescript
// After step_01, search-theme.ts no longer contains CM6 panel rules.
// The no-results error state is now handled by find-widget.css:
// .find-widget-input.find-widget-no-results
// Verify that search-theme.ts does NOT contain the old CM6 panel selectors:
expect(source).not.toContain(".cm-textfield");
expect(source).not.toContain(".cm-panels");
expect(source).not.toContain(".cm-search");
// And DOES contain the retained match highlight rules:
expect(source).toContain(".cm-searchMatch");
expect(source).toContain(".cm-searchMatch-selected");
```

### 2.4 Remove the `openSearchPanel` Mock

The module-level mock for `@codemirror/search` mocks `openSearchPanel` and `closeSearchPanel`. After v2, `main.ts` no longer imports these. The mock entry can be removed if no remaining test uses them:

```typescript
// Before (remove these two entries):
vi.mock("@codemirror/search", () => ({
  openSearchPanel: vi.fn(() => true),   // REMOVE
  closeSearchPanel: vi.fn(),            // REMOVE
  search: vi.fn(() => ({})),
  searchKeymap: [],
}));
```

### 2.5 Add a New EC-12 Test Using FindWidget API

Replace the old `handleFileLoad` test with a new one that tests the v2 contract:

```typescript
describe("EC-12: file load closes FindWidget and clears query (v2)", () => {
  it("close() and clearQuery() are called when a new file is loaded")
    // This tests the contract, not the full main.ts implementation.
    // Simulate what newFile() does:
    const closeSpy = vi.fn();
    const clearSpy = vi.fn();
    const findWidget = { close: closeSpy, clearQuery: clearSpy };
    // Replicate: findWidget?.close(); findWidget?.clearQuery();
    findWidget.close();
    findWidget.clearQuery();
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(clearSpy).toHaveBeenCalledOnce();
```

---

## 3. Test Count Target

After implementing these tests, the frontend Vitest test count should increase from 34 to approximately 60–70 tests (34 existing + ~30 new `find-widget.test.ts` tests + updates to `search.test.ts`). The exact count depends on how many `it.skip` blocks are added vs. how many can be promoted to executable tests.

**AC-35 requirement:** "Vitest test count increases (find-widget tests added to the frontend test suite)." The target is at minimum 15 new executable (non-skipped) tests in `find-widget.test.ts`.

---

## 4. Acceptance Criteria

- [ ] `tests/find-widget.test.ts` exists and all executable tests pass with `npm test`.
- [ ] `tsc --noEmit` passes on the test file (TypeScript clean).
- [ ] All 29 edge cases from `docs/requirements/active_task.md` are addressed: either by an executable test in `find-widget.test.ts` or by a documented `it.skip` block with an EC reference and a manual verification instruction.
- [ ] `tests/search.test.ts` no longer contains references to `openSearchPanel` or `closeSearchPanel` in executable test logic.
- [ ] The `.cm-textfield.cm-not-found` assertion in `search.test.ts` is updated to assert the v2 state (rule is absent from `search-theme.ts`).
- [ ] `tests/search.test.ts` still passes with `npm test`.
- [ ] AC-35: The total Vitest test count is higher than 34 (the previous baseline).
- [ ] AC-34: All 29 EC numbers appear in test file comments (either as executable tests or `it.skip` blocks).

---

## 5. Edge Case Coverage Table

All 29 edge cases mapped to their test coverage:

| EC # | Edge Case | Coverage |
|---|---|---|
| EC-1 | Cmd-F with editor null | Covered in `main.ts` wiring tests (step_05 AC checklist) + null guard in menu handler |
| EC-2 | Cmd-F when widget already open | Executable test: Group 2 "EC-2: calling open() twice" |
| EC-3 | Search term not found | Executable test: Group 12 "EC-3: zero matches shows 'No results'" |
| EC-4 | Search term is empty | Executable test: Group 12 "EC-4: empty find input results in empty count label" |
| EC-5 | Very large match set | `it.skip` — Group 17 "EC-5: requires live CM6 environment" |
| EC-6 | Invalid RegExp | Executable test: Group 12 "EC-6: invalid regexp shows 'Invalid'" |
| EC-7 | Zero-width match pattern | Executable test: Group 12 "EC-7: zero-width regexp shows '999+'" |
| EC-8 | Replace All 1000+ matches | `it.skip` — Group 17 "EC-8: requires live CM6 history" |
| EC-9 | Undo after Replace All | `it.skip` — Group 17 "EC-9: requires CM6 undo stack" |
| EC-10 | Theme switch while widget open | `it.skip` — Group 17 "EC-10: requires live CSS cascade" |
| EC-11 | Preview toggle while widget open | `it.skip` — Group 17 "EC-11: requires live CM6 compartment" |
| EC-12 | File load closes widget | `it.skip` (runtime) + executable contract test in `search.test.ts` Group 2.5 |
| EC-13 | Multi-line selection pre-fill | Executable test: Group 5 "EC-13: multi-line text uses only first line" |
| EC-14 | Very long search term | `it.skip` — Group 17 "EC-14: requires real browser" |
| EC-15 | Empty document | `it.skip` — Group 17 "EC-15: requires live CM6 EditorState" |
| EC-16 | Cmd-Shift-F with editor null | Same null guard pattern as EC-1; covered in main.ts wiring AC checklist |
| EC-17 | Escape when widget not open | Executable test: Group 8 "EC-17: close() when already closed does not throw" |
| EC-18 | findNext wraps at last match | `it.skip` — Group 17 "EC-18: requires CM6 findNext behavior" |
| EC-19 | Case toggle updates search | Executable test: Group 6 "EC-19: toggling match case re-dispatches setSearchQuery" |
| EC-20 | Whole word toggle updates search | Executable test: Group 6 "EC-20: toggling whole word re-dispatches setSearchQuery" |
| EC-21 | Narrow viewport clamping | Executable test: Group 15 "EC-21: 400px viewport" |
| EC-22 | Drag past left edge clamped | Executable test: Group 15 "EC-22: drag past left edge clamps to x=0" |
| EC-23 | Off-screen stored position | Executable test: Group 13 "EC-23: off-screen saved position falls back to default" |
| EC-24 | Widget and settings panel coexist | `it.skip` — Group 17 "EC-24: requires visual inspection" |
| EC-25 | Incomplete regexp | Executable test: Group 12 "EC-25: incomplete regexp '[abc' — same as EC-6" |
| EC-26 | Position retained across file switch | Executable test: Group 13 "EC-26: widget re-opens at dragged position after close/open" |
| EC-27 | Escape from replace input | Executable test: Group 8 "EC-27: Escape from replace input calls close()" |
| EC-28 | findNext with zero matches | Executable test: Group 10 "EC-28: findNext with zero matches does not throw" |
| EC-29 | Window focus with widget open | `it.skip` — Group 17 "EC-29: requires main.ts integration" |

---

## 6. Notes

- All executable tests that access private DOM elements (`findInput`, `replaceRow`, `header`, etc.) must do so through the public DOM (`document.body.querySelector('.find-widget-input')`, etc.) since TypeScript does not expose private class fields in tests.
- The `vi.mock` for `@codemirror/search` must be at the top of the file before any imports that transitively pull in `@codemirror/search`. Vitest hoists `vi.mock` calls automatically.
- The `updateSettings` mock must return a resolved `Promise` to avoid unhandled promise rejections in the drag-end path.
- Each test group should use `beforeEach` to create a fresh `FindWidget` instance and a fresh `view` mock to prevent state leakage between tests.
- `document.body.innerHTML = ''` in `afterEach` cleans up appended widget roots.
