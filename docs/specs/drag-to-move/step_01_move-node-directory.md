---
title: Step 01 — Fix moveNode for directory moves
last-updated: "2026-04-30"
review-cadence-days: 90
status: active
---

# Step 01 — Fix `moveNode` for directory moves

## Goal

Update `moveNode` in `file-browser-ops.ts` so that when the moved node is a
directory, every open tab whose path lives under that directory receives an
updated `filePath` via `handleFileRename`. The existing single-path call
(`handleFileRename(sourcePath, newPath)`) covers only the file case and does
nothing for directories (Finding 3 in requirements).

After this step, `npm run test:run` must pass with zero failures.

---

## File to edit

`src/plugins/file-browser/file-browser-ops.ts`

---

## What to change

### Context — existing `moveNode` (lines 648–674)

```typescript
export async function moveNode(
  sourcePath: string,
  destinationDir: string,
  container: HTMLElement | null,
): Promise<void> {
  const oldStem = getFileStem(sourcePath);

  const newPath = await invoke<string>("move_file", {
    source: sourcePath,
    destinationDir,
  });

  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // PROBLEM: this call is correct only for files.
  // For a directory source, sourcePath is a directory path; no tab has
  // filePath === directoryPath, so this silently does nothing.
  (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(sourcePath, newPath);

  const newStem = getFileStem(newPath);
  if (oldStem !== newStem) {
    checkAndShowLinkBanner(container, oldStem, newStem);
  }
}
```

### Required change — replace the single `handleFileRename` call with a
directory-aware branch

The pattern is identical to `renameNode`'s directory branch (lines 388–406).
Use `sourcePath + "/"` as the prefix discriminator.

```typescript
// After reloadVaultIndex, replace the single handleFileRename line with:

const prefix = sourcePath + "/";
const tabs: Array<{ filePath: string | null }> =
  (window as any).__MARKABLE_TAB_MANAGER__?.getTabs?.() ?? [];

// Check whether any open tab lives under the moved directory.
// This distinguishes directory moves (tabs with matching prefix) from
// file moves (no tab matches the prefix because file paths never end with "/").
const directoryTabsExist = tabs.some((t) => t.filePath?.startsWith(prefix));

if (directoryTabsExist) {
  // Directory move: iterate and update all tabs inside the moved directory.
  for (const tab of tabs) {
    if (tab.filePath?.startsWith(prefix)) {
      const newTabPath = newPath + "/" + tab.filePath.slice(prefix.length);
      (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(tab.filePath, newTabPath);
    }
  }
} else {
  // File move (or directory move with no open tabs): update single path.
  (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(sourcePath, newPath);
}
```

Important notes for the developer:

1. `getTabs()` returns a shallow copy (same contract as `renameNode` uses). Safe
   to iterate while `handleFileRename` mutates the live tab array.

2. The `directoryTabsExist` check doubles as the file/directory discriminator.
   A file path never ends with "/" so `filePath.startsWith(sourcePath + "/")`
   is never true when `sourcePath` is a file — the `else` branch always handles
   files correctly.

3. Do NOT add a `nodeType` parameter to `moveNode`. The existing callers in
   `attachDragDropListeners` do not pass it, and the prefix check is sufficient.
   Adding a parameter would force a signature change in the plugin file and
   increase the risk surface.

4. Keep the `oldStem !== newStem` banner guard below the tab-update block — it
   is unchanged and must remain in place.

---

## Complete updated `moveNode` for reference

```typescript
export async function moveNode(
  sourcePath: string,
  destinationDir: string,
  container: HTMLElement | null,
): Promise<void> {
  const oldStem = getFileStem(sourcePath);

  const newPath = await invoke<string>("move_file", {
    source: sourcePath,
    destinationDir,
  });

  // Reload the vault index so the tree reflects the new location.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // Update open tabs.
  // For a directory move, every tab whose path starts with `sourcePath + "/"`
  // needs a prefix-substituted path. For a file move (or directory with no
  // open tabs), update only the exact source path.
  const prefix = sourcePath + "/";
  const tabs: Array<{ filePath: string | null }> =
    (window as any).__MARKABLE_TAB_MANAGER__?.getTabs?.() ?? [];
  const directoryTabsExist = tabs.some((t) => t.filePath?.startsWith(prefix));

  if (directoryTabsExist) {
    for (const tab of tabs) {
      if (tab.filePath?.startsWith(prefix)) {
        const newTabPath = newPath + "/" + tab.filePath.slice(prefix.length);
        (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(tab.filePath, newTabPath);
      }
    }
  } else {
    (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(sourcePath, newPath);
  }

  // Only show the banner when the stem actually changed (AD-01).
  const newStem = getFileStem(newPath);
  if (oldStem !== newStem) {
    checkAndShowLinkBanner(container, oldStem, newStem);
  }
}
```

---

## Test file to create

`tests/plugins/file-browser/drag-to-move.test.ts`

