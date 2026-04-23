//! File discovery commands.
//!
//! Provides directory scanning utilities for the backlinks feature and
//! keybinding preset discovery. Separate from io.rs because these commands
//! return file metadata (names, not contents) and have different error
//! semantics (empty Vec on failure, not Result::Err).

use std::fs;
use std::path::{Path, PathBuf};
// Manager trait provides app.path() on AppHandle — must be in scope for list_preset_files.
use tauri::Manager;

/// List `.md` filenames in a directory (shallow, non-recursive).
///
/// Scans the immediate children of `directory_path` for files with a `.md`
/// extension (case-insensitive). Hidden files (names starting with `.`) are
/// excluded. Directories whose names end in `.md` are also excluded — only
/// regular files are returned.
///
/// # Arguments
/// * `directory_path` - Absolute path to the directory to scan.
///
/// # Returns
/// Filenames (not full paths) of `.md` files, sorted alphabetically
/// (case-insensitive). Returns an empty Vec if the directory does not
/// exist, cannot be read, or contains no matching files.
///
/// # Performance
/// NFR-1: must complete in under 50ms for directories with up to 500 files.
/// This is a simple read_dir + filter — no file content is read, so the
/// bottleneck is purely the number of directory entries.
#[tauri::command]
pub fn list_md_files(path: String) -> Vec<String> {
    let dir = Path::new(&path);

    // Attempt to read the directory. If it doesn't exist or we lack
    // permission, return an empty list rather than an error — the caller
    // (backlinks index builder) treats "no files" and "unreadable dir"
    // identically.
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut filenames: Vec<String> = entries
        .filter_map(|entry| {
            // Skip entries that fail to read (e.g., permission denied on
            // individual entry). The filename is still returned if the
            // DirEntry itself is readable — only metadata failures are
            // skipped here (EC-21).
            let entry = entry.ok()?;

            // Only include regular files. Directories or symlinks whose
            // names end in ".md" are excluded.
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }

            let name = entry.file_name().to_string_lossy().into_owned();

            // Exclude hidden files (macOS convention: names starting with '.')
            if name.starts_with('.') {
                return None;
            }

            // Check .md extension case-insensitively. We use to_lowercase()
            // on the full filename and check ends_with(".md") rather than
            // splitting on '.' — this correctly handles names like "file.MD",
            // "file.Md", and edge cases like ".md" (hidden, already excluded).
            if !name.to_lowercase().ends_with(".md") {
                return None;
            }

            Some(name)
        })
        .collect();

    // Sort alphabetically with case-insensitive comparison. This ensures
    // "alpha.md" sorts before "Beta.md" regardless of case, matching user
    // expectations for file listings.
    filenames.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    filenames
}

