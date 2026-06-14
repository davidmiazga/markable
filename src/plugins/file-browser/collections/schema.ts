/**
 * schema.ts — Runtime constants, YAML key-name table, and small pure utility
 * helpers for the Collections feature.
 *
 * This file is intentionally separate from `types.ts` so that the type-only
 * file can be imported by anything (tests, lazy plugin modules) without
 * pulling runtime code into the IIFE bundle.
 *
 * Every export here is pure: no DOM access, no I/O, no Tauri calls. The
 * module is safe to import from any context.
 *
 * @module collections/schema
 */

/**
 * Current frontmatter schema revision. Bumped only on breaking changes.
 *
 * The store layer (step 02) rejects writes against a `_folder.md` whose
 * `schemaVersion` is greater than this constant (EC-13: a newer Markable
 * built the file; we render read-only to avoid clobbering unknown fields).
 */
export const COLLECTIONS_SCHEMA_VERSION = 1;

/**
 * Canonical YAML key names used in `_folder.md` for the Collections feature.
 *
 * Encoded as a frozen object so every caller imports from the same source.
 * If a key name changes (it shouldn't — the on-disk format is the user's
 * data) the update happens here once.
 */
export const COLLECTION_YAML_KEYS = {
  schemaVersion: "schemaVersion",
  // Legacy marker. Refactor R04 (2026-06-06): no longer emitted on write;
  // tolerated on read as an alias for `layout: collection-home`.
  type:          "type",
  // Canonical marker after refactor R04. Mirrors `layout: cards` /
  // `layout: bookshelf` etc. — selected via the display-options picker.
  layout:        "layout",
  displayName:   "displayName",
  stackOrder:    "stackOrder",
  noteOrder:     "noteOrder",
  childOrder:    "childOrder",
  order:         "order",
  references:    "references",
  icon:          "icon",
} as const;

/**
 * Canonical value of the `layout:` field for a Collection root. Used by
 * `store.readCollection` (read-compat alias) and `store.writeCollectionMeta`
 * (canonical writer). Single source of truth so a rename here would
 * propagate without grep across the codebase.
 */
export const COLLECTION_LAYOUT_KEY = "collection-home";

/**
 * Default icon assigned to a new Stack (FR-6, C-6).
 *
 * Resolves through `interpretIconValue(...)` (folder-icons.ts) to the
 * `folder-icon-notebook` CSS class shipped by the folder-icon-assignment
 * feature. The user can re-skin via the existing "Set folder icon…"
 * right-click flow.
 */
export const STACK_DEFAULT_ICON = "notebook";

/**
 * Prefix used by `nextStackName` to derive auto-generated Stack folder names.
 *
 * Exported so a future drag-reorder / rename-multiple UI (DW-1) can reuse
 * the literal without re-typing it.
 */
export const STACK_AUTO_NAME_PREFIX = "Stack";

/**
 * Regex that matches an auto-generated Stack folder name and captures the
 * numeric suffix. Anchored to the full string so a folder named
 * "Stack 01 (copy)" does NOT collide with the auto-name namespace.
 */
const STACK_AUTO_NAME_PATTERN = /^Stack (\d+)$/;

/**
 * Compute the next auto-generated Stack folder name.
 *
 * Scans the supplied list for any entry matching `^Stack (\d+)$` and returns
 * `"Stack ${max + 1}"` zero-padded to at least two digits. If no entries
 * match (or the list is empty), returns `"Stack 01"`.
 *
 * Gaps are intentionally skipped — given `["Stack 01", "Stack 03"]` the next
 * name is `"Stack 04"`, not `"Stack 02"`. This avoids re-using a name that a
 * user previously deleted on disk; their git history (and any external
 * references in another tool) keep pointing at "Stack 02" without surprise
 * collisions.
 *
 * Pure function. No I/O.
 *
 * @param existingNames - Folder names already present in the parent Collection.
 * @returns The next available `"Stack NN"` name.
 */
export function nextStackName(existingNames: readonly string[]): string {
  // Pull every numeric suffix from a matching name. Non-matching entries
  // (user-renamed Stacks, unrelated folders) are silently ignored.
  let max = 0;
  for (const name of existingNames) {
    const m = STACK_AUTO_NAME_PATTERN.exec(name);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  // Zero-pad to two digits for the common case (Stack 01..Stack 99); when
  // the count grows past 99, padStart keeps the natural width (Stack 100).
  return `${STACK_AUTO_NAME_PREFIX} ${String(next).padStart(2, "0")}`;
}

/**
 * Type-guard for `type: collection`. The argument is `unknown` because the
 * upstream YAML parser returns string-valued records — narrowing to the
 * literal type lets the renderer's switch statement be exhaustive.
 */
export function isCollectionType(type: unknown): type is "collection" {
  return typeof type === "string" && type === "collection";
}

/**
 * Type-guard for `type: stack`. Same rationale as `isCollectionType`.
 */
export function isStackType(type: unknown): type is "stack" {
  return typeof type === "string" && type === "stack";
}
