/**
 * codeblock-writer.ts — atomic writer for `_folder.md` in the new
 * codeblock shape, with migration-on-write for legacy frontmatter.
 *
 * The Unified View Modal (and the Collections writer that uses the same
 * primitives) call `writeFolderMdCodeblock(folderPath, state)` whenever
 * the user mutates folder-view configuration. This module composes the
 * file content and dispatches a single atomic write through the bridge.
 *
 * Migration-on-write contract (AD-4 / AD-5, FR-60 / FR-61 / FR-63):
 *
 *   - Folder-view-config keys carried in legacy frontmatter are stripped
 *     (the exhaustive list is `FOLDER_VIEW_CONFIG_KEYS`).
 *   - Non-folder-view keys (e.g. `icon: book` from folder-icon-assignment,
 *     `displayName: ...`) are preserved byte-for-byte.
 *   - The new `select` codeblock is placed at the TOP of the body so the
 *     read path (parser.ts step_01) finds it on first scan.
 *   - Any pre-existing `select` codeblock in the body is removed first
 *     so we replace rather than duplicate.
 *   - One temp-file-swap via the bridge's `writeFile`. No separate
 *     migration write.
 *
 * @module folder-view/codeblock-writer
 */

import type { FileResult } from "../../../lib/errors";
import { readFile, writeFile } from "../../../lib/bridge";
import {
  parseYamlFrontmatter,
  removeYamlKey,
  reconstructFile,
} from "./yaml-frontmatter";
import {
  buildSelectFenceFromState,
  type SelectFormState,
} from "../../../lib/select-builder";

/** File name of the per-folder metadata file. */
const FOLDER_MD_NAME = "_folder.md";

/**
 * The complete set of YAML frontmatter keys this feature owns. Stripped
 * during migration-on-write so they cannot drift out of sync with the
 * codeblock. Locked in AD-5 of `docs/specs/view-modal/00_index.md`.
 *
 * `type` is included so `type: collection` legacy folders (EC-20)
 * migrate cleanly in the same atomic write.
 *
 * `icon`, `displayName`, and any other keys NOT in this list survive
 * migration verbatim (EC-19, folder-icon-assignment contract).
 */
export const FOLDER_VIEW_CONFIG_KEYS: readonly string[] = [
  "layout",
  "sort",
  "show-modified",
  "show-extensions",
  "show-tags",
  "show-count",
  "preview-pane",
  "preview-height",
  "content-width",
  "card-width",
  "layout-mode",
  "aspect-ratio",
  "fit",
  "min-height",
  "max-height",
  "show-name",
  "show-folders",
  "show-files",
  "folders-title",
  "files-title",
  "content-area-override",
  "extra-fields",
  "fields",
  "exclude",
  "kanban-field",
  "kanban-order",
  "order",
  "group-by",
  "where",
  "cover",
  "type",
];

/**
 * Build the absolute path of the `_folder.md` for a folder.
 *
 * Normalises trailing slashes so `/vault/Foo/` and `/vault/Foo` both
 * map to `/vault/Foo/_folder.md`.
 */
function folderMdPath(folderPath: string): string {
  return folderPath.replace(/\/+$/, "") + "/" + FOLDER_MD_NAME;
}

/**
 * Locate the first `select` codeblock in a body and return its
 * line-range. Returns null when no codeblock or no closing fence.
 *
 * Duplicates the boundary-detection logic of
 * `extractSelectCodeblockBody` (parser.ts) intentionally — Phase 1
 * keeps the two helpers co-located with their respective modules; a
 * shared utility may emerge in Phase 2 if drift becomes a problem.
 */
function findFirstSelectFenceRange(
  lines: string[],
): { openIdx: number; closeIdx: number } | null {
  const openRe = /^```select(?:\s|$)/;
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "```") {
      return { openIdx, closeIdx: i };
    }
  }
  return null;
}

/**
 * Remove the first `select` codeblock (inclusive of its fence lines)
 * from a body. Collapses a redundant blank line at the seam so we
 * don't accumulate vertical whitespace across migrations.
 */
function stripFirstSelectCodeblock(body: string): string {
  const lines = body.split("\n");
  const range = findFirstSelectFenceRange(lines);
  if (range === null) return body;
  const before = lines.slice(0, range.openIdx);
  const after = lines.slice(range.closeIdx + 1);
  // If `before` ends with a blank AND `after` starts with a blank, collapse.
  if (
    after.length > 0 &&
    after[0] === "" &&
    (before.length === 0 || before[before.length - 1] === "")
  ) {
    after.shift();
  }
  return [...before, ...after].join("\n");
}

