/**
 * detection.ts — Folder View detection scan for _folder.md files.
 *
 * Provides buildFolderViewSet(), which scans the vault index once per
 * renderPanel call and returns a Set<string> of directory absolute paths
 * that contain a _folder.md file.
 *
 * Design decisions (from 00_index.md AD-3):
 * - O(N) scan over VaultIndex.entries — no nested loops, no redundant scans.
 * - Result is computed once per renderTreeContent call and threaded downward
 *   (FR-06, NFR-01).
 * - Returns an empty Set when the index is null or empty (EC-01, EC-23).
 * - Guards against directories named "_folder.md" by checking entry.name === "_folder"
 *   AND entry.path.endsWith(".md") (EC-21).
 *
 * @module folder-view/detection
 */

import type { VaultIndex } from "../../../lib/vault-types";

/**
 * Build the set of directory paths that contain a _folder.md file.
 *
 * Scans vaultIndex.entries exactly once. For each entry whose stem name is
 * "_folder" and whose path ends with ".md", adds the parent directory path
 * to the result set.
 *
 * The vault index stores the filename stem (without ".md") in entry.name for
 * Markdown files, so a real _folder.md file has entry.name === "_folder". A
 * directory literally named "_folder.md" would have a different name format —
 * the path.endsWith(".md") check acts as a secondary guard (EC-21).
 *
 * @param vaultIndex - The current vault index, or null when the index is not
 *                     yet available (EC-01, loading state).
 * @returns A Set of absolute directory paths that contain _folder.md.
 *          Returns an empty Set when vaultIndex is null or has no entries.
 */
export function buildFolderViewSet(vaultIndex: VaultIndex | null): Set<string> {
  // EC-01 / EC-23: guard against null index or empty vault.
  if (!vaultIndex || vaultIndex.entries.length === 0) {
    return new Set<string>();
  }

  const result = new Set<string>();

  for (const entry of vaultIndex.entries) {
    // EC-21: entry.name must equal "_folder" (the stem without ".md" extension).
    // entry.path must end with ".md" to rule out directories named "_folder.md".
    if (entry.name === "_folder" && entry.path.endsWith(".md")) {
      // Compute the parent directory by stripping everything after the last "/".
      const lastSlash = entry.path.lastIndexOf("/");
      if (lastSlash > 0) {
        result.add(entry.path.slice(0, lastSlash));
      }
    }
  }

  return result;
}
