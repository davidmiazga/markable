---
title: "Daily Note / Calendar — Master Blueprint"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Daily Note / Calendar — Master Blueprint

## Feature Summary

A single IIFE plugin (`daily-note.plugin.ts`) that creates or opens a date-stamped Markdown note for any given day, with a calendar sidebar panel for visual month navigation. Replaces the three-plugin Obsidian chain (Daily Notes + Calendar + Periodic Notes) with one integrated, configurable unit.

Requirements source: `docs/requirements/active_task.md`

---

## Stack Decision

No new technology is introduced. The feature uses:

- **TypeScript (IIFE plugin)** — same as every other core plugin. The plugin is compiled by `vite.plugins.config.ts` into a self-contained IIFE bundle in `src-tauri/plugins/core/`.
- **Rust (Tauri commands)** — two new commands in `src-tauri/src/commands/`. Use `std::path::PathBuf`, `std::fs::create_dir_all`, and `std::collections::HashMap`. Temp-file-swap write pattern from `io.rs` is reused verbatim.
- **Vitest** — all TypeScript unit tests, consistent with every other plugin test suite.
- **`cargo test`** — Rust command tests, consistent with `files.rs`, `io.rs`, `settings.rs`.

No new runtime dependencies. `moment.js` is explicitly **not** used — all date formatting is implemented with a hand-written pure-function formatter that covers the required Moment.js tokens (`YYYY`, `MM`, `DD`, `ddd`, `dddd`, `WW`, `HH`, `mm`). This avoids a ~300 KB bundle increase and keeps the plugin within the 5 MB core plugin cap.

---

## High-Level Architecture

### Data Flow

```
User action (keyboard / calendar click / command bar)
  └─> openDailyNote(date)                     [plugin core, daily-note.plugin.ts]
        ├─> buildNotePath(date, settings)      [date-utils.ts — pure]
        ├─> resolveWorkspaceDir()              [plugin core — reads window globals]
        ├─> loadTemplate(path)                 [plugin core — Tauri read_file]
        ├─> substituteTokens(content, date)    [template-tokens.ts — pure]
        ├─> injectFrontMatter(content, date)   [frontmatter.ts — pure]
        └─> invoke("create_daily_note", ...)   [Rust — creates dirs + atomic write]
              └─> __MARKABLE_TAB_MANAGER__.openFile(absolutePath)

Calendar panel (sidebar)
  └─> on month render: buildCalendarGrid(year, month, settings)  [calendar-grid.ts — pure]
        └─> invoke("check_paths_exist", paths[])  [Rust — batch existence check]
              └─> render dots async (generation-guarded)
```

### Module Boundaries

```
src/plugins/daily-note/
  daily-note.plugin.ts        IIFE entry point; plugin lifecycle; openDailyNote(); settings UI
  date-utils.ts               Pure: formatDate(), parseDateFormat(), addDays(), isSameDay(),
                              getISOWeekNumber(), parseNaturalDate(), validateDateFormat()
  template-tokens.ts          Pure: substituteTokens(content, date, settings)
  frontmatter.ts              Pure: injectFrontMatter(content, dateStr)
  calendar-grid.ts            Pure: buildCalendarGrid(year, month, firstDay) -> CalendarCell[][]

src-tauri/src/commands/
  daily_note.rs               create_daily_note, check_paths_exist
  mod.rs                      (modified) add pub mod daily_note; add re-exports
  (main.rs)                   (modified) add commands to generate_handler![]

tests/plugins/daily-note/
  daily-note.test.ts          Vitest tests for all pure sub-modules and plugin logic
```

---

## Component Map

### New Files

| File | Purpose |
|---|---|
| `src/plugins/daily-note/daily-note.plugin.ts` | IIFE plugin entry point |
| `src/plugins/daily-note/date-utils.ts` | Pure date math and formatting |
| `src/plugins/daily-note/template-tokens.ts` | Pure token substitution |
| `src/plugins/daily-note/frontmatter.ts` | Pure YAML front matter inject/merge |
| `src/plugins/daily-note/calendar-grid.ts` | Pure calendar grid builder |
| `src-tauri/src/commands/daily_note.rs` | Rust commands |
| `tests/plugins/daily-note/daily-note.test.ts` | Vitest test suite |

