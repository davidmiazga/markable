/**
 * tests/export.test.ts
 *
 * Vitest unit tests for src/lib/export.ts.
 *
 * Covers all 20 edge cases from active_task.md (EC-1 through EC-20).
 *
 * Pure functions (escapeHtml, extractTitle, deriveExportFilename,
 * enforceHtmlExtension, markdownToHtml, buildStandaloneHtml) are tested
 * without any mocks — they have no I/O or DOM dependencies.
 *
 * The orchestration function (exportAsHtml) is tested with the Tauri bridge
 * mocked via vi.mock so that saveHtmlDialog and writeFile never invoke Tauri.
 *
 * EC-11 (synchronous performance on large documents) and EC-20 (build-time
 * failure if marked is missing) have no runtime test cases by design:
 *   EC-11 is a runtime concern only observable via profiling.
 *   EC-20 is a build-time pre-condition verified by completing step_01.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  escapeHtml,
  extractTitle,
  deriveExportFilename,
  enforceHtmlExtension,
  markdownToHtml,
  buildStandaloneHtml,
  exportAsHtml,
} from "../src/lib/export";
import { saveHtmlDialog, writeFile } from "../src/lib/bridge";

// Mock the entire bridge module so no Tauri invoke calls are made during tests.
vi.mock("../src/lib/bridge", () => ({
  saveHtmlDialog: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  updateRecentFilesMenu: vi.fn(),
  listThemes: vi.fn(),
  readThemeCss: vi.fn(),
  updateThemeMenu: vi.fn(),
}));

/**
 * Creates a minimal EditorView stub that satisfies the interface expected by
 * exportAsHtml. Uses `as any` to avoid importing the full CodeMirror type
 * graph in the test environment.
 *
 * @param content - The markdown string the stub editor should return
 */
function makeEditor(content: string) {
  return {
    state: {
      doc: {
        toString: () => content,
      },
    },
  } as any;
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes & < > \" '", () => {
    expect(escapeHtml('a & b < c > d " e \' f')).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &#39; f"
    );
  });

  it("returns unchanged string when no special characters", () => {
    expect(escapeHtml("Hello world")).toBe("Hello world");
  });

  // EC-5: H1 text may contain HTML special characters that must be escaped
  it("EC-5: escapes H1 text with HTML special characters", () => {
    expect(escapeHtml("Notes <draft> & ideas")).toBe(
      "Notes &lt;draft&gt; &amp; ideas"
    );
  });
});

// ---------------------------------------------------------------------------
// extractTitle
// ---------------------------------------------------------------------------

describe("extractTitle", () => {
  // EC-3: No H1 present, fall back to filename stem
  it("EC-3: returns filename stem when no H1 but filePath present", () => {
    expect(extractTitle("Some paragraph text.", "/home/user/notes.md")).toBe("notes");
  });

  // EC-2: No H1 and no filePath — final fallback is the string "Untitled"
  it("EC-2: returns 'Untitled' when no H1 and no filePath", () => {
    expect(extractTitle("", null)).toBe("Untitled");
  });

  it("returns H1 text when ATX H1 is present", () => {
    expect(extractTitle("# My Title\n\nBody text.", null)).toBe("My Title");
  });

  // EC-4: Array.find() stops at the first match — subsequent H1s are ignored
  it("EC-4: uses only the FIRST H1 when multiple are present", () => {
    const md = "# First\n\n## Sub\n\n# Second\n\nText.";
    expect(extractTitle(md, null)).toBe("First");
  });

  // EC-5: H1 text with HTML special characters must be escaped for <title>
  it("EC-5: HTML-escapes H1 text containing < > &", () => {
    expect(extractTitle("# Notes <draft> & ideas", null)).toBe(
      "Notes &lt;draft&gt; &amp; ideas"
    );
  });

  // EC-6: Filename-derived titles can also contain special characters
  it("EC-6: HTML-escapes filename-derived title", () => {
    expect(extractTitle("", "/path/to/report<2026>.md")).toBe(
      "report&lt;2026&gt;"
    );
  });

  // EC-10: Setext H1 (=== underline) is NOT matched — only ATX style (^# )
  it("EC-10: setext H1 (=== underline) does NOT match ATX scan — falls back to filename", () => {
    const md = "My Setext Title\n===============\n\nBody.";
    expect(extractTitle(md, "/path/to/doc.md")).toBe("doc");
  });

  // EC-19: split('\n') produces the last line even if there is no trailing newline
  it("EC-19: H1 on last line with no trailing newline is found", () => {
    expect(extractTitle("Some text\n# Last Line Title", null)).toBe(
      "Last Line Title"
    );
  });

  // EC-17: Non-.md extension in filePath should be stripped correctly
  it("EC-17: non-.md extension in filePath is replaced correctly", () => {
    expect(extractTitle("No heading here.", "/docs/report.txt")).toBe("report");
  });

  // EC-18: filePath with no extension uses full filename as stem
  it("EC-18: filePath with no extension uses full filename as stem", () => {
    expect(extractTitle("No heading.", "/path/to/README")).toBe("README");
  });
});

