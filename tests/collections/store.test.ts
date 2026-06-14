/**
 * tests/collections/store.test.ts — step_02 + refactor R04
 *
 * Asserts the Collections store layer:
 *   - readCollection / readStack — tolerant of missing/malformed files (EC-4..6).
 *   - writeCollectionMeta / writeStackMeta — preserves unrelated keys (EC-23).
 *   - stackOrder + order + references mutators — atomic round-trips.
 *   - per-file write queue — concurrent writes to the same `_folder.md`
 *     serialise without corruption (EC-10).
 *   - schemaVersion guard — refuses writes when the on-disk version is newer
 *     than the running build (EC-13).
 *
 * Refactor R04 (2026-06-06): on-disk marker changed from `type: collection` /
 * `type: stack` to `layout: collection-home` (Collection root only — Stacks
 * have no marker). Reads remain tolerant of the legacy `type:` field
 * (FR-4 / EC-7); writes strip it in the same atomic temp-file-swap (FR-5 /
 * EC-8). Tests added below cover the read-compat alias, the migration
 * behaviour, and the new fresh-write contract.
 *
 * Bridge `readFile` / `writeFile` are mocked with an in-memory file map (copied
 * pattern from `tests/folder-icons/store.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  readCollection,
  writeCollectionMeta,
  readStack,
  writeStackMeta,
  appendStackToCollection,
  removeStackFromCollection,
  reorderStack,
  appendNoteToStack,
  removeNoteFromStack,
  reorderNote,
  renameNoteInStack,
  appendReference,
  removeReference,
  updateReferenceOnMove,
} from "../../src/plugins/file-browser/collections/store";

/**
 * Stub readFile / writeFile to back the bridge with an in-memory map.
 * Returns the map so post-call state can be asserted.
 */
function withFs(initial: Record<string, string>): Map<string, string> {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) {
      return { ok: true as const, value: fs.get(path)! };
    }
    return {
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path },
    };
  });
  vi.spyOn(bridge, "writeFile").mockImplementation(
    async (path: string, content: string) => {
      fs.set(path, content);
      return { ok: true as const, value: undefined };
    },
  );
  return fs;
}

beforeEach(() => vi.restoreAllMocks());

describe("store: readCollection (step_02 + refactor R04)", () => {
  it("returns ok with parsed meta when layout: collection-home is present", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: MyCollection\nstackOrder:\n  - \"Stack 01\"\n  - \"Stack 02\"\n---\n",
    });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBe("collection-home");
    expect(r.value.displayName).toBe("MyCollection");
    expect(r.value.stackOrder).toEqual(["Stack 01", "Stack 02"]);
  });

  it("EC-4 — returns ok with empty defaults when _folder.md is missing", async () => {
    withFs({});
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Defaults: displayName from folder basename; empty stackOrder.
    expect(r.value.displayName).toBe("A");
    expect(r.value.stackOrder).toEqual([]);
  });

  it("EC-6 — returns ok with empty defaults when frontmatter is malformed", async () => {
    // Opening "---" without a closing delimiter.
    withFs({ "/v/A/_folder.md": "---\nlayout: collection-home\nstackOrder:\n" });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stackOrder).toEqual([]);
  });

  // Refactor R04 — read-compat for the MVP-era `type: collection` marker.
  it("EC-7 — readCollection accepts legacy `type: collection` (no layout:) and returns layout: collection-home", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\ntype: collection\ndisplayName: Legacy\nstackOrder: []\n---\n",
    });
    const beforeContent = fs.get("/v/A/_folder.md");
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBe("collection-home");
    expect(r.value.displayName).toBe("Legacy");
    // EC-7 critical contract: NO WRITE happens on read.
    expect(fs.get("/v/A/_folder.md")).toBe(beforeContent);
  });

  it("EC-7 — readCollection: when both layout: and legacy type: are on disk, layout: wins", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ntype: collection\ndisplayName: Mixed\nstackOrder: []\n---\n",
    });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBe("collection-home");
    // The legacy `type` field is NOT surfaced on the read result.
    expect(r.value.type).toBeUndefined();
  });

  it("readCollection on a folder with neither marker returns meta.layout === undefined", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Plain\n---\n",
    });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBeUndefined();
  });
});

