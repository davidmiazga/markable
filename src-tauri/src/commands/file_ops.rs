//! File operation Tauri commands for the File Browser plugin (Phase 2b).
//!
//! Provides atomic file CRUD commands (create, rename, delete, move, update
//! wiki-links) and a helper to reveal a path in macOS Finder.
//!
//! All file writes use the temp-file-swap pattern (write to `.tmp.{ns}`, sync,
//! rename) for atomicity — consistent with `settings.rs` and `vault.rs`.
//!
//! Error strings are human-readable and surfaced directly in the frontend UI.

use serde::{Deserialize, Serialize};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Result type for update_wiki_links ─────────────────────────────────────────

/// Per-file outcome returned by `update_wiki_links`.
///
/// Separates successfully updated files from files that could not be processed.
/// Callers use `updated` to build the success summary and `failed` to list
/// files that still contain stale links.
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateLinksResult {
    /// Absolute paths of files successfully updated (wiki-links replaced).
    pub updated: Vec<String>,
    /// Absolute paths of files that could not be read, written, or renamed.
    pub failed: Vec<String>,
}

// ── Timestamp helper ──────────────────────────────────────────────────────────

/// Return the current Unix epoch in nanoseconds for temp-file names.
///
/// Nanosecond precision minimises the (already tiny) risk of two concurrent
/// writes to the same path producing the same temp filename.
fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

// ── Temp-file-swap helper ─────────────────────────────────────────────────────

/// Write `content` to `target_path` using an atomic temp-file-swap.
///
/// Sequence:
///   1. Write bytes to `{target}.tmp.{timestamp_ns}`.
///   2. Call `sync_all()` to flush OS write buffer to disk.
///   3. `fs::rename(temp, target)` — atomic on POSIX filesystems.
///   4. On any intermediate failure: delete the temp file and propagate the error
///      so `target` is never partially written (EC-43).
fn atomic_write(target_path: &Path, content: &str) -> Result<(), String> {
    let temp_path = target_path.with_extension(format!("tmp.{}", now_ns()));

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file {:?}: {}", temp_path, e))?;

    file.write_all(content.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to write to temp file: {}", e)
    })?;

    file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to sync temp file to disk: {}", e)
    })?;

    std::fs::rename(&temp_path, target_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Atomic write (rename) failed for {:?}: {}", target_path, e)
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Create a new `.md` file at `path` with the given `content`.
///
/// - Creates all parent directories via `create_dir_all` when they are absent.
/// - Fails with a descriptive error if the path already exists (EC-15).
/// - Uses the atomic temp-file-swap pattern for the write itself.
#[tauri::command]
pub fn create_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    if target.exists() {
        return Err(format!("File already exists: {}", path));
    }

    // Create parent directories if needed (e.g. creating a file in a new folder).
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs for {}: {}", path, e))?;
        }
    }

    atomic_write(&target, &content)
}

/// Rename (or move) a file or directory from `old_path` to `new_path`.
///
/// - Fails if `old_path` does not exist.
/// - Fails if `new_path` already exists (no silent overwrite — EC-17).
/// - Works for both files and directories (delegates to `fs::rename`).
#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let src = PathBuf::from(&old_path);
    let dst = PathBuf::from(&new_path);

    if !src.exists() {
        return Err(format!("Source not found: {}", old_path));
    }

    if dst.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    std::fs::rename(&src, &dst)
        .map_err(|e| format!("Failed to rename {:?} → {:?}: {}", src, dst, e))
}

/// Delete a file at `path`.
///
/// - Fails if the path does not exist.
/// - Fails if the path points to a directory (use `delete_directory` instead).
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("Not found: {}", path));
    }

    if target.is_dir() {
        return Err(format!(
            "Path is a directory, use delete_directory: {}",
            path
        ));
    }

    std::fs::remove_file(&target)
        .map_err(|e| format!("Failed to delete file {}: {}", path, e))
}

/// Recursively delete the directory at `path` and all its contents.
///
/// - Fails if the path does not exist.
/// - Fails if the path is not a directory.
#[tauri::command]
pub fn delete_directory(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("Not found: {}", path));
    }

    if !target.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    std::fs::remove_dir_all(&target)
        .map_err(|e| format!("Failed to delete directory {}: {}", path, e))
}

