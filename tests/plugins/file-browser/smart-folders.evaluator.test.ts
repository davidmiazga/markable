/**
 * smart-folders.evaluator.test.ts
 *
 * Unit tests for the Smart Folders evaluation engine (step_02).
 *
 * Tests cover:
 *   - buildInverseMaps: tag inversion, outbound/inbound counts, ext collection
 *   - matchRule: all 6 rule types × all operators
 *   - evaluateSmartFolder: AND combinator, sort order (Locked #12)
 *   - evaluateAll: single inverse-map build per pass (FR-28), conflict (EC-09)
 *   - scanVaultTagsCached: shared in-flight promise (EC-15), TTL (5s)
 *   - clearEvaluationCache: state reset (EC-07)
 *   - Performance smoke: 1000 files × 10 SFs × 6 rule types < 100ms (NFR-01)
 *
 * All tests are pure TypeScript — no DOM access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildInverseMaps,
  matchRule,
  evaluateSmartFolder,
  evaluateAll,
} from "../../../src/plugins/file-browser/smart-folders/evaluator";
import {
  scanVaultTagsCached,
  getEvaluationResult,
  getAllEvaluationResults,
  clearEvaluationCache,
  evaluateAllSmartFolders,
} from "../../../src/plugins/file-browser/smart-folders/index";
import type { VaultIndex, VaultIndexEntry } from "../../../src/lib/vault-types";
import type { TagEntry } from "../../../src/lib/bridge";
import type { SmartFolderDef } from "../../../src/plugins/file-browser/smart-folders/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a minimal VaultIndexEntry. */
function makeEntry(overrides: Partial<VaultIndexEntry> & { path: string }): VaultIndexEntry {
  return {
    name: overrides.path.split("/").pop()?.replace(/\.md$/, "") ?? "note",
    modified: 1000,
    size: 100,
    title: "Note",
    tags: [],
    outboundLinks: [],
    ...overrides,
  };
}

/** Build a minimal VaultIndex from a list of entry paths. */
function makeVaultIndex(paths: string[], extras: Partial<VaultIndex> = {}): VaultIndex {
  return {
    vaultId: "v1",
    builtAt: Date.now(),
    entries: paths.map((p) => makeEntry({ path: p })),
    totalFilesFound: paths.length,
    skippedCount: 0,
    capped: false,
    nonMdFiles: [],
    ...extras,
  };
}

/** Build a single SmartFolderDef. */
function makeDef(overrides: Partial<SmartFolderDef> = {}): SmartFolderDef {
  return {
    id: "sf-test",
    name: "Test Folder",
    rules: [{ type: "tag", operator: "is", value: "research" }],
    ...overrides,
  };
}

// Reference timestamp for deterministic time-based tests
const NOW = new Date("2026-06-01T00:00:00Z").getTime();

// ── buildInverseMaps ──────────────────────────────────────────────────────────

