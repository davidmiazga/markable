# Step 02b — Rust `copy_core_plugins` Command

**Chunk:** 2 — Base Plugin Build Pipeline
**Prerequisite:** step_02a complete and verified (`.js` files present in `src-tauri/resources/plugins/core/`)
**Goal:** On first launch (or when the app version bumps), copy bundled core plugin `.js` files from Tauri's resource directory into `~/Library/Application Support/com.markable.app/plugins/core/`. Stamp the version so the copy only happens once per app version.

---

## Overview

After step_02a, the four `.js` files exist inside the app bundle. They are not automatically placed in the user data directory — that is this step's job. The Rust command `copy_core_plugins`:

1. Reads the current `pluginsCopiedForVersion` stamp from `settings.json`.
2. Reads the current app version from Tauri's `AppHandle`.
3. If the version stamp is absent or differs from the current version: performs the copy.
4. The copy overwrites any existing `plugins/core/` files (idempotent — EC-34).
5. Does NOT touch `plugins/user/`.
6. Writes the new version stamp back to `settings.json` after a successful copy.

Additionally, this command handles the migration described in PC-EXISTING-1: if the old flat `plugins/` directory contains `.js` files (user-created plugins from before the `user/` subdirectory existed), they are moved to `plugins/user/` before the core files are written.

---

## 1. Settings changes

### 1a. Rust struct — `src-tauri/src/commands/settings.rs`

Add one optional field to `MarkableSettings`. The field is optional (`Option<String>`) so existing settings files without the key deserialize cleanly (the default is `None`).

Add after the `recent_files` field in `MarkableSettings`:

```rust
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
    /// None means the copy has never been performed on this installation.
    /// EC-5 / EC-34: optional field — absent in old settings files, defaults to None.
    #[serde(rename = "pluginsCopiedForVersion", skip_serializing_if = "Option::is_none", default)]
    pub plugins_copied_for_version: Option<String>,
}
```

Update `Default` impl to include the new field:

```rust
impl Default for MarkableSettings {
    fn default() -> Self {
        Self {
            version: CURRENT_SCHEMA_VERSION,
            window: WindowSettings::default(),
            editor: EditorSettings::default(),
            theme: ThemeSettings::default(),
            recent_files: Vec::new(),
            plugins_copied_for_version: None,
        }
    }
}
```

**Why add to the Rust struct (not frontend-only):** The `copy_core_plugins` command must read and write this field in the same atomic `save_settings` round-trip. The `save_settings` command writes raw JSON, which preserves unknown fields, but `copy_core_plugins` needs to read the field's current value. Adding it to the struct makes the read/write logic straightforward without requiring an extra raw JSON parse step inside the new command.

**Serialization note:** `skip_serializing_if = "Option::is_none"` means the field is absent from the JSON output when `None`. This preserves the existing compact output for new installs and is consistent with how the frontend omits fields that haven't been set yet.

---

## 2. New Rust command — `src-tauri/src/commands/plugins.rs`

Add the following to `plugins.rs` below the existing helpers.

### 2a. Directory helpers

```rust
/// Returns the `plugins/core/` subdirectory path under the app data dir.
/// Does NOT create the directory.
fn plugins_core_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join("plugins").join("core"))
}

/// Returns the `plugins/user/` subdirectory path under the app data dir.
/// Does NOT create the directory.
fn plugins_user_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(data_dir.join("plugins").join("user"))
}

/// Ensure a directory exists, creating it (and all parents) if absent.
fn ensure_dir(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir_all(path)
            .map_err(|e| format!("Failed to create directory {:?}: {}", path, e))?;
    }
    Ok(())
}
```

### 2b. Migration helper (PC-EXISTING-1)

```rust
/// Migrate any `.js` files sitting in the flat `plugins/` directory
/// (the old layout before `plugins/user/` existed) into `plugins/user/`.
///
/// This is a one-time migration. After this function runs, the flat `plugins/`
/// directory contains only subdirectories (`core/`, `user/`, per-plugin settings
/// dirs). The migration is non-destructive: files that already exist in
/// `plugins/user/` under the same name are NOT overwritten (user wins).
///
/// PC-EXISTING-1: current user plugin directory is flat `plugins/`, not `plugins/user/`.
fn migrate_flat_plugins_to_user_dir(
    plugins_root: &PathBuf,
    user_dir: &PathBuf,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(plugins_root) {
        Ok(e) => e,
        Err(_) => return Ok(()), // plugins/ doesn't exist yet — nothing to migrate
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Only migrate plain .js files at the top level of plugins/.
        if !path.is_file() { continue; }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "js" { continue; }

        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None => continue,
        };

        let dest = user_dir.join(&filename);
        // Do not overwrite if the file already exists in user/.
        if dest.exists() { continue; }

        std::fs::rename(&path, &dest).unwrap_or_else(|e| {
            eprintln!("[plugins] Warning: failed to migrate {:?} to user dir: {}", path, e);
        });
    }

    Ok(())
}
```

