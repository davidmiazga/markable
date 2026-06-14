/**
 * store.ts — Read/write API for the Collections-specific keys in `_folder.md`.
 *
 * Composes the existing yaml-frontmatter helpers (parseYamlFrontmatter,
 * applyYamlKey, removeYamlKey, reconstructFile) for scalar keys, and adds a
 * small block-sequence (`key:\n  - "item"`) reader/writer for the three array
 * keys this feature owns: `stackOrder`, `order`, `references`. The yaml-
 * frontmatter helpers only understand scalar lines; arrays are this module's
 * responsibility.
 *
 * Atomicity: every write goes through `bridge.writeFile`, which calls the
 * Rust `write_file` command (temp-file-swap pattern). Concurrent writes to
 * the SAME `_folder.md` are serialised by `withFileQueue` so the read-mutate-
 * write cycle is not racy (EC-10).
 *
 * Schema discipline: every writer rejects with `schema-too-new` when the
 * on-disk schemaVersion is greater than `COLLECTIONS_SCHEMA_VERSION`
 * (EC-13). The renderer treats that as read-only and toasts.
 *
 * No raw `invoke()` calls — all I/O routes through `bridge.ts` (C-4).
 * No new Rust commands (C-4).
 *
 * @module collections/store
 */

import { readFile, writeFile } from "../../../lib/bridge";
import {
  parseYamlFrontmatter,
  removeYamlKey,
  reconstructFile,
} from "../folder-view/yaml-frontmatter";
import {
  extractSelectCodeblockBody,
  parseYamlLines,
} from "../folder-view/parser";
import { FOLDER_VIEW_CONFIG_KEYS } from "../folder-view/codeblock-writer";
import type { FileResult } from "../../../lib/errors";
import type { CollectionMeta, StackMeta } from "./types";
import {
  COLLECTIONS_SCHEMA_VERSION,
  COLLECTION_YAML_KEYS,
  COLLECTION_LAYOUT_KEY,
  STACK_DEFAULT_ICON,
} from "./schema";

/**
 * Frontmatter keys that the Collections writer strips during
 * migration-on-write (step_03 / AD-4 MW-3 / MW-4 in
 * `docs/specs/view-modal/00_index.md`).
 *
 * Includes every folder-view-config key (because Collections writes are
 * also folder-view migration triggers per AD-4) PLUS the Collections-
 * owned keys that move into the codeblock body: `schemaVersion`,
 * `displayName`, `stackOrder`, `order`, `references`. `type` is already
 * inside FOLDER_VIEW_CONFIG_KEYS.
 *
 * `icon` is intentionally NOT stripped: folder-icon-assignment owns the
 * frontmatter `icon:` key (EC-19). Collections also writes its own
 * `icon:` value inside the codeblock; reads prefer the codeblock first
 * and fall back to frontmatter.
 */
const COLLECTION_STRIP_KEYS: readonly string[] = Array.from(
  new Set<string>([
    ...FOLDER_VIEW_CONFIG_KEYS,
    "schemaVersion",
    "displayName",
    "stackOrder",
    "noteOrder",
    "childOrder",
    "order",
    "references",
  ]),
);

/** Filename convention for the per-folder sidecar metadata file. */
const FOLDER_MD_NAME = "_folder.md";

/**
 * Compute the absolute path of a folder's `_folder.md` sidecar.
 * Trailing slashes on `folderPath` are tolerated.
 */
function folderMdPath(folderPath: string): string {
  return folderPath.replace(/\/+$/, "") + "/" + FOLDER_MD_NAME;
}

/**
 * Derive a folder's basename without any trailing slash.
 * Used to default `displayName` when reading a Collection with no metadata.
 */
