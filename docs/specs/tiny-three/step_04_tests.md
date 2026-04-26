# Step 04 — Tests

**Requirements:** `docs/requirements/active_task.md` §3 (Edge Case Inventory), §4 (Acceptance Criteria)
**Test framework:** Vitest (frontend), `cargo test` (Rust — no new Rust tests needed for this batch)

---

## 1. Test File Location

All new tests go in a single new file:

```
tests/format-tiny-three.test.ts
```

This keeps the new tests isolated from the existing `tests/format.test.ts` and
avoids merge conflicts with unrelated test suites.

---

## 2. Test Helpers

The existing test suite in `tests/format.test.ts` uses a `makeView` helper that
creates an `EditorView` from an initial document string and an optional cursor
position or selection. Reuse or import that helper. If it is not exported,
replicate the minimal version below locally in the new test file.

```typescript
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

function makeView(doc: string, anchor = 0, head?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor, head: head ?? anchor },
  });
  return new EditorView({ state });
}
```

---

## 3. `insertLink` Tests

Vitest cannot call `navigator.clipboard.readText()` in the jsdom environment
without mocking. Mock it before each test group and restore afterward.

### Setup

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { insertLink } from "../src/editor/format";

describe("insertLink", () => {
  let clipboardMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clipboardMock = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: clipboardMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
```

### Test cases

```typescript
  it("AC-L1: wraps selection with valid URL from clipboard", async () => {
    clipboardMock.mockResolvedValue("https://example.com");
    const view = makeView("hello world", 0, 5); // selects "hello"
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[hello](https://example.com) world");
  });

  it("AC-L2: wraps selection with empty parens when clipboard has no valid URL", async () => {
    clipboardMock.mockResolvedValue("not a url");
    const view = makeView("hello world", 0, 5);
    await insertLink(view);
    const doc = view.state.doc.toString();
    expect(doc).toBe("[hello]() world");
    // Cursor between the parens — position after "[hello](" = 8
    expect(view.state.selection.main.anchor).toBe(8);
  });

  it("AC-L3: inserts [](url) with no selection and valid URL", async () => {
    clipboardMock.mockResolvedValue("https://example.com");
    const view = makeView("hello", 2); // cursor in middle, no selection
    await insertLink(view);
    // Inserted at position 2; cursor should be between []
    const inserted = view.state.doc.sliceString(2, 2 + "[](https://example.com)".length);
    expect(inserted).toBe("[](https://example.com)");
    expect(view.state.selection.main.anchor).toBe(3); // between []
  });

  it("AC-L4: inserts []() with no selection and no valid URL", async () => {
    clipboardMock.mockResolvedValue("");
    const view = makeView("hello", 2);
    await insertLink(view);
    const inserted = view.state.doc.sliceString(2, 6); // "[]() "
    expect(inserted).toBe("[]()");
    expect(view.state.selection.main.anchor).toBe(3); // between []
  });

  it("EC-L1: clipboard rejection falls back to no-URL path", async () => {
    clipboardMock.mockRejectedValue(new DOMException("NotAllowedError"));
    const view = makeView("hello", 0, 5);
    await insertLink(view); // must not throw
    expect(view.state.doc.toString()).toBe("[hello]() ");
  });

  it("EC-L2: trims trailing whitespace and newline from clipboard URL", async () => {
    clipboardMock.mockResolvedValue("https://example.com  \n");
    const view = makeView("x", 0, 1);
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[x](https://example.com)");
  });

  it("EC-L5: ftp:// URL is treated as invalid", async () => {
    clipboardMock.mockResolvedValue("ftp://example.com");
    const view = makeView("x", 0, 1);
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[x]()");
  });
});
```

---

## 4. `moveLineUp` / `moveLineDown` Tests

```typescript
import { describe, it, expect } from "vitest";
import { moveLineUp, moveLineDown } from "../src/editor/format";

describe("moveLineUp", () => {
  it("AC-M1: moves cursor line upward", () => {
    //  line 1: "alpha"
    //  line 2: "beta"   ← cursor on this line
    const view = makeView("alpha\nbeta", 6); // cursor at start of "beta"
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
    // cursor should remain on the moved line (now line 1)
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(1);
  });

  it("EC-M1 / AC-M5: no-op when cursor is on line 1", () => {
    const view = makeView("alpha\nbeta", 2); // cursor on line 1
    const before = view.state.doc.toString();
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("EC-M5: no-op on single-line document", () => {
    const view = makeView("only", 2);
    const before = view.state.doc.toString();
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("AC-M4 / AC-M6: moves multi-line selection upward as a unit", () => {
    //  line 1: "alpha"
    //  line 2: "beta"    ← selection starts here
    //  line 3: "gamma"   ← selection ends here
    const view = makeView("alpha\nbeta\ngamma", 6, 16);
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("beta\ngamma\nalpha");
    // selection now spans lines 1–2
    const sel = view.state.selection.main;
    const anchorLine = view.state.doc.lineAt(sel.from).number;
    const headLine   = view.state.doc.lineAt(sel.to).number;
    expect(anchorLine).toBe(1);
    expect(headLine).toBe(2);
  });

  it("EC-M7: no trailing newline gained or lost", () => {
    // Last line has no trailing newline — move it up
    const view = makeView("alpha\nbeta", 6); // cursor on "beta" (no trailing \n)
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
    // Document still has no trailing newline
    expect(view.state.doc.toString().endsWith("\n")).toBe(false);
  });
});

describe("moveLineDown", () => {
  it("AC-M2: moves cursor line downward", () => {
    const view = makeView("alpha\nbeta", 2); // cursor on line 1
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(2);
  });

  it("EC-M2 / AC-M6: no-op when cursor is on the last line", () => {
    const view = makeView("alpha\nbeta", 7); // cursor on line 2
    const before = view.state.doc.toString();
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("EC-M5: no-op on single-line document", () => {
    const view = makeView("only", 2);
    const before = view.state.doc.toString();
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe(before);
  });
});
```

---

## 5. Export / Keymap Presence Tests

These smoke tests guard against accidental omissions during implementation.

```typescript
import { describe, it, expect } from "vitest";
import { insertLink, moveLineUp, moveLineDown, formatKeymap } from "../src/editor/format";

describe("format.ts exports and keymap entries", () => {
  it("insertLink is exported as a function", () => {
    expect(typeof insertLink).toBe("function");
  });

  it("moveLineUp is exported as a function", () => {
    expect(typeof moveLineUp).toBe("function");
  });

  it("moveLineDown is exported as a function", () => {
    expect(typeof moveLineDown).toBe("function");
  });

  it("formatKeymap contains a Meta-k binding", () => {
    const entry = formatKeymap.find((b) => b.key === "Meta-k" || b.mac === "Meta-k");
    expect(entry).toBeDefined();
  });

  it("formatKeymap contains an Alt-ArrowUp binding", () => {
    const entry = formatKeymap.find((b) => b.key === "Alt-ArrowUp");
    expect(entry).toBeDefined();
  });

  it("formatKeymap contains an Alt-ArrowDown binding", () => {
    const entry = formatKeymap.find((b) => b.key === "Alt-ArrowDown");
    expect(entry).toBeDefined();
  });
});
```

---

## 6. Rust Tests

No new Rust unit tests are required for this batch. The three features touch
only:
- `menu.rs` (static menu construction — validated at compile time)
- `lib.rs` (match arm addition — no testable logic)
- Frontend TypeScript (covered above)

The existing 29 Rust tests in `src-tauri/src/` must continue to pass with no
regressions. Run `cargo test` after step_03 is complete to confirm.

---

## 7. Manual Verification Checklist

After implementation, perform the following verifications before marking
`00_index.md` steps as complete.

### Paste Link (Cmd-K)

- [ ] Copy `https://example.com` to clipboard. Select "hello" in editor. Press Cmd-K.
      Result: `[hello](https://example.com)` replaces the selection.
- [ ] Copy plain text (no URL). Select "world". Press Cmd-K.
      Result: `[world]()` with cursor inside the parens.
- [ ] No selection. Copy `https://example.com`. Press Cmd-K.
      Result: `[](https://example.com)` inserted; cursor between `[` and `]`.
- [ ] No selection. Copy plain text. Press Cmd-K.
      Result: `[]()` inserted; cursor between `[` and `]`.
- [ ] Open Format menu. Verify "Insert Link..." appears after "Highlight" with `Cmd-K` shown.
- [ ] Trigger "Insert Link..." from the menu. Behavior identical to the keymap.

### Move Line (Opt-Up / Opt-Down)

- [ ] Cursor on line 2 of a multi-line document. Press Opt-Up.
      Result: line 2 swaps with line 1; cursor remains on the moved line.
- [ ] Cursor on line 1. Press Opt-Up. Document unchanged.
- [ ] Cursor on last line. Press Opt-Down. Document unchanged.
- [ ] Select lines 2–3. Press Opt-Down.
      Result: lines 2–3 swap with line 4; selection spans the moved lines.
- [ ] Press Opt-Up three times from line 4; verify movement stops at line 1.

### Close All (Cmd-Shift-W)

- [ ] Press Cmd-Shift-W. Window hides; process remains in the Dock.
- [ ] Click the Dock icon. Window reappears (confirming hide, not destroy).
- [ ] Open File menu. Verify "Close All" appears below "Close" with `Cmd-Shift-W` shown.
- [ ] Trigger "Close All" from the menu. Same hide behavior as keyboard shortcut.

---

## 8. Test Count Target

After this step, the test totals should be:

| Suite | Before | After |
|-------|--------|-------|
| Vitest (frontend) | 34 | 34 + 19 = 53 |
| Rust (`cargo test`) | 29 | 29 (unchanged) |
