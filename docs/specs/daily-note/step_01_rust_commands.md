---
title: "Step 01 — Rust Commands: create_daily_note and check_paths_exist"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Step 01 — Rust Commands

## Goal and Scope

Implement two new Tauri commands in a new file `src-tauri/src/commands/daily_note.rs`, register them in `mod.rs` and `main.rs`, and write `cargo test` coverage.

This step has no TypeScript dependency — it can be implemented and tested in isolation before any plugin code exists.

---

## Files to Create / Modify

| Action | File |
|---|---|
| CREATE | `src-tauri/src/commands/daily_note.rs` |
| MODIFY | `src-tauri/src/commands/mod.rs` |
| MODIFY | `src-tauri/src/main.rs` |

---

## Implementation Spec

### `daily_note.rs`

Follow the module structure of `files.rs` exactly: doc comment block at the top, `use` statements, functions with doc comments, `#[cfg(test)]` block at the bottom.

#### `create_daily_note`

```
Signature: pub fn create_daily_note(path: String, content: String) -> Result<(), String>

Logic:
  1. Convert `path` to PathBuf.
  2. Check if path already exists as a directory (not a file).
     If path.is_dir() → return Err("path exists as a directory: <path>")
     (This is EC-35: the .md extension is always appended, but a dir named
      `2026-04-23.md` could theoretically exist.)
  3. Resolve the parent directory of `path` (path.parent()).
     If parent is Some(p) and !p.is_dir():
       std::fs::create_dir_all(p)
         .map_err(|e| format!("Failed to create directory '{}': {}", p.display(), e))?;
     (This handles EC-02: first-ever note; EC-16: subfolders already exist → create_dir_all is idempotent)
  4. Generate a temp filename: <path>.tmp.<timestamp_nanos>
     (Same pattern as write_file in io.rs and write_settings_to_disk in settings.rs)
  5. Create temp file, write content bytes, call sync_all().
     On any error: clean up temp file, return descriptive Err.
  6. std::fs::rename(temp_path, path)
     On error: clean up temp file, return "Atomic write failed: ..."
  7. Return Ok(())

Notes:
  - create_dir_all is idempotent — calling it when dirs already exist succeeds silently (FR-10.2).
  - Accepts absolute paths only (FR-10.4). No validation of absoluteness in Rust —
    the frontend is responsible for constructing absolute paths.
  - Content may be empty string (new note with no template).
```

#### `check_paths_exist`

```
Signature: pub fn check_paths_exist(paths: Vec<String>) -> Result<HashMap<String, bool>, String>

Imports needed: use std::collections::HashMap;

Logic:
  1. If paths is empty → return Ok(HashMap::new())   (EC-38: defensive)
  2. For each path string in paths:
     a. Convert to PathBuf.
     b. Insert (path_string, Path::exists()) into the HashMap.
        std::path::Path::exists() returns true for both files and directories;
        this is correct — the frontend asks "does this path exist?", not "is it a file?"
  3. Return Ok(map)

Notes:
  - Never returns Err in normal operation (path existence is a read-only, infallible op).
  - The Result wrapper is kept for future extensibility (e.g. permission errors on network mounts).
  - EC-17: nested paths like "/Daily Notes/2026/04/2026-04-23.md" work correctly because
    Path::exists() handles any valid absolute path.
  - EC-32: paths with spaces or Unicode work because PathBuf handles them natively.
```

### `mod.rs` changes

```rust
// Add after existing pub mod lines:
pub mod daily_note;

// Add to pub use block:
pub use daily_note::{create_daily_note, check_paths_exist};
```

### `main.rs` changes

Locate the `tauri::generate_handler![]` macro call (in `src-tauri/src/main.rs`). Add the two new commands to the list:

```rust
create_daily_note,
check_paths_exist,
```

---

## Test Cases

All tests live in `#[cfg(test)] mod tests` inside `daily_note.rs`. Follow the `setup_test_dir` / `cleanup` helper pattern from `files.rs`.

### `create_daily_note` tests

1. **creates_file_in_existing_dir** — target dir exists; file does not. Assert file is created with the correct content. Assert temp file is not left behind.

2. **creates_nested_directories_automatically** — target is `/tmp/markable_test/daily/2026/04/2026-04-23.md`; none of the intermediate dirs exist. Assert all dirs are created and file exists with content.

3. **idempotent_on_existing_directories** — intermediate dirs already exist (created by a prior call). Call `create_daily_note` again. Assert Ok(()) and content is correctly overwritten. (FR-10.2, EC-16)

4. **returns_error_when_path_is_directory** — create a directory at the target path (e.g. `/tmp/.../2026-04-23.md/` as a dir). Assert Err containing "exists as a directory". (EC-35)

5. **creates_file_with_empty_content** — content = "". Assert file exists and is empty.

6. **creates_file_with_unicode_content** — content contains Unicode characters (emoji, accented chars). Assert round-trip content matches.

7. **path_with_spaces** — target path contains spaces (e.g. `/tmp/My Notes/2026-04-23.md`). Assert Ok(()) and file exists. (EC-32)

8. **overwrites_existing_file** — file already exists with old content. Call `create_daily_note` with new content. Assert file now contains new content (tab switch case — the existing note is overwritten/re-created, which is acceptable because the frontend only calls this for new notes, but the command must not fail if the file exists).

9. **returns_error_on_unwritable_parent** — parent dir exists but is read-only (chmod 0o444). Skip on CI if running as root. Assert Err containing "Permission denied" or "Failed to create".

### `check_paths_exist` tests

10. **returns_true_for_existing_file** — create a real file; assert map[path] = true.

11. **returns_false_for_missing_file** — a path that does not exist; assert map[path] = false.

12. **returns_true_for_existing_directory** — pass a directory path; assert map[path] = true. (EC-17: dirs are valid path targets)

13. **handles_empty_input** — call with Vec::new(); assert Ok(empty HashMap). (EC-38)

14. **handles_mixed_existing_and_missing** — three paths: one file exists, one dir exists, one missing. Assert correct boolean for each.

15. **handles_nested_path** — path like `/tmp/daily/2026/04/2026-04-23.md`; create the file; assert true. (EC-17)

16. **handles_path_with_spaces** — path with spaces in directory name; assert correct result. (EC-32)

17. **handles_large_batch** — 31 paths (one per day in a month). Create 20 of them. Assert exactly 20 are true. (FR-07.3 dot rendering scenario)

18. **result_keys_are_original_path_strings** — assert that each key in the returned HashMap is exactly the original string passed in (no normalization or transformation).

---

## Definition of Done

- [ ] `src-tauri/src/commands/daily_note.rs` exists with both commands.
- [ ] `mod.rs` exports both commands.
- [ ] `main.rs` registers both commands in `generate_handler![]`.
- [ ] `cargo test` passes with all 18 tests green.
- [ ] No `unwrap()` in production paths (all errors use `map_err` or `?`).
- [ ] Doc comments present on both public functions matching the style in `files.rs`.
- [ ] No temp file left behind on any error path (cleanup in all error branches).
