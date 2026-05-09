/**
 * smart-folders.settings.test.ts
 *
 * Unit tests for the Smart Folders settings layer (step_01).
 *
 * Tests cover:
 *   - sanitizeDef: per-entry validation (EC-08, NFR-06)
 *   - sanitizeAll: top-level and per-vault validation (EC-08)
 *   - generateSmartFolderId: uniqueness and prefix contract (AD-3)
 *   - loadSmartFolders: missing-field and corruption recovery (EC-02, EC-08)
 *   - saveSmartFolders: spread-and-write pattern preserves sibling keys
 *
 * All tests are pure TypeScript — no DOM mocking required.
 */

import { describe, it, expect, vi } from "vitest";
import {
  sanitizeDef,
  sanitizeAll,
  generateSmartFolderId,
  loadSmartFolders,
  saveSmartFolders,
} from "../../../src/plugins/file-browser/smart-folders/settings";
import type { SmartFolderDef } from "../../../src/plugins/file-browser/smart-folders/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A well-formed SmartFolderDef with a single tag rule. */
function makeTagDef(overrides: Partial<SmartFolderDef> = {}): SmartFolderDef {
  return {
    id: "sf-test-id",
    name: "My Tags",
    rules: [{ type: "tag", operator: "is", value: "research" }],
    ...overrides,
  };
}

