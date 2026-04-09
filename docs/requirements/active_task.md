# Active Task: Export as HTML

**Status:** Requirements Validated
**Date:** 2026-04-09
**Revision:** 1
**Depends on:** Phase 2B Menu System (complete), Phase 2C Settings & Persistence (complete)
**Feature Checkpoint:** 1 — Base Features (File Menu: Export)

---

## Executive Summary

As a user, I want to export the current document as a standalone HTML file so that I can share my Markdown content as a self-contained web page that renders correctly in any browser without requiring Markable to be installed.

---

## Dependency Notice — `marked` Package

During codebase analysis it was confirmed that `marked` is **not present** in `package.json` and is **not installed** in `node_modules`. The user indicated it was already installed, but this is incorrect.

**Blocking action required before implementation begins:** The Lead Developer must run `npm install marked` and verify the package is added to `dependencies` in `package.json` before writing any export code. TypeScript types are available via `@types/marked` (devDependency) if not bundled with the package. The Architect must include this install step as Step 0 in the spec.

---

## Feature Scope

### In Scope

- Enable the `file-export` menu item in `menu.rs` (currently `enabled: false`).
- Add `"file-export"` to the `on_menu_event` forward list in `lib.rs`.
- Handle the `"file-export"` action in the `menu-event` listener in `main.ts`.
- Convert the current editor content (raw Markdown string from `editor.state.doc.toString()`) to HTML using `marked`.
- Wrap the resulting HTML fragment in a full standalone HTML document shell (doctype, `<html>`, `<head>`, `<body>`).
- Embed a minimal stylesheet directly in the `<head>` as a `<style>` block. No external CSS files are referenced; the exported file must be fully self-contained.
- Include a placeholder comment in the `<head>`: `<!-- To customize styles, see: [future URL] -->`.
- Derive the document `<title>` from: first H1 heading in the Markdown source, falling back to the current filename without extension, falling back to `"Untitled"`.
- Present a native save-file dialog (using the existing `saveFileDialog` bridge function) pre-populated with the suggested filename: current document name with `.html` extension (e.g., `notes.md` → `notes.html`), falling back to `untitled.html`.
- Write the final HTML string to the chosen path using the existing `writeFile` bridge function.
- Raw HTML blocks in the Markdown source pass through to the output as-is (no sanitization).
- `currentFilePath` (the tracked `.md` path) does NOT change after export — the export is fire-and-forget.

### Out of Scope

- The `file-import` menu item remains disabled. Import is not implemented in this task.
- Export formats other than HTML (PDF, DOCX, ePub, etc.) — deferred.
- Applying the user's active Markable theme to the exported HTML — the embedded stylesheet is a fixed minimal set, not derived from the active theme's CSS variables.
- Custom stylesheet selection at export time — deferred.
- Image embedding or asset resolution — images referenced in Markdown are emitted as-is; relative paths may not resolve when the HTML is opened from a different location. Deferred to a future asset-handling task.
- Syntax highlighting in exported code blocks — deferred.
- Adding the exported file to the recent files list — export does not affect `currentFilePath` or `recentFiles`.
- A progress indicator for large documents — not needed for expected document sizes.
- Exporting from a document with unsaved changes warning — export reads whatever is currently in the editor buffer; whether the buffer is saved or not is irrelevant to export.

---

## Functional Requirements

### FR-1: Enable Export Menu Item

- FR-1.1: In `src-tauri/src/menu.rs`, the `file-export` `MenuItem` is changed from `enabled: false` to `enabled: true`. The accelerator `CmdOrCtrl+Alt+E` is retained as-is.
- FR-1.2: In `src-tauri/src/lib.rs`, the string `"file-export"` is added to the `forward` match arm in `on_menu_event` so that the event is emitted to the frontend.

### FR-2: Frontend Menu Event Handling

- FR-2.1: A new `"file-export"` case is added to the `switch` block inside the `menu-event` listener in `src/main.ts`.
- FR-2.2: The case calls an `exportAsHtml()` function (defined in the same file or a dedicated module — Architect decides). The call must be `await`-safe (either the case uses `void exportAsHtml()` or the surrounding listener is async-compatible, consistent with the pattern used by existing cases such as `"file-save"`).

