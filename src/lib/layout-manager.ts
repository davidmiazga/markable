/**
 * layout-manager.ts — Core Layouts system.
 *
 * Compiled into the main bundle. Provides layout discovery, context building,
 * rendering, the picker UI, and the CM6 auto-render extension.
 *
 * Layout file search path (in order):
 *   1. {appDataDir}/layouts/          — global layouts accessible without a vault
 *   2. {vaultRoot}/VaultSettings/layouts/ — vault-specific layouts (overrides global)
 *
 * Tech-savvy users place .layout.md files in the App Support directory.
 * The wikipedia.layout.md starter is written there on first launch.
 */

import { readFile, writeFile, ensureDirectory, listMdFiles } from "./bridge";
import { render, stripScripts, wireDataPathListeners } from "./layout-engine";
import type { TemplateContext, VaultFileEntry } from "./layout-engine";
import { marked } from "marked";
import type { VaultIndex } from "./vault-types";
import type { MetaStore } from "./meta-manager";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ── Public types ───────────────────────────────────────────────────────────────

/** Parsed representation of a .layout.md file. */
export interface LayoutMeta {
  name: string;
  description: string;
  appliesTo: "single" | "collection" | "any";
  filePath: string;
  body: string;
}

/** Injectable dependencies — keeps layout-manager testable and main.ts thin. */
export interface LayoutDeps {
  appDataDir: string;
  getActiveVaultRoot: () => string | null;
  getVaultIndex: () => VaultIndex | null;
  getActiveVaultName: () => string;
  getMetaStore: () => MetaStore | null;
  openCustomRenderTab: (title: string, renderFn: (el: HTMLElement) => void) => void;
  getCurrentFilePath: () => string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STYLE_ID = "__markable_layouts_css__";
const LAYOUTS_SUBDIR = "layouts";
const VAULT_LAYOUTS_SUBDIR = "VaultSettings/layouts";

// ── Starter layouts ────────────────────────────────────────────────────────────

export const STARTER_LAYOUTS: Record<string, string> = {
  "wikipedia.layout.md": `---
name: "Wikipedia"
description: "Two-column layout with rendered body and YAML infobox"
applies-to: "single"
---
<style>
.wiki-layout { display: flex; gap: 24px; max-width: 900px; margin: 0 auto; padding: 24px; }
.wiki-body { flex: 1; min-width: 0; }
.wiki-body h1 { margin-top: 0; color: var(--text-primary); }
.wiki-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 16px; }
.wiki-tag { background: var(--bg-secondary, #2a2a3a); border-radius: 3px; padding: 2px 8px; font-size: 12px; color: var(--text-secondary); }
.wiki-infobox { width: 240px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; background: var(--bg-secondary); font-size: 13px; }
.wiki-infobox table { width: 100%; border-collapse: collapse; }
.wiki-infobox td { padding: 4px 6px; vertical-align: top; color: var(--text-primary); border-bottom: 1px solid var(--border-color); }
.wiki-infobox td:first-child { color: var(--text-secondary); font-weight: 500; white-space: nowrap; }
</style>
{{#if file}}
<div class="wiki-layout">
  <div class="wiki-body">
    <h1>{{file.title}}</h1>
    <div class="wiki-tags">{{#each file.tags}}<span class="wiki-tag">{{this}}</span>{{/each}}</div>
    {{{file.rendered}}}
  </div>
  <aside class="wiki-infobox">
    <strong>{{file.title}}</strong>
    <table>
      {{#each file.yaml}}<tr><td>{{@key}}</td><td>{{this}}</td></tr>{{/each}}
    </table>
  </aside>
</div>
{{/if}}
`,

  "bookshelf.layout.md": `---
name: "Bookshelf"
description: "Responsive card grid of all vault files"
applies-to: "collection"
---
<style>
.shelf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; padding: 8px 24px; }
.shelf-card { background: var(--bg-secondary, #2a2a3a); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; cursor: pointer; transition: background 0.15s; }
.shelf-card:hover { background: var(--bg-hover, #333); }
.shelf-card-title { font-weight: 600; color: var(--text-primary); font-size: 14px; margin-bottom: 6px; }
.shelf-card-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.shelf-tag { background: var(--bg-primary); border-radius: 3px; padding: 2px 6px; font-size: 11px; color: var(--text-secondary); }
</style>
<h2 style="color:var(--text-primary);padding:16px 24px 0">{{vault.name}}</h2>
<div class="shelf-grid">
{{#each vault.files}}
<div class="shelf-card" data-path="{{this.path}}">
  <div class="shelf-card-title">{{this.title}}</div>
  <div class="shelf-card-tags">
    {{#each this.tags}}<span class="shelf-tag">{{this}}</span>{{/each}}
  </div>
</div>
{{/each}}
</div>
`,
};

// ── Frontmatter parser ─────────────────────────────────────────────────────────

/** Parse layout frontmatter fields and extract body from a .layout.md file. */
export function parseLayoutFrontmatter(src: string, filePath: string): LayoutMeta {
  const stem = filePath.split("/").pop()?.replace(/\.layout\.md$/, "") ?? "Layout";
  let name = stem;
  let description = "";
  let appliesTo: LayoutMeta["appliesTo"] = "any";
  let body = src;

  if (src.startsWith("---")) {
    const closeIdx = src.indexOf("\n---", 3);
    if (closeIdx !== -1) {
      const yamlBlock = src.slice(3, closeIdx).trim();
      body = src.slice(closeIdx + 4).trimStart();
      for (const line of yamlBlock.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key === "name" && value) name = value;
        else if (key === "description") description = value;
        else if (key === "applies-to" && (value === "single" || value === "collection" || value === "any")) {
          appliesTo = value;
        }
      }
    }
  }

