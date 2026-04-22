---
title: "Unified Export Command (HTML + PDF)"
last-updated: "2026-04-21"
review-cadence-days: 7
status: reference
---

# Unified Export Command (HTML + PDF) — Requirements Spec

## Validation Status

**VALIDATED — requirements approved by user. Ready for architecture phase.**

---

## Summary

As a user, I want the existing "Export as HTML..." command to also offer PDF as a second format option, so that I can export to HTML or PDF from a single command without losing the Print menu item or its shortcut.

---

## Background and Motivation

The app currently has two export-adjacent menu items in the File menu:

- **"Export as HTML..."** (`Cmd-Alt-E`, menu ID `file-export`) — implemented in `src/lib/export.ts`. Reads raw Markdown from the editor, converts it with `marked`, assembles a self-contained HTML5 document (embedded `MINIMAL_CSS`), and writes it to a user-chosen path via the `save_html_dialog` Tauri command + `write_file` atomic swap. The keybinding is registered in `src/keybindings/keybindings-panel.ts` and the action is dispatched in `src/main.ts`.
- **"Print..."** (`Cmd-P`, menu ID `file-print`) — implemented as `printDocument()` in `src/main.ts`. Injects a rendered HTML overlay + print-only stylesheet into the DOM, calls `window.print()` (which surfaces the macOS system print dialog, where the user can choose "Save as PDF"), then removes the overlay on close.

The goal is to extend "Export as HTML..." into a unified **"Export..."** command that presents a format choice (HTML or PDF) before proceeding. The Print menu item, its shortcut `Cmd-P`, and its command bar entry remain completely untouched.

---

## Goals

1. Rename the existing "Export as HTML..." menu item to **"Export..."**, keeping the same ID (`file-export`) and the same shortcut (`Cmd-Alt-E`). No shortcut change.
2. When the export command fires, present a format selection step (HTML or PDF) before opening any save or print dialog.
3. Preserve all existing HTML export behaviour exactly (`src/lib/export.ts` is not replaced — it is called by the new orchestrator).
4. Preserve the existing PDF/print behaviour (`printDocument()` logic migrates into the new orchestrator and is also reachable via the format picker).
5. No new Rust Tauri commands are required for the initial scope (the existing `save_html_dialog` and `write_file` commands are reused).
6. **"Print..."** (`file-print`, `Cmd-P`) is left exactly as-is: menu item, shortcut, command bar entry, and handler are not touched.

---

## Functional Requirements

### FR-01: Menu Changes

**FR-01.1** The Rust `menu.rs` file must rename the existing `"Export as HTML..."` menu item label to `"Export..."`. The item ID (`file-export`) and accelerator (`CmdOrCtrl+Alt+E`) are unchanged.

**FR-01.2** The `"Print..."` menu item (ID `file-print`, accelerator `CmdOrCtrl+P`) must remain in the File menu exactly as it is. No change to its label, ID, shortcut, position, or enabled state.

**FR-01.3** The File menu order around the export area remains structurally identical to today. Only the label of `file-export` changes:
```
Save As...
Save as Template...
--- (separator)
Export...          Cmd-Alt-E      ← renamed from "Export as HTML..."
Import...          Cmd-Alt-Shift-I
--- (separator)
Print...           Cmd-P          ← untouched
Close
Close All
```

### FR-02: Keybinding Updates

**FR-02.1** In `src/keybindings/keybindings-panel.ts`, the entry for `file-export` must update its label from `"Export as HTML"` to `"Export..."`. The `defaultKey` (`"Cmd-Alt-E"`) is unchanged.

**FR-02.2** The entry for `file-print` must remain in `KEYBINDING_DEFS` exactly as-is.

**FR-02.3** The existing `resolveAction()` keybinding lookup continues to work for `file-export` with the unchanged default key.

### FR-03: Format Selection UX

The user picks the export format before a file-picker or print dialog appears. Two implementation options are acceptable; the Architect must evaluate and commit to one.

