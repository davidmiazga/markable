# Active Task: Markable 2.0 -- Settings & Persistence

**Status:** Requirements Validated
**Date:** 2026-04-08
**Depends on:** Phase 2A Chromeless Window (complete), Phase 2B Menu System (complete)
**Feature Checkpoint:** 1 -- Base Features (item 3: Settings & Persistence, item 4: Theming persistence)

---

## Executive Summary

This phase implements the settings and persistence layer for Markable 2.0. The app must remember its state across launches: window position and size, active theme, content width, font size, and recently opened files. Settings are stored in a single JSON file at the standard macOS Application Support path, written atomically (same pattern as document writes), and read at startup before the window is shown. A minimal settings panel (inspired by Whispr Flow) allows users to adjust core preferences visually. Keybinding customization is explicitly deferred to Phase 2.

This is the backbone for user experience continuity. Without persistence, every launch feels like a fresh install.

---

## Settings File Location & Schema

**Path:** `~/Library/Application Support/com.markable.app/settings.json`

**Schema (version 1):**

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
  "recentFiles": [
    "/Users/me/docs/notes.md",
    "/Users/me/docs/todo.md"
  ]
}
```

---

## Functional Requirements

### R1: Settings File Lifecycle

**As a user, I want** the app to persist my settings across launches so I never have to reconfigure anything.

**What must be built:**
- On first launch, if `settings.json` does not exist, create it with all default values.
- On every subsequent launch, read `settings.json` before the window is shown (blocking read during init, before `window.show()`).
- Settings are read in Rust, serialized to JSON, and passed to the frontend via a Tauri command (`get_settings`).
- A corresponding `save_settings` Tauri command accepts the full settings object and writes atomically.

**Default Values:**
- `window`: 50% of primary screen width, 100% of screen height, centered horizontally.
- `editor.contentMaxWidth`: 900 (pixels).
- `editor.contentPadding`: `"responsive"` (frontend maps this to breakpoint-based padding).
- `editor.baseFontSize`: 16 (pixels).
- `theme.active`: `"default-dark"` (or whichever is the bundled default).
- `theme.fallback`: same as `theme.active` at time of last successful theme load.
- `recentFiles`: empty array `[]`.

**Acceptance Criteria:**
- AC-1.1: First launch creates `settings.json` at the correct path with all default values.
- AC-1.2: Subsequent launches read and apply saved settings before the window becomes visible.
- AC-1.3: `get_settings` Tauri command returns the full settings object as JSON.
- AC-1.4: `save_settings` Tauri command writes atomically (temp-file-swap pattern).
- AC-1.5: The `~/Library/Application Support/com.markable.app/` directory is created automatically if missing.

---

### R2: Window State Persistence

**As a user, I want** the app to reopen at the same position and size I left it.

**What must be built:**
- On window move or resize, save `window.x`, `window.y`, `window.width`, `window.height` to settings.
- Save is debounced at 1000ms to avoid excessive writes during drag/resize.
- On launch, restore the saved window position and size.
- Also persist `fullscreen` and `maximized` boolean states.

**Missing Monitor Behavior:**
- If the saved position would place the window entirely off-screen (e.g., the external monitor was disconnected), reset to defaults: 50% of current primary screen width, 100% of screen height, centered horizontally on the primary screen.

**Acceptance Criteria:**
- AC-2.1: Moving the window and relaunching restores the same position.
- AC-2.2: Resizing the window and relaunching restores the same size.
- AC-2.3: Fullscreen state persists across launches.
- AC-2.4: Window state saves are debounced (no more than one write per 1000ms during continuous drag/resize).
- AC-2.5: If the saved position is off-screen, the window centers on the primary display with default dimensions.

---

### R3: Content Width Persistence

**As a user, I want** my chosen content width preference to persist so my reading/writing layout is consistent.

**What must be built:**
- `editor.contentMaxWidth` controls the CSS `max-width` of the `.cm-content` area in preview mode.
- Default: 900px.
- Responsive padding based on breakpoints:
  - Window width < 640px (sm): 16px left/right padding.
  - Window width 640-767px (md): 24px left/right padding.
  - Window width 768-1023px (lg): 64px left/right padding.
  - Window width >= 1024px (xl): 64px left/right padding.
- These breakpoints and padding values are defined in CSS. The setting persists the user's chosen `contentMaxWidth` value. Users may later tweak padding percentages directly in CSS/themes.
- When the user changes content width in the settings panel, the editor updates immediately (no restart).

**Acceptance Criteria:**
- AC-3.1: `contentMaxWidth` value persists across launches.
- AC-3.2: Changing content width in the settings panel updates the editor layout immediately.
- AC-3.3: Responsive padding breakpoints are applied via CSS (not JavaScript).
- AC-3.4: The value 900 is the default if no setting exists.

---

### R4: Font Size Persistence

**As a user, I want** my chosen base font size to persist so text is always at my preferred reading size.

**What must be built:**
- `editor.baseFontSize` is a numeric value (in pixels) that acts as the base from which all editor typography scales.
- H1-H6 sizes scale proportionally from this base (using the existing em-based scale in `styles.css`: H1 = 3em, H2 = 2.2em, H3 = 1.75em, H4 = 1.5em, H5 = 1em, H6 = 0.9em).
- Default: 16px (matching the current `previewTheme` in `extensions.ts`).
- Changing the font size in the settings panel updates the editor immediately.

**Acceptance Criteria:**
- AC-4.1: `baseFontSize` persists across launches.
- AC-4.2: Changing font size in the settings panel updates all editor text immediately.
- AC-4.3: Heading sizes scale proportionally (the em ratios do not change).
- AC-4.4: Default base font size is 16px.

---

### R5: Recent Files List

**As a user, I want** to quickly reopen recently edited files without navigating the filesystem.

**What must be built:**
- Maintain a list of up to 10 most recently opened/saved file paths in `recentFiles`.
- When a file is opened or saved, add it to the front of the list (or move it to the front if already present).
- If the list exceeds 10 items, drop the oldest entry.
- Recent files are displayed in the File menu as a submenu.
- The most recent file can be reopened via a keyboard shortcut: `Cmd-Opt-O` ("Reopen Last").
- Stale entries (file no longer exists on disk) are shown grayed out in the menu. If the user attempts to open a stale entry, show a brief notification that the file was not found and remove it from the list.

**Acceptance Criteria:**
- AC-5.1: Opening a file adds it to the recent files list.
- AC-5.2: The list never exceeds 10 entries.
- AC-5.3: Duplicate paths are moved to the front, not duplicated.
- AC-5.4: Recent files persist across launches.
- AC-5.5: `Cmd-Opt-O` reopens the most recent file.
- AC-5.6: Stale entries appear grayed out and are removed on attempted open.

---

### R6: Theme Persistence

**As a user, I want** my chosen theme to load automatically on every launch because I spent time selecting it.

**What must be built:**
- `theme.active` stores the name/identifier of the currently selected theme.
- `theme.fallback` stores the last known-good theme. This is updated whenever a theme loads successfully. If the active theme fails to load (file missing, CSS parse error), the app falls back to `theme.fallback`. If both fail, fall back to a hardcoded default bundled with the app.
- On launch, load the theme specified by `theme.active` before showing the window (part of the no-flash init sequence).
- Theme changes via the Theme menu or settings panel update `theme.active` and persist immediately.

**Acceptance Criteria:**
- AC-6.1: Selected theme persists across launches.
- AC-6.2: If the active theme file is missing or corrupt, the app falls back to `theme.fallback`.
- AC-6.3: If both active and fallback themes fail, the app loads the hardcoded bundled default.
- AC-6.4: The app never crashes due to a theme loading error.
- AC-6.5: Theme changes take effect immediately without restart.
- AC-6.6: `theme.fallback` is updated only after a theme loads successfully.

---

### R7: Settings Panel UI

**As a user, I want** a clean settings panel to adjust my preferences visually, without editing JSON.

**What must be built:**
- A settings panel accessible via `Cmd-,` (standard macOS shortcut) or System Menu > Settings.
- Style reference: Whispr Flow (https://wisprflow.ai/) -- clean, minimal, no clutter.
- The panel is a modal overlay or a slide-in panel (Architect to decide based on app layout).
- Phase 1 settings panel includes:
  1. **Content Width**: A slider or numeric input (min: 500px, max: 1400px, step: 50px).
  2. **Base Font Size**: A slider or numeric input (min: 10px, max: 28px, step: 1px).
  3. **Theme Selection**: A list or dropdown of available themes (from themes directory).
  4. **Recent Files**: A "Clear Recent Files" button.
- Changes apply immediately (live preview as user adjusts).
- A "Reset to Defaults" button restores all settings to their default values.
- The panel does NOT include keybinding configuration (deferred to Phase 2).

**Acceptance Criteria:**
- AC-7.1: `Cmd-,` opens the settings panel.
- AC-7.2: Content width can be adjusted and the editor updates live.
- AC-7.3: Font size can be adjusted and the editor updates live.
- AC-7.4: Theme can be selected from available themes.
- AC-7.5: "Clear Recent Files" empties the recent files list.
- AC-7.6: "Reset to Defaults" restores all settings to defaults and updates the editor immediately.
- AC-7.7: Settings panel is dismissible (Escape key or click-outside).
- AC-7.8: Settings panel respects the current theme (dark/light).

---

### R8: Settings Schema Migration

**As a user, I want** my settings to survive app updates without losing any values I customized.

**What must be built:**
- The settings file includes a `"version"` field (integer, starting at 1).
- On launch, if the file's version is less than the app's current schema version, run a migration:
  - Add any new keys with their default values.
  - Never overwrite existing user values.
  - Increment the version number.
  - Write the migrated settings file atomically.
- Migration logic is versioned and sequential (v1 -> v2, v2 -> v3, etc.).

**Acceptance Criteria:**
- AC-8.1: A v1 settings file opened by a v2 app gains new keys with defaults; existing values are preserved.
- AC-8.2: The version field is incremented after migration.
- AC-8.3: Migration writes atomically (no partial state on disk).
- AC-8.4: If migration fails, the app falls back to defaults and logs a warning (does not crash).

---

## Non-Functional Requirements

### NF1: Settings Load Performance

- Reading and applying settings must complete within 50ms on a modern machine. The window must not be delayed noticeably by settings I/O.

### NF2: Atomic Writes for Settings

- All settings writes use the existing temp-file-swap pattern (same as `write_file` in `commands/io.rs`). A crash or power loss during a settings save must never corrupt the settings file.

### NF3: No Restart Required

- All settings changes take effect immediately. The user never needs to restart the app to see a settings change applied.

### NF4: Settings Isolation

- Settings are stored per-app at the Tauri-standard path (`~/Library/Application Support/com.markable.app/`). They do not conflict with other apps.

### NF5: Graceful Degradation

- If settings.json is corrupt (invalid JSON), fall back to all defaults, log a warning to console, and overwrite the corrupt file with fresh defaults on next save.
- If settings.json is missing, create it with defaults silently.
- The app never crashes due to settings-related errors.

---

## Technical Constraints

### TC-1: Rust Owns Settings I/O

- All settings file reads and writes happen in Rust. The frontend never directly touches the filesystem for settings.
- Two new Tauri commands: `get_settings` (returns JSON) and `save_settings` (accepts JSON, writes atomically).

### TC-2: Atomic Writes (Reuse Existing Pattern)

- Reuse the temp-file-swap pattern from `commands/io.rs` for settings writes.

### TC-3: Debounced Window State Saves

- Window move/resize events trigger a save, but debounced at 1000ms. The debounce timer lives on the frontend side; it calls `save_settings` via the bridge.

### TC-4: Schema Versioning

- The `"version"` field is an integer. Migrations are sequential functions: `migrate_v1_to_v2()`, `migrate_v2_to_v3()`, etc.

### TC-5: Settings Read Before Window Show

- The existing no-flash pattern (`visible: false` -> init -> `window.show()`) must include settings read. The sequence is:
  1. Rust reads settings from disk.
  2. Frontend calls `get_settings` to receive the settings object.
  3. Frontend applies settings (theme, font size, content width).
  4. Frontend calls `window.show()`.

### TC-6: Responsive Padding in CSS Only

- Breakpoint-based padding is implemented with CSS media queries (or container queries), not JavaScript resize listeners. The `contentMaxWidth` setting is applied via a CSS custom property set by JavaScript.

### TC-7: Serde Deserialization in Rust

- Use `serde` and `serde_json` (already in Cargo.toml) for settings serialization/deserialization. Define a Rust struct with `#[derive(Serialize, Deserialize)]` that mirrors the JSON schema.

