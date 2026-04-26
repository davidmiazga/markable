# Step 01: Rust Menu Construction

**Phase:** 2B -- Native Menu System
**Depends on:** Phase 2A complete
**Modifies:** `src-tauri/src/menu.rs` (NEW), `src-tauri/src/lib.rs`

---

## Overview

Create a new Rust module that builds the complete native macOS menu bar. Wire it into the Tauri Builder. After this step, the app launches with a fully visible native menu bar -- but custom items don't do anything yet (event routing is Step 02).

---

## Task 1: Create `src-tauri/src/menu.rs`

Create a new file with a public function:

```rust
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

pub fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // Build each submenu, then combine into Menu::with_items
}
```

### 1.1 App (System) Menu

```rust
let app_menu = Submenu::with_items(
    handle,
    "Markable",
    true,
    &[
        &PredefinedMenuItem::about(handle, Some("About Markable"), None)?,
        &MenuItem::with_id(handle, "app-updates", "Check for Updates...", false, None::<&str>)?,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "app-settings", "Settings", false, Some("CmdOrCtrl+Comma"))?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::services(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::hide(handle, Some("Hide Markable"))?,
        &PredefinedMenuItem::hide_others(handle, None)?,
        &PredefinedMenuItem::show_all(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::quit(handle, Some("Quit Markable"))?,
    ],
)?;
```

### 1.2 File Menu

