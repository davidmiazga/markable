/**
 * folder-icon-custom-cache.ts — In-memory cache + sanitiser for custom SVG icons.
 *
 * This module is the render-time half of the custom-SVG amendment (FR-15,
 * FR-17). For each absolute path that lands in a `_folder.md icon:` field,
 * `getCustomSvg(path)` returns a sanitised inline SVG string ready to be
 * dropped into a `.folder-icon-custom` slot via `el.innerHTML`. The result is
 * cached by `(path, mtimeMs)` so external edits invalidate automatically.
 *
 * Sanitisation responsibility split:
 *   - **Add-time** (svg-validator.ts, step_06b) rejects unsafe-to-keep files
 *     (size > 32 KB, parse error, non-<svg> root).
 *   - **Render-time** (this module) strips dangerous content from accepted
 *     files immediately before injection. The render-time pass is the
 *     security guarantee — an SVG with a `<script>` block accepted at
 *     add-time will have the script removed here.
 *
 * Sanitiser passes (FR-15):
 *   1. `stripScripts()` (shared.ts:81) — removes `<script>...</script>` AND
 *      inline `on*="..."` / `on*='...'` event-handler attributes.
 *   2. `javascript:` URL schemes in `href`, `xlink:href`, or any quoted
 *      attribute value. (Walks the raw string; no DOMParser dependency.)
 *   3. `<foreignObject>` blocks — removed wholesale (they can contain
 *      arbitrary HTML which slips past the script regex).
 *
 * Reuse-only — no DOMPurify dependency (C-10).
 *
 * The cache is process-lifetime — no eviction, no cap. Custom SVG count is
 * bounded by the picker's 100-entry list cap (FR-18); even if every entry
 * is rendered the cache is at most 100 small strings.
 */

import { readFile, statFile } from "../../lib/bridge";
import { stripScripts } from "./folder-view/shared";

/**
 * One row in the cache. Keyed by absolute path in the outer Map. Cached
 * `sanitizedHtml` is the post-sanitisation SVG ready for `innerHTML`.
 */
interface CustomSvgCacheEntry {
  /** Last seen mtime in ms. Cache invalidates when this changes (FR-17). */
  mtimeMs: number;
  /** Sanitised SVG markup ready to be assigned to `el.innerHTML`. */
  sanitizedHtml: string;
}

/**
 * Path-keyed cache. Capacity is intentionally unbounded — the picker enforces
 * the 100-entry list cap (FR-18) and each entry is a small text string.
 */
const cache = new Map<string, CustomSvgCacheEntry>();

/**
 * Paths that have already surfaced a one-time "missing custom icon" toast in
 * this session (EC-16). Cleared only on module reload or by tests.
 */
const reportedMissing = new Set<string>();

/**
 * Resolve a custom SVG path to a sanitised inline SVG string.
 *
 * Algorithm:
 *   1. `statFile(path)` — if it fails, the file is missing/unreadable.
 *      Return null. The caller is expected to fall back to the generic
 *      `folder-icon` class AND surface a one-time toast (EC-16).
 *   2. If the cache contains `(path, mtimeMs)` matching the current stat,
 *      return the cached sanitised string. Skip the file read.
 *   3. Otherwise `readFile(path)` and sanitise the body. Defensive SVG
 *      sniff (`<svg` somewhere in the content) — rejects raw binary or
 *      non-SVG text. Cache the result.
 *
 * Returns null on any read/stat error or when the content is not SVG-shaped.
 * The caller renders the fallback glyph and the path stays in `_folder.md`
 * for the user to reassign later (we do NOT auto-mutate `_folder.md` —
 * EC-16 contract).
 *
 * @param path - Absolute path to the custom SVG file.
 * @returns Sanitised SVG markup, or null when the path cannot be resolved.
 */
export async function getCustomSvg(path: string): Promise<string | null> {
  const statResult = await statFile(path);
  if (!statResult.ok) return null;

  const { mtimeMs } = statResult.value;
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) {
    // Cache hit: same path, same mtime — skip the file read entirely.
    return hit.sanitizedHtml;
  }

  // Cache miss (or mtime changed) — read + sanitise.
  const readResult = await readFile(path);
  if (!readResult.ok) return null;

  const raw = readResult.value;

  // Defensive SVG sniff: only proceed if `<svg` appears in the content. The
  // picker's validator (step_06b) already rejected non-SVG at add-time, but
  // the file may have been replaced between add and render. Returning null
  // here causes the post-mount pass to fall back to the generic glyph
  // (EC-16) without injecting potentially dangerous content.
  if (!/<svg[\s>]/i.test(raw)) return null;

  // ── Sanitisation pipeline (FR-15) ───────────────────────────────────────
  // 1. stripScripts: <script> blocks AND inline on*="..." event handlers.
  let sanitised = stripScripts(raw);

  // 2. javascript: URL schemes. The leading character class accepts any
  //    delimiter that can legally precede a URL attribute value in HTML/SVG:
  //      - `"` / `'`   → quoted attribute values (`href="javascript:..."`)
  //      - whitespace  → unquoted values after attribute name + whitespace
  //      - `=`         → unquoted values directly after `=` (`href=javascript:...`)
  //      - `>`         → text node immediately after a tag close
  //    The pre-fix regex required a quote or whitespace, which let
  //    `href=javascript:alert(1)` (unquoted) slip through. The capture group
  //    preserves the leading delimiter; we drop only the scheme prefix so the
  //    rest of the attribute remains readable (the link becomes a no-op).
  sanitised = sanitised.replace(/(["'\s=>])javascript:/gi, "$1");

  // 3. <foreignObject> blocks — HTML escape hatch inside SVG. Remove the
  //    entire block including its children. The `[\s\S]*?` is a lazy match
  //    so a file with multiple foreignObject elements has each one removed
  //    independently (no greedy span).
  sanitised = sanitised.replace(
    /<foreignObject\b[\s\S]*?<\/foreignObject>/gi,
    "",
  );

  cache.set(path, { mtimeMs, sanitizedHtml: sanitised });
  return sanitised;
}

/**
 * Has a missing-path toast already been surfaced for `path` this session?
 *
 * Used by the post-mount injection pass in file-browser.plugin.ts to avoid
 * spamming the user when N folders all reference the same broken path.
 */
export function hasReportedMissingPath(path: string): boolean {
  return reportedMissing.has(path);
}

/**
 * Mark a missing path as reported. Idempotent.
 */
export function markPathReported(path: string): void {
  reportedMissing.add(path);
}

/**
 * Test helper: clear the cache + the reported-missing set. Exported for
 * Vitest specs only — production code never calls this. Naming with
 * double-underscore prefix follows the same convention as other test-only
 * exports in the file-browser plugin.
 */
export function __clearCustomSvgCache(): void {
  cache.clear();
  reportedMissing.clear();
}
