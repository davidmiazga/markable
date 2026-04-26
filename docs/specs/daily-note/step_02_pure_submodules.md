---
title: "Step 02 — Pure TypeScript Sub-modules"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Step 02 — Pure TypeScript Sub-modules

## Goal and Scope

Create four pure TypeScript modules that contain all logic that can be tested without a DOM, a Tauri runtime, or CM6. These modules are statically imported by `daily-note.plugin.ts` at build time and tree-shaken into the IIFE bundle by Rollup/Vite.

All functions in this step are `export`ed named functions — no default exports. No side effects at module load time. No `window` access.

---

## Files to Create

| File | Contents |
|---|---|
| `src/plugins/daily-note/date-utils.ts` | Date formatting, path building, natural-language parsing, date arithmetic |
| `src/plugins/daily-note/template-tokens.ts` | Token substitution for template files |
| `src/plugins/daily-note/frontmatter.ts` | YAML front matter inject/merge |
| `src/plugins/daily-note/calendar-grid.ts` | Month grid builder |

---

## Implementation Spec

### `date-utils.ts`

#### Types

```typescript
/** All settings fields relevant to path construction. */
export interface DailyNotePathSettings {
  dailyNoteFolder: string;   // relative or absolute
  dateFormat: string;        // Moment.js-style tokens
}

/** A single calendar day cell. */
export interface CalendarCell {
  date: Date;          // the actual date (local time)
  dayNumber: number;   // 1–31 (or 0 for padding cells)
  isPadding: boolean;  // true for filler cells outside the month
  isoWeek: number;     // ISO week number (for the week-numbers column)
}
```

#### `formatDate(date: Date, format: string): string`

Replace Moment.js tokens in `format` with the corresponding date component. Token set (replace **longest-first** to prevent partial matches):

| Token | Value |
|---|---|
| `YYYY` | 4-digit year, zero-padded |
| `YY` | 2-digit year (last two digits) |
| `MM` | 2-digit month (01–12) |
| `M` | 1–2 digit month (no leading zero) |
| `DD` | 2-digit day of month (01–31) |
| `D` | 1–2 digit day (no leading zero) |
| `dddd` | Full weekday name (Sunday–Saturday) |
| `ddd` | Abbreviated weekday (Sun–Sat) |
| `WW` | ISO week number, zero-padded (01–53) |
| `W` | ISO week number, no padding |
| `HH` | 2-digit hour, 24h (00–23) |
| `mm` | 2-digit minute (00–59) |

Implementation note: build a replacement map sorted by token length descending so that `YYYY` is replaced before `YY`, `dddd` before `ddd`, etc. Use a single pass with a regex alternation of all token strings.

#### `getISOWeekNumber(date: Date): number`

ISO 8601 week number algorithm:
1. Copy the date; set time to midday (to avoid DST edge cases).
2. Set day to the nearest Thursday: `date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 3)`
3. ISO week 1 is the week containing the first Thursday. Calculate as: `Math.round((date - new Date(date.getFullYear(), 0, 4)) / 604800000) + 1`

#### `buildNotePath(date: Date, workspaceDir: string, settings: DailyNotePathSettings): string`

```
Logic:
  1. const formattedDate = formatDate(date, settings.dateFormat)
     // formattedDate may contain '/' for subfolder formats (FR-01.3)
  2. Determine base folder:
     if settings.dailyNoteFolder is absolute (starts with '/'):
       base = settings.dailyNoteFolder
     else if settings.dailyNoteFolder === '':
       base = workspaceDir                    (EC-39)
     else:
       base = joinPath(workspaceDir, settings.dailyNoteFolder)
  3. return joinPath(base, formattedDate) + '.md'
     // joinPath handles the '/' in formattedDate naturally by splitting on '/'
     // and re-joining — no special treatment of subfolder formats needed
```

#### `joinPath(...segments: string[]): string`

