import { describe, it, expect } from "vitest";
import {
  toRomanUpper,
  toRomanLower,
  fromRoman,
  isRomanNumeral,
  toAlphaLower,
  toAlphaUpper,
  fromAlpha,
  generateMarker,
  markerTypeForDepth,
  detectListLine,
  inferListStyle,
  nextMarker,
  firstMarkerForDepth,
  incrementMarker,
  disambiguate,
  isListMetaComment,
  parseListMetaComment,
  findListBlockRange,
  type ListLineInfo,
} from "../src/editor/list-engine";

// ============================================================
// Roman numeral helpers
// ============================================================

describe("toRomanUpper", () => {
  it("converts basic numbers", () => {
    expect(toRomanUpper(1)).toBe("I");
    expect(toRomanUpper(2)).toBe("II");
    expect(toRomanUpper(3)).toBe("III");
    expect(toRomanUpper(4)).toBe("IV");
    expect(toRomanUpper(5)).toBe("V");
    expect(toRomanUpper(9)).toBe("IX");
    expect(toRomanUpper(10)).toBe("X");
    expect(toRomanUpper(14)).toBe("XIV");
    expect(toRomanUpper(50)).toBe("L");
    expect(toRomanUpper(100)).toBe("C");
    expect(toRomanUpper(500)).toBe("D");
    expect(toRomanUpper(1000)).toBe("M");
  });

  it("handles edge cases", () => {
    expect(toRomanUpper(0)).toBe("0");
    expect(toRomanUpper(-1)).toBe("-1");
    expect(toRomanUpper(3999)).toBe("MMMCMXCIX");
    expect(toRomanUpper(4000)).toBe("4000");
  });
});

describe("toRomanLower", () => {
  it("converts to lowercase", () => {
    expect(toRomanLower(1)).toBe("i");
    expect(toRomanLower(4)).toBe("iv");
    expect(toRomanLower(14)).toBe("xiv");
  });
});

describe("fromRoman", () => {
  it("parses roman numerals", () => {
    expect(fromRoman("I")).toBe(1);
    expect(fromRoman("IV")).toBe(4);
    expect(fromRoman("IX")).toBe(9);
    expect(fromRoman("XIV")).toBe(14);
    expect(fromRoman("XLII")).toBe(42);
  });

  it("handles lowercase", () => {
    expect(fromRoman("iv")).toBe(4);
    expect(fromRoman("xiv")).toBe(14);
  });
});

describe("isRomanNumeral", () => {
  it("recognizes valid roman numerals", () => {
    expect(isRomanNumeral("I")).toBe(true);
    expect(isRomanNumeral("IV")).toBe(true);
    expect(isRomanNumeral("XIV")).toBe(true);
    expect(isRomanNumeral("MMMCMXCIX")).toBe(true);
    expect(isRomanNumeral("i")).toBe(true);
    expect(isRomanNumeral("iv")).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isRomanNumeral("")).toBe(false);
    expect(isRomanNumeral("A")).toBe(false);
    expect(isRomanNumeral("IIII")).toBe(false);
    expect(isRomanNumeral("ABC")).toBe(false);
  });
});

// ============================================================
// Alpha helpers
// ============================================================

describe("toAlphaLower / toAlphaUpper", () => {
  it("converts ordinals to letters", () => {
    expect(toAlphaLower(1)).toBe("a");
    expect(toAlphaLower(26)).toBe("z");
    expect(toAlphaUpper(1)).toBe("A");
    expect(toAlphaUpper(26)).toBe("Z");
  });

  it("handles out of range", () => {
    expect(toAlphaLower(0)).toBe("0");
    expect(toAlphaLower(27)).toBe("27");
  });
});

describe("fromAlpha", () => {
  it("converts letters to ordinals", () => {
    expect(fromAlpha("a")).toBe(1);
    expect(fromAlpha("z")).toBe(26);
    expect(fromAlpha("A")).toBe(1);
    expect(fromAlpha("Z")).toBe(26);
  });
});

