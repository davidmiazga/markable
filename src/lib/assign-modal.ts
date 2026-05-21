/**
 * assign-modal.ts — Unified "View or Layout" assignment modal.
 *
 * openAssignModal(filePath, deps) lets the user assign a view-* layout
 * (renders the parent directory's files as a collection) or a typography
 * layout (styles this file's own content) to any .md file.  The two
 * categories share the same `layout:` frontmatter field and are therefore
 * mutually exclusive — selecting one clears the other.
 *
 * For _folder.md and view-*.md files the Layouts section is grayed out to
 * discourage applying typography layouts to directory-scoped view files.
 */

import { readFile, writeFile, openAssetDialog } from "./bridge";
import {
  discoverLayouts,
  applyLayoutToFile,
  removeLayoutFromFile,
  stripLayoutBlock,
  LAYOUT_PREVIEW_SVGS,
} from "./layout-manager";
import type { LayoutDeps } from "./layout-manager";
import { attachModalKeyboard } from "./modal-keyboard";
import { getDisplaySpec } from "../plugins/file-browser/folder-view/display-options";

// ── Constants ──────────────────────────────────────────────────────────────────

const OVERLAY_ID = "__assign-modal-overlay__";
const STYLE_ID   = "__am-styles__";

const VIEW_TYPES: Array<{
  slug: string;
  name: string;
  description: string;
  requiresField?: boolean;
}> = [
  {
    slug: "view-cards",
    name: "Cards",
    description: "Grid of file cards with image preview thumbnails. Great for visual collections of images or notes.",
  },
  {
    slug: "view-table",
    name: "Table",
    description: "Sortable table with configurable columns. Best for structured notes with frontmatter metadata.",
  },
  {
    slug: "view-timeline",
    name: "Timeline",
    description: "Files grouped by recency with a vertical orange rail and date headings.",
  },
  {
    slug: "view-kanban",
    name: "Kanban",
    description: "Columns grouped by a frontmatter field value. Only shows files that have that field set.",
    requiresField: true,
  },
  {
    slug: "view-bookshelf",
    name: "Bookshelf",
    description: "Horizontal shelves of book-like items. Shows YAML `cover:` images when present; falls back to title spines.",
  },
];

// ── Preview SVGs ───────────────────────────────────────────────────────────────

const VIEW_PREVIEW_SVGS: Record<string, string> = {
  "view-cards":
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#1a1a2e"/><rect x="14" y="14" width="110" height="76" rx="6" fill="#252540" stroke="#333360" stroke-width="1"/><rect x="145" y="14" width="110" height="76" rx="6" fill="#252540" stroke="#333360" stroke-width="1"/><rect x="276" y="14" width="110" height="76" rx="6" fill="#252540" stroke="#333360" stroke-width="1"/><rect x="14" y="104" width="110" height="76" rx="6" fill="#252540" stroke="#333360" stroke-width="1"/><rect x="145" y="104" width="110" height="76" rx="6" fill="#252540" stroke="#333360" stroke-width="1"/><rect x="276" y="104" width="110" height="76" rx="6" fill="#252540" stroke="#333360" stroke-width="1"/><rect x="20" y="79" width="70" height="6" rx="3" fill="#444466"/><rect x="151" y="79" width="70" height="6" rx="3" fill="#444466"/><rect x="282" y="79" width="70" height="6" rx="3" fill="#444466"/><rect x="20" y="169" width="70" height="6" rx="3" fill="#444466"/><rect x="151" y="169" width="70" height="6" rx="3" fill="#444466"/><rect x="282" y="169" width="70" height="6" rx="3" fill="#444466"/><text x="200" y="218" text-anchor="middle" fill="#555577" font-size="11" font-family="sans-serif">Cards</text></svg>`,

  "view-table":
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#1a1a2e"/><rect x="12" y="16" width="376" height="26" rx="3" fill="#2a2a4a"/><rect x="20" y="23" width="50" height="10" rx="3" fill="#5566aa"/><rect x="90" y="23" width="70" height="10" rx="3" fill="#5566aa"/><rect x="180" y="23" width="70" height="10" rx="3" fill="#5566aa"/><rect x="270" y="23" width="60" height="10" rx="3" fill="#5566aa"/><rect x="12" y="46" width="376" height="24" rx="2" fill="#1e1e38"/><rect x="12" y="74" width="376" height="24" rx="2" fill="#232340"/><rect x="12" y="102" width="376" height="24" rx="2" fill="#1e1e38"/><rect x="12" y="130" width="376" height="24" rx="2" fill="#232340"/><rect x="12" y="158" width="376" height="24" rx="2" fill="#1e1e38"/><rect x="20" y="54" width="44" height="7" rx="3" fill="#444466"/><rect x="90" y="54" width="55" height="7" rx="3" fill="#444466"/><rect x="20" y="82" width="38" height="7" rx="3" fill="#444466"/><rect x="90" y="82" width="62" height="7" rx="3" fill="#444466"/><rect x="20" y="110" width="50" height="7" rx="3" fill="#444466"/><rect x="90" y="110" width="48" height="7" rx="3" fill="#444466"/><rect x="20" y="138" width="42" height="7" rx="3" fill="#444466"/><rect x="20" y="166" width="48" height="7" rx="3" fill="#444466"/><text x="200" y="218" text-anchor="middle" fill="#555577" font-size="11" font-family="sans-serif">Table</text></svg>`,

  "view-timeline":
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#1a1a2e"/><rect x="30" y="12" width="6" height="220" rx="3" fill="#ff6600" opacity="0.6"/><circle cx="33" cy="28" r="7" stroke="#ff6600" stroke-width="4" fill="#1a1a2e"/><rect x="52" y="20" width="70" height="12" rx="3" fill="#5566aa"/><rect x="52" y="42" width="280" height="24" rx="3" fill="#232340"/><rect x="52" y="70" width="280" height="24" rx="3" fill="#1e1e38"/><circle cx="33" cy="110" r="7" stroke="#ff6600" stroke-width="4" fill="#1a1a2e"/><rect x="52" y="102" width="55" height="12" rx="3" fill="#5566aa"/><rect x="52" y="122" width="280" height="24" rx="3" fill="#232340"/><rect x="52" y="150" width="280" height="24" rx="3" fill="#1e1e38"/><rect x="52" y="178" width="280" height="24" rx="3" fill="#232340"/><rect x="62" y="50" width="100" height="7" rx="3" fill="#555577"/><rect x="62" y="78" width="80" height="7" rx="3" fill="#555577"/><rect x="62" y="130" width="120" height="7" rx="3" fill="#555577"/><rect x="62" y="158" width="90" height="7" rx="3" fill="#555577"/><rect x="62" y="186" width="105" height="7" rx="3" fill="#555577"/><text x="200" y="252" text-anchor="middle" fill="#555577" font-size="11" font-family="sans-serif">Timeline</text></svg>`,

  "view-kanban":
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#1a1a2e"/><rect x="8" y="10" width="118" height="195" rx="6" fill="#232340"/><rect x="141" y="10" width="118" height="195" rx="6" fill="#232340"/><rect x="274" y="10" width="118" height="195" rx="6" fill="#232340"/><rect x="16" y="18" width="80" height="14" rx="3" fill="#5566aa"/><rect x="149" y="18" width="80" height="14" rx="3" fill="#5566aa"/><rect x="282" y="18" width="80" height="14" rx="3" fill="#5566aa"/><rect x="16" y="42" width="102" height="46" rx="4" fill="#1e1e38" stroke="#33335a" stroke-width="1"/><rect x="16" y="96" width="102" height="46" rx="4" fill="#1e1e38" stroke="#33335a" stroke-width="1"/><rect x="149" y="42" width="102" height="46" rx="4" fill="#1e1e38" stroke="#33335a" stroke-width="1"/><rect x="282" y="42" width="102" height="46" rx="4" fill="#1e1e38" stroke="#33335a" stroke-width="1"/><rect x="282" y="96" width="102" height="46" rx="4" fill="#1e1e38" stroke="#33335a" stroke-width="1"/><rect x="22" y="50" width="70" height="7" rx="3" fill="#555577"/><rect x="22" y="104" width="55" height="7" rx="3" fill="#555577"/><rect x="155" y="50" width="65" height="7" rx="3" fill="#555577"/><rect x="288" y="50" width="60" height="7" rx="3" fill="#555577"/><rect x="288" y="104" width="75" height="7" rx="3" fill="#555577"/><text x="200" y="240" text-anchor="middle" fill="#555577" font-size="11" font-family="sans-serif">Kanban</text></svg>`,

  "view-bookshelf":
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#1a1a2e"/>` +
    // Shelf 1 (top)
    `<rect x="20" y="20" width="40" height="70" rx="2" fill="#4a6fa5"/>` +
    `<rect x="64" y="20" width="14" height="70" rx="2" fill="#2f3a55"/>` +
    `<rect x="82" y="20" width="14" height="70" rx="2" fill="#3a4866"/>` +
    `<rect x="100" y="20" width="40" height="70" rx="2" fill="#a55a4a"/>` +
    `<rect x="144" y="20" width="40" height="70" rx="2" fill="#5a8a6f"/>` +
    `<rect x="188" y="20" width="14" height="70" rx="2" fill="#2f3a55"/>` +
    `<rect x="206" y="20" width="40" height="70" rx="2" fill="#9b8a5a"/>` +
    `<rect x="250" y="20" width="14" height="70" rx="2" fill="#3a4866"/>` +
    `<rect x="268" y="20" width="14" height="70" rx="2" fill="#2f3a55"/>` +
    `<rect x="20" y="93" width="262" height="2" rx="1" fill="#555577"/>` +
    // Shelf 2 (middle)
    `<rect x="20" y="110" width="14" height="70" rx="2" fill="#2f3a55"/>` +
    `<rect x="38" y="110" width="40" height="70" rx="2" fill="#7a4a8a"/>` +
    `<rect x="82" y="110" width="40" height="70" rx="2" fill="#4a6fa5"/>` +
    `<rect x="126" y="110" width="14" height="70" rx="2" fill="#3a4866"/>` +
    `<rect x="144" y="110" width="14" height="70" rx="2" fill="#2f3a55"/>` +
    `<rect x="162" y="110" width="40" height="70" rx="2" fill="#a55a4a"/>` +
    `<rect x="206" y="110" width="40" height="70" rx="2" fill="#5a8a6f"/>` +
    `<rect x="250" y="110" width="14" height="70" rx="2" fill="#2f3a55"/>` +
    `<rect x="20" y="183" width="244" height="2" rx="1" fill="#555577"/>` +
    // Shelf 3 (bottom)
    `<rect x="20" y="200" width="40" height="40" rx="2" fill="#4a6fa5"/>` +
    `<rect x="64" y="200" width="14" height="40" rx="2" fill="#2f3a55"/>` +
    `<rect x="82" y="200" width="40" height="40" rx="2" fill="#a55a4a"/>` +
    `<rect x="126" y="200" width="14" height="40" rx="2" fill="#3a4866"/>` +
    `<rect x="20" y="243" width="122" height="2" rx="1" fill="#555577"/>` +
    `<text x="320" y="250" text-anchor="middle" fill="#555577" font-size="11" font-family="sans-serif">Bookshelf</text></svg>`,
};

