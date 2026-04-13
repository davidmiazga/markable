---
title: "Step 04 — Plugin API Wiring"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 04 — Plugin API Wiring

## Goal

Expose `registerSidebarPanel` and `unregisterSidebarPanel` on `MarkablePluginAPI`. Wire `SidebarManager.init()` and `SidebarManager.restoreFromSettings()` into the `main.ts` startup sequence at the correct points.

**Dependencies:** step_01 (settings types), step_02 (SidebarManager module).

---

## Files Changed

| File | Action |
|---|---|
| `src/plugins/markable-plugin-api.ts` | Add two interface methods + two factory implementations |
| `src/main.ts` | Import sidebar module; call `initSidebar()` after editor creation; call `restoreSidebarFromSettings()` after plugins are restored |

---

## Change 1: `src/plugins/markable-plugin-api.ts`

### 1a. Add import at the top of the file

After the existing imports, add:

```typescript
import {
  registerSidebarPanel as _registerSidebarPanel,
  unregisterSidebarPanel as _unregisterSidebarPanel,
} from "../sidebar";
import type { SidebarPanelDescriptor } from "../sidebar";
```

The underscore-prefixed local names avoid collisions with the method names used in the interface and factory below. The `type` import for `SidebarPanelDescriptor` is erased at compile time.

### 1b. Re-export `SidebarPanelDescriptor`

Immediately after the import block, add:

```typescript
// Re-export for plugin author convenience — plugins can import the type
// directly from this module without knowing the internal sidebar/ path.
export type { SidebarPanelDescriptor } from "../sidebar";
```

### 1c. Add methods to the `MarkablePluginAPI` interface

Inside the `MarkablePluginAPI` interface body, after the `removeExtensions()` method, add:

```typescript
  /**
   * Register a sidebar panel for this plugin. Call in onEnable.
   *
   * The panel appears in the sidebar slot specified by descriptor.side.
   * Idempotent: calling again with the same id logs a warning and is rejected
   * (the first registration stays active) — EC-12.
   *
   * descriptor.render(container) is called immediately after registration.
   * If render throws, an error placeholder is shown inside the container — EC-13.
   *
   * @param descriptor  Panel configuration. The id must be unique across all
   *                    registered panels in the session.
   */
  registerSidebarPanel(descriptor: SidebarPanelDescriptor): void;

  /**
   * Unregister the sidebar panel with the given id. Call in onDisable.
   *
   * Calls descriptor.destroy(container) before removing the panel DOM.
   * If destroy throws, the error is logged but DOM removal still proceeds — EC-14.
   *
   * No-op if panelId was not registered by this plugin — EC-19.
   *
   * @param panelId  The id from the original SidebarPanelDescriptor.
   */
  unregisterSidebarPanel(panelId: string): void;
```

### 1d. Add implementations to `buildMarkablePluginAPI()`

Inside the `return { ... }` object in `buildMarkablePluginAPI()`, after the `removeExtensions` method, add:

```typescript
    /**
     * Delegates to SidebarManager.register(), capturing pluginId in the
     * closure so the manager can enforce ownership on unregister (EC-19).
     */
    registerSidebarPanel(descriptor: SidebarPanelDescriptor): void {
      _registerSidebarPanel(pluginId, descriptor);
    },

    /**
     * Delegates to SidebarManager.unregister(), passing pluginId for
     * ownership verification — only the registering plugin may unregister
     * its own panels (EC-19).
     */
    unregisterSidebarPanel(panelId: string): void {
      _unregisterSidebarPanel(pluginId, panelId);
    },
```

---

## Change 2: `src/main.ts`

### 2a. Add imports

After the existing plugin-related imports (near the `pluginManager` import), add:

```typescript
import {
  initSidebar,
  restoreSidebarFromSettings,
} from "./sidebar";
```

### 2b. Call `initSidebar()` after editor creation

In the `initApp()` function (or equivalent startup function), `initSidebar()` must be called **after** the CodeMirror editor has been created and mounted in `#editor`, and **before** `pluginManager.restoreAll()` is called. This ordering ensures that:
- `#editor` exists in the DOM when `initSidebar()` wraps it in `#app-row`.
- The `#app-row` wrapper is present before any plugin's `onEnable` calls `registerSidebarPanel`.

Locate the call to `pluginManager.restoreAll()` (or the equivalent plugin restore call) in `initApp()`. Immediately before it, insert:

```typescript
  initSidebar();
```

### 2c. Call `restoreSidebarFromSettings()` after plugin restore

Immediately after `pluginManager.restoreAll()` (or its `await`), insert:

```typescript
  restoreSidebarFromSettings();
```

This ordering satisfies EC-23 and EC-11: the sidebar checks which panels were actually registered by plugins before deciding whether to show itself, and never relies on persisted `open: true` alone if no panels arrived.

### 2d. Wire keyboard shortcuts for sidebar toggles in `handleAction()`

In the `handleAction(id: string)` function (or the menu/keybinding dispatch switch), add two new cases:

```typescript
  case "sidebar.toggleLeft":
    toggleSidebarSide("left");
    break;
  case "sidebar.toggleRight":
    toggleSidebarSide("right");
    break;
```

Also add the `toggleSidebarSide` import to the sidebar import line:

```typescript
import {
  initSidebar,
  restoreSidebarFromSettings,
  toggleSidebarSide,
} from "./sidebar";
```

---

## Startup Sequence Diagram (after this step)

```
initApp()
  1. loadSettings()
  2. createEditor()             ← #editor exists in DOM
  3. initSidebar()              ← #app-row created; #editor moved into it
  4. pluginManager.restoreAll() ← plugins call registerSidebarPanel()
                                   SidebarManager.register() runs for each
  5. restoreSidebarFromSettings() ← applies persisted open/closed state
  6. appWindow.show()           ← user sees final state
```

Steps 4 and 5 are distinct because plugins may be disabled: a sidebar whose last panel plugin is disabled must not show (EC-11).

---

## Acceptance Criteria

1. TypeScript compiler reports zero errors.
2. `api.registerSidebarPanel({ id: "x", side: "right", ... })` in a plugin's `onEnable` causes `#sidebar-right` to appear in the DOM.
3. `api.unregisterSidebarPanel("x")` from a different plugin (different `pluginId`) is a no-op — the panel is not removed.
4. `api.unregisterSidebarPanel("x")` from the owning plugin removes the panel and calls `descriptor.destroy`.
5. After `pluginManager.restoreAll()` + `restoreSidebarFromSettings()`, a sidebar with `open: false` in settings is not visible even if a panel was registered.
6. `handleAction("sidebar.toggleLeft")` when no panels are registered is a no-op.
7. `handleAction("sidebar.toggleRight")` when a panel is registered toggles `#sidebar-right` visibility and updates `settings.sidebar.right.open`.
