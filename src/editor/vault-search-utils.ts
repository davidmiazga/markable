/**
 * vault-search-utils.ts
 *
 * Pure helper functions for multi-file find & replace (multi-file feature).
 *
 * No DOM, no Tauri, no imports from bridge.ts at runtime — only type imports
 * (erased at compile time). These functions operate only on plain data
 * structures so they can be unit-tested without mocks.
 *
 * See docs/specs/multi-file-find-replace/00_index.md for architecture decisions.
 */

import type { ContentSearchPayload, LineMatch } from "../lib/bridge";

// ── Types ─────────────────────────────────────────────────────────────────────

/** The three possible scope values for the find widget. */
export type FindScope = "file" | "vault" | "folder";

/**
 * Post-filtering options derived from the widget's toggle state.
 *
 * Both fields default to false (off). The Rust search command is always
 * case-insensitive, so matchCase and wholeWord are enforced client-side
 * by postFilterResults (FR-13, FR-14).
 */
export interface PostFilterOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

/**
 * A single focused match reference held in widget state.
 *
 * Used by _replaceVaultMatch to identify which match to replace when
 * the user focuses an individual excerpt row.
 */
export interface FocusedMatch {
  filePath: string;
  lineNumber: number;
  columnStart: number;
}

/**
 * Result of applyStringReplace — the modified content and the count of
 * substitutions made.
 *
 * When count === 0, the caller must NOT write the file back to disk (EC-6:
 * on-disk content may have changed since the search snapshot; a no-op write
 * is avoided entirely).
 */
export interface ReplaceResult {
  newContent: string;
  count: number;
}

// ── Pure helper functions ─────────────────────────────────────────────────────

/**
 * Escape all regex-special characters in a string so it can be used safely
 * as a literal pattern inside new RegExp(...).
 *
 * Required before constructing whole-word boundaries (EC-11, EC-14). Without
 * escaping, find terms that contain regex metacharacters (e.g. "$100", "a.b",
 * "3+4") would be interpreted as regex operators and produce wrong matches or
 * throw SyntaxErrors.
 *
 * @param s - The literal string to escape.
 * @returns The escaped string safe for use in RegExp constructor.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a RegExp for whole-word matching of `find`.
 *
 * Uses \b word-boundary anchors around the escaped find term. The `g` flag is
 * always set so replace operations can replace all occurrences in a single
 * String.replace() call. The `i` flag is conditionally set based on
 * caseSensitive.
 *
 * @param find          - The literal find term (will be regex-escaped internally).
 * @param caseSensitive - True for case-sensitive matching; false for insensitive.
 * @returns A RegExp with \b anchors suitable for whole-word replace operations.
 */
export function buildWholeWordRegex(find: string, caseSensitive: boolean): RegExp {
  const escaped = escapeRegex(find);
  const flags = caseSensitive ? "g" : "gi";
  return new RegExp(`\\b${escaped}\\b`, flags);
}

/**
 * Post-filter a ContentSearchPayload from searchVaultContent.
 *
 * The Rust command (search_vault_content) is always case-insensitive (FR-13
 * constraint). This function applies the client-side filters that the backend
 * does not handle:
 *
 *   - matchCase: Discards any LineMatch whose lineText does not contain the
 *     exact-case query string as a substring.
 *   - wholeWord: Discards any LineMatch where the match is not bounded by \b
 *     word-boundary anchors.
 *
 * File entries whose match array becomes empty after filtering are removed from
 * results. The capped and skippedCount fields pass through unchanged because
 * they describe the backend's work, not the filtered results.
 *
 * When neither flag is set, the payload is returned as the same object
 * reference (no copy, no iteration) — this is the hot path.
 *
 * @param payload - The raw payload from searchVaultContent.
 * @param query   - The exact query string from the find input (used for
 *                  case-sensitive substring check).
 * @param opts    - Post-filtering options (matchCase, wholeWord).
 * @returns       - A new ContentSearchPayload with filtered results, or the
 *                  same payload object reference when no filtering is needed.
 */
