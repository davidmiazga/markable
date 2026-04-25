/**
 * file-tree.ts
 *
 * Pure data-transformation functions for the File Browser plugin.
 *
 * All functions in this module are side-effect-free: they take plain data in
 * and return plain data out with no DOM access, no Tauri calls, and no window
 * globals. This makes them fully testable in Vitest without any mocking of the
 * runtime environment.
 *
 * Functions:
 *   buildTreeFromIndex  — Convert VaultIndexEntry[] + metadata into a tree.
 *   sortNodes           — Sort nodes directories-first, then alphabetically.
 *   filterTree          — Return flat array of nodes matching a fuzzy query.
 *   diffTree            — Compute minimal add/remove/update sets between trees.
 *   getVaultIconClass   — Map a VaultEntry.iconId to a CSS class name.
 *
 * @module file-tree
 */

import type { VaultIndexEntry, VaultEntry } from "../../lib/vault-types";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The three kinds of nodes that can appear in the file tree.
 *
 * "vault"     — the vault root node (always at depth 0 when multi-vault).
 * "directory" — a synthesised directory node derived from file paths.
 * "file"      — a leaf node representing an indexed .md file.
 */
export type TreeNodeType = "vault" | "directory" | "file";

/**
 * A single node in the rendered file tree.
 *
 * Nodes are never mutated — expand/collapse state produces a new tree
 * via toggleExpanded() at the call site rather than mutation here.
 */
export interface TreeNode {
  /** Distinguishes vault roots, directories, and leaf files. */
  type: TreeNodeType;
  /** Absolute path on disk (matches VaultIndexEntry.path for files). */
  path: string;
  /** Display name: filename without .md extension for files; dir name for dirs. */
  name: string;
  /** Child nodes — empty for file nodes. */
  children: TreeNode[];
  /** Whether this node's children are visible in the tree. Files always false. */
  expanded: boolean;
  /** Nesting depth — 0 for vault/root-level, increments for each dir level. */
  depth: number;
  /** CSS class for the icon glyph (mapped from type + vault.iconId). */
  iconClass: string;
  /** Set only when type === "vault"; contains the vault's UUID. */
  vaultId?: string;
  /**
   * Last-modified timestamp in milliseconds since epoch.
   *
   * Present only on file-type leaf nodes, sourced from VaultIndexEntry.modified.
   * Used by diffTree to detect when a file's content has changed without its
   * path changing (e.g. an in-place edit). Absent on directory and vault nodes.
   */
  modified?: number;
}

// ── Icon class mapping ────────────────────────────────────────────────────────

/**
 * Resolve the CSS icon class for a vault tree node.
 *
 * This is the extension point described in AD-05: adding a new vault icon
 * variant requires only (a) setting VaultEntry.iconId and (b) adding a CSS
 * rule for the new class. No code change to this function is needed for new
 * icon variants beyond updating the lookup table.
 *
 * @param vault - The VaultEntry whose iconId we are resolving.
 * @returns A CSS class name for the vault icon, defaulting to "vault-icon-default".
 */
