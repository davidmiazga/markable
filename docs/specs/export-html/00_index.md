# Export as HTML — Master Blueprint

**Feature:** Export as HTML
**Requirements source:** `docs/requirements/active_task.md`
**Status:** Architecture Complete — Awaiting Implementation
**Date:** 2026-04-09

---

## Implementation Checklist

Steps must be completed in order. Each step is gated on the previous step compiling and passing its tests.

- [x] step_01 — Add `marked` dependency and install
- [x] step_02 — Extend dialog infrastructure (new `saveHtmlDialog` command in Rust + TypeScript bridge)
- [x] step_03 — Create `src/lib/export.ts` (pure conversion + orchestration)
- [x] step_04 — Wire menu item (enable in `menu.rs`, forward in `lib.rs`, handle in `main.ts`)
- [x] step_05 — Write Vitest tests for all 20 edge cases

---

## Stack Decision

### Markdown-to-HTML Converter: `marked` v18

**Requirement:** FR-3.2 specifies `marked` by name. The requirements analyst confirmed no other library is to be evaluated.

**Validation against alternatives (for the record):**

| Library | Version (2026) | Types bundled | Return type | GFM / tables | License |
|---|---|---|---|---|---|
| `marked` | 18.x | Yes | `string` (sync default) | Yes | MIT |
| `markdown-it` | 14.x | Via `@types/markdown-it` | `string` (sync) | Via plugin | MIT |
| `remark` (unified) | 11.x | Yes | `string` (async pipeline) | Via plugin | MIT |

`marked` is the specified library, is synchronous by default (no `async: true` needed for this use case), bundles TypeScript declarations in v5+ (confirmed: v18 includes `./lib/marked.d.ts`), and requires zero additional plugins for GFM, tables, or task lists. No `@types/marked` devDependency is required.

**API shape confirmed:** `marked.parse(src: string): string` — synchronous. Import: `import { marked } from 'marked'`.

**Task list behavior (EC-13):** GFM task lists (`- [ ] item`, `- [x] item`) are rendered as `<li>` elements with `<input type="checkbox" disabled>` by `marked` when `gfm: true` (default). The checkboxes are present but non-interactive (disabled). This is acceptable and documented in step_03.

---

## High-Level Architecture

### Data Flow

```
User clicks File > Export (or presses Cmd-Alt-E)
  |
  v
Rust on_menu_event (lib.rs)
  -- emits --> "menu-event" { action: "file-export" }
  |
  v
main.ts menu-event listener
  -- calls --> exportAsHtml()  [defined in src/lib/export.ts]
  |
  v
exportAsHtml()
  1. Guard: editor null? return early (EC-16)
  2. markdown = editor.state.doc.toString()
  3. suggestedName = deriveExportFilename(currentFilePath)
  4. dialogResult = await saveHtmlDialog(suggestedName)  [bridge.ts -> dialogs.rs]
  5. dialogResult.cancelled? return early (EC-8)
  6. path = enforceHtmlExtension(dialogResult.path)  (EC-15)
  7. title = extractTitle(markdown, currentFilePath)
  8. html = buildStandaloneHtml(markdown, title)
  9. result = await writeFile(path, html)
  10. result.ok? — silent success / alert on failure (EC-9)
  currentFilePath is NEVER assigned (FR-8.4, AC-20)
```

### Separation of Concerns