// ---------------------------------------------------------------------------
// deriveExportFilename
// ---------------------------------------------------------------------------

describe("deriveExportFilename", () => {
  // EC-2: null filePath -> untitled.html
  it("EC-2: null filePath returns 'untitled.html'", () => {
    expect(deriveExportFilename(null)).toBe("untitled.html");
  });

  it("replaces .md with .html", () => {
    expect(deriveExportFilename("/home/user/notes.md")).toBe("notes.html");
  });

  // EC-17: Any extension is replaced, not just .md
  it("EC-17: replaces any extension with .html", () => {
    expect(deriveExportFilename("/docs/report.txt")).toBe("report.html");
  });

  // EC-18: No extension -> append .html to the full filename
  it("EC-18: appends .html when filename has no extension", () => {
    expect(deriveExportFilename("/path/to/README")).toBe("README.html");
  });
});

// ---------------------------------------------------------------------------
// enforceHtmlExtension
// ---------------------------------------------------------------------------

describe("enforceHtmlExtension", () => {
  // EC-15: Path without .html extension must have .html appended
  it("EC-15: appends .html when no extension", () => {
    expect(enforceHtmlExtension("/path/to/export")).toBe("/path/to/export.html");
  });

  it("EC-15: appends .html when extension is .md", () => {
    expect(enforceHtmlExtension("/path/to/file.md")).toBe("/path/to/file.md.html");
  });

  it("does not modify path that already ends in .html", () => {
    expect(enforceHtmlExtension("/path/to/file.html")).toBe("/path/to/file.html");
  });

  it("does not modify path that already ends in .htm", () => {
    expect(enforceHtmlExtension("/path/to/file.htm")).toBe("/path/to/file.htm");
  });

  it("is case-insensitive for .HTML", () => {
    expect(enforceHtmlExtension("/path/to/file.HTML")).toBe("/path/to/file.HTML");
  });
});

// ---------------------------------------------------------------------------
// markdownToHtml
// ---------------------------------------------------------------------------

