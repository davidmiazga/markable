/**
 * folder-icon-store.ts — read / set / remove the `icon:` field in _folder.md.
 *
 * This is the storage half of the folder-icon-assignment feature. It owns the
 * atomic round-trip for the YAML `icon:` key without disturbing other frontmatter
 * keys or the body (EC-8). The value stored is opaque — it may be a catalog
 * iconId (`book`) or an absolute file-system path to a custom SVG
 * (`/Users/dave/glyphs/notion.svg`). Interpretation lives in `folder-icons.ts`.
 *
 * Atomicity is delegated entirely to the Rust `write_file` Tauri command via
 * `bridge.writeFile` (temp-file-swap pattern, per CLAUDE.md NFR-4). No
 * temp-file logic lives here.
 *
 * No raw `invoke()` calls — all I/O goes through bridge.ts (C-4).
 */

import { readFile, readFolderIconMap, writeFile } from "../../lib/bridge";
import {
  parseYamlFrontmatter,
  applyYamlKey,
  removeYamlKey,
  reconstructFile,
} from "./folder-view/yaml-frontmatter";
import type { FileResult } from "../../lib/errors";

/** Filename convention for the per-folder sidecar metadata file. */
const FOLDER_MD_NAME = "_folder.md";

/**
 * Compute the absolute path of a folder's `_folder.md` sidecar.
 *
 * Strips a trailing slash from the folder path before appending the sidecar
 * filename so callers can pass `/v/A` or `/v/A/` interchangeably.
 *
 * @param folderPath - Absolute path of the folder.
 * @returns Absolute path of the folder's `_folder.md` file.
 */
export function folderMdPath(folderPath: string): string {
  // POSIX-style join — matches the rest of the file-browser plugin's path
  // handling (no `path` module to keep the IIFE bundle clean).
  return folderPath.replace(/\/+$/, "") + "/" + FOLDER_MD_NAME;
}

/**
 * Read the `icon:` value from a folder's `_folder.md`, or undefined if:
 *   - the file does not exist (EC-1, EC-6),
 *   - the file has no frontmatter,
 *   - the frontmatter is malformed (no closing `---`, EC-11),
 *   - the `icon` key is absent (EC-2),
 *   - the key is present but the value is empty (EC-5).
 *
 * Never throws. Bridge errors are silenced — the caller (renderer) interprets
 * `undefined` as "no assignment" and falls back to the generic glyph (NFR-1).
 *
 * Quoting: the reader strips a single pair of surrounding double-quotes if
 * present, mirroring the writer's quoting policy (used for path-shaped values
 * with YAML-special characters per EC-22).
 *
 * @param folderPath - Absolute folder path. `_folder.md` is appended.
 * @returns The raw icon string verbatim (catalog id OR absolute path), or undefined.
 */
export async function readFolderIcon(
  folderPath: string,
): Promise<string | undefined> {
  const result = await readFile(folderMdPath(folderPath));
  if (!result.ok) return undefined;

  const parsed = parseYamlFrontmatter(result.value);
  if (!parsed.hasFrontmatter || parsed.malformed) return undefined;

  for (const line of parsed.frontmatterLines) {
    // Three valid prefixes: `icon: <space>`, `icon:\t<tab>`, or the bare `icon:`
    // (which yields an empty value and is therefore treated as unassigned).
    const isIconLine =
      line.startsWith("icon: ") || line.startsWith("icon:\t") || line === "icon:";
    if (!isIconLine) continue;

    const raw = line.slice("icon:".length).trim();
    if (!raw) return undefined;

    // Strip surrounding double-quotes if present (writer quotes path-shaped
    // values to keep YAML well-formed). Escaped `\"` inside is unescaped.
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      return raw.slice(1, -1).replace(/\\"/g, '"');
    }
    return raw;
  }

  return undefined;
}

/**
 * Set or remove the `icon:` field in a folder's `_folder.md`.
 *
 *   - `iconValue === undefined` → remove the key. Other frontmatter keys and
 *     the body are preserved verbatim (EC-7, EC-8).
 *   - `iconValue === string`    → upsert the key. The value is opaque — may be
 *     a catalog iconId or an absolute SVG path (FR-12). Path-shaped values
 *     (containing `/`, `\`, space, `:`, or any YAML-special character) MUST
 *     be quoted by the writer; catalog iconIds are pure kebab-case slugs and
 *     are written unquoted. `applyYamlKey()` (yaml-frontmatter.ts) handles
 *     this — it quotes a value that includes `:`, leading/trailing spaces,
 *     or begins with `---`. **However**, applyYamlKey does NOT quote on the
 *     presence of `/` or `\` alone (those are not YAML-special). For paths
 *     without `:` or surrounding whitespace, applyYamlKey emits them
 *     unquoted, which is still valid YAML — `/Users/dave/icons/x.svg` is a
 *     plain scalar. The reader is tolerant of both quoted and unquoted
 *     scalars (EC-22 test covers a path with `:` which triggers quoting).
 *
 *     When `_folder.md` does not exist, a new file is created with only the
 *     icon field in frontmatter and no body (EC-6).
 *
 *     EC-11 (malformed YAML): when the existing file has an opening `---`
 *     but no closing one, the parser returns `malformed=true` with
 *     `hasFrontmatter=false`. We treat this as "rewrite cleanly" — the new
 *     file gets a fresh well-formed frontmatter with just the icon key, and
 *     the body is dropped (the stray content following the malformed
 *     opening delimiter is not safely recoverable). The Architect's
 *     decision: silent overwrite (DW-10 — a future enhancement can surface
 *     a confirmation toast).
 *
 * Writes are atomic — `bridge.writeFile` calls the Rust `write_file` command
 * which uses the temp-file-swap pattern. The caller does not need to retry.
 *
 * @param folderPath - Absolute folder path. `_folder.md` is appended.
 * @param iconValue  - New value to set (string), or `undefined` to remove.
 * @returns `FileResult<void>` from the write — `ok: true` on success.
 */
