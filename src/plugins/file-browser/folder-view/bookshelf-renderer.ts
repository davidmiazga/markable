/**
 * bookshelf-renderer.ts — Bookshelf display for the Select codefence.
 *
 * Three sub-options dispatch from one entry point:
 *
 *   - `compact` (default): spines only, every item rendered as a stylized
 *     vertical spine — even when the YAML carries a `cover:`. Same 80vh
 *     count-aware shelf heights as `library`. Reads as a dense wall of books.
 *
 *   - `library`: mixed shelves — cover image when available, randomized
 *     spine fallback otherwise. Per-shelf detection switches a fully-covered
 *     shelf into a grid layout; when every shelf is all-covers the bookshelf
 *     drops the 80vh height and sizes to content.
 *
 *   - `covers`: every item is a cover-box. Items with a cover use the image
 *     at its natural aspect ratio; items without get a colored placeholder
 *     box with horizontal title + author text. Shelf height is auto.
 *
 * Bookshelf reads arbitrary YAML keys (`cover`, `author`, plus any
 * user-chosen `group-by` key) so it cannot rely on the synchronous vault
 * index. The renderer paints a placeholder skeleton immediately, then
 * asynchronously reads frontmatter from each visible .md file and re-renders.
 */

import type { FolderViewConfig, FolderCard } from "./types";
import { sortCards } from "./renderer";
import { applyExcludeFilter } from "./shared";
import { parseYamlLines } from "./parser";
import { readFile } from "../../../lib/bridge";
import { resolveAssetSrc } from "../../../lib/layout-manager";
import { bookshelfPatternUrl } from "./bookshelf-patterns";

// ── Click handling ───────────────────────────────────────────────────────────

function openCard(card: FolderCard): void {
  const tabMgr = (window as unknown as { __MARKABLE_TAB_MANAGER__?: {
    openFileInTab?: (path: string) => unknown;
    openMediaInTab?: (path: string) => unknown;
  } }).__MARKABLE_TAB_MANAGER__;
  if (card.ext === ".md" || card.ext === ".txt") {
    void tabMgr?.openFileInTab?.(card.path);
  } else {
    void tabMgr?.openMediaInTab?.(card.path);
  }
}

function attachClickHandlers(book: HTMLElement, card: FolderCard): void {
  book.addEventListener("click", () => openCard(card));
  book.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCard(card);
    }
  });
}

// ── Hash-derived per-book visual slots ───────────────────────────────────────

/**
 * Hash a card's path. Same book always gets the same number — used to
 * derive stable but visually-random color/width/weight/size slots so a
 * given book keeps its appearance through sorts, re-renders, and folder
 * additions.
 */
function hashCard(card: FolderCard): number {
  let h = 5381;
  for (let i = 0; i < card.path.length; i++) {
    h = (h * 33) ^ card.path.charCodeAt(i);
  }
  return Math.abs(h);
}

/** Bright-palette slot 1..8 (applied to Covers placeholders + Library covers). */
function colorSlotFor(card: FolderCard): number {
  return (hashCard(card) % 8) + 1;
}

/**
 * Paired-palette slot 1..8 — used by the two-zone spine (Compact + Library's
 * no-cover rich-spine fallback). Each pair carries a top color (pattern zone)
 * and a bottom color (label zone), defined in src/styles.css.
 *
 * Different formula than colorSlotFor so a given book that uses both —
 * unlikely in practice — would get a different pair slot than its bright
 * slot, but the slot stays stable across re-renders for the same card.
 */
function pairSlotFor(card: FolderCard): number {
  return ((hashCard(card) >> 3) % 8) + 1;
}

/**
 * Pseudo-random width in [75, 105] for long-title spines. Hash-derived so a
 * given book keeps its width across re-renders. The widths are discrete (6
 * steps of 6px) so the shelf reads as deliberate variety rather than noise.
 *
 * Wider than the widest classic spine (61px from .fv-book-rule:nth-child(5n))
 * — keeps the two-zone variant visibly distinct on the shelf.
 */
function longTitleWidthFor(card: FolderCard): number {
  const widths = [75, 81, 87, 93, 99, 105];
  return widths[(hashCard(card) >> 6) % widths.length];
}

