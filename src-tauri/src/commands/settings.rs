//! Settings persistence with atomic writes and schema migration.
//!
//! Stores user settings at ~/Library/Application Support/com.markable.app/settings.json
//! using the same temp-file-swap pattern as document writes.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write as IoWrite;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const CURRENT_SCHEMA_VERSION: u32 = 1;
const SETTINGS_FILENAME: &str = "settings.json";

// Validation constants
const MIN_CONTENT_MAX_WIDTH: u32 = 500;
const MAX_CONTENT_MAX_WIDTH: u32 = 1400;
const MIN_BASE_FONT_SIZE: u32 = 8;
const MAX_BASE_FONT_SIZE: u32 = 48;
const MAX_RECENT_FILES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkableSettings {
    pub version: u32,
    pub window: WindowSettings,
    pub editor: EditorSettings,
    pub theme: ThemeSettings,
    #[serde(rename = "recentFiles")]
    pub recent_files: Vec<String>,
    /// Version stamp written after a successful core plugin copy.
    /// Format: semver string matching tauri.conf.json `version` (e.g. "0.1.0").
    /// `None` means the copy has never been performed on this installation.
    ///
    /// EC-5 / EC-34: optional field — absent in old settings files; serde defaults
    /// to `None` on deserialization when the key is missing, so existing settings
    /// files continue to parse without error.
    #[serde(
        rename = "pluginsCopiedForVersion",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub plugins_copied_for_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSettings {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorSettings {
    #[serde(rename = "contentMaxWidth")]
    pub content_max_width: u32,
    #[serde(rename = "contentPadding")]
    pub content_padding: String,
    #[serde(rename = "baseFontSize")]
    pub base_font_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSettings {
    pub active: String,
    pub fallback: String,
}

// --- Defaults ---

impl Default for MarkableSettings {
    fn default() -> Self {
        Self {
            version: CURRENT_SCHEMA_VERSION,
            window: WindowSettings::default(),
            editor: EditorSettings::default(),
            theme: ThemeSettings::default(),
            recent_files: Vec::new(),
            // None: copy has not been performed yet on a fresh install.
            // The `copy_core_plugins` command writes the version stamp on first copy.
            plugins_copied_for_version: None,
        }
    }
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            x: -1,      // Sentinel: frontend computes screen-centered default
            y: -1,
            width: 0,   // Sentinel: frontend uses 50% of screen width
            height: 0,  // Sentinel: frontend uses 100% of screen height
            fullscreen: false,
            maximized: false,
        }
    }
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            content_max_width: 900,
            content_padding: "responsive".to_string(),
            base_font_size: 16,
        }
    }
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            active: "default-dark".to_string(),
            fallback: "default-dark".to_string(),
        }
    }
}

// --- Path resolution ---

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join(SETTINGS_FILENAME))
}

// --- Deep merge (EC-4, EC-5) ---

fn deep_merge(base: &serde_json::Value, overlay: &serde_json::Value) -> serde_json::Value {
    match (base, overlay) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(overlay_map)) => {
            let mut result = base_map.clone();
            for (key, overlay_val) in overlay_map {
                if let Some(base_val) = base_map.get(key) {
                    result.insert(key.clone(), deep_merge(base_val, overlay_val));
                } else {
                    result.insert(key.clone(), overlay_val.clone());
                }
            }
            serde_json::Value::Object(result)
        }
        (_, overlay) => overlay.clone(),
    }
}

fn merge_with_defaults(raw: &serde_json::Value) -> MarkableSettings {
    let defaults = MarkableSettings::default();
    let default_json = serde_json::to_value(&defaults).unwrap_or_default();
    let merged = deep_merge(&default_json, raw);
    serde_json::from_value(merged).unwrap_or(defaults)
}

// --- Validation (EC-20, EC-21) ---

fn validate_settings(settings: &mut MarkableSettings) {
    if settings.editor.base_font_size < MIN_BASE_FONT_SIZE
        || settings.editor.base_font_size > MAX_BASE_FONT_SIZE
    {
        eprintln!(
            "baseFontSize {} out of range [{}, {}]. Clamping.",
            settings.editor.base_font_size, MIN_BASE_FONT_SIZE, MAX_BASE_FONT_SIZE
        );
        settings.editor.base_font_size = settings
            .editor
            .base_font_size
            .clamp(MIN_BASE_FONT_SIZE, MAX_BASE_FONT_SIZE);
    }

    if settings.editor.content_max_width < MIN_CONTENT_MAX_WIDTH
        || settings.editor.content_max_width > MAX_CONTENT_MAX_WIDTH
    {
        eprintln!(
            "contentMaxWidth {} out of range [{}, {}]. Clamping.",
            settings.editor.content_max_width, MIN_CONTENT_MAX_WIDTH, MAX_CONTENT_MAX_WIDTH
        );
        settings.editor.content_max_width = settings
            .editor
            .content_max_width
            .clamp(MIN_CONTENT_MAX_WIDTH, MAX_CONTENT_MAX_WIDTH);
    }

    deduplicate_recent_files(&mut settings.recent_files);
    if settings.recent_files.len() > MAX_RECENT_FILES {
        settings.recent_files.truncate(MAX_RECENT_FILES);
    }

    // EC-16: Remove directories from recent files
    settings.recent_files.retain(|path| {
        let p = std::path::Path::new(path);
        !p.is_dir()
    });
}

