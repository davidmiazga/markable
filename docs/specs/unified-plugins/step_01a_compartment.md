# Step 01a — CM6 Plugin Compartment

**Chunk:** 1 — Foundation
**Objective:** Add `pluginCompartment` to the editor extension set; expose `setEditorView()`, `addExtensions(pluginId, exts)`, and `removeExtensions(pluginId)` on `PluginManager`; call `pluginManager.setEditorView(editor)` from `main.ts` immediately after editor creation.

**Invariant throughout this step:** All four existing built-in plugins (FocusMode, TypewriterMode, WordCount, StatusBar) must keep working exactly as before. `PluginManager.getExtensions()` is NOT removed in this step — it continues to supply the static built-in extensions via `buildExtensions()` until Chunk 2 step_02c.

**Pre-condition:** Read `src/editor/extensions.ts`, `src/plugins/index.ts`, and `src/main.ts` before editing. Confirm that `pluginCompartment` does not already exist as an export in `extensions.ts`.

---

## Files to Modify

1. `src/editor/extensions.ts` — add `pluginCompartment` declaration and its initial slot in `buildExtensions()`
2. `src/plugins/index.ts` — add three private fields and four methods to `PluginManager`
3. `src/main.ts` — add one `setEditorView` call after editor creation

---

## 1. `src/editor/extensions.ts`

### 1a. Add the compartment declaration

Current lines 89–93:
```typescript
/** Compartment that holds the live preview extensions (toggleable). */
export const previewCompartment = new Compartment();

/** Compartment that controls editor editability (toggled for read-only help files). */
export const editableCompartment = new Compartment();
```

Insert after line 93 (after the `editableCompartment` declaration), before the `_hiddenPanelDom` block:

```typescript
/**
 * Compartment that holds all CM6 extensions contributed by plugins.
 * Managed by PluginManager.addExtensions() / removeExtensions().
 * Initialized empty in buildExtensions(); plugins populate it during restoreAll().
 * EC-18: starts empty — all plugin extensions are added post-init.
 */
export const pluginCompartment = new Compartment();
```

### 1b. Add the empty compartment slot to `buildExtensions()`

Current lines 183–185 (end of `buildExtensions()`):
```typescript
  extensions.push(...pluginManager.getExtensions());
  extensions.push(previewCompartment.of(previewExtensions));
  extensions.push(editableCompartment.of(EditorView.editable.of(true)));
```

Replace line 183 only (the `getExtensions()` line) with:
```typescript
  // Plugin-contributed CM6 extensions live inside pluginCompartment.
  // PluginManager.addExtensions() reconfigures this compartment post-init
  // (called from onEnable via the MarkablePluginAPI closure).
  // The static getExtensions() call below is retained for Chunk 1 compatibility
  // and is removed in step_02c once all built-ins use api.addExtensions().
  extensions.push(...pluginManager.getExtensions());
  extensions.push(pluginCompartment.of([]));
```

Note: this keeps the existing `getExtensions()` call AND adds the empty compartment. Both coexist until step_02c. The compartment starts empty because built-ins still use the static path for now.

**The import of `pluginManager` at line 22 is kept — it is still needed for `getExtensions()` in Chunk 1.**

---

## 2. `src/plugins/index.ts`

All changes in this section are **additive**. No existing method is modified or removed.

### 2a. Add `EditorView` import

Current line 21:
```typescript
import type { Extension } from "@codemirror/state";
```

Change to:
```typescript
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
```

### 2b. Add `pluginCompartment` import

After the existing imports (after line 28, before the plugin imports), add:
```typescript
import { pluginCompartment } from "../editor/extensions";
```

Note on circular dependency: `extensions.ts` imports `pluginManager` from `index.ts`; `index.ts` now imports `pluginCompartment` from `extensions.ts`. This creates a circular module dependency. ES module circular dependencies are resolved by JavaScript's module linker as long as neither file accesses the other's exports at module evaluation time (i.e., only at call time inside functions). This is safe here because:
- `extensions.ts` uses `pluginManager` only inside `buildExtensions()` (a function call, never at module level).
- `index.ts` uses `pluginCompartment` only inside `_reconfigureCompartment()` (a method, never at construction time).
Both files export constants that are fully initialized before any cross-file function calls happen.

If `tsc --noEmit` reports a circular dependency warning, it is informational only and does not indicate a runtime failure. Vitest with happy-dom handles this correctly.

### 2c. Add three private fields to `PluginManager`

Inside the `PluginManager` class body, after the existing field declarations on lines 60–61:
```typescript
  private plugins: MarkablePlugin[];
  private userPluginRecords: UserPluginRecord[] = [];
```

Add after line 61:
```typescript
  /**
   * Maps plugin id → CM6 extensions registered by that plugin.
   * Used to reconstruct the full compartment contents on every add/remove.
   * Decision 8: all-or-nothing removal per plugin id.
   */
  private extensionMap = new Map<string, Extension[]>();

  /**
   * Live EditorView reference. Set by setEditorView() after editor creation.
   * Null before the editor exists — addExtensions queues extensions when null.
   * EC-18.
   */
  private editorView: EditorView | null = null;

  /**
   * Extensions queued by addExtensions() calls that arrive before
   * setEditorView() is called. Flushed immediately inside setEditorView().
   * EC-18: prevents dropped extensions during async startup sequences.
   */
  private pendingExtensions: Array<{ pluginId: string; exts: Extension[] }> = [];
```