function folderBasename(folderPath: string): string {
  const trimmed = folderPath.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

// ── Per-file write queue (EC-10) ──────────────────────────────────────────────

/**
 * Map of `absolutePath → tail-of-queue-promise`. Each new caller chains
 * onto the existing tail; cross-file callers do not share a tail.
 */
const fileQueue = new Map<string, Promise<unknown>>();

/**
 * Serialise an async operation against `filePath`. Other callers targeting
 * the SAME path are made to wait; callers targeting different paths run
 * concurrently. The queue entry is cleaned up when the call settles so the
 * map does not grow without bound.
 */
async function withFileQueue<T>(filePath: string, op: () => Promise<T>): Promise<T> {
  // Chain onto the existing tail (or a resolved promise if no prior work).
  const prev = fileQueue.get(filePath) ?? Promise.resolve();
  // `then(() => op())` swallows the prior call's resolved value; errors in
  // prior calls are caught inside their own tails — they must not poison
  // unrelated subsequent callers, so we shield with `.catch`.
  const next = prev.then(() => op(), () => op());
  fileQueue.set(filePath, next);
  try {
    return await next;
  } finally {
    // Only clear when we are still the tail — a later caller may have
    // already chained on top, in which case `fileQueue.get` is that newer
    // entry and we must NOT delete it.
    if (fileQueue.get(filePath) === next) {
      fileQueue.delete(filePath);
    }
  }
}

// ── Frontmatter array I/O ─────────────────────────────────────────────────────

/**
 * Escape a YAML scalar string for safe block-sequence emission.
 *
 * Block-sequence items are always double-quoted in our emission policy.
 * The rationale: Collections-owned arrays carry user-typed Stack folder
 * names, note filenames (which include `.md`), and vault-relative paths
 * (with `/` separators). All three commonly contain spaces and the dot,
 * either of which would parse fine unquoted in YAML but render ambiguously
 * to downstream tools. Always-quoted output is what the spec example shows
 * and matches what the test harness asserts. Embedded backslashes and
 * double-quotes are escaped; everything else is the literal value.
 */
function escapeYamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Strip a single pair of surrounding double-quotes (matching the writer)
 * and unescape `\"` and `\\`. Leaves unquoted scalars unchanged.
 */
function unquoteYamlString(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

/**
 * Parse a block-sequence YAML array out of a list of frontmatter lines.
 *
 * Accepts both inline `key: []` and the block form:
 *
 *     key:
 *       - "value 1"
 *       - "value 2"
 *
 * Returns an empty array if the key is absent OR if the value is `[]`.
 * Lines that follow the `key:` line and start with whitespace + `-` are
 * collected as items; the first non-indented or non-list line ends the
 * sequence.
 */
function readYamlArray(frontmatterLines: readonly string[], key: string): string[] {
  for (let i = 0; i < frontmatterLines.length; i++) {
    const line = frontmatterLines[i];
    // Match a top-level key declaration. The exact prefix rules mirror
    // applyYamlKey's matching to keep behaviour symmetric.
    if (line !== key + ":" && !line.startsWith(key + ": ") && !line.startsWith(key + ":\t")) {
      continue;
    }
    // Inline form: `key: []`. Treat anything that is not a bare `key:` as a
    // scalar — the only legal scalar value we accept for an array key is `[]`.
    if (line !== key + ":") {
      const rest = line.slice(key.length + 1).trim();
      if (rest === "[]") return [];
      // A non-empty inline value on an array key is unusual; treat as empty
      // rather than crashing. The writer always emits the block form, so this
      // only happens for hand-edited files.
      return [];
    }
    // Block form: read subsequent indented `- value` lines.
    const items: string[] = [];
    for (let j = i + 1; j < frontmatterLines.length; j++) {
      const next = frontmatterLines[j];
      // A non-indented line ends the sequence (it must be a new top-level key).
      if (!/^\s/.test(next)) break;
      const trimmed = next.trim();
      if (!trimmed.startsWith("- ")) {
        // Indented continuation that is NOT a sequence item is a nested
        // mapping; we do not produce those, so this is hand-edited content.
        // Stop parsing rather than guessing.
        break;
      }
      items.push(unquoteYamlString(trimmed.slice(2).trim()));
    }
    return items;
  }
  return [];
}

// `writeYamlArray` (legacy frontmatter array writer) removed in step_03:
// the Collections feature now emits its arrays inside the `select`
// codeblock body, not as YAML frontmatter sequences. The reader still
// uses `readYamlArray` to fall back to legacy `_folder.md` files that
// have not yet been migrated.

/**
 * Read a scalar key value out of frontmatter lines. Returns `undefined` if
 * the key is absent or has an empty value. Surrounding quotes are stripped.
 */
function readYamlScalar(frontmatterLines: readonly string[], key: string): string | undefined {
  for (const line of frontmatterLines) {
    if (line === key + ":") return undefined; // bare key, empty value
    if (line.startsWith(key + ": ") || line.startsWith(key + ":\t")) {
      const raw = line.slice(key.length + 1).trim();
      if (!raw) return undefined;
      return unquoteYamlString(raw);
    }
  }
  return undefined;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

function defaultCollectionMeta(displayName: string): CollectionMeta {
  // Refactor R04: defaults for a missing/malformed `_folder.md`.
  // We intentionally leave `layout` undefined here — the dispatch path in
  // `tab.ts` already gates on `config.layout === "collection-home"`; the
  // defaults returned from a missing file should NOT claim to be a
  // Collection. Callers asking "is this a Collection?" must look at
  // `meta.layout` (and only after a successful read).
  return {
    schemaVersion: COLLECTIONS_SCHEMA_VERSION,
    displayName,
    stackOrder: [],
    noteOrder: [],
    childOrder: [],
  };
}

function defaultStackMeta(displayName: string): StackMeta {
  // Refactor R04: Stacks are identified by their position in the file system
  // (an immediate subfolder of a `layout: collection-home` folder), not by a
  // YAML marker. No `type` field on the default.
  return {
    schemaVersion: COLLECTIONS_SCHEMA_VERSION,
    displayName,
    icon: STACK_DEFAULT_ICON,
    order: [],
    references: [],
  };
}

// ── Codeblock-shape helpers (step_03) ────────────────────────────────────────

/**
 * Parse the first `select` codeblock in a body string and return the
 * flat key/value record. Returns null when no codeblock is present.
 *
 * The Collections feature stores its meta inside the codeblock body
 * post-step_03. Read paths check the codeblock first; legacy frontmatter
 * is a fallback (per AD-2 / FR-55).
 */
function parseCollectionsCodeblock(
  bodyText: string,
): Record<string, string | Record<string, string> | (string | Record<string, string>)[]> | null {
  const cbBody = extractSelectCodeblockBody(bodyText);
  if (cbBody === null) return null;
  return parseYamlLines(cbBody.split("\n"));
}

/**
 * Extract a string scalar from the codeblock-parsed map. Returns
 * undefined when the key is absent or the value is not a string.
 */
function cbScalar(
  cb: Record<string, string | Record<string, string> | (string | Record<string, string>)[]> | null,
  key: string,
): string | undefined {
  if (cb === null) return undefined;
  const v = cb[key];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Extract a string[] from the codeblock-parsed map (block sequence).
 * Returns null when the key is absent or the value is not an array.
 *
 * `parseYamlLines` pushes plain string items verbatim (it strips
 * surrounding quotes ONLY for structured items, not for plain
 * sequence items). The Collections writer double-quotes every array
 * item via `escapeYamlString`, so we must unquote on read to invert.
 */
function cbStringArray(
  cb: Record<string, string | Record<string, string> | (string | Record<string, string>)[]> | null,
  key: string,
): string[] | null {
  if (cb === null) return null;
  const v = cb[key];
  if (!Array.isArray(v)) return null;
  return v
    .filter((x): x is string => typeof x === "string")
    .map((item) => unquoteYamlString(item));
}

/**
 * Compose the Collection root `_folder.md` content from a meta. The
 * existing file's frontmatter is preserved minus the
 * Collections-and-folder-view-config strip set; the codeblock body
 * carries the canonical Collection meta. Migration-on-write per AD-4 /
 * AD-5.
 */
function composeCollectionFile(
  existingContent: string | null,
  meta: CollectionMeta,
): string {
  const fenceLines: string[] = ["```select"];
  fenceLines.push(`${COLLECTION_YAML_KEYS.schemaVersion}: ${meta.schemaVersion}`);
  fenceLines.push(`${COLLECTION_YAML_KEYS.layout}: ${COLLECTION_LAYOUT_KEY}`);
  // Emit displayName unquoted to match legacy frontmatter shape and
  // existing test expectations. Strings with embedded `"` or backslashes
  // are rare here (user-typed Collection / Stack folder names) and the
  // YAML parser (`parseYamlLines`) accepts both quoted and unquoted scalars.
  fenceLines.push(`${COLLECTION_YAML_KEYS.displayName}: ${meta.displayName}`);
  if (meta.stackOrder.length === 0) {
    fenceLines.push(`${COLLECTION_YAML_KEYS.stackOrder}: []`);
  } else {
    fenceLines.push(`${COLLECTION_YAML_KEYS.stackOrder}:`);
    for (const s of meta.stackOrder) {
      fenceLines.push(`  - ${escapeYamlString(s)}`);
    }
  }
  // noteOrder — emitted only when non-empty. For Collections with no
  // root-level notes (or whose order is auto-derived from the vault
  // index alphabetically), nothing is persisted; the field is absent
  // from the codeblock entirely.
  if (meta.noteOrder.length > 0) {
    fenceLines.push(`${COLLECTION_YAML_KEYS.noteOrder}:`);
    for (const n of meta.noteOrder) {
      fenceLines.push(`  - ${escapeYamlString(n)}`);
    }
  }
  // childOrder — combined mixed-grid order. Once populated by a drag
  // it becomes the source of truth for rendering; absent or empty
  // falls back to stackOrder + noteOrder concat (legacy layout).
  if (meta.childOrder.length > 0) {
    fenceLines.push(`${COLLECTION_YAML_KEYS.childOrder}:`);
    for (const c of meta.childOrder) {
      fenceLines.push(`  - ${escapeYamlString(c)}`);
    }
  }
  if (meta.icon !== undefined && meta.icon !== null && meta.icon !== "") {
    // icon: emitted unquoted; the value is either a built-in name
    // (`notebook`, `book`) or a vault-relative path with no embedded
    // quotes. parseYamlLines accepts both quoted and unquoted scalars.
    fenceLines.push(`${COLLECTION_YAML_KEYS.icon}: ${meta.icon}`);
  }
  fenceLines.push("```");

  return composeShellWithFence(existingContent, fenceLines);
}

/**
 * Compose a Stack `_folder.md` content from a meta. Same migration
 * rules as `composeCollectionFile`. Stacks have no `layout:` marker.
 */
function composeStackFile(
  existingContent: string | null,
  meta: StackMeta,
): string {
  const fenceLines: string[] = ["```select"];
  fenceLines.push(`${COLLECTION_YAML_KEYS.schemaVersion}: ${meta.schemaVersion}`);
  // Emit displayName unquoted to match legacy frontmatter shape and
  // existing test expectations. Strings with embedded `"` or backslashes
  // are rare here (user-typed Collection / Stack folder names) and the
  // YAML parser (`parseYamlLines`) accepts both quoted and unquoted scalars.
  fenceLines.push(`${COLLECTION_YAML_KEYS.displayName}: ${meta.displayName}`);
  if (meta.icon !== undefined && meta.icon !== null && meta.icon !== "") {
    // icon: emitted unquoted; the value is either a built-in name
    // (`notebook`, `book`) or a vault-relative path with no embedded
    // quotes. parseYamlLines accepts both quoted and unquoted scalars.
    fenceLines.push(`${COLLECTION_YAML_KEYS.icon}: ${meta.icon}`);
  }
  if (meta.order.length === 0) {
    fenceLines.push(`${COLLECTION_YAML_KEYS.order}: []`);
  } else {
    fenceLines.push(`${COLLECTION_YAML_KEYS.order}:`);
    for (const v of meta.order) {
      fenceLines.push(`  - ${escapeYamlString(v)}`);
    }
  }
  if (meta.references.length === 0) {
    fenceLines.push(`${COLLECTION_YAML_KEYS.references}: []`);
  } else {
    fenceLines.push(`${COLLECTION_YAML_KEYS.references}:`);
    for (const v of meta.references) {
      fenceLines.push(`  - ${escapeYamlString(v)}`);
    }
  }
  fenceLines.push("```");

  return composeShellWithFence(existingContent, fenceLines);
}

/**
 * Locate the first `select` codeblock in body lines and return its
 * inclusive [open, close] line indices. Returns null when absent or
 * unclosed.
 */
function findSelectFenceLineRange(
  bodyLines: string[],
): { openIdx: number; closeIdx: number } | null {
  const openRe = /^```select(?:\s|$)/;
  let openIdx = -1;
  for (let i = 0; i < bodyLines.length; i++) {
    if (openRe.test(bodyLines[i])) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;
  for (let i = openIdx + 1; i < bodyLines.length; i++) {
    if (bodyLines[i].trim() === "```") {
      return { openIdx, closeIdx: i };
    }
  }
  return null;
}

/**
 * Compose the file shell (optional frontmatter + codeblock body + any
 * retained body content below) given a pre-built fence line array.
 *
 * Migration-on-write contract:
 *   - All COLLECTION_STRIP_KEYS are removed from existing frontmatter.
 *   - Any pre-existing `select` codeblock in the body is replaced with
 *     the new fence (no duplication).
 *   - Non-strip-list frontmatter keys (notably `icon:` owned by
 *     folder-icon-assignment) survive byte-for-byte.
 */
function composeShellWithFence(
  existingContent: string | null,
  fenceLines: string[],
): string {
  if (existingContent === null) {
    // Fresh create: codeblock-only file with a trailing newline.
    return fenceLines.join("\n") + "\n";
  }

  const parsed = parseYamlFrontmatter(existingContent);

  let fmLines = parsed.frontmatterLines;
  for (const key of COLLECTION_STRIP_KEYS) {
    fmLines = removeYamlKey(fmLines, key);
  }

  // Strip any existing `select` codeblock in the body, so we replace
  // rather than duplicate. Collapses a redundant blank-line seam.
  const bodyLines: string[] = [...parsed.bodyLines];
  const range = findSelectFenceLineRange(bodyLines);
  let strippedBodyLines: string[];
  if (range !== null) {
    const before = bodyLines.slice(0, range.openIdx);
    const after = bodyLines.slice(range.closeIdx + 1);
    if (
      after.length > 0 &&
      after[0] === "" &&
      (before.length === 0 || before[before.length - 1] === "")
    ) {
      after.shift();
    }
    strippedBodyLines = [...before, ...after];
  } else {
    strippedBodyLines = bodyLines;
  }

  // Drop trailing empty entries so reconstructFile does not emit
  // dangling blank lines; we re-add a single trailing "" so the file
  // ends with a newline byte after the final join.
  while (
    strippedBodyLines.length > 0 &&
    strippedBodyLines[strippedBodyLines.length - 1] === ""
  ) {
    strippedBodyLines.pop();
  }

  // Compose body: codeblock at the TOP, retained content below.
  const newBodyLines: string[] =
    strippedBodyLines.length > 0
      ? [...fenceLines, "", ...strippedBodyLines, ""]
      : [...fenceLines, ""];

  // When frontmatter survives, prepend a blank line so the codeblock is
  // visually separated from the closing `---` (AD-5 / FR-60 contract).
  const finalBodyLines =
    fmLines.length > 0 ? ["", ...newBodyLines] : newBodyLines;

  return reconstructFile({
    hasFrontmatter: parsed.hasFrontmatter,
    frontmatterLines: fmLines,
    bodyLines: finalBodyLines,
  });
}

// ── Internal read helpers ─────────────────────────────────────────────────────

/**
 * Read and parse a `_folder.md`. Returns `{ ok: false }` with a marker error
 * only when the bridge itself fails for an unexpected reason; ENOENT and
 * malformed frontmatter are normal cases and yield `{ ok: true, value: null }`
 * so callers can fall back to defaults.
 */
async function readFolderMdInternal(
  absPath: string,
): Promise<
  | { state: "absent" }
  | { state: "malformed" }
  | { state: "ok"; frontmatterLines: string[]; bodyLines: string[] }
> {
  const res = await readFile(absPath);
  if (!res.ok) return { state: "absent" };
  const parsed = parseYamlFrontmatter(res.value);
  if (parsed.malformed) return { state: "malformed" };
  if (!parsed.hasFrontmatter) {
    // The file exists but has no frontmatter — treat as malformed for our
    // purposes (no recognisable Collection/Stack metadata).
    return {
      state: "ok",
      frontmatterLines: [],
      bodyLines: parsed.bodyLines,
    };
  }
  return {
    state: "ok",
    frontmatterLines: [...parsed.frontmatterLines],
    bodyLines: parsed.bodyLines,
  };
}

// ── Collection root ──────────────────────────────────────────────────────────

/**
 * Read the Collection root frontmatter at `folderPath/_folder.md`.
 *
 * Tolerant of missing/malformed files: ENOENT (EC-4) and unrecoverable
 * frontmatter (EC-6) both return `{ ok: true, value: defaults }`. The
 * renderer (step 05) is responsible for surfacing the toast.
 */
export async function readCollection(
  folderPath: string,
): Promise<FileResult<CollectionMeta>> {
  const absPath = folderMdPath(folderPath);
  const r = await readFolderMdInternal(absPath);
  const displayName = folderBasename(folderPath);
  if (r.state !== "ok") {
    return { ok: true, value: defaultCollectionMeta(displayName) };
  }

  // step_03 / AD-2 — Codeblock-first read.
  //
  // Files written post-step_03 carry the canonical meta inside a
  // `select` codeblock in the body. Legacy frontmatter (`type:
  // collection` MVP shape, R04 `layout: collection-home` frontmatter
  // shape) is the fallback. Codeblock wins when both are present
  // (FR-55 precedence).
  //
  // NB: this read NEVER writes back. Read-only viewing of a legacy
  // folder leaves the file byte-for-byte unchanged.
  const bodyText = r.bodyLines.join("\n");
  const cb = parseCollectionsCodeblock(bodyText);

  const cbLayout = cbScalar(cb, COLLECTION_YAML_KEYS.layout);
  const cbDisplayName = cbScalar(cb, COLLECTION_YAML_KEYS.displayName);
  const cbStackOrder = cbStringArray(cb, COLLECTION_YAML_KEYS.stackOrder);
  const cbNoteOrder = cbStringArray(cb, COLLECTION_YAML_KEYS.noteOrder);
  const cbChildOrder = cbStringArray(cb, COLLECTION_YAML_KEYS.childOrder);
  const cbIcon = cbScalar(cb, COLLECTION_YAML_KEYS.icon);
  const cbSchema = cbScalar(cb, COLLECTION_YAML_KEYS.schemaVersion);

  // Frontmatter fallbacks (R04 read-compat).
  const fmLayout = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.layout);
  const fmType = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.type);
  const fmDisplayName = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.displayName);
  const fmStackOrder = readYamlArray(r.frontmatterLines, COLLECTION_YAML_KEYS.stackOrder);
  const fmNoteOrder = readYamlArray(r.frontmatterLines, COLLECTION_YAML_KEYS.noteOrder);
  const fmChildOrder = readYamlArray(r.frontmatterLines, COLLECTION_YAML_KEYS.childOrder);
  const fmIcon = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.icon);
  const fmSchema = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.schemaVersion);

  // The canonical marker may live in either source; legacy `type:` is
  // tolerated only when no `layout:` is present in either source.
  const layoutValue = cbLayout ?? fmLayout;
  const isCollection =
    layoutValue === COLLECTION_LAYOUT_KEY ||
    (layoutValue == null && fmType === "collection");

  const meta: CollectionMeta = {
    schemaVersion:
      Number.parseInt(cbSchema ?? fmSchema ?? "1", 10) ||
      COLLECTIONS_SCHEMA_VERSION,
    layout: isCollection ? COLLECTION_LAYOUT_KEY : undefined,
    displayName: cbDisplayName ?? fmDisplayName ?? displayName,
    // Codeblock wins. If the codeblock has the key (even as `[]`), the
    // frontmatter fallback is ignored. `?? []` at the end ensures the
    // field is always a defined array — legacy files predating this
    // schema field have neither source.
    stackOrder: cbStackOrder ?? fmStackOrder ?? [],
    noteOrder: cbNoteOrder ?? fmNoteOrder ?? [],
    childOrder: cbChildOrder ?? fmChildOrder ?? [],
    icon: cbIcon ?? fmIcon,
  };
  return { ok: true, value: meta };
}

