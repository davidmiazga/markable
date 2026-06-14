/**
 * tests/collections/reference-index.test.ts — step_03
 *
 * Asserts the reverse-index used by reference-integrity:
 *   - rebuild() — scans the vault index for `_folder.md` entries and populates
 *     a Map<canonicalRel, Set<owningStackFolderMdPath>>.
 *   - lookup() — O(1) returns the list of owning Stacks for a canonical path.
 *   - onCanonicalRenamed / onCanonicalDeleted — propagate the change to every
 *     affected `_folder.md` and update the map in lockstep.
 *
 * The store layer's `readStack` and `updateReferenceOnMove`/`removeReference`
 * are mocked so the test runs without touching the real bridge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as store from "../../src/plugins/file-browser/collections/store";
import { createReferenceIndex } from "../../src/plugins/file-browser/collections/reference-index";
import type { VaultIndex } from "../../src/lib/vault-types";

/**
 * Build a minimal VaultIndex stub with the requested `_folder.md` entries.
 * The reference-index only reads `entries[].path` and looks for the
 * `/_folder.md` suffix, plus the `directories?` field for the parent dirs,
 * so the test fixture can be deliberately sparse.
 */
function vaultIndexWith(folderMdPaths: string[]): VaultIndex {
  return {
    vaultId: "test",
    builtAt: 0,
    entries: [],
    totalFilesFound: 0,
    skippedCount: 0,
    capped: false,
    nonMdFiles: folderMdPaths.map((p) => ({ path: p, name: "_folder.md" })),
    directories: folderMdPaths.map((p) => p.replace(/\/_folder\.md$/, "")),
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("reference-index (step_03)", () => {
  it("FR-21 — rebuild populates lookups for every references: entry", async () => {
    vi.spyOn(store, "readStack").mockImplementation(async (folderPath: string) => {
      if (folderPath === "/v/A/Stack 01") {
        return {
          ok: true,
          value: {
            schemaVersion: 1,
            type: "stack",
            displayName: "Stack 01",
            icon: "notebook",
            order: [],
            references: ["Projects/Stack 02/X.md"],
          },
        };
      }
      return {
        ok: true,
        value: {
          schemaVersion: 1,
          type: "stack",
          displayName: "Stack",
          icon: "notebook",
          order: [],
          references: [],
        },
      };
    });
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith(["/v/A/Stack 01/_folder.md"]));
    expect(idx.lookup("Projects/Stack 02/X.md")).toEqual(["/v/A/Stack 01/_folder.md"]);
  });

  it("rebuild handles vaults with zero Stacks (size 0)", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: [],
      },
    });
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith([]));
    expect(idx.size()).toBe(0);
  });

  it("EC-16 — rebuild keeps broken pointers in the index so removeReference can find them", async () => {
    // The target file does not exist in the vault index — but the references:
    // entry is still present in a Stack's _folder.md. The index records the
    // owning Stack so the renderer can issue "Remove reference" later.
    vi.spyOn(store, "readStack").mockImplementation(async () => ({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["broken/path.md"],
      },
    }));
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith(["/v/A/Stack 01/_folder.md"]));
    expect(idx.lookup("broken/path.md")).toEqual(["/v/A/Stack 01/_folder.md"]);
  });

  it("lookup returns [] (not undefined) for an unknown canonical path", async () => {
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith([]));
    expect(idx.lookup("does/not/exist.md")).toEqual([]);
  });

  it("FR-25 — onCanonicalRenamed updates every affected references: array", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["old/path.md"],
      },
    });
    const updateSpy = vi
      .spyOn(store, "updateReferenceOnMove")
      .mockResolvedValue({ ok: true, value: undefined });
    const idx = createReferenceIndex();
    await idx.rebuild(
      vaultIndexWith(["/v/A/S1/_folder.md", "/v/A/S2/_folder.md", "/v/A/S3/_folder.md"]),
    );
    await idx.onCanonicalRenamed("old/path.md", "new/path.md");
    expect(updateSpy).toHaveBeenCalledTimes(3);
    // Each call points at the Stack folder (path without _folder.md suffix).
    const calls = updateSpy.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining(["/v/A/S1", "/v/A/S2", "/v/A/S3"]),
    );
  });

  it("FR-25 — onCanonicalRenamed updates the in-memory map in lockstep", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["old/path.md"],
      },
    });
    vi.spyOn(store, "updateReferenceOnMove").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith(["/v/A/S1/_folder.md", "/v/A/S2/_folder.md"]));
    await idx.onCanonicalRenamed("old/path.md", "new/path.md");
    expect(idx.lookup("old/path.md")).toEqual([]);
    expect(idx.lookup("new/path.md").length).toBe(2);
  });

  it("FR-26 — onCanonicalDeleted removes the entry from every owning Stack", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["doomed.md"],
      },
    });
    const removeSpy = vi
      .spyOn(store, "removeReference")
      .mockResolvedValue({ ok: true, value: undefined });
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith(["/v/A/S1/_folder.md", "/v/A/S2/_folder.md"]));
    await idx.onCanonicalDeleted("doomed.md");
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it("FR-26 — onCanonicalDeleted clears the map entry", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["doomed.md"],
      },
    });
    vi.spyOn(store, "removeReference").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const idx = createReferenceIndex();
    await idx.rebuild(vaultIndexWith(["/v/A/S1/_folder.md"]));
    await idx.onCanonicalDeleted("doomed.md");
    expect(idx.lookup("doomed.md")).toEqual([]);
  });

  it("EC-7 robustness — rebuild is idempotent: second call yields identical state", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["X.md", "Y.md"],
      },
    });
    const idx = createReferenceIndex();
    const vi1 = vaultIndexWith(["/v/A/S1/_folder.md"]);
    await idx.rebuild(vi1);
    const sizeAfterFirst = idx.size();
    const lookupX = [...idx.lookup("X.md")];
    await idx.rebuild(vi1);
    expect(idx.size()).toBe(sizeAfterFirst);
    expect(idx.lookup("X.md")).toEqual(lookupX);
  });

  it("EC-10 robustness — concurrent rebuilds do not double-index", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["X.md"],
      },
    });
    const idx = createReferenceIndex();
    const vi1 = vaultIndexWith(["/v/A/S1/_folder.md"]);
    await Promise.all([idx.rebuild(vi1), idx.rebuild(vi1)]);
    // X.md should map to exactly ONE owning Stack, not two duplicates.
    expect(idx.lookup("X.md")).toEqual(["/v/A/S1/_folder.md"]);
  });
});
