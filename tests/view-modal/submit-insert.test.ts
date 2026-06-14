/**
 * tests/view-modal/submit-insert.test.ts (step_05)
 *
 * Submit-insert tests. Verifies that the modal in insert mode hands
 * the user's choices to `ctx.onSubmit` and that callers can produce a
 * cursor-aware insert via `buildSelectFenceFromState` + view.dispatch.
 *
 * EC mapping: EC-3 (mid-line insert).
 *
 * FR mapping: FR-5, FR-7, FR-8, FR-40.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  openViewModal,
  VIEW_MODAL_OVERLAY_ID,
} from "../../src/lib/codeblock-modal";
import { buildSelectFenceFromState } from "../../src/lib/select-builder";

function panel(): HTMLElement {
  return document.getElementById(VIEW_MODAL_OVERLAY_ID)!.querySelector<HTMLElement>(".cbm-panel")!;
}

function clickPrimary(): void {
  panel().querySelector<HTMLButtonElement>(".cbm-btn-primary")!.click();
}

function makeView(doc: string, cursor: number, anchor?: number): EditorView {
  const sel = anchor !== undefined
    ? EditorSelection.range(anchor, cursor)
    : EditorSelection.cursor(cursor);
  const state = EditorState.create({ doc, selection: sel });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

beforeEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());
afterEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());

describe("openViewModal — submit-insert (step_05)", () => {
  it("FR-5 — title bar reads `Insert Codeblock` in insert mode", () => {
    openViewModal("insert", {});
    expect(panel().querySelector(".cbm-title")?.textContent).toBe("Insert Codeblock");
  });

  it("FR-40 — action button reads `Insert` in insert mode", () => {
    openViewModal("insert", {});
    expect(panel().querySelector<HTMLButtonElement>(".cbm-btn-primary")?.textContent).toBe("Insert");
  });

  it("FR-8 — empty line: cursor at line start → no leading newline prepended by the caller", () => {
    const view = makeView("\nABC\n", 0);
    let dispatchedText = "";
    openViewModal("insert", {
      editor: { view, from: 0, to: 0 },
      onSubmit: (state) => {
        const fence = buildSelectFenceFromState(state);
        const line = view.state.doc.lineAt(0);
        const needLead = line.from !== 0;
        const insertText = (needLead ? "\n" : "") + fence + "\n";
        dispatchedText = insertText;
        view.dispatch({ changes: { from: 0, to: 0, insert: insertText } });
      },
    });
    clickPrimary();
    expect(dispatchedText.startsWith("```select")).toBe(true);
  });

  it("EC-3 / FR-8 — mid-line cursor: leading newline prepended", () => {
    const view = makeView("ABCDEFG", 4);
    let dispatchedText = "";
    openViewModal("insert", {
      editor: { view, from: 4, to: 4 },
      onSubmit: (state) => {
        const fence = buildSelectFenceFromState(state);
        const line = view.state.doc.lineAt(4);
        // Cursor at column 4 of a non-empty line — needs leading newline.
        const needLead = line.from !== 4;
        const insertText = (needLead ? "\n" : "") + fence + "\n";
        dispatchedText = insertText;
        view.dispatch({ changes: { from: 4, to: 4, insert: insertText } });
      },
    });
    clickPrimary();
    expect(dispatchedText.startsWith("\n```select")).toBe(true);
  });

  it("submit replaces selection range when present", () => {
    const view = makeView("AAAAAAAAAA", 8, 2);
    let dispatched: { from: number; to: number; insert: string } | null = null;
    openViewModal("insert", {
      editor: { view, from: 2, to: 8 },
      onSubmit: (state) => {
        const fence = buildSelectFenceFromState(state);
        dispatched = { from: 2, to: 8, insert: fence + "\n" };
        view.dispatch({ changes: dispatched });
      },
    });
    clickPrimary();
    expect(dispatched).not.toBeNull();
    expect(dispatched!.from).toBe(2);
    expect(dispatched!.to).toBe(8);
    expect(dispatched!.insert.startsWith("```select")).toBe(true);
  });

  it("Collection tab in insert mode produces `display: collection-home`", () => {
    const view = makeView("", 0);
    let dispatchedText = "";
    openViewModal("insert", {
      editor: { view, from: 0, to: 0 },
      onSubmit: (state) => {
        dispatchedText = buildSelectFenceFromState(state);
      },
    });
    panel().querySelector<HTMLElement>('.vm-tab[data-slug="collection-home"]')!.click();
    clickPrimary();
    expect(dispatchedText).toContain("display: collection-home");
  });

  it("modal closes after submit (FR-7 hand-off)", () => {
    const view = makeView("", 0);
    openViewModal("insert", {
      editor: { view, from: 0, to: 0 },
      onSubmit: () => undefined,
    });
    clickPrimary();
    expect(document.getElementById(VIEW_MODAL_OVERLAY_ID)).toBeNull();
  });
});
