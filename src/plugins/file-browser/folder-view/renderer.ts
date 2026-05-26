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

import type { FolderViewConfig, FolderCard, FolderSortOrder, BulkContext } from "./types";
import { stripScripts, applyExcludeFilter, attachArrowNavigation } from "./shared";
import { buildPreviewPane, attachPaneResizeHandle } from "./preview-pane";
import { buildMasterCheckboxTh, buildCheckboxTd } from "./bulk-selection";
import { attachFolderItemDrag } from "./folder-item-drag";
import {
  ICON_FOLDER,
  ICON_FILE,
  ICON_FILE_MD,
  ICON_FILE_MARKDOWN,
  ICON_FILE_IMAGE,
  ICON_FILE_JSON,
  ICON_FILE_CODE,
} from "../icons/material/index";

// ── Lazy loading ──────────────────────────────────────────────────────────────

/** Render the first N cards immediately; load the rest via IntersectionObserver. */
const LAZY_BATCH_SIZE = 50;

// ── Bulk-selection checkbox context ──────────────────────────────────────────

/**
 * Per-section bulk-selection wiring threaded through card builders.
 *
 * This type is module-internal — not exported. It groups everything `buildCard`
 * needs to wire a checkbox for one card, along with the per-section arrays that
 * must be captured by reference in the IntersectionObserver closure (C-6).
 *
 * selectionState — Shared mutable selection passed down from BulkContext.
 * syncToolbar    — No-arg closure that updates the toolbar visibility/count.
 * masterInput    — The section's master <input> for indeterminate sync.
 * rowCheckboxes  — Array of all row <input> elements in this section.
 *                  Grows as lazy batches fire (captured by object reference).
 * sectionRows    — Array of all card elements in this section (cast for compat).
 * sectionPaths   — Array of all paths in this section.
 *                  Complete at construction time (pre-seeded from sectionCards).
 */
interface CheckboxContext {
  selectionState: BulkContext["selectionState"];
  syncToolbar:    () => void;
  masterInput:    HTMLInputElement;
  rowCheckboxes:  HTMLInputElement[];
  sectionRows:    HTMLTableRowElement[];
  sectionPaths:   string[];
}

// ── Icon mapping ──────────────────────────────────────────────────────────────

const IMAGE_EXTS    = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]);
const MD_EXTS       = new Set([".md", ".markdown"]);
const TEXT_EXTS     = new Set([".md", ".txt", ".markdown"]);

/**
 * Return the SVG icon string for a file card based on its extension.
 *
 * Maps common extension categories to Material Symbols icons.
 * Unknown extensions fall back to ICON_FILE (generic document icon).
 *
 * @param ext - The file extension with leading dot (e.g. ".pdf"). May be "".
 * @returns An SVG string for the icon.
 */