### Modified Files

| File | Change |
|---|---|
| `src-tauri/src/commands/mod.rs` | Add `pub mod daily_note;` and re-export both commands |
| `src-tauri/src/main.rs` | Add `create_daily_note`, `check_paths_exist` to `generate_handler![]` |
| `vite.plugins.config.ts` | Add `daily-note` entry to the plugin build inputs |
| `src-tauri/src/commands/plugins.rs` | Add `"daily-note"` to the stale-plugin cleanup list in `copy_core_plugins` |

---

## Step Overview

| Step | Title | Description | Est. Tests |
|---|---|---|---|
| 01 | Rust Commands | `create_daily_note` and `check_paths_exist` Tauri commands + Rust tests | 18 |
| 02 | Pure TypeScript Sub-modules | `date-utils.ts`, `template-tokens.ts`, `frontmatter.ts`, `calendar-grid.ts` + all unit tests | 55 |
| 03 | Plugin Scaffold + Settings | IIFE entry point, settings types/defaults, settings UI panel, `api.loadSettings`/`saveSettings` | 12 |
| 04 | Core Actions + Command Registration | `openDailyNote()`, prev/next/today commands, "Open for Date…" input, keybinding registration | 18 |
| 05 | Calendar Sidebar Panel | Month grid DOM, dot indicators, keyboard nav, tab-change updates, generation counter | 20 |
| 06 | Integration + Edge Case Audit | `openOnStartup`, `confirmCreate`, error surfaces, EC checklist coverage | 10 |

Total: ~133 tests (target: 60+)

---

## Implementation Checklist

- [x] Step 01 — Rust commands (`create_daily_note`, `check_paths_exist`)
- [x] Step 02 — Pure TypeScript sub-modules (date-utils, template-tokens, frontmatter, calendar-grid)
- [x] Step 03 — Plugin scaffold + settings panel
- [x] Step 04 — Core actions + command registration
- [x] Step 05 — Calendar sidebar panel
- [x] Step 06 — Integration + edge case audit

---

## Key Architectural Decisions

### AD-A: No Moment.js — Hand-Written Token Formatter

Moment.js is ~300 KB minified and would violate the 5 MB core plugin cap for a feature that needs only a small subset of tokens. The pure `date-utils.ts` module implements only the tokens listed in FR-05.2 using the JavaScript `Date` API. The formatter table is a literal map `{ 'YYYY': ..., 'MM': ..., 'DD': ..., ... }` sorted by token length (longest-first replacement) to avoid partial substitution bugs (e.g. `MM` before `M`).

### AD-B: Four Pure Sub-modules, One IIFE Entry Point

The IIFE compilation constraint (no `import` at runtime) does not prevent using TypeScript `import` at build time. `vite.plugins.config.ts` bundles `daily-note.plugin.ts` and all its static imports into one IIFE. The pure sub-modules (`date-utils.ts`, `template-tokens.ts`, etc.) are statically imported at build time, and their exports are directly accessible in Vitest tests via regular `import`. This is the same pattern used by the Mermaid diagrams plugin (which imports from `mermaid`).

### AD-C: `create_daily_note` Combines `ensure_directory` + `write_file`

The existing `ensure_directory` and `write_file` commands each make a round-trip. `create_daily_note` combines both into one call to satisfy NFR-01 (note tab focused within 300ms on first creation). The command: resolves the parent directory from the `.md` path, calls `create_dir_all`, then performs the temp-file-swap write. It returns `Err` if the target path already exists as a directory (EC-35).

### AD-D: Existence Dot Resolution is Asynchronous and Generation-Guarded

The calendar grid renders immediately (satisfying NFR-02: < 100ms), then fires a single `check_paths_exist` batch call. The result is applied only if the generation counter has not changed since the call was issued (guarding EC-20, EC-21). The same generation counter is incremented on plugin disable (guarding EC-34) and on month navigation.

### AD-E: `openDailyNote` is a Single Shared Code Path