// ============================================================
// generateMarker
// ============================================================

describe("generateMarker", () => {
  it("generates decimal markers", () => {
    expect(generateMarker("decimal", 1)).toBe("1. ");
    expect(generateMarker("decimal", 10)).toBe("10. ");
  });

  it("generates alpha markers", () => {
    expect(generateMarker("alpha-lower", 1)).toBe("a. ");
    expect(generateMarker("alpha-lower", 3)).toBe("c. ");
    expect(generateMarker("alpha-upper", 1)).toBe("A. ");
    expect(generateMarker("alpha-upper", 3)).toBe("C. ");
  });

  it("generates roman markers", () => {
    expect(generateMarker("roman-upper", 1)).toBe("I. ");
    expect(generateMarker("roman-upper", 4)).toBe("IV. ");
    expect(generateMarker("roman-lower", 1)).toBe("i. ");
    expect(generateMarker("roman-lower", 4)).toBe("iv. ");
  });

  it("generates decimal-outline markers", () => {
    expect(generateMarker("decimal-outline", 1, [1])).toBe("1.1. ");
    expect(generateMarker("decimal-outline", 3, [1, 2])).toBe("1.2.3. ");
    expect(generateMarker("decimal-outline", 1)).toBe("1. ");
  });

  it("generates bullet markers", () => {
    expect(generateMarker("bullet", 0)).toBe("- ");
  });
});

// ============================================================
// markerTypeForDepth
// ============================================================

describe("markerTypeForDepth", () => {
  it("standard is always decimal", () => {
    expect(markerTypeForDepth("standard", 0)).toBe("decimal");
    expect(markerTypeForDepth("standard", 3)).toBe("decimal");
  });

  it("alphanumeric cycles through 5 types", () => {
    expect(markerTypeForDepth("alphanumeric", 0)).toBe("roman-upper");
    expect(markerTypeForDepth("alphanumeric", 1)).toBe("alpha-upper");
    expect(markerTypeForDepth("alphanumeric", 2)).toBe("decimal");
    expect(markerTypeForDepth("alphanumeric", 3)).toBe("alpha-lower");
    expect(markerTypeForDepth("alphanumeric", 4)).toBe("roman-lower");
    // Wraps
    expect(markerTypeForDepth("alphanumeric", 5)).toBe("roman-upper");
  });

  it("decimal is always decimal-outline", () => {
    expect(markerTypeForDepth("decimal", 0)).toBe("decimal-outline");
    expect(markerTypeForDepth("decimal", 3)).toBe("decimal-outline");
  });

  it("steps uses decimal → alpha-lower → bullet", () => {
    expect(markerTypeForDepth("steps", 0)).toBe("decimal");
    expect(markerTypeForDepth("steps", 1)).toBe("alpha-lower");
    expect(markerTypeForDepth("steps", 2)).toBe("bullet");
    expect(markerTypeForDepth("steps", 5)).toBe("bullet");
  });
});

// ============================================================
// detectListLine
// ============================================================