### 2c. Main command

```rust
/// Copy bundled core plugin files from Tauri's resource directory into the
/// user's `plugins/core/` directory.
///
/// Called from the frontend early in `initApp()`, before `loadUserPlugins`.
/// Returns `Ok(())` on success or if the copy was skipped (version stamp matches).
/// Returns `Err(String)` only for hard failures (resource dir not found, etc.).
///
/// EC-1:  Creates `plugins/core/` and `plugins/user/` if they don't exist.
/// EC-4:  Migrates old flat `plugins/*.js` files to `plugins/user/` first.
/// EC-5:  Reads `pluginsCopiedForVersion` from settings; skips copy if it matches.
/// EC-6:  Silently skips individual missing resource files (non-fatal).
/// EC-34: Overwrites existing `plugins/core/` files — copy is idempotent.
#[tauri::command]
pub fn copy_core_plugins(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    // ── 1. Read current app version ──────────────────────────────────────────
    let current_version = app.package_info().version.to_string();

    // ── 2. Read pluginsCopiedForVersion stamp from settings ──────────────────
    //    We read the raw settings file directly rather than going through
    //    get_settings/save_settings to avoid the public command overhead and
    //    to keep this command's read/write as a single round-trip.
    let settings_path = {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
        data_dir.join("settings.json")
    };

    let raw_settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::Value::Object(Default::default()))
    } else {
        serde_json::Value::Object(Default::default())
    };

    let stamp = raw_settings
        .get("pluginsCopiedForVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // ── 3. Skip if version stamp matches (EC-34 idempotency) ─────────────────
    if stamp == current_version {
        eprintln!("[plugins] Core plugins already copied for version {}. Skipping.", current_version);
        return Ok(());
    }

    eprintln!("[plugins] Copying core plugins for version {} (was: {:?}).", current_version, stamp);

    // ── 4. Resolve paths ──────────────────────────────────────────────────────
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let plugins_root = data_dir.join("plugins");
    let core_dir = plugins_core_dir(&app)?;
    let user_dir = plugins_user_dir(&app)?;

    // ── 5. Ensure directories exist (EC-1) ────────────────────────────────────
    ensure_dir(&core_dir)?;
    ensure_dir(&user_dir)?;

    // ── 6. Migrate old flat plugins to user/ (PC-EXISTING-1, EC-4) ───────────
    migrate_flat_plugins_to_user_dir(&plugins_root, &user_dir)?;

    // ── 7. Locate bundled resource directory ──────────────────────────────────
    //    tauri::AppHandle::path().resource_dir() returns the directory where
    //    `bundle.resources` files are copied during `tauri build`.
    //    On macOS app bundle: Contents/Resources/
    //    In dev (tauri dev): the `src-tauri/` directory (resources are not
    //    bundled; we skip the copy in dev mode to avoid confusion).
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;
    let bundled_core_dir = resource_dir.join("plugins").join("core");

    if !bundled_core_dir.exists() {
        // In `tauri dev` mode the resources are not bundled. Skip gracefully.
        // The frontend handles a missing copy without error — plugins just won't
        // be present in plugins/core/ until a real build is run.
        eprintln!(
            "[plugins] Bundled core dir {:?} not found. Skipping copy (dev mode?).",
            bundled_core_dir
        );
        // Still write the version stamp so we don't re-check on every launch.
        write_version_stamp(&settings_path, &raw_settings, &current_version)?;
        return Ok(());
    }

    // ── 8. Copy each .js file from bundled core → plugins/core/ ──────────────
    //    EC-6: missing individual files are skipped (non-fatal).
    //    EC-19: path traversal is impossible here — source is the bundled resource
    //    dir and dest is the app data dir; both are under developer/app control.
    let entries = std::fs::read_dir(&bundled_core_dir)
        .map_err(|e| format!("Failed to read bundled core plugins dir: {}", e))?;

    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_file() { continue; }
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "js" { continue; }

        let filename = match src.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None => continue,
        };

        let dest = core_dir.join(&filename);

        // EC-34: overwrite unconditionally (idempotent copy on version bump).
        if let Err(e) = std::fs::copy(&src, &dest) {
            eprintln!("[plugins] Warning: failed to copy {:?} -> {:?}: {}", src, dest, e);
            // Non-fatal: continue copying remaining files.
        } else {
            eprintln!("[plugins] Copied {:?} -> {:?}", filename, dest);
        }
    }

    // ── 9. Write version stamp (EC-5, EC-34) ──────────────────────────────────
    write_version_stamp(&settings_path, &raw_settings, &current_version)?;

    Ok(())
}

/// Patch `pluginsCopiedForVersion` in the raw settings JSON and write it back.
/// Uses the same atomic temp-file-swap pattern as write_raw_settings_to_disk.
fn write_version_stamp(
    settings_path: &PathBuf,
    raw_settings: &serde_json::Value,
    version: &str,
) -> Result<(), String> {
    use std::io::Write as IoWrite;

    let mut updated = raw_settings.clone();
    if let serde_json::Value::Object(ref mut map) = updated {
        map.insert(
            "pluginsCopiedForVersion".to_string(),
            serde_json::Value::String(version.to_string()),
        );
    }

    let json = serde_json::to_string_pretty(&updated)
        .map_err(|e| format!("Failed to serialize settings with version stamp: {}", e))?;

    // Ensure parent directory exists (first launch before settings.json is written).
    if let Some(parent) = settings_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings dir: {}", e))?;
        }
    }

    // Atomic write via temp file.
    let tmp_path = settings_path.with_extension("tmp.plugins_stamp");
    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create tmp settings file: {}", e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| { let _ = std::fs::remove_file(&tmp_path); format!("Failed to write stamp: {}", e) })?;
    file.sync_all()
        .map_err(|e| { let _ = std::fs::remove_file(&tmp_path); format!("Failed to sync stamp: {}", e) })?;
    std::fs::rename(&tmp_path, settings_path)
        .map_err(|e| { let _ = std::fs::remove_file(&tmp_path); format!("Failed to rename stamp file: {}", e) })?;

    Ok(())
}
```

**Why read/write raw JSON directly rather than using `get_settings`/`save_settings`:**

`get_settings` and `save_settings` are Tauri commands — they take an `AppHandle` parameter and are designed to be called from the frontend via `invoke()`. Calling one Tauri command from another is not supported. The `copy_core_plugins` command reads and patches the raw JSON file directly, which is the same approach already used by `write_raw_settings_to_disk` in `settings.rs`. The atomic temp-file-swap pattern is preserved.

**Version string format:** `app.package_info().version` on Tauri v2 returns a `semver::Version`. Its `Display` impl produces `"0.1.0"`. The `tauri.conf.json` `version` field is `"0.1.0"`. The comparison is a simple string equality check — no semver parsing needed.

---

## 3. Register the command

### 3a. `src-tauri/src/commands/mod.rs`

Add `copy_core_plugins` to the pub use line for plugins:

```rust
pub use plugins::{
    copy_core_plugins,
    list_user_plugins,
    read_plugin_file,
    read_plugin_settings,
    write_plugin_settings,
};
```

### 3b. `src-tauri/src/lib.rs`

Add `copy_core_plugins` to the `pub use` block and to `generate_handler![]`.

In the `pub use` block at line 25–30:

```rust
pub use commands::{
    open_file_dialog, read_file, save_file_dialog, save_html_dialog, write_file,
    get_settings, save_settings,
    list_themes, read_theme_css,
    copy_core_plugins,
    list_user_plugins, read_plugin_file, read_plugin_settings, write_plugin_settings,
};
```

In `generate_handler![]` (currently at line 294), add `copy_core_plugins` alongside the other plugin commands:

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
            copy_core_plugins,
            list_user_plugins,
            read_plugin_file,
            read_plugin_settings,
            write_plugin_settings,
            update_recent_files_menu,
            update_theme_menu
        ])
```

---

## 4. Capabilities — `src-tauri/capabilities/default.json`

The `copy_core_plugins` command reads from the Tauri resource directory and writes to the app data directory. Both operations use native Rust `std::fs` — they are NOT mediated by the `tauri-plugin-fs` plugin. The existing capabilities file does not include any `fs:*` permissions, and none are needed here: Tauri command Rust code runs outside the capability sandbox (capabilities restrict webview → invoke communication, not Rust command internals).

**No capability changes are required for `copy_core_plugins`.**

The existing `"core:default"` permission covers `invoke()` from the frontend to any registered command. The command itself handles all I/O directly in Rust with no plugin-fs involvement.

---

## 5. Frontend call site — `src/main.ts`

The command must be called early in `initApp()`, before `pluginManager.loadAll()`. The exact position is:

```typescript
// In initApp(), after loadSettings() and migratePluginSettings(),
// before buildExtensions() / createEditor():

import { invoke } from "@tauri-apps/api/core";

// Copy core plugin files from bundle to user data dir (no-op if version matches).
// Non-fatal: if copy_core_plugins fails (dev mode, permissions), log and continue.
try {
  await invoke("copy_core_plugins");
} catch (err) {
  console.warn("[init] copy_core_plugins failed (non-fatal):", err);
}
```

**Placement rationale:** The copy must happen before `loadAll()` reads `plugins/core/`. If `loadAll()` runs first, it finds an empty `plugins/core/` and loads nothing. On the next launch the copy runs and the plugins appear. This is confusing. By copying first, the first launch already has plugins available.

The `await` is required — `copy_core_plugins` is async (file I/O). If it is not awaited, `loadAll()` may start scanning `plugins/core/` before the Rust copy completes.

**Note:** `src/main.ts` is not modified in this step beyond the addition of this `invoke` call. The full `initApp()` restructuring (calling `pluginManager.loadAll()` instead of `pluginManager.restoreAll()`) happens in step_04a. For now, the call is added and the existing `restoreAll` path continues to run unchanged.

**Placement in `initApp()` pseudocode:**

```
1. loadSettings()
2. migratePluginSettings(settings)        ← step_04a (not in this step)
3. await invoke("copy_core_plugins")       ← NEW in this step
4. buildExtensions()
5. createEditor(buildExtensions())
6. pluginManager.setEditorView(editor)     ← step_01a (done)
7. [step_04a: pluginManager.loadAll(settings)]
8. pluginManager.restoreAll(ctx)           ← existing path, unchanged
9. showWindow()
```

Step 3 (the new invoke call) is the only change to `main.ts` in this step.

---

## 6. `src/lib/bridge.ts` — add `copyCorePlugins` wrapper

The frontend invoke is called directly in `main.ts` for the critical-path launch call, but a typed wrapper in `bridge.ts` is the correct pattern for any future callers.

```typescript
// In src/lib/bridge.ts, add alongside the other plugin commands:

/**
 * Copy bundled core plugin files to the user data directory.
 * No-op if `pluginsCopiedForVersion` stamp matches the current app version.
 * Non-fatal: resolves even if the resource directory is absent (dev mode).
 */