/// List all `.json` filenames in the `keybinding-presets/` subdirectory of the app data dir.
///
/// Uses `AppHandle` to resolve the app data directory internally — the same pattern used
/// by `plugins.rs` and `themes.rs`. The caller (preset-manager.ts) never needs to know the
/// app data directory path.
///
/// # Returns
/// Filenames (not full paths) of `.json` files, sorted alphabetically.
/// Returns an empty Vec if the directory does not exist or cannot be read — never errors.
/// This "empty on failure" semantic is consistent with `list_md_files` above.
#[tauri::command]
pub fn list_preset_files(app: tauri::AppHandle) -> Vec<String> {
    // Resolve app data directory via AppHandle — mirrors the pattern in themes.rs.
    // If the path cannot be resolved (e.g. sandbox restrictions), return empty.
    let data_dir: PathBuf = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    let presets_dir = data_dir.join("keybinding-presets");

    // If the directory doesn't exist yet (no presets saved), return empty without error.
    if !presets_dir.is_dir() {
        return vec![];
    }

    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&presets_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Case-insensitive check so files saved as .JSON on case-preserving
            // filesystems (e.g. macOS default HFS+) are still discovered.
            if name.to_lowercase().ends_with(".json") && !name.starts_with('.') {
                names.push(name);
            }
        }
    }

    // Sort for deterministic order — same filename on every call for the same directory state.
    names.sort();
    names
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a unique temporary directory for a test case.
    /// Each test gets its own directory to avoid interference.
    fn setup_test_dir(prefix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markable_files_test_{}_{}",
            prefix,
            std::process::id()
        ));
        // Clean up any leftover from a previous run
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Remove the temporary directory after a test completes.
    fn cleanup(dir: &std::path::Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn lists_only_md_files() {
        let dir = setup_test_dir("basic");
        fs::write(dir.join("notes.md"), "# Notes").unwrap();
        fs::write(dir.join("todo.md"), "# Todo").unwrap();
        fs::write(dir.join("readme.txt"), "text").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["notes.md", "todo.md"]);
        cleanup(&dir);
    }

    #[test]
    fn excludes_hidden_files() {
        let dir = setup_test_dir("hidden");
        fs::write(dir.join(".hidden.md"), "hidden").unwrap();
        fs::write(dir.join("visible.md"), "visible").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["visible.md"]);
        cleanup(&dir);
    }

    #[test]
    fn case_insensitive_extension() {
        let dir = setup_test_dir("case_ext");
        fs::write(dir.join("upper.MD"), "# Upper").unwrap();
        fs::write(dir.join("lower.md"), "# Lower").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result.len(), 2);
        // Both should be present regardless of extension casing
        assert!(result.contains(&"upper.MD".to_string()));
        assert!(result.contains(&"lower.md".to_string()));
        cleanup(&dir);
    }

    #[test]
    fn case_insensitive_sort_order() {
        let dir = setup_test_dir("sort");
        fs::write(dir.join("Zebra.md"), "").unwrap();
        fs::write(dir.join("alpha.md"), "").unwrap();
        fs::write(dir.join("Beta.md"), "").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["alpha.md", "Beta.md", "Zebra.md"]);
        cleanup(&dir);
    }

    #[test]
    fn nonexistent_directory_returns_empty() {
        let result = list_md_files("/nonexistent/path/that/does/not/exist".to_string());
        assert!(result.is_empty());
    }

    #[test]
    fn empty_directory_returns_empty() {
        let dir = setup_test_dir("empty");
        let result = list_md_files(dir.to_string_lossy().to_string());
        assert!(result.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn excludes_directories_with_md_name() {
        let dir = setup_test_dir("subdir");
        fs::create_dir_all(dir.join("subfolder.md")).unwrap();
        fs::write(dir.join("real.md"), "real").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["real.md"]);
        cleanup(&dir);
    }

    #[test]
    fn non_recursive_ignores_nested_files() {
        let dir = setup_test_dir("nested");
        fs::create_dir_all(dir.join("subdir")).unwrap();
        fs::write(dir.join("subdir").join("nested.md"), "nested").unwrap();
        fs::write(dir.join("top.md"), "top").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["top.md"]);
        cleanup(&dir);
    }

    #[test]
    fn returns_filenames_not_full_paths() {
        let dir = setup_test_dir("names_only");
        fs::write(dir.join("document.md"), "content").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        assert_eq!(result, vec!["document.md"]);
        // Verify it's just the filename, not a path
        assert!(!result[0].contains('/'));
        cleanup(&dir);
    }

    #[test]
    fn excludes_non_md_extensions() {
        let dir = setup_test_dir("extensions");
        fs::write(dir.join("file.md"), "").unwrap();
        fs::write(dir.join("file.markdown"), "").unwrap();
        fs::write(dir.join("file.txt"), "").unwrap();
        fs::write(dir.join("file.mdx"), "").unwrap();
        fs::write(dir.join("file.mdown"), "").unwrap();

        let result = list_md_files(dir.to_string_lossy().to_string());
        // Only .md extension should match — not .markdown, .mdx, .mdown
        assert_eq!(result, vec!["file.md"]);
        cleanup(&dir);
    }

    // ── ensure_directory tests ──────────────────────────────────────────────

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
}