| Layer | Responsibility | Location |
|---|---|---|
| Menu registration | Declare menu item, set enabled state | `src-tauri/src/menu.rs` |
| Event forwarding | Route `"file-export"` to frontend | `src-tauri/src/lib.rs` |
| Dialog (Rust) | Native save dialog with HTML filter + suggested filename | `src-tauri/src/commands/dialogs.rs` |
| Dialog (TS bridge) | Typed wrapper calling `save_html_dialog` command | `src/lib/dialogs.ts`, `src/lib/bridge.ts` |
| Orchestration | Coordinate editor read → dialog → build → write | `src/lib/export.ts` (`exportAsHtml`) |
| Pure conversion | Markdown → HTML fragment via `marked.parse()` | `src/lib/export.ts` (`markdownToHtml`) |
| Pure assembly | Wrap fragment in full HTML document shell | `src/lib/export.ts` (`buildStandaloneHtml`) |
| Title derivation | H1 scan + filename fallback + HTML escaping | `src/lib/export.ts` (`extractTitle`, `escapeHtml`) |
| Embedded CSS | Fixed minimal stylesheet constant | `src/lib/export.ts` (`MINIMAL_CSS`) |
| File write | Atomic temp-file-swap | existing `write_file` Rust command |

---

## Component Map

### Files to Create

| File | Purpose |
|---|---|
| `src/lib/export.ts` | New module: pure functions + orchestration |
| `tests/export.test.ts` | Vitest unit tests covering all 20 edge cases |

### Files to Modify

| File | Change | Scope |
|---|---|---|
| `package.json` | Add `"marked": "^18.0.0"` to `dependencies` | 1 line |
| `src-tauri/src/commands/dialogs.rs` | Add `save_html_dialog` command | ~30 lines |
| `src-tauri/src/lib.rs` | Re-export `save_html_dialog`; add to `invoke_handler!`; add `"file-export"` to forward match arm | 3 locations, ~3 lines total |
| `src/lib/dialogs.ts` | Add `saveHtmlDialog(suggestedFilename)` function | ~25 lines |
| `src/lib/bridge.ts` | Re-export `saveHtmlDialog` | 1 line |
| `src/main.ts` | Add `saveHtmlDialog` to import; add `"file-export"` case; add `exportAsHtml` call | ~5 lines |
| `src-tauri/src/menu.rs` | Change `file-export` `enabled: false` → `enabled: true` | 1 character |

---

## Key Design Decisions

### Decision 1: New `save_html_dialog` Rust command rather than parameterizing the existing `save_file_dialog`

**Rationale:** The existing `save_file_dialog` Rust command is hardcoded with a `.md`/`.txt` filter and `untitled.md` default filename. It accepts no parameters. Two options were considered:

Option A — Add parameters to `save_file_dialog` (filename, filters). This requires changing the existing command signature, the existing TypeScript bridge call sites, and could introduce regressions in the existing Save As flow.

Option B — Add a new `save_html_dialog` command that accepts a `suggested_filename: String` parameter and hardcodes the HTML filter. This is a purely additive change; the existing Save As flow is untouched.

**Decision: Option B.** Additive, no regression risk, minimal surface area. The new command follows the exact same pattern as `save_file_dialog` in `dialogs.rs`.

### Decision 2: `exportAsHtml` defined in `src/lib/export.ts`, not inline in `main.ts`

**Rationale:** TC-7 in requirements explicitly prefers a dedicated module for testability. The pure functions `buildStandaloneHtml`, `extractTitle`, `escapeHtml`, and `markdownToHtml` must be importable by Vitest without a DOM or Tauri runtime. Placing them in `main.ts` would require mocking the entire app initialization chain. The orchestration function `exportAsHtml` receives `editor` and `currentFilePath` as parameters so `main.ts` can pass them without the export module needing to import from `main.ts` (which would create a circular dependency risk).

### Decision 3: `.html` extension enforcement is the export module's responsibility (EC-15)

**Rationale:** The Tauri dialog plugin on macOS does not guarantee that the file extension matches the active filter. FR-7.5 requires the Architect to decide. The rule is: if the path returned by the dialog does not end with `.html` or `.htm` (case-insensitive), append `.html`. This check runs in `enforceHtmlExtension(path: string): string` inside `export.ts`.

### Decision 4: `marked.parse()` called synchronously, no `async: true`

**Rationale:** `marked.parse(src)` returns `string` synchronously by default. The `async: true` option is only needed when custom async `walkTokens` extensions are in use. We use no extensions. EC-11 (large documents) is acceptable on the main thread at typical Markable document sizes; no `setTimeout` deferral is needed.

