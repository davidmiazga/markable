/**
 * Media Preview Plugin — IIFE entry point (FC2 #7).
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/media-preview.js
 *
 * Renders `![alt](url)` inline image Markdown syntax as visual <img> elements
 * in the CodeMirror 6 live-preview editor. Implements the Typora-style cursor-on-
 * reveal interaction: clicking a rendered image widget moves the cursor into the
 * image range, revealing the raw Markdown source for editing.
 *
 * Architecture: docs/specs/media-preview/00_index.md
 *
 * IIFE self-containment rules:
 *   - No @codemirror/* runtime imports — all CM6 APIs come from window globals.
 *   - window.__CM_VIEW__     — Decoration, WidgetType, EditorView
 *   - window.__CM_STATE__    — StateField, RangeSetBuilder
 *   - window.__CM_LANGUAGE__ — syntaxTree (lezer AST walker)
 *   - window.__MARKABLE_CONVERT_FILE_SRC__ — Tauri asset:// URL converter (AD-1)
 *   - window.__MARKABLE_CURRENT_FILE__     — current open file path (AD-2)
 *   - window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__ — suppression flag for live-preview.ts (AD-6)
 *   - CSS injected via <style> tags in onEnable, removed in onDisable.
 *   - Plugin exports `export default` a UnifiedPlugin object.
 */

// Type-only imports — erased at compile time, safe in IIFE context.
import type { DecorationSet, WidgetType as WidgetTypeClass } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";
import { buildNumberRow } from "../../settings/settings-fields";

// ── CM6 globals access ────────────────────────────────────────────────────────
//
// All @codemirror/* runtime values come from window globals set by cm-globals.ts.
// The destructure runs at IIFE evaluation time. By contract, cm-globals.ts has
// already executed before any plugin IIFE is evaluated (plugin loader ordering).

/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  WidgetType,
  Decoration,
  EditorView: _EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");

const {
  StateField,
  RangeSetBuilder,
} = (window as any).__CM_STATE__ as typeof import("@codemirror/state");

const {
  syntaxTree,
} = (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single image reference found in the document, with all annotation metadata
 * pre-parsed. Produced by scanImageRanges(); consumed by buildImageDecorations().
 */
export interface ImageRange {
  /** Document offset of the opening `!` (inclusive). */
  from: number;
  /** Document offset one past the closing `)` (exclusive). */
  to: number;
  /** Raw URL string, exactly as written in the Markdown (no encoding applied). */
  src: string;
  /** Cleaned alt text with all annotation tokens stripped. */
  cleanAlt: string;
  /** CSS class names derived from dot-prefix shorthand in alt text (e.g. `["center", "shadow"]`). */
  cssClasses: string[];
  /** Raw CSS string from `{...}` token in alt text, or undefined if absent. */
  cssStyle: string | undefined;
  /** Explicit pixel width from `|WxH` or `|W` annotation, or undefined. */
  displayWidth: number | undefined;
  /** Explicit pixel height from `|WxH` annotation, or undefined. */
  displayHeight: number | undefined;
}

/**
 * Result of parseAltAnnotations().
 * All annotation tokens have been stripped from cleanAlt.
 */
export interface AltAnnotations {
  cleanAlt: string;
  cssClasses: string[];
  cssStyle: string | undefined;
  displayWidth: number | undefined;
  displayHeight: number | undefined;
}

// ── Alt-text annotation parser ────────────────────────────────────────────────

/**
 * Parse annotation tokens embedded in alt text and return structured metadata.
 *
 * Annotation syntax (all optional, order-independent):
 *   - `{css property:value}` — inline CSS applied via style.cssText (EC-31 safe).
 *   - `|WxH` or `|W` — explicit pixel dimensions (EC-17: width-only accepted).
 *   - `.classname` — CSS class shorthand; invalid names silently discarded (EC-33).
 *
 * Parsing order is: CSS block → dimension → class shorthand → clean alt.
 * The CSS block is stripped first because a `{` inside a dimension annotation
 * would be unusual but could confuse the dimension regex.
 *
 * @param rawAlt - Raw alt text string exactly as it appears between `![` and `]`.
 * @returns      - Structured annotation data plus the cleaned alt text.
 */
export function parseAltAnnotations(rawAlt: string): AltAnnotations {
  let working = rawAlt;

  // Step 1: Extract {css} block.
  // The regex matches the first `{...}` in the string and captures the content.
  // Trimmed content that becomes empty (e.g. `{}`) is treated as undefined (no style).
  let cssStyle: string | undefined;
  working = working.replace(/\{([^}]*)\}/, (_: string, content: string) => {
    cssStyle = content.trim() || undefined;
    return "";
  });

  // Step 2: Extract |WxH or |W dimension annotation.
  // Accepts both ASCII `x` and Unicode `×` as the width×height separator.
  // Tolerates optional whitespace around the `|` and around the separator.
  // Zero or negative values (blocked by \d+) treated as undefined per FR-2.5.
  let displayWidth: number | undefined;
  let displayHeight: number | undefined;
  working = working.replace(
    /\s*\|\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*/,
    (_: string, w: string, h: string | undefined) => {
      const pw = parseInt(w, 10);
      const ph = h !== undefined ? parseInt(h, 10) : undefined;
      // Only assign if the parsed value is a positive integer (FR-2.5).
      if (pw > 0) displayWidth = pw;
      if (ph !== undefined && ph > 0) displayHeight = ph;
      return "";
    },
  );

  // Step 3: Extract .classname tokens.
  // Any dot-prefixed token is extracted from the working string.
  // Tokens that do not match the CSS identifier whitelist are silently discarded
  // (EC-33) — this is a whitelist, not a blocklist approach (see invariant #7).
  const cssClasses: string[] = [];
  working = working.replace(/\.([^\s.{}|]+)/g, (_: string, token: string) => {
    // CSS class names must start with a letter, underscore, or hyphen, followed
    // by letters, digits, underscores, or hyphens only.
    if (/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(token)) {
      cssClasses.push(token);
    }
    // Always remove the token from the working string even if invalid (EC-33),
    // so invalid tokens do not pollute the clean alt text.
    return "";
  });

  // Step 4: Trim the remaining text to produce the clean alt value.
  const cleanAlt = working.trim();

  return { cleanAlt, cssClasses, cssStyle, displayWidth, displayHeight };
}