export async function setFolderIcon(
  folderPath: string,
  iconValue: string | undefined,
): Promise<FileResult<void>> {
  const path = folderMdPath(folderPath);

  // Read existing content; tolerate ENOENT (EC-6).
  const readResult = await readFile(path);
  const existingContent = readResult.ok ? readResult.value : "";

  // Parse into frontmatter + body. parseYamlFrontmatter() handles all three
  // cases: well-formed, malformed (no closing delim), no frontmatter at all.
  const parsed = parseYamlFrontmatter(existingContent);

  // Start from the parsed state and apply the requested mutation.
  let frontmatterLines = parsed.hasFrontmatter ? parsed.frontmatterLines : [];
  let bodyLines = parsed.bodyLines;

  /*
   * EC-11: when malformed (opening `---` but no closing `---`), parsed
   * returns hasFrontmatter=false and bodyLines = all lines (including the
   * unmatched opening delimiter and the stray body lines). Rewrite cleanly:
   * drop the malformed soup and emit a fresh frontmatter + empty body. The
   * test asserts the resulting file starts with `---\nicon: <id>\n---\n`.
   */
  if (parsed.malformed) {
    frontmatterLines = [];
    // Empty body — a single empty string so reconstructFile yields a
    // trailing newline after the closing `---`.
    bodyLines = [""];
  }

  if (iconValue === undefined) {
    frontmatterLines = removeYamlKey(frontmatterLines, "icon");
  } else {
    frontmatterLines = applyYamlKey(frontmatterLines, "icon", iconValue);
  }

  // Reconstruct: if frontmatter is now empty AND there were no pre-existing
  // body lines (file was absent), reconstructFile returns an empty string —
  // which is the correct "file unchanged from never-existed" state, but we
  // still need to handle the case where the caller created the file just to
  // remove the icon. The behaviour matches reconstructFile's contract: when
  // frontmatter is empty, only the body lines remain.
  const newContent = reconstructFile({
    hasFrontmatter: frontmatterLines.length > 0,
    frontmatterLines,
    bodyLines,
  });

  return writeFile(path, newContent);
}

/**
 * Build a Map<folderPath, iconValue> by batch-reading each `_folder.md`.
 *
 * Delegates the heavy I/O to the Rust `read_folder_icon_map` command (added
 * in step_04). One Tauri round-trip per render pass. Individual file errors
 * are silently coerced to `null` by the Rust side and dropped here so the
 * map only contains real assignments.
 *
 *   - Empty input list → empty Map, no bridge call.
 *   - Bridge error    → empty Map, renderer falls back to generic glyph.
 *   - `null` value    → entry dropped (folder is unassigned).
 *
 * Map keys are **parent directory paths** (the `_folder.md` filename is
 * stripped) so the tree builder can look up a directory node by `node.path`
 * without doing the same string work itself.
 *
 * @param folderMdPaths - Absolute paths of `_folder.md` files to scan.
 * @returns Map<dirPath, rawIconValue>. Raw value may be a catalog iconId OR
 *          an absolute SVG path — interpretation is the renderer's job
 *          (`interpretIconValue` in folder-icons.ts).
 */
export async function buildFolderIconMap(
  folderMdPaths: string[],
): Promise<Map<string, string>> {
  if (folderMdPaths.length === 0) return new Map();

  const result = await readFolderIconMap(folderMdPaths);
  if (!result.ok) return new Map();

  const out = new Map<string, string>();
  for (const [folderMd, iconValue] of result.value) {
    if (!iconValue) continue;
    // Strip trailing "/_folder.md" to get the parent directory path. The
    // separator string is hardcoded because the Rust side always emits
    // POSIX-style paths in the Tauri serde layer (matches the rest of the
    // file-browser plugin's path conventions).
    const sep = folderMd.lastIndexOf("/_folder.md");
    if (sep <= 0) continue;
    out.set(folderMd.slice(0, sep), iconValue);
  }
  return out;
}