export function getFileIconForCard(ext: string): string {
  const lower = ext.toLowerCase();
  if (MD_EXTS.has(lower))   return ICON_FILE_MARKDOWN;
  if (lower === ".txt")     return ICON_FILE_MD;
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
export function formatModified(ms: number): string {
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
export function sortCards(cards: FolderCard[], sort: FolderSortOrder): void {
  // "manual" is a no-op preserve: the caller is expected to have already
  // applied the manual order via applyManualOrder() before sortCards runs.
  // Falling back to a stable sort would clobber the user's drag order.
  if (sort === "manual") return;

  cards.sort((a, b) => {
    switch (sort) {
      case "name-desc":     return b.name.localeCompare(a.name);
      case "modified-asc":  return a.modified - b.modified;
      case "modified-desc": return b.modified - a.modified;
      case "author-asc":    return authorKey(a).localeCompare(authorKey(b));
      case "author-desc":   return authorKey(b).localeCompare(authorKey(a));
      case "name-asc":
      default:              return a.name.localeCompare(b.name);
    }
  });
}

/**
 * Reorder `cards` in place to match `order` — listed paths move to the front
 * in their declared order; cards not in the list keep their relative order at
 * the tail.
 *
 * Used by `manual` sort mode. The drag-drop persistence layer writes the
 * resulting paths back to `order:` in the source document (a `\`\`\`select`
 * fence body or `_folder.md` frontmatter).
 *
 * Unknown paths in `order` are silently dropped — this is how stale entries
 * from deleted/renamed files are handled gracefully without forcing a
 * write-back to the source document.
 *
 * Matching is done by `FolderCard.path`. If a future caller wants filename-
 * based matching, swap the lookup key.
 */
export function applyManualOrder(cards: FolderCard[], order: string[]): void {
  if (!order || order.length === 0) return;
  const indexByPath = new Map<string, number>();
  for (const c of cards) indexByPath.set(c.path, cards.indexOf(c));

  const head: FolderCard[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const i = indexByPath.get(path);
    if (i === undefined) continue;          // path no longer present — skip
    if (seen.has(path)) continue;            // duplicate in order array — skip
    head.push(cards[i]);
    seen.add(path);
  }
  const tail = cards.filter((c) => !seen.has(c.path));
  cards.length = 0;
  cards.push(...head, ...tail);
}

/**
 * Sort key for `author-asc` / `author-desc`. Author lives in YAML frontmatter
 * and is populated by `enrichBookshelfMeta` on the bookshelf render path.
 * Falls back to `title` (also from frontmatter) then `name` (filename stem)
 * so a missing or unenriched author still produces a deterministic order.
 */
function authorKey(c: FolderCard): string {
  return c.meta?.author?.trim()
    || c.meta?.title?.trim()
    || c.name;
}

// ── Metadata line builder ─────────────────────────────────────────────────────

/**
 * Build the `.fv-card-meta` metadata line element for a card.
 *
 * Fields mode (config.fields !== null):
 *   Renders values for each field in config.fields, in declaration order,
 *   excluding "name" (already shown as the card name) and "icon". Non-empty
 *   values are separated by " · " (middle dot, U+00B7). Missing or empty values
 *   render as "—" (em-dash, U+2014). If every field produces an em-dash, or the
 *   field list is empty after filtering, returns null so nothing is appended
 *   (EC-13 rule: keep cards clean when no data is available).
 *
 * Legacy mode (config.fields === null):
 *   Shows modified date when config.showModified is true and the card is a file
 *   with a non-zero timestamp. Shows tags joined by " · " when config.showTags
 *   is true. Returns null when nothing is displayable.
 *
 * All values are written via .textContent — never .innerHTML (C-4, EC-15).
 *
 * @param card   - The FolderCard to read data from.
 * @param config - The FolderViewConfig.
 * @returns An HTMLDivElement with class "fv-card-meta", or null.
 */
function buildCardMeta(card: FolderCard, config: FolderViewConfig): HTMLElement | null {
  const parts: string[] = [];

  if (config.fields !== null) {
    // ── Fields mode ───────────────────────────────────────────────────────────
    for (const field of config.fields) {
      // "name" is already the card title; "icon" is visual only; "select" controls
      // checkbox visibility (not a text value) — all three are skipped here.
      if (field === "name" || field === "icon" || field === "select") continue;

      let value = "";

      if (field === "modified") {
        // Use the formatted date when a valid timestamp exists; empty otherwise.
        value = card.modified > 0 ? formatModified(card.modified) : "";
      } else if (field === "tags") {
        // Join all tags with the middle-dot separator as a single meta segment.
        // This differs from the chip display in legacy mode (max 3 chips).
        value = card.tags && card.tags.length > 0 ? card.tags.join(" · ") : "";
      } else if (field === "count") {
        // "count" is only meaningful for directory cards (EC-14).
        // For file cards we leave value="" → em-dash → may be suppressed.
        if (card.kind === "directory") {
          value = String(card.childCount ?? 0);
        }
      } else if (field === "type" || field === "ext") {
        // Show the raw extension string (e.g. ".pdf", ".md").
        value = card.ext;
      } else {
        // All other identifiers (image built-ins: width/height/date-taken/camera;
        // custom frontmatter keys) are read from card.meta populated by enrichment.
        value = card.meta?.[field] ?? "";
      }

      // Em-dash (U+2014) for missing or empty values — consistent with table renderer.
      parts.push(value === "" ? "—" : value);
    }

    // EC-13: suppress the element when every field produced an em-dash (no data).
    // Also suppress when all fields were skipped (empty parts array after filtering).
    if (parts.length === 0 || parts.every(p => p === "—")) return null;

  } else {
    // ── Legacy mode ───────────────────────────────────────────────────────────
    // Nothing to add here: the date is rendered by the .folder-view-card-date
    // block in buildCard (lines ~494-499), and tags are rendered as chip
    // elements in the .folder-view-card-tags block.  Adding either here would
    // produce duplicates.
    return null;
  }

  const meta = document.createElement("div");
  meta.className = "fv-card-meta";
  // All values written via textContent — never innerHTML (C-4, EC-15 XSS guard).
  meta.textContent = parts.join(" · ");
  return meta;
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
 * Structure: preview rectangle → name label → metadata line → checkbox overlay.
 *
 * Accessibility (NFR-07):
 *   - role="button" so screen readers announce it as interactive.
 *   - tabindex=0 so cards are keyboard-reachable via Tab.
 *   - aria-label provides a descriptive name (e.g. "Open folder Reports").
 *   - Enter and Space keys activate the card (same as click).
 *
 * EC-13 XSS note: card.name and all field values are set via .textContent
 * (not .innerHTML) so characters like < and > are rendered as text, never as HTML.
 *
 * When checkboxCtx is provided (Step 04):
 *   - el.style.position = "relative" is set so the absolutely-positioned
 *     checkbox overlay sits in the correct corner.
 *   - A .fv-card-checkbox-wrap element is appended as the last child.
 *   - The checkbox input is registered into checkboxCtx.rowCheckboxes and
 *     the card path is pushed into checkboxCtx.sectionPaths (lazy-load safe,
 *     C-6: the array is captured by reference in the IntersectionObserver closure).
 *
 * Length justification: five distinct concerns — preview rectangle, name/ext/count
 * label, legacy date+tag chips, fields-mode meta line, and checkbox overlay — each
 * require their own conditional DOM construction and event wiring. Splitting into
 * sub-functions would require threading `config`, `card`, `checkboxCtx`, and
 * `displayName` through an extra parameter layer with no clarity gain.
 *
 * @param card         - The FolderCard to render.
 * @param config       - FolderViewConfig for layout and display flags.
 * @param checkboxCtx  - Optional per-section bulk-selection wiring (Step 04).
 * @returns The card `<div>` element with all wiring attached.
 */
function buildCard(
  card: FolderCard,
  config: FolderViewConfig,
  checkboxCtx?: CheckboxContext,
  onSelect?: (card: FolderCard, el: HTMLElement) => void,
): HTMLElement {
  const el = document.createElement("div");
  el.className = [
    "folder-view-card",
    card.kind === "directory" ? "folder-view-card-dir" : "folder-view-card-file",
  ].join(" ");
  // Used by the drag-reorder util (folder-item-drag.ts) to identify cards.
  el.dataset.path = card.path;
  // Drag label shown in the floating ghost during a reorder drag.
  el.dataset.dragLabel = card.name;

  // Required for the absolutely-positioned checkbox overlay (Step 04, C-5).
  if (checkboxCtx) {
    el.style.position = "relative";
  }

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

  // ── Fields mode guard (EC-16, D-3) ─────────────────────────────────────────
  // When fields: is declared, the metadata line (.fv-card-meta) supersedes both
  // the tag chips and the legacy modified-date element. Guard both legacy blocks
  // with config.fields === null to ensure mutual exclusion (EC-16, constraint #7).

  // Tag chips — legacy mode only: first 3 tags for .md files when showTags=true.
  // In fields: mode, tags appear as plain text in the .fv-card-meta line instead.
  if (config.fields === null && config.showTags && card.tags && card.tags.length > 0) {
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

  // Modified date element — legacy mode only (FR-10).
  // When fields: is declared, this is superseded by .fv-card-meta (EC-16).
  if (config.fields === null && config.showModified && card.kind === "file" && card.modified > 0) {
    const dateEl = document.createElement("div");
    dateEl.className = "folder-view-card-date";
    dateEl.textContent = formatModified(card.modified);
    el.appendChild(dateEl);
  }

  // Metadata line — covers both fields: mode and legacy mode (Step 05).
  // buildCardMeta returns null when there is nothing displayable, so the
  // append is guarded. Mutual exclusion with .folder-view-card-date is
  // enforced by the config.fields === null guards above (EC-16, D-3).
  const metaEl = buildCardMeta(card, config);
  if (metaEl) el.appendChild(metaEl);

  // Click / keyboard activation (FR-21/FR-22, NFR-07).
  // When onSelect is provided and the card is a file (not a directory):
  //   single click / Space → select + preview only
  //   double click / Enter → open in tab (same as default)
  // Directories always navigate on single click regardless of preview mode.
  if (onSelect && card.kind === "file") {
    el.addEventListener("click", () => onSelect(card, el));
    el.addEventListener("dblclick", () => handleCardClick(card));
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); handleCardClick(card); }
      else if (e.key === " ") { e.preventDefault(); onSelect(card, el); }
    });
  } else {
    el.addEventListener("click", () => handleCardClick(card));
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(card); }
    });
  }

  // ── Checkbox overlay (Step 04) ──────────────────────────────────────────────
  // Must be appended last so z-index places it above other card content.
  // The <td> returned by buildCheckboxTd is repurposed as a positioned overlay
  // by overriding its className to "fv-card-checkbox-wrap". The CSS for this
  // class (Step 06) applies position:absolute, top:6px, left:6px, z-index:1.
  if (checkboxCtx) {
    const { selectionState, syncToolbar, masterInput, rowCheckboxes,
            sectionRows, sectionPaths } = checkboxCtx;

    // buildCheckboxTd is typed for HTMLTableRowElement but only uses classList.toggle.
    // Casting the card div is safe here (structural typing — no table-specific access).
    const checkboxTd = buildCheckboxTd(
      card,
      el as unknown as HTMLTableRowElement,
      selectionState,
      syncToolbar,
      masterInput,
      sectionPaths,
    );

    // Repurpose the <td> as a positioned overlay. The original fv-td-checkbox
    // class is replaced with fv-card-checkbox-wrap for card-layout CSS.
    checkboxTd.className = "fv-card-checkbox-wrap";
    el.appendChild(checkboxTd);

    // Register the checkbox input and card element for master-checkbox sync.
    const inputInWrap = checkboxTd.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    rowCheckboxes.push(inputInWrap);
    // Cast is safe: buildMasterCheckboxTh only calls classList.toggle on rows.
    sectionRows.push(el as unknown as HTMLTableRowElement);
  }

  return el;
}

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Append cards to a grid element, using IntersectionObserver lazy-loading
 * when the card count exceeds LAZY_BATCH_SIZE.
 *
 * ≤ LAZY_BATCH_SIZE: all cards appended synchronously (no observer overhead).
 * > LAZY_BATCH_SIZE: first batch rendered immediately, a sentinel div is placed
 *   at the end of the grid, and subsequent batches are appended as the sentinel
 *   scrolls into view within scrollRoot.
 *
 * C-6 (lazy-load checkbox threading): `checkboxCtx` is captured by object
 * reference in the IntersectionObserver closure. The inner arrays
 * (rowCheckboxes, sectionPaths, sectionRows) grow in place as batches fire,
 * so the master checkbox state calculation always sees the live arrays.
 *
 * @param cards       - All cards for this section (pre-sorted).
 * @param grid        - The `.folder-view-grid` element to append into.
 * @param config      - FolderViewConfig for buildCard.
 * @param scrollRoot  - The scrollable host element (IntersectionObserver root).
 * @param checkboxCtx - Optional per-section bulk wiring; captured by reference.
 */