// ── CSS ────────────────────────────────────────────────────────────────────────

const AM_CSS = `
.am-overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}
.am-backdrop {
  position: absolute; inset: 0; background: rgba(0,0,0,.5);
}
.am-panel {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  width: 680px; max-width: 96vw; max-height: 88vh;
  background: var(--bg-primary, #1e1e1e);
  border: 1px solid var(--border-color, rgba(255,255,255,.1));
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0,0,0,.6);
  overflow: hidden;
}
.am-header {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
  flex-shrink: 0;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
}
.am-header-info { flex: 1; min-width: 0; }
.am-title {
  font-size: 13px; font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  margin: 0 0 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.am-current { font-size: 11px; color: var(--text-secondary, #888); }
.am-current-value { color: var(--link-color, #4a9eff); font-weight: 500; }
.am-preview-cancel { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-secondary, #888); margin-top: 40px; }
.am-preview-cancel svg { width: 48px; height: 48px; fill: currentColor; opacity: .55; }
.am-preview-cancel-text { font-size: 13px; font-weight: 500; color: var(--text-primary, #e0e0e0); text-align: center; }
.am-config-row { margin-top: 10px; }
.am-config-row-label { font-size: 11px; color: var(--text-secondary, #888); margin-bottom: 4px; }
.am-config-row-buttons { display: flex; align-items: center; gap: 8px; }
.am-config-btn {
  background: var(--bg-primary, #1e1e1e); color: var(--text-primary, #ccc);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 4px 10px; cursor: pointer; font-size: 11px; white-space: nowrap; flex-shrink: 0;
}
.am-config-btn:hover { background: var(--bg-hover, rgba(255,255,255,.07)); }
.am-config-path {
  color: var(--text-tertiary, #666); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
}
.am-config-path.is-set { color: var(--text-primary, #ccc); }
.am-close {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary, #888); font-size: 18px;
  line-height: 1; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
}
.am-close:hover { background: var(--bg-hover, rgba(255,255,255,.07)); }
.am-body { display: flex; flex: 1; min-height: 0; }
.am-list {
  width: 220px; flex-shrink: 0; overflow-y: auto; padding: 8px 0;
  border-right: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.am-section { padding: 10px 12px 4px; }
.am-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  color: var(--text-tertiary, #666); text-transform: uppercase;
  margin-bottom: 2px;
}
.am-section-desc {
  font-size: 10px; color: var(--text-tertiary, #666);
  line-height: 1.4; margin-bottom: 6px;
}
.am-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; cursor: pointer;
  color: var(--text-secondary, #aaa); font-size: 12px;
  user-select: none;
}
.am-item:hover { background: var(--bg-hover, rgba(255,255,255,.05)); color: var(--text-primary, #e0e0e0); }
.am-item.is-selected { background: var(--bg-hover, rgba(255,255,255,.07)); color: var(--text-primary, #e0e0e0); }
.am-item.is-selected .am-radio { background: var(--link-color, #4a9eff); border-color: var(--link-color, #4a9eff); }
.am-item.is-selected .am-radio::after { display: block; }
.am-radio {
  width: 12px; height: 12px; border-radius: 50%;
  border: 1.5px solid var(--text-tertiary, #666);
  background: transparent; flex-shrink: 0; position: relative;
}
.am-radio::after {
  content: ""; display: none;
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%,-50%);
  width: 5px; height: 5px; border-radius: 50%; background: #fff;
}
.am-section-disabled { opacity: .42; pointer-events: none; }
.am-section-disabled-items .am-item { opacity: .42; pointer-events: none; }
.am-disabled-note {
  font-size: 10px; color: var(--text-tertiary, #666);
  padding: 1px 14px 6px; font-style: italic;
}
.am-kanban-row {
  padding: 4px 14px 8px; display: none;
  align-items: center; gap: 6px;
}
.am-kanban-row.is-visible { display: flex; }
.am-kanban-label { font-size: 11px; color: var(--text-tertiary, #666); white-space: nowrap; }
.am-kanban-input {
  flex: 1; min-width: 0;
  background: var(--bg-secondary, #2a2a3a);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 4px 8px; font-size: 11px; color: var(--text-primary, #ccc); outline: none;
}
.am-kanban-input:focus { border-color: var(--link-color, #4a9eff); }
.am-divider { height: 1px; background: var(--border-color, rgba(255,255,255,.07)); margin: 6px 12px; }
.am-preview {
  flex: 1; min-width: 0; overflow: hidden;
  padding: 16px 14px; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-start;
  background: var(--bg-secondary, #181825);
}
.am-preview-svg {
  width: 100%; max-width: 340px;
  border-radius: 6px; overflow: hidden;
  border: 1px solid var(--border-color, rgba(255,255,255,.06));
}
.am-preview-svg svg { display: block; width: 100%; height: auto; }
.am-preview-name {
  font-size: 13px; font-weight: 600; color: var(--text-primary, #e0e0e0);
  margin-top: 12px; text-align: center;
}
.am-preview-desc {
  font-size: 11px; color: var(--text-secondary, #888);
  margin-top: 6px; text-align: center; line-height: 1.5; max-width: 280px;
}
.am-preview-placeholder {
  font-size: 12px; color: var(--text-tertiary, #555);
  margin-top: 60px; text-align: center;
}
.am-footer {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 10px 16px; gap: 8px;
  border-top: 1px solid var(--border-color, rgba(255,255,255,.08));
  flex-shrink: 0;
}
.am-footer-left { margin-right: auto; display: flex; gap: 6px; }
.am-btn {
  background: transparent; border: 1px solid var(--border-color, #444);
  border-radius: 5px; padding: 6px 14px;
  font-size: 12px; cursor: pointer; color: var(--text-secondary, #aaa);
}
.am-btn:hover { background: var(--bg-hover, rgba(255,255,255,.07)); color: var(--text-primary, #e0e0e0); }
.am-btn-primary {
  background: var(--link-color, #4a9eff); border-color: transparent;
  color: #fff; font-weight: 600;
}
.am-btn-primary:hover { opacity: .88; }

/* ── View options panel (below description in preview pane) ─────────────── */
.am-options {
  width: 100%; max-width: 340px;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--border-color, rgba(255,255,255,.08));
  text-align: left;
}
.am-options.is-hidden { display: none; }
.am-opt-group { margin-bottom: 10px; }
.am-opt-group:last-child { margin-bottom: 0; }
.am-opt-group-label {
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--text-tertiary, #666);
  margin-bottom: 5px;
}
.am-sort-pills { display: flex; gap: 4px; flex-wrap: wrap; }
.am-sort-pill {
  padding: 3px 9px; border-radius: 4px; font-size: 11px; cursor: pointer;
  border: 1px solid var(--border-color, rgba(255,255,255,.15));
  color: var(--text-secondary, #aaa); background: transparent;
  line-height: 1.6; user-select: none;
}
.am-sort-pill:hover { color: var(--text-primary, #e0e0e0); background: var(--bg-hover, rgba(255,255,255,.06)); }
.am-sort-pill.is-active {
  background: var(--link-color, #4a9eff); border-color: transparent; color: #fff;
}
.am-opt-checks { display: flex; flex-direction: column; gap: 5px; }
.am-opt-check {
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; color: var(--text-secondary, #aaa);
  cursor: pointer; user-select: none;
}
/* Checkbox size + accent-color come from the global rule in styles.css. */
.am-opt-note {
  font-size: 10px; color: var(--text-tertiary, #555);
  line-height: 1.55; font-style: italic; margin-top: 2px;
}
.am-opt-note code {
  font-style: normal; font-family: monospace;
  background: rgba(255,255,255,.06); padding: 0 3px; border-radius: 3px;
  font-size: 10px;
}
`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]!),
  );
}

