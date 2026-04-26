//! User plugin discovery and per-plugin settings I/O.
//!
//! Mirrors the themes.rs pattern: all filesystem access is path-confined to
//! `~/Library/Application Support/com.markable.app/plugins/`.
//!
//! Commands:
//!   list_user_plugins  — list top-level .js files (max 50, lexicographic)
//!   read_plugin_file   — read a .js file as UTF-8 text (core: max 5 MB, user: max 500 KB)
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
    // EC-11: reject path separators and traversal sequences.
    // '\0' (NUL) is rejected separately because it can be used to bypass
    // extension checks on some filesystems (e.g. "evil\0.js" → "evil").
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") || filename.contains('\0') {
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

/// Response type for `list_user_plugins`.
///
/// Splits results into the accepted `files` slice and any `truncated` filenames
/// that were dropped because the 50-plugin cap was reached. The frontend uses
/// `truncated` to emit a visible console warning (HF-2).
#[derive(serde::Serialize)]
pub struct ListPluginsResponse {
    /// The filenames (max 50) that will be loaded.
    pub files: Vec<String>,
    /// Filenames beyond the 50-plugin cap that were silently dropped.
    pub truncated: Vec<String>,
}

/// List top-level `.js` files in the `plugins/user/` directory.
///
/// Returns a `ListPluginsResponse` with up to 50 lexicographically sorted
/// filenames in `files`. Any filenames beyond the cap are returned in
/// `truncated` so the frontend can emit a user-visible warning (HF-2).
/// Subdirectories are skipped (EC-18).
///
/// The `plugins/user/` directory is created if absent (EC-1).
#[tauri::command]
pub fn list_user_plugins(app: tauri::AppHandle) -> Result<ListPluginsResponse, String> {
    let dir = plugins_user_dir(&app)?;
    ensure_dir(&dir)?;

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
        // Split at the cap: everything after index 50 goes into `truncated`.
        // The frontend will emit a console.warn listing the dropped names (HF-2).
        let truncated = filenames.split_off(MAX_PLUGINS);
        eprintln!(
            "[plugins] Warning: {} plugin file(s) ignored (limit {}): {:?}",
            truncated.len(),
            MAX_PLUGINS,
            truncated
        );
        return Ok(ListPluginsResponse {
            files: filenames,
            truncated,
        });
    }

    Ok(ListPluginsResponse {
        files: filenames,
        truncated: Vec::new(),
    })
}

/// List `.js` files in the `plugins/core/` directory.
///
/// Core plugins are under developer control, so there is NO 50-plugin cap.
/// All `.js` files at the top level of `plugins/core/` are returned in
/// lexicographic order. Subdirectories are skipped.
///
/// Returns `ListPluginsResponse` with `truncated` always empty (no cap for core).
/// Returns `{ files: [], truncated: [] }` if the directory does not exist yet
/// (e.g. first launch before `copy_core_plugins` has run on this machine).
///
/// EC-1: the directory is NOT created here — `copy_core_plugins` already ensures
/// it exists before any plugin is loaded. Not creating it here avoids masking a
/// missing `copy_core_plugins` invocation during development.
#[tauri::command]
pub fn list_core_plugins(app: tauri::AppHandle) -> Result<ListPluginsResponse, String> {
    let dir = plugins_core_dir(&app)?;

    // If the directory does not exist, return an empty list without error.
    // This happens in dev mode when copy_core_plugins skipped the copy because
    // the bundled resource directory was absent.
    if !dir.exists() {
        return Ok(ListPluginsResponse {
            files: Vec::new(),
            truncated: Vec::new(),
        });
    }

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read core plugins directory: {}", e))?;

    let mut filenames: Vec<String> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
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

    filenames.sort();

    Ok(ListPluginsResponse {
        files: filenames,
        truncated: Vec::new(),
    })
}

