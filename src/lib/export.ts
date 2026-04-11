/**
 * src/lib/export.ts
 *
 * Export as HTML module for Markable 2.0.
 *
 * Provides pure conversion functions (testable in Vitest without a DOM or
 * Tauri runtime) and one async orchestration function that coordinates the
 * full export flow: read editor → open save dialog → build HTML → write file.
 *
 * Design decision: exportAsHtml receives `editor` and `currentFilePath` as
 * parameters rather than importing them from main.ts. Importing from main.ts
 * would create a circular dependency (main.ts -> bridge.ts -> dialogs.ts, and
 * export.ts -> main.ts would close the circle).
 */

import { marked } from "marked";
import markedFootnote from "marked-footnote";
import { EditorView } from "@codemirror/view";
import { saveHtmlDialog, writeFile } from "./bridge";

// Register the footnote extension globally so all marked.parse() calls support [^1] syntax.
marked.use(markedFootnote());

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// FR-6.1: Fixed, self-contained minimal stylesheet for exported HTML documents.
// FR-6.3: No @import, no external url() references. All values are self-contained.
const MINIMAL_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               Helvetica, Arial, sans-serif;
  font-size: 17px;
  line-height: 1.7;
  color: #1a1a1a;
  background: #ffffff;
}
.content {
  max-width: 720px;
  margin: 0 auto;
}
h1, h2, h3, h4, h5, h6 {
  margin-top: 2rem;
  margin-bottom: 0.5rem;
  line-height: 1.3;
  font-weight: 600;
}
h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.25rem; }
h3 { font-size: 1.25rem; }
h4 { font-size: 1.1rem; }
h5, h6 { font-size: 1rem; }
p { margin: 1rem 0; }
a { color: #0066cc; text-decoration: underline; }
a:hover { color: #004499; }
code {
  font-family: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono",
               Menlo, monospace;
  font-size: 0.875em;
  background: #f5f5f5;
  border-radius: 3px;
  padding: 0.1em 0.35em;
}
pre {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 1.25rem;
  overflow-x: auto;
  line-height: 1.5;
}
pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
}
blockquote {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border-left: 4px solid #d0d0d0;
  color: #555;
}
blockquote p { margin: 0; }
ul, ol { padding-left: 1.75rem; margin: 1rem 0; }
li { margin: 0.3rem 0; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
  font-size: 0.9em;
}
th, td {
  border: 1px solid #d0d0d0;
  padding: 0.5rem 0.75rem;
  text-align: left;
}
th { background: #f5f5f5; font-weight: 600; }
hr {
  border: none;
  border-top: 2px solid #e5e5e5;
  margin: 2rem 0;
}
img { max-width: 100%; height: auto; }
input[type="checkbox"] { margin-right: 0.4em; }
.callout {
  border-left: 4px solid #388bfd;
  padding: 0.75rem 1rem;
  margin: 1rem 0;
  border-radius: 4px;
  background: rgba(56, 139, 253, 0.06);
}
.callout-title { font-weight: 600; margin: 0 0 0.25rem; }
.callout-warning, .callout-caution, .callout-attention { border-left-color: #e6a817; background: rgba(230, 168, 23, 0.06); }
.callout-danger, .callout-error, .callout-bug { border-left-color: #da3633; background: rgba(218, 54, 51, 0.06); }
.callout-tip, .callout-hint, .callout-important, .callout-success, .callout-check, .callout-done { border-left-color: #2ea043; background: rgba(46, 160, 67, 0.06); }
.callout-question, .callout-help, .callout-faq, .callout-example { border-left-color: #a371f7; background: rgba(163, 113, 247, 0.06); }
.callout-quote, .callout-cite { border-left-color: #888; background: rgba(128, 128, 128, 0.06); }
`.trim();

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * HTML-escapes a plain text string for safe insertion into HTML attributes or
 * text nodes such as <title>.
 *
 * TC-6: The export module is responsible for escaping the title string.
 * marked is responsible for escaping within the rendered body content.
 * These are separate operations and must not be conflated.
 *
 * EC-5: H1-derived title with <, >, & characters is escaped here.
 * EC-6: Filename-derived title is also escaped here.
 *
 * @param text - Plain text string to HTML-escape
 * @returns HTML-safe string with special characters replaced by entities
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Derives the document title for the exported HTML <title> element.
 *
 * Priority order (FR-5):
 *   1. First ATX H1 heading in the Markdown source (^# text)
 *   2. Current filename without extension (from filePath)
 *   3. "Untitled" (if filePath is null)
 *
 * EC-4: Only the FIRST H1 is used. Subsequent H1s are ignored.
 * EC-5: Title text is HTML-escaped before return.
 * EC-6: Filename-derived title is HTML-escaped before return.
 * EC-10: Setext-style H1 (underline with ===) is intentionally NOT matched.
 *         Only ATX-style (^# ) is scanned. Documented simplification — setext
 *         headings require parsing two lines in context, adding complexity for
 *         an uncommon case. ATX covers the vast majority of real-world usage.
 * EC-19: Lines are produced by split('\n'). The last line of a string with no
 *         trailing newline is still a valid array element — the H1 is found.
 *
 * @param markdown - Raw Markdown source string (may be empty)
 * @param filePath - Current file path for filename fallback (may be null)
 * @returns HTML-escaped title string
 */
export function extractTitle(markdown: string, filePath: string | null): string {
  // FR-5.1: Scan for first ATX H1 — Array.find() stops at the first match (EC-4)
  const h1Line = markdown.split("\n").find((line) => /^# /.test(line));
  if (h1Line) {
    const text = h1Line.replace(/^# /, "").trim();
    // EC-5: escape before insertion into <title>
    return escapeHtml(text);
  }

  // FR-5.2: Fall back to filename without extension
  if (filePath) {
    const filename = filePath.split("/").pop() ?? filePath;
    const dotIndex = filename.lastIndexOf(".");
    // EC-18: no dot found (or dot is first char for hidden files) -> use full filename
    const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    // EC-6: escape filename-derived title
    return escapeHtml(stem);
  }

  // FR-5.3: Final fallback
  // EC-2: untitled document with no H1
  return "Untitled";
}

/**
 * Derives the suggested save filename for the HTML export dialog.
 *
 * FR-7.2: Replace the file extension with .html.
 * EC-2:  filePath null -> "untitled.html"
 * EC-17: Any extension (not just .md) is replaced.
 * EC-18: No extension -> append ".html" to the full filename.
 *
 * @param filePath - Current file path (may be null for untitled documents)
 * @returns Suggested save filename string (just the filename, not a full path)
 */
export function deriveExportFilename(filePath: string | null): string {
  if (!filePath) return "untitled.html";

  const filename = filePath.split("/").pop() ?? filePath;
  const dotIndex = filename.lastIndexOf(".");
  // EC-18: no dot found, or dot is the first character (hidden file like .gitignore)
  if (dotIndex <= 0) {
    return filename + ".html";
  }
  return filename.slice(0, dotIndex) + ".html";
}

/**
 * Ensures the given path ends in .html or .htm (case-insensitive).
 * If not, appends ".html".
 *
 * EC-15: The dialog does not guarantee the extension matches the filter on
 *         all platforms. This function enforces the rule after dialog return.
 * FR-7.5: Architect-defined rule — append ".html" if extension is absent or wrong.
 *
 * @param path - File path string returned by the save dialog
 * @returns Path guaranteed to end in .html or .htm
 */
export function enforceHtmlExtension(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return path;
  }
  return path + ".html";
}

/**
 * Converts a raw Markdown string to an HTML fragment using marked.
 *
 * FR-3.2: marked is used for conversion. GFM is enabled by default in marked v5+,
 *          which handles tables, task lists, strikethrough, etc.
 * FR-3.3: Raw HTML blocks pass through unchanged. No sanitization is applied.
 * FR-3.4: marked.parse() returns string synchronously (async: false, the default).
 *          No await is needed or used.
 *
 * EC-7:  Raw HTML pass-through is intentional. Not a bug.
 * EC-11: Synchronous execution on the main thread. Acceptable for typical document
 *         sizes. If profiling reveals blocking at 50k+ chars, introduce a
 *         setTimeout-deferred wrapper. No action required unless observed.
 * EC-12: Code fences with language tags render as <pre><code class="language-*">.
 *         No syntax highlighting is applied (out of scope per active_task.md).
 * EC-13: Task list items render as <li><input type="checkbox" disabled> text</li>
 *         with GFM enabled (marked default). Checkboxes are present but non-interactive.
 *
 * @param markdown - Raw Markdown source string (may be empty)
 * @returns HTML fragment string produced by marked
 */
export function markdownToHtml(markdown: string): string {
  // Strip Obsidian-style %%comments%% before conversion
  let cleaned = markdown.replace(/%%[\s\S]*?%%/g, "");

  // Convert Obsidian-style callouts to HTML before marked processes them.
  // Callouts use blockquote syntax: > [!TYPE] Title\n> content
  // We replace them with <div> blocks so marked doesn't wrap them in <blockquote>.
  cleaned = cleaned.replace(
    /^(> *\[!(\w+)\] *(.*)\n(?:> .*\n?)*)/gm,
    (_match) => {
      const lines = _match.split("\n").filter((l) => l.trim());
      const firstLine = lines[0];
      const typeMatch = firstLine.match(/\[!(\w+)\]\s*(.*)/);
      if (!typeMatch) return _match;
      const type = typeMatch[1].toLowerCase();
      const title = typeMatch[2] || type.charAt(0).toUpperCase() + type.slice(1);
      const body = lines.slice(1).map((l) => l.replace(/^>\s?/, "")).join("\n");
      return `<div class="callout callout-${type}"><p class="callout-title">${escapeHtml(title)}</p>\n\n${body}\n\n</div>\n\n`;
    }
  );

  // Custom renderer: parse image dimensions from alt text (Obsidian-style "alt|WxH")
  const renderer = new marked.Renderer();
  renderer.image = function ({ href, text }: { href: string; text: string }) {
    const dimMatch = text.match(/^(.*?)\s*\|\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*$/);
    if (dimMatch) {
      const alt = escapeHtml(dimMatch[1].trim());
      const w = dimMatch[2];
      const h = dimMatch[3];
      const style = h ? `width:${w}px;height:${h}px` : `width:${w}px;height:auto`;
      return `<img src="${href}" alt="${alt}" style="${style}" />`;
    }
    return `<img src="${href}" alt="${escapeHtml(text)}" />`;
  };

  return marked.parse(cleaned, { renderer }) as string;
}

/**
 * Assembles a complete, standalone HTML5 document from a Markdown source string
 * and a pre-escaped title string.
 *
 * FR-4.1: Begins with <!DOCTYPE html>
 * FR-4.2: <html lang="en"> wrapper
 * FR-4.3: <head> contains charset, viewport, <title>, <style>, placeholder comment
 * FR-4.4: <body> contains a single <div class="content"> wrapping the HTML fragment
 * FR-4.5: Single UTF-8 string, no BOM
 * FR-6.4: MINIMAL_CSS is embedded as a <style> block
 * AC-15:  Placeholder comment is present for future customization docs link
 *
 * EC-1: Empty markdown -> marked.parse("") = "" -> <div class="content"></div>. No crash.
 *
 * @param markdown - Raw Markdown source (may be empty)
 * @param title - Already HTML-escaped title string (from extractTitle)
 * @returns Complete standalone UTF-8 HTML document string with no BOM
 */
export function buildStandaloneHtml(markdown: string, title: string): string {
  const bodyFragment = markdownToHtml(markdown);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${MINIMAL_CSS}
  </style>
  <!-- To customize styles, see: [future URL] -->
</head>
<body>
  <div class="content">
${bodyFragment}  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Orchestration (effectful — not for direct use in pure unit tests)
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full Export as HTML flow.
 *
 * Receives editor and currentFilePath as parameters rather than importing them
 * from main.ts to avoid a circular dependency (main.ts imports from bridge.ts;
 * export.ts would import from main.ts if those were module-level globals there).
 *
 * FR-9.1  / EC-16: Guard against null editor.
 * FR-3.1:          Read raw Markdown from editor.state.doc.toString().
 * FR-7.2:          Derive suggested filename from currentFilePath.
 * FR-7.3 / EC-15:  Use saveHtmlDialog; enforce .html extension after dialog return.
 * FR-7.4 / EC-8:   Cancel is silent — no error, no state change.
 * FR-5   / EC-2-6: Derive title via extractTitle.
 * FR-4:            Assemble document via buildStandaloneHtml.
 * FR-8.1 / TC-4:   Write via writeFile (atomic temp-file-swap).
 * FR-8.2 / EC-9:   Alert on write failure.
 * FR-8.3:          Silent on success.
 * FR-8.4 / AC-20:  currentFilePath is NOT modified.
 *
 * @param editor - The active CodeMirror EditorView, or null if not yet initialized
 * @param currentFilePath - Path of the currently open file, or null for untitled
 * @returns Promise<void>. Handles all error cases internally (alert on write failure).
 */
export async function exportAsHtml(
  editor: EditorView | null,
  currentFilePath: string | null
): Promise<void> {
  // EC-16: Guard against null editor (application still initializing or no doc)
  if (!editor) return;

  // FR-3.1: Read raw Markdown from editor
  const markdown = editor.state.doc.toString();

  // FR-7.2: Derive suggested filename for the dialog
  const suggestedFilename = deriveExportFilename(currentFilePath);

  // FR-7.3: Present the native save dialog with HTML filter
  const dialogResult = await saveHtmlDialog(suggestedFilename);

  // EC-8 / FR-7.4: User cancelled — abort silently, no state change
  if (dialogResult.cancelled) return;

  // EC-15 / FR-7.5: Enforce .html extension regardless of what the dialog returned
  const savePath = enforceHtmlExtension(dialogResult.path);

  // FR-5: Derive document title (H1 -> filename -> "Untitled")
  const title = extractTitle(markdown, currentFilePath);

  // FR-4: Assemble complete standalone HTML document
  const html = buildStandaloneHtml(markdown, title);

  // FR-8.1: Write via atomic writeFile (TC-4: must not bypass this)
  const result = await writeFile(savePath, html);

  if (!result.ok) {
    // EC-9 / FR-8.2: Alert on write failure so the user is not left wondering
    alert("Export failed: " + result.error.message);
    return;
  }

  // FR-8.3: Silent on success — no notification, no modal
  // FR-8.4 / AC-20: currentFilePath is intentionally NOT updated here.
  //                  This export does not change the currently open document.
}
