/**
 * Properties Wrangler — vocabulary editor mounted inside File Properties.
 *
 * File Properties owns the sidebar. Manage opens the caret tree of every
 * tag and category: the properties file, tags already in the vault index,
 * and the values used in notes. Near-duplicates are red. Double-click or
 * right-click renames, the repeat icon merges, and the tree supports
 * drag-drop nesting (slash paths in the definitions file).
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";
import { attachModalKeyboard } from "../../lib/modal-keyboard";
import {
  classifyScanTag,
  nearDupClusters,
  type NearDupCluster,
} from "../../lib/near-dup-clusters";
import {
  parsePropertiesFile,
  rewritePropertiesSection,
  type MetaStore,
} from "../../lib/meta-manager";
import { validatePropertyRename } from "../../lib/property-rename";
import {
  findSimilarDefinitions,
  validateMergeField,
} from "../../lib/property-merge";

const CSS_ID = "__markable_properties_wrangler_css__";
const OVERLAY_ID = "__properties-wrangler-overlay__";

/** Material Symbols Outlined: repeat */
const REPEAT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">' +
  '<path d="M280-80 120-240l160-160 42 44-86 86h464v-160h60v220H236l86 86-42 44Zm-80-450v-220h524l-86-86 42-44 160 160-160 160-42-44 86-86H260v160h-60Z"/>' +
  "</svg>";