### FR-3: Markdown-to-HTML Conversion

- FR-3.1: The raw Markdown string is obtained from `editor.state.doc.toString()` at the moment the export is triggered. This is the same pattern used by `saveFile()`.
- FR-3.2: `marked` is used to convert the Markdown string to an HTML fragment string. The conversion must handle: headings, paragraphs, bold, italic, strikethrough, inline code, code fences, blockquotes, unordered lists, ordered lists, task lists, links, images, horizontal rules, and tables.
- FR-3.3: Raw HTML blocks in the Markdown source are passed through to the output unchanged. No HTML sanitization is applied.
- FR-3.4: The `marked` call must be synchronous or awaited correctly. If `marked` returns a `Promise` in the version installed, it must be `await`-ed. The Architect must confirm the API shape of the installed version before writing step files.

### FR-4: Standalone HTML Document Construction

The export function assembles a complete HTML string with the following structure:

- FR-4.1: The document begins with `<!DOCTYPE html>`.
- FR-4.2: The `<html lang="en">` element wraps the entire document.
- FR-4.3: The `<head>` contains:
  - `<meta charset="UTF-8">`
  - `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
  - `<title>` — see FR-5 for derivation logic.
  - `<style>` — the embedded minimal stylesheet (see FR-6).
  - The placeholder comment: `<!-- To customize styles, see: [future URL] -->`
- FR-4.4: The `<body>` contains a single `<div class="content">` wrapper, inside which the converted HTML fragment is placed.
- FR-4.5: The assembled HTML string is a single UTF-8 string. No BOM is prepended.

### FR-5: Document Title Derivation

- FR-5.1: The export function scans the raw Markdown string for the first H1 heading. An H1 is a line that matches the pattern `^# ` (ATX-style heading only — setext-style headings are ignored for simplicity). The heading text is extracted by stripping the leading `# ` prefix and trimming whitespace.
- FR-5.2: If no H1 is found, the title falls back to the current filename without its extension. This is derived from `currentFilePath` using the same `getFileName()` helper already in `main.ts`, then stripping the file extension (e.g., `notes.md` → `notes`).
- FR-5.3: If `currentFilePath` is also null (untitled document), the title falls back to the string `"Untitled"`.
- FR-5.4: The derived title string is HTML-escaped before insertion into the `<title>` element to prevent malformed HTML if the heading contains characters such as `<`, `>`, or `&`.

### FR-6: Embedded Minimal Stylesheet

- FR-6.1: The embedded stylesheet is a fixed, minimal CSS block sufficient to produce a readable document in any browser. It is defined as a constant string in the export module (not read from disk at runtime).
- FR-6.2: The stylesheet must define at minimum: a readable body font (system font stack), maximum content width centered in the viewport, line-height, heading sizes, code block styling (monospace font, background tint, padding), blockquote styling (left border, indentation), and link color.
- FR-6.3: The stylesheet must not reference any external resources (no `@import`, no external `url()` references for fonts or images). All values are self-contained.
- FR-6.4: The Architect is responsible for drafting the exact CSS content in the step file. The requirements analyst does not prescribe specific pixel values, but the result must pass a visual readability check by the user as part of acceptance criteria.

### FR-7: Save File Dialog

- FR-7.1: The export function calls the existing `saveFileDialog()` function from `src/lib/bridge.ts` (which re-exports it from `src/lib/dialogs.ts`). No new Tauri command is needed for the dialog.
- FR-7.2: The dialog is presented with a default suggested filename constructed as follows: take the filename component of `currentFilePath` (e.g., `notes.md`), replace the `.md` extension with `.html` to produce `notes.html`. If `currentFilePath` is null, the suggested filename is `untitled.html`.
- FR-7.3: The dialog must filter to show HTML files (`.html`, `.htm`) by default, but must also allow saving without a filter (so the user can type any filename). The Architect must verify whether `saveFileDialog` in `src/lib/dialogs.ts` accepts filter parameters; if not, a new dialog helper or an update to the existing one is required.
- FR-7.4: If the user cancels the dialog (`result.cancelled === true`), the export is silently aborted. No error is shown. `currentFilePath` is unchanged.
- FR-7.5: If the user confirms a path, the export proceeds to FR-8. The path chosen by the user is used as-is (the dialog is responsible for appending `.html` if the user omits it — or the export function appends `.html` if the path does not already end in `.html` or `.htm`). The Architect must decide and document the exact filename-suffix enforcement rule.

