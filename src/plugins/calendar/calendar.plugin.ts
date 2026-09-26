/**
 * Calendar — first-slice diary pack plugin.
 *
 * Month grid in a sidebar panel. Independent of Daily Note's note-linked calendar.
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

const PLUGIN_ID = "calendar";
const PANEL_ID = "calendar-month";
const CSS_ID = "markable-calendar-styles";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

let _year = new Date().getFullYear();
let _month = new Date().getMonth();
let _container: HTMLElement | null = null;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthTitle(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

function buildCells(year: number, month: number): Array<{
  date: Date;
  inMonth: boolean;
}> {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ date: Date; inMonth: boolean }> = [];

  for (let i = 0; i < startPad; i += 1) {
    cells.push({ date: new Date(year, month, i - startPad + 1), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(year, month, day), inMonth: true });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const nextIndex = cells.length - startPad - daysInMonth + 1;
    cells.push({ date: new Date(year, month + 1, nextIndex), inMonth: false });
    if (cells.length >= 42) break;
  }
  return cells;
}

function navigateMonth(delta: number): void {
  const next = new Date(_year, _month + delta, 1);
  _year = next.getFullYear();
  _month = next.getMonth();
  renderMonth();
}

function navigateToToday(): void {
  const today = new Date();
  _year = today.getFullYear();
  _month = today.getMonth();
  renderMonth();
}

function injectCSS(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .cal-root {
      display: flex;
      flex-direction: column;
      padding: 8px;
      font-family: var(--ui-font, system-ui, sans-serif);
      font-size: 12px;
      color: var(--text-color, inherit);
      user-select: none;
    }
    .cal-title {
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      padding: 4px 0 8px;
    }
    .cal-weekdays,
    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .cal-weekday {
      text-align: center;
      padding: 4px 0;
      color: var(--text-secondary, #666);
      font-weight: 600;
    }
    .cal-cell {
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }
    .cal-cell-out {
      color: var(--text-secondary, #999);
      opacity: 0.55;
    }
    .cal-cell-today {
      background: var(--accent-color, #3b82f6);
      color: var(--bg-primary, #fff);
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
}

function renderMonth(): void {
  if (_container === null) return;
  _container.innerHTML = "";

  const today = new Date();
  const root = document.createElement("div");
  root.className = "cal-root";

  const title = document.createElement("div");
  title.className = "cal-title";
  title.textContent = monthTitle(_year, _month);
  root.appendChild(title);

  const weekdays = document.createElement("div");
  weekdays.className = "cal-weekdays";
  for (const label of WEEKDAYS) {
    const el = document.createElement("div");
    el.className = "cal-weekday";
    el.textContent = label;
    weekdays.appendChild(el);
  }
  root.appendChild(weekdays);

  const grid = document.createElement("div");
  grid.className = "cal-grid";
  grid.setAttribute("aria-label", monthTitle(_year, _month));

  for (const cell of buildCells(_year, _month)) {
    const el = document.createElement("div");
    el.className = "cal-cell";
    el.textContent = String(cell.date.getDate());
    if (!cell.inMonth) el.classList.add("cal-cell-out");
    if (isSameDay(cell.date, today)) el.classList.add("cal-cell-today");
    grid.appendChild(el);
  }

  root.appendChild(grid);
  _container.appendChild(root);
}

export default {
  id: PLUGIN_ID,
  name: "Calendar",
  version: "1.0.0",
  description: "Month view in the sidebar",
  detail:
    "Shows a navigable month grid (previous / today / next). First plugin added to the diary pack alongside Daily Note. Does not open notes.",
  sidebarPanelId: PANEL_ID,

  onEnable(api: MarkablePluginAPI): void {
    injectCSS();
    const now = new Date();
    _year = now.getFullYear();
    _month = now.getMonth();

    api.registerSidebarPanel({
      id: PANEL_ID,
      title: "Calendar",
      side: "right",
      defaultWidth: 260,
      headerActions: [
        { icon: "‹", title: "Previous month", onClick: () => navigateMonth(-1) },
        { icon: "Today", title: "Go to today", onClick: () => navigateToToday() },
        { icon: "›", title: "Next month", onClick: () => navigateMonth(1) },
      ],
      render(container: HTMLElement): void {
        _container = container;
        renderMonth();
      },
      destroy(container: HTMLElement): void {
        _container = null;
        container.innerHTML = "";
      },
    });
    api.focusSidebarPanel(PANEL_ID);
  },

  onDisable(api: MarkablePluginAPI): void {
    api.unregisterSidebarPanel(PANEL_ID);
    _container = null;
  },
};