const CSS = `
.pw-wrap {
  display:flex; flex-direction:column; height:100%; min-height:0;
  font-size:12px; color:var(--text-primary); overflow-x:hidden; box-sizing:border-box;
}
.pw-bar {
  display:flex; align-items:center; justify-content:flex-end;
  padding:4px 8px 0; flex-shrink:0;
}
.pw-manage {
  background:none; border:none; padding:2px 0; cursor:pointer;
  color:var(--link-color, #4a9eff); font-size:12px; text-decoration:underline;
}
.pw-manage:hover { opacity:.85; }
.pw-scroll { flex:1; overflow:auto; padding:0 4px 8px; min-height:0; min-width:0; }
.pw-section-row {
  display:flex; align-items:center; gap:4px; margin:8px 4px 2px; min-width:0;
}
.pw-section {
  flex:1; min-width:0; font-size:11px; font-weight:600; letter-spacing:.04em;
  text-transform:uppercase; color:var(--text-tertiary, #888);
}
.pw-plus, .pw-repeat {
  flex-shrink:0; width:20px; height:20px; padding:0; border:none;
  background:transparent; color:var(--text-secondary, #aaa); cursor:pointer;
  border-radius:4px; display:flex; align-items:center; justify-content:center;
  font-size:14px; line-height:1;
}
.pw-plus:hover, .pw-repeat:hover { background:var(--bg-hover, rgba(255,255,255,.06)); color:var(--text-primary); }
.pw-repeat svg { width:16px; height:16px; display:block; fill:currentColor; }
.pw-add-inline {
  display:flex; gap:4px; margin:2px 8px 6px; min-width:0;
}
.pw-add-inline input {
  flex:1; min-width:0; font-size:12px; padding:4px 6px;
  background:transparent; color:var(--text-primary);
  border:1px solid var(--border-color); border-radius:4px;
}
.pw-tree { min-width:0; }
.pw-node { min-width:0; }
.pw-row {
  display:flex; align-items:center; gap:4px; padding:2px 4px; min-width:0;
  border-radius:4px; cursor:grab; user-select:none;
}
.pw-row:hover { background:var(--bg-hover, rgba(255,255,255,.05)); }
.pw-row.is-dup .pw-name { color:#d94a4a; }
.pw-row.is-drag { opacity:.45; cursor:grabbing; }
.pw-row.is-drop, .pw-section-row.is-drop {
  outline:1px dashed var(--link-color, #4a9eff);
}
.pw-ghost {
  position:fixed; z-index:1200; pointer-events:none; padding:3px 8px;
  background:var(--bg-secondary, #2a2a2a); border:1px solid var(--border-color, #444);
  border-radius:4px; font-size:12px; white-space:nowrap; opacity:.9;
}
.pw-caret {
  flex-shrink:0; width:16px; height:16px; padding:0; border:none;
  background:transparent; color:var(--text-tertiary, #888); cursor:pointer;
  font-size:9px; line-height:16px;
}
.pw-caret.is-empty { visibility:hidden; cursor:default; }
.pw-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.pw-count { flex-shrink:0; color:var(--text-tertiary, #888); font-size:10px; }
.pw-kids { padding-left:14px; min-width:0; }
.pw-empty { color:var(--text-tertiary, #888); font-style:italic; padding:8px; }
.pw-overlay {
  position:fixed; inset:0; z-index:1000;
  display:flex; align-items:center; justify-content:center;
}
.pw-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.4); }
.pw-sheet {
  position:relative; width:525px; max-width:90vw; height:min(720px, 80vh); max-height:80vh;
  background:var(--bg-primary); border:1px solid var(--border-color);
  border-radius:12px; display:flex; flex-direction:column; overflow:hidden;
  font-family:var(--ui-font); font-size:13px; color:var(--text-primary);
  box-shadow:0 16px 48px rgba(0,0,0,.2); outline:none;
}
.pw-sheet-header { padding:16px 20px 0; position:relative; flex-shrink:0; }
.pw-sheet-title { font-size:18px; font-weight:600; margin:0 36px 0 0; }
.pw-sheet-close {
  position:absolute; top:12px; right:12px; width:28px; height:28px;
  border:none; background:none; color:var(--text-secondary);
  font-size:20px; line-height:1; cursor:pointer; border-radius:6px;
}
.pw-sheet-close:hover { background:var(--code-bg, rgba(0,0,0,.06)); color:var(--text-primary); }
.pw-pane { padding:12px 20px; flex-shrink:0; }
.pw-pane-title {
  font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
  color:var(--text-tertiary, #888); margin:0 0 8px;
}
.pw-setup { display:flex; flex-direction:column; gap:8px; }
.pw-setup-input, .pw-scan-btn {
  width:100%; box-sizing:border-box; font-size:13px; padding:7px 10px;
  border:1px solid var(--border-color); border-radius:6px;
}
.pw-setup-input {
  background:transparent; color:var(--text-primary); cursor:pointer;
}
.pw-setup-input::placeholder { color:var(--text-tertiary, #888); }
.pw-scan-btn {
  background:var(--link-color, #4a9eff); border-color:var(--link-color, #4a9eff);
  color:#fff; cursor:pointer; font-weight:500;
}
.pw-scan-btn:hover { filter:brightness(1.05); }
.pw-scan-btn:disabled { opacity:.5; cursor:default; }
.pw-rule {
  border:none; border-top:1px solid var(--border-color, rgba(255,255,255,.1));
  margin:0 20px;
}
.pw-results { flex:1; min-height:0; display:flex; flex-direction:column; padding:12px 20px 20px; overflow:hidden; }
.pw-results-bar {
  display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-shrink:0;
}
.pw-results-bar .pw-pane-title { flex:1; margin:0; }
.pw-search {
  width:140px; flex-shrink:0; box-sizing:border-box; font-size:11px; padding:4px 8px;
  background:transparent; color:var(--text-primary);
  border:1px solid var(--border-color); border-radius:6px;
}
.pw-results-body { flex:1; min-height:0; overflow:auto; min-width:0; }
.pw-group { margin:4px 0 10px; }
.pw-pop {
  position:fixed; z-index:1100; min-width:160px; max-width:240px;
  background:var(--bg-primary); border:1px solid var(--border-color);
  border-radius:8px; padding:6px; box-shadow:0 8px 24px rgba(0,0,0,.2);
}
.pw-pop-label {
  font-size:10px; text-transform:uppercase; letter-spacing:.04em;
  color:var(--text-tertiary, #888); padding:4px 6px;
}
.pw-pop button {
  display:block; width:100%; text-align:left; padding:6px 8px;
  border:none; background:transparent; color:var(--text-primary);
  cursor:pointer; border-radius:4px; font-size:12px;
}
.pw-pop button:hover { background:var(--bg-hover, rgba(255,255,255,.06)); }
.pw-edit {
  flex-shrink:0; width:20px; height:20px; padding:0; border:none;
  background:transparent; color:var(--text-secondary, #aaa); cursor:pointer;
  border-radius:4px; font-size:12px; line-height:1;
}
.pw-edit:hover { background:var(--bg-hover, rgba(255,255,255,.06)); color:var(--text-primary); }
.pw-rename {
  position:relative; width:360px; max-width:90vw;
  background:var(--bg-primary); border:1px solid var(--border-color);
  border-radius:12px; padding:16px 18px; z-index:1;
  box-shadow:0 16px 48px rgba(0,0,0,.2);
}
.pw-rename h3 { margin:0 0 10px; font-size:16px; }
.pw-rename input {
  width:100%; box-sizing:border-box; font-size:13px; padding:7px 10px;
  background:transparent; color:var(--text-primary);
  border:1px solid var(--border-color); border-radius:6px;
}
.pw-rename-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.pw-rename-actions button {
  padding:6px 12px; border-radius:6px; font-size:13px; cursor:pointer;
  border:1px solid var(--border-color); background:transparent; color:var(--text-primary);
}
.pw-rename-apply {
  background:var(--link-color, #4a9eff) !important;
  border-color:var(--link-color, #4a9eff) !important; color:#fff !important;
}
.pw-rename-apply:disabled, .pw-rename-actions button:disabled { opacity:.5; cursor:default; }
.pw-rename-status { margin-top:10px; font-size:12px; color:var(--text-secondary); }
.pw-rename-status.is-error { color:#d94a4a; }
.pw-rename-status.is-ok { color:#3d9a5b; }
.pw-merge {
  position:relative; width:440px; max-width:92vw;
  background:var(--bg-primary); border:1px solid var(--border-color);
  border-radius:12px; padding:18px 20px; z-index:1;
  box-shadow:0 16px 48px rgba(0,0,0,.2);
}
.pw-merge h3 { margin:0 0 6px; font-size:16px; }
.pw-merge-target { font-size:12px; color:var(--text-secondary); margin-bottom:12px; }
.pw-merge-target strong { color:var(--text-primary); }
.pw-merge-warning {
  background:rgba(217, 74, 74, 0.1); border:1px solid rgba(217, 74, 74, 0.3);
  color:#d94a4a; border-radius:6px; padding:8px 10px; font-size:12px; margin-bottom:12px;
}
.pw-merge-confirm-label {
  display:flex; align-items:center; gap:8px; font-size:12px; margin-bottom:14px;
  cursor:pointer; color:var(--text-primary);
}
.pw-merge-header-row {
  display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;
}
.pw-merge-header-row span { font-size:12px; font-weight:600; color:var(--text-secondary); }
.pw-merge-add-btn {
  font-size:12px; padding:3px 8px; border-radius:4px; border:1px solid var(--border-color);
  background:transparent; color:var(--text-primary); cursor:pointer;
}
.pw-merge-add-btn:hover { background:var(--bg-hover, rgba(255,255,255,.06)); }
.pw-merge-search {
  width:100%; box-sizing:border-box; font-size:13px; padding:6px 10px;
  background:transparent; color:var(--text-primary);
  border:1px solid var(--border-color); border-radius:6px; margin-bottom:8px;
}
.pw-merge-options {
  max-height:140px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; margin-bottom:8px;
}
.pw-merge-option, .pw-merge-chip {
  text-align:left; font-size:12px; padding:4px 8px; border-radius:4px;
  border:1px solid var(--border-color); background:transparent; color:var(--text-primary); cursor:pointer;
}
.pw-merge-option:hover, .pw-merge-chip:hover { background:var(--bg-hover, rgba(255,255,255,.06)); }
.pw-merge-picked { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
.pw-merge-empty { font-size:12px; color:var(--text-secondary); padding:4px 2px; }
.pw-merge-field-row { display:flex; flex-direction:column; gap:4px; }
.pw-merge-field-input-wrap { display:flex; gap:6px; align-items:center; }
.pw-merge-input {
  flex:1; box-sizing:border-box; font-size:13px; padding:6px 10px;
  background:transparent; color:var(--text-primary);
  border:1px solid var(--border-color); border-radius:6px;
}
.pw-merge-input.is-invalid { border-color:#d94a4a; }
.pw-merge-remove {
  flex-shrink:0; width:26px; height:26px; padding:0; border:none;
  background:transparent; color:var(--text-secondary); cursor:pointer;
  border-radius:4px; font-size:16px; line-height:1;
}
.pw-merge-remove:hover { background:var(--bg-hover, rgba(255,255,255,.06)); color:var(--text-primary); }
.pw-merge-error-msg { font-size:11px; color:#d94a4a; margin-top:2px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.pw-suggest-fix {
  background:transparent; border:1px dashed #d94a4a; color:#d94a4a;
  border-radius:4px; padding:1px 6px; font-size:11px; cursor:pointer;
}
.pw-suggest-fix:hover { background:rgba(217, 74, 74, 0.15); }
.pw-merge-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
.pw-merge-actions button {
  padding:6px 12px; border-radius:6px; font-size:13px; cursor:pointer;
  border:1px solid var(--border-color); background:transparent; color:var(--text-primary);
}
.pw-merge-apply {
  background:var(--link-color, #4a9eff) !important;
  border-color:var(--link-color, #4a9eff) !important; color:#fff !important;
}
.pw-merge-apply:disabled, .pw-merge-actions button:disabled { opacity:.5; cursor:default; }
.pw-merge-status { margin-top:10px; font-size:12px; color:var(--text-secondary); }
.pw-merge-status.is-error { color:#d94a4a; }
.pw-merge-status.is-ok { color:#3d9a5b; }
`;