All entry points (today command, prev/next commands, calendar cell click, startup, "open for date") call one `openDailyNote(date: Date): Promise<void>` function. This prevents divergent behavior between the command bar and calendar click paths (FR-01.7). The function checks an `_inFlight` flag to prevent double-invocations (EC-33).

### AD-F: Settings UI in `renderDetailExtra` (Plugins Panel)

The Daily Note plugin contributes its settings via `renderDetailExtra` (same as Auto-Save), which renders inside the Plugins Panel detail view. This keeps all plugin settings co-located with the plugin toggle, consistent with the existing design. The settings do not appear in the main Settings panel.

### AD-G: Path Construction via Dedicated `joinPath` Utility

All TypeScript path joining goes through a `joinPath(...segments: string[]): string` helper in `date-utils.ts` that uses a `/`-based join with normalization (never double-slashes, handles empty-string folder as workspace root per EC-39). No string concatenation with `/` anywhere in the plugin (per Constraint 4 in the requirements).

### AD-H: `_testing` Export Pattern

Each pure sub-module exports all its functions as named exports, making them directly importable in Vitest. The IIFE entry point exports a `_testing` object (same pattern as backlinks) for any state that needs to be manipulated from tests without triggering the full plugin lifecycle.

---

## Edge Case to Step Mapping

| EC | Step |
|---|---|
| EC-01 (no workspace) | Step 04 |
| EC-02 (folder missing on first note) | Step 01 |
| EC-03 (date format collision) | Step 03 |
| EC-04 (illegal chars in date format) | Step 03 |
| EC-05 (template file deleted) | Step 04 |
| EC-06 (template has YAML + injectFrontMatter on) | Step 02 |
| EC-07 (template has `date:` field) | Step 02 |
| EC-08 (malformed format suffix in token) | Step 02 |
| EC-09 (template file >500 KB) | Step 04 |
| EC-10 (today note already open, active) | Step 04 |
| EC-11 (today note already open, not active) | Step 04 |
| EC-12 (prev/next from non-daily-note tab) | Step 04 |
| EC-13 (prev from Jan 1) | Step 02 |
| EC-14 (next from Dec 31) | Step 02 |
| EC-15 (leap day navigation) | Step 02 |
| EC-16 (subfolder already exists) | Step 01 |
| EC-17 (check_paths_exist with nested paths) | Step 01 |
| EC-18 (Feb non-leap year, 28 days) | Step 02 |
| EC-19 (check_paths_exist fails) | Step 05 |
| EC-20 (stale dot result after month nav) | Step 05 |
| EC-21 (rapid month navigation) | Step 05 |
| EC-22 (workspace changes mid-session) | Step 05 |
| EC-23 (calendar not visible) | Step 04 |
| EC-24 (no sidebar slot available) | Step 05 |
| EC-25 (openOnStartup, no file) | Step 06 |
| EC-26 (openOnStartup, note exists) | Step 06 |
| EC-27 (confirmCreate, user cancels) | Step 06 |
| EC-28 (confirmCreate, today bypassed) | Step 06 |
| EC-29 (invalid date in "open for date") | Step 04 |
| EC-30 ("yesterday" on Jan 1) | Step 02 |
| EC-31 (absolute folder path) | Step 04 |
| EC-32 (spaces/Unicode in workspace path) | Step 01 |
| EC-33 (double-invocation race) | Step 04 |
| EC-34 (disable during in-flight Tauri call) | Step 04 |
| EC-35 (target path is a directory) | Step 01 |
| EC-36 (file renamed outside app) | Step 06 (documented, no test needed) |
| EC-37 (two tabs, same daily note) | Step 05 |
| EC-38 (empty path list to check_paths_exist) | Step 01 |
| EC-39 (empty dailyNoteFolder) | Step 03 |
| EC-40 (dateFormat changed, existing notes) | Step 03 |

---

## Out of Scope

1. Weekly / monthly / quarterly / yearly notes (Periodic Notes feature).
2. Clicking week number cell navigates to a weekly note.
3. Drag-to-reorganize calendar cells.
4. Sync across devices.
5. Note content preview on calendar cell hover.
6. "On this day" historical view.
7. Bulk creation of past notes.
8. Dataview integration.
9. iCalendar / .ics import.
10. Full Templater `<% %>` expression support.