/**
 * SVG-pattern slot 1..7 for the long-title pattern zone. Shift distinct
 * from pairSlotFor (>>3) and longTitleWidthFor (>>6) so a given book's
 * pair color, width, and pattern look like independent draws — visual
 * variety doesn't collapse into a small set of repeated combinations.
 */
function patternSlotFor(card: FolderCard): number {
  return ((hashCard(card) >> 9) % 7) + 1;
}

// ── Item builders ────────────────────────────────────────────────────────────

/**
 * Populate a .fv-book wrapper with rich-spine content. The DOM produced
 * depends on title length:
 *
 *   SHORT title (default) — classic single-spine layout:
 *     .fv-book
 *       .fv-book-author       <- small text near the top
 *       .fv-book-title        <- main rotated bold title
 *       .fv-book-date         <- .fv-book-rule + optional date text
 *
 *   LONG title (>= 4 words OR >= 25 chars) — two-zone enriched layout:
 *     .fv-book.fv-book-title-len-long
 *       .fv-book-pattern      <- top zone (Phase 2 hosts an SVG pattern)
 *       .fv-book-label-zone   <- bottom zone, holds three vertical text runs
 *         .fv-book-eyebrow    <- appended only if meta.author is set
 *         .fv-book-title      <- bold rotated title; wraps to 2nd column
 *         .fv-book-footer     <- appended only if meta.date is set
 *
 * Both layouts use the new paired color palette (via the .fv-book-pair-N
 * class on the wrapper, set by the caller). Short books read --fv-book-bg-bottom
 * as their single background; long books use both --fv-book-bg-top (pattern
 * zone) and --fv-book-bg-bottom (label zone).
 *
 * Title falls back to card.name when meta.title is absent.
 *
 * Shared between buildCompactItem and buildLibraryItem's no-cover branch.
 */
function populateRichBookContent(book: HTMLElement, card: FolderCard): void {
  const titleStr = (card.meta?.title ?? "").trim() || card.name;
  const words = titleStr.split(/\s+/).filter(Boolean).length;
  const isLong = words >= 4 || titleStr.length >= 25;

  if (isLong) {
    book.classList.add("fv-book-title-len-long");
    // Hash-derived width 75–105px gives the shelf visual variety in the
    // two-zone spines (without it every long-title book would be the same
    // 88px). Picked deterministically so re-renders keep the same width.
    // CSS reads --fv-book-min-width with a fallback to 88px.
    book.style.setProperty("--fv-book-min-width", `${longTitleWidthFor(card)}px`);
    populateTwoZoneContent(book, card, titleStr);
  } else {
    populateClassicSpineContent(book, card, titleStr);
  }
}

/**
 * Classic spine: author / title / (rule + date) flow along the writing axis
 * of the single .fv-book block. Same DOM as the pre-redesign Compact + Library
 * rich-spine; the .fv-book-rule's :nth-child width cycle still drives the
 * spine's apparent width for visual variety.
 *
 * All three child elements ALWAYS render (with empty author / date text when
 * the YAML keys are absent) so the flex space-between geometry keeps the
 * title visually centered regardless of which fields are populated.
 */
function populateClassicSpineContent(book: HTMLElement, card: FolderCard, titleStr: string): void {
  const authorEl = document.createElement("div");
  authorEl.className = "fv-book-author";
  authorEl.textContent = (card.meta?.author ?? "").trim();
  book.appendChild(authorEl);

  const titleEl = document.createElement("div");
  titleEl.className = "fv-book-title";
  titleEl.textContent = titleStr;
  book.appendChild(titleEl);

  const dateEl = document.createElement("div");
  dateEl.className = "fv-book-date";
  const rule = document.createElement("div");
  rule.className = "fv-book-rule";
  dateEl.appendChild(rule);
  const date = (card.meta?.date ?? "").trim();
  if (date) dateEl.appendChild(document.createTextNode(date));
  book.appendChild(dateEl);
}

/**
 * Two-zone enriched layout reserved for long titles. The top zone is a
 * placeholder color block in Phase 1; Phase 2 will inject an SVG pattern
 * into it via patternSlotFor(). Eyebrow + footer rows are conditional —
 * absent fields don't reserve space.
 */
