/**
 * Backlinks Plugin (Steps 3, 4, 5, 6, 7, 8, 9, 10)
 *
 * This module contains wiki-link parsing, decoration, navigation,
 * autocomplete, index building, sidebar panel, hover preview popover,
 * and plugin lifecycle functionality for the backlinks feature.
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
 * Step 10: Wiki-link hover preview popover — injectWikiPopoverStyles,
 *          removeWikiPopoverStyles, extractPopoverContent, positionPopover,
 *          showWikiPopover, dismissWikiPopover, module-level hover state.
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
 *
 * The optional `target` field is populated only on `"mark"` ranges. It
 * carries the raw (un-normalized) wiki-link target string (the part before
 * the pipe in `[[target|display]]`). `buildWikiLinkDecorations` uses this
 * to set the `data-wiki-target` HTML attribute on each `.cm-wiki-link` span
 * so the hover handler can read the target without re-parsing the DOM text.
 */
export interface WikiLinkDecorationRange {
  /** Start of the decoration range (absolute document offset). */
  from: number;
  /** End of the decoration range (absolute document offset). */
  to: number;
  /** Whether to hide (`replace`) or style (`mark`) this range. */
  type: "replace" | "mark";
  /**
   * Raw (un-normalized) wiki-link target. Present on `type === "mark"`
   * ranges only. For `[[target|display]]` this is `"target"` (before
   * the pipe). Used to set the `data-wiki-target` DOM attribute (FR-7).
   */
  target?: string;
  /**
   * True when the target stem is not present in the vault index.
   * Only set on `type === "mark"` ranges when a `stemSet` is supplied to
   * `computeWikiLinkDecorationRanges`. Undefined (falsy) means either
   * "valid" or "no vault active" (EC-01, NFR-5).
   */
  broken?: boolean;
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
 * Extract the bare lowercase stem from a raw wiki-link target for vault
 * index lookup (AD-2 in 00_index.md).
 *
 * Algorithm (must match VaultIndexEntry.name which is the filename stem):
 *   1. normalizeTarget(t)             e.g. "subdir/notes.md"
 *   2. Strip ".md" suffix             "subdir/notes"
 *   3. Take filename portion after    "notes"
 *      the last "/"
 *   4. Lowercase                      "notes"
 *
 * Case-insensitive to match macOS HFS+ semantics (FR-4, EC-07).
 * Module-private — not exported so the public API surface stays minimal.
 *
 * @param rawTarget - The un-normalized wiki-link target (before the pipe).
 * @returns Lowercase stem suitable for Set.has() lookup.
 */
function stemForLookup(rawTarget: string): string {
  const normalized = normalizeTarget(rawTarget);
  /*
   * Strip the "#heading" anchor suffix before any further processing.
   * A link like [[notes#introduction]] targets "notes", not "notes#introduction".
   * normalizeTarget does not strip anchors (it only normalizes the path), so we
   * must handle it here. Without this step, [[notes#introduction]] would always
   * register as broken even when notes.md exists (Finding 1 / code review).
   */
  const withoutAnchor = normalized.includes("#")
    ? normalized.slice(0, normalized.indexOf("#"))
    : normalized;
  /*
   * Strip the ".md" suffix if present. normalizeTarget may have appended it,
   * or the user may have written [[file.md]] explicitly (EC-12).
   */
  const withoutExt = withoutAnchor.endsWith(".md")
    ? withoutAnchor.slice(0, -3)
    : withoutAnchor;
  /* Take the filename portion after the last "/" to handle subdirectory paths (EC-06). */
  const slashIdx = withoutExt.lastIndexOf("/");
  return (slashIdx === -1 ? withoutExt : withoutExt.slice(slashIdx + 1)).toLowerCase();
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
 * @param stemSet       - Optional set of lowercased vault stems. When provided,
 *                        mark ranges whose target stem is absent from this set
 *                        have their `broken` field set to `true`. When absent
 *                        (no vault active), no broken classification is applied
 *                        and all links render as valid (EC-01, NFR-5).
 * @returns Sorted array of decoration range descriptors.
 */
export function computeWikiLinkDecorationRanges(
  text: string,
  activeLines: Set<number>,
  visibleRanges: { from: number; to: number }[],
  stemSet?: Set<string>
): WikiLinkDecorationRange[] {
  // Length justified: two parallel branches (piped vs. simple) require identical
  // broken-link logic; decomposition would require 6+ parameters.
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

        /*
         * Style the display text (from after `|` to before `]]`).
         * Carry `match.target` so `buildWikiLinkDecorations` can set the
         * `data-wiki-target` attribute on the span (FR-7.2: for piped links
         * the attribute must be the target, not the display text).
         */
        if (pipeEnd < closeStart) {
          const markRange: WikiLinkDecorationRange = {
            from: pipeEnd,
            to: closeStart,
            type: "mark",
            target: match.target,
          };
          /*
           * When a stemSet is provided, classify the link as broken if the
           * normalized target stem is absent from the vault index (FR-1, AD-2).
           * When stemSet is undefined (no vault), leave `broken` unset so the
           * link renders as valid (EC-01, FR-3).
           */
          if (stemSet !== undefined) {
            markRange.broken = !stemSet.has(stemForLookup(match.target));
          }
          results.push(markRange);
        }
      } else {
        /*
         * Simple wiki-link: [[target]]
         * Style the target text (from after `[[` to before `]]`).
         * Skip the mark if the content is empty (EC-9: `[[]]`).
         * Carry `match.target` for the `data-wiki-target` DOM attribute (FR-7.1).
         */
        if (openEnd < closeStart) {
          const markRange: WikiLinkDecorationRange = {
            from: openEnd,
            to: closeStart,
            type: "mark",
            target: match.target,
          };
          /*
           * Same broken-link classification as the piped branch above.
           * Both branches use identical logic; the only input difference is
           * which span is being marked (display text vs. target text).
           */
          if (stemSet !== undefined) {
            markRange.broken = !stemSet.has(stemForLookup(match.target));
          }
          results.push(markRange);
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
  // Length justified: stem-set construction, active-line computation, and
  // CM6 Decoration assembly must all happen in one pass to avoid redundant
  // doc.toString() calls; extracting each step would require passing a large
  // shared context object between helpers.
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

  /*
   * Build vault stem set for broken-link detection (FR-9, AD-1).
   * O(n) in vault size; individual lookups in the decoration loop are O(1).
   * When no vault is active, stemSet is undefined and no broken-link
   * classification is applied (EC-01, FR-3).
   */
  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const vaultIndex = vaultManager?.getVaultIndex?.() ?? null;
  let stemSet: Set<string> | undefined;
  if (vaultIndex !== null) {
    stemSet = new Set(
      (vaultIndex.entries as { name: string }[]).map((e) => e.name.toLowerCase())
    );
  }

  /* Compute the pure decoration ranges, passing stemSet for broken detection */
  const decoRanges = computeWikiLinkDecorationRanges(
    docText,
    activeLines,
    view.visibleRanges,
    stemSet
  );

  /* Convert to CM6 Decoration objects */
  const decorations: any[] = [];
  for (const range of decoRanges) {
    if (range.type === "replace") {
      decorations.push(
        Decoration.replace({}).range(range.from, range.to)
      );
    } else {
      /*
       * Mark decoration: style the visible link text.
       * When `range.target` is present, add a `data-wiki-target` attribute
       * to the span so the hover handler can read the target without
       * re-parsing the text content of the span (FR-7.3, FR-7.1, FR-8, AD-6).
       * The conditional guard prevents a TypeScript error from the optional
       * field; in practice every "mark" range has a target.
       *
       * Broken links receive an additional `cm-wiki-link-broken` class (FR-1).
       * The data-wiki-target attribute is identical for broken and valid links
       * so click-to-navigate and hover popover are unaffected (FR-8, AD-6).
       */
      const linkClass = range.broken
        ? "cm-live-link cm-wiki-link cm-wiki-link-broken"
        : "cm-live-link cm-wiki-link";
      decorations.push(
        Decoration.mark({
          class: linkClass,
          attributes: range.target !== undefined
            ? { "data-wiki-target": range.target }
            : {},
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
/* Wiki-link decoration styles.
 * The .cm-live-link class provides base link styling (color, underline).
 * The .cm-wiki-link class enables click targeting by the click handler.
 * The .cm-wiki-link-broken class marks links whose target does not exist
 * in the vault index. Color is controlled by --link-broken-color in
 * styles.css so themes can override it (FR-7, AD-5). */
.cm-wiki-link {
  cursor: pointer;
}
.cm-wiki-link-broken {
  color: var(--link-broken-color);
  text-decoration-line: underline;
  text-decoration-style: wavy;
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
   * Two execution paths:
   *  1. **Vault mode** (FR-A.2): when `__MARKABLE_VAULT_MANAGER__` is present
   *     and `getVaultIndex()` returns a non-null index with entries, completions
   *     are sourced directly from `VaultIndexEntry[]`. Each completion carries
   *     a vault-relative path as `detail` (AD-03/AD-04) and a `title` as `info`
   *     when it differs from `name` (AD-03). Self-link exclusion is NOT applied
   *     (FR-A.2, AD-02). All entries are returned; CM6 `filter: true` narrows
   *     the list as the user types. `validFor` keeps the completions alive.
   *  2. **No-vault fallback** (FR-A.3): when no vault is active, falls through
   *     to the existing `_cachedFileList` path. `null` is passed for the current
   *     filename so no file is excluded (AD-02). `filter: true` is used here so
   *     CM6 can narrow further as the user types.
   *
   * Shared guards (applied before either path):
   *  - FR-A.6 / EC-A.05: `]]` in prefix → already closed, return null.
   *  - FR-A.5 / EC-A.06: `|` in prefix → display-text portion, return null.
   */
  function makeApplyCallback(label: string) {
    return (view: any, _completion: any, from: number, to: number) => {
      const docLength = view.state.doc.length;
      const after = view.state.doc.sliceString(to, Math.min(to + 2, docLength));
      const closingBrackets = after === "]]" ? "" : "]]";
      view.dispatch({
        changes: { from, to, insert: label + closingBrackets },
        selection: { anchor: from + label.length + closingBrackets.length },
      });
    };
  }

  const wikiLinkCompletionSource = (context: any): any => {
    /*
     * matchBefore scans backward from the cursor for the given pattern.
     * The pattern matches `[[` followed by zero or more characters that
     * are not `]` or newline. This gives us the raw text from `[[` to cursor.
     */
    const before = context.matchBefore(/\[\[([^\]\n]*)/);
    if (!before) return null;

    /*
     * Extract the prefix — the text the user has typed after `[[`.
     * before.text always starts with `[[`, so slice 2 characters.
     */
    const prefix = before.text.slice(2);

    /*
     * FR-A.6 / EC-A.05: already-closed wiki-link guard.
     * If `]]` appears between `[[` and the cursor, the link is already
     * closed. Suppress completions so the popup does not appear.
     */
    if (prefix.includes("]]")) return null;

    /*
     * FR-A.5 / EC-A.06: pipe-character guard (AD-05).
     * The text after `[[` contains `|`, which means the cursor is in
     * the display-text portion of `[[target|display]]`. Offering file
     * completions here would be nonsensical. Return null explicitly to
     * make the suppression intentional rather than accidental.
     */
    if (prefix.includes("|")) return null;

    // ── Vault mode (FR-A.2) ──────────────────────────────────────────────────
    /*
     * Read the vault manager and index from the window global.
     * Optional chaining (?.()) is used so that a missing or broken global
     * degrades gracefully to undefined, which causes the vault branch to be
     * skipped and control to fall through to the no-vault path (EC-A.01,
     * EC-A.10, AD-07 analogy).
     */
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    const vaultIndex = vaultManager?.getVaultIndex?.();

    if (vaultIndex && Array.isArray(vaultIndex.entries)) {
      /*
       * Vault is active. Source completions from the pre-built index.
       * We do NOT call filterCompletions here because it cannot carry
       * `detail` or `info` metadata (AD-01).
       *
       * All entries are returned (no pre-filter by prefix). CM6's own
       * `filter: true` narrows the list as the user types, and the
       * `validFor` guard keeps completions alive across keystrokes and
       * backspaces so the menu persists without needing to be re-requested
       * after every character.
       */
      const vaultRoot: string =
        vaultManager.getActiveVault()?.rootPaths?.[0] ?? "";

      const options = vaultIndex.entries
        .sort(
          (a: { name: string }, b: { name: string }) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        )
        .map((entry: { name: string; path: string; title: string }) => {
          let detail: string;
          if (vaultRoot && entry.path.startsWith(vaultRoot + "/")) {
            detail = entry.path
              .slice(vaultRoot.length + 1)
              .replace(/\.md$/, "");
          } else {
            detail = entry.name;
          }

          /* CM6 info: plain string is valid; a function must return a DOM Node.
             Using a plain string avoids the type mismatch that crashed arrow-key
             navigation when CM6 tried to mount the info panel. */
          const infoFn: string | undefined =
            entry.title !== entry.name ? entry.title : undefined;

          const label = entry.name;

          return {
            label,
            detail,
            info: infoFn,
            apply: makeApplyCallback(label),
            type: "file",
          };
        });

      return {
        from: before.from + 2,
        options,
        filter: true,
        /* Keep completions alive while the cursor stays inside [[…  */
        validFor: /^[^\]\n|]*$/,
      };
    }

    // ── No-vault fallback (FR-A.3) ───────────────────────────────────────────
    const matchingFiles = filterCompletions(_cachedFileList, prefix, null);

    /* EC-22: empty result — return null so the popup does not appear */
    if (matchingFiles.length === 0) return null;

    const options = matchingFiles.map((filename: string) => {
      const label = filename.endsWith(".md")
        ? filename.slice(0, -3)
        : filename;

      return {
        label,
        apply: makeApplyCallback(label),
        type: "file",
      };
    });

    return {
      from: before.from + 2,
      options,
      filter: true,
      validFor: /^[^\]\n|]*$/,
    };
  };

  /*
   * updateListener re-triggers the popup whenever the cursor moves into or
   * stays inside a [[… context — including after Escape, tab switch, or mouse
   * click. Without this, CM6's activateOnTyping only fires on text insertion,
   * so clicking back into [[text]] or pressing Escape and then repositioning
   * the cursor would leave the popup permanently closed.
   */
  const cmView = (window as any).__CM_VIEW__;
  const retriggerListener =
    cmView?.EditorView?.updateListener.of((update: any) => {
      if (!update.docChanged && !update.selectionSet) return;
      const state = update.view.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const before = line.text.slice(0, pos - line.from);
      if (!/\[\[[^\]\n|]*$/.test(before)) return;
      if (cmAuto.completionStatus(state) !== null) return;
      cmAuto.startCompletion(update.view);
    });

  return [
    cmAuto.autocompletion({
      override: [wikiLinkCompletionSource],
      activateOnTyping: true,
    }),
    ...(retriggerListener ? [retriggerListener] : []),
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
// @ts-ignore TS6133: assigned for future use / documentation purposes
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
// @ts-ignore TS6133: assigned for future use / documentation purposes
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
  /*
   * Phase 2b migration: when a vault is active, use the vault index as the
   * autocomplete candidate source. The vault index is bounded, pre-scanned,
   * and richer than a shallow directory scan. This is guarded so pre-vault
   * sessions (no active vault) fall back to the existing list_md_files path
   * with zero regression (R-04 mitigation from 00_index.md).
   */
  const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.();
  if (vaultIndex) {
    // Return stem + ".md" for each indexed entry so the format matches what
    // the existing autocomplete logic expects from list_md_files.
    return (vaultIndex.entries as Array<{ name: string }>).map((e) => e.name + ".md");
  }

  // Fallback: shallow scan of the current directory when no vault is active.
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
      /*
       * Vault fast path: use the pre-built VaultIndex rather than re-reading
       * all files from disk. This fixes two bugs:
       *   1. buildIndex constructed wrong paths for cross-directory vault files
       *      (it joined currentFileDir + bareFilename, missing subdirectory info).
       *   2. Unsaved editor content was invisible to the disk-based reader.
       *
       * After seeding from the persisted vault index we override any open editor
       * tabs with their current in-memory tab.doc so that a freshly typed
       * [[link]] (not yet auto-saved) is included before the file-watcher has
       * time to refresh the vault index.
       */
      const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
      const vaultIndex = vaultManager?.getVaultIndex?.() as
        | { entries: Array<{ name: string; outboundLinks: string[] }> }
        | null
        | undefined;

      if (vaultIndex && Array.isArray(vaultIndex.entries)) {
        const newIndex = new Map<string, string[]>();

        /* Seed from vault index (Rust-parsed, all directories, persisted links) */
        for (const entry of vaultIndex.entries) {
          newIndex.set(
            entry.name + ".md",
            entry.outboundLinks.map((l) => normalizeTarget(l))
          );
        }

        /* Override with in-memory content for every open editor tab */
        const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
        const tabs: Array<{ kind: string; filePath: string | null; doc: string }> =
          tabManager?.tabs ?? [];
        for (const tab of tabs) {
          if (tab.kind !== "editor" || !tab.filePath) continue;
          const filename = filenameFromPath(tab.filePath);
          newIndex.set(filename, extractOutgoingLinks(tab.doc ?? ""));
        }

        _linkIndex = newIndex;
        _currentDir = dir;
        setCachedFileList([...newIndex.keys()]);

        const backlinks = computeBacklinks(_linkIndex, currentFilename);
        const outgoing = _linkIndex.get(currentFilename) ?? [];
        callback(backlinks, outgoing);
        return;
      }

      /* No-vault fallback: directory scan (unchanged behaviour) */
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
  font-family: var(--ui-font);
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
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}

.backlinks-section-header {
  font-family: var(--ui-font);
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

  // ── Step 10 test-only accessors ──────────────────────────────────────────

  /**
   * Directly set the `_enabled` flag.
   *
   * Required by hover-popover tests that call `showWikiPopover` in
   * isolation, without going through the full `onEnable` lifecycle.
   * This accessor must not be used in production code.
   *
   * @param val - New value for `_enabled`.
   */
  setEnabled(val: boolean): void {
    _enabled = val;
  },

  /**
   * Read the current `_hoverFetchVersion` counter.
   *
   * Used by the race-safety test to verify that `dismissWikiPopover`
   * increments the version (EC-04).
   *
   * @returns Current fetch version number.
   */
  getHoverFetchVersion(): number {
    return _hoverFetchVersion;
  },

  /**
   * Read the current `_activePopoverEl` reference.
   *
   * Used by EC-07, EC-01, EC-12 tests to assert that `showWikiPopover`
   * did not create a popover element.
   *
   * @returns The active popover element, or null if none is shown.
   */
  getActivePopoverEl(): HTMLElement | null {
    return _activePopoverEl;
  },

  /**
   * Directly set the `_activePopoverEl` reference.
   *
   * Required by the EC-08 grace-period test (CRITICAL-1): the test creates
   * a fake popover element and installs it as the "active" popover so that
   * the hover and dismiss handlers treat it as the currently visible element.
   * This accessor must not be used in production code.
   *
   * @param el - The element to treat as the active popover, or null to clear it.
   */
  setActivePopoverEl(el: HTMLElement | null): void {
    _activePopoverEl = el;
  },

  /**
   * Call the module-private `resolveCreationPath` function.
   * Exposed for unit tests only.
   *
   * @param rawTarget - Raw wiki-link target string.
   * @param vaultRoot - Absolute vault root path (no trailing slash).
   * @returns Absolute path for the new file (always ends in ".md").
   */
  resolveCreationPath(rawTarget: string, vaultRoot: string): string {
    return resolveCreationPath(rawTarget, vaultRoot);
  },

  /**
   * Call the module-private `createBrokenLinkPopoverElement` function.
   * Exposed for unit tests only.
   *
   * @param displayStem       - Note title shown in the title row.
   * @param vaultRelativePath - Vault-relative path shown in the path row.
   * @returns Unattached popover element for the broken-link variant.
   */
  createBrokenLinkPopoverElement(
    displayStem: string,
    vaultRelativePath: string
  ): HTMLElement {
    return createBrokenLinkPopoverElement(displayStem, vaultRelativePath);
  },

  /**
   * Call the module-private `_showInlinePopoverError` function.
   * Exposed for unit tests only.
   *
   * @param message - Human-readable error string to display in the popover.
   */
  showInlinePopoverError(message: string): void {
    _showInlinePopoverError(message);
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
// @ts-ignore TS6133: assigned for future use / documentation purposes
let _view: any = null;

/**
 * A no-op StateEffect used to force a CM6 decoration rebuild when the
 * vault index changes outside of a document transaction (FR-5, AD-3).
 *
 * StateEffect lives in @codemirror/state, exposed as window.__CM_STATE__.
 * The null guard handles test environments where the global is absent.
 * Defined once at module scope so both the subscribe and dispatch sites
 * reference the same effect type.
 */
const { StateEffect } = (window as any).__CM_STATE__ as any ?? {};
/*
 * Type argument omitted: when StateEffect is `any`, TypeScript forbids generic
 * call syntax on untyped functions (TS2347). The effect payload is `void` in
 * practice but this is not enforced at the TypeScript level — `any` is sufficient
 * because the dispatch site also uses `any`.
 */
const forceRebuildEffect: any = StateEffect?.define() ?? null;

/**
 * Subscription callbacks for vault-change events, held so they can be
 * unsubscribed by exact reference in onDisable (EC-14, AD-4).
 *
 * Both are set together in _buildCmExtensions when vaultManager is available,
 * and both are nulled in onDisable after unsubscribing.
 */
let _onVaultChangedForDecorations: ((v: any) => void) | null = null;
let _onIndexUpdatedForDecorations: ((e: any) => void) | null = null;

/**
 * Test-only accessor for the vault decoration callbacks.
 *
 * Returns the exact same function references that `_buildCmExtensions`
 * registered with the vault manager. Tests can use these to:
 *   1. Prove the returned callbacks ARE the references registered with the mock
 *      vault manager (identity check against what onVaultChanged / onIndexUpdated
 *      received).
 *   2. Invoke them directly and assert no crash + correct behavior when _view is null.
 *
 * This export is intentionally named with a `__test_only_` prefix to signal
 * that it must never be called in production code. It is the narrowest possible
 * seam that lets tests exercise the real wiring without requiring a full CM6
 * EditorView (which cannot be instantiated in jsdom).
 *
 * Finding 2 fix: EC-08, EC-09, EC-10 tests must call this after simulating
 * plugin enable so they exercise the actual registered callbacks, not
 * inline lambdas constructed in the test itself.
 *
 * @returns Object with `onVaultChanged` and `onIndexUpdated` callback references,
 *          or null for each if `_buildCmExtensions` has not yet been called
 *          (or if vault manager was unavailable at enable time).
 */
export function __test_only_getDecorationCallbacks(): {
  onVaultChanged: ((v: any) => void) | null;
  onIndexUpdated: ((e: any) => void) | null;
} {
  return {
    onVaultChanged: _onVaultChangedForDecorations,
    onIndexUpdated: _onIndexUpdatedForDecorations,
  };
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — CSS
// ---------------------------------------------------------------------------

/**
 * CSS for the wiki-link hover popover.
 *
 * All colors reference existing CSS variables so the popover adopts the
 * active theme automatically. The element starts hidden (`display: none;
 * opacity: 0`) in the base CSS. Visibility is controlled imperatively in
 * `showWikiPopover` via inline style assignments (LOW-2 WebKit fix: class-
 * toggle transitions fail when display:none is involved).
 *
 * Design notes:
 * - `pointer-events: auto` is required so the popover catches
 *   `mouseenter`/`mouseleave` for the EC-08 grace period.
 * - `user-select: none` prevents text selection drag from triggering
 *   dismiss (FR-10.5).
 * - z-index 10000 matches the markdown toolbar layer (FR-10.4). See
 *   the z-index audit in `00_index.md` for the full layer table.
 * - `-webkit-line-clamp: 7` limits the excerpt to ~7 lines at 1.5 line
 *   height (≈126px), staying within the 240px max-height when title and
 *   path rows are included.
 */
const WIKI_POPOVER_CSS = `
[data-markable-wiki-popover] {
  position: fixed;
  z-index: 10000;
  max-width: 320px;
  max-height: 240px;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 12px;
  font-family: var(--ui-font);
  user-select: none;
  pointer-events: auto;
  display: none;
  opacity: 0;
  transform: translate(0, 4px);
}
/*
 * Note: visibility is now controlled imperatively in showWikiPopover via
 * inline style assignments (LOW-2 WebKit fix). The .wl-popover-visible class
 * is no longer needed; the base hidden state above remains for reset purposes.
 */

.wl-popover-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--link-color);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wl-popover-path {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wl-popover-excerpt {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 7;
  -webkit-box-orient: vertical;
}

.wl-popover-create-btn {
  margin-top: 8px;
}

.wl-popover-error-msg {
  margin-top: 8px;
  font-size: 11px;
  /*
   * HIGH-2: --color-error is not defined anywhere in the codebase, making
   * the hardcoded fallback #c0392b permanently active (violates NFR-5).
   * --link-broken-color IS defined (it drives the red wavy underline on
   * broken wiki-links) and is semantically correct for this error state.
   */
  color: var(--link-broken-color);
  white-space: pre-wrap;
  word-break: break-word;
}
`;

/**
 * Inject the wiki-link hover popover CSS into the document head.
 *
 * Uses a `data-markable-wiki-popover-styles` sentinel attribute so that
 * repeated calls are idempotent — the style tag is inserted only once.
 * Mirrors the pattern used by `injectWikiLinkStyles` and `injectBacklinksCSS`.
 */
export function injectWikiPopoverStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector("[data-markable-wiki-popover-styles]")) return;

  const style = document.createElement("style");
  style.setAttribute("data-markable-wiki-popover-styles", "true");
  style.textContent = WIKI_POPOVER_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the wiki-link hover popover CSS from the document head.
 *
 * No-op if the tag is absent (e.g., `onDisable` called before `onEnable`
 * or running in a test environment without document access).
 */
export function removeWikiPopoverStyles(): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector("[data-markable-wiki-popover-styles]");
  if (el) el.remove();
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Module-Level State
// ---------------------------------------------------------------------------

/** Document-level mouseover handler reference, stored for cleanup in onDisable. */
let _wikiLinkHoverHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Document-level mouseleave/click handler for popover dismissal.
 *
 * A single handler handles both `mouseleave` (on the span or popover) and
 * `click` (anywhere on the document). Stored here so `onDisable` can remove
 * all three event-listener registrations (mouseleave, click, and the second
 * click listener) with a single reference.
 */
let _wikiLinkHoverLeaveHandler: ((e: MouseEvent) => void) | null = null;

/** Timer handle for the 180 ms show-delay (FR-1.1). */
let _hoverShowTimer: ReturnType<typeof setTimeout> | null = null;

/** Timer handle for the 60 ms grace-period dismiss timer (FR-6.1, EC-08). */
let _hoverDismissTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Monotonically incrementing counter for fetch race safety (FR-2.4, EC-04).
 *
 * Incremented BEFORE each fetch in `showWikiPopover` and also inside
 * `dismissWikiPopover`. On fetch completion the captured pre-fetch value is
 * compared against the current counter; a mismatch means the result is stale
 * and should be discarded rather than rendered.
 */
let _hoverFetchVersion = 0;

/** The currently visible popover element, or null when no popover is shown. */
let _activePopoverEl: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Content Extraction
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — extractPopoverContent helpers
// ---------------------------------------------------------------------------

/**
 * Find the character offset just after the closing `---` (or `...`) line of a
 * YAML front-matter block, or -1 if no valid front-matter block is present.
 *
 * A valid front-matter block must:
 *  - Begin at character 0 with `---`.
 *  - Have a closing `\n---` or `\n...` line somewhere after the opening.
 *
 * When both markers are present the earlier one wins (the front-matter block
 * ends at whichever delimiter appears first).
 *
 * The returned offset points to the character IMMEDIATELY AFTER the three-
 * character `---`/`...` sequence (i.e. `\n---` occupies 4 chars starting at
 * the found index, so the returned value is `foundIndex + 4`). Callers that
 * want the body text starting after the closing fence should use this offset
 * directly as the `slice` start argument.
 *
 * Exported so that unit tests can verify the offset calculation without
 * calling the full `extractPopoverContent` pipeline.
 *
 * @param content - The (possibly byte-capped) file content string.
 * @returns Character offset just after the closing front-matter line, or -1.
 */
export function findFrontMatterEnd(content: string): number {
  if (!content.startsWith("---")) return -1;

  const endMarker = content.indexOf("\n---", 3);
  const dotMarker = content.indexOf("\n...", 3);

  /*
   * Resolve which marker appears first, ignoring absent markers (value === -1).
   * When both are present, take the smaller (earlier) index.
   */
  const fmEnd =
    endMarker !== -1 && dotMarker !== -1
      ? Math.min(endMarker, dotMarker)
      : endMarker !== -1
      ? endMarker
      : dotMarker;

  return fmEnd;
}

/**
 * Remove fenced code blocks from a body text string.
 *
 * Matches triple-backtick or triple-tilde fenced blocks (including any
 * language specifier on the opening fence line) and replaces each block
 * with an empty string.
 *
 * The backreference `\1` ensures the same fence character opens and closes
 * the block. `[\s\S]*?` is lazy so it stops at the first matching fence.
 * The `gm` flags apply the replacement globally and treat `^`/`$` as
 * line anchors.
 *
 * Exported for direct unit testing.
 *
 * @param text - Body text that may contain fenced code blocks.
 * @returns Text with all fenced code blocks removed.
 */
export function stripFencedCodeBlocks(text: string): string {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, "");
}

/**
 * Strip common Markdown syntax characters from a body text string.
 *
 * Removes (in order):
 *  - Heading markers (`##`, `###`, etc. — the `#` chars + trailing space)
 *  - Images: replaced with alt text only
 *  - Links: replaced with link text only
 *  - Inline decoration chars: `*`, `_`, `~`, backtick (bold/italic/strikethrough/code)
 *  - Horizontal rules (`---`, `***`, `___`)
 *  - Consecutive blank lines (collapsed to a single space)
 *
 * The result is intended for popover excerpt display, not for round-trip
 * Markdown parsing, so lossy simplifications (e.g., collapsing blank lines)
 * are acceptable.
 *
 * Exported for direct unit testing.
 *
 * @param text - Body text that may contain Markdown syntax.
 * @returns Plain-text approximation suitable for an excerpt.
 */
export function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")             // heading markers (##, ###, etc.)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // image: keep alt text only
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // link: keep link text only
    .replace(/[*_~`]/g, "")                   // bold, italic, strikethrough, code
    .replace(/^[-*_]{3,}\s*$/gm, "")          // horizontal rules
    .replace(/\n{2,}/g, " ");                 // collapse blank lines to a space
}

/**
 * Extract popover display content from a file's raw text.
 *
 * This is a **deterministic function** (no DOM, no globals except optional-chained
 * vault-manager access for the path label). It is exported for direct unit
 * testing in `hover-popover.test.ts`.
 *
 * Processing steps (in order):
 *  1. Byte-cap: slice to 2048 characters (FR-2.5, EC-03).
 *  2. Title extraction with three-level priority chain (FR-3.1):
 *     a. YAML front-matter `title:` field (handles quoted and bare values)
 *     b. First `# H1` heading
 *     c. Filename stem from `resolvedPath`
 *  3. Vault-relative path label (FR-3.3); falls back to bare filename when
 *     no vault manager is available (graceful for unit tests).
 *  4. Strip front matter from body.
 *  5. Strip fenced code blocks from body (via `stripFencedCodeBlocks`).
 *  6. Strip Markdown syntax characters from body (via `stripMarkdownSyntax`).
 *  7. Produce an excerpt of at most 200 words, appending "…" if truncated.
 *
 * @param raw          - Full file content string.
 * @param resolvedPath - Absolute path to the file (used for title fallback
 *                       and vault-relative label computation).
 * @returns `{ title, pathLabel, excerpt }` where `title` and `pathLabel` are
 *          always non-empty strings, and `excerpt` may be `""` (EC-18).
 */
export function extractPopoverContent(
  raw: string,
  resolvedPath: string
): { title: string; pathLabel: string; excerpt: string } {
  /*
   * Step 1 — Byte-cap to 2048 characters.
   * JavaScript strings are UTF-16; slicing by character index at 2048 is a
   * conservative approximation of a UTF-8 byte limit (never over-reads for
   * multi-byte chars). This prevents processing of arbitrarily large files.
   */
  const content = raw.length > 2048 ? raw.slice(0, 2048) : raw;

  // ── Step 2: Extract title ─────────────────────────────────────────────────

  let title: string | null = null;

  /*
   * Priority 1: YAML front-matter `title:` field.
   * `findFrontMatterEnd` handles the `---`/`...` marker resolution so
   * this call site only needs to act on the returned offset. The regex
   * handles optional single- or double-quote wrapping around the value.
   */
  const fmEnd = findFrontMatterEnd(content);
  if (fmEnd !== -1) {
    const frontMatter = content.slice(3, fmEnd);
    const titleMatch = frontMatter.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) title = titleMatch[1].trim();
  }

  /* Priority 2: first `# H1` heading (strip any inline formatting). */
  if (!title) {
    const h1Match = content.match(/^#\s+(.+)/m);
    if (h1Match) title = h1Match[1].replace(/[*_~`]/g, "").trim();
  }

  /* Priority 3: filename stem derived from the resolved path. */
  if (!title) {
    const filename = filenameFromPath(resolvedPath);
    title = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  }

  // ── Step 3: Vault-relative path label ────────────────────────────────────

  /*
   * Optional-chain through the vault manager so this function does not throw
   * in unit tests where `window.__MARKABLE_VAULT_MANAGER__` is undefined.
   */
  let pathLabel: string;
  const vaultRoot: string | undefined = (window as any)
    .__MARKABLE_VAULT_MANAGER__?.getActiveVault?.()?.rootPaths?.[0];
  if (vaultRoot && resolvedPath.startsWith(vaultRoot + "/")) {
    pathLabel = resolvedPath.slice(vaultRoot.length + 1);
  } else {
    pathLabel = filenameFromPath(resolvedPath);
  }

  // ── Step 4: Strip front matter from body ─────────────────────────────────

  /*
   * Re-use the `fmEnd` value already computed in Step 2.
   * `fmEnd` is -1 when no front-matter block is present; otherwise it
   * points to the first character of the closing `\n---` or `\n...`
   * sequence. We skip past those 4 characters to reach the body text.
   */
  let body = fmEnd !== -1 ? content.slice(fmEnd + 4) : content;

  // ── Steps 5-6: Strip fenced code blocks then Markdown syntax ─────────────

  body = stripFencedCodeBlocks(body);
  body = stripMarkdownSyntax(body);

  // ── Step 7: Extract excerpt (≤200 words) ─────────────────────────────────

  const words = body.trim().split(/\s+/).filter(Boolean);
  let excerpt = "";
  if (words.length > 0) {
    const truncated = words.length > 200;
    excerpt = words.slice(0, 200).join(" ");
    /* Append Unicode ellipsis (U+2026) when the content was truncated. */
    if (truncated) excerpt += "\u2026";
  }

  return { title: title!, pathLabel, excerpt };
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Positioning
// ---------------------------------------------------------------------------

/**
 * Apply `position: fixed` coordinates to a popover element relative to a
 * span element's bounding rectangle.
 *
 * Default placement: below the span, left-aligned with it. Two adjustments
 * are applied when needed:
 *  - Right-clamp (FR-5.2): shift left if the popover would overflow the
 *    right viewport edge.
 *  - Flip-above (FR-5.3): place above the span when it would overflow the
 *    bottom viewport edge. Uses the CSS `max-height` (240px) as a
 *    conservative height estimate because the element is hidden at call
 *    time and `scrollHeight` returns 0 for `display: none` elements.
 *
 * @param spanEl    - The hovered `.cm-wiki-link` span element.
 * @param popoverEl - The popover `<div>` whose `style.top`/`style.left`
 *                    will be set.
 */
export function positionPopover(
  spanEl: HTMLElement,
  popoverEl: HTMLElement
): void {
  const rect = spanEl.getBoundingClientRect();
  const popoverWidth = 320; // CSS max-width
  const margin = 16;        // minimum gap from any viewport edge (FR-5.2/FR-5.3)
  const gap = 8;            // vertical gap between span bottom and popover top (FR-5.1)

  /* Default: below the span, left-aligned. */
  let top = rect.bottom + gap;
  let left = rect.left;

  /*
   * Right-clamp (FR-5.2): if the popover would extend beyond the right
   * viewport edge, shift it left until it fits. Clamp at the left margin
   * to avoid going off-screen to the left.
   */
  if (left + popoverWidth > window.innerWidth - margin) {
    left = window.innerWidth - popoverWidth - margin;
    if (left < margin) left = margin;
  }

  popoverEl.style.top = top + "px";
  popoverEl.style.left = left + "px";

  /*
   * Flip-above (FR-5.3): use max-height (240) as a conservative estimate
   * because `scrollHeight` is 0 for hidden (`display: none`) elements.
   * If the popover bottom would exceed the viewport bottom, place it above
   * the span instead. Clamp at the top margin to handle very large popovers.
   *
   * Note: `left` does not change inside this block, so the earlier
   * `style.left` assignment above already holds the correct final value.
   * Only `style.top` needs to be updated when flipping above the span.
   */
  const estimatedHeight = 280; // increased for broken-link "Create note" button row
  if (top + estimatedHeight > window.innerHeight - margin) {
    top = rect.top - estimatedHeight - gap;
    if (top < margin) top = margin;
    popoverEl.style.top = top + "px";
  }
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — DOM Builder
// ---------------------------------------------------------------------------

/**
 * Build the popover `<div>` element with title, path label, and excerpt rows.
 *
 * This helper is extracted from `showWikiPopover` so the DOM construction
 * logic can be read and tested independently of the async fetch orchestration.
 *
 * The returned element is NOT yet attached to the document. The caller is
 * responsible for appending it, setting `_activePopoverEl`, and positioning
 * it via `positionPopover`.
 *
 * @param title     - Note title (from front-matter, H1, or filename stem).
 * @param pathLabel - Vault-relative path or bare filename for the subtitle row.
 * @param excerpt   - Plain-text body excerpt (may be empty for front-matter-only
 *                    files — EC-18). When empty the excerpt row is hidden.
 * @returns A new `<div>` element with the `data-markable-wiki-popover` attribute
 *          and three child rows appended.
 */
export function createPopoverElement(
  title: string,
  pathLabel: string,
  excerpt: string
): HTMLElement {
  const popoverEl = document.createElement("div");
  /* data-markable-wiki-popover attribute is used by the CSS selector. */
  popoverEl.setAttribute("data-markable-wiki-popover", "true");

  const titleEl = document.createElement("div");
  titleEl.className = "wl-popover-title";
  titleEl.textContent = title;

  const pathEl = document.createElement("div");
  pathEl.className = "wl-popover-path";
  pathEl.textContent = pathLabel;

  const excerptEl = document.createElement("div");
  excerptEl.className = "wl-popover-excerpt";
  excerptEl.textContent = excerpt;
  /* EC-18: hide the excerpt row entirely when the body was empty. */
  if (!excerpt) excerptEl.style.display = "none";

  popoverEl.appendChild(titleEl);
  popoverEl.appendChild(pathEl);
  popoverEl.appendChild(excerptEl);

  return popoverEl;
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Broken-Link Creation Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute filesystem path where a new note should be created.
 *
 * Rules (FR-2):
 *  - No path prefix (e.g. "new idea")     → "{vaultRoot}/new idea.md"
 *  - Path prefix (e.g. "folder/note")     → "{vaultRoot}/folder/note.md"
 *  - Absolute path (leading "/")          → used verbatim, ".md" appended if absent
 *  - Anchor suffix (e.g. "note#intro")    → anchor stripped before extension
 *
 * Preserves the author's capitalisation of the raw target text.
 * Does NOT lowercase. The vault index lookup is case-insensitive so the
 * decoration re-classifies the link as valid regardless of case.
 *
 * @param rawTarget  - Raw wiki-link target string (from data-wiki-target attribute).
 * @param vaultRoot  - Absolute path of the vault root directory (no trailing slash).
 * @returns Absolute path for the new file (always ends in ".md").
 */
function resolveCreationPath(rawTarget: string, vaultRoot: string): string {
  // Strip #anchor suffix before constructing the filename (EC-15).
  const withoutAnchor = rawTarget.includes("#")
    ? rawTarget.slice(0, rawTarget.indexOf("#"))
    : rawTarget;

  // Ensure the path ends with ".md".
  const withExt = withoutAnchor.endsWith(".md")
    ? withoutAnchor
    : withoutAnchor + ".md";

  // Absolute path: return as-is (unusual but must not crash).
  if (withExt.startsWith("/")) {
    return withExt;
  }

  // Relative (with or without path prefix): always vault-root-relative (FR-2).
  return vaultRoot + "/" + withExt;
}

/**
 * Build the "Create note" variant popover element for a broken wiki-link.
 *
 * Analogous to `createPopoverElement` but shows the stem title, the resolved
 * creation path, and a "Create note" button instead of a file excerpt.
 *
 * The returned element is NOT yet attached to the document. The caller
 * is responsible for appending it, setting `_activePopoverEl`, and
 * positioning it via `positionPopover`.
 *
 * @param displayStem       - The note title derived from the target (after
 *                            stripping path prefix and anchor). Used as the
 *                            title row text.
 * @param vaultRelativePath - Vault-root-relative path where the file will be
 *                            created (e.g. "folder/My Note.md"). Shown as the
 *                            subtitle row so the user knows where the file lands.
 * @returns A new `<div>` element with `data-markable-wiki-popover` attribute,
 *          title, path, and a button row appended.
 */
function createBrokenLinkPopoverElement(
  displayStem: string,
  vaultRelativePath: string
): HTMLElement {
  const popoverEl = document.createElement("div");
  popoverEl.setAttribute("data-markable-wiki-popover", "true");

  const titleEl = document.createElement("div");
  titleEl.className = "wl-popover-title";
  titleEl.textContent = displayStem;

  const pathEl = document.createElement("div");
  pathEl.className = "wl-popover-path";
  pathEl.textContent = vaultRelativePath;

  const btnEl = document.createElement("button");
  btnEl.className = "wl-popover-create-btn btn btn-primary";
  btnEl.textContent = "Create note";
  // type="button" prevents accidental form submission in any ancestor form.
  btnEl.setAttribute("type", "button");

  popoverEl.appendChild(titleEl);
  popoverEl.appendChild(pathEl);
  popoverEl.appendChild(btnEl);

  return popoverEl;
}

/**
 * Replace the "Create note" button in the active popover with an inline
 * error message.
 *
 * Called when `ensure_directory` or `write_file` fails (FR-5). The popover
 * remains open so the user can read the error. If no active popover exists
 * (already dismissed) this is a no-op.
 *
 * @param message - Human-readable error string.
 */
function _showInlinePopoverError(message: string): void {
  if (!_activePopoverEl) return;

  const btn = _activePopoverEl.querySelector(".wl-popover-create-btn");
  if (btn) {
    const errEl = document.createElement("div");
    errEl.className = "wl-popover-error-msg";
    errEl.textContent = message;
    btn.replaceWith(errEl);
  }
}

/**
 * Handle the "Create note" button click.
 *
 * Called from an event listener wired by `showWikiPopover` when the user
 * clicks the button in the broken-link popover. Exported for test access.
 *
 * Steps:
 *  1. Version guard — abort if the popover was dismissed while the click
 *     event was in the browser queue (EC-11, NFR-4).
 *  2. Null-guard the window globals (EC-2).
 *  3. Call `ensure_directory` for the parent directory of the target path.
 *     On error: show an inline error message inside the popover and return.
 *  4. Call `write_file` with the initial content `# {displayStem}\n` (FR-3).
 *     On error: show an inline error message inside the popover and return.
 *  5. Fire-and-forget `reloadVaultIndex()` (FR-4 step 1).
 *  6. Fire-and-forget `openFileInTab(absolutePath)` (FR-4 step 2).
 *  7. Call `dismissWikiPopover()` (FR-4 step 3).
 *
 * @param absolutePath    - Resolved absolute path for the new file.
 * @param displayStem     - Display title used as the H1 heading in the new file.
 * @param capturedVersion - The `_hoverFetchVersion` value captured when the
 *                          button was rendered. Used for EC-11 race safety.
 */
export async function handleCreateNoteClick(
  absolutePath: string,
  displayStem: string,
  capturedVersion: number
): Promise<void> {
  // EC-11: abort if the popover was dismissed while this click was queued.
  if (capturedVersion !== _hoverFetchVersion) return;

  // EC-2: null-guard globals before use.
  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;

  if (!vaultManager) {
    console.warn(
      "[backlinks] handleCreateNoteClick: __MARKABLE_VAULT_MANAGER__ missing"
    );
    return;
  }

  // Step 3: ensure parent directory exists (EC-8).
  const parentDir = absolutePath.slice(0, absolutePath.lastIndexOf("/"));
  if (parentDir) {
    try {
      await (window as any).__TAURI_INTERNALS__.invoke("ensure_directory", {
        path: parentDir,
      });
    } catch (err) {
      _showInlinePopoverError(`Could not create folder: ${err}`);
      return;
    }
  }

  // EC-11: re-check version after the first await.
  if (capturedVersion !== _hoverFetchVersion) return;

  // Step 4: write the new file atomically.
  const initialContent = `# ${displayStem}\n`;
  try {
    await (window as any).__TAURI_INTERNALS__.invoke("write_file", {
      path: absolutePath,
      content: initialContent,
    });
  } catch (err) {
    _showInlinePopoverError(`Could not create note: ${err}`);
    return;
  }

  // EC-11: re-check version after the second await.
  if (capturedVersion !== _hoverFetchVersion) return;

  // Step 5: rebuild vault index (non-fatal, fire-and-forget).
  /*
   * HIGH-1: `try { void asyncFn() } catch` does NOT catch async rejections —
   * the promise escapes the try block before it rejects.  Use .catch() instead
   * so async errors are always handled regardless of microtask timing.
   */
  vaultManager.reloadVaultIndex?.()?.catch((err: unknown) => {
    console.error(
      "[backlinks] handleCreateNoteClick: reloadVaultIndex failed:",
      err
    );
  });

  // Step 6: open the new file in a tab (non-fatal, fire-and-forget).
  if (!tabManager || typeof tabManager.openFileInTab !== "function") {
    console.warn(
      "[backlinks] handleCreateNoteClick: __MARKABLE_TAB_MANAGER__ missing or invalid"
    );
  } else {
    /*
     * HIGH-1: same async-rejection reason as reloadVaultIndex above.
     * Use .catch() to ensure promise rejections are always surfaced.
     */
    tabManager.openFileInTab(absolutePath)?.catch((err: unknown) => {
      console.error(
        "[backlinks] handleCreateNoteClick: openFileInTab failed:",
        err
      );
    });
  }

  // Step 7: dismiss the popover.
  dismissWikiPopover();
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Show / Dismiss
// ---------------------------------------------------------------------------

/**
 * Remove the active popover from the DOM and cancel all pending timers.
 *
 * Safe to call when no popover is visible (idempotent). Also increments
 * `_hoverFetchVersion` so any in-flight `invokeReadFile` call that
 * completes after `dismissWikiPopover` runs will see a version mismatch
 * and discard its result rather than rendering a stale popover.
 *
 * Called from:
 *  - The 60 ms dismiss timer when the cursor leaves the span/popover.
 *  - The click-anywhere handler.
 *  - `showWikiPopover` before creating a new popover (FR-4.4).
 *  - `onDisable` cleanup.
 */
export function dismissWikiPopover(): void {
  /* Cancel the show-delay timer if it is pending. */
  if (_hoverShowTimer !== null) {
    clearTimeout(_hoverShowTimer);
    _hoverShowTimer = null;
  }

  /* Cancel the grace-period dismiss timer if it is pending. */
  if (_hoverDismissTimer !== null) {
    clearTimeout(_hoverDismissTimer);
    _hoverDismissTimer = null;
  }

  /*
   * Increment the fetch version so any in-flight fetch discards its result
   * (FR-2.4). This is critical for the race condition where the user dismisses
   * a popover while a slow network read is still in progress (EC-04, EC-15).
   */
  _hoverFetchVersion++;

  /* Remove the popover element from the DOM. */
  if (_activePopoverEl) {
    _activePopoverEl.remove();
    _activePopoverEl = null;
  }
}

/**
 * Fetch the linked file, extract display content, build and show the popover.
 *
 * This is the async orchestration function called by the hover show-timer.
 * It is exported so that `hover-popover.test.ts` can call it directly via
 * the test-only export (step_05 recommendation).
 *
 * Race safety (FR-2.4, EC-04): `_hoverFetchVersion` is incremented before
 * the fetch and captured in a local constant. If the version has changed by
 * the time the fetch resolves (because the user moved away or dismissed), the
 * function returns without rendering.
 *
 * @param spanEl - The hovered `.cm-wiki-link` span element (used for positioning).
 * @param target - Raw wiki-link target string (before normalization).
 */
export async function showWikiPopover(
  spanEl: HTMLElement,
  target: string
): Promise<void> {
  /* Guard: plugin must be enabled. */
  if (!_enabled) return;

  /*
   * Increment the fetch version BEFORE any branch so that dismissWikiPopover
   * increments correctly for both broken and valid paths (NFR-4, EC-11).
   * The local copy is compared against `_hoverFetchVersion` after each await
   * to detect stale results from a superseded hover.
   */
  _hoverFetchVersion++;
  const myVersion = _hoverFetchVersion;

  // ── Broken-link path ──────────────────────────────────────────────────────

  if (spanEl.classList.contains("cm-wiki-link-broken")) {
    /*
     * EC-1: no vault active — suppress the broken-link popover entirely.
     * getActiveVault() is null when no vault folder has been opened.
     * We read the vault root from the first entry in rootPaths (the canonical
     * path the index was built from).
     */
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    const vaultRoot: string | undefined =
      vaultManager?.getActiveVault?.()?.rootPaths?.[0];

    if (!vaultRoot) return;

    /* Resolve the absolute creation path (FR-2). */
    const absolutePath = resolveCreationPath(target, vaultRoot);

    /* Derive the vault-relative path for the subtitle row. */
    const vaultRelPath = absolutePath.startsWith(vaultRoot + "/")
      ? absolutePath.slice(vaultRoot.length + 1)
      : absolutePath;

    /*
     * Derive the display stem: strip path prefix and anchor from the raw
     * target, preserving capitalisation (FR-3 title row).
     */
    const withoutAnchor = target.includes("#")
      ? target.slice(0, target.indexOf("#"))
      : target;
    const slashIdx = withoutAnchor.lastIndexOf("/");
    const displayStem =
      slashIdx === -1 ? withoutAnchor : withoutAnchor.slice(slashIdx + 1);

    /* Dismiss any previously visible popover (FR-4.4). */
    dismissWikiPopover();

    /*
     * CRITICAL: capture clickVersion AFTER dismissWikiPopover() because
     * dismissWikiPopover() increments _hoverFetchVersion.  Capturing before
     * the dismiss would give clickVersion = N while _hoverFetchVersion = N+1,
     * which would make the guard in handleCreateNoteClick always fire and
     * permanently break the Create note button (EC-11).
     */
    const clickVersion = _hoverFetchVersion;

    /* Build and attach the broken-link popover DOM. */
    const brokenPopoverEl = createBrokenLinkPopoverElement(
      displayStem,
      vaultRelPath
    );
    document.body.appendChild(brokenPopoverEl);
    _activePopoverEl = brokenPopoverEl;

    /*
     * Wire the button click to the creation handler.
     * `clickVersion` is captured AFTER dismiss so it matches the current
     * _hoverFetchVersion, allowing the guard inside handleCreateNoteClick
     * to correctly detect only superseded (stale) invocations (EC-11).
     */
    const btn = brokenPopoverEl.querySelector(
      ".wl-popover-create-btn"
    ) as HTMLButtonElement | null;
    if (btn) {
      btn.addEventListener("click", () => {
        void handleCreateNoteClick(absolutePath, displayStem, clickVersion);
      });
    }

    /* Position and fade in (same pattern as valid-link popover). */
    positionPopover(spanEl, brokenPopoverEl);
    brokenPopoverEl.style.opacity = "0";
    brokenPopoverEl.style.display = "block";
    void brokenPopoverEl.offsetHeight; // force layout so WebKit transition works
    brokenPopoverEl.style.transition = "opacity 100ms ease, transform 100ms ease";
    brokenPopoverEl.style.opacity = "1";
    brokenPopoverEl.style.transform = "translate(0, 0)";

    return; // broken-link branch ends here
  }

  // ── Valid-link path (existing code, unchanged) ────────────────────────────

  /*
   * EC-07: an untitled (unsaved) document has no file path.
   * Without a current file we cannot resolve the wiki-link target.
   * This guard only applies to the valid-link path — the broken-link path
   * only needs the vault root, not the current file (EC-12).
   */
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as
    | string
    | null;
  if (!currentFile) return;

  /* Resolve the absolute path from the current file's directory. */
  const resolvedPath = resolveWikiLinkPath(currentFile, target);

  /* Fetch the file content via the existing invokeReadFile helper. */
  const result = await invokeReadFile(resolvedPath);

  /*
   * Stale-result guard: if the version changed while we were waiting,
   * another hover (or dismiss) superseded this fetch — discard it.
   */
  if (myVersion !== _hoverFetchVersion) return;

  /* Guard again after await: plugin may have been disabled while waiting. */
  if (!_enabled) return;

  /* EC-01: file not found or read error — silently abort. */
  if (!result.ok) {
    console.debug(
      "[backlinks] hover-popover: file not found:",
      resolvedPath
    );
    return;
  }

  /* Extract title, path label, and excerpt from raw content. */
  const { title, pathLabel, excerpt } = extractPopoverContent(
    result.value,
    resolvedPath
  );

  /* Dismiss any previously visible popover before creating a new one (FR-4.4). */
  dismissWikiPopover();

  /* Build and attach the popover DOM element (FR-4.2, FR-4.3). */
  const popoverEl = createPopoverElement(title, pathLabel, excerpt);
  document.body.appendChild(popoverEl);
  _activePopoverEl = popoverEl;

  /* Position before making visible so the initial paint is in the right place. */
  positionPopover(spanEl, popoverEl);

  /*
   * Trigger the CSS fade-in transition (FR-9.4).
   *
   * LOW-2 (WebKit fix): instead of toggling a class (which does not animate
   * from display:none in WebKit), we set styles imperatively:
   *  1. Set opacity:0 so the transition has a defined start value.
   *  2. Set display:block to make the element layout-participating.
   *  3. Force a layout flush via offsetHeight so WebKit registers the
   *     opacity:0 state before we transition away from it.
   *  4. Apply the transition property and target values in one assignment.
   */
  popoverEl.style.opacity = "0";
  popoverEl.style.display = "block";
  void popoverEl.offsetHeight; // force layout so transition works in WebKit
  popoverEl.style.transition = "opacity 100ms ease, transform 100ms ease";
  popoverEl.style.opacity = "1";
  popoverEl.style.transform = "translate(0, 0)";
}

// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Handler Builders
// ---------------------------------------------------------------------------

/**
 * Build the `mouseover` handler closure for wiki-link hover detection.
 *
 * Extracted from `onEnable` so that:
 *  - The handler body is readable in isolation (not buried in a 300-line method).
 *  - Tests can invoke the returned closure directly via `buildHoverHandler()(e)`
 *    without going through the full `onEnable` lifecycle.
 *
 * The returned closure:
 *  1. Guards against disabled state (`_enabled` flag check).
 *  2. EC-08 grace period: if the cursor moves INTO the active popover, cancel
 *     any pending dismiss timer and return early (keeps popover alive).
 *  3. If the event target is or is inside a `[data-wiki-target]` span, cancel
 *     any pending show/dismiss timers from a prior span and start the 180 ms
 *     show-delay timer (FR-1.1). EC-12: empty target attribute → skip.
 *
 * @returns A `(e: MouseEvent) => void` closure that reads and writes the
 *          module-level hover state variables.
 */
export function buildHoverHandler(): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    if (!_enabled) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    /*
     * EC-08 grace period: if the cursor moves INTO the active popover,
     * cancel any pending dismiss timer so the popover stays visible while
     * the user reads it. Return without starting a new show timer.
     */
    if (
      _activePopoverEl &&
      (target === _activePopoverEl || _activePopoverEl.contains(target))
    ) {
      if (_hoverDismissTimer !== null) {
        clearTimeout(_hoverDismissTimer);
        _hoverDismissTimer = null;
      }
      return;
    }

    /* Find the closest ancestor (or self) with a data-wiki-target attribute. */
    const spanEl = target.closest("[data-wiki-target]") as HTMLElement | null;
    if (!spanEl) return;

    /*
     * The cursor has moved onto a new wiki-link span. Cancel any timers
     * from a prior span so they don't fire for the wrong target.
     */
    if (_hoverShowTimer !== null) {
      clearTimeout(_hoverShowTimer);
      _hoverShowTimer = null;
    }
    if (_hoverDismissTimer !== null) {
      clearTimeout(_hoverDismissTimer);
      _hoverDismissTimer = null;
    }

    const wikiTarget = spanEl.getAttribute("data-wiki-target");
    /* EC-12: empty target attribute — skip to avoid a vacuous fetch. */
    if (!wikiTarget) return;

    /*
     * Start the 180 ms show-delay timer (FR-1.1).
     * If the user leaves before it fires, the dismiss handler cancels it.
     */
    _hoverShowTimer = setTimeout(() => {
      _hoverShowTimer = null;
      void showWikiPopover(spanEl, wikiTarget);
    }, 180);
  };
}

/**
 * Build the `mouseleave` / `click` dismiss handler closure.
 *
 * Extracted from `onEnable` so that:
 *  - The handler body is readable in isolation.
 *  - Tests can invoke the returned closure directly via `buildDismissHandler()(e)`
 *    without going through the full `onEnable` lifecycle.
 *
 * The returned closure handles three dismissal scenarios:
 *  1. `click` anywhere on the document → immediate dismiss (FR-6.1).
 *  2. `mouseleave` on a wiki-link span → start 60 ms grace timer (EC-08).
 *  3. `mouseleave` on the popover itself → start 60 ms grace timer (EC-08).
 *
 * `mouseleave` is used instead of `mouseout` for span/popover because
 * `mouseleave` does not fire when moving to a child element, matching the
 * desired "stay alive while hovering children" behavior.
 *
 * @returns A `(e: MouseEvent) => void` closure that reads and writes the
 *          module-level hover state variables.
 */
export function buildDismissHandler(): (e: MouseEvent) => void {
  /*
   * The handler accepts `Event` internally (it handles both `mouseleave` and
   * `click` events registered at capture phase). The outer return type is cast
   * to `(e: MouseEvent) => void` because the stored reference type
   * `_wikiLinkHoverLeaveHandler` requires a MouseEvent signature for the
   * removeEventListener call in `onDisable`.
   */
  const handler = (e: Event): void => {
    if (!_enabled) return;

    /* Case 1: click anywhere → immediate dismiss. */
    if (e.type === "click") {
      if (_activePopoverEl) dismissWikiPopover();
      return;
    }

    /* Cases 2 & 3: mouseleave on span or popover. */
    const me = e as MouseEvent;
    const evTarget = me.target as HTMLElement | null;
    if (!evTarget) return;

    const isLeavingSpan = !!(
      evTarget.hasAttribute("data-wiki-target") ||
      evTarget.closest("[data-wiki-target]")
    );
    const isLeavingPopover = !!(
      _activePopoverEl &&
      (evTarget === _activePopoverEl || _activePopoverEl.contains(evTarget))
    );

    if (!isLeavingSpan && !isLeavingPopover) return;

    /* Cancel any pending show timer so it cannot fire after the cursor left. */
    if (_hoverShowTimer !== null) {
      clearTimeout(_hoverShowTimer);
      _hoverShowTimer = null;
    }

    /* If no popover is currently visible, nothing to dismiss. */
    if (!_activePopoverEl) return;

    /*
     * Start the 60 ms grace-period dismiss timer (FR-6.1, EC-08).
     * If the cursor enters the popover within 60 ms, the hover handler
     * cancels this timer (see EC-08 branch in `buildHoverHandler`).
     */
    if (_hoverDismissTimer !== null) {
      clearTimeout(_hoverDismissTimer);
    }
    _hoverDismissTimer = setTimeout(() => {
      _hoverDismissTimer = null;
      dismissWikiPopover();
    }, 60);
  };

  return handler as (e: MouseEvent) => void;
}

// ---------------------------------------------------------------------------
// Step 9: Plugin Export
// ---------------------------------------------------------------------------

// Type-only import — erased by tsc, no runtime code emitted.
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ---------------------------------------------------------------------------
// onEnable helpers — extracted for readability and testability
// ---------------------------------------------------------------------------

/**
 * Inject the wiki-popover CSS, build the hover and dismiss closures, and
 * attach both to `document` as capturing event listeners.
 *
 * Extracted from `onEnable` so that:
 *  - The listener setup is readable in isolation.
 *  - The stored references (`_wikiLinkHoverHandler`,
 *    `_wikiLinkHoverLeaveHandler`) are set in one place.
 *
 * Called as the first side-effectful step in `onEnable`, before the CM6
 * extensions are built, because the hover handler depends only on the
 * `_enabled` flag (already set before this function runs).
 */
function _wireHoverListeners(): void {
  injectWikiPopoverStyles();

  /*
   * Build and register the hover handler (mouseover, capture phase).
   *
   * Using `mouseover` (not `mouseenter`) allows a single top-level
   * listener to intercept events from any `.cm-wiki-link` span, including
   * spans that are created or replaced after `onEnable` runs (as visible
   * ranges change). Capture phase (`true`) ensures this fires before any
   * CM6 event handlers.
   *
   * The handler body lives in the named function `buildHoverHandler` so
   * that tests can invoke it directly without going through `onEnable`.
   */
  _wikiLinkHoverHandler = buildHoverHandler();
  document.addEventListener("mouseover", _wikiLinkHoverHandler, true);

  /*
   * Build and register the dismiss handler (mouseleave + click, capture phase).
   *
   * Handles three dismissal scenarios:
   *  1. `mouseleave` on a wiki-link span → start 60 ms grace timer.
   *  2. `mouseleave` on the popover itself → start 60 ms grace timer.
   *  3. `click` anywhere on the document → immediate dismiss (FR-6.1).
   *
   * A single function reference is registered for both event types so
   * that both can be removed with one stored reference in `onDisable`.
   *
   * The handler body lives in the named function `buildDismissHandler` so
   * that tests can invoke it directly without going through `onEnable`.
   */
  _wikiLinkHoverLeaveHandler = buildDismissHandler();
  document.addEventListener("mouseleave", _wikiLinkHoverLeaveHandler, true);
  document.addEventListener("click", _wikiLinkHoverLeaveHandler, true);
}

/**
 * Build the CM6 extension array and register it via `api.addExtensions()`.
 *
 * Assembles (in dependency order):
 *  1. Wiki-link decoration ViewPlugin (Step 4) — hides `[[`/`]]` syntax.
 *  2. Click-to-navigate document listener (Step 5) — opens the linked file.
 *  3. Autocomplete extension (Step 6) — `[[` completion source.
 *  4. Tab-switch updateListener (Step 7) — detects file changes, triggers
 *     index rebuilds.
 *  5. Fallback poll timer (Step 7) — catches tab switches that do not
 *     produce a CM6 transaction.
 *
 * All extensions that depend on `__CM_VIEW__` are guarded with a null
 * check and degrade gracefully (empty array / no-op) when the global is
 * absent (e.g. in the test environment).
 *
 * @param api    - The `MarkablePluginAPI` instance passed to `onEnable`.
 */
function _buildCmExtensions(api: MarkablePluginAPI): void {
  // Length justified: registers 6 tightly coupled extension points (decoration,
  // click handler, autocomplete, update listener, poll timer, vault subscriptions)
  // that all share _view, _enabled, and api; extracting each would require passing
  // all shared mutable references as parameters, reducing readability with no gain.
  const cmView = (window as any).__CM_VIEW__;
  const extensions: any[] = [];

  /* 1. Wiki-link decoration ViewPlugin (Step 4) */
  extensions.push(...buildWikiLinkDecorationExtension());

  /*
   * 2. Click handler for wiki-link navigation (Step 5).
   * Uses a document-level click listener (not CM6 domEventHandlers) to
   * avoid interfering with CM6's mousedown/selection handling. The
   * listener is added on enable and removed on disable.
   */
  if (cmView && cmView.EditorView) {
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

  /* 3. Autocomplete extension (Step 6) — gracefully absent if global missing */
  extensions.push(...buildAutocompleteExtension());

  /*
   * 4. Tab-switch and doc-change listener (Step 7).
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
   * 5. Fallback: poll for file path changes every 500ms.
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

  /*
   * 6. Subscribe to vault index changes so broken-link decorations refresh
   *    when files are created, deleted, or when the vault is switched
   *    (FR-5, EC-08, EC-09, EC-10).
   *
   *    Both callbacks dispatch a forceRebuildEffect to _view. This triggers
   *    a CM6 update cycle that calls WikiLinkPlugin.update(), which calls
   *    buildWikiLinkDecorations with the freshly updated vault index.
   *
   *    forceRebuildEffect may be null in test environments where __CM_STATE__
   *    is unavailable; the dispatch is skipped in that case (AD-3).
   *
   *    The _enabled guard matches the pattern used by the existing
   *    updateListener and poll timer to prevent stale effects from a
   *    disabled plugin.
   */
  const vaultMgrForSub = (window as any).__MARKABLE_VAULT_MANAGER__;
  if (vaultMgrForSub) {
    _onVaultChangedForDecorations = (_vault: any) => {
      if (!_enabled) return;
      // If _view is null (vault event fired before first CM6 transaction), the
      // rebuild is silently deferred to the next user-triggered transaction.
      if (forceRebuildEffect && _view) {
        _view.dispatch({ effects: forceRebuildEffect.of(undefined) });
      }
    };

    _onIndexUpdatedForDecorations = (_event: any) => {
      if (!_enabled) return;
      // If _view is null (vault event fired before first CM6 transaction), the
      // rebuild is silently deferred to the next user-triggered transaction.
      if (forceRebuildEffect && _view) {
        _view.dispatch({ effects: forceRebuildEffect.of(undefined) });
      }
    };

    vaultMgrForSub.onVaultChanged(_onVaultChangedForDecorations);
    vaultMgrForSub.onIndexUpdated(_onIndexUpdatedForDecorations);
  }

  api.addExtensions(extensions);
}

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
 *   3. Wire hover popover listeners via `_wireHoverListeners`.
 *   4. Build and register CM6 extensions via `_buildCmExtensions`.
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

  /*
   * onEnable is a lifecycle orchestrator. Its length is justified by the
   * ordered dependency chain: CSS must be injected before listeners, listeners
   * must be wired before extensions (so hover state is valid when the first
   * CM6 transaction fires), and the sidebar panel must be registered before
   * the initial index rebuild fires its callback (which calls rebuildBacklinksDOM).
   * Each numbered step below corresponds to a step in the sequence above.
   */
  onEnable(api: MarkablePluginAPI): void {
    /* Step 1: Mark plugin as active (guards all async callbacks) */
    _enabled = true;

    /* Step 2: Inject CSS — wiki-link decorations and backlinks panel */
    injectWikiLinkStyles();
    injectBacklinksCSS();

    /* Step 3: Wire hover-popover CSS + document listeners (FR-8.1) */
    _wireHoverListeners();

    /* Step 4: Build CM6 extension array and register with the editor */
    _buildCmExtensions(api);

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
    // Length justified: the disable sequence must mirror the exact reverse of
    // onEnable across 10 steps (timers, CM6 extensions, sidebar, CSS, click handlers,
    // vault subscriptions, hover popover, and module-level state reset); splitting
    // across helpers would obscure the invariant that every onEnable registration
    // has a corresponding cleanup here.
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

    /* Step 5b: Unsubscribe vault-change decoration callbacks (EC-14, AD-4).
     * The null-check before each off* call is defensive — in theory both are
     * set together in _buildCmExtensions, but this guards partial-enable failures.
     * Variables are nulled after the off* calls to match the pattern used by
     * _wikiLinkClickHandler above. */
    const vaultMgrForCleanup = (window as any).__MARKABLE_VAULT_MANAGER__;
    // If vaultMgrForCleanup is null (vault manager already torn down), the callbacks
    // remain in its internal Set but are effectively inert because _enabled is false.
    if (vaultMgrForCleanup) {
      if (_onVaultChangedForDecorations) {
        vaultMgrForCleanup.offVaultChanged(_onVaultChangedForDecorations);
      }
      if (_onIndexUpdatedForDecorations) {
        vaultMgrForCleanup.offIndexUpdated(_onIndexUpdatedForDecorations);
      }
    }
    _onVaultChangedForDecorations = null;
    _onIndexUpdatedForDecorations = null;

    // ── Step 10: Hover popover cleanup (FR-8.2) ──────────────────────────────

    /*
     * Dismiss any visible popover and cancel all pending timers before
     * removing the event listeners. This ensures a clean state even if the
     * plugin is disabled while a popover is visible or a fetch is in flight.
     */
    dismissWikiPopover();

    if (_wikiLinkHoverHandler) {
      document.removeEventListener("mouseover", _wikiLinkHoverHandler, true);
      _wikiLinkHoverHandler = null;
    }
    if (_wikiLinkHoverLeaveHandler) {
      /*
       * The same function reference was registered for both `mouseleave` and
       * `click`. Both must be removed with the same `true` (capture) flag to
       * match the registration in `onEnable`. A mismatched flag would silently
       * fail to deregister the listener, causing a memory and behavior leak.
       */
      document.removeEventListener("mouseleave", _wikiLinkHoverLeaveHandler, true);
      document.removeEventListener("click", _wikiLinkHoverLeaveHandler, true);
      _wikiLinkHoverLeaveHandler = null;
    }

    removeWikiPopoverStyles();

    /*
     * Belt-and-suspenders: explicitly null the hover state variables.
     * `dismissWikiPopover` handles most of this, but these explicit resets
     * mirror the defensive pattern used for `_view`, `_lastKnownFile`, etc.
     *
     * _hoverFetchVersion is intentionally not reset: it is a monotonic counter.
     * Resetting it risks a stale deferred fetch matching the post-re-enable version
     * on a rapid disable/re-enable cycle.
     */
    _hoverShowTimer = null;
    _hoverDismissTimer = null;
    _activePopoverEl = null;

    /* Step 6: Clear all module-level state to initial values */
    _view = null;
    _lastKnownFile = null;
    _currentBacklinks = [];
    _currentOutgoing = [];
    _isScanning = false;
    _backlinksListEl = null;
    _onScanningStateChanged = null;
    _onIndexRebuilt = null;
    /* Belt-and-suspenders: these were already nulled in Step 5b, but the
     * canonical reset block must be complete (AD-4). */
    _onVaultChangedForDecorations = null;
    _onIndexUpdatedForDecorations = null;
  },
};

export default plugin;
