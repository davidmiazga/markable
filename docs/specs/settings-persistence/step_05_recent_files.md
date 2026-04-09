# Step 05: Recent Files

**Covers:** R5
**Edge Cases:** EC-14, EC-15, EC-16, EC-22
**Depends on:** Step 02 (settings singleton, bridge), existing menu system in `menu.rs` and `main.ts`
**Files Modified:** `src/lib/settings.ts`, `src/main.ts`, `src-tauri/src/menu.rs`, `src-tauri/src/lib.rs`

---

## Objective

Track the 10 most recently opened/saved files. Display them in a File menu submenu. Support `Cmd-Opt-O` to reopen the most recent file. Handle stale entries gracefully.

---

## 1. Recent Files Management Functions

Add to `src/lib/settings.ts`:

```typescript
const MAX_RECENT_FILES = 10;

/**
 * Add a file path to the recent files list.
 * - Moves existing entries to the front (no duplicates).
 * - Caps at MAX_RECENT_FILES entries.
 * - Persists immediately.
 *
 * Called after every successful file open or save.
 */
export async function addRecentFile(path: string): Promise<void> {
  await updateSettings((s) => {
    const files = s.recentFiles.filter((f) => f !== path);
    files.unshift(path);
    if (files.length > MAX_RECENT_FILES) {
      files.length = MAX_RECENT_FILES;
    }
    return { ...s, recentFiles: files };
  });

  // Update the File menu's recent files submenu
  await refreshRecentFilesMenu();
}

/**
 * Remove a specific file from the recent files list.
 * Used when a stale entry is clicked and the file is not found (EC-14).
 */
export async function removeRecentFile(path: string): Promise<void> {
  await updateSettings((s) => ({
    ...s,
    recentFiles: s.recentFiles.filter((f) => f !== path),
  }));
  await refreshRecentFilesMenu();
}

/**
 * Clear all recent files (used by settings panel "Clear Recent Files" button).
 */
export async function clearRecentFiles(): Promise<void> {
  await updateSettings((s) => ({
    ...s,
    recentFiles: [],
  }));
  await refreshRecentFilesMenu();
}

/**
 * Get the most recent file path, or null if the list is empty.
 * Used by Cmd-Opt-O handler (EC-22: returns null if empty).
 */
export function getMostRecentFile(): string | null {
  const settings = getCurrentSettings();
  return settings.recentFiles.length > 0 ? settings.recentFiles[0] : null;
}
```

---

## 2. File Menu: "Open Recent" Submenu

### Approach A: Dynamic Rust Menu (Recommended)

The "Open Recent" submenu in the File menu must be dynamic -- its items change at runtime as files are opened/saved. Tauri v2 supports dynamic menu modification.

**Update `src-tauri/src/menu.rs`:**

Add placeholders for the "Open Recent" submenu in the File menu:

```rust
let recent_submenu = Submenu::with_items(
    handle,
    "Open Recent",
    true,
    &[
        &MenuItem::with_id(handle, "recent-empty", "(No Recent Files)", false, None::<&str>)?,
    ],
)?;

let file_menu = Submenu::with_items(
    handle,
    "File",
    true,
    &[
        &MenuItem::with_id(handle, "file-new", "New", true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(handle, "file-open", "Open...", true, Some("CmdOrCtrl+O"))?,
        &MenuItem::with_id(handle, "file-reopen-last", "Reopen Last", true, Some("CmdOrCtrl+Alt+O"))?,
        &recent_submenu,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "file-save", "Save", true, Some("CmdOrCtrl+S"))?,
        &MenuItem::with_id(handle, "file-save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "file-export", "Export", false, Some("CmdOrCtrl+Alt+E"))?,
        &MenuItem::with_id(handle, "file-import", "Import", false, None::<&str>)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::close_window(handle, Some("Close"))?,
    ],
)?;
```

### Approach B: Frontend-Driven Menu Updates

Since the recent files list is managed in the frontend, updating native menu items dynamically requires calling back to Rust. The simplest approach for v1 is:

1. The Rust menu has a static "Open Recent" submenu with a placeholder item.
2. When the frontend's recent files list changes, it emits an event to Rust with the new list.
3. Rust rebuilds the submenu items.

**However**, for this phase, a simpler approach is acceptable: the "Reopen Last" menu item (`Cmd-Opt-O`) covers the primary use case. The full dynamic submenu with individual file entries can use a Tauri command that rebuilds the submenu.

**Pragmatic decision:** For this step, implement:
- `Cmd-Opt-O` ("Reopen Last") -- handles the most common use case.
- A static "Open Recent" submenu that triggers the frontend to show recent files (or is populated on app launch).
- Dynamic updates via a `update_recent_files_menu` Tauri command.

---

## 3. Cmd-Opt-O Handler (Reopen Last)

In `src/main.ts`, add to the menu event handler and register the "file-reopen-last" event:

```typescript
case "file-reopen-last":
  reopenLastFile();
  break;
```

Also update the `on_menu_event` handler in `lib.rs` to forward this event:

```rust
"file-new" | "file-open" | "file-save" | "file-save-as"
| "file-reopen-last"
| "view-toggle-preview"
// ... existing patterns ...
```

Implement `reopenLastFile`:

```typescript
async function reopenLastFile(): Promise<void> {
  const path = getMostRecentFile();

  // EC-22: Empty recent files list -- do nothing
  if (!path) {
    console.log("No recent files to reopen.");
    return;
  }

  // Try to read the file
  const result = await readFile(path);

  if (!result.ok) {
    // EC-14: File no longer exists
    console.warn(`Recent file not found: ${path}`);
    // Show a brief notification (use console for now; toast in future)
    // Remove from recent files list
    await removeRecentFile(path);
    return;
  }

  // Load into editor
  if (editor) {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: result.value },
    });
  }
  currentFilePath = path;
  updateTitleBar();
  console.log(`Reopened: ${path}`);
}
```

---

## 4. Integration with File Open/Save

Update `openFile()` and `saveFile()` / `saveFileAs()` in `main.ts` to call `addRecentFile()` after successful operations:

```typescript
async function openFile() {
  // ... existing dialog and read logic ...

  currentFilePath = path;
  updateTitleBar();

  // Add to recent files
  await addRecentFile(path);

  console.log(`File loaded: ${path}`);
}

async function saveFile() {
  // ... existing save logic ...

  // Add to recent files after successful save
  if (currentFilePath) {
    await addRecentFile(currentFilePath);
  }
}

async function saveFileAs() {
  // ... existing save-as logic ...

  currentFilePath = path;
  updateTitleBar();

  // Add to recent files after successful save
  await addRecentFile(path);
}
```

---

## 5. Dynamic Menu Update Command

Add a Tauri command to update the recent files submenu dynamically:

```rust
// In src-tauri/src/commands/settings.rs (or a new menu_utils module)

#[tauri::command]
pub fn update_recent_files_menu(
    app: tauri::AppHandle,
    files: Vec<String>,
) -> Result<(), String> {
    // This command rebuilds the "Open Recent" submenu with the given file paths.
    // Each file gets a menu item with id "recent-file-N" where N is the index.
    // Implementation uses Tauri's menu manipulation APIs.
    //
    // Note: If dynamic menu manipulation is too complex for v1, this can be
    // deferred. The Cmd-Opt-O shortcut covers the primary use case.

    Ok(())
}
```

**Implementation note:** Dynamic submenu rebuilding in Tauri v2 requires access to the menu handle. The exact API depends on the Tauri v2 menu crate version. If dynamic menu manipulation proves too complex for this step, the fallback is:
1. `Cmd-Opt-O` works immediately (primary use case).
2. The "Open Recent" submenu shows a static list populated on app launch.
3. Full dynamic updates are deferred to a follow-up.

---

## 6. Refresh Recent Files Menu (Frontend)

```typescript
/**
 * Rebuild the native "Open Recent" submenu with current recent files.
 * Calls the Rust command to update menu items.
 */
async function refreshRecentFilesMenu(): Promise<void> {
  const settings = getCurrentSettings();
  try {
    await invoke("update_recent_files_menu", {
      files: settings.recentFiles,
    });
  } catch (err) {
    console.warn("Failed to update recent files menu:", err);
    // Non-fatal. The menu may be stale, but Cmd-Opt-O still works.
  }
}
```

---

## 7. Stale Entry Handling (EC-14)

When a user clicks a recent file entry (from the submenu or via Cmd-Opt-O):

1. Attempt to read the file via `readFile()`.
2. If the file does not exist, show a notification ("File not found").
3. Remove the entry from the recent files list.
4. Refresh the menu.

The grayed-out appearance in the menu is a stretch goal. For v1, all entries appear normal. If clicked and the file is missing, the user sees a notification and the entry is removed.

**Stretch goal for this step or Step 08:** Before displaying the submenu, check `fs.exists()` on each path (via a Rust command) and mark missing files as disabled.

---

## 8. Edge Case Coverage

| Edge Case | How Handled |
|-----------|-------------|
| EC-14: Stale entry | Read attempt fails, notification shown, entry removed from list. |
| EC-15: Duplicate paths | `addRecentFile` filters out existing occurrences before prepending. Rust also deduplicates on load (Step 01). |
| EC-16: Directory in recent files | Rust `validate_settings` removes directories on load (Step 01). Frontend `addRecentFile` only adds paths from file open/save dialogs which only return files. |
| EC-22: Cmd-Opt-O with empty list | `getMostRecentFile()` returns null, `reopenLastFile()` logs and returns early. No-op. |

---

## 9. Tests

```typescript
describe("Recent Files", () => {
  it("getMostRecentFile returns null when list is empty", () => {
    // With DEFAULT_SETTINGS (empty recentFiles)
    expect(getMostRecentFile()).toBeNull();
  });

  it("addRecentFile adds to front of list", async () => {
    // Mock updateSettings to capture the update
    // Verify the new path is at index 0
  });

  it("addRecentFile moves duplicate to front", async () => {
    // Start with ["/a.md", "/b.md", "/c.md"]
    // addRecentFile("/b.md") => ["/b.md", "/a.md", "/c.md"]
  });

  it("addRecentFile caps at 10 entries", async () => {
    // Start with 10 files, add 11th
    // Verify list length is 10 and oldest is dropped
  });
});
```

---

## Done Criteria

- [ ] `addRecentFile()` adds/moves paths to front of list
- [ ] Recent files list never exceeds 10 entries
- [ ] `openFile()` and `saveFile()`/`saveFileAs()` call `addRecentFile()`
- [ ] `Cmd-Opt-O` reopens the most recent file
- [ ] `Cmd-Opt-O` is a no-op when the list is empty (EC-22)
- [ ] Stale entries are removed on attempted open (EC-14)
- [ ] "Open Recent" submenu exists in File menu
- [ ] `file-reopen-last` menu event forwarded from Rust to frontend
- [ ] `clearRecentFiles()` function implemented
- [ ] `getMostRecentFile()` returns null for empty list
- [ ] Tests pass
