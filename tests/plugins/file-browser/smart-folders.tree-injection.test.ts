/**
 * smart-folders.tree-injection.test.ts
 *
 * Unit tests for the Smart Folders tree-injection module (step_03).
 *
 * Tests cover:
 *   - smartFolderPath / isSmartFolderPath: round-trip sanity (AD-3)
 *   - buildSmartFolderNode: file children, expansion state, empty-hint (EC-03)
 *   - injectSmartFolderNodes: prepend order preserved (FR-14)
 *   - buildTreeFromIndex: injections appear above real dirs (FR-14, EC-14)
 *   - sortNodes: smart-folder roots stay at top, children not re-sorted (AD-6)
 *   - sortNodes: mutates input array in-place (existing contract)
 *   - diffTree: rename (EC-05) and delete (EC-06) behavior
 *
 * All tests are pure TypeScript — no DOM access.
 */

import { describe, it, expect } from "vitest";
import {
  SMART_FOLDER_PATH_PREFIX,
  smartFolderPath,
  isSmartFolderPath,
  buildSmartFolderNode,
  injectSmartFolderNodes,
} from "../../../src/plugins/file-browser/smart-folders/tree-injection";
import {
  buildTreeFromIndex,
  sortNodes,
  diffTree,
} from "../../../src/plugins/file-browser/file-tree";
import type { TreeNode } from "../../../src/plugins/file-browser/file-tree";
import type { VaultIndexEntry, VaultEntry } from "../../../src/lib/vault-types";
import type { SmartFolderDef, EvaluationResult } from "../../../src/plugins/file-browser/smart-folders/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(path: string, overrides: Partial<VaultIndexEntry> = {}): VaultIndexEntry {
  return {
    path,
    name: path.split("/").pop()?.replace(/\.md$/, "") ?? "note",
    modified: 1000,
    size: 100,
    title: "Note",
    tags: [],
    outboundLinks: [],
    ...overrides,
  };
}

function makeVault(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "v1",
    name: "Test Vault",
    rootPaths: ["/notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDef(id = "sf-abc", name = "Research"): SmartFolderDef {
  return { id, name, rules: [{ type: "tag", operator: "is", value: "research" }] };
}

function makeResult(sfId: string, paths: string[], _modifieds?: number[]): EvaluationResult {
  return {
    smartFolderId: sfId,
    matches: paths,
    count: paths.length,
  };
}

/** Build a Map from paths to VaultIndexEntry objects for tree-injection. */
function makeEntriesByPath(entries: VaultIndexEntry[]): Map<string, VaultIndexEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}

// ── smartFolderPath / isSmartFolderPath ───────────────────────────────────────

describe("smartFolderPath and isSmartFolderPath", () => {
  it("round-trips correctly", () => {
    const id = "sf-test-123";
    const path = smartFolderPath(id);
    expect(path).toBe(`${SMART_FOLDER_PATH_PREFIX}${id}`);
    expect(isSmartFolderPath(path)).toBe(true);
  });

  it("returns false for a real vault path", () => {
    expect(isSmartFolderPath("/notes/research/note.md")).toBe(false);
    expect(isSmartFolderPath("/vault")).toBe(false);
  });

  it("returns true for any path starting with __smart__/", () => {
    expect(isSmartFolderPath("__smart__/sf-abc")).toBe(true);
    expect(isSmartFolderPath("__smart__/sf-abc/__empty__")).toBe(true);
  });
});

// ── buildSmartFolderNode ──────────────────────────────────────────────────────

