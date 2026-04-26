/**
 * date-utils.ts — Pure date arithmetic, formatting, and path construction
 *
 * This module contains no DOM access, no Tauri invoke, and no CM6 references.
 * It is safe to import directly in Vitest and is statically bundled into the
 * daily-note IIFE plugin by Vite/Rollup at build time.
 *
 * Key design decisions:
 * - No Moment.js. Hand-written token formatter keeps the plugin under the 5 MB cap.
 * - Token replacement is longest-first to prevent partial substitution bugs
 *   (e.g. "YY" replacing the first two chars of "YYYY").
 * - All functions are pure — no side effects, no global state mutation.
 *
 * Spec: docs/specs/daily-note/step_02_pure_submodules.md
 */

// ── Public types ──────────────────────────────────────────────────────────────

/** Settings fields required to construct the note file path. */
export interface DailyNotePathSettings {
  /** Relative (to workspace) or absolute folder path for daily notes. */
  dailyNoteFolder: string;
  /** Moment.js-compatible token string, e.g. "YYYY-MM-DD". */
  dateFormat: string;
}

// ── Token map ─────────────────────────────────────────────────────────────────

/** Human-readable weekday names indexed by JS Date.getDay() (0 = Sunday). */
const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Abbreviated weekday names indexed by JS Date.getDay() (0 = Sunday). */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Zero-pad a number to `width` digits.
 * e.g. pad(5, 2) → "05"
 */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * The replacement map for formatDate.
 * Ordered longest-first so that the regex alternation matches longer tokens
 * before shorter ones (prevents "YYYY" being consumed by two "YY" matches, etc.).
 */
const TOKEN_MAP: Array<{ token: string; value: (d: Date) => string }> = [
  { token: "YYYY", value: (d) => pad(d.getFullYear(), 4) },
  { token: "YY",   value: (d) => pad(d.getFullYear() % 100, 2) },
  { token: "MM",   value: (d) => pad(d.getMonth() + 1, 2) },
  { token: "M",    value: (d) => String(d.getMonth() + 1) },
  { token: "DD",   value: (d) => pad(d.getDate(), 2) },
  { token: "D",    value: (d) => String(d.getDate()) },
  // dddd before ddd: ensures "dddd" is not partially matched by "ddd" + "d"
  { token: "dddd", value: (d) => WEEKDAY_FULL[d.getDay()] },
  { token: "ddd",  value: (d) => WEEKDAY_SHORT[d.getDay()] },
  // WW before W: ensures "WW" is not consumed by "W" + "W"
  { token: "WW",   value: (d) => pad(getISOWeekNumber(d), 2) },
  { token: "W",    value: (d) => String(getISOWeekNumber(d)) },
  { token: "HH",   value: (d) => pad(d.getHours(), 2) },
  { token: "mm",   value: (d) => pad(d.getMinutes(), 2) },
];

