---
title: "Step 06 — Bulk Operation Runners"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 06 — Bulk Operation Runners

## Goal

Implement the three sequential operation runners in `bulk-operations.ts`.

Each runner:
1. Iterates `selectionState.paths` using sequential `await` (NFR-3).
2. Dispatches the correct Tauri command based on `selectionState.kindMap`.
3. Collects per-item success/failure into an `OperationResult`.
4. Returns the result. The caller (toolbar callbacks in step_05) handles
   display and re-render decisions.

All Tauri invocations use `window.__TAURI_INTERNALS__?.invoke?.()` (NFR-1).

---

## Dependency on Previous Steps

- step_01: `OperationResult`, `SelectionState` types.
- step_03: `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`,
  `reconstructFile`.

---

## Files to Modify

### `src/plugins/file-browser/folder-view/bulk-operations.ts`

Replace the stub file with a full implementation.

#### `invokeTauri(command, args): Promise<unknown>`

```typescript
/**
 * Thin wrapper around window.__TAURI_INTERNALS__?.invoke?.()
 *
 * Throws the error string returned by Rust on failure.
 * Returns the result value on success.
 *
 * @param command - Tauri command name (snake_case).
 * @param args    - Plain object of arguments.
 */
async function invokeTauri(command: string, args: Record<string, unknown>): Promise<unknown>
```

This isolates the `(window as any)` cast in one place and makes callers
testable via mocking.

#### `executeBulkMove(selectionState, destDir): Promise<OperationResult>`

```typescript
/**
 * Move each path in selectionState.paths to destDir.
 *
 * Dispatch rules (EC-05):
 *   - card.kind === "file":      invoke "move_file" with { source, destinationDir }
 *   - card.kind === "directory": invoke "rename_file" with {
 *       oldPath: itemPath,
 *       newPath: destDir + "/" + dirName,
 *     } where dirName = itemPath.split("/").pop()
 *
 * Operations run sequentially (NFR-3). Each failure is caught per-item
 * and added to OperationResult.failed (EC-02, EC-03, EC-04, EC-06).
 *
 * @param selectionState - Contains paths and kindMap.
 * @param destDir        - Absolute path of destination directory.
 * @returns OperationResult with succeeded count and per-item failures.
 */
export async function executeBulkMove(
  selectionState: SelectionState,
  destDir: string,
): Promise<OperationResult>
```

Guard: if `selectionState.paths.size === 0`, return `{ succeeded: 0, failed: [] }` immediately (EC-01).

#### `executeBulkDelete(selectionState): Promise<OperationResult>`

```typescript
/**
 * Delete each path in selectionState.paths.
 *
 * Dispatch rules (EC-15):
 *   - card.kind === "file":      invoke "delete_file" with { path }
 *   - card.kind === "directory": invoke "delete_directory" with { path }
 *
 * Operations run sequentially (NFR-3). Each failure caught per-item.
 *
 * @param selectionState - Contains paths and kindMap.
 * @returns OperationResult.
 */
export async function executeBulkDelete(
  selectionState: SelectionState,
): Promise<OperationResult>
```

Guard: if `selectionState.paths.size === 0`, return `{ succeeded: 0, failed: [] }` immediately.

#### `executeBulkYaml(selectionState, op, key, value, allCards): Promise<OperationResult & { skippedCount: number }>`

```typescript
/**
 * Apply or remove a YAML frontmatter key on all eligible .md files in the
 * selection.
 *
 * Eligible means: card.kind === "file" && path.endsWith(".md").
 * Non-eligible items are silently skipped (EC-11, EC-12).
 *
 * For each eligible .md file:
 *   1. invoke "read_file" to get content.
 *   2. parseYamlFrontmatter(content).
 *   3. If malformed: add to failed with "Could not parse frontmatter in: X" (EC-10).
 *   4. If op === "add": applyYamlKey(frontmatterLines, key, value).
 *      If op === "remove": removeYamlKey(frontmatterLines, key).
 *   5. reconstructFile(parsed).
 *   6. invoke "write_file" with updated content.
 *   7. On success: increment succeeded.
 *   8. On read or write failure: add to failed.
 *
 * If op === "remove" and the key was absent from a file: that file is silently
 * skipped (not an error), per EC-09. removeYamlKey returns the array unchanged.
 * A write to an unchanged file is still performed (idempotent).
 *
 * @param selectionState - paths + kindMap.
 * @param op             - "add" | "remove".
 * @param key            - Frontmatter key.
 * @param value          - New value (ignored when op is "remove").
 * @param allCards       - All FolderCards from the current render (used to
 *                         resolve path → kind when kindMap might be incomplete).
 * @returns OperationResult extended with skippedCount (items not .md files).
 */
export async function executeBulkYaml(
  selectionState: SelectionState,
  op: "add" | "remove",
  key: string,
  value: string,
  allCards: FolderCard[],
): Promise<OperationResult & { skippedCount: number }>
```

Guard: if `key === ""`, return immediately with `{ succeeded: 0, failed: [], skippedCount: 0 }`.

#### Result summary formatter

