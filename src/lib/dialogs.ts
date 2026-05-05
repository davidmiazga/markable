/**
 * TypeScript bridge to Tauri file dialog commands.
 *
 * Wraps Tauri's native file dialogs with type-safe error handling.
 */

import { invoke } from "@tauri-apps/api/core";
import type { DialogResult } from "./errors";

/**
 * Open file dialog for selecting a file to open.
 *
 * @returns Promise resolving to DialogResult
 *   - { cancelled: false, path: string } — User selected a file
 *   - { cancelled: true } — User cancelled the dialog
 *
 * @example
 * ```typescript
 * const result = await openFileDialog();
 * if (!result.cancelled) {
 *   const fileContents = await readFile(result.path);
 * }
 * ```
 */
export async function openFileDialog(): Promise<DialogResult> {
  try {
    const path = await invoke<string | null>("open_file_dialog");

    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("openFileDialog error:", error);
    // Treat errors as cancellation for UI purposes
    return { cancelled: true };
  }
}

/**
 * Save file dialog for selecting a file path to save.
 *
 * @returns Promise resolving to DialogResult
 *   - { cancelled: false, path: string } — User selected save location
 *   - { cancelled: true } — User cancelled the dialog
 *
 * @example
 * ```typescript
 * const result = await saveFileDialog();
 * if (!result.cancelled) {
 *   const writeResult = await writeFile(result.path, content);
 * }
 * ```
 */
export async function saveFileDialog(suggestedFilename?: string): Promise<DialogResult> {
  try {
    const path = await invoke<string | null>("save_file_dialog", {
      suggestedFilename: suggestedFilename ?? null,
    });

    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("saveFileDialog error:", error);
    // Treat errors as cancellation for UI purposes
    return { cancelled: true };
  }
}

/**
 * Open folder dialog for selecting a directory (e.g. vault root).
 *
 * @param defaultPath - Optional starting directory shown in the dialog.
 * @returns Promise resolving to DialogResult
 *   - { cancelled: false, path: string } — User selected a folder
 *   - { cancelled: true } — User cancelled the dialog
 */
export async function openFolderDialog(defaultPath?: string): Promise<DialogResult> {
  try {
    const path = await invoke<string | null>("open_folder_dialog", {
      defaultPath: defaultPath ?? null,
    });
    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("openFolderDialog error:", error);
    return { cancelled: true };
  }
}

/**
 * Save file dialog for storing a clipboard-pasted image as PNG.
 *
 * Structurally identical to `saveHtmlDialog` — same `invoke` → discriminated-
 * union pattern — substituting `save_image_dialog` for `save_html_dialog`.
 *
 * The dialog is filtered to PNG files only (matching the Rust command's
 * `.add_filter("PNG Image", &["png"])` configuration). Errors are caught and
 * treated as cancellation so the caller never needs to handle a throw.
 *
 * @param suggestedFilename - Pre-populated filename (e.g. "20260505-143022.png")
 * @returns Promise resolving to DialogResult
 *   - { cancelled: false, path: string } — User confirmed a save location
 *   - { cancelled: true }               — User cancelled or dialog failed
 *
 * @example
 * ```typescript
 * const result = await saveImageDialog("20260505-143022.png");
 * if (!result.cancelled) {
 *   await writeBinaryFile(result.path, bytes);
 * }
 * ```
 */
export async function saveImageDialog(
  suggestedFilename: string
): Promise<DialogResult> {
  try {
    // Tauri v2 maps camelCase JS keys to snake_case Rust params automatically.
    const path = await invoke<string | null>("save_image_dialog", {
      suggestedFilename,
    });

    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("saveImageDialog error:", error);
    // Treat errors as cancellation so the paste handler can safely check
    // `result.cancelled` without separate error handling (mirrors saveHtmlDialog).
    return { cancelled: true };
  }
}

export async function saveHtmlDialog(suggestedFilename: string): Promise<DialogResult> {
  try {
    // Tauri v2 maps camelCase JS keys to snake_case Rust params automatically.
    const path = await invoke<string | null>("save_html_dialog", {
      suggestedFilename,
    });

    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("saveHtmlDialog error:", error);
    // Treat errors as cancellation for UI purposes
    return { cancelled: true };
  }
}
