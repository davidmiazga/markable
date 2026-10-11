/**
 * Note-based project board.
 *
 * A board is a markdown file whose frontmatter says `kanban: board`.
 * Lanes are repeated `lane:` lines. Cards are other markdown files in the
 * same folder. A card's `status:` is the lane it sits in. Nothing here is
 * stored in plugin settings.
 */

import {
  applyYamlKey,
  parseYamlFrontmatter,
  reconstructFile,
  removeYamlKey,
} from "../file-browser/folder-view/yaml-frontmatter";

export const BOARD_MARKER = "board";
export const BOARD_FILE = "board.md";

export const DEFAULT_LANES: ReadonlyArray<{ title: string; color: string }> = [
  { title: "To Do", color: "#4c78e8" },
  { title: "In Progress", color: "#e6a23c" },
  { title: "Done", color: "#3d9a6a" },
];

const RESERVED_KEYS = new Set([
  "kanban",
  "title",
  "status",
  "priority",
  "due",
  "assignee",
  "tags",
  "blocked-by",
  "color",
  "border",
  "unread",
  "parent",
  "order",
  "lane",
  "show-title",
  "show-tags",
  "show-progress",
]);

export interface Lane {
  title: string;
  color: string;
  collapsed: boolean;
  hidden: boolean;
}

export interface CheckItem {
  text: string;
  done: boolean;
  /** Index into the file body lines, used to flip one box. */
  bodyLineIndex: number;
}

export interface CustomField {
  key: string;
  value: string;
}

export interface CardNote {
  path: string;
  fileName: string;
  title: string;
  status: string;
  priority: string;
  due: string;
  assignee: string;
  tags: string[];
  blockedBy: string;
  color: string;
  border: string;
  unread: boolean;
  parent: string;
  order: string;
  description: string;
  comments: string;
  history: string;
  checks: CheckItem[];
  custom: CustomField[];
}

export interface BoardNote {
  path: string;
  title: string;
  lanes: Lane[];
  showTitle: boolean;
  showTags: boolean;
  showProgress: boolean;
}

export type BoardFilter = "overdue" | "due-soon" | "blocked" | "unread";

const CHECK_RE = /^- \[([ xX])\]\s?(.*)$/;

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function scalarLines(lines: string[], key: string): string[] {
  const want = key.toLowerCase();
  const found: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== want) continue;
    found.push(unquote(line.slice(colon + 1)));
  }
  return found;
}

function scalar(lines: string[], key: string): string {
  return scalarLines(lines, key)[0] ?? "";
}

function yes(raw: string, fallback: boolean): boolean {
  if (raw === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "no" || value === "false" || value === "0" || value === "off") return false;
  if (value === "yes" || value === "true" || value === "1" || value === "on") return true;
  return fallback;
}

function parseTags(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner
    .split(",")
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter((tag) => tag !== "");
}

function parseLane(raw: string): Lane | null {
  const parts = raw.split("|").map((part) => part.trim());
  const title = parts[0] ?? "";
  if (title === "") return null;
  const color = parts[1] && parts[1].startsWith("#") ? parts[1] : "";
  const flags = new Set(parts.slice(color ? 2 : 1).map((flag) => flag.toLowerCase()));
  return {
    title,
    color,
    collapsed: flags.has("collapsed"),
    hidden: flags.has("hidden"),
  };
}

function laneLine(lane: Lane): string {
  const bits = [lane.title];
  if (lane.color) bits.push(lane.color);
  if (lane.collapsed) bits.push("collapsed");
  if (lane.hidden) bits.push("hidden");
  return `lane: ${bits.join("|")}`;
}

export function isBoardContent(content: string): boolean {
  const parsed = parseYamlFrontmatter(content);
  return parsed.hasFrontmatter && scalar(parsed.frontmatterLines, "kanban") === BOARD_MARKER;
}

export function parseBoard(content: string, path: string): BoardNote | null {
  if (!isBoardContent(content)) return null;
  const parsed = parseYamlFrontmatter(content);
  const lanes = scalarLines(parsed.frontmatterLines, "lane")
    .map(parseLane)
    .filter((lane): lane is Lane => lane !== null);
  const title = scalar(parsed.frontmatterLines, "title") || fileStem(path);
  return {
    path,
    title,
    lanes: lanes.length > 0 ? lanes : DEFAULT_LANES.map((lane) => ({
      title: lane.title,
      color: lane.color,
      collapsed: false,
      hidden: false,
    })),
    showTitle: yes(scalar(parsed.frontmatterLines, "show-title"), true),
    showTags: yes(scalar(parsed.frontmatterLines, "show-tags"), true),
    showProgress: yes(scalar(parsed.frontmatterLines, "show-progress"), true),
  };
}

