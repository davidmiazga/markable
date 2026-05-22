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

/** Bright-palette slot 1..8 (applied to spines AND placeholders). */
function colorSlotFor(card: FolderCard): number {
  return (hashCard(card) % 8) + 1;
}

// widthSlotFor / weightSlotFor / fontSizeSlotFor used to vary the OLD
// .fv-book-spine element (pre-redesign). The new rich-book content uses
// :nth-child width cycling on .fv-book-rule instead. Slots removed.

// ── Item builders ────────────────────────────────────────────────────────────

/**
 * Populate a .fv-book wrapper with the rich-spine content used by Compact
 * AND Library (when no cover). All three children ALWAYS render — empty
 * author/date placeholders keep `justify-content: space-between` consistent
 * so the title stays centered. The .fv-book-rule's :nth-child-cycled width
 * controls the spine's overall width.
 *
 * Shared between buildCompactItem and buildLibraryItem (no-cover branch +
 * cover-error fallback). Title falls back to card.name when meta.title is
 * absent.
 */
function populateRichBookContent(book: HTMLElement, card: FolderCard): void {
  // Author (always rendered, may be empty) — top anchor of flex space-between.
  const authorEl = document.createElement("div");
  authorEl.className = "fv-book-author";
  authorEl.textContent = (card.meta?.author ?? "").trim();
  book.appendChild(authorEl);

  // Title — always populated; falls back to filename stem.
  const titleEl = document.createElement("div");
  titleEl.className = "fv-book-title";
  titleEl.textContent = (card.meta?.title ?? "").trim() || card.name;
  book.appendChild(titleEl);

  // Date — always rendered with the rule decoration. The rule's :nth-child-
  // cycled width controls the spine width (without it spines collapse to the
  // rotated-text line-height). Date text node only added when meta.date set.
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
 * on the wrapper so both spines and placeholders inherit via descendant
 * selectors (.fv-book.fv-book-color-N .fv-book-spine etc.).
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
 * Library item: cover img when available, otherwise the same rich book
 * content as Compact (author/title/date/rule). On cover-image error the
 * book is converted in-place to the rich-content fallback. This lets
 * library shelves mix wide cover-image books and narrow rich-spine books
 * on the same row, all bottom-aligned at the shared --library-book-h.
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
      book.removeChild(img);
      populateRichBookContent(book, card);
    });
    book.appendChild(img);
  } else {
    populateRichBookContent(book, card);
  }

  attachClickHandlers(book, card);
  return book;
}

/**
 * Compact item: a .fv-book wrapper with the rich author/title/date/rule
 * content. See populateRichBookContent for the structure rationale.
 */
function buildCompactItem(card: FolderCard): HTMLElement {
  const book = document.createElement("div");
  book.className = `fv-book fv-book-color-${colorSlotFor(card)}`;
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