describe("buildSmartFolderNode", () => {
  const entry1 = makeEntry("/notes/a.md", { modified: 300, title: "A" });
  const entry2 = makeEntry("/notes/b.md", { modified: 100, title: "B" });
  const entriesByPath = makeEntriesByPath([entry1, entry2]);
  const expanded = new Set<string>();

  it("builds a node with type=directory and iconClass=folder-smart", () => {
    const def    = makeDef("sf-1", "Research");
    const result = makeResult("sf-1", ["/notes/a.md"]);
    const node   = buildSmartFolderNode(def, result, entriesByPath, expanded, 1);

    expect(node.type).toBe("directory");
    expect(node.iconClass).toBe("folder-smart");
    expect(node.smartFolderId).toBe("sf-1");
    expect(node.name).toBe("Research");
    expect(node.matchCount).toBe(1);
  });

  it("builds file children in the order matches[] provides (modified-desc assumed pre-sorted)", () => {
    const def    = makeDef("sf-1");
    // Evaluator already sorts by modified desc, so result.matches is pre-sorted
    const result = makeResult("sf-1", ["/notes/a.md", "/notes/b.md"]);
    const node   = buildSmartFolderNode(def, result, entriesByPath, expanded, 1);

    expect(node.children).toHaveLength(2);
    expect(node.children[0].path).toBe("/notes/a.md");
    expect(node.children[1].path).toBe("/notes/b.md");
    // Both should be type "file"
    expect(node.children[0].type).toBe("file");
  });

  it("sets expanded=true when synthPath is in expandedPaths", () => {
    const def    = makeDef("sf-1");
    const result = makeResult("sf-1", ["/notes/a.md"]);
    const exp    = new Set(["__smart__/sf-1"]);
    const node   = buildSmartFolderNode(def, result, entriesByPath, exp, 1);

    expect(node.expanded).toBe(true);
  });

  it("sets expanded=false when synthPath is not in expandedPaths", () => {
    const def    = makeDef("sf-1");
    const result = makeResult("sf-1", ["/notes/a.md"]);
    const node   = buildSmartFolderNode(def, result, entriesByPath, new Set(), 1);

    expect(node.expanded).toBe(false);
  });

  it("emits empty-hint sentinel child when zero matches (EC-03)", () => {
    const def    = makeDef("sf-1");
    const result = makeResult("sf-1", []);
    const node   = buildSmartFolderNode(def, result, entriesByPath, new Set(), 1);

    expect(node.children).toHaveLength(1);
    expect(node.children[0].path).toMatch(/__empty__$/);
    expect(node.children[0].type).toBe("file");
  });

  it("uses depth=rootDepth for the smart folder node", () => {
    const def    = makeDef("sf-1");
    const result = makeResult("sf-1", []);
    const node   = buildSmartFolderNode(def, result, entriesByPath, new Set(), 2);

    expect(node.depth).toBe(2);
  });

  it("file children use depth=rootDepth+1", () => {
    const def    = makeDef("sf-1");
    const result = makeResult("sf-1", ["/notes/a.md"]);
    const node   = buildSmartFolderNode(def, result, entriesByPath, new Set(), 1);

    expect(node.children[0].depth).toBe(2);
  });

  it("handles non-md files (absent from entriesByPath) gracefully", () => {
    const def    = makeDef("sf-1");
    const result = makeResult("sf-1", ["/notes/photo.png"]);
    // entriesByPath has no entry for photo.png (it's a non-md file)
    const node   = buildSmartFolderNode(def, result, new Map(), new Set(), 1);

    expect(node.children).toHaveLength(1);
    expect(node.children[0].path).toBe("/notes/photo.png");
    expect(node.children[0].type).toBe("file");
  });
});

// ── injectSmartFolderNodes ────────────────────────────────────────────────────

