/**
 * Unit tests for the list style-switching logic.
 *
 * Tests exercise `computeStyleSwitchChanges()` — the pure transformation
 * function that contains all switching logic without CM6 dependency.
 * Each test case maps to an edge case from the requirements spec (EC-1
 * through EC-18, with relevant ones for Step 1).
 */

import { describe, it, expect } from "vitest";
import { computeStyleSwitchChanges } from "../src/editor/list-style-switch";

// ============================================================
// EC-1: Cursor not on a list line
// ============================================================

describe("EC-1: cursor not on list line", () => {
  it("returns null when cursor is on a heading", () => {
    const result = computeStyleSwitchChanges(
      ["# Heading", "Some text"],
      0,
      "alphanumeric",
    );
    expect(result).toBeNull();
  });

  it("returns null when cursor is on a plain paragraph", () => {
    const result = computeStyleSwitchChanges(
      ["Just a paragraph", "More text"],
      1,
      "steps",
    );
    expect(result).toBeNull();
  });
});

// ============================================================
// EC-2: Single-item list
// ============================================================

describe("EC-2: single-item list", () => {
  it("rewrites the single marker to the target style", () => {
    const result = computeStyleSwitchChanges(
      ["1. Only item"],
      0,
      "alphanumeric",
    );
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(1);
    expect(result!.changes[0].oldMarker).toBe("1. ");
    expect(result!.changes[0].newMarker).toBe("I. ");
  });

  it("single item to decimal keeps the same marker at depth 0", () => {
    const result = computeStyleSwitchChanges(
      ["1. Only item"],
      0,
      "decimal",
    );
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(1);
    // decimal-outline at depth 0 with ordinal 1 and no parent chain = "1. "
    expect(result!.changes[0].newMarker).toBe("1. ");
  });

  it("single item to steps keeps decimal at depth 0", () => {
    const result = computeStyleSwitchChanges(
      ["I. Only item"],
      0,
      "steps",
    );
    expect(result).not.toBeNull();
    expect(result!.changes[0].newMarker).toBe("1. ");
  });
});

// ============================================================
// EC-3: Deeply nested list (5+ levels, alphanumeric)
// ============================================================

describe("EC-3: deeply nested list (5+ levels)", () => {
  it("cycles through all 5 alphanumeric marker types and wraps at depth 5", () => {
    const lines = [
      "1. Depth 0",
      "  1. Depth 1",
      "    1. Depth 2",
      "      1. Depth 3",
      "        1. Depth 4",
      "          1. Depth 5",
    ];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(6);

    // depth 0: roman-upper => I.
    expect(result!.changes[0].newMarker).toBe("I. ");
    // depth 1: alpha-upper => A.
    expect(result!.changes[1].newMarker).toBe("A. ");
    // depth 2: decimal => 1.
    expect(result!.changes[2].newMarker).toBe("1. ");
    // depth 3: alpha-lower => a.
    expect(result!.changes[3].newMarker).toBe("a. ");
    // depth 4: roman-lower => i.
    expect(result!.changes[4].newMarker).toBe("i. ");
    // depth 5: wraps to roman-upper => I.
    expect(result!.changes[5].newMarker).toBe("I. ");
  });
});

// ============================================================
// EC-4: Empty list items
// ============================================================

describe("EC-4: empty list items", () => {
  it("rewrites markers on empty content lines without corruption", () => {
    const lines = ["1. ", "2. Content"];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(2);
    // Both markers should be rewritten even though the first has empty content
    expect(result!.changes[0].oldMarker).toBe("1. ");
    expect(result!.changes[0].newMarker).toBe("I. ");
    expect(result!.changes[1].oldMarker).toBe("2. ");
    expect(result!.changes[1].newMarker).toBe("II. ");
  });
});

// ============================================================
// EC-5: Mixed depths with decimal-outline
// ============================================================

