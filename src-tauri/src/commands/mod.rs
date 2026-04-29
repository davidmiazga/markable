//! Tauri command registry.
//!
//! Each submodule exports commands that are registered via
//! the `tauri::generate_handler![]` macro in main.rs.

pub mod daily_note;
pub mod dialogs;
pub mod file_ops;
pub mod files;
pub mod io;
pub mod plugins;
pub mod settings;
pub mod themes;
pub mod vault;

pub use daily_note::{check_paths_exist, create_daily_note};
pub use dialogs::{open_file_dialog, open_folder_dialog, save_file_dialog, save_html_dialog};
pub use file_ops::{
    create_directory,
    create_file,
    delete_directory,
    delete_file,
    move_file,
    rename_file,
    reveal_in_finder,
    update_wiki_links,
};
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
pub use themes::{copy_default_themes, list_themes, read_theme_css};
pub use vault::{
    build_vault_index,
    create_vault,
    delete_vault,
    get_vault_index,
    list_vault_files,
    save_vault_index,
    search_vault_content,
    switch_vault,
    unwatch_vault,
    update_vault,
    validate_vault_paths,
    watch_vault,
    WatcherRegistry,
};