### Decision 5: Minimal embedded CSS is a module-level constant

**Rationale:** FR-6.1 specifies a fixed constant, not a runtime file read. Defining it as `const MINIMAL_CSS = \`...\`` at the top of `export.ts` keeps the module self-contained and makes `buildStandaloneHtml` a pure function testable without filesystem access.

---

## Interface Contracts

### `src/lib/export.ts` — Exported API

```typescript
// Pure: no side effects, no I/O. Safe to call in Vitest without mocks.
export function escapeHtml(text: string): string

// Pure: scans raw markdown for first ATX H1 (^# text).
// Falls back to filename-without-extension from filePath, then "Untitled".
// Title string is HTML-escaped before return.
export function extractTitle(markdown: string, filePath: string | null): string

// Pure: derives the suggested save filename from filePath.
// /path/to/notes.md  -> "notes.html"
// /path/to/README    -> "README.html"  (no extension)
// null               -> "untitled.html"
export function deriveExportFilename(filePath: string | null): string

// Pure: if path does not end in .html or .htm (case-insensitive), appends ".html".
export function enforceHtmlExtension(path: string): string

// Pure: calls marked.parse(markdown) and returns the HTML fragment string.
export function markdownToHtml(markdown: string): string

// Pure: assembles the complete standalone HTML document string.
// markdown: raw Markdown source
// title: already-escaped title string (from extractTitle)
// Returns: complete UTF-8 HTML string, no BOM
export function buildStandaloneHtml(markdown: string, title: string): string

// Effectful: orchestrates the full export flow.
// editor and currentFilePath are passed in from main.ts to avoid circular imports.
// Returns Promise<void>. Handles all error cases internally (alert on write failure).
export async function exportAsHtml(
  editor: import("../editor/editor").EditorInstance | null,
  currentFilePath: string | null
): Promise<void>
```

### `src/lib/dialogs.ts` — New function

```typescript
// Calls the new save_html_dialog Rust command.
// suggestedFilename: the pre-populated filename string (e.g. "notes.html")
// Returns DialogResult: { cancelled: false, path: string } | { cancelled: true }
export async function saveHtmlDialog(suggestedFilename: string): Promise<DialogResult>
```

### `src-tauri/src/commands/dialogs.rs` — New command

```rust
#[tauri::command]
pub async fn save_html_dialog(
    app: tauri::AppHandle,
    suggested_filename: String,
) -> Result<Option<String>, String>
// Dialog behavior:
//   - filter: "HTML Files" -> ["html", "htm"]
//   - filter: "All Files"  -> ["*"]
//   - set_file_name: suggested_filename
//   - Returns Ok(Some(path)) / Ok(None for cancel) / Err(String) on failure
```

---

## Embedded CSS Specification (FR-6)

The following CSS block is to be defined verbatim as `MINIMAL_CSS` in `src/lib/export.ts`. It satisfies FR-6.1 through FR-6.4 and passes the visual readability acceptance criteria (AC-14).

```css
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
```

No `@import` rules. No external `url()` references. All values are self-contained (FR-6.3).

---

## Edge Case Coverage Map

Every EC from `active_task.md` is addressed by a specific function or guard. This map is the Code Reviewer's checklist.