export interface VocabNode {
  label: string;
  path: string;
  children: VocabNode[];
}

interface ScanItem {
  value: string;
  count: number;
}

interface ScanModel {
  rootLabel: string;
  tags: ScanItem[];
  fields: Record<string, ScanItem[]>;
}

interface DefinitionModel {
  tags: string[];
  fields: Record<string, string[]>;
  raw: string;
}

interface TreeOpts {
  query: string;
  plus: boolean;
}

let _panelEl: HTMLElement | null = null;
let _scan: ScanModel | null = null;
let _definitions: DefinitionModel | null = null;
let _working: Record<string, string[]> | null = null;
let _busy = false;
let _scanRoot: string | null = null;
let _sheetOpen = false;
let _sheetDetach: (() => void) | null = null;
let _sheetQuery = "";
let _adding: string | null = null;
let _collapsed = new Set<string>();
let _popEl: HTMLElement | null = null;
let _rename: { section: string; from: string } | null = null;
let _renameOverlay: HTMLElement | null = null;
let _merge: { section: string; target: string } | null = null;
let _mergeOverlay: HTMLElement | null = null;

export function basenamePath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function parentPath(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i <= 0 ? null : path.slice(0, i);
}

/** Drop `source` onto `target`. Null when the move is illegal. */
export function reparentPath(source: string, target: string): string | null {
  if (!source || !target || source === target) return null;
  if (target === source || target.startsWith(`${source}/`)) return null;
  return `${target}/${basenamePath(source)}`;
}

export function rewriteNestedList(values: string[], from: string, to: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    let next = v;
    if (v === from) next = to;
    else if (v.startsWith(`${from}/`)) next = to + v.slice(from.length);
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

export function buildVocabTree(values: string[]): VocabNode[] {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  const byPath = new Map<string, VocabNode>();

  const ensure = (path: string): VocabNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const node: VocabNode = { label: basenamePath(path), path, children: [] };
    byPath.set(path, node);
    const parent = parentPath(path);
    if (parent) ensure(parent).children.push(node);
    return node;
  };

  for (const v of unique) ensure(v);

  const roots = [...byPath.values()].filter((n) => parentPath(n.path) === null);
  const sortNodes = (nodes: VocabNode[]): void => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Function } }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return Promise.reject(new Error("Tauri invoke unavailable"));
  return internals.invoke(cmd, args) as Promise<T>;
}

function activeVault(): { id: string; name: string; rootPaths: string[]; excludePatterns?: string[] } | null {
  const vm = (window as unknown as { __MARKABLE_VAULT_MANAGER__?: { getActiveVault?: () => any } }).__MARKABLE_VAULT_MANAGER__;
  const vault = vm?.getActiveVault?.();
  if (!vault?.rootPaths?.[0]) return null;
  return vault;
}

function fileBrowserOn(): boolean {
  return !!(window as unknown as { __MARKABLE_FILE_BROWSER__?: unknown }).__MARKABLE_FILE_BROWSER__;
}

function propertiesPath(vault: { name: string; rootPaths: string[] }): string {
  const safe = vault.name.replace(/[/:\x00]/g, "_");
  return `${vault.rootPaths[0]}/VaultSettings/${safe}_properties.md`;
}

function injectCss(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function removeCss(): void {
  document.getElementById(CSS_ID)?.remove();
}

function closePop(): void {
  _popEl?.remove();
  _popEl = null;
}

function applyMetaStore(vaultId: string, raw: string): void {
  const parsed = parsePropertiesFile(raw);
  const store: MetaStore = { ...parsed, vaultId };
  (window as unknown as { __MARKABLE_META__: MetaStore }).__MARKABLE_META__ = store;
}

async function loadDefinitions(): Promise<void> {
  const vault = activeVault();
  if (!vault) {
    adoptMetaDefinitions();
    return;
  }
  const path = propertiesPath(vault);
  try {
    const raw = await invoke<string>("read_file", { path });
    const parsed = parsePropertiesFile(raw);
    _definitions = { tags: parsed.tags, fields: parsed.fields, raw };
    applyMetaStore(vault.id, raw);
  } catch {
    adoptMetaDefinitions();
  }
}

/** Use the vocabulary File Properties already loaded, when the file read fails. */
function adoptMetaDefinitions(): void {
  const meta = (window as unknown as { __MARKABLE_META__?: { tags?: string[]; fields?: Record<string, string[]> } }).__MARKABLE_META__;
  const tags = Array.isArray(meta?.tags) ? [...meta.tags] : [];
  const fields: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(meta?.fields ?? {})) {
    if (Array.isArray(values)) fields[key] = [...values];
  }
  if (_definitions && (_definitions.tags.length > 0 || Object.keys(_definitions.fields).length > 0)) {
    return;
  }
  _definitions = { tags, fields, raw: _definitions?.raw ?? "" };
}

async function writeDefinitionSection(sectionLower: string, bullets: string[]): Promise<void> {
  const vault = activeVault();
  if (!vault) {
    rebuild();
    return;
  }
  const path = propertiesPath(vault);
  const raw = _definitions?.raw || "# Properties to validate against, format: Field - metadata\n## Tags\n";
  const next = rewritePropertiesSection(raw, sectionLower, bullets);
  const dir = `${vault.rootPaths[0]}/VaultSettings`;
  try {
    await invoke("ensure_directory", { path: dir });
    await invoke("write_file", { path, content: next });
    _definitions = { ...parsePropertiesFile(next), raw: next };
    applyMetaStore(vault.id, next);
  } catch {
    /* definitions stay as last successful write */
  }
  rebuild();
}

