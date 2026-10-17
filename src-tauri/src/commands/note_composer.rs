//! Merge two Markdown notes or split one note into two.
//!
//! Merge appends the source onto the destination, then deletes the source
//! through Data Protection. Split keeps the text before the cursor in the
//! original file and writes the rest to a new file.

use std::fs;
use std::path::Path;

pub fn merge_bodies(destination: &str, source: &str) -> String {
    let dest = destination.trim_end();
    let src = source.trim();
    if dest.is_empty() {
        return if src.is_empty() {
            String::new()
        } else {
            format!("{src}\n")
        };
    }
    if src.is_empty() {
        return format!("{dest}\n");
    }
    format!("{dest}\n\n{src}\n")
}

pub fn split_body(content: &str, at_char: usize) -> Result<(String, String), String> {
    let mut byte = content.len();
    for (index, (offset, _)) in content.char_indices().enumerate() {
        if index == at_char {
            byte = offset;
            break;
        }
    }
    if !content.is_char_boundary(byte) {
        return Err("Split point is not on a character boundary".to_string());
    }
    let head = content[..byte].trim_end();
    let tail = content[byte..].trim_start();
    if head.is_empty() || tail.is_empty() {
        return Err(
            "Nothing to split. Place the cursor between the two parts of the note.".to_string(),
        );
    }
    Ok((with_trailing_newline(head), with_trailing_newline(tail)))
}

fn with_trailing_newline(text: &str) -> String {
    if text.ends_with('\n') {
        text.to_string()
    } else {
        format!("{text}\n")
    }
}

fn read_note(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

fn write_note(path: &str, content: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create folder for {}: {}", path, e))?;
    }
    fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub fn compose_merge_notes(
    app: tauri::AppHandle,
    destination: String,
    source: String,
) -> Result<String, String> {
    if destination == source {
        return Err("Choose a different note to merge in.".to_string());
    }
    let dest_body = read_note(&destination)?;
    let source_body = read_note(&source)?;
    let merged = merge_bodies(&dest_body, &source_body);
    write_note(&destination, &merged)?;
    super::file_recovery::protected_delete_file(&app, &source)?;
    Ok(merged)
}

#[tauri::command]
pub fn compose_split_note(
    path: String,
    at_char: usize,
    new_path: String,
) -> Result<String, String> {
    if path == new_path {
        return Err("The new note needs a different path.".to_string());
    }
    if Path::new(&new_path).exists() {
        return Err(format!("File already exists: {}", new_path));
    }
    let content = read_note(&path)?;
    let (head, tail) = split_body(&content, at_char)?;
    write_note(&new_path, &tail)?;
    write_note(&path, &head)?;
    Ok(head)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_appends_the_source_after_a_blank_line() {
        let merged = merge_bodies("# Dest\n\nHello\n", "# Source\n\nThere\n");
        assert_eq!(merged, "# Dest\n\nHello\n\n# Source\n\nThere\n");
    }

    #[test]
    fn merge_keeps_destination_when_source_is_blank() {
        assert_eq!(merge_bodies("# Dest\n", "  \n"), "# Dest\n");
    }

    #[test]
    fn split_keeps_the_cursor_sides() {
        let (head, tail) = split_body("# A\n\n# B\n", 5).unwrap();
        assert_eq!(head, "# A\n");
        assert_eq!(tail, "# B\n");
    }

    #[test]
    fn split_refuses_an_empty_side() {
        assert!(split_body("# Only\n", 0).is_err());
        assert!(split_body("# Only\n", 7).is_err());
    }

    #[test]
    fn compose_split_writes_both_files() {
        let dir = std::env::temp_dir().join(format!(
            "markable_compose_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("note.md");
        fs::write(&original, "# Keep\n\n# Move\n").unwrap();
        let created = dir.join("move.md");
        let head = compose_split_note(
            original.to_string_lossy().to_string(),
            8,
            created.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(head, "# Keep\n");
        assert_eq!(fs::read_to_string(&original).unwrap(), "# Keep\n");
        assert_eq!(fs::read_to_string(&created).unwrap(), "# Move\n");
        let _ = fs::remove_dir_all(&dir);
    }
}
