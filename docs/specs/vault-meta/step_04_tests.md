---
title: step_04 — Full Test Specification
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Step 04 — Full Test Specification

## Goal

Provide complete test coverage for all three implementation steps. Each test suite is independently executable via the project test runner. Tests must not require a live Tauri process — all Rust commands and bridge calls are mocked.

Test command:
```bash
npm run test:run                                         # all frontend tests
cargo test                                               # all Rust tests
npm run test:run -- tests/lib/meta-manager.test.ts       # single suite
```

---

## Test File Map

| Test file | Covers |
|-----------|--------|
| `tests/lib/meta-manager.test.ts` | All pure functions in `src/lib/meta-manager.ts` |
| `tests/plugins/command-bar/tags-mode.test.ts` | `buildTagRows()` and tags mode data layer |
| `tests/plugins/yaml-pane/chip-warning.test.ts` | `getVocabularyForField()` + chip warning modifier |
| Rust tests in `src-tauri/src/commands/vault.rs` | `sanitise_vault_name()`, `is_meta_folder_component()`, meta exclusion in `build_vault_index` |

---

## 1. `tests/lib/meta-manager.test.ts`

### 1.1 `sanitiseVaultName`

```typescript
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

  it("replaces all unsafe characters in one pass", () => {
    // EC-18: "Work: Notes/2024" → "Work_ Notes_2024"
    expect(sanitiseVaultName("Work: Notes/2024")).toBe("Work_ Notes_2024");
  });

  it("handles unicode names unchanged", () => {
    // EC-8: unicode is safe for filesystem
    expect(sanitiseVaultName("日本語")).toBe("日本語");
  });
});
```

### 1.2 `metaFolderPath`

```typescript
describe("metaFolderPath", () => {
  const vault: VaultEntry = {
    id: "v1",
    name: "Work Notes",
    rootPaths: ["/Users/dave/Notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "",
    lastOpened: "",
  };

  it("returns correct folder path for a safe vault name", () => {
    expect(metaFolderPath(vault)).toBe("/Users/dave/Notes/Work Notes_meta");
  });

  it("sanitises unsafe vault name in folder path", () => {
    const v = { ...vault, name: "Work: Notes" };
    expect(metaFolderPath(v)).toBe("/Users/dave/Notes/Work_ Notes_meta");
  });

  it("uses first rootPath only", () => {
    const v = { ...vault, rootPaths: ["/first", "/second"] };
    expect(metaFolderPath(v)).toBe("/first/Work Notes_meta");
  });
});
```

### 1.3 `metaFilePath`

```typescript
describe("metaFilePath", () => {
  const vault: VaultEntry = {
    id: "v1",
    name: "Work Notes",
    rootPaths: ["/Users/dave/Notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "",
    lastOpened: "",
  };

  it("returns correct tags file path", () => {
    expect(metaFilePath(vault, "tags"))
      .toBe("/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md");
  });

  it("returns correct custom field file path", () => {
    expect(metaFilePath(vault, "author"))
      .toBe("/Users/dave/Notes/Work Notes_meta/Work Notes_author.md");
  });
});
```

### 1.4 `parseMetaBulletList`

```typescript
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

  it("deduplicates entries (EC-4 — first occurrence wins)", () => {
    const input = "- alpha\n- beta\n- alpha\n";
    expect(parseMetaBulletList(input)).toEqual(["alpha", "beta"]);
  });

  it("trims leading/trailing whitespace from each entry", () => {
    expect(parseMetaBulletList("- alpha  \n-  beta\n")).toEqual(["alpha", "beta"]);
  });

  it("discards lines that do not start with '- '", () => {
    expect(parseMetaBulletList("# heading\nnote\n* bullet\n- valid\n"))
      .toEqual(["valid"]);
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
```

### 1.5 `buildMetaStore`

