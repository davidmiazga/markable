---
title: "Step 02 — file-browser.plugin.ts targeted edits + split-click tests"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 02 — `file-browser.plugin.ts` targeted edits + split-click tests

**Prerequisite**: Step 01 complete; `npm run test:run` is GREEN.

**TDD order**: update `tests/folder-view/split-click.test.ts` first (T-10
through T-13 go RED), then make the plugin edits until GREEN.

**Files touched in this step:**
- `tests/folder-view/split-click.test.ts` — partial rewrite (T-10, T-11, T-12 rewritten; T-13 added; T-14 preserved)
- `src/plugins/file-browser/file-browser.plugin.ts` — targeted edits only

---

## 1. Update `tests/folder-view/split-click.test.ts`

### Tests to remove or rewrite

**T-10 (was line 83–94) — was asserting wrong behavior (`aria-expanded` flips)**

Replace with: `hasFolderView=true`, label click → `openFolderViewTab` is called.

The spy target is `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__`.  The plugin
wraps `_openFolderViewTab` from `tab.ts` in a module-level closure and assigns
it to that global in `onEnable`.  In tests, set the global to a `vi.fn()` spy
before calling `attachNodeListeners`.

```
(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy

li = makeDirectoryNode("/vault/A")
li.setAttribute("data-has-folder-view", "true")   // if needed for the impl
_testing.attachNodeListeners(li, "vault-1", true)

// Click the label (not the chevron)
const label = li.querySelector(".tree-node-label")
label.dispatchEvent(new MouseEvent("click", { bubbles: true }))

expect(openFVSpy).toHaveBeenCalledWith("/vault/A")
expect(li.getAttribute("aria-expanded")).toBe("false")   // NOT toggled
```

Note on spy wiring: `buildActivateHandler` calls the module-level
`openFolderViewTab` closure (line 913), which calls `_openFolderViewTab`, which
calls the real `tab.ts` function.  That is hard to spy on from tests.  The
implementation must be changed (see section 2b) so that the `hasFolderView=true`
branch calls `(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__?.(path)` rather
than the module-local closure.  This matches how `renderer.ts` card handlers
already call the global, and it makes the test trivially spyable.

Alternatively, `buildActivateHandler` can call the local `openFolderViewTab`
closure as before; in that case, the test cannot directly spy on it unless
`_testing` exposes a setter.  The `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__`
approach is preferred because it is already the pattern used by renderer card
click handlers (FR-16).

**Chosen implementation approach**: in `buildActivateHandler`, the
`hasFolderView=true` branch calls
`(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__?.(path)`.  This is assigned
to the real `openFolderViewTab` in `onEnable`, so runtime behavior is identical.
Tests can spy on it directly.

**T-11 (was line 98–116) — was asserting chevron click bubbles to row**

Replace with: chevron click with `hasFolderView=true` → `toggleDirectoryNode`
fires (aria-expanded flips); `openFolderViewTab` does NOT fire.

```
(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy

li = makeDirectoryNode("/vault/A", false)
_testing.attachNodeListeners(li, "vault-1", true)

chevron = li.querySelector(".tree-node-chevron")
chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }))

expect(li.getAttribute("aria-expanded")).toBe("true")   // toggled
expect(openFVSpy).not.toHaveBeenCalled()               // NOT opened
```

This test requires that `attachNodeListeners` adds a `click` listener on the
chevron element itself (inside the `if (hasFolderView)` branch) that calls
`e.stopPropagation()` then `toggleDirectoryNode(el, path, vaultId)`.

**T-12 (was line 120–130) — was asserting Enter key toggles expand/collapse**

Replace with: Enter key on `hasFolderView=true` node → `openFolderViewTab`
is called.

```
(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy

li = makeDirectoryNode("/vault/A", false)
_testing.attachNodeListeners(li, "vault-1", true)

li.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

expect(openFVSpy).toHaveBeenCalledWith("/vault/A")
```