describe("EC-5: mixed depths to decimal", () => {
  it("produces correct x.y.z markers with parent chains", () => {
    const lines = [
      "1. A",
      "  1. B",
      "  2. C",
      "2. D",
      "  1. E",
      "    1. F",
    ];
    const result = computeStyleSwitchChanges(lines, 0, "decimal");
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(6);

    // depth 0, ordinal 1: "1. "
    expect(result!.changes[0].newMarker).toBe("1. ");
    // depth 1, ordinal 1, parent [1]: "1.1. "
    expect(result!.changes[1].newMarker).toBe("1.1. ");
    // depth 1, ordinal 2, parent [1]: "1.2. "
    expect(result!.changes[2].newMarker).toBe("1.2. ");
    // depth 0, ordinal 2: "2. "
    expect(result!.changes[3].newMarker).toBe("2. ");
    // depth 1, ordinal 1, parent [2]: "2.1. "
    expect(result!.changes[4].newMarker).toBe("2.1. ");
    // depth 2, ordinal 1, parent [2, 1]: "2.1.1. "
    expect(result!.changes[5].newMarker).toBe("2.1.1. ");
  });
});

// ============================================================
// EC-6: Comment override already present
// ============================================================

describe("EC-6: comment override present", () => {
  it("does not rewrite the comment line but rewrites list markers", () => {
    const lines = [
      "<!-- list: alphanumeric -->",
      "1. First",
      "2. Second",
    ];
    const result = computeStyleSwitchChanges(lines, 1, "steps");
    expect(result).not.toBeNull();
    // Comment line has no marker, so it should not appear in changes
    expect(result!.changes).toHaveLength(2);
    expect(result!.changes[0].lineIndex).toBe(1);
    expect(result!.changes[0].newMarker).toBe("1. ");
    expect(result!.changes[1].lineIndex).toBe(2);
    expect(result!.changes[1].newMarker).toBe("2. ");
  });
});

// ============================================================
// EC-7: Switching to the same style (idempotent)
// ============================================================

describe("EC-7: switching to the same style", () => {
  it("produces identical markers for standard -> standard", () => {
    const lines = ["1. A", "2. B"];
    const result = computeStyleSwitchChanges(lines, 0, "standard");
    expect(result).not.toBeNull();
    // Markers should remain the same (idempotent rewrite)
    expect(result!.changes[0].oldMarker).toBe("1. ");
    expect(result!.changes[0].newMarker).toBe("1. ");
    expect(result!.changes[1].oldMarker).toBe("2. ");
    expect(result!.changes[1].newMarker).toBe("2. ");
  });

  it("produces identical markers for alphanumeric -> alphanumeric", () => {
    const lines = ["I. A", "  A. B", "    1. C"];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();
    expect(result!.changes[0].newMarker).toBe("I. ");
    expect(result!.changes[1].newMarker).toBe("A. ");
    expect(result!.changes[2].newMarker).toBe("1. ");
  });
});

// ============================================================
// EC-8: Alpha overflow (>26 items)
// ============================================================

describe("EC-8: alpha overflow (>26 items)", () => {
  it("falls back to numeric string for items beyond 26", () => {
    // Build 28 lines all at depth 1 (alpha-upper in alphanumeric)
    const lines: string[] = [];
    // Need a depth-0 anchor line so depth-1 lines have a parent context
    lines.push("I. Anchor");
    for (let i = 1; i <= 28; i++) {
      lines.push(`  ${i}. Item ${i}`);
    }

    const result = computeStyleSwitchChanges(lines, 1, "alphanumeric");
    expect(result).not.toBeNull();

    // depth 0 -> roman-upper: "I. "
    expect(result!.changes[0].newMarker).toBe("I. ");

    // depth 1 -> alpha-upper: A through Z, then "27. ", "28. "
    expect(result!.changes[1].newMarker).toBe("A. ");
    expect(result!.changes[26].newMarker).toBe("Z. ");
    // Item 27 overflows: toAlphaUpper(27) returns "27"
    expect(result!.changes[27].newMarker).toBe("27. ");
    expect(result!.changes[28].newMarker).toBe("28. ");
  });
});

// ============================================================
// EC-9: Roman numeral generation
// ============================================================

describe("EC-9: roman numeral generation", () => {
  it("generates correct roman numerals at depth 0 for alphanumeric", () => {
    const lines = ["1. A", "2. B", "3. C"];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();
    expect(result!.changes[0].newMarker).toBe("I. ");
    expect(result!.changes[1].newMarker).toBe("II. ");
    expect(result!.changes[2].newMarker).toBe("III. ");
  });
});

// ============================================================
// EC-10: Single transaction (change array size = block size)
// ============================================================

