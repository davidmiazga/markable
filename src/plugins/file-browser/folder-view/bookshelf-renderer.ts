/**
 * bookshelf-renderer.ts — Bookshelf display for the Select codefence.
 *
 * Renders a folder's files as horizontal shelves of book-like items. Each item
 * shows its cover (from YAML `cover:`) when set; otherwise a stylized spine
 * with the title (and optional `author:`).
 *
 * Three options dispatch from the same entry point:
 *
 *   - `covers` (Phase 2 default): minimal shelf with mixed covers and spines.
 *   - `library` (Phase 3): curated pastel spines with index counters.
 *   - `compact` (Phase 3): dense rack of small spines.
 *
 * Phase 2 ships only the `covers` renderer; library and compact fall back to it.
 *
 * Because Bookshelf reads arbitrary YAML keys (`cover`, `author`, and any
 * user-chosen `group-by` key), it cannot rely on the synchronous vault index.
 * The renderer paints a placeholder skeleton immediately, then asynchronously
 * reads frontmatter from each visible .md file and re-renders with real data.
 */

import type { FolderViewConfig, FolderCard } from "./types";
import { sortCards } from "./renderer";
import { applyExcludeFilter } from "./shared";
import { parseYamlLines } from "./parser";
import { readFile } from "../../../lib/bridge";
import { resolveAssetSrc } from "../../../lib/layout-manager";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/** Build the spine fallback element for a book with no cover. */
function buildSpine(card: FolderCard): HTMLElement {
  const spine = document.createElement("div");
  spine.className = "fv-book-spine";

  const title = document.createElement("div");
  title.className = "fv-book-title";
  title.textContent = card.name;
  spine.appendChild(title);

  const author = (card.meta?.author ?? "").trim();
  if (author) {
    const authorEl = document.createElement("div");
    authorEl.className = "fv-book-author";
    authorEl.textContent = author;
    spine.appendChild(authorEl);
  }
  return spine;
}

/**
 * Build one book element — cover image when `card.meta.cover` is set, spine
 * fallback otherwise. A broken cover path swaps to a spine via `onerror`.
 */
function buildBookItem(card: FolderCard, folderPath: string): HTMLElement {
  const book = document.createElement("div");
  book.className = "fv-book";
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
      const spine = buildSpine(card);
      if (img.parentNode === book) book.replaceChild(spine, img);
    });
    book.appendChild(img);
  } else {
    book.appendChild(buildSpine(card));
  }
  attachClickHandlers(book, card);
  return book;
}

/**
 * Group cards by a YAML frontmatter key value. Empty groupBy → single
 * ungrouped collection. Missing/empty values bucket into "Uncategorized"
 * which is always sorted last.
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
 * Read the `cover`, `author`, and (if set) the `groupBy` key from each .md
 * card's frontmatter and merge into `card.meta`. Other cards are skipped.
 */
async function enrichBookshelfMeta(
  cards: FolderCard[],
  groupBy: string | undefined,
): Promise<void> {
  const mdCards = cards.filter((c) => c.kind === "file" && c.ext === ".md");
  const wantedKeys = new Set(["cover", "author"]);
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

/** Render the loading skeleton shown while frontmatter is being read. */
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

/** Render the real shelves into `root`. Replaces any prior content. */
function renderCovers(
  root: HTMLElement,
  cards: FolderCard[],
  config: FolderViewConfig,
  folderPath: string,
): void {
  root.innerHTML = "";

  // Bookshelf shows file cards only — directories aren't books.
  const files = cards.filter((c) => c.kind === "file");
  if (files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "No files in this folder.";
    root.appendChild(empty);
    return;
  }

  sortCards(files, config.sort);
  const groups = groupCards(files, config.groupBy);

  for (const { key, items } of groups) {
    const shelf = document.createElement("div");
    shelf.className = "fv-shelf";

    if (key !== null) {
      const heading = document.createElement("div");
      heading.className = "fv-shelf-heading";
      heading.textContent = key;
      shelf.appendChild(heading);
    }

    const row = document.createElement("div");
    row.className = "fv-shelf-row";
    for (const card of items) {
      row.appendChild(buildBookItem(card, folderPath));
    }
    shelf.appendChild(row);

    const rail = document.createElement("div");
    rail.className = "fv-shelf-rail";
    shelf.appendChild(rail);

    root.appendChild(shelf);
  }
}

// ── Renderer ─────────────────────────────────────────────────────────────────

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

  // Library and compact are Phase 3; fall back to covers so the pill is still
  // selectable without breaking the renderer.
  const requested = config.displayOption ?? "covers";
  const renderingOption = requested === "library" || requested === "compact"
    ? "covers"
    : requested;

  const root = document.createElement("div");
  root.className = `fv-bookshelf fv-bookshelf--${renderingOption}`;
  host.appendChild(root);

  const visible = applyExcludeFilter(cards, config.exclude);
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "No files in this folder.";
    host.appendChild(empty);
    return;
  }

  // Paint a placeholder skeleton synchronously, then read YAML and re-render.
  renderSkeleton(root, visible.length);

  void enrichBookshelfMeta(visible, config.groupBy).then(() => {
    renderCovers(root, visible, config, folderPath);
  });
}