function appendCardsToGrid(
  cards: FolderCard[],
  grid: HTMLElement,
  config: FolderViewConfig,
  scrollRoot: HTMLElement,
  checkboxCtx?: CheckboxContext,
  onSelect?: (card: FolderCard, el: HTMLElement) => void,
): void {
  // WeakMap for reverse-lookup from element → card (used by arrow-nav onFocus).
  const cardMap = new WeakMap<HTMLElement, FolderCard>();

  const addCard = (card: FolderCard): HTMLElement => {
    const el = buildCard(card, config, checkboxCtx, onSelect);
    cardMap.set(el, card);
    // Enable drag-to-reorder for file cards only (Phase 1).
    // On a successful drop, dispatch a bubbling CustomEvent that consumers
    // (select-widget, folder-view tab) listen for to persist the new order.
    // Selectors are scoped to the grid container so multiple folder-views in
    // the same document don't cross-contaminate.
    if (card.kind === "file") {
      attachFolderItemDrag(
        el,
        grid,
        card.path,
        ".folder-view-card-file[data-path]",
        (orderedPaths) => {
          grid.dispatchEvent(new CustomEvent("folderview:reorder", {
            detail: { orderedPaths },
            bubbles: true,
          }));
        },
      );
    }
    return el;
  };

  if (cards.length <= LAZY_BATCH_SIZE) {
    for (const card of cards) grid.appendChild(addCard(card));
  } else {
    for (const card of cards.slice(0, LAZY_BATCH_SIZE)) {
      grid.appendChild(addCard(card));
    }

    let rendered = LAZY_BATCH_SIZE;
    const sentinel = document.createElement("div");
    sentinel.className = "fv-load-sentinel";
    grid.appendChild(sentinel);

    // CRITICAL (C-6): checkboxCtx and cardMap are captured by reference.
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      const batch = cards.slice(rendered, rendered + LAZY_BATCH_SIZE);
      for (const card of batch) {
        grid.insertBefore(addCard(card), sentinel);
      }
      rendered += batch.length;
      if (rendered >= cards.length) {
        observer.disconnect();
        sentinel.remove();
      }
    }, { root: scrollRoot, rootMargin: "200px 0px" });

    observer.observe(sentinel);
  }

  // Arrow-key navigation — always enabled (plan requirement).
  // getColCount queries the live computed style at event time.
  attachArrowNavigation(
    grid,
    ".folder-view-card",
    () => {
      try {
        const templateCols = getComputedStyle(grid).gridTemplateColumns;
        if (!templateCols || templateCols === "none") return 1;
        return templateCols.split(" ").length || 1;
      } catch { return 1; }
    },
    onSelect
      ? (el) => { const c = cardMap.get(el); if (c) onSelect(c, el); }
      : undefined,
  );
}

