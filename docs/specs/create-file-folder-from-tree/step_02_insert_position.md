---
title: "Step 02 — Inline Input Insert Position"
last-updated: "2026-04-30"
review-cadence-days: 7
status: active
---

# Step 02 — Inline Input Insert Position

## Goal

Fix `showInlineCreateInput` and `showInlineFolderCreateInput` so the temporary `<li>` is
inserted immediately after the target directory's `<li>` in the flat tree list, rather
than always prepended to the top of the `<ul>` (Finding 3 / FR-8).

Only these two functions change. `buildInlineInputNode` and all callers are unchanged.

---

## File: `src/plugins/file-browser/file-browser.plugin.ts`

### Background: how the flat tree is structured

`_treeEl` is a `<ul class="file-tree">` whose children are `<li>` elements with
`data-path` and `data-type` attributes. Directories carry `data-type="directory"`,
files carry `data-type="file"`, the vault root carries `data-type="vault"`. All are
direct children of the `<ul>` (no nesting of `<ul>` elements).

To insert the inline input after a directory, we query for the `<li>` whose `data-path`
matches `dirPath` and call `insertAdjacentElement('afterend', li)`. If no `<li>` is
found (vault-root trigger where the vault node uses `rootPaths[0]` as its `data-path`,
or any collapsed/hidden-row edge case), fall back to `_treeEl.prepend(li)`.

### Private helper: `insertInlineAfterDir`

Add this private helper immediately before `showInlineCreateInput` (around line 2278).
It centralises the insert logic used by both `showInlineCreateInput` and
`showInlineFolderCreateInput`:

```typescript
/**
 * Insert the temporary inline-create `<li>` into the tree at the correct position.
 *
 * Strategy:
 *   1. Find the <li> whose data-path matches `dirPath`.
 *   2. If found, insert `li` immediately after it (the user sees the input
 *      appear directly below the directory row they right-clicked).
 *   3. If not found (EC-3: collapsed parent, vault-root trigger, loading state),
 *      fall back to prepend — suboptimal position but no crash.
 *
 * @param dirPath - Absolute path of the target directory.
 * @param li      - The temporary <li> to insert.
 */
function insertInlineAfterDir(dirPath: string, li: HTMLElement): void {
  const escapedPath = CSS.escape(dirPath);
  const targetEl = _treeEl!.querySelector<HTMLElement>(`[data-path="${escapedPath}"]`);
  if (targetEl) {
    targetEl.insertAdjacentElement("afterend", li);
  } else {
    _treeEl!.prepend(li);
  }
}
```

Note: `_treeEl!` (non-null assertion) is safe here because both callers guard
`if (!_treeEl) return` before calling this helper.

### Change to `showInlineCreateInput`

Replace the existing body (lines 2278–2284):

```typescript
// BEFORE
function showInlineCreateInput(dirPath: string, container: HTMLElement, vaultId: string): void {
  if (!_treeEl) return;

  const li = buildInlineInputNode(dirPath, container, vaultId, "file");
  /* Prepend inside the tree so the input appears at the top */
  _treeEl.prepend(li);
}
```

With:

```typescript
// AFTER
function showInlineCreateInput(dirPath: string, container: HTMLElement, vaultId: string): void {
  if (!_treeEl) return;

  const li = buildInlineInputNode(dirPath, container, vaultId, "file");
  insertInlineAfterDir(dirPath, li);
}
```

### Change to `showInlineFolderCreateInput`

Replace the existing body (lines 2293–2297):

```typescript
// BEFORE
function showInlineFolderCreateInput(dirPath: string, container: HTMLElement, vaultId: string): void {
  if (!_treeEl) return;
  const li = buildInlineInputNode(dirPath, container, vaultId, "directory");
  _treeEl.prepend(li);
}
```

With:

```typescript
// AFTER
function showInlineFolderCreateInput(dirPath: string, container: HTMLElement, vaultId: string): void {
  if (!_treeEl) return;
  const li = buildInlineInputNode(dirPath, container, vaultId, "directory");
  insertInlineAfterDir(dirPath, li);
}
```

### `_testing` export additions

Add the following entries to the `_testing` export object so tests can call these
functions directly:

```typescript
/** Expose showInlineCreateInput for testing. */
showInlineCreateInput,
/** Expose showInlineFolderCreateInput for testing. */
showInlineFolderCreateInput,
/** Expose insertInlineAfterDir for testing (insert-position logic). */
insertInlineAfterDir,
```

---

## Acceptance Criteria

1. When `showInlineCreateInput("/notes/work", ...)` is called and a `<li data-path="/notes/work">` exists in `_treeEl`, the new `<li>` appears immediately after that element in the DOM.
2. When `showInlineFolderCreateInput("/notes/work", ...)` is called with the same setup, the same positioning applies.
3. When `dirPath` does not match any `<li>` in `_treeEl` (EC-3), the `<li>` is prepended to the top of `_treeEl`.
4. When `_treeEl` is null, both functions return without error (EC-2).
5. The new `<li>` created by `showInlineCreateInput` has `class="tree-node tree-node-file"`.
6. The new `<li>` created by `showInlineFolderCreateInput` has `class="tree-node tree-node-directory"`.

---

## TDD Notes

Tests for this step live in Suite C of `tests/plugins/file-browser/create-file-folder.test.ts`.

The test setup must:
1. Call `_testing.setTreeEl(ul)` with a `<ul>` that contains a `<li data-path="/notes/work">`.
2. Call `_testing.showInlineCreateInput("/notes/work", container, "v1")`.
3. Assert that `ul.children[1]` (second child, index 1 — after the directory row at index 0) has class `tree-node-file`.