```rust
let file_menu = Submenu::with_items(
    handle,
    "File",
    true,
    &[
        &MenuItem::with_id(handle, "file-new", "New", true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(handle, "file-open", "Open...", true, Some("CmdOrCtrl+O"))?,
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

**Note:** Import's Cmd-I shortcut conflicts with Italic. Since both are disabled, Import gets no accelerator for now.

### 1.3 Edit Menu

```rust
let edit_menu = Submenu::with_items(
    handle,
    "Edit",
    true,
    &[
        &PredefinedMenuItem::undo(handle, None)?,
        &PredefinedMenuItem::redo(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::cut(handle, None)?,
        &PredefinedMenuItem::copy(handle, None)?,
        &PredefinedMenuItem::paste(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::select_all(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "edit-find", "Find...", false, Some("CmdOrCtrl+F"))?,
        &MenuItem::with_id(handle, "edit-find-replace", "Find and Replace...", false, Some("CmdOrCtrl+Shift+F"))?,
    ],
)?;
```

### 1.4 Format Menu

All items disabled. Build as a single submenu with disabled MenuItems.

```rust
let format_menu = Submenu::with_items(
    handle,
    "Format",
    true,
    &[
        // Headings
        &MenuItem::with_id(handle, "format-h1", "Heading 1", false, Some("CmdOrCtrl+1"))?,
        &MenuItem::with_id(handle, "format-h2", "Heading 2", false, Some("CmdOrCtrl+2"))?,
        &MenuItem::with_id(handle, "format-h3", "Heading 3", false, Some("CmdOrCtrl+3"))?,
        &MenuItem::with_id(handle, "format-h4", "Heading 4", false, Some("CmdOrCtrl+4"))?,
        &MenuItem::with_id(handle, "format-h5", "Heading 5", false, Some("CmdOrCtrl+5"))?,
        &MenuItem::with_id(handle, "format-h6", "Heading 6", false, Some("CmdOrCtrl+6"))?,
        &PredefinedMenuItem::separator(handle)?,
        // Inline formatting
        &MenuItem::with_id(handle, "format-bold", "Bold", false, Some("CmdOrCtrl+B"))?,
        &MenuItem::with_id(handle, "format-italic", "Italic", false, Some("CmdOrCtrl+I"))?,
        &MenuItem::with_id(handle, "format-underline", "Underline", false, Some("CmdOrCtrl+U"))?,
        &MenuItem::with_id(handle, "format-strikethrough", "Strikethrough", false, None::<&str>)?,
        &MenuItem::with_id(handle, "format-highlight", "Highlight", false, Some("CmdOrCtrl+Shift+H"))?,
        &PredefinedMenuItem::separator(handle)?,
        // Block formatting
        &MenuItem::with_id(handle, "format-code-fence", "Code Fence", false, Some("Alt+C"))?,
        &MenuItem::with_id(handle, "format-quote", "Quote", false, Some("Alt+Q"))?,
        &MenuItem::with_id(handle, "format-bullet-list", "Bullet List", false, Some("Alt+."))?,
        &MenuItem::with_id(handle, "format-ordered-list", "Ordered List", false, Some("Alt+O"))?,
        &MenuItem::with_id(handle, "format-task-list", "Task List", false, Some("Alt+X"))?,
        &PredefinedMenuItem::separator(handle)?,
        // Indentation & misc
        &MenuItem::with_id(handle, "format-indent", "Indent", false, Some("CmdOrCtrl+]"))?,
        &MenuItem::with_id(handle, "format-outdent", "Outdent", false, Some("CmdOrCtrl+["))?,
        &MenuItem::with_id(handle, "format-hr", "Horizontal Rule", false, Some("Alt+/"))?,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "format-clear", "Clear All Formatting", false, Some("CmdOrCtrl+."))?,
    ],
)?;
```

### 1.5 Theme Menu

```rust
let theme_menu = Submenu::with_items(
    handle,
    "Theme",
    true,
    &[
        &MenuItem::with_id(handle, "theme-next", "Next Theme", false, Some("Ctrl+Shift+ArrowDown"))?,
        &MenuItem::with_id(handle, "theme-prev", "Previous Theme", false, Some("Ctrl+Shift+ArrowUp"))?,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "theme-none", "No themes installed", false, None::<&str>)?,
    ],
)?;
```

### 1.6 Window Menu

```rust
let window_menu = Submenu::with_items(
    handle,
    "Window",
    true,
    &[
        &PredefinedMenuItem::minimize(handle, None)?,
        &PredefinedMenuItem::maximize(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::fullscreen(handle, None)?,
    ],
)?;
```

### 1.7 Help Menu

```rust
let help_menu = Submenu::with_items(
    handle,
    "Help",
    true,
    &[
        &MenuItem::with_id(handle, "help-quickstart", "Quickstart", false, None::<&str>)?,
        &MenuItem::with_id(handle, "help-cheatsheet", "Markdown Cheatsheet", false, None::<&str>)?,
    ],
)?;
```

### 1.8 Combine Into Menu

```rust
Menu::with_items(
    handle,
    &[
        &app_menu,
        &file_menu,
        &edit_menu,
        &format_menu,
        &theme_menu,
        &window_menu,
        &help_menu,
    ],
)
```

---

## Task 2: Wire Menu into Builder (lib.rs)

Add `mod menu;` at top of lib.rs. Add `.menu()` to the Builder chain:

```rust
mod menu;

// In run():
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .menu(|handle| menu::build_menu(handle))
    // ... rest of chain
```

---

## Acceptance Criteria

- [ ] `cargo check` passes with no errors or warnings
- [ ] App launches with native macOS menu bar
- [ ] All 7 menus are visible: Markable, File, Edit, Format, Theme, Window, Help
- [ ] File menu shows New, Open, Save, Save As with correct shortcut symbols
- [ ] Edit menu shows Undo, Redo, Cut, Copy, Paste, Select All
- [ ] Format menu shows all items grayed out with shortcuts
- [ ] PredefinedMenuItems work: Quit (Cmd-Q), Hide (Cmd-H), Minimize (Cmd-M), Copy/Paste
- [ ] Close (Cmd-W) hides window (existing hide-on-close behavior)
- [ ] Custom items (New, Open, Save) don't do anything yet (no event routing)

---

## Troubleshooting

**"missing trait Manager"**: Ensure `use tauri::Manager;` is imported if needed. The menu API uses `Manager` trait for `PredefinedMenuItem` constructors.

**Accelerator not showing**: Check the string format. Tauri uses muda format: `"CmdOrCtrl+S"`, not `"Cmd+S"`. See muda docs for key names.

**Menu not appearing**: Ensure `.menu()` is called before `.build()` in the Builder chain.
