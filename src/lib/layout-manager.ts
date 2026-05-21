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

import { readFile, writeFile, deleteFile, ensureDirectory, listMdFiles, openAssetDialog } from "./bridge";
import { convertFileSrc } from "@tauri-apps/api/core";
import { render, stripScripts, wireDataPathListeners, wireAnchorLinks } from "./layout-engine";
import type { TemplateContext, VaultFileEntry, TocEntry } from "./layout-engine";
import { marked, Marked, Token } from "marked";
import type { VaultIndex } from "./vault-types";
import type { MetaStore } from "./meta-manager";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openTemplatePicker } from "./template-picker";
import type { TemplateDefinition } from "./template-picker";

// ── Public types ───────────────────────────────────────────────────────────────

/** Parsed representation of a .layout.md file. */
export interface LayoutMeta {
  name: string;
  description: string;
  appliesTo: "single" | "collection" | "any";
  /** True only for layouts that render inline above the CM editor (e.g. Notion Page). */
  inline: boolean;
  /** Short identifier written to `layout:` YAML field. Defaults to the filename stem. */
  slug: string;
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
  /** Exit layout view and return to the editor (used by inline layouts). */
  exitLayoutView?: () => void;
  getCurrentFilePath: () => string | null;
  /** Return the live editor content for the active file (unsaved changes included). */
  getActiveFileContent?: () => string | null;
  /**
   * Called after layout-manager writes a `layout:` key into a file's YAML.
   * The host (main.ts) should update the open tab's in-memory doc so the editor
   * reflects the change; if the file is the currently active tab, also dispatch
   * the new content to the CM6 editor so saves don't clobber the YAML update.
   */
  onFileUpdated?: (filePath: string, newContent: string) => void;
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
inline: true
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

  "notion-page.layout.md": `---
name: "Notion Page"
description: "Full-width cover, large icon, and clean reading layout"
applies-to: "single"
inline: true
slug: notion
---
<style>
.np-wrapper{width:100%}
.np-cover{width:100%;height:220px;object-fit:cover;object-position:center;display:block}
.np-page{max-width:860px;margin:0 auto;padding:0 0 48px;color:var(--text-primary)}
.np-icon-row{padding:0 32px}
.np-icon{font-size:64px;line-height:1;display:inline-block;margin-top:-32px;background:var(--bg-primary,#1e1e1e);border-radius:8px;padding:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.np-icon-img{width:64px;height:64px;object-fit:contain;display:inline-block;margin-top:-32px;background:var(--bg-primary,#1e1e1e);border-radius:8px;padding:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.np-icon-svg{display:inline-block;margin-top:-32px;background:var(--bg-primary,#1e1e1e);border-radius:100%;padding:19px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.np-icon-svg svg{width:55px;height:55px;display:block}
.np-title{font-size:2.2em;font-weight:700;margin:12px 32px 4px;color:var(--text-primary);line-height:1.2}
.np-body{padding:0 32px;font-size:15px;line-height:1.7}
.np-body h1,.np-body h2,.np-body h3{margin-top:1.5em;margin-bottom:.4em}
.np-body h2{border-bottom:1px solid var(--border-color);padding-bottom:4px}
.np-body p{margin:.6em 0}
.np-body a{color:var(--accent-color,#4a9eff)}
.np-body img{max-width:100%;border-radius:4px}
</style>
{{#if file}}
<div class="np-wrapper">
  {{#if file.yaml._coverSrc}}
  <img class="np-cover" src="{{file.yaml._coverSrc}}" alt="" onerror="this.style.display='none'">
  {{/if}}
<div class="np-page">
  <div class="np-icon-row">
    {{#if file.yaml._iconSvgContent}}<div class="np-icon-svg">{{{file.yaml._iconSvgContent}}}</div>{{/if}}
    {{#if file.yaml._iconImgSrc}}<img class="np-icon-img" src="{{file.yaml._iconImgSrc}}" alt="" onerror="this.style.display='none'">{{/if}}
    {{#if file.yaml._iconText}}<span class="np-icon">{{file.yaml._iconText}}</span>{{/if}}
  </div>
  <h1 class="np-title">{{file.title}}</h1>
  <div class="np-body">{{{file.rendered}}}</div>
</div>
</div>
{{/if}}
`,
};

// ── Frontmatter parser ─────────────────────────────────────────────────────────

