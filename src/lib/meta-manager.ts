/**
 * meta-manager.ts
 *
 * Pure functions for the Vault Properties System.
 *
 * Responsibilities:
 *  - Construct `VaultSettings/` folder and properties file paths from a vault entry.
 *  - Parse a multi-section properties Markdown file into a MetaStore.
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
 * `tags`       — entries from the `## Tags` section; empty array when absent.
 * `fields`     — lowercase field-name → vocabulary array for all other sections.
 * `dateFormat` — format string parsed from `[x] FORMAT` in the `## Date` section.
 * `vaultId`    — id of the vault this data belongs to; null when no vault is active.
 */
export interface MetaStore {
  tags: string[];
  fields: Record<string, string[]>;
  dateFormat?: string;
  vaultId: string | null;
}

export type ReadFileFn = (path: string) => Promise<FileResult<string>>;
export type WriteFileFn = (path: string, content: string) => Promise<unknown>;
export type EnsureDirectoryFn = (path: string) => Promise<unknown>;
export type DeleteDirectoryFn = (path: string) => Promise<unknown>;

export interface MetaIOOptions {
  writeFileFn?: WriteFileFn;
  ensureDirectoryFn?: EnsureDirectoryFn;
  deleteDirectoryFn?: DeleteDirectoryFn;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Replace characters invalid in macOS directory names with `_`.
 *
 * Affected characters:
 *  - `/`   — path separator (would split the component into two directories)
 *  - `:`   — reserved by HFS+/APFS (was historically used as a path separator)
 *  - `\0`  — null byte (terminates C strings, rejected by POSIX layer)
 *
 * @param name - Raw VaultEntry.name value.
 * @returns Sanitised name safe for use as a directory component.
 */
export function sanitiseVaultName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/:\x00]/g, "_");
}

/**
 * Absolute path to the VaultSettings folder for a given vault.
 * Always `{rootPaths[0]}/VaultSettings` — not vault-name-specific.
 */
export function metaFolderPath(vault: VaultEntry): string {
  return `${vault.rootPaths[0]}/VaultSettings`;
}

/**
 * Absolute path to the properties file for a given vault.
 * Pattern: `{metaFolderPath}/{sanitisedName}_properties.md`
 */
export function metaFilePath(vault: VaultEntry): string {
  const safe = sanitiseVaultName(vault.name);
  return `${metaFolderPath(vault)}/${safe}_properties.md`;
}

/**
 * Absolute path to the old-format meta folder. Used for migration only.
 * Pattern: `{rootPaths[0]}/{sanitisedName}_meta`
 */
export function legacyMetaFolderPath(vault: VaultEntry): string {
  const root = vault.rootPaths[0];
  const safe = sanitiseVaultName(vault.name);
  return `${root}/${safe}_meta`;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse a single-section bullet-list Markdown file into a deduplicated string array.
 *
 * Rules:
 *  - CR characters are stripped first so Windows line endings work.
 *  - Only lines whose trimmed form starts with `- ` are entries.
 *  - The `- ` prefix is stripped; the remainder is trimmed.
 *  - Empty strings after trimming are discarded.
 *  - Duplicate values are removed (first occurrence wins).
 *  - Heading and prose lines are ignored.
 *
 * @param raw - Raw file contents as returned by readFile().
 * @returns Deduplicated array of vocabulary entries.
 */
export function parseMetaBulletList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const value = trimmed.slice(2).trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

/**
 * Parse the multi-section `{VaultName}_properties.md` file.
 *
 * Sections are delimited by `## Heading` lines (with any leading whitespace).
 * Each section collects its bullet items into the appropriate output field:
 *  - `## Tags`     → `tags[]`
 *  - `## Date ...` → scans for `[x] FORMAT` → `dateFormat`; bullets ignored
 *  - `## Other`    → `fields[sectionNameLowercased][]`
 *
 * Field keys in `fields` are lowercased so they match YAML front-matter
 * conventions (e.g. `## Status` → `fields["status"]`).
 */
export function parsePropertiesFile(
  raw: string
): Pick<MetaStore, "tags" | "fields" | "dateFormat"> {
  const tags: string[] = [];
  const fields: Record<string, string[]> = {};
  let dateFormat: string | undefined;

  let currentSection = "";
  let currentSectionLower = "";
  const tagsSeen = new Set<string>();
  const fieldsSeen: Record<string, Set<string>> = {};

  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();

    // Section heading: ## Title or ## Title (extra info)
    if (trimmed.startsWith("## ")) {
      const headingFull = trimmed.slice(3).trim();
      // Strip parenthetical suffix: "Date (format style)" → "Date"
      currentSection = headingFull.replace(/\s*\(.*\)$/, "").trim();
      currentSectionLower = currentSection.toLowerCase();
      if (currentSectionLower !== "tags" && currentSectionLower !== "date") {
        if (!fieldsSeen[currentSectionLower]) fieldsSeen[currentSectionLower] = new Set();
      }
      continue;
    }

    if (!currentSection) continue;

    // Date section: look for [x] FORMAT line
    if (currentSectionLower === "date" && /^\[x\]\s/.test(trimmed)) {
      dateFormat = trimmed.slice(4).trim();
      continue;
    }

    // Bullet items
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      if (!value) continue;

      if (currentSectionLower === "tags") {
        if (tagsSeen.has(value)) continue;
        tagsSeen.add(value);
        tags.push(value);
      } else if (currentSectionLower !== "date") {
        const seen = fieldsSeen[currentSectionLower];
        if (!seen || seen.has(value)) continue;
        seen.add(value);
        if (!fields[currentSectionLower]) fields[currentSectionLower] = [];
        fields[currentSectionLower].push(value);
      }
    }
  }

  return { tags, fields, dateFormat };
}