function populateTwoZoneContent(book: HTMLElement, card: FolderCard, titleStr: string): void {
  // The .fv-book-label-zone is now the single container — it carries the
  // pair's bottom color and holds BOTH the pattern (at top) and the text
  // area (filling the rest). The pattern has no background-color of its
  // own; it inherits the label zone's color and overlays the SVG via
  // background-image. This produces a single-color spine with a
  // patterned cap at the top.
  const labelZone = document.createElement("div");
  labelZone.className = "fv-book-label-zone";

  const pattern = document.createElement("div");
  pattern.className = "fv-book-pattern";
  // Per-book pattern slot (1..7) keeps the same book looking the same
  // across re-renders. Set inline as a CSS variable that drives
  // mask-image in bookshelf-css.ts — using mask-image (rather than
  // background-image) lets the visible color come from the element's
  // CSS color/background-color, which we pin to the pair's top color
  // (a curated contrast against the label-zone's bottom color).
  pattern.style.setProperty("--fv-pattern-url", bookshelfPatternUrl(patternSlotFor(card)));
  labelZone.appendChild(pattern);

  // Text area wraps the three text runs so the pattern sits at the top
  // and the text stays centered in the remaining vertical space below.
  const textArea = document.createElement("div");
  textArea.className = "fv-book-text-area";

  const author = (card.meta?.author ?? "").trim();
  if (author) {
    const eyebrowEl = document.createElement("div");
    eyebrowEl.className = "fv-book-eyebrow";
    eyebrowEl.textContent = author;
    textArea.appendChild(eyebrowEl);
  }

  const titleEl = document.createElement("div");
  titleEl.className = "fv-book-title";
  titleEl.textContent = titleStr;
  textArea.appendChild(titleEl);

  const date = (card.meta?.date ?? "").trim();
  if (date) {
    const footerEl = document.createElement("div");
    footerEl.className = "fv-book-footer";
    footerEl.textContent = date;
    textArea.appendChild(footerEl);
  }

  labelZone.appendChild(textArea);
  book.appendChild(labelZone);
}

/**
 * Build a placeholder cover-box for items in Covers mode without a `cover:`
 * YAML key. A 2:3 portrait rectangle filled with the color-slot bright color,
 * with the title text centered. Title falls back to card.name (filename) when
 * no `meta.title` is set. Cover images themselves never get text overlay —
 * the user-provided art already contains the title.
 */
function buildPlaceholder(card: FolderCard): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "fv-book-placeholder";

  const title = document.createElement("div");
  title.className = "fv-book-placeholder-title";
  title.textContent = (card.meta?.title ?? "").trim() || card.name;
  placeholder.appendChild(title);

  return placeholder;
}

/**
 * Wrap inner content in a clickable .fv-book element. The color slot lives
 * on the wrapper so placeholders (in Covers mode) inherit via descendant
 * selectors (.fv-book.fv-book-color-N .fv-book-placeholder).
 */
function buildBookWrapper(card: FolderCard, inner: HTMLElement): HTMLElement {
  const book = document.createElement("div");
  book.className = `fv-book fv-book-color-${colorSlotFor(card)}`;
  book.setAttribute("role", "button");
  book.setAttribute("tabindex", "0");
  book.setAttribute("aria-label", card.name);
  book.title = card.name;
  book.appendChild(inner);
  attachClickHandlers(book, card);
  return book;
}

/**
 * Library item: cover img when available, otherwise the two-zone rich-spine
 * fallback (shared with Compact via populateRichBookContent). On cover-image
 * error the book is converted in-place to the rich-content fallback.
 *
 * The pair-N class is added only when the rich-spine path is taken (no cover
 * OR cover failed); the cover branch keeps just `.fv-book-color-N` so the
 * existing cover-image styling and Library covers placeholder behavior are
 * unaffected.
 */