/**
 * Write/update the Collection root frontmatter, preserving every unrelated
 * key (EC-23). The patch is shallow — only the keys present in `patch` are
 * touched.
 */
export async function writeCollectionMeta(
  folderPath: string,
  patch: Partial<CollectionMeta>,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(folderPath);
  return withFileQueue(absPath, async () => {
    // Read the current meta — codeblock-first per step_03's read order.
    // The reader already encapsulates the merge of codeblock + legacy
    // frontmatter fallbacks, so we apply the patch on top of that.
    const readRes = await readFile(absPath);
    const existingContent: string | null = readRes.ok ? readRes.value : null;

    // EC-13 schema-too-new gate. Inspect codeblock first, then frontmatter
    // fallback — both shapes are recognised regardless of whether the file
    // has yet been migrated.
    if (existingContent !== null) {
      const parsed = parseYamlFrontmatter(existingContent);
      const cb = parseCollectionsCodeblock(parsed.bodyLines.join("\n"));
      const onDiskRaw =
        cbScalar(cb, COLLECTION_YAML_KEYS.schemaVersion) ??
        readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.schemaVersion) ??
        "1";
      const onDisk = Number.parseInt(onDiskRaw, 10);
      if (Number.isFinite(onDisk) && onDisk > COLLECTIONS_SCHEMA_VERSION) {
        return {
          ok: false as const,
          error: {
            message: "schema-too-new",
            command: "write_file",
            path: absPath,
          },
        };
      }
    }

    // Read the merged meta (codeblock-first with frontmatter fallback).
    const cur = await readCollection(folderPath);
    if (!cur.ok) return cur;

    // Apply the patch on top of the merged current state. Unspecified
    // fields fall through to the current value. `schemaVersion` is
    // always stamped fresh so the file converges to the current build's
    // schema after each write.
    const next: CollectionMeta = {
      schemaVersion: patch.schemaVersion ?? COLLECTIONS_SCHEMA_VERSION,
      layout: COLLECTION_LAYOUT_KEY,
      displayName: patch.displayName ?? cur.value.displayName,
      stackOrder: patch.stackOrder ?? cur.value.stackOrder,
      noteOrder: patch.noteOrder ?? cur.value.noteOrder,
      childOrder: patch.childOrder ?? cur.value.childOrder,
      icon: patch.icon ?? cur.value.icon,
    };

    const newContent = composeCollectionFile(existingContent, next);
    return writeFile(absPath, newContent);
  });
}

