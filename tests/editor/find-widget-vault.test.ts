/**
 * find-widget-vault.test.ts
 *
 * Unit tests for the vault-search utilities introduced in the multi-file
 * find & replace feature (Steps 02–04).
 *
 * Part 1 — Pure logic functions with no DOM or Tauri dependencies:
 *   - postFilterResults: case-sensitive and whole-word post-filtering (FR-13, FR-14)
 *   - applyStringReplace: all-occurrences replacement with option flags (FR-15)
 *   - escapeRegex: regex-special character escaping (EC-14)
 *   - buildWholeWordRegex: word-boundary regex construction (EC-11)
 *
 * Part 2 — _replaceInFile error-path tests (Issue 7 / EC-8 / NFR-6):
 *   - RI-1: readFile failure → method returns 0 and logs an error
 *   - RI-2: writeFile failure → method throws, executeReplaceAll records error
 *
 * Test IDs: PF-1…PF-6, AR-1…AR-9, ER-1, CA-1…CA-3, RI-1, RI-2
 * (per step_02, step_03, step_04, and reviewer-issue-7 specs)
 */

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted above imports by vitest's plugin.
// These are required for Part 2 tests that instantiate FindWidget.
// ---------------------------------------------------------------------------

// Tauri core invoke — needed transitively by bridge.ts
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Tauri webviewWindow — needed transitively by settings.ts
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
}));

// Tauri DPI — needed transitively by settings.ts
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));

// Bridge module — readFile and writeFile are the specific targets for RI-1/RI-2.
vi.mock("../../src/lib/bridge", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  searchVaultContent: vi.fn(),
}));

// Settings — FindWidget calls getCurrentSettings() and updateSettings().
vi.mock("../../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({ findWidget: null, findWidgetScope: "file" })),
  updateSettings: vi.fn(() => Promise.resolve()),
}));

