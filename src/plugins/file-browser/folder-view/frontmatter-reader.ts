/**
 * frontmatter-reader.ts — Lightweight YAML frontmatter key extractor.
 *
 * Extracts a specified set of keys from a Markdown file's YAML frontmatter
 * block. This is intentionally a narrow, fast utility — it does not attempt
 * to parse full YAML and does not reuse parseFolderMd() (which returns a
 * FolderViewConfig, the wrong type for child-file reads).
 *
 * Used by the enrichment phase in tab.ts (FR-09, FR-10).
 *
 * Design:
 *   - Scans between the first "---" and the closing "---".
 *   - For each declared key, matches lines of the form "key: value".
 *   - Strips inline comments (" #...") and surrounding quotes from values,
 *     matching the behaviour of parseYamlLines() for scalar values.
 *   - Never throws; any error returns {}.
 *
 * @module folder-view/frontmatter-reader
 */

/**
 * Extract specific frontmatter keys from the content of a Markdown file.
 *
 * Only top-level scalar keys are extracted — indented lines (sequence items,
 * nested mapping values) are skipped by the leading-whitespace check.
 *
 * @param content - Raw file content string.
 * @param keys    - Array of YAML key names to extract.
 * @returns A Record mapping each found key to its trimmed string value.
 *          Keys not found in the frontmatter are absent from the result.
 *          If the file has no frontmatter or any error occurs, returns {}.
 */
export function extractFrontmatterKeys(
  content: string,
  keys: string[],
): Record<string, string> {
  try {
    if (!keys.length) return {};

    const trimmed = content.trimStart();
    if (!trimmed.startsWith("---")) return {};

    // Slice past the opening "---" and look for the closing "\n---".
    const afterOpen = trimmed.slice(3);
    const closeIdx = afterOpen.indexOf("\n---");
    if (closeIdx === -1) return {};

    const yamlBlock = afterOpen.slice(0, closeIdx);
    const result: Record<string, string> = {};
    // Use a Set for O(1) key lookup when many keys are requested.
    const keySet = new Set(keys);

    for (const raw of yamlBlock.split("\n")) {
      const line = raw.trimEnd();
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      // Only consider top-level keys (no leading whitespace).
      // Indented lines belong to nested blocks or sequence items.
      if (line.length !== line.trimStart().length) continue;

      const lineKey = line.slice(0, colonIdx).trim();
      if (!keySet.has(lineKey)) continue;

      let value = line.slice(colonIdx + 1).trim();

      // Strip inline comment — mirrors parseYamlLines behaviour.
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();

      // Strip surrounding single or double quotes.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result[lineKey] = value;
    }

    return result;
  } catch {
    // Safety net: any unexpected error returns {} (never throws to callers).
    return {};
  }
}