describe("detectListLine", () => {
  it("detects decimal markers", () => {
    const info = detectListLine("1. First item");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("decimal");
    expect(info!.ordinal).toBe(1);
    expect(info!.depth).toBe(0);
    expect(info!.content).toBe("First item");
  });

  it("detects indented decimal markers", () => {
    const info = detectListLine("  2. Second item");
    expect(info).not.toBeNull();
    expect(info!.depth).toBe(1);
    expect(info!.ordinal).toBe(2);
  });

  it("detects bullet markers", () => {
    const info = detectListLine("- Item");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("bullet");
    expect(info!.content).toBe("Item");
  });

  it("detects indented bullet markers", () => {
    const info = detectListLine("    - Deep item");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("bullet");
    expect(info!.depth).toBe(2);
  });

  it("detects decimal-outline markers", () => {
    const info = detectListLine("1.1. Sub item");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("decimal-outline");
    expect(info!.ordinal).toBe(1);
    expect(info!.parentChain).toEqual([1]);
  });

  it("detects deep decimal-outline markers", () => {
    const info = detectListLine("  1.2.3. Deep item");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("decimal-outline");
    expect(info!.ordinal).toBe(3);
    expect(info!.parentChain).toEqual([1, 2]);
  });

  it("detects roman upper markers", () => {
    const info = detectListLine("IV. Fourth section");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("roman-upper");
    expect(info!.ordinal).toBe(4);
  });

  it("detects roman lower markers", () => {
    const info = detectListLine("        iv. Fourth sub");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("roman-lower");
    expect(info!.ordinal).toBe(4);
  });

  it("detects alpha upper markers", () => {
    const info = detectListLine("  B. Second sub");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("alpha-upper");
    expect(info!.ordinal).toBe(2);
  });

  it("detects alpha lower markers", () => {
    const info = detectListLine("  c. Third sub");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("alpha-lower");
    expect(info!.ordinal).toBe(3);
  });

  it("returns null for non-list lines", () => {
    expect(detectListLine("Just a paragraph")).toBeNull();
    expect(detectListLine("")).toBeNull();
    expect(detectListLine("  indented text")).toBeNull();
  });

  it("handles single-letter roman numerals as roman when valid", () => {
    // "I." is both alpha-upper and roman-upper. detectListLine should return roman-upper
    // because the regex checks roman first.
    const info = detectListLine("I. First");
    expect(info).not.toBeNull();
    expect(info!.markerType).toBe("roman-upper");
    expect(info!.ordinal).toBe(1);
  });
});

// ============================================================
// inferListStyle
// ============================================================

describe("inferListStyle", () => {
  it("detects alphanumeric from roman upper markers", () => {
    const lines = ["I. First", "  A. Sub", "    1. Detail"];
    expect(inferListStyle(lines, null, "standard")).toBe("alphanumeric");
  });

  it("detects steps from alpha lower at depth 0", () => {
    const lines = ["a. First part"];
    expect(inferListStyle(lines, null, "standard")).toBe("steps");
  });

  it("detects decimal from outline markers", () => {
    const lines = ["1. First", "1.1. Sub"];
    expect(inferListStyle(lines, null, "standard")).toBe("decimal");
  });

  it("falls back to default for ambiguous 1. markers", () => {
    const lines = ["1. First", "2. Second"];
    expect(inferListStyle(lines, null, "standard")).toBe("standard");
    expect(inferListStyle(lines, null, "steps")).toBe("steps");
  });

  it("respects metadata comment override", () => {
    const lines = ["1. First", "2. Second"];
    expect(inferListStyle(lines, "<!-- list:alphanumeric -->", "standard")).toBe("alphanumeric");
    expect(inferListStyle(lines, "<!-- list:decimal -->", "standard")).toBe("decimal");
    expect(inferListStyle(lines, "<!-- list:steps -->", "standard")).toBe("steps");
  });

  it("metadata comment overrides marker inference", () => {
    // Lines look alphanumeric but comment says steps
    const lines = ["I. First", "  A. Sub"];
    expect(inferListStyle(lines, "<!-- list:steps -->", "standard")).toBe("steps");
  });
});

// ============================================================
// nextMarker / firstMarkerForDepth
// ============================================================

