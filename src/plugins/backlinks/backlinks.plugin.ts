/**
 * Backlinks Plugin (Steps 3, 4, 5, 6, 7, 8, 9)
 *
 * This module contains wiki-link parsing, decoration, navigation,
 * autocomplete, index building, sidebar panel, and plugin lifecycle
 * functionality for the backlinks feature.
 *
 * Step 3: parseWikiLinks, normalizeTarget, resolveWikiLinkPath,
 *         extractOutgoingLinks, isInsideFencedCode, filenameFromPath.
 * Step 4: computeWikiLinkDecorationRanges, buildWikiLinkDecorations,
 *         buildWikiLinkDecorationExtension, injectWikiLinkStyles,
 *         removeWikiLinkStyles.
 * Step 5: findWikiLinkAtPosition, handleWikiLinkClick.
 * Step 6: getCompletionContext, filterCompletions, setCachedFileList,
 *         buildAutocompleteExtension.
 * Step 7: computeBacklinks, buildIndex, scheduleIndexRebuild,
 *         resetIndexState, invokeListMdFiles, invokeReadFile.
 * Step 8: rebuildBacklinksDOM, injectBacklinksCSS, removeBacklinksCSS,
 *         _onScanningStateChanged, _onIndexRebuilt, _testing.
 * Step 9: Plugin export with onEnable/onDisable lifecycle.
 *
 * All functions are exported as named exports for direct test imports,
 * alongside the default plugin export used by the IIFE plugin loader.
 *
 * @module backlinks.plugin
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Represents a single wiki-link match found in document text.
 *
 * The `from` and `to` offsets describe the full `[[...]]` range
 * (including delimiters) so that decoration and click-handler code
 * can map these ranges directly to CM6 character positions.
 */
export interface WikiLinkMatch {
  /** Character offset of the opening `[[` in the input text. */
  from: number;
  /** Character offset just after the closing `]]`. */
  to: number;
  /** The target filename (before the pipe, if any). NOT normalized. */
  target: string;
  /** Display text (after the first pipe), or null if no pipe present. */
  displayText: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex for wiki-link syntax: `[[target]]` or `[[target|display text]]`.
 *
 * Rules (FR-1.2):
 * - Opening: exactly `[[` (two left brackets)
 * - Closing: exactly `]]` (two right brackets)
 * - Content must not contain `[`, `]`, or newlines
 * - Pipe separates target from display text (first pipe only)
 * - Global flag enables multiple matches per string
 *
 * The content group uses `*?` (zero or more, lazy) rather than `+?`
 * so that empty wiki-links `[[]]` are matched (EC-9).
 *
 * Capture groups:
 *   match[0] = full match including `[[` and `]]`
 *   match[1] = content between `[[` and `]]` (target or target|display)
 *   match.index = start position in input string
 */
export const WIKI_LINK_RE = /\[\[([^\[\]\n]*?)\]\]/g;

/**
 * Regex for standard Markdown link syntax: `[text](target)`.
 *
 * Used by `extractOutgoingLinks` to find standard links to `.md` files.
 * Only relative paths are kept; absolute paths and URLs are filtered
 * out by the caller (FR-6.2).
 *
 * Capture groups:
 *   match[1] = link target (the content inside parentheses)
 */
const MD_LINK_RE = /\[(?:[^\[\]])*\]\(([^)]+)\)/g;

/**
 * Regex to detect fenced code block delimiters (opening or closing).
 *
 * Matches lines that start with three or more backticks or tildes,
 * optionally followed by a language specifier. Used by
 * `isInsideFencedCode` to determine whether a character position
 * falls inside a code block.
 */
const FENCE_RE = /^(`{3,}|~{3,})/;

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Parse all wiki-links from a text string.
 *
 * Iterates over all `WIKI_LINK_RE` matches and splits each match's
 * content on the first `|` character to separate target from optional
 * display text. Matches that fall inside fenced code blocks are skipped.
 *
 * @param text - The full document text to scan.
 * @returns Array of `WikiLinkMatch` objects with from/to offsets,
 *          target filename, and optional display text.
 *
 * @example
 * parseWikiLinks("See [[notes]] and [[readme|Read Me]]")
 * // => [
 * //   { from: 4, to: 13, target: "notes", displayText: null },
 * //   { from: 18, to: 36, target: "readme", displayText: "Read Me" }
 * // ]
 */
export function parseWikiLinks(text: string): WikiLinkMatch[] {
  WIKI_LINK_RE.lastIndex = 0;
  const results: WikiLinkMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const content = match[1];

    /*
     * Split on the first pipe only. Everything before the first `|`
     * is the target; everything after is display text (EC-4, EC-5).
     * If no pipe exists, the entire content is the target.
     */
    const pipeIndex = content.indexOf("|");
    let target: string;
    let displayText: string | null;

    if (pipeIndex === -1) {
      target = content;
      displayText = null;
    } else {
      target = content.substring(0, pipeIndex);
      displayText = content.substring(pipeIndex + 1);
    }

    results.push({ from, to, target, displayText });
  }

  return results;
}

/**
 * Normalize a link target for comparison and file resolution.
 *
 * Processing order (FR-6.3):
 * 1. Trim leading and trailing whitespace.
 * 2. Strip a leading `./` prefix if present.
 * 3. Append `.md` if the target has no file extension.
 *
 * A target "has no extension" when there is no `.` character in the
 * filename portion (the part after the last `/`). This prevents
 * treating path components like `my.folder/notes` as having an
 * extension when the filename portion (`notes`) does not.
 *
 * @param target - Raw target string from a wiki-link or markdown link.
 * @returns The normalized target suitable for file path resolution.
 *
 * @example
 * normalizeTarget("  ./readme  ") // => "readme.md"
 * normalizeTarget("notes.md")     // => "notes.md"
 * normalizeTarget("archive.tar")  // => "archive.tar"
 */
export function normalizeTarget(target: string): string {
  /* Step 1: trim whitespace */
  let result = target.trim();

  /* Step 2: strip leading "./" */
  if (result.startsWith("./")) {
    result = result.substring(2);
  }

  /* Step 3: append ".md" if the filename portion has no extension */
  const lastSlash = result.lastIndexOf("/");
  const filenamePart = lastSlash === -1 ? result : result.substring(lastSlash + 1);

  if (!filenamePart.includes(".")) {
    result = result + ".md";
  }

  return result;
}

/**
 * Resolve a wiki-link target to an absolute file path.
 *
 * Steps (FR-3.2):
 * 1. Normalize the target via `normalizeTarget`.
 * 2. Extract the directory from `currentFilePath` (everything up to
 *    and including the last `/`).
 * 3. Concatenate directory + normalized target.
 *
 * @param currentFilePath - Absolute path to the currently open file.
 * @param target - Raw target string from the wiki-link.
 * @returns Absolute path to the resolved target file.
 *
 * @example
 * resolveWikiLinkPath("/Users/me/docs/current.md", "notes")
 * // => "/Users/me/docs/notes.md"
 */
export function resolveWikiLinkPath(
  currentFilePath: string,
  target: string
): string {
  const normalized = normalizeTarget(target);
  const lastSlash = currentFilePath.lastIndexOf("/");

  /*
   * If the path has no slash (unlikely for an absolute path but
   * handled defensively), treat the current directory as empty.
   */
  const directory =
    lastSlash === -1 ? "" : currentFilePath.substring(0, lastSlash);

  return directory + "/" + normalized;
}

/**
 * Check whether a character position falls inside a fenced code block.
 *
 * Scans the text line-by-line for fenced code block delimiters
 * (triple backticks or tildes). Toggles an "inside" flag each time a
 * delimiter is encountered. Returns the state of that flag at the
 * given position.
 *
 * This is a pure-text approach that works without CM6's syntax tree,
 * making it usable from the index builder (which reads raw file
 * content) as well as from the decoration ViewPlugin.
 *
 * @param text - The full document text.
 * @param pos - The character offset to check.
 * @returns `true` if `pos` is inside a fenced code block.
 */
export function isInsideFencedCode(text: string, pos: number): boolean {
  const lines = text.split("\n");
  let insideFence = false;
  let currentPos = 0;

  for (const line of lines) {
    /*
     * Check if this line is a fence delimiter. A fence delimiter
     * starts with three or more backticks or tildes, optionally
     * followed by a language specifier (e.g., "```typescript").
     */
    if (FENCE_RE.test(line.trimStart())) {
      /*
       * Only toggle BEFORE checking the position so that content
       * on the same line as an opening fence is considered "inside",
       * and content on the same line as a closing fence is still
       * "inside" (the fence line itself is part of the code block).
       *
       * However, the fence delimiter line itself is NOT content --
       * the toggle happens at the delimiter. If the position is on
       * a fence line, the behavior depends on whether we are opening
       * or closing. For simplicity and correctness with the spec,
       * we toggle before the position check when opening, and after
       * when closing. But since we track only a boolean, a simple
       * toggle-then-check gives the right answer: positions after
       * an opening fence are "inside", positions after a closing
       * fence are "outside".
       */
      insideFence = !insideFence;
    }

    /*
     * Check if the target position falls within this line.
     * Each line occupies [currentPos, currentPos + line.length].
     * The +1 accounts for the newline character between lines.
     */
    const lineEnd = currentPos + line.length;
    if (pos >= currentPos && pos <= lineEnd) {
      return insideFence;
    }

    /* Advance past this line plus its newline separator */
    currentPos = lineEnd + 1;
  }

  return insideFence;
}

