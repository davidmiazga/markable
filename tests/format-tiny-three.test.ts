/**
 * tests/format-tiny-three.test.ts
 *
 * Vitest tests for the three "tiny-three" features added to format.ts:
 *   - insertLink  (Cmd-K, AC-L1–L7, EC-L1/L2/L5)
 *   - moveLineUp  (Opt-Up,   AC-M1/M3/M5/M6, EC-M1/M3/M5/M7)
 *   - moveLineDown (Opt-Down, AC-M2/M4/M5,    EC-M2/M4/M5)
 *
 * The test helper `makeView` creates a real CM6 EditorState and a minimal
 * view-like object whose `dispatch()` method applies transactions and updates
 * the visible `state` property. This avoids requiring a live browser layout
 * engine (which CM6's EditorView needs) while still exercising the real
 * transaction-building logic inside insertLink / moveLineUp / moveLineDown.
 *
 * navigator.clipboard is mocked per-group because happy-dom does not
 * implement Clipboard.readText().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection, type Transaction, type TransactionSpec } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import {
  insertLink,
  moveLineUp,
  moveLineDown,
  formatKeymap,
} from "../src/editor/format";

// ---------------------------------------------------------------------------
// Test helper — makeView
// ---------------------------------------------------------------------------

/**
 * Builds a minimal EditorView-like object backed by a real CM6 EditorState.
 *
 * `dispatch()` applies a CM6 TransactionSpec using `state.update()` and stores
 * the resulting state, so callers can assert on `view.state.doc` and
 * `view.state.selection` after calling the format functions.
 *
 * The `focus()` call is a no-op here — it is required by the function
 * signatures in format.ts but has no testable side-effect in this context.
 *
 * @param doc    - Initial document text.
 * @param anchor - Initial cursor / selection anchor position.
 * @param head   - Optional selection head; defaults to anchor (collapsed cursor).
 */
function makeView(doc: string, anchor = 0, head?: number) {
  let state = EditorState.create({
    doc,
    selection: { anchor, head: head ?? anchor },
  });

  return {
    get state() {
      return state;
    },
    dispatch(tr: Parameters<typeof state.update>[0]) {
      // Apply the transaction spec to the current state.
      state = state.update(tr).state;
    },
    focus() {
      // No-op in test context — format functions call focus() for UX purposes
      // only; there is no DOM focus to manage in the Vitest environment.
    },
  } as unknown as EditorView;
}

// ---------------------------------------------------------------------------
// insertLink tests
// ---------------------------------------------------------------------------

