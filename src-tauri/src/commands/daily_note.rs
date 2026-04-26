//! Daily note commands for the Daily Note / Calendar plugin.
//!
//! Provides two Tauri commands:
//! - `create_daily_note` — idempotently creates the parent directory tree and
//!   writes the note file using the temp-file-swap atomic pattern from io.rs.
//! - `check_paths_exist` — batch existence check; maps each path string to a
//!   boolean indicating whether the path exists (file or directory).
//!
//! Both commands are pure filesystem operations and carry no plugin-specific
//! business logic. The frontend is responsible for constructing correct absolute
//! paths before calling these commands.

use std::collections::HashMap;
use std::fs;
use std::io::Write as IoWrite;
use std::path::PathBuf;

/// Create (or overwrite) a daily note at the given absolute path.
///
/// Combines directory creation and atomic file write into a single round-trip
/// to satisfy NFR-01 (note tab focused within 300ms on first creation).
///
/// # Arguments
/// * `path`    - Absolute path to the `.md` file to create/overwrite.
/// * `content` - UTF-8 content to write (may be empty string).
///
/// # Returns
/// * `Ok(())` — directory was ensured and file written successfully.
/// * `Err(message)` — human-readable reason for failure.
///
/// # Error Conditions
/// - `path` already exists as a **directory** → Err (EC-35: a directory named
///   e.g. `2026-04-23.md` could theoretically exist).
/// - Parent directory creation fails (permissions, read-only fs) → Err.
/// - Temp file creation or write fails → Err (temp file cleaned up).
/// - Atomic rename fails → Err (temp file cleaned up).
///
/// # Idempotency
/// `std::fs::create_dir_all` is idempotent — if intermediate directories
/// already exist, it succeeds silently (EC-16). If the note file already
/// exists as a regular file, it is overwritten.
#[tauri::command]
pub fn create_daily_note(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    // EC-35: reject if the target path already exists as a directory.
    // A bare `.md` filename should never be a directory, but defensive
    // programming requires we check — and return a clear error rather than
    // silently failing later when we try to write a file where a dir sits.
    if target.is_dir() {
        return Err(format!("path exists as a directory: {}", path));
    }

    // Ensure all parent directories exist.
    // create_dir_all is idempotent — EC-02 (first-ever note, no dirs yet) and
    // EC-16 (subfolders already exist) are both handled correctly here.
    if let Some(parent) = target.parent() {
        // Only attempt creation when parent is a non-empty path that does not
        // yet exist as a directory. An empty parent ("") means the target is
        // a bare filename with no leading path component — not expected for
        // absolute paths, but guarded anyway to avoid a no-op create_dir_all.
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
        }
    }

    // Build the temp file path: <target>.tmp.<nanoseconds>
    // Placing the temp file in the same directory as the target ensures the
    // subsequent rename is an atomic same-filesystem operation (POSIX).
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    // The parent was already ensured to exist above, so unwrap_or_default is
    // safe here — the fallback (empty PathBuf) would only occur for a bare
    // filename, which is not a valid absolute path.
    let parent_dir = target.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let temp_filename = format!(
        "{}.tmp.{}",
        target
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        timestamp
    );
    let temp_path = parent_dir.join(&temp_filename);

    // Write to temp file. Any failure here is cleaned up before returning Err.
    let mut file = match fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => {
            // No temp file was created, nothing to clean up.
            return Err(format!(
                "Failed to create temp file for '{}': {}",
                path, e
            ));
        }
    };

    if let Err(e) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temp_path); // clean up partial temp file
        return Err(format!("Failed to write content to '{}': {}", path, e));
    }

    if let Err(e) = file.sync_all() {
        let _ = fs::remove_file(&temp_path); // clean up temp file
        return Err(format!(
            "Failed to sync file to disk for '{}': {}",
            path, e
        ));
    }

    // Atomic rename: temp → target. On POSIX this is guaranteed atomic when
    // both paths are on the same filesystem — guaranteed here because we wrote
    // the temp file to the same parent directory as the target.
    match fs::rename(&temp_path, &target) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp_path); // clean up temp file
            Err(format!("Atomic write failed for '{}': {}", path, e))
        }
    }
}

