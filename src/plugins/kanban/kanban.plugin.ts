/**
 * Kanban — project pack board over notes.
 *
 * One board. A markdown file marked `kanban: board` defines the lanes.
 * Each card is another markdown file in that folder; `status:` is the lane.
 * Cards are not stored in plugin settings.
 */

import { invoke } from "@tauri-apps/api/core";
import { openFolderDialog } from "../../lib/dialogs";
import type { MarkablePluginAPI } from "../markable-plugin-api";
import {
  addCheckItem,
  appendSectionLine,
  BOARD_FILE,
  cardVisible,
  cleanProject,
  DEFAULT_PROJECT_NAME,
  groupByParent,
  isBoardContent,
  newCardContent,
  newSubtaskContent,
  parseBoard,
  parseCard,
  progressOf,
  slugFileName,
  toggleCheck,
  withDescription,
  withLanes,
  withoutScalar,
  withScalar,
  type BoardFilter,
  type BoardNote,
  type CardNote,
  type FolderNote,
  type Lane,
} from "./board-model";

const PLUGIN_ID = "kanban";
const CSS_ID = "markable-kanban-styles";

interface VaultFile {
  path: string;
}

interface VaultApi {
  getActiveVault?: () => { name?: string; rootPaths?: string[] } | null;
  getVaultIndex?: () => { entries?: VaultFile[] } | null;
}

let _api: MarkablePluginAPI | null = null;
let _container: HTMLElement | null = null;
let _query = "";
const _filters = new Set<BoardFilter>();
let _boardPath = "";
let _openPath = "";
let _boards: BoardNote[] = [];
let _cards: CardNote[] = [];
let _focusSearch = false;
let _focusLane = "";
let _folder = "";
let _parent = "";
let _known: string[] = [];
let _mode: "pick" | "board" = "pick";
const _collapsedSubs = new Set<string>();
let _io: Promise<void> = Promise.resolve();
let _ioDepth = 0;
let _epoch = 0;
let _activeEpoch = 0;

function enqueue(task: () => Promise<void>): Promise<void> {
  if (_ioDepth > 0) return task();
  const epoch = _epoch;
  const run = _io.then(async () => {
    if (epoch !== _epoch) return;
    _activeEpoch = epoch;
    _ioDepth += 1;
    try {
      await task();
    } finally {
      _ioDepth -= 1;
    }
  });
  _io = run.then(() => undefined, () => undefined);
  return run;
}

function ioCurrent(): boolean {
  return _ioDepth === 0 || _activeEpoch === _epoch;
}

const LANE_COLORS = ["#e6a23c", "#e05a5a", "#3d9a6a", "#8b909a", "#4c78e8", "#7c6bb5"];

function vaultApi(): VaultApi | null {
  return (window as unknown as { __MARKABLE_VAULT_MANAGER__?: VaultApi }).__MARKABLE_VAULT_MANAGER__ ?? null;
}

function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(0, index) : "";
}

function basename(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  return `${dir}${sep}${name}`;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_file", { path });
  } catch {
    return null;
  }
}

async function writeText(path: string, content: string): Promise<void> {
  if (!ioCurrent()) return;
  await invoke("write_file", { path, content });
}

async function listMd(dir: string): Promise<string[]> {
  try {
    return await invoke<string[]>("list_md_files", { path: dir });
  } catch {
    return [];
  }
}

function activeVault(): { name: string; root: string } | null {
  const vault = vaultApi()?.getActiveVault?.() ?? null;
  const root = vault?.rootPaths?.[0] ?? "";
  if (root === "") return null;
  return { name: vault?.name?.trim() || "Vault", root };
}

function parentDir(): string {
  if (_parent !== "") return _parent;
  return activeVault()?.root ?? "";
}

async function ensureDir(path: string): Promise<void> {
  await invoke("ensure_directory", { path });
}

async function savePlaces(): Promise<void> {
  await _api?.saveSettings({ folder: _folder, folders: _known, parent: _parent }).catch(() => undefined);
}

async function rememberFolder(folder: string): Promise<void> {
  _folder = folder;
  if (folder !== "" && !_known.includes(folder)) _known.push(folder);
  await savePlaces();
}

async function cleanFolder(folder: string): Promise<string[]> {
  const names = await listMd(folder);
  const files: FolderNote[] = [];
  for (const name of names) {
    const content = await readText(joinPath(folder, name));
    if (content !== null) files.push({ name, content });
  }
  const cleaned = cleanProject(files, basename(folder) || DEFAULT_PROJECT_NAME);
  for (const file of cleaned.files) {
    const previous = files.find((item) => item.name === file.name)?.content;
    if (previous !== file.content) await writeText(joinPath(folder, file.name), file.content);
  }
  return cleaned.notes;
}

async function boardsInDirectory(dir: string): Promise<BoardNote[]> {
  const names = await listMd(dir);
  const boards: BoardNote[] = [];
  await Promise.all(names.map(async (name) => {
    const path = joinPath(dir, name);
    const content = await readText(path);
    if (content === null || !isBoardContent(content)) return;
    const board = parseBoard(content, path);
    if (board) boards.push(board);
  }));
  boards.sort((a, b) => a.title.localeCompare(b.title));
  return boards;
}

