---
title: "PKM Step 01 — Vault Data Model, Rust Commands, and Manage Vaults UI"
last-updated: "2026-04-24"
review-cadence-days: 14
status: active
---

# Step 01 — Vault Data Model, Rust Commands, and Manage Vaults UI

## Goal

Implement the complete vault infrastructure with no user-facing file tree or graph: vault CRUD, settings schema extension, lazy index build with disk cache, staleness detection, index capping, and a minimal Manage Vaults settings panel.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/lib/vault-types.ts` | All shared TypeScript interfaces for vaults and indexes |
| `src/lib/vault-manager.ts` | In-memory vault state singleton, event bus, generation counter |
| `src/lib/index-parser.ts` | Pure functions: front matter parse, wiki-link extract, staleness check |
| `src/plugins/file-browser/manage-vaults-ui.ts` | Manage Vaults DOM panel (rendered into Settings panel) |
| `src/plugins/file-browser/manage-vaults.css` | CSS for Manage Vaults panel |
| `src-tauri/src/commands/vault.rs` | All vault-related Rust commands |
| `tests/vault/vault-index.test.ts` | Frontend tests: vault-manager, index-parser, schema validation |
| `tests/vault/index-parser.test.ts` | Pure function tests for index-parser.ts |

---

## Files to Modify

| File | Change |
|---|---|
| `src/lib/settings.ts` | Add `VaultEntry`, `VaultIndex`, `activeVaultId` fields to `MarkableSettings` interface. Add `vaults?: VaultEntry[]` and `activeVaultId?: string | null` as optional fields. No default values needed (absent = no vaults). |
| `src-tauri/src/commands/mod.rs` | Add `pub mod vault;` and re-export all vault commands. |
| `src-tauri/src/lib.rs` (or `main.rs`) | Add new vault commands to `tauri::generate_handler![]`. |
| `src/main.ts` | Import `vault-manager` and call `vaultManager.init()` after settings load. Register Command Bar entries: "Switch Vault", "New Vault", "Manage Vaults", "Reload Vault Index". |

---

## TypeScript Interfaces (`src/lib/vault-types.ts`)

```typescript
// Full interface definitions — the developer must implement these exactly.

export interface VaultEntry {
  id: string;                      // UUID v4, immutable
  name: string;                    // Display name, 1-100 chars
  rootPaths: string[];             // Absolute paths, at least one
  created: string;                 // ISO 8601 datetime
  lastOpened: string;              // ISO 8601 datetime, updated on activate
  excludePatterns: string[];       // Glob patterns, may be empty
  maxIndexSize: number;            // Default 500
  iconId?: string;                 // Extension point for vault type icons
}

export interface VaultIndexEntry {
  path: string;                    // Absolute path
  name: string;                    // Filename without extension
  modified: number;                // Unix timestamp ms (for staleness)
  size: number;                    // Bytes
  title: string;                   // First H1 or filename if absent
  tags: string[];                  // From front matter tags: field
  outboundLinks: string[];         // [[filename]] stems, NOT resolved paths
}

export interface VaultIndex {
  vaultId: string;
  builtAt: number;                 // Unix timestamp ms
  entries: VaultIndexEntry[];
  totalFilesFound: number;         // Total before cap was applied
  skippedCount: number;            // Files skipped (permissions, etc.)
  capped: boolean;                 // true if totalFilesFound > maxIndexSize
}

export interface FileEntry {
  path: string;
  name: string;
  modified: number;
  size: number;
  isDirectory: boolean;
}

export interface PathValidationResult {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  error?: string;
}

export interface UpdateLinksResult {
  updated: string[];               // Paths successfully updated
  failed: string[];                // Paths that could not be updated
}

export interface VaultFileChangedEvent {
  vaultId: string;
  eventType: "created" | "modified" | "renamed" | "deleted";
  path: string;
  newPath?: string;                // Only for "renamed"
}