This requires that `attachKeyboardHandler` (or `attachNodeListeners`) has a
special path for Enter on `hasFolderView=true` nodes.

**T-13 — add new: FR-05 — `_folder.md` file click → `exitLayoutView` called**

```
(window as any).__MARKABLE_TAB_MANAGER__ = {
  openFileInTab: vi.fn(() => Promise.resolve()),
  exitLayoutView: exitSpy,
  ...
}

li = document.createElement("li")
li.setAttribute("data-type", "file")
li.setAttribute("data-path", "/vault/A/_folder.md")

const handleActivate = _testing.buildActivateHandler(li, "vault-1", false)
handleActivate(new MouseEvent("click"))

await Promise.resolve()   // flush microtask
expect(tabMgr.openFileInTab).toHaveBeenCalledWith("/vault/A/_folder.md")
expect(exitSpy).toHaveBeenCalledOnce()
```

Note: `exitLayoutView` must be called synchronously after `openFileInTab`
(not in a `.then()`) per FR-05.  The behavior is: open file (async),
immediately call `exitLayoutView` to ensure code view regardless of current tab
state.

### Tests to preserve unchanged

**T-14 (existing "FR-01" test)**: `hasFolderView=false`, row click →
`toggleDirectoryNode` fires (aria-expanded flips), `openFolderViewTab` NOT
called.  Do not modify this test.

**ArrowRight / ArrowLeft tests**: preserve unchanged.

---

## 2. Edit `src/plugins/file-browser/file-browser.plugin.ts`

### 2a. Finalize the import block

Remove the temporary `// TODO step 02:` comments added in step 01.  The import
block becomes:

```typescript
import {
  openFolderViewTab as _openFolderViewTab,
  buildFolderViewRenderFn,
} from "./folder-view/tab";
```

### 2b. Restore FR-02 + add FR-05 in `buildActivateHandler`

Current `type === "directory"` branch (line 1937–1943):

```typescript
} else if (type === "directory") {
  toggleDirectoryNode(el, path, vaultId);
  _selectedFolderPath = path;
  window.dispatchEvent(
    new CustomEvent("markable-folder-selected", { detail: { path } })
  );
}
```

New `type === "file"` branch (add FR-05 guard before the existing file logic):

```typescript
if (type === "file") {
  // FR-05: _folder.md clicked directly → open in code view
  if (path.endsWith("/_folder.md") || path.endsWith("\\_folder.md")) {
    void (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(path);
    (window as any).__MARKABLE_TAB_MANAGER__?.exitLayoutView?.();
    _selectedFolderPath = null;
    window.dispatchEvent(
      new CustomEvent("markable-folder-selected", { detail: { path: null } })
    );
    return;
  }
  // existing file-open logic below (unchanged)
  ...
}
```

New `type === "directory"` branch (FR-02 restored):

```typescript
} else if (type === "directory") {
  if (_hasFolderView) {
    // FR-02: label/icon click on a folder-view-enhanced directory
    // → open the folder view tab (do NOT toggle expand/collapse)
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__?.(path);
  } else {
    // FR-01: no _folder.md → always toggle
    toggleDirectoryNode(el, path, vaultId);
  }
  _selectedFolderPath = path;
  window.dispatchEvent(
    new CustomEvent("markable-folder-selected", { detail: { path } })
  );
}
```

The `_hasFolderView` parameter (already the third param of `buildActivateHandler`)
is used here.  The parameter was previously prefixed with `_` (unused), so
removing the underscore prefix is required.

### 2c. Restore FR-03 in `attachNodeListeners`

Inside `attachNodeListeners`, after `el.addEventListener("click", handleActivate)`,
add:

```typescript
// FR-03: if this directory has _folder.md, the chevron click ONLY toggles
// expand/collapse and must NOT propagate to the row activate handler.
if (hasFolderView) {
  const chevron = el.querySelector<HTMLElement>(".tree-node-chevron");
  if (chevron) {
    chevron.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      const path = el.getAttribute("data-path") ?? "";
      toggleDirectoryNode(el, path, vaultId);
    });
  }
}
```

