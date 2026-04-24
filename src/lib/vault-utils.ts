/**
 * vault-utils.ts
 *
 * Pure utility functions for vault path operations.
 *
 * Extracted from manage-vaults-ui.ts so the overlap detection logic can be
 * unit-tested independently of the DOM (HIGH-3). Import these helpers in both
 * UI code and test files rather than duplicating the logic.
 */

import type { VaultEntry } from "./vault-types";

// ── Path overlap detection ────────────────────────────────────────────────────

/**
 * Return true when `pathA` and `pathB` are the same directory or one is a
 * subdirectory of the other.
 *
 * Checks three cases that indicate an overlap:
 *  1. `pathA === pathB`           — identical directories
 *  2. `pathA` starts with `pathB + "/"` — A is inside B
 *  3. `pathB` starts with `pathA + "/"` — B is inside A
 *
 * The trailing `/` prevents false positives where one path is a prefix of
 * another but not actually a parent (e.g. `/foo/bar` vs `/foo/barbaz`).
 *
 * @param pathA - First absolute directory path.
 * @param pathB - Second absolute directory path.
 * @returns True when the paths overlap (same dir or one contains the other).
 */
export function isPathOverlapping(pathA: string, pathB: string): boolean {
  return (
    pathA === pathB ||
    pathA.startsWith(pathB + "/") ||
    pathB.startsWith(pathA + "/")
  );
}

/**
 * Check whether any path in `newPaths` overlaps with any root path in
 * `existingVaults`.
 *
 * Used in the vault create/edit form to display a yellow warning banner
 * (EC-04). Overlapping paths are allowed — both vaults will index shared
 * files independently — but the user should be informed.
 *
 * @param newPaths       - Candidate root paths being added (create or edit).
 * @param existingVaults - Vaults already in settings to compare against.
 * @returns An object with:
 *   - `overlaps`: true when at least one overlap was found.
 *   - `warning`:  a human-readable description naming the conflicting vault,
 *                 or null when there is no overlap.
 */
export function checkVaultsForOverlap(
  newPaths: string[],
  existingVaults: VaultEntry[]
): { overlaps: boolean; warning: string | null } {
  for (const newPath of newPaths) {
    for (const vault of existingVaults) {
      for (const existingPath of vault.rootPaths) {
        if (isPathOverlapping(newPath, existingPath)) {
          return {
            overlaps: true,
            warning: `This vault's path overlaps with "${vault.name}". Both vaults will index shared files independently.`,
          };
        }
      }
    }
  }
  return { overlaps: false, warning: null };
}
