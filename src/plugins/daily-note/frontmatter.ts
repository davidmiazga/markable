/**
 * frontmatter.ts — YAML front matter injection and merge logic
 *
 * Handles inserting or updating the `date:` field in a Markdown document's
 * YAML front matter block. This module is pure: no filesystem access, no
 * window globals, no Tauri invoke.
 *
 * Two cases (from the spec):
 *   Case A — No front matter present → prepend a new YAML block.
 *   Case B — Front matter present → insert or overwrite the `date:` field.
 *
 * The function guarantees that the output document never has two opening
 * "---" fences. Malformed front matter (opening fence but no closing fence)
 * is treated as Case A for safety.
 *
 * Spec: docs/specs/daily-note/step_02_pure_submodules.md
 */

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Quick check: does `content` start with a YAML front matter opening fence?
 *
 * A valid YAML block starts with "---\n" (three dashes followed by a newline).
 * This function does NOT validate that the block is properly closed — use
 * `injectFrontMatter` for that, which handles the malformed case.
 *
 * @param content - The full document text.
 * @returns true if the document begins with a YAML front matter block.
 */
export function hasFrontMatter(content: string): boolean {
  return content.startsWith("---\n");
}

/**
 * Inject or update the `date:` field in a Markdown document's front matter.
 *
 * `dateStr` must be an ISO 8601 date string (YYYY-MM-DD), e.g. "2026-04-23".
 *
 * Case A — No front matter:
 *   Prepends "---\ndate: {dateStr}\n---\n\n" before the existing content.
 *
 * Case B — Front matter present:
 *   1. Locates the closing "---" fence.
 *   2. If no closing fence is found (malformed) → fall through to Case A.
 *   3. Checks whether the YAML body already has a "date:" line.
 *      - If YES → replaces that line with "date: {dateStr}". (EC-07)
 *      - If NO  → inserts "date: {dateStr}\n" as the first line. (EC-06)
 *   4. Reassembles the document without duplicating the opening fence.
 *
 * The output never contains two opening "---" fences.
 *
 * @param content - The full document text (may be empty).
 * @param dateStr - ISO 8601 date to inject (e.g. "2026-04-23").
 * @returns The modified document text.
 */
export function injectFrontMatter(content: string, dateStr: string): string {
  const dateLine = `date: ${dateStr}`;

  if (!hasFrontMatter(content)) {
    // Case A: no existing front matter — prepend a new block.
    // Two newlines after the closing "---" separate the block from the body.
    return `---\n${dateLine}\n---\n\n${content}`;
  }

  // Case B: content already starts with "---\n".
  // Find the closing fence: search for "\n---" anywhere after the opening fence.
  // The opening fence occupies characters 0-3 ("---\n"), so we search from index 4.
  const closingFenceIndex = content.indexOf("\n---", 4);

  if (closingFenceIndex === -1) {
    // Malformed front matter: opening fence with no closing fence.
    // Treat as Case A to avoid producing a broken document (EC-06 safety net).
    return `---\n${dateLine}\n---\n\n${content}`;
  }

  // Extract the YAML body: everything between "---\n" and the closing "\n---".
  // opening = "---\n" (4 chars), body ends at closingFenceIndex.
  const yamlBody = content.slice(4, closingFenceIndex);

  // Everything after the closing "\n---" (which is 4 chars: '\n', '-', '-', '-').
  const afterClosingFence = content.slice(closingFenceIndex + 4);

  // Check if the YAML body already contains a "date:" line.
  // The /^date:/m flag makes "^" match at the start of each line within yamlBody.
  const dateFieldRegex = /^date:.*$/m;
  let updatedYamlBody: string;

  if (dateFieldRegex.test(yamlBody)) {
    // Replace the existing date: line with the new value (EC-07).
    updatedYamlBody = yamlBody.replace(dateFieldRegex, dateLine);
  } else {
    // No date: field — insert it as the very first line of the YAML block (EC-06).
    updatedYamlBody = `${dateLine}\n${yamlBody}`;
  }

  // Reassemble: opening fence + updated body + closing fence + rest of document.
  // `afterClosingFence` already starts with the content after "\n---", which
  // is typically "\n\n" followed by the document body.
  return `---\n${updatedYamlBody}\n---${afterClosingFence}`;
}
