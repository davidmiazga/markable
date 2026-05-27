/**
 * Regression guard: CSS theme-token catalog completeness.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Every CSS variable referenced via `var(--X)` anywhere in `src/` must
 * resolve to a real definition — either in the canonical catalog in
 * `src/styles.css`, or in the JS-driven allowlist below (tokens set at
 * runtime by `element.style.setProperty(...)`).
 *
 * Why this matters: when a token is referenced but never defined, the
 * call site's hardcoded fallback fires unconditionally — and the historical
 * fallbacks are all dark colors like `#2a2a3a`. The result was 40+ surfaces
 * (slash menu, codeblock modal inputs, kanban inputs, etc.) rendering as
 * dark navy bars on light themes because tokens like `--bg-secondary` were
 * referenced but undefined, so the dark fallback won.
 *
 * The fix was structural: define every referenced token once in
 * `:root` / `[data-theme="dark"]`, with aliases for legacy spellings
 * (`--accent` → `--accent-color`, `--text-color` → `--text-primary`, etc.).
 * This test pins that contract: any future addition of `var(--mystery)`
 * without a matching definition fails the build immediately.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const STYLES_CSS = join(SRC_DIR, "styles.css");

/**
 * Tokens that are NOT expected to appear in styles.css because they are set
 * at runtime by JavaScript via `element.style.setProperty(...)`. Keep this
 * list explicit — adding to it should require a code review, not a silent
 * fall-through.
 */
const JS_DRIVEN_TOKENS = new Set<string>([
  // Editor / layout (set by settings)
  "--editor-pane-width",
  "--content-padding",
  "--settings-content-max-width",
  "--settings-base-font-size",
  // Folder view bookshelf (set per-book in bookshelf-renderer)
  "--fv-book-bg",
  "--fv-book-fg",
  "--fv-book-fg-secondary",
  "--fv-card-width",
  "--fv-spine-w",
  "--library-book-h",
  "--fv-book-min-width",
  "--fv-pattern-url",
  // Folder view preview pane (set by resize handle)
  "--fvp-height",
  // File browser tree (set per row for indentation)
  "--depth",
  // Bookshelf rail color (set per-shelf for palette rotation)
  "--shelf-color",
]);

/**
 * Feature tokens that are referenced but intentionally left undefined — their
 * call sites have theme-aware fallbacks (e.g. `var(--graph-edge-color, var(--border-color))`).
 * If you reference one of these without a theme-aware fallback, define it
 * properly in styles.css instead of adding it here.
 */
const FALLBACK_OK_TOKENS = new Set<string>([
  // Tab/sidebar styling — fallbacks reference --bg-secondary and friends.
  "--tab-dot-active-width",
  "--tab-dot-dirty-indicator-color",
  "--tab-dot-inactive-color",
  "--tab-dot-size",
  "--tab-pin-color",
  "--tab-regular-bg",
  "--tab-regular-height",
  "--tab-regular-text",
  "--tab-strip-bg",
  "--tab-strip-height",
  "--tab-vertical-active-bg",
  "--tab-vertical-bg",
  "--tab-vertical-width",
  // Media/diagrams — fallbacks reference --text-danger and --border-color.
  "--media-broken-bg",
  "--media-error-color",
  "--media-image-border",
  "--media-image-radius",
  "--media-loading-bg",
  "--media-rounded-radius",
  "--media-shadow-color",
  "--mermaid-error-color",
  "--mermaid-loading-color",
  "--mermaid-max-width",
  "--graph-ambiguous-edge",
  "--graph-edge-color",
  // Knowledge-graph button hover state — fallback chain through --bg-tertiary
  // is theme-aware. Could be promoted to a canonical token if other surfaces
  // start needing a "button hover" distinct from `--bg-hover`.
  "--button-hover-bg",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

function extractReferenced(text: string): Set<string> {
  // Match `var(--name)` and capture --name. Allow word chars and hyphens.
  const out = new Set<string>();
  const re = /var\((--[a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

function extractDefined(text: string): Set<string> {
  // Match `--name:` at the start of a (possibly indented) declaration. CSS
  // also allows hyphens; require at least one char before the colon.
  const out = new Set<string>();
  const re = /(?:^|\s|;|{)\s*(--[a-zA-Z][\w-]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

describe("CSS theme-token catalog completeness", () => {
  const definedInCatalog = extractDefined(readFileSync(STYLES_CSS, "utf8"));
  const allFiles = walk(SRC_DIR);
  const referenced = new Set<string>();
  for (const file of allFiles) {
    for (const t of extractReferenced(readFileSync(file, "utf8"))) {
      referenced.add(t);
    }
  }

  it("defines every var(--X) referenced anywhere in src/", () => {
    const undefined_: string[] = [];
    for (const token of referenced) {
      if (definedInCatalog.has(token)) continue;
      if (JS_DRIVEN_TOKENS.has(token)) continue;
      if (FALLBACK_OK_TOKENS.has(token)) continue;
      undefined_.push(token);
    }

    if (undefined_.length > 0) {
      const sorted = undefined_.sort();
      throw new Error(
        `Undefined CSS tokens referenced in src/ (define in styles.css or add to one of the allowlists in this test):\n  ${sorted.join("\n  ")}`,
      );
    }
    expect(undefined_).toEqual([]);
  });

  it("does not silently drop key surface tokens from the catalog", () => {
    // Pin the most-used canonical tokens so a refactor can't accidentally
    // delete them without failing here first.
    const mustExist = [
      "--bg-primary", "--bg-secondary", "--bg-tertiary", "--bg-hover", "--bg-chrome",
      "--text-primary", "--text-secondary", "--text-tertiary", "--text-danger",
      "--border-color", "--accent-color", "--link-color",
      "--shadow-color", "--error-color", "--warning-bg",
    ];
    for (const token of mustExist) {
      expect(definedInCatalog.has(token), `${token} must be defined in styles.css`).toBe(true);
    }
  });

  it("defines aliases that map legacy spellings to canonical tokens", () => {
    // These are the legacy-name aliases that let existing call sites resolve
    // without a grep-replace. If these go missing the surfaces using
    // `var(--accent)`, `var(--text-color)`, etc. break.
    const aliases = [
      "--accent", "--text-color", "--bg-color", "--hover-bg",
      "--muted-text", "--text-muted",
      "--input-bg", "--button-bg", "--menu-bg", "--tooltip-bg", "--panel-bg",
    ];
    for (const alias of aliases) {
      expect(definedInCatalog.has(alias), `${alias} alias must be defined in styles.css`).toBe(true);
    }
  });
});