// ── Image scanner helpers ─────────────────────────────────────────────────────

/**
 * Extract raw alt text from the full text of a lezer Image node.
 *
 * The Image node spans from `!` through the closing `)`. Alt text sits between
 * the `![` opening delimiter and the `]` closing bracket.
 *
 * Extracted as a standalone helper so scanImageRanges() stays under the 30-line
 * executable limit, and the regex logic is testable in isolation.
 *
 * @param nodeText - The full node text slice from `state.doc.sliceString(from, to)`.
 * @returns        - The raw alt text string, or "" when the pattern does not match.
 */
export function extractAltTextFromNode(nodeText: string): string {
  const altMatch = nodeText.match(/^!\[([^\]]*)\]/);
  return altMatch ? altMatch[1] : "";
}

/**
 * Extract a YouTube video ID from a YouTube URL, or return null if the URL
 * is not a recognised YouTube link.
 *
 * Handles the three common URL forms:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 * Optional query parameters (t=, list=, etc.) after the ID are ignored.
 */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,        // watch?v=
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,   // youtu.be/
    /\/embed\/([a-zA-Z0-9_-]{11})/,     // /embed/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Build an ImageWidget or YouTubeWidget for a single resolved image range.
 *
 * Encapsulates URL resolution + widget instantiation so buildImageDecorations()
 * stays under the 30-line executable limit. Pure: no window globals read here —
 * currentFile and maxDisplayWidth are injected by the caller.
 *
 * @param range           - Pre-parsed image range from scanImageRanges().
 * @param currentFile     - Absolute path of the currently open file, or null.
 * @param maxDisplayWidth - Maximum display width from plugin settings.
 * @returns               - A widget ready for Decoration.replace().
 */
export function buildWidgetForRange(
  range: ImageRange,
  currentFile: string | null,
  maxDisplayWidth: number,
): ImageWidget | YouTubeWidget {
  const youtubeId = extractYouTubeId(range.src);
  if (youtubeId) {
    return new YouTubeWidget(
      youtubeId,
      range.cleanAlt,
      range.cssClasses,
      range.cssStyle,
      range.displayWidth,
      range.displayHeight,
      maxDisplayWidth,
    );
  }
  const resolvedSrc = resolveImageSrc(range.src, currentFile);
  return new ImageWidget(
    resolvedSrc,
    range.cleanAlt,
    range.cssClasses,
    range.cssStyle,
    range.displayWidth,
    range.displayHeight,
    maxDisplayWidth,
    range.src, // originalSrc: raw URL used for broken-image hover title (FR-5.3).
  );
}

// ── Image scanner ─────────────────────────────────────────────────────────────

/**
 * Walk the lezer syntax tree and return all `Image` nodes as structured ImageRange objects.
 *
 * Using the lezer AST (instead of regex) provides three key benefits:
 *   - Images inside fenced code blocks and inline code spans are excluded natively
 *     (EC-13, EC-14) without any extra filtering code.
 *   - URLs with balanced parentheses (EC-06) are handled by the grammar.
 *   - Images inside blockquotes (EC-22) are included correctly.
 *
 * If the syntax tree is partially built on first render (EC-32), iterate() simply
 * finds fewer nodes. The StateField recomputes on the next transaction — safe degradation.
 *
 * @param state - The current CM6 EditorState (access via StateField callbacks).
 * @returns     - Array of ImageRange objects sorted by `from` (ascending order required
 *                by RangeSetBuilder).
 */
