# Settings & Persistence -- Master Blueprint

**Status:** Architecture Complete
**Requirements Source:** `docs/requirements/active_task.md`
**Feature Checkpoint:** 1 -- Base Features (item 3: Settings & persistence, item 4: Theming persistence)

---

## Stack Decision

The existing stack (Tauri v2 + Rust backend + TypeScript/Vite frontend + CodeMirror 6) is retained. No new framework-level dependencies are introduced.

**Evaluated alternative -- `tauri-plugin-window-state`:**
Tauri v2 ships a window-state plugin that automatically persists window position and size. However, it was rejected for this feature because:
1. It stores data in its own file, not in our unified `settings.json`.
2. It provides no off-screen detection (required by EC-10 and EC-11).
3. It cannot be debounced at 1000ms as required by TC-3.
4. It does not integrate with the settings panel or reset-to-defaults flow.

**New Rust dependency: `dirs` crate** -- Not needed. Tauri v2's `PathResolver::app_data_dir()` resolves to `~/Library/Application Support/com.markable.app/` on macOS. The `serde` and `serde_json` crates already present in `Cargo.toml` handle all serialization.

**New frontend dependency: None.** The `@tauri-apps/api/webviewWindow` module (already used) provides `onMoved()`, `onResized()`, `outerPosition()`, `outerSize()`, `isMaximized()`, and `isFullscreen()`. The `@tauri-apps/api/path` module provides `appDataDir()` if needed for verification, but settings I/O is Rust-side.

---

## High-Level Architecture

### Data Flow

```
[User Action]
     |
     v
[Frontend (TypeScript)]
     |  1. Debounce (1000ms for window state)
     |  2. Merge change into in-memory settings object
     |  3. Call save_settings via bridge
     v
[Tauri Command Bridge]
     |
     v
[Rust: save_settings command]
     |  1. Serialize to JSON
     |  2. Atomic write (temp-file-swap)
     v
[~/Library/Application Support/com.markable.app/settings.json]
```

```
[App Launch]
     |
     v
[Rust: get_settings command]
     |  1. Read file (or create defaults if missing/corrupt)
     |  2. Run migration if version < current
     |  3. Validate + clamp values
     |  4. Return JSON to frontend
     v
[Frontend: initApp()]
     |  1. Apply theme (CSS custom properties)
     |  2. Apply font size (CSS variable + CM6 compartment)
     |  3. Apply content width (CSS variable)
     |  4. window.show() -- no flash
     v
[Window visible with correct settings]
```

### Component Map

#### New Files

| File | Purpose |
|------|---------|
| `src-tauri/src/commands/settings.rs` | Rust: settings struct, get/save commands, migration, validation |
| `src/lib/settings.ts` | TypeScript: settings types, bridge functions, debounced save, in-memory state |
| `src/settings/settings-panel.ts` | TypeScript: settings panel DOM component |
| `src/settings/settings-panel.css` | CSS: settings panel styles |
| `tests/settings.test.ts` | Frontend: settings bridge and logic tests |

#### Modified Files

| File | Change |
|------|--------|
| `src-tauri/src/commands/mod.rs` | Add `pub mod settings;` and re-export `get_settings`, `save_settings` |
| `src-tauri/src/lib.rs` | Register `get_settings` and `save_settings` in `generate_handler![]` |
| `src-tauri/capabilities/default.json` | Add window position/size/fullscreen/maximize permissions |
| `src-tauri/src/menu.rs` | Add "Open Recent" submenu to File menu; wire `app-settings` menu event |
| `src/main.ts` | Load settings before window.show(); wire Cmd-,; wire window state events; wire settings-related menu events |
| `src/editor/extensions.ts` | Add font-size compartment for dynamic reconfiguration |
| `src/styles.css` | Add CSS custom properties for content width and font size; add responsive padding breakpoints; add settings panel layout |
| `index.html` | Add settings panel overlay container |
| `src/lib/bridge.ts` | Add `getSettings()` and `saveSettings()` bridge functions |
| `src/lib/errors.ts` | Add `SettingsResult` type (or reuse `FileResult`) |
| `tests/mocks/tauri.ts` | Add settings mock helpers |

---

## API Contracts

### Rust Commands

```rust
/// Returns the full settings object as JSON.
/// On first launch, creates settings.json with defaults.
/// On corrupt file, falls back to defaults.
/// Runs migration if version < CURRENT_VERSION.
#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<String, String>

/// Writes the full settings object atomically.
/// Accepts the complete settings JSON string.
#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: String) -> Result<(), String>
```

### Settings JSON Schema (v1)

```json
{
  "version": 1,
  "window": {
    "x": 200,
    "y": 100,
    "width": 960,
    "height": 1080,
    "fullscreen": false,
    "maximized": false
  },
  "editor": {
    "contentMaxWidth": 900,
    "contentPadding": "responsive",
    "baseFontSize": 16
  },
  "theme": {
    "active": "default-dark",
    "fallback": "default-dark"
  },
  "recentFiles": []
}
```

### TypeScript Types

```typescript
interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
}

interface WindowSettings {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
  maximized: boolean;
}

interface EditorSettings {
  contentMaxWidth: number;
  contentPadding: string;
  baseFontSize: number;
}

interface ThemeSettings {
  active: string;
  fallback: string;
}
```

### TypeScript Bridge Functions

```typescript
// Load settings from Rust backend
async function getSettings(): Promise<FileResult<MarkableSettings>>

// Save settings to Rust backend (atomic write)
async function saveSettings(settings: MarkableSettings): Promise<FileResult<void>>
```

### Frontend Settings Module (src/lib/settings.ts)

