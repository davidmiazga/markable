/**
 * table-renderer.ts — Compact sortable table renderer for the "folder-table" layout.
 *
 * Exports renderFolderTable(), the FolderLayoutRenderer for the "folder-table"
 * layout. Reuses all _folder.md infrastructure (parser, types, tab opening,
 * lazy loading pattern) and adds only a table-based view with interactive
 * column header sorting.
 *
 * Design decisions:
 *   AD-6: Plain DOM construction — no reactive library or template engine.
 *   FR-25: All colors use CSS custom properties — no hard-coded values.
 *   NFR-07: Rows use role="row", tabindex=0, aria-label, and keyboard handlers.
 *   EC-14: Description body passes through stripScripts() before innerHTML.
 *   EC-13: All user-supplied text is set via .textContent (never .innerHTML).
 *
 * @module folder-view/table-renderer
 */

import type { FolderViewConfig, FolderCard, FolderSortOrder } from "./types";
import { sortCards, getFileIconForCard, formatModified } from "./renderer";
import { ICON_FOLDER } from "../icons/material/index";
import { stripScripts } from "./shared";

// ── Lazy loading ──────────────────────────────────────────────────────────────

const LAZY_BATCH_SIZE = 50;

// ── Row click handler ─────────────────────────────────────────────────────────

function handleRowClick(card: FolderCard): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const fb = (window as any).__MARKABLE_FILE_BROWSER__;

  if (card.kind === "directory") {
    fb?.expandDirectory?.(card.path);
    if (card.hasFolderView) {
      const openFV = (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__;
      openFV?.(card.path);
    }
  } else {
    const lp = card.path.toLowerCase();
    if (lp.endsWith(".md") || lp.endsWith(".txt")) {
      void tabMgr?.openFileInTab?.(card.path);
    } else {
      void tabMgr?.openMediaInTab?.(card.path);
    }
  }
}

// ── Lazy row appender ─────────────────────────────────────────────────────────

/**
 * Append rows to a tbody, lazy-loading batches via IntersectionObserver when
 * the card count exceeds LAZY_BATCH_SIZE.
 *
 * Adapts the appendCardsToGrid pattern from renderer.ts for <tr> elements.
 *
 * @param cards      - All pre-sorted cards for this section.
 * @param tbody      - The <tbody> element to append into.
 * @param buildRow   - Factory: FolderCard → HTMLTableRowElement.
 * @param scrollRoot - Scrollable host element (IntersectionObserver root).
 */
function appendRowsToTbody(
  cards: FolderCard[],
  tbody: HTMLTableSectionElement,
  buildRow: (card: FolderCard) => HTMLTableRowElement,
  scrollRoot: HTMLElement,
): void {
  if (cards.length <= LAZY_BATCH_SIZE) {
    for (const card of cards) tbody.appendChild(buildRow(card));
    return;
  }

  for (const card of cards.slice(0, LAZY_BATCH_SIZE)) tbody.appendChild(buildRow(card));

  let rendered = LAZY_BATCH_SIZE;
  const sentinel = document.createElement("tr");
  sentinel.className = "fv-sentinel-row";
  tbody.appendChild(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    const batch = cards.slice(rendered, rendered + LAZY_BATCH_SIZE);
    for (const card of batch) tbody.insertBefore(buildRow(card), sentinel);
    rendered += batch.length;
    if (rendered >= cards.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }, { root: scrollRoot, rootMargin: "200px 0px" });

  observer.observe(sentinel);
}

// ── Row builders ──────────────────────────────────────────────────────────────

function buildFolderRow(card: FolderCard, config: FolderViewConfig): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "fv-row";
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("aria-label", `Open folder ${card.name}`);

  const iconTd = document.createElement("td");
  iconTd.className = "fv-td fv-td-icon";
  iconTd.innerHTML = ICON_FOLDER;
  tr.appendChild(iconTd);

  const nameTd = document.createElement("td");
  nameTd.className = "fv-td fv-td-name";
  nameTd.textContent = card.name;
  nameTd.title = card.path;
  tr.appendChild(nameTd);

  if (config.showCount) {
    const countTd = document.createElement("td");
    countTd.className = "fv-td fv-td-count";
    countTd.textContent = String(card.childCount ?? 0);
    tr.appendChild(countTd);
  }

  tr.addEventListener("click", () => handleRowClick(card));
  tr.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(card); }
  });

  return tr;
}

