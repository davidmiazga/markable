/**
 * Pure helper functions for clipboard image paste.
 *
 * Extracted into a standalone module so unit tests can import these
 * functions without pulling in the full app initialisation from main.ts.
 * No Tauri, no CodeMirror — purely synchronous operations.
 */

/**
 * Generate the image filename for a clipboard paste.
 *
 * The filename encodes the local wall-clock time at the moment of paste so
 * that successive pastes produce unique names without a random suffix.
 * The `now` parameter is injected rather than calling `new Date()` internally
 * so that unit tests can supply a fixed date and get deterministic output.
 *
 * Format: YYYYMMDD-HHmmss.png
 *   - YYYY  4-digit year
 *   - MM    2-digit month (01–12), zero-padded
 *   - DD    2-digit day (01–31), zero-padded
 *   - HH    2-digit 24-hour hour (00–23), zero-padded
 *   - mm    2-digit minute (00–59), zero-padded
 *   - ss    2-digit second (00–59), zero-padded
 *
 * The extension is always `.png` regardless of the source MIME type (NFR-04).
 *
 * @param now - The current local wall-clock time (injected for testability).
 * @returns A filename of the form "YYYYMMDD-HHmmss.png".
 *
 * @example
 *   generateImageFilename(new Date(2026, 4, 5, 14, 30, 22))
 *   // → "20260505-143022.png"
 */
export function generateImageFilename(now: Date): string {
  // Helper: left-pad a number to 2 digits with a leading zero if needed.
  const pad = (n: number): string => String(n).padStart(2, "0");

  const year  = now.getFullYear();
  const month = pad(now.getMonth() + 1); // getMonth() returns 0-based index
  const day   = pad(now.getDate());
  const hour  = pad(now.getHours());
  const min   = pad(now.getMinutes());
  const sec   = pad(now.getSeconds());

  return `${year}${month}${day}-${hour}${min}${sec}.png`;
}

/**
 * Compute the Markdown image snippet to insert into the editor.
 *
 * The snippet form depends on the relationship between the saved image path
 * and the path of the currently open file (FR-04, EC-11, EC-12, EC-13):
 *
 * - If `activeFilePath` is non-null AND the image is in the **same directory**
 *   as the active file → return `![](filename.png)` using the basename only.
 *   This produces a relative reference that keeps the document portable.
 *
 * - Otherwise (untitled tab where `activeFilePath` is null, or the image was
 *   saved to a different directory) → return `![]({imagePath})` with the full
 *   absolute path so the image is always findable.
 *
 * Directory comparison uses simple string operations rather than the Node.js
 * `path` module because this code runs in the browser WebView context where
 * Node APIs are unavailable. Paths are expected to use forward slashes (macOS).
 *
 * @param imagePath      Absolute path of the saved image file.
 * @param activeFilePath Absolute path of the current editor tab's file,
 *                       or null if the tab is Untitled.
 * @returns The Markdown image snippet string.
 *
 * @example
 *   // Same directory → relative
 *   computeImageSnippet("/notes/photo.png", "/notes/myfile.md")
 *   // → "![](photo.png)"
 *
 * @example
 *   // Different directory → absolute
 *   computeImageSnippet("/images/photo.png", "/notes/myfile.md")
 *   // → "![]( /images/photo.png)"  (no leading space — shown here for readability)
 */
export function computeImageSnippet(
  imagePath: string,
  activeFilePath: string | null
): string {
  if (activeFilePath !== null) {
    // Extract directory portion: everything before the last forward slash.
    // e.g. "/a/b/photo.png" → "/a/b"
    const imageDir  = imagePath.substring(0, imagePath.lastIndexOf("/"));
    const activeDir = activeFilePath.substring(0, activeFilePath.lastIndexOf("/"));

    if (imageDir === activeDir) {
      // Same directory — use basename only for a clean relative reference.
      const filename = imagePath.substring(imagePath.lastIndexOf("/") + 1);
      return `![](${filename})`;
    }
  }

  // No active file path, or directories differ — use the full absolute path.
  return `![](${imagePath})`;
}

/**
 * Scan a DataTransferItemList for the first item whose MIME type starts with
 * "image/". Returns that item, or null when none is found or the list is absent.
 *
 * Extracted here so the Guard 1 logic (EC-01: text-only clipboard must not be
 * intercepted) can be unit-tested without a full DOM environment. The paste
 * listener in main.ts delegates to this function.
 *
 * @param items  The DataTransferItemList from ClipboardEvent.clipboardData, or
 *               null/undefined when the clipboard data is not accessible.
 * @returns The first image DataTransferItem, or null.
 */
export function extractImageItem(
  items: DataTransferItemList | null | undefined,
): DataTransferItem | null {
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) return items[i];
  }
  return null;
}
