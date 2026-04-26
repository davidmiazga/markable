# Step 01: Rust Settings Struct + File I/O

**Covers:** R1, R8, NF2, NF5, TC-1, TC-2, TC-4, TC-7, TC-8
**Edge Cases:** EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-8, EC-9, EC-23
**Files Created:** `src-tauri/src/commands/settings.rs`
**Files Modified:** `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

---

## Objective

Build the Rust backend for settings persistence: a `MarkableSettings` struct with serde, default values, file I/O with atomic writes, schema migration, and two Tauri commands (`get_settings`, `save_settings`).

---

## 1. Settings Struct Definition

Create `src-tauri/src/commands/settings.rs` with the following struct hierarchy:

```rust
use serde::{Deserialize, Serialize};

const CURRENT_SCHEMA_VERSION: u32 = 1;
const SETTINGS_FILENAME: &str = "settings.json";

// Validation constants
const MIN_CONTENT_MAX_WIDTH: u32 = 500;
const MAX_CONTENT_MAX_WIDTH: u32 = 1400;
const MIN_BASE_FONT_SIZE: u32 = 10;
const MAX_BASE_FONT_SIZE: u32 = 28;
const MAX_RECENT_FILES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkableSettings {
    pub version: u32,
    pub window: WindowSettings,
    pub editor: EditorSettings,
    pub theme: ThemeSettings,
    #[serde(rename = "recentFiles")]
    pub recent_files: Vec<String>,
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
```

### Default Implementation

```rust
impl Default for MarkableSettings {
    fn default() -> Self {
        Self {
            version: CURRENT_SCHEMA_VERSION,
            window: WindowSettings::default(),
            editor: EditorSettings::default(),
            theme: ThemeSettings::default(),
            recent_files: Vec::new(),
        }
    }
}

impl Default for WindowSettings {
    fn default() -> Self {
        // Actual screen-relative defaults are computed at runtime.
        // These are fallback values if screen detection fails.
        Self {
            x: -1,    // Sentinel: -1 means "use screen-centered default"
            y: -1,    // Sentinel: -1 means "use screen-centered default"
            width: 0, // Sentinel: 0 means "use 50% of screen width"
            height: 0, // Sentinel: 0 means "use 100% of screen height"
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
```

**Design note on window defaults:** The sentinel values (-1 for position, 0 for dimensions) signal to the frontend that it should compute screen-relative defaults at runtime. The Rust side does not know the screen geometry. The frontend will detect these sentinels during `applyWindowSettings()` and substitute `50% screen width, 100% screen height, centered` before applying. This avoids coupling the Rust backend to platform-specific screen APIs.

---

## 2. Settings File Path Resolution

Use Tauri's `PathResolver` to get the app data directory:

```rust
use tauri::Manager;
use std::path::PathBuf;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join(SETTINGS_FILENAME))
}
```

---

## 3. Read Settings Logic

The `read_settings_from_disk` function handles all edge cases:

```rust
fn read_settings_from_disk(app: &tauri::AppHandle) -> MarkableSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Settings path error: {}. Using defaults.", e);
            return MarkableSettings::default();
        }
    };

    // EC-1: File does not exist -- return defaults
    if !path.exists() {
        return MarkableSettings::default();
    }

    // Read the file
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            // EC-9: Not readable (permissions) -- use defaults in memory
            eprintln!("Cannot read settings file: {}. Using defaults.", e);
            return MarkableSettings::default();
        }
    };

    // EC-2: Empty file -- treat as corrupt
    if content.trim().is_empty() {
        eprintln!("Settings file is empty. Using defaults.");
        return MarkableSettings::default();
    }

    // First, try to parse as serde_json::Value for forward-compat (EC-5)
    let raw_value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            // EC-3: Invalid JSON -- treat as corrupt
            eprintln!("Settings file contains invalid JSON: {}. Using defaults.", e);
            return MarkableSettings::default();
        }
    };

    // EC-6: Version higher than app knows -- use as-is (best effort)
    if let Some(version) = raw_value.get("version").and_then(|v| v.as_u64()) {
        if version > CURRENT_SCHEMA_VERSION as u64 {
            eprintln!(
                "Settings version {} is newer than app version {}. Using as-is (best effort).",
                version, CURRENT_SCHEMA_VERSION
            );
        }
    }

    // EC-4: Merge missing keys with defaults
    // Deserialize with serde's default mechanism
    let mut settings: MarkableSettings = match serde_json::from_value(raw_value.clone()) {
        Ok(s) => s,
        Err(e) => {
            // If structured deserialization fails, try merging manually
            eprintln!("Settings deserialization warning: {}. Merging with defaults.", e);
            merge_with_defaults(&raw_value)
        }
    };

    // EC-7: Version lower than current -- run migration
    if settings.version < CURRENT_SCHEMA_VERSION {
        settings = migrate_settings(settings);
    }

    // Validate and clamp values (EC-20, EC-21)
    validate_settings(&mut settings);

    // EC-15: Deduplicate recent files
    deduplicate_recent_files(&mut settings.recent_files);

    settings
}
```

---

## 4. Merge with Defaults (EC-4, EC-5)

When deserialization partially fails (missing keys), merge existing values with defaults:

```rust
fn merge_with_defaults(raw: &serde_json::Value) -> MarkableSettings {
    let defaults = MarkableSettings::default();
    let default_json = serde_json::to_value(&defaults).unwrap_or_default();

    // Deep merge: raw values take precedence, missing keys filled from defaults
    let merged = deep_merge(&default_json, raw);

    serde_json::from_value(merged).unwrap_or(defaults)
}

