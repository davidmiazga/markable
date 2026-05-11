/**
 * parser.ts — YAML front-matter and body parser for _folder.md files.
 *
 * Implements parseFolderMd(), which reads the YAML front-matter block from
 * a _folder.md file's content string and returns a fully validated
 * FolderViewConfig with safe defaults applied.
 *
 * Design decisions (from 00_index.md AD-4):
 * - Reuses the line-by-line YAML parse pattern from layout-manager.ts.
 * - No new npm dependencies (NFR-04).
 * - Never throws (NFR-06) — all errors return safe defaults.
 * - Unknown YAML fields are silently ignored (FR-14).
 *
 * @module folder-view/parser
 */

import type { FolderViewConfig, FolderSortOrder, FolderLayoutMode } from "./types";

/** Valid sort values. Anything else defaults to "name-asc" (EC-12). */
const VALID_SORTS = new Set<string>(["name-asc", "name-desc", "modified-asc", "modified-desc"]);

/**
 * Parse an aspect-ratio YAML value into a CSS-ready string.
 *
 * Accepts: "W:H", "W/H", plain positive number, or the special token "original".
 * Invalid values fall back to "1/1".
 */
function parseAspectRatio(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "original") return "original";
  // "16:9" → "16/9", "4:3" → "4/3"
  const withSlash = s.replace(":", "/");
  if (/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(withSlash)) return withSlash;
  // Plain positive number, e.g. "1.5" (treated as "1.5/1" by CSS)
  if (/^\d+(\.\d+)?$/.test(s) && parseFloat(s) > 0) return s;
  return "1/1";
}

/**
 * Parse a fit YAML value for CSS background-size.
 *
 * Accepts any non-empty string that does not contain CSS injection vectors
 * ("url(" or ";"). Invalid values fall back to "cover".
 */
function parseFit(raw: string): string {
  const s = raw.trim();
  if (!s || s.includes("url(") || s.includes(";")) return "cover";
  return s;
}

/**
 * Parse raw YAML lines (already stripped of the --- delimiters) into a
 * flat-or-nested string record.
 *
 * Rules (mirroring layout-manager.ts pattern, AD-4):
 * - Empty lines and comment lines (starting with #) are skipped.
 * - Inline comments (" #…") are stripped from values.
 * - Surrounding single or double quotes are stripped from values.
 * - A top-level key with no value (e.g. "layout:") starts a block;
 *   subsequent indented key:value lines are collected as its sub-keys.
 * - Subsequent indented "- item" lines are collected as a string[] (YAML sequence).
 *
 * @param lines - Individual lines from inside the YAML block (no --- markers).
 * @returns A key→value record; block values are key→string records or string[].
 */
function parseYamlLines(
  lines: string[],
): Record<string, string | Record<string, string> | string[]> {
  const result: Record<string, string | Record<string, string> | string[]> = {};
  let currentBlock: string | null = null;
  // null = block started but no items yet, true = array, false = object
  let blockIsArray: boolean | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const isIndented = line.length > trimmed.length;

    if (isIndented && currentBlock !== null) {
      if (trimmed.startsWith("- ")) {
        // Sequence item
        if (blockIsArray === null || blockIsArray === true) {
          if (blockIsArray === null) {
            result[currentBlock] = [];
            blockIsArray = true;
          }
          const item = trimmed.slice(2).trim();
          if (item) (result[currentBlock] as string[]).push(item);
        }
        continue;
      }
      // Key:value pair in an object block
      if (blockIsArray !== true) {
        if (blockIsArray === null) {
          result[currentBlock] = {};
          blockIsArray = false;
        }
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        const commentIdx = value.indexOf(" #");
        if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!key) continue;
        (result[currentBlock] as Record<string, string>)[key] = value;
      }
      continue;
    }

    // Top-level line — reset block state.
    currentBlock = null;
    blockIsArray = null;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;

    if (value === "") {
      currentBlock = key;
      // Lazy-initialize: wait for first indented line to determine array or object.
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Normalize a parsed front-matter record: if the `layout` field is a nested
 * block (new format), flatten its sub-keys to the top level.
 *
 * The nested format maps `mode` → `layout-mode` so the rest of the parser
 * can use a single unified key name regardless of format.
 *
 * Array values (YAML sequences, e.g. `exclude:`) are skipped here and
 * extracted directly by the caller before normalization.
 *
 * Backwards compatible: flat string `layout` fields pass through unchanged.
 */
function normalizeFm(
  raw: Record<string, string | Record<string, string> | string[]>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      flat[k] = v;
    } else if (Array.isArray(v)) {
      // Array values (sequences like exclude:) are handled by the caller.
    } else if (k === "layout") {
      flat["layout"] = String((v as Record<string, string>)["type"] ?? "").trim();
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk === "type") continue;
        flat[sk === "mode" ? "layout-mode" : sk] = String(sv);
      }
    }
    // Other nested object blocks are ignored.
  }
  return flat;
}

/**
 * Parse the content of a _folder.md file into a validated FolderViewConfig.
 *
 * This function never throws (NFR-06). Any parse error or malformed input
 * returns safe defaults — an empty layout string triggers the FR-12 fallback.
 *
 * Algorithm:
 * 1. Detect the opening --- marker. If absent, return defaults with body = content.
 * 2. Find the closing --- and extract the YAML block and body text.
 * 3. Parse YAML lines using parseYamlLines().
 * 4. Apply defaults and clamp/validate each field.
 *
 * @param content    - Raw string content of the _folder.md file.
 * @param folderName - The last path segment of the containing folder (used as
 *                     default tab title when no `title:` YAML field is present).
 * @returns A fully validated FolderViewConfig with all fields guaranteed present.
 */