  return { name, description, appliesTo, filePath, body };
}

// ── Layout discovery ───────────────────────────────────────────────────────────

/**
 * Discover all .layout.md files from global App Support dir and (if a vault is
 * active) the vault-specific directory. Per-vault layouts shadow global ones
 * with the same filename.
 */
export async function discoverLayouts(
  appDataDir: string,
  vaultRoot: string | null,
): Promise<LayoutMeta[]> {
  const globalDir = `${appDataDir}/${LAYOUTS_SUBDIR}`;
  const vaultDir = vaultRoot ? `${vaultRoot}/${VAULT_LAYOUTS_SUBDIR}` : null;

  const seen = new Map<string, LayoutMeta>(); // filename → meta (per-vault wins)

  async function loadFromDir(dir: string): Promise<void> {
    let files: string[];
    try {
      files = await listMdFiles(dir);
    } catch {
      return;
    }
    for (const filename of files.filter((f) => f.endsWith(".layout.md"))) {
      const fullPath = `${dir}/${filename}`;
      try {
        const result = await readFile(fullPath);
        if (result.ok) {
          seen.set(filename, parseLayoutFrontmatter(result.value, fullPath));
        }
      } catch {
        // Skip unreadable files.
      }
    }
  }

  // Global first, then per-vault (per-vault overwrites same filename).
  await loadFromDir(globalDir);
  if (vaultDir) await loadFromDir(vaultDir);

  return [...seen.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

// ── Starter layout bootstrap ───────────────────────────────────────────────────

/**
 * Write bundled starter layouts to the global App Support layouts directory
 * if it is empty. Called once at app startup.
 */
export async function ensureStarterLayouts(appDataDir: string): Promise<void> {
  const dir = `${appDataDir}/${LAYOUTS_SUBDIR}`;
  try {
    await ensureDirectory(dir);
    const existing = await listMdFiles(dir);
    if (existing.some((f) => f.endsWith(".layout.md"))) return; // Already bootstrapped.
    for (const [filename, content] of Object.entries(STARTER_LAYOUTS)) {
      try {
        const result = await writeFile(`${dir}/${filename}`, content);
        if (!result.ok) {
          console.warn("[layout-manager] Failed to write starter layout:", filename);
        }
      } catch (err) {
        console.warn("[layout-manager] Error writing starter layout:", filename, err);
      }
    }
  } catch {
    // Silent — App Support write failure is non-fatal.
  }
}

// ── YAML front matter parser (for target file's YAML) ─────────────────────────

function parseFileYaml(content: string): Record<string, unknown> {
  if (!content.startsWith("---")) return {};
  const closeIdx = content.indexOf("\n---", 3);
  if (closeIdx === -1) return {};

  const yamlBlock = content.slice(3, closeIdx).trim();
  const result: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) { i++; continue; }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    i++;

    if (rawValue === "") {
      const items: string[] = [];
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, ""));
        i++;
      }
      result[key] = items.length > 0 ? items : "";
    } else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      result[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      result[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }

  return result;
}

