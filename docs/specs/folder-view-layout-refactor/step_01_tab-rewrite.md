---
title: "Step 01 — tab.ts rewrite + tab tests"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 01 — `tab.ts` rewrite + tab tests

**TDD order**: write the new `tests/folder-view/tab.test.ts` first (tests go
RED), then rewrite `tab.ts` until all tests go GREEN.

**Files touched in this step:**
- `tests/folder-view/tab.test.ts` — full rewrite
- `src/plugins/file-browser/folder-view/tab.ts` — core rewrite

**Files NOT touched in this step:**
- `src/plugins/file-browser/file-browser.plugin.ts`
- `tests/folder-view/split-click.test.ts`

---

## 1. Rewrite `tests/folder-view/tab.test.ts`

Replace the entire file contents.  The new test file must:

- Import only: `openFolderViewTab`, `buildFolderViewRenderFn`, `escapeHtml`,
  `LAYOUT_RENDERERS` from `tab.ts`.
- NOT import `_registry`, `notifyFolderViewTabs`, `checkStaleFolderViewTabs`,
  `clearFolderViewRegistry`, `FolderViewTabEntry`.
- Mock `window.__MARKABLE_TAB_MANAGER__` with `openFileInTab` (returns a
  resolved Promise), `enterLayoutView`, `exitLayoutView`, `refreshLayoutView`,
  `getActiveTab`, `isActiveTabInLayoutView`.
- Mock `window.__MARKABLE_VAULT_MANAGER__` with `getVaultIndex` returning a
  minimal empty index.
- Mock `window.__TAURI_INTERNALS__` with an `invoke` stub returning a minimal
  `_folder.md` string.

### T-01 — `openFolderViewTab` calls `openFileInTab` with `_folder.md` path

```
openFolderViewTab("/vault/A")
→ tabMgr.openFileInTab was called with "/vault/A/_folder.md"
```

Setup: `openFileInTab` returns `Promise.resolve()`.

### T-02 — `openFolderViewTab` calls `enterLayoutView` after `openFileInTab` resolves

```
openFolderViewTab("/vault/A")
await microtask queue (Promise.resolve().then chain)
→ tabMgr.enterLayoutView was called once
→ enterLayoutView was called with a function (the render fn)
```

Setup: `openFileInTab` returns `Promise.resolve()`.  Use
`await Promise.resolve()` (or `await new Promise(r => setTimeout(r, 0))`) to
flush the microtask queue before asserting.

### T-03 — calling twice for the same path calls `openFileInTab` both times

```
openFolderViewTab("/vault/A")
openFolderViewTab("/vault/A")
await microtask queue
→ tabMgr.openFileInTab call count === 2
```

Tab deduplication is the tab manager's responsibility; `tab.ts` must not
suppress the second call.

### T-04 — `buildFolderViewRenderFn` returns a function; calling it renders a loading placeholder and calls `renderFolderViewTabAsync` (indirectly via async)

```
const renderFn = buildFolderViewRenderFn("/vault/A")
const container = document.createElement("div")
renderFn(container)
→ container.innerHTML contains "Loading"  (synchronous, before async completes)
await async settle (setTimeout 50ms)
→ __TAURI_INTERNALS__.invoke was called with "read_file"
```

### T-05 — `_indexUpdatedCb` inline logic calls `refreshLayoutView` when active tab matches

This test exercises the logic that `file-browser.plugin.ts` will add in step 02.
Since that logic calls `buildFolderViewRenderFn`, test it here indirectly by
verifying that `buildFolderViewRenderFn` returns a function (prerequisite
assertion) and then simulate the inline logic:

