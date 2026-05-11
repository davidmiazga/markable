---
title: "Step 01 — Type Definitions"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 01 — Type Definitions

## Goal

Add all new TypeScript types required by the feature. This step has no runtime
behaviour — it only changes structural contracts. All subsequent steps depend on
the types defined here.

No tests are written in this step. The type changes are validated by the
TypeScript compiler when step_02 tests are compiled.

---

## File to change

`src/plugins/file-browser/folder-view/types.ts`

---

## Exact changes

### 1. Replace `FolderSortOrder` with `BuiltinSortOrder` + widened `FolderSortOrder`

**Remove** the existing line:

```typescript
export type FolderSortOrder = "name-asc" | "name-desc" | "modified-asc" | "modified-desc";
```

**Replace with**:

```typescript
/** The four built-in sort orders for the card grid and table. */
export type BuiltinSortOrder =
  | "name-asc"
  | "name-desc"
  | "modified-asc"
  | "modified-desc";

/**
 * Sort order for a Folder View section.
 *
 * Includes the four built-in orders plus any arbitrary string, which is
 * interpreted as an extra-field key for the folder-table layout (FR-08).
 */
export type FolderSortOrder = BuiltinSortOrder | string;
```

### 2. Add `ExtraField` interface — insert after `FolderLayoutMode`

After the line `export type FolderLayoutMode = "grid" | "flex";`, add:

```typescript
/**
 * One declared extra YAML frontmatter column for the folder-table layout.
 *
 * Produced by parseFolderMd() from the extra-fields sequence in _folder.md.
 * Consumed by table-renderer.ts to add sortable columns.
 */
export interface ExtraField {
  /** The YAML frontmatter key to read from child files. */
  key: string;
  /** Column header label shown in the table. */
  label: string;
}
```

### 3. Add `"extra-fields"?: unknown` to `FolderMdFrontMatter`

Inside `FolderMdFrontMatter`, after the `"content-area-override"` field, add:

```typescript
  /**
   * Raw YAML value for the extra-fields sequence (string[] or object[]).
   * Extracted before normalizeFm() and processed into ExtraField[] by parseFolderMd().
   */
  "extra-fields"?: unknown;
```

### 4. Add `extraFields: ExtraField[]` to `FolderViewConfig`

Inside `FolderViewConfig`, after the `contentAreaOverride` field, add:

```typescript
  /**
   * Declared extra frontmatter columns for the folder-table layout.
   * Default: []. Present for all layouts; ignored outside folder-table.
   */
  extraFields: ExtraField[];
```

### 5. Add `meta?: Record<string, string>` to `FolderCard`

Inside `FolderCard`, after the `childCount` field, add:

```typescript
  /**
   * Frontmatter values keyed by ExtraField.key.
   * Set by the enrichment phase in renderFolderViewTabAsync().
   * Present only for .md file cards after enrichment, and for all cards
   * when extraFields is non-empty (non-.md and directory cards get {}).
   * Absent when extraFields is empty (no enrichment phase runs).
   */
  meta?: Record<string, string>;
```

---

## TypeScript implications

### `FolderSortOrder = BuiltinSortOrder | string`

TypeScript collapses `BuiltinSortOrder | string` to `string` for assignability
purposes, but autocompletion tools still surface the literal members. The key
behavioral implication is that `VALID_SORTS.has(sortRaw)` in `parser.ts` now
produces a `BuiltinSortOrder` (via cast) for known values, while unknown values
pass through as plain `string`. Both satisfy `FolderSortOrder`.

All existing consumers of `FolderViewConfig.sort` (renderer.ts, table-renderer.ts)
accept `FolderSortOrder`. The `sortCards()` call in `table-renderer.ts` will now
receive a type-narrowed value — step_05 adds a guard so `sortCards` is only called
when `sortCol` matches a builtin.

### `table-renderer.ts` import update

`table-renderer.ts` currently imports `FolderSortOrder` from `./types`. After this
step, it will also need `ExtraField` — that import is added in step_05.

---

## Definition of done

- `src/plugins/file-browser/folder-view/types.ts` compiles without errors.
- `npm run test:run -- tests/folder-view/parser.test.ts` still passes (existing
  tests are not broken by the type addition since `parseFolderMd` has not yet
  been updated to populate `extraFields`).

Note: the TypeScript compiler will emit an error on the existing `parseFolderMd`
return statement in `parser.ts` because `extraFields` is now a required field on
`FolderViewConfig` but is absent from the return object. This error is expected and
is resolved in step_02.
