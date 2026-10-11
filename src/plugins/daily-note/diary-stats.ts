/**
 * Pure diary stats: note parsing, GitHub-style heatmap levels, filters.
 * No DOM and no Tauri. The daily-note plugin loads files and renders these.
 */

import { addDays, formatDate } from "./date-utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RESERVED = new Set([
  "date",
  "tags",
  "tag",
  "title",
  "aliases",
  "alias",
  "cssclasses",
  "cssclass",
  "category",
]);

export interface DiaryNote {
  iso: string;
  path: string;
  title: string;
  tags: string[];
  category: string;
  words: number;
  habits: Record<string, boolean | number>;
  text: string;
}

export interface HeatCell {
  iso: string;
  inYear: boolean;
  level: number;
  tip: string;
}

export function parseHabitNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function writingLevel(words: number | null): 0 | 1 | 2 | 3 | 4 {
  if (words === null) return 0;
  if (words < 50) return 1;
  if (words < 250) return 2;
  if (words < 500) return 3;
  return 4;
}

export function habitLevel(value: boolean | number | undefined): 0 | 1 | 2 | 3 | 4 {
  if (value === undefined || value === false || value === 0) return 0;
  if (value === true) return 4;
  if (value <= 1) return 1;
  if (value <= 2) return 2;
  if (value <= 3) return 3;
  return 4;
}

export function eachDayOfYear(year: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date(year, 0, 1, 12, 0, 0, 0);
  while (cursor.getFullYear() === year) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function splitFrontMatter(content: string): { yaml: string; body: string } {
  if (!content.startsWith("---\n")) return { yaml: "", body: content };
  const end = content.indexOf("\n---", 4);
  if (end < 0) return { yaml: "", body: content };
  return { yaml: content.slice(4, end), body: content.slice(end + 4) };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYaml(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  let listKey = "";
  for (const line of yaml.split("\n")) {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) {
      const piece = unquote(item[1]);
      out[listKey] = out[listKey] ? `${out[listKey]}, ${piece}` : piece;
      continue;
    }
    listKey = "";
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    if (field[2].trim() === "") {
      listKey = field[1];
      out[field[1]] = "";
      continue;
    }
    out[field[1]] = unquote(field[2]);
  }
  return out;
}

function coerceHabit(raw: string): boolean | number | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true" || lower === "yes") return true;
  if (lower === "false" || lower === "no") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return null;
}

