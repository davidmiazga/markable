/**
 * tests/plugins/yaml-pane/chip-warning.test.ts
 *
 * Unit tests for getVocabularyForField() and buildChipElement() warning logic
 * from the YAML pane plugin.
 *
 * getVocabularyForField reads window.__MARKABLE_META__ synchronously. Each
 * test sets up the mock global in beforeEach and cleans up in afterEach.
 *
 * buildChipElement creates a DOM <span> element — tests use happy-dom which
 * is configured globally in vitest.config.ts.
 *
 * Coverage targets: FR-9, FR-10, FR-11, EC-1, EC-8, EC-9, EC-12.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getVocabularyForField,
  buildChipElement,
} from "../../../src/plugins/yaml-pane/yaml-pane.plugin";

// ---------------------------------------------------------------------------
// Shared mock meta fixtures
// ---------------------------------------------------------------------------

/** Full meta: tags defined, plus an "author" field with a vocabulary. */
const FULL_META = {
  tags: ["alpha", "beta"],
  fields: { author: ["Dave", "Alice"] },
  vaultId: "v1",
};

/** Empty meta: no tags, no fields — used to verify FR-11 suppression. */
const EMPTY_META = { tags: [], fields: {}, vaultId: null };

beforeEach(() => {
  (window as any).__MARKABLE_META__ = FULL_META;
});

afterEach(() => {
  delete (window as any).__MARKABLE_META__;
});

// ---------------------------------------------------------------------------
// getVocabularyForField()
// ---------------------------------------------------------------------------

describe("getVocabularyForField", () => {
  it("returns tags array when tags is non-empty", () => {
    expect(getVocabularyForField("tags")).toEqual(["alpha", "beta"]);
  });

  it("returns null when tags is empty — FR-11 suppression", () => {
    (window as any).__MARKABLE_META__ = EMPTY_META;
    expect(getVocabularyForField("tags")).toBeNull();
  });

  it("returns null when window.__MARKABLE_META__ is undefined", () => {
    // EC-1: no meta global set at all.
    delete (window as any).__MARKABLE_META__;
    expect(getVocabularyForField("tags")).toBeNull();
  });

  it("returns field vocabulary for a non-tags field — FR-10", () => {
    expect(getVocabularyForField("author")).toEqual(["Dave", "Alice"]);
  });

  it("returns null when field key is absent — EC-12", () => {
    // "status" has no entry in fields → no vocabulary → no warnings.
    expect(getVocabularyForField("status")).toBeNull();
  });

  it("returns null when field vocabulary is empty — FR-11", () => {
    // An empty array for a field is treated as "no vocabulary defined".
    (window as any).__MARKABLE_META__ = { ...FULL_META, fields: { author: [] } };
    expect(getVocabularyForField("author")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildChipElement() — warning modifier
// ---------------------------------------------------------------------------

describe("buildChipElement — warning modifier", () => {
  it("adds warning class when value is NOT in non-empty vocabulary", () => {
    // "unknown-tag" is not in meta.tags = ["alpha", "beta"].
    const chip = buildChipElement("unknown-tag", ["unknown-tag"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(true);
    expect(chip.title).toContain('"unknown-tag" is not in the tags vocabulary');
  });

  it("does NOT add warning class when value IS in vocabulary", () => {
    // "alpha" is in meta.tags → no warning.
    const chip = buildChipElement("alpha", ["alpha"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
    // title on the outer chip should be empty when no warning.
    expect(chip.title).toBe("");
  });

  it("does NOT add warning class when vocabulary is empty — FR-11", () => {
    // Empty tags → getVocabularyForField returns null → no warning.
    (window as any).__MARKABLE_META__ = EMPTY_META;
    const chip = buildChipElement("any-value", ["any-value"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });

  it("does NOT add warning class when no meta global is set — EC-1", () => {
    // No __MARKABLE_META__ at all → getVocabularyForField returns null → no warning.
    delete (window as any).__MARKABLE_META__;
    const chip = buildChipElement("any-value", ["any-value"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });

  it("comparison is case-sensitive — EC-8", () => {
    // Meta vocabulary has "Productivity" (capital P).
    // Chip value "productivity" (lower-case) must NOT match → warning added.
    (window as any).__MARKABLE_META__ = {
      tags: ["Productivity"],
      fields: {},
      vaultId: "v1",
    };
    const chip = buildChipElement("productivity", ["productivity"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(true);
  });

  it("handles 'yes' string correctly — no YAML boolean coercion, EC-9", () => {
    // js-yaml may parse bare "yes" as boolean true, but our vocabulary and values
    // are stored as strings. "yes" === "yes" should match without coercion.
    (window as any).__MARKABLE_META__ = {
      tags: ["yes"],
      fields: {},
      vaultId: "v1",
    };
    const chip = buildChipElement("yes", ["yes"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });

  it("applies warning for non-tags field via fields map — FR-10", () => {
    // FULL_META.fields.author = ["Dave", "Alice"]. "Bob" is not in that list.
    const chip = buildChipElement("Bob", ["Bob"], "author");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(true);
  });

  it("EC-12: field with no meta vocabulary never produces a warning", () => {
    // "status" has no entry in fields → vocabulary null → no warning regardless of value.
    const chip = buildChipElement("anything", ["anything"], "status");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });
});