describe("store: writeCollectionMeta (step_02 + refactor R04)", () => {
  it("preserves unrelated keys (icon) and writes layout: collection-home — EC-23 / FR-1 (step_03: sort is now a folder-view-config key and is stripped on migration)", async () => {
    // step_03 update: `sort:` was previously assumed "unrelated" by this test,
    // but the Unified View Modal feature owns `sort:` as folder-view config.
    // The Collections writer strips folder-view-config keys on migration
    // (AD-4 MW-3). We replace `sort:` with a truly unrelated key
    // (`customField:`) so the test still proves non-folder-view-config keys
    // survive migration verbatim.
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nicon: book\ncustomField: untouched\n---\nbody\n",
    });
    const r = await writeCollectionMeta("/v/A", {
      displayName: "A",
      stackOrder: [],
      schemaVersion: 1,
    });
    expect(r.ok).toBe(true);
    const out = fs.get("/v/A/_folder.md")!;
    // Unrelated keys survive byte-for-byte (string contains check is enough —
    // the YAML helpers preserve exact line content for untouched keys).
    expect(out).toContain("icon: book");
    expect(out).toContain("customField: untouched");
    expect(out).toContain("layout: collection-home");
    expect(out).toContain("displayName: A");
    // Refactor R04: no `type: collection` is written.
    expect(out).not.toContain("type: collection");
  });

  it("creates _folder.md when absent (EC-6 fallback)", async () => {
    const fs = withFs({});
    const r = await writeCollectionMeta("/v/A", {
      displayName: "A",
      stackOrder: ["Stack 01"],
      schemaVersion: 1,
    });
    expect(r.ok).toBe(true);
    expect(fs.has("/v/A/_folder.md")).toBe(true);
    const out = fs.get("/v/A/_folder.md")!;
    expect(out).toContain("layout: collection-home");
    expect(out).toContain("stackOrder:");
    expect(out).toContain("- \"Stack 01\"");
    // FR-1: fresh writes do NOT emit the legacy `type:` marker.
    expect(out).not.toContain("type: collection");
  });

  // Refactor R04 — migration-on-write contract.
  it("EC-8 — writeCollectionMeta strips legacy `type: collection` in the same atomic write", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\ntype: collection\ndisplayName: Legacy\nstackOrder: []\n---\n",
    });
    const writeSpy = vi.spyOn(bridge, "writeFile");
    const r = await writeCollectionMeta("/v/A", { displayName: "Renamed" });
    expect(r.ok).toBe(true);
    const out = fs.get("/v/A/_folder.md")!;
    expect(out).toContain("layout: collection-home");
    expect(out).not.toContain("type: collection");
    expect(out).toContain("displayName: Renamed");
    // Exactly ONE writeFile call — migration is folded into the same atomic
    // temp-file-swap as the user's mutation.
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("EC-8 — appendStackToCollection on a legacy `type: collection` folder also strips the legacy marker", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\ntype: collection\ndisplayName: Legacy\nstackOrder: []\n---\n",
    });
    const r = await appendStackToCollection("/v/A", "Stack 01");
    expect(r.ok).toBe(true);
    const out = fs.get("/v/A/_folder.md")!;
    expect(out).not.toContain("type: collection");
    expect(out).toContain("- \"Stack 01\"");
  });
});

