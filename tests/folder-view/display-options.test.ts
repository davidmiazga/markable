/**
 * tests/folder-view/display-options.test.ts
 *
 * Tests for the DISPLAY_REGISTRY and `resolveDisplayAndOption()` resolver
 * that backs the Select-codefence display picker.
 */

import { describe, it, expect } from "vitest";
import {
  DISPLAY_REGISTRY,
  getDisplaySpec,
  resolveDisplayAndOption,
} from "../../src/plugins/file-browser/folder-view/display-options";

describe("DISPLAY_REGISTRY", () => {
  it("contains the expected displays in picker order", () => {
    const slugs = DISPLAY_REGISTRY.map((d) => d.slug);
    // `collection-home` was appended in refactor step_R02 (2026-06-06) — see
    // tests/collections/display-options.test.ts for the Collections-specific
    // assertions; the order requirement is "after Bookshelf".
    expect(slugs).toEqual([
      "cards",
      "table",
      "timeline",
      "kanban",
      "bookshelf",
      "collection-home",
    ]);
  });

  it("Bookshelf declares covers, library, compact, and book-stack options (compact default)", () => {
    const bs = getDisplaySpec("bookshelf")!;
    expect(bs.defaultOption).toBe("compact");
    expect(bs.options.map((o) => o.slug)).toEqual(["covers", "library", "compact", "book-stack"]);
  });

  it("does not contain a top-level 'list' display (List is a Table option)", () => {
    expect(DISPLAY_REGISTRY.find((d) => d.slug === "list")).toBeUndefined();
  });

  it("Table declares table-grid (default) and simple-list options", () => {
    const table = getDisplaySpec("table")!;
    expect(table.defaultOption).toBe("table-grid");
    const slugs = table.options.map((o) => o.slug);
    expect(slugs).toEqual(["table-grid", "simple-list"]);
  });

  it("Cards/Timeline/Kanban each declare exactly one option", () => {
    for (const slug of ["cards", "timeline", "kanban"]) {
      const spec = getDisplaySpec(slug)!;
      expect(spec.options.length).toBe(1);
      expect(spec.options[0].slug).toBe(spec.defaultOption);
    }
  });
});

describe("getDisplaySpec", () => {
  it("returns null for unknown slugs", () => {
    expect(getDisplaySpec("nonsense")).toBeNull();
    expect(getDisplaySpec("")).toBeNull();
  });

  it("returns the spec for known slugs", () => {
    expect(getDisplaySpec("cards")?.label).toBe("Cards");
    expect(getDisplaySpec("table")?.label).toBe("Table");
  });
});

describe("resolveDisplayAndOption", () => {
  it("aliases `display: list` to table + simple-list (backwards compat)", () => {
    expect(resolveDisplayAndOption("list", null)).toEqual({
      display: "table",
      option: "simple-list",
    });
  });

  it("aliases `display: list` even when an option is also passed", () => {
    // The alias is total — any option passed alongside `list` is discarded.
    expect(resolveDisplayAndOption("list", "table-grid")).toEqual({
      display: "table",
      option: "simple-list",
    });
  });

  it("falls back to cards/grid for unknown displays", () => {
    expect(resolveDisplayAndOption("nonsense", null)).toEqual({
      display: "cards",
      option: "grid",
    });
    expect(resolveDisplayAndOption("", "anything")).toEqual({
      display: "cards",
      option: "grid",
    });
  });

  it("falls back to the display's defaultOption when option is missing", () => {
    expect(resolveDisplayAndOption("table", null)).toEqual({
      display: "table",
      option: "table-grid",
    });
    expect(resolveDisplayAndOption("cards", null)).toEqual({
      display: "cards",
      option: "grid",
    });
  });

  it("falls back to the defaultOption when option is invalid for that display", () => {
    expect(resolveDisplayAndOption("table", "bogus")).toEqual({
      display: "table",
      option: "table-grid",
    });
    // Even an option valid for a different display gets rejected.
    expect(resolveDisplayAndOption("cards", "simple-list")).toEqual({
      display: "cards",
      option: "grid",
    });
  });

  it("passes valid display+option pairs through unchanged", () => {
    expect(resolveDisplayAndOption("table", "simple-list")).toEqual({
      display: "table",
      option: "simple-list",
    });
    expect(resolveDisplayAndOption("table", "table-grid")).toEqual({
      display: "table",
      option: "table-grid",
    });
  });

  it("never throws on garbage inputs", () => {
    expect(() => resolveDisplayAndOption("", null)).not.toThrow();
    expect(() => resolveDisplayAndOption("\n\t  ", "\n\t")).not.toThrow();
  });
});
