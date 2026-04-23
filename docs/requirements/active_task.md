---
title: "Daily Note / Calendar"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Daily Note / Calendar — Requirements Spec

## Validation Status

**VALIDATED — approved by user 2026-04-23.**

---

## Summary

As a user, I want a single integrated plugin that creates or opens a date-stamped Markdown note for any day I choose and provides a calendar sidebar panel for navigating between days, so that I can maintain a daily journaling or logging practice without juggling two separate tools or leaving the editor.

---

## Background and Motivation

Markable is entering Phase 3 (PKM features). Daily Note / Calendar is item #1 on that list — the foundational PKM primitive. Every subsequent PKM feature (Dataview, Projects, Knowledge Graph) benefits from a corpus of daily notes as anchors.

### Obsidian Parity Analysis

Obsidian delivers this feature via two separate community plugins maintained by the same developer (liamcain):

**Daily Notes (core plugin)**
- Creates one `.md` file per calendar day in a configurable folder.
- Filename uses a configurable Moment.js date format (default: `YYYY-MM-DD`).
- Optional template file is inserted into new notes on creation.
- Three commands: "Open today's daily note", "Open next daily note", "Open previous daily note."
- No built-in calendar UI — navigation is hotkey-only.
- Template variables: `{{date}}`, `{{time}}`, `{{title}}` (with optional format suffix, e.g. `{{date:dddd, MMMM D}}`).

**Calendar (community plugin)**
- Sidebar panel showing a month grid with Monday/Sunday first-day toggle and optional ISO week number column.
- Clicking a day cell opens or creates that day's daily note.
- Clicking a week number cell opens or creates a weekly note (delegates to Periodic Notes for the weekly format).
- Dot indicator on each cell shows word count for that note (if the note exists).
- Reads Daily Notes settings (folder + date format) to know where to look.

**Periodic Notes (community plugin, same developer)**
- Extends Daily Notes to also manage weekly, monthly, quarterly, and yearly notes, each with its own folder, format, and template.
- The Calendar plugin delegates weekly note creation to Periodic Notes.

### Known Obsidian Friction Points

1. **Three-plugin dependency chain**: To get a functional daily-note-plus-calendar workflow, users must install Daily Notes (core), Calendar, and Periodic Notes (community). Settings are split across all three. First-time setup is a common pain point.
2. **Calendar and Periodic Notes are effectively unmaintained**: The original developer stepped back years ago; the plugins have accumulated 98+ open GitHub issues. Obsidian users have formally requested the team adopt these as core plugins (as of 2025, still unresolved).
3. **Next/Previous hotkeys fail with subfolders**: The Daily Notes `Open next/previous` commands break when notes are organized into date-hierarchy subfolders (e.g. `YYYY/MM/YYYY-MM-DD.md`) — a well-documented bug in the Obsidian forum.
4. **No "open on startup" that is reliable cross-platform**: The "Open daily note on startup" toggle has a recurring Android bug (fills note with ghost template content from a deleted file). Less relevant on macOS but illustrates fragility.
5. **Template engine is minimal**: The core Templates plugin only substitutes `{{date}}`, `{{time}}`, `{{title}}`. Power users are forced to install the Templater community plugin just to get features like inserting the previous day's note link.
6. **Calendar dot system is opaque**: The word-count-dot visualization is clever but has no legend and breaks silently when Daily Notes settings change (folder mismatch causes dots to disappear).

### What Markable Can Do Better

1. **One plugin, one settings panel** — no three-plugin chain. Daily Note + Calendar sidebar live in a single plugin, configured from a single panel in the Markable Settings UI.
2. **Reliable subfolder routing** — generate the note path by composing the folder setting with the date format directly; no glob-scanning or next/previous lookup bugs.
3. **Template integration** — instead of a bespoke template engine, delegate to Markable's existing Templates plugin (if enabled) with a designated "Daily Note template" file, and add date tokens (`{{date}}`, `{{weekday}}`, `{{time}}`, etc.) resolved at note-creation time. Token syntax is Obsidian-compatible for easy migration.
4. **YAML front matter injection** — optionally inject a YAML block at the top of new notes with the date field pre-populated (integrates with the existing YAML Pane).
5. **Calendar sidebar as a first-class Markable panel** — uses the existing sidebar slot system (same pattern as TOC, Backlinks); no separate panel framework required.
6. **Command Bar integration** — "Open Today's Note", "Open Daily Note for Date…", "Open Previous Day", "Open Next Day" are registered commands discoverable via Cmd-Shift-P.

---

## Goals

