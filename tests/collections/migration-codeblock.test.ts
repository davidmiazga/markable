/**
 * tests/collections/migration-codeblock.test.ts (step_03)
 *
 * Tests the Collections store's switch from frontmatter shape to
 * codeblock shape. Read paths must accept BOTH shapes (codeblock wins
 * when both present); write paths must emit codeblock shape with the
 * legacy markers (`type: collection`, frontmatter `layout:`,
 * frontmatter `displayName:` / `stackOrder:` etc.) stripped in the
 * same atomic write.
 *
 * EC mapping: EC-7 (read-compat), EC-20 (Collections legacy
 * `type: collection` migration), FR-50 / FR-60 / FR-63 / FR-81.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  readCollection,
  writeCollectionMeta,
  readStack,
  writeStackMeta,
  appendStackToCollection,
} from "../../src/plugins/file-browser/collections/store";

function withFs(initial: Record<string, string>): Map<string, string> {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) return { ok: true as const, value: fs.get(path)! };
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

describe("Collections — write shape is codeblock (step_03)", () => {
  it("writeCollectionMeta on a new file emits codeblock shape", async () => {
    const fs = withFs({});
    await writeCollectionMeta("/v/A", {
      displayName: "A",
      stackOrder: ["Stack 01"],
      schemaVersion: 1,
    });
    const out = fs.get("/v/A/_folder.md")!;
    expect(out).toContain("```select");
    expect(out).toContain("layout: collection-home");
    expect(out).toContain("displayName: A");
    expect(out).toContain("- \"Stack 01\"");
  });

  it("EC-20 — writeCollectionMeta strips legacy `type: collection` and writes codeblock in one atomic write", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: Old\nstackOrder:\n  - \"S\"\n---\n",
    });
    const writeSpy = vi.spyOn(bridge, "writeFile");
    await writeCollectionMeta("/v/A", { displayName: "Renamed" });
    const out = fs.get("/v/A/_folder.md")!;
    expect(out).not.toContain("type: collection");
    expect(out).toContain("```select");
    expect(out).toContain("layout: collection-home");
    expect(out).toContain("displayName: Renamed");
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("writeCollectionMeta on legacy frontmatter `layout: collection-home` strips frontmatter and writes codeblock", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: Old\nstackOrder:\n  - \"S\"\n---\n",
    });
    await writeCollectionMeta("/v/A", { displayName: "New" });
    const out = fs.get("/v/A/_folder.md")!;
    // The legacy frontmatter layout/displayName/stackOrder are stripped.
    // The codeblock carries the canonical shape.
    expect(out).toContain("```select");
    expect(out).toContain("layout: collection-home");
    expect(out).toContain("displayName: New");
    // The frontmatter layout: line is gone (the only occurrence is in the codeblock).
    const layoutLineCount = out.split("\n").filter(l => l === "layout: collection-home").length;
    expect(layoutLineCount).toBe(1);
  });

  it("writeStackMeta emits codeblock with references array", async () => {
    const fs = withFs({});
    await writeStackMeta("/v/A/S1", {
      displayName: "S1",
      icon: "notebook",
      order: [],
      references: ["a/b/c.md"],
      schemaVersion: 1,
    });
    const out = fs.get("/v/A/S1/_folder.md")!;
    expect(out).toContain("```select");
    expect(out).toContain("references:");
    expect(out).toContain("- \"a/b/c.md\"");
  });
});

describe("Collections — read precedence (step_03)", () => {
  it("readCollection — codeblock wins over frontmatter when both present", async () => {
    withFs({
      "/v/A/_folder.md": [
        "---",
        "layout: cards",        // legacy frontmatter (wrong layout)
        "displayName: OldName",
        "---",
        "",
        "```select",
        "layout: collection-home",
        "displayName: NewName",
        "```",
      ].join("\n"),
    });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBe("collection-home");
    expect(r.value.displayName).toBe("NewName");
  });

  it("readCollection — falls back to legacy frontmatter `layout: collection-home` when no codeblock", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: Legacy\nstackOrder: []\n---\n",
    });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBe("collection-home");
    expect(r.value.displayName).toBe("Legacy");
  });

  it("readCollection — falls back to legacy `type: collection` when no codeblock and no layout", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\ntype: collection\ndisplayName: Legacy\n---\n",
    });
    const r = await readCollection("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout).toBe("collection-home");
    expect(r.value.displayName).toBe("Legacy");
  });
});

describe("Collections — reference-index round-trip with codeblock shape (step_03)", () => {
  it("writeStackMeta then readStack round-trips references array via codeblock", async () => {
    withFs({});
    await writeStackMeta("/v/A/S1", {
      displayName: "S1",
      icon: "notebook",
      order: [],
      references: ["Other/Stack 02/C.md"],
      schemaVersion: 1,
    });
    const r = await readStack("/v/A/S1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.references).toEqual(["Other/Stack 02/C.md"]);
  });
});

describe("Collections — schema-too-new gate via codeblock (step_03)", () => {
  it("EC-13 carryover — refuses write when codeblock schemaVersion > known", async () => {
    withFs({
      "/v/A/_folder.md": [
        "```select",
        "schemaVersion: 99",
        "layout: collection-home",
        "displayName: Future",
        "```",
      ].join("\n"),
    });
    const r = await writeCollectionMeta("/v/A", { displayName: "Tampered" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("schema-too-new");
  });
});

describe("Collections — idempotent codeblock writes (step_03)", () => {
  it("two writes against an empty file both produce codeblock shape with the latest patch", async () => {
    const fs = withFs({});
    await writeCollectionMeta("/v/A", {
      displayName: "First",
      stackOrder: [],
      schemaVersion: 1,
    });
    const after1 = fs.get("/v/A/_folder.md")!;
    expect(after1).toContain("```select");
    expect(after1).toContain("displayName: First");

    await writeCollectionMeta("/v/A", { displayName: "Second" });
    const after2 = fs.get("/v/A/_folder.md")!;
    expect(after2).toContain("```select");
    expect(after2).toContain("displayName: Second");
    expect(after2).not.toContain("displayName: First");
    // Exactly one `select` codeblock — no duplication.
    const fenceCount = after2.split("\n").filter(l => l.trim().startsWith("```select")).length;
    expect(fenceCount).toBe(1);
  });

  it("appendStackToCollection also rewrites a legacy frontmatter folder as codeblock", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: Legacy\nstackOrder: []\n---\n",
    });
    await appendStackToCollection("/v/A", "Stack 01");
    const out = fs.get("/v/A/_folder.md")!;
    expect(out).toContain("```select");
    expect(out).not.toContain("type: collection");
    expect(out).toContain("- \"Stack 01\"");
  });
});
