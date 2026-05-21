/**
 * SelectWidget — renders a ```select codefence as an embedded file collection.
 *
 * The fence body is a flat YAML-style spec. The widget resolves the `path:`
 * relative to the host file, enumerates that folder's children via the vault
 * index, and dispatches to one of the existing folder-view renderers (cards /
 * table / list / timeline / kanban) based on `display:`.
 *
 * Example fence body:
 *   path: ./projects
 *   sort: modified-desc
 *   display: cards
 *   show-modified: true
 *
 * Phase 1: minimal parsing, no `where:` filter language, no enrichment.
 * Modal-driven editing arrives in later phases.
 */

import { WidgetType, type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { renderFolderCards } from "../plugins/file-browser/folder-view/renderer";
import { renderFolderTable } from "../plugins/file-browser/folder-view/table-renderer";
import { renderFolderList } from "../plugins/file-browser/folder-view/list-renderer";
import { renderFolderTimeline } from "../plugins/file-browser/folder-view/timeline-renderer";
import { renderFolderKanban } from "../plugins/file-browser/folder-view/kanban-renderer";
import { collectChildren } from "../plugins/file-browser/folder-view/tab";
import { parseYamlLines } from "../plugins/file-browser/folder-view/parser";
import type {
  FolderViewConfig,
  FolderSortOrder,
  FolderLayoutRenderer,
  FolderCard,
} from "../plugins/file-browser/folder-view/types";
import type { SmartFolderRule, InverseMaps } from "../plugins/file-browser/smart-folders/types";
import { matchRule } from "../plugins/file-browser/smart-folders/evaluator";
import type { DisplayKind, SelectBuilderInitial } from "../lib/select-builder";

const RENDERERS: Record<string, FolderLayoutRenderer> = {
  cards:    renderFolderCards,
  table:    renderFolderTable,
  list:     renderFolderList,
  timeline: renderFolderTimeline,
  kanban:   renderFolderKanban,
};

const VALID_DISPLAYS = new Set(Object.keys(RENDERERS));
const VALID_SORTS = new Set<FolderSortOrder>([
  "name-asc", "name-desc", "modified-asc", "modified-desc",
]);

function defaultConfig(): FolderViewConfig {
  return {
    layout: "",
    title: "",
    sort: "name-asc",
    cardWidth: 160,
    layoutMode: "grid",
    showModified: true,
    body: "",
    aspectRatio: "1/1",
    fit: "cover",
    minHeight: 40,
    maxHeight: 200,
    showName: true,
    showPreview: true,
    showExtensions: true,
    showFolders: true,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    extraFields: [],
    fields: null,
    previewPane: false,
    previewHeight: "80vh",
  };
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return fallback;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const n = parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asStringArray(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string") out.push(item.trim());
    }
    return out;
  }
  // Inline form: "[a, b, c]"
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      return s.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean);
    }
  }
  return null;
}

export type BlockContentWidth = "normal" | "wide" | "full";

const VALID_BLOCK_WIDTHS = new Set<BlockContentWidth>(["normal", "wide", "full"]);

/** Parse the fence body into a path, a display kind, and a FolderViewConfig. */
export function parseSelectBody(body: string): {
  rawPath: string | null;
  display: string;
  config: FolderViewConfig;
  contentWidth: BlockContentWidth;
} {
  const lines = body.split("\n");
  const parsed = parseYamlLines(lines);
  const config = defaultConfig();

  const rawPath = asString(parsed.path);

  let display = asString(parsed.display) ?? "cards";
  if (!VALID_DISPLAYS.has(display)) display = "cards";
  config.layout = `view-${display}`;

  const sort = asString(parsed.sort);
  if (sort && VALID_SORTS.has(sort as FolderSortOrder)) {
    config.sort = sort as FolderSortOrder;
  }

  config.showModified   = asBool(parsed["show-modified"],   config.showModified);
  config.showExtensions = asBool(parsed["show-extensions"], config.showExtensions);
  config.showTags       = asBool(parsed["show-tags"],       config.showTags);
  config.showCount      = asBool(parsed["show-count"],      config.showCount);
  config.previewPane    = asBool(parsed["preview-pane"],    config.previewPane);
  config.cardWidth      = asInt(parsed["card-width"],       config.cardWidth);

  const aspectRatio = asString(parsed["aspect-ratio"]);
  if (aspectRatio) config.aspectRatio = aspectRatio;
  const fit = asString(parsed.fit);
  if (fit) config.fit = fit;

  const fields = asStringArray(parsed.fields);
  if (fields) config.fields = fields;

  const cwRaw = asString(parsed["content-width"])?.toLowerCase() ?? "normal";
  const contentWidth: BlockContentWidth = VALID_BLOCK_WIDTHS.has(cwRaw as BlockContentWidth)
    ? (cwRaw as BlockContentWidth)
    : "normal";

  return { rawPath, display, config, contentWidth };
}

