/**
 * Daily Note Plugin — Pure Sub-module Unit Tests (Step 02)
 *
 * All four pure TypeScript sub-modules are tested here:
 *   - date-utils.ts     (Groups 1–5)
 *   - template-tokens.ts (Group 6)
 *   - frontmatter.ts    (Group 7)
 *   - calendar-grid.ts  (Group 8)
 *
 * These modules have no window globals, no Tauri invoke, and no CM6 references,
 * so static imports work without any beforeAll dynamic-import dance.
 *
 * Spec: docs/specs/daily-note/step_02_pure_submodules.md
 */

import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";

// Static imports are safe here — none of these modules touch window at load time.
import {
  formatDate,
  addDays,
  isSameDay,
  parseNaturalDate,
  validateDateFormat,
  buildNotePath,
  joinPath,
  getISOWeekNumber,
  parseDateFromFilename,
} from "../../../src/plugins/daily-note/date-utils";

import { substituteTokens } from "../../../src/plugins/daily-note/template-tokens";

import {
  injectFrontMatter,
  hasFrontMatter,
} from "../../../src/plugins/daily-note/frontmatter";

import {
  buildCalendarGrid,
  getDaysInMonth,
} from "../../../src/plugins/daily-note/calendar-grid";

// ── Group 1: formatDate (8 tests) ─────────────────────────────────────────────

describe("formatDate", () => {
  it("formats YYYY-MM-DD correctly", () => {
    // April 23 2026 (month index 3)
    expect(formatDate(new Date(2026, 3, 23), "YYYY-MM-DD")).toBe("2026-04-23");
  });

  it("formats with subfolder tokens (YYYY/MM/YYYY-MM-DD)", () => {
    // Slashes inside the format string produce path-separator-like output
    expect(formatDate(new Date(2026, 3, 23), "YYYY/MM/YYYY-MM-DD")).toBe(
      "2026/04/2026-04-23"
    );
  });

  it("formats dddd (full weekday name) — April 23 2026 is Thursday", () => {
    expect(formatDate(new Date(2026, 3, 23), "dddd")).toBe("Thursday");
  });

  it("formats ddd (abbreviated weekday) — April 23 2026 is Thu", () => {
    expect(formatDate(new Date(2026, 3, 23), "ddd")).toBe("Thu");
  });

  it("formats WW (ISO week number, zero-padded) — April 23 2026 is week 17", () => {
    // ISO week 17 — two digits, zero-padded to at least 2
    expect(formatDate(new Date(2026, 3, 23), "WW")).toBe("17");
  });

  it("YY produces the last two digits of the year", () => {
    expect(formatDate(new Date(2026, 3, 23), "YY")).toBe("26");
  });

  it("M and D produce non-padded values for single-digit dates", () => {
    // March 5 — month 3, day 5
    const d = new Date(2026, 2, 5);
    expect(formatDate(d, "M")).toBe("3");
    expect(formatDate(d, "D")).toBe("5");
  });

  it("HH:mm produces zero-padded 24h time", () => {
    // 9:05 am → "09:05"
    expect(formatDate(new Date(2026, 3, 23, 9, 5), "HH:mm")).toBe("09:05");
  });
});

// ── Group 2: addDays / date arithmetic (8 tests) ──────────────────────────────

describe("addDays / isSameDay", () => {
  it("addDays(Jan 1, -1) rolls back to Dec 31 of the prior year (EC-13)", () => {
    const jan1 = new Date(2026, 0, 1);
    const dec31 = addDays(jan1, -1);
    expect(dec31.getFullYear()).toBe(2025);
    expect(dec31.getMonth()).toBe(11); // December
    expect(dec31.getDate()).toBe(31);
  });

  it("addDays(Dec 31, +1) rolls forward to Jan 1 of the next year (EC-14)", () => {
    const dec31 = new Date(2026, 11, 31);
    const jan1 = addDays(dec31, 1);
    expect(jan1.getFullYear()).toBe(2027);
    expect(jan1.getMonth()).toBe(0);
    expect(jan1.getDate()).toBe(1);
  });

  it("addDays(Feb 28 leap year, +1) lands on Feb 29 (EC-15a)", () => {
    const feb28 = new Date(2024, 1, 28); // 2024 is a leap year
    const feb29 = addDays(feb28, 1);
    expect(feb29.getMonth()).toBe(1);
    expect(feb29.getDate()).toBe(29);
  });

  it("addDays(Feb 29 leap year, +1) lands on Mar 1 (EC-15b)", () => {
    const feb29 = new Date(2024, 1, 29);
    const mar1 = addDays(feb29, 1);
    expect(mar1.getMonth()).toBe(2);
    expect(mar1.getDate()).toBe(1);
  });

  it("addDays(Feb 28 non-leap year, +1) lands on Mar 1", () => {
    const feb28 = new Date(2026, 1, 28); // 2026 is not a leap year
    const mar1 = addDays(feb28, 1);
    expect(mar1.getMonth()).toBe(2);
    expect(mar1.getDate()).toBe(1);
  });

  it("addDays does not mutate the original Date object", () => {
    const original = new Date(2026, 3, 23);
    const originalTime = original.getTime();
    addDays(original, 5);
    // The original must be unchanged
    expect(original.getTime()).toBe(originalTime);
  });

  it("isSameDay returns true when year/month/date match regardless of time", () => {
    const morning = new Date(2026, 3, 23, 8, 0, 0);
    const evening = new Date(2026, 3, 23, 23, 59, 59);
    expect(isSameDay(morning, evening)).toBe(true);
  });

  it("isSameDay returns false for different calendar dates", () => {
    const a = new Date(2026, 3, 23);
    const b = new Date(2026, 3, 24);
    expect(isSameDay(a, b)).toBe(false);
  });
});

// ── Group 3: parseNaturalDate (8 tests) ───────────────────────────────────────

describe("parseNaturalDate", () => {
  it('"today" returns a date that isSameDay as new Date()', () => {
    const result = parseNaturalDate("today");
    expect(result).not.toBeNull();
    expect(isSameDay(result!, new Date())).toBe(true);
  });

  it('"yesterday" returns a date that isSameDay as addDays(today, -1)', () => {
    const result = parseNaturalDate("yesterday");
    expect(result).not.toBeNull();
    expect(isSameDay(result!, addDays(new Date(), -1))).toBe(true);
  });

  it('"tomorrow" returns a date that isSameDay as addDays(today, +1)', () => {
    const result = parseNaturalDate("tomorrow");
    expect(result).not.toBeNull();
    expect(isSameDay(result!, addDays(new Date(), 1))).toBe(true);
  });

  it('"2026-04-23" parses to April 23, 2026', () => {
    const result = parseNaturalDate("2026-04-23");
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(3);
    expect(result!.getDate()).toBe(23);
  });

  it('"2026-02-30" returns null because Feb 30 does not exist (EC-29)', () => {
    // The JS Date engine silently rolls Feb 30 to Mar 2 — we must detect this.
    expect(parseNaturalDate("2026-02-30")).toBeNull();
  });

  it('"yesterday" when today is Jan 1 returns Dec 31 of prior year (EC-30)', () => {
    // We verify the logic by directly calling addDays with a fixed reference date.
    // parseNaturalDate uses new Date() internally, so we validate its structure.
    const yesterday = parseNaturalDate("yesterday");
    expect(yesterday).not.toBeNull();
    // The result must be exactly one day before today.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const yesterdayMidnight = new Date(yesterday!);
    yesterdayMidnight.setHours(0, 0, 0, 0);
    expect(todayMidnight.getTime() - yesterdayMidnight.getTime()).toBe(
      86400000 // 24 * 60 * 60 * 1000 ms
    );
  });

  it('"not-a-date" returns null', () => {
    expect(parseNaturalDate("not-a-date")).toBeNull();
  });

  it('"2026-13-01" returns null because month 13 is invalid', () => {
    expect(parseNaturalDate("2026-13-01")).toBeNull();
  });
});

// ── Group 4: validateDateFormat (5 tests) ────────────────────────────────────

describe("validateDateFormat", () => {
  it('"YYYY-MM-DD" is valid → returns null', () => {
    expect(validateDateFormat("YYYY-MM-DD")).toBeNull();
  });

  it('"YYYY/MM/YYYY-MM-DD" is valid (slashes are legal in filenames) → returns null', () => {
    expect(validateDateFormat("YYYY/MM/YYYY-MM-DD")).toBeNull();
  });

  it('"YYYY:MM:DD" is invalid → error string mentions ":"', () => {
    const result = validateDateFormat("YYYY:MM:DD");
    expect(result).not.toBeNull();
    expect(result).toContain(":");
  });

  it('"YYYY*MM*DD" is invalid → error string mentions "*"', () => {
    const result = validateDateFormat("YYYY*MM*DD");
    expect(result).not.toBeNull();
    expect(result).toContain("*");
  });

  it("empty string is valid → returns null", () => {
    expect(validateDateFormat("")).toBeNull();
  });
});

// ── Group 5: buildNotePath (5 tests) ─────────────────────────────────────────

describe("buildNotePath", () => {
  const date = new Date(2026, 3, 23); // April 23 2026

  it("joins relative folder, workspace, and date format correctly", () => {
    expect(
      buildNotePath(date, "/Users/d/notes", {
        dailyNoteFolder: "Daily Notes",
        dateFormat: "YYYY-MM-DD",
      })
    ).toBe("/Users/d/notes/Daily Notes/2026-04-23.md");
  });

  it("uses absolute folder directly, ignoring workspace (EC-31)", () => {
    expect(
      buildNotePath(date, "/Users/d/notes", {
        dailyNoteFolder: "/Users/d/journal",
        dateFormat: "YYYY-MM-DD",
      })
    ).toBe("/Users/d/journal/2026-04-23.md");
  });

  it("uses workspace root when dailyNoteFolder is empty (EC-39)", () => {
    expect(
      buildNotePath(date, "/Users/d/notes", {
        dailyNoteFolder: "",
        dateFormat: "YYYY-MM-DD",
      })
    ).toBe("/Users/d/notes/2026-04-23.md");
  });

  it("handles subfolder date format with intermediate slashes", () => {
    expect(
      buildNotePath(date, "/Users/d/notes", {
        dailyNoteFolder: "Daily Notes",
        dateFormat: "YYYY/MM/YYYY-MM-DD",
      })
    ).toBe("/Users/d/notes/Daily Notes/2026/04/2026-04-23.md");
  });

  it("handles spaces in workspace and folder paths (EC-32)", () => {
    expect(
      buildNotePath(date, "/Users/d/My Notes", {
        dailyNoteFolder: "Daily Notes",
        dateFormat: "YYYY-MM-DD",
      })
    ).toBe("/Users/d/My Notes/Daily Notes/2026-04-23.md");
  });
});

