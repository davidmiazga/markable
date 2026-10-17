/**
 * places.ts — Bookmarks, pin previews, the folder dashboard, and the pin canvas.
 *
 * Bookmarks and pins are path lists. Note text is read when a preview is
 * painted and is never written into plugin settings.
 *
 * Pin cards move with pointer events. HTML5 drag is not used: WKWebView does
 * not reliably fire dragstart (see folder-view/folder-item-drag.ts).
 *
 * @module file-browser/places
 */

import { ICON_CHEVRON, ICON_FOLDER, ICON_SEARCH } from "./icons/material/index";
import { getFileIconForCard } from "./folder-view/renderer";

/** Short markdown preview length. The rest of the file is not shown. */
export const NOTE_PREVIEW_MAX = 180;

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico", ".heic", ".heif",
]);

const DRAG_THRESHOLD_PX = 6;

export type VaultSliceKey =
  | "expandedPaths"
  | "pinnedPaths"
  | "smartFolders"
  | "bookmarks"
  | "pinLayouts"
  | "pinItems"
  | "bookmarkItems"
  | "placeSections";

/** Saved position of one pin card. Paths live in the map key, not in the file. */
export interface PinCardLayout {
  x: number;
  y: number;
  z: number;
  stackId: string | null;
}

/** One immediate child of a folder, as the file browser already lists it. */
export interface DashboardItem {
  path: string;
  name: string;
  kind: "file" | "directory";
  ext: string;
}

export interface FolderListing {
  entries?: Array<{ path: string; name: string }>;
  nonMdFiles?: Array<{ path: string; name: string } | string>;
  directories?: Array<string | { path?: string }>;
}

export interface DashboardHandlers {
  folderPath: string;
  items: DashboardItem[];
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onRename: (row: HTMLElement, item: DashboardItem) => void;
  onMove: (sourcePath: string, targetPath: string, targetType: string) => void;
  onContextMenu: (event: MouseEvent, item: DashboardItem, row: HTMLElement) => void;
  onUp?: () => void;
}

export interface PinCanvasHandlers {
  paths: string[];
  layout: Record<string, PinCardLayout>;
  loadPreview: (path: string) => Promise<string>;
  onOpen: (path: string) => void;
  onLayout: (layout: Record<string, PinCardLayout>) => void;
}

