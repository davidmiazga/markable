/**
 * timeline-renderer.ts — Date-grouped feed renderer for the "folder-timeline" layout.
 *
 * Files are grouped by recency: Today, Yesterday, This Week, This Month, Older.
 * Directories are shown in a separate Folders section above the timeline (optional).
 * Each file renders as a compact list row (same style as folder-list).
 *
 * Always sorted by `modified` descending — the sort: config field is ignored
 * because temporal ordering is the defining characteristic of a timeline.
 *
 * @module folder-view/timeline-renderer
 */

import type { FolderViewConfig, FolderCard } from "./types";
import { applyExcludeFilter } from "./shared";
import { sortCards } from "./renderer";
import { buildListRow } from "./list-renderer";
import { buildPreviewPane, attachPaneResizeHandle } from "./preview-pane";
import type { PreviewPaneHandle } from "./preview-pane";

// ── Time group logic ──────────────────────────────────────────────────────────

const MS_DAY = 86_400_000;

type TimeGroup = "Today" | "Yesterday" | "This Week" | "This Month" | "Older";
const GROUP_ORDER: TimeGroup[] = ["Today", "Yesterday", "This Week", "This Month", "Older"];

function getTimeGroup(ms: number, nowMs: number): TimeGroup {
  const now  = new Date(nowMs);
  // Start of today (midnight local time)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yestStart  = todayStart - MS_DAY;
  const weekStart  = todayStart - 6 * MS_DAY;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  if (ms >= todayStart)  return "Today";
  if (ms >= yestStart)   return "Yesterday";
  if (ms >= weekStart)   return "This Week";
  if (ms >= monthStart)  return "This Month";
  return "Older";
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderFolderTimeline(
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

  // Optional folders section above the timeline
  if (config.showFolders) {
    const dirs = visible.filter(c => c.kind === "directory");
    if (dirs.length > 0) {
      sortCards(dirs, config.sort);
      const section = document.createElement("div");
      section.className = "folder-view-section";
      const h = document.createElement("div");
      h.className = "folder-view-section-title";
      h.textContent = config.foldersTitle || "Folders";
      section.appendChild(h);
      dirs.forEach(c => section.appendChild(buildListRow(c, config, onSelect)));
      contentTarget.appendChild(section);
    }
  }

  if (!config.showFiles) return;

  const files = visible.filter(c => c.kind === "file");
  // Timeline always sorted by modified desc
  files.sort((a, b) => b.modified - a.modified);

  const now = Date.now();
  const grouped = new Map<TimeGroup, FolderCard[]>(GROUP_ORDER.map(g => [g, []]));

  for (const card of files) {
    const g = card.modified > 0 ? getTimeGroup(card.modified, now) : "Older";
    grouped.get(g)!.push(card);
  }

  const track = document.createElement("div");
  track.className = "fv-timeline-track";
  contentTarget.appendChild(track);

  for (const group of GROUP_ORDER) {
    const groupCards = grouped.get(group)!;
    if (groupCards.length === 0) continue;

    const section = document.createElement("div");
    section.className = "fv-timeline-group";

    const heading = document.createElement("div");
    heading.className = "fv-timeline-heading";
    const label = document.createElement("span");
    label.className = "fv-timeline-label";
    label.textContent = group;
    heading.appendChild(label);
    section.appendChild(heading);

    const rows = document.createElement("div");
    rows.className = "fv-timeline-rows";
    groupCards.forEach(c => rows.appendChild(buildListRow(c, config, onSelect)));
    section.appendChild(rows);

    track.appendChild(section);
  }
}