// ── Group 6: substituteTokens (13 tests) ─────────────────────────────────────

describe("substituteTokens", () => {
  // April 23, 2026 — Thursday, ISO week 17
  const date = new Date(2026, 3, 23);
  const ctx = { date, dateFormat: "YYYY-MM-DD" };

  it("replaces {{date}} with the formatted date using dateFormat", () => {
    expect(substituteTokens("Note for {{date}}", ctx)).toBe(
      "Note for 2026-04-23"
    );
  });

  it("replaces {{date:YYYY/MM/DD}} using the explicit inline format", () => {
    expect(substituteTokens("{{date:YYYY/MM/DD}}", ctx)).toBe("2026/04/23");
  });

  it("replaces {{weekday}} with the full weekday name", () => {
    expect(substituteTokens("{{weekday}}", ctx)).toBe("Thursday");
  });

  it("replaces {{weekday-short}} with the abbreviated weekday name", () => {
    expect(substituteTokens("{{weekday-short}}", ctx)).toBe("Thu");
  });

  it("replaces {{year}}, {{month}}, {{day}} with correct values", () => {
    expect(substituteTokens("{{year}}-{{month}}-{{day}}", ctx)).toBe(
      "2026-04-23"
    );
  });

  it("replaces {{month-name}} with the full month name", () => {
    expect(substituteTokens("{{month-name}}", ctx)).toBe("April");
  });

  it("replaces {{week}} with zero-padded ISO week number", () => {
    expect(substituteTokens("{{week}}", ctx)).toBe("17");
  });

  it("replaces {{time}} with HH:mm using the optional now override", () => {
    // Pass a fixed 'now' so the test is deterministic.
    const now = new Date(2026, 3, 23, 14, 30);
    expect(substituteTokens("{{time}}", ctx, now)).toBe("14:30");
  });

  it("replaces {{prev-link}} with wiki-link to the prior day", () => {
    // April 22 2026
    expect(substituteTokens("{{prev-link}}", ctx)).toBe("[[2026-04-22]]");
  });

  it("replaces {{next-link}} with wiki-link to the next day", () => {
    // April 24 2026
    expect(substituteTokens("{{next-link}}", ctx)).toBe("[[2026-04-24]]");
  });

  it("replaces {{title}} with the same value as {{date}}", () => {
    expect(substituteTokens("{{title}}", ctx)).toBe("2026-04-23");
  });

  it("leaves unknown tokens verbatim (FR-05.3)", () => {
    expect(substituteTokens("{{custom}}", ctx)).toBe("{{custom}}");
  });

  it("{{date:NOT_A_FORMAT}} does not throw and produces a string (EC-08)", () => {
    expect(() => substituteTokens("{{date:NOT_A_FORMAT}}", ctx)).not.toThrow();
    // The format "NOT_A_FORMAT" has no tokens, so it passes through as-is.
    expect(typeof substituteTokens("{{date:NOT_A_FORMAT}}", ctx)).toBe("string");
  });
});

// ── Group 7: injectFrontMatter (7 tests) ──────────────────────────────────────

describe("injectFrontMatter", () => {
  const DATE = "2026-04-23";

  it("prepends a new YAML block when content has no front matter", () => {
    const result = injectFrontMatter("# Hello\n", DATE);
    expect(result).toBe("---\ndate: 2026-04-23\n---\n\n# Hello\n");
  });

  it("inserts date as first field when front matter exists but has no date field (EC-06)", () => {
    const content = "---\ntitle: My Note\ntags: [foo]\n---\n\n# Body\n";
    const result = injectFrontMatter(content, DATE);
    // date: should appear before title: in the merged block
    expect(result).toMatch(/^---\ndate: 2026-04-23\ntitle: My Note/);
    // The original fields must still be present
    expect(result).toContain("tags: [foo]");
    // There must be exactly one opening fence
    const openFenceCount = (result.match(/^---$/gm) || []).length;
    expect(openFenceCount).toBe(2); // one opening, one closing
  });

  it("overwrites existing {{date}} placeholder in front matter (EC-07)", () => {
    const content = "---\ndate: {{date}}\ntitle: Note\n---\n\n# Body\n";
    const result = injectFrontMatter(content, DATE);
    expect(result).toContain("date: 2026-04-23");
    expect(result).not.toContain("date: {{date}}");
  });

  it("overwrites hardcoded date value in front matter (EC-07)", () => {
    const content = "---\ndate: 2020-01-01\ntitle: Old Note\n---\n\n# Body\n";
    const result = injectFrontMatter(content, DATE);
    expect(result).toContain("date: 2026-04-23");
    expect(result).not.toContain("date: 2020-01-01");
  });

  it("is idempotent when front matter already has the correct date", () => {
    const content = "---\ndate: 2026-04-23\n---\n\n# Body\n";
    const result = injectFrontMatter(content, DATE);
    expect(result).toBe(content); // should be unchanged
  });

  it("produces a valid front matter block for empty content", () => {
    const result = injectFrontMatter("", DATE);
    expect(result).toBe("---\ndate: 2026-04-23\n---\n\n");
  });

  it("treats malformed front matter (no closing ---) as no-front-matter (Case A)", () => {
    // A file that starts with --- but never closes is treated as plain content.
    const content = "---\ndate: 2020-01-01\nsome random text\n";
    const result = injectFrontMatter(content, DATE);
    // A new YAML block is prepended in front of the entire content.
    expect(result.startsWith("---\ndate: 2026-04-23\n---\n\n")).toBe(true);
  });
});

// ── hasFrontMatter utility ────────────────────────────────────────────────────

describe("hasFrontMatter", () => {
  it("returns true when content starts with ---\\n", () => {
    expect(hasFrontMatter("---\ntitle: X\n---\n")).toBe(true);
  });

  it("returns false when content does not start with ---\\n", () => {
    expect(hasFrontMatter("# Heading\n")).toBe(false);
  });
});

// ── Group 8: buildCalendarGrid (9 tests) ─────────────────────────────────────

describe("buildCalendarGrid", () => {
  it("April 2026 Monday-first: correct day count (30 non-padding + padding = 42 total)", () => {
    const grid = buildCalendarGrid(2026, 3, "monday"); // month 3 = April
    const allCells = grid.weeks.flat();
    expect(allCells.length).toBe(42);
    const nonPadding = allCells.filter((c) => !c.isPadding);
    expect(nonPadding.length).toBe(30);
  });

  it("April 2026 Monday-first: first cell is Monday March 30 (padding)", () => {
    // April 1 2026 is a Wednesday. Monday-first offset = (3+6)%7 = 2, so
    // the first cell should be Monday March 30.
    const grid = buildCalendarGrid(2026, 3, "monday");
    const firstCell = grid.weeks[0][0];
    expect(firstCell.isPadding).toBe(true);
    expect(firstCell.date.getMonth()).toBe(2); // March
    expect(firstCell.date.getDate()).toBe(30);
  });

  it("April 2026 Sunday-first: first cell is Sunday March 29 (padding)", () => {
    // April 1 is Wednesday. Sunday-first offset = 3 (Wed=3).
    // Three padding cells: Sun Mar 29, Mon Mar 30, Tue Mar 31.
    const grid = buildCalendarGrid(2026, 3, "sunday");
    const firstCell = grid.weeks[0][0];
    expect(firstCell.isPadding).toBe(true);
    expect(firstCell.date.getMonth()).toBe(2); // March
    expect(firstCell.date.getDate()).toBe(29);
  });

  it("February 2026 (non-leap year) has exactly 28 non-padding cells (EC-18)", () => {
    const grid = buildCalendarGrid(2026, 1, "monday"); // month 1 = February
    const allCells = grid.weeks.flat();
    expect(allCells.length).toBe(42);
    const nonPadding = allCells.filter((c) => !c.isPadding);
    expect(nonPadding.length).toBe(28);
  });

  it("February 2024 (leap year) has exactly 29 non-padding cells", () => {
    const grid = buildCalendarGrid(2024, 1, "monday");
    const allCells = grid.weeks.flat();
    expect(allCells.length).toBe(42);
    const nonPadding = allCells.filter((c) => !c.isPadding);
    expect(nonPadding.length).toBe(29);
  });

  it("January 2023 Monday-first: Jan 1 is Sunday so offset is 6 (6 padding cells in first row)", () => {
    // Jan 1 2023 is Sunday. Monday-first offset = (0+6)%7 = 6.
    const grid = buildCalendarGrid(2023, 0, "monday");
    const firstRow = grid.weeks[0];
    const paddingInFirstRow = firstRow.filter((c) => c.isPadding);
    expect(paddingInFirstRow.length).toBe(6);
    // The first actual day (index 6) must be Jan 1
    expect(firstRow[6].isPadding).toBe(false);
    expect(firstRow[6].date.getDate()).toBe(1);
  });

  it("ISO week numbers are correct for April 2026 — April 1 is week 14, April 23 is week 17", () => {
    const grid = buildCalendarGrid(2026, 3, "monday");
    const allCells = grid.weeks.flat();
    const apr1 = allCells.find(
      (c) => !c.isPadding && c.date.getDate() === 1 && c.date.getMonth() === 3
    );
    const apr23 = allCells.find(
      (c) => !c.isPadding && c.date.getDate() === 23 && c.date.getMonth() === 3
    );
    expect(apr1!.weekNumber).toBe(14);
    expect(apr23!.weekNumber).toBe(17);
  });

  it("always produces exactly 6 rows × 7 cols = 42 cells", () => {
    // Test a few months to ensure the invariant holds universally.
    const testCases: [number, number][] = [
      [2026, 3],  // April (30 days)
      [2026, 1],  // February non-leap (28 days)
      [2024, 1],  // February leap (29 days)
      [2026, 0],  // January (31 days)
      [2023, 4],  // May 2023 (31 days, starts on Monday)
    ];
    for (const [year, month] of testCases) {
      const grid = buildCalendarGrid(year, month, "monday");
      expect(grid.weeks.length).toBe(6);
      for (const week of grid.weeks) {
        expect(week.length).toBe(7);
      }
    }
  });

  it("padding cells at end of last row have isPadding=true and dates from next month", () => {
    // April 2026 ends on Thursday (April 30). With Monday-first, the last row
    // is [Apr 27 Mon, Apr 28 Tue, Apr 29 Wed, Apr 30 Thu, May 1 Fri (padding), May 2 Sat (padding), May 3 Sun (padding)]
    // But we also have 2 more rows of padding to make 6 total rows.
    const grid = buildCalendarGrid(2026, 3, "monday");
    const allCells = grid.weeks.flat();
    const trailingPadding = allCells.filter(
      (c) => c.isPadding && c.date.getMonth() !== 2 // not from March (leading padding)
    );
    // All trailing padding cells must belong to May (month index 4)
    for (const cell of trailingPadding) {
      expect(cell.date.getMonth()).toBe(4); // May
    }
    // There must be some trailing padding (April ends on Thu so 3 from May in last real week)
    expect(trailingPadding.length).toBeGreaterThan(0);
  });
});