### TC-8: Application Support Directory

- Use Tauri's `app_data_dir()` resolver (or equivalent) to get `~/Library/Application Support/com.markable.app/`. Do not hardcode the path.

---

## Scope Boundaries

### In Scope (This Phase)

- `settings.json` file creation, reading, writing (atomic), and schema migration.
- Window state persistence (position, size, fullscreen, maximized).
- Content width persistence and responsive padding breakpoints.
- Base font size persistence with proportional heading scaling.
- Recent files list (max 10, `Cmd-Opt-O` to reopen last, File menu submenu).
- Theme name persistence with fallback chain (active -> fallback -> bundled default).
- Settings panel UI (content width, font size, theme selection, clear recent files, reset to defaults).
- Debounced window state saving (1000ms).
- Schema versioned migration (add new keys with defaults, never overwrite user values).
- Corrupt/missing settings file recovery.

### Deferred (NOT in this phase)

- **Keybinding customization** (keybindings.json, keybinding editor UI) -- deferred to Phase 2.
- **Theme directory scanning** (listing themes from ~/Library/Application Support/Markable/themes/) -- assumed to be handled by the theming phase. This phase persists the theme name only.
- **Settings import/export** -- not required.
- **Settings sync across devices** -- not required.
- **Auto-save toggle in settings** -- deferred to auto-save plugin phase.
- **Per-document settings** (e.g., different font size per file) -- not required.