// Material Symbols: cancel (outlined) — used for the "None (remove)" preview.
const CANCEL_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="m336-280 144-144 144 144 56-56-144-144 144-144-56-56-144 144-144-144-56 56 144 144-144 144 56 56ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Zm0-340Z"/></svg>`;

/** Read notion-page sub-selection values (cover / icon / icon-themed) from frontmatter. */
function readNotionFields(content: string): { cover: string; icon: string; iconThemed: boolean } {
  const out = { cover: "", icon: "", iconThemed: false };
  if (!content.startsWith("---")) return out;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return out;
  const fm = content.slice(4, end);
  out.cover = (fm.match(/^cover:\s*(.+)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  out.icon  = (fm.match(/^icon:\s*(.+)$/m)?.[1]  ?? "").trim().replace(/^["']|["']$/g, "");
  out.iconThemed = /^icon-themed:\s*true\s*$/m.test(fm);
  return out;
}

/** Read view-specific options from file frontmatter. */
function readViewOptions(content: string): {
  sort: string;
  showModified: boolean;
  showImagePreview: boolean;
  showExtensions: boolean;
  previewPane: boolean;
} {
  const defaults = { sort: "name-asc", showModified: true, showImagePreview: true, showExtensions: true, previewPane: false };
  if (!content.startsWith("---")) return defaults;
  const fmEnd = content.indexOf("\n---", 3);
  if (fmEnd === -1) return defaults;
  const fm = content.slice(4, fmEnd);

  const sortM        = fm.match(/^sort:\s*(\S+)/m);
  const modifiedM    = fm.match(/^show-modified:\s*(\S+)/m);
  const previewM     = fm.match(/^card-preview:\s*(\S+)/m);
  const extensionsM  = fm.match(/^show-extensions:\s*(\S+)/m);
  const paneM        = fm.match(/^preview-pane:\s*(\S+)/m);

  return {
    sort:             sortM       ? sortM[1].trim()                          : "name-asc",
    showModified:     modifiedM   ? modifiedM[1].trim()   !== "false"        : true,
    showImagePreview: previewM    ? previewM[1].trim()    !== "none"         : true,
    showExtensions:   extensionsM ? extensionsM[1].trim() !== "false"        : true,
    previewPane:      paneM       ? paneM[1].trim()       === "true"         : false,
  };
}

/**
 * Detect the current assignment from file frontmatter.
 * Handles flat (`layout: view-cards`) and nested (`layout:\n  type: view-cards`) formats.
 */
function readCurrentAssignment(content: string): {
  kind: "view" | "layout" | "none";
  slug: string | null;
  kanbanField: string;
} {
  if (!content.startsWith("---")) return { kind: "none", slug: null, kanbanField: "" };
  const fmEnd = content.indexOf("\n---", 3);
  if (fmEnd === -1) return { kind: "none", slug: null, kanbanField: "" };
  const fm = content.slice(4, fmEnd);

  // Flat: `layout: <slug>` (single-line value)
  const flatM = fm.match(/^layout:\s*(\S[^\n]*?)$/m);
  const flatSlug = flatM ? flatM[1].trim().replace(/^["']|["']$/g, "") : null;

  // Nested: `layout:\n  type: <slug>`
  const hasLayoutBlock = /^layout:\s*$/m.test(fm);
  const typeM = hasLayoutBlock ? fm.match(/^\s+type:\s*(\S+)/m) : null;
  const nestedSlug = !flatSlug && typeM ? typeM[1].trim() : null;

  const slug = flatSlug || nestedSlug || null;
  if (!slug) return { kind: "none", slug: null, kanbanField: "" };

  const kfM = fm.match(/^kanban-field:\s*(\S+)/m);
  const kanbanField = kfM ? kfM[1].trim() : "";

  const kind = slug.startsWith("view-") ? "view" : "layout";
  return { kind, slug, kanbanField };
}


/** Build a ```select codefence string from the modal's chosen options. */
export function buildSelectFence(opts: {
  display: string;            // cards | table | timeline | kanban | bookshelf
  displayOption?: string;     // sub-variant (e.g. "simple-list" under table)
  path?: string | null;       // omitted → defaults to host file's directory at render time
  sort: string;
  showModified: boolean;
  showImagePreview: boolean;  // cards only
  showExtensions: boolean;
  previewPane: boolean;
  kanbanField: string;        // kanban only
  groupBy?: string;           // bookshelf only
}): string {
  const lines: string[] = ["```select"];
  if (opts.path && opts.path.trim()) lines.push(`path: ${opts.path.trim()}`);
  if (opts.display !== "timeline") lines.push(`sort: ${opts.sort}`);
  lines.push(`display: ${opts.display}`);
  // Emit `option:` only when non-default so fences round-trip byte-stably.
  const spec = getDisplaySpec(opts.display);
  if (opts.displayOption && spec && opts.displayOption !== spec.defaultOption) {
    lines.push(`option: ${opts.displayOption}`);
  }
  if (opts.display === "bookshelf" && opts.groupBy && opts.groupBy.trim()) {
    lines.push(`group-by: ${opts.groupBy.trim()}`);
  }
  if (!opts.showModified) lines.push("show-modified: false");
  if (opts.display === "cards" && !opts.showImagePreview) lines.push("card-preview: none");
  const isCardsLike =
    opts.display === "cards" ||
    (opts.display === "table" && opts.displayOption === "simple-list");
  if (isCardsLike && !opts.showExtensions) {
    lines.push("show-extensions: false");
  }
  if (opts.previewPane) lines.push("preview-pane: true");
  if (opts.display === "kanban" && opts.kanbanField.trim()) {
    lines.push(`kanban-field: ${opts.kanbanField.trim()}`);
  }
  lines.push("```");
  return lines.join("\n");
}

