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
export { openAssetDialog, openFileDialog, openFolderDialog, saveFileDialog, saveHtmlDialog, saveImageDialog } from "./dialogs";
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
 * Write raw binary data to a file atomically.
 *
 * Uses the same temp-file-swap pattern as `writeFile` (write → sync_all →
 * rename). If the write fails, the original file at `path` is never modified.
 *
 * IMPORTANT — `data` must be `number[]`, not `Uint8Array`. Tauri's JSON
 * serialiser correctly maps a JavaScript `number[]` (values 0–255) to Rust's
 * `Vec<u8>`. `Uint8Array` is serialised differently and arrives on the Rust
 * side as an object rather than a flat byte array, breaking the deserialization.
 * Convert with: `Array.from(new Uint8Array(arrayBuffer))`.
 *
 * @param path - Absolute file path (file is created if it doesn't exist)
 * @param data - Raw bytes as a plain array of unsigned integers (0–255)
 * @returns Promise resolving to FileResult<void>
 *
 * @example
 * ```typescript
 * const buffer = await blob.arrayBuffer();
 * const bytes = Array.from(new Uint8Array(buffer)); // NOT new Uint8Array directly
 * const result = await writeBinaryFile("/vault/assets/20260505-143022.png", bytes);
 * if (!result.ok) {
 *   alert(`Write failed: ${result.error.message}`);
 * }
 * ```
 */
export async function writeBinaryFile(
  path: string,
  data: number[]
): Promise<FileResult<void>> {
  try {
    await invoke("write_binary_file", { path, data });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "write_binary_file",
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

/**
 * Delete a directory and all its contents recursively.
 *
 * Wraps the Rust `delete_directory` command. No-op if the directory
 * does not exist (caller should catch errors for missing paths).
 * Throws on failure (permissions, path is a file, etc.).
 *
 * @param path - Absolute path to the directory to delete
 */
export async function deleteDirectory(path: string): Promise<void> {
  await invoke("delete_directory", { path });
}

/**
 * Returns the user's home directory path (e.g. /Users/dave).
 * Used to expand "~/" prefixes in user-configured paths.
 */
export async function getHomeDir(): Promise<string> {
  return invoke<string>("get_home_dir");
}

export async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
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

/**
 * Reveal a file in Finder (macOS only).
 *
 * Opens a Finder window with the file at `path` selected, equivalent to
 * "Show in Finder" in most macOS apps. Wraps the Rust `reveal_in_finder`
 * command which calls `open -R <path>` under the hood.
 *
 * Errors are caught and logged via console.error. They are NOT re-thrown
 * because a Finder failure (e.g. file moved or deleted since the tab was
 * opened) is non-fatal — the user's tab and document are unaffected.
 * This satisfies EC-14 in the tab context menu spec.
 *
 * @param path  Absolute path to the file to reveal.
 */
export async function revealInFinder(path: string): Promise<void> {
  try {
    await invoke("reveal_in_finder", { path });
  } catch (error) {
    console.error("revealInFinder failed:", error);
  }
}

// ─── Content search types (step_01) ──────────────────────────────────────────

/**
 * A single line that matched the search query.
 * Mirrors the Rust LineMatch struct (serde camelCase).
 */
export interface LineMatch {
  /** 1-based line number within the file. */
  lineNumber: number;
  /** Full text of the matching line (trimmed). */
  lineText: string;
  /**
   * 0-based character (Unicode scalar) offset of the match start within lineText.
   * This is a character count, not a byte offset, so it can be used directly with
   * JavaScript's String.prototype.slice() even when multi-byte characters precede
   * the match position.
   */
  columnStart: number;
}

/**
 * All matching lines found in a single file.
 * Mirrors the Rust FileContentResult struct.
 */
export interface FileContentResult {
  /** Absolute path to the file. */
  path: string;
  /** Display title: front-matter title, H1 heading, or filename stem. */
  title: string;
  /** All lines that matched, in line-number order. */
  matches: LineMatch[];
}

/**
 * Top-level payload returned by the search_vault_content Tauri command.
 * Mirrors the Rust ContentSearchPayload struct.
 */
export interface ContentSearchPayload {
  /** Matched files, sorted by match count descending. */
  results: FileContentResult[];
  /** True when the result set was truncated at max_results. */
  capped: boolean;
  /** Count of files that could not be read. */
  skippedCount: number;
}

/**
 * Search file contents across all root paths in the vault.
 *
 * This is the typed bridge wrapper for the `search_vault_content` Tauri command.
 * The IIFE command-bar plugin calls the command directly via
 * `__TAURI_INTERNALS__.invoke` (IIFE constraint — AD-GS from 00_index.md).
 * This wrapper exists for testability and future non-IIFE consumers (FR-15, NFR-8).
 *
 * Invoke parameter names are snake_case because Tauri's generate_handler! macro
 * reads argument names from the Rust function signature, not from serde renames.
 * The serde rename_all = "camelCase" applies only to the returned payload, not
 * to the invocation parameters.
 *
 * @param params.rootPaths - Absolute paths of vault root directories to search.
 * @param params.excludePatterns - Glob patterns for directories/files to skip.
 * @param params.query - Substring to search for (case-insensitive).
 * @param params.maxResults - Maximum number of files to include in results.
 * @returns FileResult<ContentSearchPayload> — never throws.
 */
export async function searchVaultContent(params: {
  rootPaths: string[];
  excludePatterns: string[];
  query: string;
  maxResults: number;
}): Promise<FileResult<ContentSearchPayload>> {
  try {
    const payload = await invoke<ContentSearchPayload>("search_vault_content", {
      rootPaths: params.rootPaths,
      excludePatterns: params.excludePatterns,
      query: params.query,
      maxResults: params.maxResults,
    });
    return { ok: true, value: payload };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "search_vault_content",
      } satisfies TauriCommandError,
    };
  }
}

/**
 * One tag and all vault file paths that use it (front matter or inline #hashtag).
 * Mirrors the Rust `TagEntry` struct returned by `scan_vault_tags`.
 */
export interface TagEntry {
  tag: string;
  /** Absolute paths of every .md file that uses this tag. */
  filePaths: string[];
  count: number;
}

/**
 * Scan the vault for all tags (front matter + inline #hashtags).
 *
 * This is the typed bridge wrapper for the `scan_vault_tags` Tauri command.
 * The IIFE command-bar plugin calls the command directly via
 * `__TAURI_INTERNALS__.invoke` (IIFE constraint).
 *
 * @param params.rootPaths - Absolute paths of vault root directories to scan.
 * @param params.excludePatterns - Glob patterns for directories/files to skip.
 * @param params.vaultName - Vault name (used to locate and exclude the meta folder).
 * @returns FileResult<TagEntry[]> sorted by count desc — never throws.
 */
export async function scanVaultTags(params: {
  rootPaths: string[];
  excludePatterns: string[];
  vaultName: string;
}): Promise<FileResult<TagEntry[]>> {
  try {
    const entries = await invoke<TagEntry[]>("scan_vault_tags", {
      rootPaths: params.rootPaths,
      excludePatterns: params.excludePatterns,
      vaultName: params.vaultName,
    });
    return { ok: true, value: entries };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "scan_vault_tags",
      } satisfies TauriCommandError,
    };
  }
}

