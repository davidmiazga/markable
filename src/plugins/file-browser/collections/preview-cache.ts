/**
 * preview-cache.ts — Per-tab LRU cache for framed-box preview HTML + height.
 *
 * The Stack panel (step 10) consults this cache before issuing a preview-HTML
 * render. On a cache hit (matching `mtimeMs`) the cached HTML is injected
 * directly into the box body. On a miss or mtime mismatch the cached entry
 * is invalidated and the caller renders fresh.
 *
 * Heights are tracked separately from HTML (FR-29): even after the box is
 * recycled to a placeholder, the cached height keeps the scroll bar from
 * jumping when the box later re-enters the viewport.
 *
 * LRU is implemented on top of JS `Map`, which preserves insertion order —
 * `delete + set` moves an entry to the most-recently-used end of the iteration.
 *
 * @module collections/preview-cache
 */

import type { PreviewCacheEntry } from "./types";

/** Public surface of one cache instance. */
export interface PreviewCacheHandle {
  get(notePath: string, currentMtimeMs: number): PreviewCacheEntry | null;
  set(notePath: string, entry: { html: string; mtimeMs: number }): void;
  setHeight(notePath: string, heightPx: number): void;
  /**
   * Read the last measured height for a notePath regardless of mtime.
   *
   * Distinct from `get()` because the recycle path (note-box.ts) needs the
   * cached layout height even after the content has been invalidated — the
   * scrollbar height is a UX property, not a content correctness property.
   * Returns null when there's no entry at all.
   */
  peekHeight(notePath: string): number | null;
  invalidate(notePath: string): void;
  clear(): void;
  size(): number;
}

/**
 * Factory. The default capacity (500) comfortably covers FR-27's 200-note
 * scroll target with overscan and leaves headroom for cross-Stack
 * navigation in the same tab.
 */
export function createPreviewCache(opts?: { maxEntries?: number }): PreviewCacheHandle {
  const maxEntries = opts?.maxEntries ?? 500;
  // JS Map preserves insertion order, which we leverage for LRU semantics:
  // delete+set moves an entry to the most-recent end of iteration; the
  // first key returned by `.keys()` is the least-recently-used.
  const map = new Map<string, PreviewCacheEntry>();

  function get(notePath: string, currentMtimeMs: number): PreviewCacheEntry | null {
    const entry = map.get(notePath);
    if (!entry) return null;
    if (entry.mtimeMs !== currentMtimeMs) {
      // Stale entry — drop it so a subsequent read with the same stale mtime
      // continues to return null. Caller is expected to re-render.
      map.delete(notePath);
      return null;
    }
    // LRU touch: delete + re-set moves the entry to MRU.
    map.delete(notePath);
    map.set(notePath, entry);
    return entry;
  }

  function set(notePath: string, entryInit: { html: string; mtimeMs: number }): void {
    // Overwriting an existing entry replaces both html + mtime and resets the
    // measured height to null. The setHeight follow-up call after layout
    // settles writes the new value.
    const newEntry: PreviewCacheEntry = {
      html: entryInit.html,
      mtimeMs: entryInit.mtimeMs,
      height: null,
    };
    map.delete(notePath);
    map.set(notePath, newEntry);
    // Evict from the LRU end until under capacity. Using Map's insertion
    // order: `.keys().next().value` is the LRU entry.
    while (map.size > maxEntries) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }

  function setHeight(notePath: string, heightPx: number): void {
    const entry = map.get(notePath);
    if (!entry) return;
    // Mutate height in place — do NOT promote LRU position. Height updates
    // happen during layout (which fires for every visible box on every
    // scroll) and a promote-on-setHeight policy would defeat eviction.
    entry.height = heightPx;
  }

  function peekHeight(notePath: string): number | null {
    const entry = map.get(notePath);
    if (!entry) return null;
    return entry.height;
  }

  function invalidate(notePath: string): void {
    map.delete(notePath);
  }

  function clear(): void {
    map.clear();
  }

  function size(): number {
    return map.size;
  }

  return { get, set, setHeight, peekHeight, invalidate, clear, size };
}
