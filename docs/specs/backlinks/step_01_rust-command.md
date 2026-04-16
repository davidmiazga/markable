---
title: "Step 1: Rust Command + Bridge Function"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 1: Rust Command + Bridge Function

## Goal

Add a new Tauri command `list_md_files` that performs a shallow directory scan returning `.md` filenames, and a corresponding TypeScript bridge function `listMdFiles()`.

## Acceptance Criteria

1. `list_md_files` command accepts `directory_path: String`, returns `Vec<String>`.
2. Only immediate children (non-recursive) are listed.
3. Only files with `.md` extension (case-insensitive) are included.
4. Hidden files (names starting with `.`) are excluded.
5. Results are sorted alphabetically (case-insensitive).
6. Returns empty Vec if the directory does not exist or cannot be read.
7. `listMdFiles()` bridge function wraps the Tauri invoke call.
8. Bridge function returns `string[]` (empty array on error).

## Files to Create

### `src-tauri/src/commands/files.rs`

```rust
//! File discovery commands.
//!
//! Provides directory scanning utilities for the backlinks feature.
//! Separate from io.rs because these commands return file metadata
//! (names, not contents) and have different error semantics (empty
//! Vec on failure, not Result::Err).

use std::fs;
use std::path::Path;

/// List `.md` filenames in a directory (shallow, non-recursive).
///
/// # Arguments
/// * `directory_path` - Absolute path to the directory to scan.
///
/// # Returns
/// * `Vec<String>` - Filenames (not full paths) of `.md` files,
///   sorted alphabetically (case-insensitive). Hidden files (names
///   starting with `.`) are excluded. Returns empty Vec if the
///   directory does not exist or cannot be read.
///
/// # Performance
/// NFR-1: must complete in under 50ms for directories with up to 500 files.
/// This is a simple read_dir + filter — no file content is read.
#[tauri::command]
pub fn list_md_files(directory_path: String) -> Vec<String> {
    let dir = Path::new(&directory_path);

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut filenames: Vec<String> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            // Exclude hidden files
            if name.starts_with('.') {
                return None;
            }
            // Check .md extension (case-insensitive)
            if !name.to_lowercase().ends_with(".md") {
                return None;
            }
            Some(name)
        })
        .collect();

    // Sort alphabetically, case-insensitive
    filenames.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    filenames
}
```

## Files to Modify

### `src-tauri/src/commands/mod.rs`

Add after existing module declarations:

```rust
pub mod files;
```

Add to the `pub use` section:

```rust
pub use files::list_md_files;
```

### `src-tauri/src/lib.rs`

Add `list_md_files` to the `pub use commands::{ ... }` block:

```rust
pub use commands::{
    // ... existing exports ...
    list_md_files,
};
```

Add `list_md_files` to the `invoke_handler` macro:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing handlers ...
    list_md_files,
])
```

### `src/lib/bridge.ts`

Add after the existing `readClipboardText` function (before the theme commands section):

```typescript
// ── Directory scanning ──────────────────────────────────────────────────────

/**
 * List .md filenames in a directory (shallow, non-recursive).
 *
 * Returns filenames only (not full paths), sorted alphabetically
 * (case-insensitive). Hidden files excluded. Returns empty array
 * if the directory does not exist or cannot be read.
 *
 * Used by the backlinks plugin for auto-complete and index building.
 */
export async function listMdFiles(directoryPath: string): Promise<string[]> {
  try {
    return await invoke<string[]>("list_md_files", { directoryPath });
  } catch (error) {
    console.error("Failed to list md files:", error);
    return [];
  }
}
```

## TDD Test Plan

### Rust Tests (`src-tauri/src/commands/files.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_test_dir(prefix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markable_files_test_{}_{}", prefix, std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cleanup(dir: &std::path::Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_lists_md_files() {
        let dir = setup_test_dir("basic");
        fs::write(dir.join("notes.md"), "# Notes").unwrap();
        fs::write(dir.join("todo.md"), "# Todo").unwrap();
        fs::write(dir.join("readme.txt"), "text").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["notes.md", "todo.md"]);
        cleanup(&dir);
    }

    #[test]
    fn test_excludes_hidden_files() {
        let dir = setup_test_dir("hidden");
        fs::write(dir.join(".hidden.md"), "hidden").unwrap();
        fs::write(dir.join("visible.md"), "visible").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["visible.md"]);
        cleanup(&dir);
    }

    #[test]
    fn test_case_insensitive_extension() {
        let dir = setup_test_dir("case");
        fs::write(dir.join("upper.MD"), "# Upper").unwrap();
        fs::write(dir.join("lower.md"), "# Lower").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result.len(), 2);
        cleanup(&dir);
    }

    #[test]
    fn test_case_insensitive_sort() {
        let dir = setup_test_dir("sort");
        fs::write(dir.join("Zebra.md"), "").unwrap();
        fs::write(dir.join("alpha.md"), "").unwrap();
        fs::write(dir.join("Beta.md"), "").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["alpha.md", "Beta.md", "Zebra.md"]);
        cleanup(&dir);
    }

    #[test]
    fn test_nonexistent_directory() {
        let result = list_md_files("/nonexistent/path/that/does/not/exist".to_string());
        assert!(result.is_empty());
    }

    #[test]
    fn test_empty_directory() {
        let dir = setup_test_dir("empty");
        let result = list_md_files(dir.to_string_lossy().to_string());
        assert!(result.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn test_excludes_directories_with_md_name() {
        let dir = setup_test_dir("subdir");
        fs::create_dir_all(dir.join("subfolder.md")).unwrap();
        fs::write(dir.join("real.md"), "real").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["real.md"]);
        cleanup(&dir);
    }
}
```

### TypeScript Tests (in step 9's test file)

Bridge function `listMdFiles()` is tested via integration tests in step 9 since it requires Tauri invoke mocking.

## Edge Cases Addressed

- **EC-11**: Large directory (500+ files) -- `read_dir` is O(n) with no content reads; NFR-1 budget of 50ms is achievable.
- **EC-20**: Binary `.md` file -- this command only lists filenames, not content. Binary content is handled in step 7 (index builder) where `readFile()` errors are caught.
- **EC-21**: Permission-denied file -- `entry.ok()?` in filter_map skips entries that cannot be read. Directory-level permission denial returns empty Vec.
