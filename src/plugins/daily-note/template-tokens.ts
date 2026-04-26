/**
 * template-tokens.ts — Template content token substitution
 *
 * Replaces `{{token}}` and `{{token:FORMAT}}` placeholders in daily note
 * template files. All tokens are Obsidian-compatible (no "dn-" prefix).
 *
 * This module is pure: no DOM, no Tauri invoke, no window globals.
 * The optional `now` parameter on `substituteTokens` allows deterministic
 * testing of the `{{time}}` token without mocking `Date`.
 *
 * Supported tokens (FR-05.2):
 *   {{date}}           → formatDate(date, dateFormat)
 *   {{date:FORMAT}}    → formatDate(date, FORMAT)
 *   {{weekday}}        → full weekday name
 *   {{weekday-short}}  → abbreviated weekday
 *   {{year}}           → 4-digit year
 *   {{month}}          → 2-digit month (01–12)
 *   {{month-name}}     → full month name (January, …)
 *   {{day}}            → 2-digit day (01–31)
 *   {{week}}           → ISO week number, zero-padded
 *   {{time}}           → HH:mm of current time (or `now` override)
 *   {{title}}          → same as {{date}}
 *   {{prev-link}}      → [[YYYY-MM-DD]] of the prior day
 *   {{next-link}}      → [[YYYY-MM-DD]] of the next day
 *
 * Unknown tokens are left verbatim (FR-05.3).
 *
 * Spec: docs/specs/daily-note/step_02_pure_submodules.md
 */

import { formatDate, addDays, getISOWeekNumber } from "./date-utils";

// ── Public types ──────────────────────────────────────────────────────────────

/** Input context required by substituteTokens. */
export interface TokenContext {
  /** The date the note is being created for. */
  date: Date;
  /** The configured date format string (Moment.js tokens), e.g. "YYYY-MM-DD". */
  dateFormat: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Full month names indexed by Date.getMonth() (0 = January). */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Full weekday names indexed by Date.getDay() (0 = Sunday). */
const WEEKDAY_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

/** Abbreviated weekday names indexed by Date.getDay() (0 = Sunday). */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Zero-pad a number to exactly `width` digits.
 */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Resolve a single token name to its replacement string.
 *
 * Returns undefined for unknown tokens so the caller can leave them verbatim
 * (FR-05.3 — "unknown tokens pass through unchanged").
 *
 * The `now` parameter overrides the current wall-clock time for `{{time}}`,
 * enabling deterministic tests without mocking the global Date constructor.
 *
 * @param token - The token string (without the surrounding {{ }}).
 * @param ctx   - Date and format context.
 * @param now   - Optional time override for the {{time}} token.
 * @returns Replacement string, or undefined if the token is unrecognised.
 */
function resolveToken(
  token: string,
  ctx: TokenContext,
  now: Date
): string | undefined {
  const { date, dateFormat } = ctx;

  // Handle {{date:FORMAT}} — everything after the colon is the format string.
  // EC-08: if FORMAT contains no valid tokens, formatDate returns it unchanged.
  if (token.startsWith("date:")) {
    const fmt = token.slice(5); // strip "date:"
    return formatDate(date, fmt);
  }

  switch (token) {
    case "date":
      return formatDate(date, dateFormat);

    case "title":
      // {{title}} is intentionally identical to {{date}} (Obsidian parity).
      return formatDate(date, dateFormat);

    case "weekday":
      return WEEKDAY_FULL[date.getDay()];

    case "weekday-short":
      return WEEKDAY_SHORT[date.getDay()];

    case "year":
      return String(date.getFullYear());

    case "month":
      return pad(date.getMonth() + 1, 2);

    case "month-name":
      return MONTH_NAMES[date.getMonth()];

    case "day":
      return pad(date.getDate(), 2);

    case "week":
      return pad(getISOWeekNumber(date), 2);

    case "time": {
      // Use the `now` override (passed by tests) or the current wall time.
      const h = pad(now.getHours(), 2);
      const m = pad(now.getMinutes(), 2);
      return `${h}:${m}`;
    }

    case "prev-link": {
      // Wiki-link to the prior day, always in YYYY-MM-DD format (not dateFormat).
      const prev = addDays(date, -1);
      return `[[${formatDate(prev, "YYYY-MM-DD")}]]`;
    }

    case "next-link": {
      // Wiki-link to the next day, always in YYYY-MM-DD format.
      const next = addDays(date, 1);
      return `[[${formatDate(next, "YYYY-MM-DD")}]]`;
    }

    default:
      // Unknown token — return undefined so the caller preserves the original text.
      return undefined;
  }
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Replace all `{{token}}` and `{{token:FORMAT}}` placeholders in `content`.
 *
 * Algorithm:
 * 1. Find every `{{...}}` occurrence with a single global regex pass.
 * 2. Extract the inner token name.
 * 3. Resolve the token via `resolveToken`. If undefined → return original text.
 *
 * The `now` parameter lets tests override the wall-clock time captured by
 * `{{time}}` without needing to mock `new Date()`.
 *
 * @param content - Raw template content string.
 * @param ctx     - Date and format context.
 * @param now     - Optional time override (defaults to new Date() at call time).
 * @returns Template content with all known tokens replaced.
 */
export function substituteTokens(
  content: string,
  ctx: TokenContext,
  now: Date = new Date()
): string {
  // A single-pass regex to capture everything between {{ and }}.
  // Using [^}]+ ensures we stop at the first closing brace (non-greedy via
  // character class negation rather than lazy quantifier, which is slightly
  // faster for long template strings).
  const TOKEN_PATTERN = /\{\{([^}]+)\}\}/g;

  return content.replace(TOKEN_PATTERN, (fullMatch, tokenName: string) => {
    const replacement = resolveToken(tokenName.trim(), ctx, now);
    // If the token is not recognised, return it verbatim (FR-05.3).
    return replacement !== undefined ? replacement : fullMatch;
  });
}