// ── Stack ────────────────────────────────────────────────────────────────────

export async function readStack(
  folderPath: string,
): Promise<FileResult<StackMeta>> {
  const absPath = folderMdPath(folderPath);
  const r = await readFolderMdInternal(absPath);
  const displayName = folderBasename(folderPath);
  if (r.state !== "ok") {
    return { ok: true, value: defaultStackMeta(displayName) };
  }

  // step_03 / AD-2 — Codeblock-first read. Stacks have no `layout:`
  // marker but their meta moves into the codeblock body alongside the
  // Collection root. Legacy `type: stack` files remain readable.
  const bodyText = r.bodyLines.join("\n");
  const cb = parseCollectionsCodeblock(bodyText);

  const cbDisplayName = cbScalar(cb, COLLECTION_YAML_KEYS.displayName);
  const cbIcon = cbScalar(cb, COLLECTION_YAML_KEYS.icon);
  const cbOrder = cbStringArray(cb, COLLECTION_YAML_KEYS.order);
  const cbReferences = cbStringArray(cb, COLLECTION_YAML_KEYS.references);
  const cbSchema = cbScalar(cb, COLLECTION_YAML_KEYS.schemaVersion);

  // Frontmatter fallbacks for legacy `type: stack` files.
  const fmDisplayName = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.displayName);
  const fmIcon = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.icon);
  const fmOrder = readYamlArray(r.frontmatterLines, COLLECTION_YAML_KEYS.order);
  const fmReferences = readYamlArray(r.frontmatterLines, COLLECTION_YAML_KEYS.references);
  const fmSchema = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.schemaVersion);

  const meta: StackMeta = {
    schemaVersion:
      Number.parseInt(cbSchema ?? fmSchema ?? "1", 10) ||
      COLLECTIONS_SCHEMA_VERSION,
    displayName: cbDisplayName ?? fmDisplayName ?? displayName,
    icon: cbIcon ?? fmIcon ?? STACK_DEFAULT_ICON,
    // Codeblock wins. The frontmatter fallback applies only when the
    // codeblock does not carry the key at all (cb returns null).
    order: cbOrder ?? fmOrder,
    references: cbReferences ?? fmReferences,
  };
  return { ok: true, value: meta };
}

