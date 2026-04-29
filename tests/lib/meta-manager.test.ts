/**
 * tests/lib/meta-manager.test.ts
 *
 * Unit tests for all pure functions in src/lib/meta-manager.ts.
 *
 * These tests require no Tauri process — all I/O is provided via mock callbacks
 * (dependency injection). The tests cover the full edge-case inventory from the
 * requirements document (EC-1 through EC-18 where applicable to pure functions).
 */

import { describe, it, expect } from "vitest";
import {
  sanitiseVaultName,
  metaFolderPath,
  metaFilePath,
  parseMetaBulletList,
  buildMetaStore,
  emptyMetaStore,
  isMetaFolderEvent,
  getVocabularyForField,
} from "../../src/lib/meta-manager";
import type { VaultEntry } from "../../src/lib/vault-types";
import type { MetaStore } from "../../src/lib/meta-manager";

// ---------------------------------------------------------------------------
// Test fixture: a safe, reusable VaultEntry
// ---------------------------------------------------------------------------

const BASE_VAULT: VaultEntry = {
  id: "v1",
  name: "Work Notes",
  rootPaths: ["/Users/dave/Notes"],
  excludePatterns: [],
  maxIndexSize: 500,
  created: "",
  lastOpened: "",
};

// ---------------------------------------------------------------------------
// sanitiseVaultName
// ---------------------------------------------------------------------------

describe("sanitiseVaultName", () => {
  it("replaces colon with underscore", () => {
    expect(sanitiseVaultName("Work: Notes")).toBe("Work_ Notes");
  });

  it("replaces slash with underscore", () => {
    expect(sanitiseVaultName("Notes/2024")).toBe("Notes_2024");
  });

  it("replaces null byte with underscore", () => {
    expect(sanitiseVaultName("Note\x00s")).toBe("Note_s");
  });

  it("does not change safe names", () => {
    expect(sanitiseVaultName("Work Notes")).toBe("Work Notes");
  });

  it("replaces all unsafe characters in one pass (EC-18)", () => {
    // "Work: Notes/2024" → "Work_ Notes_2024"
    expect(sanitiseVaultName("Work: Notes/2024")).toBe("Work_ Notes_2024");
  });

  it("handles unicode names unchanged (EC-8)", () => {
    // Unicode characters are valid filesystem characters
    expect(sanitiseVaultName("日本語")).toBe("日本語");
  });
});

// ---------------------------------------------------------------------------
// metaFolderPath
// ---------------------------------------------------------------------------

describe("metaFolderPath", () => {
  it("returns correct folder path for a safe vault name", () => {
    expect(metaFolderPath(BASE_VAULT)).toBe("/Users/dave/Notes/Work Notes_meta");
  });

  it("sanitises unsafe vault name in folder path", () => {
    const v = { ...BASE_VAULT, name: "Work: Notes" };
    expect(metaFolderPath(v)).toBe("/Users/dave/Notes/Work_ Notes_meta");
  });

  it("uses first rootPath only", () => {
    const v = { ...BASE_VAULT, rootPaths: ["/first", "/second"] };
    expect(metaFolderPath(v)).toBe("/first/Work Notes_meta");
  });
});

// ---------------------------------------------------------------------------
// metaFilePath
// ---------------------------------------------------------------------------

describe("metaFilePath", () => {
  it("returns correct tags file path", () => {
    expect(metaFilePath(BASE_VAULT, "tags")).toBe(
      "/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md"
    );
  });

  it("returns correct custom field file path", () => {
    expect(metaFilePath(BASE_VAULT, "author")).toBe(
      "/Users/dave/Notes/Work Notes_meta/Work Notes_author.md"
    );
  });
});

// ---------------------------------------------------------------------------
// parseMetaBulletList
// ---------------------------------------------------------------------------

