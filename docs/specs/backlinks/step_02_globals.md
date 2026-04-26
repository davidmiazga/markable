---
title: "Step 2: CM6 Globals + Tab Manager Global"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 2: CM6 Globals + Tab Manager Global

## Goal

Expose `window.__CM_AUTOCOMPLETE__` and `window.__MARKABLE_TAB_MANAGER__` so that IIFE plugins can access the CM6 autocomplete module and the tab manager singleton without bundling or importing them.

## Acceptance Criteria

1. `window.__CM_AUTOCOMPLETE__` is set to the `@codemirror/autocomplete` module object.
2. The global is set synchronously before any plugin IIFE runs (same timing as existing globals).
3. `window.__MARKABLE_TAB_MANAGER__` is set to the `tabManager` singleton instance.
4. The tab manager global is set after `tabManager` is created but before plugins are loaded.
5. Both globals are accessible from IIFE plugin code at runtime.

## Files to Modify

### `src/lib/cm-globals.ts`

Add after the existing `_cmLanguage` import:

```typescript
import * as _cmAutocomplete from "@codemirror/autocomplete";
```

Add after the existing `__CM_LANGUAGE__` assignment:

```typescript
// Required by backlinks.plugin.ts — exposes autocompletion, CompletionContext,
// CompletionResult, and related autocomplete utilities.
(window as unknown as Record<string, unknown>)["__CM_AUTOCOMPLETE__"] = _cmAutocomplete;
```

Update the JSDoc comment at the top to mention the new global:

```
 *   __CM_AUTOCOMPLETE__ — @codemirror/autocomplete exports used by backlinks (autocompletion)
```

### `src/main.ts`

Add after the existing `__MARKABLE_EDITOR_VIEW__` assignment (around line 786):

```typescript
  // AD-8: expose the tab manager so IIFE plugins (e.g. backlinks) can call
  // openFileInTab() for click-to-navigate without an app-internal import.
  (window as unknown as Record<string, unknown>)["__MARKABLE_TAB_MANAGER__"] =
    tabManager;
```

This line must be placed AFTER the editor is created (tabManager already exists as a module-level singleton) and BEFORE `pluginManager.loadPlugins()` is called, so that plugins see the global in their `onEnable`.

## TDD Test Plan

### TypeScript Tests

These are verified by the backlinks plugin tests in step 9. The globals themselves are simple assignments and do not need isolated unit tests. The critical validation is:

1. **EC-29 test**: Mock `window.__CM_AUTOCOMPLETE__` as undefined, verify the plugin logs a warning and autocomplete is not registered (but decorations and sidebar still work).
2. **EC-30 test**: Mock `window.__MARKABLE_TAB_MANAGER__` as undefined, verify click-to-navigate logs a warning and is disabled (but decorations and sidebar still render).

These tests live in `tests/plugins/backlinks/backlinks.test.ts` (step 9).

## Edge Cases Addressed

- **EC-29**: Autocomplete global not exposed -- the plugin must degrade gracefully. Step 6 (autocomplete source) will implement the guard: check for `window.__CM_AUTOCOMPLETE__` before building the autocomplete extension.
- **EC-30**: Tab manager global not exposed -- the plugin must degrade gracefully. Step 5 (click handler) and step 8 (sidebar panel) will implement guards: check for `window.__MARKABLE_TAB_MANAGER__` before calling `openFileInTab()`.

## Notes

The `@codemirror/autocomplete` package is already in `package.json` as a dependency (it is part of the base CM6 editor configuration). Adding the import to `cm-globals.ts` does not introduce a new dependency -- it only exposes the existing one to the window global namespace.