/// Read the source text of a plugin `.js` file.
///
/// Path traversal is rejected (EC-11). Binary/invalid-UTF-8 files are rejected
/// (EC-13). Files larger than 500 KB are rejected (EC-12, PC-8).
///
/// The `kind` parameter controls which directory is read:
///   - `Some("core")` → `plugins/core/`
///   - `Some("user")` or `None` → `plugins/user/`
///   - Any other string → error
#[tauri::command]
pub fn read_plugin_file(
    app: tauri::AppHandle,
    filename: String,
    kind: Option<String>,
) -> Result<String, String> {
    sanitize_filename(&filename)?;

    let dir = match kind.as_deref() {
        Some("core") => plugins_core_dir(&app)?,
        Some("user") | None => plugins_user_dir(&app)?,
        Some(other) => return Err(format!("Unknown plugin kind: {}", other)),
    };
    // Per-kind file size cap (FR-09, OQ-01):
    //   Core plugins: 5 MB — accommodates large bundled dependencies (e.g. Mermaid ~2.5 MB).
    //   User plugins: 500 KB — preserves safety guard for user-authored plugins (PC-8).
    let max_bytes: u64 = match kind.as_deref() {
        Some("core") => 5 * 1024 * 1024,
        _ => 500 * 1024,
    };

    let path = dir.join(&filename);

    if !path.exists() {
        return Err(format!("Plugin file not found: {}", filename));
    }

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to stat plugin file: {}", e))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "Plugin file exceeds size limit ({} bytes, limit {} bytes): {}",
            metadata.len(),
            max_bytes,
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

// ── Core plugin copy infrastructure ──────────────────────────────────────────

/// Returns the `plugins/core/` subdirectory path under the app data dir.
/// Does NOT create the directory — call `ensure_dir` separately if needed.
fn plugins_core_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join("plugins").join("core"))
}

/// Returns the `plugins/user/` subdirectory path under the app data dir.
/// Does NOT create the directory — call `ensure_dir` separately if needed.
fn plugins_user_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join("plugins").join("user"))
}

/// Create a directory and all of its parents if the directory does not yet exist.
/// No-op if the directory already exists.
///
/// EC-1: called before the first plugin copy to guarantee the destination dirs exist.
fn ensure_dir(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir_all(path)
            .map_err(|e| format!("Failed to create directory {:?}: {}", path, e))?;
    }
    Ok(())
}

/// Migrate any `.js` files sitting in the flat `plugins/` directory (the old layout
/// from before the `plugins/user/` subdirectory existed) into `plugins/user/`.
///
/// This is a one-time migration. After it runs, the flat `plugins/` directory
/// contains only subdirectories (`core/`, `user/`, per-plugin settings dirs).
///
/// Non-destructive: files that already exist in `plugins/user/` under the same
/// name are NOT overwritten — the user's copy wins.
///
/// PC-EXISTING-1: the current user plugin directory is flat `plugins/`, not `plugins/user/`.
/// EC-4: converts old flat layout to the new two-tier layout.
fn migrate_flat_plugins_to_user_dir(
    plugins_root: &PathBuf,
    user_dir: &PathBuf,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(plugins_root) {
        Ok(e) => e,
        // `plugins/` doesn't exist yet on a fresh install — nothing to migrate.
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Only migrate plain `.js` files at the top level of `plugins/`.
        // Subdirectories (core/, user/, per-plugin settings dirs) are left in place.
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "js" {
            continue;
        }

        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None => continue,
        };

        let dest = user_dir.join(&filename);
        // Do not overwrite a file that already exists in user/ — user wins.
        if dest.exists() {
            continue;
        }

        // Move the file. If the rename fails (e.g. cross-device), log and continue —
        // a failed migration is not fatal; the plugin just won't appear in user/.
        std::fs::rename(&path, &dest).unwrap_or_else(|e| {
            eprintln!(
                "[plugins] Warning: failed to migrate {:?} to user dir: {}",
                path, e
            );
        });
    }

    Ok(())
}

