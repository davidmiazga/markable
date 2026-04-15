/**
 * Image Toolbar plugin for Markable 2.0.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/image-toolbar.js
 *
 * Self-containment rules (same as all .plugin.ts files):
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__ and
 *     window.__CM_LANGUAGE__.
 *   - No app-internal module imports.
 *   - CSS injected as <style id="__markable_img_toolbar_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Architecture overview:
 *   Floating popover toolbar for Markdown image operations.
 *   Triggers on:
 *     A) Click on a rendered <img class="cm-live-image"> element (live preview mode).
 *     B) Cursor moving onto the line containing ![alt](url) syntax (edit mode).
 *   Actions: change image source (file picker or URL embed), set alignment.
 *
 * Module sections (in order):
 *   1.  Type-only imports
 *   2.  Settings types and defaults
 *   3.  Module-level state declarations
 *   4.  CSS constant and lifecycle helpers
 *   5.  Pure: AlignmentState, ImageContext types
 *   6.  Pure: parseImageSyntax
 *   7.  Pure: detectDivWrapper
 *   8.  Pure: detectFloatRight
 *   9.  Pure: detectAlignment
 *   10. Pure: extractImageCore
 *   11. Pure: buildBareImage, wrapWithDiv, buildFloatRightImg, detectLineEnding, applyAlignment
 *   12. Pure: replaceImageSrc, resolveRelativePath
 *   13. DOM: buildPopover, positionPopover, showPopover, hideToolbar
 *   14. CM6 helpers: getEditorView, getCmView, getCmLanguage
 *   15. CM6: detectImageRegion, _resolveAnchorForEditMode, _fallbackPosFromImgEl
 *   16. CM6: buildUpdateListener
 *   17. Event handlers: _onDocClick, _onDocMousedown
 *   18. Action handler: handleAction
 *   19. Plugin export object
 */

// ── 1. Type-only imports (erased at compile time) ────────────────────────────

// These imports are type-only — fully erased by tsc. They provide IDE
// autocompletion and type safety without emitting any runtime code.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { EditorState as EditorStateType } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── 2. Settings types and defaults ───────────────────────────────────────────

/**
 * Persisted settings for the Image Toolbar plugin.
 * No user-configurable fields in v1.0. Hook exists for future extensibility (FR-11).
 */
export interface ImageToolbarSettings {
  // Reserved for future fields (e.g. defaultAlignment)
}

/** Default settings — empty object in v1.0. */
export const DEFAULT_SETTINGS: ImageToolbarSettings = {};

/**
 * Merge raw persisted data with defaults.
 * EC-19: null input → returns empty settings object (no crash).
 *
 * @param raw - Parsed JSON object from disk, or null if none exists.
 * @returns   A complete ImageToolbarSettings object.
 */
export function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): ImageToolbarSettings {
  // In v1.0 there are no fields to validate — always return an empty copy of defaults.
  if (!raw) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS };
}

// ── 3. Module-level state declarations ───────────────────────────────────────
// All variables are reset to initial values in onDisable to support clean toggle cycles.

/** Whether the plugin is currently enabled. Guards the updateListener. */
let _enabled: boolean = false;

/** Reference to the MarkablePluginAPI instance provided by onEnable. */
let _api: MarkablePluginAPI | null = null;

/** The popover DOM element. Created once in onEnable, reused for all triggers. */
let _popoverEl: HTMLElement | null = null;

/**
 * The current image context — set when the toolbar opens, cleared on hide.
 * Null means the toolbar is hidden.
 */
let currentImageContext: ImageContext | null = null;

/**
 * How the toolbar was last opened: "edit" (cursor on image line) or
 * "click" (user clicked rendered image). Null when hidden.
 */
let triggerMode: "edit" | "click" | null = null;

/**
 * Stored as named refs so the identical function reference can be passed
 * to removeEventListener in onDisable (NFR-3 — no anonymous listeners).
 */
let _onDocClick: ((e: MouseEvent) => void) | null = null;
let _onDocMousedown: ((e: MouseEvent) => void) | null = null;

/**
 * Blur listener attached to the editor DOM element.
 * FR-5 requires the toolbar to dismiss when the editor loses focus.
 * Stored as a named ref so the identical reference can be removed in onDisable.
 */
let _onEditorBlur: (() => void) | null = null;

/**
 * The <input> element inside the "Embed Link" panel.
 * Stored so showPopover can pre-fill it with the current image's URL.
 */
let _urlInput: HTMLInputElement | null = null;

/**
 * All four alignment buttons. Stored so showPopover can update the active
 * highlight without querying the DOM on every trigger.
 */
let _alignBtns: NodeListOf<HTMLButtonElement> | null = null;

// ── 4. CSS constant and lifecycle helpers ────────────────────────────────────

/** The id attribute of the injected <style> tag. Used for idempotent inject/remove. */
export const STYLE_ID = "__markable_img_toolbar_css__";

/**
 * Full CSS for the popover toolbar.
 * All class names are prefixed `.img-toolbar` to avoid collision with app styles.
 * CSS custom properties (var(--bg-primary) etc.) are provided by the active theme.
 */
const TOOLBAR_CSS = `
.img-toolbar {
  position: fixed;
  z-index: 10000;
  display: none;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  min-width: 220px;
}

.img-toolbar__tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
  margin-bottom: 4px;
}

.img-toolbar__tab {
  flex: 1;
  padding: 4px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: -1px;
}

.img-toolbar__tab--active {
  border-bottom-color: var(--accent-color);
  color: var(--text-primary);
}

.img-toolbar__panel {
  display: flex;
  gap: 6px;
  align-items: center;
}

.img-toolbar__input {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.img-toolbar__input:focus {
  border-color: var(--accent-color);
}

.img-toolbar__btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: var(--selection-bg);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.img-toolbar__btn:hover {
  background: var(--accent-color);
  color: var(--bg-primary);
}

.img-toolbar__divider {
  height: 1px;
  background: color-mix(in srgb, var(--text-primary) 12%, transparent);
  margin: 2px 0;
}

.img-toolbar__align-group {
  display: flex;
  gap: 4px;
}

.img-toolbar__align-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-toolbar__align-btn:hover {
  background: var(--selection-bg);
}

.img-toolbar__align-btn--active {
  background: var(--accent-color);
  color: var(--bg-primary);
}
`;

/**
 * Inject the toolbar <style> tag into <head> if not already present.
 * Idempotent — multiple calls are safe (EC-17: prevents duplicate on rapid toggle).
 */
