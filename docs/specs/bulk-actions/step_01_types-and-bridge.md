---
title: "Step 01 — Types and Bridge Wrappers"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 01 — Types and Bridge Wrappers

## Goal

Establish all shared TypeScript interfaces used across the bulk-action helper
modules, and add the two missing bridge.ts wrappers that the project requires
even though the plugin invokes commands directly.

No DOM work. No business logic. This step is purely types and bridge contracts.

---

## Files to Create

### `src/plugins/file-browser/folder-view/bulk-selection.ts`

Create this file with only the type definitions and no DOM helpers yet.
DOM helpers are added in step_04.

```typescript
/**
 * bulk-selection.ts — Shared selection state type and lightweight helpers.
 *
 * SelectionState is created once per renderFolderTable() call and passed
 * by reference to all section builders and row factories.
 *
 * @module folder-view/bulk-selection
 */

/**
 * Shared mutable selection state for one renderFolderTable() call.
 *
 * paths    — Set of absolute paths currently checked.
 * kindMap  — Maps each known absolute path → "file" | "directory".
 *            Populated when rows are built; read by bulk operation runners
 *            to dispatch the correct Tauri command.
 */
export interface SelectionState {
  paths: Set<string>;
  kindMap: Map<string, "file" | "directory">;
}

/**
 * Create a fresh, empty SelectionState.
 */
export function createSelectionState(): SelectionState {
  return {
    paths: new Set(),
    kindMap: new Map(),
  };
}
```

### `src/plugins/file-browser/folder-view/bulk-toolbar.ts`

Create this file with only the ToolbarRefs type and the stub signature.
Full implementation is in step_05.

```typescript
/**
 * bulk-toolbar.ts — Toolbar DOM construction and state machine.
 *
 * ToolbarRefs holds references to the live DOM nodes created by buildToolbar().
 * updateToolbar() is called by every checkbox change to sync visibility and
 * count label.
 *
 * @module folder-view/bulk-toolbar
 */

import type { SelectionState } from "./bulk-selection";
import type { FolderCard } from "./types";

/**
 * Live DOM references for the bulk-action toolbar.
 *
 * toolbar     — The root <div class="fv-bulk-toolbar">.
 * countLabel  — The <span> that shows "N selected".
 * mainButtons — The <div> containing Move, Delete, Apply YAML buttons.
 * subUi       — The <div> that hosts the active sub-UI (move input,
 *               delete confirm, or YAML form). Empty and hidden when idle.
 */
export interface ToolbarRefs {
  toolbar: HTMLDivElement;
  countLabel: HTMLSpanElement;
  mainButtons: HTMLDivElement;
  subUi: HTMLDivElement;
}

// Full implementation added in step_05.
```

### `src/plugins/file-browser/folder-view/bulk-operations.ts`

Create this file with only the OperationResult type.
Full implementation is in step_06.

```typescript
/**
 * bulk-operations.ts — Sequential bulk operation runners.
 *
 * Each runner iterates the selection set, invokes the appropriate Tauri
 * command for each item, collects results, and returns an OperationResult
 * summary.
 *
 * All Tauri calls use window.__TAURI_INTERNALS__?.invoke?.() per NFR-1.
 * No imports from outside the plugin bundle directory are used.
 *
 * @module folder-view/bulk-operations
 */

/**
 * Result of a bulk operation run.
 *
 * succeeded — Count of items that were operated on successfully.
 * failed    — Per-item failures: path + human-readable error string.
 */
export interface OperationResult {
  succeeded: number;
  failed: { path: string; error: string }[];
}

// Full implementation added in step_06.
```

### `src/plugins/file-browser/folder-view/yaml-frontmatter.ts`

Create this file with only the ParsedFile type and stub function signatures.
Full implementation is in step_03.