| EC | Addressed by | Location |
|---|---|---|
| EC-1 | `buildStandaloneHtml` with empty string; `marked.parse("")` returns `""` | `export.ts` |
| EC-2 | `deriveExportFilename(null)` returns `"untitled.html"`; `extractTitle("", null)` returns `"Untitled"` | `export.ts` |
| EC-3 | `extractTitle` no-H1 branch falls to `filePath` sans-extension | `export.ts` |
| EC-4 | `extractTitle` uses `Array.find()` — stops at first match | `export.ts` |
| EC-5 | `escapeHtml()` applied to extracted H1 text | `export.ts` |
| EC-6 | `escapeHtml()` applied to filename-derived title | `export.ts` |
| EC-7 | `marked` default pass-through of raw HTML; no sanitizer applied | documented in `export.ts` comment |
| EC-8 | `exportAsHtml` early return when `dialogResult.cancelled` | `export.ts` |
| EC-9 | `alert("Export failed: " + result.error.message)` after `writeFile` | `export.ts` |
| EC-10 | `extractTitle` ATX-only scan; setext H1 does not match `^# ` | documented comment in `export.ts` |
| EC-11 | `marked.parse` is synchronous; acceptable at typical document sizes | documented comment in `export.ts` |
| EC-12 | `marked` renders code fence with `class="language-*"` naturally | documented in tests |
| EC-13 | `marked` GFM renders task list as `<li><input type="checkbox" disabled>` | documented in tests |
| EC-14 | `marked` escapes URLs in `href` attributes — library responsibility | documented in tests |
| EC-15 | `enforceHtmlExtension(path)` appends `.html` if needed | `export.ts` |
| EC-16 | `if (!editor) return` guard at top of `exportAsHtml` | `export.ts` |
| EC-17 | `deriveExportFilename` strips final extension via `lastIndexOf('.')` | `export.ts` |
| EC-18 | `deriveExportFilename` — no dot found: append `.html` to full filename | `export.ts` |
| EC-19 | `extractTitle` scans lines via `split('\n')` — last line with no `\n` is still a valid element | `export.ts` |
| EC-20 | Build-time failure; mitigated by step_01 completing before step_03 | step_01 |

---

## Acceptance Criteria Traceability

| AC | Step that satisfies it |
|---|---|
| AC-1, AC-2, AC-3 | step_04 (menu.rs + lib.rs) |
| AC-4, AC-5, AC-6, AC-7 | step_02 (save_html_dialog) + step_04 (main.ts wiring) |
| AC-8 through AC-15 | step_03 (buildStandaloneHtml, CSS constant) |
| AC-16, AC-17, AC-18 | step_03 (marked integration) |
| AC-19 | step_03 (writeFile error path) |
| AC-20 | step_04 (main.ts: currentFilePath not assigned) |
| AC-21, AC-22 | All steps (tsc --noEmit, no TODOs) |
| AC-23 | step_01 (package.json) |
| AC-24, AC-25 | step_05 (tests) |

---

## Deferred Work Log

Items explicitly out of scope per `active_task.md`. Log here so they are not silently lost.

- Image embedding / asset resolution (base64 data URIs for relative image paths)
- Syntax highlighting in exported code blocks (e.g., highlight.js integration)
- User-selected stylesheet at export time
- Export formats: PDF, DOCX, ePub
- Adding exported file to recent files list
- Applying active Markable theme CSS to export output
- `file-import` menu item (remains disabled)

---

## Review Request

- **Files changed**:
  - `package.json` — added `"marked": "^18.0.0"` to dependencies
  - `src-tauri/src/commands/dialogs.rs` — added `save_html_dialog` command
  - `src-tauri/src/commands/mod.rs` — re-exported `save_html_dialog`
  - `src-tauri/src/lib.rs` — added `save_html_dialog` to `pub use` and `invoke_handler!`; added `"file-export"` to forward match arm
  - `src-tauri/src/menu.rs` — enabled `file-export` menu item (`enabled: false` → `true`)
  - `src/lib/dialogs.ts` — added `saveHtmlDialog` function
  - `src/lib/bridge.ts` — re-exported `saveHtmlDialog`
  - `src/lib/export.ts` — new file: `escapeHtml`, `extractTitle`, `deriveExportFilename`, `enforceHtmlExtension`, `markdownToHtml`, `buildStandaloneHtml`, `exportAsHtml`
  - `src/main.ts` — added `import { exportAsHtml }` and `case "file-export"` switch arm
  - `tests/export.test.ts` — new file: 48 Vitest tests covering all 20 ECs