export function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the toolbar <style> tag by id.
 * Safe to call even if the tag was never inserted (EC-17).
 */
export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// ── 5. Types: AlignmentState and ImageContext ────────────────────────────────

/** The four supported alignment states for an image. */
export type AlignmentState = "left" | "center" | "right" | "float-right";

/**
 * Describes the full context of an image region in the document.
 * Populated when the toolbar opens; cleared (set to null) when the toolbar hides.
 *
 * AD-4: all fields except anchorEl are derived from the document source; anchorEl
 * is populated by the caller (click handler or edit-mode resolver).
 */
export interface ImageContext {
  /** Document position of the region start (inclusive). */
  from: number;
  /** Document position of the region end (exclusive). */
  to: number;
  /** Raw Markdown/HTML text of the full image region. */
  rawSource: string;
  /** Extracted URL from the Markdown source (not the resolved Tauri asset URL). */
  url: string;
  /** Extracted alt text verbatim. */
  alt: string;
  /** Detected alignment of the current image form. */
  alignment: AlignmentState;
  /** The <img> DOM element (or a DOMRect-like object) used to position the popover. */
  anchorEl: HTMLElement;
}

// ── 6. Pure: parseImageSyntax ─────────────────────────────────────────────────

/**
 * Parse `![alt](url)` from raw text.
 *
 * Returns the alt and url as-is — no trimming or unescaping (NFR-5, EC-26).
 * Returns null if the text does not match the bare Markdown image form.
 *
 * EC-10: empty alt and url (`![]()`) → returns `{ url: "", alt: "" }`.
 *
 * @param text - Raw string to test (will be trimmed before matching).
 * @returns     Parsed { url, alt } or null.
 */
export function parseImageSyntax(text: string): { url: string; alt: string } | null {
  // Match exactly the form ![alt](url) with nothing else on the line.
  const match = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(text.trim());
  if (!match) return null;
  return { alt: match[1], url: match[2] };
}

// ── 7. Pure: detectDivWrapper ─────────────────────────────────────────────────

/**
 * Detect the `<div align="center|right">...</div>` wrapper form.
 *
 * Handles both the single-line form (`<div align="center">![a](b)</div>`) and
 * the two-line form where the open tag and close tag are on separate lines.
 *
 * EC-27: the caller has already split on the document's line ending; this
 * function receives plain line text strings without embedded line endings.
 *
 * @param lineText     - Full text of the candidate first line.
 * @param nextLineText - Text of the next line (null if none exists).
 * @returns            Wrapper info or null if no match.
 */
export function detectDivWrapper(
  lineText: string,
  nextLineText: string | null,
): { align: "center" | "right"; innerText: string } | null {
  // Case 1: single-line form — `<div align="center">content</div>` on one line.
  const singleLine = /^<div\s+align="(center|right)">(.*)<\/div>$/i.exec(lineText);
  if (singleLine) {
    return {
      align: singleLine[1].toLowerCase() as "center" | "right",
      innerText: singleLine[2],
    };
  }

  // Case 2: two-line form — open tag on lineText, close tag on nextLineText.
  // The inner content is everything after the opening tag on line 1,
  // followed by anything before </div> on line 2.
  const openTag = /^<div\s+align="(center|right)">(.*)/i.exec(lineText);
  if (openTag && nextLineText !== null) {
    const closeTag = /^(.*)<\/div>$/i.exec(nextLineText);
    if (closeTag) {
      // Combine the inner content from both lines. The line2 prefix before </div>
      // may be empty (typical case: `</div>` alone on its own line).
      const part1 = openTag[2];
      const part2 = closeTag[1];
      // Only include the separator if both parts are non-empty — avoids trailing \n
      const innerText = part2 ? `${part1}\n${part2}` : part1;
      return {
        align: openTag[1].toLowerCase() as "center" | "right",
        innerText,
      };
    }
  }

  return null;
}

// ── 8. Pure: detectFloatRight ─────────────────────────────────────────────────

/**
 * Return true if `lineText` (trimmed) is the float-right `<img>` form.
 *
 * The float-right form is an inline HTML `<img>` tag with `align="right"`.
 * This is distinct from the `<div align="right">` wrapper form.
 *
 * EC-3: this detection allows the toolbar to recognise float-right images.
 *
 * @param lineText - Line text to test (trimmed before testing).
 * @returns         True if this is a float-right inline image.
 */
export function detectFloatRight(lineText: string): boolean {
  return /^<img\b[^>]*\balign="right"[^>]*>/i.test(lineText.trim());
}

// ── 9. Pure: detectAlignment ──────────────────────────────────────────────────

/**
 * Classify the alignment state of a raw image region string.
 *
 * Rules applied in priority order (first match wins):
 *   1. `<div align="center">` → "center"
 *   2. `<div align="right">` → "right"
 *   3. float-right `<img>` tag → "float-right"
 *   4. Anything else (bare `![alt](url)`, `<div align="left">`, etc.) → "left"
 *
 * EC-24: never throws regardless of input — empty string returns "left".
 *
 * @param rawSource - Full raw text of the image region.
 * @returns           The current alignment classification.
 */
export function detectAlignment(rawSource: string): AlignmentState {
  if (/^<div\s+align="center">/i.test(rawSource)) return "center";
  if (/^<div\s+align="right">/i.test(rawSource)) return "right";
  if (detectFloatRight(rawSource.trim())) return "float-right";
  // Default: bare image, `<div align="left">`, or unrecognised form.
  return "left";
}

// ── 10. Pure: extractImageCore ────────────────────────────────────────────────

/**
 * Extract `url` and `alt` from any supported image form.
 *
 * Tries each form in order and returns the first successful parse:
 *   1. Bare `![alt](url)` form (parseImageSyntax).
 *   2. `<div align="...">![alt](url)</div>` — extracts inner Markdown syntax.
 *   3. Float-right `<img src="..." alt="..." ...>` — parses HTML attributes.
 *   4. Fallback: returns `{ url: "", alt: "" }` — never throws (EC-10, EC-28).
 *
 * Alt text returned verbatim — no trimming or unescaping (NFR-5, EC-26).
 *
 * @param rawSource - Full raw text of the image region.
 * @returns           Extracted { url, alt }, both empty strings on parse failure.
 */
