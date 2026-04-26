# Step 01 — Rust Commands

**Objective:** Create `src-tauri/src/commands/plugins.rs` with 4 path-confined Tauri commands, wire them into `mod.rs` and `lib.rs`.

**Traceability:** PC-4, PC-7, PC-8, PC-9, EC-1, EC-11, EC-12, EC-13, EC-18, EC-23, EC-24, EC-25, EC-27.

---

## Files to Create

### `src-tauri/src/commands/plugins.rs` (new file)

Pattern: identical to `src-tauri/src/commands/themes.rs`. Path traversal guards are copied verbatim, then tightened with `std::path::Path::components()` check.

```rust
//! User plugin discovery and per-plugin settings I/O.
//!
//! Mirrors the themes.rs pattern: all filesystem access is path-confined to
//! `~/Library/Application Support/com.markable.app/plugins/`.
//!
//! Commands:
//!   list_user_plugins  — list top-level .js files (max 50, lexicographic)
//!   read_plugin_file   — read a .js file as UTF-8 text (max 500 KB)
//!   read_plugin_settings(id) — read plugins/<id>/settings.json or null
//!   write_plugin_settings(id, json) — write plugins/<id>/settings.json

use std::path::PathBuf;
use tauri::Manager;

// ── Directory helpers ─────────────────────────────────────────────────────────

fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join("plugins"))
}

/// Ensure the plugins directory exists (EC-1: first launch).
/// Returns the confirmed path.
fn ensure_plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = plugins_dir(app)?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;
    }
    Ok(dir)
}

// ── Sanitization ──────────────────────────────────────────────────────────────

/// Reject filenames that contain path separators or traversal sequences.
/// This mirrors `read_theme_css` in themes.rs, with an additional component
/// count check: a valid plugin filename is a single path component only.
///
/// EC-11: path traversal guard.
fn sanitize_filename(filename: &str) -> Result<(), String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(format!("Invalid plugin filename: {}", filename));
    }
    // Extra guard: ensure the string resolves to exactly one path component.
    let p = std::path::Path::new(filename);
    let component_count = p.components().count();
    if component_count != 1 {
        return Err(format!("Invalid plugin filename (multi-component): {}", filename));
    }
    Ok(())
}

/// Reject plugin IDs used in settings paths.
/// Must be a non-empty string with no `/`, `\`, `.`, or NUL characters.
///
/// EC-20: invalid id guard.
fn sanitize_plugin_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Plugin id must not be empty".to_string());
    }
    if id.contains('/') || id.contains('\\') || id.contains('.') || id.contains('\0') {
        return Err(format!(
            "Plugin id contains invalid characters: {}",
            id
        ));
    }
    Ok(())
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// List top-level `.js` files in the plugins directory.
///
/// Returns a lexicographically sorted `Vec<String>` of filenames (no paths).
/// Subdirectories are skipped (EC-18). Max 50 results returned; extras are
/// logged at warn level and dropped (EC-27, PC-7).
///
/// The plugins directory is created if absent (EC-1).
#[tauri::command]
pub fn list_user_plugins(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = ensure_plugins_dir(&app)?;

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read plugins directory: {}", e))?;

    let mut filenames: Vec<String> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        // EC-18: skip subdirectories and anything that is not a plain file.
        if !path.is_file() {
            continue;
        }
        if let Some(ext) = path.extension() {
            if ext == "js" {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    filenames.push(name.to_string());
                }
            }
        }
    }

    // Lexicographic sort before cap enforcement (EC-27, PC-7).
    filenames.sort();

    const MAX_PLUGINS: usize = 50;
    if filenames.len() > MAX_PLUGINS {
        let ignored = &filenames[MAX_PLUGINS..];
        eprintln!(
            "[plugins] Warning: {} plugin file(s) ignored (limit {}): {:?}",
            ignored.len(),
            MAX_PLUGINS,
            ignored
        );
        filenames.truncate(MAX_PLUGINS);
    }

    Ok(filenames)
}

/// Read the source text of a plugin `.js` file.
///
/// Path traversal is rejected (EC-11). Binary/invalid-UTF-8 files are rejected
/// (EC-13). Files larger than 500 KB are rejected (EC-12, PC-8).
#[tauri::command]
pub fn read_plugin_file(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    sanitize_filename(&filename)?;

    let dir = plugins_dir(&app)?;
    let path = dir.join(&filename);

    if !path.exists() {
        return Err(format!("Plugin file not found: {}", filename));
    }

    // EC-12, PC-8: reject files larger than 500 KB.
    const MAX_BYTES: u64 = 500 * 1024;
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to stat plugin file: {}", e))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "Plugin file exceeds 500 KB limit ({} bytes): {}",
            metadata.len(),
            filename
        ));
    }

    // EC-13: read_to_string rejects invalid UTF-8.
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read plugin file ({}): {}", filename, e))
}

/// Read per-plugin settings JSON from `plugins/<id>/settings.json`.
///
/// Returns `null` (JSON null serialized as `None`) if the settings file does
/// not yet exist — this is the first-run case (EC-23). Never errors on
/// missing-file; errors only on I/O failures other than NotFound.
///
/// Path is confined: only files directly under `plugins/<id>/` are accessible.
#[tauri::command]
pub fn read_plugin_settings(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Option<String>, String> {
    sanitize_plugin_id(&plugin_id)?;

    let dir = plugins_dir(&app)?;
    let settings_path = dir.join(&plugin_id).join("settings.json");

    match std::fs::read_to_string(&settings_path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // EC-23: no settings file yet — return null, not an error.
            Ok(None)
        }
        Err(e) => Err(format!(
            "Failed to read plugin settings for {}: {}",
            plugin_id, e
        )),
    }
}

/// Write per-plugin settings JSON to `plugins/<id>/settings.json`.
///
/// Creates the `plugins/<id>/` subdirectory if absent (EC-24).
/// Validates that `data` is parseable JSON before writing (EC-25).
/// Uses the temp-file-swap pattern for atomic writes (project convention).
#[tauri::command]
pub fn write_plugin_settings(
    app: tauri::AppHandle,
    plugin_id: String,
    data: String,
) -> Result<(), String> {
    sanitize_plugin_id(&plugin_id)?;

    // EC-25: validate JSON before touching disk.
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("Invalid JSON for plugin settings ({}): {}", plugin_id, e))?;

    let dir = plugins_dir(&app)?;
    let plugin_dir = dir.join(&plugin_id);

    // EC-24: create subdirectory if absent.
    if !plugin_dir.exists() {
        std::fs::create_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to create plugin settings dir: {}", e))?;
    }

    let settings_path = plugin_dir.join("settings.json");

    // Atomic write via temp-file-swap (project convention).
    let tmp_path = plugin_dir.join("settings.json.tmp");
    std::fs::write(&tmp_path, &data)
        .map_err(|e| format!("Failed to write plugin settings tmp file: {}", e))?;
    std::fs::rename(&tmp_path, &settings_path)
        .map_err(|e| format!("Failed to rename plugin settings file: {}", e))?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_rejects_traversal() {
        assert!(sanitize_filename("../evil.js").is_err());
        assert!(sanitize_filename("foo/bar.js").is_err());
        assert!(sanitize_filename("foo\\bar.js").is_err());
    }

    #[test]
    fn sanitize_filename_accepts_valid() {
        assert!(sanitize_filename("my-plugin.js").is_ok());
        assert!(sanitize_filename("plugin_v2.js").is_ok());
        assert!(sanitize_filename("WordCount.js").is_ok());
    }

    #[test]
    fn sanitize_plugin_id_rejects_invalid() {
        assert!(sanitize_plugin_id("").is_err());
        assert!(sanitize_plugin_id("foo/bar").is_err());
        assert!(sanitize_plugin_id("foo.bar").is_err());
        assert!(sanitize_plugin_id("foo\\bar").is_err());
    }

    #[test]
    fn sanitize_plugin_id_accepts_valid() {
        assert!(sanitize_plugin_id("my-plugin").is_ok());
        assert!(sanitize_plugin_id("wordCount").is_ok());
        assert!(sanitize_plugin_id("plugin_v2").is_ok());
    }
}
```