export async function writeStackMeta(
  folderPath: string,
  patch: Partial<StackMeta>,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(folderPath);
  return withFileQueue(absPath, async () => {
    const readRes = await readFile(absPath);
    const existingContent: string | null = readRes.ok ? readRes.value : null;

    // EC-13 schema gate (codeblock first, then frontmatter fallback).
    if (existingContent !== null) {
      const parsed = parseYamlFrontmatter(existingContent);
      const cb = parseCollectionsCodeblock(parsed.bodyLines.join("\n"));
      const onDiskRaw =
        cbScalar(cb, COLLECTION_YAML_KEYS.schemaVersion) ??
        readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.schemaVersion) ??
        "1";
      const onDisk = Number.parseInt(onDiskRaw, 10);
      if (Number.isFinite(onDisk) && onDisk > COLLECTIONS_SCHEMA_VERSION) {
        return {
          ok: false as const,
          error: {
            message: "schema-too-new",
            command: "write_file",
            path: absPath,
          },
        };
      }
    }

    const cur = await readStack(folderPath);
    if (!cur.ok) return cur;

    const next: StackMeta = {
      schemaVersion: patch.schemaVersion ?? COLLECTIONS_SCHEMA_VERSION,
      displayName: patch.displayName ?? cur.value.displayName,
      icon: patch.icon ?? cur.value.icon,
      order: patch.order ?? cur.value.order,
      references: patch.references ?? cur.value.references,
    };

    const newContent = composeStackFile(existingContent, next);
    return writeFile(absPath, newContent);
  });
}