export async function renameFile(
  oldPath: string,
  newPath: string,
): Promise<FileResult<void>> {
  try {
    await invoke("rename_file", { oldPath, newPath });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "rename_file",
        path: oldPath,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Delete a single file (not a directory) from disk.
 *
 * Wraps the Rust `delete_file` command. The plugin calls this command
 * directly via __TAURI_INTERNALS__; this wrapper exists for non-plugin
 * callers and type documentation.
 *
 * @param path - Absolute path to the file to delete.
 * @returns FileResult<void> — ok:true on success, ok:false with error message on failure.
 */
export async function deleteFile(path: string): Promise<FileResult<void>> {
  try {
    await invoke("delete_file", { path });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "delete_file",
        path,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Move a file (not a directory) to a destination directory, preserving
 * the original filename.
 *
 * Wraps the Rust `move_file` command. For moving directories, use
 * renameFile(itemPath, destDir + "/" + dirName) instead.
 * The plugin calls this command directly via __TAURI_INTERNALS__;
 * this wrapper exists for non-plugin callers and type documentation.
 *
 * @param source         - Absolute path of the source file.
 * @param destinationDir - Absolute path of the destination directory.
 * @returns FileResult<string> where value is the new absolute file path on success.
 */
export async function moveFile(
  source: string,
  destinationDir: string,
): Promise<FileResult<string>> {
  try {
    const newPath = await invoke<string>("move_file", {
      source,
      destinationDir,
    });
    return { ok: true, value: newPath };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "move_file",
        path: source,
      } satisfies TauriCommandError,
    };
  }
}

// ── Image metadata commands ───────────────────────────────────────────────────

/**
 * Read image dimensions (width × height in pixels) from the file header.
 *
 * Supports JPEG, PNG, GIF, WebP, and HEIC/HEIF. Header-only read — no full decode.
 * The plugin calls get_image_dimensions directly via __TAURI_INTERNALS__; this wrapper
 * exists for non-plugin consumers and type documentation (FR-10).
 *
 * @param path - Absolute path to the image file.
 * @returns FileResult<{ width: number; height: number }> — never throws.
 */
export async function getImageDimensions(
  path: string,
): Promise<FileResult<{ width: number; height: number }>> {
  try {
    // Rust Result<(u32, u32), String> serialises the success value as a JSON array [w, h].
    const [width, height] = await invoke<[number, number]>("get_image_dimensions", { path });
    return { ok: true, value: { width, height } };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "get_image_dimensions",
        path,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Read Exif metadata from a JPEG image file.
 *
 * Returns DateTimeOriginal as YYYY-MM-DD and camera as "Make Model" string.
 * Both fields are null when the Exif tag is absent.
 * JPEG only for v1 (HEIC/HEIF Exif is out of scope).
 * The plugin calls get_exif_data directly via __TAURI_INTERNALS__; this wrapper
 * exists for non-plugin consumers and type documentation (FR-10).
 *
 * @param path - Absolute path to the JPEG file.
 * @returns FileResult<{ dateTaken: string | null; camera: string | null }> — never throws.
 */
export async function getExifData(
  path: string,
): Promise<FileResult<{ dateTaken: string | null; camera: string | null }>> {
  try {
    // Rust uses snake_case (no rename_all): date_taken, camera.
    const data = await invoke<{ date_taken: string | null; camera: string | null }>(
      "get_exif_data",
      { path },
    );
    return {
      ok: true,
      value: {
        dateTaken: data.date_taken,
        camera: data.camera,
      },
    };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "get_exif_data",
        path,
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Check whether a sidecar file (path + ".md") exists on disk.
 *
 * Returns true if the sidecar file exists as a regular file.
 * The plugin calls sidecar_exists directly via __TAURI_INTERNALS__; this wrapper
 * exists per convention (FR-10). Note: executeBulkYaml does NOT call this — it writes
 * directly via write_file, which creates the file if absent (NFR-7).
 *
 * @param path - Absolute path to the source file (e.g. "/vault/photo.jpg").
 *               The sidecar path checked is path + ".md".
 * @returns FileResult<boolean> — never throws.
 */
export async function sidecarExists(
  path: string,
): Promise<FileResult<boolean>> {
  try {
    const exists = await invoke<boolean>("sidecar_exists", { path });
    return { ok: true, value: exists };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "sidecar_exists",
        path,
      } satisfies TauriCommandError,
    };
  }
}
