---
title: "Step 9: Plugin Lifecycle + Build Registration"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 9: Plugin Lifecycle + Build Registration

## Goal

Wire the complete `onEnable`/`onDisable` sequences, register the plugin in `build-plugins.mjs`, and write integration tests covering the full plugin lifecycle.

## Acceptance Criteria

1. Plugin metadata: `id: "backlinks"`, `name: "Backlinks"`, `version: "1.0.0"`, `description: "Wiki-link syntax and backlink tracking"`, `sidebarPanelId: "backlinks"`.
2. `onEnable` follows the sequence: inject CSS, build extensions, add extensions, register sidebar, trigger initial index build.
3. `onDisable` follows exact reversal: cancel timers, remove extensions, unregister sidebar, remove CSS, clear state.
4. Plugin is added to `PLUGINS` array in `build-plugins.mjs`.
5. All module-level state is reset in `onDisable` so the next `onEnable` starts clean.
6. Rapid enable/disable toggle does not leave stale timers or DOM artifacts (EC-15).

## Design

### Plugin Export

```typescript
export default {
  id: "backlinks",
  name: "Backlinks",
  version: "1.0.0",
  description: "Wiki-link syntax and backlink tracking",
  sidebarPanelId: "backlinks",
  detail:
    "Create wiki-links between Markdown files with [[filename]] syntax. " +
    "Auto-complete suggests files when typing [[. " +
    "The sidebar panel shows which files link back to your current document.",

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;

    // 1. Inject CSS
    injectCSS();

    // 2–3. Build and register CM6 extensions
    const extensions: Extension[] = [
      buildWikiLinkViewPlugin(),   // step 4: decorations
      buildClickHandler(),          // step 5: click-to-navigate
      ...buildAutocompleteExtension(), // step 6: auto-complete (may be empty)
      buildTabSwitchListener(),     // step 7: tab-switch detection
      buildDocChangeListener(),     // step 7: doc-change listener
    ];
    api.addExtensions(extensions);

    // 4. Register sidebar panel
    api.registerSidebarPanel({
      id: "backlinks",
      title: "Backlinks",
      side: "right",
      defaultWidth: 220,
      render(container: HTMLElement): void { /* ... step 8 render logic ... */ },
      destroy(_container: HTMLElement): void { /* ... step 8 destroy logic ... */ },
    });

    // 5. Trigger initial index build
    triggerIndexRebuild();
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    // 1. Cancel all pending timers
    if (_indexDebounceTimer) {
      clearTimeout(_indexDebounceTimer);
      _indexDebounceTimer = null;
    }
    // Also cancel doc-change debounce timer (held inside the listener closure)
    // This is handled by the _enabled guard in the timer callback.

    // 2. Remove CM6 extensions
    api.removeExtensions();

    // 3. Unregister sidebar panel
    api.unregisterSidebarPanel("backlinks");

    // 4. Remove CSS
    removeCSS();

    // 5. Clear all module-level state
    _index.clear();
    _cachedFileList = [];
    setCachedFileList([]);
    _lastKnownFile = null;
    _currentBacklinks = [];
    _isScanning = false;
    _backlinksListEl = null;
    _onScanningStateChanged = null;
    _onIndexRebuilt = null;
    _view = null;
  },
};
```

### Module-Level State Summary

All module-level variables that must be reset in `onDisable`:

| Variable | Type | Initial Value | Set By |
|---|---|---|---|
| `_enabled` | `boolean` | `false` | onEnable/onDisable |
| `_view` | `EditorView \| null` | `null` | updateListener |
| `_index` | `Map<string, string[]>` | `new Map()` | index builder |
| `_cachedFileList` | `string[]` | `[]` | index builder |
| `_indexDebounceTimer` | `timeout \| null` | `null` | triggerIndexRebuild |
| `_lastKnownFile` | `string \| null` | `null` | tab-switch listener |
| `_currentBacklinks` | `string[]` | `[]` | index builder |
| `_isScanning` | `boolean` | `false` | index builder |
| `_backlinksListEl` | `HTMLElement \| null` | `null` | sidebar render/destroy |
| `_onScanningStateChanged` | `fn \| null` | `null` | sidebar render/destroy |
| `_onIndexRebuilt` | `fn \| null` | `null` | sidebar render/destroy |