describe("insertLink", () => {
  let clipboardMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Replace navigator.clipboard with a mock object before each test.
    // happy-dom does not implement Clipboard.readText(), so the mock is
    // required for all clipboard code paths.
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

  it("AC-L1: wraps selection with valid URL from clipboard", async () => {
    // Condition: selection="hello", clipboard has a valid https:// URL.
    // Expected: [hello](https://example.com), cursor placed after the closing ')'.
    clipboardMock.mockResolvedValue("https://example.com");
    const view = makeView("hello world", 0, 5); // selects "hello"
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[hello](https://example.com) world");
  });

  it("AC-L2: wraps selection with empty parens when clipboard has no valid URL", async () => {
    // Condition: selection="hello", clipboard text is plain (non-URL).
    // Expected: [hello](), cursor placed between the parentheses (position 8).
    clipboardMock.mockResolvedValue("not a url");
    const view = makeView("hello world", 0, 5);
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[hello]() world");
    // "[hello](" is 8 characters; cursor goes at position 8 (between '(' and ')')
    expect(view.state.selection.main.anchor).toBe(8);
  });

  it("AC-L3: inserts [](url) with no selection and valid URL", async () => {
    // Condition: no selection, cursor at position 2, clipboard has valid URL.
    // Expected: [](https://example.com) inserted at position 2; cursor between '[]' (position 3).
    clipboardMock.mockResolvedValue("https://example.com");
    const view = makeView("hello", 2); // collapsed cursor at position 2, no selection
    await insertLink(view);
    const inserted = view.state.doc.sliceString(2, 2 + "[](https://example.com)".length);
    expect(inserted).toBe("[](https://example.com)");
    // Cursor should be at position 3 — one character after '[', inside '[]'
    expect(view.state.selection.main.anchor).toBe(3);
  });

  it("AC-L4: inserts []() with no selection and no valid URL", async () => {
    // Condition: no selection, cursor at position 2, clipboard is empty.
    // Expected: []() inserted at position 2; cursor at position 3 (between '[]').
    clipboardMock.mockResolvedValue("");
    const view = makeView("hello", 2);
    await insertLink(view);
    const inserted = view.state.doc.sliceString(2, 6); // "[]() " → first 4 chars
    expect(inserted).toBe("[]()");
    expect(view.state.selection.main.anchor).toBe(3);
  });

  it("EC-L1: clipboard rejection falls back to no-URL path without throwing", async () => {
    // Simulates the case where the user has denied clipboard permission.
    // Expected: behaves like AC-L2 (selection + no URL); no exception propagates.
    clipboardMock.mockRejectedValue(new DOMException("NotAllowedError"));
    const view = makeView("hello", 0, 5);
    await insertLink(view); // must not throw
    // With no URL the result is [hello]() — trailing " " from original " world" not present
    // because the original doc was "hello" with selection 0-5 (entire string)
    expect(view.state.doc.toString()).toBe("[hello]()");
  });

  it("EC-L2: trims trailing whitespace and newline from clipboard URL", async () => {
    // Clipboard value has trailing spaces and a newline — must be trimmed before
    // the URL regex test and before insertion.
    clipboardMock.mockResolvedValue("https://example.com  \n");
    const view = makeView("x", 0, 1); // selects "x"
    await insertLink(view);
    // Trimmed URL "https://example.com" must appear in the output — not "https://example.com  \n"
    expect(view.state.doc.toString()).toBe("[x](https://example.com)");
  });

  it("EC-L5: ftp:// URL is treated as invalid (regex requires http/https)", async () => {
    // The URL_RE only accepts http:// and https://. ftp:// must not be recognised
    // as a valid URL, so the output is [x]() rather than [x](ftp://example.com).
    clipboardMock.mockResolvedValue("ftp://example.com");
    const view = makeView("x", 0, 1);
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[x]()");
  });

  it("EC-L3: multi-line selection is used verbatim as link label", async () => {
    // The label is the raw sliced string between selection.from and selection.to.
    // A newline embedded in that slice must be preserved as-is — no normalisation.
    // Condition: selection spans "line1\nline2", clipboard has a valid URL.
    // Expected: [line1\nline2](https://example.com)
    clipboardMock.mockResolvedValue("https://example.com");
    const view = makeView("line1\nline2", 0, 11);
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[line1\nline2](https://example.com)");
  });

  it("EC-L4: existing link selected is wrapped as new label, not toggled", async () => {
    // insertLink has no "detect existing link and unwrap" logic — it wraps
    // whatever text is selected, even if that text is already a Markdown link.
    // This is intentional: the user may want to nest or re-link.
    // Condition: selection is "[foo](bar)", clipboard has a new URL.
    // Expected: [[foo](bar)](https://new.com)
    clipboardMock.mockResolvedValue("https://new.com");
    const existingLink = "[foo](bar)";
    const view = makeView(existingLink, 0, existingLink.length);
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[[foo](bar)](https://new.com)");
  });
});

// ---------------------------------------------------------------------------
// moveLineUp tests
// ---------------------------------------------------------------------------

describe("moveLineUp", () => {
  it("AC-M1: moves cursor line upward", () => {
    // Setup: two lines; cursor on line 2. After moveLineUp, line 2 becomes line 1.
    //   Before: "alpha\nbeta"  (cursor at pos 6, start of "beta")
    //   After:  "beta\nalpha"
    const view = makeView("alpha\nbeta", 6);
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
    // Cursor should still be on the moved line, which is now line 1.
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(1);
  });

  it("EC-M1 / AC-M5: no-op when cursor is on line 1", () => {
    // The boundary guard must prevent any dispatch when the block starts at line 1.
    const view = makeView("alpha\nbeta", 2); // cursor on line 1
    const before = view.state.doc.toString();
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("EC-M3: no-op when multi-line selection starts at line 1 (moveLineUp)", () => {
    // A selection that includes line 1 cannot move up — the block boundary guard
    // fires because firstLine.number === 1.
    const view = makeView("alpha\nbeta\ngamma", 0, 10); // selection spans lines 1–2
    const before = view.state.doc.toString();
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("EC-M5: no-op on single-line document (moveLineUp)", () => {
    // A single-line doc has line 1 === last line; both boundary checks trigger.
    const view = makeView("only", 2);
    const before = view.state.doc.toString();
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("AC-M4 / AC-M6: moves multi-line selection upward as a single block", () => {
    // Setup: three lines; selection spans lines 2–3. The entire block moves up.
    //   Before: "alpha\nbeta\ngamma"  selection: 6..16 (lines 2–3)
    //   After:  "beta\ngamma\nalpha"  selection spans lines 1–2
    const view = makeView("alpha\nbeta\ngamma", 6, 16);
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("beta\ngamma\nalpha");
    // Both anchor and head should now be on lines 1–2 of the new document.
    const sel = view.state.selection.main;
    const anchorLine = view.state.doc.lineAt(sel.from).number;
    const headLine   = view.state.doc.lineAt(sel.to).number;
    expect(anchorLine).toBe(1);
    expect(headLine).toBe(2);
  });

  it("EC-M7: no trailing newline gained or lost when last line has no trailing newline", () => {
    // "alpha\nbeta" has no trailing '\n'. After swapping the lines the document
    // must also end without a trailing '\n'.
    const view = makeView("alpha\nbeta", 6); // cursor on "beta"
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
    expect(view.state.doc.toString().endsWith("\n")).toBe(false);
  });

  it("EC-M6: only selection.main is moved; secondary cursor line is unaffected", () => {
    // Verifies that moveLineUp operates exclusively on selection.main and leaves
    // secondary ranges untouched. The primary selection (mainIndex 0) is on
    // line 3 ("gamma"); the secondary cursor is on line 2 ("beta").
    // After moveLineUp, "gamma" should swap with "beta", placing "gamma" on
    // line 2 and "beta" on line 3. "alpha" on line 1 is never involved.
    //
    // doc offsets:
    //   "alpha" = 0..4  (line 1)
    //   "beta"  = 6..9  (line 2)
    //   "gamma" = 11..15 (line 3)
    const state = EditorState.create({
      doc: "alpha\nbeta\ngamma",
      // mainIndex: 0 means ranges[0] is selection.main.
      selection: EditorSelection.create([
        EditorSelection.cursor(12), // inside "gamma" (line 3) — primary / main
        EditorSelection.cursor(6),  // inside "beta"  (line 2) — secondary
      ], 0),
    });

    // Build a minimal view stub that applies each dispatched TransactionSpec
    // through state.update() to produce a real Transaction (which has a .state
    // property). format.ts calls view.dispatch(spec) with a plain TransactionSpec,
    // not a pre-built Transaction, so we must materialise it here.
    const dispatched: Transaction[] = [];
    let currentState = state;
    const view = {
      get state() { return currentState; },
      dispatch(spec: TransactionSpec) {
        // state.update() converts the spec into a real Transaction with .state.
        const tr = currentState.update(spec);
        dispatched.push(tr);
        currentState = tr.state; // keep state current for multi-dispatch safety
      },
      focus() {},
    } as unknown as EditorView;

    moveLineUp(view);

    // Exactly one transaction must have been dispatched.
    expect(dispatched).toHaveLength(1);

    const newDoc = dispatched[0]?.state.doc.toString();
    // "gamma" moved up; "beta" took its place; "alpha" untouched.
    expect(newDoc).toBe("alpha\ngamma\nbeta");
  });
});

// ---------------------------------------------------------------------------
// moveLineDown tests
// ---------------------------------------------------------------------------

describe("moveLineDown", () => {
  it("AC-M2: moves cursor line downward", () => {
    // Setup: two lines; cursor on line 1. After moveLineDown, line 1 becomes line 2.
    //   Before: "alpha\nbeta"  (cursor at pos 2, on "alpha")
    //   After:  "beta\nalpha"
    const view = makeView("alpha\nbeta", 2);
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(2);
  });

  it("EC-M2 / AC-M6: no-op when cursor is on the last line", () => {
    // The boundary guard must prevent any dispatch when the block ends at the last line.
    const view = makeView("alpha\nbeta", 7); // cursor on line 2 (the last line)
    const before = view.state.doc.toString();
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("EC-M4: no-op when multi-line selection ends at last line (moveLineDown)", () => {
    // A selection that includes the last line cannot move down.
    const view = makeView("alpha\nbeta\ngamma", 6, 16); // selection spans lines 2–3
    const before = view.state.doc.toString();
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("EC-M5: no-op on single-line document (moveLineDown)", () => {
    const view = makeView("only", 2);
    const before = view.state.doc.toString();
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("AC-M4 mirror: moves multi-line selection downward as a single block", () => {
    // Selection covers lines 1–2; both lines move below line 3.
    const view = makeView("alpha\nbeta\ngamma", 0, 9);
    moveLineDown(view);
    expect(view.state.doc.toString()).toBe("gamma\nalpha\nbeta");
  });

  it("AC-M3: repeated moveLineUp moves line until line 1, then no-ops", () => {
    // Cursor on line 3; two moves bring it to line 1; third press is a no-op.
    const view = makeView("alpha\nbeta\ngamma", 12);
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("alpha\ngamma\nbeta");
    moveLineUp(view);
    expect(view.state.doc.toString()).toBe("gamma\nalpha\nbeta");
    const before = view.state.doc.toString();
    moveLineUp(view); // cursor now on line 1 — must be no-op
    expect(view.state.doc.toString()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Export and keymap presence smoke tests
// ---------------------------------------------------------------------------

describe("format.ts exports and keymap entries", () => {
  it("insertLink is exported as a function", () => {
    // Guards against accidental omission of the export keyword.
    expect(typeof insertLink).toBe("function");
  });

  it("moveLineUp is exported as a function", () => {
    expect(typeof moveLineUp).toBe("function");
  });

  it("moveLineDown is exported as a function", () => {
    expect(typeof moveLineDown).toBe("function");
  });

  it("formatKeymap contains a Meta-k binding for insertLink", () => {
    // Verifies that the Cmd-K keymap entry was added.
    const entry = formatKeymap.find((b) => b.key === "Meta-k" || b.mac === "Meta-k");
    expect(entry).toBeDefined();
  });

  it("formatKeymap contains an Alt-ArrowUp binding for moveLineUp", () => {
    const entry = formatKeymap.find((b) => b.key === "Alt-ArrowUp");
    expect(entry).toBeDefined();
  });

  it("formatKeymap contains an Alt-ArrowDown binding for moveLineDown", () => {
    const entry = formatKeymap.find((b) => b.key === "Alt-ArrowDown");
    expect(entry).toBeDefined();
  });
});