function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.md$/i, "");
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function sectionSplit(bodyLines: string[]): {
  descriptionLines: string[];
  subtasksAt: number;
  subtasksEnd: number;
  comments: string;
  history: string;
} {
  let subtasksAt = -1;
  let commentsAt = -1;
  let historyAt = -1;
  bodyLines.forEach((line, index) => {
    const heading = line.trim().toLowerCase();
    if (subtasksAt === -1 && heading === "## subtasks") subtasksAt = index;
    if (commentsAt === -1 && heading === "## comments") commentsAt = index;
    if (historyAt === -1 && heading === "## history") historyAt = index;
  });
  const cuts = [subtasksAt, commentsAt, historyAt].filter((index) => index >= 0).sort((a, b) => a - b);
  const descriptionEnd = cuts[0] ?? bodyLines.length;
  const descriptionLines = bodyLines.slice(0, descriptionEnd);
  const later = cuts.filter((index) => index > subtasksAt);
  const subtasksEnd = subtasksAt < 0 ? -1 : (later[0] ?? bodyLines.length);
  const comments = sliceSection(bodyLines, commentsAt, historyAt);
  const history = sliceSection(bodyLines, historyAt, commentsAt);
  return { descriptionLines, subtasksAt, subtasksEnd, comments, history };
}

function sliceSection(lines: string[], start: number, other: number): string {
  if (start < 0) return "";
  const end = other > start ? other : lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

export function parseCard(content: string, path: string): CardNote {
  const parsed = parseYamlFrontmatter(content);
  const lines = parsed.frontmatterLines;
  const { descriptionLines, subtasksAt, subtasksEnd, comments, history } = sectionSplit(parsed.bodyLines);
  const checks: CheckItem[] = [];
  const prose: string[] = [];
  const collectCheck = (line: string, bodyLineIndex: number, keepProse: boolean) => {
    const match = CHECK_RE.exec(line);
    if (match) {
      checks.push({
        done: match[1].toLowerCase() === "x",
        text: match[2],
        bodyLineIndex,
      });
    } else if (keepProse && line.trim() !== "") {
      prose.push(line);
    }
  };
  descriptionLines.forEach((line, bodyLineIndex) => collectCheck(line, bodyLineIndex, true));
  if (subtasksAt >= 0) {
    parsed.bodyLines.slice(subtasksAt + 1, subtasksEnd).forEach((line, offset) => {
      collectCheck(line, subtasksAt + 1 + offset, false);
    });
  }
  const custom: CustomField[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const reserved = key.toLowerCase();
    if (RESERVED_KEYS.has(reserved) || seen.has(reserved)) continue;
    seen.add(reserved);
    custom.push({ key, value: unquote(line.slice(colon + 1)) });
  }
  const title = scalar(lines, "title") || fileStem(path);
  return {
    path,
    fileName: fileName(path),
    title,
    status: scalar(lines, "status"),
    priority: scalar(lines, "priority"),
    due: scalar(lines, "due"),
    assignee: scalar(lines, "assignee"),
    tags: parseTags(scalar(lines, "tags")),
    blockedBy: scalar(lines, "blocked-by"),
    color: scalar(lines, "color"),
    border: scalar(lines, "border"),
    unread: yes(scalar(lines, "unread"), false),
    parent: scalar(lines, "parent"),
    order: scalar(lines, "order"),
    description: prose.join("\n").trim(),
    comments,
    history,
    checks,
    custom,
  };
}

function rewrite(content: string, mutate: (lines: string[]) => string[]): string {
  const parsed = parseYamlFrontmatter(content);
  const frontmatterLines = mutate([...parsed.frontmatterLines]);
  return reconstructFile({
    hasFrontmatter: frontmatterLines.length > 0 || parsed.hasFrontmatter,
    frontmatterLines,
    bodyLines: parsed.bodyLines,
  });
}

export function withScalar(content: string, key: string, value: string): string {
  return rewrite(content, (lines) => applyYamlKey(lines, key, value));
}

export function withoutScalar(content: string, key: string): string {
  return rewrite(content, (lines) => removeYamlKey(lines, key));
}

function setOrClear(content: string, key: string, value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? withoutScalar(content, key) : withScalar(content, key, trimmed);
}

export function withLanes(content: string, lanes: Lane[]): string {
  return rewrite(content, (lines) => {
    const kept = lines.filter((line) => !line.startsWith("lane:") && line !== "lane:");
    return [...kept, ...lanes.map(laneLine)];
  });
}

export function withShowFlags(
  content: string,
  flags: { showTitle: boolean; showTags: boolean; showProgress: boolean },
): string {
  let next = withScalar(content, "show-title", flags.showTitle ? "yes" : "no");
  next = withScalar(next, "show-tags", flags.showTags ? "yes" : "no");
  return withScalar(next, "show-progress", flags.showProgress ? "yes" : "no");
}

export function toggleCheck(content: string, bodyLineIndex: number): string {
  const parsed = parseYamlFrontmatter(content);
  const line = parsed.bodyLines[bodyLineIndex];
  if (line === undefined) return content;
  const match = CHECK_RE.exec(line);
  if (!match) return content;
  const mark = match[1].toLowerCase() === "x" ? " " : "x";
  const bodyLines = [...parsed.bodyLines];
  bodyLines[bodyLineIndex] = `- [${mark}] ${match[2]}`;
  return reconstructFile({ ...parsed, bodyLines });
}

export function addCheckItem(content: string, text: string): string {
  const parsed = parseYamlFrontmatter(content);
  const bodyLines = [...parsed.bodyLines];
  const row = `- [ ] ${text.trim()}`;
  const subAt = bodyLines.findIndex((line) => line.trim().toLowerCase() === "## subtasks");
  if (subAt === -1) {
    const insertAt = bodyLines.findIndex((line) => {
      const heading = line.trim().toLowerCase();
      return heading === "## comments" || heading === "## history";
    });
    const block = ["## Subtasks", row];
    if (insertAt === -1) {
      if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] !== "") bodyLines.push("");
      bodyLines.push(...block);
    } else {
      bodyLines.splice(insertAt, 0, ...block);
    }
  } else {
    let end = subAt + 1;
    while (end < bodyLines.length && !bodyLines[end].trim().toLowerCase().startsWith("## ")) end += 1;
    bodyLines.splice(end, 0, row);
  }
  return reconstructFile({ ...parsed, bodyLines });
}