// ── Starter vocabulary ────────────────────────────────────────────────────────

/**
 * Default content written to a freshly created `{VaultName}_properties.md`.
 * Matches the format defined in docs/handoffs/sampleProperties.md.
 */
export const PROPERTIES_INITIAL_CONTENT = `# Properties to validate against, format: Field - metadata
  ## Tags
  - home
  - family
  - finance
  - news
  - recipe
  - sports

  ## Source
  - article
  - book
  - video
  - daily-note

  ## Status
  - draft
  - in-progress
  - complete
  - archived
  - review

  ## Classification
  - General Works
  - Computer
  - Philosophy-Psychology
  - Religion
  - Social Sciences
  - Language
  - Science
  - Technology
  - Arts-Recreation
  - Literature
  - History-Geography

  ## Area
  - research
  - personal
  - work

  ## Priority
  - high
  - medium
  - low

  ## Date (format style)
  [x] MM/DD/YYYY
  [ ] MM/DD/YY
  [ ] MM.DD.YYYY
  [ ] MM.DD.YY
  [ ] Month Day, Year
  [ ] Mon. Day, Year
`;

// ── Meta store builder ────────────────────────────────────────────────────────

/**
 * Build a MetaStore for the given vault by reading its properties file.
 *
 * When `io` is provided, also performs two side effects:
 *  1. Migration: if the old `{safe}_meta/` folder exists, deletes it silently.
 *  2. Auto-create: if the properties file doesn't exist, writes the starter
 *     vocabulary (`PROPERTIES_INITIAL_CONTENT`) and parses it immediately.
 *
 * This function never throws. On any error it returns an empty-tags MetaStore.
 *
 * @param vault       - The vault to build a meta store for.
 * @param readFileFn  - Injected readFile function (bridge.ts::readFile).
 * @param io          - Optional I/O functions for migration and auto-create.
 * @returns A MetaStore. Never rejects.
 */
export async function buildMetaStore(
  vault: VaultEntry,
  readFileFn: ReadFileFn,
  io?: MetaIOOptions
): Promise<MetaStore> {
  // Step 1: Migration — silently delete old {safe}_meta/ folder if it exists.
  if (io?.deleteDirectoryFn) {
    try {
      await io.deleteDirectoryFn(legacyMetaFolderPath(vault));
    } catch {
      // Not found or already gone — not an error.
    }
  }

  const propertiesPath = metaFilePath(vault);
  const result = await readFileFn(propertiesPath);

  // Step 2: Auto-create starter vocabulary when file doesn't exist yet.
  if (!result.ok && io?.ensureDirectoryFn && io?.writeFileFn) {
    try {
      await io.ensureDirectoryFn(metaFolderPath(vault));
      await io.writeFileFn(propertiesPath, PROPERTIES_INITIAL_CONTENT);
      const created = await readFileFn(propertiesPath);
      if (created.ok) {
        const parsed = parsePropertiesFile(created.value);
        return { ...parsed, vaultId: vault.id };
      }
    } catch (err) {
      console.warn("[buildMetaStore] Failed to auto-create properties file:", err);
    }
    return { tags: [], fields: {}, vaultId: vault.id };
  }

  if (!result.ok) {
    return { tags: [], fields: {}, vaultId: vault.id };
  }

  const parsed = parsePropertiesFile(result.value);
  return { ...parsed, vaultId: vault.id };
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

// ── Meta folder event detection ───────────────────────────────────────────────

/**
 * Determine whether a VaultFileChangedEvent path belongs to the VaultSettings
 * folder of the given vault. Used by main.ts to hot-reload the meta store.
 *
 * @param eventPath  - Absolute path from the VaultFileChangedEvent.
 * @param vault      - The currently active vault.
 * @returns True when eventPath is inside `{root}/VaultSettings/`.
 */
export function isMetaFolderEvent(eventPath: string, vault: VaultEntry): boolean {
  const folder = metaFolderPath(vault);
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
 * `fieldKey` is lowercased before lookup so `Status` and `status` both match
 * the `fields["status"]` entry stored by parsePropertiesFile.
 *
 * @param store    - The current MetaStore.
 * @param fieldKey - YAML front-matter field name (e.g. "tags", "status").
 * @returns Vocabulary array or null.
 */
export function getVocabularyForField(
  store: MetaStore,
  fieldKey: string
): string[] | null {
  const key = fieldKey.toLowerCase();
  if (key === "tags") {
    return store.tags.length > 0 ? store.tags : null;
  }
  const vocab = store.fields[key];
  return vocab && vocab.length > 0 ? vocab : null;
}

// ── Window global type augmentation ──────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __MARKABLE_META__: MetaStore;
  }
}
