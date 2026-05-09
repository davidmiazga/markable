/**
 * smart-folders/tree-injection.ts
 *
 * Pure helpers that convert SmartFolderDef + EvaluationResult into TreeNode
 * objects ready for insertion into the file browser tree.
 *
 * This module is side-effect-free: no DOM, no window globals, no I/O.
 * It depends only on types from the tree (file-tree.ts) and the evaluation
 * result types (types.ts).
 *
 * Design decisions (AD-6):
 *   - Smart Folder path uses the synthetic key `__smart__/<id>` so expansion
 *     state never collides with real vault paths (AD-3, Locked #14).
 *   - Children are taken from `result.matches` in the order the evaluator
 *     provides (modified desc) and must NOT be re-sorted (sortNodes guards this).
 *   - Zero-match Smart Folders show an empty-hint sentinel child (EC-03).
 *   - Non-md files absent from entriesByPath still produce valid file nodes.
 *
 * @module smart-folders/tree-injection
 */

import type { TreeNode } from "../file-tree";
import type { SmartFolderDef, EvaluationResult } from "./types";
import type { VaultIndexEntry } from "../../../lib/vault-types";

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Synthetic path prefix reserved for Smart Folder expansion-state keys.
 *
 * Real vault paths begin with an absolute filesystem path (e.g. "/Users/…"),
 * so this prefix can never collide (AD-3, Locked #14).
 */
export const SMART_FOLDER_PATH_PREFIX = "__smart__/";

/**
 * Compose the synthetic path used as the expansion-state key and DOM data-path
 * for a Smart Folder root node.
 *
 * @param id - The SmartFolderId.
 * @returns The synthetic path string.
 */
export function smartFolderPath(id: string): string {
  return `${SMART_FOLDER_PATH_PREFIX}${id}`;
}

/**
 * Test whether a path is a Smart Folder synthetic key.
 *
 * Used by sortNodes to avoid re-sorting Smart Folder children, and by
 * buildNodeEl to skip listener wiring for empty-hint rows (step_03).
 *
 * @param path - Any absolute or synthetic path.
 * @returns True if the path starts with the Smart Folder prefix.
 */
export function isSmartFolderPath(path: string): boolean {
  return path.startsWith(SMART_FOLDER_PATH_PREFIX);
}

// ── Icon helpers ──────────────────────────────────────────────────────────────

/**
 * Choose the icon CSS class for a file leaf inside a Smart Folder.
 *
 * Replicates the extension-based logic used in the main file browser so
 * Smart Folder children have consistent icon presentation.
 *
 * @param path - Absolute path to the file.
 * @returns CSS icon class name.
 */
function chooseFileIconClass(path: string): string {
  const lp = path.toLowerCase();
  if (lp.endsWith(".md"))   return "file-md";
  if (lp.endsWith(".png") || lp.endsWith(".jpg") || lp.endsWith(".jpeg") ||
      lp.endsWith(".gif") || lp.endsWith(".svg") || lp.endsWith(".webp")) {
    return "file-image";
  }
  if (lp.endsWith(".json"))  return "file-json";
  if (lp.endsWith(".ts") || lp.endsWith(".js") || lp.endsWith(".css") ||
      lp.endsWith(".html") || lp.endsWith(".py") || lp.endsWith(".rs")) {
    return "file-code";
  }
  return "file-icon";
}

/**
 * Extract the basename (last path segment) from an absolute path.
 *
 * @param path - An absolute filesystem path.
 * @returns The filename or directory name.
 */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Strip the ".md" extension from a filename, if present.
 *
 * @param filename - A filename possibly ending in ".md".
 * @returns The display name without extension.
 */
function stripMdExt(filename: string): string {
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

// ── Node builders ─────────────────────────────────────────────────────────────

/**
 * Build the synthetic TreeNode for one Smart Folder, including its file children.
 *
 * Children are taken from `result.matches` in their provided order (modified
 * desc from the evaluator). If zero matches, a single empty-hint sentinel
 * child is added so the renderer can show "No matches" (EC-03, AD-12).
 *
 * @param def           - The Smart Folder definition.
 * @param result        - Evaluation result (matches, count).
 * @param entriesByPath - Map from path to VaultIndexEntry for md file metadata.
 * @param expandedPaths - Set of paths whose nodes should be expanded.
 * @param rootDepth     - Depth to assign to the Smart Folder root node.
 * @returns A TreeNode with type="directory" and iconClass="folder-smart".
 */
export function buildSmartFolderNode(
  def: SmartFolderDef,
  result: EvaluationResult,
  entriesByPath: Map<string, VaultIndexEntry>,
  expandedPaths: Set<string>,
  rootDepth: number,
): TreeNode {
  const synthPath = smartFolderPath(def.id);
  const expanded  = expandedPaths.has(synthPath);
  const childDepth = rootDepth + 1;

  let children: TreeNode[];

  if (result.matches.length === 0) {
    // Empty-hint sentinel: a non-selectable placeholder shown when expanded (EC-03, AD-12).
    children = [{
      type: "file",
      path: `${synthPath}/__empty__`,
      name: "No matches",
      children: [],
      expanded: false,
      depth: childDepth,
      iconClass: "file-icon",
    }];
  } else {
    // Map each match path to a standard file leaf node.
    children = result.matches.map((matchPath) => {
      const entry = entriesByPath.get(matchPath);
      const filename = basename(matchPath);
      return {
        type: "file" as const,
        path: matchPath,
        name: stripMdExt(filename),
        children: [],
        expanded: false,
        depth: childDepth,
        iconClass: chooseFileIconClass(matchPath),
        modified: entry?.modified ?? 0,
      };
    });
  }

  return {
    type: "directory",
    path: synthPath,
    name: def.name,
    children,
    expanded,
    depth: rootDepth,
    iconClass: "folder-smart",
    smartFolderId: def.id,
    matchCount: result.count,
  };
}

/**
 * Prepend Smart Folder virtual nodes to the vault root's children list.
 *
 * Called by the plugin AFTER sortNodes has run on the real children, so smart
 * folders always appear above the alphabetized real subdirectories (FR-14, EC-14).
 *
 * This is a pure function — it returns a new array without mutating inputs.
 *
 * @param rootChildren      - Sorted real children of the vault root.
 * @param smartFolderNodes  - Pre-built Smart Folder TreeNodes in desired order.
 * @returns New array with smart folder nodes prepended.
 */
export function injectSmartFolderNodes(
  rootChildren: TreeNode[],
  smartFolderNodes: TreeNode[],
): TreeNode[] {
  return [...smartFolderNodes, ...rootChildren];
}
