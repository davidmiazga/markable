//! Theme discovery and loading.
//!
//! Scans `~/Library/Application Support/com.markable.app/themes/` for `.css`
//! files and returns them as available custom themes.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeEntry {
    /// Display name derived from filename (e.g. "solarized-dark.css" → "Solarized Dark")
    pub name: String,
    /// The CSS filename (e.g. "solarized-dark.css")
    pub filename: String,
}

fn themes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join("themes"))
}

fn filename_to_display_name(filename: &str) -> String {
    let stem = filename.strip_suffix(".css").unwrap_or(filename);
    stem.split(|c: char| c == '-' || c == '_')
        .filter(|s| !s.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    let upper: String = first.to_uppercase().collect();
                    format!("{}{}", upper, chars.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub fn list_themes(app: tauri::AppHandle) -> Result<Vec<ThemeEntry>, String> {
    let dir = themes_dir(&app)?;

    // Create the directory if it doesn't exist (first launch)
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create themes directory: {}", e))?;
    }

    let mut themes = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read themes directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "css" {
                    if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                        themes.push(ThemeEntry {
                            name: filename_to_display_name(filename),
                            filename: filename.to_string(),
                        });
                    }
                }
            }
        }
    }

    // Sort alphabetically by display name
    themes.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(themes)
}

#[tauri::command]
pub fn read_theme_css(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    // Sanitize: reject path traversal
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid theme filename".to_string());
    }

    let dir = themes_dir(&app)?;
    let path = dir.join(&filename);

    if !path.exists() {
        return Err(format!("Theme file not found: {}", filename));
    }

    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read theme file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filename_to_display_name() {
        assert_eq!(filename_to_display_name("solarized-dark.css"), "Solarized Dark");
        assert_eq!(filename_to_display_name("my_custom_theme.css"), "My Custom Theme");
        assert_eq!(filename_to_display_name("monokai.css"), "Monokai");
        assert_eq!(filename_to_display_name("nord-light.css"), "Nord Light");
    }

    #[test]
    fn test_filename_sanitization_rejects_traversal() {
        assert!("../evil.css".contains(".."));
        assert!("foo/bar.css".contains('/'));
        assert!("foo\\bar.css".contains('\\'));
    }
}
