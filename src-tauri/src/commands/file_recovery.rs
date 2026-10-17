//! Core Markdown delete protection.
//!
//! Plugins keep calling `delete_file` / `delete_directory`. Those commands
//! read the Data Protection preference and either remove the file, ask
//! first, or keep a local copy that Settings can restore.
//!
//! Only `.md` files are protected. Saving a note is unchanged.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const DELETE_CANCELLED: &str = "Delete cancelled";
const NOTE_FILE: &str = "note.md";
const META_FILE: &str = "meta.json";

static EXIT_CHOICE_DONE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectionMode {
    Off,
    Ask,
    Trash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionKind {
    Duration,
    UntilQuit,
    AskOnQuit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionUnit {
    Hours,
    Days,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataProtection {
    pub mode: ProtectionMode,
    pub retention: RetentionKind,
    pub retention_amount: u64,
    pub retention_unit: RetentionUnit,
}

impl Default for DataProtection {
    fn default() -> Self {
        Self {
            mode: ProtectionMode::Off,
            retention: RetentionKind::Duration,
            retention_amount: 7,
            retention_unit: RetentionUnit::Days,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RecoveryStore {
    pub durable: PathBuf,
    pub session: PathBuf,
}

impl RecoveryStore {
    pub fn under(app_data: &Path) -> Self {
        let root = app_data.join("file-recovery");
        Self {
            durable: root.join("snapshots"),
            session: root.join("session"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub id: String,
    pub original_path: String,
    pub name: String,
    pub deleted_at_ms: u64,
    pub expires_at_ms: Option<u64>,
    pub session_only: bool,
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

pub fn parse_data_protection(value: &serde_json::Value) -> DataProtection {
    let mut protection = DataProtection::default();
    let Some(obj) = value.as_object() else {
        return protection;
    };

    protection.mode = match obj.get("mode").and_then(|v| v.as_str()) {
        Some("ask") => ProtectionMode::Ask,
        Some("trash") => ProtectionMode::Trash,
        _ => ProtectionMode::Off,
    };
    protection.retention = match obj.get("retention").and_then(|v| v.as_str()) {
        Some("untilQuit") => RetentionKind::UntilQuit,
        Some("askOnQuit") => RetentionKind::AskOnQuit,
        _ => RetentionKind::Duration,
    };
    protection.retention_unit = match obj.get("retentionUnit").and_then(|v| v.as_str()) {
        Some("hours") => RetentionUnit::Hours,
        _ => RetentionUnit::Days,
    };
    if let Some(amount) = obj.get("retentionAmount").and_then(|v| v.as_u64()) {
        protection.retention_amount = amount.clamp(1, 8760);
    }
    protection
}

pub fn read_protection_at(path: &Path) -> DataProtection {
    let Ok(text) = fs::read_to_string(path) else {
        return DataProtection::default();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return DataProtection::default();
    };
    match value.get("dataProtection") {
        Some(field) => parse_data_protection(field),
        None => DataProtection::default(),
    }
}

fn protection_from_app(app: &tauri::AppHandle) -> DataProtection {
    let Ok(dir) = app.path().app_data_dir() else {
        return DataProtection::default();
    };
    read_protection_at(&dir.join("settings.json"))
}

fn store_from_app(app: &tauri::AppHandle) -> Result<RecoveryStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(RecoveryStore::under(&dir))
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn session_only(protection: &DataProtection) -> bool {
    matches!(
        protection.retention,
        RetentionKind::UntilQuit | RetentionKind::AskOnQuit
    )
}

fn expires_at(protection: &DataProtection, now: SystemTime) -> Option<SystemTime> {
    if session_only(protection) {
        return None;
    }
    let unit_secs: u64 = match protection.retention_unit {
        RetentionUnit::Hours => 60 * 60,
        RetentionUnit::Days => 24 * 60 * 60,
    };
    let secs = protection.retention_amount.max(1).saturating_mul(unit_secs);
    Some(now + Duration::from_secs(secs))
}

fn snapshot_id(path: &Path, now: SystemTime) -> String {
    let ms = millis(now);
    let nanos = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let mut hash: u32 = 2_166_136_261;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(1_677_7619);
    }
    format!("{ms}-{nanos}-{hash:08x}")
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note.md".to_string())
}

fn bucket_for(store: &RecoveryStore, session: bool) -> &Path {
    if session {
        &store.session
    } else {
        &store.durable
    }
}

fn is_inside(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn capture(
    source: &Path,
    protection: &DataProtection,
    now: SystemTime,
    store: &RecoveryStore,
    remove_source: bool,
) -> Result<SnapshotMeta, String> {
    let session = session_only(protection);
    let expiry = expires_at(protection, now).map(millis);
    let meta = SnapshotMeta {
        id: snapshot_id(source, now),
        original_path: source.to_string_lossy().into_owned(),
        name: file_name(source),
        deleted_at_ms: millis(now),
        expires_at_ms: expiry,
        session_only: session,
    };
    let dir = bucket_for(store, session).join(&meta.id);
    if let Err(error) = (|| -> Result<(), String> {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create recovery folder: {}", e))?;
        fs::copy(source, dir.join(NOTE_FILE))
            .map_err(|e| format!("Failed to copy Markdown note: {}", e))?;
        let json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("Failed to record recovery copy: {}", e))?;
        fs::write(dir.join(META_FILE), json)
            .map_err(|e| format!("Failed to record recovery copy: {}", e))?;
        Ok(())
    })() {
        let _ = fs::remove_dir_all(&dir);
        return Err(error);
    }

    if remove_source {
        fs::remove_file(source)
            .map_err(|e| format!("Failed to delete file {}: {}", source.to_string_lossy(), e))?;
    }
    Ok(meta)
}

/// Apply the Data Protection preference to one file.
///
/// Non-Markdown files are removed. Markdown files follow `protection`.
pub fn apply_delete(
    path: &Path,
    protection: &DataProtection,
    now: SystemTime,
    store: &RecoveryStore,
    confirm: impl FnOnce(&str) -> bool,
) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Not found: {}", path.to_string_lossy()));
    }
    if path.is_dir() {
        return Err(format!(
            "Path is a directory, use delete_directory: {}",
            path.to_string_lossy()
        ));
    }

    if !is_markdown(path) || protection.mode == ProtectionMode::Off {
        return fs::remove_file(path)
            .map_err(|e| format!("Failed to delete file {}: {}", path.to_string_lossy(), e));
    }

    if protection.mode == ProtectionMode::Ask {
        let name = file_name(path);
        if !confirm(&name) {
            return Err(DELETE_CANCELLED.to_string());
        }
        return fs::remove_file(path)
            .map_err(|e| format!("Failed to delete file {}: {}", path.to_string_lossy(), e));
    }

    capture(path, protection, now, store, true)?;
    purge_expired(store, now);
    Ok(())
}

fn collect_markdown(dir: &Path, store: &RecoveryStore, out: &mut Vec<PathBuf>) {
    if is_inside(dir, &store.durable) || is_inside(dir, &store.session) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_markdown(&path, store, out);
        } else if is_markdown(&path) {
            out.push(path);
        }
    }
}

/// Snapshot or confirm Markdown files inside `dir` before the directory is removed.
pub fn prepare_directory_delete(
    dir: &Path,
    protection: &DataProtection,
    now: SystemTime,
    store: &RecoveryStore,
    confirm: impl FnOnce(&str) -> bool,
) -> Result<(), String> {
    let notes = {
        let mut found = Vec::new();
        collect_markdown(dir, store, &mut found);
        found
    };
    if notes.is_empty() || protection.mode == ProtectionMode::Off {
        return Ok(());
    }

    if protection.mode == ProtectionMode::Ask {
        let folder = file_name(dir);
        let noun = if notes.len() == 1 { "file" } else { "files" };
        let prompt = format!(
            "Are you sure you want to delete {} Markdown {} in \"{}\"?",
            notes.len(),
            noun,
            folder
        );
        if !confirm(&prompt) {
            return Err(DELETE_CANCELLED.to_string());
        }
        return Ok(());
    }

    let mut captured = Vec::new();
    for note in &notes {
        match capture(note, protection, now, store, false) {
            Ok(meta) => captured.push(meta),
            Err(error) => {
                for meta in captured {
                    let _ = fs::remove_dir_all(bucket_for(store, meta.session_only).join(meta.id));
                }
                return Err(error);
            }
        }
    }
    purge_expired(store, now);
    Ok(())
}

pub fn protected_delete_file(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let target = PathBuf::from(path);
    let protection = protection_from_app(app);
    let store = store_from_app(app)?;
    apply_delete(&target, &protection, SystemTime::now(), &store, |name| {
        confirm_message(app, &format!("Are you sure you want to delete \"{name}\"?"))
    })
}

pub fn protected_delete_directory(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!("Not found: {}", path));
    }
    if !target.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let protection = protection_from_app(app);
    let store = store_from_app(app)?;
    prepare_directory_delete(&target, &protection, SystemTime::now(), &store, |prompt| {
        confirm_message(app, prompt)
    })?;
    fs::remove_dir_all(&target).map_err(|e| format!("Failed to delete directory {}: {}", path, e))
}

fn confirm_message(app: &tauri::AppHandle, message: &str) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    app.dialog()
        .message(message)
        .title("Data Protection")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show()
}

fn read_bucket(root: &Path, out: &mut Vec<(PathBuf, SnapshotMeta)>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let Ok(text) = fs::read_to_string(dir.join(META_FILE)) else {
            continue;
        };
        if let Ok(meta) = serde_json::from_str::<SnapshotMeta>(&text) {
            out.push((dir, meta));
        }
    }
}

pub fn purge_expired(store: &RecoveryStore, now: SystemTime) {
    let now_ms = millis(now);
    let mut found = Vec::new();
    read_bucket(&store.durable, &mut found);
    for (dir, meta) in found {
        if meta.expires_at_ms.is_some_and(|expiry| expiry <= now_ms) {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

pub fn purge_session(store: &RecoveryStore) {
    let _ = fs::remove_dir_all(&store.session);
}

pub fn session_is_empty(store: &RecoveryStore) -> bool {
    let mut found = Vec::new();
    read_bucket(&store.session, &mut found);
    found.is_empty()
}

pub fn promote_session(store: &RecoveryStore) -> Result<(), String> {
    let mut found = Vec::new();
    read_bucket(&store.session, &mut found);
    fs::create_dir_all(&store.durable)
        .map_err(|e| format!("Failed to keep recovery copies: {}", e))?;
    for (dir, mut meta) in found {
        meta.session_only = false;
        meta.expires_at_ms = None;
        let dest = store.durable.join(&meta.id);
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        fs::rename(&dir, &dest).map_err(|e| format!("Failed to keep recovery copies: {}", e))?;
        let json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("Failed to keep recovery copies: {}", e))?;
        fs::write(dest.join(META_FILE), json)
            .map_err(|e| format!("Failed to keep recovery copies: {}", e))?;
    }
    Ok(())
}

pub fn list_snapshots(store: &RecoveryStore) -> Vec<SnapshotMeta> {
    let mut found = Vec::new();
    read_bucket(&store.durable, &mut found);
    read_bucket(&store.session, &mut found);
    found.sort_by(|a, b| b.1.deleted_at_ms.cmp(&a.1.deleted_at_ms));
    found.into_iter().map(|(_, meta)| meta).collect()
}

fn find_snapshot(store: &RecoveryStore, id: &str) -> Option<(PathBuf, SnapshotMeta)> {
    let mut found = Vec::new();
    read_bucket(&store.durable, &mut found);
    read_bucket(&store.session, &mut found);
    found.into_iter().find(|(_, meta)| meta.id == id)
}

fn available_restore_path(original: &Path) -> Result<PathBuf, String> {
    let parent = original
        .parent()
        .ok_or_else(|| format!("Original folder is missing: {}", original.to_string_lossy()))?;
    if !parent.is_dir() {
        return Err(format!(
            "Original folder is missing: {}",
            parent.to_string_lossy()
        ));
    }
    if !original.exists() {
        return Ok(original.to_path_buf());
    }
    let stem = original
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".to_string());
    let first = parent.join(format!("{stem} restored.md"));
    if !first.exists() {
        return Ok(first);
    }
    for index in 2..1000 {
        let candidate = parent.join(format!("{stem} restored {index}.md"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "No free name to restore {}",
        original.to_string_lossy()
    ))
}

pub fn restore_snapshot(store: &RecoveryStore, id: &str) -> Result<String, String> {
    let (dir, meta) =
        find_snapshot(store, id).ok_or_else(|| format!("Recovery copy not found: {}", id))?;
    let note = dir.join(NOTE_FILE);
    let original = PathBuf::from(&meta.original_path);
    let destination = available_restore_path(&original)?;
    fs::copy(&note, &destination).map_err(|e| format!("Failed to restore note: {}", e))?;
    let _ = fs::remove_dir_all(dir);
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_recovered_notes(app: tauri::AppHandle) -> Result<Vec<SnapshotMeta>, String> {
    let store = store_from_app(&app)?;
    purge_expired(&store, SystemTime::now());
    Ok(list_snapshots(&store))
}

#[tauri::command]
pub fn restore_recovered_note(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let store = store_from_app(&app)?;
    restore_snapshot(&store, &id)
}

/// Parent folder that holds both durable and session Markdown copies.
pub fn ensure_recovery_root(store: &RecoveryStore) -> Result<PathBuf, String> {
    let root = store
        .durable
        .parent()
        .ok_or_else(|| "Recovery folder has no parent".to_string())?
        .to_path_buf();
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create recovery folder: {}", e))?;
    Ok(root)
}

fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to show recovery copies in Finder: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(())
    }
}

/// Open the recovery folder in Finder so the queued copies are visible.
#[tauri::command]
pub fn reveal_recovered_notes(app: tauri::AppHandle) -> Result<(), String> {
    let store = store_from_app(&app)?;
    let root = ensure_recovery_root(&store)?;
    open_folder(&root)
}

enum ExitPlan {
    Continue,
    PurgeSession,
    Ask,
}

fn exit_plan(protection: &DataProtection) -> ExitPlan {
    if protection.mode != ProtectionMode::Trash {
        return ExitPlan::Continue;
    }
    match protection.retention {
        RetentionKind::UntilQuit => ExitPlan::PurgeSession,
        RetentionKind::AskOnQuit => ExitPlan::Ask,
        RetentionKind::Duration => ExitPlan::Continue,
    }
}

/// Drop session copies on quit, or ask whether to keep them.
pub fn handle_exit_requested(app: &tauri::AppHandle, prevent_exit: impl FnOnce()) {
    if EXIT_CHOICE_DONE.load(Ordering::SeqCst) {
        return;
    }
    let Ok(store) = store_from_app(app) else {
        return;
    };
    match exit_plan(&protection_from_app(app)) {
        ExitPlan::Continue => {}
        ExitPlan::PurgeSession => purge_session(&store),
        ExitPlan::Ask => {
            if session_is_empty(&store) {
                return;
            }
            prevent_exit();
            let app = app.clone();
            use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
            app.dialog()
                .message("Discard Markdown copies kept for this session?")
                .title("Data Protection")
                .buttons(MessageDialogButtons::YesNo)
                .show(move |discard| {
                    if let Ok(store) = store_from_app(&app) {
                        if discard {
                            purge_session(&store);
                        } else {
                            let _ = promote_session(&store);
                        }
                    }
                    EXIT_CHOICE_DONE.store(true, Ordering::SeqCst);
                    app.exit(0);
                });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markable_recovery_{name}_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn store_in(root: &Path) -> RecoveryStore {
        RecoveryStore::under(&root.join("app-data"))
    }

    fn at_secs(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn write_note(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, body).unwrap();
        path
    }

    fn protection(
        mode: ProtectionMode,
        retention: RetentionKind,
        amount: u64,
        unit: RetentionUnit,
    ) -> DataProtection {
        DataProtection {
            mode,
            retention,
            retention_amount: amount,
            retention_unit: unit,
        }
    }

    #[test]
    fn off_removes_markdown_without_a_copy() {
        let root = temp_root("off");
        let note = write_note(&root, "note.md", "hello");
        let store = store_in(&root);
        apply_delete(
            &note,
            &DataProtection::default(),
            at_secs(1_700_000_000),
            &store,
            |_| panic!("off mode must not ask"),
        )
        .unwrap();
        assert!(!note.exists());
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ask_no_leaves_the_file() {
        let root = temp_root("ask-no");
        let note = write_note(&root, "note.md", "keep me");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Ask,
            RetentionKind::Duration,
            7,
            RetentionUnit::Days,
        );
        let error =
            apply_delete(&note, &prefs, at_secs(1_700_000_000), &store, |_| false).unwrap_err();
        assert_eq!(error, DELETE_CANCELLED);
        assert_eq!(fs::read_to_string(&note).unwrap(), "keep me");
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ask_yes_removes_the_file() {
        let root = temp_root("ask-yes");
        let note = write_note(&root, "note.md", "gone");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Ask,
            RetentionKind::Duration,
            7,
            RetentionUnit::Days,
        );
        let mut asked = String::new();
        apply_delete(&note, &prefs, at_secs(1_700_000_000), &store, |name| {
            asked = name.to_string();
            true
        })
        .unwrap();
        assert_eq!(asked, "note.md");
        assert!(!note.exists());
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn trash_keeps_a_copy_for_days_and_restore_puts_it_back() {
        let root = temp_root("trash-days");
        let note = write_note(&root.join("notes"), "diary.md", "# Tuesday");
        let store = store_in(&root);
        let now = at_secs(1_700_000_000);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::Duration,
            2,
            RetentionUnit::Days,
        );
        apply_delete(&note, &prefs, now, &store, |_| panic!("trash must not ask")).unwrap();
        assert!(!note.exists());
        let listed = list_snapshots(&store);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "diary.md");
        assert_eq!(
            listed[0].expires_at_ms,
            Some(millis(now) + 2 * 24 * 60 * 60 * 1000)
        );
        assert!(!listed[0].session_only);
        let restored = restore_snapshot(&store, &listed[0].id).unwrap();
        assert_eq!(restored, note.to_string_lossy());
        assert_eq!(fs::read_to_string(&note).unwrap(), "# Tuesday");
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn trash_restore_uses_a_new_name_when_the_original_is_back() {
        let root = temp_root("trash-collision");
        let note = write_note(&root, "diary.md", "first");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::Duration,
            1,
            RetentionUnit::Hours,
        );
        apply_delete(&note, &prefs, at_secs(1_700_000_000), &store, |_| true).unwrap();
        write_note(&root, "diary.md", "second");
        let id = list_snapshots(&store)[0].id.clone();
        let restored = restore_snapshot(&store, &id).unwrap();
        assert!(restored.ends_with("diary restored.md"));
        assert_eq!(fs::read_to_string(&note).unwrap(), "second");
        assert_eq!(
            fs::read_to_string(root.join("diary restored.md")).unwrap(),
            "first"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn expired_copies_are_purged() {
        let root = temp_root("expire");
        let note = write_note(&root, "old.md", "stale");
        let store = store_in(&root);
        let now = at_secs(1_700_000_000);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::Duration,
            1,
            RetentionUnit::Hours,
        );
        apply_delete(&note, &prefs, now, &store, |_| true).unwrap();
        assert_eq!(list_snapshots(&store).len(), 1);
        let later = now + Duration::from_secs(2 * 60 * 60);
        purge_expired(&store, later);
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn until_quit_copies_live_in_the_session_folder() {
        let root = temp_root("until-quit");
        let note = write_note(&root, "session.md", "temp");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::UntilQuit,
            7,
            RetentionUnit::Days,
        );
        apply_delete(&note, &prefs, at_secs(1_700_000_000), &store, |_| true).unwrap();
        let listed = list_snapshots(&store);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].session_only);
        assert!(listed[0].expires_at_ms.is_none());
        purge_session(&store);
        assert!(session_is_empty(&store));
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ask_on_quit_keep_promotes_session_copies() {
        let root = temp_root("ask-quit");
        let note = write_note(&root, "later.md", "keep");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::AskOnQuit,
            7,
            RetentionUnit::Days,
        );
        apply_delete(&note, &prefs, at_secs(1_700_000_000), &store, |_| true).unwrap();
        promote_session(&store).unwrap();
        assert!(session_is_empty(&store));
        let listed = list_snapshots(&store);
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].session_only);
        assert!(listed[0].expires_at_ms.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn non_markdown_is_removed_even_when_trash_is_on() {
        let root = temp_root("txt");
        let note = write_note(&root, "picture.txt", "pixels");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::Duration,
            7,
            RetentionUnit::Days,
        );
        apply_delete(&note, &prefs, at_secs(1_700_000_000), &store, |_| {
            panic!("non-markdown must not ask")
        })
        .unwrap();
        assert!(!note.exists());
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_trash_snapshots_markdown_only() {
        let root = temp_root("dir-trash");
        let dir = root.join("folder");
        write_note(&dir, "a.md", "A");
        write_note(&dir.join("nested"), "b.md", "B");
        write_note(&dir, "c.txt", "C");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Trash,
            RetentionKind::Duration,
            3,
            RetentionUnit::Hours,
        );
        prepare_directory_delete(&dir, &prefs, at_secs(1_700_000_000), &store, |_| {
            panic!("trash must not ask")
        })
        .unwrap();
        fs::remove_dir_all(&dir).unwrap();
        let listed = list_snapshots(&store);
        assert_eq!(listed.len(), 2);
        let names: Vec<&str> = listed.iter().map(|meta| meta.name.as_str()).collect();
        assert!(names.contains(&"a.md"));
        assert!(names.contains(&"b.md"));
        assert!(!names.contains(&"c.txt"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_ask_no_leaves_the_folder() {
        let root = temp_root("dir-ask");
        let dir = root.join("folder");
        write_note(&dir, "a.md", "A");
        let store = store_in(&root);
        let prefs = protection(
            ProtectionMode::Ask,
            RetentionKind::Duration,
            7,
            RetentionUnit::Days,
        );
        let mut prompt = String::new();
        let error =
            prepare_directory_delete(&dir, &prefs, at_secs(1_700_000_000), &store, |text| {
                prompt = text.to_string();
                false
            })
            .unwrap_err();
        assert_eq!(error, DELETE_CANCELLED);
        assert!(prompt.contains("1 Markdown file"));
        assert!(prompt.contains("folder"));
        assert_eq!(fs::read_to_string(dir.join("a.md")).unwrap(), "A");
        assert!(list_snapshots(&store).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_reads_trash_hours_and_clamps_zero() {
        let value = serde_json::json!({
            "mode": "trash",
            "retention": "duration",
            "retentionAmount": 0,
            "retentionUnit": "hours"
        });
        let parsed = parse_data_protection(&value);
        assert_eq!(parsed.mode, ProtectionMode::Trash);
        assert_eq!(parsed.retention_amount, 1);
        assert_eq!(parsed.retention_unit, RetentionUnit::Hours);
    }

    #[test]
    fn ensure_recovery_root_creates_the_folder() {
        let root = temp_root("reveal-root");
        let store = store_in(&root);
        let path = ensure_recovery_root(&store).unwrap();
        assert!(path.ends_with("file-recovery"));
        assert!(path.is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_preference_is_off() {
        let root = temp_root("prefs");
        let path = root.join("settings.json");
        fs::write(&path, r#"{"version":1}"#).unwrap();
        assert_eq!(read_protection_at(&path).mode, ProtectionMode::Off);
        let _ = fs::remove_dir_all(&root);
    }
}