```typescript
describe("buildMetaStore", () => {
  const vault: VaultEntry = {
    id: "v1",
    name: "Work Notes",
    rootPaths: ["/Users/dave/Notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "",
    lastOpened: "",
  };

  it("populates tags from meta file when file exists", async () => {
    const readFn = async (_path: string) => ({
      ok: true as const,
      value: "# Tags\n- alpha\n- beta\n",
    });
    const store = await buildMetaStore(vault, readFn);
    expect(store.tags).toEqual(["alpha", "beta"]);
    expect(store.vaultId).toBe("v1");
    expect(store.fields).toEqual({});
  });

  it("returns empty tags when file does not exist (EC-2)", async () => {
    const readFn = async (_path: string) => ({
      ok: false as const,
      error: "ENOENT",
    });
    const store = await buildMetaStore(vault, readFn);
    expect(store.tags).toEqual([]);
    expect(store.vaultId).toBe("v1");
  });

  it("returns empty tags when file exists but is empty (EC-3)", async () => {
    const readFn = async (_path: string) => ({ ok: true as const, value: "" });
    const store = await buildMetaStore(vault, readFn);
    expect(store.tags).toEqual([]);
  });

  it("reads the correct file path for the tags meta file", async () => {
    let capturedPath = "";
    const readFn = async (path: string) => {
      capturedPath = path;
      return { ok: false as const, error: "ENOENT" };
    };
    await buildMetaStore(vault, readFn);
    expect(capturedPath).toBe(
      "/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md"
    );
  });

  it("sanitises unsafe vault name in file path (EC-18)", async () => {
    const unsafeVault = { ...vault, name: "Work: Notes" };
    let capturedPath = "";
    const readFn = async (path: string) => {
      capturedPath = path;
      return { ok: false as const, error: "ENOENT" };
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
    const store = await buildMetaStore(vault, readFn);
    expect(store.tags).toEqual(["alpha", "beta"]);
  });
});
```

### 1.6 `emptyMetaStore`

```typescript
describe("emptyMetaStore", () => {
  it("returns a store with empty tags, fields, and null vaultId (EC-1)", () => {
    const store = emptyMetaStore();
    expect(store.tags).toEqual([]);
    expect(store.fields).toEqual({});
    expect(store.vaultId).toBeNull();
  });
});
```

### 1.7 `isMetaFolderEvent`

```typescript
describe("isMetaFolderEvent", () => {
  const vault: VaultEntry = {
    id: "v1",
    name: "Work Notes",
    rootPaths: ["/Users/dave/Notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "",
    lastOpened: "",
  };

  it("returns true for a file inside the meta folder", () => {
    expect(isMetaFolderEvent(
      "/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md",
      vault
    )).toBe(true);
  });

  it("returns false for a regular vault file", () => {
    expect(isMetaFolderEvent(
      "/Users/dave/Notes/my-note.md",
      vault
    )).toBe(false);
  });

  it("returns false for a file outside the vault root", () => {
    expect(isMetaFolderEvent(
      "/Users/other/Work Notes_meta/Work Notes_tags.md",
      vault
    )).toBe(false);
  });

  it("handles unsafe vault name correctly (EC-18)", () => {
    const v = { ...vault, name: "Work: Notes" };
    expect(isMetaFolderEvent(
      "/Users/dave/Notes/Work_ Notes_meta/Work_ Notes_tags.md",
      v
    )).toBe(true);
  });
});
```

### 1.8 `getVocabularyForField`

```typescript
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
```

---

## 2. `tests/plugins/command-bar/tags-mode.test.ts`

This suite tests `buildTagRows()`. Because `buildTagRows` reads window globals, the test must set up mock globals before calling it.

The function should be exported (or the test file should import the compiled plugin and stub the globals). The recommended approach: export `buildTagRows` from the plugin for testing purposes only, guarded by a comment: "exported for tests".

