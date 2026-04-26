---
title: "Command Bar — Step 01: Infrastructure"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 01 — Infrastructure

## Goal

Wire all the non-plugin pieces that the Command Bar plugin depends on:
1. Export the `COMMANDS` array from `keybindings-panel.ts`.
2. Add the `"command-bar-open"` entry to `COMMANDS`.
3. Register five window globals in `main.ts`.
4. Add the `"command-bar-open"` case to `handleAction()`.
5. Update the `window.focus` handler to respect the command-bar-open flag.

No plugin file is touched in this step. All changes are to app-level files.

---

## Files to Modify

| File | Change type |
|------|------------|
| `src/keybindings/keybindings-panel.ts` | Export COMMANDS; add new entry |
| `src/main.ts` | Globals, handleAction case, focus handler update |

---

## 1. `src/keybindings/keybindings-panel.ts`

### 1a. Export the COMMANDS array

Change line 15 from:

```typescript
const COMMANDS: CommandDef[] = [
```

to:

```typescript
export const COMMANDS: CommandDef[] = [
```

The `CommandDef` interface must also be exported so `main.ts` can annotate the global:

```typescript
export interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}
```

### 1b. Add `"command-bar-open"` to COMMANDS

Insert in the View section, immediately before the `view-toggle-preview` entry:

```typescript
{ id: "command-bar-open", label: "Command Bar", defaultKey: "Cmd-Shift-P", section: "View" },
```

**Rationale for placement**: "Command Bar" is a view-level navigation feature, so the
View section is correct. Placing it first in View keeps it near other navigation commands.

---

## 2. `src/main.ts`

### 2a. Add import

Add `COMMANDS` and `CommandDef` to the existing import from `keybindings-panel.ts`:

```typescript
import {
  createKeybindingsPanel,
  toggleKeybindingsPanel,
  resolveAction,
  COMMANDS,
} from "./keybindings/keybindings-panel";
import type { CommandDef } from "./keybindings/keybindings-panel";
```

### 2b. Register window globals in `initApp()`

Add the following block immediately after the `createKeybindingsPanel()` call (around
line 950 in the current file). The exact location must be after `createKeybindingsPanel()`
(so `COMMANDS` is populated) and after `pluginManager.loadPlugins()` (so the plugin
manager is initialized).

```typescript
// ── Command Bar globals ────────────────────────────────────────────────────
// Exposes the COMMANDS array, PluginManager, and settings accessor to the
// Command Bar IIFE plugin (AD-01, AD-02, AD-05 in 00_index.md).

(window as unknown as Record<string, unknown>)["__MARKABLE_COMMANDS__"] = COMMANDS;

(window as unknown as Record<string, unknown>)["__MARKABLE_PLUGIN_MANAGER__"] =
  pluginManager;

(window as unknown as Record<string, unknown>)["__MARKABLE_GET_SETTINGS__"] =
  getCurrentSettings;

// Set by the Command Bar plugin at open/close time.
// The window.focus handler reads this to avoid stealing focus from the overlay.
(window as unknown as Record<string, unknown>)["__MARKABLE_COMMAND_BAR_IS_OPEN__"] =
  false;

// Set to a () => void function by the plugin at onEnable; null at onDisable.
// handleAction("command-bar-open") calls this function.
(window as unknown as Record<string, unknown>)["__MARKABLE_COMMAND_BAR_OPEN__"] =
  null;
```

**Important**: `__MARKABLE_COMMANDS__` is a live reference to the same `COMMANDS` array
object. It does not need to be re-assigned if `COMMANDS` is mutated (it is not — it is
a static const array). The reference is sufficient.

### 2c. Add `"command-bar-open"` to `handleAction()`

Add immediately after the `"app-plugins"` case (around line 538):

```typescript
case "command-bar-open": {
  const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
  if (typeof openCB === "function") openCB();
  break;
}
```

When the Command Bar plugin is disabled, `__MARKABLE_COMMAND_BAR_OPEN__` is null, so the
call is a safe no-op (EC-19). No error dialog or fallback message is needed.

### 2d. Update the `window.focus` event handler

The current handler (around line 1096) is:

```typescript
window.addEventListener("focus", () => {
  if (findWidget?.isOpen()) {
    return;
  }
  if (editor) editor.focus();
});
```

Update to also check the Command Bar state (EC-26, AD-08):

```typescript
window.addEventListener("focus", () => {
  if (findWidget?.isOpen()) {
    return;
  }
  // Do not steal focus from the Command Bar overlay when the window regains focus.
  if ((window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__) {
    return;
  }
  if (editor) editor.focus();
});
```

---

## Interface Contracts

### `CommandDef` (exported from keybindings-panel.ts)

```typescript
export interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}
```

### Window globals added by this step

```typescript
// TypeScript-side type annotations for documentation purposes only.
// Accessed via (window as any).__MARKABLE_*__ at runtime.

window.__MARKABLE_COMMANDS__: CommandDef[]
window.__MARKABLE_PLUGIN_MANAGER__: PluginManager   // from src/plugins/index.ts
window.__MARKABLE_GET_SETTINGS__: () => MarkableSettings
window.__MARKABLE_COMMAND_BAR_IS_OPEN__: boolean
window.__MARKABLE_COMMAND_BAR_OPEN__: (() => void) | null
```

---

## Test Cases

These are unit-testable in `tests/plugins/command-bar/command-bar.test.ts` once the plugin
is implemented. For this step, verification is by inspection:

| Test | Expected |
|------|---------|
| `COMMANDS` contains `"command-bar-open"` entry | `defaultKey: "Cmd-Shift-P"`, `section: "View"` |
| `COMMANDS` is exported | TypeScript import of `COMMANDS` compiles without error |
| `CommandDef` is exported | TypeScript import of `CommandDef` compiles without error |
| `handleAction("command-bar-open")` when plugin disabled | No error thrown; `__MARKABLE_COMMAND_BAR_OPEN__` is null |
| `handleAction("command-bar-open")` when plugin enabled | Calls the registered open function |

---

## Acceptance Criteria

- [ ] `export const COMMANDS` compiles without TypeScript errors.
- [ ] `export interface CommandDef` compiles without TypeScript errors.
- [ ] `"command-bar-open"` appears in `COMMANDS` with `defaultKey: "Cmd-Shift-P"` and `section: "View"`.
- [ ] Pressing Cmd-Shift-P in the app triggers `handleAction("command-bar-open")` (verified via console.log in the case before plugin integration).
- [ ] All five window globals are assigned in `initApp()` after `createKeybindingsPanel()`.
- [ ] `window.focus` handler does not call `editor.focus()` when `__MARKABLE_COMMAND_BAR_IS_OPEN__` is `true`.
- [ ] No TypeScript compilation errors introduced in either file.
- [ ] `npm run build` passes.