/** Append one line under a `##` section, creating the heading when the note lacks it. */
export function appendSectionLine(content: string, heading: string, line: string): string {
  const parsed = parseYamlFrontmatter(content);
  const body = [...parsed.bodyLines];
  const want = heading.trim().toLowerCase();
  const at = body.findIndex((row) => row.trim().toLowerCase() === want);
  if (at === -1) {
    if (body.length > 0 && body[body.length - 1] !== "") body.push("");
    body.push(heading, line);
  } else {
    let end = at + 1;
    while (end < body.length && !body[end].trim().toLowerCase().startsWith("## ")) end += 1;
    body.splice(end, 0, line);
  }
  return reconstructFile({ ...parsed, bodyLines: body });
}

export interface CardDraft {
  title: string;
  status: string;
  priority?: string;
  due?: string;
  assignee?: string;
  tags?: string[];
  blockedBy?: string;
  parent?: string;
  description?: string;
}

export function withDescription(content: string, description: string): string {
  const parsed = parseYamlFrontmatter(content);
  const body = parsed.bodyLines;
  const subtasksAt = body.findIndex((line) => line.trim().toLowerCase() === "## subtasks");
  const commentsAt = body.findIndex((line) => line.trim().toLowerCase() === "## comments");
  const historyAt = body.findIndex((line) => line.trim().toLowerCase() === "## history");
  const cuts = [subtasksAt, commentsAt, historyAt].filter((index) => index >= 0).sort((a, b) => a - b);
  const end = cuts[0] ?? body.length;
  const checks = body.slice(0, end).filter((line) => CHECK_RE.test(line));
  const tail = body.slice(end);
  const prose = description.trim() === "" ? [] : description.replace(/\r\n/g, "\n").trim().split("\n");
  const bodyLines: string[] = [...prose];
  if (prose.length > 0 && checks.length > 0) bodyLines.push("");
  bodyLines.push(...checks);
  if (tail.length > 0) {
    if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] !== "") bodyLines.push("");
    bodyLines.push(...tail);
  }
  return reconstructFile({ ...parsed, bodyLines });
}

