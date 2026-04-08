/// File dialog commands using Tauri v2 dialog plugin
///
/// This module provides native file open/save dialogs that integrate
/// with the system's file browser (Finder on macOS, Explorer on Windows, etc.).

use std::sync::mpsc;

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
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .add_filter("All Files", &["*"])
        .pick_file(move |path| {
            let path_string = path.map(|p| p.to_string());
            let _ = tx.send(path_string);
        });

    // Wait for the result
    rx.recv().map_err(|e| {
        eprintln!("open_file_dialog error: {}", e);
        format!("File dialog failed: {}", e)
    })
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
pub async fn save_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .add_filter("All Files", &["*"])
        .set_file_name("untitled.md")
        .save_file(move |path| {
            let path_string = path.map(|p| p.to_string());
            let _ = tx.send(path_string);
        });

    // Wait for the result
    rx.recv().map_err(|e| {
        eprintln!("save_file_dialog error: {}", e);
        format!("File dialog failed: {}", e)
    })
}