1. Ship a single Markable plugin (`daily-note.plugin.ts`) that replaces the need for Obsidian's three-plugin chain.
2. Deliver a calendar sidebar panel that allows click-to-navigate to any day.
3. Deliver keyboard commands for opening today, previous day, and next day.
4. Integrate with the existing Templates plugin for note content (with a graceful fallback when Templates is off).
5. Integrate with the Command Bar (commands discoverable via Cmd-Shift-P).
6. Integrate with the YAML Pane (optionally inject a `date:` front matter field).
7. Keep the implementation contained to a single IIFE plugin; no new Rust commands unless file-creation requires it (see FR-10 for the Rust surface).

---

## Functional Requirements

### FR-01: Note Creation and Opening

**FR-01.1** The plugin creates a new `.md` file for a given date if that file does not already exist, then opens it in a new tab (or switches to the existing tab if the file is already open).

**FR-01.2** The file path for a daily note is computed as: `<daily-notes-folder>/<formatted-date>.md`, where `<daily-notes-folder>` is the configured folder path (FR-08.1) and `<formatted-date>` is the date formatted using the configured date format string (FR-08.2).

**FR-01.3** If the date format string contains `/` characters (e.g. `YYYY/MM/YYYY-MM-DD`), each path segment separated by `/` is treated as a subfolder. The full nested directory path is created automatically if it does not exist. Example: format `YYYY/MM/YYYY-MM-DD` and folder `Daily Notes` for 2026-04-23 produces `Daily Notes/2026/04/2026-04-23.md`.

**FR-01.4** File creation uses an existing Tauri `write_file` command (or equivalent) with the temp-file-swap pattern mandated by Markable conventions. The plugin must not write files directly via the Fetch API or other browser-side mechanisms.

**FR-01.5** When a new note is created, the plugin inserts template content before saving (see FR-05). When opening an existing note, no content modification occurs.

**FR-01.6** After creating or locating the note file, the plugin calls `__MARKABLE_TAB_MANAGER__.openFile(absolutePath)` to open or switch to the tab. If the file is already open as a tab, `switchToTab` is used instead of creating a duplicate tab.

**FR-01.7** The "open or create" operation is exposed as a reusable internal function `openDailyNote(date: Date): Promise<void>` so that all entry points (commands, calendar click, startup) share a single code path.

---

### FR-02: Open Today's Note

**FR-02.1** The command "Daily Note: Open Today" creates or opens the daily note for today's local calendar date.

**FR-02.2** The command is accessible via:
- A registered Markable command (appears in Command Bar under "Daily Note: Open Today").
- A configurable keyboard shortcut (default: `Cmd-Opt-T`; user-overridable via the Keybinding Editor).
- A "Today" button in the calendar sidebar panel header.

**FR-02.3** "Today" is determined by `new Date()` in the renderer process at the moment the command is invoked, converted to local time. No server clock or Tauri time command is used.

---

### FR-03: Open Previous / Next Day

**FR-03.1** The commands "Daily Note: Open Previous Day" and "Daily Note: Open Next Day" navigate to the day immediately before or after the currently displayed daily note.

**FR-03.2** "Currently displayed daily note" is determined by parsing the filename of the active tab against the configured date format. If the active tab is not a daily note (filename does not match the expected format), both commands fall back to opening yesterday and tomorrow relative to today, respectively.

**FR-03.3** Prev/Next navigate strictly by calendar day (subtract/add exactly one day). They do not skip to the nearest existing file — they create the note for the target date if it does not exist, following the same FR-01 flow.

**FR-03.4** Default keyboard shortcuts: Prev = `Cmd-Opt-Left`, Next = `Cmd-Opt-Right`. Both are user-overridable via the Keybinding Editor.

**FR-03.5** Prev/Next buttons are visible in the calendar sidebar panel header (flanking the "Today" button) as well as registered as named commands in the Command Bar.

---

### FR-04: Open Daily Note for a Specific Date

**FR-04.1** The Command Bar exposes a command "Daily Note: Open for Date…" that, when activated, opens an inline date-picker input in the Command Bar (or a native macOS date prompt via Tauri dialog) allowing the user to type or select an arbitrary date.

**FR-04.2** The date input field accepts ISO 8601 format (`YYYY-MM-DD`) and natural-language shortcuts: `today`, `yesterday`, `tomorrow`. Unrecognized input shows an inline validation error; the note is not created.

**FR-04.3** Pressing Enter on a valid date runs `openDailyNote(parsedDate)`. Pressing Escape cancels without creating anything.

**FR-04.4** The calendar sidebar panel already satisfies the "pick any date" use case visually (click any cell). The "Open for Date…" command is a keyboard-first alternative for power users.

---

### FR-05: Template Integration

**FR-05.1** When a new daily note is created, the plugin checks whether a "Daily Note template" file is configured (FR-08.4) and whether that file exists on disk.

**FR-05.2** If both conditions are met, the template file's content is read (via Tauri `read_file`) and the following date tokens are substituted before insertion:

| Token | Substitution |
|---|---|
| `{{date}}` | Date in the configured date format (FR-08.2) |
| `{{date:FORMAT}}` | Date in the explicitly specified Moment.js format (e.g. `{{date:YYYY-MM-DD}}`) |
| `{{weekday}}` | Full weekday name (e.g. `Thursday`) |
| `{{weekday-short}}` | Abbreviated weekday name (e.g. `Thu`) |
| `{{year}}` | 4-digit year |
| `{{month}}` | 2-digit month (01–12) |
| `{{month-name}}` | Full month name (e.g. `April`) |
| `{{day}}` | 2-digit day of month (01–31) |
| `{{week}}` | ISO week number (01–53) |
| `{{time}}` | Current local time at moment of creation (HH:mm) |
| `{{title}}` | The note's filename without extension (the formatted date string) |
| `{{prev-link}}` | Wiki-link to the previous day's note: `[[YYYY-MM-DD]]` |
| `{{next-link}}` | Wiki-link to the next day's note: `[[YYYY-MM-DD]]` (future date) |

**FR-05.3** Tokens that are not in the table above are left verbatim (no substitution, no error). This ensures forward compatibility if the user adds custom tokens for the Templater plugin or similar.

**FR-05.4** If the configured template file path is set but the file does not exist on disk, a `console.warn` is emitted and the note is created empty (no error is thrown, no modal is shown). The missing-template condition is surfaced only in the plugin settings panel as a yellow warning badge on the template path field.

**FR-05.5** If the Templates plugin is not enabled, the daily-note template path still functions independently — the Daily Note plugin reads the file directly and does its own token substitution. The Templates plugin and the Daily Note plugin are not coupled; the daily note template path is a separate setting from the Templates plugin's folder.

**FR-05.6** If no template file is configured, new notes are created with an empty body (no default content injected). The YAML front matter injection (FR-06) still applies if enabled.

---

### FR-06: YAML Front Matter Injection

**FR-06.1** When the setting `injectFrontMatter` is enabled (FR-08.5), new daily notes receive a YAML front matter block at the top of the file, prepended before any template content.

**FR-06.2** The injected block contains at minimum:

```yaml
---
date: YYYY-MM-DD
---
```

where the date value is the ISO 8601 date of the note.

**FR-06.3** If the template file already contains a YAML front matter block (first line is `---`), the injected `date:` field is merged into the existing block rather than prepending a second `---` fence. Merge strategy: the `date:` key is inserted as the first field inside the existing block. If `date:` already exists in the template, it is overwritten with the computed date.

**FR-06.4** The YAML Pane plugin (if active) automatically reflects the injected front matter fields as soon as the note is opened, because the YAML Pane reads from the document state — no special coupling is required beyond FR-06.1–FR-06.3.

---

### FR-07: Calendar Sidebar Panel

**FR-07.1** The plugin registers a sidebar panel titled "Calendar" using the existing `SidebarPanelDescriptor` system. The panel is assignable to the left or right sidebar slot (same behavior as TOC, Backlinks).

**FR-07.2** The calendar panel renders a month grid: 7-column day grid with a header row showing abbreviated weekday names (Mon–Sun or Sun–Sat depending on the `firstDayOfWeek` setting, FR-08.7). The current month and year are shown as a title above the grid.

**FR-07.3** Each day cell in the grid shows:
- The day number.
- A visual indicator (a small filled dot) if a daily note file exists for that date. The dot is shown only for dates where the expected file path (computed from FR-01.2) resolves to an existing file. Existence is checked lazily when the month is rendered, via a batch Tauri `check_paths_exist` call or equivalent.
- A distinct "today" style (bold day number, accent-colored border) for the current calendar date.
- A distinct "selected" style for the date whose note is currently open in the active tab (if it matches a daily note).

**FR-07.4** Clicking any day cell calls `openDailyNote(date)` (FR-01.7).

**FR-07.5** The panel header row contains three navigation controls:
- Left arrow button: navigate to the previous month.
- A "Today" button (or month/year label that is also a button): navigate back to the current month.
- Right arrow button: navigate to the next month.

**FR-07.6** An optional "week number" column can be shown to the left of the grid (controlled by the `showWeekNumbers` setting, FR-08.8). Week numbers follow ISO 8601 (Monday = start of week, week 1 = week containing the first Thursday of the year). Clicking a week number cell is a no-op in this version (weekly notes are out of scope — see Out of Scope).

**FR-07.7** The calendar panel does not re-render on every keystroke or CM6 document change. It re-renders when: (a) the visible month changes, (b) the active tab changes (to update the "selected" cell highlight), or (c) the plugin settings change. Existence dots are cached per-month and invalidated when a new daily note is created.