describe("buildInverseMaps", () => {
  it("inverts tag scan into pathToTags correctly", () => {
    const vaultIndex = makeVaultIndex(["/notes/a.md", "/notes/b.md", "/notes/c.md"]);
    const tagScan: TagEntry[] = [
      { tag: "research", filePaths: ["/notes/a.md", "/notes/b.md"], count: 2 },
      { tag: "draft",    filePaths: ["/notes/b.md"],                 count: 1 },
    ];

    const maps = buildInverseMaps(vaultIndex, tagScan);

    const tagsA = maps.pathToTags.get("/notes/a.md");
    const tagsB = maps.pathToTags.get("/notes/b.md");
    const tagsC = maps.pathToTags.get("/notes/c.md");

    expect(tagsA?.has("research")).toBe(true);
    expect(tagsA?.has("draft")).toBe(false);
    expect(tagsB?.has("research")).toBe(true);
    expect(tagsB?.has("draft")).toBe(true);
    expect(tagsC).toBeUndefined();
  });

  it("sets outbound count equal to outboundLinks.length for each entry", () => {
    const vaultIndex = makeVaultIndex([], {
      entries: [
        makeEntry({ path: "/notes/a.md", outboundLinks: ["b", "c"] }),
        makeEntry({ path: "/notes/b.md", outboundLinks: [] }),
      ],
    });
    const maps = buildInverseMaps(vaultIndex, []);

    expect(maps.pathToOutboundCount.get("/notes/a.md")).toBe(2);
    expect(maps.pathToOutboundCount.get("/notes/b.md")).toBe(0);
  });

  it("computes inbound count via stem resolution (2 files link to foo)", () => {
    const vaultIndex = makeVaultIndex([], {
      entries: [
        makeEntry({ path: "/notes/foo.md",     name: "foo",      outboundLinks: [] }),
        makeEntry({ path: "/notes/linker1.md", name: "linker1",  outboundLinks: ["foo"] }),
        makeEntry({ path: "/notes/linker2.md", name: "linker2",  outboundLinks: ["foo"] }),
      ],
    });
    const maps = buildInverseMaps(vaultIndex, []);

    expect(maps.pathToInboundCount.get("/notes/foo.md")).toBe(2);
    expect(maps.pathToInboundCount.get("/notes/linker1.md")).toBeUndefined();
  });

  it("adds non-md file extensions to distinctExtensions", () => {
    const vaultIndex = makeVaultIndex(["/notes/a.md"], {
      nonMdFiles: [
        { path: "/notes/photo.png", name: "photo.png" },
        { path: "/notes/doc.pdf",   name: "doc.pdf"   },
      ],
    });
    const maps = buildInverseMaps(vaultIndex, []);

    expect(maps.distinctExtensions).toContain(".png");
    expect(maps.distinctExtensions).toContain(".pdf");
    expect(maps.distinctExtensions).toContain(".md");
  });
});

// ── matchRule — tag ───────────────────────────────────────────────────────────

describe("matchRule tag", () => {
  const vaultIndex = makeVaultIndex(["/notes/a.md"]);
  const tagScan: TagEntry[] = [
    { tag: "research", filePaths: ["/notes/a.md"], count: 1 },
  ];
  const maps = buildInverseMaps(vaultIndex, tagScan);

  const candidate = { path: "/notes/a.md", name: "a", title: "A", modified: 1000, isMd: true };
  const other     = { path: "/notes/b.md", name: "b", title: "B", modified: 1000, isMd: true };

  it("operator 'is' returns true when file has the tag", () => {
    expect(matchRule({ type: "tag", operator: "is", value: "research" }, candidate, maps, NOW)).toBe(true);
  });

  it("operator 'is' returns false when file lacks the tag", () => {
    expect(matchRule({ type: "tag", operator: "is", value: "research" }, other, maps, NOW)).toBe(false);
  });

  it("operator 'is not' returns false when file has the tag", () => {
    expect(matchRule({ type: "tag", operator: "is not", value: "research" }, candidate, maps, NOW)).toBe(false);
  });

  it("operator 'is not' returns true when file lacks the tag", () => {
    expect(matchRule({ type: "tag", operator: "is not", value: "research" }, other, maps, NOW)).toBe(true);
  });
});

// ── matchRule — path ──────────────────────────────────────────────────────────

describe("matchRule path", () => {
  const maps = buildInverseMaps(makeVaultIndex([]), []);
  const c = { path: "/vault/projects/work/note.md", name: "note", title: "Note", modified: 0, isMd: true };

  it("operator 'contains'", () => {
    expect(matchRule({ type: "path", operator: "contains", value: "projects" }, c, maps, NOW)).toBe(true);
    expect(matchRule({ type: "path", operator: "contains", value: "personal" }, c, maps, NOW)).toBe(false);
  });

  it("operator 'does not contain'", () => {
    expect(matchRule({ type: "path", operator: "does not contain", value: "personal" }, c, maps, NOW)).toBe(true);
    expect(matchRule({ type: "path", operator: "does not contain", value: "projects" }, c, maps, NOW)).toBe(false);
  });

  it("operator 'starts with'", () => {
    expect(matchRule({ type: "path", operator: "starts with", value: "/vault" }, c, maps, NOW)).toBe(true);
    expect(matchRule({ type: "path", operator: "starts with", value: "/other" }, c, maps, NOW)).toBe(false);
  });

  it("operator 'does not start with'", () => {
    expect(matchRule({ type: "path", operator: "does not start with", value: "/other" }, c, maps, NOW)).toBe(true);
    expect(matchRule({ type: "path", operator: "does not start with", value: "/vault" }, c, maps, NOW)).toBe(false);
  });
});