This file is created in this step with tests covering `moveNode` only. Tests for
`attachDragDropListeners` are added in step_02.

### Boilerplate (mock setup — same pattern as `rename-delete-ops.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { moveNode } from "../../../src/plugins/file-browser/file-browser-ops";

let invokeMock: ReturnType<typeof vi.fn>;
let reloadVaultIndexMock: ReturnType<typeof vi.fn>;
let handleFileRenameMock: ReturnType<typeof vi.fn>;
let getTabsMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue(undefined);
  reloadVaultIndexMock = vi.fn().mockResolvedValue(undefined);
  handleFileRenameMock = vi.fn();
  getTabsMock = vi.fn().mockReturnValue([]);

  (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    reloadVaultIndex: reloadVaultIndexMock,
  };
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    handleFileRename: handleFileRenameMock,
    getTabs: getTabsMock,
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
});
```

### Required test cases for `moveNode`

Each test case maps to a requirement or edge case. Write them inside `describe`
blocks labelled with the FR/EC reference.

**Test M1 — file move calls move_file with correct args (FR-10)**
```
invokeMock resolves "/vault/B/note.md"
call moveNode("/vault/A/note.md", "/vault/B", null)
assert invokeMock called with "move_file", { source: "/vault/A/note.md", destinationDir: "/vault/B" }
```

**Test M2 — file move calls handleFileRename(oldPath, newPath) (FR-10, EC-10)**
```
invokeMock resolves "/vault/B/note.md"
call moveNode("/vault/A/note.md", "/vault/B", null)
assert handleFileRenameMock called with ("/vault/A/note.md", "/vault/B/note.md")
assert handleFileRenameMock called exactly once
```

**Test M3 — file move calls reloadVaultIndex (FR-13)**
```
call moveNode("/vault/A/note.md", "/vault/B", null)
assert reloadVaultIndexMock called once
```

**Test M4 — directory move updates all open tabs inside the moved folder (FR-11, EC-8)**
```
getTabsMock returns [
  { filePath: "/vault/A/docs/note-a.md" },
  { filePath: "/vault/A/docs/sub/note-b.md" },
  { filePath: "/vault/A/other.md" },        // NOT inside /vault/A/docs/
]
invokeMock resolves "/vault/B/docs"
call moveNode("/vault/A/docs", "/vault/B", null)
assert handleFileRenameMock called with ("/vault/A/docs/note-a.md",     "/vault/B/docs/note-a.md")
assert handleFileRenameMock called with ("/vault/A/docs/sub/note-b.md", "/vault/B/docs/sub/note-b.md")
assert handleFileRenameMock NOT called with ("/vault/A/other.md", anything)
assert handleFileRenameMock call count === 2
```

**Test M5 — directory move with no open tabs falls through to single handleFileRename (EC-9)**
```
getTabsMock returns []   // no tabs at all
invokeMock resolves "/vault/B/docs"
call moveNode("/vault/A/docs", "/vault/B", null)
// With no tabs under the prefix, directoryTabsExist is false.
// The else branch calls handleFileRename(sourcePath, newPath).
assert handleFileRenameMock called with ("/vault/A/docs", "/vault/B/docs")
assert handleFileRenameMock called exactly once
```

**Test M6 — move does not show link banner when stem is unchanged (EC-12, AD-01)**
```
getVaultIndex returns index with a file that links to "note"
invokeMock resolves "/vault/B/note.md"
container = makeContainer()
call moveNode("/vault/A/note.md", "/vault/B", container)
assert container.querySelector(".file-browser-link-banner") is null
```

NOTE: `moveNode` uses `checkAndShowLinkBanner` which requires
`__MARKABLE_VAULT_MANAGER__.getVaultIndex`. Add that mock in this test case:
```typescript
(window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex = vi.fn(() => makeVaultIndex(["/vault/other.md"]));
```
(Copy `makeVaultIndex` helper from `rename-delete-ops.test.ts`.)

**Test M7 — move_file rejection surfaces via catch (EC-6, EC-7, FR-8)**
```
invokeMock rejects with new Error("already exists")
container = makeContainer()
call moveNode("/vault/A/note.md", "/vault/B", container)
// moveNode must not throw to the caller — the plugin's .catch() handles display.
// The test verifies moveNode rejects so the plugin's .catch() can run.
await expect(moveNode(...)).rejects.toThrow("already exists")
assert handleFileRenameMock NOT called
assert reloadVaultIndexMock NOT called
```

**Test M8 — null container does not throw (EC-16)**
```
invokeMock resolves "/vault/B/note.md"
call moveNode("/vault/A/note.md", "/vault/B", null)
// No crash expected even with null container
```

---

## After this step

Run:
```bash
npm run test:run -- tests/plugins/file-browser/drag-to-move.test.ts
```

All tests in the file must pass. Then run the full suite:
```bash
npm run test:run
```

No regressions in existing tests. Proceed to step_02.
