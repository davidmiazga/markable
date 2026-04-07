//! Tauri command registry.
//!
//! Each submodule exports commands that are registered via
//! the `tauri::generate_handler![]` macro in main.rs.

pub mod io;

pub use io::{read_file, write_file};
