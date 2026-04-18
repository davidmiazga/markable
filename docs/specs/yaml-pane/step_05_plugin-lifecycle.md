---
title: "YAML Pane — Step 05: Plugin Lifecycle"
last-updated: "2026-04-17"
review-cadence-days: 7
status: active
---

# Step 05 — Plugin Lifecycle

## Goal

Wire all previous steps together into the **complete plugin export object** with `onEnable` and `onDisable` lifecycle methods. Add the CM6 `updateListener` extension for document change detection and tab-switch handling. Register the plugin in the build system.

This step produces the final, functional plugin that can be loaded by the Markable plugin infrastructure.

---

## Files to Modify

| Action | File |
|---|---|
| Modify | `src/plugins/yaml-pane/yaml-pane.plugin.ts` — add lifecycle functions and plugin export |
| Modify | `scripts/build-plugins.mjs` — add yaml-pane to PLUGINS array |
| Modify | `tests/plugins/yaml-pane/yaml-pane.test.ts` — add lifecycle integration tests |

---

## Module-Level Lifecycle State

```typescript
let _enabled = false;
let _lastKnownFile: string | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _closingOffset: number = 0;   // updated on each successful parse; used by commit functions
```

`_closingOffset` is set on every successful `parseFrontMatter` call and stored module-level so that `dispatchFrontMatterUpdate` always has the current front matter block end position without re-parsing.

---

## CM6 Update Listener

### `buildUpdateListenerExtension(): any[]`

Factory function (not a module-level constant) — same pattern as `buildTocUpdateListener` in auto-toc. Calls `getCmEditorView()` only inside this factory, not at module load time.

```typescript
function buildUpdateListenerExtension(): any[] {
  const cmView = (window as any).__CM_VIEW__;
  if (!cmView || !cmView.EditorView) {
    console.warn("[yaml-pane] __CM_VIEW__ not available; live updates disabled.");
    return [];
  }

  return [
    cmView.EditorView.updateListener.of((update: any) => {
      if (!_enabled) return;

      // FR-3.7: if the transaction was self-dispatched by the YAML Pane,
      // skip re-rendering to avoid interrupting in-progress edits.
      // Also skip if userEvent matches our own dispatch (write-back does not
      // change what the parser would produce — the panel already reflects it).
      const isSelfDispatch = update.transactions.some(
        (tr: any) => tr.annotation
          ? tr.annotation((window as any).__CM_VIEW__?.Transaction?.userEvent) === YAML_PANE_USER_EVENT
          : false
      );
      if (isSelfDispatch) return;

      // Detect tab switch by comparing __MARKABLE_CURRENT_FILE__ with last known
      const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
      const tabSwitched = currentFile !== _lastKnownFile;

      if (tabSwitched) {
        _lastKnownFile = currentFile;
        // EC-17: discard any in-progress edit on tab switch
        _editingKey = null;
        _addFieldVisible = false;
      }

      // Only re-parse if doc changed OR tab switched
      if (!update.docChanged && !tabSwitched) return;

      // Debounce at 150ms (FR-1.4)
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }

      const docText = update.state.doc.toString();

      _debounceTimer = setTimeout(() => {
        if (!_enabled) return;

        const result = parseFrontMatter(docText);

        if (result.kind === "ok") {
          _closingOffset = result.closingOffset;
          const enriched = mergeWithSchema(result.fields, _schema);
          _panelState = { kind: "fields", fields: enriched };
        } else if (result.kind === "error") {
          _panelState = { kind: "error", message: result.message };
        } else {
          _panelState = { kind: "empty" };
        }

        rebuildPanelDOM();
      }, 150);
    }),
  ];
}
```

**Note on `userEvent` check:** The CM6 `Transaction.annotation(Transaction.userEvent)` API requires importing `Transaction` from `@codemirror/state`. In an IIFE plugin, this is accessible via `window.__CM_VIEW__`. The exact API to check `userEvent` annotation from a transaction object is:

