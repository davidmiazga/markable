/**
 * DOM for the diary heatmap, on-this-day list, and editor dashboard.
 */

import type { DiaryNote, HeatCell } from "./diary-stats";
import { habitLevel, sortNotes, streakEnding, writingLevel, yearWeeks } from "./diary-stats";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function mountViewBar(
  parent: HTMLElement,
  view: "month" | "heatmap",
  onMonth: () => void,
  onHeatmap: () => void,
  onDashboard: () => void,
): void {
  const bar = document.createElement("div");
  bar.className = "dn-cal-views";
  const month = viewButton("Month", view === "month", onMonth);
  const heat = viewButton("Heatmap", view === "heatmap", onHeatmap);
  const dash = viewButton("Dashboard", false, onDashboard);
  bar.append(month, heat, dash);
  parent.appendChild(bar);
}

function viewButton(label: string, on: boolean, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = on ? "dn-cal-view dn-cal-view-on" : "dn-cal-view";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    action();
  });
  return button;
}

export function mountHeatmap(
  parent: HTMLElement,
  year: number,
  weekStartsOn: 0 | 1,
  notes: Map<string, DiaryNote>,
  mode: "words" | { habit: string },
  onOpen: (iso: string) => void,
): void {
  const model = yearWeeks(year, weekStartsOn, (iso, inYear) => {
    const note = inYear ? notes.get(iso) : undefined;
    if (mode === "words") {
      const level = note ? writingLevel(note.words) : 0;
      const tip = note ? `${note.words} words on ${iso}` : iso;
      return { iso, inYear, level, tip };
    }
    const value = note ? habitValue(note, mode.habit) : undefined;
    const level = note ? habitLevel(value) : 0;
    const shown = value === undefined ? "no entry" : String(value);
    return { iso, inYear, level, tip: `${mode.habit}: ${shown} on ${iso}` };
  });

  const block = document.createElement("div");
  block.className = "dn-heat";

  const months = document.createElement("div");
  months.className = "dn-heat-months";
  months.style.gridTemplateColumns = `repeat(${model.weeks.length}, 11px)`;
  for (const label of model.monthLabels) {
    const el = document.createElement("span");
    el.className = "dn-heat-month";
    el.textContent = label.label;
    el.style.gridColumn = String(label.week + 1);
    months.appendChild(el);
  }

  const row = document.createElement("div");
  row.className = "dn-heat-row";

  const dows = document.createElement("div");
  dows.className = "dn-heat-dows";
  for (let i = 0; i < 7; i += 1) {
    const slot = document.createElement("span");
    const index = (weekStartsOn + i) % 7;
    if (index === 1 || index === 3 || index === 5) slot.textContent = DOW[index].slice(0, 1);
    dows.appendChild(slot);
  }

  const scroll = document.createElement("div");
  scroll.className = "dn-heat-scroll";
  const grid = document.createElement("div");
  grid.className = "dn-heat-grid";
  grid.style.gridTemplateRows = "repeat(7, 11px)";
  grid.style.gridAutoColumns = "11px";
  for (const week of model.weeks) {
    for (const cell of week) grid.appendChild(heatCell(cell, onOpen));
  }
  scroll.append(months, grid);
  row.append(dows, scroll);
  block.append(row, legend());
  parent.appendChild(block);
}

function habitValue(note: DiaryNote, habit: string): boolean | number | undefined {
  const key = Object.keys(note.habits).find((name) => name.toLowerCase() === habit.toLowerCase());
  return key ? note.habits[key] : undefined;
}

function heatCell(cell: HeatCell, onOpen: (iso: string) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `dn-heat-cell dn-heat-${cell.level}`;
  button.title = cell.tip;
  if (!cell.inYear) button.classList.add("dn-heat-out");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (cell.inYear) onOpen(cell.iso);
  });
  return button;
}

function legend(): HTMLElement {
  const row = document.createElement("div");
  row.className = "dn-heat-legend";
  const less = document.createElement("span");
  less.textContent = "Less";
  row.appendChild(less);
  for (let level = 0; level <= 4; level += 1) {
    const swatch = document.createElement("span");
    swatch.className = `dn-heat-cell dn-heat-${level}`;
    row.appendChild(swatch);
  }
  const more = document.createElement("span");
  more.textContent = "More";
  row.appendChild(more);
  return row;
}

export function mountOnThisDay(
  parent: HTMLElement,
  notes: DiaryNote[],
  onOpen: (iso: string) => void,
): void {
  const block = document.createElement("div");
  block.className = "dn-otd";
  const title = document.createElement("div");
  title.className = "dn-otd-title";
  title.textContent = "On this day";
  block.appendChild(title);
  if (notes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dn-otd-empty";
    empty.textContent = "No earlier notes for this date.";
    block.appendChild(empty);
  } else {
    for (const note of notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dn-otd-item";
      button.textContent = `${note.iso.slice(0, 4)}  ${note.title}`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        onOpen(note.iso);
      });
      block.appendChild(button);
    }
  }
  parent.appendChild(block);
}

