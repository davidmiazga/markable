---
title: "Folder View — Step 02: Detection"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 02 — Detection

**Goal**: Build the `buildFolderViewSet` function and thread its result through `renderTreeContent` and `buildTreeUl` so every directory `<li>` knows whether it has `_folder.md`.

**Files created**:
- `src/plugins/file-browser/folder-view/detection.ts`

**Files modified**:
- `src/plugins/file-browser/file-browser.plugin.ts`

---

## Detailed Tasks

### 1. Create `detection.ts`

```
buildFolderViewSet(vaultIndex: VaultIndex | null): Set<string>
```

**Algorithm** (FR-05, FR-06, EC-21, EC-23):

1. If `vaultIndex` is null or `vaultIndex.entries` is empty, return an empty `Set<string>` immediately (EC-01, EC-23).

2. Scan `vaultIndex.entries` once. For each `entry`:
   - Check `entry.name === "_folder"` (the vault index stores the stem without extension for `.md` files).
   - Check that `entry.path.endsWith(".md")` (EC-21: guards against a directory literally named `_folder.md`).
   - If both conditions are true, compute the parent directory: `entry.path.slice(0, entry.path.lastIndexOf("/"))`.
   - Add the parent directory path to the result set.

3. Return the set.

**Implementation note**: The function must be ≤20 lines. Import `VaultIndex` as a type only (`import type ...`) for IIFE safety.

### 2. Modify `file-browser.plugin.ts`

#### 2a. Add import

At the top of `file-browser.plugin.ts`, alongside the other smart-folders imports, add:

```typescript
import { buildFolderViewSet } from "./folder-view/detection";
```

#### 2b. Thread `folderViewSet` through `renderTreeContent`

In `renderTreeContent(wrapper: HTMLElement)`, after the tree is built and sorted (after `_currentTree = tree`), compute the folder-view set:

```typescript
const folderViewSet = buildFolderViewSet(vaultIndex);
```

Then pass `folderViewSet` to the `buildTreeUl` call:

```typescript
buildTreeUl(wrapper, displayNodes, activeFile, activeVault.id, folderViewSet);
```

Update the `buildTreeUl` signature to accept a fifth parameter:

```typescript
function buildTreeUl(
  wrapper: HTMLElement,
  displayNodes: TreeNode[],
  activeFile: string | null,
  vaultId: string,
  folderViewSet: Set<string>,
): void
```

#### 2c. Thread `folderViewSet` through `buildTreeUl` into `attachNodeListeners`

Inside `buildTreeUl`, update the `attachNodeListeners` call to pass per-node info:

For each node element `el` in the loop, before calling `attachNodeListeners(el, vaultId)`:
- Determine `hasFolderView`: `el.getAttribute("data-type") === "directory" && folderViewSet.has(el.getAttribute("data-path") ?? "")`.
- Pass to `attachNodeListeners`: `attachNodeListeners(el, vaultId, hasFolderView)`.

Update `attachNodeListeners` signature to:
```typescript
function attachNodeListeners(el: HTMLElement, vaultId: string, hasFolderView = false): void
```

The `hasFolderView` parameter defaults to `false` to avoid breaking the pinned-section call on line ~1604 which calls `attachNodeListeners(el, vaultId)` without the third argument.

#### 2d. Apply `tree-node-has-folder-view` class in `buildNodeEl`

The CSS class is added in `buildNodeEl`, not in `buildTreeUl`. However, `buildNodeEl` does not currently know about the folder-view set. The cleanest approach is to apply the class AFTER `buildNodeEl` returns, inside `buildTreeUl`, before calling `attachNodeListeners`:

In the loop in `buildTreeUl` (after `renderNodes` populates `nodeEls`):

```typescript
for (const el of nodeEls) {
  ul.appendChild(el);
  if (el.classList.contains("smart-folder-empty-hint")) continue;
  const path = el.getAttribute("data-path") ?? "";
  const hasFolderView =
    el.getAttribute("data-type") === "directory" &&
    folderViewSet.has(path);
  if (hasFolderView) el.classList.add("tree-node-has-folder-view");
  attachNodeListeners(el, vaultId, hasFolderView);
}
```

This keeps `buildNodeEl` unchanged (it does not need the set) and applies the class in `buildTreeUl` where the set is available.

#### 2e. Handle the second call to `buildTreeUl` (search filtered path)

The `buildTreeUl` call inside the search path (same `renderTreeContent` function) also needs `folderViewSet`. The variable is already computed earlier in the same function scope, so the second call automatically has it available.

#### 2f. Ensure `buildFolderViewSet` receives the correct vaultIndex

In `renderTreeContent`, `vaultIndex` is already retrieved from `vaultManager.getVaultIndex()`. Pass it directly to `buildFolderViewSet(vaultIndex)`.

---

## Acceptance Criteria

### Tests to write: `tests/folder-view/detection.test.ts`

All tests must pass via `npm run test:run -- tests/folder-view/detection.test.ts`.

Write tests for the following cases:

1. **EC-23**: Empty vault index → empty set returned.
2. **EC-01**: Null vault index → empty set returned.
3. **Basic detection**: Index has entry `{ path: "/vault/A/_folder.md", name: "_folder" }` → set contains `"/vault/A"`.
4. **Multiple folders**: Three `_folder.md` entries in different directories → set contains all three parent paths.
5. **Non-_folder.md files ignored**: Entry `{ path: "/vault/A/readme.md", name: "readme" }` → not in set.
6. **EC-21**: Entry `{ path: "/vault/_folder.md", name: "_folder.md" }` where `name` is `"_folder.md"` (directory named `_folder.md`) → NOT added (name check is `"_folder"` not `"_folder.md"`). The vault index stores the stem for `.md` files, so a directory would have `name: "_folder.md"` not `name: "_folder"`.
7. **EC-21 alternative**: Entry where `name === "_folder"` but `path` does NOT end with `.md` → not added.
8. **Nested paths**: `_folder.md` at depth 3 (`/vault/A/B/C/_folder.md`) → parent is `/vault/A/B/C`.

### Visual verification (after running `npm run build:plugins && npm run sync:plugins`)

1. Open the app. Create a directory with `_folder.md` inside it.
2. Verify the directory `<li>` in the file tree has class `tree-node-has-folder-view` (inspect DOM in DevTools).
3. Verify directories WITHOUT `_folder.md` do not have the class.
4. Verify `_folder.md` itself appears as a normal file in the tree.

**Run after this step**:
```
npm run build:plugins && npm run sync:plugins
```
