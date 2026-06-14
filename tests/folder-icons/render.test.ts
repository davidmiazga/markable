/**
 * tests/folder-icons/render.test.ts — step_05
 *
 * Asserts that `buildTreeFromIndex` consumes the optional `folderIconMap`
 * parameter and threads the resolved iconClass into directory nodes, with the
 * generic `"folder-icon"` fallback when no map is provided or when the value
 * is unrecognised. Covers EC-1, EC-2, EC-3, EC-4, EC-5, EC-23.
 */

import { describe, it, expect } from "vitest";
import {
  buildTreeFromIndex,
  getFolderIconClass,
} from "../../src/plugins/file-browser/file-tree";
import type {
  VaultEntry,
  VaultIndexEntry,
} from "../../src/lib/vault-types";

const vault: VaultEntry = {
  id: "v1",
  name: "V",
  rootPaths: ["/v"],
  created: "",
  lastOpened: "",
  excludePatterns: [],
  maxIndexSize: 500,
};

function makeTree(folderIconMap?: Map<string, string>) {
  const entries: VaultIndexEntry[] = [
    {
      path: "/v/A/note.md",
      name: "note",
      modified: 0,
      size: 0,
      title: "n",
      tags: [],
      outboundLinks: [],
    },
    {
      path: "/v/B/note.md",
      name: "note",
      modified: 0,
      size: 0,
      title: "n",
      tags: [],
      outboundLinks: [],
    },
  ];
  // buildTreeFromIndex signature (live): (entries, rootPaths, expandedPaths,
  // vault, directories?, smartFolderInjections?, folderIconMap?)
  return buildTreeFromIndex(
    entries,
    ["/v"],
    new Set(),
    vault,
    ["/v/A", "/v/B"],
    [],
    folderIconMap,
  );
}

/** Convenience: walk a vault-rooted tree and return all directory nodes. */
function dirsOf(tree: ReturnType<typeof makeTree>): {
  path: string;
  iconClass: string;
  iconCustomPath?: string;
}[] {
  const out: { path: string; iconClass: string; iconCustomPath?: string }[] = [];
  function walk(nodes: typeof tree): void {
    for (const n of nodes) {
      if (n.type === "directory") {
        out.push({
          path: n.path,
          iconClass: n.iconClass,
          iconCustomPath: n.iconCustomPath,
        });
      }
      if (n.children.length > 0) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

describe("buildTreeFromIndex with folderIconMap (step_05)", () => {
  it("EC-1 — default fallback when no map provided", () => {
    const dirs = dirsOf(makeTree());
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) expect(d.iconClass).toBe("folder-icon");
  });

  it("EC-1 / EC-2 — directories missing from the map fall back to 'folder-icon'", () => {
    const dirs = dirsOf(makeTree(new Map()));
    for (const d of dirs) expect(d.iconClass).toBe("folder-icon");
  });

  it("applies catalog id when present in the map", () => {
    const dirs = dirsOf(makeTree(new Map([["/v/A", "book"]])));
    const a = dirs.find((d) => d.path === "/v/A")!;
    const b = dirs.find((d) => d.path === "/v/B")!;
    expect(a.iconClass).toBe("folder-icon-book");
    expect(b.iconClass).toBe("folder-icon");
  });

  it("EC-3 — unrecognised iconId falls back to 'folder-icon' (silent)", () => {
    const dirs = dirsOf(makeTree(new Map([["/v/A", "nonsense"]])));
    expect(dirs.find((d) => d.path === "/v/A")!.iconClass).toBe("folder-icon");
  });

  it("EC-4 — bare image-path-shaped value (no separator, not .svg) falls back to 'folder-icon'", () => {
    // `cover.png` has no separator and doesn't end in .svg → fallback branch.
    const dirs = dirsOf(makeTree(new Map([["/v/A", "cover.png"]])));
    expect(dirs.find((d) => d.path === "/v/A")!.iconClass).toBe("folder-icon");
  });

  it("EC-5 — does not lookup empty strings", () => {
    const dirs = dirsOf(makeTree(new Map([["/v/A", ""]])));
    expect(dirs.find((d) => d.path === "/v/A")!.iconClass).toBe("folder-icon");
  });

  it("EC-23 — a value containing `/` and ending `.svg` routes to custom kind + carries iconCustomPath", () => {
    const dirs = dirsOf(
      makeTree(new Map([["/v/A", "/Users/dave/my.svg"]])),
    );
    const a = dirs.find((d) => d.path === "/v/A")!;
    expect(a.iconClass).toBe("folder-icon-custom");
    expect(a.iconCustomPath).toBe("/Users/dave/my.svg");
  });

  it("getFolderIconClass is re-exported from file-tree for path-symmetric imports", () => {
    expect(getFolderIconClass("book")).toBe("folder-icon-book");
    expect(getFolderIconClass(undefined)).toBe("folder-icon");
  });
});
