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

import { parseYamlFrontmatter, applyYamlKey, removeYamlKey, reconstructFile }
  from "./yaml-frontmatter";
import type { SelectionState } from "./bulk-selection";
import type { FolderCard } from "./types";

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

// ── Internal Tauri bridge ─────────────────────────────────────────────────────

/**
 * Thin wrapper around window.__TAURI_INTERNALS__?.invoke?.()
 *
 * Throws the error string returned by Rust on failure.
 * Returns the result value on success. This isolates the (window as any) cast
 * in one place and makes callers testable by mocking __TAURI_INTERNALS__.
 *
 * @param command - Tauri command name (snake_case).
 * @param args    - Plain object of arguments.
 * @returns Resolved result from Rust on success.
 */
async function invokeTauri(command: string, args: Record<string, unknown>): Promise<unknown> {
  // window.__TAURI_INTERNALS__?.invoke?.() pattern required in plugin IIFEs
  // because bridge.ts cannot be imported from within the plugin bundle (NFR-1).
  const internals = (window as any).__TAURI_INTERNALS__;

  // Fail fast when the runtime context is absent (e.g. browser preview, unit
  // tests that forgot to stub __TAURI_INTERNALS__) rather than silently
  // returning undefined, which would cause the caller to treat every operation
  // as succeeded (result.succeeded always increments on no-throw).
  if (!internals?.invoke) {
    throw new Error(`invokeTauri: __TAURI_INTERNALS__ not available (command: ${command})`);
  }

  return internals.invoke(command, args);
}

// ── Bulk move ─────────────────────────────────────────────────────────────────

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
): Promise<OperationResult> {
  // EC-01: empty selection guard.
  if (selectionState.paths.size === 0) {
    return { succeeded: 0, failed: [] };
  }

  const result: OperationResult = { succeeded: 0, failed: [] };

  for (const itemPath of selectionState.paths) {
    const kind = selectionState.kindMap.get(itemPath) ?? "file";

    try {
      if (kind === "directory") {
        // Directories are moved via rename_file: rename to destDir/dirName.
        // This avoids a separate move_directory command and works for same-volume
        // renames; cross-volume moves will fail with an OS error (EC-06).
        const dirName = itemPath.split("/").pop() ?? itemPath;
        await invokeTauri("rename_file", {
          oldPath: itemPath,
          newPath: `${destDir}/${dirName}`,
        });
      } else {
        await invokeTauri("move_file", {
          source: itemPath,
          destinationDir: destDir,
        });
      }
      result.succeeded += 1;
    } catch (err) {
      const errorStr = typeof err === "string" ? err : String(err);
      result.failed.push({ path: itemPath, error: errorStr });
    }
  }

  return result;
}

// ── Bulk delete ───────────────────────────────────────────────────────────────

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
): Promise<OperationResult> {
  // EC-01: empty selection guard.
  if (selectionState.paths.size === 0) {
    return { succeeded: 0, failed: [] };
  }

  const result: OperationResult = { succeeded: 0, failed: [] };

  for (const itemPath of selectionState.paths) {
    const kind = selectionState.kindMap.get(itemPath) ?? "file";

    try {
      if (kind === "directory") {
        await invokeTauri("delete_directory", { path: itemPath });
      } else {
        await invokeTauri("delete_file", { path: itemPath });
      }
      result.succeeded += 1;
    } catch (err) {
      const errorStr = typeof err === "string" ? err : String(err);
      result.failed.push({ path: itemPath, error: errorStr });
    }
  }

  return result;
}