```typescript
import { buildTagRows } from "../../../src/plugins/command-bar/command-bar.plugin";

const VAULT_WITH_TAGS = {
  getActiveVault: () => ({ id: "v1", name: "Test Vault" }),
  getVaultIndex: () => ({
    vaultId: "v1",
    entries: [
      { path: "/a.md", name: "a", title: "Note A", tags: ["alpha", "beta"], outboundLinks: [], modified: 0, size: 0 },
      { path: "/b.md", name: "b", title: "Note B", tags: ["alpha", "gamma"], outboundLinks: [], modified: 0, size: 0 },
    ],
  }),
};

const META_WITH_TAGS = {
  tags: ["alpha", "beta"],
  fields: {},
  vaultId: "v1",
};

beforeEach(() => {
  (window as any).__MARKABLE_VAULT_MANAGER__ = VAULT_WITH_TAGS;
  (window as any).__MARKABLE_META__ = META_WITH_TAGS;
});

afterEach(() => {
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_META__;
});

describe("buildTagRows", () => {
  it("puts vocab tags in defined section and index-only tags in uncategorised", () => {
    const { defined, uncategorised } = buildTagRows("");
    expect(defined.map(r => r.tag)).toEqual(["alpha", "beta"]); // sorted
    expect(uncategorised.map(r => r.tag)).toEqual(["gamma"]);
  });

  it("calculates file counts correctly", () => {
    const { defined } = buildTagRows("");
    const alphaRow = defined.find(r => r.tag === "alpha")!;
    expect(alphaRow.files).toHaveLength(2);
  });

  it("applies case-insensitive substring filter to both sections", () => {
    const { defined, uncategorised } = buildTagRows("alp");
    expect(defined.map(r => r.tag)).toEqual(["alpha"]);
    expect(uncategorised).toHaveLength(0);
  });

  it("returns empty sections when filter matches nothing", () => {
    const { defined, uncategorised } = buildTagRows("zzz");
    expect(defined).toHaveLength(0);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-1: returns empty sections when no vault is open", () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = { getActiveVault: () => null, getVaultIndex: () => null };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined).toHaveLength(0);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-17: returns only defined tags (with 0 file counts) when index is null", () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "v1", name: "Test Vault" }),
      getVaultIndex: () => null,
    };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined.map(r => r.tag)).toEqual(["alpha", "beta"]);
    expect(defined.every(r => r.files.length === 0)).toBe(true);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-2: returns only uncategorised when meta has no tags", () => {
    (window as any).__MARKABLE_META__ = { tags: [], fields: {}, vaultId: "v1" };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined).toHaveLength(0);
    expect(uncategorised.map(r => r.tag).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("EC-15: both sections empty when no tags anywhere", () => {
    (window as any).__MARKABLE_META__ = { tags: [], fields: {}, vaultId: "v1" };
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "v1", name: "Test Vault" }),
      getVaultIndex: () => ({ vaultId: "v1", entries: [] }),
    };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined).toHaveLength(0);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-16: filter state does not persist between calls (stateless function)", () => {
    const first = buildTagRows("alp");
    const second = buildTagRows("");
    expect(first.defined).toHaveLength(1);
    expect(second.defined).toHaveLength(2); // back to full list
  });

  it("sorts defined tags alphabetically (case-insensitive)", () => {
    (window as any).__MARKABLE_META__ = {
      tags: ["Zebra", "apple", "Mango"],
      fields: {},
      vaultId: "v1",
    };
    const { defined } = buildTagRows("");
    expect(defined.map(r => r.tag)).toEqual(["apple", "Mango", "Zebra"]);
  });
});
```

---

## 3. `tests/plugins/yaml-pane/chip-warning.test.ts`

This suite tests `getVocabularyForField()` from `yaml-pane.plugin.ts`. Because the yaml-pane is an IIFE, the function needs to be either exported for tests or the logic tested via a wrapper. The recommended approach: extract `getVocabularyForField` as an exported function in the plugin (it has no side effects and is safe to export).

```typescript
import { getVocabularyForField } from "../../../src/plugins/yaml-pane/yaml-pane.plugin";

const FULL_META = {
  tags: ["alpha", "beta"],
  fields: { author: ["Dave", "Alice"] },
  vaultId: "v1",
};

const EMPTY_META = { tags: [], fields: {}, vaultId: null };

beforeEach(() => {
  (window as any).__MARKABLE_META__ = FULL_META;
});

afterEach(() => {
  delete (window as any).__MARKABLE_META__;
});

describe("getVocabularyForField", () => {
  it("returns tags array when tags non-empty", () => {
    expect(getVocabularyForField("tags")).toEqual(["alpha", "beta"]);
  });

  it("returns null when tags is empty (FR-11 suppression)", () => {
    (window as any).__MARKABLE_META__ = EMPTY_META;
    expect(getVocabularyForField("tags")).toBeNull();
  });

  it("returns null when window.__MARKABLE_META__ is undefined", () => {
    delete (window as any).__MARKABLE_META__;
    expect(getVocabularyForField("tags")).toBeNull();
  });

  it("returns field vocab for non-tags field (FR-10)", () => {
    expect(getVocabularyForField("author")).toEqual(["Dave", "Alice"]);
  });

  it("returns null when field is absent (EC-12)", () => {
    expect(getVocabularyForField("status")).toBeNull();
  });

  it("returns null when field vocab is empty (FR-11)", () => {
    (window as any).__MARKABLE_META__ = { ...FULL_META, fields: { author: [] } };
    expect(getVocabularyForField("author")).toBeNull();
  });
});

describe("buildChipElement — warning modifier", () => {
  // These tests require DOM. Use jsdom (already configured via vitest).

  it("adds warning class when value not in non-empty vocabulary", () => {
    // We need to be able to call buildChipElement from the test.
    // If not exported, refactor to export for tests.
    const chip = buildChipElement("unknown-tag", ["unknown-tag"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(true);
    expect(chip.title).toContain('"unknown-tag" is not in the tags vocabulary');
  });

  it("does NOT add warning class when value is in vocabulary", () => {
    const chip = buildChipElement("alpha", ["alpha"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
    expect(chip.title).toBe("");
  });

  it("does NOT add warning class when vocabulary is empty (FR-11)", () => {
    (window as any).__MARKABLE_META__ = EMPTY_META;
    const chip = buildChipElement("any-value", ["any-value"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });

  it("does NOT add warning class when no meta global set (EC-1)", () => {
    delete (window as any).__MARKABLE_META__;
    const chip = buildChipElement("any-value", ["any-value"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });

  it("comparison is case-sensitive (EC-8)", () => {
    // Meta defines "Productivity" but chip value is "productivity"
    (window as any).__MARKABLE_META__ = {
      tags: ["Productivity"],
      fields: {},
      vaultId: "v1",
    };
    const chip = buildChipElement("productivity", ["productivity"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(true);
  });

  it("handles 'yes' string correctly — no YAML boolean coercion (EC-9)", () => {
    (window as any).__MARKABLE_META__ = {
      tags: ["yes"],
      fields: {},
      vaultId: "v1",
    };
    const chip = buildChipElement("yes", ["yes"], "tags");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });

  it("applies warning for non-tags field via fields map (FR-10)", () => {
    const chip = buildChipElement("Bob", ["Bob"], "author");
    // "Bob" not in ["Dave", "Alice"]
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(true);
  });

  it("EC-12: field with no meta vocabulary never warns", () => {
    const chip = buildChipElement("anything", ["anything"], "status");
    expect(chip.classList.contains("yaml-pane-chip--warning")).toBe(false);
  });
});
```