```typescript
// In-memory settings singleton
let currentSettings: MarkableSettings;

// Load settings from Rust, apply to DOM, return settings object
async function loadSettings(): Promise<MarkableSettings>

// Save with 1000ms debounce (window state) or immediate (user action)
function saveSettingsDebounced(): void
function saveSettingsImmediate(): void

// Apply settings to DOM (CSS custom properties) and CM6 (compartments)
function applyEditorSettings(settings: EditorSettings): void
function applyThemeSettings(settings: ThemeSettings): void
function applyWindowSettings(settings: WindowSettings): void

// Recent files management
function addRecentFile(path: string): void
function clearRecentFiles(): void
function getRecentFiles(): string[]

// Reset all settings to defaults
function resetToDefaults(): Promise<void>
```

---

## Capability / Permission Requirements

The following permissions must be added to `src-tauri/capabilities/default.json`:

```json
"core:window:allow-outer-position",
"core:window:allow-outer-size",
"core:window:allow-inner-size",
"core:window:allow-set-position",
"core:window:allow-set-size",
"core:window:allow-is-maximized",
"core:window:allow-is-fullscreen",
"core:window:allow-set-fullscreen",
"core:window:allow-maximize",
"core:window:allow-unmaximize",
"core:window:allow-center"
```

---

## Implementation Roadmap

Each step is designed to be completable in one session with TDD (Red/Green/Refactor). Steps build on each other sequentially.

### Step Checklist

- [ ] **Step 01: Rust Settings Struct + File I/O** (`step_01_rust_settings.md`)
  Settings struct with serde, defaults, get_settings/save_settings commands, migration skeleton, atomic writes, directory creation. Covers: R1, R8, NF2, NF5, TC-1, TC-2, TC-4, TC-7, TC-8. Edge cases: EC-1 through EC-9.

- [ ] **Step 02: Frontend Bridge + Init Sequence** (`step_02_frontend_bridge.md`)
  TypeScript types, bridge functions, in-memory settings singleton, loadSettings() in initApp() before window.show(). Covers: R1 (frontend side), TC-5. Edge cases: EC-3 (frontend handling), EC-4 (merge behavior on frontend).

- [ ] **Step 03: Window State Persistence** (`step_03_window_state.md`)
  Listen to onMoved/onResized, debounced save at 1000ms, restore position/size on launch, off-screen detection, fullscreen/maximize restore. Covers: R2, TC-3. Edge cases: EC-10, EC-11, EC-12, EC-13, EC-24, EC-25. Permissions update.

- [ ] **Step 04: Editor Settings** (`step_04_editor_settings.md`)
  Content width via CSS custom property, font size via CSS custom property + CM6 compartment reconfigure, responsive padding breakpoints via CSS media queries. Covers: R3, R4, TC-6. Edge cases: EC-20, EC-21.

- [ ] **Step 05: Recent Files** (`step_05_recent_files.md`)
  Track recently opened/saved files, add to front of list, cap at 10, deduplicate. Update File menu with "Open Recent" submenu. Wire Cmd-Opt-O. Handle stale entries. Covers: R5. Edge cases: EC-14, EC-15, EC-16, EC-22.

- [ ] **Step 06: Theme Persistence** (`step_06_theme_persistence.md`)
  Save/restore theme.active and theme.fallback. Apply theme before window.show(). Fallback chain: active -> fallback -> bundled default. Update theme.fallback on successful load. Covers: R6. Edge cases: EC-17, EC-18, EC-19.

- [ ] **Step 07: Settings Panel UI** (`step_07_settings_panel.md`)
  DOM overlay panel, Cmd-, toggle, content width slider, font size slider, theme selector, "Clear Recent Files" button, "Reset to Defaults" button. Live preview of changes. Escape/click-outside to dismiss. Covers: R7. Edge cases: EC-26, EC-27, EC-28.

- [ ] **Step 08: Edge Case Hardening + Tests** (`step_08_hardening.md`)
  Comprehensive test coverage for all 28 edge cases. Rust cargo tests for settings I/O. Frontend vitest tests for settings logic, debounce, validation. Final audit against requirements checklist.

---

## Traceability Matrix

Every requirement and edge case is mapped to at least one step:

| Requirement | Step(s) |
|-------------|---------|
| R1: Settings File Lifecycle | 01, 02 |
| R2: Window State Persistence | 03 |
| R3: Content Width Persistence | 04 |
| R4: Font Size Persistence | 04 |
| R5: Recent Files List | 05 |
| R6: Theme Persistence | 06 |
| R7: Settings Panel UI | 07 |
| R8: Settings Schema Migration | 01 |
| NF1: Load Performance (<50ms) | 02 |
| NF2: Atomic Writes | 01 |
| NF3: No Restart Required | 04, 06, 07 |
| NF4: Settings Isolation | 01 |
| NF5: Graceful Degradation | 01, 08 |
| TC-1: Rust Owns I/O | 01 |
| TC-2: Atomic Writes Pattern | 01 |
| TC-3: Debounced Saves | 03 |
| TC-4: Schema Versioning | 01 |
| TC-5: Read Before Show | 02 |
| TC-6: Responsive Padding CSS | 04 |
| TC-7: Serde Deserialization | 01 |
| TC-8: App Support Directory | 01 |
| EC-1 through EC-9 | 01, 08 |
| EC-10, EC-11, EC-12 | 03, 08 |
| EC-13, EC-24, EC-25 | 03, 08 |
| EC-14, EC-15, EC-16 | 05, 08 |
| EC-17, EC-18, EC-19 | 06, 08 |
| EC-20, EC-21 | 04, 08 |
| EC-22 | 05, 08 |
| EC-23 | 01, 08 |
| EC-26, EC-27, EC-28 | 07, 08 |
