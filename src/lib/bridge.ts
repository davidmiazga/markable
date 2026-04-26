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
export { openFileDialog, openFolderDialog, saveFileDialog, saveHtmlDialog } from "./dialogs";
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

// ── Directory scanning ──────────────────────────────────────────────────────

/**
 * List .md filenames in a directory (shallow, non-recursive).
 *
 * Returns filenames only (not full paths), sorted alphabetically
 * (case-insensitive). Hidden files are excluded. Returns an empty
 * array if the directory does not exist or cannot be read.
 *
 * Used by the backlinks plugin for auto-complete file suggestions
 * and for building the backlink index of sibling documents.
 *
 * @param directoryPath - Absolute path to the directory to scan
 * @returns Sorted array of .md filenames (e.g. ["alpha.md", "beta.md"])
 */
export async function listMdFiles(directoryPath: string): Promise<string[]> {
  try {
    return await invoke<string[]>("list_md_files", { path: directoryPath });
  } catch (error) {
    console.error("Failed to list md files:", error);
    return [];
  }
}

// ── Directory management ─────────────────────────────────────────────────────

/**
 * Ensure a directory exists, creating it and all parents if absent.
 *
 * Wraps the Rust `ensure_directory` command. No-op if the directory
 * already exists. Throws on failure (permissions, path conflict).
 *
 * @param path - Absolute path to the directory to ensure
 */
export async function ensureDirectory(path: string): Promise<void> {
  await invoke("ensure_directory", { path });
}

// ── Core plugin copy ──────────────────────────────────────────────────────────

/**
 * Copy bundled core plugin `.js` files from the Tauri resource directory into
 * the user data `plugins/core/` directory.
 *
 * No-op if the `pluginsCopiedForVersion` stamp in settings.json already matches
 * the current app version (EC-34). On first install or version upgrade, all four
 * core plugin files are copied (EC-1, EC-5).
 *
 * Non-fatal: if the bundled resource directory is absent (e.g. `tauri dev` mode),
 * the command logs a message and writes the version stamp so re-checks are avoided
 * on subsequent launches. The frontend wraps this call in a try/catch so any
 * unexpected errors do not crash `initApp()`.
 */
export async function copyCorePlugins(): Promise<void> {
  await invoke<void>("copy_core_plugins");
}

/**
 * Copy bundled default theme CSS files to Application Support/themes/.
 * Only writes files that don't already exist — user customisations are safe.
 * Returns the number of newly installed themes (0 = all already present).
 * Non-fatal: silently succeeds in tauri dev where the resource dir is absent.
 */
export async function copyDefaultThemes(): Promise<number> {
  return invoke<number>("copy_default_themes");
}

// ── User Plugin commands ──────────────────────────────────────────────────────

/**
 * Response shape returned by the Rust `list_user_plugins` command.
 * `files` contains the accepted filenames (max 50, lexicographic order).
 * `truncated` contains any filenames that were dropped because the cap was
 * reached — used by the frontend to emit a user-visible warning (HF-2).
 */
export interface ListUserPluginsResponse {
  files: string[];
  truncated: string[];
}

/**
 * List top-level .js filenames in the user plugins directory.
 *
 * Returns the Rust-structured response containing the accepted file list and
 * any names that were dropped by the 50-plugin cap.  Returns
 * `{ files: [], truncated: [] }` if the directory does not exist (Rust
 * creates it on first call) or if the command fails.
 *
 * EC-1, EC-27, HF-2.
 */
export async function listUserPlugins(): Promise<ListUserPluginsResponse> {
  try {
    return await invoke<ListUserPluginsResponse>("list_user_plugins");
  } catch (error) {
    console.error("Failed to list user plugins:", error);
    return { files: [], truncated: [] };
  }
}

/**
 * Discriminated union result from `readPluginFile`.
 * `{ source }` on success; `{ error }` when Rust rejects the file with a
 * human-readable reason (too large, binary, not found, path traversal).
 * Using a discriminated union rather than `string | null` lets callers thread
 * the rejection reason into `UserPluginRecord.failReason` (MF-1).
 */
export type ReadPluginFileResult = { source: string } | { error: string };

/**
 * List top-level .js filenames in the core plugins directory.
 *
 * Returns the Rust-structured response. The `truncated` array is always empty
 * for core plugins (no cap). Returns `{ files: [], truncated: [] }` if the
 * directory does not exist (e.g. dev mode where copy was skipped).
 *
 * EC-1: directory is created by copy_core_plugins, not by this command.
 */
export async function listCorePlugins(): Promise<ListUserPluginsResponse> {
  try {
    return await invoke<ListUserPluginsResponse>("list_core_plugins");
  } catch (error) {
    console.error("Failed to list core plugins:", error);
    return { files: [], truncated: [] };
  }
}

/**
 * Read the source text of a plugin file.
 *
 * Returns `{ source }` on success, or `{ error: reason }` when Rust rejects
 * the file. The caller should propagate the error string into the plugin
 * record's `failReason` field so the panel can display a meaningful message.
 *
 * The `kind` parameter routes the read to the correct subdirectory:
 *   - `"core"` → reads from `plugins/core/`
 *   - `"user"` or omitted → reads from `plugins/user/`
 *
 * EC-11, EC-12, EC-13, MF-1.
 */
export async function readPluginFile(
  filename: string,
  kind?: "core" | "user",
): Promise<ReadPluginFileResult> {
  try {
    const source = await invoke<string>("read_plugin_file", {
      filename,
      kind: kind ?? null,
    });
    return { source };
  } catch (error) {
    const reason = typeof error === "string" ? error : String(error);
    console.warn(`Failed to read plugin file "${filename}":`, reason);
    return { error: reason };
  }
}

/**
 * Read per-plugin settings JSON.
 * Returns the parsed object, or null if no settings file exists yet (EC-23).
 */
export async function readPluginSettings(
  pluginId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await invoke<string | null>("read_plugin_settings", { pluginId });
    if (raw === null || raw === undefined) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    console.warn(`Failed to read settings for plugin "${pluginId}":`, error);
    return null;
  }
}

/**
 * Write per-plugin settings JSON.
 * Throws if data is not JSON-serialisable (EC-25 — Rust validates before write).
 */
export async function writePluginSettings(
  pluginId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(data);
  await invoke("write_plugin_settings", { pluginId, data: json });
}