function buildFileRow(card: FolderCard, config: FolderViewConfig): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "fv-row";
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("aria-label", `Open file ${card.name}`);

  const iconTd = document.createElement("td");
  iconTd.className = "fv-td fv-td-icon";
  iconTd.innerHTML = getFileIconForCard(card.ext);
  tr.appendChild(iconTd);

  // MD files store only the stem in card.name; add ext back when showing extensions.
  let displayName = card.name;
  if (config.showExtensions && card.ext === ".md") {
    displayName = card.name + card.ext;
  } else if (!config.showExtensions && card.ext && card.ext !== ".md" && card.name.endsWith(card.ext)) {
    displayName = card.name.slice(0, -card.ext.length);
  }

  const nameTd = document.createElement("td");
  nameTd.className = "fv-td fv-td-name";
  nameTd.textContent = displayName;
  nameTd.title = card.path;
  tr.appendChild(nameTd);

  if (config.showExtensions) {
    const extTd = document.createElement("td");
    extTd.className = "fv-td fv-td-ext";
    extTd.textContent = card.ext;
    tr.appendChild(extTd);
  }

  if (config.showModified) {
    const modTd = document.createElement("td");
    modTd.className = "fv-td fv-td-modified";
    modTd.textContent = card.modified > 0 ? formatModified(card.modified) : "—";
    tr.appendChild(modTd);
  }

  if (config.showTags) {
    const tagsTd = document.createElement("td");
    tagsTd.className = "fv-td fv-td-tags";
    if (card.tags && card.tags.length > 0) {
      for (const tag of card.tags) {
        const chip = document.createElement("span");
        chip.className = "folder-view-tag-chip";
        chip.textContent = tag;
        chip.title = tag;
        tagsTd.appendChild(chip);
      }
    }
    tr.appendChild(tagsTd);
  }

  tr.addEventListener("click", () => handleRowClick(card));
  tr.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(card); }
  });

  return tr;
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

function parseSortOrder(sort: FolderSortOrder): { col: "name" | "modified"; dir: "asc" | "desc" } {
  if (sort === "modified-asc")  return { col: "modified", dir: "asc" };
  if (sort === "modified-desc") return { col: "modified", dir: "desc" };
  if (sort === "name-desc")     return { col: "name",     dir: "desc" };
  return { col: "name", dir: "asc" };
}

// ── Section table builder ─────────────────────────────────────────────────────

/**
 * Build a section element (optional heading + sortable table).
 *
 * Manages interactive sort state in a closure: sortCol and sortDir initialise
 * from config.sort (folders are name-only; files support name and modified).
 * Clicking a header column toggles direction (same column) or resets to asc
 * (different column). rebuildTbody() clears and repopulates the tbody on sort.
 *
 * Length justification: sort state, header construction, header event wiring,
 * conditional columns, and tbody population are all tightly coupled through
 * the shared sortCol/sortDir mutable closure. Splitting into sub-functions
 * would require threading 5+ variables across boundaries with no clarity gain.
 *
 * @param title   - Section heading text, or null to omit.
 * @param cards   - Pre-filtered cards for this section (unsorted copy is made internally).
 * @param config  - FolderViewConfig for column visibility flags.
 * @param host    - The .folder-view-host element (IntersectionObserver root).
 * @param isFiles - true → file columns; false → folder columns.
 */
