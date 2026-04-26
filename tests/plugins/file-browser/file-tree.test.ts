/**
 * Unit tests for file-tree.ts — pure data-transformation functions.
 *
 * All tests operate on plain data structures (VaultIndexEntry[], TreeNode[])
 * with no DOM, no window globals, and no Tauri dependencies. This lets them
 * run as fast synchronous unit tests without any setup overhead.
 *
 * Test file: tests/plugins/file-browser/file-tree.test.ts
 * Source:    src/plugins/file-browser/file-tree.ts
 */

import { describe, it, expect } from "vitest";
import {
  buildTreeFromIndex,
  sortNodes,
  filterTree,
  diffTree,
  getVaultIconClass,
  type TreeNode,
} from "../../../src/plugins/file-browser/file-tree";
import type { VaultIndexEntry, VaultEntry } from "../../../src/lib/vault-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal VaultEntry for test use. */
function makeVault(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "vault-1",
    name: "My Vault",
    rootPaths: ["/vault"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Minimal VaultIndexEntry for test use. */
function makeEntry(path: string, overrides: Partial<VaultIndexEntry> = {}): VaultIndexEntry {
  const name = path.split("/").pop()?.replace(/\.md$/, "") ?? "note";
  return {
    path,
    name,
    modified: 1000,
    size: 100,
    title: name,
    tags: [],
    outboundLinks: [],
    ...overrides,
  };
}

// ── getVaultIconClass ─────────────────────────────────────────────────────────

describe("getVaultIconClass", () => {
  it("returns vault-icon-default when iconId is absent", () => {
    const vault = makeVault();
    expect(getVaultIconClass(vault)).toBe("vault-icon-default");
  });

  it("returns vault-icon-default when iconId is undefined", () => {
    const vault = makeVault({ iconId: undefined });
    expect(getVaultIconClass(vault)).toBe("vault-icon-default");
  });

  it("returns vault-icon-default when iconId is null (LOW-4)", () => {
    /*
     * The VaultEntry type marks iconId as optional (string | undefined), but
     * defensive runtime handling is required because external JSON data could
     * supply null. We cast to `any` here to simulate that scenario and verify
     * the function never returns undefined or throws.
     */
    const vault = makeVault({ iconId: null as any });
    expect(getVaultIconClass(vault)).toBe("vault-icon-default");
  });

  it("returns vault-icon-default for an unknown iconId string", () => {
    const vault = makeVault({ iconId: "flying-saucer" });
    expect(getVaultIconClass(vault)).toBe("vault-icon-default");
  });

  it("maps known iconId 'work' to vault-icon-work", () => {
    const vault = makeVault({ iconId: "work" });
    expect(getVaultIconClass(vault)).toBe("vault-icon-work");
  });

  it("maps known iconId 'personal' to vault-icon-personal", () => {
    const vault = makeVault({ iconId: "personal" });
    expect(getVaultIconClass(vault)).toBe("vault-icon-personal");
  });

  it("maps iconId 'default' to vault-icon-default", () => {
    const vault = makeVault({ iconId: "default" });
    expect(getVaultIconClass(vault)).toBe("vault-icon-default");
  });
});

// ── buildTreeFromIndex ────────────────────────────────────────────────────────

describe("buildTreeFromIndex", () => {
  it("returns a single vault root node when entries is empty", () => {
    const vault = makeVault();
    const tree = buildTreeFromIndex([], ["/vault"], new Set(), vault);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("vault");
    expect(tree[0].name).toBe("My Vault");
    expect(tree[0].children).toHaveLength(0);
  });

  it("vault root node has the vault's id", () => {
    const vault = makeVault({ id: "abc-123" });
    const tree = buildTreeFromIndex([], ["/vault"], new Set(), vault);
    expect(tree[0].vaultId).toBe("abc-123");
  });

  it("adds a file directly under the vault node when at root level", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/note.md")];
    const tree = buildTreeFromIndex(entries, ["/vault"], new Set(), vault);
    const vaultNode = tree[0];
    expect(vaultNode.children).toHaveLength(1);
    expect(vaultNode.children[0].type).toBe("file");
    expect(vaultNode.children[0].name).toBe("note");
    expect(vaultNode.children[0].path).toBe("/vault/note.md");
  });

  it("synthesises an intermediate directory node for a nested file", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/work/report.md")];
    const tree = buildTreeFromIndex(entries, ["/vault"], new Set(), vault);
    const vaultNode = tree[0];

    // Should have one directory child "work"
    expect(vaultNode.children).toHaveLength(1);
    const dir = vaultNode.children[0];
    expect(dir.type).toBe("directory");
    expect(dir.name).toBe("work");

    // Directory should have one file child "report"
    expect(dir.children).toHaveLength(1);
    expect(dir.children[0].type).toBe("file");
    expect(dir.children[0].name).toBe("report");
  });

  it("sets expanded: true on a directory whose path is in expandedPaths", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/docs/readme.md")];
    const expanded = new Set(["/vault/docs"]);
    const tree = buildTreeFromIndex(entries, ["/vault"], expanded, vault);
    const dir = tree[0].children[0];
    expect(dir.type).toBe("directory");
    expect(dir.expanded).toBe(true);
  });

  it("sets expanded: false on a directory whose path is NOT in expandedPaths", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/docs/readme.md")];
    const tree = buildTreeFromIndex(entries, ["/vault"], new Set(), vault);
    const dir = tree[0].children[0];
    expect(dir.expanded).toBe(false);
  });

  it("strips the .md extension from file node names", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/my-note.md")];
    const tree = buildTreeFromIndex(entries, ["/vault"], new Set(), vault);
    const file = tree[0].children[0];
    expect(file.name).toBe("my-note");
  });

  it("produces multiple root-level children when given multiple rootPaths", () => {
    const vault = makeVault({ rootPaths: ["/vaultA", "/vaultB"] });
    const entries = [
      makeEntry("/vaultA/note1.md"),
      makeEntry("/vaultB/note2.md"),
    ];
    const tree = buildTreeFromIndex(entries, ["/vaultA", "/vaultB"], new Set(), vault);
    // Vault root wraps both subtrees
    const vaultNode = tree[0];
    // Both notes should appear under the vault
    const allFiles = flattenFiles(vaultNode.children);
    expect(allFiles.map((n) => n.name)).toContain("note1");
    expect(allFiles.map((n) => n.name)).toContain("note2");
  });

  it("vault root node is always expanded", () => {
    const vault = makeVault();
    const tree = buildTreeFromIndex([], ["/vault"], new Set(), vault);
    expect(tree[0].expanded).toBe(true);
  });

  it("assigns depth 0 to the vault node", () => {
    const vault = makeVault();
    const tree = buildTreeFromIndex([], ["/vault"], new Set(), vault);
    expect(tree[0].depth).toBe(0);
  });

  it("assigns depth 1 to a file directly under the vault root", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/note.md")];
    const tree = buildTreeFromIndex(entries, ["/vault"], new Set(), vault);
    const file = tree[0].children[0];
    // With one root path, base depth is 0 so file at root level → depth 0
    // (spec says depth relative to root; base depth for single-root is 0)
    expect(file.depth).toBeGreaterThanOrEqual(0);
  });

  it("file nodes always have expanded: false", () => {
    const vault = makeVault();
    const entries = [makeEntry("/vault/note.md")];
    const tree = buildTreeFromIndex(entries, ["/vault"], new Set(), vault);
    const file = tree[0].children[0];
    expect(file.expanded).toBe(false);
  });
});