/**
 * Extract all outgoing link targets from document content.
 *
 * Scans for two types of links (FR-6.2):
 * 1. **Wiki-links**: `[[target]]` and `[[target|display]]` -- the target
 *    portion is extracted and normalized.
 * 2. **Standard Markdown links**: `[text](target.md)` -- only relative
 *    paths that resolve to `.md` files are included. Absolute paths,
 *    URLs, and fragment-only links are ignored.
 *
 * Matches inside fenced code blocks are skipped (FR-2.4, EC-6).
 *
 * All targets are normalized via `normalizeTarget()`. Duplicates are
 * preserved intentionally -- the index builder handles deduplication.
 *
 * @param content - Full document text.
 * @returns Array of normalized link target filenames.
 *
 * @example
 * extractOutgoingLinks("See [[notes]] and [readme](readme.md)")
 * // => ["notes.md", "readme.md"]
 */
export function extractOutgoingLinks(content: string): string[] {
  const targets: string[] = [];

  /*
   * Pass 1: extract wiki-link targets.
   * Uses parseWikiLinks which already handles the regex iteration.
   * Skip links that fall inside fenced code blocks.
   */
  const wikiLinks = parseWikiLinks(content);
  for (const link of wikiLinks) {
    if (!isInsideFencedCode(content, link.from)) {
      targets.push(normalizeTarget(link.target));
    }
  }

  /*
   * Pass 2: extract standard Markdown link targets.
   * Filter out absolute paths, URLs, and fragment-only links per FR-6.2.
   */
  MD_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MD_LINK_RE.exec(content)) !== null) {
    const rawTarget = match[1];

    /* Skip if inside a fenced code block */
    if (isInsideFencedCode(content, match.index)) {
      continue;
    }

    /* Skip absolute paths (start with /) */
    if (rawTarget.startsWith("/")) {
      continue;
    }

    /* Skip URLs (http:// or https://) */
    if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://")) {
      continue;
    }

    /* Skip fragment-only links (start with #) */
    if (rawTarget.startsWith("#")) {
      continue;
    }

    /*
     * Normalize the target and only include if it ends with .md.
     * This filters out links to images, PDFs, etc.
     */
    const normalized = normalizeTarget(rawTarget);
    if (normalized.endsWith(".md")) {
      targets.push(normalized);
    }
  }

  return targets;
}

/**
 * Extract the filename component from an absolute file path.
 *
 * Splits on the last `/` and returns everything after it.
 * If the path has no `/`, the entire string is returned as the filename.
 *
 * @param filePath - An absolute or relative file path.
 * @returns The filename portion of the path.
 *
 * @example
 * filenameFromPath("/Users/me/docs/notes.md") // => "notes.md"
 * filenameFromPath("notes.md")                // => "notes.md"
 */
export function filenameFromPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return filePath;
  }
  return filePath.substring(lastSlash + 1);
}

// ---------------------------------------------------------------------------
// Step 4: Wiki-Link Decoration Ranges (Pure Logic)
// ---------------------------------------------------------------------------

/**
 * Describes a single decoration range produced by the wiki-link decoration
 * builder. This is the pure, testable output format that does not depend on
 * CM6's `Decoration` class. The `buildWikiLinkDecorations()` function maps
 * these ranges into actual CM6 `Decoration` objects.
 *
 * - `"replace"` — hides the range content via `Decoration.replace({})`.
 *   Used for `[[`, `]]`, and the `target|` prefix in piped wiki-links.
 * - `"mark"` — styles the range with `.cm-live-link` and `.cm-wiki-link`
 *   classes via `Decoration.mark(...)`. Used for the visible text portion.
 */
export interface WikiLinkDecorationRange {
  /** Start of the decoration range (absolute document offset). */
  from: number;
  /** End of the decoration range (absolute document offset). */
  to: number;
  /** Whether to hide (`replace`) or style (`mark`) this range. */
  type: "replace" | "mark";
}

/**
 * Determine the 1-based line number for a character offset in plain text.
 *
 * This is a local utility used by `computeWikiLinkDecorationRanges` to
 * map a character offset to a line number without depending on CM6's
 * `doc.lineAt()`. The function counts newline characters before `pos` to
 * determine the line.
 *
 * @param text - The full document text.
 * @param pos  - The character offset to resolve.
 * @returns 1-based line number.
 */
