/**
 * Unit tests for the Auto TOC plugin's heading scanner.
 *
 * These tests exercise scanHeadings() — the only pure-function surface of the
 * plugin that can be tested without a real CM6 instance or browser DOM. All DOM
 * lifecycle (sidebar creation, layout toggle) and the CM6 updateListener are
 * verified in step_03 by manual visual inspection.
 *
 * Edge cases covered (mapped to requirements spec EC numbers):
 *   EC-1, EC-2  — empty document / no headings
 *   EC-3        — cursor above all headings (findActiveIndex = -1, no active class)
 *   EC-4        — only H1 headings
 *   EC-5        — only H6 headings
 *   EC-6        — empty heading text ("# " with nothing after)
 *   EC-7        — heading text containing inline Markdown syntax stored verbatim
 *   EC-8        — two headings with identical text, different lineFrom
 *   EC-9        — 201 headings without error or truncation
 *   EC-22       — heading on the first line (lineFrom = 0)
 *   EC-23       — heading on the last line (no trailing newline)
 *   EC-25       — headings inside code fences excluded (``` and ~~~)
 *   EC-27/EC-28 — pure function; no shared state between calls
 */

import { describe, it, expect } from "vitest";
import {
  scanHeadings,
  findActiveIndex,
  type HeadingEntry,
} from "../src/plugins/auto-toc/auto-toc.plugin";

// ── Empty and no-heading documents ───────────────────────────────────────────