**FR-07.8** The calendar panel is keyboard-navigable: when the panel has focus, Left/Right/Up/Down arrow keys move between day cells; Enter activates the focused cell; Page Up/Down navigates months.

**FR-07.9** The panel uses CSS variables for all colors and fonts (`--bg-primary`, `--text-primary`, `--accent-color`, `--ui-font`, etc.). It must look correct in all built-in Markable themes without hardcoded hex values.

---

### FR-08: Settings

**FR-08.1** `dailyNoteFolder` (string, default: `"Daily Notes"`) — the folder path, relative to the current workspace directory (the directory containing the most recently opened file), where daily notes are stored. An absolute path is also accepted. If the folder does not exist, it is created automatically on the first note creation. An empty string means the workspace root.

**FR-08.2** `dateFormat` (string, default: `"YYYY-MM-DD"`) — the Moment.js date format string used for both the filename and the `{{date}}` token. `/` characters in the format create subfolders (FR-01.3). Must produce a valid filename on macOS (characters `:`, `*`, `?`, `"`, `<`, `>`, `|`, `\` are rejected with a settings-panel inline error).

**FR-08.3** `openOnStartup` (boolean, default: `false`) — when enabled, the plugin opens today's daily note automatically each time the Markable application is launched. Opening happens after the editor is fully initialized (not during plugin `onEnable`).

**FR-08.4** `templateFilePath` (string, default: `""`) — absolute path to a `.md` file used as the template for new daily notes. The settings panel renders a "Choose file…" button that opens a native file picker seeded at the workspace directory. If the path is non-empty but the file does not exist, the settings panel shows a yellow warning badge (no blocking error).

**FR-08.5** `injectFrontMatter` (boolean, default: `false`) — when enabled, new daily notes receive a YAML front matter block with a `date:` field (FR-06).

**FR-08.6** `confirmCreate` (boolean, default: `false`) — when enabled, the plugin shows a brief confirmation dialog before creating a note for any date other than today. Useful for users who want to avoid accidentally creating future or historical notes from the calendar. The dialog reads: `"Create daily note for [formatted date]?"` with "Create" and "Cancel" buttons.

**FR-08.7** `firstDayOfWeek` (enum: `"monday"` | `"sunday"`, default: `"monday"`) — controls whether the calendar grid starts on Monday or Sunday.

**FR-08.8** `showWeekNumbers` (boolean, default: `false`) — controls whether the ISO week number column is shown in the calendar panel (FR-07.6).

---

### FR-09: Command Registration

All commands below are registered in `__MARKABLE_COMMANDS__` so they appear in the Command Bar (Cmd-Shift-P) and are assignable via the Keybinding Editor.

| Command ID | Label | Default Shortcut |
|---|---|---|
| `daily-note-today` | Daily Note: Open Today | `Cmd-Opt-T` |
| `daily-note-prev` | Daily Note: Open Previous Day | `Cmd-Opt-Left` |
| `daily-note-next` | Daily Note: Open Next Day | `Cmd-Opt-Right` |
| `daily-note-for-date` | Daily Note: Open for Date… | (none by default) |
| `daily-note-toggle-calendar` | Daily Note: Toggle Calendar Panel | (none by default) |

**FR-09.1** Commands are only active (not context-invalid) when the plugin is enabled. If the plugin is disabled, the commands are unregistered and the calendar sidebar panel is removed.

**FR-09.2** The "Open Today", "Prev", and "Next" commands are never context-invalid (they can be invoked from any tab, including non-daily-note tabs). The `confirmCreate` setting (FR-08.6) governs whether a prompt is shown for past/future dates; it does not gate the command itself.

---

### FR-10: Rust Backend Surface

**FR-10.1** The plugin requires two new Tauri commands:

| Command | Signature | Purpose |
|---|---|---|
| `create_daily_note` | `(path: String, content: String) -> Result<(), String>` | Creates parent directories if needed, then writes the file using the temp-file-swap pattern. Returns an error string if the write fails. |
| `check_paths_exist` | `(paths: Vec<String>) -> Result<HashMap<String, bool>, String>` | General-purpose batch existence check. Given a list of absolute paths (files or directories), returns a map of path → boolean indicating which paths exist on disk. Not specific to daily notes — usable by any feature that needs to check multiple paths in a single round-trip. |

**FR-10.2** `create_daily_note` must be idempotent on the directory creation side — calling it when the directories already exist must succeed silently.

**FR-10.3** Both commands must be registered in `src-tauri/src/commands/` following the existing command-file pattern and added to the `tauri::generate_handler!` macro invocation.

**FR-10.4** `check_paths_exist` takes absolute paths only. The frontend is responsible for constructing absolute paths from the workspace directory + folder + formatted date before calling this command. The command is intentionally general-purpose: it accepts any mix of file and directory paths and returns a presence boolean for each.

---

### FR-11: Plugin Lifecycle and IIFE Constraints

**FR-11.1** The plugin is implemented as an IIFE following the same pattern as all existing core plugins. No app-internal TypeScript imports. All cross-boundary communication goes through `window` globals.

**FR-11.2** On `onEnable`: register commands, register sidebar panel, attach tab-change listener, and (if `openOnStartup` is true and the app has just launched for the first time since the plugin was enabled) open today's note.

**FR-11.3** On `onDisable`: unregister commands, remove sidebar panel, detach tab-change listener, cancel any in-flight Tauri invocations via generation counter.

**FR-11.4** The plugin does not hold open file handles. All file reads and writes go through single-shot Tauri `invoke` calls.

**FR-11.5** The calendar panel DOM is built once on `onEnable` and mutated in place on month navigation or tab changes (no tear-down/rebuild per interaction).

---

## Non-Functional Requirements

**NFR-01: Open latency** — "Open Today" must result in the note tab being focused within 300ms on first creation (includes file write + tab open). Subsequent opens of an already-existing note must be under 100ms (tab switch only).

**NFR-02: Calendar render latency** — The calendar month grid must render within 100ms of the panel becoming visible. Existence dot resolution (the `check_paths_exist` call) may happen asynchronously after the grid is visible; dots appear as a second paint with no layout shift.

**NFR-03: CSS variable theming** — All calendar panel CSS uses existing Markable CSS variables. No hardcoded hex values or font stack literals.

**NFR-04: IIFE constraint** — The plugin must not import any app-internal modules. All globals are accessed via the `window` namespace.

**NFR-05: Test coverage** — A Vitest test file at `tests/plugins/daily-note/daily-note.test.ts` must cover: date format computation, path construction (including subfolder cases), token substitution, YAML front matter injection/merge, date parsing for "Open for Date…", prev/next day navigation logic, and all edge cases in the Edge Case Inventory. Minimum target: 60 tests.

**NFR-06: No silent data loss** — File write failures must surface as visible user-facing error notices (inline in the calendar panel or as a temporary status bar message). The plugin must never silently swallow a `create_daily_note` error.

---

## Integration Points

| Global / API | Role | Notes |
|---|---|---|
| `__MARKABLE_TAB_MANAGER__` | `openFile(path)`, `switchToTab(id)`, `getAllTabs()`, tab-change event | Used for all note opening and for "selected" cell highlighting |
| `__MARKABLE_CURRENT_FILE__` | Derive workspace directory | Falls back gracefully when null (EC-01) |
| `__MARKABLE_COMMANDS__` | Command registration | Plugin adds 5 commands on enable, removes them on disable |
| `__MARKABLE_HANDLE_ACTION__` | Dispatch daily-note commands from Command Bar | Standard command dispatch pattern |
| `__MARKABLE_COMMAND_BAR_OPEN__` | Trigger "Open for Date…" inline input if implemented inside bar | Optional — may use a simpler inline DOM approach instead |
| `__MARKABLE_PREVIEW_ENABLED__` | Source-mode guard | Not directly used; no editor decorations |
| `api.loadSettings()` / `api.saveSettings()` | Persist plugin settings | Standard plugin settings API |
| `__TAURI_INTERNALS__.invoke("create_daily_note")` | File creation with directory scaffolding | New Rust command (FR-10.1) |
| `__TAURI_INTERNALS__.invoke("check_paths_exist")` | General-purpose batch existence check for calendar dots and any other multi-path checks | New Rust command (FR-10.1) |
| Sidebar panel system (`SidebarPanelDescriptor`) | Register "Calendar" panel | Same pattern as TOC and Backlinks panels |
| YAML Pane plugin | Reads injected `date:` field on note open | No coupling required — YAML Pane reads from document state |

---

## Out of Scope

1. **Weekly / monthly / quarterly / yearly notes** — Obsidian's Periodic Notes feature. May be a follow-on plugin; not in this spec.
2. **Clicking a week number cell navigates to a weekly note** — the week number column is display-only in this version (FR-07.6).
3. **Drag-to-reorganize** — rearranging daily notes by dragging calendar cells.
4. **Sync across devices** — that is FC3 #12 (Backup & Sync).
5. **Note content preview on calendar cell hover** — popover with note excerpt. Possible future enhancement.
6. **"On this day" historical view** — opening all notes from the same date in prior years in a single view.
7. **Bulk creation of past notes** — "create all missing notes for the last 30 days."
8. **Dataview integration** — querying daily notes by tag, date range, or property. That is FC3 #15.
9. **iCalendar / .ics import** — no calendar event integration.
10. **Full Templater plugin support** — Templater's `<% %>` expression syntax is not evaluated by this plugin. Users who want Templater expressions must use Markable's own token set or wait for a Templater-compatible plugin.

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer. Every item must have a corresponding test or documented rationale for why it is excluded.

**EC-01: No file currently open (workspace directory unknown)** — `__MARKABLE_CURRENT_FILE__` is null when the user invokes "Open Today". Expected: the plugin falls back to a "no workspace" state and shows an inline error notice: "Open a file first to set the workspace for daily notes." The note is not created. The calendar panel remains visible but shows an empty grid with a "No workspace" message.

**EC-02: Daily notes folder does not exist yet (first-ever note)** — The configured `dailyNoteFolder` path does not exist on disk. Expected: `create_daily_note` creates all intermediate directories automatically (FR-10.2). The operation succeeds silently. On failure (e.g. permissions), the error from Rust is surfaced as a visible notice.

**EC-03: Date format produces a path collision (two formats resolve to the same filename)** — E.g. the user changes `dateFormat` from `YYYY-MM-DD` to `MM-DD-YYYY` and the note `04-23-2026.md` could conflict with a file created under the old format. Expected: the plugin does not validate for this scenario; it simply opens or creates whatever file the current format resolves to. A settings-panel warning text explains this risk when the format is changed: "Changing date format does not rename existing notes."

**EC-04: Date format string contains macOS-illegal filename characters** — E.g. user types `YYYY:MM:DD` (colon is illegal on macOS HFS+). Expected: the settings panel immediately shows an inline validation error listing the illegal characters and prevents saving the setting. The previous valid format remains active.

**EC-05: Template file path is set but the file has been deleted** — The settings panel shows a yellow warning badge (FR-05.4). When the user triggers note creation, the note is created with an empty body (no error thrown). The warning badge is the only feedback.

**EC-06: Template file contains a YAML front matter block AND `injectFrontMatter` is enabled** — Two YAML blocks would be produced if naive prepend is used. Expected: FR-06.3 merge logic detects the existing `---` fence and inserts the `date:` field inside it. No duplicate `---` fences in the output.

**EC-07: Template file contains a `date:` field already** — The template has `date: {{date}}` or even `date: 2020-01-01` (a hardcoded value). Expected: the injected `date:` overwrites whatever value was in the template (FR-06.3 merge). The final note has exactly one `date:` field with the correct computed date.

**EC-08: Template token substitution with a malformed format suffix** — User writes `{{date:NOT_A_FORMAT}}`. Expected: Moment.js will produce a string (potentially nonsensical but not an exception). The token is substituted with whatever Moment.js returns; no crash.

**EC-09: Template file is very large (>500 KB)** — A template with embedded images or extensive content. Expected: the plugin reads the file and proceeds; there is no per-template size cap (the 500 KB limit applies to user plugins, not template files). However, a `console.warn` is emitted for template files larger than 100 KB to alert the developer.

**EC-10: "Open Today" invoked when today's note is already open as the active tab** — Expected: `switchToTab` is called; the tab gets focus. No duplicate tab is created. No error.

**EC-11: "Open Today" invoked when today's note is already open but not the active tab** — Expected: `switchToTab` finds the existing tab and switches to it. No new file write occurs. No duplicate tab.

**EC-12: "Open Previous Day" invoked from a tab that is not a daily note** — The active tab is `readme.md`. Expected: "previous day" falls back to yesterday relative to today (FR-03.2). The command succeeds. No error.

**EC-13: "Open Previous Day" invoked on January 1** — Expected: correctly navigates to December 31 of the previous year. Date arithmetic uses a proper Date API subtraction, not string manipulation. No off-by-one.

**EC-14: "Open Next Day" invoked on December 31** — Expected: correctly navigates to January 1 of the following year (same reasoning as EC-13).

**EC-15: "Open Previous Day" invoked on a leap day (Feb 29)** — Expected: navigates to Feb 28. Conversely, navigating next from Feb 28 in a leap year must land on Feb 29, not March 1. Date arithmetic relies on `Date` object subtraction/addition (JavaScript `Date` handles this correctly).

**EC-16: `dateFormat` uses `/` subfolders and the intermediate folder already exists** — Expected: `create_daily_note` does not fail on an already-existing directory. The file is written to the correct leaf path (FR-10.2 idempotency).

**EC-17: `dateFormat` uses `/` subfolders and `check_paths_exist` receives paths with nested directories** — Expected: the existence check works correctly for paths like `/Daily Notes/2026/04/2026-04-23.md`. The Rust command uses `std::path::Path::exists()` which handles nested paths.

**EC-18: Calendar panel — month with 28 days (February non-leap year)** — Expected: the grid renders exactly 28 day cells (plus leading/trailing filler cells from the adjacent months if needed for a full 6-row grid). No off-by-one resulting in a March cell labeled as February.

**EC-19: Calendar panel — `check_paths_exist` fails (Rust error)** — Expected: the existence dots for that month are omitted silently (all cells render without dots). A `console.warn` is emitted. The calendar grid remains interactive; clicking cells still creates/opens notes.

**EC-20: Calendar panel — `check_paths_exist` resolves after the user has already navigated to a different month** — Expected: the stale result is discarded via a generation counter or cancellation flag. The newly-visible month's dots are not overwritten by the previous month's result. No layout corruption.

**EC-21: Calendar panel — rapid month navigation (clicking prev/next many times quickly)** — Expected: each navigation cancels any in-flight `check_paths_exist` call for the previous month. Only the final month's dots are fetched and rendered. No uncaught promise rejection or stale result bleed-through.

**EC-22: Calendar panel — the workspace changes mid-session (user opens a file in a different directory)** — Expected: the next time the calendar panel renders or the user creates a note, the new workspace directory is used. Notes created before the workspace change are not affected.

**EC-23: Calendar panel not visible (collapsed or not assigned to a slot) when "Open Today" is invoked** — Expected: the note opens correctly regardless of whether the calendar panel is visible. The calendar panel is not a dependency for note opening.

**EC-24: Plugin enabled while no sidebar slot is available** — Expected: the panel registers normally but waits for a slot assignment from the user (same behavior as TOC and Backlinks panels). No crash or log error on registration.

**EC-25: `openOnStartup` is true and the app launches with no previous session (no tabs open, no file)** — `__MARKABLE_CURRENT_FILE__` is null. Expected: the plugin silently skips the startup open. No error is thrown and no status bar message is shown. Rationale: the workspace concept (Vaults / File Browser) is not yet implemented in FC3; silent skip is intentional until FC3 items #9/#11 (Vaults/File Browser) establish a persistent workspace root. Once a workspace root exists, this behavior will be revisited. It does not retry `openOnStartup` again during that session.

**EC-26: `openOnStartup` fires when today's note already exists from a previous session (the note is not yet open as a tab)** — Expected: the note is opened in a new tab (or the existing tab is focused if it was already open from a restored session). No duplicate tab. No second write to the file.

**EC-27: `confirmCreate` is enabled and user cancels the confirmation dialog** — Expected: no file is created, no tab is opened. The calendar cell is not highlighted as selected. The dialog is destroyed cleanly.

**EC-28: `confirmCreate` is enabled but the target date is today** — Expected: no confirmation dialog is shown for today (FR-08.6 specifies confirmation only for dates other than today). The note is created/opened immediately.

**EC-29: "Open for Date…" command receives an invalid date string** — E.g. user types `2026-02-30` (February 30 does not exist). Expected: `new Date("2026-02-30")` returns an invalid date; the plugin detects `isNaN(date.getTime())` and shows an inline validation error: "Invalid date." No note is created.

**EC-30: "Open for Date…" natural-language input "yesterday" on January 1** — Expected: correctly resolves to December 31 of the previous year (same date arithmetic as EC-13).

**EC-31: Daily note folder path is an absolute path pointing outside the workspace** — E.g. user sets `dailyNoteFolder` to `/Users/david/Documents/journal`. Expected: the plugin uses the absolute path as-is. `create_daily_note` creates the note at that absolute path. The workspace directory is not prepended. The calendar existence check must also use the absolute path.

**EC-32: Workspace directory path contains spaces or Unicode characters** — E.g. `/Users/david/My Notes/`. Expected: all path construction uses proper path joining (not string concatenation) and the absolute path is passed verbatim to Tauri `invoke`. No URL-encoding or path escaping issues.

**EC-33: Two "Open Today" commands fire in rapid succession (double-click or rapid shortcut)** — Expected: only one file write occurs. A lock/in-flight flag prevents the second invocation from calling `create_daily_note` while the first is still awaiting a Tauri response. Both invocations ultimately open the same note without error.

**EC-34: Plugin is disabled while `create_daily_note` is in flight** — `onDisable` is called while a Tauri file write is still pending. Expected: the plugin's generation counter is incremented on disable. When the Tauri promise resolves, the stale result is discarded silently — no tab is opened, no DOM is modified, no error is thrown.

**EC-35: `dateFormat` produces a filename that already exists as a directory** — E.g. if a directory named `2026-04-23` (no `.md` extension) already exists at the target path, `create_daily_note` would attempt to write `2026-04-23.md` inside a file named `2026-04-23` — not applicable since the `.md` extension is always appended. However, if a directory named `2026-04-23.md` exists (possible via manual creation), the write will fail. Expected: the Rust command returns an error; the plugin surfaces it as a visible notice: "Could not create daily note: path exists as a directory."

**EC-36: The active tab is a daily note and the user renames the file outside Markable** — The tab still shows the old path; `__MARKABLE_CURRENT_FILE__` may be stale. The "selected" calendar cell may be incorrect. Expected: this is a known limitation of the tab system (not specific to this plugin); no special handling required. The issue resolves on the next tab switch or app reload.

**EC-37: Calendar panel "selected" highlight when two tabs have the same date** — Impossible by construction (each date maps to exactly one file path), but if the user has the same file open in two tabs (edge case in the tab system), both tabs show the same daily note. Expected: the "selected" highlight appears on the correct date cell regardless of which of the two identical tabs is active.

**EC-38: `check_paths_exist` is called with an empty path list** — E.g. when the calendar displays a month that has no days mapped to the configured folder (impossible in practice but defensive). Expected: the Rust command returns an empty map without error. The calendar renders with no dots.

**EC-39: Settings panel — `dailyNoteFolder` set to an empty string** — Expected: notes are created directly in the workspace root directory. The empty string is treated as `"."` or equivalent (the workspace directory itself). This is valid and documented in FR-08.1.

**EC-40: Settings panel — `dateFormat` changed while daily notes already exist in the old format** — Expected: existing notes are not renamed or moved. The settings panel shows a static informational note: "Changing date format does not rename existing notes." The calendar existence dots for the current month will appear missing until the user creates new notes in the new format.

---

## Resolved Decisions

**AD-01 — One plugin, not two**: Markable implements Daily Note + Calendar as a single plugin (`daily-note.plugin.ts`) rather than mirroring Obsidian's Daily Notes + Calendar split. The calendar is not meaningful without daily notes, and the configuration is shared. One settings panel, one enable/disable toggle.

**AD-02 — Obsidian-compatible token set**: Markable uses Obsidian-style tokens (`{{date}}`, `{{date:FORMAT}}`, `{{time}}`, `{{title}}`, `{{week}}`, `{{year}}`, `{{month}}`, `{{day}}`, etc.) for familiarity and migration-friendliness. The `dn-` prefix originally proposed was dropped in favour of this convention. Tokens not in the supported set are passed through verbatim, ensuring forward compatibility with other template systems.

**AD-03 — No Templater compatibility**: Templater's `<% %>` syntax requires a JavaScript runtime evaluator, which is out of scope. Users who need Templater-style scripting are power users who can compose their templates using the supported `{{date}}` / `{{time}}` / `{{title}}` tokens for date substitution and plain Markdown for everything else.

**AD-04 — Subfolder support via `/` in dateFormat**: This is direct parity with Obsidian's behavior and is the most common user request for date organization (year/month subfolders). The mechanism (splitting the format string on `/`) is simple and requires no extra settings field.

**AD-05 — `check_paths_exist` as a general-purpose batch Rust command**: Checking 28–31 file existence values one invoke per file would be expensive. A single batch call is the correct approach. The command is named `check_paths_exist` (not `check_files_exist`) and returns a `HashMap<String, bool>` so it is reusable by any future feature that needs multi-path existence checks. This is a new Rust command (two new commands total in FR-10.1).

**AD-06 — No weekly/monthly notes in this spec**: Periodic notes are a separate, larger feature. Shipping daily notes first delivers immediate value and keeps the scope reviewable. The sidebar week number column is display-only as a foundation for a future weekly notes feature.

**AD-07 — `confirmCreate` defaults to false**: Most users want frictionless creation. The setting exists for users who have accidentally created large numbers of spurious future notes (a common Obsidian complaint). Defaulting to off keeps the fast path fast.

**AD-08 — `openOnStartup` defaults to false**: Some users do not want Markable to immediately create a file on every launch. The setting is discoverable but off by default.

---

## Proposed Constraints

1. The plugin must not perform any synchronous file I/O on the main thread. All Tauri `invoke` calls must be `await`ed inside `async` functions.
2. All date arithmetic must use JavaScript's `Date` object (or a utility function wrapping it), never string manipulation. String manipulation for date math is the root cause of the Obsidian next/previous hotkey subfolder bug.
3. The `create_daily_note` Rust command must use the temp-file-swap pattern (write to `<path>.tmp`, then rename) consistent with Markable's atomic-save convention.
4. Path construction must use proper OS path joining (Rust's `std::path::PathBuf` on the Rust side; a dedicated `joinPath` utility on the TypeScript side), never string concatenation with `/`.
5. All user-facing error notices must be dismissible and must not block the editor. Use the status bar message pattern (if available) or an inline notice inside the calendar panel.
6. The calendar panel must never trigger a re-render during a CM6 `update` cycle. Panel updates are driven by tab-change events and user interactions, not by editor state updates.
7. A generation counter pattern (same as used in the Command Bar's async file fetch) must be used to guard all async Tauri calls against stale results after bar-close, month-navigation, or plugin-disable.
