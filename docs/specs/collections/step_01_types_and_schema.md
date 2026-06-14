---
title: "Step 01 — Types and Schema"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 01 — Types and Schema Constants

## Goal

Define every type used across Collections in one place, plus the schema-version constants and YAML key names — so every subsequent step imports from a stable surface.

## Files touched

- **New** `src/plugins/file-browser/collections/types.ts`
- **New** `src/plugins/file-browser/collections/schema.ts`
- **New** `tests/collections/types.test.ts`

## Function signatures to add

```typescript
// types.ts

export interface CollectionMeta {
  readonly schemaVersion: number;
  readonly type: "collection";
  readonly displayName: string;
  readonly stackOrder: readonly string[];
  readonly icon?: string;
}

export interface StackMeta {
  readonly schemaVersion: number;
  readonly type: "stack";
  readonly displayName: string;
  readonly icon: string;
  readonly order: readonly string[];
  readonly references: readonly string[];
}

export type NoteBoxKind =
  | { kind: "canonical"; stackPath: string; noteFilename: string }
  | { kind: "reference"; ownerStackPath: string; canonicalRel: string }
  | { kind: "broken";    ownerStackPath: string; canonicalRel: string };

export type CollectionView =
  | { view: "home" }
  | { view: "stack"; stackPath: string };

export interface BreadcrumbSegment {
  readonly label: string;
  readonly onClick: (() => void) | null;
}

export interface PreviewCacheEntry {
  readonly html: string;
  readonly mtimeMs: number;
  height: number | null;  // mutable: filled on first measurement
}

// schema.ts

export const COLLECTIONS_SCHEMA_VERSION = 1;

export const COLLECTION_YAML_KEYS = {
  schemaVersion: "schemaVersion",
  type:          "type",
  displayName:   "displayName",
  stackOrder:    "stackOrder",
  order:         "order",
  references:    "references",
  icon:          "icon",
} as const;

export const STACK_DEFAULT_ICON = "notebook";

export const STACK_AUTO_NAME_PREFIX = "Stack";

export function nextStackName(existingNames: readonly string[]): string;

export function isCollectionType(type: unknown): type is "collection";
export function isStackType(type: unknown): type is "stack";
```

## Failing tests to write FIRST

`tests/collections/types.test.ts`:

- `nextStackName: returns "Stack 01" when list is empty`
- `nextStackName: returns "Stack 02" when ["Stack 01"]`
- `nextStackName: skips gaps and returns next-after-max ("Stack 03" for ["Stack 01", "Stack 02"])`
- `nextStackName: ignores non-matching names ("Stack 01" for ["MyFolder", "Notes"])`
- `nextStackName: handles three-digit indices ("Stack 100" for full 1..99 list)`
- `isCollectionType: discriminates "collection" from "stack" and arbitrary strings/non-strings`
- `isStackType: discriminates "stack" from other values`
- `COLLECTIONS_SCHEMA_VERSION: equals 1`
- `STACK_DEFAULT_ICON: equals "notebook" (catalog id)`
- `COLLECTION_YAML_KEYS: object freeze sanity (Object.isFrozen via `as const`)`

## Implementation outline

`nextStackName`:
1. Regex match `^Stack (\d+)$` against each entry; collect parsed integers.
2. If none, return `"Stack 01"`.
3. Otherwise return `\`Stack ${String(max + 1).padStart(2, "0")}\``.

`isCollectionType` / `isStackType`: trivial guards (`typeof x === "string" && x === "collection"` etc.).

No DOM, no I/O. Pure module.

## Refactor opportunities

After step 18 lands, audit `STACK_AUTO_NAME_PREFIX` for re-use in DW-1 (rename-multiple). Leave the constant exported.

## Definition of Done

```bash
npm run test:run -- tests/collections/types.test.ts
```
Expected: 10 tests pass. Full suite still green (`npm run test:run`).

No source under `src/plugins/**` other than the two new files is touched → no plugin rebuild needed yet.
