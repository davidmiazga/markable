---
title: "Step 03 — Plugin Scaffold and Settings Panel"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Step 03 — Plugin Scaffold and Settings Panel

## Goal and Scope

Create the IIFE plugin entry point (`daily-note.plugin.ts`) with:
- Settings type definitions and defaults.
- `loadAndMergeSettings` / settings persistence logic.
- The `renderDetailExtra` settings UI (rendered inside the Plugins Panel detail view, same pattern as Auto-Save).
- The plugin default export object with stub `onEnable` / `onDisable` (real logic added in Steps 04 and 05).
- Add the plugin to the Vite build and to the stale-cleanup list.

This step is independently testable: the settings helpers are pure functions that can be tested without any window globals.

---

## Files to Create / Modify

| Action | File |
|---|---|
| CREATE | `src/plugins/daily-note/daily-note.plugin.ts` |
| MODIFY | `vite.plugins.config.ts` — add `daily-note` entry |
| MODIFY | `src-tauri/src/commands/plugins.rs` — add `"daily-note"` to stale cleanup list |

---

## Implementation Spec

### Settings Types (at the top of `daily-note.plugin.ts`)

```typescript
export interface DailyNoteSettings {
  dailyNoteFolder: string;          // default: "Daily Notes"
  dateFormat: string;               // default: "YYYY-MM-DD"
  openOnStartup: boolean;           // default: false
  templateFilePath: string;         // default: ""
  injectFrontMatter: boolean;       // default: false
  confirmCreate: boolean;           // default: false
  firstDayOfWeek: 'monday' | 'sunday';  // default: "monday"
  showWeekNumbers: boolean;         // default: false
}

const DEFAULT_SETTINGS: DailyNoteSettings = {
  dailyNoteFolder: 'Daily Notes',
  dateFormat: 'YYYY-MM-DD',
  openOnStartup: false,
  templateFilePath: '',
  injectFrontMatter: false,
  confirmCreate: false,
  firstDayOfWeek: 'monday',
  showWeekNumbers: false,
};
```

### `loadAndMergeSettings(raw: Record<string, unknown> | null): DailyNoteSettings`

Exported for unit tests. Merges raw settings from `api.loadSettings()` with defaults:
1. If raw is null → return `{ ...DEFAULT_SETTINGS }`.
2. For each key in DEFAULT_SETTINGS, use `raw[key]` if the type matches, else use the default.
3. Validate `dateFormat`: call `validateDateFormat(raw.dateFormat)`. If it returns an error string, fall back to `DEFAULT_SETTINGS.dateFormat` and log a console.warn. Do not throw.
4. Validate `firstDayOfWeek`: must be `'monday'` or `'sunday'`; else default.
5. Clamp numeric fields: none in this plugin (all booleans and strings).
6. Return the merged object.

### Settings UI (`renderDetailExtra`)

The detail view is rendered inside the Plugins Panel (same as Auto-Save). Build DOM elements manually — no JSX. All styles injected via a single `<style>` tag using CSS variables only (NFR-03).

#### UI Layout

```
Daily Notes Folder:  [text input]           (dailyNoteFolder)
Date Format:         [text input] [status]  (dateFormat — shows green check or red error)
First Day of Week:   [select: Monday / Sunday]
Template File:       [text input] [Choose…] [status badge]
─────────────────────────────────────────
Open on Startup:     [checkbox]
Inject Front Matter: [checkbox]
Confirm Before Create (non-today): [checkbox]
Show Week Numbers:   [checkbox]
```

#### Field behaviors

**`dailyNoteFolder`** — plain text input. On blur/change: update `_settings.dailyNoteFolder`; call `api.saveSettings(_settings)`. No validation (path validity is deferred to note creation).

**`dateFormat`** — text input. On input (not blur): call `validateDateFormat(value)`:
- If null (valid): show green checkmark badge; clear error message.
- If error string: show red/yellow inline error text listing the illegal characters.
On blur/change: if currently valid, update `_settings.dateFormat`; `api.saveSettings(_settings)`.
Also show the static informational text: "Changing date format does not rename existing notes." (EC-03, EC-40).

**`firstDayOfWeek`** — `<select>` with "Monday" and "Sunday" options. On change: update settings, `api.saveSettings`, then call `api.restartSelf()` (because the calendar grid must re-render with the new setting).

**`templateFilePath`** — text input + "Choose…" button. The "Choose…" button calls `window.__TAURI_DIALOG__.open({ filters: [{ name: 'Markdown', extensions: ['md'] }] })`. If the user selects a file, update the text input value and `_settings.templateFilePath`, then `api.saveSettings`. After save: check if the selected file actually exists (via `__TAURI_INTERNALS__.invoke('read_file', { path })` — if it throws, the file is missing). Show:
- No badge if path is empty.
- Green badge ("File found") if path is non-empty and file exists.
- Yellow badge ("File not found") if path is non-empty and file does not exist (EC-05).