```typescript
// CM6 way to read userEvent annotation:
const userEvent = tr.annotation(cmView.Transaction.userEvent);
// This returns the userEvent string set in view.dispatch({ ..., userEvent: "..." })
```

Simplification for MVP: since self-dispatch suppression is an optimization (not a correctness requirement — EC-13 documents that in-progress edits ARE discarded on external changes), **defer this check to a future enhancement**. For MVP: always re-render on `docChanged`. The `_editingKey` flag prevents overwriting a focused input element only if the full DOM rebuild preserves focus — which it does not (full innerHTML clear). Accept this as documented EC-13 behavior.

### Tab switch polling fallback

Follow the same pattern as Backlinks:

```typescript
_pollTimer = setInterval(() => {
  if (!_enabled) return;
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (currentFile !== _lastKnownFile) {
    _lastKnownFile = currentFile;
    _editingKey = null;
    _addFieldVisible = false;
    // Trigger immediate re-parse from current document
    const view = (window as any).__MARKABLE_EDITOR_VIEW__;
    if (!view) {
      _panelState = { kind: "empty" };
      rebuildPanelDOM();
      return;
    }
    const docText = view.state.doc.toString();
    const result = parseFrontMatter(docText);
    if (result.kind === "ok") {
      _closingOffset = result.closingOffset;
      const enriched = mergeWithSchema(result.fields, _schema);
      _panelState = { kind: "fields", fields: enriched };
    } else if (result.kind === "error") {
      _panelState = { kind: "error", message: result.message };
    } else {
      _panelState = { kind: "empty" };
    }
    rebuildPanelDOM();
  }
}, 500);
```

---

## `onEnable` Sequence (FR-8.2)

```typescript
async onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;

  // 1. Inject CSS
  injectYamlPaneCSS();

  // 2. Load settings
  _settings = await loadSettings();

  // 3. Load schema if path configured
  if (_settings.schemaPath) {
    const schemaResult = await loadSchema(_settings.schemaPath);
    if ('schema' in schemaResult) {
      _schema = schemaResult.schema;
      _schemaLoadError = null;
    } else {
      _schema = null;
      _schemaLoadError = schemaResult.error;
    }
  }

  // 4. Register sidebar panel
  api.registerSidebarPanel({
    id: "yaml-pane",
    title: "Properties",
    side: _settings.defaultSide,
    defaultWidth: 240,

    render(container: HTMLElement): void {
      renderPanel(container);
      // Trigger initial parse from current document
      const view = (window as any).__MARKABLE_EDITOR_VIEW__;
      if (view) {
        const result = parseFrontMatter(view.state.doc.toString());
        if (result.kind === "ok") {
          _closingOffset = result.closingOffset;
          const enriched = mergeWithSchema(result.fields, _schema);
          _panelState = { kind: "fields", fields: enriched };
        } else if (result.kind === "error") {
          _panelState = { kind: "error", message: result.message };
        } else {
          _panelState = { kind: "empty" };
        }
        rebuildPanelDOM();
      }
    },

    destroy(_container: HTMLElement): void {
      _panelContainer = null;
      _editingKey = null;
      _addFieldVisible = false;
      // Cancel debounce to prevent post-destroy render
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
    },
  });

  // 5. Register CM6 updateListener extension
  const extensions = buildUpdateListenerExtension();
  api.addExtensions(extensions);

  // 6. Set initial file tracking
  _lastKnownFile = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

  // 7. Start polling fallback
  _pollTimer = setInterval(/* see above */, 500);
}
```

**Note on `async onEnable`:** Check whether `MarkablePluginAPI` / the plugin loader handles an async `onEnable`. If the loader does not `await` the return value, use a fire-and-forget pattern with a sync `onEnable` that calls an `async _doEnable(api)` internally. Inspect `src/plugins/index.ts` to confirm before implementing.

### `onDisable` Sequence (FR-8.3)