/**
 * Parse the fence body into the shape that `openSelectBuilderModal` accepts as
 * its `initial` argument. Used by the gear icon + the cursor-aware edit flow
 * to prefill the modal from an existing block.
 *
 * Round-trips with `buildSelectFenceFromState` (writes `where:` as a YAML
 * sequence of `{type, operator, value}` objects).
 */
export function parseSelectBodyForBuilder(body: string): SelectBuilderInitial {
  const parsed = parseYamlLines(body.split("\n"));
  const initial: SelectBuilderInitial = {};

  const path = asString(parsed.path);
  if (path !== null) initial.path = path;

  const display = asString(parsed.display);
  if (display && VALID_DISPLAYS.has(display)) initial.display = display as DisplayKind;

  const sort = asString(parsed.sort);
  if (sort) initial.sort = sort;

  initial.showModified   = asBool(parsed["show-modified"],   true);
  initial.showExtensions = asBool(parsed["show-extensions"], true);
  initial.previewPane    = asBool(parsed["preview-pane"],    false);

  const kanbanField = asString(parsed["kanban-field"]);
  if (kanbanField) initial.kanbanField = kanbanField;

  const cw = asString(parsed["content-width"])?.toLowerCase();
  if (cw && VALID_BLOCK_WIDTHS.has(cw as BlockContentWidth)) {
    initial.contentWidth = cw as BlockContentWidth;
  }

  // `where:` is a list of `{type, operator, value}` mappings; parseYamlLines
  // returns it as Array<Record<string,string>> for the structured-sequence form.
  const whereRaw = parsed.where;
  if (Array.isArray(whereRaw)) {
    const rules: SmartFolderRule[] = [];
    for (const item of whereRaw) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, string>;
      const type = obj.type;
      const operator = obj.operator;
      const rawValue = obj.value ?? "";
      if (!type || !operator) continue;
      // Cast value to number when the operator implies it (mirrors smart-folder semantics).
      const isNumberOp =
        operator === "in last N days" || operator === "not in last N days" ||
        operator === "outbound >= N" || operator === "inbound >= N";
      const value: unknown = isNumberOp ? Number(rawValue) : rawValue;
      rules.push({ type, operator, value } as unknown as SmartFolderRule);
    }
    initial.rules = rules;
  }

  return initial;
}

/**
 * Build the InverseMaps needed by matchRule from the current vault index.
 *
 * Path → tags comes from vault index entries' `tags` field (already populated
 * by the indexer). Outbound counts come from `outboundLinks`. Inbound counts
 * are derived by inverting outbound. We do NOT call the Rust scan_vault_tags
 * command — too slow for a synchronous widget render. The vault index's tags
 * are the source of truth for tag rules, identical to what `pathToTags` is
 * filled with in the smart-folder evaluator.
 */
function buildMapsFromVaultIndex(vaultIndex: {
  entries?: Array<{ path: string; tags?: string[]; outboundLinks?: string[] }>;
}): InverseMaps {
  const pathToTags = new Map<string, Set<string>>();
  const pathToOutboundCount = new Map<string, number>();
  const pathToInboundCount = new Map<string, number>();
  for (const entry of vaultIndex.entries ?? []) {
    pathToTags.set(entry.path, new Set(entry.tags ?? []));
    const outbound = entry.outboundLinks ?? [];
    pathToOutboundCount.set(entry.path, outbound.length);
    for (const target of outbound) {
      pathToInboundCount.set(target, (pathToInboundCount.get(target) ?? 0) + 1);
    }
  }
  return { pathToTags, pathToOutboundCount, pathToInboundCount, distinctExtensions: [] };
}

/**
 * Apply `where:` rules to a card list. Returns the subset that matches every
 * rule (AND semantics, same as Smart Folders).
 */