export function buildCardContent(draft: CardDraft): string {
  let content = "---\ntitle: Untitled\nstatus: To Do\nunread: yes\n---\n\n";
  content = applyCardDraft(content, draft);
  return content;
}

export function applyCardDraft(content: string, draft: CardDraft): string {
  let next = setOrClear(content, "title", draft.title);
  next = setOrClear(next, "status", draft.status);
  next = setOrClear(next, "priority", draft.priority);
  next = setOrClear(next, "due", draft.due);
  next = setOrClear(next, "assignee", draft.assignee);
  next = setOrClear(next, "blocked-by", draft.blockedBy);
  next = setOrClear(next, "tags", (draft.tags ?? []).map((tag) => tag.trim()).filter(Boolean).join(", "));
  next = setOrClear(next, "parent", draft.parent);
  if (draft.description !== undefined) next = withDescription(next, draft.description);
  return next;
}

export const DEFAULT_PROJECT_NAME = "Project";

export function projectFolderName(title: string, taken: ReadonlySet<string> = new Set()): string {
  const cleaned = title.replace(/[\\/:\0]/g, " ").replace(/\s+/g, " ").trim() || DEFAULT_PROJECT_NAME;
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  if (!used.has(cleaned.toLowerCase())) return cleaned;
  let n = 2;
  while (used.has(`${cleaned} ${n}`.toLowerCase())) n += 1;
  return `${cleaned} ${n}`;
}

export function defaultBoardContent(title = DEFAULT_PROJECT_NAME): string {
  const lanes = DEFAULT_LANES.map((lane) => `lane: ${lane.title}|${lane.color}`).join("\n");
  return [
    "---",
    "kanban: board",
    `title: ${title}`,
    "show-title: yes",
    "show-tags: yes",
    "show-progress: yes",
    lanes,
    "---",
    "",
    "This folder is the project. This file is the board. Every other note here is a task.",
    "",
  ].join("\n");
}

function fileHasLaneLines(content: string): boolean {
  const parsed = parseYamlFrontmatter(content);
  return parsed.frontmatterLines.some((line) => line.startsWith("lane:") || line.startsWith("lane:\t"));
}

/** Restore the board file. Task notes in the folder are not part of this text. */
export function repairedBoard(existing: string | null, title: string): string {
  if (existing === null || existing.trim() === "") return defaultBoardContent(title);
  const salvaged = salvageFrontmatter(existing);
  if (!isBoardContent(salvaged)) {
    const kept = salvaged.replace(/^\uFEFF/, "").trim();
    const board = defaultBoardContent(title).replace(/\s*$/, "");
    return kept === "" ? `${board}\n` : `${board}\n\n${kept}\n`;
  }
  if (!fileHasLaneLines(salvaged)) {
    const parsed = parseBoard(salvaged, BOARD_FILE);
    return withLanes(salvaged, parsed?.lanes ?? []);
  }
  return withLanes(salvaged, uniqueLanes(parseBoard(salvaged, BOARD_FILE)?.lanes ?? []));
}

export interface FolderNote {
  name: string;
  content: string;
}

const SCALAR_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;
const LIST_ITEM = /^\s+-\s+(.+)$/;
const LOOSE_CHECK = /^[-*]\s+\[([ xX]?)\]\s*(.*)$/;

function normalizeCheckLine(line: string): string {
  const match = LOOSE_CHECK.exec(line);
  if (!match) return line;
  const mark = match[1].toLowerCase() === "x" ? "x" : " ";
  return `- [${mark}] ${match[2]}`.replace(/\s+$/, "");
}

