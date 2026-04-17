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
            &MenuItem::with_id(handle, "app-settings", "Settings", true, Some("CmdOrCtrl+Comma"))?,
            &MenuItem::with_id(handle, "app-keybindings", "Keyboard Shortcuts", true, Some("CmdOrCtrl+Alt+Shift+K"))?,
            &MenuItem::with_id(handle, "app-plugins", "Plugins", true, Some("CmdOrCtrl+Shift+P"))?,
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
            &MenuItem::with_id(handle, "file-new-from-template", "New from Template...", true, Some("CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(handle, "file-open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &Submenu::with_id_and_items(
                handle,
                "open-recent-submenu",
                "Open Recent",
                true,
                &[
                    &MenuItem::with_id(handle, "recent-empty", "(No Recent Files)", false, None::<&str>)?,
                ],
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "file-save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(handle, "file-save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(handle, "file-save-as-template", "Save as Template...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "file-export", "Export as HTML...", true, Some("CmdOrCtrl+Alt+E"))?,
            &MenuItem::with_id(handle, "file-import", "Import (.md / .txt)...", true, Some("CmdOrCtrl+Alt+Shift+I"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "file-print", "Print...", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, Some("Close"))?,
            // AC-C2: "Close All" sits directly below "Close" with CmdOrCtrl+Shift+W.
            // In the single-window architecture this hides the window just as "Close" does,
            // but the distinct menu item preserves standard macOS File menu conventions.
            &MenuItem::with_id(handle, "file-close-all", "Close All", true, Some("CmdOrCtrl+Shift+W"))?,
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
            &MenuItem::with_id(handle, "edit-copy-plain", "Copy As Plain Text", true, Some("CmdOrCtrl+Alt+T"))?,
            &MenuItem::with_id(handle, "edit-copy-html", "Copy As HTML", true, Some("CmdOrCtrl+Alt+C"))?,
            &PredefinedMenuItem::paste(handle, None)?,
            &MenuItem::with_id(handle, "edit-paste-plain", "Paste Without Formatting", true, Some("CmdOrCtrl+Alt+V"))?,
            &MenuItem::with_id(handle, "edit-paste-link", "Paste Link", true, Some("CmdOrCtrl+K"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::select_all(handle, None)?,
            &MenuItem::with_id(handle, "edit-select-none", "Select None", true, Some("CmdOrCtrl+Shift+D"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "edit-duplicate-line", "Duplicate Line", true, Some("CmdOrCtrl+D"))?,
            &MenuItem::with_id(handle, "edit-delete-line", "Delete Line", true, Some("CmdOrCtrl+Alt+Shift+Backspace"))?,
            &MenuItem::with_id(handle, "edit-goto-line", "Go to Line...", true, Some("Ctrl+G"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "edit-find", "Find...", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(handle, "edit-find-replace", "Find and Replace...", true, Some("CmdOrCtrl+Alt+F"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "view-toggle-preview", "Preview", true, Some("CmdOrCtrl+E"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "view-zoom-in", "Zoom In", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(handle, "view-zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(handle, "view-zoom-reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "view-toggle-statusbar", "Status Bar", true, None::<&str>)?,
            &MenuItem::with_id(handle, "view-toggle-focus", "Focus Mode", true, None::<&str>)?,
            &MenuItem::with_id(handle, "view-toggle-typewriter", "Typewriter Mode", true, None::<&str>)?,
        ],
    )?;

    let format_menu = Submenu::with_items(
        handle,
        "Format",
        true,
        &[
            &Submenu::with_id_and_items(
                handle,
                "format-heading-submenu",
                "Heading",
                true,
                &[
                    &MenuItem::with_id(handle, "format-h1", "Heading 1", true, Some("CmdOrCtrl+1"))?,
                    &MenuItem::with_id(handle, "format-h2", "Heading 2", true, Some("CmdOrCtrl+2"))?,
                    &MenuItem::with_id(handle, "format-h3", "Heading 3", true, Some("CmdOrCtrl+3"))?,
                    &MenuItem::with_id(handle, "format-h4", "Heading 4", true, Some("CmdOrCtrl+4"))?,
                    &MenuItem::with_id(handle, "format-h5", "Heading 5", true, Some("CmdOrCtrl+5"))?,
                    &MenuItem::with_id(handle, "format-h6", "Heading 6", true, Some("CmdOrCtrl+6"))?,
                ],
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-bold", "Bold", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(handle, "format-italic", "Italic", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(handle, "format-underline", "Underline", true, Some("CmdOrCtrl+U"))?,
            &MenuItem::with_id(handle, "format-strikethrough", "Strikethrough", true, Some("CmdOrCtrl+Shift+X"))?,
            &MenuItem::with_id(handle, "format-highlight", "Highlight", true, Some("CmdOrCtrl+Shift+H"))?,
            &MenuItem::with_id(handle, "format-superscript", "Superscript", true, Some("CmdOrCtrl+Shift+6"))?,
            &MenuItem::with_id(handle, "format-subscript", "Subscript", true, Some("CmdOrCtrl+Shift+9"))?,
            &MenuItem::with_id(handle, "format-comment", "Comment", true, Some("CmdOrCtrl+Shift+\\"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-code-fence", "Code Fence", true, Some("CmdOrCtrl+Shift+C"))?,
            &MenuItem::with_id(handle, "format-quote", "Callout", true, Some("CmdOrCtrl+Shift+."))?,
            &Submenu::with_id_and_items(
                handle,
                "format-list-submenu",
                "List",
                true,
                &[
                    &MenuItem::with_id(handle, "format-bullet-list", "Bullet List", true, Some("CmdOrCtrl+Shift+-"))?,
                    &MenuItem::with_id(handle, "format-ordered-list", "Ordered List", true, Some("CmdOrCtrl+Shift+1"))?,
                    &MenuItem::with_id(handle, "format-task-list", "Task List", true, Some("CmdOrCtrl+Shift+;"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &Submenu::with_id_and_items(
                        handle,
                        "format-list-style-submenu",
                        "List Style",
                        true,
                        &[
                            &MenuItem::with_id(handle, "format-list-style-standard", "Standard", true, None::<&str>)?,
                            &MenuItem::with_id(handle, "format-list-style-alphanumeric", "Alphanumeric (I. A. 1. a. i.)", true, Some("Ctrl+R"))?,
                            &MenuItem::with_id(handle, "format-list-style-decimal", "Decimal Outline (1.1.)", true, Some("Ctrl+N"))?,
                            &MenuItem::with_id(handle, "format-list-style-steps", "Steps (1. a. -)", true, Some("Ctrl+L"))?,
                        ],
                    )?,
                ],
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-indent", "Indent", true, Some("CmdOrCtrl+]"))?,
            &MenuItem::with_id(handle, "format-outdent", "Outdent", true, Some("CmdOrCtrl+["))?,
            &MenuItem::with_id(handle, "format-hr", "Horizontal Rule", true, Some("CmdOrCtrl+Shift+R"))?,
            &PredefinedMenuItem::separator(handle)?,
            &Submenu::with_id_and_items(
                handle,
                "format-insert-submenu",
                "Insert",
                true,
                &[
                    &MenuItem::with_id(handle, "format-image", "Insert Image", true, Some("CmdOrCtrl+Shift+I"))?,
                    &MenuItem::with_id(handle, "format-table", "Insert Table", true, Some("CmdOrCtrl+Shift+T"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "format-front-matter", "Insert Front Matter", true, Some("CmdOrCtrl+Shift+Y"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "format-math-inline", "Insert Math", true, Some("CmdOrCtrl+Shift+M"))?,
                    &MenuItem::with_id(handle, "format-math-block", "Insert Math Block", true, None::<&str>)?,
                ],
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-clear", "Clear All Formatting", true, Some("CmdOrCtrl+\\"))?,
        ],
    )?;

    let theme_menu = Submenu::with_id_and_items(
        handle,
        "theme-menu",
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
            &MenuItem::with_id(handle, "help-quickstart", "Quickstart", true, None::<&str>)?,
            &MenuItem::with_id(handle, "help-help", "Help", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "help-cheatsheet", "Markdown Cheatsheet", true, None::<&str>)?,
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