**`openOnStartup`**, **`injectFrontMatter`**, **`confirmCreate`**, **`showWeekNumbers`** — checkboxes. On change: update settings, `api.saveSettings`. No restart required (these are read at action time, not at plugin init time).

#### CSS (injected via `injectCSS()`)

Use a unique id `__markable_daily_note_css__`. All colors via CSS variables. Keep the class names prefixed with `dn-` to avoid collision with other plugins.

Key classes:
- `.dn-settings-row` — `display: flex; align-items: center; gap: 8px; padding: 6px 0;`
- `.dn-settings-label` — `flex: 0 0 160px; font-family: var(--ui-font); font-size: 13px;`
- `.dn-settings-input` — text input styling with `var(--input-bg)`, `var(--border-color)`, `var(--text-color)`
- `.dn-badge-ok` — small green badge (`background: var(--accent-color)`, white text, 3px border-radius)
- `.dn-badge-warn` — yellow badge (`background: #f5a623`, white text)
- `.dn-badge-error` — red inline text (`color: var(--error-color, #e74c3c)`)
- `.dn-info-text` — muted note text (`color: var(--text-muted)`, italic, font-size 11px)

### `vite.plugins.config.ts` change

Locate the build inputs object (where other plugins like `auto-save`, `command-bar`, etc. are listed). Add:
```typescript
'daily-note': 'src/plugins/daily-note/daily-note.plugin.ts',
```

### `plugins.rs` stale cleanup change

In the `copy_core_plugins` command, there is an array of currently valid core plugin filenames. Add `"daily-note.js"` to that array so old copies are cleaned up on upgrade.

---

## Module-Level State Variables (defined in `daily-note.plugin.ts`)

These are private to the IIFE closure. Define them at module scope (after imports):

```typescript
let _settings: DailyNoteSettings = { ...DEFAULT_SETTINGS };
let _active = false;   // guards async onEnable continuation
let _api: MarkablePluginAPI | null = null;
let _generation = 0;   // incremented on disable and month navigation; guards async Tauri calls
```

`_generation` is the central cancellation token shared by all async operations in the plugin. Any function that awaits a Tauri call captures the current generation at the start and checks it after the await. If the captured value no longer equals `_generation`, the result is discarded.

---

## Stub `onEnable` and `onDisable`

At this step, `onEnable` and `onDisable` are stubs that will be expanded in Steps 04 and 05.

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _active = true;
  _api = api;
  const raw = await api.loadSettings();
  if (!_active) return;          // EC-10 guard (same as auto-save)
  _settings = loadAndMergeSettings(raw);
  injectCSS();
  // Steps 04 and 05 will add: registerCommands(), registerSidebarPanel(), startup logic
}

function onDisable(api: MarkablePluginAPI): void {
  _active = false;
  _api = null;
  _generation++;    // cancel all in-flight async operations
  removeCSS();
  // Steps 04 and 05 will add: unregisterCommands(), removeSidebarPanel()
}
```

---

## Test Cases (added to `tests/plugins/daily-note/daily-note.test.ts`)

These tests import `loadAndMergeSettings` from the plugin via dynamic import (with `__CM_VIEW__` stub set first, same as auto-save test pattern).

### Group 9: `loadAndMergeSettings` (12 tests)

64. **returns all defaults when raw is null**
65. **preserves valid `dailyNoteFolder` from raw**
66. **preserves valid `dateFormat` from raw**
67. **falls back to default `dateFormat` when format contains illegal chars** (EC-04)
68. **preserves boolean `openOnStartup: true`**
69. **preserves boolean `injectFrontMatter: true`**
70. **preserves boolean `confirmCreate: true`**
71. **preserves boolean `showWeekNumbers: true`**
72. **preserves valid `firstDayOfWeek: 'sunday'`**
73. **falls back to `'monday'` for invalid `firstDayOfWeek` value**
74. **preserves `templateFilePath` string**
75. **ignores unknown keys in raw (forward compatibility)**

---

## Definition of Done

- [ ] `daily-note.plugin.ts` exists with all settings types, `DEFAULT_SETTINGS`, `loadAndMergeSettings`, `injectCSS`, `removeCSS`, `renderDetailExtra`, stub `onEnable`/`onDisable`, and plugin default export.
- [ ] `renderDetailExtra` renders all 8 settings fields described above.
- [ ] `dateFormat` field shows inline validation error for illegal characters (EC-04).
- [ ] `templateFilePath` shows yellow warning badge when file is missing (EC-05).
- [ ] Informational text "Changing date format does not rename existing notes." is present (EC-03, EC-40).
- [ ] `vite.plugins.config.ts` includes the `daily-note` entry.
- [ ] `plugins.rs` stale cleanup list includes `"daily-note.js"`.
- [ ] All 12 `loadAndMergeSettings` tests pass.
- [ ] No hardcoded hex colors or font stack literals in CSS output.