export function filterCardsByRules(
  cards: FolderCard[],
  rules: SmartFolderRule[],
  vaultIndex: { entries?: Array<{ path: string; tags?: string[]; outboundLinks?: string[] }> },
): FolderCard[] {
  if (rules.length === 0) return cards;
  const maps = buildMapsFromVaultIndex(vaultIndex);
  const now = Date.now();
  return cards.filter((card) => {
    // Directory cards are kept as-is — `where:` rules target files.
    if (card.kind === "directory") return true;
    const candidate = {
      path: card.path,
      name: card.name,
      title: card.name,
      modified: card.modified,
      isMd: card.ext === ".md",
    };
    return rules.every((rule) => matchRule(rule, candidate, maps, now));
  });
}

/** Resolve a path expression against the host file. Returns absolute folder path. */
export function resolveSelectPath(
  rawPath: string | null,
  hostFile: string | null,
  vaultRoot: string | null,
): string | null {
  if (!hostFile) return null;
  const hostDir = hostFile.split("/").slice(0, -1).join("/");
  if (!rawPath || rawPath === "" || rawPath === "." || rawPath === "./") return hostDir;
  if (rawPath === "vault") return vaultRoot ?? hostDir;
  if (rawPath.startsWith("/")) return normalizePath(rawPath);
  return normalizePath(hostDir + "/" + rawPath);
}

function normalizePath(p: string): string {
  const isAbs = p.startsWith("/");
  const parts: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return (isAbs ? "/" : "") + parts.join("/");
}

/**
 * Inject the CSS for the widget container + gear button. Idempotent —
 * checks for a sentinel <style> element before injecting.
 */
