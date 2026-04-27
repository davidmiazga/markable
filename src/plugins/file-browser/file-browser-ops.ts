/**
 * file-browser-ops.ts
 *
 * File operation helpers used by the File Browser plugin (Step 02b).
 *
 * All functions in this module call Tauri commands via the established
 * `window.__TAURI_INTERNALS__.invoke` pattern so they work inside the IIFE
 * bundle context at runtime (no ESM imports of @tauri-apps/api/core).
 *
 * Every write operation delegates to Rust commands that use the temp-file-swap
 * pattern, so the filesystem state is always either the old or the new version —
 * never partially written (EC-43 compliance).
 *
 * Error handling philosophy:
 * - User-visible errors (file exists, illegal chars, etc.) are surfaced as
 *   inline DOM messages within the tree container.
 * - Unexpected Rust-level errors are thrown so the caller can decide how to
 *   present them (toast, console, etc.).
 *
 * @module file-browser-ops
 */

// Type-only imports — erased by tsc; safe in the IIFE bundle.
import type { VaultIndex } from "../../lib/vault-types";

// ── Tauri invocation helper ───────────────────────────────────────────────────

/**
 * Invoke a Tauri command via the runtime window global.
 *
 * The IIFE constraint prevents direct imports from `@tauri-apps/api/core`,
 * so we access the same underlying mechanism through `__TAURI_INTERNALS__`.
 * This is the established Markable pattern for all IIFE plugin I/O.
 *
 * @param cmd    - Rust command name (snake_case, matches the Tauri command ID).
 * @param args   - Parameter object passed verbatim to the command.
 * @returns      The deserialized return value from Rust.
 * @throws       A string error message from Rust when the command returns Err.
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (window as any).__TAURI_INTERNALS__;
  if (!tauri?.invoke) {
    throw new Error("[file-browser-ops] __TAURI_INTERNALS__.invoke not available");
  }
  return tauri.invoke(cmd, args) as Promise<T>;
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Illegal filename characters on macOS (the OS also rejects `/`, which
 * would break path construction).
 *
 * We reject `:` and `/` because macOS HFS+/APFS forbids them, and additionally
 * reject names that are only dots (`.`, `..`) to prevent directory traversal.
 */
const ILLEGAL_FILENAME_CHARS = /[:/]/;

/**
 * Validate a proposed filename.
 *
 * Returns `null` when the name is valid, or a human-readable error string that
 * can be displayed in the inline `.tree-node-inline-error` span.
 *
 * @param name - The raw filename string entered by the user.
 * @returns null when valid, or an error message string.
 */
export function validateFilename(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Name must not be empty.";
  }
  if (/^\.+$/.test(trimmed)) {
    return "Name cannot consist entirely of dots.";
  }
  if (ILLEGAL_FILENAME_CHARS.test(trimmed)) {
    return "Name contains an illegal character (: or /).";
  }
  return null;
}

/**
 * Check whether a filename (without extension) already exists in the active
 * vault index within the given parent directory.
 *
 * Used by the inline rename/create input for real-time validation (EC-15, EC-17).
 *
 * @param dirPath  - Absolute path of the parent directory to check.
 * @param filename - The full filename to look for (with extension).
 * @returns true when the file is already known to the vault index.
 */
export function filenameExistsInDir(dirPath: string, filename: string): boolean {
  const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() as VaultIndex | null;
  if (!vaultIndex) return false;

  const normalDir = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  const target = normalDir + filename;

  return vaultIndex.entries.some((e) => e.path === target);
}

// ── Link update banner ────────────────────────────────────────────────────────

/**
 * Show an "N notes link to '{name}'. Update links?" notification strip at the
 * top of the file tree container.
 *
 * The banner has two action buttons:
 *   "Update" — calls `update_wiki_links` on all `linkingPaths` and shows a
 *               summary of how many files were updated / failed.
 *   "Dismiss" — removes the banner without making any changes.
 *
 * @param container    - The `.file-browser-panel` wrapper element.
 * @param oldStem      - The old filename stem (the link target being replaced).
 * @param newStem      - The new filename stem (the replacement).
 * @param linkingPaths - Absolute paths of files that contain links to oldStem.
 */
export function showLinkUpdateBanner(
  container: HTMLElement,
  oldStem: string,
  newStem: string,
  linkingPaths: string[],
): void {
  // Remove any existing banner before showing a new one.
  container.querySelector(".file-browser-link-banner")?.remove();

  const banner = buildLinkBanner(oldStem, newStem, linkingPaths);
  // Insert at the top of the container, before the tree / search header.
  container.insertBefore(banner, container.firstChild);
}