/// Check whether a batch of absolute paths exist on the filesystem.
///
/// Returns a map of `{ path_string → bool }` where `true` means the path
/// exists (as a file **or** a directory) and `false` means it does not.
///
/// # Arguments
/// * `paths` - Vector of absolute path strings to test.
///
/// # Returns
/// * `Ok(HashMap<String, bool>)` — existence result for each path.
/// * `Err(message)` — reserved for future extensibility (e.g. permission
///   errors on network mounts); never returned in current implementation.
///
/// # Notes
/// - EC-38: an empty input vector returns an empty HashMap immediately without
///   any filesystem operations.
/// - EC-17: nested paths like `/Daily Notes/2026/04/2026-04-23.md` work
///   because `Path::exists()` handles any valid absolute path.
/// - EC-32: paths containing spaces or Unicode characters work correctly
///   because `PathBuf` handles them natively on all supported platforms.
/// - The keys in the returned HashMap are the **exact original strings** passed
///   in — no normalization, canonicalization, or case transformation is applied.
#[tauri::command]
pub fn check_paths_exist(paths: Vec<String>) -> Result<HashMap<String, bool>, String> {
    // EC-38: short-circuit on empty input — no filesystem calls needed.
    if paths.is_empty() {
        return Ok(HashMap::new());
    }

    let mut result = HashMap::with_capacity(paths.len());

    for path_str in paths {
        let exists = std::path::Path::new(&path_str).exists();
        // Insert using the original string as the key so callers can look up
        // results with the same string they passed in (test 18 / EC-32).
        result.insert(path_str, exists);
    }

    Ok(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a unique temporary directory for a test case.
    ///
    /// Each test gets its own subdirectory inside the OS temp dir so tests can
    /// run in parallel without interfering with each other. The directory is
    /// created fresh on every call (any leftover from a previous crashed run is
    /// removed first).
    fn setup_test_dir(prefix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markable_daily_note_test_{}_{}",
            prefix,
            std::process::id()
        ));
        // Remove any leftover from a previous run that crashed before cleanup.
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Remove the temporary directory and all its contents after a test.
    fn cleanup(dir: &std::path::Path) {
        let _ = fs::remove_dir_all(dir);
    }

    // ── create_daily_note tests ───────────────────────────────────────────────

    /// Test 1: creates_file_in_existing_dir
    /// Target directory already exists; file does not yet exist.
    /// Verifies content is written correctly and no .tmp file is left behind.
    #[test]
    fn creates_file_in_existing_dir() {
        let dir = setup_test_dir("existing_dir");
        let note_path = dir.join("2026-04-23.md");
        let content = "# Daily Note\n\nHello World.";

        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            content.to_string(),
        );

        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result);
        assert!(note_path.exists(), "Note file should exist after creation");

        // Verify content was written correctly.
        let written = fs::read_to_string(&note_path).unwrap();
        assert_eq!(written, content);

        // Verify no .tmp file was left behind.
        let tmp_files: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(
            tmp_files.is_empty(),
            "No temp files should remain after successful write"
        );

        cleanup(&dir);
    }

    /// Test 2: creates_nested_directories_automatically
    /// None of the intermediate directories exist before the call.
    /// Verifies all intermediate dirs and the file are created.
    #[test]
    fn creates_nested_directories_automatically() {
        let dir = setup_test_dir("nested_dirs");
        let note_path = dir.join("daily").join("2026").join("04").join("2026-04-23.md");
        let content = "# Nested note";

        assert!(!note_path.parent().unwrap().exists(), "Precondition: parent dir must not exist");

        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            content.to_string(),
        );

        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result);
        assert!(note_path.exists(), "Note file should exist after nested dir creation");
        assert_eq!(fs::read_to_string(&note_path).unwrap(), content);

        cleanup(&dir);
    }

    /// Test 3: idempotent_on_existing_directories
    /// FR-10.2 / EC-16: intermediate directories already exist from a prior
    /// call. The command must succeed silently and overwrite the file.
    #[test]
    fn idempotent_on_existing_directories() {
        let dir = setup_test_dir("idempotent");
        let note_path = dir.join("sub").join("2026-04-23.md");
        let first_content = "# First run";
        let second_content = "# Second run (overwrite)";

        // First call: creates the directory and file.
        create_daily_note(
            note_path.to_string_lossy().to_string(),
            first_content.to_string(),
        ).unwrap();

        // Second call: directory exists, file exists — must overwrite without error.
        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            second_content.to_string(),
        );

        assert!(result.is_ok(), "Second call should succeed: {:?}", result);
        assert_eq!(
            fs::read_to_string(&note_path).unwrap(),
            second_content,
            "File should contain overwritten content"
        );

        cleanup(&dir);
    }

    /// Test 4: returns_error_when_path_is_directory
    /// EC-35: the target path exists as a directory (not a file). Must return
    /// Err containing "exists as a directory".
    #[test]
    fn returns_error_when_path_is_directory() {
        let dir = setup_test_dir("dir_conflict");
        // Create a *directory* at the exact path we will try to write a note to.
        let target_as_dir = dir.join("2026-04-23.md");
        fs::create_dir_all(&target_as_dir).unwrap();

        let result = create_daily_note(
            target_as_dir.to_string_lossy().to_string(),
            "content".to_string(),
        );

        assert!(result.is_err(), "Expected Err for directory target");
        assert!(
            result.unwrap_err().contains("exists as a directory"),
            "Error message should mention 'exists as a directory'"
        );

        cleanup(&dir);
    }

    /// Test 5: creates_file_with_empty_content
    /// Content is an empty string. File should be created with zero bytes.
    #[test]
    fn creates_file_with_empty_content() {
        let dir = setup_test_dir("empty_content");
        let note_path = dir.join("empty.md");

        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            String::new(),
        );

        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result);
        assert!(note_path.exists());
        assert_eq!(fs::read_to_string(&note_path).unwrap(), "");

        cleanup(&dir);
    }

    /// Test 6: creates_file_with_unicode_content
    /// Content includes Unicode characters (emoji, accented letters, CJK).
    /// Verifies round-trip integrity — what is written can be read back exactly.
    #[test]
    fn creates_file_with_unicode_content() {
        let dir = setup_test_dir("unicode");
        let note_path = dir.join("unicode.md");
        // Mix of: emoji, accented Latin, CJK, RTL hint, combining chars.
        let content = "# Unicode Note 🦀\n\nCafé résumé naïve\n日本語テスト\n";

        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            content.to_string(),
        );

        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result);
        assert_eq!(fs::read_to_string(&note_path).unwrap(), content);

        cleanup(&dir);
    }

    /// Test 7: path_with_spaces
    /// EC-32: target path contains spaces in the directory name.
    #[test]
    fn path_with_spaces() {
        let dir = setup_test_dir("spaces");
        // Subdirectory name contains spaces.
        let note_path = dir.join("My Daily Notes").join("2026-04-23.md");
        let content = "# Spaces test";

        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            content.to_string(),
        );

        assert!(result.is_ok(), "Expected Ok(()) for path with spaces: {:?}", result);
        assert!(note_path.exists());

        cleanup(&dir);
    }

    /// Test 8: overwrites_existing_file
    /// File already exists with old content. The command must overwrite it
    /// without error — the frontend only calls this for new notes in practice,
    /// but the command must not fail if the file already exists.
    #[test]
    fn overwrites_existing_file() {
        let dir = setup_test_dir("overwrite");
        let note_path = dir.join("2026-04-23.md");
        fs::write(&note_path, "old content").unwrap();

        let result = create_daily_note(
            note_path.to_string_lossy().to_string(),
            "new content".to_string(),
        );

        assert!(result.is_ok(), "Overwrite should succeed: {:?}", result);
        assert_eq!(fs::read_to_string(&note_path).unwrap(), "new content");

        cleanup(&dir);
    }

    /// Test 9: returns_error_on_unwritable_parent
    /// Parent directory exists but has no write permission.
    /// Expected: Err containing "Permission denied" or "Failed to create".
    ///
    /// Skipped when running as root (root can write to read-only dirs).
    #[test]
    fn returns_error_on_unwritable_parent() {
        // Running as root bypasses Unix permission checks — skip to avoid false failure.
        // We detect root by attempting to write to a read-only directory and bailing
        // out early if the OS user is "root" (environment variable check is a
        // lightweight approximation; the real gate is the permission test below).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            // `id -u` returns "0\n" for root. We spawn it here because there is no
            // stdlib function that returns the effective UID without pulling in libc.
            let uid_output = std::process::Command::new("id")
                .arg("-u")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            let is_root = uid_output == "0";
            if is_root {
                // Root ignores read-only bits — test would produce a false failure.
                return;
            }

            let dir = setup_test_dir("readonly_parent");
            let readonly_dir = dir.join("readonly");
            fs::create_dir_all(&readonly_dir).unwrap();

            // Remove all write bits from the directory so file creation fails.
            let mut perms = fs::metadata(&readonly_dir).unwrap().permissions();
            perms.set_mode(0o444); // r--r--r--
            fs::set_permissions(&readonly_dir, perms).unwrap();

            let note_path = readonly_dir.join("2026-04-23.md");
            let result = create_daily_note(
                note_path.to_string_lossy().to_string(),
                "content".to_string(),
            );

            // Restore permissions before asserting so cleanup can remove the directory
            // even if the assertion panics.
            let mut restore_perms = fs::metadata(&readonly_dir).unwrap().permissions();
            restore_perms.set_mode(0o755);
            let _ = fs::set_permissions(&readonly_dir, restore_perms);
            cleanup(&dir);

            assert!(result.is_err(), "Expected Err for read-only parent dir");
            // The error message could mention "Permission denied" (from the OS) or
            // "Failed to create" (from our wrapper). Accept either.
            let err = result.unwrap_err();
            assert!(
                err.contains("Permission denied") || err.contains("Failed to create"),
                "Unexpected error message: {}",
                err
            );
        }

        // On non-Unix targets (e.g. Windows CI) this test is a no-op.
        #[cfg(not(unix))]
        {
            // Windows ACL model differs — skip this test on non-Unix platforms.
        }
    }

    // ── check_paths_exist tests ───────────────────────────────────────────────

    /// Test 10: returns_true_for_existing_file
    /// A file that was explicitly created must map to `true`.
    #[test]
    fn returns_true_for_existing_file() {
        let dir = setup_test_dir("exists_file");
        let file_path = dir.join("exists.md");
        fs::write(&file_path, "content").unwrap();

        let path_str = file_path.to_string_lossy().to_string();
        let result = check_paths_exist(vec![path_str.clone()]).unwrap();

        assert_eq!(result.get(&path_str), Some(&true));

        cleanup(&dir);
    }

    /// Test 11: returns_false_for_missing_file
    /// A path that was never created must map to `false`.
    #[test]
    fn returns_false_for_missing_file() {
        let dir = setup_test_dir("missing_file");
        let missing = dir.join("does_not_exist.md");
        // Ensure the file really does not exist.
        let _ = fs::remove_file(&missing);

        let path_str = missing.to_string_lossy().to_string();
        let result = check_paths_exist(vec![path_str.clone()]).unwrap();

        assert_eq!(result.get(&path_str), Some(&false));

        cleanup(&dir);
    }

    /// Test 12: returns_true_for_existing_directory
    /// EC-17: a directory path must also map to `true` — existence check is
    /// not restricted to files.
    #[test]
    fn returns_true_for_existing_directory() {
        let dir = setup_test_dir("exists_dir");
        let path_str = dir.to_string_lossy().to_string();

        let result = check_paths_exist(vec![path_str.clone()]).unwrap();

        assert_eq!(result.get(&path_str), Some(&true));

        cleanup(&dir);
    }

    /// Test 13: handles_empty_input
    /// EC-38: empty Vec returns an empty HashMap without any filesystem access.
    #[test]
    fn handles_empty_input() {
        let result = check_paths_exist(vec![]).unwrap();
        assert!(result.is_empty(), "Empty input should yield empty HashMap");
    }

    /// Test 14: handles_mixed_existing_and_missing
    /// Three paths: one existing file, one existing directory, one missing path.
    /// Each must map to the correct boolean independently.
    #[test]
    fn handles_mixed_existing_and_missing() {
        let dir = setup_test_dir("mixed");
        let file_path = dir.join("note.md");
        fs::write(&file_path, "").unwrap();
        // `dir` itself is the existing directory.
        let missing_path = dir.join("ghost.md");

        let file_str = file_path.to_string_lossy().to_string();
        let dir_str = dir.to_string_lossy().to_string();
        let missing_str = missing_path.to_string_lossy().to_string();

        let result = check_paths_exist(vec![
            file_str.clone(),
            dir_str.clone(),
            missing_str.clone(),
        ])
        .unwrap();

        assert_eq!(result.get(&file_str), Some(&true), "Existing file should be true");
        assert_eq!(result.get(&dir_str), Some(&true), "Existing dir should be true");
        assert_eq!(result.get(&missing_str), Some(&false), "Missing path should be false");

        cleanup(&dir);
    }

    /// Test 15: handles_nested_path
    /// EC-17: a nested path several directories deep maps correctly once the
    /// file is created.
    #[test]
    fn handles_nested_path() {
        let dir = setup_test_dir("nested_path");
        let nested = dir.join("daily").join("2026").join("04").join("2026-04-23.md");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, "").unwrap();

        let path_str = nested.to_string_lossy().to_string();
        let result = check_paths_exist(vec![path_str.clone()]).unwrap();

        assert_eq!(result.get(&path_str), Some(&true));

        cleanup(&dir);
    }

    /// Test 16: handles_path_with_spaces
    /// EC-32: directory name contains spaces. PathBuf handles this natively.
    #[test]
    fn handles_path_with_spaces() {
        let dir = setup_test_dir("spaces_check");
        let spaced_dir = dir.join("My Notes 2026");
        fs::create_dir_all(&spaced_dir).unwrap();
        let note = spaced_dir.join("2026-04-23.md");
        fs::write(&note, "").unwrap();

        let path_str = note.to_string_lossy().to_string();
        let result = check_paths_exist(vec![path_str.clone()]).unwrap();

        assert_eq!(result.get(&path_str), Some(&true));

        cleanup(&dir);
    }

    /// Test 17: handles_large_batch
    /// FR-07.3 dot-rendering scenario: 31 paths (one per day in a month),
    /// 20 of which exist. Exactly 20 must map to `true`.
    #[test]
    fn handles_large_batch() {
        let dir = setup_test_dir("large_batch");
        let mut paths: Vec<String> = Vec::new();

        for day in 1u32..=31 {
            let filename = format!("2026-04-{:02}.md", day);
            let path = dir.join(&filename);

            // Create files for days 1–20 only.
            if day <= 20 {
                fs::write(&path, "").unwrap();
            }

            paths.push(path.to_string_lossy().to_string());
        }

        let result = check_paths_exist(paths.clone()).unwrap();

        let true_count = result.values().filter(|&&v| v).count();
        let false_count = result.values().filter(|&&v| !v).count();

        assert_eq!(true_count, 20, "Exactly 20 files should exist");
        assert_eq!(false_count, 11, "Exactly 11 files should be missing");

        cleanup(&dir);
    }

    /// Test 18: result_keys_are_original_path_strings
    /// The HashMap keys must be exactly the strings that were passed in —
    /// no normalization, canonicalization, or case transformation applied.
    #[test]
    fn result_keys_are_original_path_strings() {
        let dir = setup_test_dir("key_identity");
        let note = dir.join("2026-04-23.md");
        fs::write(&note, "").unwrap();

        // Use the exact string form without any further processing.
        let original_str = note.to_string_lossy().to_string();
        let result = check_paths_exist(vec![original_str.clone()]).unwrap();

        // Key must be present and identical to the original string.
        assert!(
            result.contains_key(&original_str),
            "Returned map must contain the original path string as key"
        );

        cleanup(&dir);
    }
}