This listener is added ONLY for `hasFolderView=true` nodes (EC-17).

### 2d. Restore FR-04 in `attachKeyboardHandler`

Current Enter branch in `attachKeyboardHandler` (line 1963–1964):

```typescript
if (e.key === "Enter") { onActivate(e); return; }
```

`onActivate` is `handleActivate`, which is built by `buildActivateHandler`.
After the fix in 2b, `handleActivate` on a `hasFolderView=true` directory node
will call `__MARKABLE_OPEN_FOLDER_VIEW_TAB__` instead of `toggleDirectoryNode`.
Therefore Enter will automatically call `openFolderViewTab` for
`hasFolderView=true` nodes — no change to `attachKeyboardHandler` is needed.

Verify: the existing `if (e.key === "Enter") { onActivate(e); return; }` line
is sufficient.  The `onActivate` handler is the one built by `buildActivateHandler`
with the corrected FR-02 logic.

### 2e. Replace `notifyFolderViewTabs` in `_indexUpdatedCb`

Current code (lines 3754–3761):

```typescript
// FR-31/FR-32: notify folder-view tabs when _folder.md may have changed.
const changedPath = (_event as any)?.path as string | undefined;
if (changedPath) {
  notifyFolderViewTabs(changedPath);
}
```

Replace with inline FR-13 logic:

```typescript
// FR-13: refresh layout view when the active _folder.md tab matches.
const changedPath = (_event as any)?.path as string | undefined;
if (changedPath &&
    (changedPath.endsWith("/_folder.md") || changedPath.endsWith("\\_folder.md"))) {
  const lastSlash = Math.max(
    changedPath.lastIndexOf("/"),
    changedPath.lastIndexOf("\\"),
  );
  if (lastSlash > 0) {
    const parentDir = changedPath.slice(0, lastSlash);
    const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
    const activeTab = tabMgr?.getActiveTab?.();
    if (activeTab?.filePath === changedPath && tabMgr?.isActiveTabInLayoutView?.()) {
      tabMgr.refreshLayoutView(buildFolderViewRenderFn(parentDir));
    }
  }
}
```

### 2f. Remove `checkStaleFolderViewTabs()` from `onTabChanged`

Current `onTabChanged` (lines 2633–2642):

```typescript
function onTabChanged(): void {
  if (!_enabled) return;
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (currentFile !== _lastKnownFile) {
    _lastKnownFile = currentFile;
    updateActiveFileHighlight();
  }
  // FR-32: check for stale Folder View tabs that are now active.
  checkStaleFolderViewTabs();
}
```

Remove the last two lines (comment + call).  Result:

```typescript
function onTabChanged(): void {
  if (!_enabled) return;
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (currentFile !== _lastKnownFile) {
    _lastKnownFile = currentFile;
    updateActiveFileHighlight();
  }
}
```

### 2g. Remove `clearFolderViewRegistry()` from `onDisable`

Current `onDisable` teardown (around line 4021):

```typescript
clearFolderViewRegistry();
(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null;
```

Remove only the `clearFolderViewRegistry()` line.  The
`__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null` line must be preserved (EC-15).

---

## 3. `_testing` accessor — no new entries required

The existing `_testing.buildActivateHandler` and `_testing.attachNodeListeners`
accessors (lines 4158–4160) already expose the functions needed by the test.
No new entries are needed.

---

## 4. Verification gate

After all edits:

```bash
npm run test:run
```

Expected:
- T-10, T-11, T-12, T-13 GREEN (new/rewritten split-click tests)
- T-14 GREEN (unchanged split-click test)
- T-01 through T-09 GREEN (from step 01)
- All other existing tests still GREEN (80+ total)
- Zero TypeScript errors visible in test output

If any previously passing test fails, investigate and fix before proceeding to
step 03.
