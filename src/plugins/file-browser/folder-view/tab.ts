/**
 * tab.ts — Central orchestrator for Folder View tabs.
 *
 * Opens _folder.md as a real editor tab and enters layout view via the tab
 * manager's enterLayoutView / refreshLayoutView API.  No custom tab machinery
 * or bespoke registry is required — the tab manager's existing path-based
 * deduplication and layout-view lifecycle handle everything.
 *
 * Exports:
 *   openFolderViewTab       — opens _folder.md in an editor tab + enters layout view
 *   buildFolderViewRenderFn — builds a render fn for enterLayoutView / refreshLayoutView
 *   escapeHtml              — HTML escape utility (XSS prevention)
 *   collectChildren         — collect immediate children from vault index
 *   LAYOUT_RENDERERS        — dispatch map from layout name to renderer fn
 *
 * @module folder-view/tab
 */

import { parseFolderMd } from "./parser";
import { buildFolderViewSet } from "./detection";
import { renderFallback } from "./fallback";
import { renderFolderCards } from "./renderer";
import { renderFolderTable } from "./table-renderer";
import type { FolderLayoutRenderer, FolderCard } from "./types";
import type { VaultIndex } from "../../../lib/vault-types";

// ── HTML escape utility (EC-13) ───────────────────────────────────────────────

/**
 * Escape special HTML characters in a string.
 *
 * Used when inserting user-controlled text (e.g. folder names) into the DOM
 * as HTML attributes or innerHTML. Prevents XSS from hostile directory names.
 *
 * @param str - The raw string to escape.
 * @returns The HTML-escaped version of the string.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Layout renderer dispatch map ──────────────────────────────────────────────

/**
 * Dispatch map from layout name (lowercased) to renderer function.
 *
 * v1 registers exactly one layout: "folder-cards".
 * Adding a new layout in a future task requires only adding one entry here (FR-28).
 *
 * The renderFolderCards function is imported from renderer.ts.
 */
export const LAYOUT_RENDERERS: Record<string, FolderLayoutRenderer> = {
  "folder-cards": renderFolderCards,
  "folder-table": renderFolderTable,
};

// ── Children collection (FR-19, AD-5, EC-22) ─────────────────────────────────

/**
 * Collect immediate children of a folder from the vault index.
 *
 * "Immediate" means direct children only — path must start with
 * `folderPath + "/"` and contain no additional "/" after that prefix (FR-19).
 *
 * Scans vaultIndex.entries (MD files), vaultIndex.directories, and
 * vaultIndex.nonMdFiles in a single O(N) pass per array (EC-22).
 *
 * _folder.md entries are excluded from the file section (FR-23).
 * Each directory card gets hasFolderView=true if the folder has _folder.md (EC-09).
 *
 * Length justification: iterates three distinct arrays (dirs, MD files, non-MD files),
 * each requiring its own shape adaptation. Splitting into sub-functions would require
 * passing `prefix`, `fvSet`, and `cards` through an extra parameter layer with no
 * clarity gain.
 *
 * @param folderPath  - Absolute path of the parent folder.
 * @param vaultIndex  - The current vault index, or null.
 * @returns Combined FolderCard[] for all immediate children (unsorted).
 */
export function collectChildren(
  folderPath: string,
  vaultIndex: VaultIndex | null,
): FolderCard[] {
  if (!vaultIndex) return [];

  // Build the folder-view set to tag subfolder cards with hasFolderView (EC-09).
  const fvSet = buildFolderViewSet(vaultIndex);
  const prefix = folderPath + "/";

  // ── Child-count map for FVB-09 (O(N) over full vault index) ─────────────
  // Counts immediate children per directory path across the whole index.
  const childCountMap = new Map<string, number>();
  const bumpCount = (childPath: string): void => {
    const parent = childPath.slice(0, childPath.lastIndexOf("/"));
    if (parent) childCountMap.set(parent, (childCountMap.get(parent) ?? 0) + 1);
  };
  for (const entry of vaultIndex.entries) bumpCount(entry.path);
  for (const nf of vaultIndex.nonMdFiles ?? []) bumpCount((nf as any).path ?? nf);
  for (const dir of vaultIndex.directories ?? []) {
    bumpCount(typeof dir === "string" ? dir : (dir as any).path ?? "");
  }

  const cards: FolderCard[] = [];

  // ── Directory children ────────────────────────────────────────────────────
  for (const dir of vaultIndex.directories ?? []) {
    const p = typeof dir === "string" ? dir : (dir as any).path ?? "";
    if (!p.startsWith(prefix)) continue;
    // Immediate child: no extra "/" after the prefix.
    if (p.slice(prefix.length).includes("/")) continue;
    const name = p.split("/").pop() ?? p;
    cards.push({
      path: p,
      name,
      kind: "directory",
      ext: "",
      modified: 0,
      hasFolderView: fvSet.has(p),
      childCount: childCountMap.get(p) ?? 0,
    });
  }

  // ── Markdown file children ────────────────────────────────────────────────
  for (const entry of vaultIndex.entries) {
    if (!entry.path.startsWith(prefix)) continue;
    if (entry.path.slice(prefix.length).includes("/")) continue;
    // FR-23: exclude _folder.md from the card grid.
    if (entry.name === "_folder" && entry.path.endsWith(".md")) continue;
    cards.push({
      path: entry.path,
      name: entry.name, // stem without ".md" for Markdown files
      kind: "file",
      ext: ".md",
      modified: entry.modified ?? 0,
      tags: (entry as any).tags ?? [],
    });
  }

  // ── Non-MD file children ──────────────────────────────────────────────────
  for (const nf of vaultIndex.nonMdFiles ?? []) {
    const p = (nf as any).path ?? nf;
    if (!p.startsWith(prefix)) continue;
    if (p.slice(prefix.length).includes("/")) continue;
    const basename = p.split("/").pop() ?? p;
    const dotIdx = basename.lastIndexOf(".");
    const ext = dotIdx > 0 ? basename.slice(dotIdx) : "";
    cards.push({
      path: p,
      name: basename,
      kind: "file",
      ext,
      modified: (nf as any).modified ?? 0,
    });
  }

  return cards;
}