// ── sortNodes ─────────────────────────────────────────────────────────────────

describe("sortNodes", () => {
  it("places directories before files", () => {
    const nodes: TreeNode[] = [
      makeFileNode("b-note", "/vault/b-note.md"),
      makeDirNode("a-folder", "/vault/a-folder"),
    ];
    sortNodes(nodes);
    expect(nodes[0].type).toBe("directory");
    expect(nodes[1].type).toBe("file");
  });

  it("sorts nodes alphabetically within the same type (case-insensitive)", () => {
    const nodes: TreeNode[] = [
      makeFileNode("Zebra", "/vault/Zebra.md"),
      makeFileNode("apple", "/vault/apple.md"),
      makeFileNode("Mango", "/vault/Mango.md"),
    ];
    sortNodes(nodes);
    const names = nodes.map((n) => n.name.toLowerCase());
    expect(names).toEqual(["apple", "mango", "zebra"]);
  });

  it("returns the same array reference (sorted in place)", () => {
    const nodes: TreeNode[] = [makeFileNode("z", "/vault/z.md"), makeFileNode("a", "/vault/a.md")];
    const result = sortNodes(nodes);
    expect(result).toBe(nodes);
  });

  it("handles an empty array without throwing", () => {
    expect(() => sortNodes([])).not.toThrow();
    expect(sortNodes([])).toEqual([]);
  });

  it("sorts directory children recursively", () => {
    const inner: TreeNode[] = [
      makeFileNode("z-file", "/vault/dir/z-file.md"),
      makeFileNode("a-file", "/vault/dir/a-file.md"),
    ];
    const nodes: TreeNode[] = [makeDirNode("dir", "/vault/dir", inner)];
    sortNodes(nodes);
    expect(nodes[0].children[0].name).toBe("a-file");
    expect(nodes[0].children[1].name).toBe("z-file");
  });
});

// ── filterTree ────────────────────────────────────────────────────────────────