**Option A — Native accessory view (NSSavePanel NSPopUpButton)**
A Rust/AppKit interop layer adds a "Format:" `NSPopUpButton` accessory view to the `NSSavePanel`. The user picks format and save location in a single native macOS sheet (identical to the TextEdit / Pages "Format:" dropdown pattern). This requires a new Tauri command that wraps `NSSavePanel` directly and accepts a format parameter.

**Option B — Minimal in-app sheet (acceptable fallback)**
A small HTML overlay anchored to the bottom of the editor window shows only a "Format: [HTML / PDF]" dropdown and an "Export" button. Confirming the sheet closes it and immediately opens either the Tauri native `save()` dialog (HTML path, with `.html` filter) or the macOS print dialog (PDF path). The overlay is not a full-viewport scrim modal; it is a compact sheet attached to the window chrome.

The Architect must call out which option is more feasible given Tauri v2's Rust/AppKit interop story and select one approach for the implementation spec. If Option A is chosen, it supersedes the FR-08 modal details below (which apply only to Option B).

**FR-03.1** Regardless of which option is chosen, the user must be able to select HTML or PDF and Cancel in a single interaction step.

**FR-03.2** Cancelling (Escape, Cancel button, or closing the sheet) must dismiss with no further action — no save dialog, no print dialog, no error.

**FR-03.3** Each invocation starts with HTML as the default / pre-selected format.

**FR-03.4** The format selection step is stateless — the last-chosen format is not persisted between sessions.

### FR-04: HTML Export Path (Post Format Selection)

**FR-04.1** When the user selects HTML, the flow must call the existing `exportAsHtml(editor, currentFilePath)` function from `src/lib/export.ts` without modification. All existing HTML export behaviour is preserved:
- Native save dialog with `.html` filter and a suggested filename derived from the current file.
- Self-contained HTML5 document assembled via `buildStandaloneHtml()` with `MINIMAL_CSS` embedded.
- Atomic write via `writeFile()` (temp-file-swap).
- Silent success; `alert()` on write failure.
- No modification to `currentFilePath` / tab state.

**FR-04.2** The suggested filename is derived using the existing `deriveExportFilename()` function: replaces the file extension with `.html`; untitled documents use `"untitled.html"` (existing behaviour — no warning needed).

### FR-05: PDF Export Path (Post Format Selection)

**FR-05.1** When the user selects PDF, the app must trigger the macOS system print dialog (which includes the native "Save as PDF" option). No bundled headless browser or third-party PDF library is used.

**FR-05.2** The PDF path must use the existing `printDocument()` mechanism: inject a rendered HTML overlay + print-only `@media print` stylesheet, call `window.print()`, then clean up.

**FR-05.3** `printDocument()` must be refactored out of `src/main.ts` and into `src/lib/export.ts` (alongside `exportAsHtml`). Function signature: `printDocument(editor: EditorView | null): void`. It receives the editor as a parameter (same pattern as `exportAsHtml`) to avoid circular imports.

**FR-05.4** The print overlay is injected into `document.body` just before `window.print()` is called and removed immediately after `window.print()` returns.

**FR-05.5** If `editor` is null when `printDocument()` is called, the function returns immediately.

**FR-05.6** The `@media print` stylesheet must hide the entire editor UI (`.cm-editor`, the sidebar, the toolbar, the status bar, the tab bar) and show only `#markable-print-overlay`.

### FR-06: Main.ts Dispatch Changes

**FR-06.1** The `case "file-export"` branch in the `handleMenuEvent` switch must be replaced with a call to the new unified export orchestrator: `void openExportDialog(editor, tabManager.getActiveFilePath())`.

**FR-06.2** The `case "file-print"` branch must remain untouched in the switch. Its existing handler (`printDocument()` or equivalent) continues to work independently of the `file-export` path.

**FR-06.3** The `openExportDialog` function is the entry point orchestrator. It is responsible for: (a) showing the format selection step, (b) routing to `exportAsHtml` or `printDocument` based on the user's selection, and (c) handling cancellation.

