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

import { applyExcludeFilter } from "./shared";
import { parseFolderMd } from "./parser";
import { buildFolderViewSet } from "./detection";
import { renderFallback } from "./fallback";
import { renderFolderCards } from "./renderer";
import { renderFolderTable } from "./table-renderer";
import { renderFolderList } from "./list-renderer";
import { renderFolderTimeline } from "./timeline-renderer";
import { renderFolderKanban } from "./kanban-renderer";
import { extractFrontmatterKeys } from "./frontmatter-reader";
import { createSelectionState } from "./bulk-selection";
import { buildToolbar, updateToolbar, showResult } from "./bulk-toolbar";
import { executeBulkMove, executeBulkDelete, executeBulkYaml, formatOperationResult }
  from "./bulk-operations";
import type { FolderLayoutRenderer, FolderCard, BulkContext } from "./types";
import type { VaultIndex } from "../../../lib/vault-types";

// ── Image extension constants (FR-9, step_04) ────────────────────────────────

/**
 * Set of image file extensions that may have sidecar .md companions.
 *
 * Used both for:
 *   (a) Sidecar exclusion in collectChildren (FR-9): a .md file whose stem ends
 *       in one of these extensions is treated as a sidecar, not a document.
 *   (b) Image type dispatch in the enrichment loop (step_05): determines whether
 *       to call get_image_dimensions / get_exif_data for a non-.md card.
 *
 * Lowercase, without leading dot. Each entry is a recognised image format
 * supported by get_image_dimensions or commonly stored in vaults.
 */
export const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif",
]);

/**
 * Return true if a vault .md entry stem looks like a sidecar for an image file.
 *
 * A sidecar stem is the filename without ".md" (i.e. entry.name in the vault index).
 * The stem is a sidecar when it contains a dot and its last dot-segment is a
 * known image extension.
 *
 * Examples:
 *   "photo.jpg"      → true  (stem has ".jpg" suffix)
 *   "banner.png"     → true
 *   "my.project.jpg" → true  (EC-20: last segment is "jpg")
 *   "_folder"        → false (no dot in stem)
 *   "readme"         → false (no dot)
 *   "notes.txt"      → false ("txt" not an image extension)
 *
 * This function is NOT exported — it is a private helper used only within tab.ts.
 *
 * @param stem - The entry.name field (filename without ".md").
 */
