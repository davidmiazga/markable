/**
 * tests/collections/context-menu.test.ts — step_14 + refactor R01
 *
 * Asserts the pure context-menu builders for Collections-related items. The
 * MVP-era `buildMakeUnmakeCollectionItem` was deleted in step_R01 — the
 * "Make Collection" / "Unmake Collection" right-click branch is gone. The
 * remaining builders are exercised here:
 *
 *   - buildStackGlyphMenu — Stack tile right-click (Rename, Move up/down,
 *     Set folder icon…, Delete).
 *   - buildNoteBoxMenu — per-note-box right-click (canonical vs reference
 *     vs broken).
 *
 * The full file-browser integration is exercised via the helpers exported
 * from `context-actions.ts`. The plugin itself is the IIFE-bundled core
 * plugin and is not unit-testable in isolation.
 */

import { describe, it, expect } from "vitest";
import {
  buildStackGlyphMenu,
  buildNoteBoxMenu,
} from "../../src/plugins/file-browser/collections/context-actions";
import type { NoteBoxHandle } from "../../src/plugins/file-browser/collections/note-box";

const canonical: NoteBoxHandle = {
  el: document.createElement("article"),
  notePath: "/v/A/Stack 01/A.md",
  kind: { kind: "canonical", stackPath: "/v/A/Stack 01", noteFilename: "A.md" },
  state: "placeholder",
  lastRenderedHeight: null,
};

const reference: NoteBoxHandle = {
  el: document.createElement("article"),
  notePath: "/v/Other/X.md",
  kind: { kind: "reference", ownerStackPath: "/v/A/Stack 02", canonicalRel: "Other/X.md" },
  state: "placeholder",
  lastRenderedHeight: null,
};

const broken: NoteBoxHandle = {
  el: document.createElement("article"),
  notePath: "/v/X/Missing.md",
  kind: { kind: "broken", ownerStackPath: "/v/A/Stack 02", canonicalRel: "X/Missing.md" },
  state: "placeholder",
  lastRenderedHeight: null,
};

describe("context-actions: Stack glyph menu (step_14)", () => {
  it("FR-14 — Stack glyph menu has exactly Rename / Move up / Move down / Set folder icon… / Delete", () => {
    const items = buildStackGlyphMenu();
    expect(items.map((i) => i.label)).toEqual([
      "Rename",
      "Move up",
      "Move down",
      "Set folder icon…",
      "Delete",
    ]);
  });
});

describe("context-actions: Note box menu (step_14)", () => {
  it("FR-12 — canonical note menu has exactly Rename / Move up / Move down / Move to other Stack… / Add reference to another Stack… / Delete", () => {
    expect(buildNoteBoxMenu(canonical).map((i) => i.label)).toEqual([
      "Rename",
      "Move up",
      "Move down",
      "Move to other Stack…",
      "Add reference to another Stack…",
      "Delete",
    ]);
  });

  it("FR-24 — reference menu has Open canonical / Remove reference / Edit in place", () => {
    expect(buildNoteBoxMenu(reference).map((i) => i.label)).toEqual([
      "Open canonical",
      "Remove reference (from this Stack)",
      "Edit in place",
    ]);
  });

  it("EC-16 — broken menu has only Remove reference (from this Stack)", () => {
    expect(buildNoteBoxMenu(broken).map((i) => i.label)).toEqual([
      "Remove reference (from this Stack)",
    ]);
  });
});