describe("scanHeadings", () => {
  describe("empty and no-heading documents", () => {
    it("returns empty array for empty string (EC-1)", () => {
      expect(scanHeadings("")).toEqual([]);
    });

    it("returns empty array when document has no headings (EC-2)", () => {
      const doc = "Just some plain text\nAnd another line\n\nA paragraph.";
      expect(scanHeadings(doc)).toEqual([]);
    });
  });

  // ── ATX heading detection ─────────────────────────────────────────────────

  describe("ATX heading detection", () => {
    it("detects H1 through H6 with correct level values", () => {
      const doc = [
        "# H1",
        "## H2",
        "### H3",
        "#### H4",
        "##### H5",
        "###### H6",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result.map((e) => e.level)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(result.map((e) => e.text)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
    });

    it("captures heading text correctly for a basic H2", () => {
      const result = scanHeadings("## Introduction");
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Introduction");
      expect(result[0].level).toBe(2);
    });

    it("includes a heading with empty text — hash + space, nothing after (EC-6)", () => {
      const result = scanHeadings("# ");
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("");
      expect(result[0].level).toBe(1);
    });

    it("stores heading text verbatim including inline Markdown syntax (EC-7)", () => {
      const result = scanHeadings("## **Bold** and [link](url)");
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("**Bold** and [link](url)");
    });

    it("does not treat 7+ hashes as a heading", () => {
      expect(scanHeadings("####### Not a heading")).toEqual([]);
    });

    it("does not treat # with no trailing space as a heading", () => {
      expect(scanHeadings("#NoSpace")).toEqual([]);
    });

    it("does not treat a hash character mid-line as a heading", () => {
      const doc = "This is not # a heading\nNor is this ## a heading either";
      expect(scanHeadings(doc)).toEqual([]);
    });

    it("does not treat a bare #### with no trailing content as a heading (no space)", () => {
      // "####" with no trailing space — not a valid ATX heading per CommonMark.
      expect(scanHeadings("####")).toEqual([]);
    });

    it("handles heading text with trailing # characters verbatim", () => {
      // "# Heading ##" is valid ATX markdown — trailing # kept per FR-6.
      const result = scanHeadings("# Heading ##");
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Heading ##");
    });
  });

  // ── Level and indent ──────────────────────────────────────────────────────

  describe("level and indent", () => {
    it("handles a document with only H1 headings (EC-4)", () => {
      const doc = "# Alpha\n\nSome text.\n\n# Beta\n\n# Gamma";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(3);
      expect(result.every((e) => e.level === 1)).toBe(true);
      expect(result.map((e) => e.text)).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("handles a document with only H6 headings (EC-5)", () => {
      const doc = "###### Deep One\n###### Deep Two";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.level === 6)).toBe(true);
    });

    it("produces correct level values for a mixed-level document", () => {
      const doc = "# Top\n## Sub\n### Sub-sub\n## Back to two\n# Top again";
      const result = scanHeadings(doc);
      expect(result.map((e) => e.level)).toEqual([1, 2, 3, 2, 1]);
    });
  });

  // ── Multiple headings ─────────────────────────────────────────────────────

  describe("multiple headings", () => {
    it("returns separate entries for headings with identical text (EC-8)", () => {
      const doc = "# Same\n\nParagraph\n\n# Same";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Same");
      expect(result[1].text).toBe("Same");
      // Both entries must point to different lines.
      expect(result[0].lineFrom).not.toBe(result[1].lineFrom);
      expect(result[0].lineNumber).toBe(1);
      expect(result[1].lineNumber).toBe(5);
    });

    it("handles 201 headings without error (EC-9)", () => {
      const lines = Array.from({ length: 201 }, (_, i) => `# Heading ${i + 1}`);
      const result = scanHeadings(lines.join("\n"));
      expect(result).toHaveLength(201);
      expect(result[200].text).toBe("Heading 201");
    });

    it("preserves document order for headings", () => {
      const doc = "# First\n## Second\n### Third";
      const result = scanHeadings(doc);
      expect(result.map((e) => e.text)).toEqual(["First", "Second", "Third"]);
    });
  });

  // ── lineFrom accuracy ─────────────────────────────────────────────────────

  describe("lineFrom accuracy", () => {
    it("H1 on the first line has lineFrom 0 and lineNumber 1 (EC-22)", () => {
      const result = scanHeadings("# Hello World");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject<Partial<HeadingEntry>>({
        level: 1,
        text: "Hello World",
        lineFrom: 0,
        lineNumber: 1,
      });
    });

    it("correctly computes lineFrom for a heading on line 3", () => {
      // Line 1: "Line one" (8 chars) + \n = 9 bytes cumulative offset
      // Line 2: "Line two" (8 chars) + \n = 9 bytes  =>  total = 18
      // Line 3: "## Heading" starts at offset 18
      const doc = "Line one\nLine two\n## Heading";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(1);
      expect(result[0].lineFrom).toBe(18);
      expect(result[0].lineNumber).toBe(3);
    });

    it("detects a heading on the last line (no trailing newline) (EC-23)", () => {
      const doc = "Some text\n# Last Line Heading";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Last Line Heading");
      expect(result[0].lineNumber).toBe(2);
      // "Some text\n" = 10 chars; heading starts at offset 10.
      expect(result[0].lineFrom).toBe(10);
    });

    it("lineNumber is 1-based and matches actual line number in document", () => {
      const doc = "plain\nplain\n# Third Line\nplain\n## Fifth Line";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(5);
    });
  });

  // ── Code fence exclusion (EC-25) ──────────────────────────────────────────

  describe("code fence exclusion — EC-25", () => {
    it("excludes headings inside a triple-backtick code fence", () => {
      const doc = [
        "# Before fence",
        "```",
        "# Inside fence — NOT a heading",
        "```",
        "# After fence",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Before fence");
      expect(result[1].text).toBe("After fence");
    });

    it("excludes headings inside a triple-tilde code fence", () => {
      const doc = [
        "# Real heading",
        "~~~",
        "# Fake heading in fence",
        "~~~",
        "## Also real",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Real heading");
      expect(result[1].text).toBe("Also real");
    });

    it("detects headings that appear after a closing fence marker", () => {
      const doc = "```\n# in fence\n```\n# After fence";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("After fence");
    });

    it("correctly handles two consecutive fences with headings between them", () => {
      const doc = [
        "```",
        "# Excluded A",
        "```",
        "# Included B",
        "```",
        "# Excluded C",
        "```",
        "# Included D",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Included B");
      expect(result[1].text).toBe("Included D");
    });

    it("excludes all headings after an unclosed opening fence", () => {
      const doc = [
        "# Before",
        "```",
        "# In unclosed fence",
        "# Still in fence",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Before");
    });

    it("handles a fence with a language specifier (e.g. ```typescript)", () => {
      // "```typescript" starts with "```", so it should toggle the fence flag.
      const doc = [
        "# Before",
        "```typescript",
        "# Not a heading",
        "```",
        "# After",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Before");
      expect(result[1].text).toBe("After");
    });

    it("cross-marker: a backtick fence cannot be closed by a tilde fence", () => {
      // Opening ``` can only be closed by ```, not ~~~.
      const doc = [
        "# Before",
        "```",
        "# Inside backtick fence",
        "~~~",
        "# Still inside (~~~ does not close ``` fence)",
        "```",
        "# After",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Before");
      expect(result[1].text).toBe("After");
    });

    it("cross-marker: a tilde fence cannot be closed by a backtick fence", () => {
      // Opening ~~~ can only be closed by ~~~, not ```.
      const doc = [
        "# Before",
        "~~~",
        "# Inside tilde fence",
        "```",
        "# Still inside (``` does not close ~~~ fence)",
        "~~~",
        "# After",
      ].join("\n");
      const result = scanHeadings(doc);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Before");
      expect(result[1].text).toBe("After");
    });
  });

  // ── lineNumber field ──────────────────────────────────────────────────────

  describe("lineNumber field", () => {
    it("assigns lineNumber 1 to a heading on the first line", () => {
      const result = scanHeadings("# Top");
      expect(result[0].lineNumber).toBe(1);
    });

    it("assigns correct lineNumber when heading is preceded by blank lines", () => {
      const doc = "\n\n# Third Line";
      const result = scanHeadings(doc);
      expect(result).toHaveLength(1);
      expect(result[0].lineNumber).toBe(3);
    });
  });

  // ── Pure function / no shared state (EC-27, EC-28) ───────────────────────

  describe("EC-27 / EC-28 — fresh documents", () => {
    it("is stateless — repeated calls with different documents return independent results", () => {
      const doc1 = "# Heading One";
      const doc2 = "## Heading Two";
      const r1 = scanHeadings(doc1);
      const r2 = scanHeadings(doc2);
      expect(r1).toHaveLength(1);
      expect(r1[0].level).toBe(1);
      expect(r2).toHaveLength(1);
      expect(r2[0].level).toBe(2);
      // Calling r1 again after r2 must produce the same result (no shared state).
      expect(scanHeadings(doc1)).toEqual(r1);
    });

    it("calling scanHeadings on an empty string after a populated call returns []", () => {
      const __ = scanHeadings("# Full document\n## With headings");
      void __;
      expect(scanHeadings("")).toEqual([]);
    });
  });
});

// ── findActiveIndex ───────────────────────────────────────────────────────────

describe("findActiveIndex (EC-3)", () => {
  const entries: HeadingEntry[] = [
    { level: 1, text: "First",  lineFrom: 10, lineNumber: 2 },
    { level: 2, text: "Second", lineFrom: 30, lineNumber: 5 },
    { level: 2, text: "Third",  lineFrom: 50, lineNumber: 8 },
  ];

  it("returns -1 when entries is empty", () => {
    expect(findActiveIndex([], 0)).toBe(-1);
  });

  it("returns -1 when cursor is before all headings (EC-3)", () => {
    // cursor at position 5, first heading at 10
    expect(findActiveIndex(entries, 5)).toBe(-1);
  });

  it("returns -1 when cursor is at position 0 and first heading is not at 0", () => {
    expect(findActiveIndex(entries, 0)).toBe(-1);
  });

  it("returns 0 when cursor is exactly on the first heading's lineFrom", () => {
    expect(findActiveIndex(entries, 10)).toBe(0);
  });

  it("returns 0 when cursor is between first and second heading", () => {
    expect(findActiveIndex(entries, 20)).toBe(0);
  });

  it("returns 1 when cursor is exactly on the second heading's lineFrom", () => {
    expect(findActiveIndex(entries, 30)).toBe(1);
  });

  it("returns 2 when cursor is past the last heading", () => {
    expect(findActiveIndex(entries, 999)).toBe(2);
  });

  it("returns the last index when cursor is exactly on the last heading's lineFrom", () => {
    expect(findActiveIndex(entries, 50)).toBe(2);
  });

  it("returns -1 for a single-heading document when cursor is before it", () => {
    const single: HeadingEntry[] = [{ level: 1, text: "Only", lineFrom: 5, lineNumber: 1 }];
    expect(findActiveIndex(single, 0)).toBe(-1);
    expect(findActiveIndex(single, 4)).toBe(-1);
  });

  it("returns 0 for a single-heading document when cursor is on or after it", () => {
    const single: HeadingEntry[] = [{ level: 1, text: "Only", lineFrom: 5, lineNumber: 1 }];
    expect(findActiveIndex(single, 5)).toBe(0);
    expect(findActiveIndex(single, 100)).toBe(0);
  });
});
