/**
 * tests/format-front-matter.test.ts
 *
 * Vitest tests for front matter detection and insertion:
 *   - detectFrontMatter  (live-preview.ts)
 *   - insertFrontMatter  (format.ts)
 *
 * Uses the same makeView helper pattern as format-tiny-three.test.ts.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { detectFrontMatter } from "../src/editor/live-preview";
import { insertFrontMatter } from "../src/editor/format";

// ---------------------------------------------------------------------------
// Test helper — makeView (same pattern as format-tiny-three.test.ts)
// ---------------------------------------------------------------------------

function makeView(doc: string, anchor = 0) {
  let state = EditorState.create({
    doc,
    selection: { anchor },
  });

  return {
    get state() {
      return state;
    },
    dispatch(tr: Parameters<typeof state.update>[0]) {
      state = state.update(tr).state;
    },
    focus() {},
  };
}

// ---------------------------------------------------------------------------
// detectFrontMatter tests
// ---------------------------------------------------------------------------

describe("detectFrontMatter", () => {
  it("returns -1 for empty document", () => {
    const state = EditorState.create({ doc: "" });
    expect(detectFrontMatter(state)).toBe(-1);
  });

  it("returns -1 when line 1 is not ---", () => {
    const state = EditorState.create({ doc: "# Heading\ncontent\n" });
    expect(detectFrontMatter(state)).toBe(-1);
  });

  it("returns -1 when only --- on line 1 with no closing fence", () => {
    const state = EditorState.create({ doc: "---\ntitle: Hello\n" });
    expect(detectFrontMatter(state)).toBe(-1);
  });

  it("returns 3 for default inserted template (empty body — previously broken)", () => {
    // "---\n\n---\n" → line 1: ---, line 2: (empty), line 3: ---
    // This was the primary bug: empty line 2 caused detection to return -1.
    const state = EditorState.create({ doc: "---\n\n---\n" });
    expect(detectFrontMatter(state)).toBe(3);
  });

  it("returns 3 for front matter with text body", () => {
    const state = EditorState.create({ doc: "---\ntitle: Hello\n---\n" });
    expect(detectFrontMatter(state)).toBe(3);
  });

  it("returns 3 for front matter with ... closer", () => {
    const state = EditorState.create({ doc: "---\ntitle: Hello\n...\n" });
    expect(detectFrontMatter(state)).toBe(3);
  });

  it("returns 3 and ignores content after closing fence", () => {
    const state = EditorState.create({ doc: "---\ntitle: Hello\n---\nBody content here\n" });
    expect(detectFrontMatter(state)).toBe(3);
  });

  it("returns 4 for multi-line front matter body", () => {
    const state = EditorState.create({ doc: "---\ntitle: Hello\nauthor: World\n---\n" });
    expect(detectFrontMatter(state)).toBe(4);
  });

  it("returns -1 for doc shorter than 3 lines", () => {
    const state = EditorState.create({ doc: "---\n" });
    expect(detectFrontMatter(state)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// insertFrontMatter tests
// ---------------------------------------------------------------------------

describe("insertFrontMatter", () => {
  it("inserts ---/---  block at top of fresh document", () => {
    const view = makeView("Hello world\n");
    insertFrontMatter(view as any);
    expect(view.state.doc.toString()).toBe("---\n\n---\nHello world\n");
  });

  it("places cursor on line 2 (inside block) after insertion", () => {
    const view = makeView("Hello world\n");
    insertFrontMatter(view as any);
    // anchor: 4 = after "---\n"
    expect(view.state.selection.main.anchor).toBe(4);
  });

  it("does not double-insert when front matter already present", () => {
    const doc = "---\ntitle: Hello\n---\nBody\n";
    const view = makeView(doc);
    insertFrontMatter(view as any);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("moves cursor to line 2 when front matter already present", () => {
    const doc = "---\ntitle: Hello\n---\nBody\n";
    const view = makeView(doc, 20); // cursor somewhere in body
    insertFrontMatter(view as any);
    // line 2 starts at position 4 ("---\n" = 4 chars)
    expect(view.state.selection.main.anchor).toBe(4);
  });

  it("inserts on completely empty document", () => {
    const view = makeView("");
    insertFrontMatter(view as any);
    expect(view.state.doc.toString()).toBe("---\n\n---\n");
    expect(view.state.selection.main.anchor).toBe(4);
  });
});