export function scanImageRanges(state: EditorState): ImageRange[] {
  const results: ImageRange[] = [];

  syntaxTree(state).iterate({
    enter(node: { name: string; from: number; to: number; node: { cursor: () => { firstChild: () => boolean; name: string; from: number; to: number; nextSibling: () => boolean } } }) {
      if (node.name !== "Image") return;

      // Walk Image children to find the URL node.
      // The lezer Markdown grammar places URL content in a child node named "URL".
      let url = "";
      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.name === "URL") {
            url = state.doc.sliceString(cursor.from, cursor.to);
          }
        } while (cursor.nextSibling());
      }

      // Extract raw alt text from the full node text via the dedicated helper.
      // Delegating to extractAltTextFromNode() keeps this function under 30 lines.
      const fullText = state.doc.sliceString(node.from, node.to);
      const rawAlt = extractAltTextFromNode(fullText);

      const annotations = parseAltAnnotations(rawAlt);

      results.push({
        from: node.from,
        to: node.to,
        src: url,
        cleanAlt: annotations.cleanAlt,
        cssClasses: annotations.cssClasses,
        cssStyle: annotations.cssStyle,
        displayWidth: annotations.displayWidth,
        displayHeight: annotations.displayHeight,
      });

      // Returning false prevents descent into Image child nodes,
      // avoiding double-counting of nested elements.
      return false;
    },
  });

  // Sort as a safety net — lezer iterates left-to-right so results are usually
  // already sorted, but RangeSetBuilder requires strictly ascending `from` order.
  results.sort((a, b) => a.from - b.from);
  return results;
}

// ── URL resolver ──────────────────────────────────────────────────────────────

/**
 * Resolve an image src string to a displayable URL.
 *
 * Returns an empty string for cases that must show a broken-image placeholder:
 *   - Empty or whitespace-only src (EC-03).
 *   - `file://` protocol — rejected by Tauri's asset protocol (FR-3.3, EC-09).
 *
 * URL categories handled:
 *   - `http://` / `https://` — pass through unchanged (FR-3.1).
 *   - `data:` — pass through unchanged (FR-3.4).
 *   - Absolute path (`/...`) — converted via __MARKABLE_CONVERT_FILE_SRC__ (FR-3.1).
 *   - Relative path — joined with current file directory, then converted (FR-3.1).
 *   - No current file (EC-07) — returns src as-is (will fail to load; onerror fires).
 *
 * Accesses window.__MARKABLE_CONVERT_FILE_SRC__ defensively (EC-35): if the global
 * is not a function (e.g. startup race), logs a warning and returns src unchanged.
 *
 * @param src         - Raw URL string from the Markdown image syntax.
 * @param currentFile - Absolute path of the currently open file, or null for unsaved.
 * @returns           - Resolved URL ready for use as <img src>, or "" for broken.
 */
export function resolveImageSrc(src: string, currentFile: string | null): string {
  // EC-03: Empty or whitespace-only URL — signal broken-image immediately.
  if (!src || src.trim() === "") return "";

  // EC-09: file:// protocol — Tauri's asset:// does not accept this. Reject it.
  if (src.startsWith("file://")) return "";

  // FR-3.1 / FR-3.4: Remote URLs and data: URIs pass through without conversion.
  if (/^(https?:|data:)/.test(src)) return src;

  // Get convertFileSrc defensively so a missing global does not crash the plugin.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const convertFileSrc = (window as any).__MARKABLE_CONVERT_FILE_SRC__;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (typeof convertFileSrc !== "function") {
    // EC-35: global not yet assigned at enable time.
    // Pass src as-is — the <img> will fail to load and onerror shows the placeholder.
    console.warn("[media-preview] __MARKABLE_CONVERT_FILE_SRC__ is not defined");
    return src;
  }

  // FR-3.1: Absolute local path — convert directly to asset:// URL.
  if (src.startsWith("/")) {
    return convertFileSrc(src) as string;
  }

  // FR-3.1: Relative local path — resolve against the current file's directory.
  // EC-07: If currentFile is null (unsaved document), the path cannot be resolved.
  // Return src as-is — it will fail to load and the onerror handler shows the placeholder.
  if (currentFile) {
    const dir = currentFile.replace(/\/[^/]*$/, "");
    // Use URL to normalize .. and . segments before converting to asset://.
    // Simple string join (`${dir}/${src}`) leaves "../" unresolved, which the
    // asset:// protocol does not normalize — the image 404s even though the
    // file exists.
    const normalized = new URL(src, `file://${dir}/`).pathname;
    return convertFileSrc(normalized) as string;
  }

  // EC-07: No current file path available — pass through.
  return src;
}

// ── Cursor overlap test ───────────────────────────────────────────────────────

/**
 * Return true if the cursor or selection overlaps the given document range.
 *
 * "Overlapping" covers:
 *   - Collapsed cursor inside the range (both anchor and head between from and to).
 *   - Cursor exactly on the opening delimiter at `from` (EC-01).
 *   - Cursor at `to - 1` (on the closing character) is inside (EC-02).
 *   - Cursor exactly at `to` is OUTSIDE — the image is rendered as a widget.
 *   - Selection partially intersecting the range from either side (FR-1.4).
 *   - Selection spanning the entire range.
 *
 * Unified formula: selFrom < to && selTo >= from
 * Normalises anchor/head with Math.min/max to handle reversed selections.
 *
 * This formula is identical to the math plugin's isCursorInsideRange (invariant #6).
 *
 * @param selectionAnchor - state.selection.main.anchor
 * @param selectionHead   - state.selection.main.head
 * @param from            - Inclusive start of the image range.
 * @param to              - Exclusive end of the image range.
 */
