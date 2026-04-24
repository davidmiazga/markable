---
title: "PKM Step 02b — File Browser Operations, FS Watch, and Backlinks Migration"
last-updated: "2026-04-24"
review-cadence-days: 14
status: active
---

# Step 02b — File Browser Operations, FS Watch, and Backlinks Migration

## Goal

Implement all file write operations (create, rename, delete, move), drag-and-drop, right-click context menus, post-rename link update notification, file-system watching for incremental index updates, and migrate the backlinks plugin to use the vault index when a vault is active.

**Prerequisite**: Step 02a complete. Tree renders correctly in read-only mode.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/plugins/file-browser/file-browser-ops.ts` | File operation helpers: create, rename, delete, move, link-update notification |
| `src-tauri/src/commands/file_ops.rs` | Rust commands: create_file, rename_file, delete_file, delete_directory, move_file, update_wiki_links |

---

## Files to Modify

| File | Change |
|---|---|
| `src/plugins/file-browser/file-browser.plugin.ts` | Wire up right-click menus, drag-and-drop, inline rename/create inputs, link update banner. Call ops from `file-browser-ops.ts`. |
| `src-tauri/src/commands/vault.rs` | Replace Phase 1 `watch_vault` / `unwatch_vault` stubs with full `notify` watcher implementations. |
| `src-tauri/src/commands/mod.rs` | Add `pub mod file_ops;` and re-export all file_ops commands. |
| `src-tauri/src/lib.rs` (or `main.rs`) | Add file_ops commands to `tauri::generate_handler![]`. |
| `src/plugins/backlinks/backlinks.plugin.ts` | Migrate: check vault index first (when active vault exists) for autocomplete candidates and wiki-link resolution. |
| `src/plugins/file-browser/file-browser.plugin.ts` | Call `watch_vault` on `onShow`; call `unwatch_vault` on `onHide`/`onDisable`. Handle `vault-file-changed` Tauri events. |

---

## Rust Commands (`src-tauri/src/commands/file_ops.rs`)

### `create_file`

```rust
#[tauri::command]
pub fn create_file(path: String, content: String) -> Result<(), String>
```

- Resolve `PathBuf` from `path`.
- If path already exists: return `Err("File already exists: {path}")`.
- Create parent directories via `create_dir_all`.
- Write via temp-file-swap (same pattern as `write_raw_settings_to_disk`):
  1. Write to `{path}.tmp.{timestamp}`.
  2. `file.sync_all()`.
  3. `fs::rename(temp, path)`.

### `rename_file`

```rust
#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String>
```

- If `old_path` does not exist: return `Err("Source not found: {old_path}")`.
- If `new_path` already exists: return `Err("Destination already exists: {new_path}")`.
- `fs::rename(old_path, new_path)`.
- Works for both files and directories.

### `delete_file`

```rust
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String>
```

- If not found: return `Err("Not found: {path}")`.
- `fs::remove_file(path)`.

### `delete_directory`

```rust
#[tauri::command]
pub fn delete_directory(path: String) -> Result<(), String>
```

- If not found or not a directory: return `Err(...)`.
- `fs::remove_dir_all(path)`.

### `move_file`

```rust
#[tauri::command]
pub fn move_file(source: String, destination_dir: String) -> Result<String, String>
```

- Extract filename from `source`.
- Compute `destination = destination_dir / filename`.
- If `destination` already exists: return `Err("File '{filename}' already exists in '{destination_dir}'")` (EC-19).
- `fs::rename(source, &destination)`.
- Return `Ok(destination.to_string_lossy().into_owned())`.

### `update_wiki_links`

```rust
#[derive(Serialize)]
pub struct UpdateLinksResult {
    pub updated: Vec<String>,
    pub failed: Vec<String>,
}