function buildLibraryItem(card: FolderCard, folderPath: string): HTMLElement {
  const book = document.createElement("div");
  book.className = `fv-book fv-book-color-${colorSlotFor(card)}`;
  book.setAttribute("role", "button");
  book.setAttribute("tabindex", "0");
  book.setAttribute("aria-label", card.name);
  book.title = card.name;

  const cover = (card.meta?.cover ?? "").trim();
  if (cover) {
    const img = document.createElement("img");
    img.className = "fv-book-cover";
    img.alt = card.name;
    img.src = resolveAssetSrc(cover, folderPath);
    img.addEventListener("error", () => {
      // Replace the broken img with the rich-content fallback in-place.
      // Tag the wrapper with the pair slot before populating so the
      // two-zone backgrounds resolve correctly.
      book.removeChild(img);
      book.classList.add(`fv-book-pair-${pairSlotFor(card)}`);
      populateRichBookContent(book, card);
    });
    book.appendChild(img);
  } else {
    book.classList.add(`fv-book-pair-${pairSlotFor(card)}`);
    populateRichBookContent(book, card);
  }

  attachClickHandlers(book, card);
  return book;
}

/**
 * Compact item: a .fv-book wrapper with the two-zone rich-spine content.
 * See populateRichBookContent for DOM structure. The pair-N class supplies
 * the top/bottom backgrounds and the foreground color via CSS variables
 * defined in src/styles.css.
 */
function buildCompactItem(card: FolderCard): HTMLElement {
  const book = document.createElement("div");
  book.className = `fv-book fv-book-color-${colorSlotFor(card)} fv-book-pair-${pairSlotFor(card)}`;
  book.setAttribute("role", "button");
  book.setAttribute("tabindex", "0");
  book.setAttribute("aria-label", card.name);
  book.title = card.name;
  populateRichBookContent(book, card);
  attachClickHandlers(book, card);
  return book;
}

/** Covers-mode item: cover img if available, placeholder otherwise. */
function buildCoverBoxItem(card: FolderCard, folderPath: string): HTMLElement {
  const cover = (card.meta?.cover ?? "").trim();
  if (!cover) return buildBookWrapper(card, buildPlaceholder(card));
  const img = document.createElement("img");
  img.className = "fv-book-cover";
  img.alt = card.name;
  img.src = resolveAssetSrc(cover, folderPath);
  img.addEventListener("error", () => {
    if (img.parentNode) img.parentNode.replaceChild(buildPlaceholder(card), img);
  });
  return buildBookWrapper(card, img);
}

// ── Shelf grouping + YAML enrichment ────────────────────────────────────────

/**
 * Group cards by a YAML key value. Empty groupBy → one ungrouped collection.
 * Missing/empty values bucket into "Uncategorized" (always sorted last).
 */
function groupCards(
  cards: FolderCard[],
  groupBy: string | undefined,
): Array<{ key: string | null; items: FolderCard[] }> {
  if (!groupBy || !groupBy.trim()) {
    return [{ key: null, items: cards }];
  }
  const map = new Map<string, FolderCard[]>();
  for (const c of cards) {
    const v = (c.meta?.[groupBy] ?? "").trim();
    const key = v || "Uncategorized";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "Uncategorized") return 1;
      if (b === "Uncategorized") return -1;
      return a.toLowerCase().localeCompare(b.toLowerCase());
    })
    .map(([key, items]) => ({ key, items }));
}

/**
 * Read frontmatter values into `card.meta` for the keys Bookshelf cares about:
 * `cover`, `author`, `title`, `date`, plus the dynamic `groupBy` key when set.
 * Non-md cards are skipped (no frontmatter to read).
 */
async function enrichBookshelfMeta(
  cards: FolderCard[],
  groupBy: string | undefined,
): Promise<void> {
  const mdCards = cards.filter((c) => c.kind === "file" && c.ext === ".md");
  const wantedKeys = new Set(["cover", "author", "title", "date"]);
  if (groupBy && groupBy.trim()) wantedKeys.add(groupBy.trim());

  await Promise.all(mdCards.map(async (card) => {
    const r = await readFile(card.path);
    if (!r.ok) return;
    const text = r.value;
    if (!text.startsWith("---")) return;
    const lines = text.split("\n");
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") { endIdx = i; break; }
    }
    if (endIdx === -1) return;
    const fm = parseYamlLines(lines.slice(1, endIdx));
    const meta: Record<string, string> = card.meta ?? {};
    for (const key of wantedKeys) {
      const v = fm[key];
      if (typeof v === "string") meta[key] = v;
    }
    card.meta = meta;
  }));
}

// ── Shelf rendering ──────────────────────────────────────────────────────────