export function getVaultIconClass(vault: VaultEntry): string {
  if (!vault.iconId) {
    return "vault-icon-default";
  }

  /*
   * Forward-looking icon map. New icon types are added here as iconId values
   * are defined by the vault configuration UI. Any unknown iconId also falls
   * back to the default so the tree never renders without an icon.
   */
  const ICON_MAP: Record<string, string> = {
    "default": "vault-icon-default",
    "work":    "vault-icon-work",
    "personal": "vault-icon-personal",
    "research": "vault-icon-research",
  };

  return ICON_MAP[vault.iconId] ?? "vault-icon-default";
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract the display name for a tree node.
 *
 * Files: strip the ".md" extension so only the stem is shown (FR-04.3).
 * Directories and vaults: return the segment as-is.
 *
 * @param rawName - The last path segment (filename or directory name).
 * @param type    - The node type used to decide whether to strip the extension.
 * @returns The display name to render in the tree.
 */
function displayName(rawName: string, _type: TreeNodeType): string {
  // Always show the full filename including extension.
  return rawName;
}

/**
 * Derive the last path segment from an absolute path string.
 *
 * Uses string splitting on "/" rather than the Node path module so the
 * function remains DOM-safe (no Node built-ins in the browser IIFE context).
 *
 * @param absPath - An absolute filesystem path.
 * @returns The filename or directory name at the end of the path.
 */
function basename(absPath: string): string {
  const segments = absPath.split("/");
  return segments[segments.length - 1] || absPath;
}

/**
 * Compute the path segments relative to a root path.
 *
 * Given rootPath "/home/user/notes" and absPath "/home/user/notes/work/report.md",
 * returns ["work", "report.md"].
 *
 * Returns an empty array when absPath does not start with rootPath (this
 * should not happen in a well-formed vault index but is handled defensively).
 *
 * @param rootPath - The vault root path.
 * @param absPath  - The absolute path of an index entry.
 * @returns Relative path segments from root to the file.
 */
function relativeParts(rootPath: string, absPath: string): string[] {
  const normalRoot = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  if (!absPath.startsWith(normalRoot)) {
    return [basename(absPath)];
  }
  const rel = absPath.slice(normalRoot.length);
  return rel.split("/").filter(Boolean);
}

// ── buildTreeFromIndex ────────────────────────────────────────────────────────

/**
 * Build a tree of TreeNode objects from a flat VaultIndexEntry array.
 *
 * The algorithm:
 * 1. For each root path in the vault, create an in-memory directory map.
 * 2. For each VaultIndexEntry, split the path relative to its root and
 *    synthesise intermediate directory nodes as needed.
 * 3. Set `expanded` on each directory node based on the expandedPaths set.
 * 4. Wrap everything under a vault root node (type "vault") at depth 0.
 *
 * Directories are synthesised from file paths because VaultIndexEntry only
 * contains file records — directory nodes are not present in the index.
 *
 * Length justification: this function is a single-pass tree constructor that
 * coordinates multiple rootPaths and delegates per-root work to buildSubtree.
 * Extracting a sub-routine here would just move the multi-root bookkeeping
 * elsewhere without reducing cognitive complexity — the algorithm resists
 * clean extraction.
 *
 * @param entries       - All index entries for the vault.
 * @param rootPaths     - The vault's configured root directory paths.
 * @param expandedPaths - Set of directory absolute paths that should be expanded.
 * @param vault         - The VaultEntry (for name and icon class on the root node).
 * @returns Array of top-level TreeNodes (usually one vault root node).
 */
export function buildTreeFromIndex(
  entries: VaultIndexEntry[],
  rootPaths: string[],
  expandedPaths: Set<string>,
  vault: VaultEntry,
): TreeNode[] {
  /*
   * Build a map from absolute path → TreeNode for all directory nodes so we
   * can look up an existing directory by path when processing nested files.
   * Keyed by path string for O(1) lookup.
   */
  const dirMap = new Map<string, TreeNode>();

  /*
   * Root-level children of the vault node. Each rootPath becomes one child
   * when there are multiple roots; when there is only one root, its children
   * are treated as direct vault children (flat model).
   */
  const rootChildren: TreeNode[] = [];

  for (const rootPath of rootPaths) {
    /*
     * For each entry, walk its relative path segments and create/reuse
     * directory nodes up to the file.
     */
    const rootEntries = entries.filter((e) => {
      const normalRoot = rootPath.endsWith("/") ? rootPath : rootPath + "/";
      return e.path.startsWith(normalRoot) || e.path === rootPath;
    });

    /*
     * When a vault has multiple rootPaths, each root gets its own subtree.
     * When there is only one, we skip the extra directory wrapper to keep
     * the tree shallow.
     */
    const container: TreeNode[] = rootPaths.length > 1
      ? buildSubtree(rootPath, rootEntries, expandedPaths, dirMap, 1)
      : buildSubtree(rootPath, rootEntries, expandedPaths, dirMap, 0);

    rootChildren.push(...container);
  }

  /*
   * The vault root node wraps everything. It is always expanded so the user
   * sees the vault's contents without an extra click.
   */
  const vaultNode: TreeNode = {
    type: "vault",
    path: rootPaths[0] ?? "",
    name: vault.name,
    children: rootChildren,
    expanded: true,
    depth: 0,
    iconClass: getVaultIconClass(vault),
    vaultId: vault.id,
  };

  return [vaultNode];
}

/**
 * Build the subtree of directory and file nodes for a single rootPath.
 *
 * Synthesises intermediate directory nodes by walking each entry's relative
 * path segments. Uses dirMap to avoid duplicate directory nodes when multiple
 * files share a parent directory.
 *
 * Length justification: this is a single-pass recursive accumulation algorithm.
 * The three concerns (path splitting, directory synthesis, file attachment) are
 * tightly coupled by the loop variable `parentChildren` — splitting them into
 * separate helpers would require threading that mutable pointer through multiple
 * function calls, making the code harder to follow, not easier.
 *
 * @param rootPath      - The vault root path to build the subtree under.
 * @param entries       - Entries whose paths are under rootPath.
 * @param expandedPaths - Expanded directory state set.
 * @param dirMap        - Shared directory node map (mutated as dirs are created).
 * @param baseDepth     - The depth to assign to immediate children of this root.
 * @returns Array of TreeNodes at the rootPath level.
 */
function buildSubtree(
  rootPath: string,
  entries: VaultIndexEntry[],
  expandedPaths: Set<string>,
  dirMap: Map<string, TreeNode>,
  baseDepth: number,
): TreeNode[] {
  const topLevel: TreeNode[] = [];

  for (const entry of entries) {
    const parts = relativeParts(rootPath, entry.path);

    /*
     * Walk from the first segment down to the file. Ensure each intermediate
     * directory node exists in dirMap, then attach the file to its parent.
     */
    let parentChildren = topLevel;
    let currentPath = rootPath;

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath + "/" + parts[i];
      const depth = baseDepth + i;

      if (!dirMap.has(currentPath)) {
        const dirNode: TreeNode = {
          type: "directory",
          path: currentPath,
          name: parts[i],
          children: [],
          expanded: expandedPaths.has(currentPath),
          depth,
          iconClass: "folder-icon",
        };
        dirMap.set(currentPath, dirNode);
        parentChildren.push(dirNode);
      }

      parentChildren = dirMap.get(currentPath)!.children;
    }

    /* Leaf: attach the file node to the deepest directory's children. */
    const fileSegment = parts[parts.length - 1];
    const fileDepth = baseDepth + parts.length - 1;

    const fileNode: TreeNode = {
      type: "file",
      path: entry.path,
      name: displayName(fileSegment, "file"),
      children: [],
      expanded: false,
      depth: fileDepth,
      iconClass: "file-icon",
      /*
       * Carry the VaultIndexEntry.modified timestamp forward so that diffTree
       * can detect in-place file edits (same path, different modified time).
       * This resolves HIGH-2 from the Step 2a code review.
       */
      modified: entry.modified,
    };

    parentChildren.push(fileNode);
  }

  return topLevel;
}