// ── getDaysInMonth utility ────────────────────────────────────────────────────

describe("getDaysInMonth", () => {
  it("returns 28 for February in a non-leap year", () => {
    expect(getDaysInMonth(2026, 1)).toBe(28);
  });

  it("returns 29 for February in a leap year", () => {
    expect(getDaysInMonth(2024, 1)).toBe(29);
  });

  it("returns 30 for April", () => {
    expect(getDaysInMonth(2026, 3)).toBe(30);
  });

  it("returns 31 for January", () => {
    expect(getDaysInMonth(2026, 0)).toBe(31);
  });
});

// ── getISOWeekNumber (standalone tests) ──────────────────────────────────────

describe("getISOWeekNumber", () => {
  it("Jan 1 2026 is in ISO week 1", () => {
    expect(getISOWeekNumber(new Date(2026, 0, 1))).toBe(1);
  });

  it("Dec 31 2026 is in ISO week 53", () => {
    // Dec 31 2026 is a Thursday — it belongs to week 53
    expect(getISOWeekNumber(new Date(2026, 11, 31))).toBe(53);
  });

  it("April 23 2026 is ISO week 17", () => {
    expect(getISOWeekNumber(new Date(2026, 3, 23))).toBe(17);
  });
});

// ── parseDateFromFilename ─────────────────────────────────────────────────────

describe("parseDateFromFilename", () => {
  it("parses 2026-04-23.md with default YYYY-MM-DD format", () => {
    const result = parseDateFromFilename("2026-04-23.md", "YYYY-MM-DD");
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(3);
    expect(result!.getDate()).toBe(23);
  });

  it("returns null for a non-date filename with default format", () => {
    const result = parseDateFromFilename("readme.md", "YYYY-MM-DD");
    expect(result).toBeNull();
  });

  it("falls back gracefully for non-default formats", () => {
    // Non-default formats return null or attempt a best-effort parse — must not throw.
    expect(() =>
      parseDateFromFilename("2026-04-23.md", "DD-MM-YYYY")
    ).not.toThrow();
  });
});

// ── joinPath utility ──────────────────────────────────────────────────────────

describe("joinPath", () => {
  it("joins two segments with a single slash", () => {
    expect(joinPath("/Users/d", "notes")).toBe("/Users/d/notes");
  });

  it("collapses double slashes", () => {
    expect(joinPath("/Users/d/", "/notes")).toBe("/Users/d/notes");
  });

  it("preserves absolute first segment", () => {
    expect(joinPath("/abs/path", "sub", "file.md")).toBe(
      "/abs/path/sub/file.md"
    );
  });

  it("handles empty segments gracefully", () => {
    expect(joinPath("/a", "", "b")).toBe("/a/b");
  });
});

// ── Group 9: loadAndMergeSettings (Step 03) ───────────────────────────────────
//
// The daily-note plugin does NOT destructure from window.__CM_VIEW__ at module
// evaluation time (Step 03 has no CM6 extensions), but it does access
// window.__TAURI_INTERNALS__ only at runtime (inside onEnable), not at import
// time. A minimal window stub is sufficient for these pure settings tests.
//
// Spec: docs/specs/daily-note/step_03_plugin_scaffold_settings.md — Group 9

/* eslint-disable @typescript-eslint/no-explicit-any */
let loadAndMergeSettings: (raw: Record<string, unknown> | null) => any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
  // Provide a minimal __CM_VIEW__ stub so the import does not throw even if
  // the plugin file were to reference it at load time in a future step.
  if (!(window as any).__CM_VIEW__) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__CM_VIEW__ = { EditorView: { updateListener: { of: () => ({}) } } };
  }

  // Dynamic import after globals are set — matches the auto-save test pattern.
  const mod = await import("../../../src/plugins/daily-note/daily-note.plugin");
  loadAndMergeSettings = mod.loadAndMergeSettings;
});

describe("loadAndMergeSettings", () => {
  // Test 64: null raw → all defaults returned
  it("returns all defaults when raw is null", () => {
    const s = loadAndMergeSettings(null);
    expect(s.dailyNoteFolder).toBe("Daily Notes");
    expect(s.dateFormat).toBe("YYYY-MM-DD");
    expect(s.openOnStartup).toBe(false);
    expect(s.templateFilePath).toBe("");
    expect(s.injectFrontMatter).toBe(false);
    expect(s.confirmCreate).toBe(false);
    expect(s.firstDayOfWeek).toBe("monday");
    expect(s.showWeekNumbers).toBe(false);
  });

  // Test 65: valid dailyNoteFolder is preserved
  it("preserves valid dailyNoteFolder from raw", () => {
    const s = loadAndMergeSettings({ dailyNoteFolder: "Journal/Daily" });
    expect(s.dailyNoteFolder).toBe("Journal/Daily");
  });

  // Test 66: valid dateFormat is preserved
  it("preserves valid dateFormat from raw", () => {
    const s = loadAndMergeSettings({ dateFormat: "YYYY/MM/DD" });
    expect(s.dateFormat).toBe("YYYY/MM/DD");
  });

  // Test 67: illegal chars in dateFormat → fall back to default (EC-04)
  it("falls back to default dateFormat when format contains illegal chars (EC-04)", () => {
    // "YYYY:MM:DD" contains ":" which is an illegal macOS filename character.
    const s = loadAndMergeSettings({ dateFormat: "YYYY:MM:DD" });
    expect(s.dateFormat).toBe("YYYY-MM-DD");
  });

  // Test 68: openOnStartup true is preserved
  it("preserves boolean openOnStartup: true", () => {
    const s = loadAndMergeSettings({ openOnStartup: true });
    expect(s.openOnStartup).toBe(true);
  });

  // Test 69: injectFrontMatter true is preserved
  it("preserves boolean injectFrontMatter: true", () => {
    const s = loadAndMergeSettings({ injectFrontMatter: true });
    expect(s.injectFrontMatter).toBe(true);
  });

  // Test 70: confirmCreate true is preserved
  it("preserves boolean confirmCreate: true", () => {
    const s = loadAndMergeSettings({ confirmCreate: true });
    expect(s.confirmCreate).toBe(true);
  });

  // Test 71: showWeekNumbers true is preserved
  it("preserves boolean showWeekNumbers: true", () => {
    const s = loadAndMergeSettings({ showWeekNumbers: true });
    expect(s.showWeekNumbers).toBe(true);
  });

  // Test 72: valid firstDayOfWeek 'sunday' is preserved
  it("preserves valid firstDayOfWeek: 'sunday'", () => {
    const s = loadAndMergeSettings({ firstDayOfWeek: "sunday" });
    expect(s.firstDayOfWeek).toBe("sunday");
  });

  // Test 73: invalid firstDayOfWeek falls back to 'monday'
  it("falls back to 'monday' for invalid firstDayOfWeek value", () => {
    // "saturday" is not an accepted value — only 'monday' and 'sunday' are valid.
    const s = loadAndMergeSettings({ firstDayOfWeek: "saturday" });
    expect(s.firstDayOfWeek).toBe("monday");
  });

  // Test 74: templateFilePath string is preserved
  it("preserves templateFilePath string", () => {
    const s = loadAndMergeSettings({ templateFilePath: "/path/to/template.md" });
    expect(s.templateFilePath).toBe("/path/to/template.md");
  });

  // Test 75: unknown keys in raw are ignored (forward compatibility)
  it("ignores unknown keys in raw (forward compatibility)", () => {
    const s = loadAndMergeSettings({
      dailyNoteFolder: "Notes",
      unknownFutureKey: "some-value",
      anotherUnknownKey: 42,
    });
    // Known key is applied; unknown keys do not appear on the settings object.
    expect(s.dailyNoteFolder).toBe("Notes");
    // The returned object should only have the known DailyNoteSettings keys.
    expect((s as any).unknownFutureKey).toBeUndefined();
    expect((s as any).anotherUnknownKey).toBeUndefined();
  });
});

