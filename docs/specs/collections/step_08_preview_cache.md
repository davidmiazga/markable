---
title: "Step 08 — Preview Cache"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 08 — Per-Tab LRU Preview + Height Cache

## Goal

Provide a cache that maps `notePath` → `{ html, mtimeMs, height }`. Used by stack-panel (step 10) to avoid re-rendering preview HTML on every scroll-in event and to keep scroll position stable when boxes get recycled (FR-28, FR-29).

## Files touched

- **New** `src/plugins/file-browser/collections/preview-cache.ts`
- **New** `tests/collections/preview-cache.test.ts`

## Function signatures to add

```typescript
import type { PreviewCacheEntry } from "./types";

export interface PreviewCacheHandle {
  /**
   * Read an entry. Returns null on miss, on mtime mismatch, or if
   * the entry was evicted by the LRU.
   *
   * On mtime mismatch the stale entry is invalidated and null is
   * returned — caller must re-render.
   */
  get(notePath: string, currentMtimeMs: number): PreviewCacheEntry | null;

  /**
   * Insert or overwrite an entry. Initialises height to null
   * (caller measures and updates via `setHeight`).
   */
  set(notePath: string, entry: { html: string; mtimeMs: number }): void;

  /**
   * Record the measured height of a rendered box. Idempotent.
   * Persists across out-of-viewport recycling (FR-29).
   */
  setHeight(notePath: string, heightPx: number): void;

  /**
   * Drop a single entry (called on note rename / delete).
   */
  invalidate(notePath: string): void;

  /**
   * Drop everything (called on Stack navigation away or tab close).
   */
  clear(): void;

  /** Current entry count. For tests. */
  size(): number;
}

export function createPreviewCache(opts?: { maxEntries?: number }): PreviewCacheHandle;
```

Default `maxEntries: 500`. LRU eviction on `set` when full.

## Failing tests to write FIRST

`tests/collections/preview-cache.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `get returns null on miss` | basic | null |
| `set then get returns the entry` | basic | round-trip |
| `get returns null when mtime mismatches (stale)` | FR-28 | also: subsequent get with same stale mtime still null (entry invalidated) |
| `setHeight persists across get cycles` | FR-29 | get returns entry with height set |
| `setHeight before any set is a no-op` | edge | no entry created |
| `invalidate removes the entry; get returns null afterward` | FR-25/26 | post-call size === 0 |
| `clear drops all entries` | tab close | size === 0 |
| `LRU evicts oldest when over maxEntries (capacity=3)` | perf | inserting 4 entries → oldest absent |
| `accessing an entry promotes it (LRU touch on get)` | perf | the touched entry survives a subsequent eviction wave |
| `setHeight does not affect LRU order` | invariant | only get and set touch LRU order |

## Implementation outline

1. Internal storage: `Map<string, PreviewCacheEntry>`. JS `Map` preserves insertion order, so for LRU we delete-and-reinsert on touch.
2. `get(notePath, currentMtimeMs)`:
   - `const entry = this.map.get(notePath);`
   - `if (!entry) return null;`
   - `if (entry.mtimeMs !== currentMtimeMs) { this.map.delete(notePath); return null; }`
   - **LRU touch**: `this.map.delete(notePath); this.map.set(notePath, entry);`
   - Return `entry`.
3. `set(notePath, { html, mtimeMs })`:
   - Build `entry: PreviewCacheEntry = { html, mtimeMs, height: null }` (note: `height` is `let` semantically — TS interface marks it mutable).
   - `this.map.delete(notePath); this.map.set(notePath, entry);`
   - If `this.map.size > maxEntries`, delete the oldest (`this.map.keys().next().value`) until under cap.
4. `setHeight(notePath, heightPx)`:
   - `const entry = this.map.get(notePath); if (!entry) return; entry.height = heightPx;` (no LRU touch).
5. `invalidate(notePath)`: `this.map.delete(notePath);`
6. `clear()`: `this.map.clear();`

## Refactor opportunities

If step 10 needs to cache the rendered HTMLElement (not just the HTML string) for faster re-mount, add a second optional field. Defer until profiling shows it's needed.

## Definition of Done

```bash
npm run test:run -- tests/collections/preview-cache.test.ts
```
Expected: 10 tests pass. No plugin rebuild needed yet (pure module, not yet imported).