export const PLACES_CSS = `
.tree-node-pinned.has-preview {
  height: auto;
  flex-wrap: wrap;
  align-items: flex-start;
  padding-top: 4px;
  padding-bottom: 6px;
}
.file-browser-pin-preview {
  flex: 1 0 100%;
  margin: 2px 0 0;
  font-family: var(--ui-font);
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-secondary, rgba(128,128,128,.85));
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tree-node-trailing {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.tree-node-mark {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-color, var(--text-primary));
  cursor: pointer;
  border-radius: 3px;
}
.tree-node-mark svg { display: block; fill: currentColor; width: 16px; height: 16px; }
.tree-node-mark:hover { background: var(--bg-hover, rgba(255,255,255,.07)); }
.tree-node-trailing .tree-node-add-btn,
.tree-node-trailing .tree-node-fv-badge { margin-left: 0; }
.place-section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.place-twist, .place-header-action {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.place-twist svg, .place-kind-icon svg { width: 14px; height: 14px; display: block; fill: currentColor; }
.place-twist.is-open svg { transform: rotate(90deg); }
.place-header-action { margin-left: auto; width: auto; padding: 0 4px; font-size: 10px; letter-spacing: 0.04em; }
.place-group { flex-direction: column; align-items: stretch; height: auto; }
.place-group-head, .place-row { display: flex; align-items: center; min-height: 28px; gap: 4px; }
.place-children { list-style: none; margin: 0; padding: 0 0 0 14px; }
.place-color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.place-color-red { background: #e06a6a; }
.place-color-orange { background: #f0a35a; }
.place-color-yellow { background: #e6d35a; }
.place-color-green { background: #7dce6a; }
.place-color-blue { background: #6aa8e8; }
.place-color-purple { background: #b07ad4; }
.place-color-amber { background: #e6a23c; }
.place-tint-red { --place-tint: #e06a6a; }
.place-tint-orange { --place-tint: #f0a35a; }
.place-tint-yellow { --place-tint: #e6d35a; }
.place-tint-green { --place-tint: #7dce6a; }
.place-tint-blue { --place-tint: #6aa8e8; }
.place-tint-purple { --place-tint: #b07ad4; }
.place-tint-amber { --place-tint: #e6a23c; }
.place-row.place-tinted,
.place-group-head.place-tinted {
  background: color-mix(in srgb, var(--place-tint) 28%, transparent);
  box-shadow: inset 0 0 0 1px var(--place-tint);
  border-radius: 4px;
}
.place-row.place-tinted:hover,
.place-group-head.place-tinted:hover,
.place-row.place-tinted.tree-node-active,
.place-group-head.place-tinted.tree-node-active {
  background: color-mix(in srgb, var(--place-tint) 42%, transparent);
  box-shadow: inset 0 0 0 1px var(--place-tint);
}
.context-menu:has(.place-swatch-row) { min-width: 0; }
.place-swatch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  list-style: none;
}
.place-swatch, .place-swatch-remove {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}
.place-swatch.is-selected { box-shadow: 0 0 0 2px var(--text-primary, #fff); }
.place-swatch-remove {
  margin-left: 4px;
  background: transparent;
  color: var(--text-secondary, #ccc);
  font-size: 16px;
  line-height: 18px;
}
.place-row.is-dragging { opacity: 0.45; }
.place-preview {
  position: fixed;
  z-index: 10000;
  min-width: 280px;
  max-width: 440px;
  max-height: 280px;
  overflow: hidden;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, rgba(128,128,128,.3));
  background: var(--bg-primary, #1e1e1e);
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  font-family: var(--ui-font);
}
.place-preview-title { font-size: 16px; font-weight: 600; line-height: 1.35; margin-bottom: 6px; }
.place-preview-body {
  font-size: 14px;
  line-height: 1.45;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.file-browser-search-row { display: flex; align-items: center; gap: 4px; }
.file-browser-search-row .file-browser-search { width: auto; flex: 1; min-width: 0; }
.file-browser-search-save {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.file-browser-search-save svg { width: 18px; height: 18px; fill: currentColor; }
.file-browser-search-save:hover { background: var(--hover-bg, rgba(128,128,128,.12)); color: var(--text-primary); }
.file-browser-dash,
.file-browser-pin-canvas {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-primary, transparent);
}
.file-browser-dash-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 6px 12px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary, rgba(255,255,255,.4));
}
.file-browser-dash-header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-browser-dash-up {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--ui-font);
  font-size: 12px;
  letter-spacing: 0;
  text-transform: none;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.file-browser-dash-up:hover {
  background: var(--hover-bg, rgba(128,128,128,.08));
  color: var(--text-primary);
}
.file-browser-dash-list { overflow: auto; flex: 1; padding: 4px 0 12px; }
.file-browser-dash-row { padding-left: 8px; height: auto; min-height: 28px; }
.file-browser-dash-thumb {
  width: 36px;
  height: 28px;
  object-fit: cover;
  border-radius: 3px;
  margin-left: 8px;
  flex-shrink: 0;
}
.file-browser-pin-board {
  position: relative;
  flex: 1;
  min-height: 420px;
  overflow: auto;
}
.file-browser-pin-card {
  position: absolute;
  width: 220px;
  box-sizing: border-box;
  padding: 8px 10px 10px;
  border: 1px solid var(--border-color, rgba(128,128,128,.25));
  border-radius: 6px;
  background: var(--bg-primary, var(--bg-secondary, #1e1e1e));
  box-shadow: 0 1px 2px rgba(0,0,0,.12);
  cursor: grab;
  user-select: none;
}
.file-browser-pin-card .tree-node-label {
  line-height: 1.3;
  font-weight: 600;
  padding-left: 0;
}
.file-browser-pin-card .file-browser-pin-preview {
  margin: 6px 0 0;
  -webkit-line-clamp: 6;
}
.file-browser-pin-card.is-dragging { cursor: grabbing; opacity: 0.92; }
.file-browser-pin-empty,
.file-browser-dash .file-browser-empty {
  padding: 24px 16px;
  color: var(--text-secondary);
  font-size: 13px;
}
`;

/** True for markdown notes. Pins with a body preview are notes only. */
export function isNotePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

/** Keep unique non-empty path strings. Drops anything that is not a path. */
export function sanitizePathList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const path = item.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export const PLACE_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "amber"] as const;
export type PlaceColor = (typeof PLACE_COLORS)[number];
export type PlaceKind = "file" | "heading" | "search" | "group";

/** One bookmark or pin. Groups hold children. Order is the list order. */
export interface PlaceEntry {
  id: string;
  kind: PlaceKind;
  path?: string;
  heading?: string;
  query?: string;
  name?: string;
  color?: PlaceColor;
  collapsed?: boolean;
  children?: PlaceEntry[];
}

export interface PlaceSections {
  pinsCollapsed: boolean;
  bookmarksCollapsed: boolean;
}