function lineNumberAtPos(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/**
 * Compute wiki-link decoration ranges from plain text.
 *
 * This is the pure, testable core of the wiki-link decoration system.
 * It scans a text string for wiki-links within the specified visible
 * ranges, filters out those on active lines or inside fenced code blocks,
 * and returns an array of `WikiLinkDecorationRange` objects describing
 * which portions to hide and which to style.
 *
 * The function is used directly in unit tests (where no CM6 editor exists)
 * and is called by `buildWikiLinkDecorations()` at runtime to produce the
 * actual CM6 `DecorationSet`.
 *
 * Decoration layout for `[[target]]` (no pipe):
 *   - replace `[[` (2 chars)
 *   - mark "target" (content between `[[` and `]]`)
 *   - replace `]]` (2 chars)
 *
 * Decoration layout for `[[target|display]]` (with pipe):
 *   - replace `[[` (2 chars)
 *   - replace "target|" (from after `[[` to after the first `|`)
 *   - mark "display" (from after `|` to before `]]`)
 *   - replace `]]` (2 chars)
 *
 * @param text          - The full document text.
 * @param activeLines   - Set of 1-based line numbers where the cursor is.
 *                        Wiki-links on these lines are skipped (raw syntax
 *                        is shown on active lines, per FR-2.2).
 * @param visibleRanges - Array of `{from, to}` character ranges that are
 *                        currently visible in the viewport. Only wiki-links
 *                        within these ranges are processed (NFR-3).
 * @returns Sorted array of decoration range descriptors.
 */
export function computeWikiLinkDecorationRanges(
  text: string,
  activeLines: Set<number>,
  visibleRanges: { from: number; to: number }[]
): WikiLinkDecorationRange[] {
  const results: WikiLinkDecorationRange[] = [];

  for (const { from: rangeFrom, to: rangeTo } of visibleRanges) {
    /*
     * Extract the text slice for this visible range.
     * parseWikiLinks returns offsets relative to the slice, so we add
     * rangeFrom to convert them to absolute document positions.
     */
    const slice = text.substring(rangeFrom, rangeTo);
    const matches = parseWikiLinks(slice);

    for (const match of matches) {
      /* Convert slice-relative offsets to absolute document positions */
      const absFrom = match.from + rangeFrom;
      const absTo = match.to + rangeFrom;

      /* Skip wiki-links on active lines (FR-2.2) */
      const lineNum = lineNumberAtPos(text, absFrom);
      if (activeLines.has(lineNum)) {
        continue;
      }

      /* Skip wiki-links inside fenced code blocks (FR-2.4, EC-6) */
      if (isInsideFencedCode(text, absFrom)) {
        continue;
      }

      /*
       * Build decoration ranges for this wiki-link.
       * The `[[` and `]]` delimiters are always 2 characters each.
       */
      const openEnd = absFrom + 2;
      const closeStart = absTo - 2;

      /* Hide the opening `[[` */
      results.push({ from: absFrom, to: openEnd, type: "replace" });

      if (match.displayText !== null) {
        /*
         * Piped wiki-link: [[target|display]]
         * Hide from after `[[` through and including the `|` character.
         * The pipe position within the content is at target.length offset
         * from the opening delimiter end.
         */
        const pipeEnd = openEnd + match.target.length + 1;
        results.push({ from: openEnd, to: pipeEnd, type: "replace" });

        /* Style the display text (from after `|` to before `]]`) */
        if (pipeEnd < closeStart) {
          results.push({ from: pipeEnd, to: closeStart, type: "mark" });
        }
      } else {
        /*
         * Simple wiki-link: [[target]]
         * Style the target text (from after `[[` to before `]]`).
         * Skip the mark if the content is empty (EC-9: `[[]]`).
         */
        if (openEnd < closeStart) {
          results.push({ from: openEnd, to: closeStart, type: "mark" });
        }
      }

      /* Hide the closing `]]` */
      results.push({ from: closeStart, to: absTo, type: "replace" });
    }
  }

  return results;
}

/**
 * Build a CM6 `DecorationSet` for wiki-link decorations.
 *
 * This is the CM6-specific wrapper around `computeWikiLinkDecorationRanges`.
 * It converts the pure decoration range descriptors into actual CM6
 * `Decoration` objects using the window globals (`__CM_VIEW__`).
 *
 * The function is called by the `WikiLinkPlugin` ViewPlugin on construction
 * and on every update. It reads the editor state to determine active lines
 * and visible ranges.
 *
 * @param view - The CM6 EditorView instance.
 * @returns A sorted, non-overlapping `DecorationSet`.
 */
export function buildWikiLinkDecorations(view: any): any {
  const { Decoration } = (window as any).__CM_VIEW__ as any;
  const state = view.state;

  /*
   * Compute active lines from the selection.
   * In view mode (cursor at 0, no interaction), the set is empty and all
   * wiki-links get decorated — this is correct behavior (FR-2.1).
   */
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let i = startLine; i <= endLine; i++) {
      activeLines.add(i);
    }
  }

  /* Get full document text for the pure function */
  const docText = state.doc.toString();

  /* Compute the pure decoration ranges */
  const decoRanges = computeWikiLinkDecorationRanges(
    docText,
    activeLines,
    view.visibleRanges
  );

  /* Convert to CM6 Decoration objects */
  const decorations: any[] = [];
  for (const range of decoRanges) {
    if (range.type === "replace") {
      decorations.push(
        Decoration.replace({}).range(range.from, range.to)
      );
    } else {
      decorations.push(
        Decoration.mark({
          class: "cm-live-link cm-wiki-link",
        }).range(range.from, range.to)
      );
    }
  }

  return Decoration.set(decorations, true);
}

/**
 * Build the wiki-link decoration ViewPlugin extension.
 *
 * Returns an array containing the CM6 ViewPlugin. This is intended to be
 * added to the editor's extension set via `api.addExtensions()` during
 * `onEnable` (Step 9).
 *
 * The ViewPlugin always rebuilds decorations on every update, matching the
 * behavior of `LivePreviewPlugin` in `live-preview.ts`. This is necessary
 * because the async Markdown parser dispatches transactions that don't set
 * `docChanged` or `selectionSet`, and fresh scanning is needed for those.
 *
 * @returns Array with the wiki-link ViewPlugin extension, or empty array
 *          if `__CM_VIEW__` is unavailable.
 */
export function buildWikiLinkDecorationExtension(): any[] {
  const cmView = (window as any).__CM_VIEW__;
  if (!cmView) {
    console.warn(
      "[backlinks] __CM_VIEW__ not available; wiki-link decorations disabled."
    );
    return [];
  }

  const { ViewPlugin } = cmView;

  /**
   * WikiLinkPlugin class.
   *
   * Follows the same pattern as `LivePreviewPlugin` in `live-preview.ts`:
   * - Constructor builds initial decorations.
   * - `update()` always rebuilds (async parser rationale).
   * - Decorations are provided via the `decorations` accessor.
   */
  class WikiLinkPlugin {
    decorations: any;

    constructor(view: any) {
      this.decorations = buildWikiLinkDecorations(view);
    }

    update(update: any) {
      this.decorations = buildWikiLinkDecorations(update.view);
    }
  }

  return [
    ViewPlugin.fromClass(WikiLinkPlugin, {
      decorations: (v: WikiLinkPlugin) => v.decorations,
    }),
  ];
}

/**
 * Inject the wiki-link CSS styles into the document head.
 *
 * Wiki-links reuse the existing `.cm-live-link` class for link styling
 * (FR-2.3). The additional `.cm-wiki-link` class is added for click
 * targeting by the click handler (Step 5). This function injects a
 * `<style>` tag with the wiki-link-specific styles.
 *
 * The style tag is identified by `data-markable-wiki-link-styles` so
 * it can be found and removed during plugin disable.
 */
export function injectWikiLinkStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector("[data-markable-wiki-link-styles]")) return;

  const style = document.createElement("style");
  style.setAttribute("data-markable-wiki-link-styles", "true");
  style.textContent = `
/* Wiki-link decoration styles (Step 4).
 * The .cm-live-link class provides base link styling (color, underline).
 * The .cm-wiki-link class enables click targeting by the click handler. */
.cm-wiki-link {
  cursor: pointer;
}
`;
  document.head.appendChild(style);
}

/**
 * Remove the wiki-link CSS styles from the document head.
 *
 * Called during plugin disable to clean up the injected `<style>` tag.
 */
export function removeWikiLinkStyles(): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector("[data-markable-wiki-link-styles]");
  if (el) el.remove();
}

// ---------------------------------------------------------------------------
// Step 5: Click-to-Navigate — Pure Helpers
// ---------------------------------------------------------------------------

/**
 * Find the wiki-link at a given absolute document position within a line.
 *
 * This is a pure, testable helper used by the click handler extension
 * (`buildClickHandler`). It runs `parseWikiLinks()` on the line text,
 * adjusts each match's `from` and `to` by the `lineFrom` offset to
 * convert from line-relative to absolute document positions, and returns
 * the first match whose range contains `clickPos`. Returns null if no
 * wiki-link contains the click position.
 *
 * The function is intentionally separated from the CM6 click handler
 * so that it can be tested without any DOM or editor dependency.
 *
 * @param lineText - The text content of the line where the click occurred.
 * @param lineFrom - The absolute document offset where this line begins.
 *                   Used to convert line-relative match positions to
 *                   absolute document positions.
 * @param clickPos - The absolute document position of the click.
 * @returns The `WikiLinkMatch` (with adjusted from/to) that contains
 *          `clickPos`, or `null` if the click is outside all wiki-links.
 *
 * @example
 * // Line "See [[notes]] end" starts at document offset 0
 * findWikiLinkAtPosition("See [[notes]] end", 0, 6)
 * // => { from: 4, to: 13, target: "notes", displayText: null }
 *
 * // Same line but starting at document offset 100
 * findWikiLinkAtPosition("See [[notes]] end", 100, 106)
 * // => { from: 104, to: 113, target: "notes", displayText: null }
 */
