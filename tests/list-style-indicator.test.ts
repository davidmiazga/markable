/**
 * Unit tests for the list style status bar indicator.
 *
 * Tests exercise `computeListStyleLabel()` — the pure function that determines
 * the display label for the status bar based on cursor position and document
 * content. This function is called by the CM6 updateListener wrapper
 * (`listStyleIndicator`) but has no CM6 dependency itself, making it
 * fully testable in isolation.
 *
 * Edge cases covered:
 *   EC-11: Status bar on non-list line -> returns empty string
 *   EC-12: Status bar with comment override -> shows style from comment
 *   EC-16: Empty document / no list block -> returns empty string
 */

import { describe, it, expect } from "vitest";
import { computeListStyleLabel } from "../src/editor/list-style-switch";

// ============================================================
// EC-11: Status bar on non-list line — indicator disappears
// ============================================================

describe("EC-11: cursor on non-list line", () => {
  it("returns empty string when cursor is on a heading", () => {
    const label = computeListStyleLabel(
      ["# Heading", "Some paragraph text"],
      0,
      "standard",
    );
    expect(label).toBe("");
  });

  it("returns empty string when cursor is on a paragraph", () => {
    const label = computeListStyleLabel(
      ["1. First item", "Just a paragraph", "2. Second item"],
      1,
      "standard",
    );
    expect(label).toBe("");
  });

  it("returns empty string when cursor is on a blank line between lists", () => {
    const label = computeListStyleLabel(
      ["1. First item", "", "1. Another list"],
      1,
      "standard",
    );
    expect(label).toBe("");
  });
});

// ============================================================
// EC-16: Empty document / no list block
// ============================================================

describe("EC-16: empty document or no list block", () => {
  it("returns empty string for an empty document", () => {
    const label = computeListStyleLabel([], 0, "standard");
    expect(label).toBe("");
  });

  it("returns empty string for a single blank line", () => {
    const label = computeListStyleLabel([""], 0, "standard");
    expect(label).toBe("");
  });

  it("returns empty string for a document with no lists", () => {
    const label = computeListStyleLabel(
      ["# Title", "A paragraph.", "Another paragraph."],
      1,
      "standard",
    );
    expect(label).toBe("");
  });
});

// ============================================================
// Standard list detection
// ============================================================

describe("standard list detection", () => {
  it('returns "Standard" when cursor is on a standard list line', () => {
    const label = computeListStyleLabel(
      ["1. First item", "2. Second item", "3. Third item"],
      0,
      "standard",
    );
    expect(label).toBe("Standard");
  });

  it('returns "Standard" when cursor is on the last line of a standard list', () => {
    const label = computeListStyleLabel(
      ["1. First item", "2. Second item"],
      1,
      "standard",
    );
    expect(label).toBe("Standard");
  });
});

// ============================================================
// Alphanumeric list detection
// ============================================================

describe("alphanumeric list detection", () => {
  it('returns "Alphanumeric" when cursor is on an alphanumeric list line', () => {
    const label = computeListStyleLabel(
      ["I. First item", "  A. Sub item", "    1. Sub sub"],
      0,
      "standard",
    );
    expect(label).toBe("Alphanumeric");
  });

  it('returns "Alphanumeric" when cursor is on a nested alphanumeric line', () => {
    const label = computeListStyleLabel(
      ["I. First item", "  A. Sub item"],
      1,
      "standard",
    );
    expect(label).toBe("Alphanumeric");
  });
});

// ============================================================
// Decimal-outline list detection
// ============================================================

describe("decimal-outline list detection", () => {
  it('returns "Decimal" when cursor is on a decimal-outline list line', () => {
    const label = computeListStyleLabel(
      ["1. First", "  1.1. Nested"],
      1,
      "standard",
    );
    expect(label).toBe("Decimal");
  });
});

// ============================================================
// Steps list detection
// ============================================================

describe("steps list detection", () => {
  it('returns "Steps" when comment override declares steps style', () => {
    // inferListStyle uses comment override as the highest-priority signal.
    // A steps-style list with "1. / a. / -" markers and a preceding comment
    // is the canonical way to declare steps style.
    const label = computeListStyleLabel(
      ["<!-- list: steps -->", "1. Do this", "  a. Sub step", "    - Detail"],
      1,
      "standard",
    );
    expect(label).toBe("Steps");
  });

  it('returns "Steps" when alpha-lower marker appears at depth 0', () => {
    // inferListStyle recognizes alpha-lower at depth 0 as a steps signal.
    const label = computeListStyleLabel(
      ["a. First step", "b. Second step"],
      0,
      "standard",
    );
    expect(label).toBe("Steps");
  });
});

// ============================================================
// EC-12: Comment override — status bar shows style from comment
// ============================================================

describe("EC-12: comment override in status bar", () => {
  it('shows "Steps" when comment overrides markers that look standard', () => {
    // The markers are "1. 2. 3." which inferListStyle would normally call
    // "standard", but the comment override forces "steps".
    const label = computeListStyleLabel(
      ["<!-- list: steps -->", "1. First item", "2. Second item"],
      1,
      "standard",
    );
    expect(label).toBe("Steps");
  });

  it('shows "Alphanumeric" when comment overrides to alphanumeric', () => {
    const label = computeListStyleLabel(
      ["<!-- list: alphanumeric -->", "1. First item", "2. Second item"],
      1,
      "standard",
    );
    expect(label).toBe("Alphanumeric");
  });

  it('shows "Decimal" when comment overrides to decimal', () => {
    const label = computeListStyleLabel(
      ["<!-- list: decimal -->", "1. First item", "2. Second item"],
      1,
      "standard",
    );
    expect(label).toBe("Decimal");
  });
});

// ============================================================
// Fallback style used when inference is ambiguous
// ============================================================

describe("fallback style", () => {
  it("uses the provided fallback when markers are ambiguous (all decimal)", () => {
    // A list with only "1. 2. 3." markers is ambiguous between standard,
    // decimal, and steps. The fallback style determines the label.
    const label = computeListStyleLabel(
      ["1. First", "2. Second"],
      0,
      "alphanumeric",
    );
    // inferListStyle with fallback "alphanumeric" returns "alphanumeric"
    // when it cannot distinguish from markers alone.
    expect(label).toBe("Alphanumeric");
  });
});
