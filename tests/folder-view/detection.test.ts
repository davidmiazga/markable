/**
 * tests/folder-view/detection.test.ts
 *
 * Unit tests for buildFolderViewSet().
 *
 * Covers all acceptance criteria from step_02_detection.md:
 * EC-01, EC-21, EC-23, plus normal detection paths.
 */

import { describe, it, expect } from "vitest";
import { buildFolderViewSet } from "../../src/plugins/file-browser/folder-view/detection";
import type { VaultIndex } from "../../src/lib/vault-types";

/** Build a minimal VaultIndex stub with only the fields detection.ts needs. */
function makeIndex(entries: Array<{ path: string; name: string }>): VaultIndex {
  return {
    entries: entries.map((e) => ({
      path: e.path,
      name: e.name,
      title: e.name,
      outboundLinks: [],
      tags: [],
      modified: 0,
      size: 0,
    })),
    nonMdFiles: [],
    directories: [],
    totalFilesFound: entries.length,
    capped: false,
  } as unknown as VaultIndex;
}

describe("buildFolderViewSet", () => {
  // ── EC-23: Flat vault / empty vault ───────────────────────────────────────

  it("EC-23: empty vault index entries → empty set", () => {
    const idx = makeIndex([]);
    expect(buildFolderViewSet(idx).size).toBe(0);
  });

  // ── EC-01: Null vault index ────────────────────────────────────────────────

  it("EC-01: null vault index → empty set, no crash", () => {
    expect(buildFolderViewSet(null).size).toBe(0);
  });

  // ── Basic detection ────────────────────────────────────────────────────────

  it("detects _folder.md: set contains the parent directory path", () => {
    const idx = makeIndex([{ path: "/vault/A/_folder.md", name: "_folder" }]);
    const set = buildFolderViewSet(idx);
    expect(set.has("/vault/A")).toBe(true);
    expect(set.size).toBe(1);
  });

  // ── Multiple folders ───────────────────────────────────────────────────────

  it("three _folder.md entries → set contains all three parent paths", () => {
    const idx = makeIndex([
      { path: "/vault/A/_folder.md", name: "_folder" },
      { path: "/vault/B/_folder.md", name: "_folder" },
      { path: "/vault/C/D/_folder.md", name: "_folder" },
    ]);
    const set = buildFolderViewSet(idx);
    expect(set.has("/vault/A")).toBe(true);
    expect(set.has("/vault/B")).toBe(true);
    expect(set.has("/vault/C/D")).toBe(true);
    expect(set.size).toBe(3);
  });

  // ── Non-_folder.md files ignored ──────────────────────────────────────────

  it("entry with name 'readme' → not added to the set", () => {
    const idx = makeIndex([{ path: "/vault/A/readme.md", name: "readme" }]);
    expect(buildFolderViewSet(idx).size).toBe(0);
  });

  // ── EC-21: Directory named _folder.md ─────────────────────────────────────

  it("EC-21: entry name is '_folder.md' (directory named _folder.md) → NOT added (name check is '_folder')", () => {
    // A directory named "_folder.md" would appear in the index with name === "_folder.md",
    // not "_folder". The vault index stores the file stem for .md files.
    const idx = makeIndex([{ path: "/vault/_folder.md", name: "_folder.md" }]);
    expect(buildFolderViewSet(idx).size).toBe(0);
  });

  it("EC-21 alternative: entry.name === '_folder' but path does NOT end with .md → not added", () => {
    // Guard: if somehow a path exists with name _folder but no .md extension.
    const idx = makeIndex([{ path: "/vault/A/_folder", name: "_folder" }]);
    expect(buildFolderViewSet(idx).size).toBe(0);
  });

  // ── Nested paths ──────────────────────────────────────────────────────────

  it("_folder.md at depth 3 → parent is the depth-3 directory", () => {
    const idx = makeIndex([{ path: "/vault/A/B/C/_folder.md", name: "_folder" }]);
    const set = buildFolderViewSet(idx);
    expect(set.has("/vault/A/B/C")).toBe(true);
    expect(set.size).toBe(1);
  });

  // ── Mixed entries: only _folder.md entries contribute ─────────────────────

  it("mixed entries: only _folder.md files contribute to the set", () => {
    const idx = makeIndex([
      { path: "/vault/A/notes.md", name: "notes" },
      { path: "/vault/A/_folder.md", name: "_folder" },
      { path: "/vault/B/readme.md", name: "readme" },
    ]);
    const set = buildFolderViewSet(idx);
    expect(set.has("/vault/A")).toBe(true);
    expect(set.has("/vault/B")).toBe(false);
    expect(set.size).toBe(1);
  });
});
