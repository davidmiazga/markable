/**
 * shared.ts — Utilities shared across folder-view sub-modules.
 *
 * Kept minimal: only extract here when the same logic appears in 2+ files.
 */

import type { FolderCard } from "./types";

/**
 * Filter `cards` by the `exclude` list from FolderViewConfig.
 *
 * Compares each card's effective filename (name + ".md" for .md files) against
 * the exclude set. Used in both tab.ts (for the YAML callback's visible-cards
 * set) and renderer.ts (for section-building), so both always apply the same
 * logic from a single source.
 *
 * @param cards   - Full card list before filtering.
 * @param exclude - Array of filenames to exclude (e.g. ["_folder.md"]).
 * @returns Filtered card list, or the original array when exclude is empty.
 */
export function applyExcludeFilter(cards: FolderCard[], exclude: string[]): FolderCard[] {
  if (exclude.length === 0) return cards;
  const excludeSet = new Set(exclude);
  return cards.filter(c => {
    const filename = c.ext === ".md" ? c.name + ".md" : c.name;
    return !excludeSet.has(filename);
  });
}

/**
 * Remove <script> elements and inline event handlers from an HTML string.
 *
 * Used before assigning user-controlled markdown to innerHTML (EC-14).
 *
 * @param html - Rendered HTML string to sanitize.
 * @returns Sanitized HTML with script elements and event handlers removed.
 */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "")
    .replace(/ on\w+='[^']*'/gi, "");
}