/**
 * Build a section element (optional heading + master checkbox + CSS grid of cards).
 *
 * Used for both the "Folders" section and the "Files" section (FR-18).
 * Cards are appended via appendCardsToGrid, which lazy-loads when the section
 * has more than LAZY_BATCH_SIZE items.
 *
 * When `checkboxCtx` is provided, a master-checkbox row is rendered immediately
 * after the heading (or at the top if there is no heading). The master checkbox
 * uses the same `buildMasterCheckboxTh` helper as the table renderer, but only
 * the returned `masterInput` is used — the `<th>` element is discarded since
 * cards sections use a `<div>` wrapper instead.
 *
 * @param title       - The section heading text (e.g. "Folders"). null = no heading.
 * @param cards       - Pre-sorted FolderCards for this section.
 * @param config      - FolderViewConfig (for card width, layout mode, etc.).
 * @param scrollRoot  - Scrollable host element passed to appendCardsToGrid.
 * @param checkboxCtx - Optional per-section bulk wiring from renderFolderCards.
 * @returns The `.folder-view-section` div element.
 */
function buildSection(
  title: string | null,
  cards: FolderCard[],
  config: FolderViewConfig,
  scrollRoot: HTMLElement,
  checkboxCtx?: CheckboxContext,
  onSelect?: (card: FolderCard, el: HTMLElement) => void,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "folder-view-section";

  if (title) {
    const heading = document.createElement("h3");
    heading.className = "folder-view-section-title";
    heading.textContent = title;
    section.appendChild(heading);
  }

  // Master checkbox wrap — only when bulk context is provided.
  // The <th> returned by buildMasterCheckboxTh is discarded (not applicable to
  // a div-based grid); we only need masterInput from the returned object.
  if (checkboxCtx) {
    const masterWrap = document.createElement("div");
    masterWrap.className = "fv-card-master-checkbox-wrap";
    const masterLabel = document.createElement("label");
    masterLabel.className = "fv-card-master-label";
    const masterInput = checkboxCtx.masterInput;
    masterInput.setAttribute("aria-label", `Select all ${title ?? "items"}`);
    masterLabel.appendChild(masterInput);
    const labelText = document.createElement("span");
    labelText.className = "fv-card-master-label-text";
    labelText.textContent = "Select all";
    masterLabel.appendChild(labelText);
    masterWrap.appendChild(masterLabel);
    section.appendChild(masterWrap);
  }

  const grid = document.createElement("div");
  grid.className = "folder-view-grid";
  grid.style.setProperty("--fv-card-width", config.cardWidth + "px");
  if (config.layoutMode === "flex") grid.classList.add("fv-flex-mode");
  grid.setAttribute("role", "list");

  appendCardsToGrid(cards, grid, config, scrollRoot, checkboxCtx, onSelect);

  section.appendChild(grid);
  return section;
}

