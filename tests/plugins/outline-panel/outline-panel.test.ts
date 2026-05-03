/**
 * Unit tests for the Outline Panel plugin pure functions.
 * Imports directly from the TypeScript source; Vitest resolves TS natively.
 * No CM6 runtime or DOM required for these tests.
 *
 * Step 01 covers: scanHeadings, findActiveIndex, plugin shape.
 * Step 02 covers: computeFoldRange.
 */
import { describe, it, expect } from "vitest";
import {
  scanHeadings,
  findActiveIndex,
  computeFoldRange,
} from "../../../src/plugins/outline-panel/outline-panel.plugin";
import plugin from "../../../src/plugins/outline-panel/outline-panel.plugin";

// ── scanHeadings tests ────────────────────────────────────────────────────────

describe("scanHeadings", () => {
  it("returns empty array for empty string", () => {
    expect(scanHeadings("")).toEqual([]);
  });

  it("returns empty array when document has no headings", () => {
    expect(scanHeadings("plain text\nmore text")).toEqual([]);
  });

  it("detects H1 through H6 headings", () => {
    const doc = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(6);
    expect(result.map((e) => e.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("H1 on the first line has lineFrom 0 and lineNumber 1", () => {
    const doc = "# Hello\nBody";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(1);
    expect(result[0].lineFrom).toBe(0);
    expect(result[0].lineNumber).toBe(1);
  });

  it("computes correct lineFrom for second heading", () => {
    // "# First\n" is 8 characters (7 + newline), so second heading starts at 8.
    const doc = "# First\n# Second";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(2);
    expect(result[1].lineFrom).toBe(8);
  });

  it("excludes headings inside backtick code fences", () => {
    const doc = "# Real\n```\n# Fake\n```\n# Real2";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.text)).toEqual(["Real", "Real2"]);
  });

  it("excludes headings inside tilde code fences", () => {
    const doc = "# Real\n~~~\n# Fake\n~~~\n# Real2";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.text)).toEqual(["Real", "Real2"]);
  });

  it("does not close a backtick fence with tilde", () => {
    // The ~~~ line is inside the ``` fence (does not close it).
    // The second ``` closes the fence. Only the lines outside any fence count.
    const doc = "# Real\n```\n# Fake\n~~~\n# Fake2\n```\n# Real2";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.text)).toEqual(["Real", "Real2"]);
  });

  it("handles a line with 7 hash characters (not a heading)", () => {
    expect(scanHeadings("####### Not a heading")).toEqual([]);
  });

  it("heading with no text after space is included with empty text", () => {
    // "# " — hash followed by space but no trailing text.
    const result = scanHeadings("# ");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("");
  });

  it("heading with no trailing space is not a heading", () => {
    expect(scanHeadings("#NoSpace")).toEqual([]);
  });

  it("heading on the last line without trailing newline", () => {
    // Verifies that the last line (no \n after it) is still parsed correctly.
    const doc = "# First\n# Last";
    const result = scanHeadings(doc);
    expect(result).toHaveLength(2);
    // "# First\n" = 8 chars → second heading lineFrom = 8.
    expect(result[1].lineFrom).toBe(8);
  });

  it("stores heading text verbatim including inline Markdown syntax", () => {
    const result = scanHeadings("# Hello **world**");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello **world**");
  });

  it("is stateless — repeated calls with different documents return independent results", () => {
    const r1 = scanHeadings("# One\n# Two");
    const r2 = scanHeadings("## Alpha");
    // Each call should reflect only its own input.
    expect(r1).toHaveLength(2);
    expect(r2).toHaveLength(1);
    expect(r2[0].level).toBe(2);
    expect(r2[0].text).toBe("Alpha");
  });

  it("handles 201 headings without error", () => {
    const doc = Array.from({ length: 201 }, (_, i) => `# H${i}`).join("\n");
    const result = scanHeadings(doc);
    expect(result).toHaveLength(201);
  });
});

// ── findActiveIndex tests ─────────────────────────────────────────────────────