function collapseFrontmatter(lines: string[]): { kept: string[]; rescued: string[] } {
  const rescued: string[] = [];
  const scalars: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^tags\s*:\s*$/.test(line)) {
      const tags: string[] = [];
      let j = i + 1;
      while (j < lines.length && LIST_ITEM.test(lines[j])) {
        tags.push(lines[j].replace(LIST_ITEM, "$1").trim());
        j += 1;
      }
      if (tags.length > 0) {
        scalars.push(`tags: ${tags.join(", ")}`);
        i = j - 1;
        continue;
      }
    }
    const match = SCALAR_LINE.exec(line.trim());
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      if (key === "kanban" && value.toLowerCase() === "board") value = "board";
      scalars.push(value === "" ? `${key}:` : `${key}: ${value}`);
      continue;
    }
    if (line.trim() !== "") rescued.push(line.trim());
  }
  const lanes: string[] = [];
  const order: string[] = [];
  const values = new Map<string, string>();
  for (const line of scalars) {
    if (line.startsWith("lane:") || line.startsWith("lane:\t")) {
      lanes.push(line);
      continue;
    }
    const match = SCALAR_LINE.exec(line);
    if (!match) continue;
    if (!values.has(match[1])) order.push(match[1]);
    values.set(match[1], line);
  }
  return {
    kept: [...order.map((key) => values.get(key) ?? ""), ...lanes],
    rescued,
  };
}

/** Close a broken frontmatter block and keep every non-property line in the note body. */
export function salvageFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if ((lines[0] ?? "").trim() !== "---") {
    const body = lines.map(normalizeCheckLine);
    const next = body.join("\n");
    return next === normalized ? content.replace(/\r\n/g, "\n") : next;
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  let rawFm: string[];
  let body: string[];
  if (close === -1) {
    rawFm = [];
    let i = 1;
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "") break;
      if (SCALAR_LINE.test(line.trim()) || LIST_ITEM.test(line) || line.trim().startsWith("lane:")) {
        rawFm.push(line);
        continue;
      }
      break;
    }
    body = lines.slice(i);
  } else {
    rawFm = lines.slice(1, close);
    body = lines.slice(close + 1);
  }
  const { kept, rescued } = collapseFrontmatter(rawFm);
  const bodyLines = [...rescued, ...body].map(normalizeCheckLine);
  if (kept.length === 0) return bodyLines.join("\n");
  return reconstructFile({
    hasFrontmatter: true,
    frontmatterLines: kept,
    bodyLines,
  });
}

function uniqueLanes(lanes: Lane[]): Lane[] {
  const seen = new Set<string>();
  const unique: Lane[] = [];
  for (const lane of lanes) {
    const title = lane.title.trim();
    if (title === "" || seen.has(title)) continue;
    seen.add(title);
    unique.push({ ...lane, title });
  }
  if (unique.length > 0) return unique;
  return DEFAULT_LANES.map((lane) => ({
    title: lane.title,
    color: lane.color,
    collapsed: false,
    hidden: false,
  }));
}

function parentIsPresent(parent: string, names: readonly string[]): boolean {
  const want = parent.trim().toLowerCase();
  if (want === "") return true;
  return names.some((name) => {
    const stem = name.replace(/\.md$/i, "").toLowerCase();
    return name.toLowerCase() === want || stem === want || `${stem}.md` === want;
  });
}

/**
 * Read a project folder the way Obsidian keeps a note open: salvage broken
 * properties, keep the prose, and put a card with a missing lane onto the board.
 */