- **Steps completed**: step_01, step_02, step_03, step_04, step_05

- **Known limitations**:
  - Image embedding (base64 data URIs for relative image paths) — out of scope per active_task.md
  - Syntax highlighting in exported code blocks — out of scope per active_task.md
  - User-selected stylesheet at export time — out of scope per active_task.md
  - `file-import` menu item remains disabled — out of scope per active_task.md

- **Edge cases covered by tests**:
  - EC-1: `markdownToHtml EC-1`, `buildStandaloneHtml EC-1`, `exportAsHtml EC-1`
  - EC-2: `extractTitle EC-2`, `deriveExportFilename EC-2`, `exportAsHtml EC-2`
  - EC-3: `extractTitle EC-3`
  - EC-4: `extractTitle EC-4`
  - EC-5: `escapeHtml EC-5`, `extractTitle EC-5`
  - EC-6: `extractTitle EC-6`
  - EC-7: `markdownToHtml EC-7` + inline comment in `export.ts`
  - EC-8: `exportAsHtml EC-8`
  - EC-9: `exportAsHtml EC-9`
  - EC-10: `extractTitle EC-10` + inline comment in `export.ts`
  - EC-11: inline comment in `export.ts` (runtime performance — no unit test applicable)
  - EC-12: `markdownToHtml EC-12` + inline comment
  - EC-13: `markdownToHtml EC-13` + inline comment
  - EC-14: `markdownToHtml EC-14` + inline comment
  - EC-15: `enforceHtmlExtension EC-15` (5 tests), `exportAsHtml EC-15`
  - EC-16: `exportAsHtml EC-16`
  - EC-17: `extractTitle EC-17`, `deriveExportFilename EC-17`
  - EC-18: `extractTitle EC-18`, `deriveExportFilename EC-18`
  - EC-19: `extractTitle EC-19`
  - EC-20: build-time pre-condition — verified by step_01 completing before step_03

---

## Notes for Lead Developer

1. Complete step_01 first and verify `npm install` succeeds before touching any TypeScript.
2. The Rust `save_html_dialog` command (step_02) must be added to both `pub use` in `lib.rs` AND `tauri::generate_handler![]` — missing either will cause a silent runtime failure.
3. `exportAsHtml` in `src/lib/export.ts` must receive `editor` and `currentFilePath` as parameters. Do not import them from `main.ts` — that creates a circular dependency.
4. The `MINIMAL_CSS` constant is specified verbatim in this document under "Embedded CSS Specification". Copy it exactly.
5. All inline edge case comments must reference the EC number (e.g., `// EC-16: guard against null editor`). This is required by AC-24.

---

## Review Sign-off

- **Date**: 2026-04-09
- **Findings summary**: 0 Critical, 0 High, 3 Medium, 2 Low — all 3 Medium resolved (test file only; no production code defects were ever outstanding); 2 Low accepted (1 pre-existing Rust async pattern, 1 incomplete test assertion accepted as-is).
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified. FR-1 through FR-9, TC-1 through TC-6, and all Out-of-Scope constraints confirmed.
- **Edge case coverage**: All 20 Edge Case Inventory items (EC-1 through EC-20) covered by tests or inline EC-numbered comments per AC-24.
- **Re-review (2026-04-09)**: Three Medium fixes verified in `tests/export.test.ts` lines 320–445.
  - Finding 1 resolved: `vi.stubGlobal("alert", vi.fn())` in `beforeEach` + `vi.unstubAllGlobals()` in `afterEach` — clean setup/teardown confirmed.
  - Finding 2 resolved: EC-1 empty-document test now uses `toContain('<div class="content">')` + `toContain("<title>Untitled</title>")`, aligned with actual `marked.parse("")` output.
  - Finding 3 resolved: EC-9 now uses single `expect(window.alert).toHaveBeenCalledWith("Export failed: disk full")` — two-fragment regression guard eliminated.
- **Status**: Approved for Merge