```typescript
onDisable(api: MarkablePluginAPI): void {
  _enabled = false;

  // 1. Cancel all timers
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }

  // 2. Remove CM6 extensions
  api.removeExtensions();

  // 3. Unregister sidebar panel (calls destroy() internally)
  api.unregisterSidebarPanel("yaml-pane");

  // 4. Remove CSS
  removeYamlPaneCSS();

  // 5. Clear all module-level state
  _panelContainer = null;
  _panelState = { kind: "empty" };
  _editingKey = null;
  _addFieldVisible = false;
  _nestedExpanded = new Set();
  _schema = null;
  _schemaLoadError = null;
  _settings = { ...DEFAULT_SETTINGS };
  _lastKnownFile = null;
  _closingOffset = 0;
}
```

---

## Plugin Export Object

```typescript
export default {
  id: "yaml-pane",
  name: "YAML Pane",
  version: "1.0.0",
  description: "Display and edit document front matter as structured fields",
  detail:
    "Shows a 'Properties' sidebar panel that reads your document's YAML front matter " +
    "and presents each field as an editable form control. Supports type inference, " +
    "date pickers, tag chips, and schema-driven controlled vocabularies.",
  sidebarPanelId: "yaml-pane",

  renderDetailExtra(container: HTMLElement): void {
    // Schema path setting UI shown in the Plugins Panel detail view
    renderSchemaPathSetting(container);
  },

  onEnable(api: MarkablePluginAPI): void { ... },
  onDisable(api: MarkablePluginAPI): void { ... },
};
```

### `renderDetailExtra` — Schema Path Setting

The `renderDetailExtra` callback is called by the Plugins Panel when the user opens the yaml-pane plugin detail view. Render a form row:

```
Label: "Schema file path"
Input: <input type="text" value={_settings.schemaPath} placeholder="Absolute path to JSON schema file">
Button: "Browse..." (optional — opens file dialog)
Button: "Save"
Button: "Reload Schema"  (visible when _schemaLoadError is non-null or schema is loaded)
```

On "Save": call `saveSettings({ ..._settings, schemaPath: inputValue })`, then trigger schema reload.
On "Reload Schema": call `loadSchema(_settings.schemaPath)`, update `_schema`/`_schemaLoadError`, call `rebuildPanelDOM()`.

---

## `scripts/build-plugins.mjs` Change

Add to the `PLUGINS` array (after the `"templates"` entry):

```javascript
["yaml-pane", "src/plugins/yaml-pane/yaml-pane.plugin.ts"],
```

---

## Test Cases to Write First (Red Phase)

### Group: Lifecycle integration

