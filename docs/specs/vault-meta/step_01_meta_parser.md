---
title: step_01 — Meta Parser, Vault Index Exclusion, Window Global
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Step 01 — Meta Parser, Vault Index Exclusion, Window Global

## Goal

Establish the data foundation for the entire Vault Meta System:

1. Create `src/lib/meta-manager.ts` — all pure functions for path construction, parsing, and meta store assembly.
2. Extend `src-tauri/src/commands/vault.rs` — add `vault_name: String` parameter to `build_vault_index` and exclude the `{name}_meta/` folder during the walk.
3. Update `src/lib/vault-manager.ts` — pass `vault.name` to the updated Rust command.
4. Update `src/main.ts` — import `meta-manager.ts`, call `initMeta()` on vault activation, register hot-reload handler, and expose `window.__MARKABLE_META__`.

After this step, IIFE plugins can read `window.__MARKABLE_META__` synchronously. No tag browser or chip warnings yet — those are steps 02 and 03.

---

## Files to Change

| File | Change type |
|------|-------------|
| `src/lib/meta-manager.ts` | **CREATE** |
| `src-tauri/src/commands/vault.rs` | **MODIFY** |
| `src/lib/vault-manager.ts` | **MODIFY** |
| `src/main.ts` | **MODIFY** |

---

## 1. Create `src/lib/meta-manager.ts`

This module is a pure ES module (not IIFE). It is imported by `main.ts` and by tests. It must never call `invoke()` directly — all I/O is passed in as function parameters (dependency injection) to keep the functions testable without mocking Tauri.

### 1.1 Full source

```typescript
/**
 * meta-manager.ts
 *
 * Pure functions for the Vault Meta System.
 *
 * Responsibilities:
 *  - Construct `{VaultName}_meta/` folder and file paths from a vault entry.
 *  - Parse a meta bullet-list Markdown file into a string array vocabulary.
 *  - Build a MetaStore from a vault entry using an injected readFile function.
 *  - Create an empty meta file (folder + file) on demand.
 *
 * All functions are pure or accept I/O as callbacks so they are testable
 * without a live Tauri process.
 *
 * Design decisions:
 *  - AD-1: TypeScript parsing avoids a new Rust command.
 *  - AD-3: MetaStore is replaced atomically on vault switch (callers must
 *    assign the return value; this module never mutates window globals).
 *  - AD-5: sanitiseVaultName() is the single canonical implementation.
 */

import type { VaultEntry } from "./vault-types";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The in-memory vocabulary store exposed as window.__MARKABLE_META__.
 *
 * `tags`    — entries from `{VaultName}_tags.md`; empty array when absent.
 * `fields`  — entries from other `{VaultName}_{fieldname}.md` files.
 * `vaultId` — id of the vault this data belongs to; null when no vault is active.
 */
export interface MetaStore {
  tags: string[];
  fields: Record<string, string[]>;
  vaultId: string | null;
}

/** FileResult discriminated union — mirrors bridge.ts pattern. */
type ReadResult = { ok: true; value: string } | { ok: false; error: unknown };

/**
 * Callback type for reading a file via the bridge.
 * Matches the signature of bridge.ts::readFile().
 */
export type ReadFileFn = (path: string) => Promise<ReadResult>;

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Replace characters invalid in macOS directory names with `_`.
 *
 * Affected characters: `/` (path separator), `:` (HFS+ reserved), null byte.
 * The result is used only for filesystem path construction; the vault display
 * name is unchanged.
 *
 * @param name - Raw VaultEntry.name value.
 * @returns Sanitised name safe for use as a directory component.
 */
export function sanitiseVaultName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/:\x00]/g, "_");
}

/**
 * Absolute path to the meta folder for a given vault.
 *
 * Uses `rootPaths[0]` as the base directory. Multi-root vaults always use
 * the first root for meta folder placement (Out of scope note in requirements).
 *
 * @param vault - The active VaultEntry.
 * @returns Absolute path string, e.g. `/Users/dave/Notes/Work Notes_meta`.
 */
export function metaFolderPath(vault: VaultEntry): string {
  const root = vault.rootPaths[0];
  const safe = sanitiseVaultName(vault.name);
  return `${root}/${safe}_meta`;
}

/**
 * Absolute path to a specific meta field file.
 *
 * @param vault     - The active VaultEntry.
 * @param fieldName - Lowercase field name (e.g. `"tags"`, `"author"`).
 * @returns Absolute path string, e.g. `/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md`.
 */
export function metaFilePath(vault: VaultEntry, fieldName: string): string {
  const safe = sanitiseVaultName(vault.name);
  return `${metaFolderPath(vault)}/${safe}_${fieldName}.md`;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse a meta bullet-list Markdown file into a deduplicated string array.
 *
 * Rules:
 *  - Lines are split on `\n` (CR stripped first).
 *  - Only lines whose trimmed form starts with `- ` are treated as entries.
 *  - The `- ` prefix is stripped; the remainder is trimmed.
 *  - Empty strings after trimming are discarded.
 *  - Duplicate values are removed (first occurrence wins) — EC-4.
 *  - The optional `# heading` line is ignored.
 *
 * @param raw - Raw file contents as returned by readFile().
 * @returns Deduplicated array of vocabulary entries.
 */