// ── Async render (reads disk and dispatches to layout renderer) ───────────────

/**
 * Asynchronously read _folder.md, parse it, and render the Folder View content.
 *
 * Separated from the synchronous render fn so the synchronous slot passed to
 * enterLayoutView / refreshLayoutView can return immediately while the actual
 * disk read proceeds asynchronously.
 *
 * On success: dispatches to the appropriate layout renderer.
 * On read failure: shows a fallback notice.
 * On unknown/missing layout: shows the FR-12/FR-13 fallback.
 *
 * The syntheticKey / title-patch mechanism from the old implementation has been
 * removed.  The tab title is now the real filename "_folder.md" provided by the
 * tab manager's standard file-open path.
 *
 * Length justification: covers one indivisible async flow — read → parse →
 * dispatch.  Each step's result feeds directly into the next and shares
 * error-handling context.  Splitting would require threading 4+ values across
 * function boundaries with no clarity gain.
 *
 * @param folderPath    - Absolute path of the folder being rendered.
 * @param folderMdPath  - Absolute path of _folder.md inside the folder.
 * @param vaultIndex    - Live vault index fetched at render time.
 * @param container     - The DOM element to render into.
 */
async function renderFolderViewTabAsync(
  folderPath: string,
  folderMdPath: string,
  vaultIndex: VaultIndex | null,
  container: HTMLElement,
): Promise<void> {
  // Step 1: Read _folder.md from disk.
  let content = "";
  try {
    const result = await (window as any).__TAURI_INTERNALS__?.invoke?.(
      "read_file",
      { path: folderMdPath },
    );
    content = (typeof result === "string") ? result : (result?.content ?? "");
  } catch {
    renderFallback("", "Could not read _folder.md.", container);
    return;
  }

  // Step 2: Parse front-matter and body.
  const folderName = folderPath.split("/").pop() ?? folderPath;
  const config = parseFolderMd(content, folderName);

  // Update the tab title to the folder name (or custom title:) rather than "_folder".
  (window as any).__MARKABLE_TAB_MANAGER__?.setActiveTabTitle?.(config.title);

  // Step 3: Dispatch to layout renderer (FR-27/FR-28).
  const layoutKey = config.layout.toLowerCase();
  if (!layoutKey) {
    renderFallback(config.body, "No layout specified — showing raw content.", container);
  } else if (!LAYOUT_RENDERERS[layoutKey]) {
    renderFallback(
      config.body,
      `Unknown layout '${config.layout}' — showing raw content.`,
      container,
    );
  } else {
    const cards = collectChildren(folderPath, vaultIndex);
    LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath);
  }
}

// ── buildFolderViewRenderFn ────────────────────────────────────────────────────

/**
 * Build a synchronous render function for use with enterLayoutView /
 * refreshLayoutView.
 *
 * The returned function captures folderPath at call time.  Each call to
 * buildFolderViewRenderFn produces an independent closure that reads the
 * vault index fresh at render time (the index is fetched inside the closure,
 * not captured here).
 *
 * The pattern:
 *   1. Writes a loading placeholder into container immediately (synchronous).
 *   2. Fires renderFolderViewTabAsync as a fire-and-forget async call.
 *
 * This satisfies the enterLayoutView / refreshLayoutView contract: the render fn
 * must be synchronous and return void, but the actual render work is async.
 *
 * @param folderPath - Absolute path of the folder to render.
 * @returns A render function: (container: HTMLElement) => void
 */
export function buildFolderViewRenderFn(
  folderPath: string,
): (container: HTMLElement) => void {
  const folderMdPath = folderPath + "/_folder.md";
  return (container: HTMLElement): void => {
    // Fetch a fresh vault index at render time so newly added/deleted files
    // in the folder appear correctly (avoids using a stale captured index).
    const liveIndex =
      (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() ?? null;
    container.innerHTML = `<div class="folder-view-loading">Loading…</div>`;
    void renderFolderViewTabAsync(folderPath, folderMdPath, liveIndex, container);
  };
}

// ── openFolderViewTab ─────────────────────────────────────────────────────────

/**
 * Open _folder.md in a real editor tab and enter layout view (FR-07/FR-08).
 *
 * Uses the tab manager's openFileInTab + enterLayoutView API (RD-01).
 * enterLayoutView is called in the .then() callback to guarantee the tab is
 * active and kind="editor" before enterLayoutView inspects getActiveTab().
 * Calling enterLayoutView synchronously after openFileInTab would silently
 * no-op because the tab is not yet the active tab at that point (RD-01).
 *
 * Tab deduplication is the tab manager's responsibility: openFileInTab
 * re-activates an existing tab for the same filePath without creating a
 * duplicate.  This function intentionally does not suppress repeated calls.
 *
 * Safe when window.__MARKABLE_TAB_MANAGER__ is undefined (NFR-05):
 * the optional-chaining calls are silent no-ops in that case.
 *
 * @param folderPath - Absolute path of the folder whose view to open.
 */
export function openFolderViewTab(folderPath: string): void {
  const folderMdPath = folderPath + "/_folder.md";
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  void tabMgr?.openFileInTab?.(folderMdPath)?.then?.(() => {
    tabMgr?.enterLayoutView?.(buildFolderViewRenderFn(folderPath));
  });
}
