use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

pub fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
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

    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "view-toggle-preview", "Preview", true, Some("CmdOrCtrl+E"))?,
        ],
    )?;

    let format_menu = Submenu::with_items(
        handle,
        "Format",
        true,
        &[
            &MenuItem::with_id(handle, "format-h1", "Heading 1", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(handle, "format-h2", "Heading 2", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(handle, "format-h3", "Heading 3", true, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(handle, "format-h4", "Heading 4", true, Some("CmdOrCtrl+4"))?,
            &MenuItem::with_id(handle, "format-h5", "Heading 5", true, Some("CmdOrCtrl+5"))?,
            &MenuItem::with_id(handle, "format-h6", "Heading 6", true, Some("CmdOrCtrl+6"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-bold", "Bold", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(handle, "format-italic", "Italic", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(handle, "format-underline", "Underline", true, Some("CmdOrCtrl+U"))?,
            &MenuItem::with_id(handle, "format-strikethrough", "Strikethrough", true, Some("CmdOrCtrl+Shift+X"))?,
            &MenuItem::with_id(handle, "format-highlight", "Highlight", true, Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-code-fence", "Code Fence", true, Some("Alt+C"))?,
            &MenuItem::with_id(handle, "format-quote", "Quote", true, Some("Alt+Q"))?,
            &MenuItem::with_id(handle, "format-bullet-list", "Bullet List", true, Some("Alt+."))?,
            &MenuItem::with_id(handle, "format-ordered-list", "Ordered List", true, Some("Alt+O"))?,
            &MenuItem::with_id(handle, "format-task-list", "Task List", true, Some("Alt+X"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-indent", "Indent", true, Some("CmdOrCtrl+]"))?,
            &MenuItem::with_id(handle, "format-outdent", "Outdent", true, Some("CmdOrCtrl+["))?,
            &MenuItem::with_id(handle, "format-hr", "Horizontal Rule", true, Some("Alt+/"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-clear", "Clear All Formatting", true, Some("CmdOrCtrl+\\"))?,
        ],
    )?;

    let theme_menu = Submenu::with_items(
        handle,
        "Theme",
        true,
        &[
            &MenuItem::with_id(handle, "theme-next", "Next Theme", true, Some("CmdOrCtrl+Alt+."))?,
            &MenuItem::with_id(handle, "theme-prev", "Previous Theme", true, Some("CmdOrCtrl+Alt+,"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "theme-light", "Light", true, None::<&str>)?,
            &MenuItem::with_id(handle, "theme-dark", "Dark", true, None::<&str>)?,
            &MenuItem::with_id(handle, "theme-system", "System", true, None::<&str>)?,
        ],
    )?;

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

    let help_menu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[
            &MenuItem::with_id(handle, "help-quickstart", "Quickstart", false, None::<&str>)?,
            &MenuItem::with_id(handle, "help-cheatsheet", "Markdown Cheatsheet", false, None::<&str>)?,
        ],
    )?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &format_menu,
            &theme_menu,
            &window_menu,
            &help_menu,
        ],
    )
}