### FR-8: File Write

- FR-8.1: The assembled HTML string is written to the path returned by the save dialog using the existing `writeFile(path, content)` bridge function. This reuses the atomic temp-file-swap write pattern already in place.
- FR-8.2: If `writeFile` returns `{ ok: false }`, a native `alert()` is shown to the user with the error message: `"Export failed: " + result.error.message`. This is consistent with the error handling pattern used in `saveFile()` and `saveFileAs()`.
- FR-8.3: If `writeFile` returns `{ ok: true }`, no success notification is shown. The export is silent on success (consistent with how Save behaves).
- FR-8.4: `currentFilePath` is NOT updated after a successful export. The editor continues to track the original `.md` file path (or null if untitled).

### FR-9: Editor State Guard

- FR-9.1: The export function must check that `editor` is non-null before attempting to read `editor.state.doc.toString()`. If `editor` is null (init not yet complete), the function returns early with no visible error.

---

## Edge Case Inventory

Every item below must be covered by a test or explicit inline handling with a comment referencing the EC number. This list is the Code Reviewer's mandatory test checklist.

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | Export triggered on an empty document (zero characters in editor) | Valid empty-body export. `<body>` contains `<div class="content"></div>`. Title falls through H1 check (no H1) to filename or "Untitled". No crash. |
| EC-2 | Export triggered on an untitled document (currentFilePath is null) | Suggested filename in dialog is `untitled.html`. `<title>` is `"Untitled"`. No crash. |
| EC-3 | Document has no H1 but has a currentFilePath | `<title>` is the filename without extension (e.g., `notes.md` → `notes`). H1 scan produces no match; fallback is used. |
| EC-4 | Document has multiple H1 headings | The FIRST H1 encountered (scanning top to bottom) is used for the title. Subsequent H1s are ignored for title derivation. |
| EC-5 | H1 heading text contains HTML special characters (e.g., `# Notes <draft> & ideas`) | The title string is HTML-escaped before insertion into `<title>`. The body conversion by `marked` handles escaping within rendered content separately. |
| EC-6 | Filename contains characters that are invalid in HTML `<title>` (same as EC-5, e.g., filename `report<2026>.md`) | Filename-derived title is also HTML-escaped. |
| EC-7 | Document contains raw HTML blocks | HTML blocks pass through as-is into the exported body. The resulting file may contain the raw HTML. No sanitization. The behavior is documented as intentional. |
| EC-8 | User cancels the save dialog | Export silently aborts. `currentFilePath` unchanged. Editor content unchanged. No error shown. |
| EC-9 | `writeFile` returns an error (e.g., disk full, permissions denied on chosen path) | `alert("Export failed: " + result.error.message)` is shown. No other state changes occur. |
| EC-10 | Document contains a setext-style H1 (underline-style: text on one line, `===` on the next) | Title derivation only scans for ATX-style `^# ` headings. A setext H1 does NOT match the title scan. The title falls back to filename or "Untitled". The `marked` library still renders the setext H1 correctly in the output body. This is a documented simplification. |
| EC-11 | Document contains a very large amount of text (50,000+ characters) | `marked` conversion completes without UI freeze. If `marked` is synchronous, it runs on the main thread — acceptable for typical document sizes. If profiling shows blocking, the Architect may opt for a `setTimeout`-deferred call, but this is not required unless a regression is observed. |
| EC-12 | Document contains a code fence with a language tag (e.g., ` ```rust `) | `marked` renders it as `<pre><code class="language-rust">...</code></pre>`. No syntax highlighting is applied in the exported file (highlighting is out of scope). The code content is present and readable. |
| EC-13 | Document contains task list items (`- [ ] item` and `- [x] item`) | `marked` default behavior renders these as `<li>` elements. If `marked` does not render checkboxes by default, the output contains the raw `[ ]` / `[x]` text. The Architect must verify `marked`'s task list handling and document the result — no special rendering is required by these requirements. |
| EC-14 | Document contains a Markdown link whose URL contains `<` or `>` or `&` | `marked` handles attribute-safe escaping in generated `href` values. This is a `marked` library responsibility, not custom code. Verify and note in tests. |
| EC-15 | The file system path chosen by the user does not end in `.html` or `.htm` | The export function appends `.html` to the path (per FR-7.5, the Architect defines the rule). The written file has a `.html` extension regardless of what the user typed. |
| EC-16 | `editor` is null when export is triggered (application still initializing) | The export function returns early without any dialog or error. Consistent with the guard pattern used in `saveFile()`. |
| EC-17 | currentFilePath ends in an extension other than `.md` (e.g., `.txt`) | The suggested export filename replaces only the final extension with `.html` (e.g., `notes.txt` → `notes.html`). Path splitting logic must handle any extension, not only `.md`. |
| EC-18 | currentFilePath has no extension (e.g., file named `README` with no dot) | Suggested export filename is `README.html`. The title fallback is `README` (the full filename, no dot to strip). |
| EC-19 | Document's first H1 is on the last line with no trailing newline | The ATX scan must not require a newline after the heading line. A line matching `^# ` at the end of the string without a trailing `\n` is still a valid H1. |
| EC-20 | `marked` is not installed (package missing from node_modules) | Build fails at TypeScript import stage. This is a pre-condition failure, not a runtime edge case. The requirement to install `marked` (see Dependency Notice) must be completed before implementation begins. |

---

## Acceptance Criteria

All of the following must be true before this task is considered complete. User visual verification is required for all UI items.

### Menu Wiring
- [ ] AC-1: `File > Export` menu item is enabled and visible in the macOS menu bar.
- [ ] AC-2: Pressing `Cmd-Alt-E` triggers the export flow.
- [ ] AC-3: Clicking `File > Export` triggers the export flow.

### Save Dialog Behavior
- [ ] AC-4: The native save dialog opens when export is triggered.
- [ ] AC-5: The default suggested filename in the dialog is `[current-document-name].html` (e.g., if the open file is `notes.md`, the dialog suggests `notes.html`).
- [ ] AC-6: For an untitled document, the suggested filename is `untitled.html`.
- [ ] AC-7: Cancelling the dialog produces no file, no error, and no state change.

### Exported File Structure
- [ ] AC-8: The exported file is valid HTML5 — begins with `<!DOCTYPE html>` and contains a complete `<html>`, `<head>`, and `<body>` structure.
- [ ] AC-9: The exported file opens correctly in Safari, Firefox, and Chrome without errors.
- [ ] AC-10: The `<title>` tag contains the first H1 heading text when one is present.
- [ ] AC-11: The `<title>` tag falls back to the filename (without extension) when no H1 is present.
- [ ] AC-12: The `<title>` tag is `"Untitled"` for an untitled document with no H1.
- [ ] AC-13: The exported file contains an embedded `<style>` block (not a `<link>` to an external file).
- [ ] AC-14: The embedded stylesheet produces a readable document when the exported file is opened in a browser without any internet connection.
- [ ] AC-15: The placeholder comment `<!-- To customize styles, see: [future URL] -->` is present in the `<head>`.

### Content Fidelity
- [ ] AC-16: Headings, paragraphs, bold, italic, strikethrough, inline code, code fences, blockquotes, unordered lists, ordered lists, horizontal rules, and links all render correctly in the exported HTML when opened in a browser.
- [ ] AC-17: Raw HTML blocks in the Markdown source appear in the exported file output without modification.
- [ ] AC-18: An empty document produces an exported file with an empty `<div class="content">` — no crash, no partial output.

### Error Handling
- [ ] AC-19: If the file write fails, an alert is shown with the message `"Export failed: [error detail]"`.
- [ ] AC-20: `currentFilePath` remains pointing to the original `.md` file (or null) after a successful export — it is not changed to the `.html` path.

### Code Quality
- [ ] AC-21: All TypeScript passes `tsc --noEmit` with no errors.
- [ ] AC-22: No TODO comments in source files.
- [ ] AC-23: `marked` is listed in `dependencies` in `package.json` (not `devDependencies`).
- [ ] AC-24: All 20 edge cases are covered by tests or explicit inline handling with a comment referencing the EC number.
- [ ] AC-25: Vitest test count increases (export tests added to the frontend test suite).

---

## Technical Constraints

### TC-1: No New Rust Commands Required

The export feature requires no new Tauri backend commands. All required functionality is available via existing commands:
- `save_file_dialog` (for the save dialog)
- `write_file` (for atomic file write)

The only Rust changes are enabling the menu item (`menu.rs`) and forwarding the event (`lib.rs`).

### TC-2: `marked` Version and API Shape

The Architect must confirm the API shape of the `marked` version installed. As of `marked` v5+, the `marked(src)` function may return a `Promise<string>` rather than a `string`. The export function must `await` the result if necessary. The Architect verifies this in Step 0 of the spec and documents the correct call signature.

### TC-3: No Solo Alt- Shortcuts

The existing accelerator `CmdOrCtrl+Alt+E` uses a compound modifier and is acceptable. No new solo `Alt-` shortcuts may be introduced.

### TC-4: Atomic Write Pattern

File writes use the existing `writeFile` bridge which delegates to the Rust `write_file` command (temp-file-swap pattern). The export function must not bypass this by calling any direct Tauri FS API. This ensures data safety and consistency with the rest of the codebase.

### TC-5: No Base64 Image Embedding

Images referenced in Markdown (via `![alt](path)`) are rendered as `<img src="path">` tags in the output. The path value is not resolved or converted to a data URI. This is a known limitation documented in Out of Scope.

### TC-6: HTML Escaping Responsibility Boundary

The `marked` library is responsible for escaping Markdown-derived content inside the HTML body. The export function is additionally responsible for escaping the title string (derived from the H1 or filename) before inserting it into the `<title>` element. These are separate operations and must not be conflated.

### TC-7: Export Module Placement

The Architect decides whether `exportAsHtml()` lives in `src/main.ts` (co-located with other file operations like `saveFile`) or in a new dedicated module such as `src/lib/export.ts`. Given that the function has a pure input/output structure (Markdown string in, HTML string out for the conversion step), a dedicated module is preferred for testability. The conversion logic (step FR-3 through FR-6) should be extractable as a pure function `buildHtmlDocument(markdown: string, title: string): string` that can be unit-tested without a DOM or Tauri runtime.

---

## Impact Analysis

| Area | Impact |
|---|---|
| `src-tauri/src/menu.rs` | Change `file-export` from `enabled: false` to `enabled: true`. Minimal change. |
| `src-tauri/src/lib.rs` | Add `"file-export"` to the forwarded menu event IDs in `on_menu_event`. One-line change. |
| `src/main.ts` | Add `"file-export"` case to the `menu-event` switch block. Calls new `exportAsHtml()`. |
| `src/lib/export.ts` (new) | New module containing `buildHtmlDocument()` (pure) and `exportAsHtml()` (effectful: dialog + write). |
| `src/lib/dialogs.ts` | May require update to pass file type filters to `saveFileDialog`. Architect evaluates. |
| `package.json` | Add `marked` to `dependencies`. Add `@types/marked` to `devDependencies` if needed. |
| `tests/export.test.ts` (new) | Vitest tests for `buildHtmlDocument()` — title derivation, HTML escaping, document structure, all edge cases. |

---

## Files Expected to be Created or Modified

| File | Change Type | Summary |
|---|---|---|
| `src-tauri/src/menu.rs` | Modified | Enable `file-export` menu item |
| `src-tauri/src/lib.rs` | Modified | Forward `"file-export"` menu event to frontend |
| `src/main.ts` | Modified | Add `"file-export"` case in menu-event listener |
| `src/lib/export.ts` | New | HTML document builder + export orchestration function |
| `src/lib/dialogs.ts` | Possibly modified | Add file type filter support to `saveFileDialog` if not already present |
| `package.json` | Modified | Add `marked` (and optionally `@types/marked`) |
| `tests/export.test.ts` | New | Vitest unit tests for export logic |

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 20 items in Edge Case Inventory

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