function injectSelectWidgetCss(): void {
  const id = "__markable_select_widget_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.cm-select-widget { position: relative; }
.cm-select-widget-inner { width: 100%; }
.cm-select-widget-gear {
  position: absolute; top: 6px; right: 6px; z-index: 10;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 5px; border: 1px solid var(--border-color, rgba(255,255,255,.2));
  background: var(--bg-secondary, rgba(30,30,40,.92)); color: var(--text-secondary, #bbb);
  cursor: pointer; opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
  font-size: 15px; line-height: 1; user-select: none;
  box-shadow: 0 1px 3px rgba(0,0,0,.3);
}
.cm-select-widget:hover .cm-select-widget-gear { opacity: 1; }
.cm-select-widget-gear:hover {
  color: var(--text-primary, #fff);
  background: var(--bg-hover, rgba(60,60,80,.95));
}
.cm-select-error {
  padding: 10px 14px; border-radius: 4px;
  background: rgba(255, 80, 80, .08); color: var(--text-secondary, #c66);
  border: 1px solid rgba(255, 80, 80, .25);
  font-family: var(--ui-font, -apple-system, sans-serif); font-size: 12px;
}
`.trim();
  document.head.appendChild(style);
}

export class SelectWidget extends WidgetType {
  constructor(readonly body: string) { super(); }

  eq(other: SelectWidget): boolean { return this.body === other.body; }

  toDOM(view: EditorView): HTMLElement {
    injectSelectWidgetCss();

    const wrapper = document.createElement("div");
    wrapper.className = "cm-select-widget";

    // Inner container holds the renderer's output. The folder-view renderers
    // call `container.innerHTML = ""` on their first line, so the gear must
    // live on `wrapper` (outside the renderer's reach), not on this inner div.
    const inner = document.createElement("div");
    inner.className = "cm-select-widget-inner";
    wrapper.appendChild(inner);

    // CM6 widget click guard. The folder-view renderers attach click handlers
    // to cards / rows / checkboxes but do NOT call preventDefault on mousedown
    // (they were originally written for the non-CM6 "view tab" context). When
    // embedded in a CM6 widget, an un-prevented mousedown also moves the
    // editor cursor — which then scrolls the source ```select``` block into
    // view, looking like "clicking a card opened the code".
    //
    // The fix per memory note `feedback_cm6_widget_clicks.md`: each
    // interactive element inside a widget must preventDefault on mousedown.
    // We do it once for the whole inner subtree, excepting form fields that
    // need to receive focus.
    inner.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.matches("input, textarea, select")) return;
      e.preventDefault();
    });

    // Gear icon — opens the select-builder in edit mode for this block.
    // Appended after `inner` so it sits on top in DOM/paint order. Wired via
    // the __MARKABLE_EDIT_SELECT_FENCE__ window global (set in main.ts).
    const gear = document.createElement("button");
    gear.className = "cm-select-widget-gear";
    gear.type = "button";
    gear.setAttribute("aria-label", "Edit data block");
    gear.title = "Edit data block";
    gear.textContent = "⚙";
    gear.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const editFn = (window as unknown as {
        __MARKABLE_EDIT_SELECT_FENCE__?: (view: EditorView, body: string) => void;
      }).__MARKABLE_EDIT_SELECT_FENCE__;
      if (typeof editFn === "function") editFn(view, this.body);
    });
    wrapper.appendChild(gear);

    let parsed;
    try {
      parsed = parseSelectBody(this.body);
    } catch (err) {
      inner.appendChild(errorBox(`Could not parse select block: ${String(err)}`));
      return wrapper;
    }
    const { rawPath, display, config, contentWidth } = parsed;

    // Apply block-level content-width class (suppressed by page-level CSS
    // when the page has its own content-width override).
    if (contentWidth === "wide") wrapper.classList.add("cm-block-width-wide");
    else if (contentWidth === "full") wrapper.classList.add("cm-block-width-full");

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const hostFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null | undefined;
    const vaultMgr = (window as any).__MARKABLE_VAULT_MANAGER__;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const vaultRoot: string | null = vaultMgr?.getActiveVaultRoot?.() ?? null;
    const vaultIndex = vaultMgr?.getVaultIndex?.() ?? null;

    const folderPath = resolveSelectPath(rawPath, hostFile ?? null, vaultRoot);
    if (!folderPath) {
      inner.appendChild(errorBox("Select block needs a saved host file to resolve `path:`."));
      return wrapper;
    }
    if (!vaultIndex) {
      inner.appendChild(errorBox("Select block: no active vault."));
      return wrapper;
    }

    config.title = folderPath.split("/").pop() ?? folderPath;
    const allCards = collectChildren(folderPath, vaultIndex);

    // Apply `where:` rules if present. Phase 2: rules are parsed from the
    // fence body via the same path as the modal pre-fill, so we re-parse the
    // body to extract them.
    const initial = parseSelectBodyForBuilder(this.body);
    const cards = initial.rules && initial.rules.length > 0
      ? filterCardsByRules(allCards, initial.rules, vaultIndex)
      : allCards;

    const renderer = RENDERERS[display] ?? RENDERERS.cards;
    renderer(config, cards, inner, folderPath);
    return wrapper;
  }

  ignoreEvent(): boolean { return false; }
}

function errorBox(message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-select-error";
  el.textContent = message;
  return el;
}

/**
 * Find the enclosing `select` codefence at the cursor position, if any.
 * Used by the cursor-aware command-bar / slash entry points to decide
 * whether the user is editing an existing block or inserting a new one.
 */
export function findSelectFenceAtCursor(
  view: EditorView,
): { from: number; to: number; body: string } | null {
  const detected = findCustomFenceAtCursor(view);
  if (detected && detected.lang === "select") {
    return { from: detected.from, to: detected.to, body: detected.body };
  }
  return null;
}

/**
 * Find the first recognized custom codefence in the document (sidebar /
 * sidebar-left / grid / grid-card / select). Used by the "open `_folder.md`
 * and edit its primary block" flow when entering a Folder View.
 */
export function findFirstCustomFence(
  view: EditorView,
): { from: number; to: number; body: string; lang: string } | null {
  const known = new Set(["sidebar", "sidebar-left", "grid", "grid-card", "select"]);
  const state = view.state;
  let found: { from: number; to: number; body: string; lang: string } | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (found) return false;
      if (node.name !== "FencedCode") return;
      let lang = "";
      let codeFrom = -1;
      let codeTo = -1;
      const cur = node.node.cursor();
      if (cur.firstChild()) {
        do {
          if (cur.name === "CodeInfo") {
            lang = state.doc.sliceString(cur.from, cur.to).trim();
          } else if (cur.name === "CodeText") {
            codeFrom = cur.from;
            codeTo = cur.to;
          }
        } while (cur.nextSibling());
      }
      const langLc = lang.toLowerCase();
      const firstToken = langLc.split(/\s+/)[0];
      if (!known.has(firstToken)) return false;
      const body = codeFrom >= 0 ? state.doc.sliceString(codeFrom, codeTo) : "";
      found = { from: node.from, to: node.to, body, lang: langLc };
      return false;
    },
  });
  return found;
}

/**
 * Find the enclosing custom codefence at the cursor — one of our recognized
 * block types (sidebar / sidebar-left / grid / grid-card / select). Used by
 * the unified CodeBlock modal to detect edit mode for any block type.
 */
export function findCustomFenceAtCursor(
  view: EditorView,
): { from: number; to: number; body: string; lang: string } | null {
  const known = new Set(["sidebar", "sidebar-left", "grid", "grid-card", "select"]);
  const state = view.state;
  const cursor = state.selection.main.head;
  let found: { from: number; to: number; body: string; lang: string } | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (found) return false;
      if (node.name !== "FencedCode") return;
      if (cursor < node.from || cursor > node.to) return false;
      let lang = "";
      let codeFrom = -1;
      let codeTo = -1;
      const cur = node.node.cursor();
      if (cur.firstChild()) {
        do {
          if (cur.name === "CodeInfo") {
            lang = state.doc.sliceString(cur.from, cur.to).trim();
          } else if (cur.name === "CodeText") {
            codeFrom = cur.from;
            codeTo = cur.to;
          }
        } while (cur.nextSibling());
      }
      const langLc = lang.toLowerCase();
      // First token is the block kind; remainder may carry modifiers (e.g.
      // " wide" / " full"). Match the first token against the known set.
      const firstToken = langLc.split(/\s+/)[0];
      if (!known.has(firstToken)) return false;
      const body = codeFrom >= 0 ? state.doc.sliceString(codeFrom, codeTo) : "";
      found = { from: node.from, to: node.to, body, lang: langLc };
      return false;
    },
  });
  return found;
}

/** Parse a Grid fence info-string + body into form state. */
export function parseGridFenceBody(
  body: string,
  lang: string,
): { cols: number; rows: number; cellStyle: "grid" | "grid-card"; contentWidth: BlockContentWidth } {
  const [name, modifier] = lang.split(/\s+/);
  const cellStyle: "grid" | "grid-card" = name === "grid-card" ? "grid-card" : "grid";
  const contentWidth: BlockContentWidth =
    modifier === "wide" ? "wide" : modifier === "full" ? "full" : "normal";
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  const m = firstLine.trim().match(/^(\d+)(?:x(\d+))?$/);
  if (m) {
    const cols = Math.max(1, parseInt(m[1], 10));
    const rows = m[2] ? Math.max(1, parseInt(m[2], 10)) : cols;
    return { cols, rows, cellStyle, contentWidth };
  }
  return { cols: 3, rows: 3, cellStyle, contentWidth };
}

/** Parse a Sidebar fence info-string + body into form state. */
export function parseSidebarFenceBody(
  body: string,
  lang: string,
): { side: "right" | "left"; body: string; contentWidth: BlockContentWidth } {
  const [name, modifier] = lang.split(/\s+/);
  const contentWidth: BlockContentWidth =
    modifier === "wide" ? "wide" : modifier === "full" ? "full" : "normal";
  return {
    side: name === "sidebar-left" ? "left" : "right",
    body: body,
    contentWidth,
  };
}

/**
 * Find the `[from, to]` range of a `select` codefence in the current document
 * whose body matches `targetBody`. Used by the gear icon to locate the fence
 * for transaction-based editing.
 *
 * Walks the CM6 syntax tree for `FencedCode` nodes, extracts `CodeInfo` (lang)
 * and `CodeText` (body) for each, and returns the first one whose lang is
 * `select` and whose body matches. Returns null if not found.
 */
export function findSelectFenceRange(
  view: EditorView,
  targetBody: string,
): { from: number; to: number } | null {
  const state = view.state;
  let found: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (found) return false;
      if (node.name !== "FencedCode") return;
      let lang = "";
      let codeFrom = -1;
      let codeTo = -1;
      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.name === "CodeInfo") {
            lang = state.doc.sliceString(cursor.from, cursor.to).trim();
          } else if (cursor.name === "CodeText") {
            codeFrom = cursor.from;
            codeTo = cursor.to;
          }
        } while (cursor.nextSibling());
      }
      if (lang.toLowerCase() !== "select") return false;
      const body = codeFrom >= 0 ? state.doc.sliceString(codeFrom, codeTo) : "";
      if (body === targetBody) {
        found = { from: node.from, to: node.to };
        return false;
      }
      return;
    },
  });
  return found;
}