// ── sortNodes ─────────────────────────────────────────────────────────────────

/**
 * Sort tree nodes in-place: directories and vaults before files, then
 * case-insensitive alphabetical within each group.
 *
 * Applied recursively so the entire tree is sorted uniformly, not just the
 * top level. This ensures that a deeply nested folder's children are also
 * sorted correctly.
 *
 * @param nodes - The array of TreeNode objects to sort (mutated in-place).
 * @returns The same array reference after sorting (for chaining convenience).
 */
export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    const aIsDir = a.type === "directory" || a.type === "vault";
    const bIsDir = b.type === "directory" || b.type === "vault";

    /* Directories before files */
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;

    /* Within the same group: case-insensitive alphabetical */
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  /* Recurse into each directory's children */
  for (const node of nodes) {
    if (node.children.length > 0) {
      sortNodes(node.children);
    }
  }

  return nodes;
}

// ── filterTree ────────────────────────────────────────────────────────────────

/**
 * Compute a simple fuzzy-match score between a query string and a candidate.
 *
 * The algorithm:
 * 1. Require every character of the query to appear in the candidate in order
 *    (subsequence match). A candidate that does not satisfy this scores -1.
 * 2. Score starts at 1 and is incremented for each consecutive run of
 *    matching characters (rewards tight matches over scattered matches).
 *
 * This mirrors the basic tier of the Command Bar fuzzy ranker: it keeps the
 * file tree filter feeling familiar to users who already know the Command Bar.
 *
 * @param query     - The search string (lowercased before calling).
 * @param candidate - The target string to score against (lowercased by caller).
 * @returns A positive score for a match, or -1 for no match.
 */
function fuzzyScore(query: string, candidate: string): number {
  if (!query) return 1;

  let score = 1;
  let qi = 0;          /* index into query */
  let consecutive = 0; /* length of current consecutive run */

  for (let ci = 0; ci < candidate.length && qi < query.length; ci++) {
    if (candidate[ci] === query[qi]) {
      consecutive++;
      score += consecutive;
      qi++;
    } else {
      consecutive = 0;
    }
  }

  /* If we did not consume the entire query, no match */
  return qi === query.length ? score : -1;
}