describe("store: writeStackMeta (refactor R04)", () => {
  it("FR-1 — writeStackMeta does NOT emit `type: stack` on a fresh write", async () => {
    const fs = withFs({});
    const r = await writeStackMeta("/v/A/Stack 01", {
      displayName: "Stack 01",
      icon: "notebook",
      order: [],
      references: [],
      schemaVersion: 1,
    });
    expect(r.ok).toBe(true);
    const out = fs.get("/v/A/Stack 01/_folder.md")!;
    expect(out).toContain("displayName: Stack 01");
    expect(out).toContain("icon: notebook");
    // The Stack marker is gone entirely — Stacks are identified by being
    // subfolders of a `layout: collection-home` folder.
    expect(out).not.toContain("type: stack");
  });

  it("EC-8 — reorderNote on a legacy `type: stack` Stack also strips the legacy marker", async () => {
    const fs = withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences: []\n---\n",
    });
    await reorderNote("/v/A/Stack 01", "B.md", "up");
    const out = fs.get("/v/A/Stack 01/_folder.md")!;
    expect(out).not.toContain("type: stack");
    // The user's mutation is also reflected.
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["B.md", "A.md"]);
  });
});

describe("store: readStack (step_02)", () => {
  it("EC-5 — returns defaults if _folder.md missing", async () => {
    withFs({});
    const r = await readStack("/v/A/Stack 01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.displayName).toBe("Stack 01");
    expect(r.value.icon).toBe("notebook");
    expect(r.value.order).toEqual([]);
    expect(r.value.references).toEqual([]);
  });

  it("parses order: and references: arrays", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences:\n  - \"Other/Stack 02/C.md\"\n---\n",
    });
    const r = await readStack("/v/A/Stack 01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.order).toEqual(["A.md", "B.md"]);
    expect(r.value.references).toEqual(["Other/Stack 02/C.md"]);
  });
});

describe("store: stackOrder mutators (step_02)", () => {
  it("FR-6 — appendStackToCollection appends to stackOrder atomically", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
    });
    const r = await appendStackToCollection("/v/A", "Stack 02");
    expect(r.ok).toBe(true);
    const reread = await readCollection("/v/A");
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.value.stackOrder).toEqual(["Stack 01", "Stack 02"]);
    // Sanity-check the on-disk text too.
    expect(fs.get("/v/A/_folder.md")).toContain("- \"Stack 02\"");
  });

  it("removeStackFromCollection drops the name and writes back", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n  - \"Stack 02\"\n---\n",
    });
    const r = await removeStackFromCollection("/v/A", "Stack 01");
    expect(r.ok).toBe(true);
    const reread = await readCollection("/v/A");
    if (!reread.ok) return;
    expect(reread.value.stackOrder).toEqual(["Stack 02"]);
  });

  it("Phase-1.5 — reorderStack up swaps with previous", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"S1\"\n  - \"S2\"\n  - \"S3\"\n---\n",
    });
    await reorderStack("/v/A", "S3", "up");
    const reread = await readCollection("/v/A");
    if (!reread.ok) return;
    expect(reread.value.stackOrder).toEqual(["S1", "S3", "S2"]);
  });

  it("Phase-1.5 — reorderStack { toIndex } moves to exact position", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"S1\"\n  - \"S2\"\n  - \"S3\"\n---\n",
    });
    await reorderStack("/v/A", "S1", { toIndex: 2 });
    const reread = await readCollection("/v/A");
    if (!reread.ok) return;
    expect(reread.value.stackOrder).toEqual(["S2", "S3", "S1"]);
  });
});

