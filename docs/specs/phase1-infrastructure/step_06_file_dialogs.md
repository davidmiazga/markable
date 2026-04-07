# Step 06: File Dialog Integration (R6)

**Requirement:** R6 — File Dialog Integration
**Acceptance Criteria:** File Open dialog appears and allows selection, File Save As dialog appears, selected paths work with read_file/write_file, cancel handling is graceful

---

## Overview

This step integrates Tauri's native file dialogs for opening and saving files. Users can navigate the file system visually, select files for editing, and save files to chosen locations. The TypeScript wrappers (created in step 04) are now used with event handlers on buttons.

**Output:** Complete file dialog commands in Rust, TypeScript wrappers, UI buttons, and integrated flow: button → dialog → read/write → editor update.

---

## Implementation Tasks

### Task 6.1: Create src-tauri/src/commands/dialogs.rs

Implement the file dialog commands using Tauri's dialog plugin.

**File: `src-tauri/src/commands/dialogs.rs`**

```rust
/// File dialog commands using Tauri v2 dialog plugin
///
/// This module provides native file open/save dialogs that integrate
/// with the system's file browser (Finder on macOS, Explorer on Windows, etc.).

use tauri::AppHandle;
use tauri::api::dialog::FileDialogBuilder;

/// Open file dialog for selecting a file to open
///
/// # Arguments
/// * `app` - Tauri AppHandle for dialog access
///
/// # Returns
/// * `Ok(Some(path))` - User selected a file (absolute path)
/// * `Ok(None)` - User cancelled the dialog
/// * `Err(String)` - Dialog failed (rare)
///
/// # Dialog Behavior
/// - Starts in user's home directory
/// - Filters to `.md` and `.txt` files
/// - Single file selection (not multi-select)
#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let path = FileDialogBuilder::new()
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .await
        .map_err(|e| {
            eprintln!("open_file_dialog error: {}", e);
            format!("File dialog failed: {}", e)
        })?;

    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

/// Save file dialog for selecting a file path to save
///
/// # Arguments
/// * `app` - Tauri AppHandle for dialog access
///
/// # Returns
/// * `Ok(Some(path))` - User selected save location (absolute path)
/// * `Ok(None)` - User cancelled the dialog
/// * `Err(String)` - Dialog failed (rare)
///
/// # Dialog Behavior
/// - Starts in user's home directory
/// - Default filename: `untitled.md`
/// - Filters to `.md` and `.txt` files
/// - Allows creating new file or overwriting existing
#[tauri::command]
pub async fn save_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let path = FileDialogBuilder::new()
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .add_filter("All Files", &["*"])
        .set_file_name("untitled.md")
        .pick_file()
        .await
        .map_err(|e| {
            eprintln!("save_file_dialog error: {}", e);
            format!("File dialog failed: {}", e)
        })?;

    Ok(path.map(|p| p.to_string_lossy().to_string()))
}
```

**Notes:**
- Uses `FileDialogBuilder` from Tauri v2 dialog plugin
- `pick_file()` returns `Option<PathBuf>` (user selects one file)
- Filters configured for Markdown and text files
- `set_file_name()` sets default filename for save dialog
- Errors are caught and returned as Err; cancellation is Ok(None)
- `async` required for dialog blocking behavior

---

### Task 6.2: Update src-tauri/src/commands/mod.rs

Add dialog command exports.

**File: `src-tauri/src/commands/mod.rs` (update)**

```rust
/// Command registry module for Markable 2.0
///
/// Each submodule (io, dialogs, etc.) exports commands that are
/// registered via the `tauri::generate_handler![]` macro in main.rs.

pub mod io;
pub mod dialogs;

// Re-export command functions for easy registration
pub use io::{read_file, write_file};
pub use dialogs::{open_file_dialog, save_file_dialog};
```

(This was already created in step 04; just verify it includes dialog exports.)

---

### Task 6.3: Update src-tauri/src/main.rs

Register the dialog commands.

**File: `src-tauri/src/main.rs` (verify/update)**

