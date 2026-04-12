# Step 03 — PluginManager Pilot (Phase A3)

**Phase:** A3
**Checklist item:** `src/plugins/index.ts` created with `PluginManager` class and `pluginManager` singleton; Focus Mode only registered; not yet wired to `main.ts`
**Risk:** Low. This step creates one new file. No existing file is modified. The `pluginManager` singleton is instantiated at module scope but not imported or used by anything yet.

---

## Objective

Create the `PluginManager` class and the `pluginManager` singleton in `src/plugins/index.ts`.
Register only `FocusModePlugin` in this step. The class is complete (all methods implemented)
but the remaining three plugins are added in Step 6 after the pilot is approved.

This step does NOT wire the manager into `main.ts`. The app behavior is identical before and after.

---

## Prerequisite

Step 2 must be complete: `src/plugins/focus-mode/index.ts` exists and exports `FocusModePlugin`.

---

## File to Create

### `src/plugins/index.ts` (new)

```typescript
/**
 * PluginManager — central registry for Markable FC2 plugins.
 *
 * Plugins are registered in the constructor in display order (the order they
 * appear in the Plugins panel). Adding a new plugin requires only:
 *   1. Create src/plugins/<name>/index.ts implementing MarkablePlugin.
 *   2. Import it here and add it to the `this.plugins` array.
 *   3. Zero changes to main.ts.
 *
 * The `pluginManager` singleton is module-level. It is instantiated before the
 * editor exists. Therefore:
 *   - The constructor must not access the DOM.
 *   - `getExtensions()` must not access the DOM (it is called before editor creation).
 *   - `toggle()` and `restoreAll()` receive a PluginContext and may access the DOM.
 */

import type { Extension } from "@codemirror/state";
import type { MarkablePlugin, PluginContext, PluginDef } from "./plugin-types";
import type { MarkableSettings } from "../lib/settings";
import { updateSettings } from "../lib/settings";

// --- Plugin imports (add new plugins here) ---
import { FocusModePlugin } from "./focus-mode/index";
// NOTE: WordCountPlugin, StatusBarPlugin, TypewriterModePlugin added in Step 6.

export class PluginManager {
  private plugins: MarkablePlugin[];

  constructor() {
    // Registration order controls display order in the Plugins panel.
    // Full order (after Step 6): WordCount, StatusBar, FocusMode, TypewriterMode.
    // Pilot (Steps 3–5): FocusMode only.
    this.plugins = [
      FocusModePlugin,
    ];
  }

  /**
   * Aggregate CM6 extensions from all plugins that declare getExtensions().
   * Called once during buildExtensions() in extensions.ts before editor creation.
   * Pure — no side effects, no DOM access.
   */
  getExtensions(): Extension[] {
    const exts: Extension[] = [];
    for (const plugin of this.plugins) {
      if (plugin.getExtensions) {
        exts.push(...plugin.getExtensions());
      }
    }
    return exts;
  }

  /**
   * Enable or disable a plugin by id.
   * Calls onEnable/onDisable and persists the new state via updateSettings.
   *
   * @param id      Plugin id — must match a registered plugin's id.
   * @param enabled Target enabled state.
   * @param ctx     PluginContext from buildPluginContext() in main.ts.
   */
  toggle(id: string, enabled: boolean, ctx: PluginContext): void {
    const plugin = this.plugins.find((p) => p.id === id);
    if (!plugin) {
      console.warn(`PluginManager.toggle: unknown plugin id "${id}"`);
      return;
    }
    if (enabled) {
      plugin.onEnable(ctx);
    } else {
      plugin.onDisable(ctx);
    }
    // Persist the new state. Each plugin's onEnable/onDisable may also
    // persist additional fields (e.g. statusBar.visible). That is intentional
    // and additive — this call persists the plugin's own boolean toggle.
    void updateSettings((s) => ({
      ...s,
      [id]: enabled,
    }));
  }

  /**
   * Restore all plugins from persisted settings. Called once during initApp()
   * after the editor is created.
   *
   * For each plugin:
   *   - If restoreFromSettings() is defined, delegates to it entirely.
   *   - Otherwise, applies the default: enable if settings[plugin.id] === true.
   *
   * The default path sets _enabled = false for disabled plugins but does NOT
   * call onDisable (which would be a no-op since the plugin starts disabled).
   */
  restoreAll(settings: MarkableSettings, ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      if (plugin.restoreFromSettings) {
        plugin.restoreFromSettings(settings, ctx);
      } else {
        const settingsValue = (settings as Record<string, unknown>)[plugin.id];
        if (settingsValue === true) {
          plugin.onEnable(ctx);
        }
        // If false/undefined, _enabled stays false (its initialized default).
      }
    }
  }

  /**
   * Returns a snapshot of all registered plugins' enabled states.
   * Used by togglePluginsPanel() to seed the panel's internal state object.
   */
  getStates(): Record<string, boolean> {
    const states: Record<string, boolean> = {};
    for (const plugin of this.plugins) {
      states[plugin.id] = plugin.isEnabled();
    }
    return states;
  }

  /**
   * Returns PluginDef[] for the registered plugins, in registration order.
   * Used by createPluginsPanel() as the data source for list rendering.
   */
  getDefinitions(): PluginDef[] {
    return this.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      detail: p.detail,
    }));
  }
}

export const pluginManager = new PluginManager();
```

