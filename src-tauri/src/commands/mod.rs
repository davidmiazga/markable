//! Tauri command registry.
//!
//! Each submodule exports commands that are registered via
//! the `tauri::generate_handler![]` macro in main.rs.

pub mod dialogs;
pub mod io;

pub use dialogs::{open_file_dialog, save_file_dialog};
pub use io::{read_file, write_file};