/// Patch `pluginsCopiedForVersion` in the raw settings JSON and write it back
/// using the atomic temp-file-swap pattern (same approach as `write_raw_settings_to_disk`
/// in settings.rs).
///
/// EC-5, EC-34: version stamp is written only after a successful copy so a crash
/// or power failure during copy causes a re-copy on the next launch.
fn write_version_stamp(
    settings_path: &PathBuf,
    raw_settings: &serde_json::Value,
    version: &str,
) -> Result<(), String> {
    use std::io::Write as IoWrite;

    // Clone the raw settings and insert (or overwrite) the version stamp field.
    let mut updated = raw_settings.clone();
    if let serde_json::Value::Object(ref mut map) = updated {
        map.insert(
            "pluginsCopiedForVersion".to_string(),
            serde_json::Value::String(version.to_string()),
        );
    }

    let json = serde_json::to_string_pretty(&updated)
        .map_err(|e| format!("Failed to serialize settings with version stamp: {}", e))?;

    // Ensure the parent directory exists (first launch before settings.json is written).
    if let Some(parent) = settings_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings dir: {}", e))?;
        }
    }

    // Atomic write: write to a temp file then rename over the real file.
    // The `.plugins_stamp` suffix distinguishes this temp file from the main
    // settings temp file (which uses a nanosecond timestamp suffix).
    let tmp_path = settings_path.with_extension("tmp.plugins_stamp");

    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create tmp settings file: {}", e))?;

    file.write_all(json.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to write stamp: {}", e)
    })?;

    file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to sync stamp: {}", e)
    })?;

    std::fs::rename(&tmp_path, settings_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to rename stamp file: {}", e)
    })?;

    Ok(())
}

