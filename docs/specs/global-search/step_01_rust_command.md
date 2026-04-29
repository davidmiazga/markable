---
title: "Step 01 — search_vault_content Rust Command + bridge.ts Wrapper"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 01 — `search_vault_content` Rust Command + bridge.ts Wrapper

## Goal

Add the `search_vault_content` async Tauri command to `vault.rs`, register it in `mod.rs`
and `lib.rs`, and add a typed `searchVaultContent()` wrapper in `bridge.ts`. After this step
the backend search capability exists and is callable from both IIFE plugins and compiled code.

---

## Files to Change

| File | Change |
|------|--------|
| `src-tauri/src/commands/vault.rs` | Add 3 structs + 1 async command function |
| `src-tauri/src/commands/mod.rs` | Add `pub use vault::search_vault_content;` |
| `src-tauri/src/lib.rs` | Add `search_vault_content` to `pub use commands::...` and to `generate_handler![]` |
| `src/lib/bridge.ts` | Add TypeScript types + `searchVaultContent()` wrapper |

---

## 1. `src-tauri/src/commands/vault.rs`

### 1a. New structs

Insert these three struct definitions immediately after the `NonMdFile` struct and before the
`VaultIndexPayload` struct (around line 67 in the current file). Keep the established pattern
of `#[derive(Debug, Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]`.

```rust
/// A single line that matched the search query in a content search.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    /// 1-based line number within the file.
    pub line_number: u32,
    /// Full text of the matching line, trimmed of leading/trailing whitespace.
    pub line_text: String,
    /// 0-based byte offset of the first match start within `line_text` (after trimming).
    pub column_start: u32,
}

/// All matching lines found in a single file during a content search.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentResult {
    /// Absolute path to the file.
    pub path: String,
    /// Display title: front-matter `title`, first H1 heading, or filename stem.
    pub title: String,
    /// All lines that matched the query, in line-number order.
    pub matches: Vec<LineMatch>,
}

/// Top-level payload returned by `search_vault_content`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPayload {
    /// Matched files, sorted by match count descending (AD-GS-10).
    pub results: Vec<FileContentResult>,
    /// True when the result count was truncated at `max_results`.
    pub capped: bool,
    /// Count of files that could not be read (permission error, invalid path, etc.).
    pub skipped_count: u32,
}
```

### 1b. Per-file read cap constant

Add this constant near the top of the file, alongside the existing `FRONT_MATTER_MAX_BYTES`
constant (around line 196):

```rust
/// Maximum bytes read per file during content search (NFR-7, EC-10).
/// Files larger than this are truncated before line scanning.
const SEARCH_MAX_FILE_BYTES: usize = 1_048_576; // 1 MB
```

### 1c. `search_vault_content` async command

Add this function at the bottom of the `// ─── Tauri commands ───` section in `vault.rs`,
after the last existing command function. This placement keeps all commands grouped together.