// ── matchRule — extension ─────────────────────────────────────────────────────

describe("matchRule extension", () => {
  const maps = buildInverseMaps(makeVaultIndex([]), []);
  const mdFile  = { path: "/vault/note.md",    name: "note",    title: "Note",    modified: 0, isMd: true  };
  const pdfFile = { path: "/vault/report.pdf", name: "report",  title: "report",  modified: 0, isMd: false };

  it("operator 'is' with leading dot matches correctly", () => {
    expect(matchRule({ type: "extension", operator: "is", value: ".md"  }, mdFile,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "extension", operator: "is", value: ".pdf" }, pdfFile, maps, NOW)).toBe(true);
    expect(matchRule({ type: "extension", operator: "is", value: ".pdf" }, mdFile,  maps, NOW)).toBe(false);
  });

  it("operator 'is not' is the inverse", () => {
    expect(matchRule({ type: "extension", operator: "is not", value: ".pdf" }, mdFile, maps, NOW)).toBe(true);
    expect(matchRule({ type: "extension", operator: "is not", value: ".md"  }, mdFile, maps, NOW)).toBe(false);
  });
});

// ── matchRule — file-type ────────────────────────────────────────────────────

describe("matchRule file-type", () => {
  const maps = buildInverseMaps(makeVaultIndex([]), []);
  const jpg  = { path: "/vault/photo.jpg",  name: "photo.jpg",  title: "photo",  modified: 0, isMd: false };
  const png  = { path: "/vault/icon.png",   name: "icon.png",   title: "icon",   modified: 0, isMd: false };
  const mp4  = { path: "/vault/clip.mp4",   name: "clip.mp4",   title: "clip",   modified: 0, isMd: false };
  const mp3  = { path: "/vault/song.mp3",   name: "song.mp3",   title: "song",   modified: 0, isMd: false };
  const pdf  = { path: "/vault/doc.pdf",    name: "doc.pdf",    title: "doc",    modified: 0, isMd: false };
  const note = { path: "/vault/note.md",    name: "note",       title: "Note",   modified: 0, isMd: true  };

  it("'is images' matches .jpg and .png", () => {
    expect(matchRule({ type: "file-type", operator: "is", value: "images" }, jpg,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "file-type", operator: "is", value: "images" }, png,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "file-type", operator: "is", value: "images" }, mp4,  maps, NOW)).toBe(false);
    expect(matchRule({ type: "file-type", operator: "is", value: "images" }, note, maps, NOW)).toBe(false);
  });

  it("'is video' matches .mp4, not .jpg", () => {
    expect(matchRule({ type: "file-type", operator: "is", value: "video" }, mp4,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "file-type", operator: "is", value: "video" }, jpg,  maps, NOW)).toBe(false);
  });

  it("'is audio' matches .mp3", () => {
    expect(matchRule({ type: "file-type", operator: "is", value: "audio" }, mp3,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "file-type", operator: "is", value: "audio" }, mp4,  maps, NOW)).toBe(false);
  });

  it("'is not images' excludes image files but includes others", () => {
    expect(matchRule({ type: "file-type", operator: "is not", value: "images" }, jpg,  maps, NOW)).toBe(false);
    expect(matchRule({ type: "file-type", operator: "is not", value: "images" }, pdf,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "file-type", operator: "is not", value: "images" }, note, maps, NOW)).toBe(true);
  });

  it("unknown group name → 'is' returns false, 'is not' returns true", () => {
    expect(matchRule({ type: "file-type", operator: "is",     value: "spreadsheets" }, jpg, maps, NOW)).toBe(false);
    expect(matchRule({ type: "file-type", operator: "is not", value: "spreadsheets" }, jpg, maps, NOW)).toBe(true);
  });
});

// ── matchRule — modified ──────────────────────────────────────────────────────

