---
title: "Step 01 — Plugin Scaffold"
last-updated: "2026-04-20"
review-cadence-days: 14
status: active
---

# Step 01 — Plugin Scaffold

## Goal

Create the plugin file with full lifecycle hooks, CSS injection, settings persistence, and global registration. After this step the plugin can be enabled/disabled without crashing, its settings round-trip correctly, and the global integration point exists for `handleAction` to call.

No dialog UI or insertion logic yet.

---

## File to Create

`src/plugins/insert-count/insert-count.plugin.ts`

---

## Plugin Metadata

```typescript
const PLUGIN_ID = "insert-count";

export default {
  id: PLUGIN_ID,
  name: "Insert Count",
  version: "1.0.0",
  description: "Insert an auto-incrementing numeric sequence at cursor positions",
  detail: `Insert Count places an incrementing number at each cursor position or at the start of each selected line.

Modes:
  Multi-cursor (Mode A): multiple cursors — each gets the next value.
  Selection (Mode B): one selection spanning multiple lines — each line gets the next value, inserted at the cursor column.
  Single cursor (Mode C): one cursor, no selection — inserts the Start value once.

Invoke via Edit > Insert Count... (Cmd-Shift-3) or Command Bar.`,
};
```

---

## Settings Type

Define at module scope inside the plugin file (not exported — IIFE scope):

```typescript
interface InsertCountSettings {
  start: number;
  step: number;
  wrap: string;
}

const DEFAULT_SETTINGS: InsertCountSettings = {
  start: 1,
  step: 1,
  wrap: "",
};
```

Module-level mutable state (also at IIFE scope):

```typescript
/** Last-used or default settings. Populated in onEnable, updated on successful Insert. */
let currentSettings: InsertCountSettings = { ...DEFAULT_SETTINGS };

/** Whether the Count Dialog is currently open. Prevents double-open (EC-19). */
let dialogOpen = false;

/** Reference to the dialog element, for cleanup in onDisable (EC-20). */
let dialogEl: HTMLElement | null = null;

/** CSS style element injected by this plugin. */
const CSS_ID = "markable-insert-count-styles";
```

---

## CSS Injection

Inject once in `onEnable`, guarded by element ID. Remove in `onDisable`.

```typescript
function injectStyles(): void {
  if (document.getElementById(CSS_ID)) return; // idempotent
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = INSERT_COUNT_CSS; // defined as a const string — see Dialog UI step
  document.head.appendChild(style);
}

function removeStyles(): void {
  document.getElementById(CSS_ID)?.remove();
}
```

`INSERT_COUNT_CSS` is a template literal constant in the same file (defined in step_02). In this step, leave it as an empty string placeholder: `const INSERT_COUNT_CSS = "";`

---

## onEnable

```typescript
async onEnable(api: MarkablePluginAPI): Promise<void> {
  // 1. Load persisted settings; fall back to defaults if null (EC-25).
  const saved = await api.loadSettings();
  if (saved && typeof saved === "object") {
    currentSettings = {
      start: typeof saved["start"] === "number" ? saved["start"] : DEFAULT_SETTINGS.start,
      step:  typeof saved["step"]  === "number" ? saved["step"]  : DEFAULT_SETTINGS.step,
      wrap:  typeof saved["wrap"]  === "string" ? saved["wrap"]  : DEFAULT_SETTINGS.wrap,
    };
  } else {
    currentSettings = { ...DEFAULT_SETTINGS };
  }

  // 2. Inject CSS (idempotent).
  injectStyles();

  // 3. Register global so handleAction can invoke the dialog.
  (window as any).__MARKABLE_INSERT_COUNT_OPEN__ = openDialog;
},
```

`openDialog` is implemented in step_02. Declare it as a forward reference here: `function openDialog(): void { /* step_02 */ }`

---

## onDisable

```typescript
async onDisable(_api: MarkablePluginAPI): Promise<void> {
  // 1. Close any open dialog without inserting (EC-20).
  if (dialogEl) {
    closeDialog(false); // false = do not insert
  }

  // 2. Remove injected CSS.
  removeStyles();

  // 3. Clear global so handleAction falls through to the alert (EC-02).
  (window as any).__MARKABLE_INSERT_COUNT_OPEN__ = null;
},
```

`closeDialog(insert: boolean)` is implemented in step_02.

---

## Settings Persistence — Save Helper

Define a helper called after successful Insert:

```typescript
async function persistSettings(api: MarkablePluginAPI, settings: InsertCountSettings): Promise<void> {
  try {
    await api.saveSettings({
      start: settings.start,
      step: settings.step,
      wrap: settings.wrap,
    });
    currentSettings = { ...settings };
  } catch (err) {
    // EC-26: Save failure does not roll back insertion; log and continue.
    console.warn("[insert-count] Failed to save settings:", err);
  }
}
```

The `api` instance must be captured in `onEnable` closure scope so `persistSettings` can access it. Assign it to a module-level variable:

```typescript
let pluginApi: MarkablePluginAPI | null = null;

// Inside onEnable:
pluginApi = api;

// Inside onDisable:
pluginApi = null;
```

---

## Global Type Declaration

At the top of the plugin file, add an ambient declaration so TypeScript is satisfied with `window` property access:

```typescript
declare global {
  interface Window {
    __MARKABLE_EDITOR_VIEW__: any;
    __MARKABLE_INSERT_COUNT_OPEN__: (() => void) | null;
  }
}
```

---

## Plugin Export

The IIFE entry point must return the plugin object. The file's default export is the plugin descriptor:

```typescript
// The IIFE loader appends "return __markablePlugin__;" after eval.
// Rollup wraps everything in:  var __markablePlugin__ = (function(){ ... })();
export default {
  id: PLUGIN_ID,
  name: "Insert Count",
  version: "1.0.0",
  description: "...",
  detail: "...",
  async onEnable(api: MarkablePluginAPI) { ... },
  async onDisable(api: MarkablePluginAPI) { ... },
} satisfies UnifiedPlugin;
```

Import the `UnifiedPlugin` and `MarkablePluginAPI` interfaces at the top of the file. Because this is an IIFE bundle, these types are compile-time only and produce no runtime imports:

```typescript
import type { UnifiedPlugin, MarkablePluginAPI } from "../markable-plugin-api";
```

---

## Edge Cases Addressed

| EC | How |
|---|---|
| EC-25 | `loadSettings` returns null → defaults applied with explicit property checks |
| EC-26 | `saveSettings` rejection caught, logged; insertion already applied |
| EC-20 | `onDisable` calls `closeDialog(false)` if `dialogEl` is non-null |

---

## Acceptance Criteria

- Plugin file passes TypeScript compilation with no errors.
- Enabling the plugin: `window.__MARKABLE_INSERT_COUNT_OPEN__` is a function.
- Disabling the plugin: `window.__MARKABLE_INSERT_COUNT_OPEN__` is null.
- CSS style tag `#markable-insert-count-styles` is present in DOM after enable, absent after disable.
- `loadSettings` returning null does not throw; module state contains defaults.
- `saveSettings` rejection is caught and does not propagate.