---

## Files to Modify

### `src-tauri/src/commands/mod.rs`

**Current lines 1–14 (full file):**

```rust
pub mod dialogs;
pub mod io;
pub mod settings;
pub mod themes;

pub use dialogs::{open_file_dialog, save_file_dialog, save_html_dialog};
pub use io::{read_file, write_file};
pub use settings::{get_settings, save_settings};
pub use themes::{list_themes, read_theme_css};
```

**After change** — add `pub mod plugins;` and its re-exports:

```rust
pub mod dialogs;
pub mod io;
pub mod plugins;
pub mod settings;
pub mod themes;

pub use dialogs::{open_file_dialog, save_file_dialog, save_html_dialog};
pub use io::{read_file, write_file};
pub use plugins::{list_user_plugins, read_plugin_file, read_plugin_settings, write_plugin_settings};
pub use settings::{get_settings, save_settings};
pub use themes::{list_themes, read_theme_css};
```

### `src-tauri/src/lib.rs`

Two changes required:

**1. Update the `pub use commands::...` line (currently line 25).**

Current:
```rust
pub use commands::{open_file_dialog, read_file, save_file_dialog, save_html_dialog, write_file, get_settings, save_settings, list_themes, read_theme_css};
```

After:
```rust
pub use commands::{
    open_file_dialog, read_file, save_file_dialog, save_html_dialog, write_file,
    get_settings, save_settings,
    list_themes, read_theme_css,
    list_user_plugins, read_plugin_file, read_plugin_settings, write_plugin_settings,
};
```

