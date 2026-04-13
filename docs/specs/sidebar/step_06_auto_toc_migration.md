---
title: "Step 06 — Auto TOC Migration"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 06 — Auto TOC Migration

## Goal

Migrate `src/plugins/auto-toc/auto-toc.plugin.ts` from its bespoke `.toc-editor-row` layout approach to the new sidebar API. The migration must:

- Remove all bespoke layout code while keeping all pure logic intact.
- Pass the existing `tests/auto-toc.test.ts` suite without any modification to that test file.
- Produce no visible behaviour change from the user's perspective.

**Dependencies:** step_04 (Plugin API has `registerSidebarPanel` / `unregisterSidebarPanel`).

---

## Files Changed

| File | Action |
|---|---|
| `src/plugins/auto-toc/auto-toc.plugin.ts` | Remove layout code; add sidebar API calls |

---

## What to Remove

The following items are **deleted** from `auto-toc.plugin.ts`:

1. **The `TOC_CSS` constant** — The layout CSS inside it (`.toc-editor-row`, `#toc-sidebar` block dimensions) is replaced by the shared `sidebar.css`. The content CSS (`.toc-list`, `.toc-item`, `.toc-item-active`, `.toc-empty`) moves to a new constant `TOC_CONTENT_CSS` (see below) because it still needs to be injected by the plugin.

2. **`_tocEditorRow: HTMLDivElement | null`** — module-level variable, removed entirely.

3. **`_tocSidebar: HTMLDivElement | null`** — module-level variable, removed entirely.

4. **`enableLayout(sidebar: HTMLDivElement): void`** — function deleted entirely.

5. **`disableLayout(): void`** — function deleted entirely.

6. **`createSidebar(): HTMLDivElement`** — function deleted entirely. Panel content creation moves into the `render` callback inside `onEnable`.

7. The call to `injectCSS()` in `onEnable` and `removeCSS()` in `onDisable` are updated to use the new constant name `TOC_CONTENT_CSS` (the layout CSS is no longer injected by the plugin).

8. The `_tocSidebar = createSidebar(); enableLayout(_tocSidebar);` lines in `onEnable` are removed.

9. The `disableLayout();` call and `removeCSS();` call in `onDisable` are updated/removed accordingly.

10. In `onDisable`, the comment `// _tocList, _tocEditorRow, _tocSidebar are already nulled by disableLayout().` is removed; `_tocList` is now nulled directly.

---

## What to Keep (Unchanged)

The following items are **not modified**:

- `HeadingEntry` interface and its export.
- `scanHeadings()` function and its export.
- `findActiveIndex()` function and its export.
- `DEBOUNCE_MS` constant.
- `_view`, `_enabled`, `_debounceTimer`, `_lastEntries`, `_tocList` module-level variables (all kept; `_tocList` is now set by the `render` callback instead of `createSidebar()`).
- `getCmEditorView()` function.
- `rebuildTOC()` function — unchanged (it writes to `_tocList` as before).
- `buildTocUpdateListener()` function — unchanged.
- `injectCSS()` and `removeCSS()` functions — kept but updated to reference the new `TOC_CONTENT_CSS` constant and style id.

---

## New Constant: `TOC_CONTENT_CSS`

Replace `TOC_CSS` with `TOC_CONTENT_CSS` containing only the content-area styles (no layout):

```typescript
const TOC_CONTENT_CSS = `
.toc-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.toc-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.toc-item:hover {
  background: var(--code-bg);
}

.toc-item-active {
  color: var(--text-primary);
  border-left: 2px solid var(--link-color);
  background: var(--selection-bg);
}

.toc-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
`;
```

Update the style tag id in `injectCSS` and `removeCSS` to keep the existing `"__markable_auto_toc_css__"` id — this prevents any change to the idempotency guard logic.

---

## Updated `onEnable`

The new `onEnable` implementation:

```typescript
onEnable(api: MarkablePluginAPI): void {
  _enabled = true;

  // Forward-compatibility stub for future persisted settings.
  void api.loadSettings();

  injectCSS();  // injects TOC_CONTENT_CSS (renamed from TOC_CSS)

  // Build the CM6 listener.
  api.addExtensions([buildTocUpdateListener()]);

  // Register the sidebar panel. The render callback creates .toc-list DOM
  // inside the provided container and triggers the initial TOC build.
  api.registerSidebarPanel({
    id: "auto-toc",
    title: "Table of Contents",
    side: "right",
    defaultWidth: 220,

    render(container: HTMLElement): void {
      // Create and attach the .toc-list element inside the sidebar container.
      const list = document.createElement("div");
      list.className = "toc-list";
      container.appendChild(list);
      _tocList = list;

      // Perform the initial TOC build.
      // EC-22: if __MARKABLE_EDITOR_VIEW__ is absent, render empty state;
      // the updateListener will populate on the first transaction.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
        | EditorViewType
        | undefined;
      /* eslint-enable @typescript-eslint/no-explicit-any */

      if (liveView) {
        _view = liveView;
        _lastEntries = scanHeadings(liveView.state.doc.toString());
        const activeIdx = findActiveIndex(
          _lastEntries,
          liveView.state.selection.main.head,
        );
        rebuildTOC(_lastEntries, activeIdx);
      } else {
        rebuildTOC([], -1);
      }
    },

    destroy(_container: HTMLElement): void {
      // Cancel any in-flight debounce (EC-6, EC-7).
      if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
      // Null the list reference. The container's DOM is removed by the
      // infrastructure after this callback returns.
      _tocList = null;
    },
  });
},
```

---

## Updated `onDisable`

```typescript
onDisable(api: MarkablePluginAPI): void {
  _enabled = false;

  // Cancel any in-flight debounce.
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Remove CM6 extension.
  api.removeExtensions();

  // Unregister the sidebar panel. SidebarManager calls destroy() before
  // removing the DOM, so the debounce cancel above runs before _tocList
  // is invalidated.
  api.unregisterSidebarPanel("auto-toc");

  // Remove the content CSS.
  removeCSS();

  // Reset module-level state.
  _view = null;
  _lastEntries = [];
  // _tocList is already nulled by the destroy() callback above.
},
```

---

## Why Destroy is Called Before `removeExtensions`

The order in `onDisable` is:
1. `_enabled = false` — guard flag; stops listener from processing.
2. Clear debounce.
3. `api.removeExtensions()` — removes the CM6 listener from the editor.
4. `api.unregisterSidebarPanel()` — calls `destroy()` on the container.

Calling `removeExtensions()` before `unregisterSidebarPanel()` ensures no further TOC rebuilds can fire after the `_tocList` reference is about to be nulled by `destroy()`. If a rebuild fired during destroy, `rebuildTOC` would safely return early (`if (!_tocList) return`) — but the ordering prevents the issue cleanly.

---

## Regression Test Requirement

`tests/auto-toc.test.ts` tests `scanHeadings` and `findActiveIndex` as pure functions. These functions are not modified. The test file must pass without any changes.

Verify by running:
```bash
npx vitest run tests/auto-toc.test.ts
```

Expected: all existing tests green.

---

## Acceptance Criteria

1. `tests/auto-toc.test.ts` passes without modification.
2. TypeScript compiler reports zero errors in `auto-toc.plugin.ts`.
3. The compiled IIFE (after `scripts/build-plugins.mjs`) does not reference `.toc-editor-row`, `enableLayout`, `disableLayout`, or `createSidebar`.
4. Enabling the Auto TOC plugin causes the TOC to appear in the right sidebar, populated from the current document.
5. Clicking a TOC item jumps to the heading and focuses the editor — same behaviour as before migration.
6. Disabling the Auto TOC plugin removes the TOC panel from the sidebar (the right sidebar disappears entirely if auto-toc was the only panel).
7. Toggling the plugin off and on twice produces no duplicate tabs, no duplicate DOM, and no duplicate event listeners (EC-20, NFR-3).
8. Hiding the right sidebar via keyboard shortcut (`Cmd-Shift-]`) while the TOC is active does not stop the CM6 update listener — on reveal, the TOC content is current (EC-21).
