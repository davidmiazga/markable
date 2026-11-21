/**
 * Pure policy for vault HTML dashboard tabs.
 *
 * Path classification, session shape, index projection, and note parsing.
 * No DOM, no Tauri, and no tab manager. Nothing here reads the filesystem.
 */

import { load as loadYaml } from "js-yaml";

/** Final extension, including the dot, or "" when the name has none. */
function fileExtension(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

function fileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function directoryName(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  if (slash <= 0) return slash === 0 ? "/" : ".";
  return filePath.slice(0, slash);
}

/** Absolute-path normalize with `.` and `..`, matching Node `path.resolve` for POSIX paths. */
function normalizeAbsolute(filePath: string): string {
  const parts: string[] = [];
  for (const segment of filePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

function resolvePath(from: string, to?: string): string {
  if (to === undefined || to === "") return normalizeAbsolute(from);
  if (to.startsWith("/")) return normalizeAbsolute(to);
  return normalizeAbsolute(`${from}/${to}`);
}

export interface BridgeIndexEntry {
  path: string;
  name: string;
  title: string;
  tags: string[];
  outboundLinks: string[];
  modified: number;
  size: number;
}

export interface BridgeIndex {
  vaultId: string;
  builtAt: number;
  capped: boolean;
  entries: BridgeIndexEntry[];
}

export interface NoteDocument {
  path: string;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  body: string;
}

export type ClassifiedHref =
  | { action: "html"; path: string }
  | { action: "note"; path: string }
  | { action: "external"; url: string }
  | { action: "ignore" };

export interface SessionFileEntry {
  filePath: string;
  scrollTop: number;
  pinned?: boolean;
  kind?: "editor" | "html";
}

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * True only for a final extension of `.html` or `.htm`, in any case.
 */
export function isHtmlFilePath(filePath: string): boolean {
  return HTML_EXTENSIONS.has(fileExtension(filePath).toLowerCase());
}

/**
 * True for a final extension of `.md` or `.markdown`, in any case.
 */
export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(fileExtension(filePath).toLowerCase());
}

/**
 * True when `filePath` is `root` or a descendant of `root` after resolve/normalize.
 * A sibling whose name only shares a prefix (`/vault` vs `/vault-other`) is outside.
 * A `..` segment that resolves outside the root is outside.
 */
function isInsideRoot(filePath: string, root: string): boolean {
  const resolvedRoot = resolvePath(root);
  const resolvedPath = resolvePath(filePath);
  if (resolvedPath === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith("/")
    ? resolvedRoot
    : resolvedRoot + "/";
  return resolvedPath.startsWith(prefix);
}

/**
 * True when the absolute path is one of the roots or a descendant of one.
 * Empty `rootPaths` is never inside. Does not read the filesystem.
 */
export function isInsideVault(filePath: string, rootPaths: string[]): boolean {
  if (rootPaths.length === 0) return false;
  return rootPaths.some((root) => isInsideRoot(filePath, root));
}

function ignore(): ClassifiedHref {
  return { action: "ignore" };
}

/**
 * Classify a link from an HTML page.
 *
 * `javascript:`, `file:`, `data:`, and any scheme other than `http:` / `https:`
 * are ignored and the target is not returned. `http:` and `https:` keep the
 * href argument unchanged. Relative and root-absolute paths are resolved
 * against the directory of `pagePath` (Node `path.resolve` semantics); a
 * `#fragment` or `?query` is not part of the file path. An `.html`/`.htm`
 * or `.md`/`.markdown` path is actionable when it sits in the vault or in
 * the HTML file's own folder. Does not read the filesystem.
 */
export function classifyHref(
  href: string,
  pagePath: string,
  rootPaths: string[],
): ClassifiedHref {
  const trimmed = href.trim();
  if (!trimmed) return ignore();

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === "http" || name === "https") {
      return { action: "external", url: href };
    }
    return ignore();
  }

  const pathOnly = trimmed.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (!pathOnly) return ignore();

  const resolved = resolvePath(directoryName(pagePath), pathOnly);
  const pageDir = directoryName(pagePath);
  const reachable =
    isInsideVault(resolved, rootPaths) || isInsideVault(resolved, [pageDir]);
  if (isHtmlFilePath(resolved) && reachable) {
    return { action: "html", path: resolved };
  }
  if (isMarkdownPath(resolved) && reachable) {
    return { action: "note", path: resolved };
  }
  return ignore();
}

/**
 * A markdown note the page may read: inside an active vault, or inside the
 * open HTML file's folder. Other paths are refused before any read.
 */
export function noteIsReadable(
  notePath: string,
  pagePath: string,
  rootPaths: string[],
): boolean {
  if (!isMarkdownPath(notePath)) return false;
  const pageDir = directoryName(pagePath);
  return isInsideVault(notePath, rootPaths) || isInsideVault(notePath, [pageDir]);
}

/**
 * Copy the bridge-facing index fields. Extra fields (including per-entry
 * `frontmatter`) are dropped. The input object is not mutated.
 * `null` becomes an empty index.
 */
export function projectBridgeIndex(
  index: {
    vaultId: string;
    builtAt: number;
    capped: boolean;
    entries: BridgeIndexEntry[];
  } | null,
): BridgeIndex {
  if (index === null) {
    return { vaultId: "", builtAt: 0, capped: false, entries: [] };
  }
  return {
    vaultId: index.vaultId,
    builtAt: index.builtAt,
    capped: index.capped,
    entries: index.entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      title: entry.title,
      tags: [...entry.tags],
      outboundLinks: [...entry.outboundLinks],
      modified: entry.modified,
      size: entry.size,
    })),
  };
}