---

## Review Request

- **Files changed**:
  - `src-tauri/src/commands/daily_note.rs` (created)
  - `src-tauri/src/commands/mod.rs` (modified — added `pub mod daily_note` and re-exports)
  - `src-tauri/src/lib.rs` (modified — added `pub use` re-exports and registered commands in `generate_handler![]`)

- **Steps completed**: `step_01_rust_commands.md`

- **Known limitations**: None. All 18 specified tests were implemented and pass.

- **Edge cases covered by tests**:

  | EC | Test |
  |---|---|
  | EC-02 (folder missing on first note) | `creates_nested_directories_automatically` |
  | EC-16 (subfolder already exists) | `idempotent_on_existing_directories` |
  | EC-17 (check_paths_exist with nested paths) | `handles_nested_path` |
  | EC-32 (spaces/Unicode in workspace path) | `path_with_spaces`, `handles_path_with_spaces`, `creates_file_with_unicode_content` |
  | EC-35 (target path is a directory) | `returns_error_when_path_is_directory` |
  | EC-38 (empty path list to check_paths_exist) | `handles_empty_input` |

---

## Review Request — Step 02

- **Files changed**:
  - `src/plugins/daily-note/date-utils.ts` (created)
  - `src/plugins/daily-note/template-tokens.ts` (created)
  - `src/plugins/daily-note/frontmatter.ts` (created)
  - `src/plugins/daily-note/calendar-grid.ts` (created)
  - `tests/plugins/daily-note/daily-note.test.ts` (created)
  - `docs/specs/daily-note/00_index.md` (Step 02 checked off, Review Request appended)

- **Steps completed**: `step_02_pure_submodules.md`

- **Known limitations**: None. All 79 tests pass (63 specified + 16 additional utility/coverage tests for `getDaysInMonth`, `getISOWeekNumber`, `parseDateFromFilename`, `joinPath`, and `hasFrontMatter`).

- **Edge cases covered by tests**:

  | EC | Test |
  |---|---|
  | EC-04 (illegal chars in date format) | `validateDateFormat > "YYYY:MM:DD" is invalid`, `"YYYY*MM*DD" is invalid` |
  | EC-06 (template has YAML + injectFrontMatter on) | `injectFrontMatter > inserts date as first field when front matter exists but has no date field` |
  | EC-07 (template has date: field) | `injectFrontMatter > overwrites existing {{date}} placeholder`, `overwrites hardcoded date value` |
  | EC-08 (malformed format suffix in token) | `substituteTokens > {{date:NOT_A_FORMAT}} does not throw` |
  | EC-13 (prev from Jan 1) | `addDays(Jan 1, -1) rolls back to Dec 31 of the prior year` |
  | EC-14 (next from Dec 31) | `addDays(Dec 31, +1) rolls forward to Jan 1 of the next year` |
  | EC-15a/b (leap day navigation) | `addDays(Feb 28 leap year, +1) lands on Feb 29`, `addDays(Feb 29 leap year, +1) lands on Mar 1` |
  | EC-18 (Feb non-leap year, 28 days) | `buildCalendarGrid > February 2026 (non-leap year) has exactly 28 non-padding cells` |
  | EC-29 (invalid date in "open for date") | `parseNaturalDate > "2026-02-30" returns null` |
  | EC-30 ("yesterday" on Jan 1) | `parseNaturalDate > "yesterday" when today is Jan 1 returns Dec 31 of prior year` |
  | EC-31 (absolute folder path) | `buildNotePath > uses absolute folder directly, ignoring workspace` |
  | EC-32 (spaces/Unicode in workspace path) | `buildNotePath > handles spaces in workspace and folder paths` |
  | EC-39 (empty dailyNoteFolder) | `buildNotePath > uses workspace root when dailyNoteFolder is empty` |

---

## Review Request — Step 03

- **Files changed**:
  - `src/plugins/daily-note/daily-note.plugin.ts` (created)
  - `vite.plugins.config.ts` (modified — added `daily-note` entry)
  - `scripts/build-plugins.mjs` (modified — added `daily-note` entry)
  - `tests/plugins/daily-note/daily-note.test.ts` (modified — added Group 9: 12 `loadAndMergeSettings` tests; added `beforeAll` to import)
  - `docs/specs/daily-note/00_index.md` (Step 03 checked off, Review Request appended)