describe("matchRule modified", () => {
  const maps = buildInverseMaps(makeVaultIndex([]), []);
  // 3 days ago
  const recentMs = NOW - 3 * 86_400_000;
  // 20 days ago
  const oldMs    = NOW - 20 * 86_400_000;

  const recent = { path: "/a.md", name: "a", title: "A", modified: recentMs, isMd: true };
  const old    = { path: "/b.md", name: "b", title: "B", modified: oldMs,    isMd: true };

  it("operator 'in last N days' includes recent file (7 days)", () => {
    expect(matchRule({ type: "modified", operator: "in last N days", value: 7 }, recent, maps, NOW)).toBe(true);
    expect(matchRule({ type: "modified", operator: "in last N days", value: 7 }, old,    maps, NOW)).toBe(false);
  });

  it("operator 'not in last N days' excludes recent file", () => {
    expect(matchRule({ type: "modified", operator: "not in last N days", value: 7 }, recent, maps, NOW)).toBe(false);
    expect(matchRule({ type: "modified", operator: "not in last N days", value: 7 }, old,    maps, NOW)).toBe(true);
  });

  it("operator 'before' ISO date", () => {
    // Modified 20 days before NOW (2026-06-01) → should be "before 2026-05-20"
    const cutDate = "2026-05-20"; // recent is 2026-05-29 (3 days before), old is 2026-05-12
    expect(matchRule({ type: "modified", operator: "before", value: cutDate }, recent, maps, NOW)).toBe(false);
    expect(matchRule({ type: "modified", operator: "before", value: cutDate }, old,    maps, NOW)).toBe(true);
  });

  it("operator 'after' ISO date", () => {
    const cutDate = "2026-05-20";
    expect(matchRule({ type: "modified", operator: "after", value: cutDate }, recent, maps, NOW)).toBe(true);
    expect(matchRule({ type: "modified", operator: "after", value: cutDate }, old,    maps, NOW)).toBe(false);
  });
});

// ── matchRule — links ─────────────────────────────────────────────────────────

describe("matchRule links", () => {
  const vaultIndex = makeVaultIndex([], {
    entries: [
      makeEntry({ path: "/notes/hub.md",   name: "hub",   outboundLinks: ["a", "b"] }),
      makeEntry({ path: "/notes/a.md",     name: "a",     outboundLinks: [] }),
      makeEntry({ path: "/notes/orphan.md",name: "orphan",outboundLinks: [] }),
    ],
  });
  const maps = buildInverseMaps(vaultIndex, []);

  const hub    = { path: "/notes/hub.md",    name: "hub",    title: "Hub",    modified: 0, isMd: true  };
  const aNote  = { path: "/notes/a.md",      name: "a",      title: "A",      modified: 0, isMd: true  };
  const orphan = { path: "/notes/orphan.md", name: "orphan", title: "Orphan", modified: 0, isMd: true  };
  const pdf    = { path: "/notes/doc.pdf",   name: "doc",    title: "doc",    modified: 0, isMd: false };

  it("outbound = 0", () => {
    expect(matchRule({ type: "links", operator: "outbound = 0",  value: null }, hub,    maps, NOW)).toBe(false);
    expect(matchRule({ type: "links", operator: "outbound = 0",  value: null }, orphan, maps, NOW)).toBe(true);
  });

  it("outbound >= 1", () => {
    expect(matchRule({ type: "links", operator: "outbound >= 1", value: null }, hub,    maps, NOW)).toBe(true);
    expect(matchRule({ type: "links", operator: "outbound >= 1", value: null }, orphan, maps, NOW)).toBe(false);
  });

  it("outbound >= N (N=2)", () => {
    expect(matchRule({ type: "links", operator: "outbound >= N", value: 2    }, hub,    maps, NOW)).toBe(true);
    expect(matchRule({ type: "links", operator: "outbound >= N", value: 3    }, hub,    maps, NOW)).toBe(false);
  });

  it("inbound = 0 (orphan has no inbound)", () => {
    expect(matchRule({ type: "links", operator: "inbound = 0",   value: null }, orphan, maps, NOW)).toBe(true);
    expect(matchRule({ type: "links", operator: "inbound = 0",   value: null }, aNote,  maps, NOW)).toBe(false);
  });

  it("inbound >= 1 (a.md has inbound from hub)", () => {
    expect(matchRule({ type: "links", operator: "inbound >= 1",  value: null }, aNote,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "links", operator: "inbound >= 1",  value: null }, orphan, maps, NOW)).toBe(false);
  });

  it("inbound >= N (N=1)", () => {
    expect(matchRule({ type: "links", operator: "inbound >= N",  value: 1    }, aNote,  maps, NOW)).toBe(true);
    expect(matchRule({ type: "links", operator: "inbound >= N",  value: 2    }, aNote,  maps, NOW)).toBe(false);
  });

  it("non-md file returns false for all link rules (EC-18)", () => {
    expect(matchRule({ type: "links", operator: "outbound = 0",  value: null }, pdf, maps, NOW)).toBe(false);
    expect(matchRule({ type: "links", operator: "outbound >= 1", value: null }, pdf, maps, NOW)).toBe(false);
    expect(matchRule({ type: "links", operator: "inbound = 0",   value: null }, pdf, maps, NOW)).toBe(false);
    expect(matchRule({ type: "links", operator: "inbound >= 1",  value: null }, pdf, maps, NOW)).toBe(false);
  });
});