export function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number,
): boolean {
  const selFrom = Math.min(selectionAnchor, selectionHead);
  const selTo   = Math.max(selectionAnchor, selectionHead);
  // Overlap: the selection and the range share at least one character position.
  return selFrom < to && selTo >= from;
}

// ── CSS injection helpers ─────────────────────────────────────────────────────

/** Unique DOM id for the plugin's injected <style> tag. */
const PLUGIN_CSS_ELEMENT_ID = "__markable_media_preview_css__";

/**
 * CSS for all media-preview widget styles.
 *
 * Uses CSS custom properties with fallback values throughout so that any active
 * theme can override individual values without modifying this file (NFR-4).
 * All alignment helpers (.center, .left, .right, .shadow, .rounded) are
 * applied as class names via the alt text class shorthand annotation.
 */
const PLUGIN_CSS = `
/* ── Media Preview Plugin CSS ─────────────────────────────────────────────── */

/* Container span wrapping each image widget */
.cm-media-container {
  display: inline-block;
  vertical-align: middle;
  max-width: 100%;
  line-height: 0; /* prevents extra space below inline-block image */
}

/* Rendered image */
.cm-media-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--media-image-radius, 4px);
  /* Subtle border using CSS variable for theme overrides */
  border: var(--media-image-border, 1px solid transparent);
}

/* Loading state — applied before the image loads (native browser handles this) */
.cm-media-image[src=""] {
  min-width: 60px;
  min-height: 40px;
  background: var(--media-loading-bg, rgba(128, 128, 128, 0.1));
}

/* ── Built-in alignment helpers (applied via .classname alt text annotation) ─ */

.cm-media-image.center,
.cm-media-container:has(.cm-media-image.center) {
  display: block;
  margin-left: auto;
  margin-right: auto;
}

/* Float must be on the container (the inline-block <span>), not the inner <img>.
 * Floating the <img> alone traps the float inside the inline-block formatting
 * context and it never escapes into the document flow. */
.cm-media-container:has(.cm-media-image.left) {
  float: left;
  margin-right: 1em;
  margin-bottom: 0.5em;
}

.cm-media-container:has(.cm-media-image.right) {
  float: right;
  margin-left: 1em;
  margin-bottom: 0.5em;
}

.cm-media-image.shadow {
  box-shadow: 0 2px 8px var(--media-shadow-color, rgba(0, 0, 0, 0.25));
}

.cm-media-image.rounded {
  border-radius: var(--media-rounded-radius, 12px);
}

/* ── Broken-image placeholder ─────────────────────────────────────────────── */

.cm-media-broken {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  min-width: 80px;
  min-height: 60px;
  background: var(--media-broken-bg, rgba(192, 57, 43, 0.08));
  border: 1px dashed var(--media-error-color, #c0392b);
  border-radius: 4px;
  color: var(--media-error-color, #c0392b);
  font-size: 0.8em;
  cursor: help; /* Signals that hovering shows the URL */
}

.cm-media-broken-icon {
  display: block;
  opacity: 0.7;
}

.cm-media-broken-icon svg {
  display: block;
}

.cm-media-broken-caption {
  display: block;
  font-style: italic;
  font-size: 0.85em;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

/* ── YouTube embed ────────────────────────────────────────────────────────── */

.cm-media-youtube {
  display: block;
  margin: 0.5em 0;
  line-height: 0;
}

.cm-media-youtube iframe {
  display: block;
  max-width: 100%;
  border: none;
  border-radius: var(--media-image-radius, 4px);
}

/* Alignment helpers — classes are on the container div directly, so no :has() needed */
.cm-media-youtube.center {
  /* fit-content shrinks the div to the iframe width so auto margins can center it */
  width: fit-content;
  margin-left: auto;
  margin-right: auto;
}

.cm-media-youtube.left {
  float: left;
  margin-right: 1em;
  margin-bottom: 0.5em;
}

.cm-media-youtube.right {
  float: right;
  margin-left: 1em;
  margin-bottom: 0.5em;
}
`;

/**
 * Inject the plugin CSS into the document <head>.
 *
 * Idempotent: guarded by element id so repeated calls (e.g. after plugin
 * re-enable) do not create duplicate style tags (EC-30).
 */
