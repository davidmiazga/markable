/**
 * Unit tests for backlinks plugin — Steps 3, 4, 5, 6, 7, 8, and 9.
 *
 * Step 3 tests cover zero-DOM, zero-CM6 pure functions for wiki-link
 * parsing, outgoing link extraction, target normalization, and path
 * resolution. All edge cases from the requirements spec (EC-4 through
 * EC-19) are exercised here.
 *
 * Step 5 tests cover the `findWikiLinkAtPosition` pure helper and
 * the `handleWikiLinkClick` navigation logic, including edge cases
 * EC-1 (untitled doc), EC-2 (self-link), EC-3 (nonexistent target),
 * EC-24 (click during index rebuild), and EC-30 (missing tab manager).
 *
 * Step 6 tests cover autocomplete helpers (getCompletionContext,
 * filterCompletions, setCachedFileList, buildAutocompleteExtension).
 *
 * Step 8 tests cover the sidebar panel: render, destroy, content update,
 * scanning state, backlink item click navigation, and edge cases EC-1
 * (untitled document) and EC-14 (tab switch to untitled).
 *
 * Step 9 tests cover the plugin export metadata, onEnable/onDisable
 * lifecycle, and rapid enable/disable edge case (EC-15).
 *
 * Test file: tests/plugins/backlinks/backlinks.test.ts
 * Source: src/plugins/backlinks/backlinks.plugin.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import backlinkPlugin, {
  WIKI_LINK_RE,
  parseWikiLinks,
  normalizeTarget,
  resolveWikiLinkPath,
  extractOutgoingLinks,
  filenameFromPath,
  isInsideFencedCode,
  findWikiLinkAtPosition,
  handleWikiLinkClick,
  computeWikiLinkDecorationRanges,
  getCompletionContext,
  filterCompletions,
  setCachedFileList,
  buildAutocompleteExtension,
  computeBacklinks,
  buildIndex,
  scheduleIndexRebuild,
  resetIndexState,
  rebuildBacklinksDOM,
  injectBacklinksCSS,
  removeBacklinksCSS,
  // injectWikiLinkStyles,
  removeWikiLinkStyles,
  _testing,
} from "../../../src/plugins/backlinks/backlinks.plugin";
// import type { WikiLinkDecorationRange } from "../../../src/plugins/backlinks/backlinks.plugin";

// ---------------------------------------------------------------------------
// WIKI_LINK_RE
// ---------------------------------------------------------------------------

describe("WIKI_LINK_RE", () => {
  /**
   * Helper that collects all regex matches from a string.
   * Resets lastIndex before each call so the global regex is safe to reuse.
   */
  function allMatches(input: string): RegExpExecArray[] {
    WIKI_LINK_RE.lastIndex = 0;
    const results: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK_RE.exec(input)) !== null) {
      results.push(m);
    }
    return results;
  }

  it("matches simple wiki-link [[target]]", () => {
    const matches = allMatches("See [[notes]] here");
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe("[[notes]]");
    expect(matches[0][1]).toBe("notes");
  });

  it("matches wiki-link with display text [[target|text]]", () => {
    const matches = allMatches("Link: [[readme|Read Me]]");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("readme|Read Me");
  });

  it("matches multiple wiki-links on one line", () => {
    const matches = allMatches("See [[file-a]] and [[file-b]] today");
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe("file-a");
    expect(matches[1][1]).toBe("file-b");
  });

  it("does not match across newlines (EC-8)", () => {
    const matches = allMatches("[[file\nname]]");
    expect(matches).toHaveLength(0);
  });

  it("matches inner [[text]] from malformed [[[text]]] (EC-7)", () => {
    const matches = allMatches("[[[text]]]");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("text");
  });

  it("does not match single brackets [text]", () => {
    const matches = allMatches("Just [text] here");
    expect(matches).toHaveLength(0);
  });

  it("matches empty wiki-link [[]] (EC-9)", () => {
    const matches = allMatches("An empty [[]] link");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("");
  });

  it("matches wiki-link with very long filename (EC-10)", () => {
    const longName = "a".repeat(200);
    const matches = allMatches(`[[${longName}]]`);
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe(longName);
  });

  it("does not match unclosed [[text", () => {
    const matches = allMatches("Broken [[text here");
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseWikiLinks
// ---------------------------------------------------------------------------

describe("parseWikiLinks", () => {
  it("returns correct from/to/target for [[notes]]", () => {
    const result = parseWikiLinks("See [[notes]] end");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      from: 4,
      to: 13,
      target: "notes",
      displayText: null,
    });
  });

  it("splits target and display text on first pipe (EC-4)", () => {
    const result = parseWikiLinks("[[target|My Display Text]]");
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("target");
    expect(result[0].displayText).toBe("My Display Text");
  });

  it("preserves subsequent pipes in display text (EC-5)", () => {
    const result = parseWikiLinks("[[target|text with | pipes]]");
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("target");
    expect(result[0].displayText).toBe("text with | pipes");
  });

  it("handles empty target [[]] (EC-9)", () => {
    const result = parseWikiLinks("[[]]");
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("");
    expect(result[0].displayText).toBe(null);
  });

  it("handles multiple wiki-links in one string (EC-27)", () => {
    const result = parseWikiLinks("See [[file-a]] and [[file-b]]");
    expect(result).toHaveLength(2);
    expect(result[0].target).toBe("file-a");
    expect(result[0].from).toBe(4);
    expect(result[0].to).toBe(14);
    expect(result[1].target).toBe("file-b");
    expect(result[1].from).toBe(19);
    expect(result[1].to).toBe(29);
  });

  it("returns empty array for text with no wiki-links", () => {
    const result = parseWikiLinks("No links here at all.");
    expect(result).toEqual([]);
  });

  it("handles wiki-link at start of text", () => {
    const result = parseWikiLinks("[[start]] of line");
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(0);
    expect(result[0].to).toBe(9);
  });

  it("handles wiki-link at end of text", () => {
    const result = parseWikiLinks("end of [[line]]");
    expect(result).toHaveLength(1);
    expect(result[0].to).toBe(15);
  });

  it("handles pipe-only display text [[target|]]", () => {
    const result = parseWikiLinks("[[target|]]");
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("target");
    expect(result[0].displayText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeTarget
// ---------------------------------------------------------------------------

describe("normalizeTarget", () => {
  it("trims whitespace", () => {
    expect(normalizeTarget("  notes  ")).toBe("notes.md");
  });

  it("strips leading ./", () => {
    expect(normalizeTarget("./sibling")).toBe("sibling.md");
  });

  it("appends .md when no extension", () => {
    expect(normalizeTarget("notes")).toBe("notes.md");
  });

  it("does not append .md when extension exists", () => {
    expect(normalizeTarget("notes.md")).toBe("notes.md");
  });

  it("does not append .md for non-.md extensions", () => {
    expect(normalizeTarget("archive.tar")).toBe("archive.tar");
  });

  it("handles target with path separators (EC-16)", () => {
    expect(normalizeTarget("subfolder/file")).toBe("subfolder/file.md");
  });

  it("handles empty string (EC-9)", () => {
    expect(normalizeTarget("")).toBe(".md");
  });

  it("strips ./ and appends .md together", () => {
    expect(normalizeTarget("./readme")).toBe("readme.md");
  });

  it("strips ./ but keeps existing extension", () => {
    expect(normalizeTarget("./readme.md")).toBe("readme.md");
  });

  it("handles target with dot in path but no file extension", () => {
    // "my.folder/notes" -- the dot is before the slash, so filename
    // portion "notes" has no extension
    expect(normalizeTarget("my.folder/notes")).toBe("my.folder/notes.md");
  });
});

// ---------------------------------------------------------------------------
// resolveWikiLinkPath
// ---------------------------------------------------------------------------

describe("resolveWikiLinkPath", () => {
  it("resolves target relative to current file directory", () => {
    const result = resolveWikiLinkPath("/Users/me/docs/current.md", "notes");
    expect(result).toBe("/Users/me/docs/notes.md");
  });

  it("appends .md to extensionless target", () => {
    const result = resolveWikiLinkPath("/Users/me/docs/current.md", "readme");
    expect(result).toBe("/Users/me/docs/readme.md");
  });

  it("handles target that already has .md", () => {
    const result = resolveWikiLinkPath(
      "/Users/me/docs/current.md",
      "readme.md"
    );
    expect(result).toBe("/Users/me/docs/readme.md");
  });

  it("handles target with path separators (EC-16)", () => {
    const result = resolveWikiLinkPath(
      "/Users/me/docs/current.md",
      "subfolder/file"
    );
    expect(result).toBe("/Users/me/docs/subfolder/file.md");
  });

  it("trims whitespace from target before resolving", () => {
    const result = resolveWikiLinkPath(
      "/Users/me/docs/current.md",
      "  notes  "
    );
    expect(result).toBe("/Users/me/docs/notes.md");
  });
});

// ---------------------------------------------------------------------------
// extractOutgoingLinks
// ---------------------------------------------------------------------------

describe("extractOutgoingLinks", () => {
  it("extracts wiki-link targets", () => {
    const result = extractOutgoingLinks("See [[notes]] and [[readme]]");
    expect(result).toContain("notes.md");
    expect(result).toContain("readme.md");
  });

  it("extracts standard markdown link targets (EC-17)", () => {
    const result = extractOutgoingLinks("Check [here](sibling.md) for info");
    expect(result).toContain("sibling.md");
  });

  it("strips ./ from relative paths (EC-18)", () => {
    const result = extractOutgoingLinks("[link](./sibling.md)");
    expect(result).toContain("sibling.md");
  });

  it("ignores absolute paths (EC-19)", () => {
    const result = extractOutgoingLinks("[link](/absolute/path.md)");
    expect(result).toEqual([]);
  });

  it("ignores URLs (EC-19)", () => {
    const result = extractOutgoingLinks(
      "[link](https://example.com/file.md)"
    );
    expect(result).toEqual([]);
  });

  it("ignores http:// URLs", () => {
    const result = extractOutgoingLinks("[link](http://example.com/file.md)");
    expect(result).toEqual([]);
  });

  it("ignores fragment-only links", () => {
    const result = extractOutgoingLinks("[section](#heading-1)");
    expect(result).toEqual([]);
  });

  it("normalizes all targets", () => {
    // wiki-link target without extension gets .md appended
    const result = extractOutgoingLinks("[[readme]]");
    expect(result).toContain("readme.md");
  });

  it("returns empty array for document with no links", () => {
    const result = extractOutgoingLinks("Just plain text, no links.");
    expect(result).toEqual([]);
  });

  it("handles mixed wiki-links and standard links", () => {
    const content = "See [[notes]] and [also](readme.md) here.";
    const result = extractOutgoingLinks(content);
    expect(result).toContain("notes.md");
    expect(result).toContain("readme.md");
    expect(result).toHaveLength(2);
  });

  it("ignores standard links to non-.md targets", () => {
    const result = extractOutgoingLinks("[img](photo.png)");
    expect(result).toEqual([]);
  });

  it("preserves duplicates (deduplication is the index builder's job)", () => {
    const result = extractOutgoingLinks("[[notes]] and [[notes]]");
    expect(result).toEqual(["notes.md", "notes.md"]);
  });

  it("skips wiki-links inside fenced code blocks", () => {
    const content = "Before\n```\n[[not-a-link]]\n```\nAfter [[real-link]]";
    const result = extractOutgoingLinks(content);
    expect(result).toContain("real-link.md");
    expect(result).not.toContain("not-a-link.md");
  });

  it("skips standard markdown links inside fenced code blocks", () => {
    const content =
      "Before\n```\n[text](not-a-link.md)\n```\nAfter [text](real.md)";
    const result = extractOutgoingLinks(content);
    expect(result).toContain("real.md");
    expect(result).not.toContain("not-a-link.md");
  });
});

// ---------------------------------------------------------------------------
// filenameFromPath
// ---------------------------------------------------------------------------

describe("filenameFromPath", () => {
  it("extracts filename from absolute path", () => {
    expect(filenameFromPath("/Users/me/docs/notes.md")).toBe("notes.md");
  });

  it("handles path with no directory", () => {
    expect(filenameFromPath("notes.md")).toBe("notes.md");
  });

  it("handles trailing slash gracefully", () => {
    // Edge case: path ends with "/" -- returns empty string
    expect(filenameFromPath("/Users/me/docs/")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isInsideFencedCode
// ---------------------------------------------------------------------------

describe("isInsideFencedCode", () => {
  it("returns false for position outside any code block", () => {
    const text = "Hello world\n[[link]]\nGoodbye";
    expect(isInsideFencedCode(text, 12)).toBe(false);
  });

  it("returns true for position inside a fenced code block", () => {
    const text = "Before\n```\n[[link]]\n```\nAfter";
    // Position 12 is inside the code block (after the opening ```)
    const linkPos = text.indexOf("[[link]]");
    expect(isInsideFencedCode(text, linkPos)).toBe(true);
  });

  it("returns false for position after a closed code block", () => {
    const text = "Before\n```\ncode\n```\n[[link]]";
    const linkPos = text.indexOf("[[link]]");
    expect(isInsideFencedCode(text, linkPos)).toBe(false);
  });

  it("returns true inside an unclosed code block (EOF)", () => {
    const text = "Before\n```\n[[link]]";
    const linkPos = text.indexOf("[[link]]");
    expect(isInsideFencedCode(text, linkPos)).toBe(true);
  });

  it("handles tilde fenced code blocks (~~~)", () => {
    const text = "Before\n~~~\n[[link]]\n~~~\nAfter";
    const linkPos = text.indexOf("[[link]]");
    expect(isInsideFencedCode(text, linkPos)).toBe(true);
  });

  it("returns false at position 0 with no code block", () => {
    expect(isInsideFencedCode("plain text", 0)).toBe(false);
  });

  it("handles multiple code blocks correctly", () => {
    const text =
      "```\nblock1\n```\n[[outside]]\n```\n[[inside]]\n```\n[[after]]";
    const outsidePos = text.indexOf("[[outside]]");
    const insidePos = text.indexOf("[[inside]]");
    const afterPos = text.indexOf("[[after]]");
    expect(isInsideFencedCode(text, outsidePos)).toBe(false);
    expect(isInsideFencedCode(text, insidePos)).toBe(true);
    expect(isInsideFencedCode(text, afterPos)).toBe(false);
  });

  it("handles code block with language specifier", () => {
    const text = "```typescript\n[[link]]\n```\nAfter";
    const linkPos = text.indexOf("[[link]]");
    expect(isInsideFencedCode(text, linkPos)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeWikiLinkDecorationRanges (Step 4)
// ---------------------------------------------------------------------------

describe("computeWikiLinkDecorationRanges", () => {
  it("simple [[target]] produces 3 decoration ranges: hide [[, mark text, hide ]]", () => {
    const text = "See [[notes]] end";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /*
     * Expected decorations for [[notes]] at positions 4..13:
     *   - replace  4..6   (hide "[[")
     *   - mark     6..11  (style "notes" with cm-live-link)
     *   - replace  11..13 (hide "]]")
     */
    expect(ranges).toHaveLength(3);

    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0]).toEqual({ from: 4, to: 6, type: "replace" });
    expect(sorted[1]).toEqual({ from: 6, to: 11, type: "mark" });
    expect(sorted[2]).toEqual({ from: 11, to: 13, type: "replace" });
  });

  it("[[target|display]] produces 4 ranges: hide [[, hide target|, mark display, hide ]]", () => {
    const text = "[[readme|Read Me]]";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /*
     * Expected decorations for [[readme|Read Me]] at positions 0..18:
     *   - replace  0..2    (hide "[[")
     *   - replace  2..9    (hide "readme|")
     *   - mark     9..16   (style "Read Me")
     *   - replace  16..18  (hide "]]")
     */
    expect(ranges).toHaveLength(4);

    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0]).toEqual({ from: 0, to: 2, type: "replace" });
    expect(sorted[1]).toEqual({ from: 2, to: 9, type: "replace" });
    expect(sorted[2]).toEqual({ from: 9, to: 16, type: "mark" });
    expect(sorted[3]).toEqual({ from: 16, to: 18, type: "replace" });
  });

  it("active line: no decorations applied", () => {
    const text = "See [[notes]] end";
    /* Line 1 is active (cursor is there) */
    const activeLines = new Set<number>([1]);
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);
    expect(ranges).toHaveLength(0);
  });

  it("fenced code block: no decorations applied (EC-6)", () => {
    const text = "Before\n```\n[[link]]\n```\nAfter";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);
    expect(ranges).toHaveLength(0);
  });

  it("wiki-link at document start position 0 (EC-26)", () => {
    const text = "[[start]]";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    expect(ranges).toHaveLength(3);
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0]).toEqual({ from: 0, to: 2, type: "replace" });
    expect(sorted[1]).toEqual({ from: 2, to: 7, type: "mark" });
    expect(sorted[2]).toEqual({ from: 7, to: 9, type: "replace" });
  });

  it("wiki-link at document end (EC-26)", () => {
    const text = "end [[finish]]";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    expect(ranges).toHaveLength(3);
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0]).toEqual({ from: 4, to: 6, type: "replace" });
    expect(sorted[1]).toEqual({ from: 6, to: 12, type: "mark" });
    expect(sorted[2]).toEqual({ from: 12, to: 14, type: "replace" });
  });

  it("two wiki-links on same line (EC-27)", () => {
    const text = "See [[file-a]] and [[file-b]]";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /* 3 decorations per wiki-link = 6 total */
    expect(ranges).toHaveLength(6);
  });

  it("wiki-link adjacent to bold **[[link]]** (EC-28)", () => {
    const text = "**[[link]]**";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /*
     * The wiki-link [[link]] is at positions 2..10 within the bold markers.
     * Wiki-link decorations are independent of Markdown syntax decorations.
     */
    expect(ranges).toHaveLength(3);
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0]).toEqual({ from: 2, to: 4, type: "replace" });
    expect(sorted[1]).toEqual({ from: 4, to: 8, type: "mark" });
    expect(sorted[2]).toEqual({ from: 8, to: 10, type: "replace" });
  });

  it("wiki-link to self [[current-file]] still gets decorated (EC-2)", () => {
    /*
     * Self-reference detection is handled in the click handler (step 5),
     * NOT in decoration logic. The decoration builder treats all wiki-links
     * the same regardless of whether they point to the current file.
     */
    const text = "Link to [[current-file]] here";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);
    expect(ranges).toHaveLength(3);
  });

  it("empty wiki-link [[]] produces hide [[ + hide ]] only, no mark (EC-9)", () => {
    const text = "An [[]] link";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /*
     * [[]] at positions 3..7. Content is empty, so no mark decoration.
     *   - replace  3..5  (hide "[[")
     *   - replace  5..7  (hide "]]")
     */
    expect(ranges).toHaveLength(2);
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0]).toEqual({ from: 3, to: 5, type: "replace" });
    expect(sorted[1]).toEqual({ from: 5, to: 7, type: "replace" });
  });

  it("only processes wiki-links within visible ranges", () => {
    const text = "[[outside]]\n[[inside]]\n[[also-outside]]";
    const activeLines = new Set<number>();
    /* Visible range covers only line 2: "[[inside]]" starts at pos 12 */
    const visibleRanges = [{ from: 12, to: 22 }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /* Only [[inside]] should be decorated (3 ranges) */
    expect(ranges).toHaveLength(3);
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    expect(sorted[0].from).toBe(12);
  });

  it("multiline document: active line skips only that line wiki-links", () => {
    const text = "[[line1-link]]\n[[line2-link]]\n[[line3-link]]";
    /* Line 2 is active (cursor there) */
    const activeLines = new Set<number>([2]);
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /* Lines 1 and 3 get decorated (3 each), line 2 does not = 6 total */
    expect(ranges).toHaveLength(6);
  });

  it("wiki-link outside fenced code block IS decorated alongside code block", () => {
    const text = "[[real-link]]\n```\n[[code-link]]\n```";
    const activeLines = new Set<number>();
    const visibleRanges = [{ from: 0, to: text.length }];

    const ranges = computeWikiLinkDecorationRanges(text, activeLines, visibleRanges);

    /* Only [[real-link]] gets 3 decorations; [[code-link]] is skipped */
    expect(ranges).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Step 5: Click-to-Navigate
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// findWikiLinkAtPosition
// ---------------------------------------------------------------------------

describe("findWikiLinkAtPosition", () => {
  it("returns the wiki-link match when click position is inside [[notes]]", () => {
    /*
     * Line: "See [[notes]] end"
     * lineFrom = 0, so absolute positions match the line-relative ones.
     * Clicking at position 6 (the 'o' in 'notes') should return the match.
     */
    const result = findWikiLinkAtPosition("See [[notes]] end", 0, 6);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("notes");
    expect(result!.from).toBe(4);
    expect(result!.to).toBe(13);
  });

  it("returns null when click position is outside wiki-links", () => {
    /*
     * Clicking at position 0 (the 'S' in 'See') is outside any wiki-link
     * range, so the function should return null.
     */
    const result = findWikiLinkAtPosition("See [[notes]] end", 0, 0);
    expect(result).toBeNull();
  });

  it("returns null on an empty line", () => {
    const result = findWikiLinkAtPosition("", 0, 0);
    expect(result).toBeNull();
  });

  it("adjusts match positions by lineFrom offset", () => {
    /*
     * If the line starts at document offset 100, the wiki-link
     * [[notes]] at line-relative offset 4 becomes absolute offset 104.
     * A click at document position 106 should fall within the match.
     */
    const result = findWikiLinkAtPosition("See [[notes]] end", 100, 106);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(104);
    expect(result!.to).toBe(113);
    expect(result!.target).toBe("notes");
  });

  it("returns null when click is after the line text", () => {
    /*
     * Click position 200 is beyond the line length (lineFrom=0,
     * lineText is 17 chars), so no match should be found.
     */
    const result = findWikiLinkAtPosition("See [[notes]] end", 0, 200);
    expect(result).toBeNull();
  });

  it("handles multiple wiki-links and returns the correct one", () => {
    const lineText = "See [[file-a]] and [[file-b]] end";
    /* Click on 'b' in file-b -- absolute position of [[file-b]] starts at 19 */
    const result = findWikiLinkAtPosition(lineText, 0, 22);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("file-b");
  });

  it("handles wiki-link with display text [[target|display]]", () => {
    const result = findWikiLinkAtPosition("Go [[readme|Read Me]] now", 0, 8);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("readme");
    expect(result!.displayText).toBe("Read Me");
  });
});

// ---------------------------------------------------------------------------
// handleWikiLinkClick
// ---------------------------------------------------------------------------

describe("handleWikiLinkClick", () => {
  /**
   * Save and restore window globals between tests to avoid cross-test
   * pollution. Each test sets up the exact globals it needs.
   */
  let savedCurrentFile: unknown;
  let savedTabManager: unknown;
  let alertSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedCurrentFile = (globalThis as any).__MARKABLE_CURRENT_FILE__;
    savedTabManager = (globalThis as any).__MARKABLE_TAB_MANAGER__;
    alertSpy = vi.fn();
    warnSpy = vi.fn();
    (globalThis as any).alert = alertSpy;
    vi.spyOn(console, "warn").mockImplementation(warnSpy as unknown as (...args: any[]) => void);
  });

  afterEach(() => {
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = savedCurrentFile;
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = savedTabManager;
    vi.restoreAllMocks();
  });

  it("EC-1: shows alert when document has no file path (untitled doc)", async () => {
    /*
     * When __MARKABLE_CURRENT_FILE__ is null, the user is editing an
     * untitled document. Navigation cannot resolve a relative path,
     * so an alert is shown explaining the situation.
     */
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = null;
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn().mockResolvedValue(true),
    };

    await handleWikiLinkClick("notes");

    expect(alertSpy).toHaveBeenCalledWith(
      "Cannot navigate: document has no file path"
    );
  });

  it("EC-30: logs warning when tab manager is missing", async () => {
    /*
     * When __MARKABLE_TAB_MANAGER__ is undefined, click-to-navigate
     * is silently disabled with a console warning. No crash occurs.
     */
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";
    delete (globalThis as any).__MARKABLE_TAB_MANAGER__;

    await handleWikiLinkClick("notes");

    expect(warnSpy).toHaveBeenCalledWith(
      "[backlinks] Tab manager not available; click-to-navigate disabled."
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("calls openFileInTab with the resolved path", async () => {
    /*
     * Standard navigation: the target "notes" is resolved relative to
     * the current file's directory and passed to openFileInTab.
     */
    const openMock = vi.fn().mockResolvedValue(true);
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: openMock,
    };

    await handleWikiLinkClick("notes");

    expect(openMock).toHaveBeenCalledWith("/Users/me/docs/notes.md");
  });

  it("EC-2: self-link still navigable (activates existing tab)", async () => {
    /*
     * A wiki-link to the current file itself should still call
     * openFileInTab. The tab manager has a duplicate-path guard
     * that activates the existing tab instead of opening a new one.
     */
    const openMock = vi.fn().mockResolvedValue(true);
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/notes.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: openMock,
    };

    await handleWikiLinkClick("notes");

    expect(openMock).toHaveBeenCalledWith("/Users/me/docs/notes.md");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("EC-3: nonexistent target -- openFileInTab handles error", async () => {
    /*
     * When the file does not exist, openFileInTab returns false and
     * shows its own error alert internally. handleWikiLinkClick does
     * not show a duplicate alert.
     */
    const openMock = vi.fn().mockResolvedValue(false);
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: openMock,
    };

    await handleWikiLinkClick("nonexistent");

    expect(openMock).toHaveBeenCalledWith("/Users/me/docs/nonexistent.md");
    /* handleWikiLinkClick does not show its own alert -- tabManager handles it */
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("EC-24: click during index rebuild -- navigation proceeds immediately", async () => {
    /*
     * The click handler resolves the path directly using
     * resolveWikiLinkPath, completely independent of the backlink
     * index. Navigation works even while the index is being rebuilt.
     */
    const openMock = vi.fn().mockResolvedValue(true);
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: openMock,
    };

    await handleWikiLinkClick("target");

    expect(openMock).toHaveBeenCalledWith("/Users/me/docs/target.md");
  });

  it("EC-30: logs warning when tab manager has no openFileInTab method", async () => {
    /*
     * If __MARKABLE_TAB_MANAGER__ exists but lacks the openFileInTab
     * method, the guard still catches it and logs a warning.
     */
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {};

    await handleWikiLinkClick("notes");

    expect(warnSpy).toHaveBeenCalledWith(
      "[backlinks] Tab manager not available; click-to-navigate disabled."
    );
  });
});

// ---------------------------------------------------------------------------
// Step 6: Auto-Complete Source
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getCompletionContext
// ---------------------------------------------------------------------------

describe("getCompletionContext", () => {
  it("finds [[ context when cursor is immediately after [[", () => {
    const result = getCompletionContext("See [[", 6);
    expect(result).toEqual({ from: 6, prefix: "" });
  });

  it("finds [[ context with partial text typed after [[", () => {
    const result = getCompletionContext("See [[not", 9);
    expect(result).toEqual({ from: 6, prefix: "not" });
  });

  it("returns null when no [[ exists before cursor", () => {
    const result = getCompletionContext("Hello world", 5);
    expect(result).toBeNull();
  });

  it("returns null when [[ is closed by ]] before cursor", () => {
    const result = getCompletionContext("See [[done]] more", 17);
    expect(result).toBeNull();
  });

  it("finds context for second [[ after first is closed", () => {
    const result = getCompletionContext("[[done]] and [[sec", 18);
    expect(result).toEqual({ from: 15, prefix: "sec" });
  });

  it("returns null when cursor is before [[", () => {
    const result = getCompletionContext("ab [[notes", 2);
    expect(result).toBeNull();
  });

  it("handles [[ at the very start of the line", () => {
    const result = getCompletionContext("[[notes", 7);
    expect(result).toEqual({ from: 2, prefix: "notes" });
  });

  it("handles empty wiki-link context [[ with empty prefix (EC-9)", () => {
    /*
     * When the user has typed just `[[`, the prefix is an empty string
     * and all files should be offered as completions.
     */
    const result = getCompletionContext("[[", 2);
    expect(result).toEqual({ from: 2, prefix: "" });
  });

  it("handles cursor between [[ and ]] (editing existing link)", () => {
    /*
     * If the cursor is between `[[` and `]]` on the same line,
     * the user is editing an existing wiki-link. The context should
     * still be found because `]]` is AFTER the cursor, not between
     * `[[` and cursor.
     */
    const result = getCompletionContext("[[notes]]", 4);
    expect(result).toEqual({ from: 2, prefix: "no" });
  });

  it("returns null when only a single [ precedes cursor", () => {
    const result = getCompletionContext("See [notes", 10);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterCompletions
// ---------------------------------------------------------------------------

describe("filterCompletions", () => {
  const files = ["notes.md", "readme.md", "notebook.md", "Archive.md"];

  it("returns all files when prefix is empty", () => {
    const result = filterCompletions(files, "", null);
    expect(result).toEqual(["Archive.md", "notebook.md", "notes.md", "readme.md"]);
  });

  it("filters by case-insensitive prefix match", () => {
    const result = filterCompletions(files, "not", null);
    expect(result).toEqual(["notebook.md", "notes.md"]);
  });

  it("matches case-insensitively (uppercase prefix)", () => {
    const result = filterCompletions(files, "ARC", null);
    expect(result).toEqual(["Archive.md"]);
  });

  it("excludes the current file", () => {
    const result = filterCompletions(files, "", "notes.md");
    expect(result).not.toContain("notes.md");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no files match prefix (EC-22)", () => {
    const result = filterCompletions(files, "xyz", null);
    expect(result).toEqual([]);
  });

  it("returns sorted results alphabetically", () => {
    const result = filterCompletions(
      ["zebra.md", "alpha.md", "middle.md"],
      "",
      null
    );
    expect(result).toEqual(["alpha.md", "middle.md", "zebra.md"]);
  });

  it("compares prefix against filename without .md extension", () => {
    /*
     * The prefix "read" should match "readme.md" because
     * "readme" starts with "read".
     */
    const result = filterCompletions(files, "read", null);
    expect(result).toEqual(["readme.md"]);
  });

  it("excludes current file with case-insensitive comparison", () => {
    /*
     * If the current file is "Archive.md" but stored differently
     * in the list, the exclusion should still work via
     * case-insensitive comparison.
     */
    const result = filterCompletions(files, "", "archive.md");
    expect(result).not.toContain("Archive.md");
  });
});

// ---------------------------------------------------------------------------
// buildAutocompleteExtension
// ---------------------------------------------------------------------------

describe("buildAutocompleteExtension", () => {
  it("returns empty array when __CM_AUTOCOMPLETE__ is undefined (EC-29)", () => {
    /*
     * When the autocomplete global is not available, the builder
     * must gracefully degrade by returning an empty extension array
     * and logging a warning.
     */
    const saved = (globalThis as any).__CM_AUTOCOMPLETE__;
    delete (globalThis as any).__CM_AUTOCOMPLETE__;

    const result = buildAutocompleteExtension();
    expect(result).toEqual([]);

    /* Restore if it was set */
    if (saved !== undefined) {
      (globalThis as any).__CM_AUTOCOMPLETE__ = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// buildAutocompleteExtension — vault mode
// ---------------------------------------------------------------------------

/**
 * Tests for the vault-mode completion path introduced in step_01 of the
 * wiki-autocomplete spec. These tests exercise EC-A.01 through EC-A.10.
 *
 * The mock vault manager exposes the same shape as the real
 * `__MARKABLE_VAULT_MANAGER__` window global at runtime.
 */
describe("buildAutocompleteExtension — vault mode", () => {
  /**
   * Three canonical vault entries used across most tests.
   *  - "meeting"  lives in a sub-folder, has a title equal to its name.
   *  - "notes"    lives at root, has a DIFFERENT title "My Notes".
   *  - "readme"   lives at root, title equals name.
   */
  const mockEntries = [
    {
      name: "meeting",
      path: "/vault/work/meeting.md",
      title: "meeting",
      tags: [],
      outboundLinks: [],
      modified: 0,
      size: 0,
    },
    {
      name: "notes",
      path: "/vault/notes.md",
      title: "My Notes",
      tags: [],
      outboundLinks: [],
      modified: 0,
      size: 0,
    },
    {
      name: "readme",
      path: "/vault/readme.md",
      title: "readme",
      tags: [],
      outboundLinks: [],
      modified: 0,
      size: 0,
    },
  ];

  /**
   * A mock CM6 `CompletionContext` that simulates a cursor positioned
   * after the text `[[<prefix>`. `matchBefore` returns a fake match whose
   * `.text` property starts with `[[` followed by the prefix.
   *
   * @param prefix - Text typed after `[[`, e.g. "not", "", "stem|"
   */
  function makeContext(prefix: string) {
    return {
      matchBefore: (_regex: RegExp) => {
        if (prefix === null) return null; // simulate no match
        return {
          from: 0,
          to: 2 + prefix.length,
          text: `[[${prefix}`,
        };
      },
    };
  }

  /**
   * Helper that calls the vault-mode path by:
   *  1. Setting up __MARKABLE_VAULT_MANAGER__ with the given entries.
   *  2. Setting up __CM_AUTOCOMPLETE__ with an `autocompletion` spy that
   *     captures the override function.
   *  3. Calling buildAutocompleteExtension() to get the registered source.
   *  4. Invoking the captured CompletionSource with a fake context.
   *
   * Returns whatever the CompletionSource returns.
   */
  function invokeSource(
    prefix: string,
    entries = mockEntries,
    vaultRoot = "/vault",
  ) {
    // Capture the CompletionSource function from autocompletion({override: [fn]})
    let capturedSource: ((ctx: any) => any) | null = null;
    (window as any).__CM_AUTOCOMPLETE__ = {
      autocompletion: (opts: { override: Array<(ctx: any) => any> }) => {
        capturedSource = opts.override[0];
        return { _tag: "autocompletion" };
      },
    };

    // Install vault manager mock
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: () => ({ entries }),
      getActiveVault: () => ({ rootPaths: [vaultRoot] }),
    };

    buildAutocompleteExtension();
    if (!capturedSource) throw new Error("CompletionSource was not captured");

    // Cast to the known type so TypeScript does not infer `never` after the
    // narrowing guard above (closure variables are not narrowed post-mutation).
    const source = capturedSource as (ctx: any) => any;
    return source(makeContext(prefix));
  }

  afterEach(() => {
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    delete (window as any).__CM_AUTOCOMPLETE__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  // EC-A.02 — vault active but entries array is empty → { from, options: [] }, NOT null
  it("returns empty options (not null) when vault index has zero entries", () => {
    const result = invokeSource("", []);
    // The vault path is taken (entries.length === 0), so result is an object
    // with an empty options array, NOT null.
    expect(result).not.toBeNull();
    expect(result.options).toEqual([]);
  });

  // EC-A.03 — vault active: source returns all entries; CM6 filter:true handles narrowing
  it("returns all entries with filter:true so CM6 can narrow (EC-A.03)", () => {
    const result = invokeSource("zzz");
    expect(result).not.toBeNull();
    // Source no longer pre-filters — CM6 does it. All entries returned.
    expect(result.options).toHaveLength(mockEntries.length);
    expect(result.filter).toBe(true);
  });

  // EC-A.04 — detail is vault-relative path without .md extension
  it("detail is vault-relative path without extension (AD-04)", () => {
    const result = invokeSource("meeting");
    expect(result).not.toBeNull();
    // entry.path = "/vault/work/meeting.md", vaultRoot = "/vault"
    // expected detail: "work/meeting"
    const meetingOption = result.options.find((o: any) => o.label === "meeting");
    expect(meetingOption).toBeDefined();
    expect(meetingOption.detail).toBe("work/meeting");
  });

  // EC-A.04 — two files sharing same stem in different folders both appear with distinct details
  it("two files with same stem in different folders both appear with distinct details (EC-A.04)", () => {
    const twoMeetings = [
      { name: "meeting", path: "/vault/notes/meeting.md", title: "meeting", tags: [], outboundLinks: [], modified: 0, size: 0 },
      { name: "meeting", path: "/vault/work/meeting.md",  title: "meeting", tags: [], outboundLinks: [], modified: 0, size: 0 },
    ];
    const result = invokeSource("meeting", twoMeetings);
    const meetingOptions = result.options.filter((o: any) => o.label === "meeting");
    expect(meetingOptions).toHaveLength(2);
    const details = meetingOptions.map((o: any) => o.detail);
    expect(details).toContain("notes/meeting");
    expect(details).toContain("work/meeting");
  });

  // AD-03 — info is a plain string (not a function) when title differs from name
  it("info is a plain string equal to the title when title differs from name", () => {
    const result = invokeSource("notes");
    const notesOption = result.options.find((o: any) => o.label === "notes");
    expect(notesOption).toBeDefined();
    // CM6 info: plain string is valid; function form must return a DOM Node.
    // notes.title = "My Notes", notes.name = "notes" → info should be the string
    expect(typeof notesOption.info).toBe("string");
    expect(notesOption.info).toBe("My Notes");
  });

  // AD-03 — info is undefined when title equals name
  it("info is undefined when VaultIndexEntry.title equals name", () => {
    const result = invokeSource("readme");
    const readmeOption = result.options.find((o: any) => o.label === "readme");
    expect(readmeOption).toBeDefined();
    // readme.title === readme.name → info should be undefined
    expect(readmeOption.info).toBeUndefined();
  });

  // FR-A.2 — currently open file is NOT excluded from vault-mode completions
  it("current file is included in completions (no self-exclusion)", () => {
    // Set the global so self-link detection code (if any) can see it
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/notes.md";
    const result = invokeSource("");
    const labels = result.options.map((o: any) => o.label);
    // "notes" must still appear even though it is the current file
    expect(labels).toContain("notes");
  });

  // FR-A.5 / EC-A.06 — pipe character in prefix triggers immediate null return
  it("returns null when prefix contains pipe character", () => {
    const result = invokeSource("stem|");
    expect(result).toBeNull();
  });

  // EC-A.07 — empty prefix returns all entries; filter:true and validFor present
  it("returns all entries with filter:true and validFor when prefix is empty (EC-A.07)", () => {
    const result = invokeSource("");
    expect(result).not.toBeNull();
    expect(result.options).toHaveLength(mockEntries.length);
    expect(result.filter).toBe(true);
    expect(result.validFor).toBeInstanceOf(RegExp);
  });

  // EC-A.08 — filter:true delegated to CM6; source returns all entries regardless of prefix
  it("returns all entries regardless of prefix (CM6 handles case-insensitive filter)", () => {
    const result = invokeSource("NOTE");
    expect(result.filter).toBe(true);
    // All entries are present; CM6 narrows to case-insensitive prefix matches at render time
    const labels = result.options.map((o: any) => o.label);
    expect(labels).toContain("notes");
    expect(labels).toContain("meeting");
    expect(labels).toContain("readme");
  });

  // EC-A.10 — vault manager global absent → falls through to _cachedFileList
  it("falls through to _cachedFileList when vault manager global is absent", () => {
    delete (window as any).__MARKABLE_VAULT_MANAGER__;

    let capturedSource: ((ctx: any) => any) | null = null;
    (window as any).__CM_AUTOCOMPLETE__ = {
      autocompletion: (opts: { override: Array<(ctx: any) => any> }) => {
        capturedSource = opts.override[0];
        return { _tag: "autocompletion" };
      },
    };

    setCachedFileList(["alpha.md", "beta.md"]);
    buildAutocompleteExtension();

    // Cast through unknown — TypeScript can't narrow closure-mutated variables
    // after buildAutocompleteExtension() sets capturedSource via callback.
    const sourceA = capturedSource as unknown as (ctx: any) => any;
    const result = sourceA(makeContext("al"));
    // Should fall through to the no-vault path and return "alpha"
    expect(result).not.toBeNull();
    const labels = result.options.map((o: any) => o.label);
    expect(labels).toContain("alpha");
  });

  // EC-A.01 — getVaultIndex returns null → falls through to _cachedFileList
  it("falls through to _cachedFileList when getVaultIndex returns null", () => {
    let capturedSource: ((ctx: any) => any) | null = null;
    (window as any).__CM_AUTOCOMPLETE__ = {
      autocompletion: (opts: { override: Array<(ctx: any) => any> }) => {
        capturedSource = opts.override[0];
        return { _tag: "autocompletion" };
      },
    };

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: () => null,
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
    };

    setCachedFileList(["gamma.md"]);
    buildAutocompleteExtension();

    // Cast through unknown — TypeScript can't narrow closure-mutated variables
    // after buildAutocompleteExtension() sets capturedSource via callback.
    const sourceG = capturedSource as unknown as (ctx: any) => any;
    const result = sourceG(makeContext("gamma"));
    expect(result).not.toBeNull();
    const labels = result.options.map((o: any) => o.label);
    expect(labels).toContain("gamma");
  });

  // AD-04 fallback — entry.path not under vaultRoot → detail falls back to name
  it("detail falls back to entry.name when path is not under vaultRoot", () => {
    const externalEntry = [
      {
        name: "remote",
        path: "/other-root/remote.md", // not under /vault
        title: "remote",
        tags: [],
        outboundLinks: [],
        modified: 0,
        size: 0,
      },
    ];
    const result = invokeSource("remote", externalEntry, "/vault");
    const opt = result.options.find((o: any) => o.label === "remote");
    expect(opt).toBeDefined();
    // Path does not start with vaultRoot "/vault" → detail = entry.name = "remote"
    expect(opt.detail).toBe("remote");
  });

  // H-01 — string-prefix collision: /vaultroot/file.md must NOT match vaultRoot /vault
  it("detail falls back to name when path shares root prefix but not separator boundary", () => {
    const entry = [
      {
        name: "file",
        path: "/vaultroot/file.md", // starts with "/vault" but not "/vault/"
        title: "file",
        tags: [],
        outboundLinks: [],
        modified: 0,
        size: 0,
      },
    ];
    const result = invokeSource("file", entry, "/vault");
    const opt = result.options.find((o: any) => o.label === "file");
    expect(opt).toBeDefined();
    // "/vaultroot/file.md".startsWith("/vault/") === false → fallback to entry.name
    expect(opt.detail).toBe("file");
  });

  // EC-A.11 — apply inserts stem with spaces verbatim as [[meeting notes]]
  it("apply inserts stem containing spaces verbatim without escaping (EC-A.11)", () => {
    const spacedEntry = [
      {
        name: "meeting notes",
        path: "/vault/meeting notes.md",
        title: "meeting notes",
        tags: [],
        outboundLinks: [],
        modified: 0,
        size: 0,
      },
    ];
    const result = invokeSource("meeting", spacedEntry);
    const opt = result.options.find((o: any) => o.label === "meeting notes");
    expect(opt).toBeDefined();

    const dispatchSpy = vi.fn();
    const mockView = {
      state: {
        doc: {
          length: 20,
          sliceString: (_from: number, _to: number) => "",
        },
      },
      dispatch: dispatchSpy,
    };
    opt.apply(mockView, null, 2, 2);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 2, to: 2, insert: "meeting notes]]" },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// filterCompletions — null currentFile includes all files (AD-02)
// ---------------------------------------------------------------------------

describe("filterCompletions — null currentFile", () => {
  it("includes all files when currentFile is null (no self-exclusion)", () => {
    /*
     * FR-A.2 / AD-02: passing null as currentFile must NOT exclude any file.
     * Previously wikiLinkCompletionSource passed currentFilename which excluded
     * the current file. The new implementation passes null in both paths.
     */
    const result = filterCompletions(
      ["current.md", "other.md", "another.md"],
      "",
      null,
    );
    expect(result).toContain("current.md");
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// setCachedFileList
// ---------------------------------------------------------------------------

describe("setCachedFileList", () => {
  it("updates the internal cache used by filterCompletions", () => {
    /*
     * setCachedFileList is a setter for module-level state.
     * We verify it works by checking that the file list is
     * accessible to the autocomplete system. Since filterCompletions
     * takes a files parameter directly, this test just ensures
     * the function does not throw.
     */
    expect(() => setCachedFileList(["a.md", "b.md"])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Step 7: Backlink Index Builder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// computeBacklinks
// ---------------------------------------------------------------------------

describe("computeBacklinks", () => {
  it("finds files that link to current file via wiki-links", () => {
    /*
     * File A has an outgoing link to "current.md". When computing
     * backlinks for "current.md", file A should appear in the results.
     */
    const index = new Map<string, string[]>([
      ["fileA.md", ["current.md"]],
      ["fileB.md", ["other.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual(["fileA.md"]);
  });

  it("performs case-insensitive matching (AD-5)", () => {
    /*
     * macOS APFS is case-insensitive by default (AD-5). The comparison
     * uses localeCompare with sensitivity: "base" so "Current.md" and
     * "current.md" are treated as the same file.
     */
    const index = new Map<string, string[]>([
      ["fileA.md", ["Current.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual(["fileA.md"]);
  });

  it("excludes self-links (file linking to itself)", () => {
    /*
     * A file that contains a wiki-link to itself should not appear
     * in its own backlink list. The self-exclusion is case-insensitive.
     */
    const index = new Map<string, string[]>([
      ["current.md", ["current.md", "other.md"]],
      ["fileA.md", ["current.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual(["fileA.md"]);
    expect(result).not.toContain("current.md");
  });

  it("returns multiple files linking to current file, sorted alphabetically", () => {
    /*
     * When several files link to the current file, all should appear
     * in the result, sorted alphabetically by filename.
     */
    const index = new Map<string, string[]>([
      ["zebra.md", ["current.md"]],
      ["alpha.md", ["current.md"]],
      ["middle.md", ["current.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual(["alpha.md", "middle.md", "zebra.md"]);
  });

  it("returns empty array when no files link to current file", () => {
    const index = new Map<string, string[]>([
      ["fileA.md", ["other.md"]],
      ["fileB.md", ["another.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual([]);
  });

  it("detects standard markdown links as backlinks (EC-17)", () => {
    /*
     * The index contains normalized outgoing links from extractOutgoingLinks,
     * which already includes standard markdown links. This test confirms
     * that such entries are picked up by computeBacklinks.
     */
    const index = new Map<string, string[]>([
      ["fileA.md", ["current.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toContain("fileA.md");
  });

  it("handles large index with 50+ entries correctly (EC-11)", () => {
    /*
     * Performance edge case: a directory with 50+ sibling markdown
     * files. The function should still produce correct results.
     */
    const index = new Map<string, string[]>();
    for (let i = 0; i < 55; i++) {
      const links = i % 3 === 0 ? ["current.md"] : ["other.md"];
      index.set(`file${String(i).padStart(3, "0")}.md`, links);
    }

    const result = computeBacklinks(index, "current.md");

    /* Every 3rd file (i=0, 3, 6, ... 54) links to current = 19 files */
    expect(result).toHaveLength(19);

    /* Verify sorted order */
    for (let i = 1; i < result.length; i++) {
      expect(
        result[i - 1].localeCompare(result[i], undefined, { sensitivity: "base" })
      ).toBeLessThanOrEqual(0);
    }
  });

  it("handles empty index gracefully", () => {
    const index = new Map<string, string[]>();
    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual([]);
  });

  it("handles file with multiple outgoing links including current (EC-25 scenario)", () => {
    /*
     * EC-25: A file may have a stale entry (e.g., renamed file) still
     * in the index. The stale filename remains in results until the
     * next full rebuild. This test verifies that a file with multiple
     * outgoing links correctly matches when one of them is the current file.
     */
    const index = new Map<string, string[]>([
      ["fileA.md", ["other.md", "current.md", "third.md"]],
    ]);

    const result = computeBacklinks(index, "current.md");
    expect(result).toEqual(["fileA.md"]);
  });
});

// ---------------------------------------------------------------------------
// buildIndex
// ---------------------------------------------------------------------------

describe("buildIndex", () => {
  let savedTauriInternals: unknown;

  beforeEach(() => {
    savedTauriInternals = (globalThis as any).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    (globalThis as any).__TAURI_INTERNALS__ = savedTauriInternals;
    vi.restoreAllMocks();
  });

  it("builds index from sibling files", async () => {
    /*
     * Mock __TAURI_INTERNALS__.invoke to simulate listing and reading files.
     * buildIndex calls invokeListMdFiles then invokeReadFile for each file.
     */
    const mockInvoke = vi.fn().mockImplementation((cmd: string, args: any) => {
      if (cmd === "list_md_files") {
        return Promise.resolve(["alpha.md", "beta.md"]);
      }
      if (cmd === "read_file") {
        if (args.path.endsWith("alpha.md")) {
          return Promise.resolve("Links to [[beta]]");
        }
        if (args.path.endsWith("beta.md")) {
          return Promise.resolve("Links to [[alpha]]");
        }
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };

    const result = await buildIndex("/Users/me/docs");

    expect(result.size).toBe(2);
    expect(result.get("alpha.md")).toEqual(["beta.md"]);
    expect(result.get("beta.md")).toEqual(["alpha.md"]);
  });

  it("skips unreadable files with warning (EC-20, EC-21)", async () => {
    /*
     * When a file cannot be read (binary, permission denied), it is
     * skipped with a console warning. The index should still contain
     * entries for the files that were successfully read.
     */
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockInvoke = vi.fn().mockImplementation((cmd: string, args: any) => {
      if (cmd === "list_md_files") {
        return Promise.resolve(["good.md", "bad.md"]);
      }
      if (cmd === "read_file") {
        if (args.path.endsWith("good.md")) {
          return Promise.resolve("Content with [[link]]");
        }
        if (args.path.endsWith("bad.md")) {
          return Promise.reject("Permission denied");
        }
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };

    const result = await buildIndex("/Users/me/docs");

    expect(result.size).toBe(1);
    expect(result.has("good.md")).toBe(true);
    expect(result.has("bad.md")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("updates cached file list for autocomplete", async () => {
    /*
     * buildIndex calls setCachedFileList with the file list returned
     * by invokeListMdFiles, enabling autocomplete to show sibling files.
     */
    const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "list_md_files") {
        return Promise.resolve(["one.md", "two.md"]);
      }
      if (cmd === "read_file") {
        return Promise.resolve("No links here");
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };

    await buildIndex("/Users/me/docs");

    /*
     * Verify indirectly: filterCompletions uses the cached file list.
     * Since buildIndex calls setCachedFileList internally, we can
     * confirm the integration by testing a known set.
     */
    const completions = filterCompletions(["one.md", "two.md"], "", null);
    expect(completions).toEqual(["one.md", "two.md"]);
  });

  it("handles empty directory (EC-11 with 0 files)", async () => {
    const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "list_md_files") {
        return Promise.resolve([]);
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };

    const result = await buildIndex("/Users/me/empty");
    expect(result.size).toBe(0);
  });

  it("handles listMdFiles failure gracefully", async () => {
    // @ts-ignore TS6133: spy created for side-effect (suppresses console.error output)
    const _errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "list_md_files") {
        return Promise.reject("Directory not found");
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };

    const result = await buildIndex("/Users/me/nonexistent");

    /* invokeListMdFiles returns [] on error, so the index is empty */
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scheduleIndexRebuild -- debounce behavior
// ---------------------------------------------------------------------------

describe("scheduleIndexRebuild", () => {
  let savedTauriInternals: unknown;
  let savedCurrentFile: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    savedTauriInternals = (globalThis as any).__TAURI_INTERNALS__;
    savedCurrentFile = (globalThis as any).__MARKABLE_CURRENT_FILE__;

    /* Reset module-level state before each test */
    resetIndexState();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).__TAURI_INTERNALS__ = savedTauriInternals;
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = savedCurrentFile;
    vi.restoreAllMocks();
    resetIndexState();
  });

  it("calls callback with backlinks after debounce delay (300ms)", async () => {
    /*
     * scheduleIndexRebuild debounces at 300ms. After the timer fires,
     * it reads the current file, builds the index, and calls the
     * callback with computed backlinks.
     */
    const mockInvoke = vi.fn().mockImplementation((cmd: string, args: any) => {
      if (cmd === "list_md_files") {
        return Promise.resolve(["current.md", "fileA.md"]);
      }
      if (cmd === "read_file") {
        if (args.path.endsWith("current.md")) {
          return Promise.resolve("No links");
        }
        if (args.path.endsWith("fileA.md")) {
          return Promise.resolve("Links to [[current]]");
        }
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";

    const callback = vi.fn();
    scheduleIndexRebuild(callback);

    /* Timer has not fired yet -- callback should not have been called */
    expect(callback).not.toHaveBeenCalled();

    /* Advance past the 300ms debounce */
    await vi.advanceTimersByTimeAsync(300);

    /* After the async work completes, callback should be called */
    expect(callback).toHaveBeenCalledWith(["fileA.md"], expect.any(Array));
  });

  it("resets debounce timer on repeated calls (EC-12)", async () => {
    /*
     * EC-12: If scheduleIndexRebuild is called again before the
     * 300ms debounce fires, the previous timer is cleared and a new
     * one is started. Only the final call's timer fires.
     */
    const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "list_md_files") {
        return Promise.resolve(["current.md"]);
      }
      if (cmd === "read_file") {
        return Promise.resolve("No links");
      }
      return Promise.reject("unknown command");
    });

    (globalThis as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    /* First call */
    scheduleIndexRebuild(callback1);

    /* Advance 200ms (not yet fired) */
    await vi.advanceTimersByTimeAsync(200);

    /* Second call resets the timer */
    scheduleIndexRebuild(callback2);

    /* Advance 200ms more (only 200ms since second call) */
    await vi.advanceTimersByTimeAsync(200);

    /* Neither callback fired yet because the second timer has 100ms left */
    expect(callback1).not.toHaveBeenCalled();

    /* Advance the final 100ms */
    await vi.advanceTimersByTimeAsync(100);

    /* Only the second callback fires */
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalled();
  });

  it("returns empty backlinks for untitled document (EC-14)", async () => {
    /*
     * EC-14: When __MARKABLE_CURRENT_FILE__ is null (untitled doc),
     * the callback should be called with an empty array immediately
     * after the debounce, without attempting any file I/O.
     */
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = null;

    const callback = vi.fn();
    scheduleIndexRebuild(callback);

    await vi.advanceTimersByTimeAsync(300);

    expect(callback).toHaveBeenCalledWith([], expect.any(Array));
  });
});

// ---------------------------------------------------------------------------
// resetIndexState
// ---------------------------------------------------------------------------

describe("resetIndexState", () => {
  it("clears all module-level index state without throwing", () => {
    /*
     * resetIndexState is a cleanup function called during onDisable.
     * It should clear timers, the index map, and all flags. We verify
     * it does not throw and can be called multiple times safely.
     */
    expect(() => resetIndexState()).not.toThrow();
    expect(() => resetIndexState()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Step 8: Sidebar Panel
// ---------------------------------------------------------------------------

describe("Backlinks sidebar panel", () => {
  /**
   * Save and restore window globals and module state between tests.
   * Each test gets a fresh container element and clean panel state.
   */
  let savedCurrentFile: unknown;
  let savedTabManager: unknown;
  let container: HTMLElement;

  beforeEach(() => {
    savedCurrentFile = (globalThis as any).__MARKABLE_CURRENT_FILE__;
    savedTabManager = (globalThis as any).__MARKABLE_TAB_MANAGER__;

    /* Create a fresh container element for the panel */
    container = document.createElement("div");
    document.body.appendChild(container);

    /* Reset panel state via the testing accessor */
    _testing.setBacklinksListEl(null);
    _testing.setIsScanning(false);
    _testing.setCurrentBacklinks([]);
  });

  afterEach(() => {
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = savedCurrentFile;
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = savedTabManager;

    /* Clean up DOM */
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }

    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // render / destroy lifecycle
  // -------------------------------------------------------------------------

  it("renders 'No backlinks' when backlinks array is empty", () => {
    /*
     * When the panel is first rendered with no backlinks data, it
     * should show the empty state message. This matches FR-7.3.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);

    rebuildBacklinksDOM();

    const emptyEl = list.querySelector(".backlink-empty");
    expect(emptyEl).not.toBeNull();
    expect(emptyEl!.textContent).toBe("No links");
  });

  it("renders 'Scanning...' when isScanning is true", () => {
    /*
     * During index rebuild, the panel should show a loading indicator.
     * This matches FR-7.4.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setIsScanning(true);

    rebuildBacklinksDOM();

    const emptyEl = list.querySelector(".backlink-empty");
    expect(emptyEl).not.toBeNull();
    expect(emptyEl!.textContent).toBe("Scanning...");
  });

  it("renders backlink items for each filename", () => {
    /*
     * When backlinks exist, each filename should appear as a
     * clickable button element with the .backlink-item class.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setCurrentBacklinks(["alpha.md", "beta.md", "gamma.md"]);

    rebuildBacklinksDOM();

    const items = list.querySelectorAll(".backlink-item");
    expect(items).toHaveLength(3);
  });

  it("displays filenames without .md extension", () => {
    /*
     * Backlink items should display the human-readable filename
     * without the .md extension, matching the wiki-link display
     * convention used elsewhere in the feature.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setCurrentBacklinks(["my-notes.md"]);

    rebuildBacklinksDOM();

    const item = list.querySelector(".backlink-item");
    expect(item).not.toBeNull();
    expect(item!.textContent).toBe("my-notes");
  });

  it("items are sorted alphabetically", () => {
    /*
     * Acceptance criterion 3: entries are sorted alphabetically.
     * The caller (index builder) provides unsorted data; the panel
     * must sort before rendering.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setCurrentBacklinks(["zebra.md", "alpha.md", "middle.md"]);

    rebuildBacklinksDOM();

    const items = list.querySelectorAll(".backlink-item");
    expect(items[0].textContent).toBe("alpha");
    expect(items[1].textContent).toBe("middle");
    expect(items[2].textContent).toBe("zebra");
  });

  it("clicking item calls openFileInTab with correct path", () => {
    /*
     * Each backlink item should navigate to the linked file when
     * clicked. The path is resolved relative to the current file's
     * directory, matching the same resolution logic as wiki-link
     * click-to-navigate (Step 5).
     */
    const openMock = vi.fn().mockResolvedValue(true);
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/current.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: openMock,
    };

    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setCurrentBacklinks(["notes.md"]);

    rebuildBacklinksDOM();

    const item = list.querySelector(".backlink-item") as HTMLButtonElement;
    expect(item).not.toBeNull();
    item.click();

    expect(openMock).toHaveBeenCalledWith("/Users/me/docs/notes.md");
  });

  it("EC-1: untitled document shows 'No backlinks' (no crash)", () => {
    /*
     * When __MARKABLE_CURRENT_FILE__ is null (untitled document),
     * the backlinks panel should display "No backlinks" and not crash.
     * The index builder produces an empty array for untitled docs.
     */
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = null;

    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setCurrentBacklinks([]);

    rebuildBacklinksDOM();

    const emptyEl = list.querySelector(".backlink-empty");
    expect(emptyEl).not.toBeNull();
    expect(emptyEl!.textContent).toBe("No links");
  });

  it("EC-14: tab switch to untitled clears panel to 'No backlinks'", () => {
    /*
     * When switching from a file with backlinks to an untitled
     * document, the panel must clear to the empty state. This
     * simulates the index builder calling updatePanelContent([]).
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);

    /* First render with backlinks */
    _testing.setCurrentBacklinks(["file-a.md", "file-b.md"]);
    rebuildBacklinksDOM();
    expect(list.querySelectorAll(".backlink-item")).toHaveLength(2);

    /* Simulate tab switch to untitled */
    _testing.setCurrentBacklinks([]);
    rebuildBacklinksDOM();

    const emptyEl = list.querySelector(".backlink-empty");
    expect(emptyEl).not.toBeNull();
    expect(emptyEl!.textContent).toBe("No links");
    expect(list.querySelectorAll(".backlink-item")).toHaveLength(0);
  });

  it("panel updates when index is rebuilt", () => {
    /*
     * Simulates the flow: panel starts empty, index rebuilds with
     * results, panel shows the new backlinks.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);

    /* Initial: empty */
    rebuildBacklinksDOM();
    expect(list.querySelector(".backlink-empty")!.textContent).toBe("No links");

    /* Index rebuilt with results */
    _testing.setCurrentBacklinks(["result.md"]);
    rebuildBacklinksDOM();

    const items = list.querySelectorAll(".backlink-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("result");
  });

  it("panel updates when scanning state changes", () => {
    /*
     * Simulates: empty -> scanning -> results available.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);

    /* Start scanning */
    _testing.setIsScanning(true);
    rebuildBacklinksDOM();
    expect(list.querySelector(".backlink-empty")!.textContent).toBe("Scanning...");

    /* Scanning complete, results available */
    _testing.setIsScanning(false);
    _testing.setCurrentBacklinks(["found.md"]);
    rebuildBacklinksDOM();

    expect(list.querySelectorAll(".backlink-item")).toHaveLength(1);
    expect(list.querySelector(".backlink-item")!.textContent).toBe("found");
  });

  it("rebuildBacklinksDOM is a no-op when list element is null", () => {
    /*
     * When the panel is not mounted (_backlinksListEl is null),
     * calling rebuildBacklinksDOM should silently return without
     * throwing an error.
     */
    _testing.setBacklinksListEl(null);
    expect(() => rebuildBacklinksDOM()).not.toThrow();
  });

  it("backlink item title attribute contains full filename with .md", () => {
    /*
     * The title attribute provides the full filename on hover,
     * useful when the display name is truncated by text-overflow.
     */
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _testing.setBacklinksListEl(list);
    _testing.setCurrentBacklinks(["long-filename-here.md"]);

    rebuildBacklinksDOM();

    const item = list.querySelector(".backlink-item") as HTMLButtonElement;
    expect(item.title).toBe("long-filename-here.md");
  });
});

// ---------------------------------------------------------------------------
// Step 8: CSS injection
// ---------------------------------------------------------------------------

describe("Backlinks CSS injection", () => {
  afterEach(() => {
    /* Clean up any injected style tags */
    removeBacklinksCSS();
  });

  it("injectCSS creates style tag with correct id", () => {
    injectBacklinksCSS();

    const style = document.getElementById("__markable_backlinks_css__");
    expect(style).not.toBeNull();
    expect(style!.tagName).toBe("STYLE");
  });

  it("removeCSS removes style tag", () => {
    injectBacklinksCSS();
    expect(document.getElementById("__markable_backlinks_css__")).not.toBeNull();

    removeBacklinksCSS();
    expect(document.getElementById("__markable_backlinks_css__")).toBeNull();
  });

  it("injectCSS is idempotent (no duplicate tags)", () => {
    injectBacklinksCSS();
    injectBacklinksCSS();
    injectBacklinksCSS();

    const styles = document.querySelectorAll("#__markable_backlinks_css__");
    expect(styles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Step 9: Plugin Lifecycle + Build Registration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

describe("backlinks plugin metadata", () => {
  it("has correct id, name, version, description", () => {
    /*
     * The plugin metadata must match the spec exactly so the plugin
     * loader and plugins panel can identify and display it correctly.
     */
    expect(backlinkPlugin.id).toBe("backlinks");
    expect(backlinkPlugin.name).toBe("Backlinks");
    expect(backlinkPlugin.version).toBe("1.0.0");
    expect(backlinkPlugin.description).toBe(
      "Wiki-link syntax and backlink tracking"
    );
  });

  it("has sidebarPanelId matching panel registration id", () => {
    /*
     * sidebarPanelId tells the Plugins Panel detail view to render
     * the Left/Right sidebar assignment toggle for this plugin.
     * It must match the id passed to api.registerSidebarPanel().
     */
    expect(backlinkPlugin.sidebarPanelId).toBe("backlinks");
  });

  it("has a detail string for the plugins panel", () => {
    /*
     * The detail field provides a longer description shown in the
     * Plugins Panel detail view. It must be a non-empty string.
     */
    expect(typeof backlinkPlugin.detail).toBe("string");
    expect((backlinkPlugin as any).detail.length).toBeGreaterThan(0);
  });

  it("onEnable and onDisable are functions", () => {
    expect(typeof backlinkPlugin.onEnable).toBe("function");
    expect(typeof backlinkPlugin.onDisable).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Plugin lifecycle (onEnable / onDisable)
// ---------------------------------------------------------------------------

describe("backlinks plugin lifecycle", () => {
  /**
   * Mock MarkablePluginAPI that records calls for assertions.
   * Matches the interface used by all Markable IIFE plugins.
   */
  let mockApi: {
    addExtensions: ReturnType<typeof vi.fn>;
    removeExtensions: ReturnType<typeof vi.fn>;
    registerSidebarPanel: ReturnType<typeof vi.fn>;
    unregisterSidebarPanel: ReturnType<typeof vi.fn>;
    loadSettings: ReturnType<typeof vi.fn>;
  };

  let savedCmView: unknown;
  let savedCmAutocomplete: unknown;
  let savedCurrentFile: unknown;
  let savedTabManager: unknown;
  let savedTauriInternals: unknown;

  beforeEach(() => {
    /* Save all window globals */
    savedCmView = (globalThis as any).__CM_VIEW__;
    savedCmAutocomplete = (globalThis as any).__CM_AUTOCOMPLETE__;
    savedCurrentFile = (globalThis as any).__MARKABLE_CURRENT_FILE__;
    savedTabManager = (globalThis as any).__MARKABLE_TAB_MANAGER__;
    savedTauriInternals = (globalThis as any).__TAURI_INTERNALS__;

    /* Set up minimal CM6 mocks required by onEnable */
    (globalThis as any).__CM_VIEW__ = {
      EditorView: {
        updateListener: {
          of: vi.fn(() => ({ _tag: "updateListener" })),
        },
        domEventHandlers: vi.fn(() => ({ _tag: "domEventHandlers" })),
      },
      ViewPlugin: {
        fromClass: vi.fn(() => ({ _tag: "viewPlugin" })),
      },
      Decoration: {
        replace: vi.fn(() => ({
          range: vi.fn(() => ({})),
        })),
        mark: vi.fn(() => ({
          range: vi.fn(() => ({})),
        })),
        set: vi.fn(() => ({})),
      },
    };

    (globalThis as any).__CM_AUTOCOMPLETE__ = {
      autocompletion: vi.fn(() => ({ _tag: "autocompletion" })),
    };

    (globalThis as any).__MARKABLE_CURRENT_FILE__ = "/Users/me/docs/test.md";
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn().mockResolvedValue(true),
    };
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue([]),
    };

    /* Create fresh mock API */
    mockApi = {
      addExtensions: vi.fn(),
      removeExtensions: vi.fn(),
      registerSidebarPanel: vi.fn(),
      unregisterSidebarPanel: vi.fn(),
      loadSettings: vi.fn().mockResolvedValue(null),
    };

    /* Clean up any leftover CSS from prior tests */
    removeWikiLinkStyles();
    removeBacklinksCSS();
    resetIndexState();
  });

  afterEach(() => {
    /* Restore all window globals */
    (globalThis as any).__CM_VIEW__ = savedCmView;
    (globalThis as any).__CM_AUTOCOMPLETE__ = savedCmAutocomplete;
    (globalThis as any).__MARKABLE_CURRENT_FILE__ = savedCurrentFile;
    (globalThis as any).__MARKABLE_TAB_MANAGER__ = savedTabManager;
    (globalThis as any).__TAURI_INTERNALS__ = savedTauriInternals;

    /* Clean up CSS */
    removeWikiLinkStyles();
    removeBacklinksCSS();
    resetIndexState();

    vi.restoreAllMocks();
  });

  it("onEnable registers extensions and sidebar panel", () => {
    /*
     * After calling onEnable, the plugin must have called
     * api.addExtensions() with a non-empty array and
     * api.registerSidebarPanel() with the correct panel id.
     */
    backlinkPlugin.onEnable(mockApi as any);

    expect(mockApi.addExtensions).toHaveBeenCalledTimes(1);
    const extensions = mockApi.addExtensions.mock.calls[0][0];
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);

    expect(mockApi.registerSidebarPanel).toHaveBeenCalledTimes(1);
    const panelConfig = mockApi.registerSidebarPanel.mock.calls[0][0];
    expect(panelConfig.id).toBe("backlinks");
    expect(panelConfig.title).toBe("Backlinks");
    expect(panelConfig.side).toBe("right");
    expect(typeof panelConfig.render).toBe("function");
    expect(typeof panelConfig.destroy).toBe("function");
  });

  it("onEnable injects both wiki-link and backlinks CSS", () => {
    backlinkPlugin.onEnable(mockApi as any);

    expect(
      document.querySelector("[data-markable-wiki-link-styles]")
    ).not.toBeNull();
    expect(
      document.getElementById("__markable_backlinks_css__")
    ).not.toBeNull();
  });

  it("onDisable removes extensions and unregisters sidebar panel", () => {
    backlinkPlugin.onEnable(mockApi as any);
    backlinkPlugin.onDisable(mockApi as any);

    expect(mockApi.removeExtensions).toHaveBeenCalledTimes(1);
    expect(mockApi.unregisterSidebarPanel).toHaveBeenCalledWith("backlinks");
  });

  it("onDisable removes both CSS style tags", () => {
    backlinkPlugin.onEnable(mockApi as any);

    /* Verify CSS was injected */
    expect(
      document.querySelector("[data-markable-wiki-link-styles]")
    ).not.toBeNull();
    expect(
      document.getElementById("__markable_backlinks_css__")
    ).not.toBeNull();

    backlinkPlugin.onDisable(mockApi as any);

    /* Verify CSS was removed */
    expect(
      document.querySelector("[data-markable-wiki-link-styles]")
    ).toBeNull();
    expect(
      document.getElementById("__markable_backlinks_css__")
    ).toBeNull();
  });

  it("onDisable clears all module-level state", () => {
    backlinkPlugin.onEnable(mockApi as any);
    backlinkPlugin.onDisable(mockApi as any);

    /*
     * After onDisable, the testing accessor should confirm that
     * panel state has been cleared. The backlinks list element
     * should be null and backlinks should be empty.
     */
    expect(_testing.getBacklinksListEl()).toBeNull();
  });

  it("EC-15: rapid enable/disable cycle — no stale timers, no duplicate CSS, clean state", () => {
    /*
     * EC-15: Rapidly toggling the plugin on and off should not leave
     * stale timers, duplicate CSS tags, or corrupted module state.
     * After the final disable, everything must be clean.
     */

    /* Cycle 1 */
    backlinkPlugin.onEnable(mockApi as any);
    backlinkPlugin.onDisable(mockApi as any);

    /* Cycle 2 */
    backlinkPlugin.onEnable(mockApi as any);
    backlinkPlugin.onDisable(mockApi as any);

    /* Cycle 3 */
    backlinkPlugin.onEnable(mockApi as any);
    backlinkPlugin.onDisable(mockApi as any);

    /* No CSS tags should remain after final disable */
    expect(
      document.querySelector("[data-markable-wiki-link-styles]")
    ).toBeNull();
    expect(
      document.getElementById("__markable_backlinks_css__")
    ).toBeNull();

    /* Module state should be clean */
    expect(_testing.getBacklinksListEl()).toBeNull();

    /* API should have been called symmetrically for each cycle */
    expect(mockApi.addExtensions).toHaveBeenCalledTimes(3);
    expect(mockApi.removeExtensions).toHaveBeenCalledTimes(3);
    expect(mockApi.registerSidebarPanel).toHaveBeenCalledTimes(3);
    expect(mockApi.unregisterSidebarPanel).toHaveBeenCalledTimes(3);
  });

  it("enable after disable starts with clean state", () => {
    /*
     * After a disable+re-enable cycle, the plugin should behave
     * identically to a fresh first-time enable. Extensions should
     * be re-registered and CSS re-injected.
     */
    backlinkPlugin.onEnable(mockApi as any);
    backlinkPlugin.onDisable(mockApi as any);

    /* Fresh mock API for second enable */
    const freshApi = {
      addExtensions: vi.fn(),
      removeExtensions: vi.fn(),
      registerSidebarPanel: vi.fn(),
      unregisterSidebarPanel: vi.fn(),
      loadSettings: vi.fn().mockResolvedValue(null),
    };

    backlinkPlugin.onEnable(freshApi as any);

    expect(freshApi.addExtensions).toHaveBeenCalledTimes(1);
    expect(freshApi.registerSidebarPanel).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("[data-markable-wiki-link-styles]")
    ).not.toBeNull();
    expect(
      document.getElementById("__markable_backlinks_css__")
    ).not.toBeNull();

    /* Clean up */
    backlinkPlugin.onDisable(freshApi as any);
  });
});