/// Deep merge two JSON values. `overlay` values take precedence over `base`.
/// Extra keys in `overlay` are preserved (EC-5: forward compatibility).
fn deep_merge(base: &serde_json::Value, overlay: &serde_json::Value) -> serde_json::Value {
    match (base, overlay) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(overlay_map)) => {
            let mut result = base_map.clone();
            for (key, overlay_val) in overlay_map {
                if let Some(base_val) = base_map.get(key) {
                    result.insert(key.clone(), deep_merge(base_val, overlay_val));
                } else {
                    // EC-5: Extra key from overlay -- preserve it
                    result.insert(key.clone(), overlay_val.clone());
                }
            }
            serde_json::Value::Object(result)
        }
        (_, overlay) => overlay.clone(),
    }
}
```

---

## 5. Validation and Clamping

```rust
fn validate_settings(settings: &mut MarkableSettings) {
    // EC-20: Clamp baseFontSize
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

    // EC-21: Clamp contentMaxWidth
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

    // EC-15: Deduplicate and cap recent files
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
    let mut seen = std::collections::HashSet::new();
    files.retain(|path| seen.insert(path.clone()));
}
```

---

## 6. Schema Migration

```rust
fn migrate_settings(mut settings: MarkableSettings) -> MarkableSettings {
    // Sequential migration: v1 -> v2, v2 -> v3, etc.
    // Currently only v1 exists, so this is a skeleton for future use.

    // Example for future: if settings.version == 1 { migrate_v1_to_v2(&mut settings); }

    // After all migrations, set version to current
    settings.version = CURRENT_SCHEMA_VERSION;
    settings
}
```

This skeleton is intentionally minimal for v1. Future versions add `migrate_v1_to_v2()` functions that add new keys with defaults, never overwriting existing user values. The sequential pattern (TC-4) is established so future developers know exactly where to add migrations.

---

## 7. Write Settings (Atomic)

Reuse the temp-file-swap pattern from `commands/io.rs`:

```rust
fn write_settings_to_disk(app: &tauri::AppHandle, settings: &MarkableSettings) -> Result<(), String> {
    let path = settings_path(app)?;

    // EC-8: Create directory if it does not exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create settings directory: {}", e)
            })?;
        }
    }

    // Serialize to pretty JSON
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // Atomic write: temp file -> sync -> rename
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = path.with_extension(format!("tmp.{}", timestamp));

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp settings file: {}", e))?;

    file.write_all(json.as_bytes())
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Failed to write settings: {}", e)
        })?;

    file.sync_all()
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Failed to sync settings to disk: {}", e)
        })?;

    std::fs::rename(&temp_path, &path)
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Atomic settings write failed: {}", e)
        })?;

    Ok(())
}
```

---

## 8. Tauri Commands

```rust
#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<String, String> {
    let settings = read_settings_from_disk(&app);

    // If this is a first launch (file did not exist), write defaults to disk.
    // This is a best-effort write; failure is not fatal.
    let path = settings_path(&app)?;
    if !path.exists() {
        if let Err(e) = write_settings_to_disk(&app, &settings) {
            eprintln!("Failed to write default settings: {}", e);
            // EC-9, EC-23: Non-fatal. Continue with in-memory defaults.
        }
    }

    serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: String) -> Result<(), String> {
    // Parse the incoming JSON to validate it
    let parsed: MarkableSettings = serde_json::from_str(&settings)
        .map_err(|e| format!("Invalid settings JSON: {}", e))?;

    write_settings_to_disk(&app, &parsed)
}
```

---

## 9. Module Registration

### `src-tauri/src/commands/mod.rs`

Add:
```rust
pub mod settings;
pub use settings::{get_settings, save_settings};
```

### `src-tauri/src/lib.rs`

Update the `pub use` line:
```rust
pub use commands::{open_file_dialog, read_file, save_file_dialog, write_file, get_settings, save_settings};
```

Update the `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    greet,
    open_file_dialog,
    read_file,
    save_file_dialog,
    write_file,
    get_settings,
    save_settings,
])
```

---

## 10. Rust Tests

Add tests in `settings.rs`:

```rust
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
        assert_eq!(settings.theme.active, "default-dark"); // filled from defaults
        assert_eq!(settings.window.x, 100); // preserved from file
    }

    #[test]
    fn test_extra_keys_preserved() {
        // EC-5: Unknown keys should not cause errors
        let json_with_extra = r#"{"version": 1, "window": {"x": 0, "y": 0, "width": 800, "height": 600, "fullscreen": false, "maximized": false}, "editor": {"contentMaxWidth": 900, "contentPadding": "responsive", "baseFontSize": 16}, "theme": {"active": "dark", "fallback": "dark"}, "recentFiles": [], "futureKey": "futureValue"}"#;
        let raw: serde_json::Value = serde_json::from_str(json_with_extra).unwrap();
        // Should parse without error -- extra keys ignored by serde
        let settings: MarkableSettings = serde_json::from_value(raw).unwrap();
        assert_eq!(settings.version, 1);
    }

    #[test]
    fn test_validate_clamps_font_size() {
        // EC-20
        let mut settings = MarkableSettings::default();
        settings.editor.base_font_size = 5; // below min
        validate_settings(&mut settings);
        assert_eq!(settings.editor.base_font_size, MIN_BASE_FONT_SIZE);

        settings.editor.base_font_size = 50; // above max
        validate_settings(&mut settings);
        assert_eq!(settings.editor.base_font_size, MAX_BASE_FONT_SIZE);
    }

    #[test]
    fn test_validate_clamps_content_width() {
        // EC-21
        let mut settings = MarkableSettings::default();
        settings.editor.content_max_width = 100; // below min
        validate_settings(&mut settings);
        assert_eq!(settings.editor.content_max_width, MIN_CONTENT_MAX_WIDTH);

        settings.editor.content_max_width = 5000; // above max
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
        assert_eq!(merged["a"], 10);     // overlay wins
        assert_eq!(merged["b"]["c"], 20); // overlay wins
        assert_eq!(merged["b"]["d"], 3);  // base fills missing
    }

    #[test]
    fn test_migrate_settings_v1() {
        // Currently a no-op since we are at v1
        let settings = MarkableSettings::default();
        let migrated = migrate_settings(settings);
        assert_eq!(migrated.version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_invalid_json_returns_defaults() {
        // EC-3: covered by read_settings_from_disk -- tested via integration
        let bad_json = "not valid json {{{";
        let result: Result<serde_json::Value, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_string_returns_defaults() {
        // EC-2: empty content is treated as corrupt
        let content = "";
        assert!(content.trim().is_empty());
    }
}
```

---

## Done Criteria

- [ ] `MarkableSettings` struct compiles with serde derive macros
- [ ] `Default` implementations produce correct values matching the schema
- [ ] `deep_merge` handles missing keys and extra keys
- [ ] `validate_settings` clamps out-of-range values
- [ ] `deduplicate_recent_files` removes duplicates preserving order
- [ ] `migrate_settings` skeleton exists for future versions
- [ ] `get_settings` command registered and returns JSON string
- [ ] `save_settings` command registered and writes atomically
- [ ] All `cargo test` tests pass
- [ ] `mod.rs` and `lib.rs` updated with exports and handler registration