/**
 * Build the DOM element for the link-update banner.
 *
 * Extracted from showLinkUpdateBanner to keep each function ≤30 lines.
 *
 * @param oldStem      - Old filename stem.
 * @param newStem      - New filename stem.
 * @param linkingPaths - Files containing the old link.
 * @returns The configured banner element.
 */
function buildLinkBanner(
  oldStem: string,
  newStem: string,
  linkingPaths: string[],
): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "file-browser-link-banner";

  const msg = document.createElement("span");
  // Grammar: "1 note links to …" (singular verb) vs "2 notes link to …" (plural).
  // The "s" moves from the noun suffix to the verb suffix for singular count.
  const count = linkingPaths.length;
  msg.textContent = count === 1
    ? `1 note links to "${oldStem}". Update links?`
    : `${count} notes link to "${oldStem}". Update links?`;
  banner.appendChild(msg);

  const updateBtn = document.createElement("button");
  // type="button" prevents accidental form submission if the banner is ever
  // placed inside a <form> element in the future (defensive coding).
  updateBtn.type = "button";
  updateBtn.className = "file-browser-link-banner-btn";
  updateBtn.textContent = "Update";
  updateBtn.addEventListener("click", () => {
    void handleLinkUpdateClick(banner, msg, linkingPaths, oldStem, newStem);
  });

  const dismissBtn = document.createElement("button");
  // type="button" — same defensive rationale as updateBtn above.
  dismissBtn.type = "button";
  dismissBtn.className = "file-browser-link-banner-btn file-browser-link-banner-dismiss";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => banner.remove());

  banner.appendChild(updateBtn);
  banner.appendChild(dismissBtn);

  return banner;
}

/**
 * Handle the "Update" button click in the link-update banner.
 *
 * Invokes `update_wiki_links` Rust command and updates the banner message
 * to reflect the per-file outcome (N updated, M failed).
 *
 * @param banner       - The banner element to update with results.
 * @param msg          - The message <span> to update with summary text.
 * @param linkingPaths - Files to process.
 * @param oldStem      - Old link stem.
 * @param newStem      - New link stem.
 */
async function handleLinkUpdateClick(
  banner: HTMLElement,
  msg: HTMLElement,
  linkingPaths: string[],
  oldStem: string,
  newStem: string,
): Promise<void> {
  msg.textContent = "Updating links…";

  try {
    const result = await invoke<{ updated: string[]; failed: string[] }>(
      "update_wiki_links",
      { filesToUpdate: linkingPaths, oldLink: oldStem, newLink: newStem },
    );

    const updatedCount = result.updated.length;
    const failedCount = result.failed.length;

    if (failedCount === 0) {
      // Full success: reload the vault index so link metadata is current
      // (FR-02.11.4), then show summary and auto-dismiss after 3 s (EC-11).
      await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
      msg.textContent = `Updated ${updatedCount} note${updatedCount === 1 ? "" : "s"}.`;
      setTimeout(() => banner.remove(), 3000);
    } else {
      // Partial failure: reload the vault index for the files that did succeed
      // (FR-02.11.4), then show both counts and leave banner open for user
      // action (EC-08). No auto-dismiss — the user must manually dismiss.
      await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
      msg.textContent = `Updated ${updatedCount}, failed ${failedCount}.`;
    }
  } catch (err) {
    msg.textContent = `Link update failed: ${String(err)}`;
  }
}

// ── File operations ───────────────────────────────────────────────────────────

/**
 * Create a new `.md` file at `dirPath/filename.md` with empty content.
 *
 * Validates the filename first (no illegal chars, no `.md` collision — EC-15,
 * EC-16). On success: reloads the vault index and opens the new file in a tab.
 *
 * @param dirPath   - Absolute path of the parent directory.
 * @param filename  - Stem (no extension) or full name typed by the user.
 * @param container - The file-browser panel container (for error display).
 */
