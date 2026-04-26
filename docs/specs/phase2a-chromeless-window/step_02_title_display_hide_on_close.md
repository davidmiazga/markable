# Step 02: Title Display & Hide-on-Close

**Phase:** 2A -- Chromeless Window
**Covers:** R3 (Document Title Display), R5 (No Flash -- show-on-ready), R6 (Hide-on-Close), NF2
**Depends on:** Step 01 complete

---

## Overview

This step makes two changes:
1. Update `src/main.ts` to manage the document title in the custom title bar and show the window after the frontend renders
2. Update `src-tauri/src/lib.rs` to intercept the window close event (hide instead of close) and handle dock icon re-activation

After this step, the full Phase 2A feature set is complete: chromeless window, custom title bar with document name, no-flash launch, and hide-on-close with dock reactivation.

---

## Change 1: src/main.ts

**File:** `src/main.ts`

Replace the entire file with:

```typescript
/**
 * Markable 2.0 -- Main Entry Point
 *
 * Initializes the application:
 * 1. Waits for DOM to be ready
 * 2. Creates the CodeMirror editor
 * 3. Sets up event listeners for file operations
 * 4. Updates the custom title bar with document name
 * 5. Shows the window after frontend renders (no-flash pattern)
 */

import { createEditor } from "./editor/editor";
import {
  readFile,
  writeFile,
  openFileDialog,
  saveFileDialog,
} from "./lib/bridge";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles.css";

// Global editor instance and current file path
let editor: ReturnType<typeof createEditor> = null;
let currentFilePath: string | null = null;

/**
 * Extract just the filename from a full path.
 *
 * @param path - Full file path (e.g., "/Users/me/docs/notes.md")
 * @returns Just the filename (e.g., "notes.md")
 */
function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * Update the document title in the custom title bar.
 *
 * Shows "Untitled" when no file is open, or the filename when a file is loaded.
 * Also updates the toolbar file-name span for backwards compatibility.
 */
function updateTitleBar() {
  const titleEl = document.getElementById("titlebar-title");
  const fileNameEl = document.getElementById("file-name");

  const displayName = currentFilePath ? getFileName(currentFilePath) : "Untitled";

  if (titleEl) {
    titleEl.textContent = displayName;
  }

  // Also update toolbar file-name display
  if (fileNameEl) {
    if (currentFilePath) {
      fileNameEl.textContent = `Editing: ${getFileName(currentFilePath)}`;
    } else {
      fileNameEl.textContent = "";
    }
  }
}

/**
 * Load file contents into editor
 */
async function openFile() {
  console.log("Open file dialog triggered");

  const result = await openFileDialog();

  if (result.cancelled) {
    console.log("User cancelled file open dialog");
    return;
  }

  const path = result.path;
  console.log(`Opening file: ${path}`);

  // Read file contents
  const readResult = await readFile(path);

  if (!readResult.ok) {
    alert(`Error opening file: ${readResult.error.message}`);
    return;
  }

  // Load into editor
  if (editor) {
    const content = readResult.value;
    const transaction = editor.state.update({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: content,
      },
    });
    editor.dispatch(transaction);
  }

  // Update current file and title bar
  currentFilePath = path;
  updateTitleBar();

  console.log(`File loaded: ${path}`);
}

/**
 * Save editor contents to file
 */
async function saveFile() {
  // If no current file, use save-as dialog
  if (!currentFilePath) {
    return saveFileAs();
  }

  console.log(`Saving file: ${currentFilePath}`);

  // Get editor content
  if (!editor) {
    alert("Editor not ready");
    return;
  }

  const content = editor.state.doc.toString();

  // Write to file
  const result = await writeFile(currentFilePath, content);

  if (!result.ok) {
    alert(`Error saving file: ${result.error.message}`);
    return;
  }

  console.log(`File saved: ${currentFilePath}`);
  updateTitleBar();
}

/**
 * Save editor contents to a new file (save-as)
 */
async function saveFileAs() {
  console.log("Save As dialog triggered");

  const result = await saveFileDialog();

  if (result.cancelled) {
    console.log("User cancelled save dialog");
    return;
  }

  const path = result.path;
  console.log(`Saving to: ${path}`);

  if (!editor) {
    alert("Editor not ready");
    return;
  }

  const content = editor.state.doc.toString();

  // Write to file
  const writeResult = await writeFile(path, content);

  if (!writeResult.ok) {
    alert(`Error saving file: ${writeResult.error.message}`);
    return;
  }

  // Update current file path and title bar
  currentFilePath = path;
  updateTitleBar();

  console.log(`File saved: ${path}`);
}

/**
 * Show the window after the frontend has fully rendered.
 *
 * This implements the "no-flash" pattern:
 * 1. Window starts with visible: false in tauri.conf.json
 * 2. Frontend loads, CSS applies, editor mounts
 * 3. This function calls window.show() to make it visible
 * 4. User sees a fully styled window from the first frame
 */
async function showWindow() {
  try {
    const appWindow = getCurrentWebviewWindow();
    await appWindow.show();
    console.log("Window shown (no-flash pattern complete)");
  } catch (err) {
    console.error("Failed to show window:", err);
    // If show fails, the window remains hidden.
    // This should never happen in production, but log for debugging.
  }
}

/**
 * Initialize the application
 */
async function initApp() {
  console.log("Initializing Markable 2.0...");

  // Get editor container
  const editorContainer = document.getElementById("editor");
  if (!editorContainer) {
    console.error("Editor container #editor not found in DOM");
    return;
  }

  // Create editor instance
  editor = createEditor(
    editorContainer,
    "# Welcome to Markable 2.0\n\nUse the buttons above to open and save files."
  );
  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  // Set up file dialog button listeners
  const openBtn = document.getElementById("btn-open");
  const saveBtn = document.getElementById("btn-save");

  if (openBtn) {
    openBtn.addEventListener("click", openFile);
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", saveFile);
  }

  // Set initial title bar state
  updateTitleBar();

  // Show the window now that everything is rendered
  await showWindow();

  console.log("Markable initialized successfully");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
```