export function findWikiLinkAtPosition(
  lineText: string,
  lineFrom: number,
  clickPos: number
): WikiLinkMatch | null {
  const matches = parseWikiLinks(lineText);

  for (const match of matches) {
    /*
     * Convert line-relative offsets to absolute document positions
     * by adding lineFrom. This lets the caller compare directly
     * against the CM6 click position.
     */
    const absFrom = match.from + lineFrom;
    const absTo = match.to + lineFrom;

    if (clickPos >= absFrom && clickPos < absTo) {
      return {
        from: absFrom,
        to: absTo,
        target: match.target,
        displayText: match.displayText,
      };
    }
  }

  return null;
}

/**
 * Handle a wiki-link click by resolving the target and navigating.
 *
 * This function reads window globals to determine the current file path
 * and access the tab manager. It is designed to be called by
 * `buildClickHandler()` when a click lands on a wiki-link range.
 *
 * Edge case handling:
 * - EC-1: If `__MARKABLE_CURRENT_FILE__` is null (untitled document),
 *   shows an alert and returns without navigating.
 * - EC-30: If `__MARKABLE_TAB_MANAGER__` is missing or lacks
 *   `openFileInTab`, logs a warning and returns without navigating.
 * - EC-2: Self-links are passed through to openFileInTab, which
 *   activates the existing tab (no error).
 * - EC-3: Nonexistent files are handled by openFileInTab's own error
 *   reporting. No duplicate alert is shown by this function.
 * - EC-24: Navigation is independent of the backlink index -- it
 *   resolves the path directly via `resolveWikiLinkPath` and proceeds
 *   immediately regardless of index state.
 *
 * @param target - The raw wiki-link target string (before normalization).
 */
export async function handleWikiLinkClick(target: string): Promise<void> {
  const currentFile = (globalThis as any).__MARKABLE_CURRENT_FILE__ as
    | string
    | null;

  /* EC-1: untitled document has no file path to resolve against */
  if (!currentFile) {
    alert("Cannot navigate: document has no file path");
    return;
  }

  const tabManager = (globalThis as any).__MARKABLE_TAB_MANAGER__;

  /* EC-30: tab manager not available or missing the required method */
  if (!tabManager || typeof tabManager.openFileInTab !== "function") {
    console.warn(
      "[backlinks] Tab manager not available; click-to-navigate disabled."
    );
    return;
  }

  const resolvedPath = resolveWikiLinkPath(currentFile, target);

  /*
   * Delegate to the tab manager for file opening. The tab manager
   * handles all error cases (file not found, read errors) with its
   * own alert messages. We intentionally do not show a second alert
   * to avoid confusing double-dialog UX (see step_05 spec discussion).
   */
  void tabManager.openFileInTab(resolvedPath);
}

// ---------------------------------------------------------------------------
// Step 6: Auto-Complete Source
// ---------------------------------------------------------------------------

/**
 * Cached list of sibling `.md` filenames in the current file's directory.
 *
 * Populated by the index builder (Step 7) after calling `listMdFiles()`.
 * The autocomplete `CompletionSource` reads from this array to build
 * completion options. An empty array means either no sibling files exist
 * or the index has not been built yet (e.g., untitled document — EC-1).
 */
let _cachedFileList: string[] = [];

/**
 * Update the cached file list.
 *
 * Called by the index builder (Step 7) after a successful directory scan.
 * The autocomplete source reads `_cachedFileList` on every invocation, so
 * calling this function immediately affects subsequent completions without
 * requiring a CM6 transaction or state update.
 *
 * @param files - Array of `.md` filenames (e.g., `["notes.md", "readme.md"]`).
 */
export function setCachedFileList(files: string[]): void {
  _cachedFileList = files;
}

/**
 * Retrieve the `@codemirror/autocomplete` module from the window global.
 *
 * Returns `undefined` if the global has not been set (EC-29). The caller
 * must handle this gracefully by skipping autocomplete registration.
 *
 * @returns The autocomplete module namespace, or `undefined`.
 */
function getCmAutocomplete(): typeof import("@codemirror/autocomplete") | undefined {
  return (window as any).__CM_AUTOCOMPLETE__ as
    typeof import("@codemirror/autocomplete") | undefined;
}

/**
 * Determine whether the cursor is inside an open `[[` wiki-link context.
 *
 * Scans backward from `cursorInLine` (a zero-based offset within `lineText`)
 * looking for the nearest `[[` that has no matching `]]` between it and the
 * cursor. This is the pure, testable core of the `CompletionSource`.
 *
 * Algorithm:
 * 1. Search backward from the cursor for `[[`.
 * 2. If found, check whether `]]` appears between the `[[` and the cursor.
 * 3. If `]]` is found between `[[` and cursor, that `[[` is already closed.
 *    Continue searching backward before that `[[` for another open one.
 * 4. If no `]]` is found, return the position after `[[` (the start of the
 *    typed prefix) and the substring between `[[` and cursor as the prefix.
 *
 * @param lineText - The full text of the current line.
 * @param cursorInLine - Zero-based cursor offset within `lineText`.
 * @returns Object with `from` (position after `[[` in the line) and `prefix`
 *          (text typed after `[[`), or `null` if no open context exists.
 *
 * @example
 * getCompletionContext("See [[not", 9)
 * // => { from: 6, prefix: "not" }
 *
 * getCompletionContext("See [[done]] more", 17)
 * // => null (the [[ is already closed)
 */
export function getCompletionContext(
  lineText: string,
  cursorInLine: number
): { from: number; prefix: string } | null {
  /*
   * Only consider the portion of the line up to the cursor position.
   * This prevents a closing `]]` after the cursor from affecting our
   * decision (the user may be editing inside an existing wiki-link).
   */
  const textBeforeCursor = lineText.substring(0, cursorInLine);

  /*
   * Search backward for the last `[[` in the text before the cursor.
   * We iterate backward so that if multiple `[[` exist, we find the
   * nearest (most relevant) one first.
   */
  let searchEnd = textBeforeCursor.length;

  while (searchEnd > 0) {
    const bracketPos = textBeforeCursor.lastIndexOf("[[", searchEnd - 1);

    /* No more `[[` found — no open wiki-link context */
    if (bracketPos === -1) {
      return null;
    }

    /*
     * Check if there is a `]]` between this `[[` and the cursor.
     * If so, this wiki-link is already closed and we should look
     * for an earlier `[[`.
     */
    const afterBracket = textBeforeCursor.substring(bracketPos + 2);
    if (afterBracket.includes("]]")) {
      /* This [[ is closed — search further back */
      searchEnd = bracketPos;
      continue;
    }

    /* Found an open `[[` — extract the prefix typed after it */
    const from = bracketPos + 2;
    const prefix = textBeforeCursor.substring(from);
    return { from, prefix };
  }

  return null;
}