describe("nextMarker", () => {
  it("generates standard markers", () => {
    expect(nextMarker("standard", 0, 1)).toBe("1. ");
    expect(nextMarker("standard", 0, 5)).toBe("5. ");
    expect(nextMarker("standard", 2, 3)).toBe("3. ");
  });

  it("generates alphanumeric markers at each depth", () => {
    expect(nextMarker("alphanumeric", 0, 1)).toBe("I. ");
    expect(nextMarker("alphanumeric", 0, 4)).toBe("IV. ");
    expect(nextMarker("alphanumeric", 1, 1)).toBe("A. ");
    expect(nextMarker("alphanumeric", 1, 3)).toBe("C. ");
    expect(nextMarker("alphanumeric", 2, 1)).toBe("1. ");
    expect(nextMarker("alphanumeric", 3, 1)).toBe("a. ");
    expect(nextMarker("alphanumeric", 4, 1)).toBe("i. ");
  });

  it("generates decimal outline markers", () => {
    expect(nextMarker("decimal", 0, 1)).toBe("1. ");
    expect(nextMarker("decimal", 1, 1, [1])).toBe("1.1. ");
    expect(nextMarker("decimal", 1, 3, [1])).toBe("1.3. ");
    expect(nextMarker("decimal", 2, 2, [1, 3])).toBe("1.3.2. ");
  });

  it("generates steps markers", () => {
    expect(nextMarker("steps", 0, 1)).toBe("1. ");
    expect(nextMarker("steps", 0, 3)).toBe("3. ");
    expect(nextMarker("steps", 1, 1)).toBe("a. ");
    expect(nextMarker("steps", 1, 3)).toBe("c. ");
    expect(nextMarker("steps", 2, 1)).toBe("- ");
    expect(nextMarker("steps", 5, 1)).toBe("- ");
  });
});

describe("firstMarkerForDepth", () => {
  it("generates first markers", () => {
    expect(firstMarkerForDepth("alphanumeric", 0)).toBe("I. ");
    expect(firstMarkerForDepth("alphanumeric", 1)).toBe("A. ");
    expect(firstMarkerForDepth("steps", 0)).toBe("1. ");
    expect(firstMarkerForDepth("steps", 1)).toBe("a. ");
    expect(firstMarkerForDepth("steps", 2)).toBe("- ");
  });
});

// ============================================================
// incrementMarker
// ============================================================

describe("incrementMarker", () => {
  it("increments decimal", () => {
    const info: ListLineInfo = {
      markerType: "decimal", depth: 0, ordinal: 3, marker: "3. ",
      indent: "", content: "test",
    };
    expect(incrementMarker(info)).toBe("4. ");
  });

  it("increments alpha lower", () => {
    const info: ListLineInfo = {
      markerType: "alpha-lower", depth: 1, ordinal: 1, marker: "a. ",
      indent: "  ", content: "test",
    };
    expect(incrementMarker(info)).toBe("b. ");
  });

  it("increments alpha upper", () => {
    const info: ListLineInfo = {
      markerType: "alpha-upper", depth: 1, ordinal: 2, marker: "B. ",
      indent: "  ", content: "test",
    };
    expect(incrementMarker(info)).toBe("C. ");
  });

  it("increments roman upper", () => {
    const info: ListLineInfo = {
      markerType: "roman-upper", depth: 0, ordinal: 3, marker: "III. ",
      indent: "", content: "test",
    };
    expect(incrementMarker(info)).toBe("IV. ");
  });

  it("increments roman lower", () => {
    const info: ListLineInfo = {
      markerType: "roman-lower", depth: 4, ordinal: 4, marker: "iv. ",
      indent: "        ", content: "test",
    };
    expect(incrementMarker(info)).toBe("v. ");
  });

  it("increments decimal-outline", () => {
    const info: ListLineInfo = {
      markerType: "decimal-outline", depth: 1, ordinal: 2, marker: "1.2. ",
      indent: "  ", content: "test", parentChain: [1],
    };
    expect(incrementMarker(info)).toBe("1.3. ");
  });

  it("bullet stays as bullet", () => {
    const info: ListLineInfo = {
      markerType: "bullet", depth: 2, ordinal: 0, marker: "- ",
      indent: "    ", content: "test",
    };
    expect(incrementMarker(info)).toBe("- ");
  });
});

// ============================================================
// disambiguate
// ============================================================