```typescript
/**
 * Build a human-readable result summary string from an OperationResult.
 *
 * Formats:
 *   Move/Delete: "Moved N of M items." or "Deleted N of M items."
 *   With failures: adds per-item lines "  Failed: <path> — <error>".
 *   All failures (EC-19): "0 of N items succeeded.\n  Failed: ..."
 *
 * @param result    - The OperationResult to format.
 * @param verb      - "Moved" | "Deleted" | "Processed"
 * @param skipped   - For YAML: number of non-.md items skipped (EC-22).
 */
export function formatOperationResult(
  result: OperationResult,
  verb: "Moved" | "Deleted" | "Processed",
  skipped?: number,
): string
```

YAML-specific summary rules (EC-18, EC-22):
- `skippedCount > 0 && result.succeeded === 0 && result.failed.length === 0`:
  `"No eligible .md files in selection."`.
- Otherwise: `"Processed ${result.succeeded} of ${eligible} eligible .md files."` where
  `eligible = result.succeeded + result.failed.length`.
- If `skippedCount > 0`: append ` (${skippedCount} item(s) skipped — not .md)`.

---

## Files to Create

### `tests/folder-view/bulk-operations.test.ts`

```typescript
/**
 * tests/folder-view/bulk-operations.test.ts
 *
 * Unit tests for bulk operation runners.
 * Covers EC-01 through EC-07, EC-09, EC-10, EC-11, EC-12,
 * EC-15, EC-18, EC-19, EC-22.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeBulkMove,
  executeBulkDelete,
  executeBulkYaml,
  formatOperationResult,
} from "../../src/plugins/file-browser/folder-view/bulk-operations";
import { createSelectionState } from
  "../../src/plugins/file-browser/folder-view/bulk-selection";
import type { FolderCard } from
  "../../src/plugins/file-browser/folder-view/types";
```

Mocking pattern: mock `window.__TAURI_INTERNALS__` in `beforeEach`:

```typescript
beforeEach(() => {
  const invoke = vi.fn();
  (window as any).__TAURI_INTERNALS__ = { invoke };
  // Store reference for per-test configuration:
  // (window as any).__TAURI_INTERNALS__.invoke.mockResolvedValue(...)
});
```

Tests to implement:

**executeBulkMove:**

| Test ID | Description |
|---|---|
| BM-01 | Empty selection returns { succeeded:0, failed:[] } without invoke (EC-01) |
| BM-02 | File in selection: invokes "move_file" with source + destinationDir |
| BM-03 | Directory in selection: invokes "rename_file" with oldPath + newPath = destDir + "/" + dirName (EC-05) |
| BM-04 | Successful move: succeeded incremented, not in failed |
| BM-05 | Failed move (invoke throws): path added to failed with error string (EC-02, EC-03, EC-04) |
| BM-06 | Mixed success/failure: succeeded counts only successes (EC-19 partial) |
| BM-07 | All fail: succeeded=0, all in failed (EC-19) |
| BM-08 | Operations are sequential (second invoke called only after first resolves) |

**executeBulkDelete:**

| Test ID | Description |
|---|---|
| BD-01 | Empty selection returns { succeeded:0, failed:[] } (EC-01) |
| BD-02 | File: invokes "delete_file" |
| BD-03 | Directory: invokes "delete_directory" (EC-15) |
| BD-04 | All fail: succeeded=0, all in failed (EC-19) |

**executeBulkYaml:**

| Test ID | Description |
|---|---|
| BY-01 | Empty key returns early (no invoke) |
| BY-02 | Directory in selection is skipped (skippedCount incremented, no invoke) (EC-12) |
| BY-03 | Non-.md file is skipped (EC-11) |
| BY-04 | .md file: invokes "read_file" then "write_file" with modified content |
| BY-05 | op="add": key added to frontmatter |
| BY-06 | op="remove": key removed from frontmatter |
| BY-07 | Malformed frontmatter: file added to failed, not written (EC-10) |
| BY-08 | Key absent in remove op: file processed without error (EC-09) |
| BY-09 | All non-.md selection: returns "No eligible .md files" message via formatOperationResult (EC-18) |
| BY-10 | Mixed selection 2 .md + 1 dir: skippedCount=1, succeeded=2 (EC-22) |

**formatOperationResult:**

| Test ID | Description |
|---|---|
| FR-01 | Move success: "Moved 3 of 3 items." |
| FR-02 | Move partial failure: includes "Failed: path — error" lines |
| FR-03 | All failure (EC-19): "0 of 2 items succeeded." |
| FR-04 | YAML skipped items: appends "(N item(s) skipped — not .md)" |
| FR-05 | YAML zero eligible (EC-18): "No eligible .md files in selection." |

---

## Acceptance Criteria

1. All tests in `tests/folder-view/bulk-operations.test.ts` pass.
2. `executeBulkMove` dispatches `rename_file` for directories and `move_file`
   for files.
3. `executeBulkDelete` dispatches `delete_file` for files and
   `delete_directory` for directories.
4. `executeBulkYaml` skips non-.md files and directories silently.
5. Malformed frontmatter files are added to `failed`, not written.
6. All operations are sequential (`await` each before starting next).
7. `formatOperationResult` correctly handles all-failure (EC-19),
   zero-eligible (EC-18), and mixed skipped (EC-22) scenarios.
8. `npm run test:run -- tests/folder-view/bulk-operations.test.ts` passes.

---

## Required Imports in bulk-operations.ts

```typescript
import { parseYamlFrontmatter, applyYamlKey, removeYamlKey, reconstructFile }
  from "./yaml-frontmatter";
import type { SelectionState } from "./bulk-selection";
import type { FolderCard } from "./types";
```

All are within the plugin bundle directory. No external imports.