Join path segments using `/`, normalising double slashes, respecting absolute paths. Rules:
- Filter empty segments.
- If the first non-empty segment is absolute (starts with `/`), the result is absolute.
- Join with `/`.
- Collapse any `//` to `/`.
- Do not touch trailing slashes on purpose — always strip.

This function must never use string concatenation with `/`; use `segments.filter(Boolean).join('/')` with post-normalisation.

#### `addDays(date: Date, days: number): Date`

Returns a **new** Date object (does not mutate the input). Uses:
```typescript
const result = new Date(date);
result.setDate(result.getDate() + days);
return result;
```
This handles month/year rollovers and leap years correctly via the JS Date engine (EC-13, EC-14, EC-15).

#### `isSameDay(a: Date, b: Date): boolean`

Compare local year, month, and date (not timestamps):
```typescript
return a.getFullYear() === b.getFullYear() &&
       a.getMonth() === b.getMonth() &&
       a.getDate() === b.getDate();
```

#### `parseNaturalDate(input: string): Date | null`

Accepted inputs:
- `"today"` → `new Date()`
- `"yesterday"` → `addDays(new Date(), -1)`
- `"tomorrow"` → `addDays(new Date(), 1)`
- ISO 8601 `YYYY-MM-DD` → `new Date(year, month-1, day)` using integer parsing.
  **Important**: do not use `new Date("2026-02-30")` directly — it may silently roll over.
  Instead, parse the three integers, construct via `new Date(y, m-1, d)`, then verify
  `result.getFullYear() === y && result.getMonth() === m-1 && result.getDate() === d`.
  If verification fails → return null (EC-29).
- Anything else → return null.

#### `validateDateFormat(format: string): string | null`

Returns null if the format is valid, or a human-readable error string if invalid.