/** Tags already on the open vault index, so Manage can list them before the walk finishes. */
function seedIndexTags(): void {
  const vm = (window as unknown as {
    __MARKABLE_VAULT_MANAGER__?: { getVaultIndex?: () => { entries?: Array<{ tags?: string[] }> } | null };
  }).__MARKABLE_VAULT_MANAGER__;
  const counts = new Map<string, number>();
  for (const entry of vm?.getVaultIndex?.()?.entries ?? []) {
    for (const raw of entry?.tags ?? []) {
      const value = String(raw).trim().replace(/^#/, "");
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return;
  const incoming: ScanItem[] = [...counts.entries()].map(([value, count]) => ({ value, count }));
  const vault = activeVault();
  if (!_scan) {
    _scan = { rootLabel: vault?.rootPaths[0] ?? "", tags: incoming, fields: {} };
    return;
  }
  const seen = new Set(_scan.tags.map((item) => item.value));
  const tags = [..._scan.tags];
  for (const item of incoming) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    tags.push(item);
  }
  _scan = { ..._scan, tags };
}

function defaultScanRoot(): { roots: string[]; vaultName: string; exclude: string[] } | null {
  const vault = activeVault();
  if (fileBrowserOn() && vault) {
    return { roots: vault.rootPaths, vaultName: vault.name, exclude: vault.excludePatterns ?? [] };
  }
  if (_scanRoot) {
    const base = _scanRoot.replace(/\/+$/, "").split("/").pop() || "folder";
    return { roots: [_scanRoot], vaultName: base, exclude: [] };
  }
  if (vault) {
    return { roots: vault.rootPaths, vaultName: vault.name, exclude: vault.excludePatterns ?? [] };
  }
  return null;
}

export function buildScanModel(
  entries: Array<{ tag: string; count: number }>,
  rootLabel: string,
): ScanModel {
  const tags = new Map<string, number>();
  const fields = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const classified = classifyScanTag(entry.tag);
    if (classified.kind === "tag") {
      for (const piece of classified.value.split(",")) {
        const value = piece.trim();
        if (!value) continue;
        tags.set(value, (tags.get(value) ?? 0) + entry.count);
      }
    } else {
      const map = fields.get(classified.field) ?? new Map<string, number>();
      map.set(classified.value, (map.get(classified.value) ?? 0) + entry.count);
      fields.set(classified.field, map);
    }
  }
  const toItems = (m: Map<string, number>): ScanItem[] =>
    [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const fieldObj: Record<string, ScanItem[]> = {};
  for (const [field, map] of [...fields.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    fieldObj[field] = toItems(map);
  }
  return { rootLabel, tags: toItems(tags), fields: fieldObj };
}

async function runScan(rootOverride?: string): Promise<void> {
  if (rootOverride) _scanRoot = rootOverride;
  const target = rootOverride
    ? {
        roots: [rootOverride],
        vaultName: rootOverride.replace(/\/+$/, "").split("/").pop() || "folder",
        exclude: [] as string[],
      }
    : defaultScanRoot();
  if (!target) {
    rebuild();
    return;
  }
  _busy = true;
  rebuild();
  try {
    const entries = await invoke<Array<{ tag: string; count: number }>>("scan_vault_tags", {
      rootPaths: target.roots,
      excludePatterns: target.exclude,
      vaultName: target.vaultName,
    });
    _scan = buildScanModel(entries, target.roots[0]);
    await loadDefinitions();
    _working = null;
  } catch {
    /* keep last successful scan */
  }
  _busy = false;
  rebuild();
}

function definedList(section: string): string[] {
  if (!_definitions) return [];
  if (section === "tags") return [..._definitions.tags];
  return [...(_definitions.fields[section] ?? [])];
}

function usedValues(section: string): string[] {
  if (!_scan) return [];
  if (section === "tags") return _scan.tags.map((t) => t.value);
  return (_scan.fields[section] ?? []).map((t) => t.value);
}

function allValues(section: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...usedValues(section), ...definedList(section)]) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function workingList(section: string): string[] {
  if (!_working) _working = {};
  if (!_working[section]) _working[section] = allValues(section);
  return _working[section];
}

function setWorking(section: string, next: string[]): void {
  if (!_working) _working = {};
  _working[section] = next;
}

function countFor(section: string, value: string): number {
  if (!_scan) return 0;
  const list = section === "tags" ? _scan.tags : _scan.fields[section] ?? [];
  return list.find((i) => i.value === value)?.count ?? 0;
}

function fieldKeys(): string[] {
  const keys = new Set([
    ...Object.keys(_scan?.fields ?? {}),
    ...Object.keys(_definitions?.fields ?? {}),
    ...Object.keys(_working ?? {}).filter((k) => k !== "tags"),
  ]);
  return [...keys].filter((k) => k.toLowerCase() !== "tags").sort();
}

function clustersFor(section: string): NearDupCluster[] {
  return nearDupClusters(workingList(section));
}

function clusterFor(section: string, value: string): NearDupCluster | undefined {
  return clustersFor(section).find((c) => c.members.includes(value));
}

async function persistSection(section: string, next: string[]): Promise<void> {
  setWorking(section, next);
  await writeDefinitionSection(section, next);
}

async function addValue(section: string, raw: string): Promise<void> {
  const value = raw.trim();
  if (!value) return;
  const list = workingList(section);
  if (list.includes(value)) return;
  _adding = null;
  await persistSection(section, [...list, value]);
}

export async function nestValue(section: string, source: string, target: string | null): Promise<void> {
  const to = target === null ? basenamePath(source) : reparentPath(source, target);
  if (!to || to === source) return;
  if (target) _collapsed.delete(collapseKey(section, target));
  const next = rewriteNestedList(workingList(section), source, to);
  await persistSection(section, next);
}

function closeRename(): void {
  _renameOverlay?.remove();
  _renameOverlay = null;
  _rename = null;
}

function renameStatusEl(): HTMLElement | null {
  return _renameOverlay?.querySelector(".pw-rename-status") ?? null;
}

function setRenameStatus(text: string, kind: "" | "error" | "ok"): void {
  const el = renameStatusEl();
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", kind === "error");
  el.classList.toggle("is-ok", kind === "ok");
}

function openRename(section: string, from: string): void {
  closePop();
  closeMerge();
  closeRename();
  _rename = { section, from };
  const overlay = document.createElement("div");
  overlay.className = "pw-overlay";
  overlay.id = "__properties-wrangler-rename__";
  overlay.style.zIndex = "1100";
  const backdrop = document.createElement("div");
  backdrop.className = "pw-backdrop";
  backdrop.addEventListener("click", () => {
    if (_busy) return;
    closeRename();
  });
  const box = document.createElement("div");
  box.className = "pw-rename";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Rename");
  const title = document.createElement("h3");
  title.textContent = "Rename";
  const input = document.createElement("input");
  input.type = "text";
  input.value = from;
  input.setAttribute("aria-label", "New name");
  const actions = document.createElement("div");
  actions.className = "pw-rename-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "pw-rename-apply";
  apply.textContent = "Apply";
  const status = document.createElement("div");
  status.className = "pw-rename-status";
  cancel.addEventListener("click", () => {
    if (_busy) return;
    closeRename();
  });
  apply.addEventListener("click", () => { void applyRename(input.value, cancel, apply); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void applyRename(input.value, cancel, apply);
    if (e.key === "Escape" && !_busy) closeRename();
  });
  actions.appendChild(cancel);
  actions.appendChild(apply);
  box.appendChild(title);
  box.appendChild(input);
  box.appendChild(actions);
  box.appendChild(status);
  overlay.appendChild(backdrop);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _renameOverlay = overlay;
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
}

async function applyRename(
  rawTo: string,
  cancelBtn: HTMLButtonElement,
  applyBtn: HTMLButtonElement,
): Promise<void> {
  if (!_rename) return;
  const { section, from } = _rename;
  const to = rawTo.trim();
  const existing = workingList(section);
  const localErr = validatePropertyRename(from, to, existing);
  if (localErr) {
    setRenameStatus(localErr, "error");
    return;
  }
  const scan = defaultScanRoot();
  if (!scan) {
    setRenameStatus("Open a vault first.", "error");
    return;
  }
  _busy = true;
  cancelBtn.disabled = true;
  applyBtn.disabled = true;
  setRenameStatus("Renaming across the vault…", "");
  try {
    const result = await invoke<{ filesChanged: number; replacements: number }>(
      "rename_vault_property",
      {
        rootPaths: scan.roots,
        excludePatterns: scan.exclude,
        section,
        from,
        to,
        existing,
      },
    );
    const next = rewriteNestedList(existing, from, to);
    await persistSection(section, next);
    await runScan();
    const files = result.filesChanged;
    setRenameStatus(
      files === 0
        ? "No notes used this name. Definitions updated."
        : `Updated ${files} file${files === 1 ? "" : "s"} (${result.replacements} replacements).`,
      "ok",
    );
    cancelBtn.textContent = "Close";
  } catch (error) {
    setRenameStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    _busy = false;
    cancelBtn.disabled = false;
    applyBtn.disabled = false;
  }
}

function closeMerge(): void {
  _mergeOverlay?.remove();
  _mergeOverlay = null;
  _merge = null;
}

function mergeStatusEl(): HTMLElement | null {
  return _mergeOverlay?.querySelector(".pw-merge-status") ?? null;
}

function setMergeStatus(text: string, kind: "" | "error" | "ok"): void {
  const el = mergeStatusEl();
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", kind === "error");
  el.classList.toggle("is-ok", kind === "ok");
}

function openMerge(section: string, target: string): void {
  closePop();
  closeRename();
  closeMerge();
  _merge = { section, target };

  const overlay = document.createElement("div");
  overlay.className = "pw-overlay";
  overlay.id = "__properties-wrangler-merge__";
  overlay.style.zIndex = "1100";

  const backdrop = document.createElement("div");
  backdrop.className = "pw-backdrop";
  backdrop.addEventListener("click", () => {
    if (_busy) return;
    closeMerge();
  });

  const box = document.createElement("div");
  box.className = "pw-merge";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Merge");

  const title = document.createElement("h3");
  title.textContent = `Merge into "${target}"`;
  box.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "pw-merge-target";
  sub.textContent = `Merge other definitions into "${target}" in ${section}.`;
  box.appendChild(sub);

  const warning = document.createElement("div");
  warning.className = "pw-merge-warning";
  warning.textContent =
    "Warning: Merging will replace matching definitions in YAML front-matter across notes in your vault. This cannot be undone.";
  box.appendChild(warning);

  const confirmLabel = document.createElement("label");
  confirmLabel.className = "pw-merge-confirm-label";
  const confirmCb = document.createElement("input");
  confirmCb.type = "checkbox";
  confirmCb.className = "pw-merge-confirm-cb";
  const confirmSpan = document.createElement("span");
  confirmSpan.textContent = "I understand that this merge cannot be undone";
  confirmLabel.appendChild(confirmCb);
  confirmLabel.appendChild(confirmSpan);
  box.appendChild(confirmLabel);

  const search = document.createElement("input");
  search.type = "search";
  search.className = "pw-merge-search";
  search.placeholder = "Search definitions";
  search.setAttribute("aria-label", "Search definitions to merge");
  box.appendChild(search);

  const options = document.createElement("div");
  options.className = "pw-merge-options";
  options.setAttribute("role", "listbox");
  box.appendChild(options);

  const pickedBox = document.createElement("div");
  pickedBox.className = "pw-merge-picked";
  box.appendChild(pickedBox);

  const actions = document.createElement("div");
  actions.className = "pw-merge-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "pw-merge-apply";
  applyBtn.textContent = "Apply Merge";
  applyBtn.disabled = true;
  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  box.appendChild(actions);

  const status = document.createElement("div");
  status.className = "pw-merge-status";
  box.appendChild(status);

  overlay.appendChild(backdrop);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _mergeOverlay = overlay;

  const known = workingList(section).filter((name) => name !== target);
  const picked = new Set(findSimilarDefinitions(target, workingList(section)));

  function updateApplyState(): void {
    if (_busy) {
      applyBtn.disabled = true;
      return;
    }
    const chosen = [...picked].filter((name) => validateMergeField(name, target).valid);
    applyBtn.disabled = !(chosen.length > 0 && confirmCb.checked);
  }

  function renderPicker(): void {
    pickedBox.replaceChildren();
    for (const name of picked) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pw-merge-chip";
      chip.dataset.value = name;
      chip.textContent = `${name} ×`;
      chip.setAttribute("aria-label", `Remove ${name}`);
      chip.addEventListener("click", () => {
        if (_busy) return;
        picked.delete(name);
        renderPicker();
      });
      pickedBox.appendChild(chip);
    }

    const query = search.value.trim().toLowerCase();
    const matches = known.filter(
      (name) => !picked.has(name) && name.toLowerCase().includes(query),
    );
    options.replaceChildren();
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pw-merge-empty";
      empty.textContent = known.length === 0
        ? "No other definitions in this section."
        : "No matches.";
      options.appendChild(empty);
    } else {
      for (const name of matches) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "pw-merge-option";
        choice.textContent = name;
        choice.addEventListener("click", () => {
          if (_busy) return;
          picked.add(name);
          search.value = "";
          renderPicker();
        });
        options.appendChild(choice);
      }
    }
    updateApplyState();
  }

  search.addEventListener("input", renderPicker);
  confirmCb.addEventListener("change", updateApplyState);
  cancelBtn.addEventListener("click", () => {
    if (_busy) return;
    closeMerge();
  });
  applyBtn.addEventListener("click", () => {
    void applyMergeAction(cancelBtn, applyBtn);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !_busy) closeMerge();
  });
  renderPicker();
  queueMicrotask(() => search.focus());
}