```
const changedPath = "/vault/A/_folder.md"
const parentDir   = "/vault/A"
const renderFn    = buildFolderViewRenderFn(parentDir)

// Simulate the inline check:
const activeTab = { filePath: changedPath }
// filePath matches AND isActiveTabInLayoutView() === true
→ tabMgr.refreshLayoutView(renderFn) would be called

// Test the guard logic explicitly:
// If activeTab.filePath !== changedPath → refreshLayoutView NOT called
// If isActiveTabInLayoutView() === false → refreshLayoutView NOT called
```

Note: This test validates `buildFolderViewRenderFn` is the right value to pass.
The actual inline `_indexUpdatedCb` logic is tested by T-05 and T-06 in the
context of the plugin (step 02); here we verify the render fn shape only.

Simplify: T-05 can be a straightforward assertion that `buildFolderViewRenderFn`
returns a `typeof === "function"` value.  The full integration logic is verified
in the split-click tests.

### T-06 — active tab does NOT match `_folder.md` path → `refreshLayoutView` NOT called

```
getActiveTab() → { filePath: "/vault/B/some-note.md" }
isActiveTabInLayoutView() → true
changedPath = "/vault/A/_folder.md"

// activeTab.filePath !== changedPath
→ tabMgr.refreshLayoutView NOT called
```

Implement this test by writing a small helper that replicates the inline logic
from FR-13 (since that logic lives in the plugin, not in `tab.ts`, this test
verifies the boolean conditions independently using the mocked tab manager).

Alternative approach: skip this test here, cover it in `split-click.test.ts`
once the plugin changes are in place.  The requirement is that T-06 exists
somewhere.  Place it in `tab.test.ts` as a logic-level test of the conditions.

### T-07 — non-`_folder.md` path → no-op

```
changedPath = "/vault/A/some-note.md"
// does NOT end with "/_folder.md"
→ refreshLayoutView NOT called (early-return condition)
```

Same approach as T-06: test the guard condition directly.

### T-08 — `escapeHtml` escapes `<`, `>`, `"`, `&`

```
escapeHtml("<script>") === "&lt;script&gt;"
escapeHtml('"quoted"') === "&quot;quoted&quot;"
escapeHtml("a & b")   === "a &amp; b"
```

This test is copied verbatim from the old test file (it survives unchanged).

### T-09 — `LAYOUT_RENDERERS` contains `"folder-cards"` entry

```
typeof LAYOUT_RENDERERS["folder-cards"] === "function"
```

This test is copied verbatim from the old test file (it survives unchanged).

---

## 2. Rewrite `src/plugins/file-browser/folder-view/tab.ts`

### 2a. Delete these exports entirely

Remove all code for:
- `interface FolderViewTabEntry`
- `export const _registry: FolderViewTabEntry[]`
- `export function notifyFolderViewTabs`
- `export function checkStaleFolderViewTabs`
- `export function clearFolderViewRegistry`

Remove the "Registry types and state" section header comment as well.

### 2b. Simplify `renderFolderViewTabAsync`

Remove the `syntheticKey: string` parameter from the function signature.

Remove Step 4 entirely (the block that calls `tabMgr.getTabs()`, searches for
the tab by `syntheticKey`, patches `thisTab.title`, and dispatches
`markable-tab-changed`).

Update the function's JSDoc to remove references to `syntheticKey` and
title-patching.

The updated signature:

```typescript
async function renderFolderViewTabAsync(
  folderPath: string,
  folderMdPath: string,
  vaultIndex: VaultIndex | null,
  container: HTMLElement,
): Promise<void>
```

All internal call sites within `tab.ts` must be updated to omit the removed
parameter.

### 2c. Add `buildFolderViewRenderFn`

Add this export immediately before `openFolderViewTab`:

```typescript
/**
 * Build a synchronous render function for use with enterLayoutView /
 * refreshLayoutView.
 *
 * The returned function captures folderPath at call time.  Each call to
 * buildFolderViewRenderFn produces an independent closure that reads the
 * vault index fresh at render time (the index is fetched inside the closure,
 * not captured here).
 *
 * @param folderPath - Absolute path of the folder to render.
 * @returns A render function: (container: HTMLElement) => void
 */
export function buildFolderViewRenderFn(
  folderPath: string,
): (container: HTMLElement) => void {
  const folderMdPath = folderPath + "/_folder.md";
  return (container: HTMLElement): void => {
    const liveIndex =
      (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() ?? null;
    container.innerHTML = `<div class="folder-view-loading">Loading…</div>`;
    void renderFolderViewTabAsync(folderPath, folderMdPath, liveIndex, container);
  };
}
```

### 2d. Rewrite `openFolderViewTab`

Replace the current implementation with:

```typescript
/**
 * Open _folder.md in a real editor tab and enter layout view (FR-07/FR-08).
 *
 * Uses the tab manager's openFileInTab + enterLayoutView API (RD-01).
 * enterLayoutView is called in the .then() callback to guarantee the tab is
 * active and kind="editor" before enterLayoutView inspects getActiveTab().
 *
 * Safe when window.__MARKABLE_TAB_MANAGER__ is undefined (NFR-05):
 * the optional-chaining calls are silent no-ops in that case.
 *
 * @param folderPath - Absolute path of the folder whose view to open.
 */
export function openFolderViewTab(folderPath: string): void {
  const folderMdPath = folderPath + "/_folder.md";
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  void tabMgr?.openFileInTab?.(folderMdPath)?.then?.(() => {
    tabMgr?.enterLayoutView?.(buildFolderViewRenderFn(folderPath));
  });
}
```

Important: `openFileInTab` returns a `Promise`.  The `.then()` callback calls
`enterLayoutView` (RD-01 requirement).  The entire chain is voided at the
outermost level.

### 2e. Update the file-level JSDoc comment

The module-level JSDoc at the top of `tab.ts` still references the deleted
exports.  Update the `Exports:` section to:

```
 * Exports:
 *   openFolderViewTab       — opens _folder.md in an editor tab + enters layout view
 *   buildFolderViewRenderFn — builds a render fn for enterLayoutView / refreshLayoutView
 *   escapeHtml              — HTML escape utility (XSS prevention)
 *   collectChildren         — collect immediate children from vault index
 *   LAYOUT_RENDERERS        — dispatch map from layout name to renderer fn
```

Remove the `AD-1` and `AD-2` design-decision comments from the module header
(they describe the deleted synthetic-key and stale-flag mechanisms).

---

## 3. Verification gate

After completing 2a–2e:

```bash
npm run test:run
```

Expected: all tests pass.  The new T-01 through T-09 must be GREEN.  No other
test file may introduce new failures.

Note: `file-browser.plugin.ts` still imports `notifyFolderViewTabs`,
`checkStaleFolderViewTabs`, and `clearFolderViewRegistry` from `tab.ts` at this
point.  Those names no longer exist in `tab.ts`, so TypeScript will error on the
import line.  To keep the build green during step 01 only, update the import
block in `file-browser.plugin.ts` to remove the three deleted names (do NOT make
any other changes to the plugin in this step).  The full plugin edit work is done
in step 02.

The minimal import-block fix for step 01:

```typescript
// In file-browser.plugin.ts, change:
import {
  openFolderViewTab as _openFolderViewTab,
  notifyFolderViewTabs,         // DELETE
  checkStaleFolderViewTabs,     // DELETE
  clearFolderViewRegistry,      // DELETE
} from "./folder-view/tab";

// To:
import {
  openFolderViewTab as _openFolderViewTab,
  buildFolderViewRenderFn,
} from "./folder-view/tab";
```

This will cause TypeScript call-site errors on the three deleted call sites
(`notifyFolderViewTabs(changedPath)`, `checkStaleFolderViewTabs()`,
`clearFolderViewRegistry()`).  Comment out only those three lines temporarily
with a `// TODO step 02:` prefix so the TypeScript build succeeds.  Step 02
removes the comments and replaces the logic.