function habitsFromBody(body: string): Record<string, boolean> {
  const habits: Record<string, boolean> = {};
  let inSection = false;
  for (const line of body.split("\n")) {
    if (/^#{1,6}\s+/.test(line)) {
      inSection = /^#{1,6}\s+habits\s*$/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const box = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (!box) continue;
    habits[box[2].trim()] = box[1].toLowerCase() === "x";
  }
  return habits;
}

function tagsFrom(yaml: Record<string, string>, body: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const add = (tag: string) => {
    const clean = tag.trim().replace(/^#/, "");
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(clean);
  };
  for (const key of ["tags", "tag"]) {
    for (const part of (yaml[key] ?? "").split(",")) add(part);
  }
  const plain = body.replace(/```[\s\S]*?```/g, " ");
  for (const match of plain.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) add(match[1]);
  return tags;
}

function wordCount(body: string): number {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_[\]()`]/g, " ");
  const words = plain.split(/\s+/).filter(Boolean);
  return words.length;
}

function keepHabit(
  name: string,
  configured: string[],
): boolean {
  if (configured.length === 0) return true;
  const key = name.toLowerCase();
  return configured.some((item) => item.toLowerCase() === key);
}

export function parseDiaryNote(
  path: string,
  content: string,
  habitNames: string[],
  iso: string,
): DiaryNote {
  const { yaml, body } = splitFrontMatter(content);
  const fields = parseYaml(yaml);
  const habits: Record<string, boolean | number> = {};
  for (const [key, raw] of Object.entries(fields)) {
    if (RESERVED.has(key.toLowerCase())) continue;
    if (!keepHabit(key, habitNames)) continue;
    const value = coerceHabit(raw);
    if (value === null) continue;
    if (habitNames.length === 0 && value === false) continue;
    habits[key] = value;
  }
  for (const [name, done] of Object.entries(habitsFromBody(body))) {
    if (!keepHabit(name, habitNames)) continue;
    if (habits[name] === undefined) habits[name] = done;
  }
  const heading = body.match(/^#{1,6}\s+(.+)$/m);
  const fileName = path.split("/").pop()?.replace(/\.md$/i, "") ?? iso;
  const title = (fields.title || heading?.[1] || fileName).trim();
  const tags = tagsFrom(fields, body);
  const category = (fields.category ?? "").trim();
  return {
    iso,
    path,
    title,
    tags,
    category,
    words: wordCount(body),
    habits,
    text: `${title} ${tags.join(" ")} ${category} ${body}`.toLowerCase(),
  };
}

export function collectHabitNames(notes: DiaryNote[], configured: string[]): string[] {
  if (configured.length > 0) return configured;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    for (const name of Object.keys(note.habits)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

export function filterNotes(notes: DiaryNote[], query: string): DiaryNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((note) => {
    if (note.iso.includes(q) || note.title.toLowerCase().includes(q)) return true;
    if (note.category.toLowerCase().includes(q)) return true;
    if (note.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
    if (Object.keys(note.habits).some((name) => name.toLowerCase().includes(q))) return true;
    return note.text.includes(q);
  });
}

export function sortNotes(notes: DiaryNote[], newestFirst: boolean): DiaryNote[] {
  const copy = [...notes];
  copy.sort((a, b) => (newestFirst ? b.iso.localeCompare(a.iso) : a.iso.localeCompare(b.iso)));
  return copy;
}

export function yearWeeks(
  year: number,
  weekStartsOn: 0 | 1,
  cellFor: (iso: string, inYear: boolean) => HeatCell,
): { weeks: HeatCell[][]; monthLabels: Array<{ label: string; week: number }> } {
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const dec31 = new Date(year, 11, 31, 12, 0, 0, 0);
  const start = new Date(jan1);
  const delta = (start.getDay() - weekStartsOn + 7) % 7;
  start.setDate(start.getDate() - delta);

  const weeks: HeatCell[][] = [];
  const monthLabels: Array<{ label: string; week: number }> = [];
  const seenMonths = new Set<number>();
  let cursor = start;
  while (cursor <= dec31 || weeks.length === 0) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const inYear = cursor.getFullYear() === year;
      const iso = formatDate(cursor, "YYYY-MM-DD");
      if (inYear && cursor.getDate() === 1 && !seenMonths.has(cursor.getMonth())) {
        seenMonths.add(cursor.getMonth());
        monthLabels.push({ label: MONTHS[cursor.getMonth()], week: weeks.length });
      }
      week.push(cellFor(iso, inYear));
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    if (weeks.length > 54) break;
  }
  return { weeks, monthLabels };
}

export function onThisDayDates(anchor: Date, lookbackYears: number): Date[] {
  const dates: Date[] = [];
  for (let i = 1; i <= lookbackYears; i += 1) {
    const candidate = new Date(anchor.getFullYear() - i, anchor.getMonth(), anchor.getDate(), 12, 0, 0, 0);
    if (candidate.getMonth() !== anchor.getMonth()) continue;
    dates.push(candidate);
  }
  return dates;
}

export function streakEnding(done: Set<string>, today: Date): number {
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  if (!done.has(formatDate(cursor, "YYYY-MM-DD"))) cursor = addDays(cursor, -1);
  let count = 0;
  while (done.has(formatDate(cursor, "YYYY-MM-DD"))) {
    count += 1;
    cursor = addDays(cursor, -1);
    if (count > 3660) break;
  }
  return count;
}

export function habitDoneOn(note: DiaryNote | undefined, habit: string): boolean {
  if (!note) return false;
  const key = Object.keys(note.habits).find((name) => name.toLowerCase() === habit.toLowerCase());
  if (!key) return false;
  const value = note.habits[key];
  return value === true || (typeof value === "number" && value > 0);
}