/** Push merged file contents into open notes so the editor matches the disk write. */
async function refreshOpenEditors(paths: string[]): Promise<void> {
  const tm = (window as unknown as {
    __MARKABLE_TAB_MANAGER__?: { applyExternalFileContent?: (path: string, content: string) => void };
  }).__MARKABLE_TAB_MANAGER__;
  const apply = tm?.applyExternalFileContent;
  if (!apply || paths.length === 0) return;
  for (const path of paths) {
    try {
      const content = await invoke<string>("read_file", { path });
      if (typeof content === "string") apply(path, content);
    } catch {
      /* the note is already updated on disk */
    }
  }
}

async function applyMergeAction(
  cancelBtn: HTMLButtonElement,
  applyBtn: HTMLButtonElement,
): Promise<void> {
  if (!_merge) return;
  const { section, target } = _merge;
  const fromValues = Array.from(
    _mergeOverlay?.querySelectorAll<HTMLButtonElement>(".pw-merge-chip") ?? [],
  ).map((chip) => chip.dataset.value ?? "").filter(Boolean);
  if (fromValues.length === 0) {
    setMergeStatus("Add at least one definition to merge.", "error");
    return;
  }

  for (const from of fromValues) {
    const val = validateMergeField(from, target);
    if (!val.valid) {
      setMergeStatus(val.error ?? "Please fix errors before applying merge.", "error");
      return;
    }
  }

  const scan = defaultScanRoot();
  if (!scan) {
    setMergeStatus("Open a vault first.", "error");
    return;
  }

  _busy = true;
  cancelBtn.disabled = true;
  applyBtn.disabled = true;
  setMergeStatus("Merging across the vault…", "");

  try {
    const result = await invoke<{
      filesChanged: number;
      replacements: number;
      changedPaths?: string[];
    }>(
      "merge_vault_property",
      {
        rootPaths: scan.roots,
        excludePatterns: scan.exclude,
        section,
        fromValues,
        to: target,
      },
    );

    if ((result?.filesChanged ?? 0) === 0) {
      setMergeStatus(
        "Merge did not change any notes. The YAML in your files was left unchanged.",
        "error",
      );
      applyBtn.disabled = false;
      return;
    }

    await refreshOpenEditors(result.changedPaths ?? []);

    const existing = workingList(section);
    const next: string[] = [];
    for (const item of existing) {
      let mapped = item;
      for (const from of fromValues) {
        if (item === from) {
          mapped = target;
          break;
        }
        if (item.startsWith(`${from}/`)) {
          mapped = target + item.slice(from.length);
          break;
        }
      }
      if (!next.includes(mapped)) {
        next.push(mapped);
      }
    }
    if (!next.includes(target)) {
      next.push(target);
    }

    await persistSection(section, next);
    await runScan();

    const count = fromValues.length;
    setMergeStatus(
      result.filesChanged === 0
        ? `No notes used ${count === 1 ? "this definition" : "these definitions"}. Definitions updated.`
        : `Merged ${count} definition${count === 1 ? "" : "s"} into "${target}" across ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"} (${result.replacements} replacements).`,
      "ok",
    );
    cancelBtn.textContent = "Close";
  } catch (error) {
    setMergeStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    _busy = false;
    cancelBtn.disabled = false;
  }
}