describe("EC-10: single transaction verification", () => {
  it("returns one change entry per list line in the block", () => {
    const lines = ["1. A", "  2. B", "3. C"];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();
    // 3 list lines in the block = 3 changes
    expect(result!.changes).toHaveLength(3);
  });

  it("exposes blockStart and blockEnd for the caller to verify scope", () => {
    const lines = ["1. A", "2. B", "3. C"];
    const result = computeStyleSwitchChanges(lines, 1, "steps");
    expect(result).not.toBeNull();
    expect(result!.blockStart).toBe(0);
    expect(result!.blockEnd).toBe(2);
  });
});

// ============================================================
// EC-14: Decimal parent chain computation
// ============================================================

describe("EC-14: decimal parent chain computation", () => {
  it("computes correct parent chains for depths [0,1,1,0,1,2]", () => {
    const lines = [
      "1. A",       // depth 0
      "  1. B",     // depth 1
      "  2. C",     // depth 1
      "2. D",       // depth 0
      "  1. E",     // depth 1
      "    1. F",   // depth 2
    ];
    const result = computeStyleSwitchChanges(lines, 0, "decimal");
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(6);

    expect(result!.changes[0].newMarker).toBe("1. ");
    expect(result!.changes[1].newMarker).toBe("1.1. ");
    expect(result!.changes[2].newMarker).toBe("1.2. ");
    expect(result!.changes[3].newMarker).toBe("2. ");
    expect(result!.changes[4].newMarker).toBe("2.1. ");
    expect(result!.changes[5].newMarker).toBe("2.1.1. ");
  });

  it("handles 3 levels of nesting correctly", () => {
    const lines = [
      "1. A",
      "  1. B",
      "    1. C",
      "    2. D",
      "  2. E",
      "2. F",
    ];
    const result = computeStyleSwitchChanges(lines, 0, "decimal");
    expect(result).not.toBeNull();

    expect(result!.changes[0].newMarker).toBe("1. ");
    expect(result!.changes[1].newMarker).toBe("1.1. ");
    expect(result!.changes[2].newMarker).toBe("1.1.1. ");
    expect(result!.changes[3].newMarker).toBe("1.1.2. ");
    expect(result!.changes[4].newMarker).toBe("1.2. ");
    expect(result!.changes[5].newMarker).toBe("2. ");
  });
});

// ============================================================
// EC-15: Bullet markers in steps at depth 2+
// ============================================================

describe("EC-15: bullet markers in steps at depth 2+", () => {
  it("produces decimal, alpha-lower, bullet for depths 0/1/2", () => {
    const lines = [
      "1. Depth 0",
      "  1. Depth 1",
      "    1. Depth 2",
    ];
    const result = computeStyleSwitchChanges(lines, 0, "steps");
    expect(result).not.toBeNull();
    expect(result!.changes[0].newMarker).toBe("1. ");
    expect(result!.changes[1].newMarker).toBe("a. ");
    expect(result!.changes[2].newMarker).toBe("- ");
  });

  it("all items at depth 3+ also get bullet markers", () => {
    const lines = [
      "1. A",
      "  1. B",
      "    1. C",
      "      1. D",
      "        1. E",
    ];
    const result = computeStyleSwitchChanges(lines, 0, "steps");
    expect(result).not.toBeNull();
    expect(result!.changes[2].newMarker).toBe("- ");
    expect(result!.changes[3].newMarker).toBe("- ");
    expect(result!.changes[4].newMarker).toBe("- ");
  });
});

// ============================================================
// EC-16: Empty document / no list block
// ============================================================

describe("EC-16: empty document", () => {
  it("returns null for an empty lines array", () => {
    const result = computeStyleSwitchChanges([], 0, "alphanumeric");
    expect(result).toBeNull();
  });

  it("returns null for out-of-bounds cursor index", () => {
    const result = computeStyleSwitchChanges(["1. A"], 5, "alphanumeric");
    expect(result).toBeNull();
  });
});

// ============================================================
// EC-17: Selection spans multiple list blocks
// ============================================================

