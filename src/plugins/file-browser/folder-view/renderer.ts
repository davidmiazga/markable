/**
 * renderer.ts — Card grid renderer for the "folder-cards" layout.
 *
 * Exports renderFolderCards(), the FolderLayoutRenderer for the v1 "folder-cards"
 * layout. The renderer receives a validated FolderViewConfig, a pre-collected
 * list of FolderCards from collectChildren(), and a DOM container to render into.
 *
 * Design decisions:
 *   AD-6: Plain DOM construction — no reactive library or template engine.
 *   AD-10: Subfolder card click expands the tree and (if hasFolderView) opens FV tab.
 *   FR-25: All colors use CSS custom properties — no hard-coded values.
 *   NFR-07: Cards use role="button", tabindex=0, aria-label, and keyboard handlers.
 *   EC-14: Description body passes through stripScripts() before innerHTML assignment.
 *   EC-22: O(N) card construction — no O(N²) nested operations.
 *
 * @module folder-view/renderer
 */

import type { FolderViewConfig, FolderCard, FolderSortOrder } from "./types";
import { stripScripts } from "./shared";
import {
  ICON_FOLDER,
  ICON_FILE,
  ICON_FILE_MD,
  ICON_FILE_IMAGE,
  ICON_FILE_JSON,
  ICON_FILE_CODE,
} from "../icons/material/index";

// ── Icon mapping ──────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]);
const TEXT_EXTS  = new Set([".md", ".txt", ".markdown"]);

/**
 * Return the SVG icon string for a file card based on its extension.
 *
 * Maps common extension categories to Material Symbols icons.
 * Unknown extensions fall back to ICON_FILE (generic document icon).
 *
 * @param ext - The file extension with leading dot (e.g. ".pdf"). May be "".
 * @returns An SVG string for the icon.
 */