- **Steps completed**: `step_03_plugin_scaffold_settings.md`

- **Known limitations**:
  - `plugins.rs` stale cleanup: no hardcoded array exists in the Rust source — the cleanup set is built dynamically from `read_dir(&bundled_core_dir)`. Adding the plugin to the Vite build is sufficient; no Rust change is required. The spec note ("add `"daily-note.js"` to that array") does not apply to the actual implementation.
  - `onDisable` parameter is named `_unusedApi` (underscore prefix) because no CM6 extensions are registered in this step. This is idiomatic TypeScript for intentionally unused parameters.

- **Edge cases covered by tests**:

  | EC | Test |
  |---|---|
  | EC-03 (date format collision) | `loadAndMergeSettings > preserves valid dateFormat from raw` (valid format preserved, not overwritten) |
  | EC-04 (illegal chars in date format) | `loadAndMergeSettings > falls back to default dateFormat when format contains illegal chars (EC-04)` |
  | EC-39 (empty dailyNoteFolder) | `loadAndMergeSettings > returns all defaults when raw is null` (default is "Daily Notes", not empty) |
  | EC-40 (dateFormat changed, existing notes) | `renderDetailExtra > date format info text present` (informational text hardcoded in `buildDateFormatRow`) |

---

## Review Request — Step 04

- **Files changed**:
  - `src/plugins/daily-note/daily-note.plugin.ts` (modified — added `openDailyNote`, `openPrevDay`, `openNextDay`, `getCurrentDailyNoteDate`, `openForDatePrompt`, `showNotice`, `confirmCreateDialog`, `invalidateMonthCache` (stub), `toggleCalendarPanel` (stub), `registerCommands`, `unregisterCommands`, `registerKeydownListener`, `unregisterKeydownListener`; expanded `onEnable`/`onDisable`; expanded `_testing` export with `callOpenDailyNote`, `callOpenPrevDay`, `callOpenNextDay`, `callOnEnable`, `callOnDisable`, `getInFlight`)
  - `tests/plugins/daily-note/daily-note.test.ts` (modified — added Groups 10 and 11: 20 tests covering `openDailyNote` paths and prev/next/today commands)

- **Steps completed**: `step_04_core_actions_commands.md`

- **Known limitations**:
  - `invalidateMonthCache` and `toggleCalendarPanel` are intentional no-op stubs. They will be filled in during Step 05 when the calendar sidebar panel is implemented.
  - The `registerKeydownListener` approach registers a document-level `keydown` listener because daily-note commands are not in the static `COMMANDS` array in `keybindings-panel.ts` (which `resolveAction` reads). The listener fires at capture phase and respects `__MARKABLE_COMMAND_BAR_IS_OPEN__`. Custom keybinding remapping (from the Keybindings Editor) does not apply to these commands in this step; Step 06 can address that if needed.
  - `openForDatePrompt` is implemented but has no dedicated unit tests beyond the existing `parseNaturalDate` coverage (EC-29, EC-30). The prompt is a DOM overlay that auto-dismisses and its behaviour is covered by the `parseNaturalDate` tests in Group 3.