// ── stackOrder mutators ───────────────────────────────────────────────────────

/**
 * Compute a new order applying a directional or absolute reorder request.
 * Pure helper shared by `reorderStack` and `reorderNote`.
 */
function applyReorder(
  current: readonly string[],
  name: string,
  direction: "up" | "down" | { toIndex: number },
): string[] {
  const idx = current.indexOf(name);
  if (idx === -1) return [...current]; // unknown name — no-op
  const next = [...current];
  next.splice(idx, 1);
  if (typeof direction === "object") {
    const clamped = Math.max(0, Math.min(direction.toIndex, next.length));
    next.splice(clamped, 0, name);
    return next;
  }
  if (direction === "up") {
    next.splice(Math.max(0, idx - 1), 0, name);
  } else {
    next.splice(Math.min(next.length, idx + 1), 0, name);
  }
  return next;
}

export async function appendStackToCollection(
  collectionPath: string,
  stackFolderName: string,
): Promise<FileResult<void>> {
  // The full read-modify-write is wrapped in `withFileQueue` via
  // `writeCollectionMeta`. We read OUTSIDE the queue here, then dispatch the
  // write — but the read result is stale if a parallel write is in flight,
  // so we do the entire read+write inside the queue.
  const absPath = folderMdPath(collectionPath);
  return withFileQueue(absPath, async () => {
    const cur = await readCollection(collectionPath);
    if (!cur.ok) return cur;
    const newOrder = [...cur.value.stackOrder, stackFolderName];
    // Direct write — bypass writeCollectionMeta's outer queue (already
    // inside it) by inlining a single writeYamlArray pass.
    return writeWithStackOrder(absPath, newOrder);
  });
}