/** Parse layout frontmatter fields and extract body from a .layout.md file. */
export function parseLayoutFrontmatter(src: string, filePath: string): LayoutMeta {
  const stem = filePath.split("/").pop()?.replace(/\.layout\.md$/, "") ?? "Layout";
  let name = stem;
  let description = "";
  let appliesTo: LayoutMeta["appliesTo"] = "any";
  let inline = false;
  let slug = stem;
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
        } else if (key === "inline") {
          inline = value === "true";
        } else if (key === "slug" && value) {
          slug = value;
        }
      }
    }
  }

  return { name, description, appliesTo, inline, slug, filePath, body };
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
    // Clean up renamed/removed starter layouts from existing installs.
    void deleteFile(`${dir}/bookshelf.layout.md`);
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

function resolveAssetSrc(value: string, fileDir = ""): string {
  const abs = value.startsWith("/") ? value : `${fileDir}/${value.replace(/^\.\//, "")}`;
  return convertFileSrc(abs);
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

      const icon = yaml.icon as string | undefined;
      const cover = yaml.cover as string | undefined;
      const fileDir = filePath.split("/").slice(0, -1).join("/");

      // resolveAssetSrc is a module-level helper — see below

      const _iconIsImagePath = icon ? /\.(svg|png|jpg|jpeg|webp|gif)$/i.test(icon) : false;
      const _iconIsSvg = icon ? /\.svg$/i.test(icon) : false;

      // SVG: inline the markup — asset:// protocol doesn't serve SVG with the
      // correct MIME type, so <img src="asset://...svg"> silently fails.
      let _iconSvgContent: string | undefined;
      let _iconImgSrc: string | undefined;
      if (icon && _iconIsImagePath) {
        if (_iconIsSvg) {
          const absIcon = icon.startsWith("/") ? icon : `${fileDir}/${icon.replace(/^\.\//, "")}`;
          const svgResult = await readFile(absIcon);
          if (svgResult.ok) {
            const iconThemed = yaml["icon-themed"] === "true" || yaml["icon-themed"] === true;
            _iconSvgContent = iconThemed
              ? adaptSvgFillsToCurrentColor(svgResult.value)
              : svgResult.value;
          }
        } else {
          _iconImgSrc = resolveAssetSrc(icon, fileDir);
        }
      }

      // Mutually exclusive — at most one is set, so templates avoid {{else}}.
      const yamlWithMeta = {
        ...yaml,
        _coverSrc: cover ? resolveAssetSrc(cover, fileDir) : undefined,
        _iconSvgContent,
        _iconImgSrc,
        _iconText: icon && !_iconIsImagePath ? icon : undefined,
      };

      fileCtx = {
        title: (yaml.title as string) || stem,
        content: cleanBody,
        rendered: _markedWithIds.parse(cleanBody) as string,
        tags: Array.isArray(yaml.tags) ? (yaml.tags as string[]) : [],
        yaml: yamlWithMeta,
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
  // Inline layouts are rendered by buildLayoutInlineExtension — no panel needed.
  if (layoutMeta.inline) return;

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

// ── SVG theme adaptation ───────────────────────────────────────────────────────

/**
 * Replace hardcoded fill values in an SVG string with `currentColor` so the
 * icon inherits its colour from the surrounding CSS `color` property.
 * `fill="none"` and `fill="transparent"` are preserved intentionally.
 */
function adaptSvgFillsToCurrentColor(svg: string): string {
  svg = svg.replace(/\bfill="([^"]*)"/g, (_m, val) => {
    const v = val.trim().toLowerCase();
    return v === "none" || v === "transparent" ? _m : 'fill="currentColor"';
  });
  svg = svg.replace(/\bfill\s*:\s*([^;}"'\s][^;}"']*)/g, (_m, val) => {
    const v = val.trim().toLowerCase();
    return v === "none" || v === "transparent" ? _m : "fill:currentColor";
  });
  return svg;
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
  const needle = layoutName.toLowerCase();
  const target = all.find(
    (l) =>
      l.name.toLowerCase().includes(needle) ||
      l.filePath.split("/").pop()!.replace(".layout.md", "").includes(needle),
  );
  if (!target) return false;
  // Inline layouts are always edited in Typora mode — Cmd-E toggles code ↔ Typora.
  if (target.inline) return false;
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
  const needle = layoutName.toLowerCase();
  const target = all.find(
    (l) =>
      l.name.toLowerCase().includes(needle) ||
      l.filePath.split("/").pop()!.replace(".layout.md", "").includes(needle),
  );
  if (!target) return;
  // activate: false → only refresh an already-visible panel (don't interrupt editing on save).
  void applyLayout(target, filePath, deps, { activate: false, docContent });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Layout picker UI ───────────────────────────────────────────────────────────