**What changed from Phase 1 main.ts:**

1. **New import:** `getCurrentWebviewWindow` from `@tauri-apps/api/webviewWindow` for the show-on-ready pattern.

2. **`getFileName()` helper:** Extracted filename extraction into a reusable function.

3. **`updateTitleBar()` replaces `updateFileNameDisplay()`:** Now updates both the custom title bar (`#titlebar-title`) and the toolbar file-name span. Shows "Untitled" when no file is open.

4. **`showWindow()` function:** Calls `getCurrentWebviewWindow().show()` to make the window visible after the frontend renders. This is the core of the no-flash pattern.

5. **`initApp()` calls `updateTitleBar()` and `showWindow()`:** At the end of initialization, after the editor is mounted and event listeners are set up, the title bar shows "Untitled" and the window becomes visible.

6. **All `updateFileNameDisplay()` calls replaced with `updateTitleBar()`.**

---

## Change 2: src-tauri/src/lib.rs

**File:** `src-tauri/src/lib.rs`

Replace the entire file with:

```rust
mod commands;

pub use commands::{open_file_dialog, read_file, save_file_dialog, write_file};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_file_dialog,
            read_file,
            save_file_dialog,
            write_file
        ])
        .on_window_event(|window, event| {
            // Hide-on-close: intercept the close request and hide the window
            // instead of destroying it. This is standard macOS behavior --
            // the app stays in the dock and can be re-shown.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Handle macOS dock icon re-activation:
            // When the app is "resumed" (dock icon clicked while all windows hidden),
            // find the main window and show it.
            if let tauri::RunEvent::Resumed = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
pub mod test_utils {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Create a temporary test file with content.
    pub fn create_temp_file(prefix: &str, content: &str) -> std::io::Result<PathBuf> {
        let path = std::env::temp_dir().join(format!(
            "markable_test_{}_{}.md",
            prefix,
            std::process::id()
        ));
        fs::write(&path, content)?;
        Ok(path)
    }

    /// Clean up a temporary test file.
    pub fn remove_temp_file(path: &Path) -> std::io::Result<()> {
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::test_utils::*;

    #[test]
    fn temp_file_create_and_cleanup() {
        let path = create_temp_file("basic", "# Test").expect("create failed");
        assert!(path.exists());

        let content = std::fs::read_to_string(&path).expect("read failed");
        assert_eq!(content, "# Test");

        remove_temp_file(&path).expect("cleanup failed");
        assert!(!path.exists());
    }

    #[test]
    fn greet_returns_message() {
        let result = super::greet("Markable");
        assert!(result.contains("Markable"));
    }
}
```

**What changed from Phase 1 lib.rs:**

1. **`.run()` replaced with `.build()` + `.run()`:** The previous code used the shorthand `.run(tauri::generate_context!())`. We now use `.build(tauri::generate_context!()).expect(...).run(callback)` so we can provide a `RunEvent` callback for dock reactivation.

2. **`on_window_event` added:** Intercepts `WindowEvent::CloseRequested`, calls `api.prevent_close()` to prevent the window from being destroyed, then calls `window.hide()` to hide it. This implements R6 (hide-on-close).

