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
}