export type VaultChangedCallback = (vault: VaultEntry | null) => void;
export type IndexUpdatedCallback = (event: VaultFileChangedEvent) => void;
```

---

## `src/lib/vault-manager.ts` — Public Interface

The developer must implement these exports. Internal implementation is at their discretion.

```typescript
// Public API surface — all exports from vault-manager.ts

/** Call once during app init after settings are loaded. */
export async function init(): Promise<void>;

/** Return the currently active vault, or null if none. */
export function getActiveVault(): VaultEntry | null;

/** Return all configured vaults from settings. */
export function getAllVaults(): VaultEntry[];

/** Return the in-memory index for the active vault, or null if not loaded. */
export function getVaultIndex(): VaultIndex | null;

/**
 * Switch to a new vault.
 * Increments switchGeneration, cancels any in-flight index load,
 * updates activeVaultId in settings, loads or builds the new vault's index,
 * emits onVaultChanged.
 */
export async function switchVault(id: string): Promise<void>;

/**
 * Create a vault (calls create_vault Rust command, updates settings).
 * Immediately activates the new vault.
 */
export async function createVault(
  name: string,
  rootPaths: string[],
  excludePatterns: string[]
): Promise<VaultEntry>;

/** Update vault metadata. Re-indexes if active. */
export async function updateVault(
  id: string,
  updates: Partial<Pick<VaultEntry, "name" | "rootPaths" | "excludePatterns" | "maxIndexSize">>
): Promise<void>;

/** Delete vault. If active, sets activeVaultId to null. */
export async function deleteVault(id: string): Promise<void>;

/** Force a full index rebuild for the active vault. */
export async function reloadVaultIndex(): Promise<void>;

/** Subscribe to vault switch events. */
export function onVaultChanged(cb: VaultChangedCallback): void;
export function offVaultChanged(cb: VaultChangedCallback): void;

/** Subscribe to incremental index update events (from fs watch). */
export function onIndexUpdated(cb: IndexUpdatedCallback): void;
export function offIndexUpdated(cb: IndexUpdatedCallback): void;

/** For testing only. */
export function _resetForTests(): void;
```

**Generation counter pattern** (must be implemented exactly):

```typescript
let switchGeneration = 0;

async function switchVault(id: string): Promise<void> {
  switchGeneration++;
  const myGeneration = switchGeneration;
  // ... async index load ...
  if (switchGeneration !== myGeneration) return; // stale — discard
  // ... apply index ...
}
```

---

## `src/lib/index-parser.ts` — Required Exports

```typescript
/**
 * Parse YAML front matter from file content.
 * Reads only the first 4KB (NFR-07).
 * Returns { title, tags } with safe fallbacks on parse error (EC-40).
 */
export function parseFrontMatter(content: string): {
  title: string | null;
  tags: string[];
};

/**
 * Extract [[wikilink]] stems from full file content.
 * Reuses WIKI_LINK_RE from backlinks.plugin.ts (do not duplicate).
 * Returns array of unique target stems (no pipes, no brackets).
 */
export function extractWikiLinks(content: string): string[];

/**
 * Check whether a cached VaultIndexEntry is stale.
 * Compares entry.modified against currentModified (from file system).
 * Returns true if stale (needs re-parse).
 */
export function isStale(
  entry: VaultIndexEntry,
  currentModified: number
): boolean;

/**
 * Apply a VaultFileChangedEvent to an existing VaultIndex.
 * Returns a new VaultIndex (immutable update).
 * Does NOT read from disk — caller provides updated entry if needed.
 */
