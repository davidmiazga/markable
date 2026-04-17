use tauri::{Emitter, Manager};
use tauri::menu::{MenuItem, PredefinedMenuItem};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

mod commands;
mod menu;

/// Set the macOS NSWindow alpha (opacity). 0.0 = invisible, 1.0 = fully opaque.
/// Used to hide the window from the user while macOS/rfd force it on-screen
/// during file dialog presentation.
#[cfg(target_os = "macos")]
fn set_window_alpha<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, alpha: f64) {
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            let ns_window = ptr as *const objc2_app_kit::NSWindow;
            (*ns_window).setAlphaValue(alpha as _);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_window_alpha<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>, _alpha: f64) {}

pub use commands::{
    open_file_dialog, read_file, save_file_dialog, save_html_dialog, write_file,
    get_settings, save_settings,
    list_themes, read_theme_css,
    copy_core_plugins,
    list_core_plugins,
    list_md_files,
    ensure_directory,
    list_user_plugins, read_plugin_file, read_plugin_settings, write_plugin_settings,
};

/// Read a bundled help resource file by filename.
/// Files are embedded at compile time — no AppHandle, no path resolution, cannot fail.
#[tauri::command]
fn read_resource_file(name: String) -> Result<String, String> {
    match name.as_str() {
        "quickstart.md" => Ok(include_str!("../help/quickstart.md").to_string()),
        "help.md" => Ok(include_str!("../help/help.md").to_string()),
        "markdown-cheatsheet.md" => Ok(include_str!("../help/markdown-cheatsheet.md").to_string()),
        _ => Err(format!("Unknown help file: {}", name)),
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Unique-ID counter so dynamically-created menu items never collide.
static MENU_ITEM_COUNTER: AtomicU64 = AtomicU64::new(0);

fn find_recent_submenu<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
) -> Result<tauri::menu::Submenu<R>, String> {
    let items = menu.items().map_err(|e| format!("Failed to get menu items: {}", e))?;
    for item in &items {
        if let Some(submenu) = item.as_submenu() {
            let sub_items = submenu.items().map_err(|e| format!("Failed to get submenu items: {}", e))?;
            for sub_item in &sub_items {
                if let Some(recent_submenu) = sub_item.as_submenu() {
                    if recent_submenu.id().as_ref() == "open-recent-submenu" {
                        return Ok(recent_submenu.clone());
                    }
                }
            }
        }
    }
    Err("Could not find open-recent-submenu".to_string())
}

#[tauri::command]
fn update_recent_files_menu(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    let menu = app.menu().ok_or("No app menu found")?;
    let recent_submenu = find_recent_submenu(&menu)?;

    // Clear existing items
    let existing = recent_submenu.items().map_err(|e| format!("Failed to get recent items: {}", e))?;
    for old_item in &existing {
        let _ = recent_submenu.remove(old_item);
    }

    if paths.is_empty() {
        let n = MENU_ITEM_COUNTER.fetch_add(1, Ordering::Relaxed);
        let empty_item = MenuItem::with_id(
            &app,
            &format!("recent-empty-{}", n),
            "(No Recent Files)",
            false,
            None::<&str>,
        ).map_err(|e| format!("Failed to create menu item: {}", e))?;
        recent_submenu.append(&empty_item).map_err(|e| format!("Failed to append item: {}", e))?;
    } else {
        for (i, path) in paths.iter().enumerate() {
            let label = path.rsplit('/').next().unwrap_or(path);
            let n = MENU_ITEM_COUNTER.fetch_add(1, Ordering::Relaxed);
            let id = format!("recent-file-{}-{}", i, n);

            // First item gets the Cmd+Alt+O accelerator hint
            let accel: Option<&str> = if i == 0 { Some("CmdOrCtrl+Alt+O") } else { None };

            let item = MenuItem::with_id(
                &app,
                &id,
                label,
                true,
                accel,
            ).map_err(|e| format!("Failed to create menu item: {}", e))?;

            recent_submenu.append(&item).map_err(|e| format!("Failed to append item: {}", e))?;

            // Register a click handler on the AppHandle for this item.
            // Builder's on_menu_event may not fire for dynamically added items,
            // so we register explicitly per item.
            let app_clone = app.clone();
            let idx = i;
            app.on_menu_event(move |_app, event| {
                if event.id().as_ref() == id {
                    if let Some(window) = app_clone.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    let _ = app_clone.emit("menu-event", json!({ "action": format!("recent-file-{}", idx) }));
                }
            });
        }
    }

    Ok(())
}

/// Rebuild the Theme menu to include custom themes after the built-in entries.
/// Called from frontend after theme discovery.
#[tauri::command]
fn update_theme_menu(app: tauri::AppHandle, themes: Vec<commands::themes::ThemeEntry>) -> Result<(), String> {
    let menu = app.menu().ok_or("No app menu found")?;
    let items = menu.items().map_err(|e| format!("Failed to get menu items: {}", e))?;

    // Find the "theme-menu" submenu
    for item in &items {
        if let Some(submenu) = item.as_submenu() {
            if submenu.id().as_ref() == "theme-menu" {
                // Remove everything and rebuild from scratch
                let existing = submenu.items().map_err(|e| format!("Failed to get items: {}", e))?;
                for old in &existing {
                    let _ = submenu.remove(old);
                }

                // Re-add built-in items
                let next = MenuItem::with_id(&app, "theme-next", "Next Theme", true, Some("CmdOrCtrl+Alt+."))
                    .map_err(|e| format!("{}", e))?;
                let prev = MenuItem::with_id(&app, "theme-prev", "Previous Theme", true, Some("CmdOrCtrl+Alt+,"))
                    .map_err(|e| format!("{}", e))?;
                let sep1 = PredefinedMenuItem::separator(&app)
                    .map_err(|e| format!("{}", e))?;
                let light = MenuItem::with_id(&app, "theme-light", "Light", true, None::<&str>)
                    .map_err(|e| format!("{}", e))?;
                let dark = MenuItem::with_id(&app, "theme-dark", "Dark", true, None::<&str>)
                    .map_err(|e| format!("{}", e))?;
                let system = MenuItem::with_id(&app, "theme-system", "System", true, None::<&str>)
                    .map_err(|e| format!("{}", e))?;

                submenu.append(&next).map_err(|e| format!("{}", e))?;
                submenu.append(&prev).map_err(|e| format!("{}", e))?;
                submenu.append(&sep1).map_err(|e| format!("{}", e))?;
                submenu.append(&light).map_err(|e| format!("{}", e))?;
                submenu.append(&dark).map_err(|e| format!("{}", e))?;
                submenu.append(&system).map_err(|e| format!("{}", e))?;

                // Add custom themes if any
                if !themes.is_empty() {
                    let sep2 = PredefinedMenuItem::separator(&app)
                        .map_err(|e| format!("{}", e))?;
                    submenu.append(&sep2).map_err(|e| format!("{}", e))?;

                    for theme in &themes {
                        let n = MENU_ITEM_COUNTER.fetch_add(1, Ordering::Relaxed);
                        let id = format!("custom-theme-{}-{}", theme.filename, n);

                        let item = MenuItem::with_id(&app, &id, &theme.name, true, None::<&str>)
                            .map_err(|e| format!("{}", e))?;
                        submenu.append(&item).map_err(|e| format!("{}", e))?;

                        // Register per-item handler
                        let app_clone = app.clone();
                        let filename = theme.filename.clone();
                        app.on_menu_event(move |_app, event| {
                            if event.id().as_ref() == id {
                                if let Some(window) = app_clone.get_webview_window("main") {
                                    if !window.is_visible().unwrap_or(true) {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                                let _ = app_clone.emit("menu-event", json!({ "action": format!("custom:{}", filename) }));
                            }
                        });
                    }
                }

                return Ok(());
            }
        }
    }

    Err("Could not find theme-menu submenu".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(|handle| menu::build_menu(handle))
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            let forward = match id {
                "app-settings" | "app-keybindings" | "app-plugins"
                | "file-new" | "file-open" | "file-save" | "file-save-as" | "file-export" | "file-import" | "file-print"
                // AC-C1/AC-C3: file-close-all is explicitly forwarded so the
                // frontend hide() call fires via the standard menu-event pathway.
                | "file-close-all"
                | "edit-paste-plain"
                | "edit-paste-link"
                | "edit-copy-plain"
                | "edit-copy-html"
                | "edit-select-none" | "edit-duplicate-line" | "edit-delete-line" | "edit-goto-line"
                | "view-toggle-preview" | "view-toggle-statusbar" | "view-toggle-focus" | "view-toggle-typewriter"
                | "view-zoom-in" | "view-zoom-out" | "view-zoom-reset"
                | "theme-next" | "theme-prev"
                | "file-new-from-template" | "file-save-as-template"
                | "theme-light" | "theme-dark" | "theme-system" => true,
                _ if id.starts_with("format-") || id.starts_with("recent-file-") || id.starts_with("help-") => true,
                _ => {
                    #[cfg(debug_assertions)]
                    eprintln!("Unhandled menu event: {}", id);
                    false
                }
            };
            if forward {
                let mut handled = false;

                if let Some(window) = app_handle.get_webview_window("main") {
                    let is_hidden = !window.is_visible().unwrap_or(true);

                    // Special case: file-open / file-import while window is hidden.
                    // macOS + rfd's FocusManager will force our window on-screen when
                    // NSOpenPanel is presented. We counter this by setting the window's
                    // alpha to 0 (invisible) before opening the dialog.
                    if is_hidden && (id == "file-open" || id == "file-import") {
                        use tauri_plugin_dialog::DialogExt;

                        set_window_alpha(&window, 0.0);

                        let app_clone = app_handle.clone();
                        app_clone.dialog()
                            .file()
                            .add_filter("Markdown", &["md"])
                            .add_filter("Text", &["txt"])
                            .add_filter("All Files", &["*"])
                            .pick_file(move |path| {
                                if let Some(w) = app_clone.get_webview_window("main") {
                                    if let Some(p) = path {
                                        // File selected → restore, show, load
                                        set_window_alpha(&w, 1.0);
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                        let _ = app_clone.emit("menu-event",
                                            json!({ "action": "open-file-path", "path": p.to_string() }));
                                    } else {
                                        // Cancelled → restore alpha, re-hide
                                        set_window_alpha(&w, 1.0);
                                        let _ = w.hide();
                                    }
                                }
                            });
                        handled = true;
                    }

                    // Normal path: show window before emitting — JS listener
                    // won't receive events if the webview is hidden.
                    if !handled && is_hidden {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }

                if !handled {
                    let _ = app_handle.emit("menu-event", json!({ "action": id }));
                }
            }
        })
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
            list_core_plugins,
            list_md_files,
            ensure_directory,
            list_user_plugins,
            read_plugin_file,
            read_plugin_settings,
            write_plugin_settings,
            update_recent_files_menu,
            update_theme_menu
        ])
        .on_window_event(|window, event| {
            // Hide-on-close: intercept the close request and hide the window
            // instead of destroying it. This is standard macOS behavior --
            // the app stays in the dock and can be re-shown.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                // Tell JS to clear the editor so it's blank if the window reappears
                let _ = window.app_handle().emit("menu-event", json!({ "action": "file-close-all" }));
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // Resumed / Reopen: do nothing. The window stays hidden until the
            // user explicitly opens a file (File > Open) or creates one (File > New).
            // The macOS menu bar is always accessible without a visible window.
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