export function extractImageCore(rawSource: string): { url: string; alt: string } {
  // Attempt 1: bare Markdown image form.
  const bare = parseImageSyntax(rawSource.trim());
  if (bare) return bare;

  // Attempt 2: image embedded inside a <div align="..."> wrapper.
  // Extract the inner ![alt](url) regardless of whether the div spans one or two lines.
  const innerImgMatch = /!\[([^\]]*)\]\(([^)]*)\)/.exec(rawSource);
  if (innerImgMatch) return { alt: innerImgMatch[1], url: innerImgMatch[2] };

  // Attempt 3a: float-right form with src before alt.
  const floatSrcFirst = /<img\b[^>]*\bsrc="([^"]*)"[^>]*\balt="([^"]*)"[^>]*>/i.exec(rawSource);
  if (floatSrcFirst) return { url: floatSrcFirst[1], alt: floatSrcFirst[2] };

  // Attempt 3b: float-right form with alt before src (EC-28).
  const floatAltFirst = /<img\b[^>]*\balt="([^"]*)"[^>]*\bsrc="([^"]*)"[^>]*>/i.exec(rawSource);
  if (floatAltFirst) return { url: floatAltFirst[2], alt: floatAltFirst[1] };

  // Fallback: unrecognised form — return empty strings to avoid throwing (EC-10).
  return { url: "", alt: "" };
}

// ── 11. Pure: alignment builders ─────────────────────────────────────────────

/**
 * Return the bare `![alt](url)` Markdown image form.
 *
 * Alt and url are inserted verbatim — no escaping (NFR-5, EC-26).
 * Works correctly when alt or url is empty string (EC-10).
 *
 * @param alt - Alt text.
 * @param url - Image URL or path.
 * @returns     Bare Markdown image string.
 */
export function buildBareImage(alt: string, url: string): string {
  return `![${alt}](${url})`;
}

/**
 * Return the `<div align="center|right">![alt](url)</div>` wrapper form.
 *
 * FR-3a specifies this as a single-line form, which most Markdown renderers
 * accept. The `lineEnding` parameter is accepted for API compatibility and
 * reserved for a future multi-line variant.
 *
 * EC-22: line endings are detected and passed by applyAlignment but unused here
 * because we always produce a single-line `<div>` form.
 *
 * @param alt         - Alt text (verbatim).
 * @param url         - Image URL (verbatim).
 * @param align       - "center" or "right".
 * @param lineEnding  - "\n" or "\r\n" (reserved for future use).
 * @returns             Single-line div-wrapped image string.
 */
export function wrapWithDiv(
  alt: string,
  url: string,
  align: "center" | "right",
  lineEnding: string, // eslint-disable-line @typescript-eslint/no-unused-vars
): string {
  // Single-line form as specified in FR-3a.
  return `<div align="${align}">![${alt}](${url})</div>`;
}

/**
 * Return the float-right inline HTML image form.
 *
 * Attribute order is fixed: src, alt, align, style — exactly as specified in FR-3a.
 * Alt and url are inserted verbatim (NFR-5, EC-26).
 *
 * @param alt - Alt text (verbatim).
 * @param url - Image URL (verbatim).
 * @returns     Float-right <img> HTML string.
 */
export function buildFloatRightImg(alt: string, url: string): string {
  return `<img src="${url}" alt="${alt}" align="right" style="float:right; margin:0 0 8px 16px">`;
}

/**
 * Detect the line ending used in `rawSource`.
 *
 * Used by applyAlignment to ensure the correct line ending is passed to
 * wrapWithDiv, preserving CRLF documents (EC-22, EC-27, NFR-5).
 *
 * @param rawSource - The raw image region text.
 * @returns           "\r\n" if CRLF is present, else "\n".
 */
export function detectLineEnding(rawSource: string): string {
  return rawSource.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Master alignment operation — maps any current image form to the desired alignment.
 *
 * Extracts alt and url from `rawSource` using extractImageCore, then builds the
 * new form using the appropriate builder. Never throws — falls back to empty
 * strings if extraction fails.
 *
 * EC-5: calling with alignment="left" on an already-bare image returns the same
 *       string (idempotent write — still dispatched to normalise any edge cases).
 * EC-3: float-right → left rewrites <img> to bare ![alt](url).
 * EC-4: float-right → center rewrites <img> to <div align="center">...</div>.
 * EC-32: clicking the active alignment button still dispatches.
 *
 * @param rawSource  - Current raw text of the image region.
 * @param alignment  - Desired new alignment.
 * @returns            New Markdown/HTML string to insert.
 */
export function applyAlignment(rawSource: string, alignment: AlignmentState): string {
  const { url, alt } = extractImageCore(rawSource);
  const le = detectLineEnding(rawSource);
  switch (alignment) {
    case "left":        return buildBareImage(alt, url);
    case "center":      return wrapWithDiv(alt, url, "center", le);
    case "right":       return wrapWithDiv(alt, url, "right", le);
    case "float-right": return buildFloatRightImg(alt, url);
  }
}

// ── 12. Pure: URL operations ──────────────────────────────────────────────────

/**
 * Replace the URL in `rawSource` with `newUrl`, preserving alt text and alignment.
 *
 * Uses the reconstruction strategy (preferred over string-replace) to guarantee
 * alt text fidelity and handle the empty-url edge case cleanly (EC-10).
 *
 * Rules:
 *   - Alt text preserved verbatim (NFR-5, EC-26).
 *   - Alignment wrapper preserved.
 *   - newUrl used verbatim — no URL-encoding (EC-31, NFR-5).
 *   - If rawSource cannot be parsed, returns rawSource unchanged (graceful no-op).
 *
 * @param rawSource - Current raw text of the image region.
 * @param newUrl    - New URL to use (verbatim).
 * @returns           New Markdown/HTML string with the URL replaced.
 */
export function replaceImageSrc(rawSource: string, newUrl: string): string {
  const { alt } = extractImageCore(rawSource);
  const alignment = detectAlignment(rawSource);
  const le = detectLineEnding(rawSource);

  // If we could not parse any recognisable image form (all empty + no structure),
  // return the source unchanged as a graceful no-op.
  const { url: oldUrl } = extractImageCore(rawSource);
  if (oldUrl === "" && alt === "" && !rawSource.includes("![") && !rawSource.includes("<img")) {
    return rawSource;
  }

  // Reconstruct the output form with the new URL.
  switch (alignment) {
    case "left":        return buildBareImage(alt, newUrl);
    case "center":      return wrapWithDiv(alt, newUrl, "center", le);
    case "right":       return wrapWithDiv(alt, newUrl, "right", le);
    case "float-right": return buildFloatRightImg(alt, newUrl);
  }
}

/**
 * Internal: compute the directory part of a file path (macOS/POSIX separator).
 *
 * @param filePath - Absolute file path.
 * @returns          Directory path (e.g. "/Users/dm/Notes").
 */
function _dirname(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop(); // Remove the filename.
  return parts.join("/") || "/";
}

/**
 * Convert `selectedAbsPath` to a path relative to `docPath`'s directory when
 * the selected file is inside or below that directory; return the absolute path
 * otherwise.
 *
 * Rules:
 *   EC-6:  file in same directory or subdirectory → relative path (e.g. "./img.png").
 *   EC-7:  file outside document directory → absolute path unchanged.
 *   EC-8:  docPath is null (untitled) → absolute path unchanged.
 *   EC-31: spaces and Unicode characters preserved verbatim — no URL-encoding.
 *
 * macOS paths use "/" separator. No Windows path support in v1.0.
 *
 * @param selectedAbsPath - Absolute path selected by the user.
 * @param docPath         - Absolute path of the current document, or null.
 * @returns                 Relative or absolute path string.
 */
export function resolveRelativePath(
  selectedAbsPath: string,
  docPath: string | null,
): string {
  // EC-8: untitled document — use absolute path as-is.
  if (!docPath) return selectedAbsPath;

  const docDir = _dirname(docPath);

  // EC-7: file is outside the document's directory.
  if (!selectedAbsPath.startsWith(docDir + "/")) return selectedAbsPath;

  // EC-6: file is inside the document's directory (same dir or subdir).
  // Prepend "./" to make the relative path unambiguous.
  return "./" + selectedAbsPath.slice(docDir.length + 1);
}

// ── 13. DOM: buildPopover, positionPopover, showPopover, hideToolbar ──────────

/**
 * Create the full popover DOM tree. Called once in onEnable.
 *
 * The element is NOT appended to document.body here — the caller does that.
 * Tab switching is handled by a single delegated listener on the tab strip.
 * Button actions are handled by a single delegated listener on the popover root.
 *
 * Module-level `_urlInput` and `_alignBtns` are populated as a side effect so
 * showPopover can reference them without re-querying the DOM each time.
 *
 * @returns The root popover element (not yet in the DOM).
 *
 * @remarks Length justification: The function builds four distinct structural
 * sections of the popover DOM (tab strip, Select panel, Embed Link panel,
 * alignment group) plus the delegated listeners for tab switching and action
 * routing. Each section shares the outer `el` variable and must be assembled in
 * sequence (child nodes must exist before appendChild). Splitting into smaller
 * builders would require threading `el` as a parameter and would obscure the
 * one-pass construction contract. The inline section comments already serve as
 * logical headers.
 */
export function buildPopover(): HTMLElement {
  const el = document.createElement("div");
  el.className = "img-toolbar";
  el.id = "__markable_img_toolbar__";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Image options");

  // ── Tab strip ──────────────────────────────────────────────────────────────
  const tabs = document.createElement("div");
  tabs.className = "img-toolbar__tabs";

  const tabSelect = document.createElement("button");
  tabSelect.className = "img-toolbar__tab img-toolbar__tab--active";
  tabSelect.dataset["tab"] = "select";
  tabSelect.textContent = "Select";

  const tabEmbed = document.createElement("button");
  tabEmbed.className = "img-toolbar__tab";
  tabEmbed.dataset["tab"] = "embed";
  tabEmbed.textContent = "Embed Link";

  tabs.appendChild(tabSelect);
  tabs.appendChild(tabEmbed);

  // ── Select panel (visible by default) ─────────────────────────────────────
  const panelSelect = document.createElement("div");
  panelSelect.className = "img-toolbar__panel img-toolbar__panel--select";
  panelSelect.dataset["panel"] = "select";

  const btnChooseFile = document.createElement("button");
  btnChooseFile.className = "img-toolbar__btn";
  btnChooseFile.dataset["action"] = "choose-file";
  btnChooseFile.textContent = "Choose File";
  panelSelect.appendChild(btnChooseFile);

  // ── Embed Link panel (hidden by default) ──────────────────────────────────
  const panelEmbed = document.createElement("div");
  panelEmbed.className = "img-toolbar__panel img-toolbar__panel--embed";
  panelEmbed.dataset["panel"] = "embed";
  panelEmbed.style.display = "none";

  const urlInput = document.createElement("input");
  urlInput.className = "img-toolbar__input";
  urlInput.type = "text";
  urlInput.placeholder = "URL or relative path";
  urlInput.setAttribute("aria-label", "Image URL");

  const btnEmbed = document.createElement("button");
  btnEmbed.className = "img-toolbar__btn";
  btnEmbed.dataset["action"] = "embed-image";
  btnEmbed.textContent = "Embed Image";

  panelEmbed.appendChild(urlInput);
  panelEmbed.appendChild(btnEmbed);

  // ── Divider ────────────────────────────────────────────────────────────────
  const divider = document.createElement("div");
  divider.className = "img-toolbar__divider";
  divider.setAttribute("aria-hidden", "true");

  // ── Alignment group ────────────────────────────────────────────────────────
  const alignGroup = document.createElement("div");
  alignGroup.className = "img-toolbar__align-group";
  alignGroup.setAttribute("role", "group");
  alignGroup.setAttribute("aria-label", "Alignment");

  const alignments: Array<{ action: string; title: string; icon: string }> = [
    { action: "align-left",        title: "Left",        icon: "←" },
    { action: "align-center",      title: "Center",      icon: "↔" },
    { action: "align-right",       title: "Right",       icon: "→" },
    { action: "align-float-right", title: "Float Right", icon: "⤵" },
  ];

  for (const { action, title, icon } of alignments) {
    const btn = document.createElement("button");
    btn.className = "img-toolbar__align-btn";
    btn.dataset["action"] = action;
    btn.title = title;
    btn.textContent = icon;
    alignGroup.appendChild(btn);
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  el.appendChild(tabs);
  el.appendChild(panelSelect);
  el.appendChild(panelEmbed);
  el.appendChild(divider);
  el.appendChild(alignGroup);

  // ── Tab switching — single delegated listener on the tab strip ────────────
  tabs.addEventListener("click", (event: MouseEvent) => {
    const tabBtn = (event.target as Element).closest("[data-tab]") as HTMLElement | null;
    if (!tabBtn) return;
    const targetTab = tabBtn.dataset["tab"];

    // Update tab button active states.
    tabs.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("img-toolbar__tab--active", btn === tabBtn);
    });

    // Show the matching panel, hide others.
    el.querySelectorAll("[data-panel]").forEach((panel) => {
      const p = panel as HTMLElement;
      p.style.display = p.dataset["panel"] === targetTab ? "flex" : "none";
    });
  });

  // ── Action delegation — single listener on the popover root ───────────────
  // Alignment and embed button clicks are caught here and forwarded to handleAction.
  el.addEventListener("click", (event: MouseEvent) => {
    const btn = (event.target as Element).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset["action"];
    if (action) handleAction(action);
  });

  // ── Store module-level refs for showPopover ────────────────────────────────
  _urlInput = el.querySelector("input.img-toolbar__input");
  _alignBtns = el.querySelectorAll(".img-toolbar__align-btn");

  return el;
}

/**
 * Position the popover relative to an anchor bounding rect.
 *
 * Positioning strategy (FR-7):
 *   - Default: appear above the anchor, offset by popoverHeight + 8px.
 *   - Flip: if top would be above viewport top (< 0), render below instead (EC-23).
 *   - Clamp: if right edge exceeds viewport width, shift left (EC-24).
 *   - Sets `display: "flex"` to make the popover visible.
 *
 * Note: uses style.display = "flex" (NOT classList) — learned from table-toolbar bug.
 *
 * @param anchorRect - Bounding rect of the anchor element.
 * @param popoverEl  - The popover element to position.
 */
export function positionPopover(
  anchorRect: { top: number; bottom: number; left: number; right: number },
  popoverEl: HTMLElement,
): void {
  // Use offsetHeight/offsetWidth with fallback before first paint.
  const popoverHeight = popoverEl.offsetHeight || 120;
  const popoverWidth = popoverEl.offsetWidth || 220;

  // Default: render above the anchor with an 8px gap.
  let top = anchorRect.top - popoverHeight - 8;

  // EC-23: flip below if the toolbar would render above the viewport top edge.
  if (top < 0) {
    top = anchorRect.bottom + 8;
  }

  let left = anchorRect.left;

  // EC-24: clamp so the right edge stays within the viewport.
  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 8;
  }

  // Prevent negative left (off the left viewport edge).
  left = Math.max(0, left);

  popoverEl.style.top = top + "px";
  popoverEl.style.left = left + "px";
  // Use direct style assignment (NOT classList.add) — mirrors table-toolbar pattern.
  popoverEl.style.display = "flex";
}