export async function removeStackFromCollection(
  collectionPath: string,
  stackFolderName: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(collectionPath);
  return withFileQueue(absPath, async () => {
    const cur = await readCollection(collectionPath);
    if (!cur.ok) return cur;
    const newOrder = cur.value.stackOrder.filter((n) => n !== stackFolderName);
    return writeWithStackOrder(absPath, newOrder);
  });
}

export async function reorderStack(
  collectionPath: string,
  stackFolderName: string,
  direction: "up" | "down" | { toIndex: number },
): Promise<FileResult<void>> {
  const absPath = folderMdPath(collectionPath);
  return withFileQueue(absPath, async () => {
    const cur = await readCollection(collectionPath);
    if (!cur.ok) return cur;
    const newOrder = applyReorder(cur.value.stackOrder, stackFolderName, direction);
    return writeWithStackOrder(absPath, newOrder);
  });
}

/**
 * Write only the `stackOrder:` array, preserving every other key. Avoids
 * the schemaVersion stamping done by `writeCollectionMeta` so we do not
 * lose user-set values inside the queue.
 *
 * Callers are expected to already hold the per-file queue.
 */
async function writeWithStackOrder(
  absPath: string,
  newOrder: readonly string[],
): Promise<FileResult<void>> {
  // Read current meta via the public reader so we apply migration-on-write
  // semantics consistently (codeblock-first, frontmatter fallback).
  const readRes = await readFile(absPath);
  if (!readRes.ok) {
    // Shouldn't happen — we just read successfully above, but on a race a
    // missing file means we cannot proceed without losing metadata.
    return {
      ok: false,
      error: { message: "absent", command: "write_file", path: absPath },
    };
  }
  // Reconstruct CollectionMeta in-place by manually parsing — we cannot
  // call readCollection() because it expects a folder path, not an
  // absolute file path, and we already hold the queue. This duplication
  // is small and the alternative (round-tripping the path) reintroduces
  // ambiguity for callers with trailing slashes.
  const existing = readRes.value;
  const parsed = parseYamlFrontmatter(existing);
  const cb = parseCollectionsCodeblock(parsed.bodyLines.join("\n"));
  const meta: CollectionMeta = {
    schemaVersion:
      Number.parseInt(
        cbScalar(cb, COLLECTION_YAML_KEYS.schemaVersion) ??
          readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.schemaVersion) ??
          "1",
        10,
      ) || COLLECTIONS_SCHEMA_VERSION,
    layout: COLLECTION_LAYOUT_KEY,
    displayName:
      cbScalar(cb, COLLECTION_YAML_KEYS.displayName) ??
      readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.displayName) ??
      "",
    stackOrder: [...newOrder],
    // Preserve any existing noteOrder / childOrder so a stackOrder
    // rewrite doesn't clobber the user's manual orders. Default to
    // empty arrays when the file predates these schema fields.
    noteOrder:
      cbStringArray(cb, COLLECTION_YAML_KEYS.noteOrder) ??
      readYamlArray(parsed.frontmatterLines, COLLECTION_YAML_KEYS.noteOrder) ??
      [],
    childOrder:
      cbStringArray(cb, COLLECTION_YAML_KEYS.childOrder) ??
      readYamlArray(parsed.frontmatterLines, COLLECTION_YAML_KEYS.childOrder) ??
      [],
    icon:
      cbScalar(cb, COLLECTION_YAML_KEYS.icon) ??
      readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.icon),
  };
  return writeFile(absPath, composeCollectionFile(existing, meta));
}

