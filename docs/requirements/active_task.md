---
title: "Templates — New from Template (FC2 #4)"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Templates — New from Template (FC2 #4) Requirements Spec

## Summary

As a user, I want to create new documents from reusable `.md` template files stored in a designated folder within my working directory, via a "File > New from Template" menu item (Cmd-Shift-N), so that I can quickly start documents with consistent structure and front matter without retyping boilerplate.

---

## Background and Motivation

Templates are a core productivity feature listed as FC2 item #4 ("Basic Templates — Markdown with fields for reuse"). Users who work with structured Markdown (meeting notes, blog posts, project briefs) want a fast path to start a new document with predefined headings, front matter, and boilerplate content.

This feature is scoped as a **standalone plugin** that handles template discovery, selection, and document creation. It does NOT include YAML front matter editing or auto-population — that responsibility belongs to the separate "YAML Pane" feature (FC3), which will be built first and consumed by this plugin's output. The Templates plugin ensures that any YAML front matter present in a template file is faithfully copied into the new document.

### Dependency on YAML Pane

The YAML Pane (FC3) will provide:
- Sidebar panel displaying/editing YAML front matter fields.
- Auto-population of fields (date, title, etc.) based on schema definitions.
- Field validation via schema files.

The Templates plugin does NOT depend on YAML Pane at build time or runtime. Templates works independently: it copies template content verbatim into a new document. When the YAML Pane is later enabled, it will detect the front matter in the newly created document and handle display/editing/auto-fill. The two features compose but do not couple.

### Existing Infrastructure Leveraged

| Component | File | Relevance |
|---|---|---|
| Plugin API (loadSettings, saveSettings, etc.) | `src/plugins/markable-plugin-api.ts` | Plugin lifecycle and settings persistence |
| PluginManager (IIFE loading, toggle, restore) | `src/plugins/index.ts` | Plugin registration and state management |
| TabManager (openNewTab, openFileInTab) | `src/tabs/tab-manager.ts` | Opening new documents from template content |
| Bridge layer (readFile, listMdFiles) | `src/lib/bridge.ts` | Reading template files and listing directory contents |
| Native menu system | `src-tauri/src/menu.rs` | Adding "New from Template" menu item |
| handleAction dispatcher | `src/main.ts` | Routing `file-new-from-template` action |
| Settings persistence | `src/lib/settings.ts` | Storing configured templates folder path |
| `list_md_files` Tauri command | `src-tauri/src/commands/files.rs` | Listing `.md` files in templates directory |
| `__MARKABLE_CURRENT_FILE__` global | Set by `tab-manager.ts` | Deriving vault/working directory |
| CM6 globals for IIFE plugins | `src/lib/cm-globals.ts` | Window globals for IIFE plugin access |

---

## Functional Requirements

### FR-1: Templates Folder

**FR-1.1** Templates are stored as plain `.md` files in a user-designated "Templates" folder within the vault/working directory. There is no app-level template storage.

**FR-1.2** The templates folder path is stored in plugin settings (via `api.saveSettings()`), keyed as `templatesFolderName`. The value is a folder name relative to the vault/working directory root (e.g., `"Templates"`, `"_templates"`), not an absolute path.

**FR-1.3** The "vault/working directory" is defined as the parent directory of the currently open file (`window.__MARKABLE_CURRENT_FILE__`). When no file is open (untitled document), the templates folder cannot be resolved.

**FR-1.4** The default folder name is `"Templates"`. Users may change this via the plugin's settings UI (rendered in the Plugins Panel detail view via `renderDetailExtra`).

### FR-2: Template Discovery

**FR-2.1** The plugin discovers templates by listing `.md` files in the resolved templates folder using the existing `listMdFiles()` bridge function (which calls the Rust `list_md_files` command).

**FR-2.2** The templates folder path is resolved at discovery time: `{parent directory of current file}/{templatesFolderName}`.

**FR-2.3** Template display names are derived from filenames by stripping the `.md` extension. Example: `meeting-notes.md` displays as `"meeting-notes"`.

**FR-2.4** Templates are sorted alphabetically (case-insensitive), matching the existing `list_md_files` sort behavior.

**FR-2.5** Hidden files (names starting with `.`) are excluded — handled by `list_md_files`.

### FR-3: Template Picker UI

**FR-3.1** Triggering "File > New from Template" (Cmd-Shift-N) opens a modal picker dialog overlaying the editor.

**FR-3.2** The picker displays a vertical list of available template names (FR-2.3). Each entry is clickable.

**FR-3.3** The picker includes a text input at the top for type-to-filter. Filtering is case-insensitive substring match against the template display name.

**FR-3.4** Keyboard navigation within the picker:
- Up/Down arrow keys move the selection highlight.
- Enter applies the highlighted template.
- Escape closes the picker without action.
- Typing in the filter input narrows the list in real time.

**FR-3.5** The picker is dismissed when:
- The user selects a template (Enter or click).
- The user presses Escape.
- The user clicks outside the picker overlay.

**FR-3.6** The picker's visual style follows the existing Markable panel conventions: dark overlay backdrop, centered card, uses CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`, `--border-color`, `--selection-bg`).

### FR-4: Template Application

**FR-4.1** When a template is selected, the plugin reads the template file's full content via `readFile()`.

**FR-4.2** The plugin creates a new untitled tab (via `tabManager.openNewTab()`) and immediately replaces its empty content with the template content using an EditorView dispatch.

**FR-4.3** The template content is inserted verbatim — all YAML front matter, headings, body text, and any other content in the template file are preserved exactly as written. No string interpolation, placeholder substitution, or content transformation is performed by the Templates plugin.

**FR-4.4** After insertion, the cursor is placed at the end of the document (position = doc.length).

**FR-4.5** The new tab's dirty state is set to true after template content is inserted (the document has unsaved content that differs from an empty file).

### FR-5: Template Creation

**FR-5.1** Users can create templates via two methods:
- **Method A — "Save Current Document as Template"**: A menu item under File (action id: `file-save-as-template`) that saves the current editor content as a new `.md` file in the templates folder.
- **Method B — Manual placement**: Users manually place `.md` files in the templates folder using Finder or any other tool. These are discovered automatically on next template picker open.

**FR-5.2** "Save as Template" behavior (Method A):
1. Prompt the user for a template filename via a simple text input dialog (browser `prompt()` is acceptable for MVP).
2. Validate the filename: must be non-empty, must not contain path separators (`/`, `\`), must not start with `.`.
3. Append `.md` if the user did not include it.
4. Check if a file with that name already exists in the templates folder. If so, confirm overwrite: "Template '{name}' already exists. Overwrite?"
5. Write the current editor content to `{templates folder}/{filename}` via `writeFile()`.
6. Show confirmation (e.g., brief notification or alert): "Template saved: {name}".

**FR-5.3** If the templates folder does not exist when "Save as Template" is invoked, create it automatically before writing the file. Use a new Tauri command `ensure_directory` (or equivalent) that creates the directory if absent.

### FR-6: Setup Wizard

**FR-6.1** On first use (no saved plugin settings), when the user triggers "New from Template" (Cmd-Shift-N), the plugin presents a setup dialog instead of the picker.

**FR-6.2** The setup dialog:
- Displays: "No templates folder is configured for this directory."
- Shows the default folder name (`"Templates"`) in an editable text field.
- Offers two buttons: "Create Folder" and "Cancel".
- Optionally includes a checkbox: "Create starter templates" (default: checked).

**FR-6.3** "Create Folder" action:
1. Creates the templates folder at `{working directory}/{folder name}`.
2. If "Create starter templates" is checked, writes 2-3 minimal starter templates into the folder. Suggested starters:
   - `blank.md` — empty document (no content, no front matter).
   - `note.md` — simple note with a `# Title` heading and a date placeholder in YAML front matter.
   - `meeting-notes.md` — meeting notes structure (attendees, agenda, action items sections).
3. Saves the folder name to plugin settings.
4. Immediately opens the template picker showing the available templates.

**FR-6.4** The setup wizard can be re-invoked from the plugin's detail view in the Plugins Panel (via `renderDetailExtra`) as a "Reconfigure Templates Folder" button. This allows users to change the folder name or re-run the setup for a different working directory.

### FR-7: Menu Integration

**FR-7.1** A new menu item is added to the File menu in `src-tauri/src/menu.rs`:
- Label: `"New from Template..."`
- Action id: `"file-new-from-template"`
- Keyboard shortcut: `CmdOrCtrl+Shift+N`
- Position: after "New" (file-new) and before "Open..." (file-open).

**FR-7.2** A new menu item is added to the File menu:
- Label: `"Save as Template..."`
- Action id: `"file-save-as-template"`
- No keyboard shortcut (accessed via menu only).
- Position: after "Save As..." and before the separator preceding Export.

**FR-7.3** Both menu actions are dispatched via `handleAction()` in `main.ts`, which delegates to the plugin.

**FR-7.4** The `handleAction` cases for `file-new-from-template` and `file-save-as-template` must check whether the templates plugin is enabled. If disabled, log a warning and show an alert: "Enable the Templates plugin in Markable > Plugins to use this feature."

### FR-8: Plugin Lifecycle

**FR-8.1** The plugin is registered as a core plugin with:
- `id`: `"templates"`
- `name`: `"Templates"`
- `version`: `"1.0.0"`
- `description`: `"Create documents from reusable template files"`
- No `sidebarPanelId` (this plugin does not register a sidebar panel).

**FR-8.2** `onEnable` sequence:
1. Inject CSS for the picker dialog.
2. Load plugin settings (templates folder name).
3. Expose a global function `window.__MARKABLE_TEMPLATES__` with methods `{ openPicker(), saveAsTemplate() }` so that `handleAction()` can call the plugin without a direct import (IIFE boundary).

**FR-8.3** `onDisable` sequence:
1. Close the picker dialog if open.
2. Remove injected CSS.
3. Remove `window.__MARKABLE_TEMPLATES__` global.
4. Clear any in-memory state (cached template list, etc.).

**FR-8.4** The plugin does NOT register CM6 extensions (no `api.addExtensions()`). It is a pure UI/workflow plugin.

**FR-8.5** The plugin is added to the `PLUGINS` array in `scripts/build-plugins.mjs` for IIFE bundling.

### FR-9: Settings

**FR-9.1** Plugin settings schema:

```json
{
  "templatesFolderName": "Templates",
  "createStarterTemplates": true,
  "setupComplete": false
}
```

**FR-9.2** `templatesFolderName` — the folder name (not path) relative to the working directory. Default: `"Templates"`.

**FR-9.3** `setupComplete` — boolean. Set to `true` after the setup wizard runs successfully. Controls whether the first-use wizard appears or the picker opens directly.

**FR-9.4** `createStarterTemplates` — remembered preference from the setup wizard checkbox.

**FR-9.5** Settings are persisted via `api.saveSettings()` / `api.loadSettings()`, stored at `~/Library/Application Support/com.markable.app/plugins/templates/settings.json`.

---

## Non-Functional Requirements

**NFR-1: Performance — Template Discovery** — Listing templates must complete in under 50ms for folders with up to 100 template files. Uses the existing `list_md_files` command which meets this budget.

**NFR-2: Performance — Template Application** — Reading a template file and inserting its content into a new tab must complete in under 200ms for files up to 1MB. The perceived action should feel instant.

**NFR-3: No External Dependencies** — The plugin uses only existing bridge functions (`readFile`, `writeFile`, `listMdFiles`) and DOM APIs. No new npm dependencies.

**NFR-4: CSS Theme Compatibility** — The picker dialog and setup wizard use existing CSS variables. The UI automatically adopts the active theme.

**NFR-5: IIFE Self-Containment** — The plugin follows all IIFE self-containment rules: no app-internal module imports, CSS injected via `<style>` tag, communication with `handleAction()` via window globals.

---

## Architectural Decisions

**AD-1: Window Global for handleAction Communication** — The plugin exposes `window.__MARKABLE_TEMPLATES__` with `openPicker()` and `saveAsTemplate()` methods. `handleAction()` checks for this global's existence before calling. This follows the same pattern as `window.__MARKABLE_TAB_MANAGER__` and avoids crossing the IIFE boundary.

**AD-2: Vault-Relative Storage Only** — Templates are stored per-directory, not per-app. This means different working directories can have different template sets. When the user switches to a file in a different directory, the templates folder resolves to a different location. This is intentional — it supports project-specific templates.

**AD-3: No Template Preview** — Selecting a template applies it immediately without a preview step. This keeps the UI simple and fast. Preview can be added in a future enhancement if needed.

**AD-4: Verbatim Content Copy** — The plugin performs zero content transformation. No variable interpolation, no date insertion, no placeholder replacement. The YAML Pane (separate feature) handles all front matter intelligence. This keeps the Templates plugin simple and decoupled.

**AD-5: Separate from YAML Pane** — The Templates plugin and YAML Pane are independently toggleable. Templates works without YAML Pane (front matter is just text). YAML Pane works without Templates (it reads front matter from any document). They compose when both enabled.

**AD-6: Modal Picker over Sidebar** — The template picker is a modal dialog, not a sidebar panel. Rationale: template selection is a one-shot action (pick and dismiss), not a persistent view. A modal also avoids competing with Auto TOC and Backlinks for sidebar real estate.

**AD-7: Rust ensure_directory Command** — A new Tauri command `ensure_directory` is needed for FR-5.3 and FR-6.3. This is a thin wrapper around `std::fs::create_dir_all`. It is general-purpose and can be reused by other features.

---

## Out of Scope

1. **YAML front matter editing/auto-fill** — Handled by the YAML Pane (FC3). Templates plugin just copies content verbatim.
2. **Template variables / placeholder interpolation** — No `{{date}}`, `{{title}}`, or similar substitution. Deferred to YAML Pane auto-fill.
3. **Template preview before applying** — Skipped per scoping decision. May be added later.
4. **App-level (global) templates** — Templates are vault-relative only. No shared template library across projects.
5. **Template categories or tags** — Flat list only. No grouping, folders-within-folders, or metadata-based categorization.
6. **Template editing UI** — Templates are edited as regular `.md` files. No dedicated template editor.
7. **Bundled default templates shipped with app** — No templates are bundled in the app binary. The setup wizard creates starter templates on the user's disk.
8. **Recursive template discovery** — Only the designated templates folder is scanned (shallow). Subdirectories within it are not scanned.
9. **Template import/export** — No mechanism to share templates between vaults or users (they are just `.md` files — users can copy them manually).

---

## Edge Case Inventory

**EC-1: No file open (untitled document)** — `window.__MARKABLE_CURRENT_FILE__` is null. The working directory cannot be determined. Expected: show alert "Save your document first to establish a working directory, then try again." Both "New from Template" and "Save as Template" abort gracefully.

**EC-2: Templates folder does not exist** — The configured folder name points to a directory that has not been created. Expected for "New from Template": trigger the setup wizard flow (FR-6.1). Expected for "Save as Template": create the folder automatically (FR-5.3) then proceed with save.

**EC-3: Templates folder is empty** — The folder exists but contains no `.md` files. Expected: the picker opens but shows an empty state message: "No templates found in {folder name}/. Create a template using File > Save as Template."

**EC-4: Templates folder contains non-.md files** — Expected: non-`.md` files are ignored by `list_md_files`. Only `.md` files appear in the picker.

**EC-5: Template file cannot be read** — Permissions error or corrupted file when reading a selected template. Expected: show alert "Could not read template: {filename}. {error message}". The new tab is not created.

**EC-6: Template file is empty (0 bytes)** — Expected: a new untitled tab is created with empty content. This is functionally identical to "File > New" but is a valid use case (the `blank.md` starter template).

**EC-7: Template filename conflicts on save** — User tries to save a template with a name that already exists. Expected: confirm dialog "Template '{name}' already exists. Overwrite?" Cancel aborts, OK overwrites.

**EC-8: Invalid filename on save** — User enters a filename containing `/`, `\`, or starting with `.`. Expected: show validation error "Invalid template name. Names cannot contain path separators or start with a dot." Do not dismiss the input dialog; let the user correct the name.

**EC-9: Plugin disabled when menu action triggered** — User clicks "New from Template" but the templates plugin is not enabled. Expected: show alert "Enable the Templates plugin in Markable > Plugins to use this feature." No crash, no silent failure.

**EC-10: Working directory changes between picker open and template selection** — User opens the picker, switches tabs (changing the current file's directory), then selects a template. Expected: the template is read from the directory that was active when the picker was opened (the picker captures the resolved path at open time, not at selection time).

**EC-11: Very large template file (>1MB)** — Expected: the template is applied normally. `readFile` handles large files. A brief delay is acceptable. No explicit size cap is enforced.

**EC-12: Cmd-Shift-N pressed while picker is already open** — Expected: no-op. The picker is a singleton; pressing the shortcut again does not open a second instance.

**EC-13: Rapid double-click on template entry** — Expected: the template is applied once. After the first selection triggers application, the picker is dismissed. The second click has no target.

**EC-14: Template folder name changed in settings while picker is open** — Expected: the picker uses the folder name captured at open time. Settings changes take effect on the next picker open.

**EC-15: Setup wizard "Create Folder" fails (permissions)** — Expected: show alert "Could not create templates folder: {error}". The setup dialog remains open so the user can try a different name or cancel.

**EC-16: Templates folder is actually a file, not a directory** — A file named "Templates" exists where the folder should be. Expected: `list_md_files` returns empty (it fails on non-directories). The picker shows the empty state. "Save as Template" detects the conflict when `ensure_directory` fails and shows an alert.

**EC-17: Concurrent "Save as Template" operations** — User somehow triggers two save-as-template actions in quick succession. Expected: the `prompt()` dialog is modal and blocks the second invocation until the first completes.

**EC-18: Template content contains YAML front matter** — Expected: the front matter is copied verbatim into the new document. No parsing, validation, or modification by the Templates plugin. The YAML Pane (when enabled) will detect and render it.

**EC-19: Escape pressed in filter input vs. picker** — Expected: Escape always closes the picker, regardless of whether the filter input is focused or empty. There is no separate "clear filter" step.

**EC-20: Working directory is read-only filesystem** — Expected: "Save as Template" and "Create Folder" fail with a permissions error. The alert surfaces the OS error message. "New from Template" still works if the templates folder already exists and is readable.

---

## New Work Required

| Component | Target File | Notes |
|---|---|---|
| Templates plugin (picker, setup wizard, save-as) | `src/plugins/templates/templates.plugin.ts` (new) | IIFE plugin: picker UI, folder management, template application |
| `ensure_directory` Tauri command | `src-tauri/src/commands/files.rs` | `create_dir_all` wrapper; reusable |
| `ensureDirectory()` bridge function | `src/lib/bridge.ts` | TypeScript wrapper for new Tauri command |
| "New from Template" menu item | `src-tauri/src/menu.rs` | Cmd-Shift-N, after "New" |
| "Save as Template" menu item | `src-tauri/src/menu.rs` | After "Save As..." |
| `handleAction` cases | `src/main.ts` | `file-new-from-template`, `file-save-as-template` |
| Rust command registration | `src-tauri/src/lib.rs` | Add `ensure_directory` to `.invoke_handler()` |
| Plugin build registration | `scripts/build-plugins.mjs` | Add templates to PLUGINS array |
| Starter template files (generated by wizard) | Written to user's disk at runtime | `blank.md`, `note.md`, `meeting-notes.md` |
| Templates tests | `tests/plugins/templates/templates.test.ts` (new) | Unit tests for picker logic, filename validation, folder resolution |