---

## 4. Rust Tests (in `src-tauri/src/commands/vault.rs`)

Add to the `#[cfg(test)]` module:

```rust
// ── Meta system tests ─────────────────────────────────────────────────────────

#[test]
fn sanitise_vault_name_replaces_colon() {
    assert_eq!(sanitise_vault_name("Work: Notes"), "Work_ Notes");
}

#[test]
fn sanitise_vault_name_replaces_slash() {
    assert_eq!(sanitise_vault_name("Notes/2024"), "Notes_2024");
}

#[test]
fn sanitise_vault_name_replaces_null_byte() {
    assert_eq!(sanitise_vault_name("Note\x00s"), "Note_s");
}

#[test]
fn sanitise_vault_name_no_change_for_safe_name() {
    assert_eq!(sanitise_vault_name("Work Notes"), "Work Notes");
}

#[test]
fn sanitise_vault_name_handles_unicode() {
    // EC-18: unicode characters are not replaced
    assert_eq!(sanitise_vault_name("日本語"), "日本語");
}

#[test]
fn sanitise_vault_name_replaces_multiple_unsafe_chars() {
    // EC-18: "Work: Notes/2024" → "Work_ Notes_2024"
    assert_eq!(sanitise_vault_name("Work: Notes/2024"), "Work_ Notes_2024");
}

#[test]
fn is_meta_folder_component_detects_meta_dir() {
    let path = Path::new("Work Notes_meta/Work Notes_tags.md");
    assert!(is_meta_folder_component(path, "Work Notes_meta"));
}

#[test]
fn is_meta_folder_component_detects_meta_dir_nested() {
    // File nested two levels inside the meta folder.
    let path = Path::new("Work Notes_meta/subdir/file.md");
    assert!(is_meta_folder_component(path, "Work Notes_meta"));
}

#[test]
fn is_meta_folder_component_does_not_match_regular_dir() {
    let path = Path::new("notes/Work Notes_tags.md");
    assert!(!is_meta_folder_component(path, "Work Notes_meta"));
}

#[test]
fn is_meta_folder_component_does_not_match_partial_name() {
    // A folder named "Work Notes_meta_old" must NOT match.
    let path = Path::new("Work Notes_meta_old/file.md");
    assert!(!is_meta_folder_component(path, "Work Notes_meta"));
}

#[test]
fn is_meta_folder_component_does_not_match_parent_dir_with_similar_name() {
    // EC-11: a non-meta file whose path contains the meta folder name as a substring
    // of a different component should not be excluded.
    let path = Path::new("notes/Work Notes_meta_backup/file.md");
    assert!(!is_meta_folder_component(path, "Work Notes_meta"));
}

// ── Integration test: build_vault_index excludes meta folder ──────────────────
//
// This test creates a temp directory, writes two .md files (one inside the meta
// folder, one outside), calls build_vault_index, and asserts that only the
// outside file appears in the index.
//
// Uses tokio::test (async) because build_vault_index is async.
#[tokio::test]
async fn build_vault_index_excludes_meta_folder_files() {
    use std::fs;
    use tempfile::TempDir;

    let dir = TempDir::new().unwrap();
    let root = dir.path().to_str().unwrap().to_string();

    // Regular note — should be indexed.
    let note_path = dir.path().join("my-note.md");
    fs::write(&note_path, "# My Note\n").unwrap();

    // Meta folder file — must NOT be indexed.
    let meta_dir = dir.path().join("Test Vault_meta");
    fs::create_dir(&meta_dir).unwrap();
    let meta_file = meta_dir.join("Test Vault_tags.md");
    fs::write(&meta_file, "# Tags\n- alpha\n").unwrap();

    let result = build_vault_index(
        "vault-1".to_string(),
        vec![root],
        vec![],
        100,
        "Test Vault".to_string(),  // vault_name
    ).await.unwrap();

    // Only my-note.md should appear.
    assert_eq!(result.entries.len(), 1, "meta folder files must be excluded");
    assert!(result.entries[0].path.ends_with("my-note.md"));
}

#[tokio::test]
async fn build_vault_index_does_not_exclude_similarly_named_dirs() {
    use std::fs;
    use tempfile::TempDir;

    let dir = TempDir::new().unwrap();
    let root = dir.path().to_str().unwrap().to_string();

    // File in a dir that has a similar but non-exact name.
    let similar_dir = dir.path().join("Test Vault_meta_backup");
    fs::create_dir(&similar_dir).unwrap();
    let file = similar_dir.join("note.md");
    fs::write(&file, "# Note\n").unwrap();

    let result = build_vault_index(
        "vault-1".to_string(),
        vec![root],
        vec![],
        100,
        "Test Vault".to_string(),
    ).await.unwrap();

    // The file in "Test Vault_meta_backup" must be indexed (it's not the exact meta dir).
    assert_eq!(result.entries.len(), 1);
}
```