// ── Context builder ────────────────────────────────────────────────────────────

/** Build a TemplateContext from vault state, meta store, and optionally a file. */
export async function buildLayoutContext(
  filePath: string | null,
  deps: LayoutDeps,
): Promise<TemplateContext> {
  const index = deps.getVaultIndex();
  const meta = deps.getMetaStore();

  const vaultFiles: VaultFileEntry[] = index
    ? index.entries.map((e) => ({
        title: e.title,
        path: e.path,
        name: e.name,
        tags: e.tags,
        modified: e.modified,
      }))
    : [];

  const vaultCtx = {
    files: vaultFiles,
    name: deps.getActiveVaultName(),
    directories: index?.directories ?? [],
  };

  const metaCtx = {
    tags: meta?.tags ?? [],
    fields: meta?.fields ?? {},
  };

  let fileCtx = null;
  if (filePath) {
    const fileResult = await readFile(filePath);
    if (fileResult.ok) {
      const content = fileResult.value;
      const yaml = parseFileYaml(content);
      const bodyStart = content.startsWith("---")
        ? (content.indexOf("\n---", 3) + 4)
        : 0;
      const body = content.slice(bodyStart);
      const stem = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";

      // Look up modified from vault index if available.
      const indexEntry = index?.entries.find((e) => e.path === filePath);

      fileCtx = {
        title: (yaml.title as string) || stem,
        content: body,
        rendered: marked.parse(body) as string,
        tags: Array.isArray(yaml.tags) ? (yaml.tags as string[]) : [],
        yaml,
        path: filePath,
        name: stem,
        modified: indexEntry?.modified ?? 0,
      };
    }
  }

  return { file: fileCtx, vault: vaultCtx, meta: metaCtx };
}

// ── Bridge-compatible invoke adapter ──────────────────────────────────────────

/** Wraps bridge.readFile in the (cmd, args) signature the engine expects. */
function makeBridgeInvoke() {
  return async (cmd: string, args: Record<string, unknown>): Promise<unknown> => {
    if (cmd === "read_file") {
      const result = await readFile(args.path as string);
      if (result.ok) return result.value;
      throw new Error(result.error?.message ?? "read failed");
    }
    throw new Error(`[layout-manager] Unknown engine command: ${cmd}`);
  };
}

// ── Apply layout ───────────────────────────────────────────────────────────────