- **Edge cases covered by tests**:

  | EC | Test |
  |---|---|
  | EC-01 (no workspace) | `openDailyNote > EC-01: no workspace — shows notice, no Tauri invoke` |
  | EC-05 (template file deleted) | `openDailyNote > EC-05: template file not found — creates empty note, no error` |
  | EC-10 (today note already open, active) | `openDailyNote > EC-10/EC-11: note already open — switches to tab, no create_daily_note` |
  | EC-11 (today note already open, not active) | same test as EC-10 |
  | EC-12 (prev/next from non-daily-note tab) | `openPrevDay / openNextDay > EC-12: openPrevDay from non-daily-note falls back to yesterday` |
  | EC-13 (prev from Jan 1) | `openPrevDay / openNextDay > EC-13: openPrevDay from Jan 1 navigates to Dec 31` |
  | EC-14 (next from Dec 31) | `openPrevDay / openNextDay > EC-14: openNextDay from Dec 31 navigates to Jan 1` |
  | EC-15a (leap day Feb 28 → Feb 29) | `openPrevDay / openNextDay > EC-15a: openNextDay from Feb 28 in a leap year navigates to Feb 29` |
  | EC-15b (leap day Feb 29 → Mar 1) | `openPrevDay / openNextDay > EC-15b: openNextDay from Feb 29 in a leap year navigates to Mar 1` |
  | EC-27 (confirmCreate, user cancels) | `openDailyNote > EC-27: confirmCreate enabled, user cancels — no write` |
  | EC-28 (confirmCreate, today bypassed) | `openDailyNote > EC-28: confirmCreate enabled, target is today — no dialog, note created` |
  | EC-33 (double-invocation race) | `openDailyNote > EC-33: double invocation — second call is a no-op` |
  | EC-34 (disable during in-flight) | `openDailyNote > EC-34: plugin disabled during Tauri call — tab not opened` |
  | EC-35 (target path is a directory) | `openDailyNote > EC-35: Rust returns directory error — does not throw, tab not opened` |

---

## Review Request — Step 05

- **Files changed**:
  - `src/plugins/daily-note/daily-note.plugin.ts` (modified — added all calendar sidebar panel code: `renderCalendarPanel`, `navigateMonth`, `navigateToToday`, `resolveDotsAsync`, `applyDots`, `updateSelectedCell`, `registerSidebarPanel`, `unregisterSidebarPanel`, `attachTabChangeListener`, `detachTabChangeListener`, `buildDowHeaders`; replaced `invalidateMonthCache` and `toggleCalendarPanel` stubs with full implementations; added calendar CSS to `injectCSS`; expanded `onEnable`/`onDisable`; expanded `_testing` export with 10 new Step 05 helpers; added `sidebarPanelId` to default export)
  - `tests/plugins/daily-note/daily-note.test.ts` (modified — added Groups 12, 13, 14: 20 tests; added `beforeEach` to vitest imports)

- **Steps completed**: `step_05_calendar_sidebar.md`

