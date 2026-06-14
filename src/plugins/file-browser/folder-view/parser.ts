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

import type { FolderViewConfig, FolderSortOrder, FolderLayoutMode, ExtraField } from "./types";

/**
 * The four built-in sort values. Any other value is passed through verbatim (FR-08)
 * as it may be an extra-field key; the table renderer handles unknown values gracefully.
 */
const VALID_SORTS = new Set<string>([
  "name-asc", "name-desc",
  "modified-asc", "modified-desc",
  "author-asc", "author-desc",
  "manual",
]);

/**
 * Set of built-in column identifiers for the folder-table fields: sequence.
 * Any identifier not in this set is treated as a custom frontmatter key.
 * Used by extractFieldsRaw-derived logic in parseFolderMd() (FR-04).
 *
 * The four image built-in identifiers (width, height, date-taken, camera) are
 * included here so they are NOT classified as custom frontmatter keys and do
 * NOT appear in config.extraFields. The enrichment gate in tab.ts uses
 * imageColumnsRequested(config) to detect when image enrichment is needed.
 *
 * Exported so table-renderer.ts and tab.ts can import it for field classification.
 */
export const BUILTIN_FIELDS = new Set([
  "name", "type", "ext", "modified", "tags", "count", "icon",
  "width", "height", "date-taken", "camera",
  "select",
]);

/**
 * Locate the first `select` codeblock in a body string and return its
 * inner YAML lines (between the fences). Returns null when no such
 * codeblock exists.
 *
 * Match rules (locked per AD-2 in `docs/specs/view-modal/00_index.md`):
 *   - Opening fence: a line that starts at column 0 with /^```select(\s|$)/.
 *     The `(\s|$)` group tolerates a width modifier such as
 *     "```select wide"; the modifier is ignored by this extractor.
 *   - Closing fence: a line whose full trimmed content is exactly "```".
 *   - The opening fence line and closing fence line are NOT included.
 *   - Only the FIRST `select` codeblock in the body is considered.
 *   - Unclosed fences return null (treated as "no codeblock present").
 *
 * Never throws. Public so step_01 unit tests can pin the boundary
 * detection logic independently of the projection step in
 * parseFolderMd().
 *
 * @param body - the body string of a `_folder.md` file (post-frontmatter).
 * @returns the body of the first select codeblock, or null when absent.
 */
export function extractSelectCodeblockBody(body: string): string | null {
  if (!body) return null;
  const lines = body.split("\n");
  // Opening fence must start at column 0 — no leading whitespace tolerated.
  // The `(?:\s|$)` allows "```select" alone OR "```select <modifier>".
  const openRe = /^```select(?:\s|$)/;
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;
  // Closing fence: trimmed equals exactly "```". A second "```select" line
  // would match this branch only if its trimmed form is "```" which it is
  // not; the second opener acts as ordinary text inside the first fence.
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "```") {
      return lines.slice(openIdx + 1, i).join("\n");
    }
  }
  return null; // Unclosed fence → treat as no codeblock present.
}

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
 *
 * Length justification: a single-pass state-machine over YAML lines — top-level scalar,
 * nested object-block, plain sequence, and structured-sequence item states are all
 * tightly coupled through the shared currentBlock/blockIsArray/currentItem mutable state.
 * Splitting into sub-functions would require threading 3+ variables across boundaries
 * with no clarity gain over the flat sequential read.
 */