// ── Page header (cover + icon) ────────────────────────────────────────────────

function isImagePath(s: string): boolean {
  const dot = s.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTS.has(s.slice(dot).toLowerCase());
}

function resolveFolderPath(folderPath: string, rel: string): string {
  if (rel.startsWith("/")) return rel;
  if (rel.startsWith("./")) return folderPath + rel.slice(1);
  return folderPath + "/" + rel;
}

/**
 * Build the `.folder-view-page-header` element containing an optional cover
 * image and optional page icon. Returns null when neither is configured.
 */
function buildPageHeader(
  config: FolderViewConfig,
  folderPath: string,
): HTMLElement | null {
  if (!config.cover && !config.icon) return null;

  const convertFileSrc = (window as any).__MARKABLE_CONVERT_FILE_SRC__;
  const header = document.createElement("div");
  header.className = "folder-view-page-header";

  if (config.cover) {
    const coverEl = document.createElement("img");
    coverEl.className = "folder-view-cover";
    coverEl.alt = "";
    const absPath = resolveFolderPath(folderPath, config.cover);
    coverEl.src = convertFileSrc ? (convertFileSrc(absPath) as string) : absPath;
    coverEl.onerror = () => { coverEl.style.display = "none"; };
    header.appendChild(coverEl);
  }

  if (config.icon) {
    const iconEl = document.createElement("div");
    iconEl.className = "folder-view-page-icon";
    if (isImagePath(config.icon)) {
      const img = document.createElement("img");
      img.alt = "";
      const absPath = resolveFolderPath(folderPath, config.icon);
      img.src = convertFileSrc ? (convertFileSrc(absPath) as string) : absPath;
      img.onerror = () => { iconEl.style.display = "none"; };
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = config.icon;
    }
    header.appendChild(iconEl);
  }

  return header;
}

