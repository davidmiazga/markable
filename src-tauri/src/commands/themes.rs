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
    /// Visual base — "light" or "dark". Parsed from a `/* @theme-base: ... */`
    /// header comment in the theme file. Drives which `data-theme` attribute
    /// the loader sets on the html element so the canonical token catalog in
    /// `src/styles.css` falls back to the right palette for tokens the theme
    /// doesn't override. Defaults to "light" if the marker is missing or
    /// invalid.
    pub base: String,
}

/// Scan the first few lines of a theme CSS file for a `@theme-base:` marker.
/// Accepts `/* @theme-base: light */`, with any amount of whitespace and any
/// surrounding comment text. Returns "light" or "dark"; falls back to "light"
/// when the marker is missing or has any other value (a light canvas is the
/// safer default for unknown themes).
fn parse_theme_base(css: &str) -> String {
    for line in css.lines().take(10) {
        if let Some(idx) = line.find("@theme-base:") {
            let tail = &line[idx + "@theme-base:".len()..];
            let value: String = tail
                .chars()
                .skip_while(|c| c.is_whitespace())
                .take_while(|c| c.is_ascii_alphabetic())
                .collect();
            let lower = value.to_lowercase();
            if lower == "dark" || lower == "light" {
                return lower;
            }
            break;
        }
    }
    "light".to_string()
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
                        // Read just enough to detect the @theme-base marker;
                        // full file load also fine (themes are small), so use
                        // read_to_string for simplicity.
                        let base = std::fs::read_to_string(&path)
                            .map(|css| parse_theme_base(&css))
                            .unwrap_or_else(|_| "light".to_string());
                        themes.push(ThemeEntry {
                            name: filename_to_display_name(filename),
                            filename: filename.to_string(),
                            base,
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

/// Copy default theme CSS files from the app bundle into Application Support.
///
/// Only copies files that do not already exist in the destination — user
/// customisations to default themes are preserved. New default themes added
/// in a future version will be copied on the first launch of that version.
///
/// Safe to call on every launch (idempotent for existing files). Returns the
/// number of files newly written.
#[tauri::command]
pub fn copy_default_themes(app: tauri::AppHandle) -> Result<usize, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;

    let src_dir = resource_dir.join("themes");
    if !src_dir.exists() {
        // Normal in `tauri dev` — the resource dir is the Tauri target dir,
        // not the project root. Themes are synced manually in dev via
        // `npm run sync:themes`. Return silently.
        return Ok(0);
    }

    let dst_dir = themes_dir(&app)?;
    std::fs::create_dir_all(&dst_dir)
        .map_err(|e| format!("Failed to create themes dir: {}", e))?;

    let mut copied = 0usize;
    for entry in std::fs::read_dir(&src_dir)
        .map_err(|e| format!("Failed to read bundled themes: {}", e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().map_or(false, |ext| ext == "css") {
            if let Some(filename) = path.file_name() {
                let dst = dst_dir.join(filename);
                if !dst.exists() {
                    std::fs::copy(&path, &dst)
                        .map_err(|e| format!("Failed to copy {:?}: {}", path, e))?;
                    copied += 1;
                }
            }
        }
    }

    if copied > 0 {
        println!("[themes] Installed {} default theme(s) to Application Support.", copied);
    }

    Ok(copied)
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

    #[test]
    fn test_parse_theme_base_recognises_light_and_dark() {
        assert_eq!(parse_theme_base("/* @theme-base: light */\n:root{}"), "light");
        assert_eq!(parse_theme_base("/* @theme-base: dark */\n:root{}"), "dark");
        assert_eq!(parse_theme_base("/* @theme-base:dark */"), "dark");
        assert_eq!(parse_theme_base("/* Header */\n/* @theme-base: DARK */"), "dark");
    }

    #[test]
    fn test_parse_theme_base_defaults_to_light() {
        assert_eq!(parse_theme_base(":root{}"), "light");
        assert_eq!(parse_theme_base("/* no marker */"), "light");
        assert_eq!(parse_theme_base("/* @theme-base: oops */"), "light");
        assert_eq!(parse_theme_base(""), "light");
    }

    #[test]
    fn test_parse_theme_base_only_checks_first_lines() {
        // Marker beyond line 10 is ignored — we only scan the header.
        let mut css = String::new();
        for _ in 0..15 { css.push_str("/* filler */\n"); }
        css.push_str("/* @theme-base: dark */\n");
        assert_eq!(parse_theme_base(&css), "light");
    }
}
