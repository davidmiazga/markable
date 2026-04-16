---
title: "Backlinks — Foundation (FC2 #13)"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Backlinks — Foundation (FC2 #13) Requirements Spec

## Summary

As a user, I want to create wiki-links (`[[filename]]`) between my Markdown files, see them rendered as clickable links in live preview, get auto-complete suggestions when typing `[[`, and view a sidebar panel listing all files that link back to my current document — so that I can navigate a web of related notes without leaving the editor.

---

## Background and Motivation

Backlinks are a foundational PKM (Personal Knowledge Management) feature. Obsidian, Roam, and Logseq all center their workflows on bidirectional linking. Markable 2.0's FC2 roadmap lists "Backlinks (+Visualization?)" as item #13.

This spec covers **Foundation Backlinks** — a practical, scoped stepping stone before FC3's full vault/AI system. The feature introduces wiki-link syntax, auto-complete, shallow directory scanning, and a backlinks sidebar panel. Graph visualization, unlinked mentions, recursive scanning, and AI suggestions are explicitly deferred to FC3.

The implementation follows the existing plugin architecture: a single IIFE plugin (`backlinks.plugin.ts`) that registers CM6 extensions for wiki-link decorations and auto-complete, a sidebar panel for backlink listings, and a new Tauri command for directory scanning.

### Existing Infrastructure Leveraged

- **Plugin system**: `MarkablePluginAPI` provides `addExtensions()`, `registerSidebarPanel()`, `loadSettings()`, `saveSettings()`.
- **Sidebar panel system**: `SidebarManager` with accordion panels, left/right assignment, tab support when multiple panels share a side.
- **Tab manager**: `tabManager.openFileInTab(path)` for click-to-navigate, `window.__MARKABLE_CURRENT_FILE__` for current document path.
- **Live preview**: `src/editor/live-preview.ts` handles link decorations (`.cm-live-link` class, `--link-color` variable). The backlinks plugin will add its own decorations for wiki-links following the same visual style.
- **Bridge layer**: `src/lib/bridge.ts` wraps Tauri `invoke()` calls. A new `listDirectory()` function will be added here.
- **CM6 globals**: `window.__CM_VIEW__` and `window.__CM_STATE__` provide access to CM6 modules from IIFE plugins.

---

## Functional Requirements

### FR-1: Wiki-Link Syntax Recognition

**FR-1.1** The plugin recognizes wiki-link syntax: `[[filename]]` and `[[filename|display text]]`.

**FR-1.2** Recognition rules:
- Opening delimiter: exactly `[[` (two consecutive left square brackets).
- Closing delimiter: exactly `]]` (two consecutive right square brackets).
- Content between delimiters must not contain `[[`, `]]`, or newlines.
- The pipe `|` separates the target filename from optional display text. Only the first pipe is significant; subsequent pipes are part of the display text.
- Whitespace around the filename and display text is preserved verbatim (no trimming during recognition). Trimming occurs only during navigation (FR-6.3).

**FR-1.3** Wiki-links are NOT parsed by CM6's built-in Markdown parser (which does not know `[[...]]` syntax). Instead, the plugin uses a ViewPlugin or StateField that scans the document text via regex and applies decorations.

### FR-2: Live Preview Rendering

**FR-2.1** In live preview mode, when the cursor is NOT on the wiki-link's line, the plugin renders wiki-links as styled inline links:
- The `[[` and `]]` delimiters are hidden (replaced with zero-width decorations).
- For `[[filename]]`: the text "filename" is displayed with the `.cm-live-link` class (same style as standard Markdown links).
- For `[[filename|display text]]`: only "display text" is displayed; the "filename|" portion is hidden.

**FR-2.2** When the cursor IS on the wiki-link's line, the full raw syntax is shown (e.g., `[[filename|display text]]`) — consistent with how live preview handles all other Markdown syntax.

**FR-2.3** Wiki-link decorations use the existing `.cm-live-link` CSS class and `--link-color` variable. No new CSS variables are introduced for link styling.

**FR-2.4** Wiki-links inside fenced code blocks (``` or ~~~) are NOT decorated. The plugin must skip ranges that fall within `FencedCode` syntax tree nodes.

### FR-3: Click-to-Navigate (Wiki-Links in Editor)

**FR-3.1** Clicking a rendered wiki-link (in live preview mode, when decorations are visible) navigates to the target file.

**FR-3.2** Navigation behavior:
- Resolve the target filename relative to the current file's directory.
- If the target lacks a `.md` extension, append `.md` automatically.
- Call `tabManager.openFileInTab(resolvedPath)` to open the file (or switch to its existing tab).

**FR-3.3** If the target file does not exist, show an alert: "File not found: {filename}.md". Do not create the file automatically. (File creation on wiki-link click is deferred to FC3.)

**FR-3.4** Click handling uses a CM6 `EditorView.domEventHandlers({ click })` handler. The handler checks whether the click target falls within a wiki-link decoration range and, if so, prevents default behavior and navigates.

### FR-4: Auto-Complete for Wiki-Links

**FR-4.1** Typing `[[` triggers an auto-complete popup listing available `.md` files in the current file's directory.

**FR-4.2** The auto-complete source is registered via CM6's `@codemirror/autocomplete` module (`autocompletion()` with a custom `CompletionSource`).

**FR-4.3** Completion behavior:
- The completion context activates when the cursor is preceded by `[[` and the text between `[[` and the cursor contains no `]]`.
- Each completion option displays the filename without the `.md` extension.
- Selecting a completion inserts the filename (without `.md`) and appends the closing `]]` delimiter.
- Example: typing `[[no` and selecting "notes" inserts `notes]]`, resulting in `[[notes]]`.

**FR-4.4** The file list for auto-complete is populated from the directory scan (FR-5). The list is cached and refreshed on file save and tab switch events.

**FR-4.5** The current file is excluded from the completion list (a file should not link to itself).

**FR-4.6** If no `.md` files exist in the directory (other than the current file), the popup shows no results (standard CM6 autocomplete behavior — popup does not appear).

### FR-5: Directory Scanning

**FR-5.1** A new Tauri command `list_md_files` is added to the Rust backend:
- Input: `directory_path: String` — absolute path to a directory.
- Output: `Vec<String>` — filenames (not full paths) of `.md` files in the directory.
- The scan is **shallow** (non-recursive). Only immediate children of the directory are listed.
- Files are sorted alphabetically (case-insensitive).
- Hidden files (names starting with `.`) are excluded.
- The command returns an empty Vec if the directory does not exist or cannot be read.

**FR-5.2** A corresponding TypeScript bridge function `listMdFiles(directoryPath: string): Promise<string[]>` is added to `src/lib/bridge.ts`.

**FR-5.3** The plugin derives the directory path from `window.__MARKABLE_CURRENT_FILE__` by stripping the filename component. If `__MARKABLE_CURRENT_FILE__` is null (untitled document), the file list is empty and auto-complete is disabled.

### FR-6: Backlink Indexing

**FR-6.1** The plugin maintains an in-memory index mapping each sibling `.md` file to its outgoing links (both wiki-links and standard Markdown links pointing to `.md` files).

**FR-6.2** Outgoing link extraction scans file content for:
- Wiki-links: `[[target]]` and `[[target|display]]` — extract "target".
- Standard Markdown links: `[text](target.md)` and `[text](./target.md)` — extract "target.md" (relative paths only; absolute paths and URLs are ignored).

**FR-6.3** Link target normalization:
- Strip leading `./` if present.
- Append `.md` if the target has no extension.
- Trim whitespace from target names.
- Comparison is case-sensitive (macOS APFS default is case-insensitive, but the index stores original case; matching uses `localeCompare` with `sensitivity: 'base'` for case-insensitive comparison).

**FR-6.4** The index is rebuilt when:
- The plugin is enabled (initial build).
- The active tab changes (current file changed — the directory may differ).
- The active document is saved (outgoing links may have changed in the current file or the user may have created a new file).

**FR-6.5** Index rebuild is asynchronous and debounced at 300ms. During rebuild, the sidebar shows a brief "Scanning..." indicator. If a rebuild is triggered while one is in progress, the in-progress scan is abandoned and a new one starts after the debounce.

**FR-6.6** To build the index, the plugin:
1. Calls `listMdFiles()` to get sibling filenames.
2. For each sibling file, calls `readFile()` (from bridge.ts) to read its content.
3. Extracts outgoing links from the content.
4. Stores the result in a `Map<string, string[]>` (filename -> array of link targets).

**FR-6.7** The backlinks for the current file are computed by filtering the index: any file whose outgoing links include the current filename is a backlink source.

### FR-7: Backlinks Sidebar Panel

**FR-7.1** The plugin registers a sidebar panel via `api.registerSidebarPanel()` with:
- `id`: `"backlinks"`
- `title`: `"Backlinks"`
- `side`: `"right"` (default; user-assignable via Plugins Panel detail view)
- `defaultWidth`: 220

**FR-7.2** The panel content displays:
- A list of files that link to the current document.
- Each entry shows the filename (without `.md` extension) as a clickable button.
- Entries are sorted alphabetically.

**FR-7.3** Empty state: when no backlinks exist, the panel shows centered text: "No backlinks".

**FR-7.4** Loading state: while the index is being rebuilt, the panel shows centered text: "Scanning...".

**FR-7.5** Each backlink entry, when clicked, opens the linking file in a tab (or switches to its existing tab) via `tabManager.openFileInTab()`.

**FR-7.6** The panel updates when:
- The active tab changes (different file may have different backlinks).
- The index is rebuilt (new scan results available).

**FR-7.7** The panel follows the same CSS patterns as the Auto TOC panel: `.backlinks-list`, `.backlink-item`, `.backlink-empty` classes. CSS is injected via a `<style>` tag in `onEnable` and removed in `onDisable`.

### FR-8: Plugin Lifecycle

**FR-8.1** The plugin is registered as a core plugin with:
- `id`: `"backlinks"`
- `name`: `"Backlinks"`
- `version`: `"1.0.0"`
- `description`: `"Wiki-link syntax and backlink tracking"`
- `sidebarPanelId`: `"backlinks"`

**FR-8.2** `onEnable` sequence:
1. Inject CSS.
2. Build the CM6 extensions (wiki-link decorations, click handler, auto-complete).
3. Register extensions via `api.addExtensions()`.
4. Register the sidebar panel via `api.registerSidebarPanel()`.
5. Trigger initial directory scan and index build.

**FR-8.3** `onDisable` sequence (exact reversal):
1. Cancel any pending debounce timers.
2. Remove CM6 extensions via `api.removeExtensions()`.
3. Unregister sidebar panel via `api.unregisterSidebarPanel("backlinks")`.
4. Remove injected CSS.
5. Clear the in-memory index and all module-level state.

**FR-8.4** The plugin is added to the `PLUGINS` array in `scripts/build-plugins.mjs` for IIFE bundling.

---

## Non-Functional Requirements

**NFR-1: Performance — Directory Scan** — The shallow directory scan (`list_md_files`) must complete in under 50ms for directories with up to 500 `.md` files. This is a simple `read_dir` + filter operation.

**NFR-2: Performance — Index Build** — Reading and scanning up to 100 sibling files for outgoing links must complete in under 2 seconds. Files are read sequentially (not in parallel) to avoid file descriptor exhaustion. For directories with more than 200 `.md` files, the plugin logs a warning and proceeds (no hard cap).

**NFR-3: Performance — Decorations** — Wiki-link decoration scanning (regex over document text) must not cause visible lag on documents up to 50,000 lines. The ViewPlugin should bail early on transactions that don't change the document.

**NFR-4: No External Dependencies** — The plugin uses only CM6 modules already available via window globals and existing Tauri bridge functions. No new npm dependencies.

**NFR-5: CSS Theme Compatibility** — All backlinks UI elements use existing CSS variables (`--text-primary`, `--text-secondary`, `--link-color`, `--code-bg`, `--selection-bg`). The panel automatically adopts the active theme.

**NFR-6: IIFE Self-Containment** — The plugin follows all IIFE self-containment rules: no `@codemirror/*` value imports (accessed via `window.__CM_VIEW__`), no app-internal module imports, CSS injected via `<style>` tag.

---

## Architectural Decisions

**AD-1: Decoration Approach Over Custom Parser** — Wiki-links are detected via regex in a ViewPlugin rather than a custom lezer grammar extension. Rationale: IIFE plugins cannot modify the core parser; the decoration approach is proven (used by live-preview.ts for all Markdown decorations) and sufficient for `[[...]]` syntax.

**AD-2: Single Plugin File** — All backlinks functionality (decorations, auto-complete, click handler, sidebar panel, indexing) lives in one plugin file (`backlinks.plugin.ts`). This follows the pattern of auto-toc.plugin.ts and avoids splitting the feature across multiple plugins.

**AD-3: Shallow Scan Only** — The directory scan is limited to sibling files (same directory as the current document). Recursive scanning introduces vault-like semantics that belong in FC3. Shallow scan keeps the feature simple and fast.

**AD-4: Read-Only Backlinks** — Clicking a wiki-link to a non-existent file shows an alert rather than creating the file. File creation from wiki-links is a vault feature (FC3). This avoids accidental file creation from typos.

**AD-5: Case-Insensitive Matching** — Link target matching uses `localeCompare` with `sensitivity: 'base'` to handle macOS APFS case-insensitivity. A wiki-link `[[Notes]]` matches a file named `notes.md`.

**AD-6: Autocomplete via CM6 Module** — The auto-complete uses `@codemirror/autocomplete`'s `autocompletion()` API accessed via `window.__CM_AUTOCOMPLETE__`. A new global must be exposed in `src/lib/cm-globals.ts` for the autocomplete module, following the existing pattern for `__CM_VIEW__` and `__CM_STATE__`.

**AD-7: Shared readFile for Index Building** — The index builder reads sibling files using the existing `readFile()` bridge function (Tauri `read_file` command). No new bulk-read command is needed; sequential reads are adequate for the shallow-scan scope.

**AD-8: Tab Manager Integration via Window Global** — The plugin accesses the tab manager via `window.__MARKABLE_TAB_MANAGER__` (or equivalent global). If no such global exists, one must be exposed, following the pattern of `window.__MARKABLE_EDITOR_VIEW__` and `window.__MARKABLE_CURRENT_FILE__`.

---

## Out of Scope

1. **Unlinked mentions** — Scanning for plain-text filename matches without explicit link syntax. Deferred to FC3.
2. **Graph visualization** — Interactive node-edge graph view of backlinks. Deferred to FC3 (see FEATURES.md addition below).
3. **Recursive directory scanning** — Scanning subdirectories or vault-wide indexing. Deferred to FC3.
4. **AI-powered link suggestions** — Suggesting related files based on content similarity. Deferred to FC3.
5. **Block-level backlinks** — Linking to specific headings or paragraphs within a file. Deferred to FC3.
6. **File creation from wiki-links** — Clicking a broken wiki-link to create the target file. Deferred to FC3.
7. **Backlink count in status bar** — Showing a count of backlinks in the status bar. May be added in a future polish pass.
8. **Wiki-link rename propagation** — Renaming a file and updating all wiki-links that reference it. Deferred to FC3.
9. **Frontmatter-based link metadata** — Using YAML frontmatter fields as link targets or aliases. Deferred to FC3.

---

## Edge Case Inventory

**EC-1: Untitled document (no file path)** — `window.__MARKABLE_CURRENT_FILE__` is null. Expected: auto-complete is disabled (no directory to scan), backlinks panel shows "No backlinks", wiki-link click handler shows "Cannot navigate: document has no file path". Decorations still render wiki-link syntax visually.

**EC-2: Wiki-link to self** — `[[current-file]]` links to the file currently open. Expected: clicking navigates to the same file (no-op via tabManager's duplicate-path guard). The file is excluded from auto-complete suggestions (FR-4.5) but the link still renders as a styled link.

**EC-3: Wiki-link target does not exist** — `[[nonexistent]]` points to a file that is not in the directory. Expected: the link renders with normal link styling (no broken-link indicator in Foundation scope), clicking shows alert "File not found: nonexistent.md" (FR-3.3).

**EC-4: Wiki-link with display text** — `[[target|My Display Text]]` Expected: in preview mode, only "My Display Text" is shown (styled as link). Clicking navigates to "target.md".

**EC-5: Wiki-link with multiple pipes** — `[[target|text with | pipes]]` Expected: target is "target", display text is "text with | pipes" (only first pipe is the separator per FR-1.2).

**EC-6: Wiki-link inside fenced code block** — ` ```\n[[not-a-link]]\n``` ` Expected: no decoration applied, no click handler, treated as plain text (FR-2.4).

**EC-7: Nested square brackets** — `[[[text]]]` or `[[text]` (malformed). Expected: the regex matches the innermost valid `[[...]]` pair or fails to match. Malformed syntax is not decorated.

**EC-8: Wiki-link spanning multiple lines** — `[[file\nname]]` Expected: not recognized as a wiki-link (FR-1.2 forbids newlines in content). Rendered as plain text.

**EC-9: Empty wiki-link** — `[[]]` Expected: recognized as valid syntax but target is empty string. Decoration renders an empty link (zero-width). Clicking shows alert "File not found: .md". Auto-complete should still trigger between `[[` and `]]`.

**EC-10: Very long filename in wiki-link** — `[[a-filename-that-is-200-characters-long]]` Expected: decoration renders normally; file resolution proceeds normally (OS will reject if path exceeds system limit).

**EC-11: Directory with 500+ .md files** — Large directory scan. Expected: scan completes (NFR-1 budget 50ms), auto-complete shows all results filtered by typed prefix, index build may be slow but runs asynchronously with "Scanning..." indicator.

**EC-12: File saved while index build is in progress** — User saves while the debounced index rebuild is running. Expected: the in-progress build is abandoned, a new debounce cycle starts (FR-6.5).

**EC-13: Tab switch to file in different directory** — User switches from `/docs/a.md` to `/notes/b.md`. Expected: the index is fully rebuilt for `/notes/` directory. Previous index for `/docs/` is discarded.

**EC-14: Tab switch to untitled document** — User switches to a new untitled tab. Expected: index is cleared, auto-complete disabled, backlinks panel shows "No backlinks".

**EC-15: Plugin enabled then immediately disabled** — Rapid toggle. Expected: all timers cancelled, no stale index updates fire after disable, CM6 extensions cleanly removed, sidebar panel destroyed without errors.

**EC-16: Wiki-link target with path separators** — `[[subfolder/file]]` Expected: in Foundation scope (shallow scan), this will not match any sibling file. The link renders but clicking resolves to a path that likely does not exist (alert shown). This syntax becomes meaningful when recursive scanning is added in FC3.

**EC-17: Standard markdown link to .md file** — `[text](sibling.md)` in a sibling file. Expected: the backlink index detects this as an outgoing link to the current file and shows the sibling in the backlinks panel.

**EC-18: Standard markdown link with relative path** — `[text](./sibling.md)` Expected: the `./` prefix is stripped during normalization (FR-6.3), correctly matching "sibling.md".

**EC-19: Standard markdown link with absolute path or URL** — `[text](/absolute/path.md)` or `[text](https://example.com/file.md)` Expected: ignored by the backlink indexer (FR-6.2 specifies relative paths only).

**EC-20: Binary or non-UTF-8 .md file in directory** — A `.md` file that contains binary data. Expected: `readFile()` returns an error; the file is skipped during index build (logged as warning, not fatal).

**EC-21: Permission-denied file in directory** — A `.md` file that cannot be read due to permissions. Expected: `readFile()` returns an error; the file is skipped during index build (logged as warning, not fatal).

**EC-22: Auto-complete with no matching files** — User types `[[xyz` but no files start with "xyz". Expected: auto-complete popup shows no results (standard CM6 behavior — popup closes or does not appear).

**EC-23: Auto-complete closing bracket insertion** — User selects a completion. Expected: the filename is inserted AND `]]` is appended (FR-4.3). If `]]` already exists after the cursor, do not insert duplicate brackets.

**EC-24: Concurrent wiki-link click during index rebuild** — User clicks a wiki-link while the index is being rebuilt. Expected: click navigation proceeds immediately (it does not depend on the index — it resolves the file path directly).

**EC-25: File renamed externally** — A sibling file is renamed outside Markable while the app is open. Expected: the stale index entry persists until the next rebuild trigger (file save or tab switch). The backlinks panel may show a now-incorrect entry; clicking it shows "File not found" alert. This is acceptable for Foundation scope.

**EC-26: Wiki-link at document boundaries** — `[[link]]` as the very first or very last characters in the document. Expected: decoration and click handling work correctly; no off-by-one errors in range calculations.

**EC-27: Multiple wiki-links on the same line** — `See [[file-a]] and [[file-b]]`. Expected: both are independently decorated and clickable.

**EC-28: Wiki-link adjacent to other Markdown syntax** — `**[[bold-link]]**` or `- [[list-link]]`. Expected: wiki-link decoration is applied; surrounding Markdown syntax is handled by the existing live preview system.

**EC-29: Autocomplete global not exposed** — `window.__CM_AUTOCOMPLETE__` is not yet defined in `cm-globals.ts`. Expected: the implementation must add this global. If the global is missing at runtime, the plugin logs a warning and disables auto-complete (decorations and backlinks panel still work).

**EC-30: Tab manager global not exposed** — `window.__MARKABLE_TAB_MANAGER__` may not exist. Expected: the implementation must expose it (or use an alternative mechanism). If missing, click-to-navigate logs a warning and is disabled.

---

## Migration Notes

### Already Implemented (Leverage As-Is)

| Component | File | Relevance |
|---|---|---|
| Plugin API (addExtensions, registerSidebarPanel, etc.) | `src/plugins/markable-plugin-api.ts` | Full API surface for plugin lifecycle |
| Sidebar panel system | `src/sidebar/sidebar-manager.ts` | Panel registration, L/R assignment, tabs |
| Auto TOC plugin (reference pattern) | `src/plugins/auto-toc/auto-toc.plugin.ts` | Sidebar panel plugin pattern to follow |
| Tab manager (openFileInTab, getTabs) | `src/tabs/tab-manager.ts` | File navigation on link/backlink click |
| Live preview link handling | `src/editor/live-preview.ts` (handleLink, line 531+) | CSS classes and decoration patterns |
| Bridge layer (readFile, writeFile) | `src/lib/bridge.ts` | File I/O for index building |
| CM6 globals | `src/lib/cm-globals.ts` | Window globals for IIFE CM6 access |
| Plugin build script | `scripts/build-plugins.mjs` | PLUGINS array for IIFE bundling |
| File I/O commands | `src-tauri/src/commands/io.rs` | Pattern for new Rust command |
| `__MARKABLE_CURRENT_FILE__` global | Set by `tab-manager.ts` | Current file path for directory derivation |

### New Work Required

| Component | Target File | Notes |
|---|---|---|
| Backlinks plugin (all frontend logic) | `src/plugins/backlinks/backlinks.plugin.ts` (new) | IIFE plugin: decorations, autocomplete, click handler, sidebar, indexing |
| `list_md_files` Tauri command | `src-tauri/src/commands/io.rs` (or new file) | Shallow directory scan returning `.md` filenames |
| `listMdFiles()` bridge function | `src/lib/bridge.ts` | TypeScript wrapper for new Tauri command |
| CM6 autocomplete global | `src/lib/cm-globals.ts` | Expose `window.__CM_AUTOCOMPLETE__` |
| Tab manager global (if needed) | `src/tabs/tab-manager.ts` or `src/main.ts` | Expose `window.__MARKABLE_TAB_MANAGER__` for IIFE access |
| Plugin build registration | `scripts/build-plugins.mjs` | Add `["backlinks", "src/plugins/backlinks/backlinks.plugin.ts"]` to PLUGINS |
| Register command in Tauri app builder | `src-tauri/src/main.rs` (or `lib.rs`) | Add `list_md_files` to `.invoke_handler()` |
| Backlinks tests | `tests/plugins/backlinks/backlinks.test.ts` (new) | Unit tests for all pure functions + edge cases |
| FEATURES.md update | `docs/requirements/FEATURES.md` | Add FC3 #11a Knowledge Graph Visualization |

### FEATURES.md Addition

Add after FC3 item 11 (File Browser Advanced / Vaults):

> **11a. Knowledge Graph Visualization** — interactive node-edge graph view of vault backlinks and connections (deferred from FC2 Backlinks)