/// Move a file from `source` to `destination_dir/filename`.
///
/// - Extracts the filename from `source`; the filename is preserved.
/// - Fails if the destination file already exists (EC-19 — no silent overwrite).
/// - Returns the new absolute path on success.
#[tauri::command]
pub fn move_file(source: String, destination_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&source);

    if !src.exists() {
        return Err(format!("Source not found: {}", source));
    }

    // Extract the filename component from the source path.
    let filename = src
        .file_name()
        .ok_or_else(|| format!("Cannot determine filename from: {}", source))?;

    let dst_dir = PathBuf::from(&destination_dir);

    if !dst_dir.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
    }

    let dst = dst_dir.join(filename);

    // EC-19: reject moves that would silently overwrite an existing file.
    if dst.exists() {
        return Err(format!(
            "File '{}' already exists in '{}'",
            filename.to_string_lossy(),
            destination_dir
        ));
    }

    std::fs::rename(&src, &dst)
        .map_err(|e| format!("Failed to move {:?} → {:?}: {}", src, dst, e))?;

    Ok(dst.to_string_lossy().into_owned())
}

/// Create a directory (and all parents) at `path`.
///
/// No-op (returns `Ok(())`) when the directory already exists.
#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory {}: {}", path, e))
}

/// Batch-replace `[[old_link]]` and `[[old_link|display]]` with `new_link` in
/// all files listed in `files_to_update`.
///
/// Per-file behaviour:
/// - If the file does not exist: added to `failed` (EC-26). Continues.
/// - If no occurrences found: skipped (not an error, not in `updated`).
/// - If read or write fails: added to `failed`, original file untouched (EC-43).
/// - On success: updated content written via atomic temp-file-swap; file added
///   to `updated`.
///
/// Returns the accumulated `updated`/`failed` lists rather than stopping on the
/// first failure, so the frontend can show the user a precise per-file summary.
#[tauri::command]
pub fn update_wiki_links(
    files_to_update: Vec<String>,
    old_link: String,
    new_link: String,
) -> Result<UpdateLinksResult, String> {
    let mut updated: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    for file_path in &files_to_update {
        process_wiki_link_file(file_path, &old_link, &new_link, &mut updated, &mut failed);
    }

    Ok(UpdateLinksResult { updated, failed })
}

/// Process a single file for wiki-link replacement.
///
/// Extracted from `update_wiki_links` to keep that function ≤30 lines.
/// Appends to `updated` on success and `failed` on any error.
fn process_wiki_link_file(
    file_path: &str,
    old_link: &str,
    new_link: &str,
    updated: &mut Vec<String>,
    failed: &mut Vec<String>,
) {
    let path = Path::new(file_path);

    // EC-26: file does not exist — skip and record as failed.
    if !path.exists() {
        failed.push(file_path.to_string());
        return;
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => {
            failed.push(file_path.to_string());
            return;
        }
    };

    let new_content = replace_wiki_links(&content, old_link, new_link);

    // Skip files with no occurrences — not an error, not in updated.
    if new_content == content {
        return;
    }

    // Write updated content atomically (EC-43 — no partial writes).
    match atomic_write(path, &new_content) {
        Ok(()) => updated.push(file_path.to_string()),
        Err(_) => failed.push(file_path.to_string()),
    }
}

/// Replace `[[old]]` → `[[new]]` and `[[old|display]]` → `[[new|display]]`.
///
/// Uses a hand-rolled scanner to avoid the `regex` crate dependency.
/// The scan is identical to `extract_wiki_links` in `vault.rs` but produces a
/// new string with replacements rather than a list of stems.
fn replace_wiki_links(content: &str, old_link: &str, new_link: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // Look for `[[`
        if i + 1 < len && bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let open_start = i;
            let inner_start = i + 2;
            let mut j = inner_start;

            // Scan for closing `]]`, stopping at `[`, `\n`.
            let found = loop {
                if j + 1 >= len {
                    break false;
                }
                if bytes[j] == b'\n' || bytes[j] == b'[' {
                    break false;
                }
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    break true;
                }
                j += 1;
            };

            if found {
                // `inner` is everything between `[[` and `]]`.
                if let Ok(inner) = std::str::from_utf8(&bytes[inner_start..j]) {
                    let stem = inner.splitn(2, '|').next().unwrap_or(inner).trim();
                    if stem == old_link {
                        // Replace the stem; preserve any `|display` suffix.
                        let suffix = if let Some(pipe_idx) = inner.find('|') {
                            &inner[pipe_idx..] // includes the `|`
                        } else {
                            ""
                        };
                        result.push_str("[[");
                        result.push_str(new_link);
                        result.push_str(suffix);
                        result.push_str("]]");
                        i = j + 2;
                        continue;
                    }
                }
                // No match — copy the opening `[[` and advance past it.
                result.push_str(&content[open_start..j + 2]);
                i = j + 2;
            } else {
                // No closing `]]` found — copy the character at byte index i.
                // Using utf8_char_len + byte-slice avoids the O(n²) chars().nth(i)
                // re-scan that the original code had (LOW-1 fix).
                let ch_len = utf8_char_len(bytes[i]);
                result.push_str(&content[i..i + ch_len]);
                i += ch_len;
            }
        } else {
            // Copy char at i. Use byte boundary-safe slicing.
            let ch_len = utf8_char_len(bytes[i]);
            result.push_str(&content[i..i + ch_len]);
            i += ch_len;
        }
    }

    result
}

