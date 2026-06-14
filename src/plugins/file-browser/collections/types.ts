/**
 * types.ts — Pure type definitions shared by every Collections module.
 *
 * No runtime values live here (those are in `schema.ts`). This file is
 * type-only so it can be imported by tests, the store layer, the renderer,
 * and the reference-index without producing any code in the IIFE bundle.
 *
 * Cross-references:
 *   - `CollectionMeta` / `StackMeta` mirror the YAML frontmatter contracts
 *     defined in `docs/specs/collections/00_index.md` §3 Data Model.
 *   - `NoteBoxKind` is the discriminated union the renderer (step 09)
 *     switches on to decide visual chrome (canonical / reference / broken).
 *   - `CollectionView` is the in-tab navigation state machine (step 12):
 *     "home" is frame 04, "stack" is frames 02/03.
 *
 * @module collections/types
 */

/**
 * Frontmatter shape of a Collection's root `_folder.md`.
 *
 *   schemaVersion — bumped only on backwards-incompatible changes (EC-13).
 *   type          — legacy discriminator. Optional after refactor R04
 *                   (2026-06-06). Fresh writes never emit it; reads
 *                   tolerate it as an alias for `layout: collection-home`.
 *   layout        — canonical discriminator. Set to "collection-home" by
 *                   the picker / writers. The dispatch path reads this
 *                   field from `_folder.md` frontmatter via `parseFolderMd`.
 *   displayName   — user-facing label. Defaults to the folder basename.
 *   stackOrder    — ordered list of Stack folder names. Authoritative; the
 *                   Home canvas (FR-14) renders in this order.
 *   icon          — optional. Not used by the Home canvas (which uses
 *                   per-Stack icons), but preserved if the user assigned
 *                   one before the layout was picked.
 */
export interface CollectionMeta {
  readonly schemaVersion: number;
  readonly type?: "collection";
  readonly layout?: "collection-home";
  readonly displayName: string;
  readonly stackOrder: readonly string[];
  /**
   * Manual order of the Collection root's immediate `.md` files
   * (filenames including `.md`). Same semantics as `stackOrder` for
   * subfolders: known-head, unknown-auto-append, missing-drop. Absent
   * or empty → notes render in vault-index (alphabetical) order.
   */
  readonly noteOrder: readonly string[];
  /**
   * COMBINED manual order of all immediate children (subfolder
   * basenames + note filenames in one list). When non-empty, the
   * Home canvas renders strictly in this sequence — Stacks and
   * notes interleave freely. When empty, the fallback is the legacy
   * "stacks-first via stackOrder, then notes via noteOrder" layout.
   * Drag-reorder of ANY tile writes the full sibling sequence here.
   */
  readonly childOrder: readonly string[];
  readonly icon?: string;
}

/**
 * Frontmatter shape of a Stack's `_folder.md`.
 *
 *   schemaVersion — see CollectionMeta.
 *   type          — legacy discriminator. Optional after refactor R04
 *                   (2026-06-06). Stacks are now identified by being a
 *                   subfolder of a `layout: collection-home` folder; the
 *                   on-disk marker is no longer needed. Reads tolerate
 *                   legacy `type: stack` for backwards compatibility.
 *   displayName   — user-facing label; may diverge from folder name on rename.
 *   icon          — catalog id OR custom-SVG absolute path. Default "notebook".
 *   order         — ordered list of note filenames canonically homed here.
 *   references    — vault-relative paths to notes canonically homed elsewhere.
 */
export interface StackMeta {
  readonly schemaVersion: number;
  readonly type?: "stack";
  readonly displayName: string;
  readonly icon: string;
  readonly order: readonly string[];
  readonly references: readonly string[];
}

/**
 * The three kinds of framed-box a Stack panel renders.
 *
 *   canonical — note file lives in `stackPath`; `noteFilename` is its basename.
 *   reference — note file lives in a different Stack; `canonicalRel` is the
 *               vault-relative path; `ownerStackPath` is the Stack rendering it.
 *   broken    — references: entry whose target file is not in the vault index
 *               (deleted, moved without watcher, or pointed at a folder). The
 *               renderer dims the box and offers only "Remove reference".
 */
export type NoteBoxKind =
  | { readonly kind: "canonical"; readonly stackPath: string; readonly noteFilename: string }
  | { readonly kind: "reference"; readonly ownerStackPath: string; readonly canonicalRel: string }
  | { readonly kind: "broken";    readonly ownerStackPath: string; readonly canonicalRel: string };

/**
 * Internal navigation state of the renderer (step 12).
 *
 * "home"  — frame 04: glyph grid plus `+` affordance.
 * "stack" — frames 02/03: framed-box list with optional in-place editor.
 */
export type CollectionView =
  | { readonly view: "home" }
  | { readonly view: "stack"; readonly stackPath: string };

/**
 * One segment of the breadcrumb chrome (step 07).
 *
 *   label           — visible text. Plain string (textContent, not innerHTML).
 *   onClick         — null for the current/non-clickable segment, otherwise the click handler.
 *   icon            — optional Material Symbols icon name (currently "home" supported).
 *   dropTargetPath  — optional absolute folder path. When set, the rendered
 *                     segment carries `data-bc-path = <path>` so drag-drop
 *                     wiring can route a dropped note tile to "move into
 *                     this ancestor folder". Only ancestor (non-current)
 *                     segments should set this.
 */
export interface BreadcrumbSegment {
  readonly label: string;
  readonly onClick: (() => void) | null;
  readonly icon?: "home";
  readonly dropTargetPath?: string;
}

/**
 * One entry in the per-tab preview cache (step 08).
 *
 *   html    — pre-rendered HTML body for the framed box's preview state.
 *   mtimeMs — the file modification time the preview was rendered against.
 *             Used to invalidate stale entries.
 *   height  — measured outer height of the rendered box; null until first
 *             measurement. Mutable because measurement happens AFTER `set()`
 *             completes (the DOM has to lay out first).
 */
export interface PreviewCacheEntry {
  readonly html: string;
  readonly mtimeMs: number;
  height: number | null;
}
