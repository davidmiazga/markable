---
title: step_03 — Fix file-browser.plugin.ts (dblclick, Delete for dirs, remove redundant reloads)
last-updated: "2026-04-30"
review-cadence-days: 90
status: active
---

# step_03 — Fix `file-browser.plugin.ts`

## Prerequisites

step_01 and step_02 complete and green.

---

## File to edit

`src/plugins/file-browser/file-browser.plugin.ts`

After all edits: run `npm run build:plugins && npm run sync:plugins`.

---

## Change 1: `attachNodeListeners` — add dblclick rename for file and directory nodes

### Current code (lines 1647–1679)

The `attachNodeListeners` function currently has this block near the end:

```typescript
/* Vault-specific interactions: unmount button (step_02) + dblclick rename (step_03) */
if (el.getAttribute("data-type") === "vault") {
  attachVaultUnmountListener(el);
  attachVaultDblClickListener(el, vaultId);
}
```

### Add a new block immediately BEFORE the vault-specific block

```typescript
/* FR-1: Double-click triggers inline rename for file and directory nodes.
 * Single-click opens the file (handled by buildActivateHandler via click).
 * dblclick fires as a separate event — no timer or click-count guard needed.
 * EC-15: guard explicitly excludes vault nodes. */
if (el.getAttribute("data-type") === "file" || el.getAttribute("data-type") === "directory") {
  el.addEventListener("dblclick", (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const path = el.getAttribute("data-path") ?? "";
    startInlineRename(el, path, vaultId);
  });
}
```

### Why `e.stopPropagation()`

The dblclick event may bubble to parent containers that have their own click handlers.
Stopping propagation ensures the rename input is not immediately dismissed by a
container-level click handler.

### Why no 200 ms timer or click count check

`dblclick` is a distinct browser event from `click`. The single-click "open file"
action fires on the `click` event and runs to completion independently. The dblclick
handler fires afterward. Both fire but their effects are independent: the file opens
in a tab and the rename input appears on top. On Escape the file remains open. This
is the VS Code / Obsidian convention (documented in FR-1 and the resolved open
questions section of the requirements).

---

## Change 2: `attachNodeListeners` — fix Delete key handler

### Current keydown handler (lines 1658–1669)

```typescript
el.addEventListener("keydown", (e: KeyboardEvent) => {
  const type = el.getAttribute("data-type");
  const path = el.getAttribute("data-path") ?? "";
  if (e.key === "F2" && (type === "file" || type === "directory")) {
    e.preventDefault();
    startInlineRename(el, path, vaultId);
  }
  if (e.key === "Delete" && type === "file") {
    e.preventDefault();
    void deleteFile(path).then(() => reloadAndRender(vaultId)); // BUG: redundant reload
  }
});
```

### Replace the entire keydown listener with

```typescript
el.addEventListener("keydown", (e: KeyboardEvent) => {
  const type = el.getAttribute("data-type");
  const path = el.getAttribute("data-path") ?? "";

  /* F2: inline rename for file and directory nodes (FR-3) */
  if (e.key === "F2" && (type === "file" || type === "directory")) {
    e.preventDefault();
    startInlineRename(el, path, vaultId);
    return;
  }

  /* Delete key: delete file or directory (FR-8, EC-16) */
  if (e.key === "Delete") {
    if (type === "file") {
      e.preventDefault();
      void deleteFile(path);
    } else if (type === "directory") {
      e.preventDefault();
      void deleteDirectory(path);
    }
  }
});
```

### What changed

- `type === "file"` Delete handler: removed `.then(() => reloadAndRender(vaultId))`.
  `deleteFile` now calls `reloadVaultIndex` internally; the chain was redundant (NFR
  Finding 9 / FR-15).
- Added `type === "directory"` branch: calls `deleteDirectory(path)` (FR-8, EC-16).
- Added `return` after F2 handler to make the fall-through explicit and avoid both
  branches executing if keys overlap in a future edit.

---

## Change 3: `buildFileContextMenuItems` — remove redundant reload from Delete handler

### Current code (lines 2052–2057)

```typescript
{
  label: "Delete",
  handler: () => {
    void deleteFile(path).then(() => reloadAndRender(vaultId));
  },
},
```

### Replace with

```typescript
{
  label: "Delete",
  handler: () => {
    void deleteFile(path);
  },
},
```

---

## Change 4: `buildDirContextMenuItems` — remove redundant reload from Delete handler

### Current code (lines 2113–2118)

```typescript
{
  label: "Delete",
  handler: () => {
    void deleteDirectory(path).then(() => reloadAndRender(vaultId));
  },
},
```

### Replace with

```typescript
{
  label: "Delete",
  handler: () => {
    void deleteDirectory(path);
  },
},
```

---

## Change 5: No change to `reloadAndRender` itself

The `reloadAndRender` function (line 2608) may still be used by other callers outside
this feature. Do NOT delete it. The four call sites removed above were the only
locations inside the delete flow. Verify with a grep before assuming it is dead code:

```bash
grep -n "reloadAndRender" src/plugins/file-browser/file-browser.plugin.ts
```

If no remaining call sites exist after your edits, you may leave the function in place
(dead code) — do not delete it in this step to keep the diff minimal and reviewable.

---

## Build and test

After all edits:

```bash
npm run build:plugins && npm run sync:plugins
npm run test:run
```

### Regression checks

The following existing test files must remain green:

- `tests/plugins/file-browser/file-browser.test.ts`
- `tests/plugins/file-browser/file-tree.test.ts`
- `tests/plugins/file-browser/vault-ux.test.ts`
- `tests/plugins/file-browser/create-file-folder.test.ts`
- `tests/tabs/tab-manager-rename-delete.test.ts` (step_01)
- `tests/plugins/file-browser/rename-delete-ops.test.ts` (step_02)

### Spot-check: `buildFileContextMenuItems` is exported via `_testing`

Line 2931 exports `buildFileContextMenuItems` through `_testing`. If any test calls
that export and asserts on the Delete handler, update the test expectation to match
the new handler (no `reloadAndRender`). Search before assuming no test is affected:

```bash
grep -rn "buildFileContextMenuItems" tests/
```

---

## No new test file for step_03

The plugin listener changes are integration-level wiring. The relevant unit
behaviour (dblclick calls `startInlineRename`, Delete key calls `deleteFile` /
`deleteDirectory`) is already covered by:
- The existing `file-browser.test.ts` suite which tests `buildFileContextMenuItems`
  and `buildDirContextMenuItems`.
- The ops-level tests in `rename-delete-ops.test.ts` (step_02) which verify the
  end-to-end delete and rename paths.

If the existing test suite does not cover the dblclick path, add minimal tests to
`tests/plugins/file-browser/rename-delete-ops.test.ts` rather than creating a
fourth plugin test file.

---

## Verification checklist

- [ ] `dblclick` on a file node calls `startInlineRename`.
- [ ] `dblclick` on a directory node calls `startInlineRename`.
- [ ] `dblclick` on a vault node does NOT trigger the new handler (vault node guard).
- [ ] Delete key on a file node calls `deleteFile` (no `reloadAndRender` chain).
- [ ] Delete key on a directory node calls `deleteDirectory` (no `reloadAndRender` chain).
- [ ] Context menu "Delete" on a file calls `deleteFile` (no `reloadAndRender` chain).
- [ ] Context menu "Delete" on a directory calls `deleteDirectory` (no chain).
- [ ] `npm run build:plugins && npm run sync:plugins` succeeds.
- [ ] `npm run test:run` exits 0.