export function newPlaceId(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}`;
}

export function headingsIn(markdown: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function entriesFromPaths(paths: string[]): PlaceEntry[] {
  return paths.map((path) => ({ id: newPlaceId(), kind: "file", path }));
}

function isPlaceColor(value: unknown): value is PlaceColor {
  return PLACE_COLORS.includes(value as PlaceColor);
}

/** Accept a saved tree, or a legacy list of path strings. */
export function sanitizePlaceList(raw: unknown): PlaceEntry[] {
  if (!Array.isArray(raw)) return [];
  if (raw.every((item) => typeof item === "string")) return entriesFromPaths(sanitizePathList(raw));
  const out: PlaceEntry[] = [];
  for (const item of raw) {
    const entry = sanitizePlaceEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

function sanitizePlaceEntry(raw: unknown): PlaceEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const kind = item.kind;
  if (kind !== "file" && kind !== "heading" && kind !== "search" && kind !== "group") return null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id : newPlaceId();
  const entry: PlaceEntry = { id, kind };
  if (typeof item.path === "string" && item.path.trim()) entry.path = item.path.trim();
  if (typeof item.heading === "string" && item.heading.trim()) entry.heading = item.heading.trim();
  if (typeof item.query === "string" && item.query.trim()) entry.query = item.query.trim();
  if (typeof item.name === "string" && item.name.trim()) entry.name = item.name.trim();
  if (isPlaceColor(item.color)) entry.color = item.color;
  if (item.collapsed === true) entry.collapsed = true;
  if (kind === "file" && !entry.path) return null;
  if (kind === "heading" && (!entry.path || !entry.heading)) return null;
  if (kind === "search" && !entry.query) return null;
  if (kind === "group") {
    entry.name = entry.name || "Group";
    entry.children = Array.isArray(item.children)
      ? item.children.map(sanitizePlaceEntry).filter((child): child is PlaceEntry => child !== null)
      : [];
  }
  return entry;
}

export function sanitizePlaceSections(raw: unknown): PlaceSections {
  const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    pinsCollapsed: item.pinsCollapsed === true,
    bookmarksCollapsed: item.bookmarksCollapsed === true,
  };
}

export function filePathsIn(entries: PlaceEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (list: PlaceEntry[]): void => {
    for (const entry of list) {
      if (entry.kind === "file" && entry.path && !seen.has(entry.path)) {
        seen.add(entry.path);
        out.push(entry.path);
      }
      if (entry.children) walk(entry.children);
    }
  };
  walk(entries);
  return out;
}

export function placeHasFile(entries: PlaceEntry[], path: string): boolean {
  return filePathsIn(entries).includes(path);
}

function walkPlaces(
  entries: PlaceEntry[],
  visit: (entry: PlaceEntry, list: PlaceEntry[], index: number) => boolean | void,
): boolean {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (visit(entry, entries, index)) return true;
    if (entry.children && walkPlaces(entry.children, visit)) return true;
  }
  return false;
}

export function findPlace(entries: PlaceEntry[], id: string): PlaceEntry | null {
  let found: PlaceEntry | null = null;
  walkPlaces(entries, (entry) => {
    if (entry.id !== id) return false;
    found = entry;
    return true;
  });
  return found;
}

function containsPlace(entry: PlaceEntry, id: string): boolean {
  if (entry.id === id) return true;
  return (entry.children ?? []).some((child) => containsPlace(child, id));
}

export function addFilePlace(entries: PlaceEntry[], path: string): PlaceEntry[] {
  if (placeHasFile(entries, path)) return entries;
  return [...entries, { id: newPlaceId(), kind: "file", path }];
}

export function addHeadingPlace(entries: PlaceEntry[], path: string, heading: string): PlaceEntry[] {
  const title = heading.trim();
  if (!path || !title) return entries;
  if (entries.some((entry) => entry.kind === "heading" && entry.path === path && entry.heading === title)) {
    return entries;
  }
  return [...entries, { id: newPlaceId(), kind: "heading", path, heading: title }];
}

export function addSearchPlace(entries: PlaceEntry[], query: string): PlaceEntry[] {
  const text = query.trim();
  if (!text) return entries;
  if (entries.some((entry) => entry.kind === "search" && entry.query === text)) return entries;
  return [...entries, { id: newPlaceId(), kind: "search", query: text }];
}

export function addGroupPlace(entries: PlaceEntry[], name = "Group"): PlaceEntry[] {
  return [...entries, { id: newPlaceId(), kind: "group", name, collapsed: false, children: [] }];
}

export function removeFilePlace(entries: PlaceEntry[], path: string): PlaceEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "file" && entry.path === path) return [];
    if (!entry.children) return [entry];
    return [{ ...entry, children: removeFilePlace(entry.children, path) }];
  });
}

export function removePlace(entries: PlaceEntry[], id: string): PlaceEntry[] {
  return entries.flatMap((entry) => {
    if (entry.id === id) return [];
    if (!entry.children) return [entry];
    return [{ ...entry, children: removePlace(entry.children, id) }];
  });
}

function mapPlace(entries: PlaceEntry[], id: string, change: (entry: PlaceEntry) => PlaceEntry): PlaceEntry[] {
  return entries.map((entry) => {
    if (entry.id === id) return change(entry);
    if (!entry.children) return entry;
    return { ...entry, children: mapPlace(entry.children, id, change) };
  });
}

export function setPlaceColor(entries: PlaceEntry[], id: string, color: PlaceColor | null): PlaceEntry[] {
  return mapPlace(entries, id, (entry) => {
    const next = { ...entry };
    if (color) next.color = color;
    else delete next.color;
    return next;
  });
}

export function togglePlaceCollapsed(entries: PlaceEntry[], id: string): PlaceEntry[] {
  return mapPlace(entries, id, (entry) => ({ ...entry, collapsed: !entry.collapsed }));
}

export function renamePlace(entries: PlaceEntry[], id: string, name: string): PlaceEntry[] {
  const title = name.trim();
  if (!title) return entries;
  return mapPlace(entries, id, (entry) => ({ ...entry, name: title }));
}

function placeAddress(entries: PlaceEntry[], id: string, parentId: string | null = null): { parentId: string | null; index: number } | null {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.id === id) return { parentId, index };
    if (entry.children) {
      const nested = placeAddress(entry.children, id, entry.id);
      if (nested) return nested;
    }
  }
  return null;
}

export function relocatePlace(
  entries: PlaceEntry[],
  id: string,
  parentId: string | null,
  index: number,
): PlaceEntry[] {
  const moving = findPlace(entries, id);
  if (!moving) return entries;
  if (parentId && (parentId === id || containsPlace(moving, parentId))) return entries;
  const from = placeAddress(entries, id);
  let nextIndex = index;
  if (from && from.parentId === parentId && from.index < index) nextIndex -= 1;
  const rest = removePlace(entries, id);
  return insertPlace(rest, moving, parentId, nextIndex);
}

function insertPlace(entries: PlaceEntry[], entry: PlaceEntry, parentId: string | null, index: number): PlaceEntry[] {
  if (parentId === null) {
    const next = entries.slice();
    next.splice(Math.max(0, Math.min(index, next.length)), 0, entry);
    return next;
  }
  return entries.map((item) => {
    if (item.id === parentId && item.kind === "group") {
      const children = (item.children ?? []).slice();
      children.splice(Math.max(0, Math.min(index, children.length)), 0, entry);
      return { ...item, children };
    }
    if (!item.children) return item;
    return { ...item, children: insertPlace(item.children, entry, parentId, index) };
  });
}

/**
 * First slice of a markdown body. Front matter is skipped. The result is
 * capped so a long note cannot be copied into the sidebar or settings.
 */
export function notePreview(markdown: string, max = NOTE_PREVIEW_MAX): string {
  let text = markdown.replace(/^\uFEFF/, "");
  if (text.startsWith("---")) {
    const close = text.search(/\n---\s*(?:\n|$)/);
    if (close !== -1) text = text.slice(close).replace(/^\n---\s*\n?/, "");
  }
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

export function sanitizePinLayout(raw: unknown): Record<string, PinCardLayout> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PinCardLayout> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!path.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const card = value as Record<string, unknown>;
    const x = typeof card.x === "number" && Number.isFinite(card.x) ? card.x : 0;
    const y = typeof card.y === "number" && Number.isFinite(card.y) ? card.y : 0;
    const z = typeof card.z === "number" && Number.isFinite(card.z) ? card.z : 1;
    const stackId = typeof card.stackId === "string" && card.stackId ? card.stackId : null;
    out[path] = { x, y, z, stackId };
  }
  return out;
}

/** Copy existing settings, then replace the named per-vault slices. */
export function mergeVaultSlices(
  existing: Record<string, unknown> | null,
  vaultId: string,
  slices: Partial<Record<VaultSliceKey, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  for (const key of Object.keys(slices) as VaultSliceKey[]) {
    const prior = next[key];
    const map: Record<string, unknown> =
      prior && typeof prior === "object" && !Array.isArray(prior)
        ? { ...(prior as Record<string, unknown>) }
        : {};
    map[vaultId] = slices[key];
    next[key] = map;
  }
  return next;
}

/** Positions for the current pins. Saved cards keep their place; new pins cascade. */
export function layoutsFor(
  paths: string[],
  saved: Record<string, PinCardLayout>,
): Record<string, PinCardLayout> {
  const out: Record<string, PinCardLayout> = {};
  paths.forEach((path, index) => {
    const prev = saved[path];
    if (prev) {
      out[path] = { ...prev };
      return;
    }
    out[path] = {
      x: 16 + (index % 5) * 36,
      y: 16 + (index % 5) * 28,
      z: index + 1,
      stackId: null,
    };
  });
  return out;
}

/** Drop a card on empty space. It leaves any stack and comes to the front. */
export function moveCard(
  layout: Record<string, PinCardLayout>,
  path: string,
  x: number,
  y: number,
): Record<string, PinCardLayout> {
  const current = layout[path];
  if (!current) return layout;
  let maxZ = 0;
  for (const card of Object.values(layout)) {
    if (card.z > maxZ) maxZ = card.z;
  }
  return {
    ...layout,
    [path]: { x, y, z: maxZ + 1, stackId: null },
  };
}

/**
 * Drop a card onto another card. Both share a stack id and the dropped card
 * sits slightly down-right so the pile stays visible.
 */
export function stackOnto(
  layout: Record<string, PinCardLayout>,
  dragged: string,
  target: string,
): Record<string, PinCardLayout> {
  if (dragged === target || !layout[dragged] || !layout[target]) return layout;
  const next: Record<string, PinCardLayout> = {};
  for (const [path, card] of Object.entries(layout)) next[path] = { ...card };
  const stackId = next[target].stackId ?? target;
  next[target].stackId = stackId;
  let maxZ = 0;
  for (const card of Object.values(next)) {
    if (card.z > maxZ) maxZ = card.z;
  }
  next[dragged] = {
    x: next[target].x + 18,
    y: next[target].y + 18,
    z: maxZ + 1,
    stackId,
  };
  return next;
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

function isImmediateChild(folderPath: string, childPath: string): boolean {
  const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
  if (!childPath.startsWith(prefix)) return false;
  return !childPath.slice(prefix.length).includes("/");
}

/** Immediate children of a folder: directories, notes, images, and other files. */
export function listFolderItems(folderPath: string, index: FolderListing | null): DashboardItem[] {
  if (!index || !folderPath) return [];
  const items: DashboardItem[] = [];

  for (const dir of index.directories ?? []) {
    const path = typeof dir === "string" ? dir : dir.path ?? "";
    if (!path || !isImmediateChild(folderPath, path)) continue;
    items.push({ path, name: baseName(path), kind: "directory", ext: "" });
  }

  for (const entry of index.entries ?? []) {
    if (!entry.path || !isImmediateChild(folderPath, entry.path)) continue;
    const ext = entry.path.toLowerCase().endsWith(".markdown") ? ".markdown" : ".md";
    items.push({
      path: entry.path,
      name: entry.name || baseName(entry.path).replace(/\.markdown$/i, "").replace(/\.md$/i, ""),
      kind: "file",
      ext,
    });
  }

  for (const file of index.nonMdFiles ?? []) {
    const path = typeof file === "string" ? file : file.path;
    if (!path || !isImmediateChild(folderPath, path)) continue;
    const name = typeof file === "string" ? baseName(path) : (file.name || baseName(path));
    items.push({ path, name, kind: "file", ext: extensionOf(name) });
  }

  items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

/** Read a note and return a short preview. File contents are not stored. */
export async function readNotePreview(path: string): Promise<string> {
  const invoke = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: object) => Promise<unknown> };
  }).__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") return "";
  try {
    const raw = await invoke("read_file", { path });
    if (typeof raw !== "string") return "";
    return notePreview(raw) || "Empty note";
  } catch {
    return "Couldn't preview this note";
  }
}

export function buildBookmarkSection(
  paths: string[],
  opts: {
    activePath: string | null;
    onOpen: (path: string) => void;
    onContextMenu: (event: MouseEvent, path: string, row: HTMLElement) => void;
    /** Right-side star. Clicking it removes the bookmark. */
    onUnbookmark?: (path: string) => void;
    unbookmarkIcon?: string;
  },
): HTMLElement | null {
  if (paths.length === 0) return null;
  const section = document.createElement("div");
  section.className = "file-tree-pinned-section file-browser-bookmarks";

  const header = document.createElement("div");
  header.className = "file-tree-section-header";
  header.textContent = "Bookmarks";
  section.appendChild(header);

  const ul = document.createElement("ul");
  ul.className = "file-tree file-tree-pinned";
  ul.setAttribute("role", "tree");

  for (const path of paths) {
    const li = document.createElement("li");
    li.className = "tree-node tree-node-pinned";
    li.setAttribute("data-path", path);
    li.setAttribute("data-type", "file");
    li.tabIndex = 0;
    if (path === opts.activePath) li.classList.add("tree-node-active");

    const name = document.createElement("span");
    name.className = "tree-node-label";
    name.textContent = baseName(path);
    name.title = path;
    li.appendChild(name);

    if (opts.onUnbookmark && opts.unbookmarkIcon) {
      const mark = document.createElement("span");
      mark.className = "tree-node-mark";
      mark.setAttribute("role", "button");
      mark.title = "Remove bookmark";
      mark.innerHTML = opts.unbookmarkIcon;
      mark.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onUnbookmark?.(path);
      });
      li.appendChild(mark);
    }

    const open = (): void => opts.onOpen(path);
    li.addEventListener("click", open);
    li.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") { event.preventDefault(); open(); }
    });
    li.addEventListener("contextmenu", (event: MouseEvent) => {
      opts.onContextMenu(event, path, li);
    });
    ul.appendChild(li);
  }

  section.appendChild(ul);
  return section;
}

export interface PlaceSectionHandlers {
  title: string;
  entries: PlaceEntry[];
  collapsed: boolean;
  activePath: string | null;
  removeIcon: string;
  removeTitle: string;
  onToggleSection: () => void;
  onToggleGroup: (id: string) => void;
  onNewGroup: () => void;
  onOpenFile: (path: string, heading?: string) => void;
  onRunSearch: (query: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, parentId: string | null, index: number) => void;
  onContextMenu: (event: MouseEvent, entry: PlaceEntry, row: HTMLElement) => void;
}

/** Bookmark or pin list with groups, colors, search rows, and pointer reorder. */
export function buildPlaceSection(opts: PlaceSectionHandlers): HTMLElement | null {
  if (opts.entries.length === 0) return null;
  const section = document.createElement("div");
  section.className = "file-tree-pinned-section file-browser-places";

  const header = document.createElement("div");
  header.className = "file-tree-section-header place-section-header";
  const twist = document.createElement("button");
  twist.type = "button";
  twist.className = "place-twist" + (opts.collapsed ? "" : " is-open");
  twist.innerHTML = ICON_CHEVRON;
  twist.title = opts.collapsed ? "Expand" : "Collapse";
  const label = document.createElement("span");
  label.textContent = opts.title;
  const addGroup = document.createElement("button");
  addGroup.type = "button";
  addGroup.className = "place-header-action";
  addGroup.textContent = "Group";
  addGroup.title = "New group";
  header.append(twist, label, addGroup);
  header.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".place-header-action")) return;
    opts.onToggleSection();
  });
  addGroup.addEventListener("click", (event) => {
    event.stopPropagation();
    opts.onNewGroup();
  });
  section.appendChild(header);

  if (!opts.collapsed) {
    const ul = document.createElement("ul");
    ul.className = "file-tree file-tree-pinned";
    ul.setAttribute("role", "tree");
    renderPlaceEntries(ul, opts.entries, null, opts);
    section.appendChild(ul);
  }
  return section;
}

function renderPlaceEntries(
  ul: HTMLElement,
  entries: PlaceEntry[],
  parentId: string | null,
  opts: PlaceSectionHandlers,
): void {
  entries.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "tree-node tree-node-pinned place-row";
    li.dataset.placeId = entry.id;
    li.dataset.parentId = parentId ?? "";
    li.dataset.index = String(index);
    li.dataset.kind = entry.kind;
    if (entry.kind === "group") li.classList.add("place-group");
    if (entry.path && entry.path === opts.activePath) li.classList.add("tree-node-active");

    if (entry.kind === "group") {
      const head = document.createElement("div");
      head.className = "place-group-head";
      const twist = document.createElement("button");
      twist.type = "button";
      twist.className = "place-twist" + (entry.collapsed ? "" : " is-open");
      twist.innerHTML = ICON_CHEVRON;
      twist.addEventListener("click", (event) => {
        event.stopPropagation();
        opts.onToggleGroup(entry.id);
      });
      const icon = document.createElement("span");
      icon.className = "place-kind-icon";
      icon.innerHTML = ICON_FOLDER;
      const name = document.createElement("span");
      name.className = "tree-node-label";
      name.textContent = entry.name || "Group";
      if (entry.color) head.classList.add("place-tinted", `place-tint-${entry.color}`);
      head.append(twist, icon, name);
      li.appendChild(head);
      if (!entry.collapsed) {
        const children = document.createElement("ul");
        children.className = "place-children";
        renderPlaceEntries(children, entry.children ?? [], entry.id, opts);
        li.appendChild(children);
      }
    } else {
      appendPlaceLeaf(li, entry, opts);
    }

    li.addEventListener("contextmenu", (event) => opts.onContextMenu(event, entry, li));
    attachPlaceDrag(li, opts);
    ul.appendChild(li);
  });
}

function appendPlaceLeaf(li: HTMLElement, entry: PlaceEntry, opts: PlaceSectionHandlers): void {
  if (entry.color) {
    li.classList.add("place-tinted", `place-tint-${entry.color}`);
    const dot = document.createElement("span");
    dot.className = `place-color-dot place-color-${entry.color}`;
    li.appendChild(dot);
  }
  if (entry.kind === "search") {
    const icon = document.createElement("span");
    icon.className = "place-kind-icon";
    icon.innerHTML = ICON_SEARCH;
    icon.title = "Saved search";
    li.appendChild(icon);
  }
  const name = document.createElement("span");
  name.className = "tree-node-label";
  if (entry.kind === "search") {
    name.textContent = entry.query ?? "";
    name.title = entry.query ?? "";
  } else if (entry.kind === "heading") {
    name.textContent = `${baseName(entry.path ?? "")} › ${entry.heading ?? ""}`;
    name.title = `${entry.path ?? ""}#${entry.heading ?? ""}`;
  } else {
    name.textContent = baseName(entry.path ?? "");
    name.title = entry.path ?? "";
  }
  li.appendChild(name);

  const mark = document.createElement("span");
  mark.className = "tree-node-mark";
  mark.setAttribute("role", "button");
  mark.title = opts.removeTitle;
  mark.innerHTML = opts.removeIcon;
  mark.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    opts.onRemove(entry.id);
  });
  li.appendChild(mark);

  const open = (): void => {
    if (entry.kind === "search" && entry.query) opts.onRunSearch(entry.query);
    else if (entry.path) opts.onOpenFile(entry.path, entry.heading);
  };
  li.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".tree-node-mark, .place-twist")) return;
    open();
  });
  if (entry.kind !== "search" && entry.path) attachPlacePreview(li, entry);
}

