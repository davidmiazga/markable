use tauri::{Emitter, Manager};
use tauri::menu::MenuItem;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

mod commands;
mod menu;

pub use commands::{open_file_dialog, read_file, save_file_dialog, write_file, get_settings, save_settings};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(|handle| menu::build_menu(handle))
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            let forward = match id {
                "app-settings"
                | "file-new" | "file-open" | "file-save" | "file-save-as"
                | "view-toggle-preview"
                | "view-zoom-in" | "view-zoom-out" | "view-zoom-reset"
                | "theme-next" | "theme-prev"
                | "theme-light" | "theme-dark" | "theme-system" => true,
                _ if id.starts_with("format-") || id.starts_with("recent-file-") => true,
                _ => {
                    #[cfg(debug_assertions)]
                    eprintln!("Unhandled menu event: {}", id);
                    false
                }
            };
            if forward {
                // Ensure the window is visible before emitting — the JS listener
                // won't receive events if the webview is hidden (macOS hide-on-close).
                if let Some(window) = app_handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                let _ = app_handle.emit("menu-event", json!({ "action": id }));
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_file_dialog,
            read_file,
            save_file_dialog,
            write_file,
            get_settings,
            save_settings,
            update_recent_files_menu
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