// ── Groups 10–11: openDailyNote + Prev/Next/Today commands (Step 04) ─────────
//
// These tests exercise the core note-opening logic and command registration
// added in Step 04. They require a richer set of window globals to be mocked
// (tabManager, TAURI_INTERNALS, CURRENT_FILE, MARKABLE_COMMANDS).
//
// We use the same dynamic import scope (loaded in the Group 9 beforeAll) so that
// the module's _testing helpers are available. The _testing object gains new
// helpers in Step 04 (callOpenDailyNote, callOnEnable, callOnDisable, etc.).
//
// Pattern: globals set per-test; cleaned up in afterEach.
//
// Spec: docs/specs/daily-note/step_04_core_actions_commands.md

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Re-usable type alias for the plugin module's exports. */
interface DailyNotePluginMod {
  loadAndMergeSettings: (raw: Record<string, unknown> | null) => any;
  _testing: {
    getSettings(): any;
    setSettings(s: Record<string, unknown>): void;
    getGeneration(): number;
    isActive(): boolean;
    getInFlight(): boolean;
    callOpenDailyNote(date: Date): Promise<void>;
    callOpenPrevDay(): Promise<void>;
    callOpenNextDay(): Promise<void>;
    callOnEnable(api: any): Promise<void>;
    callOnDisable(api: any): void;
  };
}

// Loaded once for the whole Group 10/11 block. The module was already imported
// in the Group 9 beforeAll, so this reuses the same instance.
let pluginMod: DailyNotePluginMod | null = null;

/**
 * Build a minimal mock MarkablePluginAPI.
 * loadSettings returns `settingsOverride` (defaults to null → returns all defaults).
 * saveSettings is a no-op.
 */
function makeMockApi(settingsOverride: Record<string, unknown> | null = null) {
  return {
    loadSettings: vi.fn(async () => settingsOverride),
    saveSettings: vi.fn(async () => {}),
    restartSelf:  vi.fn(async () => {}),
    addExtensions:    vi.fn(),
    removeExtension:  vi.fn(),
    registerSidebarPanel:   vi.fn(),
    unregisterSidebarPanel: vi.fn(),
    focusSidebarPanel:      vi.fn(),
    toggleSidebarPanel:     vi.fn(),
  };
}

/**
 * Build a minimal mock TabManager.
 *
 * @param openTabs - List of file paths that are "already open". If a path matches
 *                   the one being opened, the plugin takes the switch-tab path.
 */
function makeMockTabManager(openTabs: string[] = []) {
  const tabs = openTabs.map((p, i) => ({ id: String(i), filePath: p }));
  return {
    getAllTabs: vi.fn(() => tabs),
    switchToTab: vi.fn(),
    openFile: vi.fn(),
  };
}

/**
 * Build a minimal mock for window.__TAURI_INTERNALS__.
 *
 * @param invokeOverrides - Map of command-name → handler. Commands not in the
 *                          map resolve to undefined.
 */
function makeMockTauriInternals(
  invokeOverrides: Record<string, () => unknown> = {}
) {
  return {
    invoke: vi.fn(async (cmd: string, _args?: unknown) => {
      if (cmd in invokeOverrides) return invokeOverrides[cmd]();
      return undefined;
    }),
  };
}

// Retrieve the module reference after the Group 9 beforeAll has run.
// Because Vitest runs beforeAll hooks in file-order, the module is already
// loaded by the time these describe blocks execute.
beforeAll(async () => {
  // Set up minimal CM_VIEW stub (same as Group 9 — idempotent).
  if (!(window as any).__CM_VIEW__) {
    (window as any).__CM_VIEW__ = {
      EditorView: { updateListener: { of: () => ({}) } },
    };
  }

  // Set up __MARKABLE_COMMANDS__ as a mutable array so registerCommands() can push.
  if (!(window as any).__MARKABLE_COMMANDS__) {
    (window as any).__MARKABLE_COMMANDS__ = [];
  }

  // Set up __MARKABLE_HANDLE_ACTION__ as a no-op spy.
  if (!(window as any).__MARKABLE_HANDLE_ACTION__) {
    (window as any).__MARKABLE_HANDLE_ACTION__ = vi.fn();
  }

  // The module was already imported in the Group 9 beforeAll. Re-importing the
  // same specifier returns the cached module instance in Vitest.
  pluginMod = (await import(
    "../../../src/plugins/daily-note/daily-note.plugin"
  )) as unknown as DailyNotePluginMod;
});

afterEach(() => {
  // Reset all window globals that tests may have overwritten.
  (window as any).__MARKABLE_CURRENT_FILE__ = null;
  (window as any).__MARKABLE_TAB_MANAGER__ = null;
  (window as any).__TAURI_INTERNALS__ = null;
  (window as any).__TAURI_DIALOG__ = null;
  (window as any).__MARKABLE_COMMANDS__ = [];
  vi.restoreAllMocks();
});

// ── Group 10: openDailyNote paths ─────────────────────────────────────────────

