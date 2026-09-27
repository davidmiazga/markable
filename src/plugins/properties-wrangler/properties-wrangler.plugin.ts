/**
 * Properties Wrangler — companion to File Properties (yaml-pane).
 *
 * Scans a vault or folder for tags and category field:value pairs, clusters
 * near-duplicates, and edits VaultSettings/{vault}_properties.md so File
 * Properties chip autocomplete matches the offer list.
 *
 * v1 does not rewrite tags inside note files (rename/merge-in-files is next).
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";
import {
  classifyScanTag,
  nearDupClusters,
  relatedNested,
  type NearDupCluster,
  type NestedRelation,
} from "../../lib/near-dup-clusters";
import {
  parsePropertiesFile,
  rewritePropertiesSection,
  type MetaStore,
} from "../../lib/meta-manager";

const CSS_ID = "__markable_properties_wrangler_css__";
const PANEL_ID = "properties-wrangler";

const CSS = `
.pw-wrap { display:flex; flex-direction:column; height:100%; min-height:0; font-size:12px; color:var(--text-primary); }
.pw-toolbar { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border-bottom:1px solid var(--border-color, rgba(255,255,255,.08)); }
.pw-btn {
  font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;
  border:1px solid var(--border-color, #444);
  background:transparent; color:var(--text-primary);
}
.pw-btn:hover { background:var(--bg-hover, rgba(255,255,255,.06)); }
.pw-btn:disabled { opacity:.5; cursor:default; }
.pw-btn-primary { background:var(--link-color, #4a9eff); border-color:var(--link-color, #4a9eff); color:#fff; }
.pw-status { padding:6px 8px; color:var(--text-secondary, #aaa); font-size:11px; }
.pw-scroll { flex:1; overflow:auto; padding:0 8px 12px; min-height:0; }
.pw-section { margin:10px 0 6px; font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--text-tertiary, #888); }
.pw-row { display:flex; align-items:flex-start; gap:6px; padding:3px 0; }
.pw-row label { flex:1; display:flex; align-items:flex-start; gap:6px; cursor:pointer; }
.pw-name { word-break:break-word; }
.pw-count { color:var(--text-tertiary, #888); flex-shrink:0; }
.pw-badge { font-size:10px; color:var(--text-tertiary, #888); }
.pw-cluster, .pw-related {
  border:1px solid var(--border-color, rgba(255,255,255,.1));
  border-radius:6px; padding:8px; margin:6px 0;
}
.pw-cluster-members { color:var(--text-secondary, #aaa); margin:4px 0 8px; }
.pw-empty { color:var(--text-tertiary, #888); font-style:italic; padding:8px 0; }
.pw-add-row { display:flex; gap:4px; margin:6px 0 10px; }
.pw-add-row input {
  flex:1; font-size:12px; padding:4px 6px;
  background:transparent; color:var(--text-primary);
  border:1px solid var(--border-color); border-radius:4px;
}
`;

interface ScanItem {
  value: string;
  count: number;
}

interface ScanModel {
  rootLabel: string;
  tags: ScanItem[];
  fields: Record<string, ScanItem[]>;
}

interface OfferModel {
  tags: string[];
  fields: Record<string, string[]>;
  raw: string;
}

let _panelEl: HTMLElement | null = null;
let _scan: ScanModel | null = null;
let _offer: OfferModel | null = null;
let _status = "Scan a vault or folder to list tags and categories.";
let _busy = false;
let _scanRoot: string | null = null;

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

function applyMetaStore(vaultId: string, raw: string): void {
  const parsed = parsePropertiesFile(raw);
  const store: MetaStore = { ...parsed, vaultId };
  (window as unknown as { __MARKABLE_META__: MetaStore }).__MARKABLE_META__ = store;
}

async function loadOffer(): Promise<void> {
  const vault = activeVault();
  if (!vault) {
    _offer = null;
    return;
  }
  const path = propertiesPath(vault);
  try {
    const raw = await invoke<string>("read_file", { path });
    const parsed = parsePropertiesFile(raw);
    _offer = { tags: parsed.tags, fields: parsed.fields, raw };
    applyMetaStore(vault.id, raw);
  } catch {
    _offer = { tags: [], fields: {}, raw: "" };
  }
}

async function writeOfferSection(sectionLower: string, bullets: string[]): Promise<void> {
  const vault = activeVault();
  if (!vault) {
    _status = "Open a vault to edit the properties offer list.";
    rebuild();
    return;
  }
  const path = propertiesPath(vault);
  const raw = _offer?.raw || "# Properties to validate against, format: Field - metadata\n## Tags\n";
  const next = rewritePropertiesSection(raw, sectionLower, bullets);
  const dir = `${vault.rootPaths[0]}/VaultSettings`;
  try {
    await invoke("ensure_directory", { path: dir });
    await invoke("write_file", { path, content: next });
    _offer = {
      ...parsePropertiesFile(next),
      raw: next,
    };
    applyMetaStore(vault.id, next);
    _status = "Updated properties file. File Properties will offer the new list.";
  } catch (err) {
    _status = `Could not write properties file: ${String(err)}`;
  }
  rebuild();
}

function defaultScanRoot(): { roots: string[]; vaultName: string; exclude: string[] } | null {
  const vault = activeVault();
  if (fileBrowserOn() && vault) {
    return {
      roots: vault.rootPaths,
      vaultName: vault.name,
      exclude: vault.excludePatterns ?? [],
    };
  }
  if (_scanRoot) {
    const base = _scanRoot.replace(/\/+$/, "").split("/").pop() || "folder";
    return { roots: [_scanRoot], vaultName: base, exclude: [] };
  }
  if (vault) {
    return {
      roots: vault.rootPaths,
      vaultName: vault.name,
      exclude: vault.excludePatterns ?? [],
    };
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
      tags.set(classified.value, (tags.get(classified.value) ?? 0) + entry.count);
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
    _status = "No vault or folder to scan. Choose a folder, or turn on File Browser.";
    rebuild();
    return;
  }
  _busy = true;
  _status = `Scanning ${target.roots[0]}…`;
  rebuild();
  try {
    const entries = await invoke<Array<{ tag: string; count: number }>>("scan_vault_tags", {
      rootPaths: target.roots,
      excludePatterns: target.exclude,
      vaultName: target.vaultName,
    });
    _scan = buildScanModel(entries, target.roots[0]);
    await loadOffer();
    const tagN = _scan.tags.length;
    const fieldN = Object.keys(_scan.fields).length;
    _status = `Found ${tagN} tags and ${fieldN} category fields in ${_scan.rootLabel}.`;
  } catch (err) {
    _status = `Scan failed: ${String(err)}`;
  }
  _busy = false;
  rebuild();
}

async function chooseFolder(): Promise<void> {
  const dialog = (window as unknown as { __TAURI_DIALOG__?: { openFolder?: (p?: string) => Promise<string | null> } }).__TAURI_DIALOG__;
  const vault = activeVault();
  const start = vault?.rootPaths[0];
  if (!dialog?.openFolder) {
    _status = "Folder picker is not available.";
    rebuild();
    return;
  }
  const picked = await dialog.openFolder(start);
  if (picked) await runScan(picked);
}

function openPropertiesFile(): void {
  const vault = activeVault();
  if (!vault) {
    _status = "Open a vault to edit the properties file.";
    rebuild();
    return;
  }
  const tm = (window as unknown as { __MARKABLE_TAB_MANAGER__?: { openFileInTab?: (p: string) => void } }).__MARKABLE_TAB_MANAGER__;
  tm?.openFileInTab?.(propertiesPath(vault));
}

function offeredSet(section: string): Set<string> {
  if (!_offer) return new Set();
  if (section === "tags") return new Set(_offer.tags);
  return new Set(_offer.fields[section] ?? []);
}

function offeredList(section: string): string[] {
  if (!_offer) return [];
  if (section === "tags") return [..._offer.tags];
  return [...(_offer.fields[section] ?? [])];
}

function usedValues(section: string): string[] {
  if (!_scan) return [];
  if (section === "tags") return _scan.tags.map((t) => t.value);
  return (_scan.fields[section] ?? []).map((t) => t.value);
}

function allValues(section: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...usedValues(section), ...offeredList(section)]) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function countFor(section: string, value: string): number {
  if (!_scan) return 0;
  const list = section === "tags" ? _scan.tags : _scan.fields[section] ?? [];
  return list.find((i) => i.value === value)?.count ?? 0;
}

async function toggleOffer(section: string, value: string, on: boolean): Promise<void> {
  const list = offeredList(section);
  const next = on
    ? (list.includes(value) ? list : [...list, value])
    : list.filter((v) => v !== value);
  await writeOfferSection(section, next);
}

async function acceptCluster(section: string, cluster: NearDupCluster): Promise<void> {
  const keep = cluster.canonical;
  const drop = new Set(cluster.members.filter((m) => m !== keep));
  const next = offeredList(section).filter((v) => !drop.has(v));
  if (!next.includes(keep)) next.push(keep);
  await writeOfferSection(section, next);
}

function renderSection(host: HTMLElement, section: string, title: string): void {
  const heading = document.createElement("div");
  heading.className = "pw-section";
  heading.textContent = title;
  host.appendChild(heading);

  const values = allValues(section);
  if (values.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pw-empty";
    empty.textContent = "Nothing scanned yet.";
    host.appendChild(empty);
  }

  const offered = offeredSet(section);
  for (const value of values) {
    const used = countFor(section, value);
    const row = document.createElement("div");
    row.className = "pw-row";
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = offered.has(value);
    cb.disabled = !activeVault() || _busy;
    cb.addEventListener("change", () => { void toggleOffer(section, value, cb.checked); });
    const name = document.createElement("span");
    name.className = "pw-name";
    name.textContent = value;
    label.appendChild(cb);
    label.appendChild(name);
    row.appendChild(label);
    const meta = document.createElement("span");
    meta.className = "pw-count";
    const bits: string[] = [];
    if (used > 0) bits.push(`${used} used`);
    else bits.push("unused");
    if (offered.has(value)) bits.push("offered");
    meta.textContent = bits.join(" · ");
    row.appendChild(meta);
    host.appendChild(row);
  }

  const add = document.createElement("div");
  add.className = "pw-add-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = `Add ${title.toLowerCase()} to offer list`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-btn";
  btn.textContent = "Add";
  btn.disabled = !activeVault();
  btn.addEventListener("click", () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    void toggleOffer(section, v, true);
  });
  add.appendChild(input);
  add.appendChild(btn);
  host.appendChild(add);

  const clusters = nearDupClusters(values);
  if (clusters.length > 0) {
    const ch = document.createElement("div");
    ch.className = "pw-section";
    ch.textContent = `${title} near-duplicates`;
    host.appendChild(ch);
    for (const cluster of clusters) {
      host.appendChild(renderCluster(section, cluster));
    }
  }

  const nested = relatedNested(values);
  if (nested.length > 0) {
    const nh = document.createElement("div");
    nh.className = "pw-section";
    nh.textContent = `${title} related (nested)`;
    host.appendChild(nh);
    for (const rel of nested) {
      host.appendChild(renderRelated(rel));
    }
  }
}

function renderCluster(section: string, cluster: NearDupCluster): HTMLElement {
  const box = document.createElement("div");
  box.className = "pw-cluster";
  const members = document.createElement("div");
  members.className = "pw-cluster-members";
  members.textContent = `${cluster.members.join(" / ")}  (${cluster.kind})`;
  box.appendChild(members);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-btn pw-btn-primary";
  btn.textContent = `Keep “${cluster.canonical}” in offer list`;
  btn.disabled = !activeVault() || _busy;
  btn.addEventListener("click", () => { void acceptCluster(section, cluster); });
  box.appendChild(btn);
  return box;
}

function renderRelated(rel: NestedRelation): HTMLElement {
  const box = document.createElement("div");
  box.className = "pw-related";
  box.textContent = `${rel.parent} → ${rel.children.join(", ")}`;
  return box;
}

function rebuild(): void {
  if (!_panelEl) return;
  _panelEl.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "pw-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "pw-toolbar";

  const scanBtn = document.createElement("button");
  scanBtn.type = "button";
  scanBtn.className = "pw-btn pw-btn-primary";
  scanBtn.textContent = fileBrowserOn() && activeVault() ? "Scan vault" : "Scan";
  scanBtn.disabled = _busy;
  scanBtn.addEventListener("click", () => { void runScan(); });
  toolbar.appendChild(scanBtn);

  const folderBtn = document.createElement("button");
  folderBtn.type = "button";
  folderBtn.className = "pw-btn";
  folderBtn.textContent = "Choose folder…";
  folderBtn.disabled = _busy;
  folderBtn.addEventListener("click", () => { void chooseFolder(); });
  toolbar.appendChild(folderBtn);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "pw-btn";
  editBtn.textContent = "Open properties file";
  editBtn.addEventListener("click", openPropertiesFile);
  toolbar.appendChild(editBtn);

  wrap.appendChild(toolbar);

  const status = document.createElement("div");
  status.className = "pw-status";
  status.textContent = _status;
  wrap.appendChild(status);

  const scroll = document.createElement("div");
  scroll.className = "pw-scroll";

  if (_scan) {
    renderSection(scroll, "tags", "Tags");
    const fields = new Set([
      ...Object.keys(_scan.fields),
      ...Object.keys(_offer?.fields ?? {}),
    ]);
    for (const field of [...fields].sort()) {
      const title = field.charAt(0).toUpperCase() + field.slice(1);
      renderSection(scroll, field, title);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "pw-empty";
    empty.textContent = "Scan to compare used values with the File Properties offer list.";
    scroll.appendChild(empty);
  }

  wrap.appendChild(scroll);
  _panelEl.appendChild(wrap);
}

export function renderWranglerPanel(container: HTMLElement): void {
  _panelEl = container;
  rebuild();
}

export default {
  id: "properties-wrangler",
  name: "Properties Wrangler",
  version: "1.0.0",
  description: "Scan tags and categories, cluster near-duplicates, and edit the File Properties offer list",
  detail:
    "Companion to File Properties. Scans the active vault (or a chosen folder), " +
    "lists tags and category values, groups near-duplicates, and writes " +
    "VaultSettings/{vault}_properties.md — the same file File Properties uses for chip offers. " +
    "Does not rewrite tags inside notes yet.",
  sidebarPanelId: PANEL_ID,

  onEnable(api: MarkablePluginAPI): void {
    injectCss();
    api.registerSidebarPanel({
      id: PANEL_ID,
      title: "Wrangler",
      side: "right",
      defaultWidth: 280,
      render(container: HTMLElement): void {
        renderWranglerPanel(container);
        if (!_scan && !_busy) void runScan();
      },
      destroy(): void {
        _panelEl = null;
      },
    });
  },

  onDisable(api: MarkablePluginAPI): void {
    api.unregisterSidebarPanel(PANEL_ID);
    removeCss();
    _panelEl = null;
    _scan = null;
    _offer = null;
    _busy = false;
    _scanRoot = null;
    _status = "Scan a vault or folder to list tags and categories.";
  },
};
