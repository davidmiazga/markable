/**
 * tests/collections/preview-cache.test.ts — step_08
 *
 * Asserts the per-tab LRU preview cache:
 *   - get returns null on miss, on mtime mismatch (FR-28).
 *   - setHeight persists across get cycles (FR-29).
 *   - LRU eviction at capacity; touched entries survive (perf).
 *   - invalidate / clear (FR-25/26 + tab-close).
 */

import { describe, it, expect } from "vitest";
import { createPreviewCache } from "../../src/plugins/file-browser/collections/preview-cache";

describe("preview-cache (step_08)", () => {
  it("get returns null on miss", () => {
    const cache = createPreviewCache();
    expect(cache.get("/x.md", 0)).toBeNull();
  });

  it("set then get returns the entry", () => {
    const cache = createPreviewCache();
    cache.set("/x.md", { html: "<p>x</p>", mtimeMs: 100 });
    const entry = cache.get("/x.md", 100);
    expect(entry).not.toBeNull();
    expect(entry?.html).toBe("<p>x</p>");
    expect(entry?.mtimeMs).toBe(100);
    expect(entry?.height).toBeNull();
  });

  it("FR-28 — get returns null when mtime mismatches (stale); subsequent get with stale mtime also null", () => {
    const cache = createPreviewCache();
    cache.set("/x.md", { html: "<p>x</p>", mtimeMs: 100 });
    expect(cache.get("/x.md", 200)).toBeNull();
    // The stale entry was invalidated; even a fresh stale read is null.
    expect(cache.get("/x.md", 200)).toBeNull();
  });

  it("FR-29 — setHeight persists across get cycles", () => {
    const cache = createPreviewCache();
    cache.set("/x.md", { html: "<p>x</p>", mtimeMs: 100 });
    cache.setHeight("/x.md", 240);
    expect(cache.get("/x.md", 100)?.height).toBe(240);
    expect(cache.get("/x.md", 100)?.height).toBe(240);
  });

  it("edge — setHeight before any set is a no-op (no entry created)", () => {
    const cache = createPreviewCache();
    cache.setHeight("/x.md", 100);
    expect(cache.size()).toBe(0);
    expect(cache.get("/x.md", 0)).toBeNull();
  });

  it("FR-25/26 — invalidate removes the entry; size === 0 afterward", () => {
    const cache = createPreviewCache();
    cache.set("/x.md", { html: "x", mtimeMs: 1 });
    cache.invalidate("/x.md");
    expect(cache.size()).toBe(0);
    expect(cache.get("/x.md", 1)).toBeNull();
  });

  it("tab close — clear drops all entries", () => {
    const cache = createPreviewCache();
    cache.set("/x.md", { html: "x", mtimeMs: 1 });
    cache.set("/y.md", { html: "y", mtimeMs: 2 });
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("LRU evicts oldest when over maxEntries (capacity=3)", () => {
    const cache = createPreviewCache({ maxEntries: 3 });
    cache.set("/a.md", { html: "a", mtimeMs: 1 });
    cache.set("/b.md", { html: "b", mtimeMs: 1 });
    cache.set("/c.md", { html: "c", mtimeMs: 1 });
    cache.set("/d.md", { html: "d", mtimeMs: 1 });
    // /a was the oldest — should be evicted.
    expect(cache.get("/a.md", 1)).toBeNull();
    expect(cache.get("/b.md", 1)).not.toBeNull();
    expect(cache.size()).toBe(3);
  });

  it("LRU — touched (via get) entry survives a subsequent eviction wave", () => {
    const cache = createPreviewCache({ maxEntries: 3 });
    cache.set("/a.md", { html: "a", mtimeMs: 1 });
    cache.set("/b.md", { html: "b", mtimeMs: 1 });
    cache.set("/c.md", { html: "c", mtimeMs: 1 });
    // Touch /a so it becomes the most-recently-used.
    cache.get("/a.md", 1);
    cache.set("/d.md", { html: "d", mtimeMs: 1 });
    // /b is now the oldest, not /a.
    expect(cache.get("/a.md", 1)).not.toBeNull();
    expect(cache.get("/b.md", 1)).toBeNull();
  });

  it("invariant — setHeight does NOT touch LRU order", () => {
    const cache = createPreviewCache({ maxEntries: 3 });
    cache.set("/a.md", { html: "a", mtimeMs: 1 });
    cache.set("/b.md", { html: "b", mtimeMs: 1 });
    cache.set("/c.md", { html: "c", mtimeMs: 1 });
    // Setting height on /a should NOT promote it to MRU.
    cache.setHeight("/a.md", 100);
    cache.set("/d.md", { html: "d", mtimeMs: 1 });
    // /a was the oldest and remains evicted.
    expect(cache.get("/a.md", 1)).toBeNull();
  });
});