export function parseFolderMd(content: string, folderName: string): FolderViewConfig {
  // The safe default object returned on any error path (EC-04, EC-05, NFR-06).
  const safeDefaults: FolderViewConfig = {
    layout: "",
    title: folderName,
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
  };

  try {
    const trimmed = content.trimStart();

    // Step 1: Check for opening --- marker.
    if (!trimmed.startsWith("---")) {
      // No front-matter — treat the entire content as the body (EC-04).
      return { ...safeDefaults, body: content.trim() };
    }

    // Step 2: Find the closing --- after the first line.
    // We search from character 3 onward to skip past the opening ---.
    // The closing delimiter may be "\n---\n" or "\n---" at end-of-string.
    const afterOpen = trimmed.slice(3);
    const closeIdx = afterOpen.indexOf("\n---");
    if (closeIdx === -1) {
      // Unclosed front-matter — treat as malformed, return defaults (EC-05).
      return safeDefaults;
    }

    const yamlBlock = afterOpen.slice(0, closeIdx);
    // Everything after "\n---" (4 chars) is the body. May start with a newline.
    const rawBody = afterOpen.slice(closeIdx + 4).replace(/^\n/, "");

    // Step 3: Parse the YAML block line by line.
    const rawFm = parseYamlLines(yamlBlock.split("\n"));

    // Extract top-level sequence fields before normalization (FVB-05).
    const rawExclude = rawFm["exclude"];
    const exclude: string[] = Array.isArray(rawExclude) ? (rawExclude as string[]) : [];

    // Normalize to flat string record for all remaining fields.
    const fm = normalizeFm(rawFm);

    // Step 4: Apply defaults and validate each field.

    // layout: lowercased; empty string when absent (triggers FR-12 fallback).
    const layout = (fm["layout"] ?? "").trim().toLowerCase();

    // title: use YAML field if non-empty, otherwise the folder's directory name.
    const title = (fm["title"] ?? "").trim() || folderName;

    // sort: validate against allowed values; default to "name-asc" for unknowns (EC-12).
    const sortRaw = (fm["sort"] ?? "").trim();
    const sort: FolderSortOrder = VALID_SORTS.has(sortRaw)
      ? (sortRaw as FolderSortOrder)
      : "name-asc";

    // card-width: minimum card width in px; clamped [40, 600].
    const cardWidthRaw = parseInt(String(fm["card-width"] ?? "160"), 10);
    const cardWidth = isNaN(cardWidthRaw) ? 160 : Math.min(600, Math.max(40, cardWidthRaw));

    // layout-mode: "grid" (default) or "flex".
    const layoutModeRaw = (fm["layout-mode"] ?? "").trim().toLowerCase();
    const layoutMode: FolderLayoutMode = layoutModeRaw === "flex" ? "flex" : "grid";

    // show-modified: only explicit "false" disables it; default true.
    const showModified = (fm["show-modified"] ?? "true") !== "false";

    // aspect-ratio: parse into CSS-ready string; "original" means no fixed ratio.
    const aspectRatio = parseAspectRatio(fm["aspect-ratio"] ?? "1/1");

    // fit: CSS background-size value for image previews.
    const fit = parseFit(fm["fit"] ?? "cover");

    // min-height / max-height: integer pixels clamped to [20, 400]; swap if inverted.
    const minRaw = parseInt(String(fm["min-height"] ?? "40"), 10);
    const maxRaw = parseInt(String(fm["max-height"] ?? "200"), 10);
    const minClamped = isNaN(minRaw) ? 40 : Math.min(400, Math.max(20, minRaw));
    const maxClamped = isNaN(maxRaw) ? 200 : Math.min(400, Math.max(20, maxRaw));
    const minHeight = Math.min(minClamped, maxClamped);
    const maxHeight = Math.max(minClamped, maxClamped);

    const body = rawBody.trim();

    // showName: only explicit "false" disables it.
    const showName = (fm["show-name"] ?? "true") !== "false";

    // showPreview: only explicit "none" disables it (FVB-04).
    const showPreview = (fm["card-preview"] ?? "full").trim().toLowerCase() !== "none";

    // showExtensions: only explicit "false" disables (FVB-06).
    const showExtensions = (fm["show-extensions"] ?? "true") !== "false";

    // showFolders / showFiles: only explicit "false" disables (FVB-07).
    const showFolders = (fm["show-folders"] ?? "true") !== "false";
    const showFiles  = (fm["show-files"]   ?? "true") !== "false";

    // foldersTitle / filesTitle: use YAML value if non-empty (FVB-08).
    const foldersTitle = (fm["folders-title"] ?? "Folders").trim() || "Folders";
    const filesTitle   = (fm["files-title"]   ?? "").trim();

    // showTags: only explicit "true" enables (FVB-01).
    const showTags = (fm["show-tags"] ?? "false").trim().toLowerCase() === "true";

    // showCount: only explicit "true" enables (FVB-09).
    const showCount = (fm["show-count"] ?? "false").trim().toLowerCase() === "true";

    return {
      layout, title, sort, cardWidth, layoutMode, showModified, body,
      aspectRatio, fit, minHeight, maxHeight,
      showName, showPreview, showExtensions, showFolders, showFiles,
      foldersTitle, filesTitle, showTags, showCount, exclude,
    };
  } catch {
    // Catch-all for any unexpected parse error (EC-05 guard).
    return safeDefaults;
  }
}