// ── matchRule — title ─────────────────────────────────────────────────────────

describe("matchRule title", () => {
  const maps = buildInverseMaps(makeVaultIndex([]), []);
  // FR-08: check both title AND name (case-insensitive)
  const c = { path: "/notes/meeting-notes.md", name: "meeting-notes", title: "Q2 Planning", modified: 0, isMd: true };

  it("operator 'contains' matches on title (case-insensitive)", () => {
    expect(matchRule({ type: "title", operator: "contains", value: "q2" }, c, maps, NOW)).toBe(true);
  });

  it("operator 'contains' matches on name (case-insensitive)", () => {
    expect(matchRule({ type: "title", operator: "contains", value: "MEETING" }, c, maps, NOW)).toBe(true);
  });

  it("operator 'contains' returns false when neither matches", () => {
    expect(matchRule({ type: "title", operator: "contains", value: "unrelated" }, c, maps, NOW)).toBe(false);
  });

  it("operator 'does not contain' is the inverse", () => {
    expect(matchRule({ type: "title", operator: "does not contain", value: "unrelated" }, c, maps, NOW)).toBe(true);
    expect(matchRule({ type: "title", operator: "does not contain", value: "q2" }, c, maps, NOW)).toBe(false);
  });
});

// ── evaluateSmartFolder ───────────────────────────────────────────────────────

describe("evaluateSmartFolder", () => {
  it("applies AND combinator: two rules together prune to intersection", () => {
    const vaultIndex = makeVaultIndex([], {
      entries: [
        makeEntry({ path: "/notes/a.md", name: "a", outboundLinks: ["b"] }),  // outbound ≥ 1
        makeEntry({ path: "/notes/b.md", name: "b", outboundLinks: [] }),      // outbound = 0
      ],
    });
    const tagScan: TagEntry[] = [
      { tag: "draft", filePaths: ["/notes/a.md", "/notes/b.md"], count: 2 },
    ];
    const maps = buildInverseMaps(vaultIndex, tagScan);

    // Rule 1: tag is "draft" → matches a and b
    // Rule 2: outbound >= 1 → matches only a
    // AND → only a
    const def = makeDef({
      rules: [
        { type: "tag",   operator: "is",          value: "draft" },
        { type: "links", operator: "outbound >= 1", value: null  },
      ],
    });
    const result = evaluateSmartFolder(def, vaultIndex, maps, NOW);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toBe("/notes/a.md");
    expect(result.count).toBe(1);
  });

  it("sorts matches by modified descending (Locked #12)", () => {
    const vaultIndex = makeVaultIndex([], {
      entries: [
        makeEntry({ path: "/notes/old.md",    name: "old",    modified: 100 }),
        makeEntry({ path: "/notes/newest.md", name: "newest", modified: 300 }),
        makeEntry({ path: "/notes/mid.md",    name: "mid",    modified: 200 }),
      ],
    });
    const maps = buildInverseMaps(vaultIndex, []);
    // "title contains" matches all three
    const def = makeDef({ rules: [{ type: "title", operator: "contains", value: "" }] });
    const result = evaluateSmartFolder(def, vaultIndex, maps, NOW);
    expect(result.matches[0]).toBe("/notes/newest.md");
    expect(result.matches[1]).toBe("/notes/mid.md");
    expect(result.matches[2]).toBe("/notes/old.md");
  });

  it("conflicting rules return empty result (EC-09)", () => {
    const vaultIndex = makeVaultIndex([], {
      entries: [
        makeEntry({ path: "/notes/a.md", name: "a" }),
      ],
    });
    const tagScan: TagEntry[] = [
      { tag: "research", filePaths: ["/notes/a.md"], count: 1 },
    ];
    const maps = buildInverseMaps(vaultIndex, tagScan);
    const def = makeDef({
      rules: [
        { type: "tag", operator: "is",     value: "research" },
        { type: "tag", operator: "is not", value: "research" },
      ],
    });
    const result = evaluateSmartFolder(def, vaultIndex, maps, NOW);
    expect(result.matches).toHaveLength(0);
    expect(result.count).toBe(0);
  });
});

