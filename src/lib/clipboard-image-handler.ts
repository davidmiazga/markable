/**
 * Clipboard image paste — core logic function.
 *
 * This module exports `handleImagePaste`, a testable async function that
 * receives all its external dependencies as parameters rather than closing
 * over module-level globals. This design makes the business logic unit-testable
 * without spinning up a Tauri environment or a live CodeMirror editor.
 *
 * The paste listener in `src/main.ts` calls this function with the live
 * dependencies (real `vaultManager`, `writeBinaryFile`, etc.) after the
 * synchronous DOM-level guards (image MIME type, editor focus) have passed.
 *
 * Responsibilities:
 *  - Guard 3: activeTab null check (EC-03)
 *  - Guard 4: activeTab.kind === "editor" check (FR-11, EC-04, EC-05)
 *  - Read image bytes from Blob (EC-16: catch arrayBuffer rejection)
 *  - Branch on vault vs. no-vault (FR-03 vs. FR-04)
 *  - Vault path: ensureDirectory + writeBinaryFile + dispatch assets/ snippet
 *  - No-vault path: saveImageDialog + writeBinaryFile + computeImageSnippet + dispatch
 */

import { generateImageFilename, computeImageSnippet } from "./clipboard-image";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PasteTab {
  kind: string;
  filePath: string | null;
}

export type BinaryWriteResult =
  | { ok: true; value: void }
  | { ok: false; error: { message: string; command: string; path?: string } };

export type ImageDialogResult =
  | { cancelled: false; path: string }
  | { cancelled: true };

export interface HandleImagePasteDeps {
  imageBlob: Blob;
  activeTab: PasteTab | null;
  getActiveVault: () => { rootPaths: string[] } | null;
  ensureDirectory: (path: string) => Promise<void>;
  writeBinaryFile: (path: string, data: number[]) => Promise<BinaryWriteResult>;
  saveImageDialog: (filename: string) => Promise<ImageDialogResult>;
  dispatch: (transaction: unknown) => void;
  getSelectionHead: () => number;
  now: Date;
}

// ---------------------------------------------------------------------------
// Private path helpers
// ---------------------------------------------------------------------------

interface VaultPathArgs {
  vault: { rootPaths: string[] };
  filename: string;
  bytes: number[];
  ensureDirectory: HandleImagePasteDeps["ensureDirectory"];
  writeBinaryFile: HandleImagePasteDeps["writeBinaryFile"];
  dispatch: HandleImagePasteDeps["dispatch"];
  getSelectionHead: HandleImagePasteDeps["getSelectionHead"];
}

async function _handleVaultPath(a: VaultPathArgs): Promise<void> {
  const assetsDir = `${a.vault.rootPaths[0]}/assets`;
  const destPath  = `${assetsDir}/${a.filename}`;
  try {
    await a.ensureDirectory(assetsDir);
  } catch (err) {
    alert(`Could not create assets directory: ${String(err)}`);
    return;
  }
  const result = await a.writeBinaryFile(destPath, a.bytes);
  if (!result.ok) { alert(`Could not save image: ${result.error.message}`); return; }
  a.dispatch({
    changes: { from: a.getSelectionHead(), insert: `![](assets/${a.filename})` },
    userEvent: "input.paste.image",
    scrollIntoView: true,
  });
}

interface NoVaultPathArgs {
  filename: string;
  bytes: number[];
  activeTab: PasteTab;
  saveImageDialog: HandleImagePasteDeps["saveImageDialog"];
  writeBinaryFile: HandleImagePasteDeps["writeBinaryFile"];
  dispatch: HandleImagePasteDeps["dispatch"];
  getSelectionHead: HandleImagePasteDeps["getSelectionHead"];
}

async function _handleNoVaultPath(a: NoVaultPathArgs): Promise<void> {
  const dialogResult = await a.saveImageDialog(a.filename);
  if (dialogResult.cancelled) return;
  const result = await a.writeBinaryFile(dialogResult.path, a.bytes);
  if (!result.ok) { alert(`Could not save image: ${result.error.message}`); return; }
  const snippet = computeImageSnippet(dialogResult.path, a.activeTab.filePath);
  a.dispatch({
    changes: { from: a.getSelectionHead(), insert: snippet },
    userEvent: "input.paste.image",
    scrollIntoView: true,
  });
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

/**
 * Execute the clipboard image paste operation.
 *
 * Guards 1, 2, and 5 are checked by the document paste listener in main.ts
 * before this function is called. This function applies Guards 3 and 4
 * internally (activeTab null / kind check).
 *
 * @param deps - All external dependencies (see HandleImagePasteDeps).
 */
export async function handleImagePaste(deps: HandleImagePasteDeps): Promise<void> {
  const { imageBlob, activeTab, getActiveVault, ensureDirectory,
    writeBinaryFile, saveImageDialog, dispatch, getSelectionHead, now } = deps;

  if (!activeTab) return;                    // Guard 3 (EC-03)
  if (activeTab.kind !== "editor") return;   // Guard 4 (FR-11, EC-04, EC-05)

  let bytes: number[];
  try {
    bytes = Array.from(new Uint8Array(await imageBlob.arrayBuffer()));
  } catch {
    alert("Could not read clipboard image data.");
    return;
  }

  const filename = generateImageFilename(now);
  const vault = getActiveVault();
  const shared = { filename, bytes, dispatch, getSelectionHead };

  if (vault && vault.rootPaths.length > 0) {
    await _handleVaultPath({ ...shared, vault, ensureDirectory, writeBinaryFile });
  } else {
    await _handleNoVaultPath({ ...shared, activeTab, saveImageDialog, writeBinaryFile });
  }
}