/**
 * Prepare and display the popover for a given ImageContext.
 *
 * Called from both the click-trigger and edit-trigger paths. Resets to the
 * "Select" tab on each open so the user always sees a consistent initial state.
 *
 * @param ctx - The full image context including the anchor element.
 */
export function showPopover(ctx: ImageContext): void {
  // Safety guard — called before onEnable or after onDisable.
  if (_popoverEl === null) return;

  // Pre-fill the URL input with the current image's URL (FR-2b).
  if (_urlInput) _urlInput.value = ctx.url;

  // Update the active alignment button — remove --active from all, then add to match.
  if (_alignBtns) {
    const targetAction = "align-" + ctx.alignment;
    _alignBtns.forEach((btn) => {
      if (btn.dataset["action"] === targetAction) {
        btn.classList.add("img-toolbar__align-btn--active");
      } else {
        btn.classList.remove("img-toolbar__align-btn--active");
      }
    });
  }

  // Reset to "Select" tab — hide embed panel, show select panel.
  _popoverEl.querySelectorAll("[data-panel]").forEach((panel) => {
    const p = panel as HTMLElement;
    p.style.display = p.dataset["panel"] === "select" ? "flex" : "none";
  });

  // Update tab button active state to match "Select".
  _popoverEl.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("img-toolbar__tab--active", btn.getAttribute("data-tab") === "select");
  });

  // Position and show the popover (positionPopover sets display: "flex").
  positionPopover(ctx.anchorEl.getBoundingClientRect(), _popoverEl);
}