// ── Public renderer ───────────────────────────────────────────────────────────

/**
 * Render the folder-cards layout into the given container.
 *
 * This is the FolderLayoutRenderer for the "folder-cards" layout value (FR-18).
 *
 * Algorithm:
 * 1. Clear the container and create the host div.
 * 2. If context is provided, attach toolbar as first child of host (Step 03).
 * 3. Render the description block if config.body is non-empty (FR-11/FR-24).
 * 4. Separate cards into subfolder and file sections; sort each independently (FR-20).
 * 5. If both sections are empty, render the empty-state message (FR-26).
 * 6. For each non-empty section, build a per-section CheckboxContext (Step 04)
 *    and render the section with master checkbox + per-card checkboxes.
 *
 * Length justification: this function orchestrates two distinct sections (subfolders
 * and files), each requiring sort, CheckboxContext construction, build, and conditional
 * render logic. All heavy lifting is delegated to buildSection(), buildCard(),
 * sortCards(). The top-level control flow cannot be meaningfully split further without
 * threading config + cards through an opaque extra layer.
 *
 * @param config      - Validated FolderViewConfig from parseFolderMd().
 * @param cards       - Immediate children from collectChildren() (unsorted).
 * @param container   - The DOM element to render into (cleared on entry).
 * @param folderPath  - Absolute path of the folder; used for resolving cover/icon paths.
 * @param context     - Optional shared bulk wiring from tab.ts (Step 01).
 */