**2. Add the 4 new commands to `generate_handler![]` (currently lines 289–303).**

Current:
```rust
        .invoke_handler(tauri::generate_handler![
            greet,
            open_file_dialog,
            read_file,
            read_resource_file,
            save_file_dialog,
            save_html_dialog,
            write_file,
            get_settings,
            save_settings,
            list_themes,
            read_theme_css,
            update_recent_files_menu,
            update_theme_menu
        ])
```

After:
```rust
        .invoke_handler(tauri::generate_handler![
            greet,
            open_file_dialog,
            read_file,
            read_resource_file,
            save_file_dialog,
            save_html_dialog,
            write_file,
            get_settings,
            save_settings,
            list_themes,
            read_theme_css,
            list_user_plugins,
            read_plugin_file,
            read_plugin_settings,
            write_plugin_settings,
            update_recent_files_menu,
            update_theme_menu
        ])
```

---

## Verification Checklist

- [ ] `cargo test` passes — all new unit tests in `plugins.rs` pass (sanitize_filename and sanitize_plugin_id).
- [ ] `cargo build` compiles without warnings on the new file.
- [ ] `list_user_plugins` returns `[]` when `plugins/` directory does not exist (and creates it).
- [ ] `list_user_plugins` returns `[]` when `plugins/` exists but contains no `.js` files.
- [ ] `list_user_plugins` skips subdirectories.
- [ ] `list_user_plugins` returns at most 50 filenames, sorted lexicographically.
- [ ] `read_plugin_file` rejects `../evil.js`, `foo/bar.js`, `foo\bar.js` with an error.
- [ ] `read_plugin_file` rejects files larger than 500 KB.
- [ ] `read_plugin_settings` returns `None` (null on frontend) for a plugin with no settings.json.
- [ ] `write_plugin_settings` creates the `plugins/<id>/` subdirectory if absent.
- [ ] `write_plugin_settings` rejects invalid JSON strings.
- [ ] No new capabilities added to `src-tauri/capabilities/default.json`.
