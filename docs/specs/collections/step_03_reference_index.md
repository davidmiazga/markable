---
title: "Step 03 — Reference Index"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 03 — Reference Reverse Index

## Goal

Provide an in-memory reverse index `canonicalRel → Set<stackFolderMdPath>` so a canonical rename/delete can rewrite affected `references:` arrays in O(1) lookup time. Rebuilt from a single vault-index scan. Hook points are wired in step 13.

## Files touched

- **New** `src/plugins/file-browser/collections/reference-index.ts`
- **New** `tests/collections/reference-index.test.ts`

## Function signatures to add

```typescript
import type { VaultIndex } from "../../../lib/vault-types";

export interface ReferenceIndexHandle {
  /**
   * Rebuild from the current vault index. Reads every `_folder.md`
   * whose parent appears in the folder-view set; parses references:
   * lazily via the store layer. Idempotent.
   */
  rebuild(vaultIndex: VaultIndex | null): Promise<void>;

  /**
   * O(1) lookup. Returns the list of stack `_folder.md` paths that
   * reference `canonicalRel`. Returns an empty array if none.
   */
  lookup(canonicalRel: string): readonly string[];

  /**
   * Called by the vault-manager rename hook (step 13). Rewrites every
   * affected references: array via `updateReferenceOnMove` (store.ts)
   * and updates the in-memory map atomically.
   */
  onCanonicalRenamed(oldVaultRel: string, newVaultRel: string): Promise<void>;

  /**
   * Called by the vault-manager delete hook (step 13). Removes the
   * entry from every affected references: array.
   */
  onCanonicalDeleted(vaultRel: string): Promise<void>;

  /** For tests: size of the map. */
  size(): number;
}

export function createReferenceIndex(): ReferenceIndexHandle;
```

A single module-level singleton is exposed alongside the factory for convenience:

```typescript
export const referenceIndex: ReferenceIndexHandle = createReferenceIndex();
```

## Failing tests to write FIRST

`tests/collections/reference-index.test.ts` — mock the store layer's `readStack` to return canned references.

| Test name | Covers | Asserts |
|---|---|---|
| `rebuild populates lookups for every references: entry` | FR-21 | `lookup("Projects/Stack 02/X.md")` returns the owning Stack path |
| `rebuild handles vaults with zero Stacks` | edge | size === 0 |
| `rebuild skips entries whose target file does not exist in vault index` | EC-16 setup | broken pointers still indexed (the render layer renders broken-link boxes; index keeps them so removeReference can find them) |
| `lookup returns empty array for unknown canonical path` | edge | `[]` not `undefined` |
| `onCanonicalRenamed updates every affected references: array` | FR-25 | mocked `updateReferenceOnMove` called once per owning Stack |
| `onCanonicalRenamed updates the in-memory map in lockstep` | FR-25 | post-call `lookup(old) === []` and `lookup(new) === [...stacks]` |
| `onCanonicalDeleted removes the entry from every owning Stack` | FR-26 | mocked `removeReference` called once per owning Stack |
| `onCanonicalDeleted clears the map entry for that path` | FR-26 | post-call `lookup(deleted) === []` |
| `rebuild is idempotent — second call with same index yields identical map` | EC-7 robustness | deep-equal before/after |
| `concurrent rebuild calls do not double-index` | EC-10 robustness | size invariant after Promise.all of two rebuilds |

## Implementation outline

1. **State**: `private map: Map<string, Set<string>>` plus a `rebuildLock: Promise<void> | null` to guard concurrent rebuild calls.
2. **`rebuild(vaultIndex)`**:
   - If `rebuildLock`, await it and return (de-dup).
   - Build a new `Map`. Iterate `vaultIndex.entries`; collect every `_folder` whose path ends with `_folder.md`. For each, call `readStack(parent)` (or `readCollection` for the root, which has no references but we skip).
   - For each `references:` entry, `map.get(entryRel) ?? new Set()`, add the owning `_folder.md` path, put back.
   - Atomic swap `this.map = newMap`.
3. **`lookup(canonicalRel)`**: `Array.from(this.map.get(canonicalRel) ?? new Set())`.
4. **`onCanonicalRenamed(old, new)`**:
   - `const stacks = this.lookup(old);`
   - For each stack `_folder.md` path, derive the parent Stack folder, call `store.updateReferenceOnMove(stackPath, old, new)`.
   - In the map: `this.map.set(new, this.map.get(old) ?? new Set()); this.map.delete(old);`
5. **`onCanonicalDeleted(rel)`**:
   - `const stacks = this.lookup(rel);`
   - For each, `store.removeReference(stackPath, rel)`.
   - `this.map.delete(rel);`

Use `vaultIndex.entries` only — does NOT read note bodies, only `_folder.md` (NFR-1).

## Refactor opportunities

If step 13 finds that the vault-manager already exposes a "before-rename" callback that fires for non-canonical-vault paths too, gate the index handler with a `looksLikeNotePath(rel)` predicate. Defer until step 13.

## Definition of Done

```bash
npm run test:run -- tests/collections/reference-index.test.ts
```
Expected: 10 tests pass. Plugin rebuild required.
