/**
 * callouts.ts — Shared parser for Obsidian-style callouts.
 *
 * Single source of truth for callout detection used by both the live-preview
 * renderer (live-preview.ts) and the HTML exporter (lib/export.ts). Keeping
 * the parser here means the two paths can't drift on which aliases are
 * recognized, which fold markers are accepted, or how titles default.
 *
 * Obsidian spec: https://help.obsidian.md/Editing+and+formatting/Callouts
 */

/**
 * Maps every Obsidian-recognized callout alias to its canonical type.
 * The canonical type drives icon + color lookup; the *written* word
 * (lowercased input key) drives the default title text so a user who
 * writes `[!hint]` sees "Hint" — not "Tip" — in the title row.
 */
export const CALLOUT_ALIASES: Record<string, string> = {
  // note
  note: "note",
  // abstract
  abstract: "abstract", summary: "abstract", tldr: "abstract",
  // info
  info: "info",
  // todo
  todo: "todo",
  // tip
  tip: "tip", hint: "tip", important: "tip",
  // success
  success: "success", check: "success", done: "success",
  // question
  question: "question", help: "question", faq: "question",
  // warning
  warning: "warning", caution: "warning", attention: "warning",
  // failure
  failure: "failure", fail: "failure", missing: "failure",
  // danger
  danger: "danger", error: "danger",
  // bug
  bug: "bug",
  // example
  example: "example",
  // quote
  quote: "quote", cite: "quote",
  // plain — no icon, no left accent, no default title. A bare rounded box.
  // Color variants reuse the palette already in use for the standard types
  // (see styles.css). Each variant is its own canonical so CSS can key off it.
  plain: "plain",
  "plain-blue": "plain-blue",
  "plain-cyan": "plain-cyan",
  "plain-green": "plain-green",
  "plain-yellow": "plain-yellow",
  "plain-orange": "plain-orange",
  "plain-red": "plain-red",
  "plain-purple": "plain-purple",
};

/**
 * The distinct canonical callout types — one per icon + color slot.
 * Order chosen to match Obsidian's docs page for predictable picker UI.
 * The seven `plain-*` color variants extend the bare `plain` box with
 * the existing standard-callout palette (no icon, no left accent).
 */
export const CALLOUT_TYPES = [
  "note", "abstract", "info", "todo", "tip", "success",
  "question", "warning", "failure", "danger", "bug", "example", "quote",
  "plain",
  "plain-blue", "plain-cyan", "plain-green", "plain-yellow",
  "plain-orange", "plain-red", "plain-purple",
] as const;

/**
 * True for `plain` and every `plain-<color>` canonical. Both the live-preview
 * widget and the HTML exporter use this to decide: (a) skip the icon and (b)
 * skip the default-title fallback (the type word). Centralized so the two
 * paths can't drift on which variants count as "plain".
 */
export function isPlainCallout(canonical: string): boolean {
  return canonical === "plain" || canonical.startsWith("plain-");
}

export type CalloutCanonical = (typeof CALLOUT_TYPES)[number] | string;

/** Parsed callout header — null when the line isn't a callout. */
export interface CalloutHeader {
  /** Canonical type for icon/color lookup. Falls back to the lowercased
   * written type when it's not a known alias (supports user-defined
   * custom callout types via CSS). */
  canonical: string;
  /** Capitalized written word from the markdown. Used as the default
   * title when no explicit title override is provided. */
  written: string;
  /** Foldable marker: "+" = open, "-" = collapsed, "" = not foldable. */
  fold: "" | "+" | "-";
  /** Title override text after the `[!type]±` marker. Empty when none. */
  title: string;
  /** Nesting depth — 1 for a top-level callout, 2+ for nested
   * (`> > [!warning]` inside another callout's body). */
  depth: number;
}

/**
 * Matches a callout header line. Capture groups:
 *   1: blockquote prefix (one or more `>` chars) — length = depth
 *   2: written type word (alphanumeric + underscores)
 *   3: fold marker ("+", "-", or empty)
 *   4: rest of the line (title override)
 *
 * Examples that match:
 *   `> [!tip] Pro tip`
 *   `> [!hint]`
 *   `> [!note]+`
 *   `> > [!warning]- Hidden`
 */
/**
 * Captures one or more `>` markers (each optionally followed by whitespace)
 * before the `[!type]` token. Obsidian writes nested callouts as `> > [!x]`
 * with spaces between the `>` chars, so the depth count comes from the
 * `>` chars inside the prefix — not from the prefix string's length.
 */
const HEADER_RE = /^((?:>\s*)+)\[!([\w-]+)\]([+-]?)\s*(.*)$/;

/**
 * Parse a single line as a callout header. Returns null when the line
 * doesn't look like a callout (no `[!type]` marker after blockquote `>`).
 *
 * Unknown type words pass through as their own canonical (lowercased) so
 * user-defined custom callout types work: `[!recipe]` parses with
 * `canonical: "recipe"` and falls back to the default icon + default
 * `--callout-color` in CSS. Users register custom types by adding
 * `.callout[data-callout="recipe"] { --callout-color: ...; }` to their
 * theme — same convention as Obsidian.
 */
export function parseCalloutHeader(line: string): CalloutHeader | null {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  const [, prefix, rawType, fold, rest] = m;
  const writtenLower = rawType.toLowerCase();
  const canonical = CALLOUT_ALIASES[writtenLower] ?? writtenLower;
  return {
    canonical,
    written: writtenLower.charAt(0).toUpperCase() + writtenLower.slice(1),
    fold: (fold as "" | "+" | "-") ?? "",
    title: rest.trim(),
    depth: (prefix.match(/>/g) ?? []).length,
  };
}

/**
 * Parses a callout title string for an optional leading ATX-heading marker
 * (`#`, `##`, …, `######`) and returns the heading level + the remaining
 * text. Used by both the live-preview widget and the HTML exporter so the
 * two paths agree on which titles get h1..h6 sizing.
 *
 * Examples:
 *   "## Section Title"  → { level: 2, rest: "Section Title" }
 *   "Plain title"       → { level: 0, rest: "Plain title" }
 *   "####### too deep"  → { level: 0, rest: "####### too deep" }  (>6 #'s = not a heading)
 */
export function parseCalloutTitle(title: string): { level: number; rest: string } {
  const m = title.match(/^(#{1,6})\s+(.*)$/);
  if (m) return { level: m[1].length, rest: m[2] };
  return { level: 0, rest: title };
}

/**
 * Strip exactly N levels of `> ` blockquote prefix from a line. Used by
 * the parsers when walking the body of a depth-N callout — they want
 * the inner content (which may itself contain a deeper-nested callout
 * header at depth N+1).
 *
 * Returns the original line when it has fewer than N levels of prefix
 * (signals end of the callout block).
 */
export function stripBlockquotePrefix(line: string, levels: number): string | null {
  let s = line;
  for (let i = 0; i < levels; i++) {
    if (!s.startsWith(">")) return null;
    s = s.slice(1);
    if (s.startsWith(" ")) s = s.slice(1);
  }
  return s;
}
