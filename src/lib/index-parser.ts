/**
 * index-parser.ts
 *
 * Pure functions for parsing and maintaining the vault file index.
 *
 * All functions in this module are stateless and have no side effects.
 * They are shared between vault-manager.ts (runtime) and unit tests
 * (which can exercise them without any Tauri backend).
 *
 * Design constraints:
 * - Front matter parsing reads only the first 4 KB of content (NFR-07).
 *   This prevents large files from causing slow index builds. Wiki-link
 *   extraction operates on the full file content.
 * - The wiki-link regex is imported from backlinks.plugin.ts — we must NOT
 *   define a second parser here to avoid diverging behaviour (spec requirement).
 * - All functions degrade gracefully on malformed input (EC-40); they never
 *   throw for bad data — they return safe fallbacks instead.
 */

import type { VaultIndex, VaultIndexEntry, VaultFileChangedEvent } from "./vault-types";
import { WIKI_LINK_RE } from "../plugins/backlinks/backlinks.plugin";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of characters read from the start of a file for front matter
 * parsing. Content past this offset may still contain wiki-links and is scanned
 * by extractWikiLinks (which receives the full content from the caller).
 */
const FRONT_MATTER_MAX_BYTES = 4096;

// ── Front matter parser ───────────────────────────────────────────────────────

/**
 * Parse YAML front matter from file content.
 *
 * Reads only the first 4 KB (NFR-07) and uses a line-by-line state machine
 * rather than a full YAML parser — this matches the Rust implementation in
 * vault.rs so both sides agree on what counts as "title" and "tags".
 *
 * Algorithm:
 * 1. If the content does not start with `---`, there is no front matter.
 * 2. Read lines until the closing `---` delimiter (or EOF).
 * 3. Extract `title:` and `tags:` values.
 * 4. If no `title:` front matter, scan the rest of the content for a `# H1`.
 *
 * @param content - Raw file content (full length; only first 4KB used for FM).
 * @returns { title, tags } — title is null when absent; tags is [] when absent.
 *   Never throws (EC-40).
 */
export function parseFrontMatter(content: string): {
  title: string | null;
  tags: string[];
} {
  // Only examine the first 4 KB for front matter to satisfy NFR-07.
  const slice = content.slice(0, FRONT_MATTER_MAX_BYTES);
  const lines = slice.split("\n");

  let title: string | null = null;
  let tags: string[] = [];

  // Front matter must start with a `---` line on the very first line.
  if (!lines[0] || lines[0].trim() !== "---") {
    // No front matter — look for an H1 heading anywhere in the full content.
    title = extractH1(content);
    return { title, tags };
  }

  let inFrontMatter = true;
  // Track whether we are currently reading a YAML block sequence for `tags`.
  let readingTagsBlock = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Closing delimiter ends front matter parsing.
    if (trimmed === "---") {
      inFrontMatter = false;
      break;
    }

    if (!inFrontMatter) break;

    // ── title: ───────────────────────────────────────────────────────────────
    const titleMatch = trimmed.match(/^title\s*:\s*(.+)$/);
    if (titleMatch) {
      // Strip surrounding quotes that YAML writers sometimes add.
      title = titleMatch[1].replace(/^["']|["']$/g, "").trim() || null;
      readingTagsBlock = false;
      continue;
    }

    // ── tags: ────────────────────────────────────────────────────────────────
    // Inline form: `tags: [a, b, c]`
    const tagsInlineMatch = trimmed.match(/^tags\s*:\s*\[([^\]]*)\]/);
    if (tagsInlineMatch) {
      tags = tagsInlineMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      readingTagsBlock = false;
      continue;
    }

    // Block form header: `tags:` (with nothing after the colon, or only whitespace)
    const tagsBlockHeader = trimmed.match(/^tags\s*:\s*$/);
    if (tagsBlockHeader) {
      readingTagsBlock = true;
      tags = []; // reset; items follow on subsequent lines
      continue;
    }

    // Block form items: `  - value` or `- value`
    if (readingTagsBlock) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        const tag = itemMatch[1].trim().replace(/^["']|["']$/g, "");
        if (tag) tags.push(tag);
        continue;
      }
      // A non-list line ends the block sequence.
      if (!trimmed.startsWith("-")) {
        readingTagsBlock = false;
      }
    }
  }

  // If front matter had no `title:` key, fall back to the first H1 in the file.
  if (title === null) {
    title = extractH1(content);
  }

  return { title, tags };
}

/**
 * Scan `content` for the first Markdown H1 heading (`# text`).
 *
 * Used as a fallback title when no `title:` front matter key exists.
 * Returns null when no H1 is found.
 *
 * @param content - Raw file content (full length).
 */