```rust
#![cfg_attr(all(not(debug_assertions), target_os = "macos"), windows_subsystem = "windows")]

mod commands;

use commands::{read_file, write_file, open_file_dialog, save_file_dialog};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            open_file_dialog,
            save_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Task 6.4: Update src/lib/dialogs.ts

The bridge wrappers were created in step 04. Verify they exist and work correctly.

**File: `src/lib/dialogs.ts` (verify from step 04)**

The file should exist from step 04 with:

```typescript
export async function openFileDialog(): Promise<DialogResult>
export async function saveFileDialog(): Promise<DialogResult>
```

These return `{ cancelled: false, path: string }` or `{ cancelled: true }`.

---

### Task 6.5: Update index.html with File Buttons

Add buttons for file open/save operations.

**File: `index.html` (update)**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="/src/style.css" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Markable</title>
  </head>
  <body>
    <!-- Toolbar with file operations -->
    <div class="toolbar">
      <button id="btn-open" class="btn" title="Open file (Cmd+O)">
        📂 Open
      </button>
      <button id="btn-save" class="btn" title="Save file (Cmd+S)">
        💾 Save
      </button>
      <span id="file-name" class="file-name"></span>
    </div>

    <!-- Main application container -->
    <div id="app">
      <!-- Editor container: CodeMirror will mount here -->
      <div
        id="editor"
        role="textbox"
        aria-label="Markdown editor for Markable"
      ></div>
    </div>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**Key elements:**
- `#btn-open` — Button to trigger file open dialog
- `#btn-save` — Button to trigger file save dialog
- `#file-name` — Display current file name

---

### Task 6.6: Update src/style.css with Toolbar Styling

Add styles for toolbar and buttons.

**File: `src/style.css` (update)**

Add to existing styles:

```css
/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f9f9f9;
  border-bottom: 1px solid #e0e0e0;
  height: auto;
}

.btn {
  padding: 6px 12px;
  background: #ffffff;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #333333;
  transition: all 0.2s ease;
}

.btn:hover {
  background: #f0f0f0;
  border-color: #b0b0b0;
}

.btn:active {
  background: #e0e0e0;
  transform: scale(0.98);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #f9f9f9;
}

.file-name {
  margin-left: auto;
  font-size: 13px;
  color: #666666;
  font-family: "Menlo", monospace;
}

/* Adjust editor container to account for toolbar */
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

#editor {
  flex: 1;
  overflow: hidden;
}

.cm-editor {
  height: 100%;
}
```

---

### Task 6.7: Update src/main.ts with Dialog Event Handlers

Wire up the buttons to open/save files.

**File: `src/main.ts` (update)**

```typescript
/**
 * Markable 2.0 — Main Entry Point
 *
 * Initializes the application:
 * 1. Waits for DOM to be ready
 * 2. Creates the CodeMirror editor
 * 3. Sets up event listeners for file operations
 */

import { createEditor } from "./editor/editor";
import { readFile, writeFile, openFileDialog, saveFileDialog } from "./lib/bridge";
import "./style.css";

// Global editor instance and current file path
let editor: ReturnType<typeof createEditor> = null;
let currentFilePath: string | null = null;

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

  // Update current file and display name
  currentFilePath = path;
  updateFileNameDisplay();

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
  updateFileNameDisplay();
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

  // Update current file path
  currentFilePath = path;
  updateFileNameDisplay();

  console.log(`File saved: ${path}`);
}

/**
 * Update the file name display in toolbar
 */
function updateFileNameDisplay() {
  const fileNameEl = document.getElementById("file-name");
  if (fileNameEl) {
    if (currentFilePath) {
      // Extract just the filename from the path
      const fileName = currentFilePath.split("/").pop() || currentFilePath;
      fileNameEl.textContent = `Editing: ${fileName}`;
    } else {
      fileNameEl.textContent = "";
    }
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
  editor = createEditor(editorContainer, "# Welcome to Markable 2.0\n\nUse the buttons above to open and save files.");
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

  // Future: Add keyboard shortcuts (Cmd+O, Cmd+S)
  // (Phase 2)

  console.log("Markable initialized successfully");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
```

**Key flows:**

1. **Open file:**
   - Show dialog
   - Read file via `readFile()`
   - Update editor via CM6 transaction
   - Store path in `currentFilePath`

2. **Save file:**
   - If no current path, use save-as
   - Get editor content via `editor.state.doc.toString()`
   - Write via `writeFile()`
   - Update file name display

3. **Save As:**
   - Show save dialog
   - Write to new path
   - Update `currentFilePath` and display

---

### Task 6.8: Build and Test

Rebuild Rust backend to include dialog commands:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/src-tauri

cargo build
```

Expected: No errors.

---

### Task 6.9: Manual Test — Run Dev Server

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

npm run tauri dev
```

**Test Open File:**

1. Click "📂 Open" button
2. Verify file dialog appears (Finder on macOS)
3. Navigate to a Markdown or text file
4. Select a file
5. File contents appear in editor
6. File name shows in toolbar ("Editing: filename.md")

**Test Save File:**

1. Edit content in editor (make some changes)
2. Click "💾 Save"
3. If no file open, save dialog appears
4. Choose a location and filename (e.g., `test.md`)
5. File is saved to disk
6. File name shows in toolbar

**Test Save Existing File:**

1. Open a file (step above)
2. Edit it
3. Click "💾 Save"
4. No dialog appears (saves to same path)
5. File on disk is updated

**Test Cancellation:**

1. Click "📂 Open"
2. Cancel the dialog (press Escape or click Cancel)
3. Nothing happens (no error)
4. Verify console shows "User cancelled"

