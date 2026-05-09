/**
 * tab.ts — Central orchestrator for Folder View tabs.
 *
 * Exports:
 *   openFolderViewTab    — creates or re-activates a Folder View tab (FR-15/FR-17)
 *   notifyFolderViewTabs — called by _indexUpdatedCb on _folder.md save (FR-31/FR-32)
 *   checkStaleFolderViewTabs — called by onTabChanged to re-render stale tabs (FR-32)
 *   clearFolderViewRegistry  — cleanup on onDisable
 *
 * Design decisions:
 *   AD-1: Synthetic title prefix "__fv__:<path>" for tab deduplication.
 *   AD-2: Stale-flag stored in a { stale: boolean } ref captured by closure.
 *   EC-19 (known v1 limitation): Folder View tabs persist when the vault is
 *         switched. The tab content becomes stale relative to the new vault.
 *         This is acceptable in v1; users can close the tab manually.
 *
 * @module folder-view/tab
 */

import { parseFolderMd } from "./parser";
import { buildFolderViewSet } from "./detection";
import { renderFallback } from "./fallback";
import { renderFolderCards } from "./renderer";
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

// ── Registry types and state ──────────────────────────────────────────────────

/**
 * One entry in the Folder View tab registry.
 *
 * Each open Folder View tab has one entry. Entries are garbage-collected by
 * notifyFolderViewTabs when getTabs() no longer contains a tab with the
 * matching syntheticKey.
 */
interface FolderViewTabEntry {
  /** Synthetic title key: "__fv__:" + folderPath. Used for tab dedup (AD-1). */
  syntheticKey: string;
  /** Absolute path of the folder this tab represents. */
  folderPath: string;
  /**
   * Mutable stale flag.
   * Set to true when _folder.md is saved while the tab is inactive (FR-32).
   * Reset to false after a re-render (FR-32).
   */
  staleRef: { stale: boolean };
  /**
   * Re-render function.
   * Reads _folder.md from disk and repaints the tab content.
   * Called immediately (FR-31) or deferred via stale flag (FR-32).
   */
  rerender: () => void;
}

/**
 * Module-level registry of all open Folder View tabs.
 * Entries are added in openFolderViewTab and garbage-collected in notifyFolderViewTabs.
 */
export const _registry: FolderViewTabEntry[] = [];

// ── Placeholder renderer (replaced in step_05) ───────────────────────────────

/**
 * Dispatch map from layout name (lowercased) to renderer function.
 *
 * v1 registers exactly one layout: "folder-cards".
 * Adding a new layout in a future task requires only adding one entry here (FR-28).
 *
 * The renderFolderCards function is imported from renderer.ts (step_05).
 */