/** Loading skeleton shown while frontmatter reads complete. */
function renderSkeleton(root: HTMLElement, count: number): void {
  root.innerHTML = "";
  const shelf = document.createElement("div");
  shelf.className = "fv-shelf fv-bookshelf-loading";
  const row = document.createElement("div");
  row.className = "fv-shelf-row";
  const skeletons = Math.min(Math.max(count, 1), 8);
  for (let i = 0; i < skeletons; i++) {
    const ph = document.createElement("div");
    ph.className = "fv-book fv-book-skeleton";
    row.appendChild(ph);
  }
  shelf.appendChild(row);
  const rail = document.createElement("div");
  rail.className = "fv-shelf-rail";
  shelf.appendChild(rail);
  root.appendChild(shelf);
}

function emptyState(root: HTMLElement): void {
  const empty = document.createElement("div");
  empty.className = "folder-view-empty";
  empty.textContent = "No files in this folder.";
  root.appendChild(empty);
}

/** Append one shelf (heading + row + rail) to `root`. */
function appendShelf(
  root: HTMLElement,
  key: string | null,
  items: FolderCard[],
  itemBuilder: (card: FolderCard) => HTMLElement,
  perShelfClass?: string,
): void {
  const shelf = document.createElement("div");
  shelf.className = "fv-shelf";
  if (perShelfClass) shelf.classList.add(perShelfClass);

  if (key !== null) {
    const heading = document.createElement("div");
    heading.className = "fv-shelf-heading";
    heading.textContent = key;
    shelf.appendChild(heading);
  }

  const row = document.createElement("div");
  row.className = "fv-shelf-row";
  for (const card of items) row.appendChild(itemBuilder(card));
  shelf.appendChild(row);

  const rail = document.createElement("div");
  rail.className = "fv-shelf-rail";
  shelf.appendChild(rail);

  root.appendChild(shelf);
}

// ── Sub-renderers (one per option) ───────────────────────────────────────────

/**
 * Width budget per Library shelf row. Used by chunkLibrary() to decide
 * when to start a new shelf instead of overflowing. Chosen for typical
 * Markable content widths (~700–900px usable after the row's padding).
 */
const LIBRARY_ROW_BUDGET = 750;
/** Estimated width of a cover item (2:3 at the shared --library-book-h ≈ 280px → ~187px). */
const LIBRARY_COVER_W = 187;
/** Estimated width of a rich-spine item (average of the 5 :nth-child rule widths). */
const LIBRARY_SPINE_W = 45;
/** Gap between items on a Library row (matches CSS). */
const LIBRARY_GAP = 16;

/**
 * Width-aware chunking. Walks the items in order; each new item gets either
 * appended to the current shelf or starts a new shelf if doing so would
 * exceed LIBRARY_ROW_BUDGET. Cover items take ~187px, rich-spine items ~45px.
 * Honors at least one item per shelf so a huge item doesn't loop forever.
 */
function chunkLibrary(items: FolderCard[]): FolderCard[][] {
  if (items.length === 0) return [[]];
  const chunks: FolderCard[][] = [[]];
  let currentWidth = 0;

  for (const item of items) {
    const itemWidth = (item.meta?.cover ?? "").trim() ? LIBRARY_COVER_W : LIBRARY_SPINE_W;
    const last = chunks[chunks.length - 1];
    const projected = currentWidth + (last.length === 0 ? itemWidth : LIBRARY_GAP + itemWidth);

    if (projected > LIBRARY_ROW_BUDGET && last.length > 0) {
      chunks.push([item]);
      currentWidth = itemWidth;
    } else {
      last.push(item);
      currentWidth = projected;
    }
  }
  return chunks;
}

/** Library: cover-or-rich-spine per book on sibling-z-index shelves. Each
 *  group is width-chunked into shelves; new shelves spawn when items would
 *  exceed the row budget. Heading appears on the first shelf of each group. */