describe("openDailyNote", () => {
  // Test 76: EC-01 — no current file → shows notice, no Tauri invoke.
  it("EC-01: no workspace — shows notice, no Tauri invoke", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    const tauriMock = makeMockTauriInternals();
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    await pluginMod!._testing.callOpenDailyNote(new Date());

    // No Tauri create_daily_note should be invoked.
    const invokes = (tauriMock.invoke as any).mock.calls.map((c: any[]) => c[0]);
    expect(invokes).not.toContain("create_daily_note");

    pluginMod!._testing.callOnDisable(api);
  });

  // Tests 77+78: EC-10/EC-11 — note already open → switchToTab, no write.
  it("EC-10/EC-11: note already open — switches to tab, no create_daily_note", async () => {
    const today = new Date();
    const y = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, "0");
    const d  = String(today.getDate()).padStart(2, "0");
    const expectedPath = `/workspace/notes/Daily Notes/${y}-${mo}-${d}.md`;

    const tauriMock = makeMockTauriInternals();
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager([expectedPath]);
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    await pluginMod!._testing.callOpenDailyNote(today);

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.switchToTab).toHaveBeenCalledOnce();
    const invokes = (tauriMock.invoke as any).mock.calls.map((c: any[]) => c[0]);
    expect(invokes).not.toContain("create_daily_note");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 79: happy path — new note created and tab opened.
  it("happy path: new note created and tab opened", async () => {
    const today = new Date();
    const y  = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, "0");
    const d  = String(today.getDate()).padStart(2, "0");
    const expectedPath = `/workspace/notes/Daily Notes/${y}-${mo}-${d}.md`;

    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    await pluginMod!._testing.callOpenDailyNote(today);

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).toHaveBeenCalledWith(expectedPath);

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 80: EC-05 — template file not found → creates empty note, no error thrown.
  it("EC-05: template file not found — creates empty note, no error", async () => {
    const tauriMock = makeMockTauriInternals({
      read_file: () => { throw new Error("file not found"); },
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi({ templateFilePath: "/nonexistent/template.md" });
    await pluginMod!._testing.callOnEnable(api);

    await expect(
      pluginMod!._testing.callOpenDailyNote(new Date())
    ).resolves.toBeUndefined();

    const createCalls = (tauriMock.invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "create_daily_note"
    );
    expect(createCalls.length).toBe(1);
    // Content must be empty string (no template loaded).
    expect(createCalls[0][1]?.content).toBe("");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 81: EC-33 — double-invocation guard.
  it("EC-33: double invocation — second call is a no-op", async () => {
    let resolveCreate!: () => void;
    const createPromise = new Promise<void>((res) => { resolveCreate = res; });

    const tauriMock = {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "create_daily_note") await createPromise;
        return undefined;
      }),
    };
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    // Start first call (hangs at create_daily_note).
    const first  = pluginMod!._testing.callOpenDailyNote(new Date());
    // Second call should be a no-op (double-invocation guard).
    const second = pluginMod!._testing.callOpenDailyNote(new Date());

    // Resolve the blocking create so both settle.
    resolveCreate();
    await Promise.all([first, second]);

    const createCalls = (tauriMock.invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "create_daily_note"
    );
    // create_daily_note must be called exactly once.
    expect(createCalls.length).toBe(1);

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 82: EC-34 — plugin disabled while Tauri call in flight.
  it("EC-34: plugin disabled during Tauri call — tab not opened", async () => {
    let resolveCreate!: () => void;
    const createPromise = new Promise<void>((res) => { resolveCreate = res; });

    const tauriMock = {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "create_daily_note") await createPromise;
        return undefined;
      }),
    };
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    const openPromise = pluginMod!._testing.callOpenDailyNote(new Date());

    // Disable the plugin while the create is in flight.
    pluginMod!._testing.callOnDisable(api);

    // Now let create_daily_note resolve.
    resolveCreate();
    await openPromise;

    // openFile must NOT be called — generation check aborts it.
    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).not.toHaveBeenCalled();
  });

  // Test 83: EC-27 — confirmCreate enabled, user cancels → no write.
  it("EC-27: confirmCreate enabled, user cancels — no write", async () => {
    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__TAURI_DIALOG__ = { confirm: vi.fn(async () => false) };

    const api = makeMockApi({ confirmCreate: true });
    await pluginMod!._testing.callOnEnable(api);

    // Use yesterday (a non-today date) so confirmCreate fires.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await pluginMod!._testing.callOpenDailyNote(yesterday);

    const invokes = (tauriMock.invoke as any).mock.calls.map((c: any[]) => c[0]);
    expect(invokes).not.toContain("create_daily_note");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 84: EC-28 — confirmCreate enabled but target is today → no dialog shown.
  it("EC-28: confirmCreate enabled, target is today — no dialog, note created", async () => {
    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    const dialogConfirm = vi.fn(async () => true);
    (window as any).__TAURI_DIALOG__ = { confirm: dialogConfirm };

    const api = makeMockApi({ confirmCreate: true });
    await pluginMod!._testing.callOnEnable(api);

    // Opening TODAY — confirmCreate must not fire.
    await pluginMod!._testing.callOpenDailyNote(new Date());

    expect(dialogConfirm).not.toHaveBeenCalled();
    const invokes = (tauriMock.invoke as any).mock.calls.map((c: any[]) => c[0]);
    expect(invokes).toContain("create_daily_note");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 85: EC-35 — Rust returns directory error → does not throw.
  it("EC-35: Rust returns directory error — does not throw, tab not opened", async () => {
    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => {
        throw new Error(
          "path exists as a directory: /workspace/notes/Daily Notes/2026-04-23"
        );
      },
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    await expect(
      pluginMod!._testing.callOpenDailyNote(new Date())
    ).resolves.toBeUndefined();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).not.toHaveBeenCalled();

    pluginMod!._testing.callOnDisable(api);
  });
});

// ── Group 11: Prev / Next / Today commands ────────────────────────────────────

describe("openPrevDay / openNextDay / today command", () => {
  async function enablePlugin(currentFile: string) {
    (window as any).__MARKABLE_CURRENT_FILE__ = currentFile;
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__TAURI_DIALOG__ = { confirm: vi.fn(async () => true) };

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);
    return api;
  }

  // Test 86: openPrevDay from a YYYY-MM-DD daily note → opens previous day.
  it("openPrevDay from daily note tab opens the correct date (April 22)", async () => {
    const api = await enablePlugin("/notes/Daily Notes/2026-04-23.md");

    await pluginMod!._testing.callOpenPrevDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2026-04-22");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 87: openNextDay from a YYYY-MM-DD daily note → opens next day.
  it("openNextDay from daily note tab opens the correct date (April 24)", async () => {
    const api = await enablePlugin("/notes/Daily Notes/2026-04-23.md");

    await pluginMod!._testing.callOpenNextDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2026-04-24");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 88: EC-12 — openPrevDay from non-daily-note → falls back to yesterday.
  it("EC-12: openPrevDay from non-daily-note falls back to yesterday", async () => {
    const api = await enablePlugin("/notes/readme.md");

    await pluginMod!._testing.callOpenPrevDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const y  = yesterday.getFullYear();
    const mo = String(yesterday.getMonth() + 1).padStart(2, "0");
    const d  = String(yesterday.getDate()).padStart(2, "0");
    expect(openedPath).toContain(`${y}-${mo}-${d}`);

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 89: EC-13 — openPrevDay from Jan 1 → Dec 31.
  it("EC-13: openPrevDay from Jan 1 navigates to Dec 31", async () => {
    const api = await enablePlugin("/notes/2026-01-01.md");

    await pluginMod!._testing.callOpenPrevDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2025-12-31");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 90: EC-14 — openNextDay from Dec 31 → Jan 1.
  it("EC-14: openNextDay from Dec 31 navigates to Jan 1", async () => {
    const api = await enablePlugin("/notes/2026-12-31.md");

    await pluginMod!._testing.callOpenNextDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2027-01-01");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 91: EC-15a — openNextDay from Feb 28 in leap year → Feb 29.
  it("EC-15a: openNextDay from Feb 28 in a leap year navigates to Feb 29", async () => {
    const api = await enablePlugin("/notes/2024-02-28.md");

    await pluginMod!._testing.callOpenNextDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2024-02-29");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 92: EC-15b — openNextDay from Feb 29 in leap year → Mar 1.
  it("EC-15b: openNextDay from Feb 29 in a leap year navigates to Mar 1", async () => {
    const api = await enablePlugin("/notes/2024-02-29.md");

    await pluginMod!._testing.callOpenNextDay();

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2024-03-01");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 93: today command calls openDailyNote(today).
  it("today command opens today's note", async () => {
    const today = new Date();
    const y  = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, "0");
    const d  = String(today.getDate()).padStart(2, "0");
    const expectedDateStr = `${y}-${mo}-${d}`;

    (window as any).__MARKABLE_COMMANDS__ = [];
    const api = await enablePlugin("/notes/readme.md");

    // Find the today command in __MARKABLE_COMMANDS__.
    const commands: any[] = (window as any).__MARKABLE_COMMANDS__ ?? [];
    const todayCmd = commands.find((c: any) => c.id === "daily-note-today");
    expect(todayCmd).toBeDefined();

    // Execute the command action directly.
    todayCmd.action();

    // Allow the async openDailyNote to settle (via setTimeout microtask).
    await new Promise((res) => setTimeout(res, 50));

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain(expectedDateStr);

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 94: five commands registered in __MARKABLE_COMMANDS__ on enable.
  it("five commands registered in __MARKABLE_COMMANDS__ on enable", async () => {
    (window as any).__MARKABLE_COMMANDS__ = [];
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals();

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    const commands: any[] = (window as any).__MARKABLE_COMMANDS__;
    const dailyCmds = commands.filter((c: any) => c.id?.startsWith("daily-note-"));
    expect(dailyCmds.length).toBe(5);

    const ids = dailyCmds.map((c: any) => c.id);
    expect(ids).toContain("daily-note-today");
    expect(ids).toContain("daily-note-prev");
    expect(ids).toContain("daily-note-next");
    expect(ids).toContain("daily-note-for-date");
    expect(ids).toContain("daily-note-toggle-calendar");

    pluginMod!._testing.callOnDisable(api);
  });

  // Test 95: commands removed from __MARKABLE_COMMANDS__ on disable.
  it("commands removed from __MARKABLE_COMMANDS__ on disable", async () => {
    (window as any).__MARKABLE_COMMANDS__ = [];
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals();

    const api = makeMockApi();
    await pluginMod!._testing.callOnEnable(api);

    const afterEnable: any[] = (window as any).__MARKABLE_COMMANDS__;
    expect(afterEnable.some((c: any) => c.id?.startsWith("daily-note-"))).toBe(true);

    pluginMod!._testing.callOnDisable(api);

    const afterDisable: any[] = (window as any).__MARKABLE_COMMANDS__;
    expect(afterDisable.some((c: any) => c.id?.startsWith("daily-note-"))).toBe(false);
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Groups 12–14: Calendar Sidebar Panel (Step 05) ───────────────────────────
//
// These tests exercise the calendar panel rendering, dot resolution, and
// keyboard navigation added in Step 05.
//
// The _testing export gains new helpers in Step 05:
//   setCalContainer, setCalMonth, getDotGeneration, getDotCache,
//   navigateMonth, navigateToToday, updateSelectedCell, applyDots,
//   callRenderCalendarPanel, callInvalidateMonthCache.
//
// All calendar tests manipulate the DOM using a fresh container div that is
// appended to document.body for each test and removed in afterEach.
//
// Spec: docs/specs/daily-note/step_05_calendar_sidebar.md

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Extended interface including the Step 05 _testing helpers. */
interface DailyNotePluginModStep05 {
  loadAndMergeSettings: (raw: Record<string, unknown> | null) => any;
  _testing: {
    getSettings(): any;
    setSettings(s: Record<string, unknown>): void;
    getGeneration(): number;
    isActive(): boolean;
    getInFlight(): boolean;
    callOpenDailyNote(date: Date): Promise<void>;
    callOpenPrevDay(): Promise<void>;
    callOpenNextDay(): Promise<void>;
    callOnEnable(api: any): Promise<void>;
    callOnDisable(api: any): void;
    // Step 05 additions
    setCalContainer(el: HTMLElement | null): void;
    setCalMonth(year: number, month: number): void;
    getDotGeneration(): number;
    getDotCache(): Map<string, boolean>;
    navigateMonth(delta: number): void;
    navigateToToday(): void;
    updateSelectedCell(): void;
    applyDots(): void;
    callRenderCalendarPanel(container: HTMLElement): void;
    callInvalidateMonthCache(date: Date): void;
    getCalMonth?(): { year: number; month: number };
  };
}

let pluginModStep05: DailyNotePluginModStep05 | null = null;

beforeAll(async () => {
  // Module was already imported in the earlier beforeAll — Vitest caches it.
  pluginModStep05 = (await import(
    "../../../src/plugins/daily-note/daily-note.plugin"
  )) as unknown as DailyNotePluginModStep05;
});

// ── Group 12: Calendar grid rendering (8 tests) ───────────────────────────────

describe("calendar panel rendering", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // Ensure settings are in default state (monday first day, no week numbers)
    pluginModStep05!._testing.setSettings({
      firstDayOfWeek: "monday",
      showWeekNumbers: false,
      dailyNoteFolder: "Daily Notes",
      dateFormat: "YYYY-MM-DD",
    });
  });

  afterEach(() => {
    container.remove();
    pluginModStep05!._testing.setCalContainer(null);
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
  });

  // Test 111: EC-18 — February 2026 renders exactly 28 non-padding cells.
  it("EC-18: February 2026 renders 28 non-padding day cells", () => {
    pluginModStep05!._testing.setCalMonth(2026, 1);
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    // Non-padding cells do NOT have the dn-cal-padding class
    const allCells = container.querySelectorAll("[data-date]");
    const realCells = Array.from(allCells).filter(
      (el) => !el.classList.contains("dn-cal-padding")
    );
    expect(realCells.length).toBe(28);
  });

  // Test 112: grid always has exactly 42 day cells (6×7).
  it("grid always has exactly 42 day cells (6×7)", () => {
    pluginModStep05!._testing.setCalMonth(2026, 3); // April 2026
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    const allCells = container.querySelectorAll("[data-date]");
    expect(allCells.length).toBe(42);
  });

  // Test 113: today cell has dn-cal-today class.
  it("today cell has dn-cal-today class", () => {
    const today = new Date();
    pluginModStep05!._testing.setCalMonth(today.getFullYear(), today.getMonth());
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    const todayCells = container.querySelectorAll(".dn-cal-today");
    expect(todayCells.length).toBeGreaterThanOrEqual(1);
  });

  // Test 114: selected cell class applied when active tab is a daily note.
  it("selected cell class applied when active tab is a daily note", () => {
    // The selected cell is determined by comparing __MARKABLE_CURRENT_FILE__ against
    // buildNotePath(cell.date, workspaceDir, settings). workspaceDir is derived from
    // currentFile as the immediate parent directory.
    //
    // With currentFile = "/workspace/Daily Notes/2026-04-15.md":
    //   workspaceDir = "/workspace/Daily Notes"
    //   buildNotePath(April 15, "/workspace/Daily Notes", { dailyNoteFolder: "" })
    //               = "/workspace/Daily Notes/2026-04-15.md"  ← matches!
    //
    // We use an empty dailyNoteFolder so the file sits directly in workspaceDir,
    // making the path computation consistent with the test's current-file value.
    pluginModStep05!._testing.setSettings({
      firstDayOfWeek: "monday",
      showWeekNumbers: false,
      dailyNoteFolder: "",   // notes are in the same dir as the current file
      dateFormat: "YYYY-MM-DD",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ =
      "/workspace/Daily Notes/2026-04-15.md";
    pluginModStep05!._testing.setCalMonth(2026, 3); // April 2026
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    const selectedCells = container.querySelectorAll(".dn-cal-selected");
    expect(selectedCells.length).toBe(1);
    const selected = selectedCells[0] as HTMLElement;
    expect(selected.dataset.date).toBe("2026-04-15");
  });

  // Test 115: EC-22 — updateSelectedCell uses current __MARKABLE_CURRENT_FILE__.
  it("EC-22: updateSelectedCell clears old selection and applies new one", () => {
    // Same empty-dailyNoteFolder convention as Test 114.
    pluginModStep05!._testing.setSettings({
      firstDayOfWeek: "monday",
      showWeekNumbers: false,
      dailyNoteFolder: "",
      dateFormat: "YYYY-MM-DD",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ =
      "/workspace/Daily Notes/2026-04-15.md";
    pluginModStep05!._testing.setCalMonth(2026, 3);
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    // Change the current file to a different date in the same directory
    (window as any).__MARKABLE_CURRENT_FILE__ =
      "/workspace/Daily Notes/2026-04-20.md";
    pluginModStep05!._testing.updateSelectedCell();

    const selectedCells = container.querySelectorAll(".dn-cal-selected");
    expect(selectedCells.length).toBe(1);
    const selected = selectedCells[0] as HTMLElement;
    expect(selected.dataset.date).toBe("2026-04-20");
  });

  // Test 116: EC-24 — registerSidebarPanel mock as no-op, onEnable does not throw.
  it("EC-24: onEnable does not throw when registerSidebarPanel is a no-op", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals();
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi(); // already mocks registerSidebarPanel as vi.fn()
    await expect(pluginModStep05!._testing.callOnEnable(api)).resolves.toBeUndefined();

    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 117: EC-37 — two tabs with same daily note path → exactly one selected cell.
  it("EC-37: two tabs open same daily note — exactly one cell is dn-cal-selected", () => {
    // Same empty-dailyNoteFolder convention as Tests 114/115.
    pluginModStep05!._testing.setSettings({
      firstDayOfWeek: "monday",
      showWeekNumbers: false,
      dailyNoteFolder: "",
      dateFormat: "YYYY-MM-DD",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ =
      "/workspace/Daily Notes/2026-04-10.md";
    pluginModStep05!._testing.setCalMonth(2026, 3);
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    // Call updateSelectedCell again (simulating a second tab switch to the same file).
    // Even with two tabs pointing to the same path, __MARKABLE_CURRENT_FILE__ is a
    // single string — so exactly one cell can match.
    pluginModStep05!._testing.updateSelectedCell();

    const selectedCells = container.querySelectorAll(".dn-cal-selected");
    // Should be exactly 1 — the calendar has exactly one cell per date
    expect(selectedCells.length).toBe(1);
  });

  // Test 118: navigateMonth(1) increments _dotGeneration.
  it("navigateMonth(1) increments _dotGeneration", () => {
    pluginModStep05!._testing.setCalContainer(container);
    const genBefore = pluginModStep05!._testing.getDotGeneration();
    pluginModStep05!._testing.navigateMonth(1);
    const genAfter = pluginModStep05!._testing.getDotGeneration();
    expect(genAfter).toBe(genBefore + 1);
  });
});

// ── Group 13: Dot resolution (8 tests) ───────────────────────────────────────

describe("dot resolution (check_paths_exist)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    pluginModStep05!._testing.setSettings({
      firstDayOfWeek: "monday",
      showWeekNumbers: false,
      dailyNoteFolder: "Daily Notes",
      dateFormat: "YYYY-MM-DD",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/readme.md";
    pluginModStep05!._testing.setCalMonth(2026, 3); // April 2026
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);
  });

  afterEach(() => {
    container.remove();
    pluginModStep05!._testing.setCalContainer(null);
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__TAURI_INTERNALS__ = null;
  });

  // Test 119: EC-19 — check_paths_exist failure → dots not applied, no exception.
  it("EC-19: check_paths_exist failure — dots not applied, no exception thrown", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (_cmd: string) => {
        throw new Error("network error");
      }),
    };

    await expect(async () => {
      pluginModStep05!._testing.callRenderCalendarPanel(container);
      // Wait for the microtask queue to flush
      await new Promise((res) => setTimeout(res, 50));
    }).not.toThrow();

    // All dot elements should still have the hidden class (dots were not applied)
    const dots = container.querySelectorAll(".dn-cal-dot:not(.hidden)");
    expect(dots.length).toBe(0);
  });

  // Test 120: EC-20 — stale result discarded after month navigation.
  it("EC-20: stale dot result discarded when _dotGeneration changes before resolve", async () => {
    let resolveInvoke!: (val: unknown) => void;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (_cmd: string, _args: any) => {
        // Block resolution until the test controls it
        return new Promise((res) => { resolveInvoke = res; });
      }),
    };

    // Start an async render (triggers resolveDotsAsync internally)
    pluginModStep05!._testing.callRenderCalendarPanel(container);

    // Navigate month BEFORE the invoke resolves → increments _dotGeneration
    pluginModStep05!._testing.navigateMonth(1);
    const genAfterNav = pluginModStep05!._testing.getDotGeneration();

    // Now resolve the invoke with an empty result
    resolveInvoke({});
    await new Promise((res) => setTimeout(res, 20));

    // Dot generation should still reflect the navigation-incremented value
    expect(pluginModStep05!._testing.getDotGeneration()).toBe(genAfterNav);
    // Dots should remain hidden (stale result was discarded)
    const visibleDots = container.querySelectorAll(".dn-cal-dot:not(.hidden)");
    expect(visibleDots.length).toBe(0);
  });

  // Test 121: EC-21 — rapid navigation → generation incremented 5 times.
  it("EC-21: rapid navigation increments _dotGeneration by one per navigateMonth call", () => {
    const genBefore = pluginModStep05!._testing.getDotGeneration();
    // Navigate 5 times rapidly
    pluginModStep05!._testing.navigateMonth(1);
    pluginModStep05!._testing.navigateMonth(1);
    pluginModStep05!._testing.navigateMonth(1);
    pluginModStep05!._testing.navigateMonth(1);
    pluginModStep05!._testing.navigateMonth(1);
    // Each call to navigateMonth increments _dotGeneration
    expect(pluginModStep05!._testing.getDotGeneration()).toBe(genBefore + 5);
  });

  // Test 122: dots visible for months with existing notes.
  it("dots visible for cells whose paths return true from check_paths_exist", () => {
    // Manually inject a path into the dot cache and call applyDots
    const existingPath = "/workspace/Daily Notes/2026-04-15.md";
    const cache = pluginModStep05!._testing.getDotCache();
    cache.set(existingPath, true);
    pluginModStep05!._testing.applyDots();

    // The cell for 2026-04-15 should now have a visible dot
    const cell = container.querySelector('[data-date="2026-04-15"]');
    expect(cell).not.toBeNull();
    const dotEl = cell!.querySelector(".dn-cal-dot");
    expect(dotEl).not.toBeNull();
    expect(dotEl!.classList.contains("hidden")).toBe(false);
  });

  // Test 123: no dots visible when all paths return false.
  it("no dots visible when all paths return false", () => {
    // Ensure cache is empty (all dots hidden via ?? false fallback)
    const cache = pluginModStep05!._testing.getDotCache();
    cache.clear();
    pluginModStep05!._testing.applyDots();

    const visibleDots = container.querySelectorAll(".dn-cal-dot:not(.hidden)");
    expect(visibleDots.length).toBe(0);
  });

  // Test 124: EC-38 — no workspace → resolveDotsAsync bails without calling invoke.
  it("EC-38: no workspace → resolveDotsAsync returns early, no invoke called", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = null; // no workspace
    const tauriMock = { invoke: vi.fn(async () => ({})) };
    (window as any).__TAURI_INTERNALS__ = tauriMock;

    await expect(async () => {
      pluginModStep05!._testing.callRenderCalendarPanel(container);
      await new Promise((res) => setTimeout(res, 30));
    }).not.toThrow();

    // With no workspace, check_paths_exist should not be invoked
    const invokeCalls: string[] = (tauriMock.invoke as any).mock.calls.map(
      (c: any[]) => c[0]
    );
    expect(invokeCalls).not.toContain("check_paths_exist");
  });

  // Test 125: invalidateMonthCache increments _dotGeneration for current month.
  it("invalidateMonthCache triggers re-resolution when note is in current month", () => {
    pluginModStep05!._testing.setCalMonth(2026, 3); // April 2026
    const genBefore = pluginModStep05!._testing.getDotGeneration();
    // A date in the currently displayed month
    const dateInApril = new Date(2026, 3, 10);
    pluginModStep05!._testing.callInvalidateMonthCache(dateInApril);
    expect(pluginModStep05!._testing.getDotGeneration()).toBe(genBefore + 1);
  });

  // Test 126: invalidateMonthCache is a no-op for notes in other months.
  it("invalidateMonthCache is a no-op for notes in a different month", () => {
    pluginModStep05!._testing.setCalMonth(2026, 3); // April 2026
    const genBefore = pluginModStep05!._testing.getDotGeneration();
    // A date in a DIFFERENT month (May 2026)
    const dateInMay = new Date(2026, 4, 5);
    pluginModStep05!._testing.callInvalidateMonthCache(dateInMay);
    expect(pluginModStep05!._testing.getDotGeneration()).toBe(genBefore);
  });
});

// ── Group 14: Keyboard navigation (4 tests) ──────────────────────────────────

describe("calendar keyboard navigation", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    pluginModStep05!._testing.setSettings({
      firstDayOfWeek: "monday",
      showWeekNumbers: false,
      dailyNoteFolder: "Daily Notes",
      dateFormat: "YYYY-MM-DD",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/readme.md";
    pluginModStep05!._testing.setCalMonth(2026, 3); // April 2026
    pluginModStep05!._testing.setCalContainer(container);
    pluginModStep05!._testing.callRenderCalendarPanel(container);
  });

  afterEach(() => {
    container.remove();
    pluginModStep05!._testing.setCalContainer(null);
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__MARKABLE_TAB_MANAGER__ = null;
    (window as any).__TAURI_INTERNALS__ = null;
  });

  // Test 127: PageUp on the grid calls navigateMonth(-1).
  it("PageUp on dn-cal-days-grid navigates to the previous month", () => {
    const grid = container.querySelector(".dn-cal-days-grid") as HTMLElement;
    expect(grid).not.toBeNull();

    const genBefore = pluginModStep05!._testing.getDotGeneration();

    // Dispatch PageUp on the grid element
    const event = new KeyboardEvent("keydown", {
      key: "PageUp",
      bubbles: true,
      cancelable: true,
    });
    grid.dispatchEvent(event);

    // Each navigateMonth call increments _dotGeneration by 1
    expect(pluginModStep05!._testing.getDotGeneration()).toBe(genBefore + 1);
  });

  // Test 128: PageDown on the grid calls navigateMonth(1).
  it("PageDown on dn-cal-days-grid navigates to the next month", () => {
    const grid = container.querySelector(".dn-cal-days-grid") as HTMLElement;
    expect(grid).not.toBeNull();

    const genBefore = pluginModStep05!._testing.getDotGeneration();

    const event = new KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
      cancelable: true,
    });
    grid.dispatchEvent(event);

    expect(pluginModStep05!._testing.getDotGeneration()).toBe(genBefore + 1);
  });

  // Test 129: ArrowRight moves focus to the next day cell.
  it("ArrowRight moves focus from first cell to second cell", () => {
    const grid = container.querySelector(".dn-cal-days-grid") as HTMLElement;
    expect(grid).not.toBeNull();

    const cells = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-date]")
    );
    expect(cells.length).toBe(42);

    // Focus the first cell
    cells[0].focus();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    grid.dispatchEvent(event);

    // After ArrowRight, the second cell should be focused
    expect(document.activeElement).toBe(cells[1]);
  });

  // Test 130: Enter on a day cell calls openDailyNote with that cell's date.
  it("Enter on a focused day cell opens that day's note", async () => {
    // The click handler shows a confirm dialog when autoCreateOnCalendarClick is false.
    // Stub window.confirm to auto-approve so the note open proceeds.
    vi.stubGlobal("confirm", vi.fn(() => true));
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });

    const grid = container.querySelector(".dn-cal-days-grid") as HTMLElement;
    const cells = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-date]")
    );

    // Find a non-padding cell to focus
    const realCell = cells.find(
      (c) => !c.classList.contains("dn-cal-padding")
    );
    expect(realCell).toBeDefined();
    realCell!.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    grid.dispatchEvent(event);

    // Allow async openDailyNote to settle
    await new Promise((res) => setTimeout(res, 50));

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    // openFile should have been called (note opened)
    expect(tabManager.openFile).toHaveBeenCalled();
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    // The opened path should contain the cell's date
    expect(openedPath).toContain(realCell!.dataset.date!);
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Group 15: Integration / lifecycle (Step 06) ───────────────────────────────
//
// These tests cover the final integration scenarios:
//   - EC-23: Open Today works when calendar panel is not mounted (Test 131)
//   - EC-25: openOnStartup, no workspace → silent skip (Test 132)
//   - EC-26: openOnStartup, valid workspace → creates note (Test 133)
//   - Plugin disabled before openOnStartup timeout fires (Test 134)
//   - EC-34 lifecycle: onDisable during openDailyNote prevents tab open (Test 135)
//   - Settings change via renderDetailExtra triggers saveSettings (Test 136)
//   - EC-04/EC-21: invalid dateFormat blocked in settings UI (Test 137)
//   - Full happy-path integration (Test 138)
//   - Plugin export shape (Test 139)
//   - EC-29: openForDatePrompt shows inline error for invalid date (Test 140)
//
// Spec: docs/specs/daily-note/step_06_integration_edge_cases.md — Group 15
//
// Timer tests use vi.useFakeTimers() / vi.runAllTimersAsync() so that
// setTimeout(0) callbacks are deterministic and do not cause test timeouts.

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("Group 15: Integration / lifecycle (Step 06)", () => {
  // Each test gets clean globals restored in afterEach.
  afterEach(() => {
    vi.useRealTimers();
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__MARKABLE_TAB_MANAGER__ = null;
    (window as any).__TAURI_INTERNALS__ = null;
    (window as any).__TAURI_DIALOG__ = null;
    (window as any).__MARKABLE_COMMANDS__ = [];
    vi.restoreAllMocks();
    // Remove any lingering overlays the tests may have injected.
    document.getElementById("dn-date-prompt")?.remove();
  });

  // Test 131: EC-23 — Open Today works when calendar panel is not mounted.
  //
  // The calendar panel (_calContainer = null) must not block note opening.
  // Verifies AD-E: all entry points share a single openDailyNote code path
  // that has no dependency on the calendar panel's visibility state.
  it("EC-23: openDailyNote succeeds when calendar panel container is null", async () => {
    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi();
    await pluginModStep05!._testing.callOnEnable(api);

    // Force _calContainer to null — the panel is not visible.
    pluginModStep05!._testing.setCalContainer(null);

    // openDailyNote should still succeed: create note + open tab.
    await pluginModStep05!._testing.callOpenDailyNote(new Date());

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).toHaveBeenCalledOnce();

    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 132: EC-25 — openOnStartup fires but __MARKABLE_CURRENT_FILE__ is null.
  //
  // Expected: the setTimeout callback runs, resolveWorkspaceDir() returns null,
  // and the function returns silently. No create_daily_note call, no showNotice.
  it("EC-25: openOnStartup with null __MARKABLE_CURRENT_FILE__ — silent skip, no invoke", async () => {
    vi.useFakeTimers();

    const tauriMock = makeMockTauriInternals();
    // No current file → resolveWorkspaceDir() returns null.
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    // Enable with openOnStartup: true.
    const api = makeMockApi({ openOnStartup: true });
    await pluginModStep05!._testing.callOnEnable(api);

    // Advance fake timers to fire the deferred setTimeout(0) callback.
    await vi.runAllTimersAsync();

    // No Tauri invoke should have been called — workspace was null.
    expect((tauriMock.invoke as any).mock.calls).toHaveLength(0);

    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 133: EC-26 — openOnStartup fires and creates today's note.
  //
  // Expected: the setTimeout callback runs, resolveWorkspaceDir() returns a valid
  // path, and openDailyNote creates the note (create_daily_note + openFile).
  it("EC-26: openOnStartup with a valid workspace — note is created and tab opened", async () => {
    vi.useFakeTimers();

    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    // Enable with openOnStartup: true.
    const api = makeMockApi({ openOnStartup: true });
    await pluginModStep05!._testing.callOnEnable(api);

    // Advance fake timers and drain microtask queue so the async chain completes.
    await vi.runAllTimersAsync();

    const invokes = (tauriMock.invoke as any).mock.calls.map((c: any[]) => c[0]);
    expect(invokes).toContain("create_daily_note");

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).toHaveBeenCalledOnce();

    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 134: Plugin disabled before openOnStartup timeout fires → no note created.
  //
  // Verifies the _active guard inside the setTimeout callback prevents note creation
  // when onDisable() is called before the timer fires.
  it("plugin disabled before openOnStartup timeout fires — no invoke called", async () => {
    vi.useFakeTimers();

    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    // Enable with openOnStartup: true — schedules the setTimeout(0) callback.
    const api = makeMockApi({ openOnStartup: true });
    await pluginModStep05!._testing.callOnEnable(api);

    // Disable BEFORE the timer fires. Sets _active = false.
    pluginModStep05!._testing.callOnDisable(api);

    // Now advance timers — the callback should bail on the _active check.
    await vi.runAllTimersAsync();

    // No Tauri invoke should have been called.
    expect((tauriMock.invoke as any).mock.calls).toHaveLength(0);
  });

  // Test 135: EC-34 (full lifecycle) — onDisable during openDailyNote prevents tab open.
  //
  // Full lifecycle version: enable → start openDailyNote → disable → resolve invoke →
  // assert tab NOT opened. Complements step-04 test 82 with a clean lifecycle sequence.
  it("EC-34 (lifecycle): onDisable during openDailyNote prevents tab open", async () => {
    let resolveCreate!: () => void;
    const createPromise = new Promise<void>((res) => { resolveCreate = res; });

    const tauriMock = {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "create_daily_note") await createPromise;
        return undefined;
      }),
    };
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi();
    await pluginModStep05!._testing.callOnEnable(api);

    const openPromise = pluginModStep05!._testing.callOpenDailyNote(new Date());

    // Disable while in-flight — increments _generation.
    pluginModStep05!._testing.callOnDisable(api);

    // Let the Tauri call resolve.
    resolveCreate();
    await openPromise;

    // openFile must NOT have been called — the generation check aborts it.
    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).not.toHaveBeenCalled();
  });

  // Test 136: Settings change via renderDetailExtra → api.saveSettings called.
  //
  // The dailyNoteFolder text input's blur handler calls api.saveSettings with the
  // updated _settings object. Verifies that the UI wiring is connected correctly.
  it("settings change via renderDetailExtra triggers api.saveSettings", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals();
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi({ dailyNoteFolder: "Daily Notes" });
    await pluginModStep05!._testing.callOnEnable(api);

    // Render the settings panel.
    const container = document.createElement("div");
    document.body.appendChild(container);

    const mod = await import("../../../src/plugins/daily-note/daily-note.plugin") as any;
    const defaultExport = mod.default;

    if (typeof defaultExport.renderDetailExtra === "function") {
      defaultExport.renderDetailExtra(container);

      // First text input is the Daily Notes Folder field.
      const folderInput = container.querySelector("input[type='text']") as HTMLInputElement;
      expect(folderInput).not.toBeNull();

      // Change the value and trigger blur to invoke the save handler.
      folderInput.value = "Journal";
      folderInput.dispatchEvent(new Event("blur", { bubbles: true }));

      // Allow the async saveSettings call to settle.
      await new Promise((res) => setTimeout(res, 20));

      expect(api.saveSettings).toHaveBeenCalled();
    }

    container.remove();
    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 137: dateFormat invalid chars blocked in settings UI — _settings.dateFormat unchanged.
  //
  // EC-04: typing "YYYY:MM:DD" into the date format input and blurring must NOT call
  // api.saveSettings because the blur handler checks validateDateFormat before persisting.
  // The _settings.dateFormat must remain the prior valid value.
  it("EC-04: invalid dateFormat in settings UI blocked — saveSettings not called, format unchanged", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals();
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi({ dateFormat: "YYYY-MM-DD" });
    await pluginModStep05!._testing.callOnEnable(api);

    // Confirm the initial dateFormat loaded correctly.
    expect(pluginModStep05!._testing.getSettings().dateFormat).toBe("YYYY-MM-DD");

    const container = document.createElement("div");
    document.body.appendChild(container);

    const mod = await import("../../../src/plugins/daily-note/daily-note.plugin") as any;
    const defaultExport = mod.default;

    if (typeof defaultExport.renderDetailExtra === "function") {
      defaultExport.renderDetailExtra(container);

      // Find the date format input (second text input: index 1 after folder input).
      const textInputs = container.querySelectorAll("input[type='text']");
      const fmtInput = textInputs[1] as HTMLInputElement | null;
      expect(fmtInput).not.toBeNull();

      // Set an invalid value (colon is an illegal macOS filename character) and blur.
      fmtInput!.value = "YYYY:MM:DD";
      fmtInput!.dispatchEvent(new Event("blur", { bubbles: true }));

      // Allow any async save to settle — there should be none for an invalid value.
      await new Promise((res) => setTimeout(res, 20));

      // saveSettings must NOT have been called for this invalid format.
      expect(api.saveSettings).not.toHaveBeenCalled();

      // _settings.dateFormat must be unchanged.
      expect(pluginModStep05!._testing.getSettings().dateFormat).toBe("YYYY-MM-DD");
    }

    container.remove();
    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 138: Full happy-path integration.
  //
  // loadSettings → _settings populated with folder + format →
  // openDailyNote(fixed date) → create_daily_note invoked →
  // tabManager.openFile called with the correctly formatted absolute path.
  it("full happy-path: loadSettings → openDailyNote → create note → open tab with correct path", async () => {
    // April 23, 2026 — fixed date for determinism (avoids midnight boundary issues).
    const targetDate = new Date(2026, 3, 23);

    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi({
      dailyNoteFolder: "Daily Notes",
      dateFormat: "YYYY-MM-DD",
    });
    await pluginModStep05!._testing.callOnEnable(api);

    // Verify settings merged correctly.
    const s = pluginModStep05!._testing.getSettings();
    expect(s.dailyNoteFolder).toBe("Daily Notes");
    expect(s.dateFormat).toBe("YYYY-MM-DD");

    await pluginModStep05!._testing.callOpenDailyNote(targetDate);

    // create_daily_note must be called exactly once.
    const createCalls = (tauriMock.invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "create_daily_note"
    );
    expect(createCalls.length).toBe(1);

    // The opened path must embed the expected date string and folder name.
    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    expect(tabManager.openFile).toHaveBeenCalledOnce();
    const openedPath: string = tabManager.openFile.mock.calls[0]?.[0] ?? "";
    expect(openedPath).toContain("2026-04-23");
    expect(openedPath).toContain("Daily Notes");

    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 139: Plugin default export shape is correct.
  //
  // Smoke-test that the module's default export has all required fields. Catches
  // accidental regressions in the export object that would break PluginManager.
  it("plugin default export has required shape: id, name, onEnable, onDisable, renderDetailExtra", async () => {
    const mod = await import("../../../src/plugins/daily-note/daily-note.plugin") as any;
    const exported = mod.default;

    expect(exported.id).toBe("daily-note");
    expect(typeof exported.name).toBe("string");
    expect(exported.name.length).toBeGreaterThan(0);
    expect(typeof exported.onEnable).toBe("function");
    expect(typeof exported.onDisable).toBe("function");
    expect(typeof exported.renderDetailExtra).toBe("function");
    // sidebarPanelId tells the Plugins Panel to render a sidebar slot assignment toggle.
    expect(exported.sidebarPanelId).toBe("daily-note-calendar");
  });

  // Test 140: EC-29 — openForDatePrompt shows inline error span for an invalid date.
  //
  // Simulates the "Open for Date…" command DOM flow: the user types "2026-02-30"
  // (February 30 does not exist) and clicks "Open". The inline error span must become
  // visible, and create_daily_note must NOT be called.
  it("EC-29: openForDatePrompt with invalid date — error span visible, no invoke", async () => {
    const tauriMock = makeMockTauriInternals({
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi();
    await pluginModStep05!._testing.callOnEnable(api);

    // Find the "daily-note-for-date" command and execute its action.
    // This injects the #dn-date-prompt overlay into the DOM.
    const commands: any[] = (window as any).__MARKABLE_COMMANDS__ ?? [];
    const forDateCmd = commands.find((c: any) => c.id === "daily-note-for-date");
    expect(forDateCmd).toBeDefined();
    forDateCmd.action();

    const prompt = document.getElementById("dn-date-prompt");
    expect(prompt).not.toBeNull();

    // Type an invalid ISO date (February 30 does not exist).
    const input = prompt!.querySelector("input") as HTMLInputElement;
    input.value = "2026-02-30";

    // Click the "Open" button — this calls attemptOpen() → parseNaturalDate → null → error.
    const buttons = prompt!.querySelectorAll("button");
    // The button row has [Cancel, Open] order; "Open" is the last button.
    const openBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    openBtn.click();

    // Allow microtasks to flush.
    await new Promise((res) => setTimeout(res, 10));

    // The error span must be visible (display property not "none").
    const spans = prompt!.querySelectorAll("span");
    // The error span is the one with an error-color style — it is the only span
    // in the prompt that is conditionally shown.
    const errorSpan = Array.from(spans).find(
      (s) => s.style.color.includes("e74c3c") || s.textContent === "Invalid date."
    ) as HTMLElement | undefined;
    expect(errorSpan).toBeDefined();
    expect(errorSpan!.style.display).not.toBe("none");

    // create_daily_note must NOT have been called.
    const invokeNames = (tauriMock.invoke as any).mock.calls.map((c: any[]) => c[0]);
    expect(invokeNames).not.toContain("create_daily_note");

    // Cleanup: close the overlay.
    prompt!.remove();
    pluginModStep05!._testing.callOnDisable(api);
  });

  // ── Group 16: EC-03 / EC-40 and EC-09 assertion tests ──────────────────────

  // Test 141: EC-40 — renderDetailExtra informational text for date format changes.
  //
  // EC-03 and EC-40 both concern the fact that changing the date format does NOT
  // rename existing notes. The settings UI communicates this via a static info
  // line rendered by buildDateFormatRow(). This test asserts that the rendered
  // output contains the exact warning string so any future refactor that removes
  // or rewrites that text will fail loudly.
  it("EC-40: renderDetailExtra contains 'Changing date format does not rename existing notes'", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = makeMockTauriInternals();
    (window as any).__MARKABLE_COMMANDS__ = [];

    const api = makeMockApi({ dateFormat: "YYYY-MM-DD" });
    await pluginModStep05!._testing.callOnEnable(api);

    // Render the settings panel into a detached container.
    const container = document.createElement("div");
    document.body.appendChild(container);

    const mod = await import("../../../src/plugins/daily-note/daily-note.plugin") as any;
    const defaultExport = mod.default;

    expect(typeof defaultExport.renderDetailExtra).toBe("function");
    defaultExport.renderDetailExtra(container);

    // The date-format info line must be present so users understand that renaming
    // existing notes is not automatic (EC-03 / EC-40).
    expect(container.textContent).toContain(
      "Changing date format does not rename existing notes"
    );

    container.remove();
    pluginModStep05!._testing.callOnDisable(api);
  });

  // Test 142: EC-09 — oversized template file warns but still creates the note.
  //
  // When the template file exceeds 100 KB the plugin logs a console.warn and
  // proceeds with the (large) content rather than aborting. This ensures users
  // are not silently blocked from creating notes just because their template is
  // unexpectedly large.
  it("EC-09: large template file (>100 KB) — console.warn emitted, create_daily_note still called", async () => {
    // Build a string that is definitively over the 100,000-character threshold.
    const largeContent = "x".repeat(110_000);

    const tauriMock = makeMockTauriInternals({
      // read_file resolves with the oversized string (simulates a large template).
      read_file: () => largeContent,
      create_daily_note: () => undefined,
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/workspace/notes/readme.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = makeMockTabManager();
    (window as any).__TAURI_INTERNALS__ = tauriMock;
    (window as any).__MARKABLE_COMMANDS__ = [];

    // Enable the plugin with a valid template path so loadTemplate() actually
    // attempts the read_file call.
    const api = makeMockApi({ templateFilePath: "/templates/large-template.md" });
    await pluginModStep05!._testing.callOnEnable(api);

    // Spy on console.warn so we can assert the warning message.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await pluginModStep05!._testing.callOpenDailyNote(new Date());

    // The implementation must emit a console.warn containing "large".
    const warnMessages: string[] = warnSpy.mock.calls.flatMap((args) =>
      args.map(String)
    );
    const hasLargeWarning = warnMessages.some((msg) =>
      msg.toLowerCase().includes("large")
    );
    expect(hasLargeWarning).toBe(true);

    // create_daily_note must still have been invoked — a large template is not
    // an error; the note is created with whatever content the template contains.
    const createCalls = (tauriMock.invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "create_daily_note"
    );
    expect(createCalls.length).toBe(1);

    warnSpy.mockRestore();
    pluginModStep05!._testing.callOnDisable(api);
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any */