function getFileIconForCard(ext: string): string {
  const lower = ext.toLowerCase();
  if (TEXT_EXTS.has(lower)) return ICON_FILE_MD;
  if (IMAGE_EXTS.has(lower)) return ICON_FILE_IMAGE;
  if ([".json", ".yaml", ".yml", ".toml"].includes(lower)) return ICON_FILE_JSON;
  if ([".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".sh"].includes(lower)) return ICON_FILE_CODE;
  return ICON_FILE;
}

// ── Date formatting ───────────────────────────────────────────────────────────

/**
 * Format a Unix millisecond timestamp as a human-readable date string.
 *
 * Uses the locale's short month/day/year format (e.g. "Jan 5, 2026").
 *
 * @param ms - Unix timestamp in milliseconds.
 * @returns Formatted date string.
 */
function formatModified(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Sort utility ──────────────────────────────────────────────────────────────

/**
 * Sort an array of FolderCards in place according to the given sort order.
 *
 * Applied independently to the subfolder section and the file section (FR-20).
 * Within each section, the sort produces a stable, deterministic order.
 *
 * @param cards - The card array to sort (mutated in place).
 * @param sort  - The sort order from FolderViewConfig.sort.
 */
function sortCards(cards: FolderCard[], sort: FolderSortOrder): void {
  cards.sort((a, b) => {
    switch (sort) {
      case "name-desc":     return b.name.localeCompare(a.name);
      case "modified-asc":  return a.modified - b.modified;
      case "modified-desc": return b.modified - a.modified;
      case "name-asc":
      default:              return a.name.localeCompare(b.name);
    }
  });
}

// ── Card click handler ────────────────────────────────────────────────────────

/**
 * Handle a click (or Enter/Space keydown) on a folder card.
 *
 * For directories (FR-21):
 *   1. Expand the file tree to the subfolder via expandDirectory().
 *   2. If the subfolder has _folder.md (hasFolderView=true), open its Folder
 *      View tab via the __MARKABLE_OPEN_FOLDER_VIEW_TAB__ global (AD-10).
 *      The global is used instead of a direct import to break the circular
 *      dependency: tab.ts imports renderer.ts, so renderer.ts must not import tab.ts.
 *
 * For files (FR-22):
 *   Opens the file in the editor (for .md/.txt) or media viewer (for others).
 *
 * @param card - The FolderCard that was activated.
 */
function handleCardClick(card: FolderCard): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const fb = (window as any).__MARKABLE_FILE_BROWSER__;

  if (card.kind === "directory") {
    // FR-21 step 1: expand the file tree to this subfolder.
    fb?.expandDirectory?.(card.path);
    // FR-21 step 2: if the subfolder has _folder.md, open its Folder View tab.
    if (card.hasFolderView) {
      const openFV = (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__;
      openFV?.(card.path);
    }
  } else {
    // FR-22: open in editor or media viewer based on file extension.
    const lp = card.path.toLowerCase();
    if (lp.endsWith(".md") || lp.endsWith(".txt")) {
      void tabMgr?.openFileInTab?.(card.path);
    } else {
      void tabMgr?.openMediaInTab?.(card.path);
    }
  }
}

// ── Card preview builder ──────────────────────────────────────────────────────

/**
 * Build the preview rectangle shown at the top of each card.
 *
 * Shape and sizing are driven by config (aspectRatio, minHeight, maxHeight).
 * Image fit (cover / contain / 80% auto / etc.) is driven by config.fit via
 * CSS background-size, which requires background-image rather than <img>.
 *
 * - Images (fixed ratio): background-image + background-size for full
 *   background-size vocabulary. Preload via Image() for error detection.
 * - Images (original): <img> with natural proportions so the container
 *   height follows the image. config.fit is ignored in this mode.
 * - Text / Markdown: async read_file; shows first ~300 chars stripped of
 *   frontmatter. Falls back to the file icon if the read fails.
 * - Directories: large folder icon centred in rectangle.
 * - All other files: centred file-type icon.
 *
 * EC-13: no innerHTML on user-supplied text; textContent is used throughout.
 *
 * Length justification: three content types × two image sub-modes each require
 * distinct element construction and async paths. All heavy lifting for icons,
 * text loading, and image loading is contained here; no further split is
 * possible without threading config through an opaque extra layer.
 */
function buildCardPreview(card: FolderCard, config: FolderViewConfig): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "folder-view-card-preview";

  // Apply layout constraints from config (inline styles override CSS defaults).
  if (config.aspectRatio !== "original") {
    preview.style.aspectRatio = config.aspectRatio;
  }
  preview.style.minHeight = config.minHeight + "px";
  preview.style.maxHeight = config.maxHeight + "px";

  if (card.kind === "directory") {
    const wrap = document.createElement("div");
    wrap.className = "folder-view-preview-icon";
    wrap.innerHTML = ICON_FOLDER;
    preview.appendChild(wrap);
    return preview;
  }

  const extLower = card.ext.toLowerCase();

  if (IMAGE_EXTS.has(extLower)) {
    const convertFileSrc = (window as any).__MARKABLE_CONVERT_FILE_SRC__;
    if (convertFileSrc) {
      const url = convertFileSrc(card.path) as string;

      if (config.aspectRatio === "original") {
        // Natural proportions: use <img> so the container height follows the image.
        const img = document.createElement("img");
        img.src = url;
        img.alt = card.name;
        img.className = "folder-view-preview-img-natural";
        img.addEventListener("error", () => {
          img.remove();
          const wrap = document.createElement("div");
          wrap.className = "folder-view-preview-icon";
          wrap.innerHTML = getFileIconForCard(extLower);
          preview.appendChild(wrap);
        });
        preview.appendChild(img);
      } else {
        // Fixed-ratio box: background-image + background-size so the full
        // CSS background-size vocabulary ("80% auto", etc.) is available.
        // Preload via a hidden Image to detect load errors before creating the div.
        const probe = new Image();
        probe.onload = () => {
          const bg = document.createElement("div");
          bg.className = "folder-view-preview-bg-img";
          bg.style.backgroundImage = `url("${url}")`;
          bg.style.backgroundSize = config.fit;
          preview.appendChild(bg);
        };
        probe.onerror = () => {
          const wrap = document.createElement("div");
          wrap.className = "folder-view-preview-icon";
          wrap.innerHTML = getFileIconForCard(extLower);
          preview.appendChild(wrap);
        };
        probe.src = url;
      }
    } else {
      const wrap = document.createElement("div");
      wrap.className = "folder-view-preview-icon";
      wrap.innerHTML = getFileIconForCard(extLower);
      preview.appendChild(wrap);
    }
    return preview;
  }

  if (TEXT_EXTS.has(extLower)) {
    const textWrap = document.createElement("div");
    textWrap.className = "folder-view-preview-text";
    preview.appendChild(textWrap);
    const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
    if (invoke) {
      void (invoke as (cmd: string, args: object) => Promise<string>)(
        "read_file", { path: card.path },
      ).then((raw) => {
        let text = raw;
        // Strip YAML frontmatter so code isn't the first thing displayed.
        if (text.startsWith("---")) {
          const end = text.indexOf("\n---", 4);
          if (end !== -1) text = text.slice(end + 4);
        }
        textWrap.textContent = text.trim().slice(0, 300) || "—";
      }).catch(() => {
        textWrap.remove();
        const wrap = document.createElement("div");
        wrap.className = "folder-view-preview-icon";
        wrap.innerHTML = getFileIconForCard(extLower);
        preview.appendChild(wrap);
      });
    }
    return preview;
  }

  // Fallback: centred file-type icon.
  const wrap = document.createElement("div");
  wrap.className = "folder-view-preview-icon";
  wrap.innerHTML = getFileIconForCard(extLower);
  preview.appendChild(wrap);
  return preview;
}

// ── Card builder ──────────────────────────────────────────────────────────────

/**
 * Build one card element for the grid.
 *
 * Structure: preview rectangle (top) → name label (bottom).
 *
 * Accessibility (NFR-07):
 *   - role="button" so screen readers announce it as interactive.
 *   - tabindex=0 so cards are keyboard-reachable via Tab.
 *   - aria-label provides a descriptive name (e.g. "Open folder Reports").
 *   - Enter and Space keys activate the card (same as click).
 *
 * EC-13 XSS note: card.name is set via .textContent (not .innerHTML) so
 * characters like < and > are rendered as text, never as HTML.
 *
 * @param card   - The FolderCard to render.
 * @param config - Config for showModified flag (retained for forward compatibility).
 * @returns The card `<div>` element with all wiring attached.
 */
function buildCard(card: FolderCard, config: FolderViewConfig): HTMLElement {
  const el = document.createElement("div");
  el.className = [
    "folder-view-card",
    card.kind === "directory" ? "folder-view-card-dir" : "folder-view-card-file",
  ].join(" ");

  // NFR-07: accessibility attributes.
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute(
    "aria-label",
    card.kind === "directory"
      ? `Open folder ${card.name}`
      : `Open file ${card.name}`,
  );

  // Preview rectangle — skipped in compact mode (FVB-04).
  if (config.showPreview) {
    el.appendChild(buildCardPreview(card, config));
  }

  // Display name: strip extension from non-md files when showExtensions=false (FVB-06).
  let displayName = card.name;
  if (!config.showExtensions && card.ext && card.ext !== ".md" && card.name.endsWith(card.ext)) {
    displayName = card.name.slice(0, -card.ext.length);
  }

  // Item count appended to folder card name (FVB-09).
  if (config.showCount && card.kind === "directory" && (card.childCount ?? 0) > 0) {
    displayName += ` (${card.childCount})`;
  }

  // Name text — set via .textContent to prevent XSS (EC-13).
  if (config.showName) {
    const nameEl = document.createElement("div");
    nameEl.className = "folder-view-card-name";
    nameEl.textContent = displayName;
    nameEl.title = card.path;
    el.appendChild(nameEl);
  }

  // Tag chips — first 3 tags for .md files when showTags=true (FVB-01).
  if (config.showTags && card.tags && card.tags.length > 0) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "folder-view-card-tags";
    const limit = Math.min(3, card.tags.length);
    for (let i = 0; i < limit; i++) {
      const chip = document.createElement("span");
      chip.className = "folder-view-tag-chip";
      chip.textContent = card.tags[i];
      chip.title = card.tags[i];
      tagsEl.appendChild(chip);
    }
    el.appendChild(tagsEl);
  }

  // Modified date — only for file cards with a known timestamp (FR-10).
  if (config.showModified && card.kind === "file" && card.modified > 0) {
    const dateEl = document.createElement("div");
    dateEl.className = "folder-view-card-date";
    dateEl.textContent = formatModified(card.modified);
    el.appendChild(dateEl);
  }

  // Click handler (FR-21/FR-22).
  el.addEventListener("click", () => handleCardClick(card));

  // Keyboard activation: Enter or Space (NFR-07).
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick(card);
    }
  });

  return el;
}

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Build a section element (heading + CSS grid of cards).
 *
 * Used for both the "Folders" section and the "Files" section (FR-18).
 * The grid's column count is controlled by the --fv-columns CSS variable
 * set inline on the grid element (FR-25).
 *
 * @param title   - The section heading text (e.g. "Folders" or "Files").
 * @param cards   - Pre-sorted FolderCards for this section.
 * @param config  - FolderViewConfig (for columns and showModified).
 * @returns The `.folder-view-section` div element.
 */