function filenameStem(filePath: string): string {
  const base = fileName(filePath);
  const extension = fileExtension(base);
  if (!extension) return base;
  return base.slice(0, -extension.length);
}

function asFrontmatter(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function tagsFromFrontmatter(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  return [];
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  if (!match) return null;
  const title = match[1].trim();
  return title.length > 0 ? title : null;
}

function stripOneLeadingNewline(value: string): string {
  if (value.startsWith("\r\n")) return value.slice(2);
  if (value.startsWith("\n") || value.startsWith("\r")) return value.slice(1);
  return value;
}

/**
 * Split a leading `---` frontmatter block. No closing delimiter means the
 * whole content is body. The newline that ends the closing delimiter is not
 * part of the body; a further blank line is kept.
 */
function splitFrontMatter(content: string): { yaml: string | null; body: string } {
  const lines = content.split("\n");
  if (!lines[0] || lines[0].replace(/\r$/, "").trim() !== "---") {
    return { yaml: null, body: content };
  }

  let closingLineIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "").trim() === "---") {
      closingLineIndex = i;
      break;
    }
  }
  if (closingLineIndex === -1) return { yaml: null, body: content };

  let offset = 0;
  for (let i = 0; i < closingLineIndex; i++) {
    offset += lines[i].length + 1;
  }
  const closingOffset = offset + lines[closingLineIndex].length;
  const yaml = lines
    .slice(1, closingLineIndex)
    .map((line) => line.replace(/\r$/, ""))
    .join("\n");
  const body = stripOneLeadingNewline(content.slice(closingOffset));
  return { yaml, body };
}

function parseFrontmatterYaml(yamlText: string): Record<string, unknown> {
  if (yamlText.trim() === "") return {};
  try {
    return asFrontmatter(loadYaml(yamlText));
  } catch {
    return {};
  }
}

/**
 * Parse a markdown note's YAML frontmatter (full object) and body.
 * Title comes from a string `title`, else the first `# Heading` in the body,
 * else the filename stem. Never throws.
 */
export function parseNoteFile(path: string, content: string): NoteDocument {
  try {
    const split = splitFrontMatter(content);
    const frontmatter = split.yaml === null ? {} : parseFrontmatterYaml(split.yaml);
    const body = split.body;
    const titleValue = frontmatter.title;
    const heading = firstHeading(body);
    const title =
      typeof titleValue === "string"
        ? titleValue
        : heading ?? filenameStem(path);
    return {
      path,
      title,
      tags: tagsFromFrontmatter(frontmatter.tags),
      frontmatter,
      body,
    };
  } catch {
    return {
      path,
      title: filenameStem(path),
      tags: [],
      frontmatter: {},
      body: content,
    };
  }
}

/**
 * Session row for an HTML dashboard tab. Scroll starts at the top.
 */
export function sessionEntryForHtml(filePath: string, pinned = false): SessionFileEntry {
  return { filePath, scrollTop: 0, pinned, kind: "html" };
}

/**
 * Kind `"html"` is an HTML page. Kind `"editor"` is never an HTML page, even
 * when the path ends in `.html`. A missing kind is an HTML page only when the
 * path is `.html` or `.htm`, so older sessions still restore as pages.
 */
export function isHtmlSessionEntry(entry: { filePath: string; kind?: string }): boolean {
  if (entry.kind === "html") return true;
  if (entry.kind === "editor") return false;
  return isHtmlFilePath(entry.filePath);
}
