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
  if (lower === ".md" || lower === ".txt") return ICON_FILE_MD;
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"].includes(lower)) return ICON_FILE_IMAGE;
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

// ── Card meta builder ─────────────────────────────────────────────────────────

/**
 * Build the meta row element (extension badge + modified date) for a file card.
 *
 * Only file cards have a meta row. Directory cards have no meta (no extension,
 * modified date not meaningful for the current v1 use case).
 *
 * @param card         - The file FolderCard.
 * @param showModified - Whether to render the modified date (from config).
 * @returns The `.folder-view-card-meta` div element.
 */
function buildCardMeta(card: FolderCard, showModified: boolean): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "folder-view-card-meta";

  // Extension badge (e.g. ".pdf").
  if (card.ext) {
    const ext = document.createElement("span");
    ext.className = "folder-view-card-ext";
    ext.textContent = card.ext;
    meta.appendChild(ext);
  }

  // Modified date (only when showModified=true and modified > 0).
  if (showModified && card.modified > 0) {
    const date = document.createElement("span");
    date.className = "folder-view-card-date";
    date.textContent = formatModified(card.modified);
    meta.appendChild(date);
  }

  return meta;
}

// ── Card builder ──────────────────────────────────────────────────────────────

/**
 * Build one card element for the grid.
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
 * Length justification: five responsibilities (icon, name, meta, click,
 * keyboard) all operate on the same `el` element and share `card`/`config`.
 * Extracting them into sub-functions would require passing `el` as a parameter
 * to each, producing no clarity gain.
 *
 * @param card   - The FolderCard to render.
 * @param config - Config for showModified flag.
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

  // Icon area.
  const iconEl = document.createElement("div");
  iconEl.className = "folder-view-card-icon";
  iconEl.innerHTML = card.kind === "directory"
    ? ICON_FOLDER
    : getFileIconForCard(card.ext);
  el.appendChild(iconEl);

  // Name text — set via .textContent to prevent XSS (EC-13).
  const nameEl = document.createElement("div");
  nameEl.className = "folder-view-card-name";
  nameEl.textContent = card.name;
  nameEl.title = card.path; // tooltip shows full path on hover
  el.appendChild(nameEl);

  // Meta row for file cards (extension badge + modified date).
  if (card.kind === "file") {
    el.appendChild(buildCardMeta(card, config.showModified));
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
  title: string,
  cards: FolderCard[],
  config: FolderViewConfig,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "folder-view-section";

  const heading = document.createElement("h3");
  heading.className = "folder-view-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "folder-view-grid";
  // FR-25: set --fv-columns CSS custom property inline for this grid.
  grid.style.setProperty("--fv-columns", String(config.columns));
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

  // Step 3: Separate and sort.
  const dirCards = cards.filter(c => c.kind === "directory");
  const fileCards = cards.filter(c => c.kind === "file");

  sortCards(dirCards, config.sort);
  sortCards(fileCards, config.sort);

  // Step 4: Empty state (FR-26, EC-06).
  if (dirCards.length === 0 && fileCards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "This folder is empty.";
    host.appendChild(empty);
    container.appendChild(host);
    return;
  }

  // Step 5: Render sections — subfolders always before files (FR-18).
  if (dirCards.length > 0) {
    host.appendChild(buildSection("Folders", dirCards, config));
  }

  if (fileCards.length > 0) {
    host.appendChild(buildSection("Files", fileCards, config));
  }

  container.appendChild(host);
}
