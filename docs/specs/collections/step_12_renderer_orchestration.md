---
title: "Step 12 — Renderer Orchestration"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 12 — Top-Level Renderer + Navigation State Machine

## Goal

Wire `home-canvas` + `breadcrumb` + `stack-panel` + `inline-editor` + `preview-cache` into one top-level renderer. Owns the home/stack navigation state, click-outside-to-commit, and replaces the stub registered in step 05.

## Files touched

- **New** `src/plugins/file-browser/collections/renderer.ts`
- **Edit** `src/plugins/file-browser/folder-view/tab.ts` (replace stub)
- **New** `tests/collections/renderer.test.ts`

## Function signatures to add

```typescript
import type { FolderViewConfig, FolderCard, BulkRenderContext } from "../folder-view/types";

/**
 * Entry point registered in LAYOUT_RENDERERS["collection-home"].
 * Replaces the stub installed in step 05.
 */
export function renderCollectionHome(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  collectionPath: string,
  bulkContext: BulkRenderContext,
): void;

// Internal navigation state machine.

interface CollectionsRendererState {
  view: "home" | "stack";
  collectionPath: string;
  activeStackPath: string | null;
  preview: PreviewCacheHandle;
  inlineEditor: InlineEditorHandle;
  stackPanel: StackPanelHandle | null;
  destroy: () => void;
}

function navigateToHome(state: CollectionsRendererState, container: HTMLElement): Promise<void>;
function navigateToStack(state: CollectionsRendererState, stackPath: string, container: HTMLElement): Promise<void>;

function wireGlobalClickOutside(state: CollectionsRendererState, container: HTMLElement): () => void;
// Returns a teardown function. Captures mousedown on container; if the
// click target is NOT inside the currently-editing box, calls
// state.inlineEditor.unmount(). Capture-phase to fire before the box
// loses focus.
```

## Failing tests to write FIRST

`tests/collections/renderer.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `home view renders the home-canvas` | FR-13 | DOM contains `.fv-collection-stack-glyph` (or empty-state) |
| `clicking a Stack glyph navigates to the Stack section view` | FR-15 | DOM swaps to `.fv-collection-stack-panel`; breadcrumb shows 2 segments (Home, Stack) |
| `clicking the breadcrumb Home segment navigates back to home` | FR-31 | DOM shows home canvas again |
| `clicking a note box mounts the editor in place` | FR-10 | box.el contains `.cm-editor` |
| `clicking another box commits the first and mounts the editor on the second` | EC-19 | first writeFile call fires before second box's editor mounts |
| `clicking outside any box commits the editor` | EC-19 | mousedown on container background → bridge.writeFile fires |
| `breadcrumb-click while editing commits the editor first` | EC-19 | writeFile fires before navigation |
| `editing a referenced box writes to the canonical file path` | EC-20 | writeFile called with canonical notePath, not the reference path |
| `Stack rename updates the breadcrumb middle segment in same render pass` | EC-24 | re-render after rename → middle segment label matches new name |
| `breadcrumb structure is "Home / Stack" (2 segments) in Stack view, "Home / Stack / Note" (3 segments) while editing` | FR-30 | 2 then 3 segments |
| `navigateToStack tears down any prior stack panel before mounting new one` | leak | mocked panel.destroy called once per nav |
| `destroy cleans up: inline-editor.destroy + stack-panel.destroy + preview-cache.clear` | tab close | all three spies fire |

## Implementation outline

1. **`renderCollectionHome`**:
   - `container.replaceChildren();` — also clear any prior state attached via WeakMap.
   - Build state object: `cache = createPreviewCache(); inlineEditor = createInlineEditor({ hostParent: hiddenHost, onSave: invalidateBoxPreview, onCommitError: toast });`
   - Append a hidden host div for the inline-editor parent (`<div class="fv-collection-editor-host" style="display:none"></div>`).
   - Append the `<nav>` breadcrumb placeholder.
   - Append a content area `<div class="fv-collection-content">`.
   - Initial render: `navigateToHome(state, container)`.
   - Wire global click-outside.
2. **`navigateToHome`**:
   - `await state.inlineEditor.unmount();`
   - `state.stackPanel?.destroy(); state.stackPanel = null;`
   - Update breadcrumb: 1 segment, `[{ label: "Home", onClick: null }]`.
   - Replace content area children with home canvas (call `renderHomeCanvas(contentEl, opts)`).
   - The `opts.onStackClick(path)` callback delegates to `navigateToStack(state, path, container)`.
   - The `opts.onCreateStack` callback calls `commands.newStack(collectionPath)` then re-renders home.
   - The `opts.onCreateNotecard` callback calls `commands.createNotecardInDefaultStack(...)` then navigates into that Stack (and triggers `beginInlineRename` on the new box).
   - `opts.onStackRename/Reorder/Delete/SetIcon` call into store/commands.
3. **`navigateToStack(stackPath)`**:
   - `await state.inlineEditor.unmount();`
   - `state.stackPanel?.destroy();`
   - Update breadcrumb: 2 segments, `[{ label: "Home", onClick: () => navigateToHome(...) }, { label: stackDisplayName, onClick: null }]`.
   - `state.stackPanel = await renderStackPanel(contentEl, { stackPath, cache, onNoteClick, ... });`
   - `onNoteClick(box)`:
     - `await inlineEditor.unmount(); // commit prior`
     - `const content = await bridge.readFile(box.notePath); inlineEditor.mount(box, content);`
     - Update breadcrumb to 3 segments (the third is the note filename, `onClick: null`).