```rust
/// Search the text content of all `.md` files in `root_paths` for a case-insensitive
/// substring match of `query`.
///
/// Walk algorithm:
///   1. Use `WalkDir` over each root path in `root_paths`.
///   2. Skip entries that `should_exclude` returns true for (hidden files, patterns).
///   3. Process only files whose extension is `.md` (case-insensitive).
///   4. Read up to `SEARCH_MAX_FILE_BYTES` bytes per file. Files that cannot be
///      opened are silently skipped (EC-8, EC-9); `skipped_count` is incremented.
///   5. Convert raw bytes to a string via `String::from_utf8_lossy` (AD-GS-02).
///   6. Scan each line for a case-insensitive substring match of `query`.
///   7. Collect all matching lines into a `FileContentResult`. A file is only added
///      to `results` when at least one line matches.
///   8. Stop adding new files once `results.len() == max_results as usize`
///      (set `capped = true`). Files already in `results` are still fully scanned
///      (all their matches are included); the cap applies to the count of *files*.
///   9. Sort `results` by match count descending before returning (AD-GS-10).
///
/// Returns `Err` only when `query` is empty after trimming (caller should guard,
/// but the Rust side validates too for safety).
#[tauri::command]
pub async fn search_vault_content(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    query: String,
    max_results: u32,
) -> Result<ContentSearchPayload, String> {
    use std::io::Read;

    let query_trimmed = query.trim().to_lowercase();
    if query_trimmed.is_empty() {
        return Err("query must not be empty".to_string());
    }

    let max = max_results as usize;
    let mut results: Vec<FileContentResult> = Vec::new();
    let mut capped = false;
    let mut skipped_count: u32 = 0;

    'roots: for root_str in &root_paths {
        let root = Path::new(root_str);
        for entry in WalkDir::new(root).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    skipped_count += 1;
                    continue;
                }
            };

            // Only process regular files.
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();

            // Exclude hidden/excluded paths.
            let rel = path.strip_prefix(root).unwrap_or(path);
            if should_exclude(rel, &exclude_patterns) {
                continue;
            }

            // Only .md files (case-insensitive extension check).
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            if !ext.eq_ignore_ascii_case("md") {
                continue;
            }

            // Stop adding new files if the cap is reached.
            if results.len() >= max {
                capped = true;
                break 'roots;
            }

            // Read up to SEARCH_MAX_FILE_BYTES bytes (EC-10, NFR-7).
            let bytes: Vec<u8> = {
                let file = match std::fs::File::open(path) {
                    Ok(f) => f,
                    Err(_) => {
                        skipped_count += 1;
                        continue;
                    }
                };
                let mut reader = file.take(SEARCH_MAX_FILE_BYTES as u64);
                let mut buf = Vec::with_capacity(SEARCH_MAX_FILE_BYTES);
                match reader.read_to_end(&mut buf) {
                    Ok(_) => buf,
                    Err(_) => {
                        skipped_count += 1;
                        continue;
                    }
                }
            };

            // Lossy UTF-8 decode (AD-GS-02): invalid sequences become U+FFFD.
            let content = String::from_utf8_lossy(&bytes);

            // Extract title for display (same priority as build_vault_index).
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let fm = parse_front_matter(&content);
            let title = fm.title.unwrap_or_else(|| stem.clone());

            // Scan lines for case-insensitive substring matches.
            let mut file_matches: Vec<LineMatch> = Vec::new();
            for (line_idx, line) in content.lines().enumerate() {
                let trimmed = line.trim();
                let lower = trimmed.to_lowercase();
                if let Some(col) = lower.find(&query_trimmed) {
                    file_matches.push(LineMatch {
                        line_number: (line_idx + 1) as u32,
                        line_text: trimmed.to_string(),
                        column_start: col as u32,
                    });
                }
            }

            if !file_matches.is_empty() {
                results.push(FileContentResult {
                    path: path.to_string_lossy().to_string(),
                    title,
                    matches: file_matches,
                });
            }
        }
    }

    // Sort by match count descending (AD-GS-10).
    results.sort_by(|a, b| b.matches.len().cmp(&a.matches.len()));

    Ok(ContentSearchPayload {
        results,
        capped,
        skipped_count,
    })
}
```

---

## 2. `src-tauri/src/commands/mod.rs`

Add `search_vault_content` to the `pub use vault::{ ... }` re-export block.

Current last line of the vault re-export block:

```rust
pub use vault::{
    build_vault_index,
    create_vault,
    delete_vault,
    get_vault_index,
    list_vault_files,
    save_vault_index,
    switch_vault,
    unwatch_vault,
    update_vault,
    validate_vault_paths,
    watch_vault,
    WatcherRegistry,
};
```

Replace with:

```rust
pub use vault::{
    build_vault_index,
    create_vault,
    delete_vault,
    get_vault_index,
    list_vault_files,
    save_vault_index,
    search_vault_content,
    switch_vault,
    unwatch_vault,
    update_vault,
    validate_vault_paths,
    watch_vault,
    WatcherRegistry,
};
```

---

## 3. `src-tauri/src/lib.rs`

Two locations must be updated. Verify the window-size section remains intact after this change
(CLAUDE.md invariant).

### 3a. `pub use commands::{ ... }` block (around line 25)

Add `search_vault_content` to the existing vault command list:

```rust
// Before (excerpt):
build_vault_index, create_vault, delete_vault, get_vault_index, list_vault_files,
save_vault_index, switch_vault, unwatch_vault, update_vault, validate_vault_paths, watch_vault,

// After:
build_vault_index, create_vault, delete_vault, get_vault_index, list_vault_files,
save_vault_index, search_vault_content, switch_vault, unwatch_vault, update_vault,
validate_vault_paths, watch_vault,
```

### 3b. `tauri::generate_handler![]` array (around line 443)

Add `search_vault_content` after `reveal_in_finder` (the current last entry):

```rust
// Before:
            update_wiki_links,
            reveal_in_finder
        ])

// After:
            update_wiki_links,
            reveal_in_finder,
            search_vault_content
        ])
```

---

