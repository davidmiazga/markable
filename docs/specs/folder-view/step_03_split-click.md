---
title: "Folder View — Step 03: Split Click and Keyboard"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 03 — Split Click and Keyboard

**Goal**: Implement split-click behavior on directory nodes that have `_folder.md`: chevron click expands/collapses; name-label click opens the Folder View tab. Add `Enter` key handler for Folder View. Expose `expandDirectory` on `__MARKABLE_FILE_BROWSER__` global for use by subfolder card clicks.

**Files created**: none.

**Files modified**:
- `src/plugins/file-browser/file-browser.plugin.ts`

---

## Detailed Tasks

### 1. Modify `buildActivateHandler`

The existing `buildActivateHandler` routes all directory node activations to `toggleDirectoryNode`. With the folder-view split, directory nodes that have `_folder.md` must route label-clicks to `openFolderViewTab` instead.

**Current signature** (unchanged):
```typescript
function buildActivateHandler(el: HTMLElement, vaultId: string): (e: Event) => void
```

**Updated signature**:
```typescript
function buildActivateHandler(
  el: HTMLElement,
  vaultId: string,
  hasFolderView: boolean,
): (e: Event) => void
```

**Changes inside the handler body**:

In the `type === "directory"` branch (currently calls `toggleDirectoryNode` unconditionally):

```typescript
} else if (type === "directory") {
  if (hasFolderView) {
    // FR-02: label click on a _folder.md-enhanced directory opens Folder View.
    // The chevron is handled separately via a dedicated listener below.
    openFolderViewTab(path, vaultIndex);
  } else {
    // FR-01: no _folder.md — toggle expand/collapse as before.
    toggleDirectoryNode(el, path, vaultId);
  }
  _selectedFolderPath = path;
  window.dispatchEvent(
    new CustomEvent("markable-folder-selected", { detail: { path } })
  );
}
```

**Critical**: `openFolderViewTab` is imported from `./folder-view/tab` (step_04). In step_03, since `tab.ts` does not yet exist, use a stub: `function openFolderViewTab(_path: string): void { /* placeholder — wired in step_04 */ }` added as a module-level placeholder inside `file-browser.plugin.ts`. The stub will be replaced by the real import in step_04.

**The `vaultIndex` variable**: `openFolderViewTab` needs the current vault index to collect children. Pass it at call time: `const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() ?? null;`. Alternatively, `openFolderViewTab` can read the vault index internally. Prefer the latter (see step_04 design) to avoid threading the index through `buildActivateHandler`.

Update the `activate handler` call at line ~2250 in `attachNodeListeners`:

```typescript
const handleActivate = buildActivateHandler(el, vaultId, hasFolderView);
```

### 2. Add chevron click listener to prevent folder-view activation on chevron click (FR-03)

When `hasFolderView` is true, the chevron must expand/collapse and NOT propagate to the label-click handler. Add a separate `click` listener on the chevron span BEFORE the row's `click` listener:

In `attachNodeListeners`, after the `handleActivate` assignment and BEFORE `el.addEventListener("click", handleActivate)`:

```typescript
if (hasFolderView) {
  const chevron = el.querySelector<HTMLElement>(".tree-node-chevron");
  if (chevron) {
    chevron.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation(); // prevent el's click from firing
      const path = el.getAttribute("data-path") ?? "";
      toggleDirectoryNode(el, path, vaultId);
      _selectedFolderPath = path;
      window.dispatchEvent(
        new CustomEvent("markable-folder-selected", { detail: { path } })
      );
    });
  }
}
```

This satisfies FR-03: the chevron click intercepts before the row click. The row click (`handleActivate`) routes to `openFolderViewTab` only when the user clicks the label or icon area.

### 3. Modify `attachKeyboardHandler` for Enter → Folder View (FR-04)

The existing Enter handler calls `onActivate(e)` which now calls `openFolderViewTab` when `hasFolderView` is true. No change is needed to `attachKeyboardHandler` itself — it delegates to `onActivate` which already routes correctly. Verify this in tests.

ArrowRight/Left are unchanged (they call `toggleDirectoryNode` directly, independent of `hasFolderView`). Confirm this in the existing logic.

### 4. Add `expandDirectory` to `__MARKABLE_FILE_BROWSER__` global (AD-10)

In `onEnable`, inside the `__MARKABLE_FILE_BROWSER__` object literal assignment, add:

```typescript
(window as any).__MARKABLE_FILE_BROWSER__ = {
  getSelectedFolderPath(): string | null {
    return _selectedFolderPath;
  },
  /**
   * Expand a directory in the file tree and re-render the panel.
   * Called by subfolder cards in Folder View tabs (FR-21 / AD-10).
   *
   * @param path - Absolute path of the directory to expand.
   */
  expandDirectory(path: string): void {
    if (!_enabled) return;
    _expandedPaths.add(path);
    // Persist the update on the debounce timer.
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    const activeVault = vaultManager?.getActiveVault?.();
    if (activeVault?.id) scheduleSettingsSave(activeVault.id);
    renderPanel();
  },
};
```

In `onDisable`, the existing `(window as any).__MARKABLE_FILE_BROWSER__ = null;` already clears this global.

---

## Acceptance Criteria

### Tests to write: `tests/folder-view/split-click.test.ts`

All tests must pass via `npm run test:run -- tests/folder-view/split-click.test.ts`.

Set up tests using JSDOM (the existing test environment). The tests should:

1. Create a `<li>` element with `data-type="directory"`, `data-path="/vault/A"`.
2. Create a `.tree-node-chevron` span and a `.tree-node-label` span inside the `<li>`.
3. Call `attachNodeListeners(li, "vault-1", true)` (hasFolderView=true).

Write tests for:

1. **FR-02 label click**: Clicking `.tree-node-label` → `openFolderViewTab` stub is called with `/vault/A`.
2. **FR-02 chevron click**: Clicking `.tree-node-chevron` → `toggleDirectoryNode` is called; `openFolderViewTab` stub is NOT called.
3. **FR-01 no folder-view**: `hasFolderView=false`, click anywhere on `<li>` → `toggleDirectoryNode` called, `openFolderViewTab` NOT called.
4. **FR-04 Enter key on hasFolderView=true**: `dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))` on `<li>` → `openFolderViewTab` stub called.
5. **NFR-05 ArrowRight expands**: `hasFolderView=true`, `aria-expanded="false"`, ArrowRight → `toggleDirectoryNode` called.
6. **NFR-05 ArrowLeft collapses**: `hasFolderView=true`, `aria-expanded="true"`, ArrowLeft → `toggleDirectoryNode` called.

### Visual verification (after running `npm run build:plugins && npm run sync:plugins`)

1. Open the app with a vault that has a directory containing `_folder.md`.
2. Click the chevron arrow on that directory → tree should expand/collapse. No tab should open.
3. Click the folder name label → a new tab should open (will show an empty/stub tab until step_04).
4. Click a directory WITHOUT `_folder.md` → it should expand/collapse as before (FR-01 regression test).
5. Press ArrowRight / ArrowLeft on a folder-view-enhanced directory → expands/collapses (NFR-05).
6. Press Enter on a folder-view-enhanced directory → opens the folder-view tab.

**Run after this step**:
```
npm run build:plugins && npm run sync:plugins
```