describe("parseMetaBulletList", () => {
  it("parses standard bullet list", () => {
    const input = "# Tags\n- productivity\n- work\n- personal\n";
    expect(parseMetaBulletList(input)).toEqual(["productivity", "work", "personal"]);
  });

  it("returns empty array for empty string (EC-3)", () => {
    expect(parseMetaBulletList("")).toEqual([]);
  });

  it("returns empty array for heading-only content (EC-3)", () => {
    expect(parseMetaBulletList("# Tags\n")).toEqual([]);
  });

  it("deduplicates entries — first occurrence wins (EC-4)", () => {
    const input = "- alpha\n- beta\n- alpha\n";
    expect(parseMetaBulletList(input)).toEqual(["alpha", "beta"]);
  });

  it("trims leading/trailing whitespace from each entry", () => {
    expect(parseMetaBulletList("- alpha  \n-  beta\n")).toEqual(["alpha", "beta"]);
  });

  it("discards lines that do not start with '- '", () => {
    expect(parseMetaBulletList("# heading\nnote\n* bullet\n- valid\n")).toEqual(["valid"]);
  });

  it("discards empty entries after trim", () => {
    expect(parseMetaBulletList("- \n- alpha\n")).toEqual(["alpha"]);
  });

  it("handles Windows line endings (\\r\\n)", () => {
    expect(parseMetaBulletList("- alpha\r\n- beta\r\n")).toEqual(["alpha", "beta"]);
  });

  it("round-trips tags with special characters (EC-8)", () => {
    const input = "- project management\n- c++\n- 日本語\n";
    expect(parseMetaBulletList(input)).toEqual(["project management", "c++", "日本語"]);
  });

  it("handles 'yes' tag without coercion (EC-9)", () => {
    expect(parseMetaBulletList("- yes\n- true\n")).toEqual(["yes", "true"]);
  });

  it("handles large file with many entries efficiently (EC-10 — no cap enforced)", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `- tag-${i}`).join("\n");
    const result = parseMetaBulletList(lines);
    expect(result).toHaveLength(500);
    expect(result[0]).toBe("tag-0");
    expect(result[499]).toBe("tag-499");
  });
});

// ---------------------------------------------------------------------------
// buildMetaStore
// ---------------------------------------------------------------------------

