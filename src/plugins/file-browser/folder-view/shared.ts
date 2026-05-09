/**
 * shared.ts — Utilities shared across folder-view sub-modules.
 *
 * Kept minimal: only extract here when the same logic appears in 2+ files.
 */

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