describe("disambiguate", () => {
  it("uses style definition when no siblings", () => {
    const info: ListLineInfo = {
      markerType: "roman-upper", depth: 0, ordinal: 1, marker: "I. ",
      indent: "", content: "test",
    };
    // In alphanumeric, depth 0 expects roman-upper — matches
    expect(disambiguate(info, [], "alphanumeric")).toBe("roman-upper");
    // In steps, depth 0 expects decimal — doesn't match, falls back to style def
    expect(disambiguate(info, [], "steps")).toBe("decimal");
  });

  it("detects alpha from sibling context", () => {
    const info: ListLineInfo = {
      markerType: "alpha-lower", depth: 1, ordinal: 9, marker: "i. ",
      indent: "  ", content: "test",
    };
    // Sibling "h." is clearly alpha (not a valid roman numeral on its own in context)
    const siblings = ["  h. Previous item"];
    expect(disambiguate(info, siblings, "alphanumeric")).toBe("alpha-lower");
  });
});

// ============================================================
// Metadata comment helpers
// ============================================================

describe("isListMetaComment", () => {
  it("detects valid comments", () => {
    expect(isListMetaComment("<!-- list:alphanumeric -->")).toBe(true);
    expect(isListMetaComment("<!-- list:steps -->")).toBe(true);
    expect(isListMetaComment("<!-- list:decimal -->")).toBe(true);
    expect(isListMetaComment("<!-- list:standard -->")).toBe(true);
    expect(isListMetaComment("<!--list:steps-->")).toBe(true);
  });

  it("rejects invalid comments", () => {
    expect(isListMetaComment("<!-- list:fancy -->")).toBe(false);
    expect(isListMetaComment("<!-- not a list comment -->")).toBe(false);
    expect(isListMetaComment("just text")).toBe(false);
  });
});

describe("parseListMetaComment", () => {
  it("extracts style name", () => {
    expect(parseListMetaComment("<!-- list:alphanumeric -->")).toBe("alphanumeric");
    expect(parseListMetaComment("<!-- list:steps -->")).toBe("steps");
  });

  it("returns null for non-match", () => {
    expect(parseListMetaComment("not a comment")).toBeNull();
  });
});

// ============================================================
// findListBlockRange
// ============================================================

describe("findListBlockRange", () => {
  it("finds a simple list block", () => {
    const lines = ["1. First", "2. Second", "3. Third"];
    expect(findListBlockRange(lines, 1)).toEqual({ start: 0, end: 2 });
  });

  it("stops at blank lines", () => {
    const lines = ["1. First", "2. Second", "", "Other text"];
    expect(findListBlockRange(lines, 0)).toEqual({ start: 0, end: 1 });
  });

  it("returns null for non-list lines", () => {
    const lines = ["Just text", "More text"];
    expect(findListBlockRange(lines, 0)).toBeNull();
  });

  it("includes metadata comment in range", () => {
    const lines = ["<!-- list:alphanumeric -->", "I. First", "  A. Sub"];
    expect(findListBlockRange(lines, 1)).toEqual({ start: 0, end: 2 });
  });

  it("handles mixed depths", () => {
    const lines = ["1. First", "  a. Sub", "    - Detail", "2. Second"];
    expect(findListBlockRange(lines, 2)).toEqual({ start: 0, end: 3 });
  });
});

// ============================================================
// Full style sequence tests
// ============================================================

describe("alphanumeric style full sequence", () => {
  it("produces correct markers at each depth", () => {
    // Depth 0: I. II. III.
    expect(firstMarkerForDepth("alphanumeric", 0)).toBe("I. ");
    expect(nextMarker("alphanumeric", 0, 2)).toBe("II. ");
    expect(nextMarker("alphanumeric", 0, 3)).toBe("III. ");

    // Depth 1: A. B. C.
    expect(firstMarkerForDepth("alphanumeric", 1)).toBe("A. ");
    expect(nextMarker("alphanumeric", 1, 2)).toBe("B. ");

    // Depth 2: 1. 2. 3.
    expect(firstMarkerForDepth("alphanumeric", 2)).toBe("1. ");

    // Depth 3: a. b. c.
    expect(firstMarkerForDepth("alphanumeric", 3)).toBe("a. ");

    // Depth 4: i. ii. iii.
    expect(firstMarkerForDepth("alphanumeric", 4)).toBe("i. ");
    expect(nextMarker("alphanumeric", 4, 4)).toBe("iv. ");
  });
});