function buildSection(
  title: string | null,
  cards: FolderCard[],
  config: FolderViewConfig,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "folder-view-section";

  if (title) {
    const heading = document.createElement("h3");
    heading.className = "folder-view-section-title";
    heading.textContent = title;
    section.appendChild(heading);
  }

  const grid = document.createElement("div");
  grid.className = "folder-view-grid";
  // Set --fv-card-width (inherited by cards for flex-basis / minmax).
  grid.style.setProperty("--fv-card-width", config.cardWidth + "px");
  // Flex mode adds a modifier class; grid mode is the default (no class).
  if (config.layoutMode === "flex") grid.classList.add("fv-flex-mode");
  grid.setAttribute("role", "list");

  // EC-22: single O(N) loop — no nested card×card operations.
  for (const card of cards) {
    grid.appendChild(buildCard(card, config));
  }

  section.appendChild(grid);
  return section;
}

// ── Public renderer ───────────────────────────────────────────────────────────

/**
 * Render the folder-cards layout into the given container.
 *
 * This is the FolderLayoutRenderer for the "folder-cards" layout value (FR-18).
 *
 * Algorithm:
 * 1. Clear the container and create the host div.
 * 2. Render the description block if config.body is non-empty (FR-11/FR-24).
 * 3. Separate cards into subfolder and file sections; sort each independently (FR-20).
 * 4. If both sections are empty, render the empty-state message (FR-26).
 * 5. Render each non-empty section (subfolder section first per FR-18).
 *
 * Length justification: this function orchestrates two distinct sections (subfolders
 * and files), each requiring sort, build, and conditional render logic. All
 * heavy lifting is delegated to buildSection(), buildCard(), sortCards().
 * The top-level control flow cannot be meaningfully split further without
 * threading config + cards through an opaque extra layer.
 *
 * @param config     - Validated FolderViewConfig from parseFolderMd().
 * @param cards      - Immediate children from collectChildren() (unsorted).
 * @param container  - The DOM element to render into (cleared on entry).
 * @param _folderPath - Absolute path of the folder (unused in this renderer;
 *                      present to satisfy the FolderLayoutRenderer contract).
 */