4. **Click-outside wiring** (`wireGlobalClickOutside`):
   - `container.addEventListener("mousedown", handler, true);` (capture).
   - `handler(ev)`:
     - If `!state.inlineEditor.isMounted()` return.
     - `const editingBoxEl = document.querySelector(".fv-collection-note-box.is-editing")` (set by inline-editor on mount).
     - If `editingBoxEl && !editingBoxEl.contains(ev.target as Node)` → `void inlineEditor.unmount();` and revert breadcrumb to 2 segments.
   - Return teardown that removes the listener.
5. **`onSave(path, content)`**:
   - `cache.invalidate(path);`
   - Find the box handle whose `notePath === path` in `state.stackPanel.handlesByEl`; trigger re-render of its preview: `void renderPreview(handle, cache);`
   - For multi-reference propagation (EC-20): the **canonical** file changed; any other Stack rendering the same canonical (as a reference box) is on a different panel — handled when the user navigates there. The current panel's reference boxes pointing to the same canonical are also invalidated and re-rendered.
6. **`destroy`**:
   - Teardown click-outside.
   - `state.stackPanel?.destroy();`
   - `state.inlineEditor.destroy();`
   - `state.preview.clear();`

**State retention** between tab navigations: store a `WeakMap<HTMLElement, CollectionsRendererState>` keyed on the container; on re-entry, reuse existing state if the container reference is the same. (LAYOUT_RENDERERS calls the renderer fresh each render; only via deliberate retention do we keep the cache. Verify pattern with existing layouts in step 12 implementation.)

**Replace step-05 stub**: in `tab.ts`, change `"collection-home": renderCollectionHomeStub` to `"collection-home": renderCollectionHome`. Remove the stub.

## Refactor opportunities

If `wireGlobalClickOutside` interferes with the existing folder-view bulk-selection mousedown handler, gate it behind a check for the `collection-home` layout class. Verify during step 12.

## Definition of Done

```bash
npm run test:run -- tests/collections/renderer.test.ts
```
Expected: 12 tests pass. Plugin rebuild required.

Manual: `npm run tauri dev` → open a Collection folder → click a Stack → click a note → edit → click outside → confirm save + preview re-render.