export function parseYamlLines(
  lines: string[],
): Record<string, string | Record<string, string> | (string | Record<string, string>)[]> {
  const result: Record<string, string | Record<string, string> | (string | Record<string, string>)[]> = {};
  let currentBlock: string | null = null;
  // null = block started but no items yet, true = array, false = object
  let blockIsArray: boolean | null = null;
  // Tracks the current structured sequence item (- key: val) being built.
  // Reset when a new top-level key is encountered or a plain string item is found.
  let currentItem: Record<string, string> | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const isIndented = line.length > trimmed.length;

    if (isIndented && currentBlock !== null) {
      if (trimmed.startsWith("- ")) {
        // Sequence item — may be a plain string or the first key of a mapping.
        if (blockIsArray === null || blockIsArray === true) {
          if (blockIsArray === null) {
            result[currentBlock] = [];
            blockIsArray = true;
          }
          const itemText = trimmed.slice(2).trim();
          const itemColonIdx = itemText.indexOf(":");
          if (itemColonIdx !== -1) {
            // Structured item: "- key: value" → start a new mapping object.
            const itemKey = itemText.slice(0, itemColonIdx).trim();
            let itemValue = itemText.slice(itemColonIdx + 1).trim();
            const ic = itemValue.indexOf(" #");
            if (ic !== -1) itemValue = itemValue.slice(0, ic).trim();
            if ((itemValue.startsWith('"') && itemValue.endsWith('"')) ||
                (itemValue.startsWith("'") && itemValue.endsWith("'"))) {
              itemValue = itemValue.slice(1, -1);
            }
            const obj: Record<string, string> = {};
            if (itemKey) obj[itemKey] = itemValue;
            currentItem = obj;
            (result[currentBlock] as (string | Record<string, string>)[]).push(obj);
          } else {
            // Plain string item.
            if (itemText) {
              (result[currentBlock] as (string | Record<string, string>)[]).push(itemText);
            }
            currentItem = null;
          }
        }
        continue;
      }
      // Non-"- " indented line: sub-key of structured item, OR object-block key-value.
      if (currentItem !== null) {
        // This line adds a sub-key to the most recently started structured item.
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        const commentIdx = value.indexOf(" #");
        if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key) currentItem[key] = value;
        continue;
      }
      // Key:value pair in an object block (blockIsArray !== true)
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
    currentItem = null;
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
 * Extract raw extra-fields items from YAML lines at any indentation level.
 *
 * `parseYamlLines` only handles one level of nesting, so `extra-fields:` placed
 * inside a `layout:` block (a common pattern) would lose its array items. This
 * function scans the raw lines independently, finds `extra-fields:` wherever it
 * appears, then collects the items beneath it using indentation comparison.
 *
 * Handles all three item forms:
 *   - status                   → plain string
 *   - status: My Status        → inline key:label
 *   - key: status              → structured (with optional "  label:" continuation)
 *     label: My Status
 *
 * Length justification: three distinct item forms each require their own parse
 * path; the indentation-tracking logic cannot be extracted without threading
 * `blockIndent`, `currentItem`, and the result array through extra parameters.
 */
function extractExtraFieldsRaw(lines: string[]): (string | Record<string, string>)[] {
  // Find the extra-fields: line at any indentation level.
  let startIdx = -1;
  let blockIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("extra-fields:")) continue;
    const afterColon = trimmed.slice("extra-fields:".length).trim();
    const commentStripped = afterColon.startsWith("#") ? "" : afterColon.replace(/ #.*$/, "").trim();
    if (commentStripped !== "") continue; // has an inline value — not a block key
    startIdx = i;
    blockIndent = raw.length - trimmed.length;
    break;
  }
  if (startIdx === -1) return [];

  const result: (string | Record<string, string>)[] = [];
  let currentItem: Record<string, string> | null = null;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd().trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= blockIndent) break; // returned to same or parent indentation level

    if (trimmed.startsWith("- ")) {
      const rest = trimmed.slice(2).trim();
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        // Inline "- fieldname: label" or start of structured "- key: fieldname"
        const k = rest.slice(0, colonIdx).trim();
        let v = rest.slice(colonIdx + 1).trim();
        v = v.replace(/ #.*$/, "").trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        currentItem = { [k]: v };
        result.push(currentItem);
      } else {
        currentItem = null;
        if (rest) result.push(rest);
      }
    } else if (currentItem !== null) {
      // Continuation sub-key for structured items (e.g. "  label: My Status")
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const k = trimmed.slice(0, colonIdx).trim();
        let v = trimmed.slice(colonIdx + 1).trim();
        v = v.replace(/ #.*$/, "").trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        currentItem[k] = v;
      }
    }
  }
  return result;
}

/**
 * Extract raw fields: items from YAML lines at any indentation level.
 *
 * Parallel to extractExtraFieldsRaw() but simpler: fields: items are always
 * plain strings. No structured sub-key (key:/label:) syntax is supported.
 *
 * Algorithm:
 * 1. Find the first line whose trimmed form starts with "fields:" with no
 *    inline value after the colon (same approach as extractExtraFieldsRaw).
 * 2. Collect subsequent more-indented "- item" lines.
 * 3. Strip inline comments (" #...") and surrounding quotes from each item.
 * 4. Skip blank items after stripping.
 * 5. Return the collected string[] (empty array when key is absent or has
 *    no items).
 *
 * @param lines - Raw YAML lines from inside the front-matter block.
 * @returns string[] of plain field identifiers; never null.
 */