**FR-06.4** `openExportDialog` must be defined in `src/lib/export.ts` and imported into `src/main.ts`. Function signature: `openExportDialog(editor: EditorView | null, currentFilePath: string | null): Promise<void>`.

### FR-07: Command Bar

**FR-07.1** The command bar entry for `"file-print"` must remain exactly as-is — label, context-invalid dimming, and ranking are unchanged.

**FR-07.2** The label displayed in the command bar for `"file-export"` must update from `"Export as HTML"` to `"Export..."` to match the renamed menu item. If the command bar reads labels from `KEYBINDING_DEFS`, updating that array (FR-02.1) is sufficient. If it maintains its own label map, that map must also be updated.

**FR-07.3** The context-invalid dimming for `"file-export"` continues to work (the action remains in `REQUIRES_FILE_IDS`).

### FR-08: In-App Sheet Details (Option B only)

These requirements apply only if the Architect selects Option B from FR-03.

**FR-08.1** The format sheet is a pure TypeScript/HTML/CSS component. No third-party component library.

**FR-08.2** The sheet must be keyboard-navigable: Tab/Shift-Tab cycles focus between format options and Cancel; Enter/Space activates the focused choice; Escape cancels.

**FR-08.3** The sheet must be created and destroyed on each invocation (destroy-on-close, not hide-on-close). A guard must prevent double-instantiation if invoked while already open.

**FR-08.4** The sheet must close itself before handing off to the next step (save dialog or print dialog). It must not remain visible while the native OS dialog is showing.

**FR-08.5** The sheet must be styled using `--ui-font`, `--accent-color`, and existing theme CSS variables so it adapts to light/dark theme automatically.

**FR-08.6** No animation is required in v1.

---

## Non-Functional Requirements

**NFR-01: No Unneeded New Rust Commands** — If Option A is chosen, one new Tauri command wrapping `NSSavePanel` with an accessory view is acceptable. If Option B is chosen, no changes to `src-tauri/src/commands/` are required.

**NFR-02: Backward Compatibility** — Existing unit tests for `src/lib/export.ts` (pure functions: `escapeHtml`, `extractTitle`, `deriveExportFilename`, `enforceHtmlExtension`, `markdownToHtml`, `buildStandaloneHtml`) must continue to pass unchanged. The new code must not alter those function signatures.

**NFR-03: No Settings Persistence** — The last-chosen export format is not persisted to `settings.json`. The format selection step always defaults to HTML.

**NFR-04: Accessibility** — The format selection step must meet minimum ARIA requirements. Full WCAG AA compliance is a stretch goal, not a hard requirement for v1.

**NFR-05: No Source-Mode Restriction** — The export command must be available regardless of whether the editor is in live-preview mode or source mode. Both HTML and PDF paths call `markdownToHtml()` independently of the CM6 view state.

---

## Integration Points

| Module | Change | Notes |
|---|---|---|
| `src-tauri/src/menu.rs` | Rename "Export as HTML..." label to "Export..." | ID (`file-export`) and accelerator (`CmdOrCtrl+Alt+E`) unchanged. `file-print` untouched. |
| `src/lib/export.ts` | Add `openExportDialog()`, `printDocument()`, format selection step creation | `exportAsHtml` and all pure functions are unchanged |
| `src/main.ts` | Update `case "file-export"` dispatch; keep `case "file-print"` unchanged; remove inline `printDocument()` definition; update import | `printDocument` moves to `export.ts` |
| `src/keybindings/keybindings-panel.ts` | Update `file-export` label to "Export..."; keep `file-print` entry unchanged | `defaultKey` for `file-export` unchanged |
| `src/plugins/command-bar/command-bar.plugin.ts` | Update `file-export` label if command bar has its own label map | `file-print` entry untouched |

---

## Out of Scope (v1)