function renderLibrary(
  root: HTMLElement,
  cards: FolderCard[],
  config: FolderViewConfig,
  folderPath: string,
): void {
  root.innerHTML = "";

  const files = cards.filter((c) => c.kind === "file");
  if (files.length === 0) { emptyState(root); return; }

  sortCards(files, config.sort);
  const groups = groupCards(files, config.groupBy);

  // Total physical shelves after chunking — drives the count-aware CSS.
  const totalShelves = groups.reduce(
    (sum, g) => sum + Math.max(1, chunkLibrary(g.items).length),
    0,
  );
  root.setAttribute("data-shelf-count", String(Math.min(totalShelves, 4)));

  for (const { key, items } of groups) {
    const chunks = chunkLibrary(items);
    chunks.forEach((chunkItems, idx) => {
      appendShelf(
        root,
        idx === 0 ? key : null,  // heading on the FIRST shelf of each group only
        chunkItems,
        (card) => buildLibraryItem(card, folderPath),
      );
    });
  }
}

/** Compact: every item is a spine; same count-aware shelf heights as library. */
function renderCompact(
  root: HTMLElement,
  cards: FolderCard[],
  config: FolderViewConfig,
  _folderPath: string,
): void {
  root.innerHTML = "";

  const files = cards.filter((c) => c.kind === "file");
  if (files.length === 0) { emptyState(root); return; }

  sortCards(files, config.sort);
  const groups = groupCards(files, config.groupBy);

  root.setAttribute("data-shelf-count", String(Math.min(groups.length, 4)));

  for (const { key, items } of groups) {
    appendShelf(root, key, items, buildCompactItem);
  }
}

/**
 * Cap on books per Covers shelf. Anything beyond this overflows to a new
 * shelf with its own rail (so you never get a long horizontal scrollbar).
 * Tuned to fit comfortably at typical Markable content widths (~700–900px):
 * 4 × 187px covers (2:3 at 280 tall) + 3 × 16px gaps ≈ 796px.
 */
const COVERS_PER_SHELF = 4;

/** Slice an array into chunks of at most `size` elements. Empty in → [[]]. */
function chunkItems<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Covers: every item is a cover-box (image or placeholder). Groups split
 *  into multiple shelves of COVERS_PER_SHELF each — no horizontal scroll. */
function renderCoversMode(
  root: HTMLElement,
  cards: FolderCard[],
  config: FolderViewConfig,
  folderPath: string,
): void {
  root.innerHTML = "";

  const files = cards.filter((c) => c.kind === "file");
  if (files.length === 0) { emptyState(root); return; }

  sortCards(files, config.sort);
  const groups = groupCards(files, config.groupBy);

  // Total number of physical shelves rendered, after chunking each group.
  const totalShelves = groups.reduce(
    (sum, g) => sum + Math.max(1, Math.ceil(g.items.length / COVERS_PER_SHELF)),
    0,
  );
  root.setAttribute("data-shelf-count", String(Math.min(totalShelves, 4)));

  for (const { key, items } of groups) {
    const chunks = chunkItems(items, COVERS_PER_SHELF);
    chunks.forEach((chunkItems, idx) => {
      // Group heading appears only on the first chunk of the group so a
      // 12-book "Books" group splits into 3 shelves but reads as one section.
      appendShelf(
        root,
        idx === 0 ? key : null,
        chunkItems,
        (card) => buildCoverBoxItem(card, folderPath),
      );
    });
  }
}

const SUB_RENDERERS: Record<
  string,
  (root: HTMLElement, cards: FolderCard[], config: FolderViewConfig, folderPath: string) => void
> = {
  library: renderLibrary,
  compact: renderCompact,
  covers:  renderCoversMode,
};

// ── Public entry point ──────────────────────────────────────────────────────

export function renderFolderBookshelf(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
): void {
  container.innerHTML = "";

  const host = document.createElement("div");
  host.className = "folder-view-host"
    + (config.contentAreaOverride ? "" : " folder-view-host--constrained");
  container.appendChild(host);

  const requested = config.displayOption ?? "compact";
  const renderingOption = SUB_RENDERERS[requested] ? requested : "compact";

  const root = document.createElement("div");
  root.className = `fv-bookshelf fv-bookshelf--${renderingOption}`;
  host.appendChild(root);

  const visible = applyExcludeFilter(cards, config.exclude);
  if (visible.length === 0) {
    emptyState(host);
    return;
  }

  // Paint a placeholder skeleton synchronously, then read YAML and re-render.
  renderSkeleton(root, visible.length);

  void enrichBookshelfMeta(visible, config.groupBy).then(() => {
    SUB_RENDERERS[renderingOption](root, visible, config, folderPath);
  });
}