fn deduplicate_recent_files(files: &mut Vec<String>) {
    let mut seen = HashSet::new();
    files.retain(|path| seen.insert(path.clone()));
}

// --- Migration (EC-7) ---

fn migrate_settings(mut settings: MarkableSettings) -> MarkableSettings {
    // Sequential migration: v1 -> v2, v2 -> v3, etc.
    // Currently only v1 exists — skeleton for future use.
    settings.version = CURRENT_SCHEMA_VERSION;
    settings
}

// --- Disk I/O ---

fn read_settings_from_disk(app: &tauri::AppHandle) -> MarkableSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Settings path error: {}. Using defaults.", e);
            return MarkableSettings::default();
        }
    };

    // EC-1: File does not exist
    if !path.exists() {
        return MarkableSettings::default();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            // EC-9: Not readable
            eprintln!("Cannot read settings file: {}. Using defaults.", e);
            return MarkableSettings::default();
        }
    };

    // EC-2: Empty file
    if content.trim().is_empty() {
        eprintln!("Settings file is empty. Using defaults.");
        return MarkableSettings::default();
    }

    // Parse as Value first for forward-compat (EC-5)
    let raw_value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            // EC-3: Invalid JSON
            eprintln!("Settings file contains invalid JSON: {}. Using defaults.", e);
            return MarkableSettings::default();
        }
    };

    // EC-6: Version higher than app knows
    if let Some(version) = raw_value.get("version").and_then(|v| v.as_u64()) {
        if version > CURRENT_SCHEMA_VERSION as u64 {
            eprintln!(
                "Settings version {} is newer than app version {}. Using as-is.",
                version, CURRENT_SCHEMA_VERSION
            );
        }
    }

    // EC-4: Merge missing keys with defaults
    let mut settings: MarkableSettings = match serde_json::from_value(raw_value.clone()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Settings deserialization warning: {}. Merging with defaults.", e);
            merge_with_defaults(&raw_value)
        }
    };

    // EC-7: Run migration if needed
    if settings.version < CURRENT_SCHEMA_VERSION {
        settings = migrate_settings(settings);
    }

    validate_settings(&mut settings);
    deduplicate_recent_files(&mut settings.recent_files);

    settings
}

fn write_settings_to_disk(
    app: &tauri::AppHandle,
    settings: &MarkableSettings,
) -> Result<(), String> {
    let path = settings_path(app)?;

    // EC-8: Create directory if it does not exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {}", e))?;
        }
    }

    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // Atomic write: temp file -> sync -> rename
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = path.with_extension(format!("tmp.{}", timestamp));

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp settings file: {}", e))?;

    file.write_all(json.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to write settings: {}", e)
    })?;

    file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to sync settings to disk: {}", e)
    })?;

    std::fs::rename(&temp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Atomic settings write failed: {}", e)
    })?;

    Ok(())
}

fn write_raw_settings_to_disk(
    app: &tauri::AppHandle,
    value: &serde_json::Value,
) -> Result<(), String> {
    let path = settings_path(app)?;

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {}", e))?;
        }
    }

    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = path.with_extension(format!("tmp.{}", timestamp));

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp settings file: {}", e))?;

    file.write_all(json.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to write settings: {}", e)
    })?;

    file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to sync settings to disk: {}", e)
    })?;

    std::fs::rename(&temp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Atomic settings write failed: {}", e)
    })?;

    Ok(())
}