1. **Additional export formats** — DOCX, Markdown (copy), plain text, EPUB. The format picker lists exactly HTML and PDF.
2. **Export settings panel** — No new settings UI for controlling export CSS, page size, margins, or paper orientation.
3. **Custom print CSS per-document** — No per-document `@page` overrides beyond what exists in `printDocument()` today.
4. **"Save as PDF" path without print dialog** — Directly producing a `.pdf` file without the system print dialog is explicitly out of scope.
5. **Remember last format** — The format selection step always resets to HTML. Persistence is a v2 consideration.
6. **Export from command bar as two separate commands** — No separate "Export as HTML" and "Export as PDF" commands are added to the command list. One `file-export` entry triggers the unified orchestrator.
7. **Exporting images as embedded base64** — The existing HTML export does not embed local images. Fixing this is a separate feature request.
8. **Any changes to Print** — `file-print`, `Cmd-P`, `printDocument()` as called from the print menu item, and the command bar Print entry are all outside the scope of this feature.

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer.

**EC-01: No editor / null editor** — User triggers Export while the editor is null (app still initialising). Expected: `openExportDialog` returns immediately; no format selection step is shown; no error is thrown.

**EC-02: Empty document** — The editor contains zero characters. Expected: format selection step opens normally; HTML path produces a valid HTML document with an empty `<div class="content"></div>`; PDF path opens print dialog showing a blank page. No crash.

**EC-03: Unsaved (untitled) document** — `currentFilePath` is null. Expected: format selection step opens; HTML save dialog pre-populates filename as `"untitled.html"`; PDF path opens print dialog. The tab/document dirty state is not modified by either path. No warning is shown (existing Untitled fallback is acceptable).

**EC-04: User cancels at the format selection step** — User opens Export, then presses Escape or clicks Cancel. Expected: format selection step dismisses silently; no save dialog opens; no print dialog opens; no error; editor state unchanged.

**EC-05: User cancels at the HTML save dialog** — User selects HTML, then cancels the native save dialog. Expected: both the format step and save dialog close silently; no file is written; editor state unchanged. (Existing `dialogResult.cancelled` guard in `exportAsHtml`.)

**EC-06: User cancels the macOS print dialog** — User selects PDF, the system print dialog appears, and the user presses Cancel. Expected: print dialog closes; print overlay is cleaned up from the DOM; no error is shown; editor state unchanged.

**EC-07: Write failure on HTML export** — `writeFile()` returns `{ ok: false, error }`. Expected: an `alert()` with the error message is shown (existing behaviour preserved). The format selection step is already closed at this point.

**EC-08: Export while in source mode (live preview off)** — The editor is in raw source mode. Expected: both HTML and PDF paths still produce correctly rendered output because they call `markdownToHtml()` independently of the CM6 view state. No `__MARKABLE_PREVIEW_ENABLED__` check is needed in the export path.

**EC-09: Export with unsaved edits (dirty state)** — The document has unsaved changes. Expected: export uses the current in-memory content (`editor.state.doc.toString()`), which includes the unsaved edits. The dirty state indicator and tab state are not modified by export.

**EC-10: Export with document that has only a YAML front matter block** — The Markdown body is empty but YAML front matter exists. Expected: `markdownToHtml()` renders the front matter as a code block or passes it through as raw text (existing `marked` behaviour); no crash; export completes.

**EC-11: No shortcut conflict** — The existing `Cmd-Alt-E` shortcut is retained. The Architect must confirm it does not conflict with any system shortcut or other binding in the current `KEYBINDING_DEFS` (it is already registered and working today, so this is a verification step rather than a new risk).

**EC-12: Format selection step focus trap (Option B only)** — While the in-app sheet is open, pressing Tab repeatedly must cycle only between format options and the Cancel/Export button. No focus must escape to the editor or sidebar.

**EC-13: Format selection step while another overlay is open (Option B only)** — If the command bar or find widget is open when Export fires. Expected: no undefined behaviour. Simplest acceptable behaviour: if the format sheet is already in the DOM, suppress duplicate instantiation.