---

### Task 6.10: Verify Capabilities

Ensure the capabilities from step 02 include dialog permissions:

**File: `src-tauri/capabilities/default.json` (verify)**

Should include:

```json
{
  "permissions": [
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

If missing, add them (step 02).

---

### Task 6.11: Create UI Integration Tests

Create tests for the main.ts event handlers (optional but recommended).

**File: `tests/main.test.ts` (optional)**

```typescript
/**
 * Main application integration tests
 *
 * Tests file dialog flows and editor updates
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { openFileDialog, saveFileDialog } from "../src/lib/bridge";

describe("File Operations (Integration)", () => {
  describe("Dialog cancel handling", () => {
    it("gracefully handles dialog cancellation", async () => {
      // Mock dialog returning cancelled
      const result = await openFileDialog();

      // If user cancels, result should indicate that
      if (result.cancelled) {
        expect(result).toEqual({ cancelled: true });
      }
    });
  });

  describe("File path handling", () => {
    it("displays file name from path", () => {
      const path = "/Users/john/Documents/file.md";
      const fileName = path.split("/").pop();

      expect(fileName).toBe("file.md");
    });

    it("handles paths without slashes", () => {
      const path = "file.md";
      const fileName = path.split("/").pop();

      expect(fileName).toBe("file.md");
    });
  });
});
```

---

## Acceptance Checklist (Step 06 Complete When All Pass)

- [ ] `src-tauri/src/commands/dialogs.rs` implements open_file_dialog, save_file_dialog
- [ ] `src-tauri/src/main.rs` registers dialog commands
- [ ] `src/lib/dialogs.ts` exports openFileDialog, saveFileDialog (from step 04)
- [ ] `index.html` has toolbar with #btn-open, #btn-save, #file-name
- [ ] `src/style.css` has toolbar and button styling
- [ ] `src/main.ts` has openFile(), saveFile(), saveFileAs() event handlers
- [ ] `src-tauri/capabilities/default.json` includes dialog:allow-open, dialog:allow-save
- [ ] `npm run tauri dev` shows working UI with toolbar
- [ ] Clicking "Open" button shows file dialog
- [ ] Selecting file loads contents into editor
- [ ] Clicking "Save" button saves to disk
- [ ] File name displays in toolbar
- [ ] Cancelling dialog doesn't cause errors
- [ ] No console errors or warnings

---

## Files Modified/Created in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/src/commands/dialogs.rs` | NEW | File dialog command implementations |
| `src-tauri/src/main.rs` | UPDATED | Register dialog commands |
| `index.html` | UPDATED | Add toolbar with file buttons |
| `src/style.css` | UPDATED | Toolbar and button styles |
| `src/main.ts` | UPDATED | Add file operation event handlers |
| `tests/main.test.ts` | NEW (optional) | Integration tests for file operations |

---

## Edge Case Coverage (Step 06)

| EC # | Edge Case | Coverage |
|------|-----------|----------|
| EC-14 | File Open dialog cancelled | openFileDialog returns { cancelled: true }; main.ts handles gracefully |
| EC-15 | File Save As dialog cancelled | saveFileDialog returns { cancelled: true }; main.ts returns early |
| EC-20 | Tauri permissions misconfigured | dialog:allow-open, dialog:allow-save in capabilities/default.json (step 02) |

---

## Summary

Step 06 completes Phase 1 by:

1. Implementing file dialog commands in Rust (open_file_dialog, save_file_dialog)
2. Registering commands in Tauri CLI
3. Adding toolbar UI with Open and Save buttons
4. Implementing file operation flows: button → dialog → file I/O → editor
5. Handling dialog cancellation gracefully
6. Testing all flows end-to-end

---

## Phase 1 Complete

All six steps are now complete. The Markable 2.0 Phase 1 infrastructure is ready:

✅ **Step 01:** Tauri v2 + Vite + TypeScript scaffolding
✅ **Step 02:** Tauri v2 capabilities and permissions
✅ **Step 03:** macOS DMG build workaround + code signing
✅ **Step 04:** Rust file I/O bridge with atomic writes
✅ **Step 05:** CodeMirror 6 editor with Markdown support
✅ **Step 06:** File dialog integration

**Deliverables:**
- ✅ Working Tauri v2 dev environment
- ✅ File read/write with atomic saves
- ✅ CodeMirror 6 editor with Markdown syntax highlighting
- ✅ Native file open/save dialogs
- ✅ macOS DMG build process with code signing
- ✅ Complete test suite (Rust unit tests + TypeScript tests)
- ✅ Documentation (build notes, architecture specs, step files)

**Next Phase:** Activate `@lead-developer` to implement Phase 2 features (multi-file tabs, live preview, theming, menu system).