describe("injectSmartFolderNodes", () => {
  it("prepends smart folder nodes before real children in input order", () => {
    const sf1 = { path: "__smart__/sf-1", name: "SF1" } as TreeNode;
    const sf2 = { path: "__smart__/sf-2", name: "SF2" } as TreeNode;
    const real1 = { path: "/notes/dir1", name: "dir1" } as TreeNode;
    const real2 = { path: "/notes/dir2", name: "dir2" } as TreeNode;

    const result = injectSmartFolderNodes([real1, real2], [sf1, sf2]);

    expect(result[0]).toBe(sf1);
    expect(result[1]).toBe(sf2);
    expect(result[2]).toBe(real1);
    expect(result[3]).toBe(real2);
  });

  it("returns real children unchanged when no smart folders provided", () => {
    const real = { path: "/notes/dir", name: "dir" } as TreeNode;
    const result = injectSmartFolderNodes([real], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(real);
  });
});

// ── buildTreeFromIndex with injections ────────────────────────────────────────

describe("buildTreeFromIndex with smart folder injections", () => {
  it("puts smart folder nodes above real directories (FR-14, EC-14)", () => {
    // Vault has a real "research" directory
    const entries = [
      makeEntry("/notes/research/paper.md"),
      makeEntry("/notes/journal.md"),
    ];
    const vault  = makeVault();
    const sfNode: TreeNode = {
      type: "directory",
      path: "__smart__/sf-1",
      name: "Research SF",
      children: [],
      expanded: false,
      depth: 1,
      iconClass: "folder-smart",
      smartFolderId: "sf-1",
      matchCount: 0,
    };

    const tree = buildTreeFromIndex(entries, vault.rootPaths, new Set(), vault, [], [sfNode]);
    // Sort so real dirs come first alphabetically; smart folder prepend happens after sort
    sortNodes(tree);

    // vault root is tree[0]; its children should have smart folder first
    const vaultRoot = tree[0];
    const firstChild = vaultRoot.children[0];
    expect(isSmartFolderPath(firstChild.path)).toBe(true);
    expect(firstChild.name).toBe("Research SF");
  });
});

// ── sortNodes with smart folders ──────────────────────────────────────────────

describe("sortNodes with smart-folder nodes", () => {
  it("keeps smart-folder roots at the top (above real directories)", () => {
    const sfNode: TreeNode = {
      type: "directory", path: "__smart__/sf-1", name: "Zebra SF",
      children: [], expanded: false, depth: 1, iconClass: "folder-smart",
    };
    const realDir: TreeNode = {
      type: "directory", path: "/notes/alpha", name: "alpha",
      children: [], expanded: false, depth: 1, iconClass: "folder-icon",
    };
    const nodes = [realDir, sfNode]; // realDir first before sort
    sortNodes(nodes);

    // Smart folder must sort to top even though "Zebra" > "alpha" alphabetically
    expect(nodes[0].path).toBe("__smart__/sf-1");
    expect(nodes[1].path).toBe("/notes/alpha");
  });

  it("does NOT re-sort smart-folder children (they are pre-sorted by evaluator)", () => {
    // Children are newest first (modified desc), sort would break this
    const child1: TreeNode = {
      type: "file", path: "/notes/b.md", name: "b",
      children: [], expanded: false, depth: 2, iconClass: "file-icon", modified: 200,
    };
    const child2: TreeNode = {
      type: "file", path: "/notes/a.md", name: "a",
      children: [], expanded: false, depth: 2, iconClass: "file-icon", modified: 100,
    };
    const sfNode: TreeNode = {
      type: "directory", path: "__smart__/sf-1", name: "SF",
      children: [child1, child2], // b before a (modified desc)
      expanded: true, depth: 1, iconClass: "folder-smart",
    };
    const nodes = [sfNode];
    sortNodes(nodes);

    // Children of smart folder must NOT be alphabetically sorted
    expect(sfNode.children[0].name).toBe("b");
    expect(sfNode.children[1].name).toBe("a");
  });

  it("mutates the input array in-place (returns same reference)", () => {
    const nodes: TreeNode[] = [
      { type: "file", path: "/notes/c.md", name: "c", children: [], expanded: false, depth: 1, iconClass: "file-icon" },
      { type: "file", path: "/notes/a.md", name: "a", children: [], expanded: false, depth: 1, iconClass: "file-icon" },
    ];
    const ref = nodes;
    const result = sortNodes(nodes);
    expect(result).toBe(ref);
  });
});

// ── diffTree with smart folders ───────────────────────────────────────────────

describe("diffTree with smart-folder synthetic paths", () => {
  it("emits toUpdate for smart-folder rename (name changed, path stable) — EC-05", () => {
    const sfNodeV1: TreeNode = {
      type: "directory", path: "__smart__/sf-1", name: "Old Name",
      children: [], expanded: false, depth: 1, iconClass: "folder-smart",
    };
    const sfNodeV2: TreeNode = {
      type: "directory", path: "__smart__/sf-1", name: "New Name",
      children: [], expanded: false, depth: 1, iconClass: "folder-smart",
    };

    const diff = diffTree([sfNodeV1], [sfNodeV2]);
    expect(diff.toUpdate).toContain("__smart__/sf-1");
    expect(diff.toRemove).toHaveLength(0);
  });

  it("emits toRemove when smart folder is deleted — EC-06", () => {
    const sfNode: TreeNode = {
      type: "directory", path: "__smart__/sf-1", name: "Research",
      children: [], expanded: false, depth: 1, iconClass: "folder-smart",
    };

    const diff = diffTree([sfNode], []);
    expect(diff.toRemove).toContain("__smart__/sf-1");
    expect(diff.toAdd).toHaveLength(0);
  });
});