function injectCSS(): void {
  const existing = document.getElementById(CSS_ID);
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    body.has-custom-tab #custom-tab-host:has(.kb-root) {
      display: flex;
      flex-direction: column;
      padding: 16px 18px 12px;
      overflow: hidden;
    }
    .kb-root {
      display: flex;
      flex-direction: column;
      gap: 14px;
      flex: 1;
      min-height: 0;
      box-sizing: border-box;
      font-family: var(--ui-font, system-ui, sans-serif);
      font-size: 13px;
      color: var(--text-primary, inherit);
    }
    .kb-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
    .kb-toolbar input[type="search"] {
      flex: 0 1 280px;
      width: 280px;
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-secondary, #2a2a2e);
      color: inherit;
      font: inherit;
    }
    .kb-toolbar button {
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .kb-toolbar button[aria-pressed="true"] {
      background: var(--bg-tertiary, rgba(255, 255, 255, 0.08));
    }
    .kb-board {
      display: flex;
      gap: 12px;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow-x: auto;
      align-items: stretch;
      padding-bottom: 4px;
    }
    .kb-column {
      flex: 0 0 280px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-height: 100%;
      border: 1px solid var(--border-color, #333);
      border-top-width: 3px;
      border-radius: 12px;
      background: var(--bg-secondary, #2a2a2e);
      overflow: hidden;
    }
    .kb-column-title {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 10px 8px;
      font-weight: 600;
    }
    .kb-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: 0 0 auto;
      background: var(--text-secondary, #888);
    }
    .kb-column-count {
      margin-left: auto;
      min-width: 1.5em;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--bg-primary, #1e1e22);
      color: var(--text-secondary, #aaa);
      font-size: 12px;
      font-weight: 500;
      text-align: center;
    }
    .kb-chevron, .kb-more {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary, #888);
      font: inherit;
      cursor: pointer;
    }
    .kb-chevron { width: 28px; height: 28px; }
    .kb-twirl {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      display: block;
    }
    .kb-twirl-closed { transform: rotate(-90deg); }
    .kb-menu { position: relative; }
    .kb-menu-pop {
      position: absolute;
      right: 0;
      top: 26px;
      z-index: 3;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 148px;
      padding: 6px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-primary, #1c1c20);
    }
    .kb-menu-pop button, .kb-rename input {
      height: 28px;
      padding: 0 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .kb-menu-pop button:hover { background: var(--bg-secondary, #2a2a2e); }
    .kb-rename { flex: 1; min-width: 0; }
    .kb-rename input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--border-color, #3a3a3a);
      background: var(--bg-primary, #1c1c20);
      cursor: text;
    }
    .kb-color {
      width: 100%;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
    }
    .kb-cards {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 8px 8px;
      overflow-y: auto;
      min-height: 0;
    }
    .kb-card {
      padding: 10px 12px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 10px;
      background: var(--bg-primary, #1c1c20);
      cursor: pointer;
    }
    .kb-card-title {
      font-weight: 600;
      line-height: 1.35;
      word-break: break-word;
    }
    .kb-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .kb-tag {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--bg-tertiary, #34343c);
      color: var(--text-secondary, #c8c8c8);
      font-size: 12px;
      font-weight: 500;
    }
    .kb-card, .kb-nested, .kb-subcard { cursor: grab; touch-action: none; }
    .kb-card.kb-dragging, .kb-nested.kb-dragging, .kb-subcard.kb-dragging { opacity: 0.45; }
    .kb-card-head { display: flex; align-items: flex-start; gap: 8px; }
    .kb-card-head .kb-card-title, .kb-nested-title, .kb-subcard-open { flex: 1; min-width: 0; }
    .kb-grip {
      display: grid;
      grid-template-columns: 3px 3px;
      gap: 2px;
      flex: 0 0 8px;
      width: 8px;
      margin-top: 7px;
      cursor: grab;
    }
    .kb-nested .kb-grip, .kb-subcard .kb-grip { margin-top: 0; }
    .kb-grip span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: #5a5a62;
    }
    .kb-insert {
      position: fixed;
      z-index: 80;
      height: 3px;
      margin: 0;
      border-radius: 999px;
      background: #7aa2ff;
      pointer-events: none;
    }
    .kb-ghost {
      position: fixed;
      z-index: 81;
      max-width: 220px;
      padding: 6px 10px;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      background: #2a2a2e;
      color: #e8e8e8;
      font: 600 13px sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
    }
    .kb-card-wrap { display: flex; flex-direction: column; }
    .kb-sub-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text-secondary, #9a9a9a);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .kb-nested-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
    }
    .kb-nested {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-left-width: 3px;
      border-radius: 8px;
      background: var(--bg-primary, #1c1c20);
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-align: left;
    }
    .kb-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
    }
    .kb-bar {
      flex: 1;
      height: 4px;
      border-radius: 999px;
      background: var(--border-color, #444);
      overflow: hidden;
    }
    .kb-bar > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #3d9a6a;
    }
    .kb-frac {
      color: var(--text-secondary, #9a9a9a);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .kb-add { padding: 2px 8px 8px; }
    .kb-add input {
      width: 100%;
      height: 28px;
      padding: 0 4px;
      border: none;
      background: transparent;
      color: var(--text-secondary, #9a9a9a);
      font: inherit;
    }
    .kb-add input:focus { outline: none; color: inherit; }
    .kb-flags { display: flex; gap: 8px; flex-wrap: wrap; }
    .kb-add-col {
      flex: 0 0 auto;
      align-self: flex-start;
      height: 32px;
      margin-top: 4px;
      padding: 0 8px;
      border: none;
      background: transparent;
      color: var(--text-secondary, #9a9a9a);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .kb-lane-add {
      flex: 0 0 180px;
      align-self: flex-start;
      margin-top: 4px;
    }
    .kb-lane-add input {
      width: 100%;
      height: 32px;
      padding: 0 8px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-secondary, #2a2a2e);
      color: inherit;
      font: inherit;
    }
    .kb-detail {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .kb-detail input[type="text"] {
      width: 100%;
      height: 26px;
      box-sizing: border-box;
      padding: 0 8px;
      border: 1px solid var(--border-color, #444);
      border-radius: 6px;
      background: var(--bg-secondary, #2a2a2e);
      color: inherit;
      font: inherit;
    }
    .kb-task-list,
    .kb-subcards {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .kb-subcards { margin-bottom: 8px; }
    .kb-check {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .kb-panel .kb-check input[type="checkbox"] {
      width: 18px;
      height: 18px;
      flex: 0 0 18px;
      margin: 0;
      padding: 0;
    }
    .kb-meta { color: var(--text-secondary, #9a9a9a); word-break: break-word; }
    .kb-stage {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
      gap: 12px;
      align-items: stretch;
      overflow: hidden;
    }
    .kb-card-open { outline: 2px solid; outline-offset: 0; }
    .kb-panel {
      flex: 0 0 360px;
      min-width: 280px;
      overflow: auto;
      border: 1px solid var(--border-color, #333);
      border-radius: 12px;
      background: var(--bg-secondary, #2a2a2e);
      padding: 12px 14px 18px;
      box-sizing: border-box;
    }
    .kb-panel-head { display: flex; align-items: flex-start; gap: 8px; }
    .kb-panel-title { flex: 1; margin: 0; font-size: 16px; line-height: 1.35; font-weight: 650; }
    .kb-panel-close {
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary, #aaa);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .kb-field { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
    .kb-field-label {
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-secondary, #9a9a9a);
    }
    .kb-color-row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 28px;
    }
    .kb-swatch-hit {
      position: relative;
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
      margin: 0;
      cursor: pointer;
    }
    .kb-swatch {
      display: block;
      width: 28px;
      height: 28px;
      box-sizing: border-box;
      border: 1px solid var(--border-color, #555);
      border-radius: 6px;
    }
    .kb-swatch-empty {
      background:
        linear-gradient(135deg, transparent 46%, #666 46%, #666 54%, transparent 54%),
        var(--bg-primary, #1c1c20);
    }
    .kb-panel .kb-field .kb-color-input {
      position: absolute;
      inset: 0;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      border: 0;
      opacity: 0;
      cursor: pointer;
    }
    .kb-color-row button {
      display: inline-flex;
      align-items: center;
      height: 28px;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text-secondary, #9a9a9a);
      font: inherit;
      line-height: 28px;
      cursor: pointer;
    }
    .kb-field input, .kb-field select, .kb-field textarea, .kb-panel .kb-detail-add input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-primary, #1c1c20);
      color: inherit;
      font: inherit;
      padding: 6px 8px;
    }
    .kb-field textarea { min-height: 88px; resize: vertical; }
    .kb-pair { display: flex; gap: 8px; }
    .kb-pair > .kb-field { flex: 1; margin-top: 10px; }
    .kb-section { margin-top: 20px; }
    .kb-file-name { color: var(--text-secondary, #aaa); word-break: break-all; }
    .kb-history { margin-top: 12px; color: var(--text-secondary, #aaa); white-space: pre-wrap; }
    .kb-history summary {
      display: flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      cursor: pointer;
      list-style: none;
      font-weight: 600;
    }
    .kb-history summary::-webkit-details-marker { display: none; }
    .kb-history summary::marker { content: ""; }
    .kb-history[open] > summary .kb-twirl { transform: none; }
    .kb-pane-subs { display: flex; flex-direction: column; gap: 12px; }
    .kb-subcard {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 8px 10px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-primary, #1c1c20);
      color: inherit;
    }
    .kb-subcard-open {
      flex: 1;
      min-width: 0;
      padding: 0;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .kb-pick {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .kb-pick button {
      height: 36px;
      padding: 0 16px;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-secondary, #2a2a2e);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, title: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.title = title;
  if (pressed) node.setAttribute("aria-pressed", "true");
  node.addEventListener("click", onClick);
  return node;
}

async function load(): Promise<void> {
  if (_mode === "board" && _folder !== "") {
    await cleanFolder(_folder);
  }
  if (_mode !== "board" || _folder === "") {
    _boards = [];
    _cards = [];
    return;
  }
  const boards = await boardsInDirectory(_folder);
  _boards = boards;
  if (boards.length === 0) {
    _cards = [];
    return;
  }
  if (!_boardPath || !boards.some((board) => board.path === _boardPath)) {
    _boardPath = boards[0].path;
  }
  const board = boards.find((item) => item.path === _boardPath) ?? boards[0];
  _cards = await loadCards(board);
}

async function loadCards(board: BoardNote): Promise<CardNote[]> {
  const dir = dirname(board.path);
  const names = await listMd(dir);
  const cards: CardNote[] = [];
  await Promise.all(names.map(async (name) => {
    if (name === basename(board.path)) return;
    const path = joinPath(dir, name);
    const content = await readText(path);
    if (content === null || isBoardContent(content)) return;
    const card = parseCard(content, path);
    if (card.status.trim() === "") return;
    cards.push(card);
  }));
  cards.sort((a, b) => orderRank(a) - orderRank(b) || a.title.localeCompare(b.title));
  return cards;
}

function orderRank(card: CardNote): number {
  if (card.order.trim() === "") return 0;
  const value = Number(card.order);
  return Number.isFinite(value) ? value : 0;
}

function nextOrder(status: string): number {
  const ranks = _cards
    .filter((card) => card.status === status && card.order.trim() !== "")
    .map((card) => Number(card.order))
    .filter((value) => Number.isFinite(value));
  return (ranks.length === 0 ? 0 : Math.max(...ranks)) + 1;
}

function commentLine(text: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `_${stamp}:_ ${text}`;
}

function onBoardKey(event: KeyboardEvent): void {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable)
  ) return;
  const search = _container?.querySelector<HTMLInputElement>("input[type=search]");
  if (!search) return;
  event.preventDefault();
  search.focus();
}

function paint(): void {
  document.querySelector(".kb-menu-pop")?.remove();
  document.querySelector(".kb-insert")?.remove();
  if (_container === null) return;
  const container = _container;
  container.innerHTML = "";
  const root = el("div", "kb-root");
  container.appendChild(root);
  if (_mode === "pick" || _boards.length === 0) {
    renderHome(root);
    return;
  }
  const board = _boards.find((item) => item.path === _boardPath) ?? _boards[0];
  renderToolbar(root);
  const stage = el("div", "kb-stage");
  root.appendChild(stage);
  renderLanes(stage, board, _cards);
  const open = _cards.find((card) => card.path === _openPath);
  if (open && cardVisible(open, childrenOf(open), _query, _filters, todayIso())) {
    stage.appendChild(renderPanel(board, open, childrenOf(open)));
  }
  if (_focusSearch) {
    const search = root.querySelector<HTMLInputElement>("input[type=search]");
    search?.focus();
    const end = search?.value.length ?? 0;
    search?.setSelectionRange(end, end);
    _focusSearch = false;
  }
}

function present(): void {
  if (!ioCurrent()) return;
  const api = _api;
  if (api === null) return;
  api.openCustomRenderTab("Project", (host) => {
    _container = host;
    paint();
  });
}

async function refresh(): Promise<void> {
  await load();
  present();
}

function renderHome(root: HTMLElement): void {
  const home = el("div", "kb-pick");
  home.appendChild(button("Choose a folder", "Open a project folder", false, () => {
    void chooseFolder();
  }));
  root.appendChild(home);
}

function renderToolbar(root: HTMLElement): void {
  const bar = el("div", "kb-toolbar");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search cards… (press /)";
  search.setAttribute("aria-label", "Search cards");
  search.value = _query;
  search.addEventListener("input", () => {
    _query = search.value;
    _focusSearch = true;
    paint();
  });
  bar.appendChild(search);
  const filters: Array<{ id: BoardFilter; label: string }> = [
    { id: "overdue", label: "Overdue" },
    { id: "due-soon", label: "Due soon" },
    { id: "blocked", label: "Blocked" },
    { id: "unread", label: "Unread" },
  ];
  for (const filter of filters) {
    bar.appendChild(button(filter.label, filter.label, _filters.has(filter.id), () => {
      if (_filters.has(filter.id)) _filters.delete(filter.id);
      else _filters.add(filter.id);
      paint();
    }));
  }
  root.appendChild(bar);
}

function renderLanes(root: HTMLElement, board: BoardNote, cards: CardNote[]): void {
  const grouped = groupByParent(cards);
  const today = todayIso();
  const boardEl = el("div", "kb-board");
  for (const lane of board.lanes) {
    if (lane.hidden) continue;
    const inLane = grouped.filter((row) => row.card.status === lane.title);
    const visible = inLane.filter((row) => cardVisible(row.card, row.children, _query, _filters, today));
    boardEl.appendChild(renderLane(board, lane, visible));
  }
  const addColumn = button("+ Add column", "Add a column", false, () => {
    const form = el("form", "kb-lane-add");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Column name";
    input.setAttribute("aria-label", "New column name");
    form.appendChild(input);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (title === "" || board.lanes.some((lane) => lane.title === title)) return;
      const color = LANE_COLORS[board.lanes.length % LANE_COLORS.length];
      const lanes: Lane[] = [...board.lanes, { title, color, collapsed: false, hidden: false }];
      void updateBoard(board.path, (content) => withLanes(content, lanes));
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") paint();
    });
    addColumn.replaceWith(form);
    input.focus();
  });
  addColumn.className = "kb-add-col";
  boardEl.appendChild(addColumn);
  root.appendChild(boardEl);
  const hidden = board.lanes.filter((lane) => lane.hidden);
  if (hidden.length > 0) {
    const restore = el("div", "kb-flags");
    for (const lane of hidden) {
      restore.appendChild(button(`Show ${lane.title}`, `Show ${lane.title}`, false, () => {
        void writeLanes(board, board.lanes.map((item) => (
          item.title === lane.title ? { ...item, hidden: false } : item
        )));
      }));
    }
    (root.parentElement ?? root).appendChild(restore);
  }
}

function renderLane(
  board: BoardNote,
  lane: Lane,
  rows: Array<{ card: CardNote; children: CardNote[] }>,
): HTMLElement {
  const col = el("section", "kb-column");
  col.style.borderTopColor = lane.color || "var(--border-color, #ddd)";
  col.setAttribute("aria-label", lane.title);

  const heading = el("div", "kb-column-title");
  const dot = el("span", "kb-dot");
  if (lane.color) dot.style.background = lane.color;
  const collapse = button("", lane.collapsed ? "Expand column" : "Collapse column", false, () => {
    void writeLanes(board, board.lanes.map((item) => (
      item.title === lane.title ? { ...item, collapsed: !item.collapsed } : item
    )));
  });
  collapse.className = "kb-chevron";
  collapse.appendChild(twirl(!lane.collapsed));
  const title = el("span", "kb-rename", lane.title);
  title.addEventListener("dblclick", () => beginRename(board, lane, title));
  const more = button("⋯", "Column options", false, () => openLaneMenu(board, lane, more));
  more.className = "kb-more";
  heading.append(dot, title, el("span", "kb-column-count", String(rows.length)), collapse, more);
  col.appendChild(heading);

  if (!lane.collapsed) {
    const list = el("div", "kb-cards");
    for (const row of rows) list.appendChild(renderCard(row.card, row.children, lane.color));
    const form = el("form", "kb-add");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "+ Add a card";
    input.setAttribute("aria-label", `Add a card to ${lane.title}`);
    form.appendChild(input);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const titleText = input.value.trim();
      if (titleText === "") return;
      void createCard(board, lane.title, titleText);
    });
    col.append(list, form);
    if (_focusLane === lane.title) {
      input.focus();
      _focusLane = "";
    }
  }
  return col;
}

function renderCard(card: CardNote, children: CardNote[], laneColor: string): HTMLElement {
  const wrap = el("div", "kb-card-wrap");
  wrap.dataset.path = card.path;
  const article = el("article", "kb-card");
  article.dataset.path = card.path;
  if (_openPath === card.path) {
    article.classList.add("kb-card-open");
    article.style.outlineColor = laneColor || "#888888";
  }
  if (card.color) article.style.background = card.color;
  if (card.border) {
    article.style.borderColor = card.border;
    article.style.borderWidth = "2px";
  }
  article.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, button, textarea, a, label, form, .kb-grip")) return;
    const opening = _openPath !== card.path;
    _openPath = opening ? card.path : "";
    paint();
    if (opening && card.unread) {
      void updateCard(card.path, (content) => withScalar(content, "unread", "no"));
    }
  });

  const head = el("div", "kb-card-head");
  head.append(el("div", "kb-card-title", card.title), grip());
  article.appendChild(head);
  bindPointerDrag(article, card.path, "card");
  const pills = [...card.tags];
  if (card.assignee && !pills.includes(card.assignee)) pills.push(card.assignee);
  if (card.priority && !pills.includes(card.priority)) pills.unshift(card.priority);
  if (pills.length > 0) {
    const tags = el("div", "kb-tags");
    for (const tag of pills) tags.appendChild(el("span", "kb-tag", tag));
    article.appendChild(tags);
  }
  const progress = progressOf(card, children);
  if (progress.total > 0) {
    const row = el("div", "kb-progress");
    const bar = el("div", "kb-bar");
    const fill = el("span", "");
    const pct = Math.round((progress.done / progress.total) * 100);
    fill.style.width = `${pct}%`;
    fill.style.background = laneColor || "#3d9a6a";
    bar.appendChild(fill);
    row.append(bar, el("span", "kb-frac", `${progress.done}/${progress.total}`));
    article.appendChild(row);
  }
  wrap.appendChild(article);
  if (children.length > 0) {
    const collapsed = _collapsedSubs.has(card.path);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "kb-sub-toggle";
    toggle.title = collapsed ? "Show subcards" : "Hide subcards";
    toggle.append(twirl(!collapsed), document.createTextNode("Subcards"));
    toggle.addEventListener("click", () => {
      if (collapsed) _collapsedSubs.delete(card.path);
      else _collapsedSubs.add(card.path);
      paint();
    });
    article.appendChild(toggle);
    if (!collapsed) article.appendChild(nestedList(card, children, laneColor));
  }
  return wrap;
}

function nestedList(card: CardNote, children: CardNote[], laneColor: string): HTMLElement {
  const list = el("div", "kb-nested-list");
  list.dataset.parent = card.path;
  for (const child of children) {
    const nested = document.createElement("button");
    nested.type = "button";
    nested.className = "kb-nested kb-sort-item";
    nested.dataset.path = child.path;
    nested.append(el("span", "kb-nested-title", child.title), grip());
    const stripe = child.border || child.color || laneColor;
    if (stripe) nested.style.borderLeftColor = stripe;
    nested.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest(".kb-grip")) return;
      _openPath = child.path;
      paint();
    });
    bindPointerDrag(nested, child.path, "sub");
    list.appendChild(nested);
  }
  return list;
}

function childrenOf(card: CardNote): CardNote[] {
  const stem = card.fileName.replace(/\.md$/i, "").toLowerCase();
  return _cards.filter((item) => {
    const parent = item.parent.trim().toLowerCase();
    return parent === card.fileName.toLowerCase() || parent === stem || parent === `${stem}.md`;
  }).sort((a, b) => orderRank(a) - orderRank(b) || a.title.localeCompare(b.title));
}

function insertAt(items: CardNote[], dragged: CardNote, beforePath: string | null): CardNote[] {
  const rest = items.filter((item) => item.path !== dragged.path);
  if (beforePath === null) return [...rest, dragged];
  const index = rest.findIndex((item) => item.path === beforePath);
  if (index < 0) return [...rest, dragged];
  return [...rest.slice(0, index), dragged, ...rest.slice(index)];
}

function twirl(open: boolean): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", open ? "kb-twirl" : "kb-twirl kb-twirl-closed");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3.5 6 L8 10.5 L12.5 6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.75");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function grip(): HTMLElement {
  const handle = el("span", "kb-grip");
  handle.title = "Drag to reorder";
  handle.setAttribute("aria-hidden", "true");
  for (let dot = 0; dot < 6; dot += 1) handle.appendChild(el("span", ""));
  return handle;
}

interface PointerDrag {
  path: string;
  kind: "card" | "sub";
  source: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  before: string | null;
  status: string;
  armed: boolean;
  ghost: HTMLElement | null;
  line: HTMLElement | null;
}

let _pointer: PointerDrag | null = null;

function childOfList(list: HTMLElement, path: string): boolean {
  const parent = _cards.find((card) => card.path === (list.dataset.parent ?? ""));
  if (!parent || path === "") return false;
  return childrenOf(parent).some((card) => card.path === path);
}

const _suppressClick = new WeakSet<HTMLElement>();

function bindPointerDrag(source: HTMLElement, path: string, kind: "card" | "sub"): void {
  source.addEventListener("click", (event) => {
    if (!_suppressClick.has(source)) return;
    _suppressClick.delete(source);
    event.preventDefault();
    event.stopPropagation();
  }, true);
  source.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || _pointer) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (kind === "card" && target instanceof HTMLElement && target.closest(".kb-nested, .kb-sub-toggle, input, textarea, select, a, label, button")) return;
    _pointer = {
      path,
      kind,
      source,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      before: null,
      status: "",
      armed: false,
      ghost: null,
      line: null,
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  });
}

function onPointerMove(event: PointerEvent): void {
  const drag = _pointer;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.source.classList.add("kb-dragging");
    const label = drag.source.querySelector(".kb-card-title, .kb-nested-title, .kb-subcard-open")?.textContent ?? "";
    drag.ghost = el("div", "kb-ghost", label);
    drag.line = el("div", "kb-insert");
    document.body.append(drag.ghost, drag.line);
    document.body.style.userSelect = "none";
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY + 8}px`;
  }
  moveInsertion(drag, event.clientX, event.clientY);
}

function moveInsertion(drag: PointerDrag, x: number, y: number): void {
  const line = drag.line;
  if (!line) return;
  const hit = document.elementFromPoint(x, y);
  drag.armed = false;
  drag.before = null;
  drag.status = "";
  if (drag.kind === "sub") {
    const list = hit instanceof Element ? hit.closest<HTMLElement>(".kb-nested-list, .kb-pane-subs") : null;
    if (!list || !childOfList(list, drag.path)) {
      line.style.display = "none";
      return;
    }
    const items = [...list.querySelectorAll<HTMLElement>(":scope > .kb-sort-item")];
    const slot = slotAt(items, list, y, drag.path);
    drag.before = slot.before;
    drag.armed = true;
    paintLine(line, slot, list.closest(".kb-column"));
    return;
  }
  const column = hit instanceof Element ? hit.closest<HTMLElement>(".kb-column") : null;
  const list = column?.querySelector<HTMLElement>(":scope > .kb-cards") ?? null;
  if (!column || !list) {
    line.style.display = "none";
    return;
  }
  const items = [...list.querySelectorAll<HTMLElement>(":scope > .kb-card-wrap")];
  const slot = slotAt(items, list, y, drag.path);
  drag.before = slot.before;
  drag.status = column.getAttribute("aria-label") ?? "";
  drag.armed = drag.status !== "";
  paintLine(line, slot, column);
}

function slotAt(items: HTMLElement[], list: HTMLElement, clientY: number, selfPath: string): { before: string | null; top: number; left: number; width: number } {
  const listRect = list.getBoundingClientRect();
  const others = items.filter((item) => (item.dataset.path ?? "") !== "" && item.dataset.path !== selfPath);
  const width = Math.max(listRect.width - 16, 24);
  const left = listRect.left + 8;
  if (others.some((item) => item.getBoundingClientRect().height > 0)) {
    for (const item of others) {
      const rect = item.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return { before: item.dataset.path ?? null, top: rect.top, left, width };
      }
    }
    const last = others[others.length - 1].getBoundingClientRect();
    return { before: null, top: last.bottom, left, width };
  }
  return { before: null, top: listRect.bottom, left, width };
}

function paintLine(line: HTMLElement, slot: { before: string | null; top: number; left: number; width: number }, column: Element | null): void {
  line.style.display = "block";
  line.style.left = `${slot.left}px`;
  line.style.top = `${slot.top - 2}px`;
  line.style.width = `${slot.width}px`;
  line.dataset.before = slot.before ?? "";
  line.dataset.drop = "yes";
  if (column instanceof HTMLElement && column.style.borderTopColor) line.style.background = column.style.borderTopColor;
}

function onPointerUp(event: PointerEvent): void {
  finishPointer(event, true);
}

function onPointerCancel(event: PointerEvent): void {
  finishPointer(event, false);
}

function finishPointer(event: PointerEvent, commit: boolean): void {
  const drag = _pointer;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { path, kind, moved, before, status, armed } = drag;
  clearPointer();
  if (moved) _suppressClick.add(drag.source);
  if (!commit || !moved || !armed) return;
  if (kind === "sub") {
    void reorderSubcards(path, before);
    return;
  }
  if (status !== "") void reorderLaneCard(path, status, before);
}

function clearPointer(): void {
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  document.removeEventListener("pointercancel", onPointerCancel);
  _pointer?.source.classList.remove("kb-dragging");
  _pointer?.ghost?.remove();
  _pointer?.line?.remove();
  document.body.style.userSelect = "";
  _pointer = null;
}

async function reorderLaneCard(path: string, status: string, before: string | null): Promise<void> {
  const dragged = _cards.find((card) => card.path === path);
  if (!dragged || dragged.parent.trim() !== "") return;
  const laneCards = groupByParent(_cards)
    .filter((row) => row.card.status === status)
    .map((row) => row.card);
  const next = insertAt(laneCards, dragged, before);
  await placeCards(next.map((card, index) => ({ path: card.path, status, order: index + 1 })));
}

async function reorderSubcards(path: string, before: string | null): Promise<void> {
  const dragged = _cards.find((card) => card.path === path);
  const parent = _cards.find((card) => childrenOf(card).some((child) => child.path === path));
  if (!dragged || !parent) return;
  const next = insertAt(childrenOf(parent), dragged, before);
  await placeCards(next.map((card, index) => ({ path: card.path, status: card.status, order: index + 1 })));
}

async function placeCards(entries: Array<{ path: string; status: string; order: number }>): Promise<void> {
  await enqueue(async () => {
    for (const entry of entries) {
      const content = await readText(entry.path);
      if (content === null) continue;
      const current = parseCard(content, entry.path);
      let next = current.status === entry.status ? content : moveToLane(content, entry.status);
      next = withScalar(next, "order", String(entry.order));
      if (next !== content) await writeText(entry.path, next);
    }
    await refresh();
  });
}

function moveToLane(content: string, status: string): string {
  const current = parseCard(content, "card.md").status;
  let next = withScalar(withScalar(content, "status", status), "unread", "no");
  if (current !== status) {
    const from = current.trim() === "" ? "an empty status" : current;
    next = appendSectionLine(next, "## History", `Moved from ${from} to ${status}.`);
  }
  return next;
}

function saveOnBlur(input: HTMLInputElement | HTMLTextAreaElement, current: string, write: (value: string) => void): void {
  input.addEventListener("blur", () => {
    if (input.value !== current) write(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Enter" || !(input instanceof HTMLInputElement)) return;
    event.preventDefault();
    input.blur();
  });
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", "kb-field");
  wrap.append(el("span", "kb-field-label", label), control);
  return wrap;
}

function cardColorField(card: CardNote, label: string, key: "color" | "border", value: string): HTMLElement {
  const wrap = el("div", "kb-field");
  wrap.appendChild(el("span", "kb-field-label", label));
  const row = el("div", "kb-color-row");
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "";
  const hit = el("label", "kb-swatch-hit");
  const swatch = el("span", hex === "" ? "kb-swatch kb-swatch-empty" : "kb-swatch");
  if (hex !== "") swatch.style.background = hex;
  const input = document.createElement("input");
  input.type = "color";
  input.className = "kb-color-input";
  input.value = hex === "" ? "#888888" : hex;
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => {
    swatch.classList.remove("kb-swatch-empty");
    swatch.style.background = input.value;
  });
  input.addEventListener("change", () => {
    void updateCard(card.path, (content) => withScalar(content, key, input.value));
  });
  hit.append(swatch, input);
  row.append(
    hit,
    button("Clear", `Clear ${label.toLowerCase()}`, false, () => {
      void updateCard(card.path, (content) => withoutScalar(content, key));
    }),
  );
  wrap.appendChild(row);
  return wrap;
}

function textField(label: string, value: string, kind: "text" | "date", write: (value: string) => void): HTMLElement {
  const input = document.createElement("input");
  input.type = kind;
  input.value = value;
  input.setAttribute("aria-label", label);
  saveOnBlur(input, value, write);
  return labeled(label, input);
}

function renderPanel(board: BoardNote, card: CardNote, children: CardNote[]): HTMLElement {
  const panel = el("aside", "kb-panel");
  panel.setAttribute("aria-label", card.title);
  const head = el("div", "kb-panel-head");
  const title = el("h2", "kb-panel-title", card.title);
  const close = button("×", "Close card", false, () => {
    _openPath = "";
    paint();
  });
  close.className = "kb-panel-close";
  head.append(title, close);
  panel.appendChild(head);

  const file = el("div", "kb-field");
  const fileInput = document.createElement("input");
  fileInput.type = "text";
  fileInput.value = card.fileName;
  fileInput.setAttribute("aria-label", "File name");
  saveOnBlur(fileInput, card.fileName, (value) => {
    void renameCard(card, value);
  });
  file.append(el("span", "kb-field-label", "File name"), fileInput);
  panel.appendChild(file);
  panel.appendChild(textField("Title", card.title, "text", (value) => {
    void updateCard(card.path, (content) => withScalar(content, "title", value.trim() || card.title));
  }));

  const status = document.createElement("select");
  status.setAttribute("aria-label", "Status");
  for (const lane of board.lanes) {
    const option = document.createElement("option");
    option.value = lane.title;
    option.textContent = lane.title;
    if (lane.title === card.status) option.selected = true;
    status.appendChild(option);
  }
  if (!board.lanes.some((lane) => lane.title === card.status) && card.status.trim() !== "") {
    const option = document.createElement("option");
    option.value = card.status;
    option.textContent = card.status;
    option.selected = true;
    status.appendChild(option);
  }
  status.addEventListener("change", () => {
    const order = String(nextOrder(status.value));
    void updateCard(card.path, (content) => withScalar(moveToLane(content, status.value), "order", order));
  });
  panel.appendChild(labeled("Status", status));

  const pair = el("div", "kb-pair");
  pair.append(
    textField("Priority", card.priority, "text", (value) => {
      void updateCard(card.path, (content) => value.trim() === ""
        ? withoutScalar(content, "priority")
        : withScalar(content, "priority", value.trim()));
    }),
    textField("Due", card.due, "date", (value) => {
      void updateCard(card.path, (content) => value.trim() === ""
        ? withoutScalar(content, "due")
        : withScalar(content, "due", value.trim()));
    }),
  );
  panel.appendChild(pair);
  panel.appendChild(textField("Assignee", card.assignee, "text", (value) => {
    void updateCard(card.path, (content) => value.trim() === ""
      ? withoutScalar(content, "assignee")
      : withScalar(content, "assignee", value.trim()));
  }));
  panel.appendChild(textField("Tags", card.tags.join(", "), "text", (value) => {
    void updateCard(card.path, (content) => value.trim() === ""
      ? withoutScalar(content, "tags")
      : withScalar(content, "tags", value.trim()));
  }));
  const colors = el("div", "kb-pair");
  colors.append(
    cardColorField(card, "Fill", "color", card.color),
    cardColorField(card, "Border", "border", card.border),
  );
  panel.appendChild(colors);

  const description = document.createElement("textarea");
  description.value = card.description;
  description.setAttribute("aria-label", "Description");
  saveOnBlur(description, card.description, (value) => {
    void updateCard(card.path, (content) => withDescription(content, value));
  });
  panel.appendChild(labeled("Description", description));

  const todos = el("section", "kb-section kb-task-list");
  todos.appendChild(el("div", "kb-field-label", "Task List"));
  for (const item of card.checks) {
    const row = el("label", "kb-check");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.done;
    box.addEventListener("change", () => {
      void updateCard(card.path, (text) => toggleCheck(text, item.bodyLineIndex));
    });
    row.append(box, document.createTextNode(item.text));
    todos.appendChild(row);
  }
  todos.appendChild(addRow("Add a task...", "Add a task", (text) => {
    void updateCard(card.path, (body) => addCheckItem(body, text));
  }));
  panel.appendChild(todos);

  const subs = el("section", "kb-section kb-subcards");
  subs.appendChild(el("div", "kb-field-label", "Subcards"));
  const subList = el("div", "kb-pane-subs");
  subList.dataset.parent = card.path;
  for (const child of children) {
    const row = el("div", "kb-subcard kb-sort-item");
    row.dataset.path = child.path;
    const open = el("button", "kb-subcard-open", child.title);
    open.type = "button";
    open.addEventListener("click", () => {
      _openPath = child.path;
      paint();
    });
    row.append(open, grip());
    bindPointerDrag(row, child.path, "sub");
    subList.appendChild(row);
  }
  subs.appendChild(subList);
  subs.appendChild(addRow("Add a subcard...", "Add a subcard", (text) => {
    void createSubtask(card, text);
  }));
  panel.appendChild(subs);

  const blocked = document.createElement("select");
  blocked.setAttribute("aria-label", "Blocked by");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Nothing";
  blocked.appendChild(none);
  for (const other of _cards) {
    if (other.path === card.path) continue;
    const option = document.createElement("option");
    option.value = other.fileName;
    option.textContent = other.title;
    if (card.blockedBy === other.fileName || card.blockedBy === other.title) option.selected = true;
    blocked.appendChild(option);
  }
  blocked.addEventListener("change", () => {
    void updateCard(card.path, (content) => blocked.value === ""
      ? withoutScalar(content, "blocked-by")
      : withScalar(content, "blocked-by", blocked.value));
  });
  panel.appendChild(labeled("Blocked by", blocked));

  const blocking = _cards.filter((other) => other.blockedBy === card.fileName || other.blockedBy === card.title);
  if (blocking.length > 0) {
    const list = el("div", "kb-field");
    list.append(el("span", "kb-field-label", "Blocks"), el("div", "kb-meta", blocking.map((other) => other.title).join(", ")));
    panel.appendChild(list);
  }

  for (const custom of card.custom) {
    panel.appendChild(textField(custom.key, custom.value, "text", (value) => {
      void updateCard(card.path, (content) => value.trim() === ""
        ? withoutScalar(content, custom.key)
        : withScalar(content, custom.key, value.trim()));
    }));
  }

  const comments = el("section", "kb-section");
  comments.appendChild(el("div", "kb-field-label", "Comments"));
  if (card.comments) comments.appendChild(el("div", "kb-meta", card.comments));
  comments.appendChild(addRow("Write a comment...", "Write a comment", (text) => {
    void updateCard(card.path, (content) => appendSectionLine(content, "## Comments", commentLine(text)));
  }));
  panel.appendChild(comments);

  const history = el("details", "kb-history");
  const historySummary = el("summary", "");
  historySummary.append(twirl(false), document.createTextNode("History"));
  history.append(historySummary, document.createTextNode(card.history || "No history yet."));
  panel.appendChild(history);
  return panel;
}

function addRow(placeholder: string, label: string, onAdd: (text: string) => void): HTMLFormElement {
  const form = el("form", "kb-detail-add");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  form.appendChild(input);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text === "") return;
    onAdd(text);
  });
  return form;
}

function beginRename(board: BoardNote, lane: Lane, title: HTMLElement): void {
  const input = document.createElement("input");
  input.type = "text";
  input.value = lane.title;
  input.setAttribute("aria-label", `Rename ${lane.title}`);
  title.replaceWith(input);
  input.focus();
  input.select();
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const next = input.value.trim();
    if (next === "" || next === lane.title || board.lanes.some((item) => item.title === next)) {
      paint();
      return;
    }
    void renameLane(board, lane.title, next);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") paint();
  });
  input.addEventListener("blur", commit);
}

function openLaneMenu(board: BoardNote, lane: Lane, anchor: HTMLElement): void {
  const existing = document.querySelector(".kb-menu-pop");
  if (existing) {
    existing.remove();
    return;
  }
  const pop = el("div", "kb-menu-pop");
  const rect = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${Math.max(8, rect.right - 160)}px`;
  pop.style.right = "auto";
  pop.style.zIndex = "40";
  const index = board.lanes.findIndex((item) => item.title === lane.title);
  const item = (label: string, run: () => void) => {
    const node = button(label, label, false, () => {
      pop.remove();
      run();
    });
    pop.appendChild(node);
  };
  item("Rename", () => {
    const title = anchor.parentElement?.querySelector(".kb-rename");
    if (title instanceof HTMLElement) beginRename(board, lane, title);
  });
  if (index > 0) {
    item("Move left", () => {
      const lanes = [...board.lanes];
      const [moved] = lanes.splice(index, 1);
      lanes.splice(index - 1, 0, moved);
      void writeLanes(board, lanes);
    });
  }
  if (index >= 0 && index < board.lanes.length - 1) {
    item("Move right", () => {
      const lanes = [...board.lanes];
      const [moved] = lanes.splice(index, 1);
      lanes.splice(index + 1, 0, moved);
      void writeLanes(board, lanes);
    });
  }
  item(lane.hidden ? "Show" : "Hide", () => {
    void writeLanes(board, board.lanes.map((entry) => (
      entry.title === lane.title ? { ...entry, hidden: !entry.hidden } : entry
    )));
  });
  if (board.lanes.length > 1) {
    item("Delete", () => {
      void deleteLane(board, lane);
    });
  }
  const color = document.createElement("input");
  color.type = "color";
  color.className = "kb-color";
  color.value = /^#[0-9a-fA-F]{6}$/.test(lane.color) ? lane.color : "#888888";
  color.setAttribute("aria-label", `Color for ${lane.title}`);
  color.addEventListener("change", () => {
    void writeLanes(board, board.lanes.map((entry) => (
      entry.title === lane.title ? { ...entry, color: color.value } : entry
    )));
  });
  pop.appendChild(color);
  document.body.appendChild(pop);
}

async function writeLanes(board: BoardNote, lanes: Lane[]): Promise<void> {
  await updateBoard(board.path, (content) => withLanes(content, lanes));
}

async function renameLane(board: BoardNote, from: string, to: string): Promise<void> {
  await enqueue(async () => {
    const lanes = board.lanes.map((lane) => (lane.title === from ? { ...lane, title: to } : lane));
    const writes: Array<{ path: string; content: string }> = [];
    for (const card of _cards.filter((item) => item.status === from)) {
      const content = await readText(card.path);
      if (content === null) continue;
      writes.push({ path: card.path, content: withScalar(content, "status", to) });
    }
    await commitBoard(board, lanes, writes);
  });
}

async function deleteLane(board: BoardNote, lane: Lane): Promise<void> {
  await enqueue(async () => {
    const index = board.lanes.findIndex((item) => item.title === lane.title);
    if (index < 0 || board.lanes.length < 2) return;
    const fallback = board.lanes[index === 0 ? 1 : index - 1].title;
    const lanes = board.lanes.filter((item) => item.title !== lane.title);
    const writes: Array<{ path: string; content: string }> = [];
    let order = nextOrder(fallback);
    for (const card of _cards.filter((item) => item.status === lane.title)) {
      const content = await readText(card.path);
      if (content === null) continue;
      writes.push({
        path: card.path,
        content: withScalar(moveToLane(content, fallback), "order", String(order)),
      });
      order += 1;
    }
    await commitBoard(board, lanes, writes);
  });
}

async function commitBoard(
  board: BoardNote,
  lanes: Lane[],
  writes: Array<{ path: string; content: string }>,
): Promise<void> {
  await enqueue(async () => {
    const content = await readText(board.path);
    if (content === null) return;
    await writeText(board.path, withLanes(content, lanes));
    for (const write of writes) await writeText(write.path, write.content);
    await refresh();
  });
}

async function updateBoard(path: string, mutate: (content: string) => string): Promise<void> {
  await enqueue(async () => {
    const content = await readText(path);
    if (content === null) return;
    await writeText(path, mutate(content));
    await refresh();
  });
}

async function updateCard(path: string, mutate: (content: string) => string): Promise<void> {
  await enqueue(async () => {
    const content = await readText(path);
    if (content === null) return;
    await writeText(path, mutate(content));
    await refresh();
  });
}

async function openProject(folder: string, boardPath: string): Promise<void> {
  await enqueue(async () => {
    await rememberFolder(folder);
    _boardPath = boardPath;
    _mode = "board";
    _openPath = "";
    await refresh();
  });
}

async function chooseFolder(): Promise<void> {
  const result = await openFolderDialog(parentDir() || undefined);
  if (result.cancelled) return;
  await adoptFolder(result.path);
}

async function adoptFolder(folder: string): Promise<void> {
  if (folder === "") return;
  try {
    await ensureDir(folder);
  } catch {
    return;
  }
  await openProject(folder, joinPath(folder, BOARD_FILE));
}

function safeFileName(raw: string): string {
  const base = raw.trim().replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (base === "" || base === "." || base === ".." || base === ".md") return "";
  return base.toLowerCase().endsWith(".md") ? base : `${base}.md`;
}

async function renameCard(card: CardNote, rawName: string): Promise<void> {
  await enqueue(async () => {
    const name = safeFileName(rawName);
    if (name === "" || name.toLowerCase() === card.fileName.toLowerCase()) return;
    const dir = dirname(card.path);
    const nextPath = joinPath(dir, name);
    const taken = new Set((await listMd(dir)).map((item) => item.toLowerCase()));
    if (taken.has(name.toLowerCase())) return;
    try {
      await invoke("rename_file", { oldPath: card.path, newPath: nextPath });
    } catch {
      return;
    }
    const stem = card.fileName.replace(/\.md$/i, "").toLowerCase();
    for (const other of _cards) {
      if (other.path === card.path) continue;
      const parent = other.parent.trim().toLowerCase();
      const blocked = other.blockedBy.trim().toLowerCase();
      const parentHit = parent === card.fileName.toLowerCase() || parent === stem || parent === `${stem}.md`;
      const blockedHit = blocked === card.fileName.toLowerCase() || blocked === stem || blocked === `${stem}.md`;
      if (!parentHit && !blockedHit) continue;
      const content = await readText(other.path);
      if (content === null) continue;
      let next = content;
      if (parentHit) next = withScalar(next, "parent", name);
      if (blockedHit) next = withScalar(next, "blocked-by", name);
      if (next !== content) await writeText(other.path, next);
    }
    if (_openPath === card.path) _openPath = nextPath;
    await refresh();
  });
}

async function createCard(board: BoardNote, status: string, title: string): Promise<void> {
  await enqueue(async () => {
    const dir = dirname(board.path);
    const names = new Set((await listMd(dir)).map((name) => name.toLowerCase()));
    const file = slugFileName(title, names);
    const content = withScalar(newCardContent(title, status), "order", String(nextOrder(status)));
    await writeText(joinPath(dir, file), content);
    _focusLane = status;
    await refresh();
  });
}

async function createSubtask(parent: CardNote, title: string): Promise<void> {
  await enqueue(async () => {
    const dir = dirname(parent.path);
    const names = new Set((await listMd(dir)).map((name) => name.toLowerCase()));
    const file = slugFileName(title, names);
    await writeText(joinPath(dir, file), newSubtaskContent(title, parent.status, parent.fileName));
    await refresh();
  });
}

export default {
  id: PLUGIN_ID,
  name: "Kanban",
  version: "1.1.0",
  description: "Project board stored in a folder of notes",
  detail:
    "Opens a project folder as lanes in the editor. Each card is a note beside the board file. A messy note is cleaned without deleting its text.",

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _api = api;
    const stored = await api.loadSettings().catch(() => null);
    if (Array.isArray(stored?.folders)) {
      _known = stored.folders.filter((item): item is string => typeof item === "string");
    }
    if (typeof stored?.folder === "string") _folder = stored.folder;
    if (typeof stored?.parent === "string") _parent = stored.parent;
    if (_folder !== "") _mode = "board";
    injectCSS();
    document.addEventListener("keydown", onBoardKey);
    await refresh();
  },

  onDisable(): void {
    _epoch += 1;
    _io = Promise.resolve();
    document.querySelector(".kb-menu-pop")?.remove();
    document.removeEventListener("keydown", onBoardKey);
    clearPointer();
    document.getElementById(CSS_ID)?.remove();
    _api = null;
    _container = null;
    _query = "";
    _filters.clear();
    _collapsedSubs.clear();
    _openPath = "";
    _focusLane = "";
    _boards = [];
    _cards = [];
    _known = [];
    _folder = "";
    _parent = "";
    _mode = "pick";
  },
};