/**
 * Pointer drag for parent/child nesting. HTML5 dragstart does not fire
 * reliably in Tauri's WKWebView — same reason file-browser uses pointers.
 */
function attachNestDrag(row: HTMLElement, section: string, path: string): void {
  let startX = 0;
  let startY = 0;
  let dragActive = false;
  let pointerId = -1;
  let ghost: HTMLElement | null = null;
  let dropEl: HTMLElement | null = null;

  const clearDrop = (): void => {
    dropEl?.classList.remove("is-drop");
    dropEl = null;
  };

  const cleanup = (): void => {
    ghost?.remove();
    ghost = null;
    clearDrop();
    row.classList.remove("is-drag");
    dragActive = false;
    pointerId = -1;
    document.body.style.userSelect = "";
    (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
    document.body.style.cursor = "";
  };

  const hitTarget = (clientX: number, clientY: number): HTMLElement | null => {
    row.style.pointerEvents = "none";
    if (ghost) ghost.style.pointerEvents = "none";
    const hit = document.elementFromPoint(clientX, clientY);
    row.style.pointerEvents = "";
    const asEl = hit instanceof Element ? hit : null;
    const overRow = asEl?.closest<HTMLElement>(".pw-row");
    if (overRow && overRow !== row && overRow.dataset.section === section) return overRow;
    const overHead = asEl?.closest<HTMLElement>(".pw-section-row");
    if (overHead && overHead.dataset.section === section) return overHead;
    return null;
  };

  row.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button")) return;
    startX = e.clientX;
    startY = e.clientY;
    dragActive = false;
    pointerId = e.pointerId;
    try { row.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    document.body.style.userSelect = "none";
    (document.body.style as unknown as Record<string, string>).webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();
    e.stopPropagation();
  });

  row.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragActive) {
      if (Math.hypot(dx, dy) < 6) return;
      dragActive = true;
      row.classList.add("is-drag");
      document.body.style.cursor = "grabbing";
      ghost = document.createElement("div");
      ghost.className = "pw-ghost";
      ghost.textContent = row.querySelector(".pw-name")?.textContent || path;
      document.body.appendChild(ghost);
    }
    if (!ghost) return;
    ghost.style.left = `${e.clientX + 14}px`;
    ghost.style.top = `${e.clientY + 6}px`;
    const next = hitTarget(e.clientX, e.clientY);
    if (next !== dropEl) {
      clearDrop();
      if (next) {
        next.classList.add("is-drop");
        dropEl = next;
      }
    }
  });

  const finish = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    if (dragActive && dropEl) {
      const targetPath = dropEl.classList.contains("pw-section-row")
        ? null
        : (dropEl.dataset.path ?? null);
      void nestValue(section, path, targetPath);
    }
    cleanup();
  };

  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", finish);
}

function searchClause(section: string, value: string, exclude: boolean): string {
  const field = section === "tags" ? "tag" : section;
  const body = /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
  return `${exclude ? "-" : ""}${field}:#${body}`;
}

function openSearchMenu(anchor: HTMLElement, section: string, value: string): void {
  closePop();
  const pop = document.createElement("div");
  pop.className = "pw-pop";
  pop.setAttribute("role", "menu");
  const add = (label: string, kind: "include" | "exclude"): void => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = kind === "include" ? "pw-search-include" : "pw-search-exclude";
    btn.setAttribute("role", "menuitem");
    btn.textContent = label;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      closePop();
      const search = (window as unknown as {
        __MARKABLE_TAG_SEARCH__?: (clause: string, kind: "include" | "exclude") => void;
      }).__MARKABLE_TAG_SEARCH__;
      if (typeof search !== "function") return;
      search(searchClause(section, value, kind === "exclude"), kind);
      closeSheet();
    });
    pop.appendChild(btn);
  };
  add("Search notes with this", "include");
  add("Exclude this from search", "exclude");
  if (section === "tags") {
    const page = document.createElement("button");
    page.type = "button";
    page.className = "pw-tag-page";
    page.setAttribute("role", "menuitem");
    page.textContent = "Open tag page";
    page.addEventListener("click", (event) => {
      event.stopPropagation();
      void openTagPage(value, pop);
    });
    pop.appendChild(page);
  }
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 4}px`;
  _popEl = pop;
}

function safeTagFileName(tag: string): string | null {
  const name = tag.trim();
  if (!name || name === "." || name === "..") return null;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return null;
  return `${name}.md`;
}

function yamlAlias(tag: string): string {
  if (/[:#&*!|>%@`]|\s/.test(tag)) return `"${tag.replace(/"/g, "")}"`;
  return tag;
}

