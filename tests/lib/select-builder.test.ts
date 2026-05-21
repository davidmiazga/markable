/**
 * tests/lib/select-builder.test.ts
 *
 * Tests for buildSelectFenceFromState — specifically that:
 *   - `option:` is emitted only when non-default (byte-stable round-trip).
 *   - `group-by:` is emitted when present.
 *   - The fence parses back to the same state via parseSelectBodyForBuilder.
 */

import { describe, it, expect } from "vitest";
import { buildSelectFenceFromState } from "../../src/lib/select-builder";
import { parseSelectBodyForBuilder } from "../../src/editor/select-widget";
import type { DisplayKind } from "../../src/lib/select-builder";

function baseState(overrides: Partial<Parameters<typeof buildSelectFenceFromState>[0]> = {}) {
  return {
    rules: [],
    path: "./notes",
    display: "cards" as DisplayKind,
    displayOption: "grid",
    groupBy: "",
    sort: "name-asc",
    showModified: true,
    showExtensions: true,
    previewPane: false,
    kanbanField: "",
    contentWidth: "normal" as const,
    ...overrides,
  };
}

describe("buildSelectFenceFromState — option emission", () => {
  it("omits `option:` for the default option (byte-stable)", () => {
    const fence = buildSelectFenceFromState(baseState({ display: "cards", displayOption: "grid" }));
    expect(fence).not.toContain("option:");
  });

  it("emits `option: simple-list` when Table picks the non-default option", () => {
    const fence = buildSelectFenceFromState(
      baseState({ display: "table", displayOption: "simple-list" }),
    );
    expect(fence).toContain("display: table");
    expect(fence).toContain("option: simple-list");
  });

  it("omits `option: table-grid` (the Table default)", () => {
    const fence = buildSelectFenceFromState(
      baseState({ display: "table", displayOption: "table-grid" }),
    );
    expect(fence).not.toContain("option:");
  });

  it("emits `group-by:` when non-empty", () => {
    const fence = buildSelectFenceFromState(baseState({ groupBy: "section" }));
    expect(fence).toContain("group-by: section");
  });

  it("trims whitespace-only groupBy as empty", () => {
    const fence = buildSelectFenceFromState(baseState({ groupBy: "   " }));
    expect(fence).not.toContain("group-by:");
  });

  it("emits `show-extensions: false` when Table+simple-list disables it (cards-like guard)", () => {
    const fence = buildSelectFenceFromState(
      baseState({ display: "table", displayOption: "simple-list", showExtensions: false }),
    );
    expect(fence).toContain("show-extensions: false");
  });

  it("does NOT emit `show-extensions: false` for plain Table grid (extensions option doesn't apply)", () => {
    const fence = buildSelectFenceFromState(
      baseState({ display: "table", displayOption: "table-grid", showExtensions: false }),
    );
    expect(fence).not.toContain("show-extensions:");
  });
});

describe("buildSelectFenceFromState — round-trip", () => {
  it("Table + simple-list round-trips to itself", () => {
    const state = baseState({ display: "table", displayOption: "simple-list" });
    const fence = buildSelectFenceFromState(state);
    // Strip the ```select / ``` markers before re-parsing
    const body = fence.split("\n").slice(1, -1).join("\n");
    const parsed = parseSelectBodyForBuilder(body);
    expect(parsed.display).toBe("table");
    expect(parsed.displayOption).toBe("simple-list");
  });

  it("Cards (default option) round-trips with no `option:` line", () => {
    const state = baseState({ display: "cards", displayOption: "grid" });
    const fence = buildSelectFenceFromState(state);
    const body = fence.split("\n").slice(1, -1).join("\n");
    const parsed = parseSelectBodyForBuilder(body);
    expect(parsed.display).toBe("cards");
    expect(parsed.displayOption).toBeUndefined();
  });

  it("groupBy survives the round-trip", () => {
    const state = baseState({ display: "cards", groupBy: "status" });
    const fence = buildSelectFenceFromState(state);
    const body = fence.split("\n").slice(1, -1).join("\n");
    const parsed = parseSelectBodyForBuilder(body);
    expect(parsed.groupBy).toBe("status");
  });
});