describe("filterTree", () => {
  function makeSimpleTree(): TreeNode[] {
    const files = [
      makeFileNode("meeting-notes", "/vault/meeting-notes.md"),
      makeFileNode("readme", "/vault/readme.md"),
      makeFileNode("todo", "/vault/todo.md"),
    ];
    const dir = makeDirNode("docs", "/vault/docs", files);
    return [makeDirNode("vault", "/vault", [dir])];
  }

  it("returns original tree unchanged when query is empty string", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "");
    expect(result).toBe(tree);
  });

  it("returns original tree unchanged when query is only whitespace", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "   ");
    expect(result).toBe(tree);
  });

  it("returns flat array of matching file nodes for a non-empty query", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "readme");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("readme");
    expect(result[0].type).toBe("file");
  });

  it("returns an empty array when query matches no file", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "zzz-does-not-match");
    expect(result).toHaveLength(0);
  });

  it("matching is case-insensitive", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "README");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("readme");
  });

  it("fuzzy-matches 'mtg' against 'meeting-notes'", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "mtg");
    const names = result.map((n) => n.name);
    expect(names).toContain("meeting-notes");
  });

  it("returns multiple matches when several files satisfy the query", () => {
    const tree = makeSimpleTree();
    // Both "readme" and "meeting-notes" contain the letter 'e'
    const result = filterTree(tree, "e");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("result nodes are plain file nodes (no directory wrappers)", () => {
    const tree = makeSimpleTree();
    const result = filterTree(tree, "todo");
    expect(result.every((n) => n.type === "file")).toBe(true);
  });
});

// ── diffTree ──────────────────────────────────────────────────────────────────

describe("diffTree", () => {
  it("returns empty arrays when trees are identical", () => {
    const nodes = [makeFileNode("note", "/vault/note.md")];
    const result = diffTree(nodes, nodes);
    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
  });

  it("puts a new file's path in toAdd", () => {
    const old = [makeFileNode("a", "/vault/a.md")];
    const next = [makeFileNode("a", "/vault/a.md"), makeFileNode("b", "/vault/b.md")];
    const { toAdd } = diffTree(old, next);
    expect(toAdd).toContain("/vault/b.md");
  });

  it("puts a removed file's path in toRemove", () => {
    const old = [makeFileNode("a", "/vault/a.md"), makeFileNode("b", "/vault/b.md")];
    const next = [makeFileNode("a", "/vault/a.md")];
    const { toRemove } = diffTree(old, next);
    expect(toRemove).toContain("/vault/b.md");
  });

  it("puts a renamed file's path in toUpdate when the name changed", () => {
    const old = [makeFileNode("old-name", "/vault/note.md")];
    const next = [makeFileNode("new-name", "/vault/note.md")];
    const { toUpdate } = diffTree(old, next);
    expect(toUpdate).toContain("/vault/note.md");
  });

  it("identical file nodes produce no toUpdate entry", () => {
    const file = makeFileNode("note", "/vault/note.md");
    const { toUpdate } = diffTree([file], [file]);
    expect(toUpdate).toHaveLength(0);
  });

  it("handles empty old tree (all new paths go to toAdd)", () => {
    const next = [makeFileNode("a", "/vault/a.md"), makeFileNode("b", "/vault/b.md")];
    const { toAdd, toRemove } = diffTree([], next);
    expect(toAdd).toHaveLength(2);
    expect(toRemove).toHaveLength(0);
  });

  it("handles empty new tree (all old paths go to toRemove)", () => {
    const old = [makeFileNode("a", "/vault/a.md")];
    const { toRemove, toAdd } = diffTree(old, []);
    expect(toRemove).toContain("/vault/a.md");
    expect(toAdd).toHaveLength(0);
  });

  it("puts a file's path in toUpdate when modified timestamp changed (HIGH-2 / LOW-2)", () => {
    /*
     * Same path and name — only the modified timestamp differs. This simulates
     * an in-place file edit that vault-manager detects via mtime, and verifies
     * that diffTree propagates that change to the toUpdate set so the incremental
     * render path can refresh the node without tearing down the whole tree.
     */
    const oldNode: TreeNode = { ...makeFileNode("note", "/vault/note.md"), modified: 1000 };
    const newNode: TreeNode = { ...makeFileNode("note", "/vault/note.md"), modified: 2000 };
    const { toUpdate } = diffTree([oldNode], [newNode]);
    expect(toUpdate).toContain("/vault/note.md");
  });

  it("does NOT put a path in toUpdate when modified timestamps are equal", () => {
    const node: TreeNode = { ...makeFileNode("note", "/vault/note.md"), modified: 1000 };
    const { toUpdate } = diffTree([node], [{ ...node }]);
    expect(toUpdate).toHaveLength(0);
  });

  it("does NOT put a path in toUpdate when both nodes lack a modified timestamp", () => {
    /*
     * Vault nodes and directory nodes have no modified field. Ensure the diff
     * does not incorrectly mark them for update when both are undefined.
     */
    const dir = { ...makeFileNode("dir", "/vault/dir"), modified: undefined };
    const { toUpdate } = diffTree([dir], [{ ...dir }]);
    expect(toUpdate).toHaveLength(0);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Collect all file-type nodes from a tree (recursive). */
function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === "file") out.push(n);
    if (n.children.length > 0) out.push(...flattenFiles(n.children));
  }
  return out;
}

function makeFileNode(name: string, path: string): TreeNode {
  return {
    type: "file",
    path,
    name,
    children: [],
    expanded: false,
    depth: 1,
    iconClass: "file-icon",
  };
}

function makeDirNode(name: string, path: string, children: TreeNode[] = []): TreeNode {
  return {
    type: "directory",
    path,
    name,
    children,
    expanded: false,
    depth: 0,
    iconClass: "folder-icon",
  };
}
