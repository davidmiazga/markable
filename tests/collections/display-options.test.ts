/**
 * tests/collections/display-options.test.ts — refactor step_R02
 *
 * Asserts that the Collections layout is fully wired into the two registration
 * surfaces that power the codeblock display picker:
 *
 *   1. `DISPLAY_REGISTRY` in `folder-view/display-options.ts` — the catalog
 *      the picker UI reads to build its pill row.
 *   2. `SELECT_WIDGET_RENDERERS` in `editor/select-widget.ts` — the dispatch
 *      map the codefence widget uses to render the chosen layout in place.
 *
 * The existing `LAYOUT_RENDERERS["collection-home"]` entry in
 * `folder-view/tab.ts` was registered by the MVP step_05 and is exercised by
 * `tests/collections/dispatch.test.ts` (step_R03).
 */

import { describe, it, expect } from "vitest";
import {
  DISPLAY_REGISTRY,
  getDisplaySpec,
  resolveDisplayAndOption,
} from "../../src/plugins/file-browser/folder-view/display-options";
import { SELECT_WIDGET_RENDERERS } from "../../src/editor/select-widget";
import { renderCollectionHome } from "../../src/plugins/file-browser/collections/renderer";

describe("display-options: DISPLAY_REGISTRY (refactor R02)", () => {
  it("FR-2 — DISPLAY_REGISTRY contains a `collection-home` entry", () => {
    const entry = DISPLAY_REGISTRY.find((e) => e.slug === "collection-home");
    expect(entry).toBeDefined();
  });

  it("FR-2 / Q-R2 — Collections entry has label 'Collection' and single default option", () => {
    const entry = DISPLAY_REGISTRY.find((e) => e.slug === "collection-home")!;
    expect(entry.label).toBe("Collection");
    expect(entry.defaultOption).toBe("default");
    expect(entry.options.length).toBe(1);
    expect(entry.options[0].slug).toBe("default");
  });

  it("UX ordering — Collections entry appears after Bookshelf in registry order", () => {
    const bookshelfIdx = DISPLAY_REGISTRY.findIndex((e) => e.slug === "bookshelf");
    const collectionIdx = DISPLAY_REGISTRY.findIndex((e) => e.slug === "collection-home");
    expect(bookshelfIdx).toBeGreaterThanOrEqual(0);
    expect(collectionIdx).toBeGreaterThan(bookshelfIdx);
  });

  it("FR-2 / Q-R2 — resolveDisplayAndOption('collection-home', null) returns default option", () => {
    expect(resolveDisplayAndOption("collection-home", null)).toEqual({
      display: "collection-home",
      option: "default",
    });
  });

  it("EC-1 — resolveDisplayAndOption('collection-home', 'nonsense') falls back to default option", () => {
    expect(resolveDisplayAndOption("collection-home", "nonsense")).toEqual({
      display: "collection-home",
      option: "default",
    });
  });

  it("FR-2 — getDisplaySpec('collection-home') returns the new spec", () => {
    const spec = getDisplaySpec("collection-home");
    expect(spec).not.toBeNull();
    expect(spec!.slug).toBe("collection-home");
  });
});

describe("display-options: select-widget RENDERERS (refactor R02)", () => {
  it("RQ-3 — SELECT_WIDGET_RENDERERS routes 'collection-home' to renderCollectionHome", () => {
    expect(SELECT_WIDGET_RENDERERS["collection-home"]).toBe(renderCollectionHome);
  });

  it("RQ-3 — every layout slug in DISPLAY_REGISTRY (except 'list' alias) has a matching RENDERERS entry", () => {
    for (const spec of DISPLAY_REGISTRY) {
      // The "list" alias is intentionally absent — resolveDisplayAndOption
      // rewrites it to (table, simple-list) before dispatch.
      expect(SELECT_WIDGET_RENDERERS[spec.slug]).toBeDefined();
    }
  });
});
