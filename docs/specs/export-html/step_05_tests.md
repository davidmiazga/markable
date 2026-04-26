# Step 05 — Tests (`tests/export.test.ts`)

**Goal:** Write a Vitest test file that covers all 20 edge cases from `active_task.md` and verifies the public API of `src/lib/export.ts`. All pure functions are tested without mocks. The orchestration function `exportAsHtml` is tested with mocked bridge functions.

**Requirement references:** AC-24 (all 20 ECs covered), AC-25 (test count increases), AC-21 (`tsc --noEmit` passes)

**Prerequisite:** step_03 complete (`src/lib/export.ts` exists and exports all functions).

---

## Test Environment Notes

- Test runner: Vitest (already configured, `vitest.config.ts` or via `vite.config.ts`).
- DOM environment: `happy-dom` is already in `devDependencies`. Set `environment: 'happy-dom'` in the test file or in the Vitest config if not already set globally.
- `marked` is a real production dependency — import it directly in tests. No mock needed for `marked.parse`.
- The Tauri `invoke` function is NOT available in the test environment. `saveHtmlDialog` and `writeFile` are bridge functions that call `invoke`. These must be mocked via `vi.mock`.
- `alert` is a browser global. In `happy-dom` it exists as a no-op. Spy on it with `vi.spyOn(window, 'alert')`.

---

## File to Create

**`tests/export.test.ts`** — new file.

---

## Mock Strategy

The test file mocks `src/lib/bridge.ts` at the module level so that `saveHtmlDialog` and `writeFile` never call Tauri `invoke`:

```typescript
vi.mock("../src/lib/bridge", () => ({
  saveHtmlDialog: vi.fn(),
  writeFile: vi.fn(),
  // other bridge exports that may be transitively imported:
  readFile: vi.fn(),
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  updateRecentFilesMenu: vi.fn(),
  listThemes: vi.fn(),
  readThemeCss: vi.fn(),
  updateThemeMenu: vi.fn(),
}));
```

In each test that calls `exportAsHtml`, configure the mock return values with `vi.mocked(saveHtmlDialog).mockResolvedValue(...)` and `vi.mocked(writeFile).mockResolvedValue(...)`.

---

## Complete Test Specification