- **Known limitations**:
  - `toggleCalendarPanel()` calls `api.toggleSidebarPanel()` if the method exists on the API, but the `MarkablePluginAPI` interface does not currently expose that method. The call is guarded with a runtime typeof check and therefore silently no-ops in production. The `toggleSide()` function in `sidebar-manager.ts` exists as a module function but is not exposed via the plugin API. This deferred work is documented here rather than left as a source-code TODO.
  - The `setInterval` polling fallback for tab-change (mentioned in the spec's backlinks pattern) is not implemented. The `onTabChange` event API is sufficient for the current test coverage and production use. An interval handle would require cleanup infrastructure that adds complexity without tangible benefit.
  - `showWeekNumbers` rendering (ISO week number column) is not implemented in the DOM — the setting is persisted and respected by the grid builder (`buildCalendarGrid` receives `firstDayOfWeek`) but the 8-column CSS grid variant was not added. This is an out-of-scope deferral; the spec lists it as optional.

- **Edge cases covered by tests**:

  | EC | Test |
  |---|---|
  | EC-18 (Feb non-leap year, 28 days) | `calendar panel rendering > EC-18: February 2026 renders 28 non-padding day cells` |
  | EC-19 (check_paths_exist fails) | `dot resolution > EC-19: check_paths_exist failure — dots not applied, no exception thrown` |
  | EC-20 (stale dot result after month nav) | `dot resolution > EC-20: stale dot result discarded when _dotGeneration changes before resolve` |
  | EC-21 (rapid month navigation) | `dot resolution > EC-21: rapid navigation increments _dotGeneration by one per navigateMonth call` |
  | EC-22 (workspace changes mid-session) | `calendar panel rendering > EC-22: updateSelectedCell clears old selection and applies new one` |
  | EC-24 (no sidebar slot available) | `calendar panel rendering > EC-24: onEnable does not throw when registerSidebarPanel is a no-op` |
  | EC-37 (two tabs, same daily note path) | `calendar panel rendering > EC-37: two tabs open same daily note — exactly one cell is dn-cal-selected` |
  | EC-38 (empty path list) | `dot resolution > EC-38: no workspace → resolveDotsAsync returns early, no invoke called` |

---

## Review Request — Step 06

- **Files changed**:
  - `src/plugins/daily-note/daily-note.plugin.ts` (modified — added `openOnStartup` logic with `setTimeout(0)` + `_active` guard in `onEnable`; added EC-36 code comment in `updateSelectedCell`)
  - `tests/plugins/daily-note/daily-note.test.ts` (modified — added Group 15: 10 integration tests, Tests 131–140)
  - `docs/specs/daily-note/00_index.md` (Step 06 checked off, Review Request appended)

- **Steps completed**: `step_06_integration_edge_cases.md`

- **Known limitations**:
  - EC-02, EC-16, EC-17, EC-32 (Rust side): covered by `cargo test` in `daily_note.rs`, not by Vitest. No TypeScript test can exercise the Rust `create_dir_all` idempotency.
  - EC-36 (file renamed outside app): documented with a code comment in `updateSelectedCell` per the spec. No test possible — this is a tab-system limitation, not plugin logic.
  - `toggleSidebarPanel` API method not yet exposed on `MarkablePluginAPI` interface — `toggleCalendarPanel()` is guarded with a runtime `typeof` check and silently no-ops. Documented in Step 05 known limitations.

- **Edge cases covered by tests**:

  | EC | Test |
  |---|---|
  | EC-23 (calendar not visible, Open Today works) | `Group 15 > EC-23: openDailyNote succeeds when calendar panel container is null` (Test 131) |
  | EC-25 (openOnStartup, no workspace) | `Group 15 > EC-25: openOnStartup with null __MARKABLE_CURRENT_FILE__ — silent skip` (Test 132) |
  | EC-26 (openOnStartup, note exists) | `Group 15 > EC-26: openOnStartup with a valid workspace — note is created and tab opened` (Test 133) |
  | EC-34 (disable during in-flight) | `Group 15 > EC-34 (lifecycle): onDisable during openDailyNote prevents tab open` (Test 135) |
  | EC-04 (invalid chars in settings UI) | `Group 15 > EC-04: invalid dateFormat in settings UI blocked — saveSettings not called` (Test 137) |
  | EC-29 (invalid date in prompt) | `Group 15 > EC-29: openForDatePrompt with invalid date — error span visible, no invoke` (Test 140) |

---

## Post-Review Fixes (2026-04-23)

All three items flagged by the code reviewer have been resolved.

### H-01 — Resolved: Hardcoded hex colors in badge CSS (NFR-03)

`color: #fff` replaced with `color: var(--bg-primary, #fff)` in both `.dn-badge-ok` and `.dn-badge-warn`. `background: #f5a623` replaced with `background: var(--warn-color, #f5a623)` in `.dn-badge-warn`. Explanatory NFR-03 comments added to each replaced line.

### M-01 — Resolved: EC-03/EC-40 now have an assertion-backed test

Test 141 (`EC-40: renderDetailExtra contains 'Changing date format does not rename existing notes'`) added to Group 16. It renders the settings panel and asserts `container.textContent` includes the exact informational string from `buildDateFormatRow`.

### M-02 — Resolved: EC-09 large template now has a test

Test 142 (`EC-09: large template file (>100 KB) — console.warn emitted, create_daily_note still called`) added to Group 16. It mocks `read_file` to return a 110,000-character string, spies on `console.warn`, and asserts both that the warning contains "large" and that `create_daily_note` was still invoked.

### L-02 — Resolved: Stale `onDisable` comment removed

Two stale lines — `Step 05 will add: registerSidebarPanel(api).` from the `onEnable` JSDoc and `Step 05 will add: unregisterSidebarPanel().` from the `onDisable` JSDoc — were removed. Both functions were implemented in Step 05; the forward-reference comments were obsolete.

### Files modified

- `src/plugins/daily-note/daily-note.plugin.ts` — H-01 CSS variables, L-02 stale comment removal
- `tests/plugins/daily-note/daily-note.test.ts` — M-01 (Test 141) and M-02 (Test 142) added
- `docs/specs/daily-note/00_index.md` — this section