export interface DashboardState {
  year: number;
  query: string;
  newestFirst: boolean;
  view: "heatmap" | "timeline" | "habits";
  weekStartsOn: 0 | 1;
  notes: DiaryNote[];
  habitNames: string[];
}

export function mountDashboard(
  parent: HTMLElement,
  state: DashboardState,
  onChange: (patch: Partial<DashboardState>) => void,
  onOpen: (iso: string) => void,
): void {
  parent.innerHTML = "";
  const root = document.createElement("div");
  root.className = "dn-dash";

  const head = document.createElement("div");
  head.className = "dn-dash-head";
  const year = document.createElement("div");
  year.className = "dn-dash-year";
  year.append(
    viewButton("‹", false, () => onChange({ year: state.year - 1 })),
    textSpan(`${state.year}`, "dn-dash-year-label"),
    viewButton("›", false, () => onChange({ year: state.year + 1 })),
  );
  const search = document.createElement("input");
  search.type = "search";
  search.className = "dn-dash-search";
  search.placeholder = "Search notes, tags, habits";
  search.value = state.query;
  search.addEventListener("input", () => onChange({ query: search.value }));
  head.append(year, search);
  root.appendChild(head);

  const views = document.createElement("div");
  views.className = "dn-cal-views";
  views.append(
    viewButton("Heatmap", state.view === "heatmap", () => onChange({ view: "heatmap" })),
    viewButton("Timeline", state.view === "timeline", () => onChange({ view: "timeline" })),
    viewButton("Habits", state.view === "habits", () => onChange({ view: "habits" })),
    viewButton(state.newestFirst ? "Newest" : "Oldest", false, () => onChange({ newestFirst: !state.newestFirst })),
  );
  root.appendChild(views);

  const notes = new Map(state.notes.map((note) => [note.iso, note]));
  const body = document.createElement("div");
  body.className = "dn-dash-body";
  if (state.view === "heatmap") {
    mountHeatmap(body, state.year, state.weekStartsOn, notes, "words", onOpen);
    const total = state.notes.reduce((sum, note) => sum + note.words, 0);
    body.appendChild(statLine(`${state.notes.length} notes · ${total} words`));
  } else if (state.view === "timeline") {
    body.appendChild(timeline(sortNotes(state.notes, state.newestFirst), onOpen));
  } else {
    body.appendChild(habitBoard(state, notes, onOpen));
  }
  root.appendChild(body);
  parent.appendChild(root);
}

function textSpan(text: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function statLine(text: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "dn-dash-stat";
  line.textContent = text;
  return line;
}

function timeline(notes: DiaryNote[], onOpen: (iso: string) => void): HTMLElement {
  const list = document.createElement("div");
  list.className = "dn-time";
  if (notes.length === 0) {
    list.appendChild(statLine("No notes match."));
    return list;
  }
  let month = "";
  for (const note of notes) {
    const label = note.iso.slice(0, 7);
    if (label !== month) {
      month = label;
      const heading = document.createElement("div");
      heading.className = "dn-time-month";
      heading.textContent = label;
      list.appendChild(heading);
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dn-time-row";
    const date = document.createElement("span");
    date.className = "dn-time-date";
    date.textContent = note.iso.slice(8);
    const title = document.createElement("span");
    title.className = "dn-time-title";
    title.textContent = note.title;
    const meta = document.createElement("span");
    meta.className = "dn-time-meta";
    const bits = [`${note.words} words`];
    if (note.category) bits.push(note.category);
    if (note.tags.length) bits.push(note.tags.map((tag) => `#${tag}`).join(" "));
    meta.textContent = bits.join(" · ");
    row.append(date, title, meta);
    row.addEventListener("click", () => onOpen(note.iso));
    list.appendChild(row);
  }
  return list;
}

function habitBoard(
  state: DashboardState,
  notes: Map<string, DiaryNote>,
  onOpen: (iso: string) => void,
): HTMLElement {
  const board = document.createElement("div");
  board.className = "dn-habits";
  if (state.habitNames.length === 0) {
    board.appendChild(statLine("No habits yet. Add a property such as exercise: true, or a ## Habits checkbox list. Name them in Daily Note settings to pin the list."));
    return board;
  }
  const today = new Date();
  for (const habit of state.habitNames) {
    const card = document.createElement("section");
    card.className = "dn-habit";
    const title = document.createElement("div");
    title.className = "dn-habit-title";
    const done = new Set<string>();
    for (const note of state.notes) {
      const value = habitValue(note, habit);
      if (value === true || (typeof value === "number" && value > 0)) done.add(note.iso);
    }
    title.textContent = `${habit} · ${streakEnding(done, today)} day streak`;
    card.appendChild(title);
    mountHeatmap(card, state.year, state.weekStartsOn, notes, { habit }, onOpen);
    board.appendChild(card);
  }
  return board;
}