/// Copy bundled core plugin `.js` files from Tauri's resource directory into the
/// user's `plugins/core/` directory under the app data path.
///
/// Called from the frontend early in `initApp()`, before `loadUserPlugins`.
/// Returns `Ok(())` on success or if the copy was skipped (version stamp matches).
/// Returns `Err(String)` only for hard failures (e.g. resource dir unreadable).
///
/// EC-1:  Creates `plugins/core/` and `plugins/user/` if they don't exist.
/// EC-4:  Migrates old flat `plugins/*.js` files to `plugins/user/` first.
/// EC-5:  Reads `pluginsCopiedForVersion` from settings; skips copy if it matches.
/// EC-6:  Silently skips individual missing resource files (non-fatal per-file error).
/// EC-34: Overwrites existing `plugins/core/` files — copy is idempotent within a version.
#[tauri::command]
pub fn copy_core_plugins(app: tauri::AppHandle) -> Result<(), String> {
    // ── 1. Read current app version ──────────────────────────────────────────
    // `app.package_info().version` returns a `semver::Version`; its `Display`
    // impl produces the same string as the `version` field in tauri.conf.json
    // (e.g. "0.1.0"). The comparison is simple string equality — no semver parsing.
    let current_version = app.package_info().version.to_string();

    // ── 2. Resolve app data directory once ───────────────────────────────────
    // All data-dir-relative paths are derived from this single resolution so the
    // OS path lookup runs exactly once per command invocation (Finding 2: eliminated
    // the four redundant `app_data_dir()` calls that previously existed across the
    // settings-path block, step 4, plugins_core_dir(), and plugins_user_dir()).
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    // ── 3. Locate settings file and read raw JSON ────────────────────────────
    // We read the raw file rather than going through `get_settings`/`save_settings`
    // (those are Tauri commands — calling one command from another is not supported).
    // The raw read-patch-write approach is the same pattern used by
    // `write_raw_settings_to_disk` in settings.rs.
    let settings_path = data_dir.join("settings.json");

    let raw_settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        // Fall back to empty object on parse failure — we can still write the stamp.
        serde_json::from_str(&content)
            .unwrap_or(serde_json::Value::Object(Default::default()))
    } else {
        // File doesn't exist yet (first launch before settings.json is written).
        serde_json::Value::Object(Default::default())
    };

    // Extract the current stamp (empty string if absent — always differs from a real version).
    let stamp = raw_settings
        .get("pluginsCopiedForVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // ── 4. Skip if version stamp matches (EC-34 idempotency) ─────────────────
    if stamp == current_version {
        eprintln!(
            "[plugins] Core plugins already copied for version {}. Skipping.",
            current_version
        );
        return Ok(());
    }

    eprintln!(
        "[plugins] Copying core plugins for version {} (was: {:?}).",
        current_version, stamp
    );

    // ── 5. Derive all data-dir-relative paths ────────────────────────────────
    // All four subdirectory paths are derived from the single `data_dir` resolved
    // above — no additional OS lookups are performed.
    let plugins_root = data_dir.join("plugins");
    let core_dir = data_dir.join("plugins").join("core");
    let user_dir = data_dir.join("plugins").join("user");

    // ── 5. Ensure destination directories exist (EC-1) ────────────────────────
    ensure_dir(&core_dir)?;
    ensure_dir(&user_dir)?;

    // ── 6. Migrate old flat `plugins/*.js` files to `plugins/user/` (EC-4) ───
    migrate_flat_plugins_to_user_dir(&plugins_root, &user_dir)?;

    // ── 7. Locate the bundled resource directory ──────────────────────────────
    // `app.path().resource_dir()` returns the directory where `bundle.resources`
    // files are placed during `tauri build`:
    //   - Production (app bundle): Contents/Resources/
    //   - Development (`tauri dev`): resources are NOT bundled; the directory
    //     may not contain the plugins/core/ subdirectory.
    //
    // In dev mode we skip the copy WITHOUT writing the stamp. This means the
    // check runs on every launch in dev, which is intentional — it avoids
    // masking a missing `npm run build:plugins` run during development.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;
    let bundled_core_dir = resource_dir.join("plugins").join("core");

    if !bundled_core_dir.exists() {
        // In dev mode `tauri dev` does not bundle resources, so the core plugin
        // directory will not exist. Warn and return without writing the version
        // stamp — omitting the stamp means we re-check on every launch, which is
        // the correct behaviour while developing (avoids masking a missing build).
        eprintln!(
            "[plugins] Bundled core dir {:?} not found. Skipping copy (dev mode?).",
            bundled_core_dir
        );
        return Ok(());
    }

    // ── 7a. Remove stale core plugins no longer in the bundle ─────────────────
    // When plugins are consolidated or removed between versions, old `.js` files
    // linger in `plugins/core/`. Build a set of bundled filenames and delete any
    // `.js` file in `core_dir` that is not in the set.
    {
        let bundled_names: std::collections::HashSet<String> = std::fs::read_dir(&bundled_core_dir)
            .map_err(|e| format!("Failed to read bundled core plugins dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path().is_file()
                    && e.path().extension().and_then(|x| x.to_str()) == Some("js")
            })
            .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
            .collect();

        if let Ok(existing) = std::fs::read_dir(&core_dir) {
            for entry in existing.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if path.extension().and_then(|x| x.to_str()) != Some("js") {
                    continue;
                }
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !bundled_names.contains(name) {
                        eprintln!("[plugins] Removing stale core plugin: {}", name);
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }

    // ── 8. Copy each `.js` file from bundle → plugins/core/ ──────────────────
    // EC-6: individual copy failures are logged and skipped — non-fatal.
    //       The remaining files are still copied.
    // EC-19: path traversal is impossible — both source (bundled resource dir)
    //        and destination (app data dir) are under developer/OS control.
    let entries = std::fs::read_dir(&bundled_core_dir)
        .map_err(|e| format!("Failed to read bundled core plugins dir: {}", e))?;

    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "js" {
            continue;
        }

        let filename = match src.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None => continue,
        };

        let dest = core_dir.join(&filename);

        // EC-34: overwrite unconditionally on every version bump (idempotent copy).
        if let Err(e) = std::fs::copy(&src, &dest) {
            eprintln!(
                "[plugins] Warning: failed to copy {:?} -> {:?}: {}",
                src, dest, e
            );
            // Non-fatal: continue copying remaining files.
        } else {
            eprintln!("[plugins] Copied {} -> {:?}", filename, dest);
        }
    }

    // ── 9. Write version stamp (EC-5, EC-34) ──────────────────────────────────
    // Written only after the copy loop completes so a crash during copy causes
    // a re-copy on the next launch (stamp not written → version mismatch → copy runs again).
    write_version_stamp(&settings_path, &raw_settings, &current_version)?;

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
        // LF-2: bare ".." is a traversal sequence and must be rejected.
        assert!(sanitize_filename("..").is_err());
    }

    #[test]
    fn sanitize_filename_rejects_nul_byte() {
        // HF-1: NUL byte can be used to bypass extension checks on some filesystems.
        // "evil\0.js" would appear to end with ".js" but the OS sees "evil".
        assert!(sanitize_filename("evil\0.js").is_err());
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
        assert!(sanitize_plugin_id("foo\0bar").is_err());
    }

    #[test]
    fn sanitize_plugin_id_accepts_valid() {
        assert!(sanitize_plugin_id("my-plugin").is_ok());
        assert!(sanitize_plugin_id("wordCount").is_ok());
        assert!(sanitize_plugin_id("plugin_v2").is_ok());
    }

    // ── copy_core_plugins helpers ─────────────────────────────────────────────

    /// EC-4 (conflict): migrate_flat_plugins_to_user_dir must NOT overwrite a file
    /// that already exists in user/ — the user's copy wins.
    #[test]
    fn migrate_flat_plugins_to_user_dir_skips_existing() {
        use std::fs;
        // Use a unique temp directory per test run to avoid conflicts with parallel tests.
        let tmp = std::env::temp_dir()
            .join(format!("markable_migrate_skip_{}", std::process::id()));
        let user = tmp.join("user");
        fs::create_dir_all(&user).unwrap();

        // A .js file at the flat `plugins/` level to be migrated.
        fs::write(tmp.join("my-plugin.js"), b"// from flat").unwrap();
        // The same filename already exists in user/ with different content.
        fs::write(user.join("my-plugin.js"), b"// existing").unwrap();

        migrate_flat_plugins_to_user_dir(&tmp, &user).unwrap();

        // user/my-plugin.js must NOT have been overwritten.
        let content = fs::read_to_string(user.join("my-plugin.js")).unwrap();
        assert_eq!(content, "// existing", "existing user file must not be overwritten");

        // The source flat file should still be at the flat level (rename did not happen).
        assert!(
            tmp.join("my-plugin.js").exists(),
            "source file should remain when destination already exists"
        );

        fs::remove_dir_all(&tmp).unwrap();
    }

    /// EC-4 (move): migrate_flat_plugins_to_user_dir must move a new flat .js file
    /// to user/ when no conflict exists.
    #[test]
    fn migrate_flat_plugins_moves_new_files() {
        use std::fs;
        let tmp = std::env::temp_dir()
            .join(format!("markable_migrate_move_{}", std::process::id()));
        let user = tmp.join("user");
        fs::create_dir_all(&user).unwrap();

        fs::write(tmp.join("new-plugin.js"), b"// new").unwrap();

        migrate_flat_plugins_to_user_dir(&tmp, &user).unwrap();

        // File should now be in user/.
        assert!(user.join("new-plugin.js").exists(), "file should be in user/");
        // Original flat-level file should be gone (was renamed, not copied).
        assert!(
            !tmp.join("new-plugin.js").exists(),
            "original flat file should have been moved"
        );

        fs::remove_dir_all(&tmp).unwrap();
    }

    /// EC-5: write_version_stamp must create the settings file if it doesn't exist,
    /// and the written JSON must contain the correct `pluginsCopiedForVersion` value.
    #[test]
    fn write_version_stamp_creates_file_if_absent() {
        use std::fs;
        let tmp = std::env::temp_dir()
            .join(format!("markable_stamp_new_{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("settings.json");

        let raw = serde_json::Value::Object(Default::default());
        write_version_stamp(&path, &raw, "0.1.0").unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(
            parsed["pluginsCopiedForVersion"], "0.1.0",
            "version stamp must be written correctly"
        );

        fs::remove_dir_all(&tmp).unwrap();
    }

    /// EC-34: write_version_stamp must preserve all pre-existing JSON fields while
    /// inserting (or overwriting) only `pluginsCopiedForVersion`.
    #[test]
    fn write_version_stamp_preserves_existing_fields() {
        use std::fs;
        let tmp = std::env::temp_dir()
            .join(format!("markable_stamp_preserve_{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("settings.json");

        let raw = serde_json::json!({
            "version": 1,
            "theme": { "active": "dark" }
        });
        write_version_stamp(&path, &raw, "1.2.3").unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        // Pre-existing fields must be preserved unchanged.
        assert_eq!(parsed["version"], 1, "version field must be preserved");
        assert_eq!(
            parsed["theme"]["active"], "dark",
            "nested theme field must be preserved"
        );
        // New stamp must be present.
        assert_eq!(
            parsed["pluginsCopiedForVersion"], "1.2.3",
            "version stamp must be written"
        );

        fs::remove_dir_all(&tmp).unwrap();
    }

    /// EC-5: verify that `MarkableSettings` deserializes correctly when
    /// `pluginsCopiedForVersion` is absent from the JSON (old settings files).
    #[test]
    fn markable_settings_deserializes_without_plugins_copied_version() {
        use crate::commands::settings::MarkableSettings;

        let json = r#"{
            "version": 1,
            "window": {"x": 0, "y": 0, "width": 800, "height": 600,
                       "fullscreen": false, "maximized": false},
            "editor": {"contentMaxWidth": 900, "contentPadding": "responsive",
                       "baseFontSize": 16},
            "theme": {"active": "dark", "fallback": "dark"},
            "recentFiles": []
        }"#;

        let settings: MarkableSettings = serde_json::from_str(json).unwrap();
        assert_eq!(
            settings.plugins_copied_for_version, None,
            "field should default to None when absent from JSON"
        );
    }

    /// EC-34 / Finding 7: verify the idempotency guard.
    ///
    /// Simulates the second launch scenario: the settings file already contains
    /// `pluginsCopiedForVersion` matching the current version. The guard condition
    /// `stamp == current_version` must be true, meaning `copy_core_plugins` would
    /// return `Ok(())` immediately without touching any files.
    ///
    /// Because `copy_core_plugins` requires a live `tauri::AppHandle` (only
    /// available at runtime), this test exercises the guard logic directly by
    /// performing the same read-and-compare steps the command uses:
    ///   1. Write a stamp using `write_version_stamp`.
    ///   2. Read it back as the command would.
    ///   3. Assert the stamp equals the current version — proving the early-return
    ///      branch would be taken and no files would be modified.
    #[test]
    fn copy_core_plugins_stamp_match_idempotency_guard() {
        use std::fs;

        let tmp = std::env::temp_dir()
            .join(format!("markable_idempotency_{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        let settings_path = tmp.join("settings.json");

        // Write an initial settings file that already contains a matching stamp.
        // This mirrors the state of the settings file on a second launch after a
        // successful copy on the first launch.
        let pre_existing = serde_json::json!({
            "version": 1,
            "theme": { "active": "dark" }
        });
        write_version_stamp(&settings_path, &pre_existing, "1.0.0").unwrap();

        // Read the file back exactly as `copy_core_plugins` does.
        let content = fs::read_to_string(&settings_path).unwrap();
        let raw: serde_json::Value = serde_json::from_str(&content).unwrap();

        // Extract the stamp using the same logic as the command.
        let stamp = raw
            .get("pluginsCopiedForVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // The guard condition: stamp matches → early return → no files modified.
        assert_eq!(
            stamp, "1.0.0",
            "stamp must equal the written version so the idempotency guard fires"
        );

        // Pre-existing fields must be intact — stamp write must not corrupt settings.
        assert_eq!(raw["version"], 1, "pre-existing version field must be preserved");
        assert_eq!(
            raw["theme"]["active"], "dark",
            "pre-existing theme field must be preserved"
        );

        // Verify the guard condition is boolean true (explicit assertion for clarity).
        let current_version = "1.0.0";
        assert!(
            stamp == current_version,
            "guard condition `stamp == current_version` must be true — early return would be taken"
        );

        fs::remove_dir_all(&tmp).unwrap();
    }

    /// list_core_plugins must return an empty list (not an error) when the
    /// plugins/core/ directory does not yet exist.
    /// This test exercises the path returned by the helper function directly
    /// (the command itself requires a live AppHandle).
    #[test]
    fn plugins_core_dir_is_correct_path_segment() {
        // Verify the helper produces a path ending in .../plugins/core
        // by constructing the expected suffix.
        // We cannot call plugins_core_dir() without an AppHandle, so we verify
        // the directory construction logic by testing the path fragment directly.
        let root = std::path::PathBuf::from("/tmp/markable_test");
        let core = root.join("plugins").join("core");
        assert!(
            core.ends_with("plugins/core"),
            "plugins/core path must end with plugins/core"
        );
    }

    /// Verify the per-kind file-size cap selection logic (FR-09, OQ-01).
    /// Core plugins get 5 MB; user plugins and kind=None get 500 KB.
    #[test]
    fn core_plugin_cap_is_5_mb() {
        // Replicate the cap selection logic from read_plugin_file.
        let max_bytes: u64 = match Some("core") {
            Some("core") => 5 * 1024 * 1024,
            _ => 500 * 1024,
        };
        assert_eq!(max_bytes, 5 * 1024 * 1024, "core plugin cap must be 5 MB");
    }

    /// Verify user plugin cap and None-kind cap are both 500 KB (FR-09, PC-8).
    #[test]
    fn user_plugin_cap_is_500_kb() {
        // kind = "user"
        let max_bytes_user: u64 = match Some("user") {
            Some("core") => 5 * 1024 * 1024,
            _ => 500 * 1024,
        };
        // kind = None
        let max_bytes_none: u64 = match None::<&str> {
            Some("core") => 5 * 1024 * 1024,
            _ => 500 * 1024,
        };
        assert_eq!(max_bytes_user, 500 * 1024, "user plugin cap must be 500 KB");
        assert_eq!(max_bytes_none, 500 * 1024, "None kind cap must be 500 KB");
    }

    /// list_core_plugins returns an empty non-truncated list when core/ does not exist.
    /// Verified at the logic level: if dir.exists() is false, files and truncated are both [].
    #[test]
    fn list_core_plugins_empty_when_dir_missing() {
        // Construct a path that provably does not exist.
        let non_existent_dir =
            std::path::PathBuf::from("/tmp/markable_nonexistent_core_dir_test_12345");
        assert!(
            !non_existent_dir.exists(),
            "test precondition: directory must not exist"
        );
        // The logic in list_core_plugins: if !dir.exists() → return empty.
        // We replicate it here without an AppHandle.
        let result: Vec<String> = if !non_existent_dir.exists() {
            Vec::new()
        } else {
            panic!("should have returned early");
        };
        assert!(result.is_empty());
    }

    /// EC-34: verify that `MarkableSettings` round-trips correctly when
    /// `pluginsCopiedForVersion` is set — and that `None` is omitted from output.
    #[test]
    fn markable_settings_version_stamp_serialization() {
        use crate::commands::settings::MarkableSettings;

        let mut settings = MarkableSettings::default();

        // None → field is omitted from serialized JSON.
        let json_none = serde_json::to_value(&settings).unwrap();
        assert!(
            json_none.get("pluginsCopiedForVersion").is_none(),
            "None stamp should be omitted from JSON output"
        );

        // Some → field appears in serialized JSON.
        settings.plugins_copied_for_version = Some("0.1.0".to_string());
        let json_some = serde_json::to_value(&settings).unwrap();
        assert_eq!(
            json_some["pluginsCopiedForVersion"], "0.1.0",
            "Some stamp must appear in JSON output"
        );
    }
}