export const LAYOUT_PREVIEW_SVGS: Record<string, string> = {
  "wikipedia.layout.md": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
    <rect width="400" height="280" fill="#1a1a1a"/>
    <rect x="20" y="18" width="240" height="14" rx="3" fill="#ccc"/>
    <rect x="20" y="38" width="120" height="2" rx="1" fill="#555"/>
    <rect x="20" y="50" width="100" height="8" rx="2" fill="#666"/>
    <rect x="20" y="62" width="80" height="8" rx="2" fill="#666"/>
    <rect x="20" y="74" width="90" height="8" rx="2" fill="#666"/>
    <rect x="240" y="50" width="140" height="80" rx="3" fill="#252525" stroke="#444" stroke-width="1"/>
    <rect x="248" y="58" width="124" height="50" rx="2" fill="#333"/>
    <rect x="248" y="114" width="60" height="6" rx="1" fill="#555"/>
    <rect x="248" y="124" width="80" height="5" rx="1" fill="#555"/>
    <rect x="20" y="94" width="210" height="6" rx="1" fill="#555"/>
    <rect x="20" y="106" width="200" height="6" rx="1" fill="#555"/>
    <rect x="20" y="118" width="215" height="6" rx="1" fill="#555"/>
    <rect x="20" y="138" width="180" height="10" rx="2" fill="#888"/>
    <rect x="20" y="154" width="360" height="6" rx="1" fill="#555"/>
    <rect x="20" y="166" width="350" height="6" rx="1" fill="#555"/>
    <rect x="20" y="178" width="355" height="6" rx="1" fill="#555"/>
  </svg>`,
  "notion-page.layout.md": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
    <rect width="400" height="280" fill="#1a1a1a"/>
    <rect x="0" y="0" width="400" height="90" rx="0" fill="#2a3040"/>
    <rect x="28" y="72" width="44" height="44" rx="8" fill="#1a1a1a"/>
    <text x="50" y="104" text-anchor="middle" font-size="26">📝</text>
    <rect x="30" y="128" width="220" height="16" rx="3" fill="#ddd"/>
    <rect x="30" y="154" width="340" height="6" rx="1" fill="#555"/>
    <rect x="30" y="166" width="330" height="6" rx="1" fill="#555"/>
    <rect x="30" y="178" width="335" height="6" rx="1" fill="#555"/>
    <rect x="30" y="198" width="160" height="9" rx="2" fill="#777"/>
    <rect x="30" y="214" width="340" height="6" rx="1" fill="#555"/>
    <rect x="30" y="226" width="320" height="6" rx="1" fill="#555"/>
  </svg>`,
};

/**
 * Insert or replace multiple keys in a file's YAML front matter.
 * Keys are written in the order provided. If no front matter exists, a minimal block is prepended.
 */
function insertLayoutFields(content: string, fields: Record<string, string>): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (fmMatch) {
    let fmBlock = fmMatch[1];
    for (const [key, value] of Object.entries(fields)) {
      if (new RegExp(`^${key}:`, "m").test(fmBlock)) {
        fmBlock = fmBlock.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
      } else if (key === "layout") {
        // Always place layout: as the first key so it's visible at a glance.
        fmBlock = `${key}: ${value}\n` + fmBlock;
      } else {
        fmBlock += `\n${key}: ${value}`;
      }
    }
    return content.replace(/^---\n([\s\S]*?)\n---(\n|$)/, `---\n${fmBlock}\n---\n`);
  }
  const fieldLines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${fieldLines}\n---\n\n${content}`;
}

/**
 * Comment out config fields that don't belong to `newStem` and uncomment those
 * that do — so switching layouts preserves values for when the user switches back.
 *
 * e.g. switching notion-page → wikipedia:  `cover: ./img.jpg` → `# cover: ./img.jpg`
 * e.g. switching wikipedia → notion-page:  `# cover: ./img.jpg` → `cover: ./img.jpg`
 */
function toggleLayoutConfigFields(content: string, newStem: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!fmMatch) return content;
  const newKeys = new Set((LAYOUT_CONFIG[newStem] ?? []).map((f) => f.key));
  const allKeys = Object.values(LAYOUT_CONFIG).flatMap((fs) => fs.map((f) => f.key));
  let fmBlock = fmMatch[1];
  for (const key of allKeys) {
    if (newKeys.has(key)) {
      // Uncomment: `# key: val` → `key: val`
      fmBlock = fmBlock.replace(new RegExp(`^#\\s*${key}:([^\n]*)`, "m"), `${key}:$1`);
    } else {
      // Comment out: `key: val` → `# key: val`
      fmBlock = fmBlock.replace(new RegExp(`^${key}:([^\n]*)`, "m"), `# ${key}:$1`);
    }
  }
  return content.replace(/^---\n[\s\S]*?\n---(\n|$)/, `---\n${fmBlock}\n---\n`);
}