export async function createNote(
  dirPath: string,
  filename: string,
  container: HTMLElement,
): Promise<void> {
  const trimmed = filename.trim();
  const stem = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
  const fullFilename = stem + ".md";

  const validationError = validateFilename(stem);
  if (validationError) {
    showInlineError(container, validationError);
    return;
  }

  if (filenameExistsInDir(dirPath, fullFilename)) {
    showInlineError(container, `"${stem}" already exists in this folder.`);
    return;
  }

  const fullPath = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + fullFilename;

  await invoke("create_file", { path: fullPath, content: "" });

  // Reload the vault index so the new file appears in the tree.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // Open the new file in a tab so the user can start editing immediately.
  (window as any).__MARKABLE_TAB_MANAGER__?.openFile?.(fullPath);
}

/**
 * Rename a file or directory from `oldPath` to the same parent with `newName`.
 *
 * On success:
 *  - Reloads the vault index.
 *  - Updates the tab title for any open tab at `oldPath`.
 *  - Checks the vault index for backlinks and shows the link-update banner if
 *    any files reference the old stem (EC-18).
 *
 * On name collision (EC-17): shows an inline error.
 *
 * @param oldPath   - Current absolute path.
 * @param newName   - New filename stem (no .md extension required, but tolerated).
 * @param container - The file-browser panel container.
 */
export async function renameNode(
  oldPath: string,
  newName: string,
  container: HTMLElement,
): Promise<void> {
  const oldStem = getFileStem(oldPath);
  const trimmed = newName.trim();
  const stem = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed;

  const validationError = validateFilename(stem);
  if (validationError) {
    showInlineError(container, validationError);
    return;
  }

  const parentDir = getParentDir(oldPath);
  const isFile = oldPath.endsWith(".md");
  const newFileName = isFile ? stem + ".md" : stem;
  const newPath = (parentDir.endsWith("/") ? parentDir : parentDir + "/") + newFileName;

  if (filenameExistsInDir(parentDir, newFileName)) {
    showInlineError(container, `"${stem}" already exists in this folder.`);
    return;
  }

  await invoke("rename_file", { oldPath, newPath });

  // Reload the vault index to reflect the rename in the tree.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // Notify the tab manager so the tab title updates.
  (window as any).__MARKABLE_TAB_MANAGER__?.renameFile?.(oldPath, newPath);

  // Only check backlinks when the stem actually changed (AD-01).
  // When oldStem === stem the user committed the input without changing the
  // filename; showing the banner would offer a no-op rewrite (EC-04 guard).
  if (isFile && oldStem !== stem) {
    checkAndShowLinkBanner(container, oldStem, stem);
  }
}

/**
 * Check the vault index for files containing `[[oldStem]]` and show the
 * link-update banner when any are found.
 *
 * Accepts a nullable container so callers can pass `_panelContainer` directly
 * without a null-check at every call site (EC-18). When `container` is null the
 * function returns immediately without touching the DOM.
 *
 * Extracted from renameNode to keep that function ≤30 lines.
 *
 * @param container - The panel container to host the banner, or null when the
 *                    panel is not mounted (banner is silently suppressed).
 * @param oldStem   - The old link target stem.
 * @param newStem   - The replacement stem.
 */
export function checkAndShowLinkBanner(
  container: HTMLElement | null,
  oldStem: string,
  newStem: string,
): void {
  // Guard: panel may not be mounted yet (e.g. during startup or after teardown).
  if (!container) return;

  const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() as VaultIndex | null;
  if (!vaultIndex) return;

  const linkingPaths = vaultIndex.entries
    .filter((e) => e.outboundLinks?.includes(oldStem))
    .map((e) => e.path);

  if (linkingPaths.length > 0) {
    showLinkUpdateBanner(container, oldStem, newStem, linkingPaths);
  }
}

/**
 * Delete a file after confirming with a native dialog.
 *
 * Uses `window.confirm()` for the confirmation (consistent with the existing
 * Manage Vaults delete flow). On confirmation: deletes the file, closes any
 * open tab for it, and reloads the vault index.
 *
 * @param path - Absolute path of the file to delete.
 */