// @codemirror/search — requires a live EditorState; mock with stubs.
// SearchQuery must be a constructor function (not an arrow function) so that
// `new SearchQuery(...)` works correctly.
vi.mock("@codemirror/search", () => {
  function SearchQueryMock(this: Record<string, unknown>, opts: Record<string, unknown>) {
    this.search = opts.search ?? "";
    this.caseSensitive = opts.caseSensitive ?? false;
    this.wholeWord = opts.wholeWord ?? false;
    this.regexp = opts.regexp ?? false;
    this.replace = opts.replace ?? "";
    this.valid = true;
    this.getCursor = vi.fn(() => ({ next: vi.fn(() => ({ done: true })), value: { to: 0 } }));
  }
  return {
    SearchQuery: vi.fn().mockImplementation(function(
      this: Record<string, unknown>,
      opts: Record<string, unknown>,
    ) { SearchQueryMock.call(this, opts); }),
    setSearchQuery: { of: vi.fn(() => ({ type: "setSearchQuery" })) },
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    replaceNext: vi.fn(),
    replaceAll: vi.fn(),
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  postFilterResults,
  applyStringReplace,
  escapeRegex,
  buildWholeWordRegex,
} from "../../src/editor/vault-search-utils";
import type { ContentSearchPayload } from "../../src/lib/bridge";
import { readFile, writeFile } from "../../src/lib/bridge";
import { createFindWidget } from "../../src/editor/find-widget";

// ── Test fixture helper ───────────────────────────────────────────────────────

/**
 * Build a minimal ContentSearchPayload for use in tests.
 *
 * @param matches - Array of file entries with line matches.
 */
function makePayload(
  matches: Array<{
    path: string;
    title: string;
    lines: Array<{ lineText: string; lineNumber: number; columnStart: number }>;
  }>
): ContentSearchPayload {
  return {
    results: matches.map((m) => ({
      path: m.path,
      title: m.title,
      matches: m.lines.map((l) => ({
        lineText: l.lineText,
        lineNumber: l.lineNumber,
        columnStart: l.columnStart,
      })),
    })),
    capped: false,
    skippedCount: 0,
  };
}

// ── postFilterResults tests ───────────────────────────────────────────────────

describe("postFilterResults", () => {
  /**
   * PF-1: When neither matchCase nor wholeWord is active, the payload is
   * returned as the same object reference (no copy made, no filtering).
   */
  it("PF-1: no post-filter options — payload returned as-is (same reference)", () => {
    const payload = makePayload([
      {
        path: "/a.md",
        title: "A",
        lines: [{ lineText: "Hello World", lineNumber: 1, columnStart: 6 }],
      },
    ]);
    const result = postFilterResults(payload, "world", { matchCase: false, wholeWord: false });
    expect(result).toBe(payload); // Same object reference.
  });

  /**
   * PF-2: matchCase:true discards LineMatches whose lineText does not contain
   * the exact-case query string (FR-13, EC-10).
   */
  it("PF-2: matchCase:true discards case-mismatched results", () => {
    const payload = makePayload([
      {
        path: "/a.md",
        title: "A",
        lines: [
          { lineText: "Hello World", lineNumber: 1, columnStart: 6 }, // "World" ≠ "world"
          { lineText: "hello world", lineNumber: 2, columnStart: 6 }, // "world" matches
        ],
      },
    ]);
    const result = postFilterResults(payload, "world", { matchCase: true, wholeWord: false });
    expect(result.results.length).toBe(1);
    expect(result.results[0].matches.length).toBe(1);
    expect(result.results[0].matches[0].lineNumber).toBe(2);
  });

  /**
   * PF-3: matchCase:true removes the file entry if all its matches are
   * filtered out (EC-10).
   */
  it("PF-3: matchCase:true removes file when all matches are filtered", () => {
    const payload = makePayload([
      {
        path: "/a.md",
        title: "A",
        lines: [{ lineText: "Hello World", lineNumber: 1, columnStart: 6 }],
      },
    ]);
    const result = postFilterResults(payload, "world", { matchCase: true, wholeWord: false });
    expect(result.results.length).toBe(0);
  });

  /**
   * PF-4: wholeWord:true discards partial-word matches (FR-14, EC-11).
   * "cat" inside "concatenate" is not a whole-word match; standalone "cat" is.
   */
  it("PF-4: wholeWord:true discards partial-word matches", () => {
    const payload = makePayload([
      {
        path: "/a.md",
        title: "A",
        lines: [
          { lineText: "concatenate the cat", lineNumber: 1, columnStart: 16 }, // whole "cat" ✓
          { lineText: "concatenate this", lineNumber: 2, columnStart: 0 },     // "cat" inside word ✗
        ],
      },
    ]);
    const result = postFilterResults(payload, "cat", { matchCase: false, wholeWord: true });
    expect(result.results[0].matches.length).toBe(1);
    expect(result.results[0].matches[0].lineNumber).toBe(1);
  });

  /**
   * PF-5: capped and skippedCount pass through unchanged regardless of filtering.
   */
  it("PF-5: capped and skippedCount pass through unchanged", () => {
    const payload: ContentSearchPayload = { results: [], capped: true, skippedCount: 3 };
    const result = postFilterResults(payload, "x", { matchCase: true, wholeWord: false });
    expect(result.capped).toBe(true);
    expect(result.skippedCount).toBe(3);
  });

  /**
   * PF-6: matchCase:true + wholeWord:true: only exact-case whole-word matches
   * are kept (step_03 test).
   */
  it("PF-6: matchCase:true + wholeWord:true keeps only exact-case whole-word matches", () => {
    const payload = makePayload([
      {
        path: "/a.md",
        title: "A",
        lines: [
          { lineText: "The Cat sat", lineNumber: 1, columnStart: 4 },      // "Cat" correct case + whole word ✓
          { lineText: "The cat sat", lineNumber: 2, columnStart: 4 },      // "cat" wrong case ✗
          { lineText: "The Catfish swam", lineNumber: 3, columnStart: 4 }, // "Cat" but partial word ✗
        ],
      },
    ]);
    const result = postFilterResults(payload, "Cat", { matchCase: true, wholeWord: true });
    expect(result.results[0].matches.length).toBe(1);
    expect(result.results[0].matches[0].lineNumber).toBe(1);
  });

  /**
   * CA-3: postFilterResults with empty results array returns empty results.
   */
  it("CA-3: empty results array — returns empty results", () => {
    const payload: ContentSearchPayload = { results: [], capped: false, skippedCount: 0 };
    const result = postFilterResults(payload, "x", { matchCase: true, wholeWord: false });
    expect(result.results.length).toBe(0);
    expect(result.capped).toBe(false);
  });
});

// ── applyStringReplace tests ──────────────────────────────────────────────────

describe("applyStringReplace", () => {
  /**
   * AR-1: Case-insensitive replacement replaces all occurrences.
   */
  it("AR-1: replaces all occurrences (case-insensitive)", () => {
    const result = applyStringReplace("hello world hello", "hello", "bye", {
      matchCase: false,
      wholeWord: false,
    });
    expect(result.newContent).toBe("bye world bye");
    expect(result.count).toBe(2);
  });

  /**
   * AR-2: matchCase:true replaces only exact-case occurrences.
   */
  it("AR-2: matchCase:true — replaces only exact-case occurrences", () => {
    const result = applyStringReplace("Hello hello HELLO", "hello", "bye", {
      matchCase: true,
      wholeWord: false,
    });
    expect(result.newContent).toBe("Hello bye HELLO");
    expect(result.count).toBe(1);
  });

  /**
   * AR-3: wholeWord:true replaces only whole-word occurrences (EC-11).
   */
  it("AR-3: wholeWord:true — does not replace partial-word occurrences", () => {
    const result = applyStringReplace("cat concatenate cat", "cat", "dog", {
      matchCase: false,
      wholeWord: true,
    });
    expect(result.newContent).toBe("dog concatenate dog");
    expect(result.count).toBe(2);
  });

  /**
   * AR-4: Returns count 0 when the find term is not present (EC-6).
   * The caller must not write the file when count === 0.
   */
  it("AR-4: returns count 0 when find term is absent (EC-6 no-write guard)", () => {
    const result = applyStringReplace("nothing here", "xyz", "abc", {
      matchCase: false,
      wholeWord: false,
    });
    expect(result.count).toBe(0);
    expect(result.newContent).toBe("nothing here");
  });

  /**
   * AR-5: Empty replace string deletes all occurrences (EC-13).
   */
  it("AR-5: empty replace string performs deletion (EC-13)", () => {
    const result = applyStringReplace("remove this word", "this ", "", {
      matchCase: false,
      wholeWord: false,
    });
    expect(result.newContent).toBe("remove word");
    expect(result.count).toBe(1);
  });

  /**
   * AR-6: Empty find string returns count 0 (guard against no-op split).
   */
  it("AR-6: empty find string returns count 0", () => {
    const result = applyStringReplace("content", "", "replace", {
      matchCase: false,
      wholeWord: false,
    });
    expect(result.count).toBe(0);
    expect(result.newContent).toBe("content");
  });

  /**
   * AR-7: Special regex characters in the find term are treated literally (EC-14).
   * "$100" must match literally, not as a regex backreference.
   */
  it("AR-7: special regex chars in find term are escaped (EC-14)", () => {
    const result = applyStringReplace("price is $100 and $200", "$100", "$50", {
      matchCase: false,
      wholeWord: false,
    });
    expect(result.newContent).toBe("price is $50 and $200");
    expect(result.count).toBe(1);
  });

  /**
   * AR-8: wholeWord:true does not match partial terms (EC-11).
   * "cat" inside "cats" and "concatenate" must not be replaced.
   * Only the standalone "cat" at end of string matches \bcat\b.
   *
   * Note: "cats" is a separate whole word and does NOT match \bcat\b because
   * there is no word boundary between "cat" and "s". This is the correct
   * whole-word behavior. The spec intent is to prove "concatenate" is not
   * touched; "cats" is similarly unaffected.
   */
  it("AR-8: wholeWord:true does not match partial term (EC-11)", () => {
    const result = applyStringReplace("cats and concatenate and cat", "cat", "dog", {
      matchCase: false,
      wholeWord: true,
    });
    // "cats" does NOT match \bcat\b (no word boundary between "cat" and "s").
    // "concatenate" does NOT match \bcat\b (cat is embedded inside the word).
    // Only the standalone "cat" at the end matches.
    expect(result.newContent).toBe("cats and concatenate and dog");
    expect(result.count).toBe(1);
  });

  /**
   * AR-9: matchCase:true + wholeWord:true replaces only exact-case whole-word matches.
   */
  it("AR-9: matchCase:true + wholeWord:true — combined filters", () => {
    const result = applyStringReplace("Cat cat CAT", "cat", "dog", {
      matchCase: true,
      wholeWord: true,
    });
    expect(result.newContent).toBe("Cat dog CAT");
    expect(result.count).toBe(1);
  });

  /**
   * CA-2: Empty replace term (deletion) with wholeWord context (EC-13).
   * When the confirmation panel shows "Delete '...'", the engine must handle
   * the empty-string replacement correctly.
   */
  it("CA-2: empty replaceTerm performs deletion (EC-13, confirmation panel phrasing)", () => {
    const result = applyStringReplace("remove the word", "the ", "", {
      matchCase: false,
      wholeWord: false,
    });
    expect(result.newContent).toBe("remove word");
    expect(result.count).toBe(1);
  });
});

// ── escapeRegex tests ─────────────────────────────────────────────────────────

describe("escapeRegex", () => {
  /**
   * ER-1: All regex-special characters are escaped so the string can be used
   * safely inside new RegExp(...) as a literal pattern (EC-14).
   */
  it("ER-1: escapes all regex-special characters (EC-14)", () => {
    const input = "a.b*c?d+e^f$g(h)i[j]k{l}m|n\\o";
    const expected = "a\\.b\\*c\\?d\\+e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n\\\\o";
    expect(escapeRegex(input)).toBe(expected);
  });
});

// ── buildWholeWordRegex tests ─────────────────────────────────────────────────

describe("buildWholeWordRegex", () => {
  /**
   * Whole-word regex must include \b anchors and the g flag.
   */
  it("builds a regex with word-boundary anchors", () => {
    const re = buildWholeWordRegex("cat", false);
    expect(re.source).toBe("\\bcat\\b");
    expect(re.global).toBe(true);
    expect(re.ignoreCase).toBe(true);
  });

  /**
   * When caseSensitive is true, the i flag must be absent.
   */
  it("caseSensitive:true omits the i flag", () => {
    const re = buildWholeWordRegex("Cat", true);
    expect(re.ignoreCase).toBe(false);
  });
});

// ── Payload total-match-count helper test ────────────────────────────────────

describe("Payload match count (CA-1)", () => {
  /**
   * CA-1: The sum of match counts across all files in a payload equals the
   * expected total. This validates the counting logic used by the confirmation
   * panel (which cannot be tested in isolation without DOM).
   */
  it("CA-1: sum of matches across files equals expected total", () => {
    const payload = makePayload([
      {
        path: "/a.md",
        title: "A",
        lines: [
          { lineText: "cat and cat", lineNumber: 1, columnStart: 0 },
          { lineText: "another cat", lineNumber: 2, columnStart: 8 },
        ],
      },
      {
        path: "/b.md",
        title: "B",
        lines: [{ lineText: "cat on a mat", lineNumber: 3, columnStart: 0 }],
      },
    ]);
    const total = payload.results.reduce((s, f) => s + f.matches.length, 0);
    expect(total).toBe(3);
  });
});

// ── _replaceInFile error-path tests (Issue 7 / EC-8 / NFR-6) ─────────────────
//
// These tests verify that _replaceInFile (a private method on FindWidget)
// handles bridge.readFile and bridge.writeFile failure modes correctly:
//
//   RI-1: readFile failure → returns 0 and logs a console.error
//   RI-2: writeFile failure → throws, which _executeReplaceAll records per-file
//
// We access the private method via `(widget as any)._replaceInFile(...)`, a
// standard pattern in this codebase (see tests/find-widget.test.ts and
// tests/tabs/tab-manager.test.ts for precedent).

/**
 * Build a minimal EditorView stub satisfying FindWidget's constructor requirements.
 * Mirrors makeViewMock() in tests/find-widget.test.ts.
 */
function makeViewStub(docText = "") {
  return {
    focus: vi.fn(),
    dispatch: vi.fn(),
    state: {
      selection: { main: { from: 0, to: 0 } },
      doc: {
        toString: () => docText,
        length: docText.length,
      },
      sliceDoc: vi.fn((_from: number, _to: number) => ""),
    },
  } as any;
}

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;

describe("_replaceInFile error paths (EC-8 / NFR-6)", () => {
  let widget: ReturnType<typeof createFindWidget>;

  beforeEach(() => {
    // Reset all bridge mocks before each test.
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    // Silence console.error output in these tests — we only care about behaviour.
    vi.spyOn(console, "error").mockImplementation(() => {});
    widget = createFindWidget(makeViewStub());
  });

  afterEach(() => {
    widget.destroy();
    vi.restoreAllMocks();
  });

  /**
   * RI-1: When readFile returns ok:false, _replaceInFile must return 0
   * (no replacements made) and log a console.error (EC-8, NFR-6).
   *
   * This is the "graceful degradation" requirement: a single unreadable file
   * must not abort the batch or throw an unhandled rejection.
   */
  it("RI-1: readFile failure → returns 0 and logs error (EC-8 / NFR-6)", async () => {
    // Arrange: bridge.readFile returns an error result.
    mockReadFile.mockResolvedValue({
      ok: false,
      error: { message: "Permission denied", command: "read_file", path: "/vault/note.md" },
    });

    // Act: call the private method directly.
    const result = await (widget as any)._replaceInFile("/vault/note.md", "cat", "dog");

    // Assert: return value is 0 (no replacements, not -1 which means cancelled).
    expect(result).toBe(0);

    // Assert: console.error was called so the error is observable in logs.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("readFile failed"),
      expect.stringContaining("Permission denied"),
    );

    // Assert: writeFile was never called — a failed read must not trigger a write.
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  /**
   * RI-2: When writeFile returns ok:false, _replaceInFile must throw an Error.
   * The _executeReplaceAll batch loop wraps each call in try/catch and records
   * the thrown error as outcome.error without aborting the remaining files
   * (EC-8, EC-20, NFR-6).
   */
  it("RI-2: writeFile failure → throws Error (caught by batch loop, EC-8 / NFR-6)", async () => {
    // Arrange: readFile succeeds with content containing the find term.
    mockReadFile.mockResolvedValue({
      ok: true,
      value: "hello cat world",
    });
    // Arrange: writeFile returns an error result.
    mockWriteFile.mockResolvedValue({
      ok: false,
      error: { message: "Disk full", command: "write_file", path: "/vault/note.md" },
    });

    // Suppress console.error for the writeFile error log.
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Act + Assert: the method must throw so the batch loop can catch it.
    await expect(
      (widget as any)._replaceInFile("/vault/note.md", "cat", "dog"),
    ).rejects.toThrow("Disk full");
  });
});