/** Render a layout against the current file/vault and open a custom render tab. */
export async function applyLayout(
  layoutMeta: LayoutMeta,
  filePath: string | null,
  deps: LayoutDeps,
): Promise<void> {
  const ctx = await buildLayoutContext(filePath, deps);
  const vaultRoot = deps.getActiveVaultRoot();

  const rawHtml = await render(
    layoutMeta.body,
    ctx,
    0,
    vaultRoot ?? "",
    makeBridgeInvoke(),
    (md) => marked.parse(md) as string,
  );

  const safeHtml = stripScripts(rawHtml);

  deps.openCustomRenderTab(layoutMeta.name, (el) => {
    el.innerHTML = safeHtml;
    wireDataPathListeners(el);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Picker UI ──────────────────────────────────────────────────────────────────

let _pickerOpen = false;
let _overlayEl: HTMLElement | null = null;

/** Open the layout picker modal. No-op if already open or no layouts found. */
export async function openLayoutPicker(deps: LayoutDeps): Promise<void> {
  if (_pickerOpen) return;
  const layouts = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
  if (layouts.length === 0) return;

  _pickerOpen = true;
  let selectedIdx = 0;

  const overlay = document.createElement("div");
  overlay.className = "templates-overlay layouts-picker-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Open with Layout");

  function renderItems(): void {
    const card = overlay.querySelector(".templates-card");
    if (!card) return;
    card.querySelector(".layouts-picker-list")?.remove();
    const list = document.createElement("div");
    list.className = "layouts-picker-list";
    list.innerHTML = layouts.map((l, i) => `
      <button class="templates-item layouts-picker-item${i === selectedIdx ? " selected" : ""}" data-idx="${i}">
        <span class="layouts-picker-name">${escapeHtml(l.name)}</span>
        <span class="layouts-picker-desc">${escapeHtml(l.description)}</span>
      </button>
    `).join("");
    card.appendChild(list);
    list.querySelectorAll<HTMLButtonElement>(".templates-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedIdx = parseInt(btn.dataset.idx ?? "0", 10);
        applyAndClose();
      });
    });
  }

  function applyAndClose(): void {
    void applyLayout(layouts[selectedIdx], deps.getCurrentFilePath(), deps);
    closePicker();
  }

  overlay.innerHTML = `<div class="templates-card"><div class="templates-header">Open with Layout</div></div>`;
  document.body.appendChild(overlay);
  _overlayEl = overlay;
  renderItems();

  function handleKeydown(e: KeyboardEvent): void {
    if (!_pickerOpen) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, layouts.length - 1); renderItems(); break;
      case "ArrowUp":   e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); renderItems(); break;
      case "Enter":     e.preventDefault(); applyAndClose(); break;
      case "Escape":    e.preventDefault(); closePicker(); break;
    }
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closePicker(); });
  document.addEventListener("keydown", handleKeydown);
  (overlay as unknown as Record<string, unknown>)["_keydownHandler"] = handleKeydown;
}

function closePicker(): void {
  if (!_pickerOpen) return;
  _pickerOpen = false;
  if (_overlayEl) {
    const handler = (_overlayEl as unknown as Record<string, unknown>)["_keydownHandler"];
    if (typeof handler === "function") document.removeEventListener("keydown", handler as EventListener);
    _overlayEl.remove();
    _overlayEl = null;
  }
}

// ── CM6 auto-render extension ──────────────────────────────────────────────────

let _lastAutoRenderPath: string | null = null;

/** Return a CM6 Extension that auto-renders files with a `layout:` frontmatter key. */
export function buildAutoRenderExtension(deps: LayoutDeps): Extension {
  return EditorView.updateListener.of(async (update) => {
    const currentPath = deps.getCurrentFilePath();
    if (currentPath === _lastAutoRenderPath) return;
    _lastAutoRenderPath = currentPath;
    if (!currentPath) return;

    const doc = update.state.doc.toString();
    const yamlMatch = doc.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) return;
    const layoutField = yamlMatch[1].match(/^layout:\s*(.+)$/m);
    if (!layoutField) return;
    const layoutName = layoutField[1].trim().replace(/["']/g, "");
    if (!layoutName || layoutName.toLowerCase() === "none") return;

    const all = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
    const target = all.find(
      (l) => l.name === layoutName || l.filePath.endsWith(`/${layoutName}.layout.md`),
    );
    if (!target) return;
    void applyLayout(target, currentPath, deps);
  });
}

// ── CSS ────────────────────────────────────────────────────────────────────────

/** Inject layouts CSS into document head. Idempotent. */
export function injectLayoutsCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.layouts-picker-overlay .templates-card { max-height: 70vh; overflow: hidden; display: flex; flex-direction: column; }
.layouts-picker-list { overflow-y: auto; flex: 1; }
.layouts-picker-item { display: flex; flex-direction: column; text-align: left; }
.layouts-picker-name { font-size: 13px; color: var(--text-primary, #ccc); }
.layouts-picker-desc { font-size: 11px; color: var(--text-secondary, #888); margin-top: 2px; }
`;
  document.head.appendChild(style);
}