```typescript
/**
 * yaml-frontmatter.ts — Minimal line-oriented YAML frontmatter parser/writer.
 *
 * The parser detects --- delimiters and key: scalar_value lines. Everything
 * else is preserved verbatim. No third-party YAML library is used (AD-6).
 *
 * @module folder-view/yaml-frontmatter
 */

/**
 * Parsed representation of a file split into frontmatter and body.
 *
 * hasFrontmatter   — true when a valid opening+closing --- block was found.
 * frontmatterLines — Lines between the --- delimiters (not including the
 *                    delimiter lines themselves). Empty array when no frontmatter.
 * bodyLines        — Lines after the closing --- delimiter, or all file lines
 *                    when hasFrontmatter is false.
 */
export interface ParsedFile {
  hasFrontmatter: boolean;
  frontmatterLines: string[];
  bodyLines: string[];
}

/**
 * Parse a file's content into frontmatter lines and body lines.
 * Returns { hasFrontmatter: false, frontmatterLines: [], bodyLines: all lines }
 * when no valid frontmatter block is detected.
 * Returns { hasFrontmatter: false, ... } with a special malformed flag when
 * an opening --- is found but no closing --- (EC-10).
 */
export function parseYamlFrontmatter(content: string): ParsedFile & { malformed: boolean } {
  throw new Error("Not implemented — see step_03");
}

/**
 * Add or update a key in frontmatterLines.
 * Values containing a colon or leading/trailing whitespace are double-quoted
 * (EC-13, EC-24).
 */
export function applyYamlKey(
  frontmatterLines: string[],
  key: string,
  value: string,
): string[] {
  throw new Error("Not implemented — see step_03");
}

/**
 * Remove a key line from frontmatterLines.
 * Returns the lines unchanged (not an error) when key is absent (EC-09).
 */
export function removeYamlKey(frontmatterLines: string[], key: string): string[] {
  throw new Error("Not implemented — see step_03");
}

/**
 * Reconstruct the full file content from a ParsedFile.
 * When hasFrontmatter is true and frontmatterLines is non-empty:
 *   "---\n" + frontmatterLines.join("\n") + "\n---\n" + body
 * When hasFrontmatter is true and frontmatterLines is empty:
 *   body only (EC-23 — empty frontmatter block is removed).
 * When hasFrontmatter is false:
 *   body only.
 */
export function reconstructFile(parsed: ParsedFile): string {
  throw new Error("Not implemented — see step_03");
}
```

---

## Files to Modify

### `src/lib/bridge.ts`

Add these two functions at the end of the file, after `renameFile`.

```typescript
/**
 * Delete a single file (not a directory) from disk.
 *
 * Wraps the Rust `delete_file` command. The plugin calls this command
 * directly via __TAURI_INTERNALS__; this wrapper exists for non-plugin
 * callers and type documentation.
 *
 * @param path - Absolute path to the file to delete.
 * @returns FileResult<void> — ok:true on success, ok:false with error message on failure.
 */
export async function deleteFile(path: string): Promise<FileResult<void>> {
  try {
    await invoke("delete_file", { path });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "delete_file",
        path,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Move a file (not a directory) to a destination directory, preserving
 * the original filename.
 *
 * Wraps the Rust `move_file` command. For moving directories, use
 * renameFile(itemPath, destDir + "/" + dirName) instead.
 * The plugin calls this command directly via __TAURI_INTERNALS__;
 * this wrapper exists for non-plugin callers and type documentation.
 *
 * @param source         - Absolute path of the source file.
 * @param destinationDir - Absolute path of the destination directory.
 * @returns FileResult<string> where value is the new absolute file path on success.
 */
export async function moveFile(
  source: string,
  destinationDir: string,
): Promise<FileResult<string>> {
  try {
    const newPath = await invoke<string>("move_file", {
      source,
      destinationDir,
    });
    return { ok: true, value: newPath };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "move_file",
        path: source,
      } satisfies TauriCommandError,
    };
  }
}
```

**Important:** The Rust command parameter for destination is `destination_dir`
in snake_case. Verify the exact parameter name against the Rust function
signature before coding; Tauri's `generate_handler!` reads argument names from
the Rust signature. The wrapper above uses `destinationDir` in camelCase as
Tauri automatically converts camelCase JS keys to snake_case when invoking.
If invoke fails with an unknown parameter error, check whether the Rust
parameter is `destination_dir` or `dest_dir`.

---

## Acceptance Criteria

1. `src/plugins/file-browser/folder-view/bulk-selection.ts` exists and exports
   `SelectionState` interface and `createSelectionState()` function.
2. `src/plugins/file-browser/folder-view/bulk-toolbar.ts` exists and exports
   `ToolbarRefs` interface.
3. `src/plugins/file-browser/folder-view/bulk-operations.ts` exists and exports
   `OperationResult` interface.
4. `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` exists and exports
   `ParsedFile` interface and four stub functions that throw `"Not implemented"`.
5. `src/lib/bridge.ts` exports `deleteFile` and `moveFile` with the signatures
   shown above.
6. `npm run test:run` passes (stub implementations must not break existing tests).
7. TypeScript compilation succeeds (`npx tsc --noEmit`).

---

## No Tests in This Step

All four new files export types and stubs only. Tests are added in the step
that provides the concrete implementation for each file.
