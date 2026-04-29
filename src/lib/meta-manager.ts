/**
 * meta-manager.ts
 *
 * Pure functions for the Vault Meta System.
 *
 * Responsibilities:
 *  - Construct `{VaultName}_meta/` folder and file paths from a vault entry.
 *  - Parse a meta bullet-list Markdown file into a string array vocabulary.
 *  - Build a MetaStore from a vault entry using an injected readFile function.
 *  - Provide vocabulary query helpers consumed by IIFE plugins at render time.
 *
 * All functions are pure or accept I/O as callbacks so they are testable
 * without a live Tauri process (dependency injection throughout).
 *
 * Design decisions:
 *  - AD-1: TypeScript parsing avoids a new Rust command.
 *  - AD-3: MetaStore is replaced atomically on vault switch (callers must
 *    assign the return value; this module never mutates window globals).
 *  - AD-5: sanitiseVaultName() is the single canonical TypeScript implementation.
 *    The Rust side mirrors it as a trivial one-liner.
 */

import type { VaultEntry } from "./vault-types";
import type { FileResult } from "./errors";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The in-memory vocabulary store exposed as window.__MARKABLE_META__.
 *
 * `tags`    — entries from `{VaultName}_tags.md`; empty array when absent.
 * `fields`  — entries from other `{VaultName}_{fieldname}.md` files.
 *             Populated by future field-scan step; always `{}` in v1.
 * `vaultId` — id of the vault this data belongs to; null when no vault is active.
 */
export interface MetaStore {
  /** Tag vocabulary from the tags meta file. Empty when no file exists. */
  tags: string[];
  /** Field-name → vocabulary mapping for non-tags meta files. */
  fields: Record<string, string[]>;
  /**
   * Vault id this meta belongs to.
   * Stored for diagnostics; stale-check across vault switches is handled by
   * the atomic `window.__MARKABLE_META__` replacement in `main.ts`
   * `onVaultChanged` — which assigns a fresh MetaStore on every vault switch,
   * making an explicit vaultId comparison unnecessary (H-2 / EC-13 accepted
   * limitation: a very short async window between the switch event firing and
   * the new MetaStore resolving is accepted as a known trade-off).
   */
  vaultId: string | null;
}

/**
 * Callback type for reading a file via the bridge.
 * Matches the signature of bridge.ts::readFile(), which returns
 * a FileResult<string> discriminated union.
 */
export type ReadFileFn = (path: string) => Promise<FileResult<string>>;

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Replace characters invalid in macOS directory names with `_`.
 *
 * Affected characters:
 *  - `/`   — path separator (would split the component into two directories)
 *  - `:`   — reserved by HFS+/APFS (was historically used as a path separator)
 *  - `\0`  — null byte (terminates C strings, rejected by POSIX layer)
 *
 * The result is used only for filesystem path construction; the vault's
 * display name is unchanged (EC-18).
 *
 * @param name - Raw VaultEntry.name value.
 * @returns Sanitised name safe for use as a directory component.
 */
export function sanitiseVaultName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/:\x00]/g, "_");
}

/**
 * Absolute path to the meta folder for a given vault.
 *
 * Uses `rootPaths[0]` as the base directory. Multi-root vaults always use
 * the first root for meta folder placement (out-of-scope note in requirements).
 *
 * @param vault - The active VaultEntry.
 * @returns Absolute path string, e.g. `/Users/dave/Notes/Work Notes_meta`.
 */
export function metaFolderPath(vault: VaultEntry): string {
  const root = vault.rootPaths[0];
  const safe = sanitiseVaultName(vault.name);
  return `${root}/${safe}_meta`;
}

/**
 * Absolute path to a specific meta field file.
 *
 * Pattern: `{metaFolderPath}/{sanitisedName}_{fieldName}.md`
 *
 * @param vault     - The active VaultEntry.
 * @param fieldName - Lowercase field name (e.g. `"tags"`, `"author"`).
 * @returns Absolute path string,
 *          e.g. `/Users/dave/Notes/Work Notes_meta/Work Notes_tags.md`.
 */
