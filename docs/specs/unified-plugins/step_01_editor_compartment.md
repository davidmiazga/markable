# Step 01 — Editor Compartment

**Objective:** Add a `pluginCompartment` to the editor extension set; expose `setEditorView()`, `addExtensions()`, and `removeExtensions()` stubs on `PluginManager`; remove the static `pluginManager.getExtensions()` call from `extensions.ts`.

This step must be completed before step_02 because `MarkablePluginAPI` exposes `addExtensions`/`removeExtensions` which delegate into the structures defined here.

---

## Files to Modify

1. `src/editor/extensions.ts` — add `pluginCompartment`; remove `pluginManager.getExtensions()` line
2. `src/plugins/index.ts` — add `extensionMap`, `editorView`, `setEditorView()`, `addExtensions()`, `removeExtensions()` to `PluginManager`

---

## 1. `src/editor/extensions.ts`

### Add: export `pluginCompartment`

After line 93 (`export const editableCompartment = new Compartment();`), add:

```typescript
/**
 * Compartment that holds all CM6 extensions contributed by plugins.
 * Managed by PluginManager.addExtensions() / removeExtensions().
 * Initialized empty; plugins populate it during restoreAll().
 */
export const pluginCompartment = new Compartment();
```

### Change: `buildExtensions()` — replace static plugin extensions with empty compartment

Remove line 183:
```typescript
  extensions.push(...pluginManager.getExtensions());
```

Replace it with:
```typescript
  // Plugin-contributed extensions live inside pluginCompartment.
  // PluginManager.addExtensions() reconfigures this compartment post-init.
  // The compartment starts empty; plugins call addExtensions() in onEnable.
  extensions.push(pluginCompartment.of([]));
```

Remove the import of `pluginManager` at line 22 (`import { pluginManager } from "../plugins/index";`) — it will no longer be used from this file.

### Verification

After this change, `buildExtensions()` must not import anything from `src/plugins/`. The `pluginCompartment` is exported for use by `PluginManager`.

---

## 2. `src/plugins/index.ts` — Add compartment infrastructure to `PluginManager`

These additions are additive — existing methods are not changed in this step. The goal is to land the CM6 plumbing before the type system is replaced.

### Add imports at the top of the file

```typescript
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { pluginCompartment } from "../editor/extensions";
```

Note: `Extension` is already imported. `EditorView` and `pluginCompartment` are new.

### Add private fields to `PluginManager` class

Inside the class body, after the existing field declarations:

```typescript
/**
 * Maps plugin id → CM6 extensions registered by that plugin.
 * Used to reconstruct the full compartment on every add/remove.
 * PC-6: all-or-nothing per plugin id.
 */
private extensionMap = new Map<string, Extension[]>();

/**
 * Live EditorView reference. Set by setEditorView() after editor creation.
 * Null before the editor exists — addExtensions queues extensions when null.
 * EC-18.
 */
private editorView: EditorView | null = null;

/**
 * Extensions queued by addExtensions() calls that arrived before
 * setEditorView() was called. Flushed immediately in setEditorView().
 * EC-18.
 */
private pendingExtensions: Array<{ pluginId: string; exts: Extension[] }> = [];
```

### Add public methods

```typescript
/**
 * Store the live EditorView reference. Called once from main.ts immediately
 * after the editor is created, before restoreAll() is called.
 *
 * Flushes any extensions that were queued before the editor existed (EC-18).
 */
setEditorView(view: EditorView): void {
  this.editorView = view;
  // Flush any extensions queued before the editor was ready.
  for (const { pluginId, exts } of this.pendingExtensions) {
    this.extensionMap.set(pluginId, exts);
  }
  this.pendingExtensions = [];
  if (this.extensionMap.size > 0) {
    this._reconfigureCompartment();
  }
}

/**
 * Register CM6 extensions for the given plugin id and reconfigure the
 * shared pluginCompartment. Called from a plugin's onEnable via the API.
 *
 * EC-18: if the editor does not yet exist, the extensions are queued and
 * applied immediately when setEditorView() is called.
 *
 * @param pluginId  The calling plugin's id (captured in the API closure).
 * @param exts      CM6 extensions to add. Replaces any previously registered
 *                  extensions for this plugin id (idempotent on re-enable).
 */
addExtensions(pluginId: string, exts: Extension[]): void {
  if (!this.editorView) {
    // Queue for deferred application (EC-18).
    this.pendingExtensions.push({ pluginId, exts });
    return;
  }
  this.extensionMap.set(pluginId, exts);
  this._reconfigureCompartment();
}

/**
 * Remove all CM6 extensions registered by the given plugin id and
 * reconfigure the shared pluginCompartment.
 *
 * EC-17: no-op if the plugin id has no registered extensions.
 *
 * @param pluginId  The calling plugin's id (captured in the API closure).
 */
removeExtensions(pluginId: string): void {
  if (!this.extensionMap.has(pluginId)) return; // EC-17: no-op
  this.extensionMap.delete(pluginId);
  if (!this.editorView) return; // Cannot dispatch without a view.
  this._reconfigureCompartment();
}

/**
 * Dispatch a Compartment.reconfigure effect to the live EditorView,
 * rebuilding the flat extension array from all currently registered plugins.
 */
private _reconfigureCompartment(): void {
  if (!this.editorView) return;
  const allExts: Extension[] = [];
  for (const exts of this.extensionMap.values()) {
    allExts.push(...exts);
  }
  this.editorView.dispatch({
    effects: pluginCompartment.reconfigure(allExts),
  });
}
```

---

## Verification Checklist

- [ ] `extensions.ts` no longer imports from `src/plugins/index.ts`.
- [ ] `pluginCompartment` is exported from `extensions.ts` and initialized with `[]` in `buildExtensions()`.
- [ ] `PluginManager` has `setEditorView()`, `addExtensions()`, `removeExtensions()`, `_reconfigureCompartment()`.
- [ ] `extensionMap`, `editorView`, `pendingExtensions` are private class fields.
- [ ] `PluginManager.getExtensions()` still exists (not removed yet — removed in step_06).
- [ ] TypeScript compiles without errors (`tsc --noEmit`).
- [ ] Focus mode and typewriter mode still work (still loaded via static `getExtensions()` at this step — they are removed in step_06).