// --- Tauri Commands ---

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(&app)?;

    // First launch: write defaults and return them
    if !path.exists() {
        let defaults = MarkableSettings::default();
        if let Err(e) = write_settings_to_disk(&app, &defaults) {
            eprintln!("Failed to write default settings: {}", e);
        }
        return serde_json::to_string(&defaults)
            .map_err(|e| format!("Failed to serialize settings: {}", e));
    }

    // Read the raw JSON so frontend-only fields (sizeW, sizeH, contentWidth, etc.)
    // are preserved through the round-trip.
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read settings file: {}", e))?;

    if content.trim().is_empty() {
        let defaults = MarkableSettings::default();
        return serde_json::to_string(&defaults)
            .map_err(|e| format!("Failed to serialize settings: {}", e));
    }

    // Validate it's valid JSON, then return as-is
    let _: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Settings file contains invalid JSON: {}", e))?;

    Ok(content)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: String) -> Result<(), String> {
    // Validate the JSON is a valid object, but write the raw value to preserve
    // frontend-only fields (sizeW, sizeH, contentWidth, wordCount, focusMode, etc.)
    // that aren't in the Rust MarkableSettings struct.
    let raw: serde_json::Value = serde_json::from_str(&settings)
        .map_err(|e| format!("Invalid settings JSON: {}", e))?;
    if !raw.is_object() {
        return Err("Settings must be a JSON object".to_string());
    }
    write_raw_settings_to_disk(&app, &raw)
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings_serialize_roundtrip() {
        let defaults = MarkableSettings::default();
        let json = serde_json::to_string(&defaults).unwrap();
        let parsed: MarkableSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.version, CURRENT_SCHEMA_VERSION);
        assert_eq!(parsed.editor.base_font_size, 16);
        assert_eq!(parsed.editor.content_max_width, 900);
        assert_eq!(parsed.theme.active, "default-dark");
        assert!(parsed.recent_files.is_empty());
    }

    #[test]
    fn test_missing_keys_merge_with_defaults() {
        // EC-4: JSON with missing "theme" key
        let partial_json = r#"{"version": 1, "window": {"x": 100, "y": 200, "width": 800, "height": 600, "fullscreen": false, "maximized": false}, "editor": {"contentMaxWidth": 900, "contentPadding": "responsive", "baseFontSize": 16}, "recentFiles": []}"#;
        let raw: serde_json::Value = serde_json::from_str(partial_json).unwrap();
        let settings = merge_with_defaults(&raw);
        assert_eq!(settings.theme.active, "default-dark");
        assert_eq!(settings.window.x, 100);
    }

    #[test]
    fn test_extra_keys_preserved_in_parse() {
        // EC-5: Unknown keys should not cause errors
        let json_with_extra = r#"{"version": 1, "window": {"x": 0, "y": 0, "width": 800, "height": 600, "fullscreen": false, "maximized": false}, "editor": {"contentMaxWidth": 900, "contentPadding": "responsive", "baseFontSize": 16}, "theme": {"active": "dark", "fallback": "dark"}, "recentFiles": [], "futureKey": "futureValue"}"#;
        let raw: serde_json::Value = serde_json::from_str(json_with_extra).unwrap();
        let settings: MarkableSettings = serde_json::from_value(raw).unwrap();
        assert_eq!(settings.version, 1);
    }

    #[test]
    fn test_validate_clamps_font_size() {
        // EC-20
        let mut settings = MarkableSettings::default();
        settings.editor.base_font_size = 5;
        validate_settings(&mut settings);
        assert_eq!(settings.editor.base_font_size, MIN_BASE_FONT_SIZE);

        settings.editor.base_font_size = 50;
        validate_settings(&mut settings);
        assert_eq!(settings.editor.base_font_size, MAX_BASE_FONT_SIZE);
    }

    #[test]
    fn test_validate_clamps_content_width() {
        // EC-21
        let mut settings = MarkableSettings::default();
        settings.editor.content_max_width = 100;
        validate_settings(&mut settings);
        assert_eq!(settings.editor.content_max_width, MIN_CONTENT_MAX_WIDTH);

        settings.editor.content_max_width = 5000;
        validate_settings(&mut settings);
        assert_eq!(settings.editor.content_max_width, MAX_CONTENT_MAX_WIDTH);
    }

    #[test]
    fn test_deduplicate_recent_files() {
        // EC-15
        let mut files = vec![
            "/a.md".to_string(),
            "/b.md".to_string(),
            "/a.md".to_string(),
            "/c.md".to_string(),
        ];
        deduplicate_recent_files(&mut files);
        assert_eq!(files, vec!["/a.md", "/b.md", "/c.md"]);
    }

    #[test]
    fn test_deep_merge_preserves_overlay_values() {
        let base = serde_json::json!({"a": 1, "b": {"c": 2, "d": 3}});
        let overlay = serde_json::json!({"a": 10, "b": {"c": 20}});
        let merged = deep_merge(&base, &overlay);
        assert_eq!(merged["a"], 10);
        assert_eq!(merged["b"]["c"], 20);
        assert_eq!(merged["b"]["d"], 3);
    }

    #[test]
    fn test_deep_merge_preserves_extra_keys() {
        // EC-5: forward compatibility
        let base = serde_json::json!({"a": 1});
        let overlay = serde_json::json!({"a": 2, "extra": "value"});
        let merged = deep_merge(&base, &overlay);
        assert_eq!(merged["a"], 2);
        assert_eq!(merged["extra"], "value");
    }

    #[test]
    fn test_migrate_settings_v1() {
        let settings = MarkableSettings::default();
        let migrated = migrate_settings(settings);
        assert_eq!(migrated.version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_invalid_json_detected() {
        // EC-3
        let bad_json = "not valid json {{{";
        let result: Result<serde_json::Value, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_string_detected() {
        // EC-2
        let content = "";
        assert!(content.trim().is_empty());
    }

    #[test]
    fn test_recent_files_capped_at_max() {
        let mut settings = MarkableSettings::default();
        for i in 0..15 {
            settings.recent_files.push(format!("/file_{}.md", i));
        }
        validate_settings(&mut settings);
        assert_eq!(settings.recent_files.len(), MAX_RECENT_FILES);
    }

    #[test]
    fn test_ec5_extra_keys_do_not_cause_error() {
        let json = r#"{
            "version": 1,
            "window": {"x": 0, "y": 0, "width": 800, "height": 600, "fullscreen": false, "maximized": false},
            "editor": {"contentMaxWidth": 900, "contentPadding": "responsive", "baseFontSize": 16},
            "theme": {"active": "dark", "fallback": "dark"},
            "recentFiles": [],
            "unknownFutureKey": true,
            "anotherNewSection": {"nested": "value"}
        }"#;
        let settings: Result<MarkableSettings, _> = serde_json::from_str(json);
        assert!(settings.is_ok());
    }

    #[test]
    fn test_ec6_higher_version_parsed_ok() {
        let json = r#"{
            "version": 999,
            "window": {"x": 0, "y": 0, "width": 800, "height": 600, "fullscreen": false, "maximized": false},
            "editor": {"contentMaxWidth": 900, "contentPadding": "responsive", "baseFontSize": 16},
            "theme": {"active": "dark", "fallback": "dark"},
            "recentFiles": []
        }"#;
        let settings: MarkableSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.version, 999);
    }

    #[test]
    fn test_ec16_directories_removed_from_recent() {
        let mut settings = MarkableSettings::default();
        settings.recent_files = vec![
            "/tmp".to_string(),
            "/nonexistent/file.md".to_string(),
        ];
        validate_settings(&mut settings);
        assert!(!settings.recent_files.contains(&"/tmp".to_string()));
    }

    #[test]
    fn test_settings_roundtrip_preserves_all_fields() {
        let mut settings = MarkableSettings::default();
        settings.window.x = 123;
        settings.window.y = 456;
        settings.window.width = 1024;
        settings.window.height = 768;
        settings.window.fullscreen = true;
        settings.editor.base_font_size = 20;
        settings.editor.content_max_width = 1000;
        settings.theme.active = "light".to_string();
        settings.theme.fallback = "dark".to_string();
        settings.recent_files = vec!["/a.md".to_string(), "/b.md".to_string()];

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: MarkableSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.window.x, 123);
        assert_eq!(parsed.window.y, 456);
        assert_eq!(parsed.window.width, 1024);
        assert_eq!(parsed.window.height, 768);
        assert!(parsed.window.fullscreen);
        assert_eq!(parsed.editor.base_font_size, 20);
        assert_eq!(parsed.editor.content_max_width, 1000);
        assert_eq!(parsed.theme.active, "light");
        assert_eq!(parsed.theme.fallback, "dark");
        assert_eq!(parsed.recent_files.len(), 2);
    }

    #[test]
    fn test_ec15_dedup_preserves_first_occurrence() {
        let mut files = vec![
            "/a.md".to_string(),
            "/b.md".to_string(),
            "/a.md".to_string(),
            "/c.md".to_string(),
            "/b.md".to_string(),
        ];
        deduplicate_recent_files(&mut files);
        assert_eq!(files, vec!["/a.md", "/b.md", "/c.md"]);
    }

    #[test]
    fn test_default_json_schema_shape() {
        let defaults = MarkableSettings::default();
        let json = serde_json::to_value(&defaults).unwrap();
        assert!(json.get("version").is_some());
        assert!(json.get("window").is_some());
        assert!(json.get("editor").is_some());
        assert!(json.get("theme").is_some());
        assert!(json.get("recentFiles").is_some());
        // Verify camelCase field names
        let editor = json.get("editor").unwrap();
        assert!(editor.get("contentMaxWidth").is_some());
        assert!(editor.get("baseFontSize").is_some());
        assert!(editor.get("contentPadding").is_some());
    }
}