Illegal macOS HFS+ filename characters: `: * ? " < > | \`

Check: does `format` contain any of these characters?
If yes → return `"Date format contains illegal filename characters: <chars>"`
If no → return null

(EC-04 — also see FR-08.2)

#### `parseDateFromFilename(filename: string, format: string): Date | null`

Used by prev/next commands to determine the date from the active tab's filename (FR-03.2).

Strategy: because the format string maps tokens to values, we need to reverse-map. This is complex to do generically. Simplification: if `format === 'YYYY-MM-DD'` (the default), use a direct regex parse. For non-default formats, return null and let the caller fall back to today.

Specific implementation:
```typescript
// Only attempt parse for the default format for now
if (format === 'YYYY-MM-DD') {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
  if (!match) return null;
  return parseNaturalDate(`${match[1]}-${match[2]}-${match[3]}`);
}
// For other formats: filename could be 2026/04/2026-04-23.md — extract the last
// path segment (after the last '/') and try YYYY-MM-DD parse as fallback
const base = filename.split('/').pop() ?? filename;
const withoutExt = base.replace(/\.md$/, '');
// Try ISO format on the base name
return parseNaturalDate(withoutExt.substring(0, 10)) ?? null;
```

---

### `template-tokens.ts`

#### Types

```typescript
export interface TokenContext {
  date: Date;
  dateFormat: string;  // for {{date}} and {{date:FORMAT}} substitution
}
```

#### `substituteTokens(content: string, ctx: TokenContext): string`

Process the template content string and replace all `{{...}}` tokens.

Token replacement table (from FR-05.2):

| Pattern | Substitution |
|---|---|
| `{{date}}` | `formatDate(ctx.date, ctx.dateFormat)` |
| `{{date:FORMAT}}` | `formatDate(ctx.date, FORMAT)` where FORMAT is everything after the colon |
| `{{weekday}}` | Full weekday name (Sunday, Monday, …) |
| `{{weekday-short}}` | Abbreviated weekday (Sun, Mon, …) |
| `{{year}}` | 4-digit year |
| `{{month}}` | 2-digit month (01–12) |
| `{{month-name}}` | Full month name (January, …) |
| `{{day}}` | 2-digit day of month (01–31) |
| `{{week}}` | ISO week number, zero-padded (01–53) |
| `{{time}}` | Current local time HH:mm |
| `{{title}}` | `formatDate(ctx.date, ctx.dateFormat)` (same as `{{date}}`) |
| `{{prev-link}}` | `[[` + formatDate(addDays(ctx.date, -1), 'YYYY-MM-DD') + `]]` |
| `{{next-link}}` | `[[` + formatDate(addDays(ctx.date, 1), 'YYYY-MM-DD') + `]]` |

Algorithm:
1. Use a single regex `/\{\{([^}]+)\}\}/g` to find all `{{...}}` occurrences.
2. For each match, extract the token name.
3. Look up in the replacement table above. Use a switch or if/else chain.
4. If the token starts with `date:`, extract the format suffix and call `formatDate`.
5. If the token is unknown → return the original `{{token}}` verbatim (FR-05.3 — no substitution for unknown tokens).
6. Return `content.replace(regex, (match, token) => lookup(token) ?? match)`.

`{{time}}` must be evaluated at the moment `substituteTokens` is called (captures the creation time, not a frozen test time). For testability, accept an optional `now?: Date` parameter that overrides `new Date()` for the time computation. When `now` is not provided, use `new Date()`.

EC-08: `{{date:NOT_A_FORMAT}}` — `formatDate` produces an output string by passing the format through the token table; non-token text is left unchanged. The result may be nonsensical but will not throw.

---

### `frontmatter.ts`

#### `injectFrontMatter(content: string, dateStr: string): string`

`dateStr` is always an ISO 8601 date (YYYY-MM-DD), e.g. `"2026-04-23"`.

Cases:

**Case A: content does not start with `---\n`**
Prepend a new YAML block:
```
---\ndate: {dateStr}\n---\n\n{content}
```

**Case B: content starts with `---\n` (template already has front matter)**
Find the closing `---` fence. Strategy:
1. After the first `---\n`, find the index of the next `\n---` (the closing fence marker).
2. If no closing fence is found → treat as Case A (malformed YAML block).
3. Extract the YAML body (between opening and closing fences).
4. Check if the YAML body contains a line starting with `date:` (using a regex `/^date:/m`).
   - If YES → replace that line with `date: {dateStr}`. (EC-07)
   - If NO → insert `date: {dateStr}\n` as the first line inside the block. (EC-06 merge)
5. Reassemble: `---\n{modified YAML body}\n---\n{rest of content after closing fence}`.

This function is pure: it never reads from disk or window globals.

#### `hasFrontMatter(content: string): boolean`

Returns `true` if the content starts with `---\n`. Utility used by the plugin to decide whether `injectFrontMatter` needs to run.

---

### `calendar-grid.ts`

#### Types

```typescript
export type FirstDayOfWeek = 'monday' | 'sunday';

export interface CalendarCell {
  date: Date;
  dayNumber: number;
  isPadding: boolean;
  weekNumber: number;   // ISO week number (for the week numbers column)
}

