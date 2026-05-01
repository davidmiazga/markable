---
title: step_01 — TabManager: add handleFileRename and closeFileByPath
last-updated: "2026-04-30"
review-cadence-days: 90
status: active
---

# step_01 — TabManager: add `handleFileRename` and `closeFileByPath`

## Goal

Add two new public methods to `TabManager` so the file-browser ops layer has a
working contract for rename propagation and safe file-path-based tab closure.

Both methods are automatically available on `window.__MARKABLE_TAB_MANAGER__`
because the singleton instance is exposed as-is on that global.

---

## File to edit

`src/tabs/tab-manager.ts`

---

## Method 1: `handleFileRename`

### Signature

```typescript
handleFileRename(oldPath: string, newPath: string): void
```

### Placement

Add this method in the `// ── Tab operations ──` section, after `activateTabByIndex`
and before `// ── Save operations ──`.

### Behaviour (maps to FR-11, EC-6, EC-7)

1. Find all tabs where `tab.filePath === oldPath`.
2. For each matching tab:
   a. Set `tab.filePath = newPath`.
   b. Set `tab.title = this._titleFromPath(newPath)`.
   c. If `this.tabs[this.activeIndex]?.id === tab.id` (it is the active tab):
      - Call `setLivePreviewFilePath(newPath)`.
      - Update the window global:
        `(window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = newPath`
      - Call `this._updateTitleBar(tab)`.
3. Call `this._notifyRenderer()`.
4. Call `void this.saveSession()` (fire-and-forget).

### JSDoc comment

```
/**
 * Update the filePath and title of any open tab that matches `oldPath`.
 *
 * Called after a successful file or directory rename so that in-memory tab
 * state stays consistent with the on-disk path. The tab's dirty state is
 * intentionally preserved — a dirty tab's content is canonical until the
 * user saves, and the next Cmd-S will write to the new path (EC-6).
 *
 * For directory renames the caller must invoke this method once per affected
 * tab (i.e. each tab whose filePath started with the old directory prefix).
 *
 * @param oldPath  Absolute path before the rename.
 * @param newPath  Absolute path after the rename.
 */
```

---

## Method 2: `closeFileByPath`

### Signature

```typescript
async closeFileByPath(path: string): Promise<boolean>
```

### Placement

Add this method immediately after `handleFileRename` in the `// ── Tab operations ──`
section.

### Behaviour (maps to FR-12, EC-9, EC-20)

1. Find the first tab where `tab.filePath === path`.
2. If not found, return `true` (nothing to close; delete can proceed).
3. Store `tab.id`.
4. Call `await this.closeTab(tab.id)`.
   - `closeTab` handles the unsaved-changes confirm dialog internally.
5. After `closeTab` resolves, check whether the tab is still present:
   `const stillOpen = this.tabs.some(t => t.id === tabId)`.
6. If `stillOpen === true`, the user cancelled — return `false` (abort delete).
7. If `stillOpen === false`, the tab was closed — return `true` (delete can proceed).

### JSDoc comment

```
/**
 * Close the tab for the given file path, handling the unsaved-changes dialog
 * internally via the existing `closeTab` flow.
 *
 * Returns `true` when the tab was successfully closed (or was never open),
 * meaning the caller may proceed with deleting the file.
 * Returns `false` when the user declined the unsaved-changes prompt, meaning
 * the delete must be aborted.
 *
 * EC-20: if two async operations race to close the same tab, the second call
 * finds no tab and returns `true` — correct, safe no-op.
 *
 * @param path  Absolute path of the file whose tab should be closed.
 * @returns     true = proceed with delete; false = abort.
 */
```

---

## Implementation notes

- Do NOT call `_captureActiveTab` or `_applyActiveTab` directly in either method.
  `closeTab` already handles all state transitions internally.
- `handleFileRename` must loop over `this.tabs` directly (not the copy from
  `getTabs()`) because it mutates `tab.filePath` in place.
- The `setLivePreviewFilePath` import is already present in the file at line 29.
  No new imports are needed.
- `saveSession` is already `async` and fire-and-forget throughout the class.
  Use the same `void this.saveSession()` pattern.

---

## Test file to create

`tests/tabs/tab-manager-rename-delete.test.ts`

### Test cases required

The test file must use `vitest`. Mirror the style of existing tab-manager tests.

**`handleFileRename` tests**

1. Updates `filePath` and `title` on a matching tab.
2. Preserves `isDirty: true` on a matching tab.
3. Is a no-op when no tab matches `oldPath`.
4. Calls `_notifyRenderer` (spy on the renderer if needed, or verify via
   `getTabs()` reflecting the new path).
5. Updates `__MARKABLE_CURRENT_FILE__` global when the renamed tab is active.
6. Does NOT update `__MARKABLE_CURRENT_FILE__` when the renamed tab is not active.

**`closeFileByPath` tests**

7. Returns `true` immediately when no tab has the given path.
8. Returns `true` after successfully closing a clean tab (no confirm dialog).
9. Returns `false` when the user cancels the unsaved-changes dialog
   (simulate by mocking `window.confirm` to return `false` and using a dirty tab).
10. EC-20: returns `true` when two concurrent calls race — second call finds the
    tab already gone.

### Minimal setup

Use the EXACT same mock pattern as `tests/tabs/tab-manager.test.ts`. Copy the
`vi.mock` blocks verbatim (they cover `bridge`, `settings`, `live-preview`,
`sidebar-manager`, `@tauri-apps/api/webviewWindow`, `@tauri-apps/api/dpi`,
`@tauri-apps/api/core`, and the three renderer modules). Then:

```typescript
// tests/tabs/tab-manager-rename-delete.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TabManager } from "../../src/tabs/tab-manager";
import { setLivePreviewFilePath } from "../../src/editor/live-preview";
// ... (all vi.mock blocks identical to tab-manager.test.ts)

const mockSetLivePreviewFilePath = setLivePreviewFilePath as ReturnType<typeof vi.fn>;
```

The existing `makeEditorView()` and `setupDom()` helpers from `tab-manager.test.ts`
can be copy-pasted or extracted to a shared test helper. Do not call `init()` in
tests that only exercise `handleFileRename` / `closeFileByPath` — instantiate with
`new TabManager()` and inject tabs by writing directly to `(tm as any).tabs`.

Use `new TabManager()` for each test (do NOT call `init()` — testing the public
methods in isolation). Inject tabs directly via the pattern used in existing tests
(push to internal array via a test helper or by constructing the object state in
`beforeEach`).

If direct access to `this.tabs` is needed for setup, add a `_testing` export block
identical in style to the pattern in `file-browser.plugin.ts`:

```typescript
// At the bottom of tab-manager.ts, inside a conditional that is tree-shaken:
export const _testingTabManager =
  (import.meta as any).vitest !== undefined
    ? { injectTabs: (tm: TabManager, tabs: any[]) => { (tm as any).tabs = tabs; (tm as any).activeIndex = 0; } }
    : undefined;
```

Only add this export if existing tests do not already have an equivalent mechanism.
Check the existing test suite before adding.

---

## Verification

```bash
npm run test:run -- tests/tabs/tab-manager-rename-delete.test.ts
```

All tests must pass before proceeding to step_02.