/** Append a select codefence to the given file's body. Writes via writeFile + onFileUpdated. */
async function applyViewAssignment(
  filePath: string,
  slug: string,
  displayOption: string,
  kanbanField: string,
  groupBy: string,
  sort: string,
  showModified: boolean,
  showImagePreview: boolean,
  showExtensions: boolean,
  previewPane: boolean,
  deps: LayoutDeps,
): Promise<void> {
  const liveContent = deps.getActiveFileContent?.();
  let base: string;
  if (liveContent != null) {
    base = liveContent;
  } else {
    const r = await readFile(filePath);
    if (!r.ok) return;
    base = r.value;
  }

  // Strip any prior `layout: view-*` frontmatter so the file no longer
  // takes over the page via the old YAML path.
  const existing = readCurrentAssignment(base);
  let body = base;
  if (existing.slug && existing.slug.startsWith("view-")) {
    body = stripLayoutBlock(base);
  }

  const display = slug.replace(/^view-/, "");
  const fence = buildSelectFence({
    display,
    displayOption,
    sort,
    showModified,
    showImagePreview,
    showExtensions,
    previewPane,
    kanbanField,
    groupBy,
  });

  // Append the fence with a leading blank line for readability.
  const next = body.trimEnd() + "\n\n" + fence + "\n";

  const writeResult = await writeFile(filePath, next);
  if (!writeResult.ok) return;
  deps.onFileUpdated?.(filePath, next);

  void (window as unknown as { __MARKABLE_VAULT_MANAGER__?: { reloadVaultIndex?: () => void } })
    .__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = AM_CSS;
  document.head.appendChild(s);
}

