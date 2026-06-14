/**
 * tests/view-modal/slash-commands.test.ts (step_07)
 *
 * Tests for the new `/sidebar` and `/grid` slash commands.
 *
 * EC mapping:
 *   - EC-9: typing `/sidebar` inside an open code fence does NOT fire
 *     the slash menu (regression pin against the existing line-start
 *     regex; codeblock body lines start with content, not `/`, so the
 *     trigger naturally cannot fire there).
 *   - EC-10 (LOCKED per user directive): pressing Esc when the slash
 *     menu is showing for `/sidebar` or `/grid` MUST remove the typed
 *     slash text, close the menu, and return the cursor to where the
 *     slash started. This overrides the existing convention which
 *     leaves typed text in place; it applies only to these two new
 *     commands.
 *
 * FR mapping: FR-70, FR-71, FR-72, FR-73, FR-74.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  __TEST_ONLY_ESC_REMOVES_TYPED_TEXT,
  buildQuickCommandExtension,
} from "../../src/editor/quick-commands";

function makeView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown(),
      buildQuickCommandExtension({
        openLayoutPicker: () => undefined,
        enterPreviewMode: () => undefined,
        openCodeBlock: () => undefined,
      }),
    ],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

function typeAt(view: EditorView, text: string, pos: number): void {
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
}

function pressEnter(_view: EditorView): void {
  // The slash keymap registers Enter at top precedence via Prec.highest.
  // Simulating the keystroke directly through the contenteditable surface
  // is awkward in jsdom; we instead drive the dispatch via the captured
  // `_active` reference exposed by the popup's keymap path. For tests
  // we look up the slash-cmd-popup, find the selected chip, and trigger
  // its mousedown which dispatches via the same `acceptAt` path.
  const popup = document.querySelector(".slash-cmd-popup");
  if (!popup) throw new Error("slash popup not open");
  const selected = Array.from(popup.querySelectorAll<HTMLElement>(".slash-cmd-chip"))
    .find((c) => c.style.background.includes("accent-subtle"));
  if (!selected) {
    // Fall back to the first chip.
    const first = popup.querySelector<HTMLElement>(".slash-cmd-chip");
    if (!first) throw new Error("no chip");
    first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    return;
  }
  selected.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}

function pressEsc(view: EditorView): void {
  // Drive the Escape keymap through CodeMirror's dispatch directly.
  // The keymap is registered at Prec.highest and listens for Escape.
  const ev = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(ev);
}

function popupOpen(): boolean {
  return !!document.querySelector(".slash-cmd-popup");
}

function popupChipNames(): string[] {
  const chips = Array.from(document.querySelectorAll<HTMLElement>(".slash-cmd-chip"));
  return chips.map((c) => c.querySelector("span")?.textContent ?? "");
}

beforeEach(() => {
  // Clean any popups left over from prior tests.
  document.querySelectorAll(".slash-cmd-popup").forEach((p) => p.remove());
  document.body.innerHTML = "";
});
afterEach(() => {
  document.querySelectorAll(".slash-cmd-popup").forEach((p) => p.remove());
});

describe("slash commands — `/sidebar` and `/grid` registration (step_07)", () => {
  it("FR-70 — `/sidebar` is registered and appears when filtering on `/s`", () => {
    const view = makeView("", 0);
    typeAt(view, "/s", 0);
    expect(popupOpen()).toBe(true);
    const chips = popupChipNames();
    expect(chips).toContain("/sidebar");
  });

  it("FR-71 — `/grid` is registered and appears when filtering on `/g`", () => {
    const view = makeView("", 0);
    typeAt(view, "/g", 0);
    expect(popupOpen()).toBe(true);
    const chips = popupChipNames();
    expect(chips).toContain("/grid");
  });

  it("FR-70 — `/sidebar` inserts ```sidebar\\n\\n``` at cursor and lands inside", () => {
    const view = makeView("", 0);
    typeAt(view, "/sidebar", 0);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("```sidebar\n\n```");
    // Cursor lands on the inner blank line — offset is the length of
    // "```sidebar\n".
    expect(view.state.selection.main.head).toBe("```sidebar\n".length);
  });

  it("FR-71 — `/grid` inserts ```grid\\n\\n``` at cursor and lands inside", () => {
    const view = makeView("", 0);
    typeAt(view, "/grid", 0);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("```grid\n\n```");
    expect(view.state.selection.main.head).toBe("```grid\n".length);
  });

  it("FR-72 — slash trigger cannot fire mid-line (regex requires `/` at column 0)", () => {
    const view = makeView("Hello", 5);
    typeAt(view, "/sidebar", 5);
    // The slash matched against "Hello/sidebar" — the `/^\/(\w*)$/` regex
    // requires `/` to be the FIRST character of the line, so the popup
    // does not open in this case.
    expect(popupOpen()).toBe(false);
  });

  it("`/sidebar` and existing `/sidebar-left` both register (no collision)", () => {
    const view = makeView("", 0);
    typeAt(view, "/sidebar", 0);
    const chips = popupChipNames();
    expect(chips).toContain("/sidebar");
    expect(chips).toContain("/sidebar-left");
  });
});

describe("slash commands — EC-10 (LOCKED per user directive — Esc removes typed text)", () => {
  it("EC-10 — Esc on `/sidebar` removes the typed text and closes the menu", () => {
    const view = makeView("", 0);
    typeAt(view, "/sidebar", 0);
    expect(popupOpen()).toBe(true);
    expect(view.state.doc.toString()).toBe("/sidebar");

    pressEsc(view);

    // Popup closed.
    expect(popupOpen()).toBe(false);
    // Typed text removed — clean editor state, cursor at original slash position.
    expect(view.state.doc.toString()).toBe("");
    expect(view.state.selection.main.head).toBe(0);
  });

  it("EC-10 — Esc on `/grid` removes the typed text and closes the menu", () => {
    const view = makeView("Prefix ", 7);
    // Move to a new line so the slash can trigger.
    typeAt(view, "\n", 7);
    const slashPos = 8;
    typeAt(view, "/grid", slashPos);
    expect(popupOpen()).toBe(true);
    expect(view.state.doc.toString()).toBe("Prefix \n/grid");

    pressEsc(view);

    expect(popupOpen()).toBe(false);
    // Typed `/grid` text removed; cursor back at slashPos.
    expect(view.state.doc.toString()).toBe("Prefix \n");
    expect(view.state.selection.main.head).toBe(slashPos);
  });

  it("EC-10 scope — Esc on `/table` leaves the typed text in place (legacy convention)", () => {
    // `/table` is one of the existing slash commands; its name is NOT
    // in ESC_REMOVES_TYPED_TEXT, so the legacy "leave typed text" rule
    // applies. This pins the EC-10 scope to only the two new commands.
    const view = makeView("", 0);
    typeAt(view, "/table", 0);
    expect(popupOpen()).toBe(true);

    pressEsc(view);

    expect(popupOpen()).toBe(false);
    // Existing convention: typed text persists.
    expect(view.state.doc.toString()).toBe("/table");
  });

  it("EC-10 scope — Esc on existing `/code` leaves the typed text in place", () => {
    const view = makeView("", 0);
    typeAt(view, "/code", 0);
    expect(popupOpen()).toBe(true);
    pressEsc(view);
    expect(popupOpen()).toBe(false);
    expect(view.state.doc.toString()).toBe("/code");
  });
});

describe("slash commands — L-1 hardening (Object.freeze on EC-10 opt-in Set)", () => {
  it("ESC_REMOVES_TYPED_TEXT is runtime-frozen (Object.isFrozen returns true)", () => {
    // Reviewer L-1: the docstring promised a "frozen Set" but pre-fix
    // the binding was only `ReadonlySet<string>` (TypeScript-level). A
    // malicious plugin could grab the reference and call `.add("table")`
    // at runtime to extend EC-10's "Esc removes typed text" behaviour
    // to other slash commands. After the fix, the Set is wrapped in
    // Object.freeze so the binding is locked at module load.
    expect(Object.isFrozen(__TEST_ONLY_ESC_REMOVES_TYPED_TEXT)).toBe(true);
  });
});

describe("slash commands — EC-9 (slash trigger suppressed inside open code fences)", () => {
  it("EC-9 — `/sidebar` typed on a blank line INSIDE an open ```js fence does NOT open the popup", () => {
    // AD-7 explicitly calls for a syntax-tree-aware verification test:
    // the existing slash-trigger regex only requires `/` at column 0,
    // which would naively fire even on the inner blank line of a code
    // fence. The fix in `quick-commands.ts` consults the Lezer syntax
    // tree and skips when the cursor's enclosing node is `FencedCode`
    // (or any other code-like context).
    const doc = "```js\n\n```";
    // Cursor on the inner blank line — between the two newlines.
    // Offset breakdown: "```js" (5) + "\n" (1) = position 6.
    const view = makeView(doc, 6);
    typeAt(view, "/sidebar", 6);
    expect(popupOpen()).toBe(false);
  });

  it("EC-9 — `/grid` typed inside an open ```python fence is also suppressed", () => {
    const doc = "```python\n\n```";
    // "```python" (9) + "\n" (1) = position 10.
    const view = makeView(doc, 10);
    typeAt(view, "/grid", 10);
    expect(popupOpen()).toBe(false);
  });

  it("EC-9 paired regression pin — `/sidebar` on a normal blank line OUTSIDE any fence STILL opens the popup", () => {
    // Pairs with the inside-fence test above. Without this, a buggy
    // syntax-tree guard could globally suppress the slash menu — which
    // would break every other test in this file. This test pins the
    // expected behaviour explicitly.
    const view = makeView("", 0);
    typeAt(view, "/sidebar", 0);
    expect(popupOpen()).toBe(true);
  });
});