function buildSectionTable(
  title: string | null,
  cards: FolderCard[],
  config: FolderViewConfig,
  host: HTMLElement,
  isFiles: boolean,
): HTMLElement {
  const { col: initCol, dir: initDir } = parseSortOrder(config.sort);
  // Folders only sort by name; if config had a modified sort, default to asc-name.
  let sortCol = (isFiles ? initCol : "name") as "name" | "modified" | "ext";
  let sortDir: "asc" | "desc"              = isFiles ? initDir : (initCol === "name" ? initDir : "asc");

  const section = document.createElement("div");
  section.className = "folder-view-section";

  if (title) {
    const h3 = document.createElement("h3");
    h3.className = "folder-view-section-title";
    h3.textContent = title;
    section.appendChild(h3);
  }

  const table = document.createElement("table");
  table.className = "fv-table";

  // ── thead ─────────────────────────────────────────────────────────────────

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const iconTh = document.createElement("th");
  iconTh.className = "fv-th fv-th-icon";
  headerRow.appendChild(iconTh);

  const nameTh = document.createElement("th");
  nameTh.className = "fv-th fv-th-name";
  nameTh.textContent = "Name";
  if (sortCol === "name") nameTh.classList.add(`fv-sorted-${sortDir}`);
  headerRow.appendChild(nameTh);

  let extTh: HTMLTableCellElement | null = null;
  let modTh: HTMLTableCellElement | null = null;

  if (isFiles) {
    if (config.showExtensions) {
      extTh = document.createElement("th");
      extTh.className = "fv-th fv-th-ext";
      extTh.textContent = "Type";
      if (sortCol === "ext") extTh.classList.add(`fv-sorted-${sortDir}`);
      headerRow.appendChild(extTh);
    }
    if (config.showModified) {
      modTh = document.createElement("th");
      modTh.className = "fv-th fv-th-modified";
      modTh.textContent = "Modified";
      if (sortCol === "modified") modTh.classList.add(`fv-sorted-${sortDir}`);
      headerRow.appendChild(modTh);
    }
    if (config.showTags) {
      const tagsTh = document.createElement("th");
      tagsTh.className = "fv-th fv-th-tags";
      tagsTh.textContent = "Tags";
      headerRow.appendChild(tagsTh);
    }
  } else {
    if (config.showCount) {
      const countTh = document.createElement("th");
      countTh.className = "fv-th fv-th-count";
      countTh.textContent = "Items";
      headerRow.appendChild(countTh);
    }
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // ── tbody + sort logic ────────────────────────────────────────────────────

  const tbody = document.createElement("tbody");
  tbody.className = "fv-tbody";

  const workingCards = [...cards];

  const applySort = (): void => {
    if (sortCol === "ext") {
      const dir = sortDir === "asc" ? 1 : -1;
      workingCards.sort((a, b) => {
        const cmp = dir * a.ext.localeCompare(b.ext);
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
    } else {
      sortCards(workingCards, `${sortCol}-${sortDir}` as FolderSortOrder);
    }
  };

  const buildRow = isFiles
    ? (card: FolderCard) => buildFileRow(card, config)
    : (card: FolderCard) => buildFolderRow(card, config);

  const clearIndicators = (): void => {
    nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
    if (extTh) extTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
    if (modTh) modTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  };

  const rebuildTbody = (): void => {
    tbody.innerHTML = "";
    applySort();
    appendRowsToTbody(workingCards, tbody, buildRow, host);
  };

  applySort();
  appendRowsToTbody(workingCards, tbody, buildRow, host);

  // ── Header sort wiring ────────────────────────────────────────────────────

  nameTh.addEventListener("click", () => {
    sortDir = sortCol === "name" ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    sortCol = "name";
    clearIndicators();
    nameTh.classList.add(`fv-sorted-${sortDir}`);
    rebuildTbody();
  });

  if (extTh) {
    const _extTh = extTh;
    _extTh.addEventListener("click", () => {
      sortDir = sortCol === "ext" ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      sortCol = "ext";
      clearIndicators();
      _extTh.classList.add(`fv-sorted-${sortDir}`);
      rebuildTbody();
    });
  }

  if (modTh) {
    const _modTh = modTh;
    _modTh.addEventListener("click", () => {
      sortDir = sortCol === "modified" ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      sortCol = "modified";
      clearIndicators();
      _modTh.classList.add(`fv-sorted-${sortDir}`);
      rebuildTbody();
    });
  }

  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

// ── Public renderer ───────────────────────────────────────────────────────────

/**
 * Render the folder-table layout into the given container.
 *
 * This is the FolderLayoutRenderer for the "folder-table" layout (FR-28).
 * Reuses all existing _folder.md config fields with no new YAML additions.
 *
 * Length justification: mirrors renderFolderCards() — two distinct sections
 * (subfolders, files), each requiring exclude filtering, sort init, and
 * conditional render. All per-section work is delegated to buildSectionTable().
 *
 * @param config      - Validated FolderViewConfig from parseFolderMd().
 * @param cards       - Immediate children from collectChildren() (unsorted).
 * @param container   - The DOM element to render into (cleared on entry).
 * @param _folderPath - Absolute path of the folder (satisfies FolderLayoutRenderer contract).
 */
export function renderFolderTable(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
): void {
  container.innerHTML = "";

  const host = document.createElement("div");
  host.className = "folder-view-host";
  if (!config.contentAreaOverride) host.classList.add("folder-view-host--constrained");

  if (config.body.trim()) {
    const desc = document.createElement("div");
    desc.className = "folder-view-description";
    const renderMd = (window as any).__MARKABLE_RENDER_MD__ as ((md: string) => string) | undefined;
    if (renderMd) {
      desc.innerHTML = stripScripts(renderMd(config.body));
    } else {
      desc.textContent = config.body;
    }
    host.appendChild(desc);
  }

  const excludeSet = new Set(config.exclude);
  const visibleCards = excludeSet.size > 0
    ? cards.filter(c => {
        const filename = c.ext === ".md" ? c.name + ".md" : c.name;
        return !excludeSet.has(filename);
      })
    : cards;

  const dirCards  = visibleCards.filter(c => c.kind === "directory");
  const fileCards = visibleCards.filter(c => c.kind === "file");

  const showDirs  = config.showFolders && dirCards.length > 0;
  const showFiles = config.showFiles   && fileCards.length > 0;

  if (!showDirs && !showFiles) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "This folder is empty.";
    host.appendChild(empty);
    container.appendChild(host);
    return;
  }

  if (showDirs) {
    host.appendChild(
      buildSectionTable(config.foldersTitle || null, dirCards, config, host, false),
    );
  }
  if (showFiles) {
    host.appendChild(
      buildSectionTable(config.filesTitle || null, fileCards, config, host, true),
    );
  }

  container.appendChild(host);
}
