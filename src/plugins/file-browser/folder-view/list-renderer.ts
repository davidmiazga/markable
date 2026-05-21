/**
 * list-renderer.ts — Compact single-column list renderer for the "folder-list" layout.
 *
 * Exports renderFolderListInternal() and buildListRow() (reused by timeline-renderer
 * and kanban-renderer). Each file/folder renders as one horizontal row: icon, name,
 * optional tags, optional modified date.
 *
 * After May 2026, List is no longer a top-level Select display. It's reachable via
 * `display: table, option: simple-list` and via the standalone Folder-View tab
 * codepath (`tab.ts` LAYOUT_RENDERERS for `view-list` / `folder-list`).
 *
 * @module folder-view/list-renderer
 */

import type { FolderViewConfig, FolderCard } from "./types";
import { sortCards, getFileIconForCard, formatModified } from "./renderer";
import { applyExcludeFilter } from "./shared";
import { ICON_FOLDER } from "../icons/material/index";
import { buildPreviewPane, attachPaneResizeHandle } from "./preview-pane";
import type { PreviewPaneHandle } from "./preview-pane";

// ── Click handler ─────────────────────────────────────────────────────────────

function openCard(card: FolderCard): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const fb     = (window as any).__MARKABLE_FILE_BROWSER__;
  if (card.kind === "directory") {
    fb?.expandDirectory?.(card.path);
    if (card.hasFolderView) {
      (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__?.(card.path);
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

// ── Row builder (exported for reuse by timeline-renderer and kanban-renderer) ──

/**
 * Build one `.fv-list-row` element for a card.
 *
 * Exported so timeline-renderer.ts and kanban-renderer.ts can reuse the same
 * row layout without duplicating the DOM construction logic.
 */
export function buildListRow(
  card: FolderCard,
  config: FolderViewConfig,
  onSelect?: (card: FolderCard, el: HTMLElement) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "fv-list-row";
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-label", card.name);

  // Icon
  const iconEl = document.createElement("span");
  iconEl.className = "fv-list-icon";
  iconEl.innerHTML = card.kind === "directory" ? ICON_FOLDER : getFileIconForCard(card.ext);
  row.appendChild(iconEl);

  const nameEl = document.createElement("span");
  nameEl.className = "fv-list-name";
  // Always show the file extension. .md files are stored as stems so append
  // the extension explicitly; all other files already include it in card.name.
  const displayName = (card.kind === "file" && card.ext === ".md")
    ? card.name + ".md"
    : card.name;
  nameEl.textContent = displayName;
  row.appendChild(nameEl);

  // Tag chips (optional)
  if (config.showTags && card.tags && card.tags.length > 0) {
    const tagsEl = document.createElement("span");
    tagsEl.className = "fv-list-tags";
    card.tags.slice(0, 3).forEach(tag => {
      const chip = document.createElement("span");
      chip.className = "folder-view-tag-chip";
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    });
    row.appendChild(tagsEl);
  }

  // Modified date (optional, right-aligned via flex)
  if (config.showModified && card.modified > 0) {
    const metaEl = document.createElement("span");
    metaEl.className = "fv-list-meta";
    metaEl.textContent = formatModified(card.modified);
    row.appendChild(metaEl);
  }

  if (onSelect && card.kind === "file") {
    row.addEventListener("click", () => onSelect(card, row));
    row.addEventListener("dblclick", () => openCard(card));
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); openCard(card); }
      else if (e.key === " ") { e.preventDefault(); onSelect(card, row); }
    });
  } else {
    row.addEventListener("click", () => openCard(card));
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(card); }
    });
  }

  return row;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderFolderListInternal(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
): void {
  container.innerHTML = "";
  const host = document.createElement("div");
  host.className = "folder-view-host"
    + (config.contentAreaOverride ? "" : " folder-view-host--constrained");
  container.appendChild(host);

  let contentTarget: HTMLElement = host;
  let previewHandle: PreviewPaneHandle | null = null;
  let selectedRow: HTMLElement | null = null;

  if (config.previewPane) {
    host.classList.add("fv-host--with-preview");
    host.style.setProperty("--fvp-height", config.previewHeight);
    previewHandle = buildPreviewPane();
    host.appendChild(previewHandle.pane);
    host.appendChild(attachPaneResizeHandle(host, previewHandle.pane));
    const mainWrapper = document.createElement("div");
    mainWrapper.className = "folder-view-main";
    host.appendChild(mainWrapper);
    contentTarget = mainWrapper;
  }

  const onSelect = previewHandle
    ? (card: FolderCard, el: HTMLElement) => {
        selectedRow?.classList.remove("fv-card--selected");
        selectedRow = el;
        el.classList.add("fv-card--selected");
        previewHandle!.update(card);
      }
    : undefined;

  const visible = applyExcludeFilter(cards, config.exclude);
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "No files in this folder.";
    contentTarget.appendChild(empty);
    return;
  }

  const dirs  = visible.filter(c => c.kind === "directory");
  const files = visible.filter(c => c.kind === "file");
  sortCards(dirs,  config.sort);
  sortCards(files, config.sort);

  if (config.showFolders && dirs.length > 0) {
    const section = document.createElement("div");
    section.className = "folder-view-section";
    if (config.foldersTitle) {
      const h = document.createElement("div");
      h.className = "folder-view-section-title";
      h.textContent = config.foldersTitle;
      section.appendChild(h);
    }
    dirs.forEach(c => section.appendChild(buildListRow(c, config, onSelect)));
    contentTarget.appendChild(section);
  }

  if (config.showFiles && files.length > 0) {
    const section = document.createElement("div");
    section.className = "folder-view-section";
    if (config.filesTitle) {
      const h = document.createElement("div");
      h.className = "folder-view-section-title";
      h.textContent = config.filesTitle;
      section.appendChild(h);
    }
    files.forEach(c => section.appendChild(buildListRow(c, config, onSelect)));
    contentTarget.appendChild(section);
  }
}