async function openTagPage(tag: string, pop: HTMLElement): Promise<void> {
  const showError = (message: string): void => {
    let line = pop.querySelector(".pw-tag-page-error");
    if (!line) {
      line = document.createElement("div");
      line.className = "pw-tag-page-error";
      pop.appendChild(line);
    }
    line.textContent = message;
  };
  const fileName = safeTagFileName(tag);
  if (!fileName) {
    showError("That tag is not a safe file name.");
    return;
  }
  const vault = activeVault();
  if (!vault || vault.rootPaths.length === 0) {
    showError("No vault open.");
    return;
  }
  try {
    const existing = await invoke<string | null>("find_tag_page", {
      rootPaths: vault.rootPaths,
      excludePatterns: vault.excludePatterns ?? [],
      tag,
    });
    let path = existing;
    if (!path) {
      const dir = `${vault.rootPaths[0].replace(/\/+$/, "")}/Tags`;
      await invoke("create_directory", { path: dir });
      path = `${dir}/${fileName}`;
      const content = `---\naliases:\n  - ${yamlAlias(tag)}\n---\n`;
      await invoke("write_file", { path, content });
    }
    const tabs = (window as unknown as {
      __MARKABLE_TAB_MANAGER__?: { openFileInTab?: (path: string) => void };
    }).__MARKABLE_TAB_MANAGER__;
    tabs?.openFileInTab?.(path);
    closePop();
    closeSheet();
  } catch (err) {
    showError(String(err));
  }
}

function nodeMatches(node: VocabNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.path.toLowerCase().includes(q) || node.label.toLowerCase().includes(q)) return true;
  return node.children.some((c) => nodeMatches(c, query));
}

function collapseKey(section: string, path: string): string {
  return `${section}:${path}`;
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length - 1;
}

function branchesAtDepth(section: string, depth: number): string[] {
  const peers: string[] = [];
  const walk = (nodes: VocabNode[], level: number): void => {
    for (const node of nodes) {
      if (level === depth && node.children.length > 0) peers.push(node.path);
      walk(node.children, level + 1);
    }
  };
  walk(buildVocabTree(workingList(section)), 0);
  return peers;
}

function toggleSameDepth(section: string, path: string): void {
  const peers = branchesAtDepth(section, pathDepth(path));
  if (peers.length === 0) return;
  const anyOpen = peers.some((peer) => !_collapsed.has(collapseKey(section, peer)));
  for (const peer of peers) {
    const key = collapseKey(section, peer);
    if (anyOpen) _collapsed.add(key);
    else _collapsed.delete(key);
  }
}

function renderNode(
  host: HTMLElement,
  section: string,
  node: VocabNode,
  opts: TreeOpts,
): void {
  if (!nodeMatches(node, opts.query)) return;

  const hasKids = node.children.length > 0;
  const collapsed = !opts.query && _collapsed.has(collapseKey(section, node.path));
  const cluster = clusterFor(section, node.path);
  const used = countFor(section, node.path);

  const row = document.createElement("div");
  row.className = "pw-row";
  row.dataset.path = node.path;
  row.dataset.section = section;
  if (cluster) row.classList.add("is-dup");

  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "pw-caret" + (hasKids ? "" : " is-empty");
  caret.textContent = collapsed ? "▶" : "▼";
  caret.setAttribute("aria-label", collapsed ? `Expand ${node.label}` : `Collapse ${node.label}`);
  if (hasKids) {
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      if (section === "tags" && e.shiftKey) toggleSameDepth(section, node.path);
      else {
        const key = collapseKey(section, node.path);
        if (_collapsed.has(key)) _collapsed.delete(key);
        else _collapsed.add(key);
      }
      rebuild();
    });
  }
  row.appendChild(caret);

  const name = document.createElement("span");
  name.className = "pw-name";
  name.textContent = node.label;
  row.appendChild(name);

  if (used > 0) {
    const count = document.createElement("span");
    count.className = "pw-count";
    count.textContent = String(used);
    row.appendChild(count);
  }

  name.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openRename(section, node.path);
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSearchMenu(row, section, node.path);
  });

  const repeat = document.createElement("button");
  repeat.type = "button";
  repeat.className = "pw-repeat";
  repeat.setAttribute("aria-label", `Consolidate ${node.label}`);
  repeat.innerHTML = REPEAT_SVG;
  repeat.addEventListener("click", (e) => {
    e.stopPropagation();
    openMerge(section, node.path);
  });
  row.appendChild(repeat);

  attachNestDrag(row, section, node.path);

  const wrap = document.createElement("div");
  wrap.className = "pw-node";
  wrap.appendChild(row);
  if (hasKids && !collapsed) {
    const kids = document.createElement("div");
    kids.className = "pw-kids";
    for (const child of node.children) renderNode(kids, section, child, opts);
    wrap.appendChild(kids);
  }
  host.appendChild(wrap);
}

function renderSection(
  host: HTMLElement,
  section: string,
  title: string,
  opts: TreeOpts,
  flags?: { skipEmpty?: boolean },
): void {
  const head = document.createElement("div");
  head.className = "pw-section-row";
  head.dataset.section = section;
  const heading = document.createElement("div");
  heading.className = "pw-section";
  heading.textContent = title;
  head.appendChild(heading);
  if (opts.plus) {
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "pw-plus";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `Add ${title.toLowerCase()}`);
    plus.addEventListener("click", () => {
      _adding = _adding === section ? null : section;
      rebuild();
    });
    head.appendChild(plus);
  }
  host.appendChild(head);

  if (opts.plus && _adding === section) {
    const inline = document.createElement("div");
    inline.className = "pw-add-inline";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `New ${title.toLowerCase()}`;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void addValue(section, input.value);
      if (e.key === "Escape") {
        _adding = null;
        rebuild();
      }
    });
    inline.appendChild(input);
    host.appendChild(inline);
    queueMicrotask(() => input.focus());
  }

  const values = workingList(section);
  if (values.length === 0) {
    if (flags?.skipEmpty) return;
    const empty = document.createElement("div");
    empty.className = "pw-empty";
    empty.textContent = "Nothing here yet.";
    host.appendChild(empty);
    return;
  }

  const tree = document.createElement("div");
  tree.className = "pw-tree";
  for (const node of buildVocabTree(values)) {
    renderNode(tree, section, node, opts);
  }
  host.appendChild(tree);
}

