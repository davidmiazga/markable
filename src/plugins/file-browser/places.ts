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

import { ICON_FOLDER } from "./icons/material/index";
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
  | "pinLayouts";

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
  margin: 0 10px 0 16px;
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