// ── Bulk YAML ─────────────────────────────────────────────────────────────────

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
 * processed without error, per EC-09. removeYamlKey returns the array unchanged.
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
): Promise<OperationResult & { skippedCount: number }> {
  // Guard: empty key returns immediately without any Tauri invocations.
  if (key === "") {
    return { succeeded: 0, failed: [], skippedCount: 0 };
  }

  // Build a supplementary kind map from allCards in case kindMap is incomplete.
  // This handles EC-20 where lazily-rendered rows may not have registered yet.
  const cardKindMap = new Map<string, "file" | "directory">();
  for (const card of allCards) {
    cardKindMap.set(card.path, card.kind);
  }

  const result: OperationResult & { skippedCount: number } = {
    succeeded: 0,
    failed: [],
    skippedCount: 0,
  };

  for (const itemPath of selectionState.paths) {
    const kind = selectionState.kindMap.get(itemPath)
      ?? cardKindMap.get(itemPath)
      ?? "file";

    // Directories are always skipped — they have no file or sidecar to write to.
    if (kind === "directory") {
      result.skippedCount += 1;
      continue;
    }

    // For non-.md files: operate on the sidecar path (path + ".md") instead of
    // the source file directly. write_file creates the sidecar if it does not
    // exist (NFR-7, EC-8). We do NOT call sidecar_exists before writing.
    const targetPath = itemPath.endsWith(".md") ? itemPath : itemPath + ".md";

    try {
      // Step 1: read the target content.
      // For new sidecars (add operation): tolerate missing file by starting with
      // empty content. For remove on a missing sidecar: let the error propagate
      // so it falls into the outer catch and adds to failed (EC-10).
      let content = "";
      try {
        content = await invokeTauri("read_file", { path: targetPath }) as string;
      } catch (readErr) {
        if (op === "remove") {
          // EC-10: cannot remove a key from a file that does not exist.
          throw readErr;
        }
        // op === "add": sidecar does not exist yet — start with empty content.
        // write_file will create it (NFR-7, EC-8).
        content = "";
      }

      // Step 2: parse frontmatter.
      const parsed = parseYamlFrontmatter(content);

      // Step 3: reject malformed frontmatter (EC-11).
      if (parsed.malformed) {
        result.failed.push({
          path: targetPath,
          error: `Could not parse frontmatter in: ${targetPath}`,
        });
        continue;
      }

      // Steps 4-5: apply the requested operation, then reconstruct the file.
      // When op is "add" and the file has no frontmatter, we create one.
      let newFrontmatterLines: string[];
      if (op === "add") {
        newFrontmatterLines = applyYamlKey(parsed.frontmatterLines, key, value);
      } else {
        newFrontmatterLines = removeYamlKey(parsed.frontmatterLines, key);
      }

      const updatedParsed = {
        // When the file had no frontmatter and we are adding a key, set
        // hasFrontmatter=true so reconstructFile wraps the block in ---.
        hasFrontmatter: parsed.hasFrontmatter || (op === "add" && newFrontmatterLines.length > 0),
        frontmatterLines: newFrontmatterLines,
        bodyLines: parsed.bodyLines,
      };

      const newContent = reconstructFile(updatedParsed);

      // Step 6: write back to targetPath (may be a sidecar path).
      await invokeTauri("write_file", { path: targetPath, content: newContent });
      result.succeeded += 1;
    } catch (err) {
      const errorStr = typeof err === "string" ? err : String(err);
      result.failed.push({ path: targetPath, error: errorStr });
    }
  }

  return result;
}

// ── Result formatter ──────────────────────────────────────────────────────────

/**
 * Build a human-readable result summary string from an OperationResult.
 *
 * Formats:
 *   Move/Delete: "Moved N of M items." or "Deleted N of M items."
 *   With failures: adds per-item lines "  Failed: <path> — <error>".
 *   All failures (EC-19): "0 of N items succeeded.\n  Failed: ..."
 *
 * YAML-specific summary rules (EC-18, EC-22):
 *   - skippedCount > 0 && succeeded === 0 && failed === 0:
 *     "No eligible .md files in selection."
 *   - Otherwise: "Processed N of M eligible .md files."
 *   - If skippedCount > 0: appends " (K item(s) skipped — not .md)"
 *
 * @param result  - The OperationResult to format.
 * @param verb    - "Moved" | "Deleted" | "Processed"
 * @param skipped - For YAML: number of non-.md items skipped (EC-22).
 * @returns Formatted human-readable summary string.
 */
export function formatOperationResult(
  result: OperationResult,
  verb: "Moved" | "Deleted" | "Processed",
  skipped?: number,
): string {
  const skippedCount = skipped ?? 0;

  if (verb === "Processed") {
    // YAML-specific path.
    const eligible = result.succeeded + result.failed.length;

    // EC-18: zero eligible files in the selection (only directories were selected).
    if (skippedCount > 0 && result.succeeded === 0 && result.failed.length === 0) {
      return "No eligible files in selection.";
    }

    let summary = `Processed ${result.succeeded} of ${eligible} eligible files.`;

    // EC-22: append skip annotation when directories were in the selection.
    // Phrasing changed from "not .md" to "directory" because non-.md files now use
    // sidecar write and are eligible — only directories are ever skipped.
    if (skippedCount > 0) {
      const noun = skippedCount === 1 ? "directory" : "directories";
      summary += ` (${skippedCount} ${noun} skipped)`;
    }

    if (result.failed.length > 0) {
      for (const f of result.failed) {
        summary += `\n  Failed: ${f.path} — ${f.error}`;
      }
    }

    return summary;
  }

  // Move / Delete path.
  const total = result.succeeded + result.failed.length;
  let summary = `${verb} ${result.succeeded} of ${total} items.`;

  // EC-19: when all items failed, clarify "0 of N items succeeded."
  if (result.succeeded === 0 && total > 0) {
    summary = `0 of ${total} items succeeded.`;
  }

  if (result.failed.length > 0) {
    for (const f of result.failed) {
      summary += `\n  Failed: ${f.path} — ${f.error}`;
    }
  }

  return summary;
}
