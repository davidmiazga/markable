/**
 * Fuzzy ranker for the Command Bar plugin (FC2 #11, Step 02).
 *
 * This is a pure TypeScript module with no DOM, window, or side-effect
 * dependencies. It is imported directly by command-bar.plugin.ts and bundled
 * inline by the IIFE build step (Rollup resolves the local import). It is also
 * directly importable by Vitest tests without any setup or mocking.
 *
 * Exported API:
 *   - FuzzyMatch        (type)
 *   - fuzzyMatch()      — rank a single label against a query, or return null
 *   - renderHighlightedLabel() — build a DOM element with <mark> spans
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a fuzzy match attempt.
 *
 * - tier: quality of the match (1 = best, 4 = worst). Lower is better.
 * - positions: 0-based indices into the original label where query characters
 *   were matched. Used by renderHighlightedLabel() to inject <mark> spans.
 */
export interface FuzzyMatch {
  tier: 1 | 2 | 3 | 4;
  positions: number[];
}

// ---------------------------------------------------------------------------
// Core fuzzy match algorithm (FR-02.3)
// ---------------------------------------------------------------------------

/**
 * Attempt to fuzzy-match `label` against `query` using a four-tier strategy:
 *
 *   Tier 1 — Exact prefix:     label starts with query (case-insensitive)
 *   Tier 2 — Word boundary:    any word in label starts with query
 *   Tier 3 — Substring:        query appears anywhere in label
 *   Tier 4 — Subsequence:      every char of query appears in label in order
 *
 * All comparisons are case-insensitive. The returned positions reference
 * indices in the *original* label (preserving case for highlight rendering).
 *
 * @param label  - The text to search in (e.g. "Focus Mode").
 * @param query  - The user-typed query string (e.g. "fo").
 * @returns FuzzyMatch with tier and matched positions, or null if no match.
 */
export function fuzzyMatch(label: string, query: string): FuzzyMatch | null {
  // Empty query: no match. The caller handles empty query as "show all" (FR-02.5).
  if (query === "") return null;

  const labelLower = label.toLowerCase();
  const queryLower = query.toLowerCase();

  // ── Tier 1: exact prefix ──────────────────────────────────────────────────
  if (labelLower.startsWith(queryLower)) {
    const positions = Array.from({ length: queryLower.length }, (_, i) => i);
    return { tier: 1, positions };
  }

  // ── Tier 2: word-boundary prefix ─────────────────────────────────────────
  // A "word start" is either position 0 or the position immediately after a
  // space, hyphen, or underscore. We skip position 0 here because tier 1
  // already covers the case where the label itself starts with the query.
  const wordBoundaryPositions = wordBoundaryMatch(labelLower, queryLower);
  if (wordBoundaryPositions) {
    return { tier: 2, positions: wordBoundaryPositions };
  }

  // ── Tier 3: substring ────────────────────────────────────────────────────
  const idx = labelLower.indexOf(queryLower);
  if (idx !== -1) {
    const positions = Array.from({ length: queryLower.length }, (_, i) => idx + i);
    return { tier: 3, positions };
  }

  // ── Tier 4: subsequence ───────────────────────────────────────────────────
  // Every character of query must appear in label in order (greedy-first match).
  const seqPositions = subsequenceMatch(labelLower, queryLower);
  if (seqPositions) {
    return { tier: 4, positions: seqPositions };
  }

  return null; // label does not match query at all
}

// ---------------------------------------------------------------------------
// Word-boundary helper
// ---------------------------------------------------------------------------

/**
 * Check whether any word within `labelLower` starts with `queryLower`.
 *
 * A "word start" is defined as any position immediately after a separator
 * character (space, hyphen, underscore). Position 0 is the start of the
 * first word — but tier 1 already covers that case, so we only check
 * positions after a separator here. Including position 0 in the scan would
 * be harmless (tier 1 already returned if the label started with the query),
 * but omitting it keeps the intent of this function clear: tier 2 handles
 * only non-first-word matches, and the wordBoundaryMatch helper reflects that.
 *
 * @param labelLower - Lowercase version of the label.
 * @param queryLower - Lowercase version of the query.
 * @returns Array of matched positions (indices into the original label), or null.
 */
function wordBoundaryMatch(labelLower: string, queryLower: string): number[] | null {
  // Collect word-start positions after separator characters only (not position 0,
  // because tier 1 already handles the case where the label starts with the query).
  const starts: number[] = [];
  for (let i = 1; i < labelLower.length; i++) {
    const prev = labelLower[i - 1];
    if (prev === " " || prev === "-" || prev === "_") {
      starts.push(i);
    }
  }

  // Check each word start. String.startsWith(query, offset) is O(query.length).
  for (const start of starts) {
    if (labelLower.startsWith(queryLower, start)) {
      return Array.from({ length: queryLower.length }, (_, i) => start + i);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Subsequence helper
// ---------------------------------------------------------------------------

/**
 * Greedy subsequence match: return positions of the first occurrence of each
 * query character found in label in order, or null if not all chars are found.
 *
 * This is the standard O(n + m) subsequence algorithm where n = label length
 * and m = query length. It is "greedy-first": each query char binds to the
 * earliest available position in the label.
 *
 * Example: "Focus Mode" vs "fcs" → positions [0, 2, 4]
 *   (F at 0, first 'c' at 2, first 's' at 4)
 *
 * @param labelLower - Lowercase label.
 * @param queryLower - Lowercase query.
 * @returns Matched positions, or null if not a valid subsequence.
 */
function subsequenceMatch(labelLower: string, queryLower: string): number[] | null {
  const positions: number[] = [];
  let qi = 0; // index into queryLower
  for (let li = 0; li < labelLower.length && qi < queryLower.length; li++) {
    if (labelLower[li] === queryLower[qi]) {
      positions.push(li);
      qi++;
    }
  }
  // If qi reached query length, all chars were matched
  return qi === queryLower.length ? positions : null;
}

// ---------------------------------------------------------------------------
// DOM highlight renderer
// ---------------------------------------------------------------------------

/**
 * Build a `<span>` element that renders `label` with the matched characters
 * highlighted by `<mark class="cb-match">` spans.
 *
 * Safety: never uses innerHTML. All text is inserted via textContent or
 * createTextNode, which prevents HTML injection (EC-10).
 *
 * Consecutive matched positions are merged into a single <mark> for a cleaner
 * DOM and correct visual appearance (e.g. positions [2,3] → one mark "cu").
 *
 * @param label     - The display text to render (original case).
 * @param positions - Matched character positions from FuzzyMatch.positions.
 * @returns A <span> element containing text nodes and <mark> elements.
 */
export function renderHighlightedLabel(label: string, positions: number[]): HTMLElement {
  const span = document.createElement("span");
  const posSet = new Set(positions);
  let i = 0;

  while (i < label.length) {
    if (posSet.has(i)) {
      // Build one <mark> for this run of consecutive highlighted characters.
      const mark = document.createElement("mark");
      mark.className = "cb-match";
      let j = i;
      while (j < label.length && posSet.has(j)) {
        // Append each character via textContent — never innerHTML — for XSS safety.
        mark.textContent = (mark.textContent ?? "") + label[j];
        j++;
      }
      span.appendChild(mark);
      i = j;
    } else {
      // Collect the run of consecutive unhighlighted characters into one text node.
      let j = i;
      while (j < label.length && !posSet.has(j)) j++;
      span.appendChild(document.createTextNode(label.slice(i, j)));
      i = j;
    }
  }

  return span;
}