#[tauri::command]
pub fn update_wiki_links(
    files_to_update: Vec<String>,
    old_link: String,
    new_link: String,
) -> Result<UpdateLinksResult, String>
```

- For each path in `files_to_update`:
  - Read file content.
  - If file does not exist: add to `failed`. Continue (EC-26).
  - Find all occurrences of `[[{old_link}]]` and `[[{old_link}|` (with pipe, preserve display text).
    - Pattern: `\[\[{old_link}\]\]` and `\[\[{old_link}\|([^\]]*)\]\]`.
  - If no occurrences: skip (do not rewrite, not an error).
  - Replace: `[[{old_link}]]` → `[[{new_link}]]`; `[[{old_link}|display]]` → `[[{new_link}|display]]`.
  - Write updated content via temp-file-swap.
  - On any error (read, write, rename): add to `failed`, NOT to `updated`. No partial writes.
  - On success: add to `updated`.
- Return `Ok(UpdateLinksResult { updated, failed })`.

**Important**: If the temp file is written but the rename fails (disk full after write), the temp file must be cleaned up. The file at `path` must be untouched — it is either fully updated or not touched at all (EC-43).

---

## `watch_vault` Implementation (`vault.rs`)

Replace the Phase 1 stub:

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher, EventKind};
use std::collections::HashMap;
use std::sync::{Mutex, Arc};
use tauri::Emitter;

// Module-level watcher registry: vaultId → RecommendedWatcher
static WATCHERS: Mutex<HashMap<String, RecommendedWatcher>> = Mutex::new(HashMap::new());

#[tauri::command]
pub fn watch_vault(
    vault_id: String,
    root_paths: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Remove any existing watcher for this vault (idempotent).
    let mut watchers = WATCHERS.lock().map_err(|_| "watcher lock poisoned")?;
    watchers.remove(&vault_id);

    let vault_id_clone = vault_id.clone();
    let app_clone = app.clone();

    // Debounce: batch events within 500ms before emitting.
    // Use a simple Arc<Mutex<Option<JoinHandle>>> debounce pattern.
    let pending: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>> =
        Arc::new(Mutex::new(None));

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(e) => { eprintln!("[watch_vault] watcher error: {e}"); return; }
        };

        let event_type = match event.kind {
            EventKind::Create(_) => "created",
            EventKind::Modify(_) => "modified",
            EventKind::Remove(_) => "deleted",
            _ => return,
        };

        for path in &event.paths {
            let path_str = path.to_string_lossy().to_string();
            // Emit immediately (debouncing is handled on TS side via vault-manager)
            let payload = serde_json::json!({
                "vaultId": vault_id_clone,
                "eventType": event_type,
                "path": path_str,
            });
            let _ = app_clone.emit("vault-file-changed", payload);
        }
    }).map_err(|e| format!("Failed to create watcher: {e}"))?;

    for root in &root_paths {
        watcher
            .watch(std::path::Path::new(root), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch '{root}': {e}"))?;
    }

    watchers.insert(vault_id, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_vault(vault_id: String) -> Result<(), String> {
    let mut watchers = WATCHERS.lock().map_err(|_| "watcher lock poisoned")?;
    watchers.remove(&vault_id);
    Ok(())
}
```

**Note**: The 500ms debounce for rapid events (git checkout etc., NFR-06) is implemented in `vault-manager.ts` on the TypeScript side. Each incoming `vault-file-changed` event is pushed into a pending queue; the queue is flushed after 500ms of silence. This avoids Rust `tokio` complexity and keeps the debounce testable.

---

## `file-browser-ops.ts` — Required Exports

```typescript
/**
 * Create a new .md file at `dirPath/filename.md`.
 * Validates filename (no illegal chars: : / \ ? * " < > |).
 * Shows inline error in the tree if file already exists (EC-15) or invalid chars (EC-16).
 * On success: updates vault index incrementally, opens file in new tab.
 */
export async function createNote(
  dirPath: string,
  filename: string,
  container: HTMLElement
): Promise<void>;

/**
 * Rename a file or directory.
 * Shows inline error if new name already exists in same folder (EC-17).
 * On success: updates vault index, updates open tab titles,
 *   checks for backlinks and shows "Update links?" banner if found (EC-18).
 */
export async function renameNode(
  oldPath: string,
  newName: string,
  container: HTMLElement
): Promise<void>;

/**
 * Delete a file.
 * Shows native confirm dialog first (FR-02.12).
 * On confirm: deletes file, closes open tabs for that file, updates index.
 */
export async function deleteFile(path: string): Promise<void>;

/**
 * Delete a folder.
 * Shows native confirm dialog.
 * Closes all open tabs for files within the folder (with unsaved-changes prompt, EC-20).
 * Calls delete_directory Rust command.
 */
export async function deleteDirectory(path: string): Promise<void>;

/**
 * Move a file/directory to a new parent directory.
 * Errors if destination already has same name (EC-19).
 * On success: updates index, updates open tabs, checks for backlinks needing update.
 */
export async function moveNode(
  sourcePath: string,
  destinationDir: string
): Promise<void>;

/**
 * Show the "N notes link to 'name'. Update links?" banner in the panel container.
 * Banner has "Update" and "Dismiss" buttons.
 * "Update" calls update_wiki_links Rust command, then shows result summary.
 */
export function showLinkUpdateBanner(
  container: HTMLElement,
  oldStem: string,
  newStem: string,
  linkingPaths: string[]
): void;
```

---

## Inline Rename / Create Input

Both create and rename use an inline editable input that replaces the tree node label temporarily.

**Inline input behaviour:**
1. The `<span class="tree-node-label">` is replaced with `<input class="tree-node-rename-input" type="text" value="current-name" />`.
2. Input is focused and text is selected.
3. `Enter` key → commit the rename/create.
4. `Escape` key → cancel (restore original label).
5. `blur` event (user clicks elsewhere) → cancel (EC-24).
6. Real-time validation: on each `input` event, check for illegal characters and existing names. Show `.tree-node-inline-error` span below the input if invalid.
7. Commit: call the appropriate op (`renameNode` or `createNote`). If the op returns an error, show the error inline and keep the input open.

Illegal filename characters on macOS: `:`, `/`. Additionally reject names consisting entirely of dots (`.`, `..`).

---

## Drag-and-Drop

Uses the HTML5 Drag and Drop API on tree node `<li>` elements.

- `draggable="true"` on all file and directory nodes.
- `dragstart`: store `event.dataTransfer.setData("text/plain", node.path)`.
- `dragover` on directory nodes: `event.preventDefault()`. Add `.drag-over` class.
- `dragleave` on directory nodes: remove `.drag-over` class.
- `drop` on directory nodes: get source path from `dataTransfer.getData("text/plain")`. Call `moveNode(source, targetDir)`. Remove `.drag-over` class.
- `dragend`: remove all `.drag-over` classes (cleanup).

Optimistic update: immediately update the tree in memory (move node); revert on error.

Dropping a vault root node is a no-op (cannot drag vaults).

---

## Right-Click Context Menus

Right-click on a file node shows a floating context menu `<ul class="context-menu">` with items:
- "New Note" → `createNote(parentDir, ...)`
- "Rename" → activate inline rename
- "Delete" → `deleteFile(path)`
- "Move to..." → not implemented in this step (deferred; item shown but disabled/greyed)
- "Open in Finder" → `__TAURI_INTERNALS__.invoke("open_in_finder", { path })` (new Rust command, see below)
- "Copy Path" → `navigator.clipboard.writeText(path)`

Right-click on a directory node:
- "New Note" → `createNote(dirPath, ...)`
- "New Folder" → `createFolder(dirPath, ...)`
- "Rename" → inline rename
- "Delete" → `deleteDirectory(path)`
- "Open in Finder"

Right-click on a vault node:
- "New Vault..." → opens Manage Vaults create form
- "Edit Vault..." → opens Manage Vaults edit form for this vault
- "Delete Vault..." → `vaultManager.deleteVault(vaultId)`

Context menu is positioned at click coordinates, clamped to viewport edges. Clicking outside the menu dismisses it. Pressing Escape dismisses it.

**Additional Rust command needed** (add to `file_ops.rs`):

```rust
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(&["-R", &path])
        .spawn()
        .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
    Ok(())
}
```

---

## File-System Watch Integration (vault-manager.ts changes)

Add the following to `vault-manager.ts`:

```typescript
import { listen } from "@tauri-apps/api/event";

// Inside init() or switchVault():
async function startWatching(vault: VaultEntry): Promise<void> {
  await __TAURI_INTERNALS__.invoke("watch_vault", {
    vaultId: vault.id,
    rootPaths: vault.rootPaths,
  });

  // Listen for events from the watcher.
  await listen<VaultFileChangedEvent>("vault-file-changed", (event) => {
    if (event.payload.vaultId !== getActiveVault()?.id) return; // EC-25
    scheduleIndexUpdate(event.payload);
  });
}

// Debounce: batch rapid events, flush after 500ms of silence.
let updateTimer: ReturnType<typeof setTimeout> | null = null;
const pendingUpdates: VaultFileChangedEvent[] = [];

function scheduleIndexUpdate(event: VaultFileChangedEvent): void {
  pendingUpdates.push(event);
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    flushIndexUpdates();
  }, 500);
}

function flushIndexUpdates(): void {
  const events = [...pendingUpdates];
  pendingUpdates.length = 0;
  for (const event of events) {
    applyEventToIndex(event);
  }
}
```

`applyEventToIndex` calls the pure `applyIndexUpdate` from `index-parser.ts` and re-fetches file metadata for "created" and "modified" events (via a new lightweight Rust command or using `list_vault_files` with a single path). Then it emits `onIndexUpdated(event)`.

---

## Backlinks Migration

In `backlinks.plugin.ts`, find the `invokeListMdFiles` function (used for autocomplete candidates). Modify it:

```typescript
// Before (current):
async function invokeListMdFiles(dirPath: string): Promise<string[]> {
  return __TAURI_INTERNALS__.invoke("list_md_files", { path: dirPath });
}

// After (Phase 2b):
async function invokeListMdFiles(dirPath: string): Promise<string[]> {
  // If a vault is active, use the vault index for richer, bounded candidates.
  const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.();
  if (vaultIndex) {
    return vaultIndex.entries.map((e: { name: string }) => e.name + ".md");
  }
  // Fallback to shallow scan when no vault is active.
  return __TAURI_INTERNALS__.invoke("list_md_files", { path: dirPath });
}
```

**Note**: `vault-manager.ts` must export its public functions via a global `window.__MARKABLE_VAULT_MANAGER__` so that the IIFE-bundled backlinks plugin can access them without a module import. Add to `main.ts`:

```typescript
import * as vaultManager from "./lib/vault-manager";
(window as any).__MARKABLE_VAULT_MANAGER__ = vaultManager;
```

All 261 existing backlinks tests must continue to pass after this change (no regression). The change is guarded: `vaultIndex` is checked for truthiness before use.

---

## CSS Additions (`file-browser.css`)

- `.drag-over` — highlight folder when dragging over: `background: var(--drag-target-bg, rgba(var(--accent-rgb), 0.1)); outline: 1px dashed var(--accent-color);`
- `.context-menu` — floating `<ul>`, `position: fixed`, `z-index: 9999`, `background: var(--menu-bg)`, `border: 1px solid var(--border-color)`, `border-radius: 6px`, `box-shadow: 0 4px 16px rgba(0,0,0,0.2)`.
- `.context-menu-item` — `padding: 6px 16px; cursor: pointer;`
- `.context-menu-item:hover` — `background: var(--hover-bg)`
- `.context-menu-item.disabled` — `opacity: 0.4; cursor: default;`
- `.tree-node-rename-input` — `width: 100%; background: var(--input-bg); border: 1px solid var(--accent-color); border-radius: 3px; padding: 1px 4px; font: inherit;`
- `.tree-node-inline-error` — `color: var(--error-color, #c0392b); font-size: 0.8em;`
- `.file-browser-link-banner` — notification strip at top of tree: `background: var(--warning-bg); padding: 6px 12px; display: flex; align-items: center; gap: 8px;`

---

## Test Requirements

Minimum 20 additional tests in `tests/plugins/file-browser/file-browser.test.ts` (extending Phase 2a tests):

1. `createNote`: success → file created, index updated, tab opened.
2. `createNote`: name already exists in folder → inline error shown, no file created (EC-15).
3. `createNote`: illegal character `:` in name → inline error (EC-16).
4. `createNote`: Escape key → input removed, no file created.
5. `createNote`: blur → same as Escape (EC-24).
6. `renameNode`: success → tree node label updated, tab title updated.
7. `renameNode`: target name already exists → inline error (EC-17).
8. `renameNode`: file has backlinks → link-update banner shown (EC-18).
9. `renameNode`: link-update banner "Update" → `update_wiki_links` invoked.
10. `renameNode`: link-update banner "Dismiss" → banner removed, no update.
11. `deleteFile`: confirm dialog accepted → file deleted, tab closed.
12. `deleteFile`: confirm dialog rejected → no action.
13. `deleteDirectory`: confirm accepted, tab for file inside has unsaved changes → unsaved-changes prompt shown (EC-20).
14. `moveNode`: success → node moves in tree, index updated.
15. `moveNode`: destination has same filename → error shown (EC-19).
16. Drag-and-drop: dragstart sets correct path in dataTransfer.
17. Drag-and-drop: drop on directory calls `moveNode`.
18. Context menu: right-click file → menu appears with correct items.
19. Context menu: Escape key → menu dismissed.
20. Backlinks migration: `invokeListMdFiles` with active vault → returns vault index names.
21. Backlinks migration: `invokeListMdFiles` with no vault → calls `list_md_files` (fallback).
22. `watch_vault` event received → `onIndexUpdated` fires after 500ms debounce.
23. `watch_vault` event for different vaultId → ignored.

---

## Acceptance Criteria

1. `npm run build:plugins` succeeds.
2. `npx vitest run tests/plugins/file-browser/` passes all tests (min 60 total across 2a + 2b).
3. `cargo test` passes for all `file_ops.rs` tests.
4. Creating a note: inline input appears, Enter creates the file, file opens in tab.
5. Renaming a file that has backlinks shows the "Update links?" banner.
6. Clicking "Update" on the banner updates all `[[old-name]]` occurrences in linking files.
7. Drag-and-drop: dragging a file to a folder moves it and updates the tree.
8. Context menu appears on right-click with the correct items.
9. Deleting a file: native confirm dialog appears before deletion.
10. File system changes (create/rename/delete outside Markable) update the tree within ~1 second.
11. Existing backlinks tests (261) all pass after backlinks migration.

---

## Edge Cases Covered

- EC-05: file write in flight when vault switch occurs → write completes, tree updates for old vault (watcher handles cleanup).
- EC-15: create note with duplicate name → inline error.
- EC-16: illegal filename characters → inline error.
- EC-17: rename to existing name → inline error.
- EC-18: rename with backlinks → link-update banner.
- EC-19: move to folder with same-named file → error, no overwrite.
- EC-20: delete folder with open tabs (unsaved changes) → unsaved-changes prompt.
- EC-21: delete folder that contains another vault's root → delete proceeds, other vault gets EC-07 handling on next activation.
- EC-24: inline rename blur → rename cancelled.
- EC-25: watcher event for path outside vault root → ignored.
- EC-26: `update_wiki_links` encounters deleted file → skipped, returned in failed list.
- EC-27: rapid note creation → tree updates incrementally per event.
- EC-43: `update_wiki_links` fails partway → returns updated + failed lists, no partial writes.