export function metaFilePath(vault: VaultEntry, fieldName: string): string {
  const safe = sanitiseVaultName(vault.name);
  return `${metaFolderPath(vault)}/${safe}_${fieldName}.md`;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse a meta bullet-list Markdown file into a deduplicated string array.
 *
 * Rules:
 *  - CR characters are stripped first so Windows line endings (`\r\n`) work.
 *  - Only lines whose trimmed form starts with `- ` (dash-space) are entries.
 *  - The `- ` prefix is stripped; the remainder is trimmed.
 *  - Empty strings after trimming are discarded.
 *  - Duplicate values are removed (first occurrence wins) — EC-4.
 *  - The optional `# heading` line is ignored by the `- ` check.
 *
 * @param raw - Raw file contents as returned by readFile().
 * @returns Deduplicated array of vocabulary entries.
 */
export function parseMetaBulletList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    // Only process bullet list items; headings and prose lines are ignored.
    if (!trimmed.startsWith("- ")) continue;
    const value = trimmed.slice(2).trim();
    // Discard blank entries that result from "- " with no text.
    if (!value) continue;
    // First occurrence wins for deduplication.
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

// ── Meta store builder ────────────────────────────────────────────────────────

/**
 * Build a MetaStore for the given vault by reading its meta files.
 *
 * Only the `tags` field file is read explicitly in v1 (AD-9). Other field
 * files (`{name}_{fieldname}.md`) are not scanned because no listFiles bridge
 * function is available; `fields` will always be `{}` until a future step adds
 * the folder scan. This is documented as deferred work in 00_index.md.
 *
 * Behaviour when the file does not exist:
 *  - `readFileFn` returns `{ ok: false }`.
 *  - `tags` is set to `[]`.
 *  - No warning is emitted — missing file is the expected initial state (EC-2).
 *
 * This function never throws. On any error it returns an empty-tags MetaStore.
 *
 * @param vault       - The vault to build a meta store for.
 * @param readFileFn  - Injected readFile function (bridge.ts::readFile).
 * @returns A MetaStore. Never rejects.
 */
export async function buildMetaStore(
  vault: VaultEntry,
  readFileFn: ReadFileFn
): Promise<MetaStore> {
  const tagsPath = metaFilePath(vault, "tags");
  const result = await readFileFn(tagsPath);

  // When the read fails (file not found, permissions, etc.) treat as no vocabulary.
  const tags = result.ok ? parseMetaBulletList(result.value) : [];

  return {
    tags,
    fields: {},
    vaultId: vault.id,
  };
}

// ── Null / no-vault store ─────────────────────────────────────────────────────

/**
 * Return an empty MetaStore for use when no vault is active (EC-1).
 *
 * All consumers must check for an empty/null vocabulary before showing
 * warnings (FR-11).
 */
export function emptyMetaStore(): MetaStore {
  return { tags: [], fields: {}, vaultId: null };
}

// ── Meta file initial content ─────────────────────────────────────────────────

/**
 * Initial content written to a freshly created tags meta file (FR-1).
 * The heading line is the only required structure; bullet items are added later.
 */
export const TAGS_META_INITIAL_CONTENT = "# Tags\n";

// ── Meta folder event detection ───────────────────────────────────────────────

/**
 * Determine whether a VaultFileChangedEvent path belongs to the meta folder
 * of the given vault. Used by main.ts to decide when to hot-reload the meta
 * store (FR-12).
 *
 * A path is a meta-folder event when it:
 *  - Is a direct child of the meta folder (starts with `{folder}/`), OR
 *  - Equals the meta folder path exactly (directory-level event).
 *
 * @param eventPath  - Absolute path from the VaultFileChangedEvent.
 * @param vault      - The currently active vault.
 * @returns True when eventPath is inside `{root}/{sanitisedName}_meta/`.
 */
export function isMetaFolderEvent(eventPath: string, vault: VaultEntry): boolean {
  const folder = metaFolderPath(vault);
  // Normalise both paths to avoid trailing-slash mismatch.
  return eventPath.startsWith(folder + "/") || eventPath === folder;
}

// ── Vocabulary query helper ───────────────────────────────────────────────────

/**
 * Return the vocabulary for `fieldKey` from a MetaStore, or null when no
 * non-empty vocabulary is defined for that field.
 *
 * Null signals "no vocabulary configured" — callers must suppress warnings
 * when this function returns null (FR-11).
 *
 * Distinction:
 *  - null         → no vocabulary defined; do NOT warn.
 *  - string[]     → vocabulary exists; compare values and warn on mismatch.
 *  - empty string[] also yields null (treat same as "not defined").
 *
 * For `fieldKey === "tags"`, returns `store.tags` when non-empty, else null.
 * For other keys, returns `store.fields[fieldKey]` when present and non-empty,
 * else null.
 *
 * @param store    - The current MetaStore.
 * @param fieldKey - YAML front-matter field name (e.g. "tags", "author").
 * @returns Vocabulary array or null.
 */
export function getVocabularyForField(
  store: MetaStore,
  fieldKey: string
): string[] | null {
  if (fieldKey === "tags") {
    return store.tags.length > 0 ? store.tags : null;
  }
  const vocab = store.fields[fieldKey];
  return vocab && vocab.length > 0 ? vocab : null;
}

// ── Window global type augmentation ──────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __MARKABLE_META__: MetaStore;
  }
}