/** Build a minimal mock API. Accepts optional settings to return from loadSettings. */
function makeMockApi(savedSettings: Record<string, unknown> | null = null) {
  return {
    loadSettings: vi.fn().mockResolvedValue(savedSettings),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
}

// ── sanitizeDef ───────────────────────────────────────────────────────────────

describe("sanitizeDef", () => {
  it("accepts a well-formed tag-rule def", () => {
    const def = makeTagDef();
    const result = sanitizeDef(def);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("sf-test-id");
    expect(result!.name).toBe("My Tags");
    expect(result!.rules).toHaveLength(1);
  });

  it("drops unknown rule.type but preserves def when other rules are valid", () => {
    const raw = {
      id: "sf-1",
      name: "Mixed",
      rules: [
        { type: "tag", operator: "is", value: "alpha" },
        { type: "unknown-type", operator: "is", value: "x" },
      ],
    };
    const result = sanitizeDef(raw);
    expect(result).not.toBeNull();
    // Only the valid rule survives
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0].type).toBe("tag");
  });

  it("returns null when no rules survive pruning", () => {
    const raw = {
      id: "sf-1",
      name: "No Valid Rules",
      rules: [
        { type: "bad-type", operator: "is", value: "x" },
      ],
    };
    expect(sanitizeDef(raw)).toBeNull();
  });

  it("returns null when name is empty after trim", () => {
    const raw = {
      id: "sf-1",
      name: "   ",
      rules: [{ type: "tag", operator: "is", value: "research" }],
    };
    expect(sanitizeDef(raw)).toBeNull();
  });

  it("accepts tag operator 'is' and rejects unknown operator 'matches'", () => {
    const goodDef = {
      id: "sf-1",
      name: "Tag test",
      rules: [{ type: "tag", operator: "is", value: "test" }],
    };
    expect(sanitizeDef(goodDef)).not.toBeNull();

    const badDef = {
      id: "sf-2",
      name: "Tag test bad",
      rules: [{ type: "tag", operator: "matches", value: "test" }],
    };
    // Rule dropped → def has 0 rules → returns null
    expect(sanitizeDef(badDef)).toBeNull();
  });

  it("accepts links operator 'outbound >= N' with numeric value", () => {
    const def = {
      id: "sf-1",
      name: "Has links",
      rules: [{ type: "links", operator: "outbound >= N", value: 5 }],
    };
    const result = sanitizeDef(def);
    expect(result).not.toBeNull();
    expect(result!.rules[0].operator).toBe("outbound >= N");
  });

  it("drops 'in last N days' rule when value is NaN", () => {
    const raw = {
      id: "sf-1",
      name: "Modified test",
      rules: [{ type: "modified", operator: "in last N days", value: NaN }],
    };
    expect(sanitizeDef(raw)).toBeNull();
  });

  it("drops 'in last N days' rule when value is negative", () => {
    const raw = {
      id: "sf-1",
      name: "Modified test",
      rules: [{ type: "modified", operator: "in last N days", value: -7 }],
    };
    expect(sanitizeDef(raw)).toBeNull();
  });

  it("drops 'before' rule when date is invalid (2026-13-99)", () => {
    const raw = {
      id: "sf-1",
      name: "Date test",
      rules: [{ type: "modified", operator: "before", value: "2026-13-99" }],
    };
    expect(sanitizeDef(raw)).toBeNull();
  });

  it("drops 'outbound >= N' rule when value is not a positive integer", () => {
    const raw = {
      id: "sf-1",
      name: "Links test",
      rules: [{ type: "links", operator: "outbound >= N", value: "not-a-number" }],
    };
    expect(sanitizeDef(raw)).toBeNull();
  });

  it("accepts a well-formed path rule", () => {
    const def = {
      id: "sf-1",
      name: "Path test",
      rules: [{ type: "path", operator: "contains", value: "drafts" }],
    };
    expect(sanitizeDef(def)).not.toBeNull();
  });

  it("accepts a well-formed extension rule", () => {
    const def = {
      id: "sf-1",
      name: "Ext test",
      rules: [{ type: "extension", operator: "is", value: ".pdf" }],
    };
    expect(sanitizeDef(def)).not.toBeNull();
  });

  it("accepts a well-formed title rule", () => {
    const def = {
      id: "sf-1",
      name: "Title test",
      rules: [{ type: "title", operator: "contains", value: "meeting" }],
    };
    expect(sanitizeDef(def)).not.toBeNull();
  });

  it("returns null for null input", () => {
    expect(sanitizeDef(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(sanitizeDef("string")).toBeNull();
    expect(sanitizeDef(42)).toBeNull();
  });

  it("returns null when rules field is not an array", () => {
    const raw = { id: "sf-1", name: "Test", rules: "not-an-array" };
    expect(sanitizeDef(raw)).toBeNull();
  });
});

// ── sanitizeAll ───────────────────────────────────────────────────────────────

describe("sanitizeAll", () => {
  it("returns {} when input is an array (malformed top-level)", () => {
    expect(sanitizeAll([])).toEqual({});
  });

  it("returns {} when input is null", () => {
    expect(sanitizeAll(null)).toEqual({});
  });

  it("returns {} when input is a primitive", () => {
    expect(sanitizeAll(42)).toEqual({});
    expect(sanitizeAll("bad")).toEqual({});
  });

  it("converts object-instead-of-array per-vault value to [] and preserves siblings", () => {
    const raw = {
      vault1: [makeTagDef({ id: "sf-1", name: "V1 Folder" })],
      vault2: { not: "an array" }, // malformed per-vault
    };
    const result = sanitizeAll(raw);
    expect(result["vault1"]).toHaveLength(1);
    expect(result["vault2"]).toEqual([]);
  });

  it("sanitizes each entry in per-vault array and drops corrupted entries", () => {
    const raw = {
      vault1: [
        makeTagDef({ id: "sf-1", name: "Good" }),
        { id: "sf-2", name: "", rules: [] }, // empty name → dropped
      ],
    };
    const result = sanitizeAll(raw);
    expect(result["vault1"]).toHaveLength(1);
    expect(result["vault1"][0].name).toBe("Good");
  });

  it("preserves an empty array when vault has no valid defs", () => {
    const raw = {
      vault1: [{ id: "bad", name: "", rules: [] }],
    };
    const result = sanitizeAll(raw);
    expect(result["vault1"]).toEqual([]);
  });
});

// ── generateSmartFolderId ─────────────────────────────────────────────────────

describe("generateSmartFolderId", () => {
  it("returns a string prefixed with 'sf-'", () => {
    const id = generateSmartFolderId();
    expect(id.startsWith("sf-")).toBe(true);
  });

  it("returns unique values across 1000 iterations", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSmartFolderId());
    }
    expect(ids.size).toBe(1000);
  });
});

