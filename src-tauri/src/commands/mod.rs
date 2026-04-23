//! Tauri command registry.
//!
//! Each submodule exports commands that are registered via
//! the `tauri::generate_handler![]` macro in main.rs.

pub mod daily_note;
pub mod dialogs;
pub mod files;
pub mod io;
pub mod plugins;
pub mod settings;
pub mod themes;

pub use daily_note::{check_paths_exist, create_daily_note};
pub use dialogs::{open_file_dialog, open_folder_dialog, save_file_dialog, save_html_dialog};
pub use files::{list_md_files, list_preset_files, ensure_directory};
pub use io::{read_file, write_file};
pub use plugins::{
    copy_core_plugins,
    list_core_plugins,
    list_user_plugins,
    read_plugin_file,
    read_plugin_settings,
    write_plugin_settings,
};
pub use settings::{get_settings, save_settings};
pub use themes::{list_themes, read_theme_css};
