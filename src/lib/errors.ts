/**
 * Error types for Tauri command results.
 *
 * All file I/O operations use discriminated unions to represent
 * success or failure with type-safe error handling.
 */

/**
 * Error structure returned by Tauri commands.
 */
export interface TauriCommandError {
  /** Human-readable error message */
  message: string;
  /** Name of the command that failed */
  command: string;
  /** Optional path if applicable */
  path?: string;
}

/**
 * Discriminated union for file operation results.
 *
 * Usage:
 * ```
 * const result = await readFile(path);
 * if (result.ok) {
 *   console.log(result.value); // File contents as string
 * } else {
 *   console.error(result.error.message); // Error message
 * }
 * ```
 */
export type FileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TauriCommandError };

/**
 * Result for file dialog operations.
 *
 * Usage:
 * ```
 * const result = await openFileDialog();
 * if (result.cancelled) {
 *   // User cancelled the dialog
 * } else {
 *   console.log(result.path); // Selected file path
 * }
 * ```
 */
export type DialogResult =
  | { cancelled: false; path: string }
  | { cancelled: true };