export async function copyCorePlugins(): Promise<void> {
  await invoke<void>("copy_core_plugins");
}
```

The `main.ts` call site may use this wrapper or call `invoke` directly — both are correct. The wrapper is added for completeness; `main.ts` can use either form.

---

## 7. Tests for `copy_core_plugins`

Add to `src-tauri/src/commands/plugins.rs` under `#[cfg(test)]`:

```rust
#[test]
fn migrate_flat_plugins_to_user_dir_skips_existing() {
    use std::fs;
    let tmp = std::env::temp_dir().join(format!("markable_migrate_test_{}", std::process::id()));
    let user = tmp.join("user");
    fs::create_dir_all(&user).unwrap();
    // Place a .js file at flat level
    fs::write(tmp.join("my-plugin.js"), b"// plugin").unwrap();
    // Place the same file in user/ already
    fs::write(user.join("my-plugin.js"), b"// existing").unwrap();
    migrate_flat_plugins_to_user_dir(&tmp, &user).unwrap();
    // Existing user/ file should not be overwritten
    let content = fs::read_to_string(user.join("my-plugin.js")).unwrap();
    assert_eq!(content, "// existing");
    // Source file should still be there (move did not happen due to conflict)
    assert!(tmp.join("my-plugin.js").exists());
    // Cleanup
    fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn migrate_flat_plugins_moves_new_files() {
    use std::fs;
    let tmp = std::env::temp_dir().join(format!("markable_migrate_move_{}", std::process::id()));
    let user = tmp.join("user");
    fs::create_dir_all(&user).unwrap();
    fs::write(tmp.join("new-plugin.js"), b"// new").unwrap();
    migrate_flat_plugins_to_user_dir(&tmp, &user).unwrap();
    assert!(user.join("new-plugin.js").exists());
    // Original file moved
    assert!(!tmp.join("new-plugin.js").exists());
    fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn write_version_stamp_creates_file_if_absent() {
    use std::fs;
    let tmp = std::env::temp_dir().join(format!("markable_stamp_{}", std::process::id()));
    fs::create_dir_all(&tmp).unwrap();
    let path = tmp.join("settings.json");
    let raw = serde_json::Value::Object(Default::default());
    write_version_stamp(&path, &raw, "0.1.0").unwrap();
    let content = fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["pluginsCopiedForVersion"], "0.1.0");
    fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn write_version_stamp_preserves_existing_fields() {
    use std::fs;
    let tmp = std::env::temp_dir().join(format!("markable_stamp_preserve_{}", std::process::id()));
    fs::create_dir_all(&tmp).unwrap();
    let path = tmp.join("settings.json");
    let raw = serde_json::json!({ "version": 1, "theme": { "active": "dark" } });
    write_version_stamp(&path, &raw, "1.2.3").unwrap();
    let content = fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["version"], 1);
    assert_eq!(parsed["theme"]["active"], "dark");
    assert_eq!(parsed["pluginsCopiedForVersion"], "1.2.3");
    fs::remove_dir_all(&tmp).unwrap();
}
```