export function renderFolderCards(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
): void {
  container.innerHTML = "";

  const host = document.createElement("div");
  host.className = "folder-view-host";

  // Step 2: Description block (FR-11/FR-24).
  if (config.body.trim()) {
    const desc = document.createElement("div");
    desc.className = "folder-view-description";

    const renderMd = (window as any).__MARKABLE_RENDER_MD__ as
      ((md: string) => string) | undefined;

    if (renderMd) {
      // EC-14: sanitize rendered HTML before injecting into DOM.
      desc.innerHTML = stripScripts(renderMd(config.body));
    } else {
      desc.textContent = config.body;
    }

    host.appendChild(desc);
  }

  // Step 3: Apply exclude filter (FVB-05), then separate and sort.
  const excludeSet = new Set(config.exclude);
  const visibleCards = excludeSet.size > 0
    ? cards.filter(c => {
        // For .md files the name is the stem; reconstruct full filename for comparison.
        const filename = c.ext === ".md" ? c.name + ".md" : c.name;
        return !excludeSet.has(filename);
      })
    : cards;

  const dirCards  = visibleCards.filter(c => c.kind === "directory");
  const fileCards = visibleCards.filter(c => c.kind === "file");

  sortCards(dirCards, config.sort);
  sortCards(fileCards, config.sort);

  // Respect section-visibility toggles (FVB-07).
  const showDirs  = config.showFolders && dirCards.length > 0;
  const showFiles = config.showFiles  && fileCards.length > 0;

  // Step 4: Empty state (FR-26, EC-06).
  if (!showDirs && !showFiles) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "This folder is empty.";
    host.appendChild(empty);
    container.appendChild(host);
    return;
  }

  // Step 5: Render sections — subfolders always before files (FR-18).
  if (showDirs) {
    host.appendChild(buildSection(config.foldersTitle || null, dirCards, config));
  }

  if (showFiles) {
    host.appendChild(buildSection(config.filesTitle || null, fileCards, config));
  }

  container.appendChild(host);
}