---

## Edge Case Inventory

> Every item below must be covered by a test or explicit handling. This list is the Code Reviewer's mandatory test checklist.

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | `settings.json` does not exist (first launch) | Create with all defaults. App launches normally. |
| EC-2 | `settings.json` is empty (0 bytes) | Treat as corrupt. Fall back to all defaults, log warning, overwrite on next save. |
| EC-3 | `settings.json` contains invalid JSON | Treat as corrupt. Fall back to all defaults, log warning, overwrite on next save. |
| EC-4 | `settings.json` is valid JSON but missing keys (e.g., no `theme` field) | Merge: add missing keys with defaults, preserve existing values. |
| EC-5 | `settings.json` has unknown/extra keys (from a newer app version or manual edit) | Preserve extra keys. Do not strip them. Forward compatibility. |
| EC-6 | `settings.json` version is higher than app knows | Use the file as-is (best effort). Log a warning. Do not downgrade. |
| EC-7 | `settings.json` version is lower than current | Run sequential migration. Add new keys, never overwrite user values. |
| EC-8 | Application Support directory does not exist | Create the directory (and parents) before writing. |
| EC-9 | Application Support directory is not writable (permissions) | Log error. Use all defaults in memory. App still launches. Settings changes are in-memory only for that session. |
| EC-10 | Window position saved on external monitor that is now disconnected | Detect off-screen position. Reset to default: 50% primary width, 100% height, centered. |
| EC-11 | Window position saved as negative coordinates (partially off-screen) | If less than 50px of the window is visible on any screen, reset to defaults. |
| EC-12 | Fullscreen state saved but user changed display arrangement | Restore fullscreen on the primary display. |
| EC-13 | Rapid window move/resize (100+ events per second) | Debounce at 1000ms. Only the final position is saved. No filesystem thrashing. |
| EC-14 | Recent files list contains a path that no longer exists | Show grayed out in menu. If user clicks it, show notification "File not found", remove from list. |
| EC-15 | Recent files list contains duplicate paths (data corruption) | Deduplicate on load. Keep most recent occurrence only. |
| EC-16 | Recent files path is a directory (not a file) | Skip it. Do not display directories in recent files. |
| EC-17 | Theme specified in `theme.active` does not exist | Fall back to `theme.fallback`. If that also fails, use bundled default. |
| EC-18 | Theme CSS file exists but is corrupt (parse error) | Fall back to `theme.fallback`. Log warning. |
| EC-19 | Both `theme.active` and `theme.fallback` are invalid | Use hardcoded bundled default theme. Log warning. App never crashes. |
| EC-20 | `baseFontSize` set to extreme value (e.g., 0, -5, or 999) | Clamp to valid range on load: min 10px, max 28px. Log warning if clamping occurred. |
| EC-21 | `contentMaxWidth` set to extreme value (e.g., 0 or 99999) | Clamp to valid range on load: min 500px, max 1400px. Log warning if clamping occurred. |
| EC-22 | `Cmd-Opt-O` pressed with empty recent files list | No-op. Do nothing. |
| EC-23 | Settings save fails (disk full, permissions) | Log error. Settings remain in memory. Retry on next trigger. Do not crash. |
| EC-24 | Two settings saves triggered within debounce window | Only the final state is written. |
| EC-25 | App crashes during settings write | Atomic write ensures either old or new file exists -- never a partial write. On next launch, whichever file survived is loaded. |
| EC-26 | Settings panel opened while no file is open | All controls work normally. "Recent Files" section may show empty state. |
| EC-27 | User manually edits `settings.json` with a text editor while app is running | App does not watch the file. Changes take effect on next launch. |
| EC-28 | `Cmd-,` pressed while settings panel is already open | No-op or toggle (close the panel). Do not stack multiple panels. |