// ── loadSmartFolders ──────────────────────────────────────────────────────────

describe("loadSmartFolders", () => {
  it("returns [] when settings field is missing (EC-02)", async () => {
    const api = makeMockApi(null);
    const result = await loadSmartFolders(api as any, "vault1");
    expect(result).toEqual([]);
  });

  it("returns [] when smartFolders key is absent from settings", async () => {
    const api = makeMockApi({ expandedPaths: {}, pinnedPaths: {} });
    const result = await loadSmartFolders(api as any, "vault1");
    expect(result).toEqual([]);
  });

  it("returns [] when vault has no entry in smartFolders", async () => {
    const api = makeMockApi({ smartFolders: { "other-vault": [] } });
    const result = await loadSmartFolders(api as any, "vault1");
    expect(result).toEqual([]);
  });

  it("prunes corrupted entry and returns clean array (EC-08)", async () => {
    const goodDef = makeTagDef({ id: "sf-good", name: "Good" });
    const badDef = { id: "bad", name: "", rules: [] }; // empty name → pruned
    const api = makeMockApi({ smartFolders: { vault1: [goodDef, badDef] } });
    const result = await loadSmartFolders(api as any, "vault1");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Good");
  });

  it("does not throw on malformed top-level smartFolders", async () => {
    const api = makeMockApi({ smartFolders: "not-an-object" });
    const result = await loadSmartFolders(api as any, "vault1");
    expect(result).toEqual([]);
  });
});

// ── saveSmartFolders ──────────────────────────────────────────────────────────

describe("saveSmartFolders", () => {
  it("preserves expandedPaths and pinnedPaths when saving (regression guard)", async () => {
    const existingSettings = {
      expandedPaths: { vault1: ["/notes/work"] },
      pinnedPaths: { vault1: ["/notes/important.md"] },
    };
    const api = makeMockApi(existingSettings);
    const defs = [makeTagDef({ id: "sf-1", name: "Research" })];

    await saveSmartFolders(api as any, "vault1", defs);

    expect(api.saveSettings).toHaveBeenCalledOnce();
    const savedData = api.saveSettings.mock.calls[0][0] as any;
    // expandedPaths and pinnedPaths must survive the save
    expect(savedData.expandedPaths).toEqual({ vault1: ["/notes/work"] });
    expect(savedData.pinnedPaths).toEqual({ vault1: ["/notes/important.md"] });
    expect(savedData.smartFolders["vault1"]).toHaveLength(1);
    expect(savedData.smartFolders["vault1"][0].name).toBe("Research");
  });

  it("creates smartFolders key from scratch when not previously saved", async () => {
    const api = makeMockApi({ expandedPaths: {} });
    const defs = [makeTagDef({ id: "sf-1", name: "All Notes" })];

    await saveSmartFolders(api as any, "vault2", defs);

    const savedData = api.saveSettings.mock.calls[0][0] as any;
    expect(savedData.smartFolders["vault2"]).toHaveLength(1);
  });

  it("does not overwrite other vault's smartFolders when saving for vault1", async () => {
    const existingSettings = {
      expandedPaths: {},
      smartFolders: {
        "vault2": [makeTagDef({ id: "sf-other", name: "Other Vault" })],
      },
    };
    const api = makeMockApi(existingSettings);
    const defs = [makeTagDef({ id: "sf-1", name: "My Folder" })];

    await saveSmartFolders(api as any, "vault1", defs);

    const savedData = api.saveSettings.mock.calls[0][0] as any;
    // vault2's smart folders must be preserved
    expect(savedData.smartFolders["vault2"]).toHaveLength(1);
    expect(savedData.smartFolders["vault2"][0].name).toBe("Other Vault");
  });
});