---

## Edge Case Coverage Matrix

| Edge case | Test location | Test name |
|-----------|--------------|-----------|
| EC-1 (no vault) | tags-mode.test.ts, chip-warning.test.ts | "EC-1: returns empty sections...", "does NOT add warning when no meta global" |
| EC-2 (no meta file) | meta-manager.test.ts | "returns empty tags when file does not exist" |
| EC-3 (empty meta file) | meta-manager.test.ts | "returns empty tags when file exists but is empty", "returns empty array for heading-only content" |
| EC-4 (duplicate entries) | meta-manager.test.ts | "deduplicates entries" |
| EC-5 (tag in file not in meta) | tags-mode.test.ts | "puts vocab tags in defined section and index-only tags in uncategorised" |
| EC-6 (vault rename) | Covered by EC-2 pattern — initMeta reads new vault name, finds nothing | meta-manager.test.ts "sanitises unsafe vault name" |
| EC-7 (vault switch) | meta-manager.test.ts | "returns store with correct vaultId" |
| EC-8 (special char tags) | meta-manager.test.ts | "round-trips tags with special characters" |
| EC-9 (YAML boolean strings) | chip-warning.test.ts, meta-manager.test.ts | "handles 'yes' tag without coercion" |
| EC-10 (large meta file) | meta-manager.test.ts | "handles large file with many entries" |
| EC-11 (non-field files in meta folder) | Out of scope for v1 field scanning — not tested |
| EC-12 (field not in doc) | chip-warning.test.ts | "EC-12: field with no meta vocabulary never warns" |
| EC-14 (write failure) | Manual test — mocking Tauri invoke in IIFE is impractical in unit tests |
| EC-15 (no tags anywhere) | tags-mode.test.ts | "EC-15: both sections empty when no tags anywhere" |
| EC-16 (filter clears on re-open) | tags-mode.test.ts | "EC-16: filter state does not persist between calls" |
| EC-17 (index not yet built) | tags-mode.test.ts | "EC-17: returns only defined tags when index is null" |
| EC-18 (unsafe vault name in path) | meta-manager.test.ts, vault.rs | "sanitise_vault_name_replaces_multiple_unsafe_chars", "sanitises unsafe vault name in file path" |
| EC-19 (⌘5 with no vault) | Manual test |
| EC-20 (concurrent write) | Not unit-testable — atomic write on Rust side; covered by atomic temp-file-swap pattern |

---

## Regression Guard

After implementing all three steps, run the existing window size invariant test to confirm no regression:

```bash
npm run test:run -- tests/settings/window-defaults.test.ts
```

This test must still pass after all changes to `main.ts` and `vault-manager.ts`.