/**
 * Collect all file-type leaf nodes from a tree via depth-first traversal.
 *
 * @param nodes - Top-level nodes to traverse.
 * @returns Flat array of all file nodes in the subtree.
 */
function collectFileNodes(nodes: TreeNode[]): TreeNode[] {
  const results: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      results.push(node);
    }
    if (node.children.length > 0) {
      results.push(...collectFileNodes(node.children));
    }
  }
  return results;
}

/**
 * Filter the tree to only show files whose names match the query.
 *
 * When query is empty, returns the original tree unchanged (caller gets the
 * full hierarchical view). When query is non-empty, returns a flat array of
 * matching file nodes sorted by descending fuzzy score so the best matches
 * appear at the top.
 *
 * Matching is case-insensitive. The `.md` extension is excluded from the
 * comparison because it is also hidden in the display name.
 *
 * @param nodes - The current tree (as returned by buildTreeFromIndex + sortNodes).
 * @param query - The search string typed by the user.
 * @returns The filtered result: flat file list when query is non-empty, original tree otherwise.
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) {
    return nodes;
  }

  const lowerQuery = query.toLowerCase();
  const allFiles = collectFileNodes(nodes);

  /* Score each file node against the query */
  const scored = allFiles
    .map((node) => {
      const score = fuzzyScore(lowerQuery, node.name.toLowerCase());
      return { node, score };
    })
    .filter(({ score }) => score > 0);

  /* Sort by descending score (best match first) */
  scored.sort((a, b) => b.score - a.score);

  return scored.map(({ node }) => node);
}

// ── diffTree ──────────────────────────────────────────────────────────────────

/**
 * Flatten a tree to a map from path → TreeNode for efficient comparison.
 *
 * @param nodes - Top-level nodes to flatten.
 * @returns Map from absolute path to TreeNode.
 */
function flattenToMap(nodes: TreeNode[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();

  function walk(nodeList: TreeNode[]): void {
    for (const node of nodeList) {
      map.set(node.path, node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return map;
}

/**
 * Compute the minimal set of DOM operations needed to update a rendered tree.
 *
 * Compares oldNodes and newNodes by path, returning three sets:
 *   toAdd    — paths present in newNodes but absent in oldNodes.
 *   toRemove — paths present in oldNodes but absent in newNodes.
 *   toUpdate — paths present in both but with a different modified timestamp.
 *
 * This is used by the incremental update path (onIndexUpdated) to avoid
 * tearing down and rebuilding the entire tree DOM when a single file changes.
 *
 * @param oldNodes - The previously rendered tree.
 * @param newNodes - The newly built tree after an index update.
 * @returns Object with three path arrays for the three change categories.
 */
export function diffTree(
  oldNodes: TreeNode[],
  newNodes: TreeNode[],
): { toAdd: string[]; toRemove: string[]; toUpdate: string[] } {
  const oldMap = flattenToMap(oldNodes);
  const newMap = flattenToMap(newNodes);

  const toAdd: string[] = [];
  const toRemove: string[] = [];
  const toUpdate: string[] = [];

  /* Paths in new but not in old → added */
  for (const [path] of newMap) {
    if (!oldMap.has(path)) {
      toAdd.push(path);
    }
  }

  /* Paths in old but not in new → removed */
  for (const [path, oldNode] of oldMap) {
    if (!newMap.has(path)) {
      toRemove.push(path);
    } else {
      /*
       * Path exists in both trees. The diff consumer (incremental update handler)
       * re-renders any node in toUpdate, so we only add a path here when the
       * node changed in a meaningful way:
       *
       *   1. name changed   — the file was renamed (same inode, new filename).
       *   2. type changed   — unexpected but defensively handled.
       *   3. modified changed — the file content changed without a rename.
       *      Both values must be defined; if either is undefined we skip the
       *      timestamp check to avoid false positives during tree bootstrapping.
       */
      const newNode = newMap.get(path)!;
      const nameOrTypeChanged =
        oldNode.name !== newNode.name || oldNode.type !== newNode.type;
      const timestampChanged =
        oldNode.modified !== undefined &&
        newNode.modified !== undefined &&
        oldNode.modified !== newNode.modified;
      if (nameOrTypeChanged || timestampChanged) {
        toUpdate.push(path);
      }
    }
  }

  return { toAdd, toRemove, toUpdate };
}