function attachPlacePreview(row: HTMLElement, entry: PlaceEntry): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    document.querySelector(".place-preview")?.remove();
  };
  row.addEventListener("mouseleave", hide);
  row.addEventListener("mouseover", (event: MouseEvent) => {
    if (!event.metaKey && !event.ctrlKey) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void showPlacePreview(row, entry);
    }, 180);
  });
}

async function showPlacePreview(row: HTMLElement, entry: PlaceEntry): Promise<void> {
  document.querySelector(".place-preview")?.remove();
  const title = entry.kind === "heading" ? (entry.heading ?? "") : baseName(entry.path ?? "");
  const body = await readNotePreview(entry.path ?? "");
  const tip = document.createElement("div");
  tip.className = "place-preview";
  const titleEl = document.createElement("div");
  titleEl.className = "place-preview-title";
  titleEl.textContent = title;
  const bodyEl = document.createElement("div");
  bodyEl.className = "place-preview-body";
  bodyEl.textContent = body || "No preview";
  tip.append(titleEl, bodyEl);
  document.body.appendChild(tip);
  const rect = row.getBoundingClientRect();
  tip.style.left = `${Math.min(rect.left, window.innerWidth - 460)}px`;
  tip.style.top = `${rect.bottom + 6}px`;
}

function attachPlaceDrag(row: HTMLElement, opts: PlaceSectionHandlers): void {
  row.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".tree-node-mark, .place-twist, .place-header-action")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    const id = row.dataset.placeId ?? "";
    const move = (ev: PointerEvent): void => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      row.classList.add("is-dragging");
    };
    const up = (ev: PointerEvent): void => {
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", up);
      row.classList.remove("is-dragging");
      if (!dragging) return;
      ev.preventDefault();
      ev.stopPropagation();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-place-id]");
      if (!target || target.dataset.placeId === id) return;
      const parentId = target.dataset.kind === "group" ? (target.dataset.placeId ?? null) : (target.dataset.parentId || null);
      const index = target.dataset.kind === "group"
        ? (findPlace(opts.entries, target.dataset.placeId ?? "")?.children?.length ?? 0)
        : Number(target.dataset.index ?? "0");
      opts.onReorder(id, parentId, index);
    };
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", up);
  });
}