export interface CalendarMonth {
  year: number;
  month: number;        // 0-indexed (JS convention: 0 = January)
  weeks: CalendarCell[][];  // Array of week rows; each row is 7 cells
}
```

#### `buildCalendarGrid(year: number, month: number, firstDay: FirstDayOfWeek): CalendarMonth`

`month` is 0-indexed (0 = January, 11 = December), consistent with `new Date()`.

Algorithm:
1. Determine the first day of the month: `new Date(year, month, 1)`.
2. Determine the last day: `new Date(year, month + 1, 0)` (day 0 of the next month).
3. Determine the start weekday offset:
   - If `firstDay === 'monday'`: offset = `(firstOfMonth.getDay() + 6) % 7` (Mon=0, …, Sun=6)
   - If `firstDay === 'sunday'`: offset = `firstOfMonth.getDay()` (Sun=0, …, Sat=6)
4. Pad the start of the first row with `offset` cells from the previous month.
   - For each padding cell: use the actual date (go back from the 1st), set `isPadding: true`.
5. Fill in the actual days of the month, `isPadding: false`.
6. Pad the end of the last row with cells from the next month until the row is 7 cells.
7. If the total number of cells does not fill a 6-row grid (42 cells), add more padding cells.
   - Always produce exactly 6 rows × 7 cols = 42 cells for consistency (no layout shift).
8. Chunk the flat array of 42 cells into 6 arrays of 7.
9. Compute `weekNumber` for each cell using `getISOWeekNumber(cell.date)`.
10. Return `{ year, month, weeks }`.

EC-18: February in a non-leap year has 28 days. The algorithm must produce exactly 28 non-padding cells and 14 padding cells (42 - 28 = 14). Verify in tests.

#### `getDaysInMonth(year: number, month: number): number`

`new Date(year, month + 1, 0).getDate()` — returns 28, 29, 30, or 31.

---

## Test Cases (in `tests/plugins/daily-note/daily-note.test.ts`)

All tests use static imports of the pure sub-modules. No `beforeAll` dynamic-import trick is needed because these modules have no `window` globals at load time.

### Group 1: `formatDate` (8 tests)

1. **formats YYYY-MM-DD correctly** — `formatDate(new Date(2026, 3, 23), 'YYYY-MM-DD')` → `'2026-04-23'`
2. **formats with subfolder tokens** — `formatDate(new Date(2026, 3, 23), 'YYYY/MM/YYYY-MM-DD')` → `'2026/04/2026-04-23'`
3. **formats dddd (full weekday)** — April 23 2026 is a Thursday → `'Thursday'`
4. **formats ddd (abbreviated weekday)** — → `'Thu'`
5. **formats WW (ISO week)** — April 23 2026 is ISO week 17 → `'17'` (zero-padded: `'17'`)
6. **YY produces 2-digit year** — 2026 → `'26'`
7. **M and D produce non-padded values** — March 5 → M=`'3'`, D=`'5'`
8. **HH:mm format** — `formatDate(new Date(2026, 3, 23, 9, 5), 'HH:mm')` → `'09:05'`

### Group 2: `addDays` / date arithmetic (8 tests)

9. **addDays(Jan 1, -1) → Dec 31 of prior year** (EC-13)
10. **addDays(Dec 31, +1) → Jan 1 of next year** (EC-14)
11. **addDays(Feb 28 leap year, +1) → Feb 29** (EC-15a)
12. **addDays(Feb 29 leap year, +1) → Mar 1** (EC-15b)
13. **addDays(Feb 28 non-leap year, +1) → Mar 1**
14. **addDays does not mutate the input date**
15. **isSameDay returns true for same date, different times**
16. **isSameDay returns false for different dates**

### Group 3: `parseNaturalDate` (8 tests)

17. **"today" returns today's date** (same day)
18. **"yesterday" returns yesterday**
19. **"tomorrow" returns tomorrow**
20. **"2026-04-23" parses correctly**
21. **"2026-02-30" returns null** (EC-29 — invalid date)
22. **"yesterday" when today is Jan 1 returns Dec 31 prior year** (EC-30)
23. **"not-a-date" returns null**
24. **"2026-13-01" returns null** (month 13 is invalid)

### Group 4: `validateDateFormat` (5 tests)

25. **"YYYY-MM-DD" → null (valid)**
26. **"YYYY/MM/YYYY-MM-DD" → null (valid — slash is ok)**
27. **"YYYY:MM:DD" → error string mentioning ":"** (EC-04)
28. **"YYYY*MM*DD" → error string mentioning "*"**
29. **empty string → null (valid — empty is treated as plain filename)**

### Group 5: `buildNotePath` (5 tests)

30. **relative folder + default format** — workspace `/Users/d/notes`, folder `"Daily Notes"`, date 2026-04-23 → `/Users/d/notes/Daily Notes/2026-04-23.md`
31. **absolute folder** — folder `/Users/d/journal`, date 2026-04-23 → `/Users/d/journal/2026-04-23.md` (EC-31)
32. **empty folder string** — folder `""`, workspace `/Users/d/notes` → `/Users/d/notes/2026-04-23.md` (EC-39)
33. **subfolder format** — format `YYYY/MM/YYYY-MM-DD`, workspace `/Users/d/notes`, folder `"Daily Notes"` → `/Users/d/notes/Daily Notes/2026/04/2026-04-23.md`
34. **path with spaces** — workspace `/Users/d/My Notes`, folder `"Daily Notes"` → `/Users/d/My Notes/Daily Notes/2026-04-23.md` (EC-32)

### Group 6: `substituteTokens` (10 tests)

35. **`{{date}}` substituted with formatted date**
36. **`{{date:YYYY/MM/DD}}` uses explicit format**
37. **`{{weekday}}` produces full name**
38. **`{{weekday-short}}` produces abbreviated name**
39. **`{{year}}`, `{{month}}`, `{{day}}` produce correct values**
40. **`{{month-name}}` produces "April" for month 4**
41. **`{{week}}` produces ISO week number**
42. **`{{time}}` produces HH:mm format** — use optional `now` override for determinism
43. **`{{prev-link}}` produces `[[2026-04-22]]` for April 23**
44. **`{{next-link}}` produces `[[2026-04-24]]` for April 23**
45. **`{{title}}` produces same as `{{date}}`**
46. **unknown token `{{custom}}` is left verbatim** (FR-05.3)
47. **`{{date:NOT_A_FORMAT}}` does not throw** (EC-08)

### Group 7: `injectFrontMatter` (7 tests)

48. **content with no front matter → prepends `---\ndate: ...\n---\n\n`**
49. **content with front matter, no `date:` → inserts `date:` as first field** (EC-06)
50. **content with front matter containing `date: {{date}}` → overwrites with correct date** (EC-07)
51. **content with front matter containing hardcoded `date: 2020-01-01` → overwrites** (EC-07)
52. **content with front matter already having correct date → overwrites (idempotent)**
53. **empty content → produces `---\ndate: ...\n---\n\n`**
54. **content with malformed front matter (no closing `---`) → treated as Case A (prepend)**

### Group 8: `buildCalendarGrid` (9 tests)

55. **April 2026, Monday-first: correct day count** — 30 days, correct total cells = 42
56. **April 2026, Monday-first: first cell is Monday March 30 (padding)**
57. **April 2026, Sunday-first: first cell is correct**
58. **February 2026 (non-leap), 28 days** — exactly 28 non-padding cells (EC-18)
59. **February 2024 (leap), 29 days** — exactly 29 non-padding cells
60. **January 2023, Monday-first: starts on Sunday, offset = 6**
61. **ISO week numbers are correct for April 2026** — April 1 is week 14; April 23 is week 17
62. **always produces exactly 6 rows × 7 cols = 42 cells total**
63. **padding cells at end have isPadding = true and correct dates from next month**

Total: 63 tests in this step.

---

## Definition of Done

- [ ] All four `.ts` files exist under `src/plugins/daily-note/`.
- [ ] All functions are exported as named exports.
- [ ] No `window`, `document`, or Tauri `invoke` references in any of the four files.
- [ ] `npm test` (Vitest) passes with all 63 tests green.
- [ ] `formatDate` uses a longest-first token replacement to avoid partial substitution bugs.
- [ ] `buildCalendarGrid` always returns exactly 6 rows of 7 cells.
- [ ] `injectFrontMatter` never produces a document with two `---` opening fences.
- [ ] `parseNaturalDate` returns null for `2026-02-30` (validated against the Date rollover bug).
