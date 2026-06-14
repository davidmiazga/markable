/**
 * tests/collections/commands.test.ts — step_04 + refactor R01
 *
 * Asserts the SURVIVING top-level user-facing actions on Collections. The
 * MVP-era `makeCollection` / `unmakeCollection` lifecycle commands were
 * deleted in step_R01 of the refactor (Collections is now opted into via
 * the layout picker, not a bespoke gesture). The remaining commands:
 *
 *   - newStack — auto-name + atomic write (FR-6, EC-3).
 *   - createNotecardInDefaultStack — EC-12 auto-Stack creation.
 *   - createNoteInStack — FR-11 + Untitled-name uniqueness.
 *   - addReference — FR-23 + EC-17 folder-vs-file refusal.
 *
 * The bridge file-system and store are mocked through an in-memory map; the
 * vault-manager is stubbed where the commands consult it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import * as store from "../../src/plugins/file-browser/collections/store";
import * as vaultManager from "../../src/lib/vault-manager";
import {
  newStack,
  createNotecardInDefaultStack,
  createNoteInStack,
  addReference,
} from "../../src/plugins/file-browser/collections/commands";
import type { VaultEntry, VaultIndex } from "../../src/lib/vault-types";

/**
 * Stub the bridge with an in-memory FS map. Mirrors the helper in store.test.ts.
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
  vi.spyOn(bridge, "ensureDirectory").mockImplementation(async (_path) => {
    // No-op in tests — the fs map is conjured up by writes.
  });
  return fs;
}

function withVault(rootPath: string, mdPaths: string[] = []) {
  const vault: VaultEntry = {
    id: "test-vault",
    name: "Test",
    rootPaths: [rootPath],
    created: "",
    lastOpened: "",
    excludePatterns: [],
    maxIndexSize: 500,
  };
  const index: VaultIndex = {
    vaultId: "test-vault",
    builtAt: 0,
    entries: mdPaths.map((p) => ({
      path: p,
      name: p.split("/").pop()!.replace(/\.md$/, ""),
      modified: 0,
      size: 0,
      title: "",
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: mdPaths.length,
    skippedCount: 0,
    capped: false,
    directories: [],
  };
  vi.spyOn(vaultManager, "getActiveVault").mockReturnValue(vault);
  vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue(index);
}

beforeEach(() => vi.restoreAllMocks());

describe("commands: newStack (step_04)", () => {
  it("FR-6 + C-6 — writes Stack 01 with notebook icon when collection is empty", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVault("/v");
    const r = await newStack("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stackName).toBe("Stack 01");
    expect(r.value.stackPath).toBe("/v/A/Stack 01");
    const stackMd = fs.get("/v/A/Stack 01/_folder.md")!;
    expect(stackMd).toContain("icon: notebook");
    // Parent stackOrder is updated atomically.
    const collMd = fs.get("/v/A/_folder.md")!;
    expect(collMd).toContain("- \"Stack 01\"");
  });

  it("EC-3 — increments to Stack 02 when Stack 01 exists", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
    });
    withVault("/v");
    const r = await newStack("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stackName).toBe("Stack 02");
  });

  it("EC-3 — skips gaps and picks max+1", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n  - \"Stack 03\"\n---\n",
    });
    withVault("/v");
    const r = await newStack("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stackName).toBe("Stack 04");
  });
});

describe("commands: createNotecardInDefaultStack (step_04)", () => {
  it("EC-12 — auto-creates Stack 01 when none exists", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVault("/v");
    const r = await createNotecardInDefaultStack("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stackPath).toBe("/v/A/Stack 01");
    expect(r.value.notePath).toBe("/v/A/Stack 01/Untitled.md");
    expect(fs.has("/v/A/Stack 01/Untitled.md")).toBe(true);
  });
});

describe("commands: createNoteInStack (step_04)", () => {
  it("FR-11 — writes empty Untitled.md and appends to order", async () => {
    const fs = withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault("/v");
    const r = await createNoteInStack("/v/A/Stack 01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.notePath).toBe("/v/A/Stack 01/Untitled.md");
    expect(fs.get("/v/A/Stack 01/Untitled.md")).toBe("");
    const stackMd = fs.get("/v/A/Stack 01/_folder.md")!;
    expect(stackMd).toContain("- \"Untitled.md\"");
  });

  it("picks Untitled 2.md when Untitled.md exists", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"Untitled.md\"\nreferences: []\n---\n",
      "/v/A/Stack 01/Untitled.md": "",
    });
    withVault("/v", ["/v/A/Stack 01/Untitled.md"]);
    const r = await createNoteInStack("/v/A/Stack 01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.notePath).toBe("/v/A/Stack 01/Untitled 2.md");
  });
});

describe("commands: addReference (step_04)", () => {
  it("FR-23 — appends vault-rel canonical path to target Stack", async () => {
    const fs = withFs({
      "/v/A/Stack 02/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 02\nicon: notebook\norder: []\nreferences: []\n---\n",
      "/v/A/Stack 01/Big Idea.md": "# Idea\n",
    });
    withVault("/v", ["/v/A/Stack 01/Big Idea.md"]);
    const r = await addReference("/v/A/Stack 01/Big Idea.md", "/v/A/Stack 02");
    expect(r.ok).toBe(true);
    const out = fs.get("/v/A/Stack 02/_folder.md")!;
    expect(out).toContain("- \"A/Stack 01/Big Idea.md\"");
  });

  it("EC-17 — refuses if canonicalPath is a folder (not in vault index as a note)", async () => {
    withFs({
      "/v/A/Stack 02/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 02\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    // The path "/v/A/SomeFolder" is NOT in the vault index .md entries; the
    // command's existence check must refuse it.
    withVault("/v", []);
    const r = await addReference("/v/A/SomeFolder", "/v/A/Stack 02");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("not-a-note");
  });

  it("ignores duplicate adds (idempotent)", async () => {
    withFs({
      "/v/A/Stack 02/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 02\nicon: notebook\norder: []\nreferences:\n  - \"A/Stack 01/X.md\"\n---\n",
      "/v/A/Stack 01/X.md": "",
    });
    withVault("/v", ["/v/A/Stack 01/X.md"]);
    const r = await addReference("/v/A/Stack 01/X.md", "/v/A/Stack 02");
    expect(r.ok).toBe(true);
    const reread = await store.readStack("/v/A/Stack 02");
    if (!reread.ok) return;
    expect(reread.value.references).toEqual(["A/Stack 01/X.md"]);
  });
});