export function applyIndexUpdate(
  index: VaultIndex,
  event: VaultFileChangedEvent,
  updatedEntry?: VaultIndexEntry
): VaultIndex;
```

**Important**: `extractWikiLinks` must import `WIKI_LINK_RE` from `../../plugins/backlinks/backlinks.plugin.ts`. Do NOT write a second wiki-link parser.

---

## New Rust Commands (`src-tauri/src/commands/vault.rs`)

### Data structures

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub modified: u64,   // Unix timestamp ms
    pub size: u64,
    pub is_directory: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PathValidationResult {
    pub path: String,
    pub exists: bool,
    pub is_directory: bool,
    pub readable: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultIndexEntry {
    pub path: String,
    pub name: String,
    pub modified: u64,
    pub size: u64,
    pub title: String,
    pub tags: Vec<String>,
    pub outbound_links: Vec<String>,  // camelCase in JSON: outboundLinks
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultIndexPayload {
    pub vault_id: String,
    pub built_at: u64,
    pub entries: Vec<VaultIndexEntry>,
    pub total_files_found: u32,
    pub skipped_count: u32,
    pub capped: bool,
}
```

All structs must use `#[serde(rename_all = "camelCase")]` so that Tauri's JSON serialisation matches the TypeScript interfaces.

### Command implementations

**`validate_vault_paths`**
- For each path: check `Path::exists()`, `Path::is_dir()`, and attempt `fs::read_dir()` to confirm readable.
- Returns `Vec<PathValidationResult>`. Never returns `Err` — per-path errors are in `PathValidationResult.error`.

**`build_vault_index`**
- Walk each root path recursively using `walkdir` crate (already a transitive Tauri dep, or add explicitly).
- Respect `exclude_patterns`: use simple glob matching (`fnmatch` style). Skip any path component matching a pattern.
- Stop adding entries when `entries.len() == max_count` (set `capped = true`, continue counting for `total_files_found`).
- For each `.md` file: read metadata (modified, size) + read content (up to 4 KB for front matter, full file for wiki-links — but asynchronously; use `std::fs::read_to_string`). Parse:
  - Title: first `# Heading` line or filename stem.
  - Tags: simple regex for `tags:` YAML line(s).
  - Outbound links: `\[\[([^\[\]\n]*?)\]\]` — same regex as backlinks.
- Hidden files (starting with `.`) are excluded.
- Return `VaultIndexPayload`.

**`get_vault_index`**
- Path: `app_data_dir/vault-index/{vault_id}.json`
- If absent: return `Ok(None)`.
- If present: read raw content and return `Ok(Some(raw_json_string))`.

**`save_vault_index`**
- Path: `app_data_dir/vault-index/{vault_id}.json`
- Create `vault-index/` directory if absent.
- Write via temp-file-swap (same pattern as `write_raw_settings_to_disk` in settings.rs).

**`delete_vault`**
- Delete `app_data_dir/vault-index/{vault_id}.json` if it exists. No-op if absent.
- Returns `Ok(())`. Does NOT modify settings — frontend handles settings update.

**`list_vault_files`**
- Same recursive walk as `build_vault_index` but returns only `FileEntry` (no content parsing).
- Respects `exclude_patterns` and `max_count`.
- Used for incremental staleness checking (compare stored `modified` vs current `modified`).

**`watch_vault`** (Phase 2b only — skip in Phase 1)
- Placeholder stub returning `Ok(())` in Phase 1 so `mod.rs` can re-export it without breaking the build.

**`unwatch_vault`** (Phase 2b only)
- Placeholder stub returning `Ok(())` in Phase 1.

### Implementation notes for `build_vault_index`

Front matter parsing: a simple state machine, not a full YAML parser. Read lines until a non-front-matter line is encountered or 4KB limit is reached:
1. If first line is `---`, enter front matter mode.
2. Read lines until `---` closing delimiter or EOF.
3. Extract `tags:` line with regex. Handle both `tags: [a, b]` and block sequence.
4. Extract `title:` line if present.
5. First `# ` line (outside front matter) is H1 title if no `title:` front matter.

This matches the TypeScript `parseFrontMatter` function semantics.

---

## `manage-vaults-ui.ts` — Required Behaviour

The Manage Vaults UI is rendered into the Settings panel as a new "Vaults" tab. It is NOT a sidebar panel — it uses the existing settings panel extension point (or is rendered via `handleAction("settings:open")` with a tab parameter).