describe("decimal outline full sequence", () => {
  it("produces correct nested markers", () => {
    expect(firstMarkerForDepth("decimal", 0)).toBe("1. ");
    expect(nextMarker("decimal", 0, 2)).toBe("2. ");
    expect(nextMarker("decimal", 1, 1, [1])).toBe("1.1. ");
    expect(nextMarker("decimal", 1, 2, [1])).toBe("1.2. ");
    expect(nextMarker("decimal", 2, 1, [1, 2])).toBe("1.2.1. ");
    expect(nextMarker("decimal", 1, 1, [2])).toBe("2.1. ");
  });
});

describe("steps Tab flow simulation", () => {
  it("simulates Enter → Tab → Enter → Tab through all 3 levels", () => {
    // Start: user typed "1. Step one" with <!-- list: steps --> above
    const docLines = ["<!-- list: steps -->", "1. Step one"];

    // === Enter on "1. Step one" ===
    const line1Info = detectListLine("1. Step one")!;
    expect(line1Info).not.toBeNull();
    expect(line1Info.markerType).toBe("decimal");
    const nextMark1 = incrementMarker(line1Info); // "2. "
    expect(nextMark1).toBe("2. ");
    // New line: "2. "
    docLines.push("2. ");

    // === Tab on "2. " (should become "  a. ") ===
    const line2Info = detectListLine("2. ")!;
    expect(line2Info).not.toBeNull();
    expect(line2Info.markerType).toBe("decimal");
    expect(line2Info.depth).toBe(0);

    // Infer style from block
    const block2 = findListBlockRange(docLines, 2)!;
    expect(block2).toEqual({ start: 0, end: 2 });
    const blockLines2 = docLines.slice(block2.start, block2.end + 1);
    const style2 = inferListStyle(blockLines2, null, "standard");
    expect(style2).toBe("steps");

    const newMarker2 = firstMarkerForDepth("steps", 1); // depth 0+1=1
    expect(newMarker2).toBe("a. ");
    // Line becomes "  a. "
    docLines[2] = "  a. ";

    // === Type "right", then Enter on "  a. right" ===
    docLines[2] = "  a. right";
    const line3Info = detectListLine("  a. right")!;
    expect(line3Info).not.toBeNull();
    expect(line3Info.markerType).toBe("alpha-lower");
    expect(line3Info.depth).toBe(1);
    expect(line3Info.ordinal).toBe(1);
    const nextMark3 = incrementMarker(line3Info); // "b. "
    expect(nextMark3).toBe("b. ");
    // New line: "  b. "
    docLines.push("  b. ");

    // === Tab on "  b. " (should become "    - ") ===
    const line4Info = detectListLine("  b. ")!;
    expect(line4Info).not.toBeNull();
    expect(line4Info.markerType).toBe("alpha-lower");
    expect(line4Info.depth).toBe(1);

    const block4 = findListBlockRange(docLines, 3)!;
    expect(block4).not.toBeNull();
    const blockLines4 = docLines.slice(block4.start, block4.end + 1);
    const style4 = inferListStyle(blockLines4, null, "standard");
    expect(style4).toBe("steps");

    const newMarker4 = firstMarkerForDepth("steps", 2); // depth 1+1=2
    expect(newMarker4).toBe("- ");
    // Line becomes "    - "
    // SUCCESS: third level is a bullet
  });
});

describe("steps style full sequence", () => {
  it("produces correct markers at each depth", () => {
    // Depth 0: 1. 2. 3.
    expect(firstMarkerForDepth("steps", 0)).toBe("1. ");
    expect(nextMarker("steps", 0, 2)).toBe("2. ");

    // Depth 1: a. b. c.
    expect(firstMarkerForDepth("steps", 1)).toBe("a. ");
    expect(nextMarker("steps", 1, 3)).toBe("c. ");

    // Depth 2+: bullet
    expect(firstMarkerForDepth("steps", 2)).toBe("- ");
    expect(firstMarkerForDepth("steps", 3)).toBe("- ");
  });
});

