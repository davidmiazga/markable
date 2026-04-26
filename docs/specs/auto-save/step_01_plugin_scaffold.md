---
title: "Auto-Save — Step 1: Plugin Scaffold"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 1 — Plugin Scaffold

## Goal

Create the `auto-save.plugin.ts` file with the complete IIFE-compliant structure,
plugin descriptor, settings type, defaults, module-level state declarations, and
empty stubs for `onEnable`, `onDisable`, and `renderDetailExtra`. Update
`vite.plugins.config.ts` to add the build entry. Confirm the build passes.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `src/plugins/auto-save/auto-save.plugin.ts` |
| Modify | `vite.plugins.config.ts` |

---

## 1.1 — Create `src/plugins/auto-save/auto-save.plugin.ts`

Create the directory and file. The scaffold must include:

### File header comment

Follow the exact convention established in `focus-mode.plugin.ts` and
`word-count.plugin.ts`:

```
/**
 * IIFE entry point for the Auto-Save core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/auto-save.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: no app-internal imports at runtime. All app interaction
 * goes through window globals and the api parameter. CM6 globals accessed via
 * window.__CM_VIEW__ / window.__CM_STATE__. CSS injected as <style> tags.
 *
 * EC-30, EC-31, EC-32: see focus-mode.plugin.ts for full rationale.
 */
```

### CM6 globals destructure

The plugin uses `EditorView.updateListener` (from `__CM_VIEW__`). Destructure only
what is needed:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Do NOT import `@codemirror/view` or `@codemirror/state` as runtime values. The build
marks those packages as external (see `vite.plugins.config.ts` `external` rule). Import
them type-only for IDE support:

```typescript
import type { ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

### Settings interface and defaults

```typescript
type TriggerMode = "debounce" | "focus-loss" | "both";

interface AutoSaveSettings {
  triggerMode: TriggerMode;
  debounceDelayMs: number;
}

const DEFAULT_SETTINGS: AutoSaveSettings = {
  triggerMode: "both",
  debounceDelayMs: 2000,
};
```

### Module-level state declarations

```typescript
/** Current persisted settings. Populated in onEnable; kept in sync by UI handlers. */
let _settings: AutoSaveSettings = { ...DEFAULT_SETTINGS };

/**
 * Guards the async onEnable continuation against a race with onDisable (EC-10).
 * Set true at the start of onEnable; set false at the start of onDisable.
 * The onEnable continuation checks this before attaching any listeners.
 */
let _active = false;

/** Pending debounce timer handle. Only one timer runs at a time (FR-03.4). */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Named reference to the blur handler so removeEventListener can remove exactly
 * the same function reference that addEventListener registered (FR-08.2, NFR-04).
 * Created fresh in each onEnable; set to null in onDisable after removal.
 */
let _blurHandler: (() => void) | null = null;

/** Plugin API reference, used by attemptSave and blurHandler. */
let _api: MarkablePluginAPI | null = null;
```

### `clampDelay` pure helper (export for tests)

```typescript
/**
 * Clamp a raw delay value to the valid range [500, 30000].
 * Non-numeric input falls back to the default (2000 ms) per FR-03.3.
 *
 * Exported for unit testing.
 *
 * @param raw - The raw value (number, string, or unknown) from settings or UI.
 * @returns   Integer delay in ms, clamped to [500, 30000].
 */
export function clampDelay(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.debounceDelayMs;
  return Math.max(500, Math.min(30_000, Math.round(n)));
}
```

### `loadAndMergeSettings` pure helper (export for tests)

```typescript
/**
 * Merge raw settings from api.loadSettings() with the defaults.
 * Returns a fully-populated AutoSaveSettings even when raw is null (EC-09).
 *
 * Exported for unit testing.
 *
 * @param raw - The return value of api.loadSettings(), or null.
 * @returns   Merged settings with validated and clamped values.
 */