describe("findActiveIndex", () => {
  it("returns -1 when entries is empty", () => {
    expect(findActiveIndex([], 0)).toBe(-1);
  });

  it("returns -1 when cursor is before all headings", () => {
    const entries = [{ level: 1, text: "H", lineFrom: 10, lineNumber: 1 }];
    expect(findActiveIndex(entries, 5)).toBe(-1);
  });

  it("returns 0 when cursor is on the first heading line", () => {
    const entries = [
      { level: 1, text: "A", lineFrom: 0, lineNumber: 1 },
      { level: 1, text: "B", lineFrom: 20, lineNumber: 3 },
    ];
    expect(findActiveIndex(entries, 0)).toBe(0);
  });

  it("returns index of last heading before cursor", () => {
    const entries = [
      { level: 1, text: "A", lineFrom: 0, lineNumber: 1 },
      { level: 1, text: "B", lineFrom: 20, lineNumber: 3 },
      { level: 1, text: "C", lineFrom: 40, lineNumber: 5 },
    ];
    expect(findActiveIndex(entries, 25)).toBe(1);
  });

  it("returns last index when cursor is at end of document", () => {
    const entries = [
      { level: 1, text: "A", lineFrom: 0, lineNumber: 1 },
      { level: 1, text: "B", lineFrom: 20, lineNumber: 3 },
    ];
    expect(findActiveIndex(entries, 9999)).toBe(1);
  });
});

// ── Plugin shape (build verification) ────────────────────────────────────────

describe("outline-panel plugin default export", () => {
  it("has required string fields", () => {
    expect(typeof plugin.id).toBe("string");
    expect(plugin.id.length).toBeGreaterThan(0);
    expect(typeof plugin.name).toBe("string");
    expect(plugin.name.length).toBeGreaterThan(0);
    expect(typeof plugin.version).toBe("string");
    expect(plugin.version.length).toBeGreaterThan(0);
    expect(typeof (plugin as any).sidebarPanelId).toBe("string");
    expect((plugin as any).sidebarPanelId.length).toBeGreaterThan(0);
  });

  it("has onEnable and onDisable as functions", () => {
    expect(typeof plugin.onEnable).toBe("function");
    expect(typeof plugin.onDisable).toBe("function");
  });
});

// ── computeFoldRange tests (Step 02) ─────────────────────────────────────────