export function injectPluginCSS(): void {
  if (document.getElementById(PLUGIN_CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = PLUGIN_CSS_ELEMENT_ID;
  style.textContent = PLUGIN_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the injected plugin CSS style tag.
 *
 * Called from onDisable. Safe to call when the tag does not exist —
 * optional chaining on `?.remove()` prevents errors (EC-30).
 */
export function removePluginCSS(): void {
  document.getElementById(PLUGIN_CSS_ELEMENT_ID)?.remove();
}

// ── Broken-image placeholder helper ──────────────────────────────────────────

/**
 * Populate `container` with a broken-image placeholder.
 *
 * Called when:
 *   - `resolvedSrc` is empty (EC-03: empty URL, EC-09: file:// URL).
 *   - The `<img>` element fires its `onerror` event (load failure).
 *
 * The placeholder shows:
 *   - An inline SVG broken-image icon (no external asset dependency).
 *   - The alt text as a caption (if non-empty).
 *   - The original src URL as a `title` attribute for hover inspection (FR-5.3).
 *
 * Using `currentColor` in the SVG means the icon respects the CSS variable
 * `--media-error-color` applied on the container (NFR-4, FR-5.4).
 *
 * @param container   - The <span class="cm-media-container"> to populate.
 * @param cleanAlt    - Cleaned alt text (shown as caption below the icon).
 * @param originalSrc - Raw URL from Markdown (shown on hover via title attribute).
 */
export function renderBrokenImage(
  container: HTMLElement,
  cleanAlt: string,
  originalSrc: string,
): void {
  container.className = "cm-media-container cm-media-broken";
  container.title = originalSrc || "(empty URL)";

  // Inline SVG broken-image icon — avoids any external asset dependency.
  // Works in the Tauri WebView without network access.
  // The diagonal line through the picture frame is the conventional broken-image symbol.
  const icon = document.createElement("span");
  icon.className = "cm-media-broken-icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M3 17l5-5 4 4 3-3 6 4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>' +
    '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.5"/>' +
    "</svg>";

  container.appendChild(icon);

  // Only render the caption when alt text is present (EC-04: empty alt has no caption).
  if (cleanAlt) {
    const caption = document.createElement("span");
    caption.className = "cm-media-broken-caption";
    caption.textContent = cleanAlt;
    container.appendChild(caption);
  }
}

// ── YouTubeWidget ─────────────────────────────────────────────────────────────

/**
 * CM6 widget that renders a YouTube video as a responsive <iframe> embed.
 *
 * The iframe src uses the youtube-nocookie.com domain to avoid embedding
 * tracking cookies. The container is a block-level <div> so the embed sits
 * on its own line, matching how display-math and large images behave.
 *
 * cursor-on-reveal: ignoreEvent() returns false so CM6 forwards clicks to the
 * editor, moving the cursor into the source range and revealing raw Markdown.
 */
export class YouTubeWidget extends (WidgetType as typeof WidgetTypeClass) {
  constructor(
    readonly videoId: string,
    readonly cleanAlt: string,
    readonly cssClasses: string[],
    readonly cssStyle: string | undefined,
    readonly displayWidth: number | undefined,
    readonly displayHeight: number | undefined,
    readonly maxDisplayWidth: number,
  ) { super(); }

  eq(other: YouTubeWidget): boolean {
    return (
      other.videoId === this.videoId &&
      other.cleanAlt === this.cleanAlt &&
      other.cssClasses.join(",") === this.cssClasses.join(",") &&
      other.cssStyle === this.cssStyle &&
      other.displayWidth === this.displayWidth &&
      other.displayHeight === this.displayHeight &&
      other.maxDisplayWidth === this.maxDisplayWidth
    );
  }

  toDOM(): HTMLElement {
    // Resolve display dimensions. Annotated width takes priority over maxDisplayWidth.
    // Height defaults to 16:9 of the effective width unless explicitly annotated.
    const defaultWidth = this.maxDisplayWidth > 0 ? this.maxDisplayWidth : 600;
    const effectiveWidth = this.displayWidth
      ? Math.min(this.displayWidth, defaultWidth)
      : defaultWidth;
    const effectiveHeight = this.displayHeight ?? Math.round(effectiveWidth * 9 / 16);

    const container = document.createElement("div");
    // Append annotation CSS classes to the container so alignment helpers
    // (.center, .left, .right) and custom classes work the same as on images.
    container.className = ["cm-media-youtube", ...this.cssClasses].join(" ");
    // Apply inline style (opacity, border, etc.) to the container.
    if (this.cssStyle) container.style.cssText = this.cssStyle;

    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${this.videoId}`;
    iframe.width = String(effectiveWidth);
    iframe.height = String(effectiveHeight);
    iframe.title = this.cleanAlt || "YouTube video";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
    );

    container.appendChild(iframe);
    return container;
  }

  ignoreEvent(): boolean { return false; }
}

// ── ImageWidget ───────────────────────────────────────────────────────────────

/**
 * CM6 WidgetType that renders a single Markdown image reference as an <img> element.
 *
 * The widget extends WidgetType from window.__CM_VIEW__ (not from a direct
 * @codemirror/view import) to ensure the widget shares the same slot-ID namespace
 * as the main editor instance (Bug #5 pattern).
 *
 * The constructor receives pre-resolved src and pre-parsed annotation data.
 * `resolveImageSrc()` is NOT called inside toDOM() — this keeps toDOM() pure and
 * avoids reading window globals during DOM construction.
 *
 * `ignoreEvent()` returns false (FR-1.5): mouse clicks on the widget are NOT
 * swallowed by CM6. Instead, CM6 moves the cursor into the widget's document
 * position, triggering the StateField to reveal the raw Markdown source.
 */
export class ImageWidget extends (WidgetType as typeof WidgetTypeClass) {
  constructor(
    /** Resolved asset:// or https:// URL ready for <img src>. Empty string signals broken. */
    readonly resolvedSrc: string,
    /** Cleaned alt text (annotation tokens stripped). */
    readonly cleanAlt: string,
    /** CSS class names from dot-prefix shorthand in alt text. */
    readonly cssClasses: string[],
    /** Raw CSS string from {braces} annotation, applied via style.cssText (EC-31). */
    readonly cssStyle: string | undefined,
    /** Explicit pixel width from |WxH or |W annotation. */
    readonly displayWidth: number | undefined,
    /** Explicit pixel height from |WxH annotation. */
    readonly displayHeight: number | undefined,
    /** maxDisplayWidth setting — 0 means no constraint (AD-5). */
    readonly maxDisplayWidth: number,
    /** Raw URL from Markdown for broken-image hover title (FR-5.3). */
    readonly originalSrc: string,
  ) {
    super();
  }

  /**
   * Equality check used by CM6 to decide whether to reuse an existing DOM node.
   *
   * When all fields are equal the rendered output is identical. For cssClasses,
   * we join with "," — class order is stable (parseAltAnnotations preserves
   * appearance order), so this comparison is deterministic.
   *
   * WHY `originalSrc` is included: when resolvedSrc is empty (broken-image path),
   * two widgets with *different* raw URLs both produce resolvedSrc === "". Without
   * this field the stale DOM node would be reused and the hover title attribute
   * (set to originalSrc by renderBrokenImage) would never update (FR-5.3).
   *
   * @param other - Another ImageWidget to compare against.
   */
  eq(other: ImageWidget): boolean {
    return (
      other.resolvedSrc === this.resolvedSrc &&
      other.originalSrc === this.originalSrc &&
      other.cleanAlt === this.cleanAlt &&
      other.cssClasses.join(",") === this.cssClasses.join(",") &&
      other.cssStyle === this.cssStyle &&
      other.displayWidth === this.displayWidth &&
      other.displayHeight === this.displayHeight &&
      other.maxDisplayWidth === this.maxDisplayWidth
    );
  }

  /**
   * Create the DOM element for this widget.
   *
   * Returns a <span class="cm-media-container"> wrapping an <img>.
   * The outer container is required (not <img> directly) because the onerror
   * handler needs to remove <img> and replace it with the broken-image markup —
   * CM6 holds a reference to the root element returned by toDOM() and it cannot
   * replace itself.
   *
   * Dimension handling priority (AD-5):
   *   1. Explicit annotation (`displayWidth` / `displayHeight`) takes precedence.
   *   2. Annotation width is capped at maxDisplayWidth when the constraint is enabled.
   *   3. If no annotation width, maxDisplayWidth is used as the default width.
   *   4. If maxDisplayWidth === 0 (no constraint) and no annotation: natural size.
   */
  toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-media-container";

    // Immediately show broken-image placeholder for empty/invalid resolved src.
    // This covers EC-03 (empty URL) and EC-09 (file:// — rejected at resolution).
    if (!this.resolvedSrc) {
      renderBrokenImage(container, this.cleanAlt, this.originalSrc);
      return container;
    }

    const img = document.createElement("img");

    // FR-1.2: always include cm-media-image; append any annotation-derived classes.
    const classes = ["cm-media-image", ...this.cssClasses];
    img.className = classes.join(" ");

    img.src = this.resolvedSrc;
    img.alt = this.cleanAlt; // NFR-5: always set alt attribute (even if empty string).

    // FR-2.4 / EC-31: Apply inline CSS via style.cssText, NOT setAttribute.
    // style.cssText goes through the browser's CSS value sanitizer, which strips
    // dangerous values like `background:url(javascript:alert(1))`.
    // setAttribute bypasses some sanitization paths in older implementations.
    if (this.cssStyle) {
      img.style.cssText = this.cssStyle;
    }

    // Apply dimension constraints based on priority order described above.
    this._applyDimensions(img);

    // FR-5.2: Broken-image onerror handler.
    // Fires asynchronously after the <img> is mounted and the browser attempts to load.
    // Removes the failed <img> and replaces it with the broken-image placeholder.
    img.onerror = () => {
      container.removeChild(img);
      renderBrokenImage(container, this.cleanAlt, this.originalSrc);
    };

    container.appendChild(img);
    return container;
  }

  /**
   * Apply width and height to the <img> element based on annotation and settings.
   *
   * Four cases:
   *   1. Annotated width — use it, optionally capped by maxDisplayWidth.
   *      Height: annotated value or "auto" for proportional scaling (FR-2.1).
   *   2. No annotation, maxDisplayWidth > 0 — use maxDisplayWidth as default width (AD-5).
   *      Height: "auto".
   *   3. No annotation, maxDisplayWidth === 0 — no explicit dimension (natural size).
   *      The CSS max-width: 100% on .cm-media-image still prevents overflow.
   *
   * @param img - The <img> element to apply dimensions to.
   */
  private _applyDimensions(img: HTMLImageElement): void {
    if (this.displayWidth !== undefined) {
      // Explicit annotation — cap at maxDisplayWidth if the constraint is active.
      const w = (this.maxDisplayWidth > 0)
        ? Math.min(this.displayWidth, this.maxDisplayWidth)
        : this.displayWidth;
      img.style.width = `${w}px`;
      img.style.height = this.displayHeight !== undefined
        ? `${this.displayHeight}px`
        : "auto"; // Proportional scaling when only width is specified (FR-2.1).
    } else if (this.maxDisplayWidth > 0) {
      // No explicit annotation — use maxDisplayWidth as the default (AD-5).
      img.style.width = `${this.maxDisplayWidth}px`;
      img.style.height = "auto";
    }
    // Case 3: maxDisplayWidth === 0 and no annotation — leave width/height unset.
  }

  /**
   * Allow the editor to handle mouse events on this widget (do not swallow them).
   *
   * Returning false lets clicks move the cursor into the widget's document position
   * [from, to), which triggers the StateField to hide the decoration and show the
   * raw Markdown source (Typora-style cursor-on-reveal, FR-1.5).
   *
   * Note: this is the opposite of the core fallback ImageWidget in live-preview.ts,
   * which returns true (non-interactive). The plugin widget is intentionally clickable.
   */
  ignoreEvent(): boolean {
    return false;
  }
}

// ── Decoration builder ────────────────────────────────────────────────────────

/**
 * Build a complete DecorationSet for the given editor state.
 *
 * Called by the StateField's `create` and `update` methods. This is the core
 * render decision function: for each image range, decide whether to show the
 * widget (cursor away) or the raw Markdown source (cursor inside).
 *
 * Reads `window.__MARKABLE_CURRENT_FILE__` fresh on every call to correctly
 * reflect the currently open tab after a tab switch (AD-2).
 *
 * @param state           - Current CM6 EditorState.
 * @param maxDisplayWidth - Maximum display width from plugin settings.
 * @returns               - DecorationSet with replace decorations for all non-cursor images.
 */
export function buildImageDecorations(
  state: EditorState,
  maxDisplayWidth: number,
): DecorationSet {
  // Never decorate in source/raw mode — widgets must not appear when live preview is off.
  if (!(window as any).__MARKABLE_PREVIEW_ENABLED__) return Decoration.none;

  const ranges = scanImageRanges(state);
  const sel = state.selection.main;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const currentFile: string | null =
    (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // RangeSetBuilder requires ranges in strictly ascending `from` order.
  // scanImageRanges() guarantees this via its final sort.
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.replace>>();

  for (const range of ranges) {
    // Cursor-on-reveal (FR-1.3, FR-1.4): if the cursor or selection overlaps
    // this image range, skip the decoration so raw Markdown is visible for editing.
    if (isCursorInsideRange(sel.anchor, sel.head, range.from, range.to)) {
      continue;
    }

    // Delegate URL resolution + widget construction to buildWidgetForRange()
    // so this loop body stays within the 30-line executable line budget.
    const widget = buildWidgetForRange(range, currentFile, maxDisplayWidth);
    // YouTube embeds are always block-level so float/alignment CSS escapes CM6's
    // inline widget wrapper. Images stay inline (block: false) since they can
    // appear mid-sentence.
    const block = widget instanceof YouTubeWidget;

    builder.add(
      range.from,
      range.to,
      Decoration.replace({ widget, block }),
    );
  }

  return builder.finish();
}

// ── StateField factory ────────────────────────────────────────────────────────

/**
 * Create a fresh CM6 StateField per enable cycle (EC-24).
 *
 * This is a factory function, not a module-level constant. A fresh StateField is
 * constructed on each onEnable() call, ensuring no residual decoration state from
 * a prior enable/disable cycle. The maxDisplayWidth value is captured in the
 * factory closure so it does not need to be stored as a module-level variable.
 *
 * The field recomputes decorations whenever the document changes OR the selection
 * changes. Selection change is the trigger for cursor-on-reveal (FR-1.7).
 *
 * @param maxDisplayWidth - Maximum display width from plugin settings.
 * @returns               - A fully configured StateField<DecorationSet>.
 */
function createImageField(
  maxDisplayWidth: number,
): ReturnType<typeof StateField.define> {
  return StateField.define<DecorationSet>({
    /**
     * Called once when the field is first installed into the editor.
     * Builds the initial DecorationSet from the current document state.
     */
    create(state: EditorState): DecorationSet {
      return buildImageDecorations(state, maxDisplayWidth);
    },

    /**
     * Called on every transaction. Recomputes decorations only when the
     * document or selection changed — skipping unchanged transactions avoids
     * redundant work on transactions that do not affect image rendering.
     */
    update(value: DecorationSet, tr: Transaction): DecorationSet {
      if (!tr.docChanged && !tr.selection) {
        return value;
      }
      return buildImageDecorations(tr.state, maxDisplayWidth);
    },

    /**
     * Wire the field's value (DecorationSet) to the editor's decoration rendering.
     * This is the CM6-idiomatic way to register a StateField as a decoration provider.
     */
    provide(field) {
      return _EditorView.decorations.from(field);
    },
  });
}

// ── Module-level state ────────────────────────────────────────────────────────

/**
 * The currently active StateField instance.
 *
 * Set in onEnable (fresh instance each enable cycle — EC-24).
 * Cleared to null in onDisable.
 */
let _imageField: ReturnType<typeof StateField.define> | null = null;
let _api: MarkablePluginAPI | null = null;
let _maxDisplayWidth = 600;

// ── Settings ──────────────────────────────────────────────────────────────────

/**
 * Settings structure for the media-preview plugin.
 * Persisted via api.loadSettings() / api.saveSettings().
 */
interface MediaPreviewSettings {
  /** Maximum display width in pixels. 0 = no constraint. Default: 600. */
  maxDisplayWidth: number;
}

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * Plugin enable sequence (FR-6.3):
 *   1. Load settings and extract maxDisplayWidth (FR-7.2). Default: 600 (FR-7.1).
 *   2. Inject plugin CSS (idempotent — EC-30).
 *   3. Set suppression flag to prevent core fallback double-rendering (FR-6.2, AD-6).
 *   4. Create fresh StateField with maxDisplayWidth captured in closure (EC-24).
 *   5. Register the field via api.addExtensions([_imageField]).
 *
 * @param api - The MarkablePluginAPI injected by the plugin manager.
 */
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // Step 1: Load persisted settings.
  // Validates that maxDisplayWidth is a non-negative number; falls back to 600.
  _api = api;
  const saved = await api.loadSettings() as Partial<MediaPreviewSettings> | null;
  const maxDisplayWidth: number =
    typeof saved?.maxDisplayWidth === "number" && saved.maxDisplayWidth >= 0
      ? saved.maxDisplayWidth
      : 600;
  _maxDisplayWidth = maxDisplayWidth;

  // Step 2: Inject CSS (idempotent — calling twice produces only one <style> tag).
  injectPluginCSS();

  // Step 3: Suppress the core fallback image rendering in live-preview.ts.
  // The flag is checked at the top of handleImage() — while true, that function
  // returns immediately so no double-decoration occurs (FR-6.2, AD-6).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__ = true;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Step 4: Create fresh StateField (EC-24: no residual state from prior cycles).
  _imageField = createImageField(maxDisplayWidth);

  // Step 5: Register the field in the shared CM6 compartment.
  api.addExtensions([_imageField]);
}

/**
 * Plugin disable sequence (FR-6.4):
 *   1. api.removeExtensions() — removes the imageField from the shared Compartment.
 *      After this call, no image decorations exist; raw Markdown `![alt](url)` is visible.
 *   2. Re-enable core fallback rendering by clearing the suppression flag (FR-6.2).
 *   3. Remove injected CSS so no media-preview styles remain in the DOM.
 *   4. Clear the field reference (no residual state).
 *
 * @param api - The MarkablePluginAPI injected by the plugin manager.
 */
function onDisable(api: MarkablePluginAPI): void {
  // Step 1: Remove CM6 extensions (decorations disappear; raw Markdown shown).
  api.removeExtensions();

  // Step 2: Re-enable the core fallback so images continue to render even without
  // the plugin. Setting to false (not deleting) is equivalent for the truthy check
  // in handleImage().
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__ = false;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Step 3: Remove injected CSS.
  removePluginCSS();

  // Step 4: Clear field and API references.
  _imageField = null;
  _api = null;
}

// ── Settings UI ───────────────────────────────────────────────────────────────

/**
 * Render a minimal settings UI in the Plugins panel detail view.
 *
 * Shows a numeric input for maxDisplayWidth. The plugin manager does not inject
 * the API object into renderDetailExtra, so save-on-change is not available in
 * Phase 1. The note instructs the user to restart the plugin after editing the
 * settings JSON directly (FR-7.3: acceptable for Phase 1).
 *
 * @param container - The DOM element to append the settings UI into.
 */
function renderDetailExtra(container: HTMLElement): void {
  const row = buildNumberRow(
    "Max display width (px)",
    _maxDisplayWidth,
    { min: 0, max: 4096, step: 50, width: "80px", unit: "0 = no limit" },
    async (value) => {
      const v = Math.max(0, Math.round(value));
      _maxDisplayWidth = v;
      if (_api) await _api.saveSettings({ maxDisplayWidth: v });
    },
  );
  container.appendChild(row);
}

// ── Plugin export ─────────────────────────────────────────────────────────────

/**
 * The UnifiedPlugin descriptor for the Media Preview plugin.
 *
 * This object is the return value of the IIFE and is validated by the plugin
 * loader (validatePlugin in plugin-loader.ts). All required fields are present.
 */
export default {
  id: "media-preview",
  name: "Media Preview",
  version: "1.0.0",
  description: "Render images inline in the live editor",
  detail:
    "Renders ![alt](url) image syntax as visual images in live preview mode. " +
    "Clicking a rendered image reveals the raw Markdown source for editing. " +
    "Supports local files (relative and absolute paths) and remote URLs. " +
    "Alt text supports CSS class shorthand (.classname) and inline style ({property:value}) annotations. " +
    "Configure maxDisplayWidth in plugin settings (default: 600px).",
  renderDetailExtra,
  onEnable,
  onDisable,
};
