---
title: "Templates Plugin — Master Blueprint"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Templates Plugin — Master Blueprint

## Requirements Source

`docs/requirements/active_task.md` — "Templates — New from Template (FC2 #4)"

## Stack Decision

No new dependencies. The Templates plugin uses the established Markable stack:

- **TypeScript IIFE plugin** — follows the UnifiedPlugin interface and IIFE bundling pattern used by all 6 existing core plugins.
- **Tauri v2 Rust command** — one new command (`ensure_directory`) added to the existing `commands/files.rs` module; thin `create_dir_all` wrapper.
- **Bridge layer** — one new function (`ensureDirectory`) in `src/lib/bridge.ts`.
- **Window globals for cross-IIFE communication** — `window.__MARKABLE_TEMPLATES__` exposes `openPicker()` and `saveAsTemplate()` to `handleAction()`, matching the `window.__MARKABLE_TAB_MANAGER__` pattern.

No npm packages added. No Vite config changes beyond adding the plugin entry to `build-plugins.mjs`.

## High-Level Architecture

### Data Flow

```
User presses Cmd-Shift-N
  -> Native menu emits "file-new-from-template" action
  -> lib.rs on_menu_event forwards to frontend via menu-event
  -> handleAction() in main.ts checks window.__MARKABLE_TEMPLATES__
  -> Plugin's openPicker() is called
  -> Plugin reads __MARKABLE_CURRENT_FILE__ to derive working directory
  -> Plugin calls __TAURI_INTERNALS__.invoke("list_md_files", { path: templatesDir })
  -> Rust scans templates folder, returns filenames
  -> Plugin renders modal picker DOM
  -> User selects a template
  -> Plugin calls __TAURI_INTERNALS__.invoke("read_file", { path: templateFilePath })
  -> Plugin calls __MARKABLE_TAB_MANAGER__.openNewTab()
  -> Plugin dispatches CM6 transaction to replace empty doc with template content
  -> New tab shows template content, dirty state = true
```

### Component Map

| Component | File | Action |
|---|---|---|
| Templates plugin (picker, wizard, save-as) | `src/plugins/templates/templates.plugin.ts` | **NEW** |
| `ensure_directory` Tauri command | `src-tauri/src/commands/files.rs` | **MODIFY** (add command) |
| `ensure_directory` registration | `src-tauri/src/commands/mod.rs` | **MODIFY** (add pub use) |
| `ensure_directory` invoke_handler | `src-tauri/src/lib.rs` | **MODIFY** (add to handler + forwarding) |
| `ensureDirectory` bridge function | `src/lib/bridge.ts` | **MODIFY** (add function) |
| "New from Template" menu item | `src-tauri/src/menu.rs` | **MODIFY** (add to File menu) |
| "Save as Template" menu item | `src-tauri/src/menu.rs` | **MODIFY** (add to File menu) |
| Menu event forwarding | `src-tauri/src/lib.rs` | **MODIFY** (add action ids to forward list) |
| `handleAction` cases | `src/main.ts` | **MODIFY** (add 2 cases) |
| Plugin build registration | `scripts/build-plugins.mjs` | **MODIFY** (add to PLUGINS array) |
| Plugin build registration (vite) | `vite.plugins.config.ts` | **MODIFY** (add pluginConfig entry) |
| Templates tests | `tests/plugins/templates/templates.test.ts` | **NEW** |
| Rust tests | `src-tauri/src/commands/files.rs` | **MODIFY** (add ensure_directory tests) |

### Files Created (2 new)

1. `src/plugins/templates/templates.plugin.ts`
2. `tests/plugins/templates/templates.test.ts`

### Files Modified (8 existing)

1. `src-tauri/src/commands/files.rs`
2. `src-tauri/src/commands/mod.rs`
3. `src-tauri/src/lib.rs`
4. `src-tauri/src/menu.rs`
5. `src/lib/bridge.ts`
6. `src/main.ts`
7. `scripts/build-plugins.mjs`
8. `vite.plugins.config.ts`

## API Contracts

### Rust: `ensure_directory` command

```rust
#[tauri::command]
pub fn ensure_directory(path: String) -> Result<(), String>
```

- Takes an absolute path string.
- Calls `std::fs::create_dir_all`.
- Returns `Ok(())` on success (including if directory already exists).
- Returns `Err(message)` on failure (permissions, path is a file, etc.).

### Bridge: `ensureDirectory` function

```typescript
export async function ensureDirectory(path: string): Promise<void> {
  await invoke("ensure_directory", { path });
}
```

- Throws on failure (caller catches).

### Window Global: `__MARKABLE_TEMPLATES__`

```typescript
interface MarkableTemplatesGlobal {
  openPicker(): void;
  saveAsTemplate(): void;
}
```

- Set on `window` during `onEnable`.
- Removed during `onDisable`.
- Called by `handleAction()` for `file-new-from-template` and `file-save-as-template`.

### Plugin Settings Schema

```typescript
interface TemplatesSettings {
  templatesFolderName: string;   // default: "Templates"
  createStarterTemplates: boolean; // default: true
  setupComplete: boolean;        // default: false
}
```

Persisted at `~/Library/Application Support/com.markable.app/plugins/templates/settings.json`.

## Implementation Roadmap

### Phase 1: Backend Infrastructure (step_01)

- Add `ensure_directory` Rust command + tests
- Add `ensureDirectory` bridge function
- Wire command registration in `mod.rs` and `lib.rs`

### Phase 2: Menu Integration (step_02)

- Add two menu items to `menu.rs`
- Add action forwarding in `lib.rs`
- Add `handleAction` cases in `main.ts`