function folderTitle(folderPath: string): string {
  const name = baseName(folderPath);
  return name || folderPath;
}

function selectDashRow(row: HTMLElement): void {
  const list = row.parentElement;
  list?.querySelectorAll(".tree-node-active").forEach((node) => node.classList.remove("tree-node-active"));
  row.classList.add("tree-node-active");
}

function paintDashIcon(row: HTMLElement, item: DashboardItem): void {
  const icon = document.createElement("span");
  icon.className = "tree-node-icon";
  icon.innerHTML = item.kind === "directory" ? ICON_FOLDER : getFileIconForCard(item.ext);
  row.appendChild(icon);

  if (item.kind !== "file" || !isImageExt(item.ext)) return;
  const convert = (window as unknown as {
    __MARKABLE_CONVERT_FILE_SRC__?: (path: string) => string;
  }).__MARKABLE_CONVERT_FILE_SRC__;
  if (typeof convert !== "function") return;
  const img = document.createElement("img");
  img.className = "file-browser-dash-thumb";
  img.alt = "";
  img.src = convert(item.path);
  img.addEventListener("error", () => img.remove());
  row.appendChild(img);
}

/**
 * Finder-style list of the current folder. Images use the existing file-src
 * preview. Other files stay a name and icon — no PDF or video player.
 */