export function parseMetaBulletList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const value = trimmed.slice(2).trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

// ── Meta store builder ────────────────────────────────────────────────────────

/**
 * Build a MetaStore for the given vault by reading its meta files.
 *
 * Only the `tags` field file is read explicitly in v1. Other field files
 * (`{name}_{fieldname}.md`) are not scanned in this release (no listFiles
 * bridge function is available). `fields` will always be `{}` until a future
 * step adds the folder scan.
 *
 * Behaviour when the file does not exist:
 *  - `readFileFn` returns `{ ok: false }`.
 *  - `tags` is set to `[]`.
 *  - No warning is emitted — missing file is the expected initial state (EC-2).
 *
 * @param vault       - The vault to build a meta store for.
 * @param readFileFn  - Injected readFile function (bridge.ts::readFile).
 * @returns A MetaStore. Never throws.
 */
export async function buildMetaStore(
  vault: VaultEntry,
  readFileFn: ReadFileFn
): Promise<MetaStore> {
  const tagsPath = metaFilePath(vault, "tags");
  const result = await readFileFn(tagsPath);

  const tags = result.ok ? parseMetaBulletList(result.value) : [];

  return {
    tags,
    fields: {},
    vaultId: vault.id,
  };
}

// ── Null / no-vault store ─────────────────────────────────────────────────────

/**
 * Return an empty MetaStore for use when no vault is active (EC-1).
 */
export function emptyMetaStore(): MetaStore {
  return { tags: [], fields: {}, vaultId: null };
}

// ── Meta file creation ────────────────────────────────────────────────────────

/**
 * Initial content written to a freshly created tags meta file (FR-1).
 */
export const TAGS_META_INITIAL_CONTENT = "# Tags\n";

/**
 * Determine whether a VaultFileChangedEvent path belongs to the meta folder
 * of the given vault. Used by main.ts to decide when to reload the meta store.
 *
 * @param eventPath  - Absolute path from the VaultFileChangedEvent.
 * @param vault      - The currently active vault.
 * @returns True when eventPath is inside `{root}/{name}_meta/`.
 */
export function isMetaFolderEvent(eventPath: string, vault: VaultEntry): boolean {
  const folder = metaFolderPath(vault);
  // Normalise both paths to avoid trailing-slash mismatch.
  return eventPath.startsWith(folder + "/") || eventPath === folder;
}

// ── Vocabulary query helper ───────────────────────────────────────────────────

/**
 * Return the vocabulary for `fieldKey` from a MetaStore, or null when no
 * vocabulary is defined for that field.
 *
 * Null signals "no vocabulary configured" (do not warn).
 * An empty array signals "vocabulary exists but is empty" (also do not warn
 * per FR-11 — caller should treat null and empty the same: suppress warnings).
 *
 * For `fieldKey === "tags"`, returns `store.tags` when non-empty, else null.
 * For other keys, returns `store.fields[fieldKey]` when present and non-empty,
 * else null.
 *
 * @param store    - The current MetaStore.
 * @param fieldKey - YAML front-matter field name (e.g. "tags", "author").
 * @returns Vocabulary array or null.
 */
export function getVocabularyForField(
  store: MetaStore,
  fieldKey: string
): string[] | null {
  if (fieldKey === "tags") {
    return store.tags.length > 0 ? store.tags : null;
  }
  const vocab = store.fields[fieldKey];
  return vocab && vocab.length > 0 ? vocab : null;
}