## Files to Modify

### `scripts/build-plugins.mjs`

Add to the `PLUGINS` array:

```javascript
const PLUGINS = [
  ["focus-mode",        "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode",   "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",        "src/plugins/word-count/word-count.plugin.ts"],
  ["auto-toc",          "src/plugins/auto-toc/auto-toc.plugin.ts"],
  ["markdown-toolbar",  "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"],
  ["backlinks",         "src/plugins/backlinks/backlinks.plugin.ts"],  // NEW
];
```

Also update the success message count from "5" to "6":

```javascript
console.log("\n[build-plugins] All 6 core plugins built successfully.");
```

### Plugin Directory Structure

Create: `src/plugins/backlinks/backlinks.plugin.ts`

This is the single file containing all plugin logic (AD-2). The directory exists for consistency with other plugins (focus-mode/, auto-toc/, etc.) even though there is only one file.

## TDD Test Plan

### Integration Tests: `tests/plugins/backlinks/backlinks.test.ts`

```
describe("backlinks plugin lifecycle", () => {
  test("onEnable registers extensions and sidebar panel")
  test("onDisable removes extensions and unregisters sidebar panel")
  test("onDisable clears all module-level state")
  test("rapid enable/disable does not leave stale timers (EC-15)")
  test("enable after disable starts with clean state")
})

describe("backlinks plugin metadata", () => {
  test("has correct id, name, version, description")
  test("has sidebarPanelId matching panel registration")
})

describe("EC-29: missing autocomplete global", () => {
  test("plugin enables successfully without __CM_AUTOCOMPLETE__")
  test("decorations and sidebar still work")
  test("console.warn logged about missing autocomplete")
})

describe("EC-30: missing tab manager global", () => {
  test("plugin enables successfully without __MARKABLE_TAB_MANAGER__")
  test("decorations and sidebar still render")
  test("click-to-navigate disabled with warning")
})
```

### Full Edge Case Coverage

This test file aggregates edge case tests from all steps. Tests that require CM6 mocking use the Vitest jsdom environment with the following setup:

```typescript
// Mock CM6 globals
beforeEach(() => {
  (window as any).__CM_VIEW__ = { /* mock EditorView, ViewPlugin, etc. */ };
  (window as any).__CM_STATE__ = { /* mock StateField, etc. */ };
  (window as any).__CM_LANGUAGE__ = { /* mock syntaxTree */ };
  (window as any).__CM_AUTOCOMPLETE__ = { /* mock autocompletion */ };
  (window as any).__MARKABLE_TAB_MANAGER__ = { /* mock tabManager */ };
  (window as any).__MARKABLE_CURRENT_FILE__ = "/test/docs/current.md";
  (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn() };
});
```

Pure function tests (parseWikiLinks, normalizeTarget, extractOutgoingLinks, etc.) do NOT need mocked globals and can run in any environment.

## Edge Cases Addressed

| EC | Handling |
|---|---|
| EC-15 | `_enabled = false` in onDisable guards all async callbacks. Timer cancellation prevents stale fires. All state reset ensures clean re-enable. |

## Build Verification

After implementation, verify:

1. `npm run build:plugins` -- backlinks.js is generated in `src-tauri/plugins/core/`
2. `cargo test` -- Rust tests for `list_md_files` pass
3. `npm test` -- All Vitest tests pass
4. Manual: enable backlinks plugin in Plugins Panel, verify sidebar panel appears
5. Manual: type `[[` in editor, verify autocomplete popup
6. Manual: click a wiki-link, verify navigation
7. Manual: check backlinks panel shows correct entries