describe("buildMetaStore", () => {
  it("populates tags from meta file when file exists", async () => {
    const readFn = async (_path: string) => ({
      ok: true as const,
      value: "# Tags\n- alpha\n- beta\n",
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual(["alpha", "beta"]);
    expect(store.vaultId).toBe("v1");
    expect(store.fields).toEqual({});
  });

  it("returns empty tags when file does not exist (EC-2)", async () => {
    const readFn = async (_path: string) => ({
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path: _path },
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual([]);
    expect(store.vaultId).toBe("v1");
  });

  it("returns empty tags when file exists but is empty (EC-3)", async () => {
    const readFn = async (_path: string) => ({ ok: true as const, value: "" });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual([]);
  });

  it("reads the correct file path for the tags meta file", async () => {
    let capturedPath = "";
    const readFn = async (path: string) => {
      capturedPath = path;
      return { ok: false as const, error: { message: "ENOENT", command: "read_file", path } };
    };
    await buildMetaStore(BASE_VAULT, readFn);
    expect(capturedPath).toBe("/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md");
  });

  it("sanitises unsafe vault name in file path (EC-18)", async () => {
    const unsafeVault = { ...BASE_VAULT, name: "Work: Notes" };
    let capturedPath = "";
    const readFn = async (path: string) => {
      capturedPath = path;
      return { ok: false as const, error: { message: "ENOENT", command: "read_file", path } };
    };
    await buildMetaStore(unsafeVault, readFn);
    expect(capturedPath).toBe(
      "/Users/dave/Notes/Work_ Notes_meta/Work_ Notes_tags.md"
    );
  });

  it("deduplicates entries from meta file (EC-4)", async () => {
    const readFn = async (_path: string) => ({
      ok: true as const,
      value: "- alpha\n- alpha\n- beta\n",
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual(["alpha", "beta"]);
  });

  /**
   * EC-6: vault rename produces an empty meta store until the user also renames
   * the meta folder on disk. The first call with "OldVault" returns vocabulary;
   * the second call with "NewVault" looks for a non-existent file path and
   * correctly returns an empty store.
   *
   * This validates the accepted limitation documented in H-2: stale-check is
   * handled by replacing the entire MetaStore on vault switch, not by comparing
   * vaultId fields. When the vault is renamed, callers must call buildMetaStore
   * again with the new vault entry; the empty result signals that the meta folder
   * has not yet been renamed.
   */
  it("returns empty store for new vault name after rename (EC-6)", async () => {
    const oldVault: VaultEntry = { ...BASE_VAULT, id: "v-old", name: "OldVault" };
    const newVault: VaultEntry = { ...BASE_VAULT, id: "v-new", name: "NewVault" };

    // Simulate: OldVault has a meta file; NewVault's meta file does not exist yet.
    const readFn = async (path: string) => {
      if (path.includes("OldVault_meta")) {
        return { ok: true as const, value: "# Tags\n- alpha\n- beta\n" };
      }
      // NewVault meta file not found — simulates the post-rename state before
      // the user renames the meta folder on disk.
      return {
        ok: false as const,
        error: { message: "ENOENT", command: "read_file", path },
      };
    };

    // First build: OldVault has vocabulary.
    const oldStore = await buildMetaStore(oldVault, readFn);
    expect(oldStore.tags).toEqual(["alpha", "beta"]);

    // Second build: NewVault has no vocabulary (meta folder not yet renamed).
    const newStore = await buildMetaStore(newVault, readFn);
    expect(newStore.tags).toEqual([]);
    expect(newStore.vaultId).toBe("v-new");
  });
});

// ---------------------------------------------------------------------------
// emptyMetaStore
// ---------------------------------------------------------------------------

describe("emptyMetaStore", () => {
  it("returns a store with empty tags, fields, and null vaultId (EC-1)", () => {
    const store = emptyMetaStore();
    expect(store.tags).toEqual([]);
    expect(store.fields).toEqual({});
    expect(store.vaultId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isMetaFolderEvent
// ---------------------------------------------------------------------------

describe("isMetaFolderEvent", () => {
  it("returns true for a file inside the meta folder", () => {
    expect(
      isMetaFolderEvent(
        "/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md",
        BASE_VAULT
      )
    ).toBe(true);
  });

  it("returns false for a regular vault file", () => {
    expect(isMetaFolderEvent("/Users/dave/Notes/my-note.md", BASE_VAULT)).toBe(false);
  });

  it("returns false for a file outside the vault root", () => {
    expect(
      isMetaFolderEvent(
        "/Users/other/Work Notes_meta/Work Notes_tags.md",
        BASE_VAULT
      )
    ).toBe(false);
  });

  it("handles unsafe vault name correctly (EC-18)", () => {
    const v = { ...BASE_VAULT, name: "Work: Notes" };
    expect(
      isMetaFolderEvent(
        "/Users/dave/Notes/Work_ Notes_meta/Work_ Notes_tags.md",
        v
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getVocabularyForField
// ---------------------------------------------------------------------------

describe("getVocabularyForField", () => {
  const storeWithTags: MetaStore = {
    tags: ["alpha", "beta"],
    fields: { author: ["Dave", "Alice"] },
    vaultId: "v1",
  };
  const emptyStore: MetaStore = { tags: [], fields: {}, vaultId: null };

  it("returns tags array when tags is non-empty", () => {
    expect(getVocabularyForField(storeWithTags, "tags")).toEqual(["alpha", "beta"]);
  });

  it("returns null when tags is empty (FR-11)", () => {
    expect(getVocabularyForField(emptyStore, "tags")).toBeNull();
  });

  it("returns field vocabulary when non-empty (FR-10)", () => {
    expect(getVocabularyForField(storeWithTags, "author")).toEqual(["Dave", "Alice"]);
  });

  it("returns null when field is absent (EC-12)", () => {
    expect(getVocabularyForField(storeWithTags, "status")).toBeNull();
  });

  it("returns null when field exists but is empty (FR-11)", () => {
    const store: MetaStore = { tags: [], fields: { author: [] }, vaultId: "v1" };
    expect(getVocabularyForField(store, "author")).toBeNull();
  });
});