### 2d. Add four public/private methods to `PluginManager`

Add the following four methods anywhere after the existing `getExtensions()` method (after line 91). Do not modify any existing method.

```typescript
  /**
   * Store the live EditorView reference. Called once from main.ts immediately
   * after createEditor() returns, before restoreAll() is called.
   *
   * Flushes any extensions that were queued before the editor existed (EC-18).
   * The pendingExtensions queue will be empty under the normal startup sequence,
   * but is drained here for correctness regardless.
   */
  setEditorView(view: EditorView): void {
    this.editorView = view;
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
   * shared pluginCompartment. Called from a plugin's onEnable via the API closure.
   *
   * Replaces any extensions previously registered under this plugin id
   * (idempotent on repeated enable calls, e.g. toggle off → on).
   *
   * EC-18: if the editor does not yet exist, the extensions are queued and
   * applied immediately when setEditorView() is called.
   *
   * @param pluginId  The calling plugin's id (captured in buildMarkablePluginAPI closure).
   * @param exts      CM6 extensions to register for this plugin.
   */
  addExtensions(pluginId: string, exts: Extension[]): void {
    if (!this.editorView) {
      this.pendingExtensions.push({ pluginId, exts });
      return;
    }
    this.extensionMap.set(pluginId, exts);
    this._reconfigureCompartment();
  }

  /**
   * Remove all CM6 extensions registered under the given plugin id and
   * reconfigure the shared pluginCompartment.
   *
   * EC-17: no-op if the plugin id has no registered extensions.
   *
   * @param pluginId  The calling plugin's id (captured in buildMarkablePluginAPI closure).
   */
  removeExtensions(pluginId: string): void {
    if (!this.extensionMap.has(pluginId)) return; // EC-17: nothing to remove
    this.extensionMap.delete(pluginId);
    if (!this.editorView) return; // No view to dispatch on (shouldn't happen post-init).
    this._reconfigureCompartment();
  }

  /**
   * Dispatch a Compartment.reconfigure effect on the live EditorView,
   * rebuilding the flat extension array from all currently registered plugins.
   * Internal — not part of the public PluginManager API.
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

## 3. `src/main.ts`

### 3a. Add `setEditorView` call after editor creation

Current lines 829–845:
```typescript
  // Create editor instance
  editor = createEditor(editorContainer, "");
  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  // Apply editor settings (content width + font size)
  applyEditorSettings(settings.editor);

  // Preview mode starts ON — hide line numbers
  editorContainer.classList.add("preview-mode");

  // Restore all plugin states from persisted settings.
  // ctx is built here — after createEditor() — so editor is guaranteed non-null (EC-11).
  const ctx = buildPluginContext();
  pluginManager.restoreAll(settings, ctx);
```

Insert **after** the `if (!editor)` guard block and **before** `applyEditorSettings`, at the point where `editor` is guaranteed non-null. The exact insertion point is after line 834 (`return;`) and before line 837 (`applyEditorSettings`):

```typescript
  // Wire the PluginManager to the live EditorView so addExtensions/removeExtensions
  // can dispatch Compartment.reconfigure effects. Must be called before restoreAll()
  // so that any plugin calling api.addExtensions() in onEnable has a live view.
  pluginManager.setEditorView(editor);
```

The surrounding block becomes:
```typescript
  // Create editor instance
  editor = createEditor(editorContainer, "");
  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  // Wire the PluginManager to the live EditorView so addExtensions/removeExtensions
  // can dispatch Compartment.reconfigure effects. Must be called before restoreAll()
  // so that any plugin calling api.addExtensions() in onEnable has a live view.
  pluginManager.setEditorView(editor);

  // Apply editor settings (content width + font size)
  applyEditorSettings(settings.editor);
```

No import changes are needed in `main.ts` — `pluginManager` is already imported at line 72.

---

## Verification Checklist

- [ ] `extensions.ts` exports `pluginCompartment` (a `Compartment` instance).
- [ ] `buildExtensions()` includes `pluginCompartment.of([])` in its extension array.
- [ ] `buildExtensions()` still calls `pluginManager.getExtensions()` (static path unchanged for Chunk 1).
- [ ] `pluginManager` import in `extensions.ts` is still present (line 22 unchanged).
- [ ] `PluginManager` has private fields: `extensionMap`, `editorView`, `pendingExtensions`.
- [ ] `PluginManager` has public methods: `setEditorView(view)`, `addExtensions(pluginId, exts)`, `removeExtensions(pluginId)`.
- [ ] `PluginManager` has private method: `_reconfigureCompartment()`.
- [ ] `PluginManager.getExtensions()` still exists and is unchanged.
- [ ] `main.ts` calls `pluginManager.setEditorView(editor)` immediately after the `if (!editor)` guard.
- [ ] `tsc --noEmit` passes with zero errors (circular dependency between `extensions.ts` and `index.ts` is expected and safe — see note in section 2b).
- [ ] App launches and all four built-in plugins (Focus Mode, Typewriter Mode, Word Count, Status Bar) still enable/disable correctly.
- [ ] Toggling Focus Mode on and off does not throw or produce console errors.
- [ ] Toggling Typewriter Mode on and off does not throw or produce console errors.
- [ ] `pluginCompartment` starts empty on app launch (verified: no visual change from before this step).