---

## Files Modified

None. This step creates one new file only.

---

## Files Created

| File | Status |
|---|---|
| `src/plugins/index.ts` | New |

---

## Verification Checklist

- [ ] `src/plugins/index.ts` exists and TypeScript compiles without errors
- [ ] `pluginManager.getExtensions()` returns `[focusModeField, focusModePlugin]` (the two
  elements of `focusModeExtension`) — verifiable by inspection of `focus-mode.ts`
- [ ] `pluginManager.getStates()` returns `{ focusMode: false }` when called immediately
  (before restoreAll is called), reflecting the default `_enabled = false`
- [ ] No existing file was modified
- [ ] `npm run tauri dev` launches; app behavior is identical to before this step
- [ ] 29 Rust tests pass
- [ ] 204 Vitest tests pass

---

## Edge Cases to Verify

**EC-8:** `pluginManager` is instantiated at module scope. Confirm `FocusModePlugin`'s module
does not access `document` or `window` at import time. Looking at `focus-mode/index.ts`: it
imports CSS (which Vite handles at build time, not runtime) and imports symbols from
`./focus-mode` (pure CM6 types with no DOM access). The constructor is safe.

**EC-9:** The `pluginManager` const is resolved by the ES module system before any
function body runs. There is no timing window where `pluginManager` could be `undefined` when
imported by another module.

---

## Notes for Lead Developer

- The `updateSettings` import from `"../lib/settings"` is required for `toggle()`. Confirm this
  import does not create a circular dependency. `settings.ts` imports from `"./bridge"` and
  `"@tauri-apps/api/*"` only — no dependency back to `src/plugins/`.
- The `toggle()` method persists `[id]: enabled` as a top-level key on the settings object.
  This matches the existing pattern used by `handlePluginToggle()` in `main.ts` (e.g.
  `void updateSettings((s) => ({ ...s, wordCount: enabled }))` on line 713).
  For `statusBar`, the existing code persists `{ statusBar: { visible: enabled } }` not
  `{ statusBar: enabled }`. The `StatusBarPlugin.onDisable/onEnable` will handle this correctly
  in Step 6 by calling `updateSettings` itself for the nested field. The `toggle()` call's
  `[id]: enabled` write for statusBar will also happen but is harmless (overridden by
  `StatusBarPlugin`'s own persist call which happens first within the same microtask).
  For clarity: StatusBarPlugin's onEnable/onDisable must persist `statusBar: { visible: true/false }`
  themselves. The manager's fallback persist of `statusBar: true/false` is redundant but
  not harmful for that plugin. Document this in `StatusBarPlugin`'s `index.ts`.
- This file will be extended in Step 6 to register all 4 plugins. The comment
  `// NOTE: ... added in Step 6` is a temporary breadcrumb and must be removed in Step 6.