// ============================================================
// Comment override integration tests (FR-5)
// ============================================================

describe("inferListStyle — comment override integration", () => {

  /**
   * FR-5.1a: A preceding `<!-- list: alphanumeric -->` comment overrides
   * what markers alone would infer. Even though "1. 2." looks like standard
   * decimal, the comment forces the return value to "alphanumeric".
   */
  it("FR-5.1a: preceding comment overrides marker inference", () => {
    const lines = ["1. First item", "2. Second item"];
    const precedingLine = "<!-- list: alphanumeric -->";
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("alphanumeric");
  });

  /**
   * FR-5.1b: Comment override takes priority even when markers clearly
   * suggest a different style. Roman-upper markers (I., II.) at depth 0
   * would normally infer "alphanumeric", but the comment says "steps".
   */
  it("FR-5.1b: comment override takes priority over conflicting markers", () => {
    const lines = ["I. First item", "II. Second item"];
    const precedingLine = "<!-- list: steps -->";
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("steps");
  });

  /**
   * FR-5.1c: The comment can also appear as the first line of the block
   * itself (not just as a preceding line). inferListStyle checks lines[0]
   * as a fallback after checking precedingLine.
   */
  it("FR-5.1c: comment on first line of block also works", () => {
    const lines = ["<!-- list: decimal -->", "1. First", "2. Second"];
    expect(inferListStyle(lines, null, "standard")).toBe("decimal");
  });

  /**
   * FR-5.1d: The comment regex allows flexible whitespace around the
   * "list:" keyword and style name. All three variations below must
   * be accepted by the regex:
   *   /<!--\s*list:\s*(standard|alphanumeric|decimal|steps)\s*-->/
   */
  it("FR-5.1d: whitespace variations in comment are accepted", () => {
    // Tight spacing: no spaces anywhere inside the comment
    expect(inferListStyle(
      ["1. A"],
      "<!--list:steps-->",
      "standard",
    )).toBe("steps");

    // Extra spaces: multiple spaces around every token
    expect(inferListStyle(
      ["1. A"],
      "<!--   list:   alphanumeric   -->",
      "standard",
    )).toBe("alphanumeric");

    // Normal spacing: single space after <!-- and before -->
    expect(inferListStyle(
      ["1. A"],
      "<!-- list: decimal -->",
      "standard",
    )).toBe("decimal");
  });

  /**
   * FR-5.1e: When both a preceding line AND the first block line contain
   * comment overrides, the preceding line wins because inferListStyle
   * checks it first. This confirms the priority order in the inference
   * chain (Layer 1a before Layer 1b).
   */
  it("FR-5.1e: preceding comment wins over first-line comment", () => {
    const lines = ["<!-- list: decimal -->", "1. A"];
    const precedingLine = "<!-- list: alphanumeric -->";
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("alphanumeric");
  });

  /**
   * FR-5.1f: A comment with an unrecognised style name (e.g. "fancy")
   * does not match the regex capture group, so the engine falls through
   * to marker-based inference (Layer 2). Roman-upper at depth 0
   * triggers the "alphanumeric" heuristic.
   */
  it("FR-5.1f: invalid style in comment falls through to marker inference", () => {
    const lines = ["I. First", "II. Second"];
    const precedingLine = "<!-- list: fancy -->";
    // "fancy" is not in the regex alternation, so the comment is ignored.
    // Marker inference finds roman-upper at depth 0 -> "alphanumeric".
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("alphanumeric");
  });

  /**
   * FR-5.1g: A regular HTML comment that does not contain the "list:"
   * keyword is not a style override. The engine ignores it entirely
   * and proceeds to marker inference. Plain decimal markers at depth 0
   * are ambiguous, so the fallback style is returned.
   */
  it("FR-5.1g: comment with no list keyword is ignored", () => {
    const lines = ["1. A", "2. B"];
    const precedingLine = "<!-- this is a regular comment -->";
    // Falls through to marker inference -> all decimal at depth 0 -> ambiguous -> fallback
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("standard");
  });
});
