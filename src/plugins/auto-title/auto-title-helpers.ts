// ── extractH1 ────────────────────────────────────────────────────────────────

/**
 * Returns the text of the first H1 heading in a document, skipping YAML
 * front matter. Returns null if there is no H1 on the first content line.
 */
export function extractH1(doc: string): string | null {
  if (!doc) return null;

  let body = doc;

  if (doc.startsWith("---\n")) {
    const closingIdx = doc.indexOf("\n---", 4);
    if (closingIdx === -1) {
      // Malformed front matter — treat whole doc as body; first line is "---"
      body = doc;
    } else {
      // Skip past the closing fence and any trailing newline
      const afterFence = closingIdx + 4;
      body = doc.slice(afterFence).replace(/^\n/, "");
    }
  }

  const firstLine = body.split("\n").find((l) => l.length > 0) ?? "";
  const match = firstLine.match(/^# (.+)/);
  if (!match) return null;

  const text = match[1].trimEnd();
  return text.length > 0 ? text : null;
}

// ── h1ToFilename ─────────────────────────────────────────────────────────────

export type FilenameStyle = "spaces" | "camel" | "kebab";

const ILLEGAL_CHARS = /[/\\:*?"<>|\x00]/g;

/**
 * Converts H1 heading text to a safe filename stem (no extension).
 *
 * style "spaces" — preserves capitalisation, spaces between words (default)
 * style "camel"  — UpperCamelCase, no separators
 * style "kebab"  — all-lowercase, hyphen-separated
 *
 * Returns "Untitled" when all chars are illegal.
 */
export function h1ToFilename(h1: string, style: FilenameStyle = "spaces"): string {
  const sanitized = h1
    .replace(ILLEGAL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) return "Untitled";

  if (style === "spaces") return sanitized;

  const words = sanitized.split(" ");

  if (style === "camel") {
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  }

  // kebab
  return words.map((w) => w.toLowerCase()).join("-");
}

// ── resolveConflictPath ───────────────────────────────────────────────────────

/**
 * Returns the first non-conflicting absolute path for a new file.
 *
 * @param dir       Absolute directory path (no trailing slash).
 * @param stem      Filename stem without extension.
 * @param existsMap Map of absolute paths → boolean from check_paths_exist.
 */
export function resolveConflictPath(
  dir: string,
  stem: string,
  existsMap: Record<string, boolean>,
): string {
  const primary = `${dir}/${stem}.md`;
  if (!existsMap[primary]) return primary;

  for (let n = 2; n <= 99; n++) {
    const candidate = `${dir}/${stem} ${n}.md`;
    if (!existsMap[candidate]) return candidate;
  }

  return `${dir}/${stem} 100.md`;
}