export function renderFolderCards(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
  context?: BulkContext,
): void {
  container.innerHTML = "";

  const host = document.createElement("div");
  host.className = "folder-view-host";
  if (!config.contentAreaOverride) host.classList.add("folder-view-host--constrained");

  // Preview pane — when config.previewPane is true, restructure host as a
  // flex column: pane (top) + scrollable main area (bottom).
  // When false, contentTarget === host and DOM is unchanged.
  let contentTarget: HTMLElement = host;
  let selectCard: ((card: FolderCard, el: HTMLElement) => void) | undefined;
  let selectedEl: HTMLElement | null = null;

  if (config.previewPane) {
    host.classList.add("fv-host--with-preview");
    host.style.setProperty("--fvp-height", config.previewHeight);
    const previewHandle = buildPreviewPane();
    host.appendChild(previewHandle.pane);
    host.appendChild(attachPaneResizeHandle(host, previewHandle.pane));

    const mainWrapper = document.createElement("div");
    mainWrapper.className = "folder-view-main";
    host.appendChild(mainWrapper);
    contentTarget = mainWrapper;

    selectCard = (card: FolderCard, el: HTMLElement) => {
      selectedEl?.classList.remove("fv-card--selected");
      selectedEl = el;
      el.classList.add("fv-card--selected");
      previewHandle.update(card);
    };
  }

  // Page header — cover image + page icon, above everything else.
  const pageHeader = buildPageHeader(config, folderPath);
  if (pageHeader) contentTarget.appendChild(pageHeader);

  // Toolbar — attach to contentTarget so it sits inside the scrollable area.
  if (context?.toolbarRefs) {
    contentTarget.appendChild(context.toolbarRefs.toolbar);
  }

  // Description block (FR-11/FR-24).
  if (config.body.trim()) {
    const desc = document.createElement("div");
    desc.className = "folder-view-description";
    const renderMd = (window as any).__MARKABLE_RENDER_MD__ as
      ((md: string) => string) | undefined;
    if (renderMd) {
      desc.innerHTML = stripScripts(renderMd(config.body));
    } else {
      desc.textContent = config.body;
    }
    contentTarget.appendChild(desc);
  }

  // Apply exclude filter (FVB-05), then separate and sort.
  const visibleCards = applyExcludeFilter(cards, config.exclude);

  const dirCards  = visibleCards.filter(c => c.kind === "directory");
  const fileCards = visibleCards.filter(c => c.kind === "file");

  // Manual sort applies the user's drag-drop order to file cards; folders
  // continue to sort alphabetically (drag-reorder is files-only for Phase 1).
  if (config.sort === "manual" && config.order && config.order.length > 0) {
    applyManualOrder(fileCards, config.order);
    sortCards(dirCards, "name-asc");
  } else {
    sortCards(dirCards, config.sort);
    sortCards(fileCards, config.sort);
  }

  // Respect section-visibility toggles (FVB-07).
  const showDirs  = config.showFolders && dirCards.length > 0;
  const showFiles = config.showFiles  && fileCards.length > 0;

  // Empty state (FR-26, EC-06).
  if (!showDirs && !showFiles) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "This folder is empty.";
    contentTarget.appendChild(empty);
    container.appendChild(host);
    return;
  }

  // Build per-section CheckboxContext when bulk context is provided.
  //
  // Why per-section: each section has its own master checkbox, and the master
  // checkbox state is computed from its section's sectionPaths only. Sharing
  // a single context across sections would mix folder and file paths in the
  // master checkbox calculation.
  //
  // The sectionPaths array is complete at construction time — pre-seeded from
  // sectionCards.map(c => c.path). rowCheckboxes and sectionRows are the arrays
  // that grow as lazy batches fire (C-6: IntersectionObserver closure captures
  // checkboxCtx by reference, so appends into those arrays are visible to
  // updateMasterCheckboxState).
  const makeCheckboxCtx = (
    sectionCards: FolderCard[],
    sectionLabel: string,
  ): CheckboxContext | undefined => {
    if (!context) return undefined;

    const sectionPaths = sectionCards.map(c => c.path);
    const rowCheckboxes: HTMLInputElement[] = [];
    const sectionRows: HTMLTableRowElement[] = [];

    // buildMasterCheckboxTh wires the master checkbox and returns masterInput.
    // The <th> element is discarded — the cards layout uses a <div> wrapper.
    const { masterInput } = buildMasterCheckboxTh(
      sectionLabel,
      sectionPaths,
      context.selectionState,
      context.syncToolbar,
      rowCheckboxes,
      sectionRows,
    );

    return {
      selectionState: context.selectionState,
      syncToolbar:    context.syncToolbar,
      masterInput,
      rowCheckboxes,
      sectionRows,
      sectionPaths,
    };
  };

  const dirLabel  = config.foldersTitle || "Folders";
  const fileLabel = config.filesTitle   || "Files";

  // Render sections — subfolders always before files (FR-18).
  if (showDirs) {
    const checkboxCtx = makeCheckboxCtx(dirCards, dirLabel);
    contentTarget.appendChild(
      buildSection(config.foldersTitle || null, dirCards, config, contentTarget, checkboxCtx, selectCard),
    );
  }

  if (showFiles) {
    const checkboxCtx = makeCheckboxCtx(fileCards, fileLabel);
    contentTarget.appendChild(
      buildSection(config.filesTitle || null, fileCards, config, contentTarget, checkboxCtx, selectCard),
    );
  }

  container.appendChild(host);
}