These tests use mocked window globals and the module-level state to verify lifecycle behavior. They do not test the full DOM (that is step_04's responsibility).

```
1.  After onEnable: _enabled === true
2.  After onEnable: CSS <style> tag present in document.head
3.  After onDisable: _enabled === false
4.  After onDisable: CSS <style> tag removed from document.head
5.  After onDisable: all timer handles are null
6.  onEnable + onDisable + onEnable (toggle cycle): no duplicate CSS tags
7.  onDisable called before onEnable: no throw (idempotent)
```

### Group: updateListener (integration with mocked CM6)

```
8.  docChanged=true, docText="---\ntitle: Hi\n---\n" →
    _panelState.kind === "fields" after debounce fires

9.  docChanged=true, docText="No front matter" →
    _panelState.kind === "empty" after debounce fires

10. docChanged=true, docText="---\nbad: tab:\n\tindent\n---\n" →
    _panelState.kind === "error" after debounce fires

11. docChanged=false, selectionSet=false → debounce NOT scheduled (no unnecessary parse)

12. Debounce: two rapid docChanged events → only ONE parseFrontMatter called after 150ms
```

### Group: Tab switch

```
13. _lastKnownFile="a.md", currentFile changes to "b.md" →
    _editingKey reset to null, _addFieldVisible reset to false

14. Poll timer fires with changed file → rebuildPanelDOM called
```

### Group: `closingOffset` tracking

```
15. After successful parse, _closingOffset updated to result.closingOffset
16. commitScalarEdit calls dispatchFrontMatterUpdate with current _closingOffset
```

### Group: async onEnable check

```
17. If api.loadSettings() is called and returns stored schemaPath →
    loadSchema is called with that path during onEnable

18. If loadSchema returns error → _schemaLoadError is non-null, _schema is null
19. If loadSchema returns schema → _schema is non-null, _schemaLoadError is null
```

---

## Checklist: Pre-Submit Verification

Before marking this step complete, manually verify in the running app:

- [ ] `npm run build:plugins` completes without errors and produces `src-tauri/plugins/core/yaml-pane.js`
- [ ] Plugin appears in the Plugins Panel list as "YAML Pane"
- [ ] Enable the plugin: "Properties" panel opens on the right sidebar
- [ ] Open a document with `---\ntitle: Test\ndate: 2026-04-17\n---\n`:
  - Panel shows two field rows: "title" (text input) and "date" (date input)
- [ ] Edit "title" field, blur/Enter: editor document updates, Cmd-Z undoes the change
- [ ] Open a document with no front matter: panel shows "No front matter" + "Add Front Matter" button
- [ ] Click "Add Front Matter": inserts `---\ndate: ...\ntitle: ...\n---\n` at position 0
- [ ] Open a document with invalid YAML front matter: panel shows error state
- [ ] Disable and re-enable the plugin: no errors, panel re-appears
- [ ] Move panel to left sidebar: panel re-renders on left
- [ ] Plugin settings: enter a schema path, click Save → schema loads (or error shown if invalid)

---

## Implementation Notes

1. **`async onEnable` compatibility check:** Before implementing, read `src/plugins/index.ts` to confirm whether the plugin loader `await`s the `onEnable` return value. If it does not, restructure `onEnable` as a sync function that calls `_doEnable(api).catch(err => console.error(...))`. Settings and schema loading must be fire-and-forget but the CSS injection, extension registration, and panel registration should happen synchronously before the first render.

   Practical approach: do CSS injection and panel registration synchronously in `onEnable`. Start settings + schema loading async in parallel. On completion, update `_settings`, `_schema`, `_schemaLoadError` and call `rebuildPanelDOM()` to refresh the panel with schema-aware enriched fields.

2. **`_closingOffset` initialization:** On the initial render (inside `render()` callback), parse the document and set `_closingOffset` before rendering the field list. If the document has no front matter, `_closingOffset` stays 0 (used by "Add Front Matter" to insert at position 0).

3. **Commit functions and `_closingOffset`:** The commit functions (`commitScalarEdit`, `commitArrayEdit`, etc.) always read the current `_closingOffset` module-level variable. Because a write-back dispatch triggers the updateListener, which re-parses and updates `_closingOffset`, subsequent edits always use the correct offset. If two rapid edits occur before the debounce fires, the second edit uses the offset from before the first write-back — this is a benign race condition acceptable for MVP.

4. **`renderDetailExtra` hook availability:** Confirm that the `MarkablePluginAPI` interface includes a `renderDetailExtra` callback. Check `src/plugins/markable-plugin-api.ts`. If it does not exist yet, the schema path setting can instead be wired into the plugin's description text with a manual instruction, and the "Reload Schema" button placed in the panel header. Do not add `renderDetailExtra` to the API unless it already exists.

---

## Acceptance Criteria

- [ ] All lifecycle test cases pass
- [ ] `npm run build:plugins` succeeds with `yaml-pane.js` in output
- [ ] Plugin loads and renders panel in a running Tauri app
- [ ] All FR-8.2 `onEnable` steps execute in order
- [ ] All FR-8.3 `onDisable` steps execute in order
- [ ] No memory leaks: all timers cancelled, all DOM references nulled on disable
- [ ] Tab switch correctly discards in-progress edits (EC-17)
- [ ] `_closingOffset` stays accurate across multiple field edits
