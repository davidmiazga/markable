/**
 * tests/editor/select-widget-parse.test.ts
 *
 * Tests the `parseSelectBody()` and `parseSelectBodyForBuilder()` paths from
 * src/editor/select-widget.ts — specifically the option-system threading and
 * the `display: list` backwards-compat alias.
 */

import { describe, it, expect } from "vitest";
import {
  parseSelectBody,
  parseSelectBodyForBuilder,
} from "../../src/editor/select-widget";

describe("parseSelectBody — option system", () => {
  it("`display: list` (legacy) is aliased to view-table + simple-list", () => {
    const out = parseSelectBody("path: ./notes\ndisplay: list\n");
    expect(out.display).toBe("table");
    expect(out.config.layout).toBe("view-table");
    expect(out.config.displayOption).toBe("simple-list");
  });

  it("`display: table` with no option yields the default option", () => {
    const out = parseSelectBody("display: table\n");
    expect(out.config.layout).toBe("view-table");
    expect(out.config.displayOption).toBe("table-grid");
  });

  it("`display: table` + `option: simple-list` round-trips", () => {
    const out = parseSelectBody("display: table\noption: simple-list\n");
    expect(out.config.layout).toBe("view-table");
    expect(out.config.displayOption).toBe("simple-list");
  });

  it("invalid option falls back to the display's default", () => {
    const out = parseSelectBody("display: table\noption: bogus\n");
    expect(out.config.displayOption).toBe("table-grid");
  });

  it("unknown display falls back to cards/grid", () => {
    const out = parseSelectBody("display: nonsense\n");
    expect(out.display).toBe("cards");
    expect(out.config.layout).toBe("view-cards");
    expect(out.config.displayOption).toBe("grid");
  });

  it("`group-by:` is parsed onto config.groupBy", () => {
    const out = parseSelectBody("display: cards\ngroup-by: section\n");
    expect(out.config.groupBy).toBe("section");
  });

  it("absent `group-by:` leaves config.groupBy undefined", () => {
    const out = parseSelectBody("display: cards\n");
    expect(out.config.groupBy).toBeUndefined();
  });

  it("`display: bookshelf` (no option) yields the covers default", () => {
    const out = parseSelectBody("display: bookshelf\n");
    expect(out.display).toBe("bookshelf");
    expect(out.config.layout).toBe("view-bookshelf");
    expect(out.config.displayOption).toBe("covers");
  });

  it("`display: bookshelf` + `option: library` is preserved", () => {
    const out = parseSelectBody("display: bookshelf\noption: library\n");
    expect(out.config.displayOption).toBe("library");
  });

  it("`display: bookshelf` + bogus option falls back to covers", () => {
    const out = parseSelectBody("display: bookshelf\noption: nonsense\n");
    expect(out.config.displayOption).toBe("covers");
  });

  it("`display: bookshelf` + `group-by: status` writes config.groupBy", () => {
    const out = parseSelectBody("display: bookshelf\ngroup-by: status\n");
    expect(out.config.layout).toBe("view-bookshelf");
    expect(out.config.groupBy).toBe("status");
  });
});

describe("parseSelectBodyForBuilder — option system", () => {
  it("aliases `display: list` so the modal opens on Table + simple-list", () => {
    const initial = parseSelectBodyForBuilder("display: list\n");
    expect(initial.display).toBe("table");
    expect(initial.displayOption).toBe("simple-list");
  });

  it("seeds displayOption only when it differs from the default", () => {
    // Default option → don't leak it into the form (so it round-trips byte-stably).
    const initial = parseSelectBodyForBuilder("display: table\noption: table-grid\n");
    expect(initial.display).toBe("table");
    expect(initial.displayOption).toBeUndefined();
  });

  it("seeds groupBy when present", () => {
    const initial = parseSelectBodyForBuilder("display: cards\ngroup-by: section\n");
    expect(initial.groupBy).toBe("section");
  });

  it("leaves initial.display undefined when no display: key is set", () => {
    const initial = parseSelectBodyForBuilder("path: ./notes\n");
    expect(initial.display).toBeUndefined();
  });
});