---

## 8. EC coverage

| EC | How this step addresses it |
|----|---------------------------|
| EC-1 (dir autocreate) | `ensure_dir` creates `plugins/core/` and `plugins/user/` on first run. |
| EC-4 (flat → user/ migration) | `migrate_flat_plugins_to_user_dir` runs before the core copy. |
| EC-5 (version stamp) | `pluginsCopiedForVersion` read before copy; written after successful copy. |
| EC-6 (missing core file) | Individual file copy failures are logged and skipped (non-fatal). |
| EC-34 (idempotent copy) | Version stamp guards the copy; within one version, files are overwritten unconditionally. |

---

## 9. Files created / modified summary

| Action | File |
|--------|------|
| MODIFY | `src-tauri/src/commands/settings.rs` — add `plugins_copied_for_version` field to `MarkableSettings` and its `Default` impl |
| MODIFY | `src-tauri/src/commands/plugins.rs` — add `plugins_core_dir`, `plugins_user_dir`, `ensure_dir`, `migrate_flat_plugins_to_user_dir`, `write_version_stamp`, `copy_core_plugins`; add tests |
| MODIFY | `src-tauri/src/commands/mod.rs` — add `copy_core_plugins` to pub use |
| MODIFY | `src-tauri/src/lib.rs` — add `copy_core_plugins` to pub use block and `generate_handler![]` |
| MODIFY | `src/main.ts` — add `await invoke("copy_core_plugins")` in `initApp()` |
| MODIFY | `src/lib/bridge.ts` — add `copyCorePlugins()` wrapper |

**No changes to:**
- `src-tauri/capabilities/default.json` (no fs plugin permissions needed)
- `src-tauri/tauri.conf.json` (resources entry already handled in step_02a)
- Any TypeScript plugin file

---

## 10. Verification checklist

- [ ] `cargo test` passes (including new tests for `migrate_flat_plugins_to_user_dir`, `write_version_stamp`).
- [ ] `npm run tauri dev` launches without error. Console shows `[plugins] Bundled core dir ... not found. Skipping copy (dev mode?).` — this is expected in dev mode.
- [ ] After `npm run build:plugins && npm run tauri build`, the built `.app` contains `Contents/Resources/plugins/core/focus-mode.js` etc.
- [ ] First launch after install: `plugins/core/` appears in `~/Library/Application Support/com.markable.app/`. `settings.json` gains `"pluginsCopiedForVersion": "0.1.0"`.
- [ ] Second launch (no version change): `[plugins] Core plugins already copied for version 0.1.0. Skipping.` in stderr.
- [ ] `settings.json` diff after first launch shows only `pluginsCopiedForVersion` added — no other fields disturbed.
- [ ] Existing user plugins (`.js` files at the flat `plugins/` level) are moved to `plugins/user/` on first launch post-upgrade.