export function cleanProject(files: FolderNote[], title = DEFAULT_PROJECT_NAME): { files: FolderNote[]; notes: string[] } {
  const notes: string[] = [];
  const working = files.map((file) => ({
    name: file.name,
    content: salvageFrontmatter(file.content),
  }));
  let boardIndex = working.findIndex((file) => file.name.toLowerCase() === BOARD_FILE);
  if (boardIndex === -1) boardIndex = working.findIndex((file) => isBoardContent(file.content));
  if (boardIndex === -1) {
    working.push({ name: BOARD_FILE, content: defaultBoardContent(title) });
    boardIndex = working.length - 1;
    notes.push("Added board.md.");
  } else {
    const repaired = repairedBoard(working[boardIndex].content, title);
    if (repaired !== working[boardIndex].content) {
      notes.push(`Restored the board file ${working[boardIndex].name}.`);
      working[boardIndex].content = repaired;
    }
  }
  let lanes = uniqueLanes(parseBoard(working[boardIndex].content, working[boardIndex].name)?.lanes ?? []);
  const names = working.map((file) => file.name);
  for (let i = 0; i < working.length; i += 1) {
    if (i === boardIndex || isBoardContent(working[i].content)) continue;
    let content = working[i].content;
    const parsed = parseYamlFrontmatter(content);
    if (!parsed.hasFrontmatter) {
      const stem = working[i].name.replace(/\.md$/i, "");
      content = buildCardContent({ title: stem, status: lanes[0].title, description: content.trim() });
      notes.push(`${working[i].name} had no properties. It is in ${lanes[0].title}.`);
    } else {
      const card = parseCard(content, working[i].name);
      const status = card.status.trim();
      if (status === "") {
        content = withScalar(content, "status", lanes[0].title);
        notes.push(`${working[i].name} had no status. It is in ${lanes[0].title}.`);
      } else if (!lanes.some((lane) => lane.title === status)) {
        lanes = [...lanes, { title: status, color: "#888888", collapsed: false, hidden: false }];
        if (status !== card.status) content = withScalar(content, "status", status);
        notes.push(`Added a lane for ${status}.`);
      } else if (status !== card.status) {
        content = withScalar(content, "status", status);
      }
      if (card.parent.trim() !== "" && !parentIsPresent(card.parent, names)) {
        content = withoutScalar(content, "parent");
        notes.push(`${working[i].name} pointed at a missing note. It stays on the board.`);
      }
    }
    working[i].content = content;
  }
  const laned = withLanes(working[boardIndex].content, lanes);
  if (laned !== working[boardIndex].content) working[boardIndex].content = laned;
  const before = new Map(files.map((file) => [file.name, file.content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")]));
  for (const file of working) {
    if (before.get(file.name) !== file.content && !notes.some((note) => note.includes(file.name))) {
      notes.push(`Cleaned ${file.name}.`);
    }
  }
  return { files: working, notes };
}

export function newCardContent(title: string, status: string): string {
  return buildCardContent({ title, status });
}

export function newSubtaskContent(title: string, status: string, parentFileName: string): string {
  return buildCardContent({ title, status, parent: parentFileName });
}

export interface Progress {
  done: number;
  total: number;
}

export function progressOf(card: CardNote, children: CardNote[]): Progress {
  const checksDone = card.checks.filter((item) => item.done).length;
  const childrenDone = children.filter((child) => isDoneStatus(child.status)).length;
  return {
    done: checksDone + childrenDone,
    total: card.checks.length + children.length,
  };
}

export function isDoneStatus(status: string): boolean {
  return status.trim().toLowerCase() === "done";
}

function addDays(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function haystack(card: CardNote, children: CardNote[]): string {
  return [
    card.title,
    card.fileName,
    card.status,
    card.priority,
    card.due,
    card.assignee,
    card.tags.join(" "),
    card.blockedBy,
    card.description,
    card.comments,
    ...card.checks.map((item) => item.text),
    ...card.custom.map((field) => `${field.key} ${field.value}`),
    ...children.map((child) => `${child.title} ${child.fileName}`),
  ].join("\n").toLowerCase();
}

export function cardVisible(
  card: CardNote,
  children: CardNote[],
  query: string,
  filters: ReadonlySet<BoardFilter>,
  today: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle !== "" && !haystack(card, children).includes(needle)) return false;
  if (filters.has("blocked") && card.blockedBy.trim() === "") return false;
  if (filters.has("unread") && !card.unread) return false;
  const due = card.due.trim();
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(due);
  const done = isDoneStatus(card.status);
  if (filters.has("overdue")) {
    if (!dated || done || due >= today) return false;
  }
  if (filters.has("due-soon")) {
    if (!dated || done || due < today || due > addDays(today, 7)) return false;
  }
  return true;
}

export function groupByParent(cards: CardNote[]): Array<{ card: CardNote; children: CardNote[] }> {
  const byName = new Map<string, CardNote[]>();
  for (const card of cards) {
    const parent = card.parent.trim();
    if (parent === "") continue;
    const list = byName.get(parent) ?? [];
    list.push(card);
    byName.set(parent, list);
  }
  return cards
    .filter((card) => card.parent.trim() === "")
    .map((card) => ({
      card,
      children: [
        ...(byName.get(card.fileName) ?? []),
        ...(byName.get(card.fileName.replace(/\.md$/i, "")) ?? []),
      ],
    }));
}

export function slugFileName(title: string, taken: ReadonlySet<string>): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "card";
  let name = `${slug}.md`;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    name = `${slug}-${n}.md`;
    n += 1;
  }
  return name;
}