// Build a single regex that matches any token in one pass.
// We escape special regex chars in each token before joining with "|".
// The tokens are already ordered longest-first in TOKEN_MAP, so the regex
// alternation honours that order.
const TOKEN_REGEX = new RegExp(
  TOKEN_MAP.map((t) => t.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Replace Moment.js-style format tokens in `format` with the corresponding
 * component of `date`.
 *
 * Tokens are replaced longest-first in a single regex pass to prevent partial
 * substitution bugs (e.g. "YYYY" being partially consumed by "YY").
 *
 * Supported tokens: YYYY, YY, MM, M, DD, D, dddd, ddd, WW, W, HH, mm.
 * Any text that is not a recognised token passes through unchanged.
 *
 * @param date   - The date to format.
 * @param format - A Moment.js-compatible format string.
 * @returns      The formatted date string.
 */
export function formatDate(date: Date, format: string): string {
  // Build a lookup map: token string → replacement function.
  // The map is keyed by the token string for O(1) lookup inside the replacer.
  const lookup = new Map(TOKEN_MAP.map((t) => [t.token, t.value]));

  // Reset the regex lastIndex so repeated calls on the same regex are safe.
  TOKEN_REGEX.lastIndex = 0;

  return format.replace(TOKEN_REGEX, (match) => {
    const fn = lookup.get(match);
    // fn should always be defined because TOKEN_REGEX only matches known tokens,
    // but we fall back to the raw match string to be defensive.
    return fn ? fn(date) : match;
  });
}

/**
 * Compute the ISO 8601 week number for a given date.
 *
 * Algorithm:
 * 1. Copy the date and set time to midday to avoid DST edge cases.
 * 2. Move to the nearest Thursday (ISO weeks are Thursday-anchored).
 * 3. ISO week 1 is the week containing the first Thursday of the year.
 *    Calculate week number as distance (in weeks) from Jan 4 of the same year
 *    (Jan 4 is always in week 1 by ISO definition).
 *
 * @param date - Input date.
 * @returns ISO week number (1–53).
 */
export function getISOWeekNumber(date: Date): number {
  // Work on a copy to avoid mutating the caller's object.
  const d = new Date(date);
  // Midday avoids any DST boundary that could shift the day by ±1 hour.
  d.setHours(12, 0, 0, 0);
  // Move to Thursday of the current ISO week.
  // (d.getDay() + 6) % 7 maps Sun→6, Mon→0, Tue→1, …, Sat→5.
  // Subtracting that and adding 3 moves to Thursday.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  // Jan 4 is always in ISO week 1.
  const jan4 = new Date(d.getFullYear(), 0, 4, 12, 0, 0, 0);
  // Distance in milliseconds divided by ms-per-week, rounded.
  return Math.round((d.getTime() - jan4.getTime()) / 604800000) + 1;
}

/**
 * Return a new Date that is `days` days after (or before, if negative) `date`.
 * Does not mutate the input.
 *
 * The JS Date engine handles all month and year rollovers correctly, including
 * leap years (EC-13, EC-14, EC-15).
 *
 * @param date - Starting date.
 * @param days - Number of days to add (negative to subtract).
 * @returns A new Date object.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Check whether two Date objects fall on the same calendar day (local time).
 * Ignores the time-of-day component.
 *
 * @param a - First date.
 * @param b - Second date.
 * @returns true if year, month, and day are all equal.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Parse a natural-language or ISO 8601 date string.
 *
 * Accepted inputs:
 * - "today"     → today's date
 * - "yesterday" → yesterday's date
 * - "tomorrow"  → tomorrow's date
 * - "YYYY-MM-DD" → parsed via integer extraction (NOT new Date(string), which
 *   silently rolls over invalid dates like Feb 30).
 *
 * Returns null for any other input or for structurally invalid ISO dates
 * (e.g. month 13, Feb 30 in a non-leap year).
 *
 * @param input - The string to parse.
 * @returns A Date in local time, or null if unparseable.
 */
export function parseNaturalDate(input: string): Date | null {
  const s = input.trim().toLowerCase();

  if (s === "today") return new Date();
  if (s === "yesterday") return addDays(new Date(), -1);
  if (s === "tomorrow") return addDays(new Date(), 1);

  // ISO 8601 — match exactly YYYY-MM-DD.
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10) - 1; // convert to 0-indexed month
    const d = parseInt(iso[3], 10);

    // Validate month range (0-indexed: 0–11).
    if (m < 0 || m > 11) return null;

    const result = new Date(y, m, d);

    // Detect silent rollovers: if Feb 30 is provided, the Date engine
    // silently advances to March 1/2. We verify the components match.
    if (
      result.getFullYear() !== y ||
      result.getMonth() !== m ||
      result.getDate() !== d
    ) {
      return null;
    }

    return result;
  }

  return null;
}

/**
 * Validate a date format string for illegal macOS HFS+ filename characters.
 *
 * Returns null if the format is safe to use as a filename component.
 * Returns a human-readable error string naming the offending characters
 * if the format contains any of: `: * ? " < > | \`
 *
 * Note: `/` is intentionally NOT in this list because it is used to create
 * subfolder hierarchies in date formats (e.g. "YYYY/MM/YYYY-MM-DD").
 *
 * @param format - The format string to validate.
 * @returns null if valid, or an error description string.
 */
export function validateDateFormat(format: string): string | null {
  // Characters that are illegal in macOS HFS+ filenames.
  const illegal = [":", "*", "?", '"', "<", ">", "|", "\\"];
  const found = illegal.filter((ch) => format.includes(ch));

  if (found.length === 0) return null;

  return `Date format contains illegal filename characters: ${found.join(" ")}`;
}

