use tauri::{Emitter, Manager};
use serde_json::json;

mod commands;
mod menu;

pub use commands::{open_file_dialog, read_file, save_file_dialog, write_file, get_settings, save_settings};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(|handle| menu::build_menu(handle))
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            match id {
                "app-settings"
                | "file-new" | "file-open" | "file-save" | "file-save-as"
                | "file-reopen-last"
                | "view-toggle-preview"
                | "theme-next" | "theme-prev"
                | "theme-light" | "theme-dark" | "theme-system" => {
                    let _ = app_handle.emit("menu-event", json!({ "action": id }));
                }
                _ if id.starts_with("format-") => {
                    let _ = app_handle.emit("menu-event", json!({ "action": id }));
                }
                _ => {
                    #[cfg(debug_assertions)]
                    eprintln!("Unhandled menu event: {}", id);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_file_dialog,
            read_file,
            save_file_dialog,
            write_file,
            get_settings,
            save_settings
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