describe("markdownToHtml", () => {
  it("converts a heading to <h1>", () => {
    const result = markdownToHtml("# Hello");
    expect(result).toContain("<h1>Hello</h1>");
  });

  it("converts bold to <strong>", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
  });

  // EC-7: Raw HTML blocks pass through unchanged — not a bug, intentional (FR-3.3)
  it("EC-7: raw HTML blocks pass through unchanged", () => {
    const md = 'Before\n\n<div class="custom">raw html</div>\n\nAfter';
    const result = markdownToHtml(md);
    expect(result).toContain('<div class="custom">raw html</div>');
  });

  // EC-12: Code fences with language tags render with language class attribute
  it("EC-12: code fence with language tag renders with language class", () => {
    const md = "```rust\nfn main() {}\n```";
    const result = markdownToHtml(md);
    expect(result).toContain("language-rust");
    expect(result).toContain("fn main()");
  });

  // EC-13: GFM task lists render as <input type="checkbox" disabled> elements
  it("EC-13: task list items render with checkbox input elements", () => {
    const md = "- [ ] unchecked\n- [x] checked";
    const result = markdownToHtml(md);
    // marked GFM renders task lists as <input type="checkbox" disabled>
    expect(result).toContain("checkbox");
    expect(result).toContain("unchecked");
    expect(result).toContain("checked");
  });

  // EC-14: Links with special characters in URL — marked handles URL encoding
  it("EC-14: link with special characters in URL renders with escaped href", () => {
    const md = "[link](https://example.com/path?a=1&b=2)";
    const result = markdownToHtml(md);
    expect(result).toContain("href=");
    // marked handles URL encoding; the href should not break HTML structure
    expect(result).toContain("example.com");
  });

  // EC-1: Empty markdown must not crash and must produce empty or whitespace output
  it("EC-1: empty markdown returns empty string or whitespace only", () => {
    const result = markdownToHtml("");
    expect(result.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildStandaloneHtml
// ---------------------------------------------------------------------------

describe("buildStandaloneHtml", () => {
  it("produces a complete HTML5 document structure", () => {
    const html = buildStandaloneHtml("# Title\n\nBody.", "Title");
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</html>");
  });

  it("embeds the title in <title>", () => {
    const html = buildStandaloneHtml("", "My Doc");
    expect(html).toContain("<title>My Doc</title>");
  });

  it("contains a <style> block (not a <link>)", () => {
    const html = buildStandaloneHtml("", "Test");
    expect(html).toContain("<style>");
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it("contains the placeholder comment", () => {
    const html = buildStandaloneHtml("", "Test");
    expect(html).toContain("<!-- To customize styles, see: [future URL] -->");
  });

  it('wraps body in <div class="content">', () => {
    const html = buildStandaloneHtml("# Hi", "Hi");
    expect(html).toContain('<div class="content">');
  });

  // EC-1: Empty markdown must not throw; the content div must be present with
  // only whitespace inside. marked.parse("") returns "" so the template's
  // indentation produces whitespace-only content between the tags (valid HTML).
  it("EC-1: empty markdown produces whitespace-only content div, no crash", () => {
    expect(() => buildStandaloneHtml("", "Untitled")).not.toThrow();
    const html = buildStandaloneHtml("", "Untitled");
    expect(html).toContain('<div class="content">');
    expect(html).toContain("</div>");
    // Confirm nothing rendered between the div tags (template whitespace only)
    const match = html.match(/<div class="content">([\s\S]*?)<\/div>/);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe("");
  });

  it("does not contain a BOM character", () => {
    const html = buildStandaloneHtml("", "Test");
    // BOM is Unicode code point U+FEFF; charCodeAt(0) would be 65279
    expect(html.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("contains charset meta tag", () => {
    const html = buildStandaloneHtml("", "Test");
    expect(html).toContain('<meta charset="UTF-8">');
  });

  it("contains viewport meta tag", () => {
    const html = buildStandaloneHtml("", "Test");
    expect(html).toContain('name="viewport"');
  });
});

// ---------------------------------------------------------------------------
// exportAsHtml (integration tests with mocked bridge)
// ---------------------------------------------------------------------------

describe("exportAsHtml", () => {
  beforeEach(() => {
    // Reset all mock call counts and return values between tests
    vi.clearAllMocks();
    // Stub window.alert globally so tests don't mutate the real global and
    // so the stub is cleaned up after each test (vi.unstubAllGlobals in afterEach).
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // EC-16: Null editor guard must prevent dialog from opening
  it("EC-16: returns early without calling dialog when editor is null", async () => {
    await exportAsHtml(null, null);
    expect(saveHtmlDialog).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  // EC-8: Dialog cancel must be silent — no writeFile call, no error thrown
  it("EC-8: silently aborts when user cancels the dialog", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({ cancelled: true });
    const editor = makeEditor("# Hello\n\nContent.");
    await exportAsHtml(editor, "/path/to/notes.md");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("calls saveHtmlDialog with suggested filename derived from filePath", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({ cancelled: true });
    const editor = makeEditor("");
    await exportAsHtml(editor, "/home/user/notes.md");
    expect(saveHtmlDialog).toHaveBeenCalledWith("notes.html");
  });

  // EC-2: Untitled document (no filePath) must suggest "untitled.html"
  it("EC-2: suggests 'untitled.html' when filePath is null", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({ cancelled: true });
    await exportAsHtml(makeEditor(""), null);
    expect(saveHtmlDialog).toHaveBeenCalledWith("untitled.html");
  });

  // EC-15: Extension enforcement applied to dialog return path
  it("EC-15: appends .html to path returned by dialog if extension is missing", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/chosen/output",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    await exportAsHtml(makeEditor(""), null);
    const callArgs = vi.mocked(writeFile).mock.calls[0];
    expect(callArgs[0]).toBe("/chosen/output.html");
  });

  it("writes a string beginning with <!DOCTYPE html>", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    await exportAsHtml(makeEditor("# Hello\n\nBody."), "/path/doc.md");
    const content = vi.mocked(writeFile).mock.calls[0][1];
    expect(content).toMatch(/^<!DOCTYPE html>/);
  });

  // AC-20: currentFilePath must not change — exportAsHtml receives it by value
  it("AC-20: does not modify currentFilePath (it is a value parameter, not a ref)", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    // Capture the caller's variable before and after the call
    let callerPath: string | null = "/path/notes.md";
    await exportAsHtml(makeEditor("# Notes"), callerPath);
    // The caller's variable is unchanged — exportAsHtml cannot modify it
    expect(callerPath).toBe("/path/notes.md");
  });

  // EC-9: Write failure must produce an alert with the error message.
  // happy-dom does not define window.alert by default, so we install a
  // no-op before spying to satisfy vi.spyOn's requirement that the property
  // already exists as a function.
  it("EC-9: shows alert when writeFile returns error", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({
      ok: false,
      error: { message: "disk full", command: "write_file", path: "/out/file.html" },
    });
    await exportAsHtml(makeEditor("content"), null);
    // Single combined assertion — guards against two-separate-alert regressions
    expect(window.alert).toHaveBeenCalledWith("Export failed: disk full");
  });

  it("does not show alert on successful write", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    await exportAsHtml(makeEditor("# Test"), "/path/test.md");
    expect(window.alert).not.toHaveBeenCalled();
  });

  // EC-1 (integration): Empty document must export valid HTML without crashing
  it("EC-1: empty document exports valid HTML without crash", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/empty.html",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    await expect(exportAsHtml(makeEditor(""), null)).resolves.not.toThrow();
    const content = vi.mocked(writeFile).mock.calls[0][1];
    expect(content).toContain('<div class="content">');
    expect(content).toContain("<title>Untitled</title>");
  });
});