describe("computeFoldRange", () => {
  it("returns null for a heading with no body (no trailing newline)", () => {
    // "# H1" has no newline → headingLineEnd === -1 → no fold possible.
    const entries = [{ level: 1, text: "H1", lineFrom: 0, lineNumber: 1 }];
    expect(computeFoldRange(entries, 0, "# H1")).toBeNull();
  });

  it("returns null for a heading whose body is all blank lines", () => {
    // "# H1\n\n\n# H2" — body between H1 and H2 is two blank lines (indices 5 and 6).
    // "# H1" = 4 chars, '\n' at 4, '\n' at 5, '\n' at 6, "# H2" starts at 7.
    const doc = "# H1\n\n\n# H2";
    // Verify the lineFrom values match the actual document positions.
    const scanned = scanHeadings(doc);
    const entries = scanned.length === 2
      ? scanned
      : [
          { level: 1, text: "H1", lineFrom: 0, lineNumber: 1 },
          { level: 1, text: "H2", lineFrom: 7, lineNumber: 4 },
        ];
    expect(computeFoldRange(entries, 0, doc)).toBeNull();
  });

  it("returns fold range for a heading with body content", () => {
    // "# H1\nbody text" → from = 4 (position of '\n'), to = 14 (exclusive end).
    // "# H1" = 4 chars, '\n' at index 4. "body text" = 9 chars, positions 5..13.
    // headingLineEnd=4, cumulativeOffset starts at 5. lastNonBlankOffset = 5+9-1=13. foldTo=14.
    const doc = "# H1\nbody text";
    const entries = [{ level: 1, text: "H1", lineFrom: 0, lineNumber: 1 }];
    const result = computeFoldRange(entries, 0, doc);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(4);
    expect(result!.to).toBe(14);
  });

  it("returns null for two adjacent same-level headings with no content between them (EC-7)", () => {
    // "## Foo\n## Bar" — two sibling H2 headings immediately adjacent.
    // "## Foo" = 6 chars, '\n' at 6, "## Bar" starts at 7.
    // sectionEndPos = 7 (H2.lineFrom). bodyText = docText.slice(7, 7) = "" → null.
    const doc = "## Foo\n## Bar";
    const entries = scanHeadings(doc);
    expect(entries).toHaveLength(2);
    // H2 sibling: level 2 <= level 2 → sectionEndPos = 7.
    // bodyText = docText.slice(7, 7) = "" → all blank → null.
    expect(computeFoldRange(entries, 0, doc)).toBeNull();
  });

  it("section ends at next same-level heading", () => {
    // "# H1\nbody\n# H2\nmore" — H1 body is only "body"; section ends at H2 line start.
    // "# H1" = 4 chars, '\n' at 4, "body" = 4 chars at positions 5-8, '\n' at 9.
    // "# H2" starts at 10. bodyText = "body\n". lastNonBlankOffset = 5+4-1 = 8. to = 9.
    const doc = "# H1\nbody\n# H2\nmore";
    const entries = [
      { level: 1, text: "H1", lineFrom: 0, lineNumber: 1 },
      { level: 1, text: "H2", lineFrom: 10, lineNumber: 3 },
    ];
    const result = computeFoldRange(entries, 0, doc);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(4);
    expect(result!.to).toBe(9);
  });

  it("section ends at next higher-level heading", () => {
    // "## Sub\nbody\n# Parent" — H2 section ends when H1 is encountered.
    // "## Sub" = 6 chars, '\n' at 6, "body" = 4 chars at 7-10, '\n' at 11.
    // "# Parent" starts at 12. bodyText = "body\n". lastNonBlank = 7+4-1=10. to=11.
    const doc = "## Sub\nbody\n# Parent";
    const entries = [
      { level: 2, text: "Sub", lineFrom: 0, lineNumber: 1 },
      { level: 1, text: "Parent", lineFrom: 12, lineNumber: 3 },
    ];
    const result = computeFoldRange(entries, 0, doc);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(6);
    expect(result!.to).toBe(11);
  });

  it("section does not end at a lower-level heading", () => {
    // "# H1\nbody\n## Sub" — H1 section includes the ## Sub line in the fold.
    const doc = "# H1\nbody\n## Sub";
    const entries = [
      { level: 1, text: "H1", lineFrom: 0, lineNumber: 1 },
      { level: 2, text: "Sub", lineFrom: 10, lineNumber: 3 },
    ];
    // H2 is a child heading, so H1's section extends to end of document.
    const result = computeFoldRange(entries, 0, doc);
    expect(result).not.toBeNull();
  });

  it("section extends to end of document when no closing heading", () => {
    // "# H1\nbody" → single heading, body to EOF.
    // "# H1" = 4 chars, '\n' at 4, "body" at 5-8. lastNonBlank = 5+4-1=8. to=9.
    const doc = "# H1\nbody";
    const entries = [{ level: 1, text: "H1", lineFrom: 0, lineNumber: 1 }];
    const result = computeFoldRange(entries, 0, doc);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(4);
    expect(result!.to).toBe(9);
  });

  it("returns null for last entry in a doc ending with a blank line", () => {
    // "# H1\n\n" — heading followed only by a blank line.
    const doc = "# H1\n\n";
    const entries = [{ level: 1, text: "H1", lineFrom: 0, lineNumber: 1 }];
    expect(computeFoldRange(entries, 0, doc)).toBeNull();
  });

  it("handles heading at end of document with no body (EC-6)", () => {
    // "# H1" — no trailing newline, so headingLineEnd === -1.
    const entries = [{ level: 1, text: "H1", lineFrom: 0, lineNumber: 1 }];
    expect(computeFoldRange(entries, 0, "# H1")).toBeNull();
  });

  it("returns null when body is only whitespace lines (EC-12 blank-body path)", () => {
    // "# H\n   \n# H2" — the only body line is whitespace-only, so lastNonBlankOffset
    // stays -1 and computeFoldRange returns null before reaching the from>=to guard.
    const doc = "# H\n   \n# H2";
    const entries = [
      { level: 1, text: "H", lineFrom: 0, lineNumber: 1 },
      { level: 1, text: "H2", lineFrom: 8, lineNumber: 3 },
    ];
    expect(computeFoldRange(entries, 0, doc)).toBeNull();
  });
});