function renderCategoryBlock(host: HTMLElement, opts: TreeOpts): void {
  const others = fieldKeys().filter((k) => k !== "category");
  renderSection(host, "category", "Category", opts, { skipEmpty: others.length > 0 });
  for (const field of others) {
    const title = field.charAt(0).toUpperCase() + field.slice(1);
    renderSection(host, field, title, opts);
  }
}

function renderLists(host: HTMLElement, opts: TreeOpts, grouped: boolean): void {
  if (!_scan && !_definitions && !_working) {
    const empty = document.createElement("div");
    empty.className = "pw-empty";
    empty.textContent = "Nothing here yet.";
    host.appendChild(empty);
    return;
  }
  if (grouped) {
    const cat = document.createElement("div");
    cat.className = "pw-group";
    renderCategoryBlock(cat, opts);
    host.appendChild(cat);
    renderSection(host, "tags", "Tags", opts);
    return;
  }
  renderCategoryBlock(host, opts);
  renderSection(host, "tags", "Tags", opts);
}

function fillResultsBody(body: HTMLElement): void {
  body.replaceChildren();
  renderLists(body, { query: _sheetQuery, plus: true }, true);
}

function syncSheet(overlay: HTMLElement): void {
  const search = overlay.querySelector(".pw-search");
  if (search instanceof HTMLInputElement) search.value = _sheetQuery;
  const results = overlay.querySelector(".pw-results-body");
  if (results instanceof HTMLElement) fillResultsBody(results);
}

function closeSheet(): void {
  closePop();
  _sheetDetach?.();
  _sheetDetach = null;
  document.getElementById(OVERLAY_ID)?.remove();
  _sheetOpen = false;
  _adding = null;
}

function openSheet(): void {
  injectCss();
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "pw-overlay";
    overlay.setAttribute("aria-modal", "true");

    const backdrop = document.createElement("div");
    backdrop.className = "pw-backdrop";
    backdrop.addEventListener("click", closeSheet);

    const sheet = document.createElement("div");
    sheet.className = "pw-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Manage");
    sheet.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "pw-sheet-header";
    const title = document.createElement("h2");
    title.className = "pw-sheet-title";
    title.textContent = "Manage";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pw-sheet-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeSheet);
    header.appendChild(title);
    header.appendChild(closeBtn);

    const results = document.createElement("div");
    results.className = "pw-results";
    const bar = document.createElement("div");
    bar.className = "pw-results-bar";
    const resultsTitle = document.createElement("div");
    resultsTitle.className = "pw-pane-title";
    resultsTitle.textContent = "Tags and categories";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "pw-search";
    search.placeholder = "Search";
    search.addEventListener("input", () => {
      _sheetQuery = search.value;
      const dest = overlay?.querySelector(".pw-results-body");
      if (dest instanceof HTMLElement) fillResultsBody(dest);
    });
    bar.appendChild(resultsTitle);
    bar.appendChild(search);
    const resultsBody = document.createElement("div");
    resultsBody.className = "pw-results-body";
    results.appendChild(bar);
    results.appendChild(resultsBody);

    sheet.appendChild(header);
    sheet.appendChild(results);
    overlay.appendChild(backdrop);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    _sheetDetach = attachModalKeyboard({
      modal: overlay,
      onClose: closeSheet,
      initialFocus: search,
    });
  }
  _sheetOpen = true;
  syncSheet(overlay);
}

function rebuildSidebar(): void {
  if (!_panelEl) return;
  _panelEl.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "pw-wrap";

  const bar = document.createElement("div");
  bar.className = "pw-bar";
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "pw-manage";
  manage.textContent = "Manage";
  manage.addEventListener("click", openSheet);
  bar.appendChild(manage);
  wrap.appendChild(bar);

  const scroll = document.createElement("div");
  scroll.className = "pw-scroll";
  renderLists(scroll, { query: "", plus: false }, false);
  wrap.appendChild(scroll);
  _panelEl.appendChild(wrap);
}

function rebuild(): void {
  closePop();
  rebuildSidebar();
  if (_sheetOpen) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) syncSheet(overlay);
  }
}

export function renderWranglerPanel(container: HTMLElement): void {
  _panelEl = container;
  rebuild();
}

/** Open Manage and list every tag and category, from the properties file and the vault. */
export async function openVocabularyManager(): Promise<void> {
  injectCss();
  _sheetQuery = "";
  adoptMetaDefinitions();
  seedIndexTags();
  _working = null;
  openSheet();
  await loadDefinitions();
  _working = null;
  const overlay = document.getElementById(OVERLAY_ID);
  if (_sheetOpen && overlay) syncSheet(overlay);
  if (_sheetOpen) await runScan();
}

/** Close rename, merge, and Manage without dropping the last scan. */
export function unmountWranglerEditor(): void {
  closeSheet();
  closeRename();
  closeMerge();
  closePop();
  _panelEl = null;
}

/** Unmount and drop injected CSS. File Properties calls this on disable. */
export function releaseWranglerEditor(): void {
  unmountWranglerEditor();
  removeCss();
}

export function applyWranglerScanForTest(model: ScanModel, definitions?: DefinitionModel): void {
  _scan = model;
  _definitions = definitions ?? { tags: [], fields: {}, raw: "" };
  _working = null;
  rebuild();
}

export function resetWranglerForTest(): void {
  closeSheet();
  closeRename();
  closeMerge();
  _panelEl = null;
  _scan = null;
  _definitions = null;
  _working = null;
  _busy = false;
  _scanRoot = null;
  _sheetQuery = "";
  _adding = null;
  _collapsed = new Set();
}

export default {
  id: "properties-wrangler",
  name: "Properties Wrangler",
  version: "1.2.0",
  description: "Tree of tags and categories, with lookalike consolidate and Manage nesting",
  detail:
    "Edits tags and categories inside File Properties. Near-duplicates are red. " +
    "Edit renames, the gear merges, and Manage adds search, header +, and drag-drop " +
    "nesting into the File Properties definitions.",

  onEnable(_api: MarkablePluginAPI): void {
    /* Mounted by File Properties. No sidebar panel. */
  },

  onDisable(_api: MarkablePluginAPI): void {
    releaseWranglerEditor();
    _scan = null;
    _definitions = null;
    _working = null;
    _busy = false;
    _scanRoot = null;
    _sheetQuery = "";
    _adding = null;
    _collapsed = new Set();
  },
};