/**
 * Filter a list of `.md` filenames by a case-insensitive prefix match.
 *
 * The prefix is compared against the filename WITHOUT the `.md` extension,
 * matching the way filenames are displayed in the autocomplete popup
 * (FR-4.3). The current file is excluded from results (FR-4.5) using a
 * case-insensitive comparison to handle macOS APFS case-insensitivity (AD-5).
 *
 * @param files - Array of `.md` filenames to filter.
 * @param prefix - The text typed after `[[`. Empty string matches all files.
 * @param currentFile - Filename of the current file to exclude, or `null`
 *                      if no file is open (untitled document).
 * @returns Sorted array of matching filenames (with `.md` extension).
 *
 * @example
 * filterCompletions(["notes.md", "readme.md"], "not", null)
 * // => ["notes.md"]
 *
 * filterCompletions(["notes.md", "readme.md"], "", "notes.md")
 * // => ["readme.md"]
 */
export function filterCompletions(
  files: string[],
  prefix: string,
  currentFile: string | null
): string[] {
  const lowerPrefix = prefix.toLowerCase();

  return files
    .filter((filename) => {
      /* Exclude the current file using case-insensitive comparison (AD-5) */
      if (
        currentFile &&
        filename.localeCompare(currentFile, undefined, {
          sensitivity: "base",
        }) === 0
      ) {
        return false;
      }

      /*
       * Compare the prefix against the filename without .md extension.
       * This matches the display format shown in the autocomplete popup.
       */
      const nameWithoutExt = filename.endsWith(".md")
        ? filename.slice(0, -3)
        : filename;

      return nameWithoutExt.toLowerCase().startsWith(lowerPrefix);
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Build a CM6 `autocompletion()` extension for wiki-link completions.
 *
 * Creates a `CompletionSource` that activates when the cursor follows `[[`
 * and no `]]` exists between `[[` and the cursor. The source reads from
 * `_cachedFileList` (populated by the index builder in Step 7) and filters
 * by the typed prefix.
 *
 * If `window.__CM_AUTOCOMPLETE__` is not available (EC-29), logs a warning
 * and returns an empty array so the rest of the plugin still works.
 *
 * The returned extension array is intended to be passed to
 * `api.addExtensions()` during `onEnable` (Step 9).
 *
 * @returns Array containing the `autocompletion` extension, or an empty
 *          array if the autocomplete global is unavailable.
 */
export function buildAutocompleteExtension(): any[] {
  const cmAuto = getCmAutocomplete();
  if (!cmAuto) {
    console.warn(
      "[backlinks] __CM_AUTOCOMPLETE__ not available; auto-complete disabled."
    );
    return [];
  }

  /**
   * CM6 CompletionSource for wiki-link `[[` syntax.
   *
   * Uses `context.matchBefore()` to detect whether the cursor is
   * preceded by `[[` followed by optional non-bracket characters.
   * Delegates to pure helpers `getCompletionContext` and `filterCompletions`
   * for the testable logic, then builds CM6 `Completion` objects.
   */
  const wikiLinkCompletionSource = (context: any): any => {
    /*
     * matchBefore scans backward from the cursor for the given pattern.
     * The pattern matches `[[` followed by zero or more characters that
     * are not `]` or newline. This gives us the raw text from `[[` to cursor.
     */
    const before = context.matchBefore(/\[\[([^\]\n]*)/);
    if (!before) return null;

    /*
     * Extract the prefix (text typed after `[[`).
     * The matched text starts with `[[`, so skip 2 characters.
     */
    const prefix = before.text.slice(2);

    /*
     * Safety check: if `]]` appears between `[[` and cursor, the
     * wiki-link is already closed and we should not offer completions.
     */
    if (prefix.includes("]]")) return null;

    /*
     * Determine the current filename to exclude self-references (FR-4.5).
     * If no file is open (untitled document, EC-1), currentFilename is null.
     */
    const currentFilePath = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
    const currentFilename = currentFilePath
      ? filenameFromPath(currentFilePath)
      : null;

    /* Filter the cached file list using pure helper */
    const matchingFiles = filterCompletions(
      _cachedFileList,
      prefix,
      currentFilename
    );

    /* If no files match, return null so the popup does not appear (EC-22) */
    if (matchingFiles.length === 0) return null;

    /*
     * Build CM6 Completion objects.
     * - `label`: filename without .md (what the user sees in the popup)
     * - `apply`: custom apply function that inserts filename + `]]`,
     *   but skips `]]` if it already exists after the cursor (EC-23)
     * - `type`: "file" icon hint for the completion popup
     */
    const options = matchingFiles.map((filename: string) => {
      const label = filename.endsWith(".md")
        ? filename.slice(0, -3)
        : filename;

      return {
        label,
        apply: (view: any, _completion: any, from: number, to: number) => {
          /*
           * Check if `]]` already follows the cursor position.
           * If so, do not insert duplicate closing brackets (EC-23).
           */
          const docLength = view.state.doc.length;
          const after = view.state.doc.sliceString(
            to,
            Math.min(to + 2, docLength)
          );
          const closingBrackets = after === "]]" ? "" : "]]";

          view.dispatch({
            changes: { from, to, insert: label + closingBrackets },
            selection: {
              anchor: from + label.length + closingBrackets.length,
            },
          });
        },
        type: "file",
      };
    });

    return {
      from: before.from + 2,
      options,
      filter: true,
    };
  };

  return [
    cmAuto.autocompletion({
      override: [wikiLinkCompletionSource],
    }),
  ];
}

// ---------------------------------------------------------------------------
// Step 7: Backlink Index Builder
// ---------------------------------------------------------------------------

/**
 * The backlink index: maps each sibling filename to its array of
 * normalized outgoing link targets. Built by `buildIndex()` and
 * queried by `computeBacklinks()`.
 *
 * This is the core data structure of the backlinks feature. Each key
 * is a `.md` filename (e.g., "notes.md") and each value is an array
 * of normalized targets extracted from that file's content (e.g.,
 * ["readme.md", "todo.md"]).
 */
let _linkIndex: Map<string, string[]> = new Map();

/**
 * The directory path that the current index was built from.
 * Used to detect directory changes on tab switch (EC-13).
 * When the directory changes, a full index rebuild is triggered.
 */
let _currentDir: string | null = null;

/**
 * Debounce timer handle for `scheduleIndexRebuild()`.
 * Cleared and reset on each call to enforce the 300ms debounce window.
 */
let _rebuildTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Whether an index rebuild is currently in progress.
 * Used to prevent overlapping rebuilds (EC-12). When true and a new
 * rebuild is triggered, the timer is simply reset -- the in-progress
 * async work will complete but its results are discarded because the
 * callback reference has been replaced by the newer call.
 */
let _rebuildInProgress = false;

/**
 * Invoke the Tauri `list_md_files` command directly via window globals.
 *
 * IIFE plugins cannot import from `@tauri-apps/api/core` (it would
 * create a separate bundled instance). Instead, we call the same
 * `__TAURI_INTERNALS__.invoke` that the Tauri API uses internally.
 * This is the established pattern for IIFE plugin I/O in Markable.
 *
 * @param directoryPath - Absolute path to the directory to scan.
 * @returns Array of `.md` filenames, or empty array on error.
 */
async function invokeListMdFiles(directoryPath: string): Promise<string[]> {
  try {
    return await (window as any).__TAURI_INTERNALS__.invoke(
      "list_md_files",
      { path: directoryPath }
    );
  } catch (error) {
    console.error("[backlinks] Failed to list md files:", error);
    return [];
  }
}

/**
 * Invoke the Tauri `read_file` command directly via window globals.
 *
 * Returns a discriminated union so callers can distinguish success
 * from failure without try/catch at every call site. Follows the
 * same `{ ok, value/error }` pattern as `bridge.ts`'s `readFile()`.
 *
 * @param path - Absolute path to the file to read.
 * @returns Success with file content string, or failure with error message.
 */
async function invokeReadFile(
  path: string
): Promise<{ ok: true; value: string } | { ok: false; error: { message: string } }> {
  try {
    const content = await (window as any).__TAURI_INTERNALS__.invoke(
      "read_file",
      { path }
    );
    return { ok: true, value: content };
  } catch (error) {
    return { ok: false, error: { message: String(error) } };
  }
}

/**
 * Compute which files in the index link back to the current file.
 *
 * This is a **pure function** with no side effects -- it reads from
 * the provided index map and returns a new sorted array. This makes
 * it fully testable without any mocking.
 *
 * A file is considered a backlink source if any of its outgoing link
 * targets match `currentFilename` using case-insensitive comparison
 * (via `localeCompare` with `sensitivity: "base"`), matching macOS
 * APFS case-insensitivity behavior (AD-5).
 *
 * Self-links are excluded: if the current file contains a wiki-link
 * to itself, it does not appear in its own backlink list.
 *
 * @param index - The backlink index (filename -> outgoing targets).
 * @param currentFilename - The filename to find backlinks for.
 * @returns Sorted array of filenames that link to `currentFilename`.
 */
export function computeBacklinks(
  index: Map<string, string[]>,
  currentFilename: string
): string[] {
  const backlinks: string[] = [];

  for (const [filename, outgoingLinks] of index) {
    /*
     * Skip self: a file should not appear as its own backlink.
     * Uses case-insensitive comparison because macOS APFS treats
     * "Notes.md" and "notes.md" as the same file (AD-5).
     */
    if (
      filename.localeCompare(currentFilename, undefined, {
        sensitivity: "base",
      }) === 0
    ) {
      continue;
    }

    /*
     * Check if any of this file's outgoing links target the current
     * file. The comparison is case-insensitive for the same reason.
     */
    const linksToCurrentFile = outgoingLinks.some(
      (target) =>
        target.localeCompare(currentFilename, undefined, {
          sensitivity: "base",
        }) === 0
    );

    if (linksToCurrentFile) {
      backlinks.push(filename);
    }
  }

  /* Sort alphabetically using case-insensitive comparison */
  backlinks.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  return backlinks;
}

/**
 * Build the backlink index for all `.md` files in a directory.
 *
 * This async function:
 * 1. Lists all `.md` files in the directory via Tauri command.
 * 2. Reads each file's content.
 * 3. Extracts outgoing links using `extractOutgoingLinks()`.
 * 4. Normalizes each target via `normalizeTarget()` (already done
 *    inside `extractOutgoingLinks`).
 * 5. Builds and returns the index map.
 *
 * Files that fail to read (binary content, permission denied, etc.)
 * are skipped with a console warning (EC-20, EC-21). The remaining
 * files are still indexed.
 *
 * Also calls `setCachedFileList()` to update the autocomplete file
 * list with the directory contents.
 *
 * @param directoryPath - Absolute path to the directory to scan.
 * @returns Map where keys are filenames and values are arrays of
 *          normalized outgoing link targets.
 */
export async function buildIndex(
  directoryPath: string
): Promise<Map<string, string[]>> {
  const newIndex = new Map<string, string[]>();

  /* Step 1: list all sibling .md files */
  const files = await invokeListMdFiles(directoryPath);

  /* Update autocomplete cache with the file list */
  setCachedFileList(files);

  /* Step 2: read each file and extract outgoing links */
  for (const filename of files) {
    const filePath = `${directoryPath}/${filename}`;
    const result = await invokeReadFile(filePath);

    if (!result.ok) {
      /*
       * EC-20, EC-21: Skip files that cannot be read (binary content,
       * permission denied, etc.). Log a warning so the user can
       * investigate if needed, but do not halt the index build.
       */
      console.warn(
        `[backlinks] Skipping unreadable file: ${filename} (${result.error.message})`
      );
      continue;
    }

    const outgoingLinks = extractOutgoingLinks(result.value);
    newIndex.set(filename, outgoingLinks);
  }

  return newIndex;
}

/**
 * Schedule a debounced index rebuild.
 *
 * This function implements the 300ms debounce described in FR-6.5.
 * Each call clears any pending timer and starts a new one. When the
 * timer fires, it:
 * 1. Reads `__MARKABLE_CURRENT_FILE__` to determine the current file.
 * 2. If null (untitled document, EC-14), calls callback with `[]`.
 * 3. Otherwise, derives the directory, calls `buildIndex()`, then
 *    `computeBacklinks()`, and passes the result to the callback.
 *
 * The `_rebuildInProgress` flag prevents stale results from leaking
 * into the callback when a newer rebuild supersedes an older one (EC-12).
 *
 * @param callback - Function called with the computed backlinks array
 *                   after the index rebuild completes.
 */
export function scheduleIndexRebuild(
  callback: (backlinks: string[], outgoing: string[]) => void
): void {
  /* Clear any pending debounce timer (EC-12: new trigger replaces old) */
  if (_rebuildTimer !== null) {
    clearTimeout(_rebuildTimer);
    _rebuildTimer = null;
  }

  _rebuildTimer = setTimeout(async () => {
    const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as
      | string
      | null;

    /*
     * EC-14: untitled document has no file path. Clear the index
     * and call the callback with an empty backlinks list.
     */
    if (!currentFile) {
      _linkIndex.clear();
      _currentDir = null;
      setCachedFileList([]);
      callback([], []);
      return;
    }

    /* Derive directory and filename from the current file path */
    const dir = currentFile.replace(/\/[^/]*$/, "");
    const currentFilename = filenameFromPath(currentFile);

    _rebuildInProgress = true;

    try {
      const newIndex = await buildIndex(dir);

      /* Commit the new index to module-level state */
      _linkIndex = newIndex;
      _currentDir = dir;

      /* Compute backlinks and outgoing links for the current file */
      const backlinks = computeBacklinks(_linkIndex, currentFilename);
      const outgoing = _linkIndex.get(currentFilename) ?? [];
      callback(backlinks, outgoing);
    } finally {
      _rebuildInProgress = false;
    }
  }, 300);
}

/**
 * Reset all module-level index state to initial values.
 *
 * Called during `onDisable` to ensure no stale timers, index data,
 * or flags persist after the plugin is disabled. Safe to call
 * multiple times (idempotent).
 */
export function resetIndexState(): void {
  if (_rebuildTimer !== null) {
    clearTimeout(_rebuildTimer);
    _rebuildTimer = null;
  }

  _linkIndex = new Map();
  _currentDir = null;
  _rebuildInProgress = false;
  setCachedFileList([]);
}

// ---------------------------------------------------------------------------
// Step 8: Sidebar Panel — Module-Level State
// ---------------------------------------------------------------------------

/**
 * The `.backlinks-list` div inside the sidebar panel.
 *
 * Set by the panel's `render()` callback and nulled by `destroy()`.
 * When null, `rebuildBacklinksDOM()` is a no-op (panel not mounted).
 */
let _backlinksListEl: HTMLElement | null = null;

/**
 * Whether the index is currently being rebuilt.
 *
 * When true, `rebuildBacklinksDOM()` shows "Scanning..." instead of
 * the backlinks list or empty state. Set by the `_onScanningStateChanged`
 * callback (wired in the panel's `render()` callback).
 */
let _isScanning = false;

/**
 * Most recent backlinks result (array of `.md` filenames).
 *
 * Updated by the `_onIndexRebuilt` callback (wired in the panel's
 * `render()` callback). An empty array means either no backlinks
 * exist or the index has not been built yet.
 */
let _currentBacklinks: string[] = [];

/** Outgoing links from the current file (forward links). */
let _currentOutgoing: string[] = [];

/**
 * Callback invoked by the index builder (Step 7) when the scanning
 * state changes. Wired in the panel's `render()` callback.
 * Null when the panel is not mounted.
 */
export let _onScanningStateChanged: ((scanning: boolean) => void) | null = null;

/**
 * Callback invoked by the index builder (Step 7) when the index has
 * been rebuilt with a new set of backlinks. Wired in the panel's
 * `render()` callback. Null when the panel is not mounted.
 */
export let _onIndexRebuilt: ((backlinks: string[]) => void) | null = null;

// ---------------------------------------------------------------------------
// Step 8: Sidebar Panel — CSS
// ---------------------------------------------------------------------------

/**
 * CSS styles for the backlinks sidebar panel.
 *
 * All colors use existing CSS variables so the panel automatically
 * adopts the active theme (NFR-5). Font sizes are hard-coded in px
 * (12px) and independent of editor zoom, matching the auto-toc panel
 * pattern.
 *
 * Style classes:
 * - `.backlinks-list` — the scrollable container for backlink items.
 * - `.backlink-item` — a single clickable backlink entry (button).
 * - `.backlink-item:hover` — hover state with background highlight
 *   and left border accent.
 * - `.backlink-empty` — centered message for empty and scanning states.
 */
const BACKLINKS_CSS = `
.backlinks-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.backlink-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.backlink-item:hover {
  background: var(--code-bg);
  color: var(--text-primary);
  border-left-color: var(--link-color);
}

.backlink-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}

.backlinks-section-header {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  padding: 8px 12px 4px;
  user-select: none;
  opacity: 0.7;
}

.backlinks-section-header:not(:first-child) {
  margin-top: 8px;
  border-top: 1px solid var(--border-color, rgba(255,255,255,0.06));
  padding-top: 10px;
}
`;

/** Style tag ID for idempotent CSS injection (no duplicate tags). */
const BACKLINKS_STYLE_ID = "__markable_backlinks_css__";

/**
 * Inject the backlinks panel CSS into the document head.
 *
 * Guarded by the element id so repeated calls (from rapid enable/disable
 * cycles) never insert duplicate `<style>` tags.
 */
export function injectBacklinksCSS(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(BACKLINKS_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = BACKLINKS_STYLE_ID;
  style.textContent = BACKLINKS_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the backlinks panel CSS from the document head.
 *
 * No-op if the tag is not present (e.g., `onDisable` called before
 * `onEnable`, or running in a test environment).
 */
export function removeBacklinksCSS(): void {
  if (typeof document === "undefined") return;
  document.getElementById(BACKLINKS_STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Step 8: Sidebar Panel — DOM Rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuild the backlinks panel DOM from current module-level state.
 *
 * This function reads `_backlinksListEl`, `_isScanning`, and
 * `_currentBacklinks` to determine what to render. It is called:
 * - By the panel's `render()` callback (initial state).
 * - By `_onScanningStateChanged` (scanning starts/stops).
 * - By `_onIndexRebuilt` (new backlinks available).
 *
 * Rendering priority:
 * 1. If `_backlinksListEl` is null: no-op (panel not mounted).
 * 2. If `_isScanning` is true: show "Scanning..." message.
 * 3. If `_currentBacklinks` is empty: show "No backlinks" message.
 * 4. Otherwise: render sorted list of clickable backlink buttons.
 *
 * Each backlink button displays the filename without `.md` extension
 * and navigates to the file on click via `tabManager.openFileInTab()`.
 * The title attribute shows the full filename for truncated names.
 */
export function rebuildBacklinksDOM(): void {
  if (!_backlinksListEl) return;

  _backlinksListEl.innerHTML = "";

  /* Scanning state */
  if (_isScanning) {
    const el = document.createElement("div");
    el.className = "backlink-empty";
    el.textContent = "Scanning...";
    _backlinksListEl.appendChild(el);
    return;
  }

  const hasBacklinks = _currentBacklinks.length > 0;
  const hasOutgoing = _currentOutgoing.length > 0;

  /* Empty state: neither backlinks nor outgoing */
  if (!hasBacklinks && !hasOutgoing) {
    const el = document.createElement("div");
    el.className = "backlink-empty";
    el.textContent = "No links";
    _backlinksListEl.appendChild(el);
    return;
  }

  /* Helper: create a clickable file entry */
  const makeItem = (filename: string) => {
    const btn = document.createElement("button");
    btn.className = "backlink-item";
    btn.textContent = filename.endsWith(".md")
      ? filename.slice(0, -3)
      : filename;
    btn.title = filename;
    btn.addEventListener("click", () => {
      const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
      const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
      if (!tabManager || !currentFile) return;
      const dir = currentFile.replace(/\/[^/]*$/, "");
      void tabManager.openFileInTab(`${dir}/${filename}`);
    });
    return btn;
  };

  /* Section: Backlinks (files linking TO this file) */
  if (hasBacklinks) {
    const header = document.createElement("div");
    header.className = "backlinks-section-header";
    header.textContent = `Backlinks (${_currentBacklinks.length})`;
    _backlinksListEl.appendChild(header);

    const sorted = [..._currentBacklinks].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    for (const filename of sorted) {
      _backlinksListEl.appendChild(makeItem(filename));
    }
  }

  /* Section: Outgoing links (files this file links TO) */
  if (hasOutgoing) {
    const header = document.createElement("div");
    header.className = "backlinks-section-header";
    header.textContent = `Links (${_currentOutgoing.length})`;
    _backlinksListEl.appendChild(header);

    const sorted = [..._currentOutgoing].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    for (const filename of sorted) {
      _backlinksListEl.appendChild(makeItem(filename));
    }
  }
}

// ---------------------------------------------------------------------------
// Step 8: Test Accessor
// ---------------------------------------------------------------------------

/**
 * Testing-only accessor for module-level panel state.
 *
 * Exported so that unit tests can directly manipulate the private
 * module-level variables (`_backlinksListEl`, `_isScanning`,
 * `_currentBacklinks`) without going through the full panel
 * registration lifecycle. This avoids coupling tests to the sidebar
 * system infrastructure.
 *
 * This object is NOT part of the public plugin API and should never
 * be used by production code outside of the test suite.
 */
export const _testing = {
  /** Set the backlinks list DOM element reference. */
  setBacklinksListEl(el: HTMLElement | null): void {
    _backlinksListEl = el;
  },

  /** Set the scanning state flag. */
  setIsScanning(scanning: boolean): void {
    _isScanning = scanning;
  },

  /** Set the current backlinks array. */
  setCurrentBacklinks(backlinks: string[]): void {
    _currentBacklinks = backlinks;
  },

  /** Get the current backlinks list element (for assertions). */
  getBacklinksListEl(): HTMLElement | null {
    return _backlinksListEl;
  },
};

// ---------------------------------------------------------------------------
// Step 9: Plugin Lifecycle — Module-Level Flags
// ---------------------------------------------------------------------------

/**
 * Whether the plugin is currently enabled.
 *
 * Set to true in onEnable, false in onDisable. Guards all async
 * callbacks (debounce timers, index builder results) so they become
 * no-ops if the plugin was disabled while they were pending.
 */
let _enabled = false;

/**
 * The last known file path from `__MARKABLE_CURRENT_FILE__`.
 *
 * Used by the tab-switch detection listener to detect when the user
 * switches tabs (the file path changes). When the path changes, the
 * index is rebuilt for the new directory.
 */
let _lastKnownFile: string | null = null;

/** Document-level click handler for wiki-link navigation. Stored for cleanup. */
let _wikiLinkClickHandler: ((e: MouseEvent) => void) | null = null;

/** Interval timer for polling file path changes (fallback for tab switch detection). */
let _pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Live EditorView reference captured from the CM6 updateListener.
 *
 * Null until the first CM6 transaction fires after onEnable. Used by
 * the sidebar panel to access editor state without a direct import.
 */
let _view: any = null;

// ---------------------------------------------------------------------------
// Step 9: Plugin Export
// ---------------------------------------------------------------------------

// Type-only import — erased by tsc, no runtime code emitted.
import type { MarkablePluginAPI } from "../markable-plugin-api";

/**
 * Backlinks plugin definition.
 *
 * Provides wiki-link syntax (`[[target]]` and `[[target|display]]`)
 * with live preview decorations, click-to-navigate, auto-complete,
 * and a sidebar panel showing files that link back to the current
 * document.
 *
 * onEnable sequence:
 *   1. Set _enabled flag.
 *   2. Inject CSS (wiki-link styles + backlinks panel styles).
 *   3. Build CM6 extensions: decoration ViewPlugin, click handler,
 *      autocomplete, tab-switch + doc-change listeners.
 *   4. Register extensions via api.addExtensions().
 *   5. Register sidebar panel via api.registerSidebarPanel().
 *   6. Trigger initial index build.
 *
 * onDisable sequence (exact reversal):
 *   1. Clear _enabled flag.
 *   2. Cancel all pending timers (via resetIndexState).
 *   3. Remove CM6 extensions via api.removeExtensions().
 *   4. Unregister sidebar panel via api.unregisterSidebarPanel().
 *   5. Remove injected CSS (both wiki-link and backlinks styles).
 *   6. Clear all module-level state.
 */
const plugin = {
  id: "backlinks",
  name: "Backlinks",
  version: "1.0.0",
  description: "Wiki-link syntax and backlink tracking",
  detail:
    "Adds [[wiki-link]] syntax with auto-complete, live preview decorations, " +
    "click-to-navigate, and a sidebar panel showing files that link to the " +
    "current document.",
  sidebarPanelId: "backlinks",

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;

    /* Step 1: Inject CSS for wiki-link decorations and backlinks panel */
    injectWikiLinkStyles();
    injectBacklinksCSS();

    /* Step 2-3: Build CM6 extensions array */
    const cmView = (window as any).__CM_VIEW__;
    const extensions: any[] = [];

    /* Wiki-link decoration ViewPlugin (Step 4) */
    extensions.push(...buildWikiLinkDecorationExtension());

    /*
     * Click handler for wiki-link navigation (Step 5).
     * Uses EditorView.domEventHandlers to intercept clicks on
     * decorated wiki-link ranges.
     */
    if (cmView && cmView.EditorView) {
      /*
       * Click handler for wiki-link navigation.
       * Uses a document-level click listener (not CM6 domEventHandlers)
       * to avoid interfering with CM6's mousedown/selection handling.
       * The listener is added on enable and removed on disable.
       */
      const clickHandler = (event: MouseEvent) => {
        if (!_enabled) return;
        const target = event.target as HTMLElement;
        if (!target) return;

        /* Check if click landed on a decorated .cm-wiki-link span */
        const wikiEl = target.closest(".cm-wiki-link") as HTMLElement | null;
        if (!wikiEl) return;

        /* Find the wiki-link target from the document text at this position */
        const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
        if (!editorView) return;

        const pos = editorView.posAtDOM(wikiEl);
        if (pos === null || pos === undefined) return;

        const line = editorView.state.doc.lineAt(pos);
        const match = findWikiLinkAtPosition(line.text, line.from, pos);
        if (!match) return;

        event.preventDefault();
        event.stopPropagation();
        void handleWikiLinkClick(match.target);
      };

      document.addEventListener("click", clickHandler, true);
      _wikiLinkClickHandler = clickHandler;
    }

    /* Autocomplete extension (Step 6) — gracefully absent if global missing */
    extensions.push(...buildAutocompleteExtension());

    /*
     * Tab-switch and doc-change listener (Step 7).
     * A single EditorView.updateListener handles both:
     * - Detecting tab switches by monitoring __MARKABLE_CURRENT_FILE__
     * - Triggering index rebuilds on document saves (via menu-event)
     */
    if (cmView && cmView.EditorView) {
      extensions.push(
        cmView.EditorView.updateListener.of((update: any) => {
          if (!_enabled) return;

          /* Always capture the latest view reference */
          _view = update.view;

          /*
           * Check the current file on EVERY update (not just docChanged).
           * Tab switches update __MARKABLE_CURRENT_FILE__ and dispatch a
           * doc-replace transaction. We poll on every update tick because
           * the global may be set slightly after the transaction fires.
           */
          const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as
            | string
            | null;
          if (currentFile !== _lastKnownFile) {
            _lastKnownFile = currentFile;
            _isScanning = true;
            rebuildBacklinksDOM();
            scheduleIndexRebuild((backlinks, outgoing) => {
              if (!_enabled) return;
              _currentBacklinks = backlinks;
              _currentOutgoing = outgoing;
              _isScanning = false;
              rebuildBacklinksDOM();
            });
          }
        })
      );
    }

    /*
     * Fallback: poll for file path changes every 500ms.
     * The CM6 updateListener only fires on editor transactions.
     * If the tab switch doesn't trigger a transaction (e.g. when
     * clicking a wiki-link opens a file via tabManager), this
     * interval catches the change.
     */
    _pollTimer = setInterval(() => {
      if (!_enabled) return;
      const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as
        | string
        | null;
      if (currentFile !== _lastKnownFile) {
        _lastKnownFile = currentFile;
        _isScanning = true;
        rebuildBacklinksDOM();
        scheduleIndexRebuild((backlinks, outgoing) => {
          if (!_enabled) return;
          _currentBacklinks = backlinks;
          _currentOutgoing = outgoing;
          _isScanning = false;
          rebuildBacklinksDOM();
        });
      }
    }, 500);

    /* Step 4: Register extensions with the editor */
    api.addExtensions(extensions);

    /* Step 5: Register sidebar panel */
    api.registerSidebarPanel({
      id: "backlinks",
      title: "Backlinks",
      side: "right",
      defaultWidth: 220,

      render(container: HTMLElement): void {
        const list = document.createElement("div");
        list.className = "backlinks-list";
        container.appendChild(list);
        _backlinksListEl = list;

        /* Wire up scanning state and index rebuilt callbacks */
        _onScanningStateChanged = (scanning: boolean) => {
          _isScanning = scanning;
          rebuildBacklinksDOM();
        };

        _onIndexRebuilt = (backlinks: string[]) => {
          _currentBacklinks = backlinks;
          _isScanning = false;
          rebuildBacklinksDOM();
        };

        /* Perform initial render showing empty state */
        rebuildBacklinksDOM();
      },

      destroy(_container: HTMLElement): void {
        _backlinksListEl = null;
        _onScanningStateChanged = null;
        _onIndexRebuilt = null;
      },
    });

    /* Step 6: Trigger initial index build */
    _isScanning = true;
    scheduleIndexRebuild((backlinks, outgoing) => {
      if (!_enabled) return;
      _currentBacklinks = backlinks;
      _currentOutgoing = outgoing;
      _isScanning = false;
      rebuildBacklinksDOM();
    });
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    /* Step 1: Cancel all pending timers and reset index state */
    resetIndexState();

    /* Step 2: Remove CM6 extensions from the editor */
    api.removeExtensions();

    /* Step 3: Unregister sidebar panel (calls destroy() internally) */
    api.unregisterSidebarPanel("backlinks");

    /* Step 4: Remove all injected CSS */
    removeWikiLinkStyles();
    removeBacklinksCSS();

    /* Step 5: Remove document click handler and poll timer */
    if (_wikiLinkClickHandler) {
      document.removeEventListener("click", _wikiLinkClickHandler, true);
      _wikiLinkClickHandler = null;
    }
    if (_pollTimer !== null) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }

    /* Step 6: Clear all module-level state to initial values */
    _view = null;
    _lastKnownFile = null;
    _currentBacklinks = [];
    _currentOutgoing = [];
    _isScanning = false;
    _backlinksListEl = null;
    _onScanningStateChanged = null;
    _onIndexRebuilt = null;
  },
};

export default plugin;
