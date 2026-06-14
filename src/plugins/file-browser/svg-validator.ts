/**
 * svg-validator.ts — pure-TS validation gate for "Add custom SVG…".
 *
 * The validator answers one question: *"is this file content safe to add to
 * the user's customFolderIcons list?"*. It does not sanitise, mutate, or
 * touch disk — the caller (step_06 picker) reads the file via `readFile()`
 * and passes the raw text + byte length here.
 *
 * Sanitisation is a render-time concern handled by `folder-icon-custom-cache.ts`
 * (step_05). The split is deliberate (FR-15 vs FR-16):
 *   - **Add-time** (this module) — refuse-add if the file is bytes-too-large,
 *     malformed XML, or rooted in something other than `<svg>`.
 *   - **Render-time** — strip dangerous content from accepted files
 *     immediately before injection (the security guarantee).
 *
 * No DOMPurify dependency. DOMParser is already available in the renderer
 * and in the Vitest happy-dom environment.
 */

/** Hard limit on accepted SVG size (32 KB). FR-16. Inclusive cap. */
export const SVG_MAX_BYTES = 32 * 1024;

/**
 * Discriminated result. On failure, `reason` is a machine-readable enum the
 * picker maps to a localised user message in step_06.
 *
 *   - `empty`       — byteLength === 0. Defensive: a real file picker should
 *                     never produce this, but we'd rather fail closed.
 *   - `too_large`   — byteLength > SVG_MAX_BYTES (EC-19).
 *   - `parse_error` — DOMParser inserted a <parsererror> node into the doc.
 *   - `not_svg`     — parses cleanly but the root element is not `<svg>`.
 */
export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "too_large" | "parse_error" | "not_svg" | "empty";
    };

/**
 * Validate a candidate SVG file's content.
 *
 * Pure: no disk I/O, no DOM mutation, no side effects beyond the transient
 * Document the parser creates internally. Synchronous because DOMParser is
 * synchronous.
 *
 * @param svgText    - Raw file content as a UTF-8 string.
 * @param byteLength - Byte length of the original file (caller-provided so
 *                     the validator does not pull in a TextEncoder).
 * @returns ValidationResult — `{ ok: true }` on pass, `{ ok: false, reason }`
 *          on any of the four rejection conditions.
 */
export function validateSvgFile(
  svgText: string,
  byteLength: number,
): ValidationResult {
  // Size gate first — fastest path, no parser allocation.
  if (byteLength === 0) return { ok: false, reason: "empty" };
  if (byteLength > SVG_MAX_BYTES) return { ok: false, reason: "too_large" };

  // DOMParser with `image/svg+xml` mime applies XML rules. On parse failure
  // it inserts a <parsererror> node into the result document — there is no
  // exception. We must `.querySelector` for it.
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  if (doc.querySelector("parsererror")) {
    return { ok: false, reason: "parse_error" };
  }

  // Root element must be `<svg>`. Some platforms expose the tag name in
  // upper-case for HTML documents — XML/SVG documents preserve case but we
  // normalise defensively.
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return { ok: false, reason: "not_svg" };
  }

  return { ok: true };
}
