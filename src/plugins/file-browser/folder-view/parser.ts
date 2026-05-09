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

import type { FolderViewConfig, FolderSortOrder } from "./types";

/** Valid sort values. Anything else defaults to "name-asc" (EC-12). */
const VALID_SORTS = new Set<string>(["name-asc", "name-desc", "modified-asc", "modified-desc"]);

/**
 * Parse raw YAML lines (already stripped of the --- delimiters) into a
 * plain string record.
 *
 * Rules (mirroring layout-manager.ts pattern, AD-4):
 * - Empty lines and comment lines (starting with #) are skipped.
 * - Each line is split on the first colon; key is the left part, value is
 *   the right part, both trimmed.
 * - Surrounding single or double quotes are stripped from values.
 *
 * @param lines - Individual lines from inside the YAML block (no --- markers).
 * @returns A key→value record of the parsed YAML fields.
 */
function parseYamlLines(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes so `title: "My Title"` and `title: My Title` both work.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
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
    columns: 3,
    showModified: true,
    body: "",
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
    const fm = parseYamlLines(yamlBlock.split("\n"));

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

    // columns: parse as integer, clamp to [2, 6], default 3 (EC-11).
    const colRaw = parseInt(String(fm["columns"] ?? "3"), 10);
    const columns = isNaN(colRaw) ? 3 : Math.min(6, Math.max(2, colRaw));

    // show-modified: only explicit "false" disables it; default true.
    const showModified = (fm["show-modified"] ?? "true") !== "false";

    const body = rawBody.trim();

    return { layout, title, sort, columns, showModified, body };
  } catch {
    // Catch-all for any unexpected parse error (EC-05 guard).
    return safeDefaults;
  }
}
