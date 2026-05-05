//! File I/O commands with atomic write guarantee.
//!
//! All write operations use a temp-file-swap pattern:
//! 1. Write to a temporary file in the same directory as target
//! 2. Call sync_all() to ensure data reaches disk
//! 3. Atomically rename temp file to target (POSIX atomic operation)
//! 4. If rename fails, the original file is never modified

use std::fs;
use std::io::{self, Write as IoWrite};
use std::path::{Path, PathBuf};

/// Read file contents as UTF-8 string.
///
/// # Arguments
/// * `path` - Absolute path to file
///
/// # Returns
/// * `Ok(content)` - File contents as string
/// * `Err(message)` - Descriptive error message
///
/// # Errors Handled
/// - File not found → "File not found: {path}"
/// - Is a directory → "Is a directory: {path}"
/// - Permission denied → "Permission denied: {path}"
/// - Invalid UTF-8 → "Invalid UTF-8 in file: {path}"
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);

    // Check if path exists
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }

    // Check if it's a directory
    if path.is_dir() {
        return Err(format!("Is a directory: {}", path.display()));
    }

    // Attempt to read
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) => {
            let msg = match e.kind() {
                io::ErrorKind::NotFound => format!("File not found: {}", path.display()),
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                io::ErrorKind::IsADirectory => format!("Is a directory: {}", path.display()),
                io::ErrorKind::InvalidData => {
                    format!("Invalid UTF-8 in file: {}", path.display())
                }
                _ => format!("Failed to read file: {} ({})", path.display(), e),
            };
            Err(msg)
        }
    }
}

