/**
 * context-actions.ts — Pure builders for the Collections-related context
 * menu items.
 *
 * The file-browser plugin's `showContextMenu()` accepts a list of
 * `{ label, handler, disabled?, separator? }` items. This module produces
 * the literal label lists for each kind of context (Stack glyph, note box)
 * so tests can assert the items without spinning up the full IIFE plugin.
 *
 * The MVP-era `buildMakeUnmakeCollectionItem` and `FolderContextItem`
 * interface were removed in refactor step_R01 (2026-06-06). The "Make
 * Collection" / "Unmake Collection" gesture is gone — Collections is now
 * opted into via the display-options picker. The renderer (step 12) still
 * wires the per-box and per-glyph menus through the helpers below.
 *
 * @module collections/context-actions
 */

import {
  buildNoteBoxContextItems,
  type NoteBoxContextItem,
  type NoteBoxHandle,
} from "./note-box";
import {
  buildStackGlyphContextItems,
  type StackGlyphContextItem,
} from "./home-canvas";

/**
 * Build the Stack-glyph context menu (FR-14). Pure passthrough of the
 * home-canvas helper — exported here for symmetry so the renderer imports
 * all Collections menu shapes from one location.
 */
export function buildStackGlyphMenu(): readonly StackGlyphContextItem[] {
  return buildStackGlyphContextItems();
}

/**
 * Build the per-note-box context menu (FR-12 / FR-24 / EC-16). Returns
 * exactly the items spec'd by step 09; the renderer dispatches each
 * action via the file-browser's existing `showContextMenu()`.
 */
export function buildNoteBoxMenu(
  handle: NoteBoxHandle,
): readonly NoteBoxContextItem[] {
  return buildNoteBoxContextItems(handle);
}