function insertLayoutField(content: string, stem: string): string {
  return insertLayoutFields(toggleLayoutConfigFields(content, stem), { layout: stem });
}

/**
 * Write the `layout:` field into a file's YAML front matter and immediately
 * render the layout view. If the file is open in the editor (main.ts wires
 * `deps.onFileUpdated`), the in-memory doc is updated so saves preserve the
 * change. For files not currently open, the update is written to disk.
 */
async function setLayoutInFile(
  filePath: string,
  layoutStem: string,
  layout: LayoutMeta,
  deps: LayoutDeps,
): Promise<void> {
  // Prefer live editor content (includes unsaved changes) over the disk version.
  const liveContent = deps.getActiveFileContent?.();
  let baseContent: string;
  if (liveContent !== null && liveContent !== undefined) {
    baseContent = liveContent;
  } else {
    const result = await readFile(filePath);
    if (!result.ok) return;
    baseContent = result.value;
  }
  const newContent = insertLayoutField(baseContent, layoutStem);

  if (deps.onFileUpdated) {
    deps.onFileUpdated(filePath, newContent);
  } else {
    await writeFile(filePath, newContent);
  }

  void applyLayout(layout, filePath, deps, { docContent: newContent });
}

// ── Layout config wizard ───────────────────────────────────────────────────────

interface LayoutFieldDef {
  key: string;
  label: string;
  type?: "image" | "checkbox";
}

const LAYOUT_CONFIG: Record<string, LayoutFieldDef[]> = {
  "notion": [
    { key: "cover", label: "Cover Image", type: "image" },
    { key: "icon", label: "Icon (image or SVG)", type: "image" },
    { key: "icon-themed", label: "Make icon theme-aware (SVG fills → currentColor)", type: "checkbox" },
  ],
};

/**
 * Show a config wizard for layouts that have optional fields (cover, icon, etc.).
 * If the layout has no config, writes the `layout:` key directly and renders.
 */