// ── Window global type augmentation ──────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __MARKABLE_META__: MetaStore;
  }
}
```

---

## 2. Modify `src-tauri/src/commands/vault.rs`

### 2.1 Signature change for `build_vault_index`

Add `vault_name: String` as the fifth parameter (after `max_count`). This is a non-breaking addition: the only caller is `buildAndCacheIndex()` in `vault-manager.ts`, which is updated in section 3.

Current signature (line 601):
```rust
pub async fn build_vault_index(
    vault_id: String,
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    max_count: u32,
) -> Result<VaultIndexPayload, String>
```

New signature:
```rust
pub async fn build_vault_index(
    vault_id: String,
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    max_count: u32,
    vault_name: String,
) -> Result<VaultIndexPayload, String>
```

### 2.2 Add `sanitise_vault_name()` helper (private, above `build_vault_index`)

Place this function near `should_exclude` (around line 211):

```rust
/// Replace filesystem-unsafe characters in a vault name with `_`.
///
/// Matches the TypeScript `sanitiseVaultName()` in meta-manager.ts.
/// Affected: `/` (path separator), `:` (HFS+ reserved), null byte `\0`.
fn sanitise_vault_name(name: &str) -> String {
    name.chars()
        .map(|c| if matches!(c, '/' | ':' | '\0') { '_' } else { c })
        .collect()
}
```

### 2.3 Add `is_meta_folder_component()` helper (private, near `should_exclude`)

```rust
/// Return true if any vault-relative path component equals `{sanitised_name}_meta`.
///
/// Called inside `build_vault_index` walk loop to filter out the meta folder.
/// `meta_folder_component` is the pre-computed string `"{sanitised_name}_meta"`.
fn is_meta_folder_component(rel_path: &Path, meta_folder_component: &str) -> bool {
    rel_path.components().any(|c| {
        c.as_os_str().to_string_lossy().as_ref() == meta_folder_component
    })
}
```

### 2.4 Walk loop change inside `build_vault_index`

At the top of `build_vault_index`, compute the meta folder component string once:

```rust
let sanitised_name = sanitise_vault_name(&vault_name);
let meta_component = format!("{}_meta", sanitised_name);
```

Then, in the walk loop, immediately after the `should_exclude` check (and before the `!entry.file_type().is_file()` check), add:

```rust
// FR-4 / NFR-6: exclude all files inside the vault meta folder.
if is_meta_folder_component(rel, &meta_component) {
    continue;
}
```

The full modified walk loop section looks like:

```rust
let rel = path.strip_prefix(root_path).unwrap_or(path);
if should_exclude(rel, &exclude_patterns) {
    continue;
}
// Exclude meta folder files from the vault index (FR-4).
if is_meta_folder_component(rel, &meta_component) {
    continue;
}
if !entry.file_type().is_file() {
    continue;
}
```

The identical exclusion must also be applied to the `list_vault_files` walk if it uses the same loop (check line ~808 in vault.rs). Apply the same `is_meta_folder_component` guard there.

### 2.5 Rust unit tests to add (bottom of vault.rs test module)

Add inside the `#[cfg(test)]` module:

```rust
#[test]
fn sanitise_vault_name_replaces_colon() {
    assert_eq!(sanitise_vault_name("Work: Notes"), "Work_ Notes");
}

#[test]
fn sanitise_vault_name_replaces_slash() {
    assert_eq!(sanitise_vault_name("Notes/2024"), "Notes_2024");
}

#[test]
fn sanitise_vault_name_no_change_for_safe_name() {
    assert_eq!(sanitise_vault_name("Work Notes"), "Work Notes");
}

#[test]
fn is_meta_folder_component_detects_meta_dir() {
    let path = Path::new("Work Notes_meta/Work Notes_tags.md");
    assert!(is_meta_folder_component(path, "Work Notes_meta"));
}

#[test]
fn is_meta_folder_component_does_not_match_regular_dir() {
    let path = Path::new("notes/Work Notes_tags.md");
    assert!(!is_meta_folder_component(path, "Work Notes_meta"));
}
```

---

## 3. Modify `src/lib/vault-manager.ts`

### 3.1 Change in `buildAndCacheIndex()`

Current `invoke` call (line ~149):
```typescript
const payload = await invoke<{ ... }>("build_vault_index", {
  vaultId: vault.id,
  rootPaths: vault.rootPaths,
  excludePatterns: vault.excludePatterns,
  maxCount: vault.maxIndexSize,
});
```

Add `vaultName`:
```typescript
const payload = await invoke<{ ... }>("build_vault_index", {
  vaultId: vault.id,
  rootPaths: vault.rootPaths,
  excludePatterns: vault.excludePatterns,
  maxCount: vault.maxIndexSize,
  vaultName: vault.name,   // NEW — used to exclude {name}_meta/ from walk
});
```

No other changes to this file.

---

## 4. Modify `src/main.ts`

### 4.1 Import `meta-manager.ts`

Add near the top of the imports block (after the `vaultManager` import):

```typescript
import {
  buildMetaStore,
  emptyMetaStore,
  isMetaFolderEvent,
} from "./lib/meta-manager";
import type { MetaStore } from "./lib/meta-manager";
```