function extractH1(content: string): string | null {
  // A valid H1 must be at the start of a line (possibly after newlines),
  // followed by exactly one space and the heading text.
  const h1Match = content.match(/(?:^|\n)#\s+(.+)/);
  if (h1Match) {
    return h1Match[1].trim() || null;
  }
  return null;
}

// ── Wiki-link extractor ───────────────────────────────────────────────────────

/**
 * Extract `[[wikilink]]` stems from full file content.
 *
 * Reuses WIKI_LINK_RE from backlinks.plugin.ts — the regex is the single
 * authoritative source so both the editor and the index agree on what
 * constitutes a wiki-link (spec requirement: do not duplicate the parser).
 *
 * Piped links (`[[target|display text]]`) return only the target stem.
 * Duplicates are removed (the same target linked multiple times yields one
 * entry in the outbound-links array).
 *
 * NOTE: This function does NOT filter links inside code fences. That
 * responsibility belongs to the CM6 editor layer; the index intentionally
 * includes all syntactic wiki-links regardless of context. The spec notes
 * this as the expected behaviour (test item #30).
 *
 * @param content - Raw file content (full length).
 * @returns Array of unique target stems (no brackets, no pipe-text).
 */
export function extractWikiLinks(content: string): string[] {
  if (!content) return [];

  // WIKI_LINK_RE is a stateful global regex — reset lastIndex before each use
  // to prevent stale state from a previous call from causing skipped matches.
  WIKI_LINK_RE.lastIndex = 0;

  const stems = new Set<string>();
  let match: RegExpExecArray | null;

  // Each match[1] is the full capture group: either "stem" or "stem|display".
  // We take only the part before the first `|` to extract the target stem.
  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    const raw = match[1];
    // Split on `|` and take the target part (index 0).
    const stem = raw.split("|")[0].trim();
    if (stem) stems.add(stem);
  }

  return Array.from(stems);
}

// ── Staleness detection ───────────────────────────────────────────────────────

/**
 * Determine whether a cached VaultIndexEntry is stale relative to the current
 * file-system modification timestamp.
 *
 * The caller is responsible for obtaining `currentModified` from a recent
 * `list_vault_files` Tauri call (which returns unix ms timestamps from the OS).
 *
 * @param entry          - The cached index entry.
 * @param currentModified - Current mtime of the file in milliseconds since epoch.
 * @returns true if the file has been modified since it was indexed (needs re-parse).
 */
export function isStale(entry: VaultIndexEntry, currentModified: number): boolean {
  // Strict less-than: equal timestamps mean the file has not changed.
  return entry.modified < currentModified;
}

// ── Immutable index updater ───────────────────────────────────────────────────

/**
 * Apply a VaultFileChangedEvent to an existing VaultIndex and return a new
 * VaultIndex (immutable update — original is not mutated).
 *
 * This function is called by vault-manager's incremental update handler when
 * the notify watcher emits a change event. It does NOT read from disk; the
 * caller provides the updated entry (for "created" and "modified") or omits it
 * (for "deleted" and "renamed").
 *
 * Edge case (EC-13): If the event's vaultId does not match the index's vaultId,
 * an error is thrown — this indicates a programming error in the caller, not a
 * user-facing condition, so throwing is appropriate.
 *
 * @param index        - The current in-memory index.
 * @param event        - The file-system change event.
 * @param updatedEntry - The new entry to insert (required for "created"/"modified").
 * @returns A new VaultIndex with the event applied.
 * @throws Error if event.vaultId !== index.vaultId.
 */
export function applyIndexUpdate(
  index: VaultIndex,
  event: VaultFileChangedEvent,
  updatedEntry?: VaultIndexEntry
): VaultIndex {
  // Guard: the caller must not mix events from different vaults.
  if (event.vaultId !== index.vaultId) {
    throw new Error(
      `applyIndexUpdate: event vaultId "${event.vaultId}" does not match ` +
        `index vaultId "${index.vaultId}"`
    );
  }

  const now = Date.now();

  switch (event.eventType) {
    case "created": {
      // Add the new entry. If somehow it already exists (race condition),
      // replace it — idempotent behaviour is safer than duplicate entries.
      if (!updatedEntry) {
        // Without a parsed entry we cannot add meaningful data; return unchanged.
        return index;
      }
      const withoutDup = index.entries.filter((e) => e.path !== updatedEntry.path);
      return {
        ...index,
        builtAt: now,
        entries: [...withoutDup, updatedEntry],
        totalFilesFound: index.totalFilesFound + 1,
      };
    }

    case "modified": {
      if (!updatedEntry) return index;
      // Replace the existing entry for this path.
      return {
        ...index,
        builtAt: now,
        entries: index.entries.map((e) =>
          e.path === updatedEntry.path ? updatedEntry : e
        ),
      };
    }

    case "deleted": {
      return {
        ...index,
        builtAt: now,
        entries: index.entries.filter((e) => e.path !== event.path),
        totalFilesFound: Math.max(0, index.totalFilesFound - 1),
      };
    }

    case "renamed": {
      // `event.path` is the old path; `event.newPath` is the new path.
      // If we also received an updatedEntry (with the new path), use it;
      // otherwise patch the path/name fields on the existing entry.
      const oldPath = event.path;
      const newPath = event.newPath ?? oldPath; // fallback: no rename if newPath absent

      return {
        ...index,
        builtAt: now,
        entries: index.entries.map((e) => {
          if (e.path !== oldPath) return e;
          if (updatedEntry) return updatedEntry;
          // Derive the new name from the new path's stem (without extension).
          const newName = newPath.split("/").pop()?.replace(/\.md$/i, "") ?? e.name;
          return { ...e, path: newPath, name: newName };
        }),
      };
    }

    default: {
      // Exhaustiveness guard — TypeScript narrows this to `never` but at
      // runtime a future event type from Rust would land here.
      return index;
    }
  }
}