/**
 * Hide the popover and reset all trigger-mode state.
 *
 * This is the single exit point for all dismiss paths (FR-5 — unified dismiss
 * contract). Uses style.display = "none" (NOT classList — table-toolbar lesson).
 */
export function hideToolbar(): void {
  if (_popoverEl) _popoverEl.style.display = "none";
  currentImageContext = null;
  triggerMode = null;
}

// ── 14. CM6 helpers ───────────────────────────────────────────────────────────

/**
 * Return the live EditorView from the window global.
 *
 * Always reads fresh — never caches — so a new tab's view is always used (EC-25).
 * Returns undefined when the global is not set (test environment, EC-14).
 */
function getEditorView(): EditorViewType | undefined {
  return (window as unknown as Record<string, unknown>)["__MARKABLE_EDITOR_VIEW__"] as
    | EditorViewType
    | undefined;
}

/**
 * Return the CM6 view globals object from the window.
 * Contains `EditorView` (the class, not an instance) for registering extensions.
 */
function getCmView(): {
  EditorView: typeof import("@codemirror/view").EditorView;
} {
  return (window as unknown as Record<string, unknown>)["__CM_VIEW__"] as {
    EditorView: typeof import("@codemirror/view").EditorView;
  };
}

/**
 * Return the CM6 language globals object from the window.
 * Contains `syntaxTree` for walking the parse tree.
 * Returns undefined when not in the main app environment.
 */
function getCmLanguage():
  | {
      syntaxTree: typeof import("@codemirror/language").syntaxTree;
    }
  | undefined {
  return (window as unknown as Record<string, unknown>)["__CM_LANGUAGE__"] as
    | { syntaxTree: typeof import("@codemirror/language").syntaxTree }
    | undefined;
}

// ── 15. CM6: detectImageRegion, resolvers ────────────────────────────────────