### Phase 3: Plugin Core Logic (step_03)

- Create `templates.plugin.ts` with:
  - UnifiedPlugin interface implementation (id, name, version, onEnable, onDisable)
  - Settings management (load/save via api)
  - Template discovery (list_md_files via IIFE invoke)
  - Template application (openNewTab + dispatch)
  - Save-as-template logic (prompt, validate, write)
  - Window global exposure

### Phase 4: Picker UI and Setup Wizard (step_04)

- Modal picker DOM (overlay, card, filter input, keyboard nav)
- Setup wizard DOM (first-use dialog, folder creation, starter templates)
- Plugin detail settings UI (renderDetailExtra)
- CSS injection/removal

### Phase 5: Build and Tests (step_05)

- Register plugin in `build-plugins.mjs` and `vite.plugins.config.ts`
- Write unit tests for:
  - Filename validation
  - Template discovery resolution
  - Picker filter logic
  - Setup wizard state transitions
  - Edge cases (EC-1 through EC-20)
- Run Rust tests for `ensure_directory`

## Step Checklist

- [x] `step_01_backend.md` — Rust command + bridge function
- [x] `step_02_menu.md` — Menu items + handleAction wiring
- [x] `step_03_plugin_core.md` — Plugin lifecycle, discovery, application, save-as
- [x] `step_04_picker_ui.md` — Picker modal, setup wizard, settings UI, CSS
- [x] `step_05_build_tests.md` — Build registration + test suite

## Edge Case Coverage Matrix

| Edge Case | Addressed In |
|---|---|
| EC-1: No file open | step_03 (openPicker, saveAsTemplate guard) |
| EC-2: Folder doesn't exist | step_03 (setup wizard trigger), step_04 (wizard UI) |
| EC-3: Folder empty | step_04 (empty state message) |
| EC-4: Non-.md files | step_03 (list_md_files filters) |
| EC-5: Template read error | step_03 (readFile error handling) |
| EC-6: Empty template | step_03 (treated as valid) |
| EC-7: Filename conflict on save | step_03 (overwrite confirm) |
| EC-8: Invalid filename | step_03 (validation logic) |
| EC-9: Plugin disabled | step_02 (handleAction guard) |
| EC-10: Dir changes while picker open | step_03 (capture path at open time) |
| EC-11: Large template | step_03 (no size cap) |
| EC-12: Double-open picker | step_04 (singleton guard) |
| EC-13: Rapid double-click | step_04 (dismiss on first selection) |
| EC-14: Settings change while open | step_03 (capture at open time) |
| EC-15: Create folder fails | step_04 (wizard error handling) |
| EC-16: Path is file not dir | step_01 (ensure_directory error), step_03 |
| EC-17: Concurrent save | step_03 (prompt is modal) |
| EC-18: YAML front matter | step_03 (verbatim copy) |
| EC-19: Escape in filter | step_04 (always closes picker) |
| EC-20: Read-only filesystem | step_03 (error surfacing) |

## Review Request

- **Files changed**:
  - `src-tauri/src/commands/files.rs` (added `ensure_directory` command + 4 tests)
  - `src-tauri/src/commands/mod.rs` (added `pub use files::ensure_directory`)
  - `src-tauri/src/lib.rs` (added to `pub use`, `generate_handler![]`, and menu forwarding)
  - `src-tauri/src/menu.rs` (added 2 MenuItem entries: "New from Template...", "Save as Template...")
  - `src/lib/bridge.ts` (added `ensureDirectory()` function)
  - `src/main.ts` (added 2 handleAction cases: `file-new-from-template`, `file-save-as-template`)
  - `src/plugins/templates/templates.plugin.ts` (**NEW** -- full plugin implementation)
  - `tests/plugins/templates/templates.test.ts` (**NEW** -- 61 unit/integration tests)
  - `scripts/build-plugins.mjs` (added templates entry to PLUGINS array, updated count to 7)
  - `vite.plugins.config.ts` (added pluginConfig entry for templates)
  - `docs/specs/templates/00_index.md` (checked off all 5 steps)
- **Steps completed**: step_01, step_02, step_03, step_04, step_05
- **Known limitations**:
  - 6 pre-existing failures in `tests/plugins/backlinks/backlinks.test.ts` (unrelated to templates changes; confirmed by running on clean main branch)
- **Edge cases covered by tests**:
  - EC-1 (no file open): `saveAsTemplate > shows alert when no file open`, `openPicker > shows alert when no file open`
  - EC-5 (template read error): `applyTemplate > handles read_file failure`
  - EC-6 (empty template): `applyTemplate > handles empty content`
  - EC-7 (filename conflict): `saveAsTemplate > checks for existing file and confirms overwrite`, `saveAsTemplate > aborts on overwrite cancel`
  - EC-8 (invalid filename): `validateTemplateName` (9 tests), `saveAsTemplate > validates filename`
  - EC-9 (plugin disabled): `openPicker > is no-op when plugin is disabled`
  - EC-12 (double-open picker): singleton `_pickerOpen` guard (tested via openPicker flow)
  - EC-13 (rapid double-click): `closePicker()` removes overlay before async applyTemplate
  - EC-15 (create folder fails): `Setup wizard > shows error and stays open on folder creation failure`
  - EC-19 (Escape in filter): `Picker keyboard navigation > Escape closes picker`
  - FR-4.4 (cursor at end): `applyTemplate > sets cursor at end of document`
  - FR-5.3 (ensure_directory before write): `saveAsTemplate > calls ensure_directory before writing`
  - FR-6.4 (picker after setup): `Setup wizard > opens picker after successful setup`