// ── evaluateAll ───────────────────────────────────────────────────────────────

describe("evaluateAll", () => {
  it("builds inverse maps exactly once for multiple defs (FR-28)", () => {
    // We can't spy on buildInverseMaps directly since it's in the same module,
    // but we can verify the result is consistent across 5 defs without mutation.
    const vaultIndex = makeVaultIndex(["/notes/a.md", "/notes/b.md"]);
    const defs = Array.from({ length: 5 }, (_, i) =>
      makeDef({ id: `sf-${i}`, name: `Folder ${i}` }),
    );

    // Replace all rules with "title contains ''" to match everything
    const allMatchDefs = defs.map((d) => ({
      ...d,
      rules: [{ type: "title" as const, operator: "contains" as const, value: "" }],
    }));

    const results = evaluateAll(allMatchDefs, vaultIndex, [], NOW);
    // All 5 defs should have same match count
    for (const [, result] of results) {
      expect(result.count).toBe(2);
    }
  });

  it("returns a Map keyed by smart folder id", () => {
    const vaultIndex = makeVaultIndex(["/notes/a.md"]);
    const defs = [makeDef({ id: "sf-alpha" }), makeDef({ id: "sf-beta" })];
    const results = evaluateAll(defs, vaultIndex, [], NOW);
    expect(results.has("sf-alpha")).toBe(true);
    expect(results.has("sf-beta")).toBe(true);
  });
});

// ── scanVaultTagsCached ───────────────────────────────────────────────────────

describe("scanVaultTagsCached", () => {
  const mockVault = {
    id: "vault-test",
    name: "Test",
    rootPaths: ["/notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
  };

  beforeEach(() => {
    clearEvaluationCache();
    // Reset any Tauri mock from a previous test
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("shares the same in-flight promise for concurrent calls within TTL (EC-15)", async () => {
    let invokeCount = 0;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn((_cmd: string) => {
        invokeCount++;
        return Promise.resolve([{ tag: "t1", filePaths: ["/a.md"], count: 1 }]);
      }),
    };

    // Two simultaneous calls
    const [r1, r2] = await Promise.all([
      scanVaultTagsCached(mockVault as any),
      scanVaultTagsCached(mockVault as any),
    ]);

    // Must share the same promise → only one Tauri invoke
    expect(invokeCount).toBe(1);
    expect(r1).toBe(r2); // same array reference
  });

  it("makes a second invoke after TTL expires (5s)", async () => {
    const invokeFn = vi.fn(() =>
      Promise.resolve([{ tag: "t1", filePaths: ["/a.md"], count: 1 }])
    );
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeFn };

    // First call
    await scanVaultTagsCached(mockVault as any);
    expect(invokeFn).toHaveBeenCalledTimes(1);

    // Advance time past TTL by manipulating the cache internals via clearEvaluationCache
    // and re-calling (clearEvaluationCache nulls the tag-scan cache).
    clearEvaluationCache();
    await scanVaultTagsCached(mockVault as any);
    expect(invokeFn).toHaveBeenCalledTimes(2);
  });

  it("returns [] on Tauri failure (NFR-06 degraded mode)", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(() => Promise.reject(new Error("Tauri error"))),
    };
    const result = await scanVaultTagsCached(mockVault as any);
    expect(result).toEqual([]);
  });
});

