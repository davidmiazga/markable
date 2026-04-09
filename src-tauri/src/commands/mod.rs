//! Tauri command registry.
//!
//! Each submodule exports commands that are registered via
//! the `tauri::generate_handler![]` macro in main.rs.

pub mod dialogs;
pub mod io;
pub mod settings;
pub mod themes;

pub use dialogs::{open_file_dialog, save_file_dialog, save_html_dialog};
pub use io::{read_file, write_file};
pub use settings::{get_settings, save_settings};
pub use themes::{list_themes, read_theme_css};
