/**
 * TypeScript bridge to Tauri Rust commands.
 *
 * Wraps Tauri's invoke() with type-safe error handling and
 * discriminated unions for results.
 */

import { invoke } from "@tauri-apps/api/core";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";
import type { FileResult, DialogResult, TauriCommandError } from "./errors";

import type { MarkableSettings } from "./settings";

// Re-export dialog functions from dialogs.ts
export { openFileDialog, saveFileDialog, saveHtmlDialog } from "./dialogs";
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
 * Read a bundled help resource file by bare filename (e.g. "quickstart.md").
 * Throws if the file cannot be read.
 */
export async function readResourceFile(name: string): Promise<string> {
  return invoke<string>("read_resource_file", { name });
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

// --- Theme commands ---

export interface ThemeEntry {
  name: string;
  filename: string;
}

/**
 * List all custom .css theme files from the themes directory.
 */
export async function listThemes(): Promise<ThemeEntry[]> {
  try {
    return await invoke<ThemeEntry[]>("list_themes");
  } catch (error) {
    console.error("Failed to list themes:", error);
    return [];
  }
}

/**
 * Update the native Theme menu to include custom themes.
 */
export async function updateThemeMenu(themes: ThemeEntry[]): Promise<void> {
  try {
    await invoke("update_theme_menu", { themes });
  } catch (error) {
    console.error("Failed to update theme menu:", error);
  }
}

/**
 * Read plain text from the system clipboard via Tauri (no browser permission needed).
 * Returns empty string on failure.
 */
export async function readClipboardText(): Promise<string> {
  try {
    return await clipboardReadText() ?? "";
  } catch (err) {
    console.warn("readClipboardText failed:", err);
    return "";
  }
}

/**
 * Read the CSS contents of a custom theme file.
 */
export async function readThemeCss(filename: string): Promise<string | null> {
  try {
    return await invoke<string>("read_theme_css", { filename });
  } catch (error) {
    console.error(`Failed to read theme CSS "${filename}":`, error);
    return null;
  }
}