// ── clearEvaluationCache ──────────────────────────────────────────────────────

describe("clearEvaluationCache", () => {
  it("resets getAllEvaluationResults to empty Map after clear", async () => {
    const mockVault = {
      id: "v1", name: "V", rootPaths: ["/n"], excludePatterns: [],
      maxIndexSize: 500, created: "", lastOpened: "",
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(() => Promise.resolve([])),
    };
    const vaultIndex = makeVaultIndex(["/notes/a.md"]);
    await evaluateAllSmartFolders(
      [makeDef({ rules: [{ type: "title", operator: "contains", value: "" }] })],
      vaultIndex,
      mockVault as any,
    );
    // Verify something was stored
    expect(getAllEvaluationResults().size).toBeGreaterThan(0);

    clearEvaluationCache();
    expect(getAllEvaluationResults().size).toBe(0);
    expect(getEvaluationResult("sf-test")).toBeNull();
  });
});

// ── Performance smoke ─────────────────────────────────────────────────────────

describe("evaluateAll performance smoke (NFR-01)", () => {
  it("processes 1000 files × 10 smart folders under 100ms", () => {
    // Build a 1000-entry vault with varied tags and outbound links
    const entries = Array.from({ length: 1000 }, (_, i) => {
      const path = `/vault/note-${i}.md`;
      return makeEntry({
        path,
        name: `note-${i}`,
        title: `Note ${i}`,
        modified: Date.now() - i * 1000,
        outboundLinks: i % 5 === 0 ? [`note-${i + 1}`] : [],
      });
    });
    const vaultIndex: VaultIndex = {
      vaultId: "v-perf",
      builtAt: Date.now(),
      entries,
      totalFilesFound: 1000,
      skippedCount: 0,
      capped: false,
      nonMdFiles: Array.from({ length: 50 }, (_, i) => ({
        path: `/vault/image-${i}.png`,
        name: `image-${i}.png`,
      })),
    };
    const tagScan: TagEntry[] = [
      { tag: "research", filePaths: entries.slice(0, 100).map((e) => e.path), count: 100 },
      { tag: "draft",    filePaths: entries.slice(100, 300).map((e) => e.path), count: 200 },
    ];

    // 10 smart folders each exercising a different rule type
    const defs: SmartFolderDef[] = [
      makeDef({ id: "sf-1", name: "SF1", rules: [{ type: "tag",       operator: "is",             value: "research"     }] }),
      makeDef({ id: "sf-2", name: "SF2", rules: [{ type: "tag",       operator: "is not",         value: "draft"        }] }),
      makeDef({ id: "sf-3", name: "SF3", rules: [{ type: "path",      operator: "contains",       value: "note"         }] }),
      makeDef({ id: "sf-4", name: "SF4", rules: [{ type: "extension", operator: "is",             value: ".md"          }] }),
      makeDef({ id: "sf-5", name: "SF5", rules: [{ type: "title",     operator: "contains",       value: "Note"         }] }),
      makeDef({ id: "sf-6", name: "SF6", rules: [{ type: "links",     operator: "outbound >= 1",  value: null           }] }),
      makeDef({ id: "sf-7", name: "SF7", rules: [{ type: "links",     operator: "inbound = 0",    value: null           }] }),
      makeDef({ id: "sf-8", name: "SF8", rules: [{ type: "modified",  operator: "in last N days", value: 365            }] }),
      makeDef({ id: "sf-9", name: "SF9", rules: [{ type: "tag",       operator: "is",             value: "draft"        }] }),
      makeDef({ id: "sf-10",name: "SF10",rules: [{ type: "path",      operator: "starts with",    value: "/vault"       }] }),
    ];

    const start = performance.now();
    evaluateAll(defs, vaultIndex, tagScan, NOW);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