/**
 * Walk the CM6 syntax tree to find an Image node at or near `pos`, then build
 * a full ImageContext data object (without anchorEl — caller populates that).
 *
 * Algorithm (FR-4):
 *   1. Resolve the syntax tree node at pos.
 *   2. Walk up until an "Image" node is found.
 *   3. Check for `<div align="...">` wrapper on the same line.
 *   4. Check for float-right `<img>` form.
 *   5. Otherwise use the bare Image node range.
 *   6. Extract url, alt, alignment from the raw source.
 *
 * Returns null if no Image node exists at pos, or if CM globals are absent.
 *
 * @param state - The current CM6 EditorState.
 * @param pos   - The document position to inspect.
 * @returns       Image context data (without anchorEl), or null.
 *
 * @remarks Length justification: The function performs six sequential steps
 * (getCmLanguage guard, syntaxTree resolution, parent-walk to Image node, line
 * extraction, wrapper type detection with two-line boundary arithmetic, and
 * final rawSource extraction). Each step requires access to variables produced
 * by the prior step (e.g. lineObj is needed for both the wrapper check and the
 * two-line to-boundary). Splitting into helper functions would require threading
 * at least four variables across call sites, adding indirection without reducing
 * complexity. The numbered inline comments already act as step markers.
 */
function detectImageRegion(
  state: EditorStateType,
  pos: number,
): Omit<ImageContext, "anchorEl"> | null {
  const cmState = getCmLanguage();
  if (!cmState) {
    // CM globals not available — cannot walk the syntax tree.
    return null;
  }

  const tree = cmState.syntaxTree(state);
  let node = tree.resolveInner(pos, 1) as {
    name: string;
    from: number;
    to: number;
    parent: { name: string; from: number; to: number; parent: unknown } | null;
  } | null;

  // Walk up the tree to find an Image node.
  while (node && node.name !== "Image") {
    node = node.parent as typeof node;
  }

  if (!node) return null;

  const lineObj = state.doc.lineAt(node.from);
  const lineText = lineObj.text;

  // Check for a next line (for the two-line div wrapper form).
  const hasNext = lineObj.to < state.doc.length;
  const nextLineText = hasNext ? state.doc.lineAt(lineObj.to + 1).text : null;

  let from: number;
  let to: number;

  // EC-1/EC-2: check for `<div align="...">` wrapper (single- or two-line form).
  const divWrapper = detectDivWrapper(lineText, nextLineText);
  if (divWrapper) {
    from = lineObj.from;
    if (nextLineText !== null) {
      // Check if the close tag is on the next line (two-line form).
      const closesOnNextLine = /^(.*)<\/div>$/i.test(nextLineText);
      const opensAndClosesOnThisLine = /^<div\s+align="(center|right)">(.*)<\/div>$/i.test(lineText);
      if (closesOnNextLine && !opensAndClosesOnThisLine) {
        // Two-line form: region ends at end of next line.
        to = state.doc.lineAt(lineObj.to + 1).to;
      } else {
        // Single-line form.
        to = lineObj.to;
      }
    } else {
      to = lineObj.to;
    }
  } else if (detectFloatRight(lineText)) {
    // EC-3: float-right <img> tag — region is the full line.
    from = lineObj.from;
    to = lineObj.to;
  } else {
    // Default: bare Image node range.
    from = node.from;
    to = node.to;
  }

  const rawSource = state.doc.sliceString(from, to);
  const { url, alt } = extractImageCore(rawSource);
  const alignment = detectAlignment(rawSource);

  return { from, to, rawSource, url, alt, alignment };
}

/**
 * Find the `<img class="cm-live-image">` DOM element corresponding to `fromPos`.
 *
 * Strategy:
 *   1. Query all `.cm-live-image` elements in the editor DOM.
 *   2. For each, try `view.posAtDOM(img)`. If position matches fromPos, return it.
 *   3. Fallback: use `view.coordsAtPos(fromPos)` to produce a pseudo-rect anchor.
 *   4. Return null only if coordsAtPos also fails.
 *
 * The fallback pseudo-rect satisfies positionPopover's interface so the toolbar
 * can still appear in edit mode even when the image widget is not rendered
 * (the editor shows raw Markdown when the cursor is on the image line).
 *
 * @param view    - The live EditorView.
 * @param fromPos - The document position of the image region start.
 * @returns         An HTMLElement or pseudo-rect, or null if positioning fails.
 */
function _resolveAnchorForEditMode(
  view: EditorViewType,
  fromPos: number,
): HTMLElement | null {
  // First try: find the actual rendered <img> element.
  const imgs = view.dom.querySelectorAll("img.cm-live-image");
  for (const img of imgs) {
    try {
      const p = view.posAtDOM(img as HTMLElement);
      if (Math.abs(p - fromPos) < 5) return img as HTMLElement;
    } catch {
      // Skip elements that posAtDOM cannot resolve.
    }
  }

  // Fallback: use coordsAtPos to create a pseudo-rect that satisfies positionPopover.
  const coords = view.coordsAtPos(fromPos);
  if (!coords) return null;

  // Return an object that satisfies the `{ top, bottom, left, right }` interface.
  // getBoundingClientRect is added so showPopover's ctx.anchorEl.getBoundingClientRect()
  // call works when this object is stored as anchorEl.
  const pseudoRect = {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.right,
    getBoundingClientRect() { return this as unknown as DOMRect; },
  };
  return pseudoRect as unknown as HTMLElement;
}

/**
 * Fallback position recovery for EC-15: posAtDOM threw.
 *
 * Scans all Image nodes in visible ranges and matches against imgEl by comparing
 * the tail of the src attribute against the end of imgEl.src (best-effort heuristic
 * since the Tauri asset URL form is not importable in the plugin sandbox).
 *
 * @param view   - The live EditorView.
 * @param imgEl  - The clicked <img> element.
 * @returns       Document position or -1 if no match found.
 */
function _fallbackPosFromImgEl(view: EditorViewType, imgEl: HTMLElement): number {
  const cmState = getCmLanguage();
  if (!cmState) return -1;

  // Walk the syntax tree over all visible ranges.
  for (const range of view.visibleRanges) {
    const cursor = cmState.syntaxTree(view.state).cursor();
    cursor.moveTo(range.from, 1);
    do {
      if (cursor.name === "Image") {
        const rawSource = view.state.doc.sliceString(cursor.from, cursor.to);
        const { url } = extractImageCore(rawSource);
        if (url) {
          // Heuristic: check if imgEl.src ends with the last path segment of url.
          const urlTail = url.split("/").pop() ?? "";
          if (urlTail && (imgEl as HTMLImageElement).src.endsWith(urlTail)) {
            return cursor.from;
          }
        }
      }
    } while (cursor.next() && cursor.from < range.to);
  }

  return -1;
}

// ── 16. CM6: buildUpdateListener ─────────────────────────────────────────────