## 4. `src/lib/bridge.ts`

Add the TypeScript types and the `searchVaultContent` wrapper function. Insert the types
after the existing imports and before the first exported function. Insert the function after
the last existing exported function.

### 4a. Add types

```typescript
// ─── Content search types (step_01) ──────────────────────────────────────────

/**
 * A single line that matched the search query.
 * Mirrors the Rust LineMatch struct (serde camelCase).
 */
export interface LineMatch {
  /** 1-based line number within the file. */
  lineNumber: number;
  /** Full text of the matching line (trimmed). */
  lineText: string;
  /** 0-based byte offset of the match start within lineText. */
  columnStart: number;
}

/**
 * All matching lines found in a single file.
 * Mirrors the Rust FileContentResult struct.
 */
export interface FileContentResult {
  /** Absolute path to the file. */
  path: string;
  /** Display title: front-matter title, H1 heading, or filename stem. */
  title: string;
  /** All lines that matched, in line-number order. */
  matches: LineMatch[];
}

/**
 * Top-level payload returned by the search_vault_content Tauri command.
 * Mirrors the Rust ContentSearchPayload struct.
 */
export interface ContentSearchPayload {
  /** Matched files, sorted by match count descending. */
  results: FileContentResult[];
  /** True when the result set was truncated at max_results. */
  capped: boolean;
  /** Count of files that could not be read. */
  skippedCount: number;
}
```

### 4b. Add wrapper function

```typescript
/**
 * Search file contents across all root paths in the vault.
 *
 * This is the typed bridge wrapper for the `search_vault_content` Tauri command.
 * The IIFE command-bar plugin calls the command directly via
 * `__TAURI_INTERNALS__.invoke` (IIFE constraint — AD-GS from 00_index.md).
 * This wrapper exists for testability and future non-IIFE consumers (FR-15, NFR-8).
 *
 * @param params.rootPaths - Absolute paths of vault root directories to search.
 * @param params.excludePatterns - Glob patterns for directories/files to skip.
 * @param params.query - Substring to search for (case-insensitive).
 * @param params.maxResults - Maximum number of files to include in results.
 * @returns FileResult<ContentSearchPayload> — never throws.
 */
export async function searchVaultContent(params: {
  rootPaths: string[];
  excludePatterns: string[];
  query: string;
  maxResults: number;
}): Promise<FileResult<ContentSearchPayload>> {
  try {
    const payload = await invoke<ContentSearchPayload>("search_vault_content", {
      root_paths: params.rootPaths,
      exclude_patterns: params.excludePatterns,
      query: params.query,
      max_results: params.maxResults,
    });
    return { ok: true, value: payload };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "search_vault_content",
      } satisfies TauriCommandError,
    };
  }
}
```

Note on invoke parameter names: Tauri's `generate_handler!` macro receives argument names from
the Rust function signature (`root_paths`, `exclude_patterns`, `query`, `max_results`). The
bridge wrapper passes `snake_case` keys as the invoke argument object. The `serde` rename
applies only to the *return type* serialisation, not to parameter names.

---

## Acceptance Criteria

- [ ] `cargo build` succeeds with no new warnings.
- [ ] `cargo test` passes (no existing Rust tests broken).
- [ ] The three new structs appear in `vault.rs` with `#[serde(rename_all = "camelCase")]`.
- [ ] `search_vault_content` is listed in `mod.rs`, `lib.rs` (`pub use`), and
      `generate_handler![]`.
- [ ] `bridge.ts` exports `LineMatch`, `FileContentResult`, `ContentSearchPayload`, and
      `searchVaultContent`.
- [ ] `npm run test:run` passes — the bridge.ts types do not break existing tests.
- [ ] Window size invariant: `src/lib/settings.ts` `sizeH = "80%"` and `lib.rs` multiplier
      `0.8` are both unchanged. Run `npm run test:run -- tests/settings/window-defaults.test.ts`
      to verify.

---

## Test Requirements

Tests for this step are in `step_04_tests.md`. The tests that exercise `search_vault_content`
directly call the Rust command via a Tauri test harness or mock the `invoke` call in
`bridge.test.ts`. The bridge wrapper test must:

1. Verify that `searchVaultContent()` calls `invoke("search_vault_content", ...)` with the
   correct snake_case parameter object.
2. Verify that a resolved invoke returns `{ ok: true, value: <ContentSearchPayload> }`.
3. Verify that a rejected invoke returns `{ ok: false, error: { command: "search_vault_content" } }`.
