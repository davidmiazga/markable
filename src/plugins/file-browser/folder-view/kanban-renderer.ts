/**
 * kanban-renderer.ts — Column board renderer for the "folder-kanban" layout.
 *
 * Only .md files that explicitly have the kanban-field set to a non-empty value
 * are shown. Images, non-.md files, and files without the field are excluded.
 * Column order follows kanban-order: if set, otherwise alphabetical.
 *
 * Requires `kanban-field:` in _folder.md. Without it, shows a notice.
 * Frontmatter enrichment is auto-wired by parser.ts (the field is injected into
 * config.extraFields so tab.ts enrichment runs and populates card.meta).
 *
 * @module folder-view/kanban-renderer
 */

import type { FolderViewConfig, FolderCard } from "./types";
import { applyExcludeFilter } from "./shared";
import { buildListRow } from "./list-renderer";

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderFolderKanban(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
): void {
  container.innerHTML = "";
  const host = document.createElement("div");
  host.className = "folder-view-host"
    + (config.contentAreaOverride ? "" : " folder-view-host--constrained");
  container.appendChild(host);

  if (!config.kanbanField) {
    const notice = document.createElement("div");
    notice.className = "folder-view-fallback-notice";
    notice.textContent = "folder-kanban requires a kanban-field: setting in _folder.md.";
    host.appendChild(notice);
    return;
  }

  const field = config.kanbanField;

  // Only .md files with a non-empty value for kanban-field are shown.
  // Images and other non-.md files never carry frontmatter and are excluded.
  // Files that don't have the field set are also excluded — the kanban is
  // opt-in per file, not a catch-all for the whole folder.
  const visible = applyExcludeFilter(cards, config.exclude)
    .filter(c => c.kind === "file" && c.ext === ".md")
    .filter(c => (c.meta?.[field] ?? "").trim() !== "");

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = `No files with a "${field}:" field found in this folder.`;
    host.appendChild(empty);
    return;
  }

  // Group by field value
  const columnMap = new Map<string, FolderCard[]>();
  for (const card of visible) {
    const value = card.meta![field].trim();
    if (!columnMap.has(value)) columnMap.set(value, []);
    columnMap.get(value)!.push(card);
  }

  // Determine column order: explicit kanban-order first, then remaining alphabetically
  let orderedKeys: string[];
  if (config.kanbanOrder && config.kanbanOrder.length > 0) {
    const listed = config.kanbanOrder.filter(k => columnMap.has(k));
    const rest   = [...columnMap.keys()]
      .filter(k => !config.kanbanOrder!.includes(k))
      .sort((a, b) => a.localeCompare(b));
    orderedKeys = [...listed, ...rest];
  } else {
    orderedKeys = [...columnMap.keys()].sort((a, b) => a.localeCompare(b));
  }

  // Render board
  const board = document.createElement("div");
  board.className = "fv-kanban-board";
  host.appendChild(board);

  for (const key of orderedKeys) {
    const colCards = columnMap.get(key)!;
    const col = document.createElement("div");
    col.className = "fv-kanban-col";

    const header = document.createElement("div");
    header.className = "fv-kanban-col-header";

    const titleEl = document.createElement("span");
    titleEl.className = "fv-kanban-col-title";
    titleEl.textContent = key;
    header.appendChild(titleEl);

    const count = document.createElement("span");
    count.className = "fv-kanban-col-count";
    count.textContent = String(colCards.length);
    header.appendChild(count);

    col.appendChild(header);
    colCards.forEach(c => col.appendChild(buildListRow(c, config)));
    board.appendChild(col);
  }
}