### Imports and Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// Helper: minimal EditorView stub with a given content string
function makeEditor(content: string) {
  return {
    state: {
      doc: {
        toString: () => content,
      },
    },
  } as any;
}
```

---

### `escapeHtml` tests

```typescript
describe("escapeHtml", () => {
  it("escapes & < > \" '", () => {
    expect(escapeHtml('a & b < c > d " e \' f')).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &#39; f"
    );
  });

  it("returns unchanged string when no special characters", () => {
    expect(escapeHtml("Hello world")).toBe("Hello world");
  });

  // EC-5
  it("EC-5: escapes H1 text with HTML special characters", () => {
    expect(escapeHtml("Notes <draft> & ideas")).toBe(
      "Notes &lt;draft&gt; &amp; ideas"
    );
  });
});
```

---

### `extractTitle` tests

```typescript
describe("extractTitle", () => {
  // EC-3
  it("EC-3: returns filename stem when no H1 but filePath present", () => {
    expect(extractTitle("Some paragraph text.", "/home/user/notes.md")).toBe("notes");
  });

  // EC-2
  it("EC-2: returns 'Untitled' when no H1 and no filePath", () => {
    expect(extractTitle("", null)).toBe("Untitled");
  });

  it("returns H1 text when ATX H1 is present", () => {
    expect(extractTitle("# My Title\n\nBody text.", null)).toBe("My Title");
  });

  // EC-4
  it("EC-4: uses only the FIRST H1 when multiple are present", () => {
    const md = "# First\n\n## Sub\n\n# Second\n\nText.";
    expect(extractTitle(md, null)).toBe("First");
  });

  // EC-5
  it("EC-5: HTML-escapes H1 text containing < > &", () => {
    expect(extractTitle("# Notes <draft> & ideas", null)).toBe(
      "Notes &lt;draft&gt; &amp; ideas"
    );
  });

  // EC-6
  it("EC-6: HTML-escapes filename-derived title", () => {
    expect(extractTitle("", "/path/to/report<2026>.md")).toBe(
      "report&lt;2026&gt;"
    );
  });

  // EC-10
  it("EC-10: setext H1 (=== underline) does NOT match ATX scan — falls back to filename", () => {
    const md = "My Setext Title\n===============\n\nBody.";
    expect(extractTitle(md, "/path/to/doc.md")).toBe("doc");
  });

  // EC-19
  it("EC-19: H1 on last line with no trailing newline is found", () => {
    expect(extractTitle("Some text\n# Last Line Title", null)).toBe(
      "Last Line Title"
    );
  });

  // EC-17
  it("EC-17: non-.md extension in filePath is replaced correctly", () => {
    expect(extractTitle("No heading here.", "/docs/report.txt")).toBe("report");
  });

  // EC-18
  it("EC-18: filePath with no extension uses full filename as stem", () => {
    expect(extractTitle("No heading.", "/path/to/README")).toBe("README");
  });
});
```

---

### `deriveExportFilename` tests

```typescript
describe("deriveExportFilename", () => {
  // EC-2
  it("EC-2: null filePath returns 'untitled.html'", () => {
    expect(deriveExportFilename(null)).toBe("untitled.html");
  });

  it("replaces .md with .html", () => {
    expect(deriveExportFilename("/home/user/notes.md")).toBe("notes.html");
  });

  // EC-17
  it("EC-17: replaces any extension with .html", () => {
    expect(deriveExportFilename("/docs/report.txt")).toBe("report.html");
  });

  // EC-18
  it("EC-18: appends .html when filename has no extension", () => {
    expect(deriveExportFilename("/path/to/README")).toBe("README.html");
  });
});
```

---

### `enforceHtmlExtension` tests

```typescript
describe("enforceHtmlExtension", () => {
  // EC-15
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
```

---

### `markdownToHtml` tests

```typescript
describe("markdownToHtml", () => {
  it("converts a heading to <h1>", () => {
    const result = markdownToHtml("# Hello");
    expect(result).toContain("<h1>Hello</h1>");
  });

  it("converts bold to <strong>", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
  });

  // EC-7
  it("EC-7: raw HTML blocks pass through unchanged", () => {
    const md = "Before\n\n<div class=\"custom\">raw html</div>\n\nAfter";
    const result = markdownToHtml(md);
    expect(result).toContain('<div class="custom">raw html</div>');
  });

  // EC-12
  it("EC-12: code fence with language tag renders with language class", () => {
    const md = "```rust\nfn main() {}\n```";
    const result = markdownToHtml(md);
    expect(result).toContain("language-rust");
    expect(result).toContain("fn main()");
  });

  // EC-13
  it("EC-13: task list items render with checkbox input elements", () => {
    const md = "- [ ] unchecked\n- [x] checked";
    const result = markdownToHtml(md);
    // marked GFM renders task lists as <input type="checkbox" disabled>
    expect(result).toContain("checkbox");
    expect(result).toContain("unchecked");
    expect(result).toContain("checked");
  });

  // EC-14
  it("EC-14: link with special characters in URL renders with escaped href", () => {
    const md = "[link](https://example.com/path?a=1&b=2)";
    const result = markdownToHtml(md);
    expect(result).toContain("href=");
    // marked handles URL encoding; the href should not break HTML
    expect(result).toContain("example.com");
  });

  // EC-1
  it("EC-1: empty markdown returns empty string or whitespace only", () => {
    const result = markdownToHtml("");
    expect(result.trim()).toBe("");
  });
});
```

---

### `buildStandaloneHtml` tests

```typescript
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

  it("wraps body in <div class=\"content\">", () => {
    const html = buildStandaloneHtml("# Hi", "Hi");
    expect(html).toContain('<div class="content">');
  });

  // EC-1
  it("EC-1: empty markdown produces empty content div, no crash", () => {
    expect(() => buildStandaloneHtml("", "Untitled")).not.toThrow();
    const html = buildStandaloneHtml("", "Untitled");
    expect(html).toContain('<div class="content">');
    expect(html).toContain("</div>");
  });

  it("does not contain a BOM character", () => {
    const html = buildStandaloneHtml("", "Test");
    expect(html.charCodeAt(0)).not.toBe(0xFEFF);
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
```

---

### `exportAsHtml` integration tests (mocked bridge)

```typescript
describe("exportAsHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // EC-16
  it("EC-16: returns early without calling dialog when editor is null", async () => {
    await exportAsHtml(null, null);
    expect(saveHtmlDialog).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  // EC-8
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

  // EC-2
  it("EC-2: suggests 'untitled.html' when filePath is null", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({ cancelled: true });
    await exportAsHtml(makeEditor(""), null);
    expect(saveHtmlDialog).toHaveBeenCalledWith("untitled.html");
  });

  // EC-15
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

  // AC-20
  it("AC-20: does not modify currentFilePath (it is a value parameter, not a ref)", async () => {
    // currentFilePath is passed by value; exportAsHtml cannot modify the
    // caller's variable. This test confirms the function does not throw or
    // attempt to re-assign the parameter.
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    let callerPath: string | null = "/path/notes.md";
    await exportAsHtml(makeEditor("# Notes"), callerPath);
    // callerPath is unchanged — exportAsHtml does not return a new path
    expect(callerPath).toBe("/path/notes.md");
  });

  // EC-9
  it("EC-9: shows alert when writeFile returns error", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({
      ok: false,
      error: { message: "disk full", command: "write_file", path: "/out/file.html" },
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await exportAsHtml(makeEditor("content"), null);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Export failed:")
    );
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("disk full")
    );
  });

  it("does not show alert on successful write", async () => {
    vi.mocked(saveHtmlDialog).mockResolvedValue({
      cancelled: false,
      path: "/out/file.html",
    });
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: undefined });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await exportAsHtml(makeEditor("# Test"), "/path/test.md");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  // EC-1 (integration path)
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
```

---

## Edge Case Coverage Summary

The following table confirms every EC is addressed by at least one test or an inline comment in `export.ts`.

| EC | Test(s) | Or inline comment |
|---|---|---|
| EC-1 | `buildStandaloneHtml EC-1`, `markdownToHtml EC-1`, `exportAsHtml EC-1` | `buildStandaloneHtml` comment |
| EC-2 | `extractTitle EC-2`, `deriveExportFilename EC-2`, `exportAsHtml EC-2` | `exportAsHtml` comment |
| EC-3 | `extractTitle EC-3` | |
| EC-4 | `extractTitle EC-4` | |
| EC-5 | `extractTitle EC-5`, `escapeHtml EC-5` | |
| EC-6 | `extractTitle EC-6` | |
| EC-7 | `markdownToHtml EC-7` | `markdownToHtml` comment |
| EC-8 | `exportAsHtml EC-8` | `exportAsHtml` comment |
| EC-9 | `exportAsHtml EC-9` | `exportAsHtml` comment |
| EC-10 | `extractTitle EC-10` | `extractTitle` comment |
| EC-11 | | `markdownToHtml` comment (no test needed — runtime only) |
| EC-12 | `markdownToHtml EC-12` | `markdownToHtml` comment |
| EC-13 | `markdownToHtml EC-13` | `markdownToHtml` comment |
| EC-14 | `markdownToHtml EC-14` | `markdownToHtml` comment |
| EC-15 | `enforceHtmlExtension EC-15`, `exportAsHtml EC-15` | `enforceHtmlExtension` comment |
| EC-16 | `exportAsHtml EC-16` | `exportAsHtml` comment |
| EC-17 | `extractTitle EC-17`, `deriveExportFilename EC-17` | |
| EC-18 | `extractTitle EC-18`, `deriveExportFilename EC-18` | |
| EC-19 | `extractTitle EC-19` | `extractTitle` comment |
| EC-20 | | step_01 pre-condition (build failure — not a runtime test) |

EC-11 and EC-20 have no test cases by design: EC-11 is a runtime performance concern not verifiable in unit tests; EC-20 is a build-time pre-condition verified by completing step_01 before step_03.

---

## Running the Tests

```bash
npm run test:run
```

Or for watch mode during development:

```bash
npm test
```

All new tests must pass. Existing tests must continue to pass (no regressions).

---

## Acceptance Criteria for This Step

- [ ] `tests/export.test.ts` exists.
- [ ] All tests in `export.test.ts` pass with `npm run test:run`.
- [ ] All pre-existing tests continue to pass.
- [ ] `npx tsc --noEmit` still passes.
- [ ] Every one of the 20 ECs is addressed by a test or an inline comment referencing the EC number. (AC-24)
- [ ] Total Vitest test count is greater than the pre-export baseline of 34. (AC-25)
- [ ] No TODO comments in `tests/export.test.ts`.

---

## What NOT to Do

- Do not mock `marked` itself — use the real library. The tests verify correct integration.
- Do not write snapshot tests for the full HTML output — the structure is verified by targeted `toContain` assertions that are stable across minor whitespace changes.
- Do not use `it.skip` or `it.todo` for any EC — every EC must have a test or a documented inline comment. `it.todo` stubs count against the requirement.
