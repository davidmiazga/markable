/**
 * calendar-grid.ts — Calendar month grid builder
 *
 * Builds a 6-row × 7-column grid of calendar cells for a given month.
 * The grid is always exactly 42 cells (6 weeks) regardless of how many days
 * are in the month, preventing layout shift when switching between months.
 *
 * Padding cells (from the prior or following month) have `isPadding: true`.
 * Every cell carries the actual calendar Date and its ISO week number.
 *
 * This module is pure: no DOM, no Tauri invoke, no window globals.
 *
 * Spec: docs/specs/daily-note/step_02_pure_submodules.md
 */

import { getISOWeekNumber } from "./date-utils";

// ── Public types ──────────────────────────────────────────────────────────────

/** Which day of the week is the first column in the calendar. */
export type FirstDayOfWeek = "monday" | "sunday";

/** A single cell in the calendar grid. */
export interface CalendarCell {
  /** The calendar date this cell represents (local time). */
  date: Date;
  /** 1–31 for real days; 0 for padding cells (convenience, rarely needed). */
  dayNumber: number;
  /** true for filler cells from the prior or following month. */
  isPadding: boolean;
  /** ISO 8601 week number (1–53). Used for the week-number column. */
  weekNumber: number;
}

/** The return type of buildCalendarGrid. */
export interface CalendarMonth {
  /** Full year, e.g. 2026. */
  year: number;
  /** 0-indexed month (0 = January, 11 = December), matching JS Date convention. */
  month: number;
  /** Six rows of seven cells each. Total cells always = 42. */
  weeks: CalendarCell[][];
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Return the number of days in a given month.
 *
 * Uses the "day 0 of the next month" trick: `new Date(year, month+1, 0)`
 * produces the last day of `month`, so `.getDate()` gives the day count.
 *
 * @param year  - Full year (e.g. 2026).
 * @param month - 0-indexed month (0 = January).
 * @returns 28, 29, 30, or 31.
 */
export function getDaysInMonth(year: number, month: number): number {
  // Day 0 of the following month = last day of this month.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Build a complete 6-row × 7-column calendar grid for a given month.
 *
 * `month` is 0-indexed (0 = January, 11 = December), consistent with
 * the JavaScript Date API.
 *
 * Algorithm:
 * 1. Determine the first and last days of the month.
 * 2. Compute the column offset for the first day:
 *    - Monday-first: offset = (firstDay.getDay() + 6) % 7  (Mon=0 … Sun=6)
 *    - Sunday-first: offset = firstDay.getDay()             (Sun=0 … Sat=6)
 * 3. Prepend `offset` padding cells from the prior month.
 * 4. Append all real days of the month.
 * 5. Pad the end until we reach exactly 42 cells (6 rows × 7 cols).
 * 6. Chunk the 42-cell flat array into 6 arrays of 7.
 * 7. Attach ISO week numbers.
 *
 * EC-18: February in a non-leap year has 28 days. The algorithm always
 * produces exactly 28 non-padding cells regardless of month length.
 *
 * @param year     - Full year (e.g. 2026).
 * @param month    - 0-indexed month.
 * @param firstDay - Which day is the first column ("monday" or "sunday").
 * @returns A CalendarMonth with exactly 6 rows of 7 CalendarCells.
 */
export function buildCalendarGrid(
  year: number,
  month: number,
  firstDay: FirstDayOfWeek
): CalendarMonth {
  const TOTAL_CELLS = 42; // 6 rows × 7 columns — always fixed

  const firstOfMonth = new Date(year, month, 1);

  // Compute how many padding cells to prepend from the prior month.
  // Monday-first: Monday = column 0, Sunday = column 6.
  // Sunday-first: Sunday = column 0, Saturday = column 6.
  const rawDayOfWeek = firstOfMonth.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const startOffset =
    firstDay === "monday"
      ? (rawDayOfWeek + 6) % 7 // Mon→0, Tue→1, …, Sun→6
      : rawDayOfWeek;           // Sun→0, Mon→1, …, Sat→6

  const cells: CalendarCell[] = [];

  // ── Leading padding cells (from the prior month) ──────────────────────────
  for (let i = startOffset - 1; i >= 0; i--) {
    // Go back `i+1` days from the 1st to get dates in the prior month.
    const paddingDate = new Date(year, month, -i); // day 0 = last day of prior month, day -1 = second-to-last, etc.
    cells.push({
      date: paddingDate,
      dayNumber: 0, // padding cells use 0 as a sentinel (not displayed as a real day)
      isPadding: true,
      weekNumber: getISOWeekNumber(paddingDate),
    });
  }

  // ── Real days of the target month ─────────────────────────────────────────
  const daysInMonth = getDaysInMonth(year, month);
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({
      date: d,
      dayNumber: day,
      isPadding: false,
      weekNumber: getISOWeekNumber(d),
    });
  }

  // ── Trailing padding cells (from the next month) ──────────────────────────
  // Fill until we reach exactly TOTAL_CELLS (42).
  let nextMonthDay = 1;
  while (cells.length < TOTAL_CELLS) {
    const paddingDate = new Date(year, month + 1, nextMonthDay++);
    cells.push({
      date: paddingDate,
      dayNumber: 0,
      isPadding: true,
      weekNumber: getISOWeekNumber(paddingDate),
    });
  }

  // ── Chunk 42 flat cells into 6 rows of 7 ──────────────────────────────────
  const weeks: CalendarCell[][] = [];
  for (let row = 0; row < 6; row++) {
    weeks.push(cells.slice(row * 7, row * 7 + 7));
  }

  return { year, month, weeks };
}