// ── Stack order mutators ──────────────────────────────────────────────────────

export async function appendNoteToStack(
  stackPath: string,
  noteFilename: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    return writeStackArrayKey(absPath, COLLECTION_YAML_KEYS.order, [
      ...cur.value.order,
      noteFilename,
    ]);
  });
}

export async function removeNoteFromStack(
  stackPath: string,
  noteFilename: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    return writeStackArrayKey(
      absPath,
      COLLECTION_YAML_KEYS.order,
      cur.value.order.filter((n) => n !== noteFilename),
    );
  });
}

export async function reorderNote(
  stackPath: string,
  noteFilename: string,
  direction: "up" | "down" | { toIndex: number },
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    return writeStackArrayKey(
      absPath,
      COLLECTION_YAML_KEYS.order,
      applyReorder(cur.value.order, noteFilename, direction),
    );
  });
}

/**
 * Rename a note's entry in the Stack's `order:` array. Only updates the
 * metadata — callers must rename the actual file separately. If `oldFilename`
 * is not present in `order:`, the call is a no-op (the note was moved in
 * without going through `appendNoteToStack`).
 */
export async function renameNoteInStack(
  stackPath: string,
  oldFilename: string,
  newFilename: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    const newOrder = cur.value.order.map((f) => (f === oldFilename ? newFilename : f));
    return writeStackArrayKey(absPath, COLLECTION_YAML_KEYS.order, newOrder);
  });
}

// ── references: mutators ──────────────────────────────────────────────────────

export async function appendReference(
  stackPath: string,
  canonicalVaultRelPath: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    // Idempotent: do not duplicate an existing reference.
    if (cur.value.references.includes(canonicalVaultRelPath)) {
      return { ok: true, value: undefined };
    }
    return writeStackArrayKey(absPath, COLLECTION_YAML_KEYS.references, [
      ...cur.value.references,
      canonicalVaultRelPath,
    ]);
  });
}

export async function removeReference(
  stackPath: string,
  canonicalVaultRelPath: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    return writeStackArrayKey(
      absPath,
      COLLECTION_YAML_KEYS.references,
      cur.value.references.filter((p) => p !== canonicalVaultRelPath),
    );
  });
}

export async function updateReferenceOnMove(
  stackPath: string,
  oldVaultRel: string,
  newVaultRel: string,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(stackPath);
  return withFileQueue(absPath, async () => {
    const cur = await readStack(stackPath);
    if (!cur.ok) return cur;
    return writeStackArrayKey(
      absPath,
      COLLECTION_YAML_KEYS.references,
      cur.value.references.map((p) => (p === oldVaultRel ? newVaultRel : p)),
    );
  });
}

/**
 * Write only one array key on a Stack's `_folder.md`, preserving every
 * other key. Mirrors `writeWithStackOrder` for Stacks. Callers must
 * already hold the per-file queue.
 */
async function writeStackArrayKey(
  absPath: string,
  key: string,
  values: readonly string[],
): Promise<FileResult<void>> {
  const readRes = await readFile(absPath);
  if (!readRes.ok) {
    return {
      ok: false,
      error: { message: "absent", command: "write_file", path: absPath },
    };
  }
  const existing = readRes.value;
  const parsed = parseYamlFrontmatter(existing);
  const cb = parseCollectionsCodeblock(parsed.bodyLines.join("\n"));

  // Read all current Stack meta from the codeblock + frontmatter fallback,
  // then apply the targeted array-key mutation.
  const meta: StackMeta = {
    schemaVersion:
      Number.parseInt(
        cbScalar(cb, COLLECTION_YAML_KEYS.schemaVersion) ??
          readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.schemaVersion) ??
          "1",
        10,
      ) || COLLECTIONS_SCHEMA_VERSION,
    displayName:
      cbScalar(cb, COLLECTION_YAML_KEYS.displayName) ??
      readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.displayName) ??
      "",
    icon:
      cbScalar(cb, COLLECTION_YAML_KEYS.icon) ??
      readYamlScalar(parsed.frontmatterLines, COLLECTION_YAML_KEYS.icon) ??
      STACK_DEFAULT_ICON,
    order:
      key === COLLECTION_YAML_KEYS.order
        ? [...values]
        : cbStringArray(cb, COLLECTION_YAML_KEYS.order) ??
          readYamlArray(parsed.frontmatterLines, COLLECTION_YAML_KEYS.order),
    references:
      key === COLLECTION_YAML_KEYS.references
        ? [...values]
        : cbStringArray(cb, COLLECTION_YAML_KEYS.references) ??
          readYamlArray(parsed.frontmatterLines, COLLECTION_YAML_KEYS.references),
  };

  return writeFile(absPath, composeStackFile(existing, meta));
}

// ── Internal exports for tests / cross-step reuse ─────────────────────────────

/**
 * Exposed for the reference-index (step 03) and tests. Mirrors the
 * `folderMdPath` helper already exported from `folder-icon-store.ts` — we
 * re-export from here to give Collections one ownership boundary for
 * `_folder.md` path arithmetic.
 */
export { folderMdPath };