/// Return the byte length of the UTF-8 character starting at `first_byte`.
///
/// This is a minimal implementation for the purpose of advancing the scanner
/// by one code point. Invalid leading bytes are treated as 1-byte sequences
/// (they will be copied verbatim into the output, preserving round-trip fidelity).
fn utf8_char_len(first_byte: u8) -> usize {
    if first_byte & 0x80 == 0 {
        1
    } else if first_byte & 0xE0 == 0xC0 {
        2
    } else if first_byte & 0xF0 == 0xE0 {
        3
    } else if first_byte & 0xF8 == 0xF0 {
        4
    } else {
        1 // invalid leading byte — treat as single byte
    }
}

/// Open a file or directory in macOS Finder using `open -R`.
///
/// The `-R` flag reveals the item (selects it in its parent folder) rather
/// than opening it. Works on macOS only; a no-op placeholder on other platforms.
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Non-macOS: no-op rather than an error — the frontend hides the menu
        // item on non-macOS already; this guard is just a safety net.
        let _ = path;
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ── create_file ───────────────────────────────────────────────────────────

    #[test]
    fn create_file_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.md");
        let result = create_file(path.to_string_lossy().to_string(), "# Hello".to_string());
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Hello");
    }

    #[test]
    fn create_file_fails_if_exists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("exists.md");
        fs::write(&path, "old content").unwrap();

        let result = create_file(path.to_string_lossy().to_string(), "new".to_string());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"));
        // Original content must be untouched.
        assert_eq!(fs::read_to_string(&path).unwrap(), "old content");
    }

    #[test]
    fn create_file_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("deep").join("note.md");
        let result = create_file(path.to_string_lossy().to_string(), "content".to_string());
        assert!(result.is_ok());
        assert!(path.exists());
    }

    // ── rename_file ───────────────────────────────────────────────────────────

    #[test]
    fn rename_file_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.md");
        let dst = dir.path().join("b.md");
        fs::write(&src, "content").unwrap();

        let result = rename_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        );
        assert!(result.is_ok());
        assert!(!src.exists());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "content");
    }

    #[test]
    fn rename_file_fails_if_src_missing() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("missing.md");
        let dst = dir.path().join("out.md");

        let result = rename_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Source not found"));
    }

    #[test]
    fn rename_file_fails_if_dst_exists() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.md");
        let dst = dir.path().join("b.md");
        fs::write(&src, "src").unwrap();
        fs::write(&dst, "dst").unwrap();

        let result = rename_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
        // Both files must still exist unchanged.
        assert_eq!(fs::read_to_string(&src).unwrap(), "src");
        assert_eq!(fs::read_to_string(&dst).unwrap(), "dst");
    }

    // ── delete_file ───────────────────────────────────────────────────────────

    #[test]
    fn delete_file_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("del.md");
        fs::write(&path, "bye").unwrap();

        let result = delete_file(path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(!path.exists());
    }

    #[test]
    fn delete_file_fails_if_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ghost.md");
        let result = delete_file(path.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not found"));
    }

    // ── delete_directory ──────────────────────────────────────────────────────

    #[test]
    fn delete_directory_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("file.md"), "inner").unwrap();

        let result = delete_directory(sub.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(!sub.exists());
    }

    #[test]
    fn delete_directory_fails_if_not_dir() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notadir.md");
        fs::write(&file, "content").unwrap();

        let result = delete_directory(file.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    // ── move_file ─────────────────────────────────────────────────────────────

    #[test]
    fn move_file_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("note.md");
        let dst_dir = dir.path().join("sub");
        fs::create_dir(&dst_dir).unwrap();
        fs::write(&src, "contents").unwrap();

        let result = move_file(
            src.to_string_lossy().to_string(),
            dst_dir.to_string_lossy().to_string(),
        );
        assert!(result.is_ok());
        let new_path = result.unwrap();
        assert!(PathBuf::from(&new_path).exists());
        assert!(!src.exists());
    }

    #[test]
    fn move_file_fails_if_destination_has_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("note.md");
        let dst_dir = dir.path().join("sub");
        fs::create_dir(&dst_dir).unwrap();
        fs::write(&src, "src").unwrap();
        // Create a file with the same name in the destination dir.
        fs::write(dst_dir.join("note.md"), "existing").unwrap();

        let result = move_file(
            src.to_string_lossy().to_string(),
            dst_dir.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        // Original source must be untouched.
        assert_eq!(fs::read_to_string(&src).unwrap(), "src");
    }

    // ── update_wiki_links ─────────────────────────────────────────────────────

    #[test]
    fn update_wiki_links_replaces_exact_match() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "See [[old-name]] and done.").unwrap();

        let result = update_wiki_links(
            vec![path.to_string_lossy().to_string()],
            "old-name".to_string(),
            "new-name".to_string(),
        )
        .unwrap();

        assert_eq!(result.updated.len(), 1);
        assert!(result.failed.is_empty());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "See [[new-name]] and done."
        );
    }

    #[test]
    fn update_wiki_links_preserves_display_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "See [[old-name|Click here]].").unwrap();

        let result = update_wiki_links(
            vec![path.to_string_lossy().to_string()],
            "old-name".to_string(),
            "new-name".to_string(),
        )
        .unwrap();

        assert_eq!(result.updated.len(), 1);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "See [[new-name|Click here]]."
        );
    }

    #[test]
    fn update_wiki_links_skips_file_without_occurrences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("other.md");
        fs::write(&path, "No links here.").unwrap();

        let result = update_wiki_links(
            vec![path.to_string_lossy().to_string()],
            "old-name".to_string(),
            "new-name".to_string(),
        )
        .unwrap();

        // Skipped files are not in either list.
        assert!(result.updated.is_empty());
        assert!(result.failed.is_empty());
    }

    #[test]
    fn update_wiki_links_records_missing_file_as_failed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ghost.md");

        let result = update_wiki_links(
            vec![path.to_string_lossy().to_string()],
            "old-name".to_string(),
            "new-name".to_string(),
        )
        .unwrap();

        assert!(result.updated.is_empty());
        assert_eq!(result.failed.len(), 1);
    }

    #[test]
    fn update_wiki_links_multi_file() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        let c = dir.path().join("c.md");
        fs::write(&a, "[[foo]]").unwrap();
        fs::write(&b, "[[foo|bar]]").unwrap();
        fs::write(&c, "no links").unwrap();

        let result = update_wiki_links(
            vec![
                a.to_string_lossy().to_string(),
                b.to_string_lossy().to_string(),
                c.to_string_lossy().to_string(),
            ],
            "foo".to_string(),
            "baz".to_string(),
        )
        .unwrap();

        assert_eq!(result.updated.len(), 2);
        assert!(result.failed.is_empty());
        assert_eq!(fs::read_to_string(&a).unwrap(), "[[baz]]");
        assert_eq!(fs::read_to_string(&b).unwrap(), "[[baz|bar]]");
        assert_eq!(fs::read_to_string(&c).unwrap(), "no links"); // unchanged
    }

    // ── replace_wiki_links ────────────────────────────────────────────────────

    #[test]
    fn replace_wiki_links_no_match_returns_original() {
        let content = "Hello [[other]] world.";
        let result = replace_wiki_links(content, "target", "replacement");
        assert_eq!(result, content);
    }

    #[test]
    fn replace_wiki_links_multiple_occurrences() {
        let content = "[[a]] then [[a]] again.";
        let result = replace_wiki_links(content, "a", "b");
        assert_eq!(result, "[[b]] then [[b]] again.");
    }

    #[test]
    fn replace_wiki_links_does_not_match_partial_stem() {
        // "foo" should not match "foobar".
        let content = "[[foobar]] and [[foo]].";
        let result = replace_wiki_links(content, "foo", "baz");
        assert_eq!(result, "[[foobar]] and [[baz]].");
    }

    // ── create_directory ──────────────────────────────────────────────────────

    #[test]
    fn create_directory_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let new_dir = dir.path().join("a").join("b").join("c");
        let result = create_directory(new_dir.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(new_dir.is_dir());
    }

    #[test]
    fn create_directory_idempotent_on_existing() {
        let dir = tempfile::tempdir().unwrap();
        // Already exists — should succeed silently.
        let result = create_directory(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
    }
}
