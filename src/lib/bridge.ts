/**
 * TypeScript bridge to Tauri Rust commands.
 *
 * Wraps Tauri's invoke() with type-safe error handling and
 * discriminated unions for results.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FileResult, DialogResult, TauriCommandError } from "./errors";

import type { MarkableSettings } from "./settings";

// Re-export dialog functions from dialogs.ts
export { openFileDialog, saveFileDialog } from "./dialogs";
export type { DialogResult };

/**
 * Read file contents as UTF-8 string.
 *
 * @param path - Absolute file path
 * @returns Promise resolving to FileResult<string>
 *
 * @example
 * ```typescript
 * const result = await readFile("/path/to/file.md");
 * if (result.ok) {
 *   console.log(result.value); // File contents
 * } else {
 *   console.error(result.error.message); // Error message
 * }
 * ```
 */
export async function readFile(path: string): Promise<FileResult<string>> {
  try {
    const content = await invoke<string>("read_file", { path });
    return { ok: true, value: content };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "read_file",
        path,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Write file contents atomically.
 *
 * Uses temp-file-swap pattern to ensure data safety.
 * If write fails, the original file is never modified.
 *
 * @param path - Absolute file path (created if doesn't exist)
 * @param content - Content to write as UTF-8 string
 * @returns Promise resolving to FileResult<void>
 *
 * @example
 * ```typescript
 * const result = await writeFile("/path/to/file.md", "# Hello World");
 * if (result.ok) {
 *   console.log("File saved successfully");
 * } else {
 *   console.error(result.error.message); // Error message
 * }
 * ```
 */
export async function writeFile(
  path: string,
  content: string
): Promise<FileResult<void>> {
  try {
    await invoke("write_file", { path, content });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "write_file",
        path,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Load settings from the Rust backend.
 * On first launch, Rust creates the file with defaults.
 * On corrupt file, Rust returns defaults.
 */
export async function getSettings(): Promise<FileResult<MarkableSettings>> {
  try {
    const json = await invoke<string>("get_settings");
    const settings: MarkableSettings = JSON.parse(json);
    return { ok: true, value: settings };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "get_settings",
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Save settings to the Rust backend (atomic write).
 */
export async function saveSettings(
  settings: MarkableSettings
): Promise<FileResult<void>> {
  try {
    const json = JSON.stringify(settings);
    await invoke("save_settings", { settings: json });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "save_settings",
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Update the native "Open Recent" submenu with the given file paths.
 */
export async function updateRecentFilesMenu(paths: string[]): Promise<void> {
  try {
    await invoke("update_recent_files_menu", { paths });
  } catch (error) {
    console.error("Failed to update recent files menu:", error);
  }
}