export function loadAndMergeSettings(raw: Record<string, unknown> | null): AutoSaveSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const validModes: TriggerMode[] = ["debounce", "focus-loss", "both"];
  const triggerMode: TriggerMode = validModes.includes(raw.triggerMode as TriggerMode)
    ? (raw.triggerMode as TriggerMode)
    : DEFAULT_SETTINGS.triggerMode;
  const debounceDelayMs = clampDelay(raw.debounceDelayMs ?? DEFAULT_SETTINGS.debounceDelayMs);
  return { triggerMode, debounceDelayMs };
}
```

### `attemptSave` helper (stub only in step 1 — implementation in step 2)

```typescript
/**
 * Attempt to auto-save the currently active tab.
 * Skips silently when: tab manager unavailable, no active tab, untitled tab,
 * or clean tab. Exported for unit testing.
 */
export function attemptSave(): void {
  // Step 2 implementation
}
```

### CM6 `updateListener` extension (stub only in step 1 — implementation in step 2)

```typescript
/**
 * CM6 updateListener registered in debounce and both modes.
 * Resets the debounce timer on every docChanged transaction.
 * Exported for unit testing.
 */
export const autoSaveListener = EditorView.updateListener.of((_update: ViewUpdate) => {
  // Step 2 implementation
});
```

### `onEnable` and `onDisable` stubs

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _active = true;
  _api = api;
  const raw = await api.loadSettings();
  if (!_active) return; // EC-10: onDisable was called before load resolved
  _settings = loadAndMergeSettings(raw);
  // Step 2: attach listeners based on _settings.triggerMode
}

function onDisable(api: MarkablePluginAPI): void {
  _active = false;
  _api = null;
  // Step 2: teardown
}
```

### `renderDetailExtra` stub

```typescript
function renderDetailExtra(_container: HTMLElement): void {
  // Step 3 implementation
}
```

### Plugin default export

```typescript
export default {
  id: "auto-save",
  name: "Auto-Save",
  version: "1.0.0",
  description: "Automatically save documents after inactivity or on focus loss",
  detail:
    "Saves the active document automatically so you never lose work. " +
    "Choose between a debounce timer (saves N ms after you stop typing), " +
    "focus loss (saves when the app window loses focus), or both triggers together. " +
    "Untitled documents are always skipped — no unexpected Save dialogs.",
  onEnable,
  onDisable,
  renderDetailExtra,
};
```

---

## 1.2 — Update `vite.plugins.config.ts`

Add the auto-save entry to the exported array. It goes at the end (after `templates`)
with `clearOutput: false`:

```typescript
  pluginConfig(
    "auto-save",
    resolve(__dirname, "src/plugins/auto-save/auto-save.plugin.ts"),
    false,
  ),
```

The full modified export block will look like:

```typescript
export default [
  pluginConfig("focus-mode",        resolve(__dirname, "src/plugins/focus-mode/focus-mode.plugin.ts"),               true),
  pluginConfig("typewriter-mode",   resolve(__dirname, "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"),      false),
  pluginConfig("word-count",        resolve(__dirname, "src/plugins/word-count/word-count.plugin.ts"),               false),
  pluginConfig("status-bar",        resolve(__dirname, "src/plugins/status-bar/status-bar.plugin.ts"),               false),
  pluginConfig("markdown-toolbar",  resolve(__dirname, "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"),   false),
  pluginConfig("table-toolbar",     resolve(__dirname, "src/plugins/table-toolbar/table-toolbar.plugin.ts"),         false),
  pluginConfig("image-toolbar",     resolve(__dirname, "src/plugins/image-toolbar/image-toolbar.plugin.ts"),         false),
  pluginConfig("templates",         resolve(__dirname, "src/plugins/templates/templates.plugin.ts"),                 false),
  pluginConfig("auto-save",         resolve(__dirname, "src/plugins/auto-save/auto-save.plugin.ts"),                 false),
];
```

---

## 1.3 — Verification

Run `npm run build:plugins` and confirm:

1. Exit code is 0.
2. `src-tauri/plugins/core/auto-save.js` is created.
3. No TypeScript errors in `auto-save.plugin.ts`.
4. All previously built plugin `.js` files are still present in `src-tauri/plugins/core/`.

---

## Step 1 is done when

- `src/plugins/auto-save/auto-save.plugin.ts` exists and TypeScript-checks cleanly.
- `vite.plugins.config.ts` includes the auto-save entry.
- `npm run build:plugins` succeeds and produces `auto-save.js`.