/**
 * Compose the final `_folder.md` content from an existing file (or
 * null for fresh-create) and the modal's `SelectFormState`. Pure
 * function — no I/O. Used by `writeFolderMdCodeblock` and unit tests.
 *
 * @param existingContent - Existing file content, or null when the
 *                          file does not exist yet.
 * @param state           - The modal's current form state.
 * @returns The complete file content to write.
 */
export function composeFolderMdCodeblockContent(
  existingContent: string | null,
  state: SelectFormState,
): string {
  // `buildSelectFenceFromState` returns the codeblock WITH its fence
  // markers; we treat it as the single source of truth for codeblock
  // body shape (one parser, one emitter, no drift).
  const fence = buildSelectFenceFromState(state);

  // Fresh create — no existing file, no frontmatter, no body.
  // Shape: "```select\n...\n```\n" (trailing newline so the file ends cleanly).
  if (existingContent == null) {
    return fence + "\n";
  }

  const parsed = parseYamlFrontmatter(existingContent);

  // Strip folder-view-config keys from frontmatter. Other keys (icon,
  // displayName, future feature keys) survive.
  let fmLines = parsed.frontmatterLines;
  for (const key of FOLDER_VIEW_CONFIG_KEYS) {
    fmLines = removeYamlKey(fmLines, key);
  }

  // Strip any existing select codeblock from the body. We're about to
  // place the new one at the top, and we must not duplicate.
  const bodyText = parsed.bodyLines.join("\n");
  const strippedBody = stripFirstSelectCodeblock(bodyText);
  const strippedBodyLines = strippedBody.split("\n");

  // Compose the new body:
  //   - Frontmatter preserved (or stripped if empty) → reconstructFile handles both.
  //   - Codeblock at the top of the body.
  //   - Blank line, then any retained body content below.
  // The blank line between `---` and the fence is required (AD-5)
  // because some markdown parsers treat an adjacent fence as part of
  // the frontmatter close block.
  const fenceLines = fence.split("\n");
  // Drop trailing empty entries from the stripped body so reconstructFile
  // does not emit dangling blank lines. We DO retain a single trailing
  // newline by appending "" at the end of bodyLines so the file ends
  // with a newline byte after reconstructFile joins on "\n".
  while (
    strippedBodyLines.length > 0 &&
    strippedBodyLines[strippedBodyLines.length - 1] === ""
  ) {
    strippedBodyLines.pop();
  }

  const newBodyLines: string[] =
    strippedBodyLines.length > 0
      ? [...fenceLines, "", ...strippedBodyLines, ""]
      : [...fenceLines, ""];

  // When the frontmatter survives, we need a blank line BEFORE the
  // codeblock too (per AD-5). reconstructFile inserts "\n---\n" after
  // the frontmatter block, so the first body line is the next line
  // after `---`. We prepend a blank line so the visual is:
  //   ---
  //   icon: book
  //   ---
  //   (blank)
  //   ```select
  //   ...
  //   ```
  const finalBodyLines =
    fmLines.length > 0 ? ["", ...newBodyLines] : newBodyLines;

  return reconstructFile({
    hasFrontmatter: parsed.hasFrontmatter,
    frontmatterLines: fmLines,
    bodyLines: finalBodyLines,
  });
}

/**
 * Atomic write of a folder's `_folder.md` in codeblock shape. Reads the
 * existing file (if any), composes new content with migration applied,
 * dispatches a single bridge-level write (temp-file-swap).
 *
 * FR-51: atomic; FR-61: single write; EC-8 / EC-19 / EC-20: migration
 * preserves unrelated keys and strips both legacy `layout:` and legacy
 * `type: collection`.
 *
 * The caller (the modal) is responsible for opening the folder-view tab
 * after the write succeeds; this writer does no tab management.
 *
 * @param folderPath - Vault-relative folder path (e.g. `/vault/Foo`).
 * @param state      - The modal's `SelectFormState` snapshot at submit.
 * @returns FileResult<void> from the bridge.
 */
export async function writeFolderMdCodeblock(
  folderPath: string,
  state: SelectFormState,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(folderPath);
  // Read the existing file. A `NotFound` result means we're in the
  // fresh-create path — pass null to the composer.
  const readRes = await readFile(absPath);
  const existing = readRes.ok ? readRes.value : null;
  const newContent = composeFolderMdCodeblockContent(existing, state);
  return writeFile(absPath, newContent);
}
