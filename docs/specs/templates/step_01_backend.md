---
title: "Step 01 — Backend Infrastructure"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Step 01: Backend Infrastructure

**Goal**: Add the `ensure_directory` Rust command and its TypeScript bridge function.

## Requirement Traceability

- FR-5.3: Templates folder auto-created on "Save as Template"
- FR-6.3: Templates folder created by setup wizard
- AD-7: `ensure_directory` is a general-purpose `create_dir_all` wrapper

## 1. Rust Command: `ensure_directory`

**File**: `src-tauri/src/commands/files.rs`

Add the following command after the existing `list_md_files` function (before `#[cfg(test)]`):

```rust
/// Ensure a directory exists, creating it and all parent directories if absent.
///
/// Thin wrapper around `std::fs::create_dir_all`. Returns `Ok(())` if the
/// directory already exists or was successfully created. Returns `Err` with
/// a human-readable message on failure (permissions, path is a file, etc.).
///
/// General-purpose — not specific to the templates feature. Can be reused
/// by any feature that needs to ensure a directory exists before writing.
///
/// # Arguments
/// * `path` - Absolute path to the directory to ensure.
#[tauri::command]
pub fn ensure_directory(path: String) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}
```

## 2. Register the Command

### `src-tauri/src/commands/mod.rs`

Add to the existing `pub use files::` line:

```rust
pub use files::{list_md_files, ensure_directory};
```

### `src-tauri/src/lib.rs`

1. Add `ensure_directory` to the `pub use commands::{...}` block.
2. Add `ensure_directory` to the `tauri::generate_handler![...]` array.
3. Add `"file-new-from-template" | "file-save-as-template"` to the menu event forwarding match arm (the `_ if id.starts_with(...)` line or add them explicitly to the pipe-separated list).

**Note**: The menu items themselves are added in step_02. The command registration here ensures the Rust side is ready before the frontend calls it.

## 3. Bridge Function

**File**: `src/lib/bridge.ts`

Add after the existing `listMdFiles` function, in the "Directory scanning" section:

```typescript
/**
 * Ensure a directory exists, creating it and all parents if absent.
 *
 * Wraps the Rust `ensure_directory` command. No-op if the directory
 * already exists. Throws on failure (permissions, path conflict).
 *
 * @param path - Absolute path to the directory to ensure
 */
export async function ensureDirectory(path: string): Promise<void> {
  await invoke("ensure_directory", { path });
}
```

## 4. Rust Tests

**File**: `src-tauri/src/commands/files.rs` (in the existing `#[cfg(test)] mod tests` block)

Add tests:

```rust
#[test]
fn ensure_directory_creates_new_dir() {
    let dir = setup_test_dir("ensure_new");
    let target = dir.join("subdir");
    assert!(!target.exists());
    let result = ensure_directory(target.to_string_lossy().to_string());
    assert!(result.is_ok());
    assert!(target.is_dir());
    cleanup(&dir);
}

#[test]
fn ensure_directory_creates_nested_dirs() {
    let dir = setup_test_dir("ensure_nested");
    let target = dir.join("a").join("b").join("c");
    assert!(!target.exists());
    let result = ensure_directory(target.to_string_lossy().to_string());
    assert!(result.is_ok());
    assert!(target.is_dir());
    cleanup(&dir);
}

#[test]
fn ensure_directory_succeeds_if_exists() {
    let dir = setup_test_dir("ensure_exists");
    // dir already exists from setup
    let result = ensure_directory(dir.to_string_lossy().to_string());
    assert!(result.is_ok());
    cleanup(&dir);
}

#[test]
fn ensure_directory_fails_if_path_is_file() {
    let dir = setup_test_dir("ensure_file_conflict");
    let file_path = dir.join("not_a_dir");
    std::fs::write(&file_path, "content").unwrap();
    // Trying to create a directory where a file exists should fail
    let result = ensure_directory(file_path.to_string_lossy().to_string());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Failed to create directory"));
    cleanup(&dir);
}
```

## Verification

After this step:
- `cargo test` passes with the new `ensure_directory` tests.
- `invoke("ensure_directory", { path })` is callable from the frontend.
- No UI changes yet -- this is pure infrastructure.

## Files Changed

| File | Change |
|---|---|
| `src-tauri/src/commands/files.rs` | Add `ensure_directory` command + 4 tests |
| `src-tauri/src/commands/mod.rs` | Add `pub use files::ensure_directory` |
| `src-tauri/src/lib.rs` | Add to `pub use`, `generate_handler![]`, and menu forwarding |
| `src/lib/bridge.ts` | Add `ensureDirectory()` function |