export function postFilterResults(
  payload: ContentSearchPayload,
  query: string,
  opts: PostFilterOptions,
): ContentSearchPayload {
  // Hot path: no filtering needed — return the same reference.
  if (!opts.matchCase && !opts.wholeWord) {
    return payload;
  }

  /*
   * Build the whole-word regex once outside the file loop so it is not
   * re-compiled for every line. The g flag makes the regex stateful, so
   * lastIndex is reset to 0 before each test() call inside the filter.
   */
  const wholeWordRe = opts.wholeWord
    ? buildWholeWordRegex(query, opts.matchCase)
    : null;

  const filteredResults = payload.results
    .map((fileResult) => {
      const filteredMatches = fileResult.matches.filter((match: LineMatch) => {
        // Case-sensitive post-filter (FR-13): lineText must contain exact-case query.
        if (opts.matchCase && !match.lineText.includes(query)) {
          return false;
        }

        // Whole-word post-filter (FR-14): match must be bounded by \b.
        if (wholeWordRe) {
          /*
           * Reset lastIndex because the regex is reused across multiple
           * lineText values (the g flag makes it stateful). Without the
           * reset, the cursor from a previous test() call would carry over
           * and cause false negatives on subsequent calls.
           */
          wholeWordRe.lastIndex = 0;
          if (!wholeWordRe.test(match.lineText)) {
            return false;
          }
        }

        return true;
      });

      return { ...fileResult, matches: filteredMatches };
    })
    // Remove files that have no matches left after filtering.
    .filter((fileResult) => fileResult.matches.length > 0);

  return {
    results: filteredResults,
    capped: payload.capped,
    skippedCount: payload.skippedCount,
  };
}

/**
 * Apply a string replacement across all occurrences of `find` in `content`.
 *
 * Respects matchCase and wholeWord. Regex is intentionally NOT used as the
 * primary search strategy here (FR-15 — regex mode is out of scope for vault
 * search). All find terms are treated as literal strings.
 *
 * Returns the new content string and the count of substitutions made.
 *
 * When count === 0, the caller must NOT write the file (EC-6: on-disk content
 * may have changed since the search snapshot; a no-op write is avoided).
 *
 * Empty replace string performs deletion (EC-13).
 *
 * @param content - Current file content.
 * @param find    - The literal search term. Empty string → no-op (count 0).
 * @param replace - The replacement string (may be empty for deletion).
 * @param opts    - matchCase and wholeWord toggles.
 * @returns       - { newContent, count } where count is the number of
 *                  replacements made.
 */
export function applyStringReplace(
  content: string,
  find: string,
  replace: string,
  opts: PostFilterOptions,
): ReplaceResult {
  // Guard: empty find term → no-op.
  if (!find) {
    return { newContent: content, count: 0 };
  }

  if (opts.wholeWord) {
    /*
     * Whole-word replacement: use a regex with \b anchors. The escapeRegex
     * call ensures any metacharacters in the literal find term are treated
     * as literals (EC-14). The g flag replaces all occurrences.
     */
    const re = buildWholeWordRegex(find, opts.matchCase);
    let count = 0;
    const newContent = content.replace(re, () => {
      count++;
      return replace;
    });
    return { newContent, count };
  }

  if (opts.matchCase) {
    /*
     * Case-sensitive literal replacement without whole-word restriction.
     * String.prototype.split + join is the canonical no-regex approach for
     * literal string replacement. It avoids any regex special-character
     * escaping issues (EC-14) because split() treats the separator as a
     * literal string, not a pattern.
     *
     * count = parts.length - 1 because split produces N+1 segments for N
     * occurrences of the separator.
     */
    const parts = content.split(find);
    const count = parts.length - 1;
    return { newContent: parts.join(replace), count };
  }

  /*
   * Case-insensitive literal replacement.
   * We must use a regex here because JavaScript has no built-in
   * case-insensitive literal string replace-all. The find term is
   * escaped so metacharacters are treated as literals (EC-14).
   * The gi flags give global + case-insensitive.
   */
  const escaped = escapeRegex(find);
  const re = new RegExp(escaped, "gi");
  let count = 0;
  const newContent = content.replace(re, () => {
    count++;
    return replace;
  });
  return { newContent, count };
}
