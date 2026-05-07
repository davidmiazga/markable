/**
 * tests/lib/meta-manager.test.ts
 *
 * Unit tests for all pure functions in src/lib/meta-manager.ts.
 *
 * These tests require no Tauri process — all I/O is provided via mock callbacks
 * (dependency injection). The tests cover the full edge-case inventory from the
 * requirements document.
 */

import { describe, it, expect } from "vitest";
import {
  sanitiseVaultName,
  metaFolderPath,
  metaFilePath,
  legacyMetaFolderPath,
  parseMetaBulletList,
  parsePropertiesFile,
  buildMetaStore,
  emptyMetaStore,
  isMetaFolderEvent,
  getVocabularyForField,
  PROPERTIES_INITIAL_CONTENT,
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
    expect(sanitiseVaultName("Work: Notes/2024")).toBe("Work_ Notes_2024");
  });

  it("handles unicode names unchanged (EC-8)", () => {
    expect(sanitiseVaultName("日本語")).toBe("日本語");
  });
});

// ---------------------------------------------------------------------------
// metaFolderPath
// ---------------------------------------------------------------------------

describe("metaFolderPath", () => {
  it("returns VaultSettings folder under first rootPath", () => {
    expect(metaFolderPath(BASE_VAULT)).toBe("/Users/dave/Notes/VaultSettings");
  });

  it("uses first rootPath only for multi-root vaults", () => {
    const v = { ...BASE_VAULT, rootPaths: ["/first", "/second"] };
    expect(metaFolderPath(v)).toBe("/first/VaultSettings");
  });

  it("is the same for vaults with different names (folder is not vault-name-specific)", () => {
    const v = { ...BASE_VAULT, name: "Other Vault" };
    expect(metaFolderPath(v)).toBe("/Users/dave/Notes/VaultSettings");
  });
});

// ---------------------------------------------------------------------------
// metaFilePath
// ---------------------------------------------------------------------------

describe("metaFilePath", () => {
  it("returns the properties file path under VaultSettings", () => {
    expect(metaFilePath(BASE_VAULT)).toBe(
      "/Users/dave/Notes/VaultSettings/Work Notes_properties.md"
    );
  });

  it("sanitises unsafe vault name in file path (EC-18)", () => {
    const v = { ...BASE_VAULT, name: "Work: Notes" };
    expect(metaFilePath(v)).toBe(
      "/Users/dave/Notes/VaultSettings/Work_ Notes_properties.md"
    );
  });

  it("uses first rootPath only", () => {
    const v = { ...BASE_VAULT, rootPaths: ["/first", "/second"] };
    expect(metaFilePath(v)).toBe("/first/VaultSettings/Work Notes_properties.md");
  });
});

// ---------------------------------------------------------------------------
// legacyMetaFolderPath
// ---------------------------------------------------------------------------