export const LAYOUT_RENDERERS: Record<string, FolderLayoutRenderer> = {
  "folder-cards": renderFolderCards,
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
 * Asynchronously read _folder.md, parse it, and render the Folder View tab.
 *
 * This is the actual rendering work separated from openFolderViewTab so the
 * synchronous renderFn passed to openCustomRenderTab can kick off the read
 * without blocking the tab-manager's synchronous render slot.
 *
 * On success: dispatches to the appropriate layout renderer.
 * On read failure: shows a fallback notice.
 * On unknown/missing layout: shows the FR-12/FR-13 fallback.
 *
 * After parsing, updates tab.title to the human-readable display title and
 * dispatches markable-tab-changed so the tab strip re-paints (AD-1).
 *
 * Length justification: covers one indivisible async flow — read → parse →
 * dispatch → patch tab title. Each step's result feeds directly into the next
 * and shares error-handling context. Splitting would require threading 4+ values
 * across function boundaries with no clarity gain.
 *
 * @param folderPath    - Absolute path of the folder being rendered.
 * @param folderMdPath  - Absolute path of _folder.md inside the folder.
 * @param vaultIndex    - Live vault index fetched at render time.
 * @param container     - The DOM element to render into.
 * @param syntheticKey  - The tab's synthetic title key (used to find the tab).
 */
async function renderFolderViewTabAsync(
  folderPath: string,
  folderMdPath: string,
  vaultIndex: VaultIndex | null,
  container: HTMLElement,
  syntheticKey: string,
): Promise<void> {
  // Step 1: Read _folder.md from disk (AD-9).
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

  // Step 4: Update tab.title to the human-readable display title (AD-1).
  // The tab was opened with the syntheticKey as its title. Now that we have
  // the parsed config.title, patch the tab's stored title so the tab strip
  // shows the folder name (or YAML title) rather than "__fv__:/path".
  // tab.title is rendered as textContent (tab-manager.ts:456), so raw string
  // is correct — no HTML escaping needed here (M-3: escapeHtml would produce
  // double-encoding like "&amp;" in the visible tab label).
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const allTabs = tabMgr?.getTabs?.() ?? [];
  const thisTab = allTabs.find(
    (t: any) => t.title === syntheticKey || t.title === config.title
  );
  if (thisTab && thisTab.title === syntheticKey) {
    thisTab.title = config.title;
    // Trigger a renderer update so the tab strip re-paints with the human title.
    window.dispatchEvent(new CustomEvent("markable-tab-changed"));
  }
}

// ── openFolderViewTab ─────────────────────────────────────────────────────────

/**
 * Open (or re-activate) the Folder View tab for the given folder path.
 *
 * Tab deduplication: uses the synthetic title prefix "__fv__:<path>" (AD-1).
 * The tab-manager's existing title-dedup ensures only one tab per path exists.
 *
 * Stale-flag lifecycle:
 *   - Each call creates a fresh staleRef = { stale: false }.
 *   - Re-opening the same path replaces the existing registry entry.
 *   - notifyFolderViewTabs sets staleRef.stale = true when _folder.md is saved
 *     while the tab is inactive (FR-32).
 *   - checkStaleFolderViewTabs re-renders stale tabs when they are activated.
 *
 * @param folderPath - Absolute path of the folder whose view to open.
 */
export function openFolderViewTab(folderPath: string): void {
  const syntheticKey = "__fv__:" + folderPath;
  const folderMdPath = folderPath + "/_folder.md";
  const staleRef = { stale: false };

  /**
   * Re-render function: re-reads _folder.md and repaints the tab.
   *
   * Fetches a fresh vault index each time so newly added/deleted files in the
   * folder appear correctly after re-render (H-1 fix: do not use the index
   * captured at tab-open time — it may be stale relative to a new vault index
   * build triggered by the same _folder.md save that initiated re-render).
   *
   * Only executes when the tab is currently active (guards against re-rendering
   * an inactive tab). Called by notifyFolderViewTabs (FR-31) and
   * checkStaleFolderViewTabs (FR-32).
   */
  const rerender = (): void => {
    const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
    const activeTab = tabMgr?.getActiveTab?.();
    if (activeTab?.title !== syntheticKey) return;
    const hostEl = document.getElementById("custom-tab-host");
    if (!hostEl) return;
    const liveIndex =
      (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() ?? null;
    hostEl.innerHTML = `<div class="folder-view-loading">Loading…</div>`;
    void renderFolderViewTabAsync(folderPath, folderMdPath, liveIndex, hostEl, syntheticKey);
  };

  /**
   * Synchronous renderFn passed to openCustomRenderTab.
   *
   * Fetches a fresh vault index so the initial render also uses current state.
   * Immediately shows a loading placeholder, then kicks off the async read.
   * The container is the #custom-tab-host element injected by tab-manager.
   */
  const renderFn = (container: HTMLElement): void => {
    staleRef.stale = false;
    const liveIndex =
      (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() ?? null;
    container.innerHTML = `<div class="folder-view-loading">Loading…</div>`;
    void renderFolderViewTabAsync(folderPath, folderMdPath, liveIndex, container, syntheticKey);
  };

  // Open the tab (or re-activate the existing one via title deduplication).
  (window as any).__MARKABLE_OPEN_CUSTOM_TAB__?.(syntheticKey, renderFn);

  // Register (or replace) the entry in the registry.
  const existingIdx = _registry.findIndex(r => r.syntheticKey === syntheticKey);
  if (existingIdx !== -1) _registry.splice(existingIdx, 1);
  _registry.push({ syntheticKey, folderPath, staleRef, rerender });
}

// ── notifyFolderViewTabs (FR-31/FR-32) ────────────────────────────────────────

/**
 * Notify Folder View tabs that _folder.md may have been saved.
 *
 * Called from _indexUpdatedCb in file-browser.plugin.ts with the changed file
 * path. If the saved file is _folder.md inside a directory that has an open
 * Folder View tab, either re-renders immediately (FR-31) or marks the tab
 * stale (FR-32).
 *
 * Also garbage-collects closed tabs from the registry.
 *
 * FR-33: Only folder-view registry entries are affected — document layout tabs
 * (kind=editor) are never in this registry.
 *
 * @param savedFilePath - Absolute path of the file that was saved/changed.
 */
export function notifyFolderViewTabs(savedFilePath: string): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const allTabs: any[] = tabMgr?.getTabs?.() ?? [];
  const allTitles = new Set(allTabs.map((t: any) => t.title));

  // Garbage-collect: remove registry entries for tabs that no longer exist.
  for (let i = _registry.length - 1; i >= 0; i--) {
    if (!allTitles.has(_registry[i].syntheticKey)) {
      _registry.splice(i, 1);
    }
  }

  // Only act if the changed file is _folder.md (check for the exact filename).
  if (!savedFilePath.endsWith("/_folder.md") && !savedFilePath.endsWith("\\_folder.md")) {
    return;
  }

  // Compute the folder path from the saved file path.
  const lastSlash = Math.max(
    savedFilePath.lastIndexOf("/"),
    savedFilePath.lastIndexOf("\\"),
  );
  if (lastSlash <= 0) return;
  const changedFolderPath = savedFilePath.slice(0, lastSlash);

  const activeTab = tabMgr?.getActiveTab?.();

  for (const entry of _registry) {
    if (entry.folderPath !== changedFolderPath) continue;

    if (activeTab?.title === entry.syntheticKey) {
      // FR-31: tab is active — re-render immediately.
      entry.rerender();
    } else {
      // FR-32: tab is inactive — mark stale for re-render on next activation.
      entry.staleRef.stale = true;
    }
  }
}

// ── checkStaleFolderViewTabs (FR-32) ──────────────────────────────────────────

/**
 * Re-render any Folder View tab that was marked stale and is now active.
 *
 * Called from onTabChanged in file-browser.plugin.ts. Finds registry entries
 * whose syntheticKey matches the currently active tab and whose staleRef.stale
 * is true. Re-renders them and resets the stale flag.
 */
export function checkStaleFolderViewTabs(): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const activeTab = tabMgr?.getActiveTab?.();
  if (!activeTab) return;

  for (const entry of _registry) {
    if (entry.syntheticKey === activeTab.title && entry.staleRef.stale) {
      entry.staleRef.stale = false;
      entry.rerender();
    }
  }
}

// ── clearFolderViewRegistry (onDisable cleanup) ───────────────────────────────

/**
 * Clear the Folder View tab registry.
 *
 * Called from onDisable in file-browser.plugin.ts to ensure no stale
 * registry entries survive a plugin disable/re-enable cycle.
 */
export function clearFolderViewRegistry(): void {
  _registry.length = 0;
}