function extractFieldsRaw(lines: string[]): string[] {
  // Locate the fields: key at any indentation level.
  let startIdx = -1;
  let blockIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("fields:")) continue;
    const afterColon = trimmed.slice("fields:".length).trim();
    const commentStripped = afterColon.startsWith("#") ? "" : afterColon.replace(/ #.*$/, "").trim();
    if (commentStripped !== "") continue; // inline value — not a block key
    startIdx = i;
    blockIndent = raw.length - trimmed.length;
    break;
  }
  if (startIdx === -1) return [];

  const result: string[] = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd().trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= blockIndent) break; // returned to same or parent indentation

    if (!trimmed.startsWith("- ")) continue; // non-sequence line inside block: skip
    let item = trimmed.slice(2).trim();
    // Strip inline comment: " # ..." anywhere in item, or a leading "#" (pure comment item).
    // A leading "#" means the item was "- # some comment" which strips to empty.
    if (item.startsWith("#")) {
      item = "";
    } else {
      const commentIdx = item.indexOf(" #");
      if (commentIdx !== -1) item = item.slice(0, commentIdx).trim();
    }
    // Strip surrounding single or double quotes (EC-17).
    if (
      (item.startsWith('"') && item.endsWith('"')) ||
      (item.startsWith("'") && item.endsWith("'"))
    ) {
      item = item.slice(1, -1);
    }
    item = item.trim();
    if (item) result.push(item); // EC-11: skip blank items after stripping
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
  raw: Record<string, string | Record<string, string> | (string | Record<string, string>)[]>,
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
    contentAreaOverride: true,
    extraFields: [],
    fields: null,   // null = legacy flag-based column mode (AD-6, EC-01)
    previewPane:   false,
    previewHeight: "80vh",
  };

  try {
    const trimmed = content.trimStart();
    // Holds the YAML block lines (between --- markers), and the body
    // (everything after the closing ---). When no frontmatter is present
    // the YAML block is empty and the entire content becomes the body so
    // the codeblock-overlay path (AD-2) still runs.
    let yamlBlock: string;
    let rawBody: string;

    // Step 1: Check for opening --- marker.
    if (!trimmed.startsWith("---")) {
      // No front-matter — entire content becomes the body so the
      // codeblock-overlay path (AD-2) can still detect a `select`
      // codeblock living at the top of the file (the canonical shape
      // for new `_folder.md` files per AD-5).
      yamlBlock = "";
      rawBody = content;
    } else {
      // Step 2: Find the closing --- after the first line.
      // Search from character 3 onward to skip past the opening ---.
      // The closing delimiter may be "\n---\n" or "\n---" at end-of-string.
      const afterOpen = trimmed.slice(3);
      const closeIdx = afterOpen.indexOf("\n---");
      if (closeIdx === -1) {
        // Unclosed front-matter — treat as malformed, return defaults (EC-05).
        return safeDefaults;
      }
      yamlBlock = afterOpen.slice(0, closeIdx);
      // Everything after "\n---" (4 chars) is the body. May start with a newline.
      rawBody = afterOpen.slice(closeIdx + 4).replace(/^\n/, "");
    }

    // Step 3: Parse the YAML block line by line.
    const rawFm = parseYamlLines(yamlBlock.split("\n"));

    // Step 3.5 (AD-2): Codeblock overlay.
    //
    // When the body contains a `select` codeblock, parse its YAML and let
    // its keys override the frontmatter-derived values. The codeblock
    // represents the most recent user intent (a file with both shapes is
    // mid-migration; the codeblock is canonical per FR-55 / AD-2).
    //
    // The select codeblock uses `display:` for the layout slug; legacy
    // frontmatter uses `layout:`. The overlay maps display → layout so the
    // downstream defaults / validators see a single canonical key.
    //
    // Import boundary note: parser.ts ships inside the file-browser plugin
    // IIFE; `parseSelectBody` (in src/editor/select-widget.ts) lives in the
    // main app bundle. We CANNOT cross-bundle import from a plugin IIFE.
    // Instead we reuse `parseYamlLines` (already in this file) on the
    // codeblock body — that IS the underlying YAML parser
    // `parseSelectBody` uses — and inline the small `display`→`layout`
    // projection here. NFR-10 ("reuse the parser") is satisfied because
    // there is still exactly one YAML parser (`parseYamlLines`).
    const cbBody = extractSelectCodeblockBody(rawBody);
    if (cbBody !== null) {
      const cbParsed = parseYamlLines(cbBody.split("\n"));
      // display: maps to layout. Codeblock display is the new canonical key.
      const cbDisplay =
        typeof cbParsed["display"] === "string"
          ? (cbParsed["display"] as string).trim()
          : "";
      if (cbDisplay) rawFm["layout"] = cbDisplay;
      // path: + sort: + scalar toggles — projected through as-is.
      if (typeof cbParsed["path"] === "string") rawFm["path"] = cbParsed["path"];
      if (typeof cbParsed["sort"] === "string") rawFm["sort"] = cbParsed["sort"];
      // Kebab-case toggles carry through unchanged.
      if (typeof cbParsed["show-modified"] === "string") {
        rawFm["show-modified"] = cbParsed["show-modified"];
      }
      if (typeof cbParsed["show-extensions"] === "string") {
        rawFm["show-extensions"] = cbParsed["show-extensions"];
      }
      if (typeof cbParsed["preview-pane"] === "string") {
        rawFm["preview-pane"] = cbParsed["preview-pane"];
      }
      if (typeof cbParsed["content-width"] === "string") {
        rawFm["content-width"] = cbParsed["content-width"];
      }
      // Other scalar passthroughs the renderer consumes.
      if (typeof cbParsed["show-tags"] === "string") {
        rawFm["show-tags"] = cbParsed["show-tags"];
      }
      if (typeof cbParsed["show-count"] === "string") {
        rawFm["show-count"] = cbParsed["show-count"];
      }
      if (typeof cbParsed["group-by"] === "string") {
        rawFm["group-by"] = cbParsed["group-by"];
      }
      if (typeof cbParsed["kanban-field"] === "string") {
        rawFm["kanban-field"] = cbParsed["kanban-field"];
      }
      if (typeof cbParsed["card-width"] === "string") {
        rawFm["card-width"] = cbParsed["card-width"];
      }
      if (typeof cbParsed["aspect-ratio"] === "string") {
        rawFm["aspect-ratio"] = cbParsed["aspect-ratio"];
      }
      if (typeof cbParsed["fit"] === "string") {
        rawFm["fit"] = cbParsed["fit"];
      }
      // Array passthroughs (order, kanban-order, where, fields) override
      // the corresponding frontmatter sequence shape used by the
      // downstream extractors.
      if (Array.isArray(cbParsed["order"])) rawFm["order"] = cbParsed["order"];
      if (Array.isArray(cbParsed["kanban-order"])) {
        rawFm["kanban-order"] = cbParsed["kanban-order"];
      }
      if (Array.isArray(cbParsed["where"])) rawFm["where"] = cbParsed["where"];
      if (Array.isArray(cbParsed["fields"])) rawFm["fields"] = cbParsed["fields"];
    }

    // Extract top-level sequence fields before normalization (FVB-05).
    const rawExclude = rawFm["exclude"];
    // Filter to string items only — structured items are skipped for the exclude list.
    const exclude: string[] = Array.isArray(rawExclude)
      ? (rawExclude as (string | Record<string, string>)[]).filter((x): x is string => typeof x === "string")
      : [];

    // kanban-order: string sequence for explicit kanban column ordering.
    const rawKanbanOrder = rawFm["kanban-order"];
    const kanbanOrder: string[] | undefined = Array.isArray(rawKanbanOrder)
      ? (rawKanbanOrder as (string | Record<string, string>)[]).filter((x): x is string => typeof x === "string")
      : undefined;

    // order: string sequence for the per-file manual sort (drag/drop result).
    // Effective when sort === "manual"; ignored otherwise. Same shape as
    // kanban-order: a flat list of strings (file paths in this case).
    const rawOrder = rawFm["order"];
    const order: string[] | undefined = Array.isArray(rawOrder)
      ? (rawOrder as (string | Record<string, string>)[]).filter((x): x is string => typeof x === "string")
      : undefined;

    // Extract extra-fields sequence (FR-06). Uses a dedicated pre-pass so the
    // field works whether it appears at top-level or nested under layout:.
    const rawExtraFields = extractExtraFieldsRaw(yamlBlock.split("\n"));
    const extraFields: ExtraField[] = [];
    for (const item of rawExtraFields) {
      if (typeof item === "string") {
        const key = item.trim();
        if (!key) continue;
        extraFields.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1) });
      } else if (item && typeof item === "object") {
        if ("key" in item) {
          // Structured form: "- key: status\n  label: My Status"
          const key = (item["key"] ?? "").trim();
          if (!key) continue;
          const rawLabel = (item["label"] ?? "").trim();
          extraFields.push({ key, label: rawLabel || key.charAt(0).toUpperCase() + key.slice(1) });
        } else {
          // Inline form: "- fieldname: My Label"
          const firstKey = Object.keys(item)[0];
          if (!firstKey) continue;
          const rawLabel = (item[firstKey] ?? "").trim();
          extraFields.push({ key: firstKey, label: rawLabel || firstKey.charAt(0).toUpperCase() + firstKey.slice(1) });
        }
      }
    }

    // Extract fields: sequence (FR-05). Uses same pre-pass approach as
    // extractExtraFieldsRaw so it works whether fields: is at top level
    // or nested under layout:.
    const rawFields = extractFieldsRaw(yamlBlock.split("\n"));

    // Normalize to flat string record for all remaining fields.
    const fm = normalizeFm(rawFm);

    // Step 4: Apply defaults and validate each field.

    // layout: lowercased; empty string when absent (triggers FR-12 fallback).
    const layout = (fm["layout"] ?? "").trim().toLowerCase();

    // title: use YAML field if non-empty, otherwise the folder's directory name.
    const title = (fm["title"] ?? "").trim() || folderName;

    // sort: if a known builtin, use it directly. If absent (empty string), default to
    // "name-asc". If an unknown value, pass it through verbatim — it may be an
    // extra-field key; the renderer (table-renderer.ts) handles unknown values.
    const sortRaw = (fm["sort"] ?? "").trim();
    const sort: FolderSortOrder = sortRaw === ""
      ? "name-asc"
      : VALID_SORTS.has(sortRaw)
        ? (sortRaw as FolderSortOrder)
        : sortRaw;

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

    // contentAreaOverride: only explicit "false" disables full-width mode.
    const contentAreaOverride = (fm["content-area-override"] ?? "true") !== "false";

    // preview-pane: only explicit "true" enables.
    const previewPane = (fm["preview-pane"] ?? "false").trim().toLowerCase() === "true";

    // preview-height: CSS height value for the preview pane. Default "80vh".
    const rawPreviewHeight = (fm["preview-height"] ?? "80vh").trim();
    const previewHeight = rawPreviewHeight || "80vh";

    // cover: relative path to a cover image; absent when not declared.
    const coverRaw = (fm["cover"] ?? "").trim();
    const cover = coverRaw || undefined;

    // icon: emoji or relative path; absent when not declared.
    const iconRaw = (fm["icon"] ?? "").trim();
    const icon = iconRaw || undefined;

    // kanban-field: YAML key used to group columns in folder-kanban layout.
    const kanbanFieldRaw = (fm["kanban-field"] ?? "").trim();
    const kanbanField = kanbanFieldRaw || undefined;

    // Populate config.fields and conditionally derive extraFields from it (FR-06).
    // When fields: is present and non-empty, config.extraFields is derived from
    // the non-builtin items in fields: so the enrichment guard in tab.ts
    // (config.extraFields.length > 0) continues to work without modification (RDD-02).
    const fields: string[] | null =
      rawFields.length > 0 ? rawFields : null; // EC-01, FR-16: empty = null

    let resolvedExtraFields = extraFields; // default: from extra-fields: sequence
    if (fields !== null) {
      // When fields: is declared, derive extraFields from the non-builtin items
      // so tab.ts enrichment fires correctly for custom columns (AC-10 / EC-07).
      resolvedExtraFields = fields
        .filter(f => !BUILTIN_FIELDS.has(f))
        .map(f => ({ key: f, label: f.charAt(0).toUpperCase() + f.slice(1) }));
    }

    // When kanban-field is set, ensure the field key is in extraFields so the
    // enrichment phase in tab.ts reads frontmatter values into card.meta.
    if (kanbanField && !resolvedExtraFields.some(f => f.key === kanbanField)) {
      resolvedExtraFields = [
        ...resolvedExtraFields,
        { key: kanbanField, label: kanbanField.charAt(0).toUpperCase() + kanbanField.slice(1) },
      ];
    }

    return {
      layout, title, sort, cardWidth, layoutMode, showModified, body,
      aspectRatio, fit, minHeight, maxHeight,
      showName, showPreview, showExtensions, showFolders, showFiles,
      foldersTitle, filesTitle, showTags, showCount, exclude,
      contentAreaOverride, extraFields: resolvedExtraFields, fields,
      previewPane, previewHeight,
      ...(cover       !== undefined ? { cover }       : {}),
      ...(icon        !== undefined ? { icon  }       : {}),
      ...(kanbanField !== undefined ? { kanbanField } : {}),
      ...(kanbanOrder !== undefined ? { kanbanOrder } : {}),
      ...(order       !== undefined ? { order }       : {}),
    };
  } catch {
    // Catch-all for any unexpected parse error (EC-05 guard).
    return safeDefaults;
  }
}