**Views:**
1. **Vault list** — shows all vaults as rows: name, root paths (truncated), file count (from index), last-opened date. "New Vault" button at top. Clicking a vault row opens the Edit view. Active vault has an accent indicator.
2. **Create vault form** — name input, "Add root path" button (invokes `__TAURI_DIALOG__.openFolder()`), exclude patterns textarea, "Create" / "Cancel" buttons. Inline validation:
   - Empty name: "Vault name is required."
   - No root paths: "At least one root path is required."
   - Root path validation via `validate_vault_paths`: "Path does not exist" / "Path is a file, not a folder" shown inline per path.
   - EC-04: after creation, if the new vault's paths overlap with an existing vault, show warning banner: "This vault's path overlaps with '[vault name]'. Both vaults will index shared files independently."
3. **Edit vault form** — same as Create but pre-filled. "Save" / "Cancel" / "Delete Vault" buttons.
   - "Delete Vault" shows a confirm dialog (native Tauri dialog): "Delete vault '[name]'? This will remove it from Markable. Your notes will not be deleted."
   - Raises `maxIndexSize` above 500: show persistent yellow warning badge: "Vaults over 500 files may affect performance."
4. **Empty state** — when no vaults: centered message "No vaults yet. Create your first vault to get started." with "New Vault" button.

**Command Bar registrations** (in `main.ts`, not in the plugin):
- `"vault:switch"` → `"Switch Vault"` — opens Command Bar in a vault-selection sub-mode (list of vault names).
- `"vault:new"` → `"New Vault"` — opens Manage Vaults create form.
- `"vault:manage"` → `"Manage Vaults"` — opens Manage Vaults settings panel.
- `"vault:reload-index"` → `"Reload Vault Index"` — calls `vaultManager.reloadVaultIndex()`.

---

## CSS Changes (`manage-vaults.css`)

- `.manage-vaults-container` — full-width panel container, uses `--ui-font`.
- `.vault-list-row` — flex row: vault icon + name + paths + actions. `border-bottom: 1px solid var(--border-color)`.
- `.vault-list-row.active` — accent left border `var(--accent-color)`.
- `.vault-form` — grid layout for form fields. Labels use `--ui-font`. Inputs use `--input-bg`, `--input-border`.
- `.vault-path-entry` — single path row: path text + remove button.
- `.vault-overlap-warning` — yellow banner. `background: var(--warning-bg, #fffbe6)`.
- `.vault-performance-warning` — persistent yellow badge on maxIndexSize > 500.
- `.vault-inline-error` — red text below a field. `color: var(--error-color, #c0392b)`.

All colours via CSS variables. No hardcoded hex.

---

## Test Requirements (`tests/vault/vault-index.test.ts`)

Minimum 40 tests. Must cover:

1. `VaultEntry` schema: all required fields present, UUID format validates.
2. `VaultIndex` schema: builtAt is a number, entries is an array.
3. `vault-manager.init()`: no vaults → `getActiveVault()` returns null.
4. `vault-manager.init()`: saved activeVaultId that exists → vault is activated.
5. `vault-manager.init()`: saved activeVaultId that does NOT exist → `getActiveVaultId()` resets to null (EC-11).
6. `createVault`: valid inputs → vault entry has UUID, created/lastOpened timestamps.
7. `createVault`: name > 100 chars → error thrown.
8. `createVault`: empty rootPaths → error thrown.
9. `switchVault`: rapid switching — only final vault's index is applied (generation counter).
10. `switchVault`: switches to valid id → `getActiveVault()` returns new vault.
11. `switchVault`: invalid id → error thrown, previous vault unchanged.
12. `deleteVault`: active vault deleted → `getActiveVault()` returns null (EC-10).
13. `deleteVault`: non-active vault → active vault unchanged.
14. `reloadVaultIndex`: calls build_vault_index and updates in-memory index.
15. `onVaultChanged`: fires on switch.
16. `onVaultChanged`: fires on create.
17. `onVaultChanged`: does NOT fire when switching to same vault.
18. `onIndexUpdated`: fires on incremental update event.
19. `offVaultChanged`: removes listener.
20. Index loading: cached index loaded if present.
21. Index staleness: stale entry triggers rebuild of that entry.
22. Index cap: `capped: true` when totalFilesFound > maxIndexSize.
23. `maxIndexSize` = 500 default enforced.
24. Overlap detection: two vaults where one path is a subpath of another → `isOverlapping()` returns true.
25. `parseFrontMatter`: extracts title and tags from standard YAML block.
26. `parseFrontMatter`: missing front matter → title null, tags empty.
27. `parseFrontMatter`: malformed YAML → graceful fallback, no throw (EC-40).
28. `extractWikiLinks`: standard `[[link]]` → returns `["link"]`.
29. `extractWikiLinks`: piped `[[link|text]]` → returns `["link"]`.
30. `extractWikiLinks`: `[[link]]` inside code fence → still extracted (fence filtering is CM6's job, not index-parser's).
31. `extractWikiLinks`: empty string → returns `[]`.
32. `isStale`: entry.modified < currentModified → true.
33. `isStale`: entry.modified === currentModified → false.
34. `applyIndexUpdate`: "created" event adds new entry.
35. `applyIndexUpdate`: "deleted" event removes entry.
36. `applyIndexUpdate`: "modified" event replaces entry.
37. `applyIndexUpdate`: "renamed" event replaces path key.
38. `applyIndexUpdate`: event for vault different from index.vaultId → throws.
39. Settings schema: `vaults` field is optional array (absent = no vaults).
40. Settings schema: `activeVaultId` field is optional string | null.

Additional tests for `index-parser.test.ts` (min 20):
- H1 extraction from content when no front matter.
- Tags as array: `tags: [a, b]` parsed correctly.
- Tags as block sequence: `tags:\n  - a\n  - b` parsed correctly.
- Multiple wiki-links on one line.
- Duplicate wiki-links deduplicated in `extractWikiLinks`.
- Self-link `[[self]]` is included (graph renders it as self-loop, per EC-38).
- 4KB limit: content past 4KB is not used for front matter (but IS used for wiki-links).

---

## Acceptance Criteria

1. `npm run build:plugins` succeeds with no TypeScript errors in any new file.
2. `cargo test` passes for all tests in `vault.rs` and `file_ops.rs`.
3. `npx vitest run tests/vault/` passes all tests (min 60 total across both files).
4. Opening the Settings panel shows a "Vaults" tab.
5. Creating a vault via the Manage Vaults UI: (a) vault appears in the list, (b) `activeVaultId` is updated in settings.json, (c) `vault-index/{id}.json` is created after index build.
6. Deleting a vault: vault entry removed from settings.json, index cache file deleted.
7. `vaultManager.getActiveVault()` returns null on a fresh install (no vaults).
8. `vaultManager.getActiveVault()` returns the correct vault after app restart with a saved `activeVaultId`.
9. Creating a vault with a root path that does not exist shows inline error in the UI (EC-01).
10. Rapid vault switching (switch to A, immediately to B, immediately to C) results in only C's index being loaded.

---

## Edge Cases Covered

- EC-01: create vault with non-existent path → inline error.
- EC-02: create vault with path that is a file → inline error.
- EC-03: two vaults with same name → allowed.
- EC-04: overlapping vault paths → warning shown, vault created.
- EC-06: corrupted index cache → rebuild triggered silently.
- EC-08: index cap reached → capped flag set, UI notified.
- EC-09: `save_vault_index` fails → logged, in-memory index continues working.
- EC-10: deleting active vault → activeVaultId set to null.
- EC-11: saved activeVaultId not in vaults array → reset to null on init.
- EC-12: unreadable file during index build → file skipped, count tracked.
- EC-13: rapid vault switching → generation counter prevents stale load.
- EC-14: vault with 0 files → empty index, no crash.
- EC-40: malformed front matter → graceful fallback, file still indexed.