async function showLayoutConfigWizard(
  filePath: string,
  _stem: string,
  layout: LayoutMeta,
  deps: LayoutDeps,
): Promise<void> {
  const slug = layout.slug;
  const fields = LAYOUT_CONFIG[slug];
  if (!fields) {
    void setLayoutInFile(filePath, slug, layout, deps);
    return;
  }

  const selected: Record<string, string> = {};
  const fileDir = filePath.split("/").slice(0, -1).join("/");

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "layout-config-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10001;display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.style.cssText =
      "background:var(--bg-secondary,#2a2a3a);border:1px solid var(--border-color,#444);border-radius:8px;padding:24px;min-width:360px;max-width:480px;";

    const title = document.createElement("h3");
    title.textContent = `Configure ${layout.name}`;
    title.style.cssText = "margin:0 0 4px;color:var(--text-primary,#ccc);font-size:15px;font-weight:600;";
    const subtitle = document.createElement("p");
    subtitle.textContent = "These fields are optional — skip either to leave it unset.";
    subtitle.style.cssText = "margin:0 0 18px;color:var(--text-secondary,#888);font-size:12px;";
    card.appendChild(title);
    card.appendChild(subtitle);

    for (const field of fields) {
      const row = document.createElement("div");

      if (field.type === "checkbox") {
        row.style.cssText = "margin-bottom:14px;display:flex;align-items:center;gap:8px;";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = `wiz-${field.key}`;
        cb.className = "form-checkbox";
        const lbl = document.createElement("label");
        lbl.htmlFor = `wiz-${field.key}`;
        lbl.textContent = field.label;
        lbl.style.cssText = "color:var(--text-secondary,#888);font-size:12px;cursor:pointer;user-select:none;";
        cb.addEventListener("change", () => {
          if (cb.checked) selected[field.key] = "true";
          else delete selected[field.key];
        });
        row.appendChild(cb);
        row.appendChild(lbl);
      } else {
        row.style.cssText = "margin-bottom:14px;";
        const labelEl = document.createElement("div");
        labelEl.textContent = field.label;
        labelEl.style.cssText = "color:var(--text-secondary,#888);font-size:12px;margin-bottom:6px;";
        row.appendChild(labelEl);

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;align-items:center;gap:8px;";

        const btn = document.createElement("button");
        btn.textContent = "Choose…";
        btn.style.cssText =
          "background:var(--bg-primary,#1e1e1e);color:var(--text-primary,#ccc);border:1px solid var(--border-color,#444);border-radius:4px;padding:6px 12px;cursor:pointer;font-size:13px;white-space:nowrap;flex-shrink:0;";

        const pathEl = document.createElement("span");
        pathEl.textContent = "Not set";
        pathEl.style.cssText =
          "color:var(--text-tertiary,#666);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";

        btn.addEventListener("click", async () => {
          const result = await openAssetDialog();
          if (!result.cancelled) {
            selected[field.key] = result.path;
            pathEl.textContent = result.path.split("/").pop() ?? result.path;
            pathEl.title = result.path;
            pathEl.style.color = "var(--text-primary,#ccc)";
          }
        });

        btnRow.appendChild(btn);
        btnRow.appendChild(pathEl);
        row.appendChild(btnRow);
      }

      card.appendChild(row);
    }

    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:20px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "background:transparent;color:var(--text-secondary,#888);border:1px solid var(--border-color,#444);border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px;";

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText =
      "background:var(--accent-color,#4a9eff);color:#fff;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:500;";

    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      resolve();
    });

    applyBtn.addEventListener("click", async () => {
      overlay.remove();
      const toWrite: Record<string, string> = { layout: slug };
      for (const field of fields) {
        const val = selected[field.key];
        if (!val) continue;
        if (field.type === "checkbox") {
          toWrite[field.key] = val;
        } else {
          toWrite[field.key] = val.startsWith(fileDir + "/")
            ? "./" + val.slice(fileDir.length + 1)
            : val;
        }
      }

      const liveBase = deps.getActiveFileContent?.();
      let baseForWizard: string;
      if (liveBase !== null && liveBase !== undefined) {
        baseForWizard = liveBase;
      } else {
        const readResult = await readFile(filePath);
        if (!readResult.ok) { resolve(); return; }
        baseForWizard = readResult.value;
      }
      const newContent = insertLayoutFields(toggleLayoutConfigFields(baseForWizard, slug), toWrite);

      if (deps.onFileUpdated) {
        deps.onFileUpdated(filePath, newContent);
      } else {
        await writeFile(filePath, newContent);
      }

      void applyLayout(layout, filePath, deps, { docContent: newContent });
      resolve();
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(applyBtn);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

/** Open the layout picker modal. No-op if already open or no layouts found.
 *  Pass `targetFilePath` to apply the layout to a specific file rather than
 *  the currently active tab (used from the file-browser right-click menu). */
export async function openLayoutPicker(deps: LayoutDeps, targetFilePath?: string): Promise<void> {
  const layouts = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
  if (layouts.length === 0) return;

  const filePath = targetFilePath ?? deps.getCurrentFilePath();

  const templates: TemplateDefinition<LayoutMeta>[] = layouts.map((l) => {
    const stem = l.filePath.split("/").pop()!.replace(".layout.md", "");
    const previewSvg = LAYOUT_PREVIEW_SVGS[stem + ".layout.md"] ??
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280"><rect width="400" height="280" fill="#1a1a1a"/><text x="200" y="145" text-anchor="middle" fill="#666" font-size="13">${escapeHtml(l.name)}</text></svg>`;
    return { id: stem, name: l.name, description: l.description, previewSvg, data: l };
  });

  openTemplatePicker<LayoutMeta>({
    title: "Apply Layout",
    createLabel: "Apply",
    templates,
    onSelect: (tpl) => {
      if (!filePath) return;
      const stem = tpl.data.filePath.split("/").pop()!.replace(".layout.md", "");
      void showLayoutConfigWizard(filePath, stem, tpl.data, deps);
    },
  });
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
    const needle = layoutName.toLowerCase();
    const target = all.find(
      (l) =>
        l.name.toLowerCase().includes(needle) ||
        l.filePath.split("/").pop()!.replace(".layout.md", "").includes(needle),
    );
    if (!target) return;
    // Inline layouts handle themselves via buildLayoutInlineExtension.
    // Panel layouts should activate immediately when the file is opened/switched to.
    void applyLayout(target, currentPath, deps);
  });
}

// ── Inline layout header (Typora-compatible editing) ─────────────────────────

let _inlineHeader: HTMLElement | null = null;
let _inlineHeaderSig: string | null = null;
let _inlineHeaderGen = 0;
let _inlineHeaderQuickSig: string | null = null;

/**
 * Injects a cover/icon header directly above the CodeMirror editor whenever
 * the active file has `layout: notion-page` in its YAML front matter.
 *
 * The editor itself stays in Typora editing mode — no panel switch occurs.
 * The header is removed automatically when the layout is cleared or the tab
 * switches to a file without a supported layout.
 */