function isSidecarStem(stem: string): boolean {
  const lastDot = stem.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = stem.slice(lastDot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

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
  "folder-cards":    renderFolderCards,
  "folder-table":    renderFolderTable,
  "folder-list":     renderFolderList,
  "folder-timeline": renderFolderTimeline,
  "folder-kanban":   renderFolderKanban,
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
    // FR-9: exclude sidecar .md files (e.g. photo.jpg.md) from the card grid.
    // entry.name is the stem (filename without ".md"). A sidecar stem ends in an
    // image extension (e.g. "photo.jpg"). See isSidecarStem() for the algorithm.
    if (isSidecarStem(entry.name)) continue;
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

// ── Image enrichment helpers ──────────────────────────────────────────────────

/**
 * The four built-in image column identifiers.
 *
 * Must stay in sync with BUILTIN_FIELDS in parser.ts (they are both sets of the
 * same four strings). Used to detect when image enrichment is needed and to
 * dispatch dimension / EXIF reads vs sidecar reads in the enrichment loop.
 *
 * Defined here (not imported from parser.ts) because tab.ts is an IIFE bundle
 * that cannot import from plugin-external modules at runtime.
 */
const IMAGE_BUILTIN_KEYS = new Set(["width", "height", "date-taken", "camera"]);

/**
 * Extensions eligible for EXIF data extraction via get_exif_data.
 *
 * JPEG is fully supported in v1. HEIC/HEIF is listed here so that future
 * Rust-side HEIC Exif support requires no TypeScript change. PNG/GIF/WebP
 * do not carry standard Exif data and are intentionally excluded.
 */
const EXIF_ELIGIBLE_EXTS = new Set(["jpg", "jpeg", "heic", "heif"]);

/**
 * Return true when the FolderViewConfig requests at least one image built-in column.
 *
 * The enrichment gate in renderFolderViewTabAsync calls this helper to decide
 * whether image-specific reads (get_image_dimensions, get_exif_data) should run.
 *
 * Checks config.fields (fields: mode) first. Falls back to checking config.extraFields
 * for legacy mode, though image keys will not normally appear there because they are
 * in BUILTIN_FIELDS and are therefore excluded from extraFields by parseFolderMd.
 *
 * @param config - The parsed FolderViewConfig.
 */
function imageColumnsRequested(config: import("./types").FolderViewConfig): boolean {
  if (config.fields !== null) {
    return config.fields.some(f => IMAGE_BUILTIN_KEYS.has(f));
  }
  // Legacy mode: check extraFields (defensive; image keys are unlikely here).
  return config.extraFields.some(f => IMAGE_BUILTIN_KEYS.has(f.key));
}

/** Return true when the `select` field is declared, enabling bulk checkboxes. */
function selectRequested(config: import("./types").FolderViewConfig): boolean {
  return config.fields !== null && config.fields.includes("select");
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
 * error-handling context.  The BulkContext construction (selectionState, toolbar,
 * three callbacks) is inlined here because it must close over `cards` after
 * enrichment and before the renderer is called — extracting it would require
 * threading 6+ values across function boundaries with no clarity gain.
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

    // Step 3a: Enrichment phase — read child metadata from disk.
    // Runs when any layout requests enriched field values:
    //   (a) extra-fields are declared (custom frontmatter keys), OR
    //   (b) image built-in columns are requested (width, height, date-taken, camera).
    // When neither condition is met, enrichment is skipped for all layouts (no-op).
    const needsEnrichment =
      config.extraFields.length > 0 || imageColumnsRequested(config);

    if (needsEnrichment) {
      // Determine which field keys are needed per card type.
      //
      // requestedImageKeys: which of the four image built-ins appear in config.fields.
      //   These drive Rust command calls (get_image_dimensions, get_exif_data).
      //
      // sidecarKeys: non-builtin (custom) keys from config.extraFields.
      //   Used for both .md file enrichment AND sidecar reads for image cards.
      //   config.extraFields already excludes BUILTIN_FIELDS entries (parser.ts resolved them).
      const allRequestedFields: string[] = config.fields !== null
        ? config.fields
        : config.extraFields.map(f => f.key);

      const requestedImageKeys = allRequestedFields.filter(f => IMAGE_BUILTIN_KEYS.has(f));
      const needsDimensions = requestedImageKeys.includes("width") || requestedImageKeys.includes("height");
      const needsExif = requestedImageKeys.includes("date-taken") || requestedImageKeys.includes("camera");
      const sidecarKeys = config.extraFields.map(f => f.key);

      // Initialise meta for non-.md file cards and directory cards so the renderer
      // can safely access card.meta without undefined checks (no-op for .md cards —
      // they get their meta set in the enrichment loop below).
      for (const card of cards) {
        if (card.kind !== "file" || card.ext !== ".md") {
          card.meta = {};
        }
      }

      // Enrich all cards concurrently (AD-3: uncapped Promise.all, same as existing .md path).
      // Each per-card async callback handles its own errors so one failure cannot abort
      // the render for other cards (FR-8 per-card error isolation).
      await Promise.all(
        cards.map(async (card) => {
          // ── Directory cards: no enrichment (card.meta already initialised to {}) ─
          if (card.kind === "directory") return;

          // ── .md file cards: unchanged enrichment path ─────────────────────────
          if (card.ext === ".md") {
            if (sidecarKeys.length === 0) return; // no custom fields requested
            try {
              const fileContent = await (window as any).__TAURI_INTERNALS__?.invoke?.(
                "read_file",
                { path: card.path },
              );
              const raw = typeof fileContent === "string"
                ? fileContent
                : (fileContent?.content ?? "");
              card.meta = extractFrontmatterKeys(raw, sidecarKeys);
            } catch {
              // EC-03: failed read → empty meta, render continues.
              card.meta = {};
            }
            return;
          }

          // ── Non-.md file cards ───────────────────────────────────────────────
          // Determine if this card is an image by checking its extension.
          const extRaw = card.ext.startsWith(".") ? card.ext.slice(1).toLowerCase() : card.ext.toLowerCase();
          const isImage = IMAGE_EXTENSIONS.has(extRaw);

          if (!isImage) {
            // Non-image, non-.md file (e.g. .pdf, .zip): meta stays {} (EC-6, FR-7).
            return;
          }

          // ── Image card enrichment ────────────────────────────────────────────

          // 1. Image dimensions (FR-2): call get_image_dimensions for width/height.
          if (needsDimensions) {
            try {
              const dims = await (window as any).__TAURI_INTERNALS__?.invoke?.(
                "get_image_dimensions",
                { path: card.path },
              ) as [number, number];
              card.meta!["width"]  = String(dims[0]);
              card.meta!["height"] = String(dims[1]);
            } catch {
              // EC-1: truncated or unreadable image → store "" so renderer shows em-dash.
              card.meta!["width"]  = "";
              card.meta!["height"] = "";
            }
          }

          // 2. EXIF data (FR-3): only for EXIF-eligible extensions (JPEG, HEIC/HEIF).
          //    PNG, GIF, WebP do not carry standard Exif — store "" without invoking.
          if (needsExif) {
            if (EXIF_ELIGIBLE_EXTS.has(extRaw)) {
              try {
                const exif = await (window as any).__TAURI_INTERNALS__?.invoke?.(
                  "get_exif_data",
                  { path: card.path },
                ) as { date_taken: string | null; camera: string | null };
                card.meta!["date-taken"] = exif.date_taken ?? "";
                card.meta!["camera"]     = exif.camera ?? "";
              } catch {
                // EC-2: no Exif segment or parse error → store "" for em-dash fallback.
                card.meta!["date-taken"] = "";
                card.meta!["camera"]     = "";
              }
            } else {
              // PNG, GIF, WebP: EXIF not supported — set "" so renderer shows em-dash.
              card.meta!["date-taken"] = "";
              card.meta!["camera"]     = "";
            }
          }

          // 3. Sidecar keys (FR-4): read <image>.md for any non-builtin fields requested.
          if (sidecarKeys.length > 0) {
            const sidecarPath = card.path + ".md";
            try {
              const sidecarContent = await (window as any).__TAURI_INTERNALS__?.invoke?.(
                "read_file",
                { path: sidecarPath },
              );
              const raw = typeof sidecarContent === "string"
                ? sidecarContent
                : (sidecarContent?.content ?? "");
              const sidecarMeta = extractFrontmatterKeys(raw, sidecarKeys);
              // Merge sidecar meta into card.meta (image keys already set above).
              for (const k of sidecarKeys) {
                card.meta![k] = sidecarMeta[k] ?? "";
              }
            } catch {
              // EC-1 (sidecar variant): sidecar missing or unreadable → "" for each key.
              for (const k of sidecarKeys) {
                card.meta![k] = "";
              }
            }
          }
        }),
      );
    }

    // Step 3b: Construct shared BulkContext — only when `select` is in fields:.
    // When absent (or fields: null) the renderers receive undefined and render
    // without toolbar or checkboxes.
    let bulkContext: BulkContext | undefined;
    if (selectRequested(config)) {
      // visibleCards is needed by onYaml to know which paths are eligible.
      // applyExcludeFilter is shared with renderer.ts so both always agree.
      const visibleCards = applyExcludeFilter(cards, config.exclude);
      const dirCards  = visibleCards.filter(c => c.kind === "directory");
      const fileCards = visibleCards.filter(c => c.kind === "file");

      const selectionState = createSelectionState();

      // Extract the three operation callbacks as named consts so they can be both
      // wired into buildToolbar AND stored in BulkContext without forward-reference
      // issues. Using const (not let) guarantees no stale-closure risk.
      const onMove = async (destDir: string): Promise<void> => {
        const result = await executeBulkMove(selectionState, destDir);
        const summary = formatOperationResult(result, "Moved");
        showResult(toolbarRefs, summary, result.failed.length > 0);
        if (result.succeeded > 0) {
          (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
        }
      };

      const onDelete = async (): Promise<void> => {
        const result = await executeBulkDelete(selectionState);
        const summary = formatOperationResult(result, "Deleted");
        showResult(toolbarRefs, summary, result.failed.length > 0);
        if (result.succeeded > 0) {
          (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
        }
      };

      const onYaml = async (
        op: "add" | "remove", key: string, value: string,
      ): Promise<void> => {
        const yamlResult = await executeBulkYaml(
          selectionState, op, key, value, [...dirCards, ...fileCards],
        );
        const summary = formatOperationResult(
          yamlResult, "Processed", yamlResult.skippedCount,
        );
        showResult(toolbarRefs, summary, yamlResult.failed.length > 0);
        // No re-render after YAML apply (FR-6 maintained).
      };

      // toolbarRefs is declared const and used inside onMove/onDelete/onYaml
      // closures; those closures close over toolbarRefs by reference which is
      // valid because the closures are only called after buildToolbar returns.
      const toolbarRefs = buildToolbar(selectionState, onMove, onDelete, onYaml);

      // syncToolbar is a single no-arg closure that each renderer threads down to
      // individual checkbox change handlers so the toolbar count stays current.
      const syncToolbar = (): void => updateToolbar(toolbarRefs, selectionState);

      bulkContext = { selectionState, toolbarRefs, syncToolbar, onMove, onDelete, onYaml };
    }

    LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath, bulkContext);
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