/**
 * Create a CM6 EditorView.updateListener extension that shows or hides the
 * toolbar based on whether the cursor is on an image line.
 *
 * Runs on every editor transaction but returns immediately when disabled or
 * when neither the selection nor the document changed (performance guard, NFR-2).
 *
 * EC-11: hides the toolbar within the same CM6 update cycle when the cursor
 * leaves an image line.
 */
function buildUpdateListener() {
  const { EditorView } = getCmView();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    // Guard: plugin is disabled or no relevant change.
    if (!_enabled) return;
    if (!update.selectionSet && !update.docChanged) return;

    const pos = update.state.selection.main.head;
    const ctxData = detectImageRegion(update.state, pos);

    if (ctxData !== null) {
      // Cursor is on an image line.
      if (
        currentImageContext === null ||
        currentImageContext.from !== ctxData.from ||
        currentImageContext.to !== ctxData.to
      ) {
        // New or changed image context — resolve anchor and show/reposition.
        const anchorEl = _resolveAnchorForEditMode(update.view, ctxData.from);
        if (anchorEl) {
          const ctx: ImageContext = { ...ctxData, anchorEl };
          currentImageContext = ctx;
          triggerMode = "edit";
          showPopover(ctx);
        }
        // If anchorEl is null (image not visible in DOM), do not show toolbar.
      }
      // else: same image context, toolbar already positioned — no action needed.
    } else {
      // Cursor is not on an image line.
      if (currentImageContext !== null) {
        hideToolbar(); // EC-11
      }
    }
  });
}

// ── 17. Event handlers ────────────────────────────────────────────────────────

// These are assigned inside onEnable as named module-level refs so the same
// function reference can be passed to removeEventListener in onDisable (NFR-3).

/**
 * Click-delegation handler for `<img class="cm-live-image">` elements.
 *
 * FR-1 (click-trigger path): detects clicks on rendered images in live preview
 * mode, recovers the document position, and opens the toolbar.
 *
 * EC-9: this is a click-triggered open — dismisses only on click-away or
 *       cursor moving off, not merely on cursor movement.
 * EC-15: posAtDOM is wrapped in try/catch with fallback scan.
 */
function _handleDocClick(event: MouseEvent): void {
  const img = (event.target as Element).closest("img.cm-live-image") as HTMLElement | null;
  if (!img) return;

  const view = getEditorView();
  if (!view) return; // EC-14

  let pos: number;
  try {
    pos = view.posAtDOM(img);
  } catch (err) {
    // EC-15: posAtDOM threw — attempt fallback scan.
    pos = _fallbackPosFromImgEl(view, img);
    if (pos === -1) {
      console.error("[image-toolbar] click: position recovery failed", err);
      return;
    }
  }

  const ctxData = detectImageRegion(view.state, pos);
  if (!ctxData) return;

  const ctx: ImageContext = { ...ctxData, anchorEl: img };
  currentImageContext = ctx;
  triggerMode = "click";
  showPopover(ctx);
}

/**
 * Click-away dismiss handler.
 *
 * Hides the toolbar on mousedown outside the popover. Fires on mousedown (not
 * mouseup) so the dismiss feels instantaneous to the user (FR-5).
 *
 * EC-9: does not dismiss when mousedown is inside the popover element itself.
 */
function _handleDocMousedown(event: MouseEvent): void {
  if (!currentImageContext) return; // EC-7: nothing to dismiss
  if (_popoverEl && _popoverEl.contains(event.target as Node)) return; // inside popover
  hideToolbar();
}

// ── 18. Action handler ────────────────────────────────────────────────────────

/**
 * Route a button action string to the appropriate document mutation.
 *
 * Called by the popover's delegated click listener (buildPopover).
 * Every action reads the view fresh (EC-25) and dispatches exactly one
 * CM6 transaction (NFR-4).
 *
 * @param action - The data-action attribute value from the clicked button.
 *
 * @remarks Length justification: The function is a routing switch over five
 * distinct action strings (choose-file, embed-image, align-left, align-center,
 * align-right, align-float-right). The choose-file case requires its own
 * async dialog flow and path-resolution logic; the embed-image case needs
 * whitespace-only and unchanged-URL guards; the four alignment cases share a
 * map lookup but each requires a null-context guard before dispatch. Collapsing
 * into a dispatch table would make the per-case guards harder to read and audit
 * against individual EC requirements. The switch is the idiomatic pattern here.
 */
export function handleAction(action: string): void {
  switch (action) {
    case "choose-file": {
      // FR-2a: open the Tauri file picker, then replace the image URL.
      const dialog = (window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"] as
        | { open: (options: unknown) => Promise<string | null> }
        | undefined;

      if (!dialog?.open) {
        // EC-13: dialog global not available (test environment or not yet set up).
        console.warn("[image-toolbar] __TAURI_DIALOG__ not available");
        return; // Toolbar stays open.
      }

      // Capture current file path BEFORE the async dialog opens, so tab switches
      // during the dialog do not corrupt the resolved path (EC-8, EC-25).
      const currentFile = (window as unknown as Record<string, unknown>)[
        "__MARKABLE_CURRENT_FILE__"
      ] as string | null | undefined;

      dialog
        .open({
          multiple: false,
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
            },
          ],
        })
        .then((selectedPath: string | null) => {
          if (!selectedPath) return; // EC-12: user cancelled — toolbar stays open.

          const docPath = currentFile ?? null;
          // EC-6/EC-7/EC-8: resolve to relative path when inside doc directory.
          const resolvedUrl = resolveRelativePath(selectedPath, docPath);

          // Re-read the view fresh after the async gap (EC-25).
          const view = getEditorView();
          if (!view || !currentImageContext) return;

          const { from, to, rawSource } = currentImageContext;
          const newSource = replaceImageSrc(rawSource, resolvedUrl);
          view.dispatch({ changes: { from, to, insert: newSource } }); // NFR-4
          hideToolbar();
        })
        .catch((err: unknown) => {
          console.error("[image-toolbar] dialog.open() failed", err);
        });

      // Toolbar stays open until the async promise resolves.
      break;
    }

    case "embed-image": {
      // FR-2b: replace the image URL with the value typed in the embed input.
      if (!currentImageContext) return;

      // NFR-5: read the URL verbatim — do NOT trim(), which would silently mutate
      // a URL that the user intentionally typed with a leading space (e.g. a note
      // to themselves). Instead, only reject input that is entirely whitespace.
      const newUrl = _urlInput?.value ?? "";

      // EC-21: whitespace-only input — no dispatch, toolbar stays open.
      if (newUrl.trim() === "") return;
      // EC-20: unchanged URL — no dispatch, toolbar stays open.
      if (newUrl === currentImageContext.url) return;

      const view = getEditorView();
      if (!view) return; // EC-14

      const { from, to, rawSource } = currentImageContext;
      const newSource = replaceImageSrc(rawSource, newUrl);
      view.dispatch({ changes: { from, to, insert: newSource } }); // NFR-4
      hideToolbar();
      break;
    }

    case "align-left":
    case "align-center":
    case "align-right":
    case "align-float-right": {
      // FR-3: replace the image region with the aligned form.
      if (!currentImageContext) return;

      const view = getEditorView();
      if (!view) return; // EC-14

      // Map the action string to its AlignmentState value.
      const alignMap: Record<string, AlignmentState> = {
        "align-left":        "left",
        "align-center":      "center",
        "align-right":       "right",
        "align-float-right": "float-right",
      };
      const alignment = alignMap[action];
      const { from, to, rawSource } = currentImageContext;
      const newSource = applyAlignment(rawSource, alignment);

      view.dispatch({ changes: { from, to, insert: newSource } }); // NFR-4
      hideToolbar();
      break;
    }

    default:
      // Unknown action — no-op. Logged to help identify wiring bugs.
      console.warn("[image-toolbar] unknown action:", action);
      break;
  }
}