**EC-14: Rapid double-trigger (Option B only)** — User presses `Cmd-Alt-E` twice quickly. Expected: at most one format selection sheet appears. Second invocation is suppressed if sheet is already in the DOM.

**EC-15: PDF export print overlay cleanup after print dialog error** — `window.print()` throws an unexpected exception. Expected: the print overlay and print stylesheet are still removed from the DOM (cleanup must occur in a `finally` block or equivalent).

**EC-16: HTML export — file with special characters in path/name** — The current file path contains characters like `&`, `<`, spaces, or Unicode. Expected: `extractTitle()` and `deriveExportFilename()` handle these correctly (existing behaviour preserved, covered by existing tests).

**EC-17: Modal/sheet appears on correct screen in multi-display setups (Option B only)** — The sheet is appended to `document.body` and positioned with `position: fixed`, which inherits the webview's display. No special multi-display handling needed.

**EC-18: Export command in command bar when no file is open** — `"file-export"` is in `REQUIRES_FILE_IDS`. Expected: the command bar dims the Export entry and does not invoke `openExportDialog` (existing context-invalid behaviour preserved).

**EC-19: Print menu item continues to work after this feature ships** — `file-print` / `Cmd-P` must invoke `printDocument()` (via its existing `case "file-print"` handler) exactly as before. The refactor of `printDocument` into `export.ts` must not break this path.

---

## Resolved Decisions

**AD-01 — Reuse existing `exportAsHtml` unchanged**: The HTML export function in `src/lib/export.ts` has a full suite of unit tests and a clean parameter-based API. It is called as-is from the new orchestrator.

**AD-02 — Move `printDocument` to `export.ts`**: Collocating both export functions in one module keeps the main.ts dispatch logic thin and makes both functions unit-testable. The same "pass editor as parameter to avoid circular imports" pattern already used by `exportAsHtml` applies.

**AD-03 — Format selection step is preferred as a native NSSavePanel accessory view (Option A), with an in-app sheet (Option B) as an acceptable fallback**: The user prefers a native single-step UX identical to TextEdit/Pages. The Architect must assess Tauri v2 AppKit interop feasibility and select the appropriate option.

**AD-04 — No persistent format preference in v1**: Keeping the format selection step stateless avoids a `settings.ts` schema change. Revisit if user feedback indicates the preference is tedious to re-select.

**AD-05 — Print is untouched**: The existing `file-print` menu item, `Cmd-P` shortcut, command bar entry, and `printDocument()` invocation from the print handler are completely out of scope. PDF output is available via Export > PDF as an additional path, not as a replacement for Print.

**AD-06 — Shortcut unchanged (`Cmd-Alt-E`)**: This is the same Export as HTML command with a format option added. No new shortcut is introduced. No old shortcut is changed.

---

## Proposed Constraints

1. `openExportDialog`, `printDocument` (refactored), and the format selection step creation (Option B) must all live in `src/lib/export.ts`. No new source files are required for Option B. Option A may require one new Tauri command file in `src-tauri/src/commands/`.
2. If Option B: the format sheet must be created fresh on every invocation and removed from the DOM on close. A guard must prevent double-instantiation.
3. `printDocument()` must place all DOM cleanup (style removal, overlay removal) in a `try/finally` block so cleanup is guaranteed even if `window.print()` throws.
4. The `MINIMAL_CSS` constant shared between HTML export and PDF print overlay must not be duplicated. Both code paths import it from the same location in `export.ts`.
5. All existing pure-function unit tests in `tests/` for `export.ts` must pass without modification. New tests must cover: `openExportDialog` orchestration logic (HTML routing, PDF routing, cancellation), and the refactored `printDocument` path reachable from `file-print`.
6. If Option B: the format sheet must not add any persistent global CSS to the document. Its styles must be scoped to elements created by the sheet itself (inline styles or a `<style>` block injected and removed with the sheet).