describe("legacyMetaFolderPath", () => {
  it("returns the old {safe}_meta path for migration checks", () => {
    expect(legacyMetaFolderPath(BASE_VAULT)).toBe("/Users/dave/Notes/Work Notes_meta");
  });

  it("sanitises vault name", () => {
    const v = { ...BASE_VAULT, name: "Work: Notes" };
    expect(legacyMetaFolderPath(v)).toBe("/Users/dave/Notes/Work_ Notes_meta");
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
// parsePropertiesFile
// ---------------------------------------------------------------------------

describe("parsePropertiesFile", () => {
  it("parses Tags section into tags array", () => {
    const raw = "## Tags\n- alpha\n- beta\n";
    const result = parsePropertiesFile(raw);
    expect(result.tags).toEqual(["alpha", "beta"]);
    expect(result.fields).toEqual({});
  });

  it("parses non-Tags/Date sections into fields with lowercase keys", () => {
    const raw = "## Status\n- draft\n- complete\n## Source\n- article\n- book\n";
    const result = parsePropertiesFile(raw);
    expect(result.tags).toEqual([]);
    expect(result.fields["status"]).toEqual(["draft", "complete"]);
    expect(result.fields["source"]).toEqual(["article", "book"]);
  });

  it("extracts dateFormat from [x] line in Date section", () => {
    const raw = "## Date (format style)\n[x] MM/DD/YYYY\n[ ] MM/DD/YY\n";
    const result = parsePropertiesFile(raw);
    expect(result.dateFormat).toBe("MM/DD/YYYY");
  });

  it("returns undefined dateFormat when no [x] line in Date section", () => {
    const raw = "## Date\n[ ] MM/DD/YYYY\n";
    const result = parsePropertiesFile(raw);
    expect(result.dateFormat).toBeUndefined();
  });

  it("ignores bullet items in the Date section", () => {
    const raw = "## Date (format style)\n[x] MM/DD/YYYY\n- should-be-ignored\n";
    const result = parsePropertiesFile(raw);
    expect(result.fields["date"]).toBeUndefined();
  });

  it("handles indented section headings (as in sampleProperties.md)", () => {
    const raw = "# Title\n  ## Tags\n  - home\n  - family\n  ## Status\n  - draft\n";
    const result = parsePropertiesFile(raw);
    expect(result.tags).toEqual(["home", "family"]);
    expect(result.fields["status"]).toEqual(["draft"]);
  });

  it("parses PROPERTIES_INITIAL_CONTENT correctly", () => {
    const result = parsePropertiesFile(PROPERTIES_INITIAL_CONTENT);
    expect(result.tags).toContain("home");
    expect(result.tags).toContain("family");
    expect(result.fields["status"]).toContain("draft");
    expect(result.fields["source"]).toContain("article");
    expect(result.fields["priority"]).toEqual(["high", "medium", "low"]);
    expect(result.dateFormat).toBe("MM/DD/YYYY");
  });

  it("deduplicates values within a section", () => {
    const raw = "## Tags\n- alpha\n- beta\n- alpha\n";
    const result = parsePropertiesFile(raw);
    expect(result.tags).toEqual(["alpha", "beta"]);
  });

  it("handles mixed Tags and other sections", () => {
    const raw = "## Tags\n- work\n## Area\n- research\n- personal\n";
    const result = parsePropertiesFile(raw);
    expect(result.tags).toEqual(["work"]);
    expect(result.fields["area"]).toEqual(["research", "personal"]);
  });
});

// ---------------------------------------------------------------------------
// buildMetaStore
// ---------------------------------------------------------------------------

describe("buildMetaStore", () => {
  it("populates tags and fields from properties file when file exists", async () => {
    const readFn = async (_path: string) => ({
      ok: true as const,
      value: "## Tags\n- alpha\n- beta\n## Status\n- draft\n- complete\n",
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual(["alpha", "beta"]);
    expect(store.fields["status"]).toEqual(["draft", "complete"]);
    expect(store.vaultId).toBe("v1");
  });

  it("returns empty store when file does not exist and no io provided (EC-2)", async () => {
    const readFn = async (_path: string) => ({
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path: _path },
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual([]);
    expect(store.fields).toEqual({});
    expect(store.vaultId).toBe("v1");
  });

  it("returns empty tags when file exists but is empty (EC-3)", async () => {
    const readFn = async (_path: string) => ({ ok: true as const, value: "" });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual([]);
  });

  it("reads the correct properties file path", async () => {
    let capturedPath = "";
    const readFn = async (path: string) => {
      capturedPath = path;
      return { ok: false as const, error: { message: "ENOENT", command: "read_file", path } };
    };
    await buildMetaStore(BASE_VAULT, readFn);
    expect(capturedPath).toBe("/Users/dave/Notes/VaultSettings/Work Notes_properties.md");
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
      "/Users/dave/Notes/VaultSettings/Work_ Notes_properties.md"
    );
  });

  it("calls deleteDirectoryFn with legacy path for migration when io provided", async () => {
    let deletedPath = "";
    const io = {
      deleteDirectoryFn: async (path: string) => { deletedPath = path; },
    };
    const readFn = async (_path: string) => ({ ok: true as const, value: "## Tags\n- x\n" });
    await buildMetaStore(BASE_VAULT, readFn, io);
    expect(deletedPath).toBe("/Users/dave/Notes/Work Notes_meta");
  });

  it("auto-creates properties file with starter content when missing and io provided", async () => {
    let writtenPath = "";
    let writtenContent = "";
    let ensuredPath = "";
    const calls: string[] = [];

    const io = {
      deleteDirectoryFn: async (_path: string) => {},
      ensureDirectoryFn: async (path: string) => { ensuredPath = path; calls.push("ensure"); },
      writeFileFn: async (path: string, content: string) => {
        writtenPath = path;
        writtenContent = content;
        calls.push("write");
      },
    };

    let callCount = 0;
    const readFn = async (path: string) => {
      callCount++;
      if (callCount === 1) {
        // First read: file doesn't exist yet
        return { ok: false as const, error: { message: "ENOENT", command: "read_file", path } };
      }
      // Second read: file was just created
      return { ok: true as const, value: "## Tags\n- home\n" };
    };

    const store = await buildMetaStore(BASE_VAULT, readFn, io);
    expect(ensuredPath).toBe("/Users/dave/Notes/VaultSettings");
    expect(writtenPath).toBe("/Users/dave/Notes/VaultSettings/Work Notes_properties.md");
    expect(writtenContent).toContain("## Tags");
    expect(calls).toEqual(["ensure", "write"]);
    expect(store.tags).toEqual(["home"]);
  });

  it("parses dateFormat from properties file", async () => {
    const readFn = async (_path: string) => ({
      ok: true as const,
      value: "## Date (format style)\n[x] MM/DD/YYYY\n[ ] MM/DD/YY\n",
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.dateFormat).toBe("MM/DD/YYYY");
  });

  it("deduplicates entries from properties file (EC-4)", async () => {
    const readFn = async (_path: string) => ({
      ok: true as const,
      value: "## Tags\n- alpha\n- alpha\n- beta\n",
    });
    const store = await buildMetaStore(BASE_VAULT, readFn);
    expect(store.tags).toEqual(["alpha", "beta"]);
  });

  it("returns empty store for new vault name after rename (EC-6)", async () => {
    const oldVault: VaultEntry = { ...BASE_VAULT, id: "v-old", name: "OldVault" };
    const newVault: VaultEntry = { ...BASE_VAULT, id: "v-new", name: "NewVault" };

    const readFn = async (path: string) => {
      if (path.includes("OldVault_properties")) {
        return { ok: true as const, value: "## Tags\n- alpha\n- beta\n" };
      }
      return {
        ok: false as const,
        error: { message: "ENOENT", command: "read_file", path },
      };
    };

    const oldStore = await buildMetaStore(oldVault, readFn);
    expect(oldStore.tags).toEqual(["alpha", "beta"]);

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
    expect(store.dateFormat).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isMetaFolderEvent
// ---------------------------------------------------------------------------

describe("isMetaFolderEvent", () => {
  it("returns true for a file inside the VaultSettings folder", () => {
    expect(
      isMetaFolderEvent(
        "/Users/dave/Notes/VaultSettings/Work Notes_properties.md",
        BASE_VAULT
      )
    ).toBe(true);
  });

  it("returns true for the VaultSettings folder itself", () => {
    expect(
      isMetaFolderEvent("/Users/dave/Notes/VaultSettings", BASE_VAULT)
    ).toBe(true);
  });

  it("returns false for a regular vault file", () => {
    expect(isMetaFolderEvent("/Users/dave/Notes/my-note.md", BASE_VAULT)).toBe(false);
  });

  it("returns false for a file outside the vault root", () => {
    expect(
      isMetaFolderEvent(
        "/Users/other/VaultSettings/Work Notes_properties.md",
        BASE_VAULT
      )
    ).toBe(false);
  });

  it("returns true regardless of vault name (VaultSettings is fixed)", () => {
    const v = { ...BASE_VAULT, name: "Work: Notes" };
    expect(
      isMetaFolderEvent(
        "/Users/dave/Notes/VaultSettings/Work_ Notes_properties.md",
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
    fields: { author: ["Dave", "Alice"], status: ["draft", "complete"] },
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
    expect(getVocabularyForField(storeWithTags, "priority")).toBeNull();
  });

  it("returns null when field exists but is empty (FR-11)", () => {
    const store: MetaStore = { tags: [], fields: { author: [] }, vaultId: "v1" };
    expect(getVocabularyForField(store, "author")).toBeNull();
  });

  it("is case-insensitive for the field key", () => {
    expect(getVocabularyForField(storeWithTags, "Status")).toEqual(["draft", "complete"]);
    expect(getVocabularyForField(storeWithTags, "STATUS")).toEqual(["draft", "complete"]);
    expect(getVocabularyForField(storeWithTags, "Tags")).toEqual(["alpha", "beta"]);
  });
});
