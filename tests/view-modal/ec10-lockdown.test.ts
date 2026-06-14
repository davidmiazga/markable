/**
 * tests/view-modal/ec10-lockdown.test.ts (step_10)
 *
 * EC-10 lock-down regression test. The user directive (2026-06-08,
 * non-negotiable) says: when the slash-command menu is showing for
 * the NEW `/sidebar` or `/grid` commands, pressing Esc must:
 *
 *   1. Remove the typed slash text (the `/sidebar` or `/grid` chars).
 *   2. Close the slash menu.
 *   3. Return the cursor to the position where the slash started.
 *
 * This overrides the existing slash-command convention and applies
 * ONLY to the two new commands. Existing commands (e.g. `/code`,
 * `/sidebar-left`, `/table`) keep their legacy behaviour where the
 * typed text remains in place after Esc.
 *
 * The implementation lives in `src/editor/quick-commands.ts`:
 *   - `ESC_REMOVES_TYPED_TEXT` — frozen Set of opt-in command names.
 *   - `QuickCommandsPlugin.cancelOnEsc(view)` — branches on whether
 *     the typed text matches one of the opt-in names.
 *
 * Step_07 carries the bulk of the test surface
 * (`tests/view-modal/slash-commands.test.ts`); this file is the
 * step_10 lock-down pin that asserts the directive's three points
 * explicitly so a future refactor cannot silently regress.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { buildQuickCommandExtension } from "../../src/editor/quick-commands";

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

function pressEsc(view: EditorView): void {
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

beforeEach(() => {
  document.querySelectorAll(".slash-cmd-popup").forEach((p) => p.remove());
  document.body.innerHTML = "";
});
afterEach(() => {
  document.querySelectorAll(".slash-cmd-popup").forEach((p) => p.remove());
});

describe("step_10 — EC-10 lock-down (USER DIRECTIVE)", () => {
  it("DIRECTIVE point 1+2+3 — `/sidebar` + Esc removes typed text, closes menu, cursor at slash position", () => {
    const view = makeView("", 0);
    const slashPos = 0;
    typeAt(view, "/sidebar", slashPos);

    // Precondition: menu is showing.
    expect(popupOpen()).toBe(true);
    expect(view.state.doc.toString()).toBe("/sidebar");
    expect(view.state.selection.main.head).toBe(slashPos + "/sidebar".length);

    pressEsc(view);

    // Point 1: typed slash text removed.
    expect(view.state.doc.toString()).toBe("");
    // Point 2: slash menu closed.
    expect(popupOpen()).toBe(false);
    // Point 3: cursor at where the slash started.
    expect(view.state.selection.main.head).toBe(slashPos);
  });

  it("DIRECTIVE point 1+2+3 — `/grid` + Esc removes typed text, closes menu, cursor at slash position", () => {
    // Place the slash at a non-zero column so we can verify the cursor
    // returns precisely to the slash start (not to column 0).
    const view = makeView("Hello\n", 6);
    const slashPos = 6;
    typeAt(view, "/grid", slashPos);

    expect(popupOpen()).toBe(true);
    expect(view.state.doc.toString()).toBe("Hello\n/grid");

    pressEsc(view);

    expect(view.state.doc.toString()).toBe("Hello\n");
    expect(popupOpen()).toBe(false);
    expect(view.state.selection.main.head).toBe(slashPos);
  });

  it("SCOPE — EC-10 does NOT apply to `/code` (existing command keeps legacy convention)", () => {
    const view = makeView("", 0);
    typeAt(view, "/code", 0);
    expect(popupOpen()).toBe(true);

    pressEsc(view);

    // Existing convention: typed text remains.
    expect(view.state.doc.toString()).toBe("/code");
    expect(popupOpen()).toBe(false);
  });

  it("SCOPE — EC-10 does NOT apply to `/sidebar-left` (typed text remains)", () => {
    // Typing `/sidebar-left` partially matches both `/sidebar` and
    // `/sidebar-left`; the slash regex `/^\/(\w*)$/` excludes `-` from
    // \w, so the popup closes when `-` is typed. Drive the test by
    // typing only the slug we want to check.
    //
    // We type `/sidebar` first to verify the popup shows; the directive
    // applies on Esc when the *typed text* exactly matches `sidebar`
    // (which is in the opt-in set). To verify the SCOPE pin, we have
    // to construct a case where the typed text matches a NON-opt-in
    // command name. We use `/sidebar-left` typed all at once via an
    // out-of-band path: type the full literal and verify that after
    // the `-` is typed the popup is dismissed by the regex itself.
    const view = makeView("", 0);
    typeAt(view, "/sidebar-left", 0);
    // The popup closes naturally because `-` isn't a \w character.
    expect(popupOpen()).toBe(false);
    // Esc with no popup is a no-op.
    pressEsc(view);
    expect(view.state.doc.toString()).toBe("/sidebar-left");
  });

  it("SCOPE — EC-10 does NOT apply to a partial typing like `/sid` (not exactly `/sidebar` or `/grid`)", () => {
    const view = makeView("", 0);
    typeAt(view, "/sid", 0);
    expect(popupOpen()).toBe(true);

    pressEsc(view);

    // Typed text is `/sid` which is NOT in ESC_REMOVES_TYPED_TEXT;
    // legacy convention applies.
    expect(view.state.doc.toString()).toBe("/sid");
    expect(popupOpen()).toBe(false);
  });

  it("State integrity — after Esc removal, typing `/sidebar` again still triggers the popup", () => {
    const view = makeView("", 0);
    typeAt(view, "/sidebar", 0);
    pressEsc(view);
    expect(view.state.doc.toString()).toBe("");

    // Type again — popup must show again.
    typeAt(view, "/sidebar", 0);
    expect(popupOpen()).toBe(true);
  });
});