function closeModal(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Open the unified View or Layout assignment modal for a .md file.
 *
 * Reads the file's current `layout:` frontmatter value, shows a two-panel
 * modal (radio list + preview), and writes the chosen assignment on confirm.
 * Views and layouts are shown in separate sections; selecting one clears the
 * other. For view-*.md and _folder.md files the Layouts section is grayed.
 */
/**
 * Parse a `select` codefence body for the option keys the modal cares about.
 * Returns the same shape as `readViewOptions` plus the chosen display.
 */
function readSelectFenceOptions(body: string): {
  slug: string;
  displayOption: string;
  sort: string;
  showModified: boolean;
  showImagePreview: boolean;
  showExtensions: boolean;
  previewPane: boolean;
  kanbanField: string;
  groupBy: string;
} {
  const get = (key: string): string | null => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const m = body.match(re);
    return m ? m[1].trim().replace(/\s+#.*$/, "") : null;
  };
  const rawDisplay = (get("display") ?? "cards").toLowerCase();
  const rawOption = get("option");
  // Resolve through display-options so a fence with `display: list` opens the
  // modal as Table + Simple list, matching how the widget renders it.
  const resolved = (() => {
    if (rawDisplay === "list") return { display: "table", option: "simple-list" };
    const spec = getDisplaySpec(rawDisplay);
    if (!spec) return { display: "cards", option: "grid" };
    const valid = new Set(spec.options.map((o) => o.slug));
    const opt = rawOption && valid.has(rawOption) ? rawOption : spec.defaultOption;
    return { display: spec.slug, option: opt };
  })();
  return {
    slug: `view-${resolved.display}`,
    displayOption:    resolved.option,
    sort:             get("sort") ?? "name-asc",
    showModified:     (get("show-modified")   ?? "true")  !== "false",
    showImagePreview: (get("card-preview")    ?? "full")  !== "none",
    showExtensions:   (get("show-extensions") ?? "true")  !== "false",
    previewPane:      (get("preview-pane")    ?? "false") === "true",
    kanbanField:      get("kanban-field") ?? "",
    groupBy:          get("group-by") ?? "",
  };
}

export async function openAssignModal(
  filePath: string,
  deps: LayoutDeps,
  fenceEdit?: { body: string; onApply: (newFence: string) => void; onRemove?: () => void },
  options?: { layoutsOnly?: boolean },
): Promise<void> {
  const layoutsOnly = options?.layoutsOnly ?? false;
  if (document.getElementById(OVERLAY_ID)) return;
  injectStyles();

  // Fetch file content and layout list concurrently
  const [fileResult, allLayouts] = await Promise.all([
    readFile(filePath),
    discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot()),
  ]);
  const fileContent = fileResult.ok ? fileResult.value : "";
  const current = readCurrentAssignment(fileContent);

  const basename = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? "";
  // For _folder.md and view-*.md, the Layouts section is read-only/grayed
  const isFolderScopedFile =
    basename === "_folder.md" ||
    (basename.startsWith("view-") && basename.endsWith(".md"));

  // In fence-edit mode, seed initial state from the fence body. Otherwise from file frontmatter.
  const seed = fenceEdit ? readSelectFenceOptions(fenceEdit.body) : null;

  // Normalize the current.slug (from YAML) to a layout stem. A file may have
  // `layout: notion` (the YAML slug) where the layout file is notion-page.layout.md,
  // so we accept either stem or yaml-slug here and store the stem internally.
  function normalizeToStem(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("view-")) return raw;
    const lt = allLayouts.find((l) => {
      const stem = l.filePath.split("/").pop()!.replace(".layout.md", "");
      return stem === raw || l.slug === raw;
    });
    return lt ? lt.filePath.split("/").pop()!.replace(".layout.md", "") : raw;
  }

  let selectedSlug: string | null = seed ? seed.slug : normalizeToStem(current.slug);
  let kanbanFieldValue: string = seed ? seed.kanbanField : current.kanbanField;
  // Per-view sub-variant ("simple-list" under view-table, etc.). Seeded from
  // the existing fence body in edit mode; defaults to the display's defaultOption.
  let optDisplayOption: string = seed?.displayOption ?? "";
  // Bookshelf group-by YAML key (e.g. "status" → one shelf per status value).
  let groupByValue: string = seed?.groupBy ?? "";

  // Notion Page sub-selections (cover image, icon, theme-aware) read from frontmatter.
  // These render inline under the preview when notion-page is selected.
  const initialNotion = readNotionFields(fileContent);
  let optCover: string = initialNotion.cover;
  let optIcon: string = initialNotion.icon;
  let optIconThemed: boolean = initialNotion.iconThemed;

  // View-specific display options (read from existing frontmatter, or defaults)
  const initialOpts = seed ?? readViewOptions(fileContent);
  let optSort:             string  = initialOpts.sort;
  let optShowModified:     boolean = initialOpts.showModified;
  let optShowImagePreview: boolean = initialOpts.showImagePreview;
  let optShowExtensions:   boolean = initialOpts.showExtensions;
  // Default preview pane to ON for cards view when the file has no explicit
  // preview-pane: key. Covers (a) opening an existing cards view file that
  // predates this option, and (b) assigning cards for the first time.
  const hasExplicitPreviewPane = fileContent.includes("preview-pane:");
  const previewPaneDefault = !hasExplicitPreviewPane && current.slug === "view-cards";
  let optPreviewPane: boolean = seed
    ? seed.previewPane
    : (hasExplicitPreviewPane ? initialOpts.previewPane : previewPaneDefault);

  // ── Overlay & panel ────────────────────────────────────────────────────────

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "am-overlay";

  const backdrop = document.createElement("div");
  backdrop.className = "am-backdrop";
  backdrop.addEventListener("click", closeModal);
  overlay.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "am-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", layoutsOnly ? "Apply Page Layout" : "View or Layout");
  overlay.appendChild(panel);

  // ── Header ─────────────────────────────────────────────────────────────────

  const header = document.createElement("div");
  header.className = "am-header";

  const headerInfo = document.createElement("div");
  headerInfo.className = "am-header-info";
  const titleEl = document.createElement("div");
  titleEl.className = "am-title";
  titleEl.textContent = basename;
  titleEl.title = filePath;
  headerInfo.appendChild(titleEl);
  const currentEl = document.createElement("div");
  currentEl.className = "am-current";
  const currentPrefix = layoutsOnly ? "Current Page Layout:" : "Currently:";
  if (current.slug) {
    currentEl.innerHTML = `${currentPrefix} <span class="am-current-value">${escHtml(current.slug)}</span>`;
  } else {
    currentEl.textContent = layoutsOnly ? `${currentPrefix} not set` : "Currently: No view or layout assigned";
  }
  headerInfo.appendChild(currentEl);
  header.appendChild(headerInfo);

  const closeBtn = document.createElement("button");
  closeBtn.className = "am-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeModal);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Body ───────────────────────────────────────────────────────────────────

  const body = document.createElement("div");
  body.className = "am-body";
  panel.appendChild(body);

  // Preview panel (right)
  const previewArea = document.createElement("div");
  previewArea.className = "am-preview";
  const previewSvgEl = document.createElement("div");
  previewSvgEl.className = "am-preview-svg";
  const previewNameEl = document.createElement("div");
  previewNameEl.className = "am-preview-name";
  const previewDescEl = document.createElement("div");
  previewDescEl.className = "am-preview-desc";
  const optionsArea = document.createElement("div");
  optionsArea.className = "am-options is-hidden";
  previewArea.appendChild(previewSvgEl);
  previewArea.appendChild(previewNameEl);
  previewArea.appendChild(previewDescEl);
  previewArea.appendChild(optionsArea);

  // List panel (left)
  const listEl = document.createElement("div");
  listEl.className = "am-list";
  body.appendChild(listEl);
  body.appendChild(previewArea);

  // Item registry for selection management
  const allItems: Array<{ el: HTMLElement; slug: string | null }> = [];

  let kanbanRowEl: HTMLElement | null = null;
  let bookshelfRowEl: HTMLElement | null = null;

  function updatePreview(slug: string | null): void {
    renderOptionsArea(slug);
    // Restore default visibility (overridden in the None branch below)
    previewSvgEl.style.display = "";
    previewNameEl.style.display = "";
    if (!slug) {
      // "None (remove)" — Material Cancel icon stacked over centered text.
      previewSvgEl.innerHTML = "";
      previewSvgEl.style.display = "none";
      previewNameEl.textContent = "";
      previewNameEl.style.display = "none";
      previewDescEl.innerHTML =
        `<div class="am-preview-cancel">${CANCEL_ICON_SVG}<div class="am-preview-cancel-text">Remove Page Layout</div></div>`;
      return;
    }
    const vt = VIEW_TYPES.find((v) => v.slug === slug);
    if (vt) {
      previewSvgEl.innerHTML = VIEW_PREVIEW_SVGS[slug] ?? "";
      previewNameEl.textContent = vt.name;
      previewDescEl.textContent = vt.description;
      return;
    }
    const lt = allLayouts.find((l) => {
      const stem = l.filePath.split("/").pop()!.replace(".layout.md", "");
      return stem === slug || l.slug === slug;
    });
    if (lt) {
      const svgKey = lt.filePath.split("/").pop()!;
      const svg = LAYOUT_PREVIEW_SVGS[svgKey] ??
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#1a1a2e"/><text x="200" y="138" text-anchor="middle" fill="#555" font-size="13" font-family="sans-serif">${escHtml(lt.name)}</text></svg>`;
      previewSvgEl.innerHTML = svg;
      previewNameEl.textContent = lt.name;
      previewDescEl.textContent = lt.description;
      return;
    }
    // Unknown slug — show empty placeholder
    previewSvgEl.innerHTML = "";
    previewNameEl.textContent = "";
    previewDescEl.innerHTML = `<span class="am-preview-placeholder">Select a layout to preview</span>`;
  }

  function renderOptionsArea(slug: string | null): void {
    optionsArea.innerHTML = "";

    // ── Notion Page sub-selections: cover image, icon, theme-aware ───────────
    if (slug === "notion-page" || slug === "notion") {
      optionsArea.classList.remove("is-hidden");
      const fileDir = filePath.split("/").slice(0, -1).join("/");

      const addImagePicker = (label: string, getValue: () => string, setValue: (v: string) => void): void => {
        const row = document.createElement("div");
        row.className = "am-config-row";
        const labelEl = document.createElement("div");
        labelEl.className = "am-config-row-label";
        labelEl.textContent = label;
        row.appendChild(labelEl);
        const btnRow = document.createElement("div");
        btnRow.className = "am-config-row-buttons";
        const btn = document.createElement("button");
        btn.className = "am-config-btn";
        btn.textContent = "Choose…";
        const pathEl = document.createElement("span");
        pathEl.className = "am-config-path";
        const currentVal = getValue();
        if (currentVal) {
          pathEl.textContent = currentVal.split("/").pop() ?? currentVal;
          pathEl.title = currentVal;
          pathEl.classList.add("is-set");
        } else {
          pathEl.textContent = "Not set";
        }
        btn.addEventListener("click", async () => {
          const result = await openAssetDialog();
          if (!result.cancelled) {
            const stored = result.path.startsWith(fileDir + "/")
              ? "./" + result.path.slice(fileDir.length + 1)
              : result.path;
            setValue(stored);
            pathEl.textContent = stored.split("/").pop() ?? stored;
            pathEl.title = stored;
            pathEl.classList.add("is-set");
          }
        });
        btnRow.appendChild(btn);
        btnRow.appendChild(pathEl);
        row.appendChild(btnRow);
        optionsArea.appendChild(row);
      };

      addImagePicker("Background image",       () => optCover, (v) => { optCover = v; });
      addImagePicker("Icon (image or SVG)",    () => optIcon,  (v) => { optIcon  = v; });

      // Theme-aware checkbox
      const checkGroup = document.createElement("div");
      checkGroup.className = "am-opt-group";
      checkGroup.style.marginTop = "10px";
      const row = document.createElement("label");
      row.className = "am-opt-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = optIconThemed;
      cb.addEventListener("change", () => { optIconThemed = cb.checked; });
      cb.addEventListener("click", (e) => e.stopPropagation());
      row.appendChild(cb);
      row.appendChild(document.createTextNode("Make icon theme-aware (SVG fills → currentColor)"));
      checkGroup.appendChild(row);
      optionsArea.appendChild(checkGroup);
      return;
    }

    if (!slug?.startsWith("view-")) {
      optionsArea.classList.add("is-hidden");
      return;
    }
    optionsArea.classList.remove("is-hidden");

    // ── Sort order (not shown for timeline — always chronological) ──────────
    if (slug !== "view-timeline") {
      const sortGroup = document.createElement("div");
      sortGroup.className = "am-opt-group";
      const sortLabel = document.createElement("div");
      sortLabel.className = "am-opt-group-label";
      sortLabel.textContent = "Sort";
      sortGroup.appendChild(sortLabel);
      const pillRow = document.createElement("div");
      pillRow.className = "am-sort-pills";
      const SORT_OPTS: Array<{ value: string; label: string }> = [
        { value: "name-asc",      label: "Name ↑" },
        { value: "name-desc",     label: "Name ↓" },
        { value: "modified-asc",  label: "Date ↑" },
        { value: "modified-desc", label: "Date ↓" },
      ];
      for (const opt of SORT_OPTS) {
        const pill = document.createElement("span");
        pill.className = "am-sort-pill" + (optSort === opt.value ? " is-active" : "");
        pill.textContent = opt.label;
        pill.addEventListener("click", () => {
          optSort = opt.value;
          pillRow.querySelectorAll(".am-sort-pill").forEach((p) =>
            p.classList.toggle("is-active", (p as HTMLElement).textContent === opt.label),
          );
        });
        pillRow.appendChild(pill);
      }
      sortGroup.appendChild(pillRow);
      optionsArea.appendChild(sortGroup);
    }

    // ── Checkboxes ──────────────────────────────────────────────────────────
    const checkGroup = document.createElement("div");
    checkGroup.className = "am-opt-group";
    const checkLabel = document.createElement("div");
    checkLabel.className = "am-opt-group-label";
    checkLabel.textContent = "Show";
    checkGroup.appendChild(checkLabel);
    const checks = document.createElement("div");
    checks.className = "am-opt-checks";
    checkGroup.appendChild(checks);
    optionsArea.appendChild(checkGroup);

    function addCheck(label: string, checked: boolean, onChange: (v: boolean) => void): void {
      const row = document.createElement("label");
      row.className = "am-opt-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.addEventListener("change", () => onChange(cb.checked));
      cb.addEventListener("click", (e) => e.stopPropagation());
      row.appendChild(cb);
      row.appendChild(document.createTextNode(label));
      checks.appendChild(row);
    }

    // "Layout option" pill row — shown when the underlying display has >1 options.
    const displaySlug = slug?.replace(/^view-/, "") ?? "";
    const optSpec = getDisplaySpec(displaySlug);
    if (optSpec && optSpec.options.length > 1) {
      // Initialize to display default when not previously set or invalid.
      const validSlugs = new Set(optSpec.options.map((o) => o.slug));
      if (!validSlugs.has(optDisplayOption)) {
        optDisplayOption = optSpec.defaultOption;
      }
      const optGroup = document.createElement("div");
      optGroup.className = "am-opt-group";
      const optLabelEl = document.createElement("div");
      optLabelEl.className = "am-opt-group-label";
      optLabelEl.textContent = "Layout option";
      optGroup.appendChild(optLabelEl);
      const pillRow = document.createElement("div");
      pillRow.className = "am-sort-pills";
      for (const o of optSpec.options) {
        const pill = document.createElement("span");
        pill.className = "am-sort-pill" + (optDisplayOption === o.slug ? " is-active" : "");
        pill.textContent = o.label;
        if (o.description) pill.title = o.description;
        pill.addEventListener("click", () => {
          optDisplayOption = o.slug;
          pillRow.querySelectorAll(".am-sort-pill").forEach((p) =>
            p.classList.toggle("is-active", (p as HTMLElement).textContent === o.label),
          );
          // Re-render so option-dependent rows ("Show file extensions") refresh.
          renderOptionsArea(slug);
        });
        pillRow.appendChild(pill);
      }
      optGroup.appendChild(pillRow);
      optionsArea.appendChild(optGroup);
    }

    // "Date modified" — all views
    addCheck("Date modified", optShowModified, (v) => { optShowModified = v; });

    // "Image preview" — cards only
    if (slug === "view-cards") {
      addCheck("Image preview", optShowImagePreview, (v) => { optShowImagePreview = v; });
    }

    // "File extensions" — cards and Table → Simple list
    if (slug === "view-cards" || (slug === "view-table" && optDisplayOption === "simple-list")) {
      addCheck("File extensions", optShowExtensions, (v) => { optShowExtensions = v; });
    }

    // "Preview pane" — all views
    addCheck("Preview pane", optPreviewPane, (v) => { optPreviewPane = v; });

    // ── Extra-fields note (table and kanban) ────────────────────────────────
    // extra-fields lets you add frontmatter columns to the view. Because it's
    // a YAML sequence (not a simple key:value), it's not editable here — users
    // add it directly to the frontmatter. The note below explains the syntax.
    if (slug === "view-table" || slug === "view-kanban") {
      const noteGroup = document.createElement("div");
      noteGroup.className = "am-opt-group";
      const noteLabel = document.createElement("div");
      noteLabel.className = "am-opt-group-label";
      noteLabel.textContent = "Custom columns";
      noteGroup.appendChild(noteLabel);
      const note = document.createElement("div");
      note.className = "am-opt-note";
      note.innerHTML =
        slug === "view-table"
          ? `Add <code>extra-fields: [status, priority]</code> to the frontmatter to include custom metadata columns in the table.`
          : `Add <code>extra-fields: [status]</code> to the frontmatter to show extra metadata on each kanban card.`;
      noteGroup.appendChild(note);
      optionsArea.appendChild(noteGroup);
    }
  }

  function selectSlug(slug: string | null): void {
    selectedSlug = slug;
    // Reset option to the new display's default so an old "simple-list" from
    // Table doesn't bleed into Kanban or Cards.
    const newSpec = slug ? getDisplaySpec(slug.replace(/^view-/, "")) : null;
    optDisplayOption = newSpec?.defaultOption ?? "";
    for (const { el, slug: s } of allItems) {
      const isSel = s === slug;
      el.classList.toggle("is-selected", isSel);
      el.setAttribute("tabindex", isSel ? "0" : "-1");
    }
    // When the user picks view-cards and has never explicitly set the preview
    // pane option (no key in the file), default to ON.
    if (slug === "view-cards" && !hasExplicitPreviewPane) {
      optPreviewPane = true;
    }
    updatePreview(slug);
    if (kanbanRowEl) {
      kanbanRowEl.classList.toggle("is-visible", slug === "view-kanban");
    }
    if (bookshelfRowEl) {
      bookshelfRowEl.classList.toggle("is-visible", slug === "view-bookshelf");
    }
  }

  function addItem(label: string, slug: string | null, disabled = false): HTMLElement {
    const item = document.createElement("div");
    item.className = "am-item";
    if (disabled) item.style.cssText = "opacity:.42;pointer-events:none;";
    if (slug === selectedSlug) item.classList.add("is-selected");
    const radio = document.createElement("span");
    radio.className = "am-radio";
    item.appendChild(radio);
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    item.appendChild(labelEl);
    if (!disabled) item.addEventListener("click", () => selectSlug(slug));
    listEl.appendChild(item);
    allItems.push({ el: item, slug });
    return item;
  }

  // ── VIEWS section ──────────────────────────────────────────────────────────
  // Hidden when `layoutsOnly` is set (eye-icon / page-level flow). Views are
  // now codefence-driven (see select-builder); the page-level modal only
  // controls typography layouts.

  if (!layoutsOnly) {
    const viewSection = document.createElement("div");
    viewSection.className = "am-section";
    const viewLabel = document.createElement("div");
    viewLabel.className = "am-section-label";
    viewLabel.textContent = "Views";
    viewSection.appendChild(viewLabel);
    const viewDesc = document.createElement("div");
    viewDesc.className = "am-section-desc";
    viewDesc.textContent = "Renders this directory's files as a collection";
    viewSection.appendChild(viewDesc);
    listEl.appendChild(viewSection);

    for (const vt of VIEW_TYPES) {
      addItem(vt.name, vt.slug);
      if (vt.requiresField) {
        kanbanRowEl = document.createElement("div");
        kanbanRowEl.className = "am-kanban-row";
        if (selectedSlug === "view-kanban") kanbanRowEl.classList.add("is-visible");
        const kfl = document.createElement("label");
        kfl.className = "am-kanban-label";
        kfl.textContent = "kanban-field:";
        kanbanRowEl.appendChild(kfl);
        const kfi = document.createElement("input");
        kfi.type = "text";
        kfi.className = "am-kanban-input";
        kfi.placeholder = "e.g. status";
        kfi.value = kanbanFieldValue;
        kfi.addEventListener("input", () => { kanbanFieldValue = kfi.value; });
        kfi.addEventListener("click", (e) => e.stopPropagation());
        kanbanRowEl.appendChild(kfi);
        listEl.appendChild(kanbanRowEl);
      }
      if (vt.slug === "view-bookshelf") {
        bookshelfRowEl = document.createElement("div");
        bookshelfRowEl.className = "am-kanban-row";
        if (selectedSlug === "view-bookshelf") bookshelfRowEl.classList.add("is-visible");
        const gbl = document.createElement("label");
        gbl.className = "am-kanban-label";
        gbl.textContent = "group-by:";
        bookshelfRowEl.appendChild(gbl);
        const gbi = document.createElement("input");
        gbi.type = "text";
        gbi.className = "am-kanban-input";
        gbi.placeholder = "e.g. status (optional)";
        gbi.value = groupByValue;
        gbi.addEventListener("input", () => { groupByValue = gbi.value; });
        gbi.addEventListener("click", (e) => e.stopPropagation());
        bookshelfRowEl.appendChild(gbi);
        listEl.appendChild(bookshelfRowEl);
      }
    }

    // ── LAYOUTS section divider ───────────────────────────────────────────
    const div1 = document.createElement("div");
    div1.className = "am-divider";
    listEl.appendChild(div1);
  }

  // ── LAYOUTS section ─────────────────────────────────────────────────────────

  const layoutSection = document.createElement("div");
  layoutSection.className = "am-section";
  if (isFolderScopedFile) layoutSection.classList.add("am-section-disabled");
  const layoutLabel = document.createElement("div");
  layoutLabel.className = "am-section-label";
  layoutLabel.textContent = layoutsOnly ? "ASSIGN LAYOUT" : "Layouts";
  layoutSection.appendChild(layoutLabel);
  if (!layoutsOnly) {
    const layoutDesc = document.createElement("div");
    layoutDesc.className = "am-section-desc";
    layoutDesc.textContent = "Styles this file's own content";
    layoutSection.appendChild(layoutDesc);
  }
  if (isFolderScopedFile) {
    const note = document.createElement("div");
    note.className = "am-disabled-note";
    note.textContent = "Not applicable for view definition files";
    layoutSection.appendChild(note);
  }
  listEl.appendChild(layoutSection);

  if (allLayouts.length === 0 && !isFolderScopedFile) {
    const emptyNote = document.createElement("div");
    emptyNote.className = "am-disabled-note";
    emptyNote.textContent = "No layouts found in App Support/layouts/";
    listEl.appendChild(emptyNote);
  } else {
    for (const lt of allLayouts) {
      const stem = lt.filePath.split("/").pop()!.replace(".layout.md", "");
      addItem(lt.name, stem, isFolderScopedFile);
    }
  }

  // ── NONE section ───────────────────────────────────────────────────────────

  const div2 = document.createElement("div");
  div2.className = "am-divider";
  listEl.appendChild(div2);

  addItem("None (remove)", null);

  // Default-select the first layout when opening in layoutsOnly mode and no
  // layout is currently assigned.
  if (layoutsOnly && selectedSlug === null && allLayouts.length > 0 && !isFolderScopedFile) {
    const firstStem = allLayouts[0].filePath.split("/").pop()!.replace(".layout.md", "");
    selectedSlug = firstStem;
    for (const { el, slug: s } of allItems) {
      el.classList.toggle("is-selected", s === firstStem);
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footer = document.createElement("div");
  footer.className = "am-footer";
  panel.appendChild(footer);

  const footerLeft = document.createElement("div");
  footerLeft.className = "am-footer-left";
  if (current.kind === "view" && current.slug) {
    const openViewBtn = document.createElement("button");
    openViewBtn.className = "am-btn";
    openViewBtn.textContent = "Open View";
    openViewBtn.addEventListener("click", () => {
      closeModal();
      const sep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      const parentDir = sep > 0 ? filePath.slice(0, sep) : "";
      if (parentDir) (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__?.(parentDir, filePath);
    });
    footerLeft.appendChild(openViewBtn);

    const editBtn = document.createElement("button");
    editBtn.className = "am-btn";
    editBtn.textContent = "Edit Source";
    editBtn.addEventListener("click", () => {
      closeModal();
      (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(filePath);
      (window as any).__MARKABLE_TAB_MANAGER__?.exitLayoutView?.();
    });
    footerLeft.appendChild(editBtn);
  }
  footer.appendChild(footerLeft);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "am-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closeModal);
  footer.appendChild(cancelBtn);

  const applyBtn = document.createElement("button");
  applyBtn.className = "am-btn am-btn-primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", async () => {
    closeModal();
    // Fence-edit mode: shortcut Apply to onApply (or onRemove for "remove assignment")
    if (fenceEdit) {
      if (selectedSlug === null) {
        fenceEdit.onRemove?.();
      } else if (selectedSlug.startsWith("view-")) {
        const fence = buildSelectFence({
          display: selectedSlug.replace(/^view-/, ""),
          displayOption: optDisplayOption,
          sort: optSort,
          showModified: optShowModified,
          showImagePreview: optShowImagePreview,
          showExtensions: optShowExtensions,
          previewPane: optPreviewPane,
          kanbanField: kanbanFieldValue,
          groupBy: groupByValue,
        });
        fenceEdit.onApply(fence);
      }
      // Picking a typography layout while editing a select fence is a no-op
      // (layouts go in YAML, not codefences).
      return;
    }
    if (selectedSlug === null) {
      await removeLayoutFromFile(filePath, deps);
    } else if (selectedSlug.startsWith("view-")) {
      await applyViewAssignment(
        filePath, selectedSlug, optDisplayOption, kanbanFieldValue, groupByValue,
        optSort, optShowModified, optShowImagePreview, optShowExtensions, optPreviewPane,
        deps,
      );
    } else {
      // For notion-page, pass cover/icon/icon-themed as extra fields so they
      // land in the YAML alongside `layout: notion-page` in one write.
      const extraFields: Record<string, string> = {};
      if (selectedSlug === "notion-page") {
        if (optCover) extraFields.cover = optCover;
        if (optIcon)  extraFields.icon  = optIcon;
        if (optIconThemed) extraFields["icon-themed"] = "true";
      }
      await applyLayoutToFile(filePath, selectedSlug, deps, extraFields);
    }
  });
  footer.appendChild(applyBtn);

  // Initial state
  updatePreview(selectedSlug);

  document.body.appendChild(overlay);

  attachModalKeyboard({
    modal: overlay,
    onClose: closeModal,
    lists: [
      { container: listEl,      itemSelector: ".am-item" },
      { container: optionsArea, itemSelector: ".am-item" },
    ],
  });
}
