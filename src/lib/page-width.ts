/**
 * page-width.ts — page-level content-width override.
 *
 * Reads `content-width:` from a file's YAML frontmatter and applies it as
 * `--settings-content-max-width` on `document.documentElement` (plus a
 * marker class so the block-level overrides know to stand down).
 *
 * Precedence (locked):
 *   page-level YAML > block-level codefence > global Settings
 *
 * The marker class `markable-page-content-width` on `<html>` is what makes
 * the block-level CSS rules in styles.css yield: when set, the
 * `.cm-block-width-wide` / `-full` classes fall back to the page max-width.
 */

/**
 * Pull the `content-width:` value out of the first `---` frontmatter block.
 * Accepts any CSS length token (e.g. `1400px`, `90%`, `60rem`). Returns
 * `null` when the file has no frontmatter or the key is absent.
 */
export function readContentWidthFromFrontmatter(doc: string): string | null {
  if (!doc.startsWith("---")) return null;
  const closeIdx = doc.indexOf("\n---", 3);
  if (closeIdx === -1) return null;
  const block = doc.slice(3, closeIdx);
  const match = block.match(/^content-width:\s*([^\n#]+)/m);
  if (!match) return null;
  const raw = match[1].trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  // Loose validation: any non-empty token that isn't suspicious. We don't
  // gate on a strict CSS-length regex because users may use calc()/var()
  // expressions that are still legal.
  if (raw.includes(";") || raw.includes("{") || raw.includes("}")) return null;
  return raw;
}

const HTML_CLASS = "markable-page-content-width";
const CSS_VAR    = "--settings-content-max-width";

/**
 * Apply (or clear) the page-level content-width override.
 *
 * The CSS variable is set on `document.body` (NOT `documentElement`) so the
 * global Settings value — which lives on `documentElement` — is preserved.
 * When the page override is cleared, the global value cascades back through.
 *
 * The marker class still goes on `<html>` because that's what the CSS rules
 * in styles.css key off of to suppress block-level overrides.
 */
export function applyPageContentWidth(value: string | null): void {
  const root = document.documentElement;
  const body = document.body;
  if (value) {
    body.style.setProperty(CSS_VAR, value);
    root.classList.add(HTML_CLASS);
  } else {
    body.style.removeProperty(CSS_VAR);
    root.classList.remove(HTML_CLASS);
  }
}