---

## Acceptance Criteria Summary

All of the following must be true before this phase is complete:

### Settings I/O
- [ ] `settings.json` is created on first launch at the correct Application Support path.
- [ ] `get_settings` Tauri command returns the settings object.
- [ ] `save_settings` Tauri command writes atomically.
- [ ] Corrupt settings file triggers fallback to defaults (no crash).
- [ ] Missing settings file triggers creation with defaults.

### Window State
- [ ] Window position and size persist across launches.
- [ ] Fullscreen state persists across launches.
- [ ] Off-screen window position resets to centered defaults.
- [ ] Window state saves are debounced at 1000ms.

### Editor Settings
- [ ] Content max-width persists and applies on launch.
- [ ] Responsive padding breakpoints work at all window sizes.
- [ ] Base font size persists and applies on launch.
- [ ] Heading sizes scale proportionally from base font size.

### Recent Files
- [ ] Recently opened files appear in the File menu submenu.
- [ ] `Cmd-Opt-O` reopens the most recently opened file.
- [ ] List never exceeds 10 entries.
- [ ] Stale entries are handled gracefully (grayed, removed on click).

### Theme
- [ ] Active theme name persists and loads on launch.
- [ ] Fallback chain works: active -> fallback -> bundled default.
- [ ] App never crashes due to theme errors.

