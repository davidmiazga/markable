/**
 * composite.ts — generate the content-view companion file for a Stack
 * (and later Chapter / Book).
 *
 * Each container folder has TWO views in the renderer:
 *   - File view: icon tiles (the current Stack panel).
 *   - Content view: a single rendered markdown file whose body is the
 *     concatenated content of all child notes in `order:` sequence,
 *     separated by a horizontal rule.
 *
 * The composite file lives INSIDE the container folder and is named
 * after the folder (e.g. `Stack 01/Stack 01.md`). It carries
 * `composite: true` in its YAML frontmatter so:
 *   1. The file view's children-listing filter can drop it (it must
 *      not appear as a tile alongside the source notes).
 *   2. A future reader can tell "this file is auto-generated; user
 *      edits will be clobbered on next regen."
 *
 * Regeneration trigger: lazy on read. The toggle to content view in
 * the panel header calls `regenerateStackComposite`, which composes
 * the new body from the current child notes and atomically writes the
 * composite file. Between content-view opens, the on-disk composite
 * may be stale — that's accepted (per the locked design).
 *
 * @module collections/composite
 */

import * as bridge from "../../../lib/bridge";
import * as store from "./store";

/** YAML frontmatter key identifying an auto-generated composite file. */
export const COMPOSITE_FRONTMATTER_KEY = "composite";

/** Separator between concatenated child note bodies. */
const COMPOSITE_DELIMITER = "\n\n---\n\n";

/** Stable filename for a container's composite file. */
export function compositeFilename(containerFolderName: string): string {
  return `${containerFolderName}.md`;
}

/**
 * Inspect a `.md` file's content and return true if it carries the
 * `composite: true` frontmatter marker. Returns false on any parse
 * failure — the file view fails OPEN (shows the file as a tile)
 * rather than mistakenly hiding a real user note.
 */
export function isCompositeFile(content: string): boolean {
  // Cheap frontmatter scan — we only need to detect a top-level
  // `composite: true` line inside the opening `---` block. Avoids
  // dragging in a full YAML parser for this hot path.
  if (!content.startsWith("---")) return false;
  const close = content.indexOf("\n---", 3);
  if (close < 0) return false;
  const block = content.slice(3, close);
  // Match `composite:` followed by `true` (case-insensitive) on its
  // own line. Permissive on whitespace and quoting.
  return /^\s*composite\s*:\s*(?:true|"true"|'true')\s*$/im.test(block);
}

/**
 * Strip the YAML frontmatter block from a `.md` file's raw content,
 * returning just the body. Used when concatenating child notes — the
 * composite owns its OWN frontmatter; child frontmatter is dropped
 * from the inner content (per the locked design).
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const close = content.indexOf("\n---", 3);
  if (close < 0) return content;
  // Body starts after `\n---\n` (5 chars) OR `\n---` at EOF (4 chars).
  const afterClose = close + 4;
  if (content[afterClose] === "\n") return content.slice(afterClose + 1);
  return content.slice(afterClose);
}

/**
 * Build the composite body for a Stack — concatenated child note
 * bodies in `order:` sequence (canonical first, references appended).
 *
 * Frontmatter from child notes is stripped. Broken references render
 * as an italic `_(missing: <path>)_` placeholder so the composite
 * stays a complete document even when one child is missing.
 */
async function buildStackCompositeBody(
  stackPath: string,
): Promise<string> {
  const stackMeta = await store.readStack(stackPath);
  if (!stackMeta.ok) return "";

  const compositeName = compositeFilename(folderBasename(stackPath));
  const pieces: string[] = [];

  // Canonical children (in `order:` sequence). Skip the composite
  // file itself so we don't recursively embed it.
  for (const noteFilename of stackMeta.value.order) {
    if (noteFilename === compositeName) continue;
    const notePath = `${stackPath.replace(/\/+$/, "")}/${noteFilename}`;
    const fileRes = await bridge.readFile(notePath);
    if (!fileRes.ok) {
      pieces.push(`_(missing: ${noteFilename})_`);
      continue;
    }
    pieces.push(stripFrontmatter(fileRes.value).trim());
  }

  // References appended after canonical children, in declared order.
  for (const refRel of stackMeta.value.references) {
    const refRes = await bridge.readFile(refRel);
    if (!refRes.ok) {
      pieces.push(`_(missing: ${refRel})_`);
      continue;
    }
    pieces.push(stripFrontmatter(refRes.value).trim());
  }

  return pieces.filter((p) => p.length > 0).join(COMPOSITE_DELIMITER);
}

/**
 * Compose the full composite file content (frontmatter + body) and
 * atomically write it to disk. Returns the absolute path of the
 * composite file on success.
 *
 * Lazy regeneration: callers invoke this only when the user toggles
 * to the content view. Between toggles, the on-disk composite may be
 * stale; the next toggle re-reads child notes and overwrites.
 */
export async function regenerateStackComposite(
  stackPath: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const folderName = folderBasename(stackPath);
  const compositePath = `${stackPath.replace(/\/+$/, "")}/${compositeFilename(folderName)}`;
  const body = await buildStackCompositeBody(stackPath);
  // Composite frontmatter carries the marker + a generated-at note so
  // a curious user opening the file in Finder sees what it is.
  const content =
    `---\n` +
    `${COMPOSITE_FRONTMATTER_KEY}: true\n` +
    `generated-from: ${folderName}\n` +
    `---\n\n` +
    body +
    "\n";
  const writeRes = await bridge.writeFile(compositePath, content);
  if (!writeRes.ok) {
    return { ok: false, error: writeRes.error.message };
  }
  return { ok: true, value: compositePath };
}

/** Extract the folder basename from a folder path (strips trailing slashes). */
function folderBasename(folderPath: string): string {
  return folderPath.replace(/\/+$/, "").split("/").pop() ?? folderPath;
}
