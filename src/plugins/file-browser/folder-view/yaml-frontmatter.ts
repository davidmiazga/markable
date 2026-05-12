/**
 * yaml-frontmatter.ts — Minimal line-oriented YAML frontmatter parser/writer.
 *
 * The parser detects --- delimiters and key: scalar_value lines. Everything
 * else is preserved verbatim. No third-party YAML library is used (AD-6).
 *
 * Design constraints:
 *   - The entire file must work inside a plugin IIFE with no external imports.
 *   - Complex YAML (arrays, nested mappings, anchors) is preserved verbatim;
 *     only simple scalar key: value lines are touched.
 *   - The delimiter check is exact: an entire trimmed line === "---" closes
 *     the block. A value like `key: "--- not a delim"` will NOT close it
 *     because the full trimmed line is not exactly "---" (EC-24).
 *
 * @module folder-view/yaml-frontmatter
 */

/**
 * Parsed representation of a file split into frontmatter and body.
 *
 * hasFrontmatter   — true when a valid opening+closing --- block was found.
 * frontmatterLines — Lines between the --- delimiters (not including the
 *                    delimiter lines themselves). Empty array when no frontmatter.
 * bodyLines        — Lines after the closing --- delimiter, or all file lines
 *                    when hasFrontmatter is false.
 */
export interface ParsedFile {
  hasFrontmatter: boolean;
  frontmatterLines: string[];
  bodyLines: string[];
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a file's content into frontmatter lines and body lines.
 *
 * Algorithm:
 *   1. Split content on "\n".
 *   2. If lines[0].trim() !== "---", no frontmatter block exists.
 *   3. Scan lines[1..] for the closing "---". The test is exact:
 *      the entire trimmed line must be "---" (not just a prefix).
 *   4. If no closing "---" found: malformed=true.
 *   5. Otherwise: frontmatterLines = lines between the two delimiters;
 *      bodyLines = lines after the closing delimiter.
 *
 * @param content - Raw file content as a UTF-8 string.
 * @returns ParsedFile extended with a malformed flag.
 */
export function parseYamlFrontmatter(
  content: string,
): ParsedFile & { malformed: boolean } {
  const lines = content.split("\n");

  // No frontmatter if the file does not start with exactly "---".
  if (lines[0]?.trim() !== "---") {
    return {
      hasFrontmatter: false,
      malformed: false,
      frontmatterLines: [],
      bodyLines: lines,
    };
  }

  // Search lines[1..] for the closing "---".
  // A line whose full trimmed text is "---" closes the block (EC-24: a line
  // like `key: "--- not a delim"` has a trimmed value of `key: "--- not a delim"`
  // which is NOT equal to "---", so it does not close the block).
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  // EC-10: opening "---" found but no closing "---" — malformed block.
  if (closingIndex === -1) {
    return {
      hasFrontmatter: false,
      malformed: true,
      frontmatterLines: [],
      bodyLines: lines,
    };
  }

  // Lines between the two delimiters (not including the delimiters themselves).
  const frontmatterLines = lines.slice(1, closingIndex);
  // Lines after the closing delimiter form the body.
  const bodyLines = lines.slice(closingIndex + 1);

  return {
    hasFrontmatter: true,
    malformed: false,
    frontmatterLines,
    bodyLines,
  };
}

// ── Key writer ────────────────────────────────────────────────────────────────

/**
 * Add or update a key in frontmatterLines.
 *
 * Values containing a colon or leading/trailing whitespace are double-quoted
 * to prevent downstream YAML parsers from misinterpreting them (EC-13, EC-24).
 * Existing double-quotes inside the value are escaped as \".
 *
 * This function never mutates the input array — it always returns a copy.
 *
 * @param frontmatterLines - Lines between the --- delimiters (not including delimiters).
 * @param key              - The YAML key to add or update.
 * @param value            - The scalar value to assign.
 * @returns New array of frontmatter lines with the key added or updated.
 */
export function applyYamlKey(
  frontmatterLines: string[],
  key: string,
  value: string,
): string[] {
  // Determine how to serialize the value: quote when the value contains a colon
  // or has leading/trailing whitespace, since both break YAML scalar parsing.
  // Also quote when the value starts with "---" to avoid ambiguity: a YAML
  // parser that re-reads the file might treat a bare `key: --- heading` value
  // as a block-scalar or document-marker depending on the parser implementation
  // (EC-24). Quoting guarantees it is always read as a string.
  const needsQuoting =
    value.includes(":") ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.startsWith("---");

  let serializedValue: string;
  if (needsQuoting) {
    // Escape any existing double-quote characters inside the value (A-09).
    const escaped = value.replace(/"/g, '\\"');
    serializedValue = `"${escaped}"`;
  } else {
    serializedValue = value;
  }

  const newLine = `${key}: ${serializedValue}`;

  // Search for an existing line that defines this key.
  // A match requires the line to start with `key:` followed by a space, tab,
  // or be exactly `key:` (bare key with no value). This prevents partial
  // key matches: key "a" must not match a line starting with "a-extra:".
  const copy = [...frontmatterLines];
  const existingIndex = copy.findIndex(
    line =>
      line === key + ":" ||
      line.startsWith(key + ": ") ||
      line.startsWith(key + ":\t"),
  );

  if (existingIndex !== -1) {
    // Replace the existing line in the copy.
    copy[existingIndex] = newLine;
  } else {
    // Append the new line.
    copy.push(newLine);
  }

  return copy;
}

/**
 * Remove a key line from frontmatterLines.
 *
 * Returns the lines unchanged (not an error) when key is absent (EC-09).
 * This function never mutates the input array — it always returns a filtered copy.
 *
 * @param frontmatterLines - Lines between the --- delimiters.
 * @param key              - The YAML key to remove.
 * @returns New array with the key's line removed, or an identical copy if absent.
 */
export function removeYamlKey(frontmatterLines: string[], key: string): string[] {
  // Filter out any line that defines this exact key (same prefix rules as applyYamlKey).
  return frontmatterLines.filter(
    line =>
      line !== key + ":" &&
      !line.startsWith(key + ": ") &&
      !line.startsWith(key + ":\t"),
  );
}

// ── Reconstructor ─────────────────────────────────────────────────────────────

/**
 * Reconstruct the full file content from a ParsedFile.
 *
 * Rules:
 *   - hasFrontmatter && frontmatterLines.length > 0:
 *       "---\n" + frontmatterLines.join("\n") + "\n---\n" + bodyLines.join("\n")
 *   - hasFrontmatter && frontmatterLines.length === 0:
 *       bodyLines.join("\n") only (EC-23 — empty frontmatter block removed)
 *   - !hasFrontmatter:
 *       bodyLines.join("\n")
 *
 * The body lines already contain a trailing empty string when the original
 * file ended with a newline (because "a\n".split("\n") yields ["a", ""]).
 * We must NOT add an extra newline — only reassemble what the parser split.
 *
 * @param parsed - A ParsedFile (as returned by parseYamlFrontmatter).
 * @returns The reconstructed file content as a string.
 */
export function reconstructFile(parsed: ParsedFile): string {
  if (parsed.hasFrontmatter && parsed.frontmatterLines.length > 0) {
    return (
      "---\n" +
      parsed.frontmatterLines.join("\n") +
      "\n---\n" +
      parsed.bodyLines.join("\n")
    );
  }

  // EC-23: empty frontmatter block is removed entirely — return body only.
  // Also handles !hasFrontmatter — same behaviour.
  return parsed.bodyLines.join("\n");
}