// ── 19. Plugin export object ──────────────────────────────────────────────────

/**
 * The plugin object consumed by Markable's PluginManager.
 *
 * AD-5: no sidebarPanelId — this plugin is floating-only.
 * renderDetailExtra returns null — no position toggle in the Plugins Panel.
 */
/**
 * Test-only helper: set the module-level currentImageContext directly.
 * This is needed in tests that call showPopover() without going through the
 * full click or updateListener path, which would normally set the context first.
 *
 * Do not call this in production code.
 *
 * @param ctx - The ImageContext to set, or null to clear.
 */
export function _setContextForTesting(ctx: ImageContext | null): void {
  currentImageContext = ctx;
}

const _pluginDef = {
  id: "image-toolbar",
  name: "Image Toolbar",
  version: "1.0.0",
  description: "Floating toolbar for aligning images and replacing image sources.",
  detail:
    "Shows a popover toolbar when you click a rendered image or move the cursor onto an " +
    "image syntax line. Lets you change the image source (by picking a file or entering " +
    "a URL) and set alignment to Left, Center, Right, or Float Right.",
  // sidebarPanelId is intentionally omitted — floating only (AD-5).

  /**
   * Enable the plugin: inject CSS, create the popover DOM, register CM6 extension,
   * and attach document-level event listeners.
   *
   * onEnable sequence (from 00_index.md):
   *   1.  _enabled = true
   *   2.  _api = api
   *   3.  await api.loadSettings() — no-op in v1.0 (FR-11)
   *   4.  injectCSS() — idempotent (EC-17)
   *   5.  buildPopover() + append to body
   *   6.  Wire _onDocClick + _onDocMousedown
   *   7.  document.addEventListener for both
   *   8.  api.addExtensions([buildUpdateListener()])
   */
  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _enabled = true;
    _api = api;

    // FR-11: load settings — no-op in v1.0, but the pattern must exist for
    // future extensibility (e.g. a default alignment preference).
    const raw = (await api.loadSettings()) as Record<string, unknown> | null;
    mergeWithDefaults(raw); // Result not stored — no settings to apply in v1.0.

    // Inject CSS (idempotent — EC-17 prevents duplicate on rapid toggle).
    injectCSS();

    // Create the popover DOM once; reuse on every subsequent trigger (NFR-2).
    _popoverEl = buildPopover();
    document.body.appendChild(_popoverEl);
    _popoverEl.style.display = "none";

    // Store handler references as module-level vars for removal in onDisable (NFR-3).
    _onDocClick = _handleDocClick;
    _onDocMousedown = _handleDocMousedown;

    document.addEventListener("click", _onDocClick);
    document.addEventListener("mousedown", _onDocMousedown);

    // FR-5: hide the toolbar when the editor loses focus (blur dismiss path).
    // Uses a named ref so the same function reference can be removed in onDisable.
    _onEditorBlur = () => hideToolbar();
    const editorDom = getEditorView()?.dom;
    if (editorDom) {
      editorDom.addEventListener("blur", _onEditorBlur);
    }

    // Register the CM6 updateListener extension.
    api.addExtensions([buildUpdateListener()]);
  },

  /**
   * Disable the plugin: remove CM6 extension, remove popover DOM, remove event
   * listeners, reset all module-level state.
   *
   * onDisable sequence (from 00_index.md):
   *   1.  _enabled = false
   *   2.  api.removeExtensions()
   *   3.  Remove popover from body (EC-18)
   *   4.  Remove document listeners (NFR-3)
   *   5.  removeCSS()
   *   6.  Reset all state variables
   */
  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    // Remove the CM6 extension first so no more updateListener callbacks fire.
    api.removeExtensions();

    // EC-18: remove the popover immediately, even if the toolbar is currently visible.
    if (_popoverEl) {
      _popoverEl.remove();
      _popoverEl = null;
    }

    // NFR-3: remove listeners using the stored named refs (not anonymous closures).
    if (_onDocClick) {
      document.removeEventListener("click", _onDocClick);
      _onDocClick = null;
    }
    if (_onDocMousedown) {
      document.removeEventListener("mousedown", _onDocMousedown);
      _onDocMousedown = null;
    }

    // FR-5: remove the editor blur listener (NFR-3 — named ref, not anonymous closure).
    if (_onEditorBlur) {
      getEditorView()?.dom?.removeEventListener("blur", _onEditorBlur);
      _onEditorBlur = null;
    }

    // Remove the style tag.
    removeCSS();

    // Reset all module-level state to initial values.
    currentImageContext = null;
    triggerMode = null;
    _urlInput = null;
    _alignBtns = null;
    _api = null;
    _onEditorBlur = null;
  },

  /**
   * AD-5: Image Toolbar is floating-only — no sidebar mode.
   * The Plugins Panel will show no position toggle for this plugin.
   *
   * @returns null — no detail panel extra content.
   */
  renderDetailExtra(): null {
    return null;
  },
};

// Named export for tests; default export is what the IIFE loader reads.
export { _pluginDef as __markablePlugin__ };
export default _pluginDef;
