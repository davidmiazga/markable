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
import { render, stripScripts, wireDataPathListeners, wireAnchorLinks } from "./layout-engine";
import type { TemplateContext, VaultFileEntry, TocEntry } from "./layout-engine";
import { marked, Marked, Token } from "marked";
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
  /** Enter layout view on the current editor tab (Cmd-E / auto-render / picker). */
  showLayoutView: (renderFn: (el: HTMLElement) => void) => void;
  /** Update layout content without switching into layout view (save-triggered refresh). */
  refreshLayoutView: (renderFn: (el: HTMLElement) => void) => void;
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
description: "Serif title, jump-link TOC, inline sidebars"
applies-to: "single"
---
<style>
.wiki-page{max-width:980px;margin:0 auto;padding:20px 28px;color:var(--text-primary)}
.wiki-h1{font-family:Georgia,"Times New Roman",serif;font-size:var(--heading-h1-size);font-weight:var(--heading-h1-weight);margin:0 0 16px}
.wiki-page hr{border:none;border-top:1px solid var(--border-color);margin:8px 0}
.wiki-toc{margin:6px 0;font-size:13px;line-height:2}
.wiki-toc a{color:var(--text-secondary);text-decoration:none;margin-right:14px}
.wiki-toc a:hover{color:var(--text-primary);text-decoration:underline}
.wiki-toc a.toc-h3{padding-left:12px;font-size:12px}
.wiki-body{overflow:auto}
.wiki-infobox{float:right;clear:right;margin:0 0 16px 24px;width:270px;border:1px solid var(--border-color);background:var(--bg-secondary);font-size:13px;border-radius:3px;overflow:hidden}
.wiki-infobox-body{padding:10px}
.wiki-infobox-body img{max-width:100%;display:block;margin:0 auto 8px}
.wiki-infobox-body p{margin:3px 0}
.wiki-infobox-body table{width:100%;border-collapse:collapse}
.wiki-infobox-body td{padding:3px 6px;border-top:1px solid var(--border-color);vertical-align:top}
.wiki-infobox-body td:first-child{color:var(--text-secondary);white-space:nowrap}
.wiki-body :is(h1,h2,h3,h4,h5,h6)+p{margin-top:0}
.wiki-body :is(h1,h2,h3,h4,h5,h6):has(+p){margin-bottom:4px}
.wiki-body h1{font-family:Georgia,"Times New Roman",serif;font-size:var(--heading-h1-size);font-weight:var(--heading-h1-weight)}
.wiki-body h2{font-family:Georgia,"Times New Roman",serif;font-size:var(--heading-h2-size);font-weight:var(--heading-h2-weight);border-bottom:1px solid var(--border-color);padding-bottom:2px;margin-top:24px}
.wiki-body h3{font-family:inherit;font-size:var(--heading-h3-size);font-weight:var(--heading-h3-weight);border-bottom:none}
.wiki-body h4{font-family:inherit;font-size:var(--heading-h4-size);font-weight:var(--heading-h4-weight);border-bottom:none}
.wiki-body h5{font-family:inherit;font-size:var(--heading-h5-size);font-weight:var(--heading-h5-weight);border-bottom:none}
.wiki-body h6{font-family:inherit;font-size:var(--heading-h6-size);font-weight:var(--heading-h6-weight);border-bottom:none}
.wiki-infobox-body :is(h1,h2){margin-top:0}
</style>
{{#if file}}
<div class="wiki-page">
  <h1 class="wiki-h1">{{file.title}}</h1>
  {{#if file.toc}}
  <hr>
  <nav class="wiki-toc">{{#each file.toc}}<a href="#{{this.id}}" class="{{this.cssClass}}">{{this.text}}</a>{{/each}}</nav>
  <hr>
  {{/if}}
  <div class="wiki-body">
    {{{file.rendered}}}
  </div>
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

  // Seed with in-memory starter layouts so bundled templates are always current
  // regardless of what version is on disk (avoids stale-template issues on hot-reload).
  for (const [filename, content] of Object.entries(STARTER_LAYOUTS)) {
    const fullPath = `${globalDir}/${filename}`;
    seen.set(filename, parseLayoutFrontmatter(content, fullPath));
  }

  async function loadFromDir(dir: string, isVault: boolean): Promise<void> {
    let files: string[];
    try {
      files = await listMdFiles(dir);
    } catch {
      return;
    }
    for (const filename of files.filter((f) => f.endsWith(".layout.md"))) {
      // Global dir: skip starter filenames — in-memory version is authoritative.
      if (!isVault && Object.prototype.hasOwnProperty.call(STARTER_LAYOUTS, filename)) continue;
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

  // Global first (user-created non-starter files), then per-vault (overrides everything).
  await loadFromDir(globalDir, false);
  if (vaultDir) await loadFromDir(vaultDir, true);

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

// ── Sidebar + TOC processing ───────────────────────────────────────────────────

/**
 * Replace every ```sidebar fence in `body` with an inline <aside> HTML block
 * at that position, so multiple sidebars each float right near their related
 * content rather than stacking at the top.
 */
function processSidebarFences(body: string): string {
  const re = /^```sidebar[^\n]*\n([\s\S]*?)^```/mg;
  return body.replace(re, (_match, content) => {
    const html = marked.parse(content.trimEnd()) as string;
    return `\n\n<aside class="wiki-infobox"><div class="wiki-infobox-body">${html}</div></aside>\n\n`;
  });
}

/**
 * A marked instance that adds `id` attributes to headings so TOC jump links
 * work inside the layout container. IDs are generated with the same algorithm
 * used by `extractToc`, ensuring consistency.
 */
const _markedWithIds = (() => {
  const m = new Marked();
  m.use({ breaks: true });
  m.use({
    renderer: {
      heading({ tokens, depth }: { tokens: Token[]; depth: number; text: string; raw: string; type: string }): string {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const text = (this as any).parser.parseInline(tokens) as string;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const plain = text.replace(/<[^>]+>/g, "");
        const id = plain.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
    },
  });
  return m;
})();

function extractToc(body: string): TocEntry[] {
  const result: TocEntry[] = [];
  const re = /^(#{2,3})\s+(.+)$/mg;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[2].trim().replace(/\*{1,2}|_{1,2}|`/g, "");
    result.push({
      level: m[1].length,
      text,
      id: text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-"),
      cssClass: m[1].length === 3 ? "toc-h3" : "",
    });
  }
  return result;
}

// ── Context builder ────────────────────────────────────────────────────────────

/** Build a TemplateContext from vault state, meta store, and optionally a file. */
export async function buildLayoutContext(
  filePath: string | null,
  deps: LayoutDeps,
  docContent?: string,
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
    let rawContent: string | null = null;
    if (docContent !== undefined) {
      rawContent = docContent;
    } else {
      const fileResult = await readFile(filePath);
      if (fileResult.ok) rawContent = fileResult.value;
    }
    if (rawContent !== null) {
      const content = rawContent;
      const yaml = parseFileYaml(content);
      const bodyStart = content.startsWith("---")
        ? (content.indexOf("\n---", 3) + 4)
        : 0;
      const rawBody = content.slice(bodyStart);
      const cleanBody = processSidebarFences(rawBody);
      const toc = extractToc(cleanBody);
      const stem = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";

      // Look up modified from vault index if available.
      const indexEntry = index?.entries.find((e) => e.path === filePath);

      fileCtx = {
        title: (yaml.title as string) || stem,
        content: cleanBody,
        rendered: _markedWithIds.parse(cleanBody) as string,
        tags: Array.isArray(yaml.tags) ? (yaml.tags as string[]) : [],
        yaml,
        path: filePath,
        name: stem,
        modified: indexEntry?.modified ?? 0,
        toc,
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
  options: { activate?: boolean; docContent?: string } = {},
): Promise<void> {
  const ctx = await buildLayoutContext(filePath, deps, options.docContent);
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

  const showFn = options.activate === false ? deps.refreshLayoutView : deps.showLayoutView;
  showFn((el) => {
    el.innerHTML = safeHtml;
    wireDataPathListeners(el);
    wireAnchorLinks(el);
  });
}

// ── Layout field helpers ───────────────────────────────────────────────────────

/**
 * Extract the `layout:` field value from a document's YAML frontmatter.
 * Returns null if the field is absent, empty, or set to "none".
 */
export function extractLayoutField(docContent: string): string | null {
  const yamlMatch = docContent.match(/^---\n([\s\S]*?)\n---/);
  if (!yamlMatch) return null;
  const layoutField = yamlMatch[1].match(/^layout:\s*(.+)$/m);
  if (!layoutField) return null;
  const name = layoutField[1].trim().replace(/["']/g, "");
  return name && name.toLowerCase() !== "none" ? name : null;
}

/**
 * Discover the layout for a file and render it into a custom tab.
 * Returns true if a matching layout was found and applied, false otherwise.
 * Uses openCustomRenderTab (activates the tab) — intended for explicit user actions.
 */
export async function showLayoutForFile(
  filePath: string,
  docContent: string,
  deps: LayoutDeps,
): Promise<boolean> {
  const layoutName = extractLayoutField(docContent);
  if (!layoutName) return false;
  const all = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
  const target = all.find(
    (l) =>
      l.name.toLowerCase() === layoutName.toLowerCase() ||
      l.filePath.endsWith(`/${layoutName}.layout.md`),
  );
  if (!target) return false;
  void applyLayout(target, filePath, deps, { docContent });
  return true;
}

// ── Save-triggered render ──────────────────────────────────────────────────────

/**
 * Called from saveFile() — reads layout field from the in-memory doc string
 * and triggers applyLayout if the file has a non-empty, non-"none" layout.
 */
export async function checkAndApplyLayoutOnSave(
  filePath: string | null,
  docContent: string,
  deps: LayoutDeps,
): Promise<void> {
  if (!filePath) return;
  const layoutName = extractLayoutField(docContent);
  if (!layoutName) return;

  const all = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
  const target = all.find(
    (l) =>
      l.name.toLowerCase() === layoutName.toLowerCase() ||
      l.filePath.endsWith(`/${layoutName}.layout.md`),
  );
  if (!target) return;
  void applyLayout(target, filePath, deps, { activate: false });
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
    if (!currentPath) return;                        // custom/media tab active — ignore
    if (currentPath === _lastAutoRenderPath) return; // same file, no re-render
    _lastAutoRenderPath = currentPath;

    const layoutName = extractLayoutField(update.state.doc.toString());
    if (!layoutName) return;

    const all = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
    const target = all.find(
      (l) => l.name === layoutName || l.filePath.endsWith(`/${layoutName}.layout.md`),
    );
    if (!target) return;
    void applyLayout(target, currentPath, deps);
  });
}

// ── CSS ────────────────────────────────────────────────────────────────────────

/** Inject sidebar live-preview CSS into document head. Idempotent. */
export function injectSidebarCSS(): void {
  const id = "__markable_sidebar_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.cm-sidebar-preview{border:1px solid var(--border-color);background:var(--bg-secondary);border-radius:4px;padding:10px 14px;margin:8px 0;font-size:13px}
.cm-sidebar-preview img{max-width:100%;display:block;margin:4px auto}
.cm-sidebar-preview table{width:100%;border-collapse:collapse}
.cm-sidebar-preview td{padding:3px 6px;border-top:1px solid var(--border-color);vertical-align:top}
.cm-sidebar-preview td:first-child{color:var(--text-secondary)}
`;
  document.head.appendChild(style);
}

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