### 4.2 Add `initMeta()` helper function

Add this function before `initApp()`:

```typescript
/**
 * Load (or reload) the meta store for the active vault and expose it as
 * window.__MARKABLE_META__.
 *
 * Non-blocking: called fire-and-forget from vault activation paths.
 * On failure: sets an empty store (EC-1, EC-2).
 *
 * @param vault - The active VaultEntry, or null when no vault is active.
 */
async function initMeta(vault: Parameters<typeof buildMetaStore>[0] | null): Promise<void> {
  if (!vault) {
    (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = emptyMetaStore();
    return;
  }
  try {
    const store = await buildMetaStore(vault, readFile);
    (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = store;
  } catch (err) {
    console.warn("[initMeta] Failed to load meta store:", err);
    (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = emptyMetaStore();
  }
}
```

### 4.3 Set initial empty `window.__MARKABLE_META__` before plugins load

Add this line alongside the other `window.__MARKABLE_*` assignments (around line 925):

```typescript
(window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = emptyMetaStore();
```

This ensures the global exists and is non-null before any plugin IIFE evaluates.

### 4.4 Subscribe to vault changes for meta reload

After the `vaultManager.init()` call (around line 937), add:

```typescript
// Load meta vocabulary for initial vault (non-blocking — fire and forget).
initMeta(vaultManager.getActiveVault()).catch((err) =>
  console.warn("[init] initMeta failed (non-fatal):", err)
);

// Reload meta whenever the user switches vaults (EC-7).
vaultManager.onVaultChanged((vault) => {
  initMeta(vault).catch((err) =>
    console.warn("[onVaultChanged] initMeta failed:", err)
  );
});

// Hot-reload meta when a file inside the meta folder changes on disk (FR-12).
vaultManager.onIndexUpdated((event) => {
  const vault = vaultManager.getActiveVault();
  if (!vault) return;
  if (isMetaFolderEvent(event.path, vault)) {
    initMeta(vault).catch((err) =>
      console.warn("[onIndexUpdated] meta hot-reload failed:", err)
    );
  }
});
```

### 4.5 Import `readFile` from bridge

Confirm that `readFile` is already imported from `"./lib/bridge"` at the top of `main.ts`. The grep shows only `readResourceFile`, `openFileDialog`, etc. are imported. Add `readFile` to the existing bridge import:

Current bridge import:
```typescript
import {
  readResourceFile,
  openFileDialog,
  ...
} from "./lib/bridge";
```

Add `readFile` to this destructure. Do NOT import `readFile` as a second import statement — add it to the existing one.

---

## Acceptance Criteria

- [ ] `sanitiseVaultName("Work: Notes/2024")` returns `"Work_ Notes_2024"`.
- [ ] `parseMetaBulletList("# Tags\n- alpha\n- beta\n- alpha\n")` returns `["alpha", "beta"]` (deduplication, EC-4).
- [ ] `parseMetaBulletList("")` returns `[]` (EC-3).
- [ ] `buildMetaStore(vault, () => Promise.resolve({ ok: false }))` returns `{ tags: [], fields: {}, vaultId: vault.id }` (EC-2).
- [ ] Files inside `{name}_meta/` do NOT appear in `build_vault_index` results (NFR-6).
- [ ] Files outside `{name}_meta/` that match the vault name substring are NOT excluded.
- [ ] `window.__MARKABLE_META__` is set to `emptyMetaStore()` before any plugin loads.
- [ ] After `initMeta()` resolves for a vault with a tags meta file, `window.__MARKABLE_META__.tags` contains the parsed entries.
- [ ] After `initMeta()` resolves for a vault without a tags meta file, `window.__MARKABLE_META__.tags` is `[]`.
- [ ] When a file inside the meta folder changes on disk and triggers `onIndexUpdated`, `initMeta` is called and `window.__MARKABLE_META__` is refreshed.
- [ ] Vault switch sets `window.__MARKABLE_META__.vaultId` to the new vault's id.
- [ ] `cargo test` passes all new Rust tests.
- [ ] `npm run test:run` passes all new TypeScript tests.

---

## Test Requirements

See `step_04_tests.md` for the full test spec. Tests specific to this step:

- `tests/lib/meta-manager.test.ts` — covers `sanitiseVaultName`, `parseMetaBulletList`, `buildMetaStore`, `isMetaFolderEvent`, `getVocabularyForField`, `emptyMetaStore`.
- Rust tests in `src-tauri/src/commands/vault.rs` — `sanitise_vault_name_*` and `is_meta_folder_component_*` tests.
