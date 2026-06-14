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
 * Attach keyboard arrow-key navigation to a container of focusable items.
 *
 * Delegates a `keydown` listener on `container`. ArrowDown/Up move by
 * `getColCount()` positions (so Up/Down skip a full grid row). ArrowRight/Left
 * are active only when `getColCount() > 1` (i.e. multi-column grids); they are
 * no-ops in single-column views such as the folder table.
 *
 * Always enabled: arrow navigation works regardless of whether a preview pane
 * is shown. When `onFocus` is provided, it is called after the new element
 * receives focus so callers can update preview state.
 *
 * @param container    - Scrollable host; `keydown` listener is attached here.
 * @param itemSelector - CSS selector for focusable item elements inside `container`.
 * @param getColCount  - Returns the current column count (called at event time).
 * @param onFocus      - Optional callback after moving focus; receives the new element.
 */
export function attachArrowNavigation(
  container: HTMLElement,
  itemSelector: string,
  getColCount: () => number,
  onFocus?: (el: HTMLElement) => void,
): void {
  container.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" &&
        e.key !== "ArrowUp"   && e.key !== "ArrowDown") return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    e.preventDefault();
    const cols = getColCount();
    let next = idx;
    if      (e.key === "ArrowRight" && cols > 1) next = Math.min(idx + 1, items.length - 1);
    else if (e.key === "ArrowLeft"  && cols > 1) next = Math.max(idx - 1, 0);
    else if (e.key === "ArrowDown")              next = Math.min(idx + cols, items.length - 1);
    else if (e.key === "ArrowUp")                next = Math.max(idx - cols, 0);
    if (next === idx) return;
    items[next].focus();
    onFocus?.(items[next]);
  });
}

/**
 * Remove <script> elements and inline event handlers from an HTML string.
 *
 * Used before assigning user-controlled markdown to innerHTML (EC-14, EC-17).
 *
 * Why three separate event-handler regexes (post-Reviewer-fix):
 * Real HTML/XML separates attributes with ANY whitespace (space, tab, newline)
 * — not just a literal ASCII space — AND permits unquoted attribute values.
 * An earlier implementation matched only ` on\w+="..."` and ` on\w+='...'`,
 * which let `<circle\nonclick="alert(1)"/>` (newline gap) and
 * `<circle onclick=alert(1)/>` (unquoted) survive sanitisation.
 *
 * The leading character class `[\s\/]` accepts any whitespace OR the `/` of a
 * self-closing tag (e.g. `<br/ onclick=...>`). The three value-form branches
 * cover double-quoted, single-quoted, and unquoted values; for unquoted the
 * value runs until the next whitespace or `>` (HTML tokeniser rule). `\s*` on
 * either side of `=` tolerates `onclick = "..."`.
 *
 * @param html - Rendered HTML string to sanitize.
 * @returns Sanitized HTML with script elements and event handlers removed.
 */
export function stripScripts(html: string): string {
  let sanitised = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    "",
  );
  // Double-quoted event-handler value.
  sanitised = sanitised.replace(/[\s\/]on\w+\s*=\s*"[^"]*"/gi, "");
  // Single-quoted event-handler value.
  sanitised = sanitised.replace(/[\s\/]on\w+\s*=\s*'[^']*'/gi, "");
  // Unquoted event-handler value — terminates at whitespace or `>`.
  sanitised = sanitised.replace(/[\s\/]on\w+\s*=\s*[^\s>]+/gi, "");
  return sanitised;
}