/**
 * Join path segments into a single path string, normalising double slashes.
 *
 * Rules:
 * - Empty segments are filtered out.
 * - Absolute first segment (starts with "/") is preserved.
 * - Segments are joined with "/" and any resulting "//" is collapsed to "/".
 * - No trailing slash is added.
 *
 * This function replaces all direct "/" string concatenation in the plugin
 * (AD-G in the architecture doc) to avoid accidental double-slashes when
 * folder names include leading/trailing slashes.
 *
 * @param segments - Path components to join.
 * @returns Normalised path string.
 */
export function joinPath(...segments: string[]): string {
  // Filter empty strings so we don't produce a leading double-slash.
  const parts = segments.filter(Boolean);
  if (parts.length === 0) return "";

  // Join and then collapse any "//" that results from segments with trailing
  // or leading slashes (but do not collapse the leading "//" of absolute paths —
  // however, absolute paths start with "/" not "//", so this is safe).
  let result = parts.join("/");

  // Collapse multiple consecutive slashes into one, but only after the first
  // character to preserve an absolute root "/".
  result = result.replace(/([^:])\/\/+/g, "$1/");

  // Handle the case where the join itself created "//" at the very start.
  result = result.replace(/^\/\/+/, "/");

  return result;
}

/**
 * Build the absolute file path for a daily note.
 *
 * Logic:
 * 1. Format the date using settings.dateFormat (may include "/" for subfolders).
 * 2. Determine the base folder:
 *    - Absolute dailyNoteFolder → use as-is.
 *    - Empty dailyNoteFolder  → use workspaceDir directly (EC-39).
 *    - Relative dailyNoteFolder → join with workspaceDir.
 * 3. Join base folder with the formatted date and append ".md".
 *
 * @param date         - The date for the note.
 * @param workspaceDir - Absolute path to the current workspace directory.
 * @param settings     - Plugin settings (folder + format).
 * @returns Absolute path to the target .md file.
 */
export function buildNotePath(
  date: Date,
  workspaceDir: string,
  settings: DailyNotePathSettings
): string {
  const formattedDate = formatDate(date, settings.dateFormat);

  let base: string;
  if (settings.dailyNoteFolder.startsWith("/")) {
    // Absolute folder — ignore the workspace dir entirely.
    base = settings.dailyNoteFolder;
  } else if (settings.dailyNoteFolder === "") {
    // Empty folder → notes live directly in the workspace root (EC-39).
    base = workspaceDir;
  } else {
    // Relative folder → resolve against the workspace.
    base = joinPath(workspaceDir, settings.dailyNoteFolder);
  }

  // formattedDate may contain "/" (e.g. "2026/04/2026-04-23") — joinPath
  // handles multi-segment strings naturally because they become part of the
  // joined string and are normalised like any other segment.
  return joinPath(base, formattedDate) + ".md";
}

/**
 * Attempt to determine the note date from a filename.
 *
 * This is used by the prev/next navigation commands to derive the date from
 * the currently active tab's filename (FR-03.2).
 *
 * Strategy: for the default "YYYY-MM-DD" format, use a direct regex parse.
 * For non-default formats (which may involve subfolders or non-standard
 * orderings), the last path segment (after the final "/") is extracted and
 * a YYYY-MM-DD parse is attempted as a best-effort fallback. If all attempts
 * fail, null is returned and the caller falls back to today.
 *
 * @param filename - Filename or relative path (e.g. "2026-04-23.md" or
 *                   "2026/04/2026-04-23.md").
 * @param format   - The configured dateFormat string.
 * @returns Parsed Date, or null if the filename does not encode a parseable date.
 */
export function parseDateFromFilename(
  filename: string,
  format: string
): Date | null {
  if (format === "YYYY-MM-DD") {
    // Strict parse for the default format — only matches "YYYY-MM-DD.md".
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
    if (!match) return null;
    return parseNaturalDate(`${match[1]}-${match[2]}-${match[3]}`);
  }

  // Non-default formats: extract the base name (last segment after any "/")
  // and attempt a YYYY-MM-DD parse on the first 10 characters.
  // This is a best-effort approach — not all custom formats embed an ISO date.
  const base = filename.split("/").pop() ?? filename;
  const withoutExt = base.replace(/\.md$/, "");
  return parseNaturalDate(withoutExt.substring(0, 10)) ?? null;
}