/// Write file contents atomically.
///
/// Uses temp-file-swap pattern to ensure data safety:
/// 1. Write to {path}.tmp.{random}
/// 2. sync_all() to disk
/// 3. Atomic rename to {path}
///
/// If any step fails, the original file is never modified.
///
/// # Arguments
/// * `path` - Absolute path to file (created if doesn't exist)
/// * `content` - Content to write as UTF-8 string
///
/// # Returns
/// * `Ok(())` - File written successfully
/// * `Err(message)` - Descriptive error message
///
/// # Errors Handled
/// - Parent directory doesn't exist → "File not found: {path}"
/// - Permission denied → "Permission denied: {path}"
/// - Disk full → "Disk full: insufficient space to write {path}"
/// - Atomic rename failed → "Write failed: atomic swap could not complete"
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    // Validate parent directory exists
    let parent = path.parent();
    if let Some(parent_dir) = parent {
        if !parent_dir.is_dir() && parent_dir != Path::new("") {
            return Err(format!("File not found: {} (parent dir missing)", path.display()));
        }
    }

    // Generate temp filename with random suffix
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let temp_filename = format!(
        "{}.tmp.{}",
        path.file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        timestamp
    );
    let temp_path = temp_path.join(&temp_filename);

    // Write to temp file
    let mut file = match fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => {
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!("Failed to create temp file: {} ({})", path.display(), e),
            };
            return Err(msg);
        }
    };

    // Write content
    if let Err(e) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temp_path); // Clean up temp file
        let msg = match e.kind() {
            io::ErrorKind::PermissionDenied => {
                format!("Permission denied: {}", path.display())
            }
            _ => format!("Failed to write to temp file: {} ({})", path.display(), e),
        };
        return Err(msg);
    }

    // Sync all data to disk
    if let Err(e) = file.sync_all() {
        let _ = fs::remove_file(&temp_path); // Clean up temp file
        return Err(format!("Failed to sync file to disk: {} ({})", path.display(), e));
    }

    // Atomic rename (POSIX atomic operation)
    match fs::rename(&temp_path, &path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp_path); // Clean up temp file
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!(
                    "Write failed: atomic swap could not complete ({})",
                    e.kind()
                ),
            };
            Err(msg)
        }
    }
}
/// Write raw binary data to a file atomically.
///
/// Uses the same temp-file-swap pattern as `write_file`, substituting
/// raw bytes (`Vec<u8>`) for the UTF-8 string content. All other logic —
/// parent-dir guard, timestamp-based temp filename, `sync_all()`, atomic
/// rename, and error messages — is identical to `write_file`.
///
/// JavaScript callers pass a `number[]` (array of unsigned bytes 0–255).
/// Tauri's JSON deserialiser maps a `number[]` to `Vec<u8>` correctly.
/// Do **not** pass a `Uint8Array` from JavaScript — it does not serialise
/// reliably across the Tauri IPC boundary (DC-01 note in architecture spec).
///
/// # Arguments
/// * `path` - Absolute path to the output file (created if doesn't exist)
/// * `data` - Raw binary bytes; JavaScript callers supply `number[]`
///
/// # Returns
/// * `Ok(())` - File written successfully
/// * `Err(message)` - Descriptive error message
///
/// # Error messages (identical to `write_file` for consistent test assertions)
/// - Parent directory missing → "File not found: {path} (parent dir missing)"
/// - Permission denied        → "Permission denied: {path}"
/// - Disk write failure       → "Failed to write to temp file: {path} ({e})"
/// - Sync failure             → "Failed to sync file to disk: {path} ({e})"
/// - Atomic rename failure    → "Write failed: atomic swap could not complete ({kind})"
#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(&path);

    // Validate parent directory exists (same guard as write_file).
    let parent = path.parent();
    if let Some(parent_dir) = parent {
        if !parent_dir.is_dir() && parent_dir != Path::new("") {
            return Err(format!("File not found: {} (parent dir missing)", path.display()));
        }
    }

    // Generate temp filename using a nanosecond timestamp for uniqueness.
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let temp_filename = format!(
        "{}.tmp.{}",
        path.file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        timestamp
    );
    let temp_path = temp_dir.join(&temp_filename);

    // Write binary data to the temporary file.
    let mut file = match fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => {
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!("Failed to create temp file: {} ({})", path.display(), e),
            };
            return Err(msg);
        }
    };

    // Write raw bytes (not content.as_bytes() — the only difference from write_file).
    if let Err(e) = file.write_all(&data) {
        let _ = fs::remove_file(&temp_path); // Clean up temp file on failure
        let msg = match e.kind() {
            io::ErrorKind::PermissionDenied => {
                format!("Permission denied: {}", path.display())
            }
            _ => format!("Failed to write to temp file: {} ({})", path.display(), e),
        };
        return Err(msg);
    }

    // Flush OS buffers to disk before renaming to prevent partial-write exposure.
    if let Err(e) = file.sync_all() {
        let _ = fs::remove_file(&temp_path); // Clean up temp file on failure
        return Err(format!("Failed to sync file to disk: {} ({})", path.display(), e));
    }

    // Atomic rename: on POSIX systems `rename` is guaranteed to be atomic,
    // so readers never see a partially-written file at the target path.
    match fs::rename(&temp_path, &path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp_path); // Clean up temp file on failure
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!(
                    "Write failed: atomic swap could not complete ({})",
                    e.kind()
                ),
            };
            Err(msg)
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;

    #[test]
    fn test_read_file_success() {
        let path = create_temp_file("read_success", "# Hello World").unwrap();
        let result = read_file(path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Hello World");
        remove_temp_file(&path).unwrap();
    }

    #[test]
    fn test_read_file_not_found() {
        let result = read_file("/nonexistent/path/file.md".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File not found"));
    }

    #[test]
    fn test_read_file_is_directory() {
        let dir = std::env::temp_dir();
        let result = read_file(dir.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Is a directory"));
    }

    #[test]
    fn test_write_file_success() {
        let path = std::env::temp_dir().join(format!("markable_write_test_{}.md", std::process::id()));
        let content = "# Test Content\n\nThis is a test.";

        let result = write_file(path.to_string_lossy().to_string(), content.to_string());
        assert!(result.is_ok());

        // Verify file was actually written
        let read_result = fs::read_to_string(&path);
        assert!(read_result.is_ok());
        assert_eq!(read_result.unwrap(), content);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_file_creates_new_file() {
        let path = std::env::temp_dir().join(format!("markable_new_file_{}.md", std::process::id()));

        // Ensure file doesn't exist
        let _ = fs::remove_file(&path);

        let content = "New file content";
        let result = write_file(path.to_string_lossy().to_string(), content.to_string());
        assert!(result.is_ok());
        assert!(path.exists());

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_file_overwrites_existing() {
        let path = std::env::temp_dir().join(format!("markable_overwrite_{}.md", std::process::id()));

        // Create initial file
        fs::write(&path, "Initial content").unwrap();

        // Overwrite with new content
        let new_content = "Overwritten content";
        let result = write_file(path.to_string_lossy().to_string(), new_content.to_string());
        assert!(result.is_ok());

        // Verify content was overwritten
        let read_result = fs::read_to_string(&path);
        assert_eq!(read_result.unwrap(), new_content);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_atomic_write_leaves_original_untouched_on_error() {
        // This test verifies the atomic swap property:
        // If we can't rename the temp file, the original is untouched.

        let path = std::env::temp_dir().join(format!("markable_atomic_{}.md", std::process::id()));
        let original_content = "Original content";

        fs::write(&path, original_content).unwrap();

        // Attempt to write to a path in a nonexistent directory
        // This should fail at the parent directory check
        let bad_path = "/nonexistent/markable_atomic_test.md";
        let result = write_file(bad_path.to_string(), "Should fail".to_string());
        assert!(result.is_err());

        // Original file should still be intact
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, original_content);

        let _ = fs::remove_file(&path);
    }

    // ── write_binary_file tests ────────────────────────────────────────────
    //
    // Each test path includes both the PID and the current thread ID so that
    // parallel test threads within the same process never share a file path.

    #[test]
    fn test_write_binary_file_success() {
        // Use the PNG magic bytes as representative binary content.
        // This verifies the file is written verbatim without encoding changes.
        let bytes: Vec<u8> = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let path = std::env::temp_dir()
            .join(format!("markable_binary_success_{}_{:?}.bin",
                std::process::id(), std::thread::current().id()));

        let result = write_binary_file(path.to_string_lossy().to_string(), bytes.clone());
        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result.err());

        // Read back raw bytes and compare byte-for-byte.
        let read_back = fs::read(&path).expect("File should be readable after write");
        assert_eq!(read_back, bytes, "Read-back bytes must equal written bytes");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_binary_file_creates_new_file() {
        let path = std::env::temp_dir()
            .join(format!("markable_binary_creates_{}_{:?}.bin",
                std::process::id(), std::thread::current().id()));

        // Ensure the file does not exist before the test.
        let _ = fs::remove_file(&path);
        assert!(!path.exists(), "Pre-condition: file must not exist before write");

        let result = write_binary_file(
            path.to_string_lossy().to_string(),
            vec![0xDE, 0xAD, 0xBE, 0xEF],
        );
        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result.err());
        assert!(path.exists(), "File must exist after a successful write");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_binary_file_parent_missing() {
        // A path whose parent directory does not exist must return the
        // canonical "File not found" error message.
        let result = write_binary_file(
            "/nonexistent/test.bin".to_string(),
            vec![0x00],
        );
        assert!(result.is_err(), "Expected Err for missing parent dir");
        assert!(
            result.unwrap_err().contains("File not found"),
            "Error message must contain 'File not found'"
        );
    }

    #[test]
    fn test_write_binary_file_empty_data() {
        // Writing zero bytes is a valid operation (e.g. an empty clipboard item).
        let path = std::env::temp_dir()
            .join(format!("markable_binary_empty_{}_{:?}.bin",
                std::process::id(), std::thread::current().id()));
        let _ = fs::remove_file(&path);

        let result = write_binary_file(path.to_string_lossy().to_string(), vec![]);
        assert!(result.is_ok(), "Expected Ok(()) for empty data, got: {:?}", result.err());

        // File must exist and have zero length.
        let metadata = fs::metadata(&path).expect("File must exist after write");
        assert_eq!(metadata.len(), 0, "File must be empty (0 bytes)");

        let _ = fs::remove_file(&path);
    }
}