export async function deleteFile(path: string): Promise<void> {
  const stem = getFileStem(path);
  const confirmed = window.confirm(`Delete "${stem}.md"? This cannot be undone.`);
  if (!confirmed) return;

  await invoke("delete_file", { path });

  // Close the tab if the file is currently open.
  (window as any).__MARKABLE_TAB_MANAGER__?.closeFile?.(path);

  // Reload the vault index.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}

/**
 * Delete a directory after confirming with a native dialog.
 *
 * Closes all open tabs for files within the folder. When any such tab has
 * unsaved changes, prompts the user before closing (EC-20 via the tab manager's
 * `closeFile` which handles the unsaved-changes flow internally).
 *
 * @param path - Absolute path of the directory to delete.
 */
export async function deleteDirectory(path: string): Promise<void> {
  const dirName = getBasename(path);
  const confirmed = window.confirm(
    `Delete folder "${dirName}" and all its contents? This cannot be undone.`,
  );
  if (!confirmed) return;

  // Close tabs for files inside this directory.
  await closeTabsUnder(path);

  await invoke("delete_directory", { path });

  // Reload the vault index.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}

/**
 * Close all open tabs whose file path starts with `dirPath`.
 *
 * Delegating to the tab manager preserves its unsaved-changes prompt logic
 * (EC-20). We call `closeFile` per file because the tab manager handles each
 * file's dirty state individually.
 *
 * @param dirPath - Absolute directory path; close any tab under this prefix.
 */
async function closeTabsUnder(dirPath: string): Promise<void> {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tm?.closeFile) return;

  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() as VaultIndex | null;
  if (!vaultIndex) return;

  for (const entry of vaultIndex.entries) {
    if (entry.path.startsWith(prefix)) {
      // closeFile handles the unsaved-changes prompt internally.
      await tm.closeFile(entry.path);
    }
  }
}

/**
 * Move a file to a new parent directory.
 *
 * Errors if the destination already contains a file with the same name (EC-19).
 * On success: reloads the vault index, updates any open tab for the moved file,
 * and conditionally shows the link-update banner.
 *
 * The banner is suppressed when `oldStem === newStem` (AD-01). A pure directory
 * move never changes the stem, so the guard is currently always false. It exists
 * to document intent and protect against future code paths that might differ.
 *
 * @param sourcePath     - Absolute path of the file to move.
 * @param destinationDir - Absolute path of the target directory.
 * @param container      - The file-browser panel container for the banner, or
 *                         null when the panel is not mounted (banner suppressed).
 */
export async function moveNode(
  sourcePath: string,
  destinationDir: string,
  container: HTMLElement | null,
): Promise<void> {
  // Capture the source stem before the move (stem is preserved during a move,
  // but computing both allows the guard below to document intent clearly).
  const oldStem = getFileStem(sourcePath);

  const newPath = await invoke<string>("move_file", {
    source: sourcePath,
    destinationDir,
  });

  // Reload the vault index so the tree reflects the new location.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // Notify the tab manager so the tab header updates.
  (window as any).__MARKABLE_TAB_MANAGER__?.renameFile?.(sourcePath, newPath);

  // Only show the banner when the stem actually changed (AD-01).
  // For a standard move this guard is always false; it guards future edge cases.
  const newStem = getFileStem(newPath);
  if (oldStem !== newStem) {
    checkAndShowLinkBanner(container, oldStem, newStem);
  }
}

// ── Private path helpers ──────────────────────────────────────────────────────

/**
 * Return the filename stem (no extension) from an absolute path.
 *
 * "/notes/work/report.md" → "report"
 *
 * @param absPath - Absolute filesystem path.
 * @returns The stem string.
 */
export function getFileStem(absPath: string): string {
  const base = getBasename(absPath);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * Return the filename (last segment) from an absolute path.
 *
 * "/notes/work/report.md" → "report.md"
 *
 * @param absPath - Absolute filesystem path.
 * @returns The last path segment.
 */
export function getBasename(absPath: string): string {
  const parts = absPath.split("/");
  return parts[parts.length - 1] || absPath;
}

/**
 * Return the parent directory of an absolute path.
 *
 * "/notes/work/report.md" → "/notes/work"
 *
 * @param absPath - Absolute filesystem path.
 * @returns The parent directory path.
 */
export function getParentDir(absPath: string): string {
  const idx = absPath.lastIndexOf("/");
  return idx > 0 ? absPath.slice(0, idx) : "/";
}

/**
 * Display a transient inline error message inside the panel container.
 *
 * The error is shown as a `.file-browser-inline-error` element and auto-
 * removes itself after 3 seconds so the user can see it without it lingering.
 *
 * @param container - The panel container element.
 * @param message   - The error text to display.
 */
export function showInlineError(container: HTMLElement, message: string): void {
  container.querySelector(".file-browser-inline-error")?.remove();

  const err = document.createElement("div");
  err.className = "file-browser-inline-error";
  err.textContent = message;
  container.insertBefore(err, container.firstChild);

  setTimeout(() => err.remove(), 3000);
}