### Settings Panel
- [ ] `Cmd-,` opens the settings panel.
- [ ] Content width, font size, and theme are adjustable.
- [ ] Changes apply immediately (no restart).
- [ ] "Reset to Defaults" works.
- [ ] Panel is dismissible via Escape or click-outside.

### Schema Migration
- [ ] Version field exists and is checked on load.
- [ ] Migration adds new keys without overwriting user values.
- [ ] Migration writes atomically.

### Code Quality
- [ ] All Rust code compiles with no warnings.
- [ ] All TypeScript code passes `tsc --noEmit`.
- [ ] No TODO comments in source files.
- [ ] All 28 edge cases are covered by tests or explicit handling.

---

## Files Expected to be Created or Modified

| File | Change |
|---|---|
| `src-tauri/src/commands/settings.rs` | New: Rust settings I/O (get, save, migrate, defaults) |
| `src-tauri/src/commands/mod.rs` | Modified: export settings commands |
| `src-tauri/src/lib.rs` | Modified: register settings commands in handler |
| `src-tauri/capabilities/default.json` | Modified: add any needed permissions (path access) |
| `src/lib/settings.ts` | New: TypeScript settings bridge (get, save, types) |
| `src/settings/settings-panel.ts` | New: Settings panel UI component |
| `src/settings/settings-panel.css` | New: Settings panel styles |
| `src/main.ts` | Modified: load settings on init, apply before window show |
| `src/styles.css` | Modified: responsive padding breakpoints, CSS custom properties for settings |
| `src/editor/extensions.ts` | Modified: accept dynamic font size / content width |
| `index.html` | Modified: settings panel DOM structure (if not injected via JS) |
| `tests/settings.test.ts` | New: frontend settings tests |

---

## Visual Verification Checklist (for user sign-off)

- [ ] Settings panel opens via Cmd-, and looks clean (Whispr Flow style)
- [ ] Content width slider changes editor layout in real time
- [ ] Font size slider changes all text proportionally in real time
- [ ] Theme selector shows available themes and switching is instant
- [ ] Settings panel respects current theme (dark/light)
- [ ] Close and relaunch: window reopens at same position and size
- [ ] Close and relaunch: font size and content width are remembered
- [ ] Close and relaunch: theme is remembered (no flash of wrong theme)
- [ ] Recent files appear in File menu after opening files
- [ ] Cmd-Opt-O reopens the last file
- [ ] Disconnect external monitor, relaunch: window centers on primary display

---

**Next step:** Activate @software-architect and provide this document as context for architecture design.