3. **`RunEvent::Resumed` handler:** When macOS reactivates the app (e.g., user clicks the dock icon), the `Resumed` event fires. The handler finds the "main" window via `app_handle.get_webview_window("main")` and calls `show()` + `set_focus()` on it. This makes the window reappear when the dock icon is clicked.

**Why `.build().run()` instead of `.run()`:** The shorthand `Builder::run()` does not accept a callback for `RunEvent`. To handle dock reactivation, we must use the `App::run()` method which takes a `FnMut(&AppHandle, RunEvent)` callback. The `build()` method returns an `App` instance, and then `app.run()` starts the event loop with the callback.

**Why `Resumed` for dock reactivation:** Tauri v2's `RunEvent` enum does not have a dedicated `Reopen` variant. The `Resumed` event is the closest match -- it fires when the event loop is resumed, which on macOS happens when the app is reactivated via the dock icon while windows are hidden. This is the standard Tauri v2 approach.

**Note on `get_webview_window`:** In Tauri v2, windows created from `tauri.conf.json` are both windows and webviews. The `get_webview_window("main")` method returns a `WebviewWindow` which has both `show()` and `set_focus()` methods. The label "main" matches the `label` field in `tauri.conf.json`.

**Note on `let _ =`:** The `window.hide()`, `window.show()`, and `window.set_focus()` calls return `Result<()>`. We use `let _ =` to explicitly ignore errors since there is no meaningful recovery action -- if hide/show fails, the window state is already compromised and logging would just add noise. In production, these calls essentially never fail.

---

## Acceptance Criteria

| # | Criterion | How to Verify |
|---|---|---|
| AC-1 | Title bar shows "Untitled" on launch | Run `npm run tauri dev`; title bar center text reads "Untitled" |
| AC-2 | Title updates when file opened | Open a file via the Open button; title bar shows the filename (e.g., "notes.md") |
| AC-3 | Title updates on save-as | Save to a new file; title bar updates to the new filename |
| AC-4 | Long filename truncates | Open a file with a very long name; title shows ellipsis, does not overflow |
| AC-5 | No white flash on launch | Launch the app; window appears fully styled from the first frame |
| AC-6 | Close button hides window | Click the red close button; window disappears but dock icon remains |
| AC-7 | Dock click re-shows window | After hiding via close, click the dock icon; window reappears |
| AC-8 | Cmd-Q quits the app | Press Cmd-Q; app quits completely (dock icon disappears) |
| AC-9 | Window re-shows in same state | Hide window, re-show via dock; editor content and title are preserved |
| AC-10 | Title bar drag still works | After all changes, window is still draggable via the title bar region |

---

## Test Requirements

### Manual Verification (Required)

All acceptance criteria above must be verified manually via `npm run tauri dev`.

### Automated Tests

No new unit tests are strictly required for this step since the changes are:
- Rust event handlers (difficult to unit test without a full Tauri runtime)
- Window show/hide calls (requires native window context)
- DOM manipulation (covered by existing patterns)

However, the existing tests must still pass:
- `cargo test` in `src-tauri/` -- existing Rust tests pass
- `npm test` -- existing frontend tests pass (bridge tests, editor tests)
- `tsc --noEmit` -- TypeScript compilation succeeds

### Regression Check

After completing this step, run through the Phase 1 verification checklist to ensure nothing is broken:
- File open works (dialog appears, file loads into editor)
- File save works (content written to disk)
- Editor typing and markdown syntax highlighting work
- No console errors

---

## Developer Notes

- **Cmd-Q behavior:** The hide-on-close handler only intercepts `CloseRequested` events (the red button or Cmd-W). Cmd-Q triggers `ExitRequested` which is NOT intercepted, so the app quits normally. No special handling needed.

- **`Resumed` event may fire on other occasions:** The `Resumed` event can fire in situations beyond dock icon clicks (e.g., the app coming to foreground from another app). Calling `show()` on an already-visible window is a no-op, so this is harmless.

- **Window state preserved:** Since the window is hidden (not destroyed), all state is preserved -- editor content, scroll position, current file path. The window simply becomes invisible and then visible again.

- **Multiple windows (future):** The current `on_window_event` handler applies to ALL windows. When multi-window support is added in Phase 2C, the handler may need to be scoped to specific window labels. For now, with only one window, this is correct.

- **If `Resumed` does not work for dock reactivation:** If testing reveals that `Resumed` does not fire when the dock icon is clicked on macOS, the fallback approach is to use the `tauri::tray` module to create a system tray icon, or to use `#[cfg(target_os = "macos")]` with raw `objc` calls to register an `applicationShouldHandleReopen` delegate. However, `Resumed` should work for the common case. Document any findings in this step file if adjustments are needed.