export function buildLayoutInlineExtension(deps: LayoutDeps): Extension {
  return EditorView.updateListener.of(async (update) => {
    const editorParent = update.view.dom.parentElement;
    if (!editorParent) return;

    const isPreviewMode = editorParent.classList.contains("preview-mode");
    const currentPath = deps.getCurrentFilePath();
    const quickSig = `${currentPath}|${isPreviewMode}`;

    // Skip if neither preview-mode state, path, nor doc content changed
    if (quickSig === _inlineHeaderQuickSig && !update.docChanged) return;
    _inlineHeaderQuickSig = quickSig;

    const gen = ++_inlineHeaderGen;
    const doc = update.state.doc.toString();
    const layoutName = extractLayoutField(doc);

    if (!isPreviewMode || !layoutName) {
      if (_inlineHeader) { _inlineHeader.remove(); _inlineHeader = null; _inlineHeaderSig = null; }
      editorParent.classList.remove("notion-layout-active");
      delete editorParent.dataset.inlineLayout;
      return;
    }

    const fmMatch = doc.match(/^---\n([\s\S]*?)\n---/);
    const fmText = fmMatch ? fmMatch[1] : "";
    const getVal = (key: string): string | undefined => {
      const m = fmText.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m ? m[1].trim() : undefined;
    };
    const cover = getVal("cover");
    const icon = getVal("icon");
    const iconThemed = getVal("icon-themed");
    const sig = `${currentPath}|${layoutName}|${cover}|${icon}|${iconThemed}`;

    if (sig === _inlineHeaderSig && _inlineHeader) return;
    _inlineHeaderSig = sig;

    // Only inline layouts render a header above the editor; panel layouts use showLayoutView.
    const all = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
    if (gen !== _inlineHeaderGen) return;
    const needle = layoutName.toLowerCase();
    const target = all.find(
      (l) =>
        l.name.toLowerCase().includes(needle) ||
        l.filePath.split("/").pop()!.replace(".layout.md", "").includes(needle),
    );
    if (!target?.inline) {
      if (_inlineHeader) { _inlineHeader.remove(); _inlineHeader = null; }
      editorParent.classList.remove("notion-layout-active");
      delete editorParent.dataset.inlineLayout;
      return;
    }

    const layoutStem = target.filePath.split("/").pop()!.replace(".layout.md", "");
    editorParent.dataset.inlineLayout = layoutStem;
    editorParent.classList.add("notion-layout-active");

    if (!_inlineHeader) {
      _inlineHeader = document.createElement("div");
      _inlineHeader.className = "np-inline-header";
      editorParent.insertBefore(_inlineHeader, update.view.dom);
    }

    const fileDir = currentPath ? currentPath.replace(/\/[^/]+$/, "") : "";

    const coverHtml = cover
      ? `<img class="np-cover" src="${resolveAssetSrc(cover, fileDir)}" alt="" onerror="this.style.display='none'">`
      : "";

    if (icon && /\.svg$/i.test(icon)) {
      _inlineHeader.innerHTML = coverHtml + `<div class="np-icon-row"><div class="np-icon-svg"></div></div>`;
      const absIcon = icon.startsWith("/") ? icon : `${fileDir}/${icon.replace(/^\.\//, "")}`;
      const svgResult = await readFile(absIcon);
      if (gen !== _inlineHeaderGen || !_inlineHeader) return;
      if (svgResult.ok) {
        const content = iconThemed === "true" ? adaptSvgFillsToCurrentColor(svgResult.value) : svgResult.value;
        const iconEl = _inlineHeader.querySelector(".np-icon-svg");
        if (iconEl) iconEl.innerHTML = content;
      }
    } else {
      let iconHtml = "";
      if (icon) {
        if (/\.(png|jpg|jpeg|webp|gif)$/i.test(icon)) {
          iconHtml = `<img class="np-icon-img" src="${resolveAssetSrc(icon, fileDir)}" alt="" onerror="this.style.display='none'">`;
        } else {
          iconHtml = `<span class="np-icon">${icon}</span>`;
        }
      }
      if (gen !== _inlineHeaderGen || !_inlineHeader) return;
      _inlineHeader.innerHTML = coverHtml + (iconHtml ? `<div class="np-icon-row">${iconHtml}</div>` : "");
    }
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
.cm-sidebar-preview,.cm-sidebar-left{width:220px;box-sizing:border-box;border:1px solid var(--border-color);background:var(--bg-secondary);border-radius:4px;padding:10px 14px;font-size:13px}
.cm-sidebar-preview{float:right;margin:0 0 16px 20px;clear:right}
.cm-sidebar-left{float:left;margin:0 20px 16px 0;clear:left}
.cm-sidebar-preview img,.cm-sidebar-left img{max-width:100%;display:block;margin:4px auto}
.cm-sidebar-preview table,.cm-sidebar-left table{width:100%;border-collapse:collapse}
.cm-sidebar-preview td,.cm-sidebar-left td{padding:3px 6px;border-top:1px solid var(--border-color);vertical-align:top}
.cm-sidebar-preview td:first-child,.cm-sidebar-left td:first-child{color:var(--text-secondary)}
`;
  document.head.appendChild(style);
}

/** Inject grid codefence widget CSS into document head. Idempotent. */
export function injectGridCSS(): void {
  const id = "__markable_grid_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.cm-grid-wrapper{container-type:inline-size;width:100%}
.cm-grid{display:grid;gap:8px;padding:4px 0;width:100%;box-sizing:border-box}
@container(max-width:300px){.cm-grid{grid-template-columns:1fr!important}}
.cm-grid-cell{padding:12px 14px;box-sizing:border-box;overflow:hidden;min-height:60px}
.cm-grid-cell>*:first-child{margin-top:0}
.cm-grid-cell>*:last-child{margin-bottom:0}
.cm-grid-cell--card{background:var(--bg-secondary,#232333);border:1px solid var(--border-color,rgba(255,255,255,.1));border-radius:4px}
.cm-grid-cell--placeholder{border:1px dashed var(--border-color,rgba(255,255,255,.15));border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted,#555);font-size:12px;font-style:italic;min-height:60px}
.cm-grid-cell h1{font-size:var(--heading-h1-size,2em);font-weight:var(--heading-h1-weight,700);color:var(--text-primary,#ccc);margin:0 0 6px}
.cm-grid-cell h2{font-size:var(--heading-h2-size,1.5em);font-weight:var(--heading-h2-weight,600);color:var(--text-primary,#ccc);margin:0 0 6px}
.cm-grid-cell h3{font-size:var(--heading-h3-size,1.25em);font-weight:var(--heading-h3-weight,600);color:var(--text-primary,#ccc);margin:0 0 6px}
.cm-grid-cell h4{font-size:var(--heading-h4-size,1.1em);font-weight:var(--heading-h4-weight,600);color:var(--text-primary,#ccc);margin:0 0 4px}
.cm-grid-cell h5{font-size:var(--heading-h5-size,1em);font-weight:var(--heading-h5-weight,600);color:var(--text-primary,#ccc);margin:0 0 4px}
.cm-grid-cell h6{font-size:var(--heading-h6-size,.9em);font-weight:var(--heading-h6-weight,600);color:var(--text-secondary,#999);margin:0 0 4px}
.cm-grid-cell p{color:var(--text-primary,#ccc);margin:0 0 6px}
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

/* ── Shared form checkbox (wizard + any layout config UI) ── */
.form-checkbox {
  appearance: none; -webkit-appearance: none;
  width: 18px; height: 18px; flex-shrink: 0;
  border: 1px solid var(--border-color, #444);
  border-radius: 4px; background: transparent; cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.form-checkbox:checked {
  background: var(--link-color, #4a9eff);
  border-color: var(--link-color, #4a9eff);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 8'%3E%3Cpath d='M1 4l3 3 5-6' stroke='%23fff' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: center; background-size: 65%;
}
.form-checkbox:focus-visible { outline: 2px solid var(--link-color, #4a9eff); outline-offset: 2px; }

/* ── Notion layout: inline header above the Typora editor ── */
#editor.notion-layout-active { display: flex !important; flex-direction: column; overflow: hidden !important; }
#editor.notion-layout-active > .cm-editor { flex: 1; min-height: 0; height: auto !important; }
.np-inline-header { flex-shrink: 0; width: 100%; }
.np-inline-header .np-cover { width: 100%; height: 220px; object-fit: cover; object-position: center; display: block; }
.np-inline-header .np-icon-row { padding: 0 80px; margin-top: -32px; position: relative; z-index: 1; }
.np-inline-header .np-icon-svg { display: inline-block; background: var(--bg-primary, #1e1e1e); border-radius: 100%; padding: 19px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
.np-inline-header .np-icon-svg svg { width: 55px; height: 55px; display: block; }
.np-inline-header .np-icon { font-size: 64px; line-height: 1; display: block; }
.np-inline-header .np-icon-img { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; display: block; }
#editor.notion-layout-active .cm-content { padding-left: 80px !important; padding-right: 80px !important; max-width: 860px; margin: 0 auto; box-sizing: border-box; }

/* ── Wikipedia layout: Typora-mode typography ── */
/* CM6 Typora headings render as .cm-live-hN lines containing <span> elements — not real <hN> tags. */
#editor[data-inline-layout="wikipedia"] .cm-live-h1 span,
#editor[data-inline-layout="wikipedia"] .cm-live-h2 span,
#editor[data-inline-layout="wikipedia"] .cm-live-h3 span,
#editor[data-inline-layout="wikipedia"] .cm-live-h4 span { font-family: Georgia, "Linux Libertine", "Times New Roman", serif; }
#editor[data-inline-layout="wikipedia"] .cm-live-h1 span { font-size: 1.95em; font-weight: normal; }
#editor[data-inline-layout="wikipedia"] .cm-live-h2 span { font-size: 1.5em; font-weight: normal; }
#editor[data-inline-layout="wikipedia"] .cm-live-h3 span { font-size: 1.2em; font-weight: bold; }
#editor[data-inline-layout="wikipedia"] .cm-live-h2 { border-bottom: 1px solid var(--border-color, #a2a9b1); padding-bottom: 3px; margin-bottom: 2px; }
#editor[data-inline-layout="wikipedia"] .cm-content { max-width: 980px !important; padding-left: 40px !important; padding-right: 40px !important; font-family: sans-serif; font-size: 14px; line-height: 1.6; }
`;

  document.head.appendChild(style);
}

// ── assign-modal utilities ─────────────────────────────────────────────────────

/**
 * Remove the layout: frontmatter key (flat or nested block) from content.
 * Handles `layout: view-cards` and `layout:\n  type: view-cards\n  ...` formats.
 */
export function stripLayoutBlock(content: string): string {
  const fmEnd = content.indexOf("\n---");
  if (!content.startsWith("---\n") || fmEnd === -1) return content;
  const fmBody = content.slice(4, fmEnd);
  const stripped = fmBody.replace(/^layout:[^\n]*(?:\n[ \t]+[^\n]*)*/m, "");
  return "---\n" + stripped + content.slice(fmEnd);
}

/** Remove the layout: field from a file's YAML and exit any active layout view. */
export async function removeLayoutFromFile(
  filePath: string,
  deps: LayoutDeps,
): Promise<void> {
  const liveContent = deps.getActiveFileContent?.();
  let baseContent: string;
  if (liveContent != null) {
    baseContent = liveContent;
  } else {
    const result = await readFile(filePath);
    if (!result.ok) return;
    baseContent = result.value;
  }
  const newContent = stripLayoutBlock(baseContent);
  if (deps.onFileUpdated) {
    deps.onFileUpdated(filePath, newContent);
  } else {
    await writeFile(filePath, newContent);
  }
  deps.exitLayoutView?.();
}

/** Find a typography layout by slug and apply it to a file. */
/**
 * Build a starter ```grid (or ```grid-card) codefence with a 3x3 lorem-ipsum
 * cell layout. Exported so the CodeBlock modal's Grid form can reuse the same
 * default body the legacy Grid layout used to inject.
 */
export function buildGridStarterFence(opts: {
  cols?: number;
  rows?: number;
  cellStyle?: "grid" | "grid-card";
} = {}): string {
  const cols = Math.max(1, opts.cols ?? 3);
  const rows = Math.max(1, opts.rows ?? 3);
  const fenceTag = opts.cellStyle === "grid-card" ? "```grid-card" : "```grid";
  const samples = [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    "Ut enim ad minim veniam, quis nostrud exercitation.",
    "Ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit.",
    "Esse cillum dolore eu fugiat nulla pariatur.",
    "Excepteur sint occaecat cupidatat non proident.",
    "Sunt in culpa qui officia deserunt mollit anim id est laborum.",
    "Nemo enim ipsam voluptatem quia voluptas sit aspernatur.",
  ];
  const totalCells = cols * rows;
  const lines: string[] = [fenceTag, `${cols}x${rows}`];
  for (let i = 0; i < totalCells; i++) {
    lines.push(`## Cell ${i + 1}`);
    lines.push(samples[i % samples.length]);
    if (i < totalCells - 1) lines.push("---");
  }
  lines.push("```");
  return lines.join("\n");
}

export async function applyLayoutToFile(
  filePath: string,
  slug: string,
  deps: LayoutDeps,
): Promise<void> {
  const all = await discoverLayouts(deps.appDataDir, deps.getActiveVaultRoot());
  const target = all.find(
    (l) => l.filePath.split("/").pop()!.replace(".layout.md", "") === slug,
  );
  if (!target) return;
  void setLayoutInFile(filePath, slug, target, deps);
}