export function renderFileDashboard(host: HTMLElement, handlers: DashboardHandlers): void {
  host.innerHTML = "";
  const root = document.createElement("div");
  root.className = "file-browser-dash";

  const header = document.createElement("div");
  header.className = "file-browser-dash-header";
  const title = document.createElement("span");
  title.textContent = folderTitle(handlers.folderPath);
  header.appendChild(title);
  if (handlers.onUp) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "file-browser-dash-up";
    up.textContent = "Up";
    up.addEventListener("click", () => handlers.onUp?.());
    header.appendChild(up);
  }
  root.appendChild(header);

  if (handlers.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "file-browser-empty";
    empty.textContent = "This folder is empty.";
    root.appendChild(empty);
    host.appendChild(root);
    return;
  }

  const list = document.createElement("div");
  list.className = "file-browser-dash-list";
  list.setAttribute("role", "list");

  for (const item of handlers.items) {
    const row = document.createElement("div");
    row.className = "tree-node file-browser-dash-row";
    row.setAttribute("role", "listitem");
    row.setAttribute("data-path", item.path);
    row.setAttribute("data-type", item.kind === "directory" ? "directory" : "file");
    row.tabIndex = 0;
    paintDashIcon(row, item);

    const label = document.createElement("span");
    label.className = "tree-node-label";
    label.textContent = item.name;
    label.title = item.path;
    row.appendChild(label);

    const open = (): void => {
      if (item.kind === "directory") handlers.onOpenFolder(item.path);
      else handlers.onOpenFile(item.path);
    };

    attachRowPointer(row, item, handlers, open);
    row.addEventListener("dblclick", (event: MouseEvent) => {
      event.preventDefault();
      open();
    });
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") { event.preventDefault(); open(); }
      else if (event.key === "F2") { event.preventDefault(); handlers.onRename(row, item); }
    });
    row.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      selectDashRow(row);
      handlers.onContextMenu(event, item, row);
    });
    list.appendChild(row);
  }

  root.appendChild(list);
  host.appendChild(root);
}

