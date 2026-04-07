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
export async function saveFileDialog(): Promise<DialogResult> {
  try {
    const path = await invoke<string | null>("save_file_dialog");

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