describe("EC-17: cursor in middle of two blocks separated by blank line", () => {
  it("only rewrites the block containing the cursor", () => {
    const lines = [
      "1. Block1-A",
      "2. Block1-B",
      "",
      "1. Block2-A",
      "2. Block2-B",
    ];
    const result = computeStyleSwitchChanges(lines, 3, "alphanumeric");
    expect(result).not.toBeNull();
    // Only block 2 (lines 3-4) should be rewritten
    expect(result!.blockStart).toBe(3);
    expect(result!.blockEnd).toBe(4);
    expect(result!.changes).toHaveLength(2);
    expect(result!.changes[0].lineIndex).toBe(3);
    expect(result!.changes[0].newMarker).toBe("I. ");
    expect(result!.changes[1].lineIndex).toBe(4);
    expect(result!.changes[1].newMarker).toBe("II. ");
  });

  it("first block is unaffected when cursor is in second block", () => {
    const lines = [
      "I. Block1-A",
      "II. Block1-B",
      "",
      "1. Block2-A",
      "2. Block2-B",
    ];
    const result = computeStyleSwitchChanges(lines, 3, "steps");
    expect(result).not.toBeNull();
    // Only lines 3-4 should appear in changes
    expect(result!.changes.every(c => c.lineIndex >= 3)).toBe(true);
  });
});

// ============================================================
// EC-18: Block starts with comment line
// ============================================================

describe("EC-18: block starts with comment", () => {
  it("comment is in block range but not rewritten", () => {
    const lines = [
      "<!-- list: decimal -->",
      "1. A",
      "  2. B",
    ];
    const result = computeStyleSwitchChanges(lines, 1, "alphanumeric");
    expect(result).not.toBeNull();
    // Block includes the comment line
    expect(result!.blockStart).toBe(0);
    expect(result!.blockEnd).toBe(2);
    // But only the 2 list lines get marker changes
    expect(result!.changes).toHaveLength(2);
    expect(result!.changes[0].lineIndex).toBe(1);
    expect(result!.changes[0].newMarker).toBe("I. ");
    expect(result!.changes[1].lineIndex).toBe(2);
    expect(result!.changes[1].newMarker).toBe("A. ");
  });
});

// ============================================================
// Additional integration-style tests
// ============================================================

describe("standard style rewrite", () => {
  it("converts alphanumeric markers back to decimal at all depths", () => {
    const lines = [
      "I. First",
      "  A. Sub",
      "    1. Detail",
    ];
    const result = computeStyleSwitchChanges(lines, 0, "standard");
    expect(result).not.toBeNull();
    // Standard is always decimal, regardless of depth
    expect(result!.changes[0].newMarker).toBe("1. ");
    expect(result!.changes[1].newMarker).toBe("1. ");
    expect(result!.changes[2].newMarker).toBe("1. ");
  });
});

describe("ordinal tracking across depth changes", () => {
  it("resets ordinals correctly when depth decreases", () => {
    const lines = [
      "1. A",       // depth 0, ordinal 1
      "  1. B",     // depth 1, ordinal 1
      "  2. C",     // depth 1, ordinal 2
      "2. D",       // depth 0, ordinal 2
      "  1. E",     // depth 1, ordinal 1 (reset because depth went back to 0 then down to 1)
    ];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();
    expect(result!.changes).toHaveLength(5);

    // depth 0 -> roman-upper: I, II
    expect(result!.changes[0].newMarker).toBe("I. ");
    expect(result!.changes[3].newMarker).toBe("II. ");

    // depth 1 -> alpha-upper: A, B (first group), then A (reset for second group)
    expect(result!.changes[1].newMarker).toBe("A. ");
    expect(result!.changes[2].newMarker).toBe("B. ");
    expect(result!.changes[4].newMarker).toBe("A. ");
  });
});

describe("multiple items at same depth with deeper items between", () => {
  it("continues ordinal counting at a depth after returning from deeper", () => {
    const lines = [
      "1. A",       // depth 0, ordinal 1
      "  1. B",     // depth 1, ordinal 1
      "    1. C",   // depth 2, ordinal 1
      "  2. D",     // depth 1, ordinal 2 (continues from 1)
      "2. E",       // depth 0, ordinal 2
    ];
    const result = computeStyleSwitchChanges(lines, 0, "alphanumeric");
    expect(result).not.toBeNull();

    expect(result!.changes[0].newMarker).toBe("I. ");     // depth 0, ord 1
    expect(result!.changes[1].newMarker).toBe("A. ");     // depth 1, ord 1
    expect(result!.changes[2].newMarker).toBe("1. ");     // depth 2, ord 1
    expect(result!.changes[3].newMarker).toBe("B. ");     // depth 1, ord 2
    expect(result!.changes[4].newMarker).toBe("II. ");    // depth 0, ord 2
  });
});