function attachRowPointer(
  row: HTMLElement,
  item: DashboardItem,
  handlers: DashboardHandlers,
  open: () => void,
): void {
  let startX = 0;
  let startY = 0;
  let dragActive = false;
  let pointerId = -1;

  const endDrag = (): void => {
    row.classList.remove("is-dragging");
    dragActive = false;
    pointerId = -1;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  row.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as Element | null)?.closest("input,button")) return;
    startX = event.clientX;
    startY = event.clientY;
    dragActive = false;
    pointerId = event.pointerId;
    try { row.setPointerCapture(event.pointerId); } catch { /* happy-dom */ }
  });

  row.addEventListener("pointermove", (event: PointerEvent) => {
    if (event.pointerId !== pointerId || dragActive) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) return;
    dragActive = true;
    row.classList.add("is-dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  });

  row.addEventListener("pointerup", (event: PointerEvent) => {
    if (pointerId === -1 || event.pointerId !== pointerId) return;
    const moved = dragActive;
    if (moved) {
      row.style.pointerEvents = "none";
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      row.style.pointerEvents = "";
      const target = (hit as HTMLElement | null)?.closest<HTMLElement>("[data-path][data-type]");
      const targetPath = target?.getAttribute("data-path") ?? "";
      const targetType = target?.getAttribute("data-type") ?? "";
      if (target && target !== row && targetPath) {
        handlers.onMove(item.path, targetPath, targetType);
      }
    } else {
      selectDashRow(row);
    }
    endDrag();
    if (!moved) open();
  });

  row.addEventListener("pointercancel", () => {
    if (pointerId !== -1) endDrag();
  });
}

function cardName(path: string): string {
  return baseName(path);
}

/**
 * Overlapping pin cards. A drop onto another card stacks them.
 * A click without a drag opens the note.
 */
export function renderPinCanvas(host: HTMLElement, handlers: PinCanvasHandlers): void {
  host.innerHTML = "";
  const root = document.createElement("div");
  root.className = "file-browser-pin-canvas";

  const header = document.createElement("div");
  header.className = "file-tree-section-header";
  header.textContent = "Pins";
  root.appendChild(header);

  const layout = layoutsFor(handlers.paths, handlers.layout);

  if (handlers.paths.length === 0) {
    const empty = document.createElement("div");
    empty.className = "file-browser-pin-empty";
    empty.textContent = "No pinned notes. Pin a markdown note from the file list.";
    root.appendChild(empty);
    host.appendChild(root);
    return;
  }

  const board = document.createElement("div");
  board.className = "file-browser-pin-board";

  const ordered = [...handlers.paths].sort((a, b) => (layout[a]?.z ?? 0) - (layout[b]?.z ?? 0));
  for (const path of ordered) {
    const card = document.createElement("article");
    card.className = "file-browser-pin-card";
    card.setAttribute("data-path", path);
    const place = layout[path];
    card.style.left = `${place.x}px`;
    card.style.top = `${place.y}px`;
    card.style.zIndex = String(place.z);

    const title = document.createElement("div");
    title.className = "tree-node-label";
    title.textContent = cardName(path);
    title.title = path;
    card.appendChild(title);

    const preview = document.createElement("p");
    preview.className = "file-browser-pin-preview";
    preview.textContent = "";
    card.appendChild(preview);
    void handlers.loadPreview(path).then((text) => {
      if (preview.isConnected) preview.textContent = text;
    });

    attachCardPointer(card, path, layout, handlers.onOpen, (next) => {
      handlers.onLayout(next);
      renderPinCanvas(host, { ...handlers, layout: next });
    });
    board.appendChild(card);
  }

  root.appendChild(board);
  host.appendChild(root);
}

function attachCardPointer(
  card: HTMLElement,
  path: string,
  layout: Record<string, PinCardLayout>,
  onOpen: (path: string) => void,
  commit: (layout: Record<string, PinCardLayout>) => void,
): void {
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let dragActive = false;
  let pointerId = -1;

  const cleanup = (): void => {
    card.classList.remove("is-dragging");
    dragActive = false;
    pointerId = -1;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  card.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    originX = layout[path]?.x ?? 0;
    originY = layout[path]?.y ?? 0;
    dragActive = false;
    pointerId = event.pointerId;
    try { card.setPointerCapture(event.pointerId); } catch { /* happy-dom */ }
    event.stopPropagation();
  });

  card.addEventListener("pointermove", (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragActive) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragActive = true;
      card.classList.add("is-dragging");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }
    card.style.left = `${originX + dx}px`;
    card.style.top = `${originY + dy}px`;
  });

  card.addEventListener("pointerup", (event: PointerEvent) => {
    if (pointerId === -1 || event.pointerId !== pointerId) return;
    const moved = dragActive;
    if (!moved) {
      cleanup();
      onOpen(path);
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    card.style.pointerEvents = "none";
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    card.style.pointerEvents = "";
    const other = (hit as HTMLElement | null)?.closest<HTMLElement>(".file-browser-pin-card");
    const target = other?.getAttribute("data-path") ?? "";
    const next = target && target !== path
      ? stackOnto(layout, path, target)
      : moveCard(layout, path, originX + dx, originY + dy);
    cleanup();
    commit(next);
  });

  card.addEventListener("pointercancel", () => {
    if (pointerId !== -1) cleanup();
  });
}