describe("store: order mutators (step_02)", () => {
  it("FR-9 — appendNoteToStack appends to order", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\nreferences: []\n---\n",
    });
    await appendNoteToStack("/v/A/Stack 01", "B.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["A.md", "B.md"]);
  });

  it("FR-12 — removeNoteFromStack removes by filename", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences: []\n---\n",
    });
    await removeNoteFromStack("/v/A/Stack 01", "A.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["B.md"]);
  });

  it("reorderNote up swaps with previous", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences: []\n---\n",
    });
    await reorderNote("/v/A/Stack 01", "B.md", "up");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["B.md", "A.md"]);
  });

  it("renameNoteInStack replaces old filename with new filename in order", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\n  - \"C.md\"\nreferences: []\n---\n",
    });
    await renameNoteInStack("/v/A/Stack 01", "B.md", "Renamed.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["A.md", "Renamed.md", "C.md"]);
  });

  it("renameNoteInStack is a no-op when old filename is absent from order", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\nreferences: []\n---\n",
    });
    await renameNoteInStack("/v/A/Stack 01", "NotPresent.md", "New.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["A.md"]);
  });

  it("renameNoteInStack preserves references and other meta", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: My Stack\nicon: notebook\norder:\n  - \"A.md\"\nreferences:\n  - \"Other/X.md\"\n---\n",
    });
    await renameNoteInStack("/v/A/Stack 01", "A.md", "Renamed.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.order).toEqual(["Renamed.md"]);
    expect(reread.value.references).toEqual(["Other/X.md"]);
    expect(reread.value.displayName).toBe("My Stack");
  });
});

describe("store: references mutators (step_02)", () => {
  it("FR-23 — appendReference appends vault-rel path to references", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    await appendReference("/v/A/Stack 01", "Other/Stack 02/C.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.references).toEqual(["Other/Stack 02/C.md"]);
  });

  it("FR-24 — removeReference removes only the named entry, not duplicates of other paths", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences:\n  - \"X.md\"\n  - \"Y.md\"\n  - \"Z.md\"\n---\n",
    });
    await removeReference("/v/A/Stack 01", "Y.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.references).toEqual(["X.md", "Z.md"]);
  });

  it("FR-25 — updateReferenceOnMove replaces old path with new path", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences:\n  - \"old/path.md\"\n  - \"unrelated.md\"\n---\n",
    });
    await updateReferenceOnMove("/v/A/Stack 01", "old/path.md", "new/path.md");
    const reread = await readStack("/v/A/Stack 01");
    if (!reread.ok) return;
    expect(reread.value.references).toEqual(["new/path.md", "unrelated.md"]);
  });
});

describe("store: write queue (step_02)", () => {
  it("EC-10 — concurrent writes to the same _folder.md serialise without corruption", async () => {
    // Pre-seed an empty Collection. Two appendStackToCollection calls fire in
    // parallel. The queue must serialise them so the final stackOrder contains
    // BOTH names (a naive read-modify-write would race and lose one).
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder: []\n---\n",
    });
    const [a, b] = await Promise.all([
      appendStackToCollection("/v/A", "Stack 01"),
      appendStackToCollection("/v/A", "Stack 02"),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const reread = await readCollection("/v/A");
    if (!reread.ok) return;
    // Order is FIFO of arrival; both must be present.
    expect(reread.value.stackOrder).toHaveLength(2);
    expect(reread.value.stackOrder).toContain("Stack 01");
    expect(reread.value.stackOrder).toContain("Stack 02");
  });

  it("concurrent writes to DIFFERENT files do not block each other (perf)", async () => {
    // Both files start empty; two writes fan out in parallel. The queue is
    // keyed by absolute path, so cross-file writes do not chain.
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder: []\n---\n",
      "/v/B/_folder.md":
        "---\ntype: collection\ndisplayName: B\nstackOrder: []\n---\n",
    });
    const [a, b] = await Promise.all([
      appendStackToCollection("/v/A", "X"),
      appendStackToCollection("/v/B", "Y"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const ra = await readCollection("/v/A");
    const rb = await readCollection("/v/B");
    if (!ra.ok || !rb.ok) return;
    expect(ra.value.stackOrder).toEqual(["X"]);
    expect(rb.value.stackOrder).toEqual(["Y"]);
  });
});

describe("store: schemaVersion guard (step_02)", () => {
  it("EC-13 — writer refuses when on-disk schemaVersion > known", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 99\ntype: collection\ndisplayName: A\nstackOrder: []\n---\n",
    });
    const r = await writeCollectionMeta("/v/A", { displayName: "B" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("schema-too-new");
  });
});
