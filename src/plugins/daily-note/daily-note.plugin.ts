/**
 * IIFE entry point for the Daily Note core plugin.
 *
 * Compiled by vite.plugins.config.ts and scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/daily-note.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: no app-internal imports at runtime. All Tauri interaction
 * goes through window.__TAURI_INTERNALS__.invoke. Settings are loaded and saved via
 * the api parameter (api.loadSettings / api.saveSettings).
 *
 * This file implements Steps 03–05 of the Daily Note feature:
 *   Step 03: Settings types/defaults, loadAndMergeSettings, renderDetailExtra,
 *            stub onEnable/onDisable.
 *   Step 04: openDailyNote (single shared code path for all entry points),
 *            registerCommands/unregisterCommands, openPrevDay, openNextDay,
 *            getCurrentDailyNoteDate, openForDatePrompt, showNotice,
 *            confirmCreateDialog, expanded onEnable/onDisable.
 *   Step 05: Calendar sidebar panel — renderCalendarPanel, navigateMonth,
 *            navigateToToday, resolveDotsAsync, applyDots, updateSelectedCell,
 *            registerSidebarPanel, unregisterSidebarPanel, keyboard navigation,
 *            tab-change listener, invalidateMonthCache (full impl), toggleCalendarPanel.
 *
 * Spec: docs/specs/daily-note/step_03_plugin_scaffold_settings.md
 *       docs/specs/daily-note/step_04_core_actions_commands.md
 *       docs/specs/daily-note/step_05_calendar_sidebar.md
 */

// Type-only import — erased by tsc; safe for IDE type checking.
import type { MarkablePluginAPI } from "../markable-plugin-api";

// Pure utility imports — bundled into the IIFE at build time by Vite/Rollup.
// These modules have no window globals, so they are safe to import statically.
import {
  validateDateFormat,
  buildNotePath,
  formatDate,
  addDays,
  isSameDay,
  parseNaturalDate,
  parseDateFromFilename,
} from "./date-utils";
import { substituteTokens } from "./template-tokens";
import { injectFrontMatter } from "./frontmatter";
import { buildCalendarGrid } from "./calendar-grid";
import type { SidebarPanelDescriptor } from "../markable-plugin-api";
import { buildToggleRow, buildSelectRow, buildTextRow } from "../../settings/settings-fields";

// ── Settings types and defaults ───────────────────────────────────────────────

/**
 * Persisted settings shape for the Daily Note plugin.
 *
 * All fields are serialised to JSON by api.saveSettings() and restored by
 * api.loadSettings(). loadAndMergeSettings() fills in missing fields from
 * DEFAULT_SETTINGS and validates the values that can be invalid.
 */
export interface DailyNoteSettings {
  /** Relative (to workspace) or absolute folder for daily notes. Default: "Daily Notes". */
  dailyNoteFolder: string;
  /** Moment.js-compatible date format used as the note filename. Default: "YYYY-MM-DD". */
  dateFormat: string;
  /** When true, today's note is opened automatically at app start. Default: false. */
  openOnStartup: boolean;
  /** Absolute path to a Markdown template file. Empty string means no template. */
  templateFilePath: string;
  /** When true, a date: field is injected into (or merged into) the note's YAML front matter. */
  injectFrontMatter: boolean;
  /** When true, a confirmation dialog is shown before creating a note for a non-today date. */
  confirmCreate: boolean;
  /** Which day is the first day of the week in the calendar grid. */
  firstDayOfWeek: "monday" | "sunday";
  /** When true, an ISO week number column is shown in the calendar sidebar panel. */
  showWeekNumbers: boolean;
}

/**
 * Factory defaults returned when no stored settings exist (first run).
 *
 * These values are also used as individual field fallbacks when a stored value
 * is present but fails validation (e.g. an illegal dateFormat, an unrecognised
 * firstDayOfWeek enum value).
 */
const DEFAULT_SETTINGS: DailyNoteSettings = {
  dailyNoteFolder: "Daily Notes",
  dateFormat: "YYYY-MM-DD",
  openOnStartup: false,
  templateFilePath: "",
  injectFrontMatter: false,
  confirmCreate: false,
  firstDayOfWeek: "monday",
  showWeekNumbers: false,
};

// ── Module-level state ────────────────────────────────────────────────────────
// These variables are private to the IIFE closure after bundling. They are not
// visible outside the new Function() scope at runtime.

/**
 * Current persisted settings. Populated in onEnable; kept in sync by UI handlers.
 *
 * Must remain a module-level `let` so that UI change handlers can mutate it in
 * place and have the mutation visible to subsequent handlers in the same cycle.
 */
let _settings: DailyNoteSettings = { ...DEFAULT_SETTINGS };

/**
 * Guards the async onEnable continuation against a race with onDisable (EC-10).
 * Set true at the start of onEnable; set false at the start of onDisable.
 * The onEnable continuation checks this before proceeding after each await.
 */
let _active = false;

/**
 * Plugin API reference. Set in onEnable, cleared in onDisable.
 * Used by renderDetailExtra so that settings change handlers can call
 * api.saveSettings() without receiving the api as a parameter.
 */
let _api: MarkablePluginAPI | null = null;

/**
 * Generation counter — incremented in onDisable.
 *
 * Any async operation (e.g. template file existence check) captures _generation
 * at the start of the call and discards the result if the counter has changed
 * by the time the await resolves (AD-D, EC-34). Shared with the calendar panel
 * in Steps 04–05 (dot-indicator generation guard, AD-D).
 */
let _generation = 0;

/**
 * In-flight guard for openDailyNote.
 *
 * Prevents concurrent invocations of openDailyNote() (EC-33, AD-E). Set true
 * at the top of openDailyNote and cleared in its finally block. onDisable also
 * clears it so a stale true value from a crashed call never blocks future opens.
 */
let _inFlight = false;

// ── Step 05: Calendar sidebar state ──────────────────────────────────────────

/**
 * The year currently displayed in the calendar panel.
 * Initialised to the current year; mutated by navigateMonth / navigateToToday.
 */
let _calYear = new Date().getFullYear();

/**
 * The 0-indexed month currently displayed in the calendar panel (0 = January).
 * Initialised to the current month; mutated by navigateMonth / navigateToToday.
 */
let _calMonth = new Date().getMonth();

/**
 * Dot-existence cache: maps absolute note path → true/false.
 *
 * Populated by resolveDotsAsync() after a successful check_paths_exist call.
 * Invalidated (replaced with a new empty Map) on any month navigation and when
 * a new note is created in the currently displayed month (invalidateMonthCache).
 *
 * Using a Map rather than a plain object preserves insertion order for iteration
 * and allows O(1) lookup by absolute path string.
 */
let _dotCache: Map<string, boolean> = new Map();

/**
 * Generation counter for the async check_paths_exist call.
 *
 * Separate from _generation (the plugin-level lifecycle counter). Incremented
 * on every month navigation and on invalidateMonthCache. Each resolveDotsAsync
 * call captures the counter at start and discards its result if the counter has
 * changed by the time check_paths_exist returns (AD-D, EC-20, EC-21).
 */
let _dotGeneration = 0;

/**
 * Reference to the calendar panel content container.
 *
 * Set in the SidebarPanelDescriptor.render() callback; cleared to null in
 * destroy(). Used by navigateMonth, applyDots, and updateSelectedCell to
 * access the live DOM without passing the element through every call stack.
 *
 * Null when the panel is not mounted (plugin disabled, no sidebar slot).
 */
let _calContainer: HTMLElement | null = null;

/**
 * The 0-based index of the focused cell within the 42-cell flat array.
 *
 * Maintained by keyboard navigation so that ArrowLeft/ArrowRight/Up/Down,
 * Home, and End can compute the next cell index without a DOM query.
 * Initialised to -1 (no cell focused).
 */
let _focusedCellIndex = -1;

/**
 * Tab-change listener reference stored so it can be removed in onDisable.
 *
 * Passed to tabManager.onTabChange() in attachTabChangeListener(); removed via
 * tabManager.offTabChange() in detachTabChangeListener().
 */
let _tabChangeListener: (() => void) | null = null;

// ── Pure settings helpers ─────────────────────────────────────────────────────

/**
 * Merge raw settings from api.loadSettings() with DEFAULT_SETTINGS.
 *
 * Validation rules applied per field:
 *   - `dateFormat`:     must pass validateDateFormat() (no illegal filename chars,
 *                       EC-04). Falls back to default + logs a console.warn.
 *   - `firstDayOfWeek`: must be 'monday' or 'sunday'. Falls back to 'monday'.
 *   - All boolean fields: raw value must be typeof boolean, else default is used.
 *   - `dailyNoteFolder`, `templateFilePath`: raw value must be typeof string.
 *
 * Unknown keys in raw are silently ignored (forward compatibility, Test 75).
 *
 * Exported for unit testing (the returned object is fully typed and validated).
 *
 * @param raw - The return value of api.loadSettings(), or null.
 * @returns   A fully-populated DailyNoteSettings with valid, clamped values.
 */
export function loadAndMergeSettings(
  raw: Record<string, unknown> | null
): DailyNoteSettings {
  // Null means first run — return a clean copy of defaults.
  if (!raw) return { ...DEFAULT_SETTINGS };

  // ── dailyNoteFolder ──────────────────────────────────────────────────────
  // Accept any string value (path validity is deferred to note creation).
  const dailyNoteFolder =
    typeof raw.dailyNoteFolder === "string"
      ? raw.dailyNoteFolder
      : DEFAULT_SETTINGS.dailyNoteFolder;

  // ── dateFormat ───────────────────────────────────────────────────────────
  // Must not contain macOS HFS+ illegal filename characters (EC-04).
  let dateFormat = DEFAULT_SETTINGS.dateFormat;
  if (typeof raw.dateFormat === "string") {
    const err = validateDateFormat(raw.dateFormat);
    if (err !== null) {
      // Illegal characters found — warn and fall back to default.
      console.warn(
        `[daily-note] Stored dateFormat "${raw.dateFormat}" is invalid: ${err}. ` +
          `Falling back to default "${DEFAULT_SETTINGS.dateFormat}".`
      );
    } else {
      dateFormat = raw.dateFormat;
    }
  }

  // ── openOnStartup ────────────────────────────────────────────────────────
  const openOnStartup =
    typeof raw.openOnStartup === "boolean"
      ? raw.openOnStartup
      : DEFAULT_SETTINGS.openOnStartup;

  // ── templateFilePath ─────────────────────────────────────────────────────
  const templateFilePath =
    typeof raw.templateFilePath === "string"
      ? raw.templateFilePath
      : DEFAULT_SETTINGS.templateFilePath;

  // ── injectFrontMatter ────────────────────────────────────────────────────
  const injectFrontMatter =
    typeof raw.injectFrontMatter === "boolean"
      ? raw.injectFrontMatter
      : DEFAULT_SETTINGS.injectFrontMatter;

  // ── confirmCreate ────────────────────────────────────────────────────────
  const confirmCreate =
    typeof raw.confirmCreate === "boolean"
      ? raw.confirmCreate
      : DEFAULT_SETTINGS.confirmCreate;

  // ── firstDayOfWeek ───────────────────────────────────────────────────────
  // Only 'monday' and 'sunday' are accepted enum values.
  const validFirstDays: Array<DailyNoteSettings["firstDayOfWeek"]> = [
    "monday",
    "sunday",
  ];
  const firstDayOfWeek = validFirstDays.includes(
    raw.firstDayOfWeek as DailyNoteSettings["firstDayOfWeek"]
  )
    ? (raw.firstDayOfWeek as DailyNoteSettings["firstDayOfWeek"])
    : DEFAULT_SETTINGS.firstDayOfWeek;

  // ── showWeekNumbers ──────────────────────────────────────────────────────
  const showWeekNumbers =
    typeof raw.showWeekNumbers === "boolean"
      ? raw.showWeekNumbers
      : DEFAULT_SETTINGS.showWeekNumbers;

  // Return a new object containing only the known DailyNoteSettings keys.
  // Unknown keys from `raw` are intentionally excluded (forward compatibility).
  return {
    dailyNoteFolder,
    dateFormat,
    openOnStartup,
    templateFilePath,
    injectFrontMatter,
    confirmCreate,
    firstDayOfWeek,
    showWeekNumbers,
  };
}

// ── Step 04: Core action helpers ─────────────────────────────────────────────

/**
 * Resolve the workspace directory from the currently open file.
 *
 * Returns the directory portion of `__MARKABLE_CURRENT_FILE__`, or null if no
 * file is open (EC-01). The workspace is used as the base for resolving relative
 * `dailyNoteFolder` values.
 *
 * @returns Absolute path of the workspace directory, or null.
 */
function resolveWorkspaceDir(): string | null {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!currentFile) return null;
  // Extract directory: everything before the last '/'.
  const lastSlash = currentFile.lastIndexOf("/");
  if (lastSlash < 0) return null;
  return currentFile.slice(0, lastSlash);
}

/**
 * Show a user-facing informational or error notice.
 *
 * Injects a temporary floating div into document.body that auto-dismisses
 * after 4 seconds. Uses only CSS variables so it respects the active theme.
 * Falls back to console.warn if DOM injection fails.
 *
 * This function must never throw (called from catch blocks and error paths).
 *
 * @param message - The message to display.
 */
function showNotice(message: string): void {
  try {
    console.warn(`[daily-note] ${message}`);

    // Reuse an existing notice element if one is already visible.
    const existingId = "__dn_notice__";
    let el = document.getElementById(existingId);
    if (!el) {
      el = document.createElement("div");
      el.id = existingId;
      // Positioned in the bottom-right corner, above the status bar.
      el.style.cssText = [
        "position: fixed",
        "bottom: 48px",
        "right: 16px",
        "z-index: 9999",
        "padding: 8px 12px",
        "border-radius: 4px",
        "background: var(--bg-secondary, #2c2c2c)",
        "border: 1px solid var(--border-color, #555)",
        "font-family: var(--ui-font, system-ui, sans-serif)",
        "font-size: 13px",
        "color: var(--text-color, #eee)",
        "max-width: 320px",
        "word-wrap: break-word",
        "box-shadow: 0 2px 8px rgba(0,0,0,0.3)",
      ].join(";");
      document.body.appendChild(el);
    }
    el.textContent = message;

    // Auto-dismiss after 4 seconds.
    setTimeout(() => {
      document.getElementById(existingId)?.remove();
    }, 4000);
  } catch (_err) {
    // If DOM manipulation fails for any reason, the message was already console.warn'd.
  }
}

/**
 * Show a native (or browser fallback) confirmation dialog.
 *
 * Uses `window.__TAURI_DIALOG__.confirm` when available (native macOS dialog),
 * falling back to `window.confirm` in browser/test environments.
 *
 * @param formattedDate - Human-readable date string shown in the dialog message.
 * @returns true if the user confirmed, false if they cancelled (EC-27).
 */
async function confirmCreateDialog(formattedDate: string): Promise<boolean> {
  const message = `Create daily note for ${formattedDate}?`;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const dialog = (window as any).__TAURI_DIALOG__;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (dialog?.confirm) {
    return await dialog.confirm(message, { title: "Create Daily Note", kind: "info" });
  }
  // Fallback: browser confirm (used in tests and web previews).
  return window.confirm(message);
}

/**
 * Invalidate the calendar dot cache for the displayed month when a new note
 * is created in that month.
 *
 * Called by openDailyNote() after a successful create_daily_note Tauri call.
 * If the newly created note falls within the currently displayed month, the
 * dot cache is cleared and a new async resolution is triggered so the dot
 * indicator appears immediately. Notes in other months are silently ignored
 * (the cache for the other month will be rebuilt when the user navigates to it).
 *
 * EC-34: the _dotGeneration increment acts as a generation fence — if the user
 * navigates away while resolveDotsAsync is in flight, the result is discarded.
 *
 * @param date - The date of the newly created (or opened) note.
 */
function invalidateMonthCache(date: Date): void {
  // Only invalidate when the new note is in the currently displayed month.
  if (date.getFullYear() === _calYear && date.getMonth() === _calMonth) {
    _dotCache = new Map();
    _dotGeneration++;
    // Trigger a fresh async resolution so the dot appears without requiring
    // the user to navigate away and back.
    if (_calContainer) void resolveDotsAsync();
  }
}

/**
 * Toggle the calendar sidebar panel visibility.
 *
 * Delegates to api.toggleSidebarPanel() when the API method is available.
 * The MarkablePluginAPI interface does not expose toggleSidebarPanel directly;
 * we use a type assertion to call the method when it exists at runtime.
 *
 * This function is intentionally minimal — the sidebar system owns the
 * show/hide state. The plugin only requests the toggle.
 */
function toggleCalendarPanel(): void {
  if (_api && typeof (_api as unknown as Record<string, unknown>).toggleSidebarPanel === "function") {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (_api as any).toggleSidebarPanel("daily-note-calendar");
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}

/**
 * Determine the date of the currently active daily note.
 *
 * Extracts the filename from `__MARKABLE_CURRENT_FILE__` and attempts to parse
 * a date from it using the configured `dateFormat`. Returns null when:
 *   - No file is open.
 *   - The active file's name does not match the date format (EC-12).
 *
 * Callers use `?? new Date()` to fall back to today when this returns null.
 *
 * @returns The parsed Date, or null if the active tab is not a daily note.
 */
function getCurrentDailyNoteDate(): Date | null {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!currentFile) return null;
  // Extract just the filename (last segment after any path separator).
  const filename = currentFile.split("/").pop() ?? "";
  return parseDateFromFilename(filename, _settings.dateFormat);
}

/**
 * Open the daily note for the given date.
 *
 * This is the single shared code path for all entry points (AD-E):
 *   - Open Today command (Cmd-Opt-T)
 *   - Open Previous Day command (Cmd-Opt-Left)
 *   - Open Next Day command (Cmd-Opt-Right)
 *   - Calendar cell click (Step 05)
 *   - "Open for Date…" prompt
 *   - openOnStartup (Step 06)
 *
 * Guards:
 *   - EC-33: _inFlight prevents concurrent invocations.
 *   - EC-01: no workspace → shows notice, returns.
 *   - EC-10/EC-11: note already open → switches to tab, no write.
 *   - EC-27: confirmCreate + user cancelled → returns.
 *   - EC-05: template not found → creates empty note.
 *   - EC-09: oversized template → warns but proceeds.
 *   - EC-34: _generation check after every await discards stale results.
 *   - EC-35: Rust returns error → shows notice, returns.
 *
 * @param date - The date to open a note for.
 */
async function openDailyNote(date: Date): Promise<void> {
  // EC-33: guard against concurrent invocations (AD-E).
  if (_inFlight) return;
  _inFlight = true;

  // Capture the generation counter BEFORE the first await so that EC-34 checks
  // downstream can detect if onDisable() was called while we were awaiting.
  const gen = _generation;

  try {
    // EC-01: workspace unknown — cannot build a note path without a workspace.
    const workspaceDir = resolveWorkspaceDir();
    if (!workspaceDir) {
      showNotice("Open a file first to set the workspace for daily notes.");
      return;
    }

    // Compute the absolute path for this date using the configured settings.
    const absolutePath = buildNotePath(date, workspaceDir, _settings);

    // FR-08.6: show a confirmation dialog for non-today dates when confirmCreate
    // is enabled. EC-28: today is always bypassed.
    if (_settings.confirmCreate && !isSameDay(date, new Date())) {
      const formattedDate = formatDate(date, _settings.dateFormat);
      const confirmed = await confirmCreateDialog(formattedDate);

      // EC-34: check generation after the dialog await.
      if (_generation !== gen) return;
      // EC-27: user cancelled.
      if (!confirmed) return;
    }

    // Require the tab manager to open the note after creation.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!tabManager) {
      showNotice("Tab manager not available.");
      return;
    }

    // EC-10/EC-11: check whether a tab for this path is already open.
    // getAllTabs() may return an empty array for tab managers that don't support it.
    const existingTab = tabManager.getAllTabs?.()?.find(
      // The filePath property is set on tab descriptors by the tab manager.
      (t: { filePath?: string }) => t.filePath === absolutePath
    );
    if (existingTab) {
      // The note is already open — just switch to it (no write needed).
      tabManager.switchToTab?.(existingTab.id);
      return;
    }

    // Determine the initial content for a new note.
    // An empty string is used when there is no template or the template is missing.
    let content = "";

    if (_settings.templateFilePath) {
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const templateContent: string = await (window as any).__TAURI_INTERNALS__
          .invoke("read_file", { path: _settings.templateFilePath });
        /* eslint-enable @typescript-eslint/no-explicit-any */

        // EC-34: check generation after the template file read.
        if (_generation !== gen) return;

        // EC-09: warn for large templates (>100 KB) but proceed regardless.
        if (templateContent.length > 100_000) {
          console.warn("[daily-note] Template file is large (>100 KB); proceeding.");
        }
        content = templateContent;
      } catch (_err) {
        // EC-05: template file missing or unreadable → create an empty note.
        // This is a warn, not an error — missing templates are a common scenario
        // (e.g. the user moved the file after configuring it).
        console.warn("[daily-note] Template file not found; creating empty note.");
        content = "";
      }
    }

    // Substitute {{token}} placeholders in the template content (FR-05).
    content = substituteTokens(content, {
      date,
      dateFormat: _settings.dateFormat,
    });

    // Inject the `date:` YAML front-matter field if the setting is enabled (FR-06).
    if (_settings.injectFrontMatter) {
      const dateStr = formatDate(date, "YYYY-MM-DD");
      content = injectFrontMatter(content, dateStr);
    }

    // Create the note file via the Rust command (combines mkdir + atomic write).
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await (window as any).__TAURI_INTERNALS__
        .invoke("create_daily_note", { path: absolutePath, content });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    } catch (err: unknown) {
      // EC-34: plugin was disabled while the Tauri call was in flight.
      if (_generation !== gen) return;
      // EC-35 and other write errors — surface to the user.
      const msg = typeof err === "string" ? err
        : err instanceof Error ? err.message
        : String(err);
      showNotice(`Could not create daily note: ${msg}`);
      return;
    }

    // EC-34: final generation check before touching the tab manager.
    if (_generation !== gen) return;

    // Open the note in a new tab.
    tabManager.openFile(absolutePath);

    // Notify the calendar panel (Step 05 will fill this in).
    invalidateMonthCache(date);

  } finally {
    // Always clear the in-flight flag, even on early return or exception.
    _inFlight = false;
  }
}

/**
 * Open the daily note for the day before the currently active note.
 *
 * Falls back to today when the active tab is not a recognisable daily note (EC-12).
 * The fallback means pressing Prev Day from any non-note tab is equivalent to
 * pressing "Open Yesterday".
 */
async function openPrevDay(): Promise<void> {
  const date = getCurrentDailyNoteDate() ?? new Date();
  void openDailyNote(addDays(date, -1));
}

/**
 * Open the daily note for the day after the currently active note.
 *
 * Falls back to today when the active tab is not a recognisable daily note (EC-12).
 */
async function openNextDay(): Promise<void> {
  const date = getCurrentDailyNoteDate() ?? new Date();
  void openDailyNote(addDays(date, 1));
}

/**
 * Show a floating overlay prompt for "Open for Date…".
 *
 * The overlay accepts ISO 8601 dates ("YYYY-MM-DD") and natural-language aliases
 * ("today", "yesterday", "tomorrow"). Invalid input shows an inline error (EC-29).
 * Pressing Escape or clicking Cancel closes the overlay without navigating (FR-04.3).
 *
 * Double-instantiation guard: if the prompt is already open, focus it and return.
 *
 * EC-30: "yesterday" on Jan 1 is handled correctly by parseNaturalDate.
 */
function openForDatePrompt(): void {
  const PROMPT_ID = "dn-date-prompt";

  // Double-instantiation guard.
  const existing = document.getElementById(PROMPT_ID);
  if (existing) {
    (existing.querySelector("input") as HTMLInputElement | null)?.focus();
    return;
  }

  // Outer container — fixed overlay, centred horizontally at 40% from top.
  const container = document.createElement("div");
  container.id = PROMPT_ID;
  container.style.cssText = [
    "position: fixed",
    "top: 40%",
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 10000",
    "padding: 16px",
    "background: var(--bg-primary, #fff)",
    "border: 1px solid var(--border-color, #ccc)",
    "border-radius: 6px",
    "font-family: var(--ui-font, system-ui, sans-serif)",
    "min-width: 300px",
    "box-shadow: 0 4px 16px rgba(0,0,0,0.2)",
  ].join(";");

  // Label text.
  const label = document.createElement("div");
  label.textContent = "Open daily note for date:";
  label.style.cssText = "font-size: 13px; margin-bottom: 8px; color: var(--text-color, inherit);";

  // Text input — accepts natural dates or ISO 8601.
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "YYYY-MM-DD or today / yesterday / tomorrow";
  input.style.cssText = [
    "width: 100%",
    "box-sizing: border-box",
    "padding: 4px 8px",
    "font-size: 13px",
    "font-family: var(--ui-font, system-ui, sans-serif)",
    "border: 1px solid var(--border-color, #ccc)",
    "border-radius: 4px",
    "background: var(--input-bg, #fff)",
    "color: var(--text-color, inherit)",
    "margin-bottom: 4px",
  ].join(";");

  // Inline error span (initially hidden).
  const errorSpan = document.createElement("span");
  errorSpan.style.cssText = "font-size: 11px; color: var(--error-color, #e74c3c); display: none;";
  errorSpan.textContent = "Invalid date.";

  // Button row.
  const buttonRow = document.createElement("div");
  buttonRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;";

  const openBtn   = document.createElement("button");
  openBtn.type    = "button";
  openBtn.textContent = "Open";
  openBtn.style.cssText = "font-size: 13px; padding: 3px 10px; cursor: pointer;";

  const cancelBtn = document.createElement("button");
  cancelBtn.type  = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "font-size: 13px; padding: 3px 10px; cursor: pointer;";

  buttonRow.appendChild(cancelBtn);
  buttonRow.appendChild(openBtn);

  container.appendChild(label);
  container.appendChild(input);
  container.appendChild(errorSpan);
  container.appendChild(buttonRow);
  document.body.appendChild(container);

  // Auto-focus the input so the user can type immediately.
  input.focus();

  /** Remove the overlay from the DOM. */
  function close(): void {
    document.getElementById(PROMPT_ID)?.remove();
  }

  /**
   * Parse the current input value and navigate if valid.
   * Shows the inline error span for invalid input (EC-29).
   */
  function attemptOpen(): void {
    const parsed = parseNaturalDate(input.value.trim());
    if (!parsed) {
      // EC-29: invalid date — show inline error.
      errorSpan.style.display = "";
      input.focus();
      return;
    }
    close();
    void openDailyNote(parsed);
  }

  openBtn.addEventListener("click", () => attemptOpen());
  cancelBtn.addEventListener("click", () => close());

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter")  { e.preventDefault(); attemptOpen(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  // Hide the error span again whenever the user modifies the input.
  input.addEventListener("input", () => {
    errorSpan.style.display = "none";
  });
}

/**
 * Register all five Daily Note commands in `window.__MARKABLE_COMMANDS__`.
 *
 * The commands are pushed to the array that the Command Bar reads from
 * (`__MARKABLE_COMMANDS__`). The `action` on each command directly invokes the
 * relevant function rather than routing through `__MARKABLE_HANDLE_ACTION__`,
 * because the daily-note commands are not part of the static keybindings-panel
 * COMMANDS array.
 *
 * `unregisterCommands` is the matching teardown called from onDisable.
 */
function registerCommands(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cmds: any[] = (window as any).__MARKABLE_COMMANDS__ ?? [];

  cmds.push(
    {
      id: "daily-note-today",
      label: "Daily Note: Open Today",
      defaultKey: "Cmd-Opt-T",
      section: "Daily Note",
      /** Opens today's daily note. Never context-invalid (FR-09.2). */
      action: () => { void openDailyNote(new Date()); },
    },
    {
      id: "daily-note-prev",
      label: "Daily Note: Open Previous Day",
      defaultKey: "Cmd-Opt-Left",
      section: "Daily Note",
      /** Opens the day before the current daily note (or yesterday as fallback). */
      action: () => { void openPrevDay(); },
    },
    {
      id: "daily-note-next",
      label: "Daily Note: Open Next Day",
      defaultKey: "Cmd-Opt-Right",
      section: "Daily Note",
      /** Opens the day after the current daily note (or tomorrow as fallback). */
      action: () => { void openNextDay(); },
    },
    {
      id: "daily-note-for-date",
      label: "Daily Note: Open for Date\u2026",
      defaultKey: null,
      section: "Daily Note",
      /** Shows the date prompt overlay (FR-04). */
      action: () => { openForDatePrompt(); },
    },
    {
      id: "daily-note-toggle-calendar",
      label: "Daily Note: Toggle Calendar Panel",
      defaultKey: null,
      section: "Daily Note",
      /** Toggles the calendar sidebar panel (Step 05 will fill this in). */
      action: () => { toggleCalendarPanel(); },
    }
  );

  // Write back in case the global was null (unlikely but defensive).
  (window as any).__MARKABLE_COMMANDS__ = cmds;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Remove all Daily Note commands from `window.__MARKABLE_COMMANDS__`.
 *
 * Filters out every entry whose `id` starts with `"daily-note-"`. Called in
 * onDisable so the Command Bar no longer shows these commands after the plugin
 * is toggled off.
 */
function unregisterCommands(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_COMMANDS__ = (
    ((window as any).__MARKABLE_COMMANDS__ ?? []) as any[]
  ).filter((cmd: any) => !String(cmd.id ?? "").startsWith("daily-note-"));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Register a `keydown` listener on `document` for the three default keybindings.
 *
 * Because the Daily Note plugin is an IIFE loaded at runtime, its commands are
 * NOT part of the static `COMMANDS` array in `keybindings-panel.ts` that the
 * `resolveAction` function iterates. We therefore install our own document-level
 * listener here, using the same Cmd+Opt modifier pattern as other Daily Note keys.
 *
 * The listener is stored in `_keydownHandler` so it can be removed in onDisable.
 *
 * Key mappings (FR-03):
 *   Cmd-Opt-T     → Open Today
 *   Cmd-Opt-Left  → Open Previous Day
 *   Cmd-Opt-Right → Open Next Day
 */
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

function registerKeydownListener(): void {
  _keydownHandler = (e: KeyboardEvent) => {
    // Only respond when the command bar is not open — prevents stealing focus
    // while the user is typing a search query.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if ((window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__) return;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (e.defaultPrevented) return;

    const isMeta = e.metaKey;
    const isOpt  = e.altKey;
    const noShift = !e.shiftKey;
    const noCtrl  = !e.ctrlKey;

    if (isMeta && isOpt && noShift && noCtrl) {
      if (e.key === "t" || e.key === "T" || e.key === "\u2020" /* Opt+T */) {
        e.preventDefault();
        e.stopPropagation();
        void openDailyNote(new Date());
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        void openPrevDay();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        void openNextDay();
        return;
      }
    }
  };

  // Capture phase so we intercept before CM6 and before the main.ts keydown handler.
  document.addEventListener("keydown", _keydownHandler, true);
}

/**
 * Remove the document-level keydown listener registered by `registerKeydownListener`.
 * Called in onDisable.
 */
function unregisterKeydownListener(): void {
  if (_keydownHandler) {
    document.removeEventListener("keydown", _keydownHandler, true);
    _keydownHandler = null;
  }
}

// ── Step 05: Calendar sidebar panel ──────────────────────────────────────────

/**
 * Build the day-of-week header abbreviations for the calendar grid.
 *
 * Returns 7 abbreviated day names starting from the configured first day of
 * the week. Monday-first: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].
 * Sunday-first: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].
 *
 * @param firstDay - Which day should appear in column 0.
 * @returns Array of 7 two-letter abbreviations.
 */
function buildDowHeaders(firstDay: "monday" | "sunday"): string[] {
  // Full week starting from Sunday (JS Date.getDay() = 0 for Sunday).
  const ALL_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  // Monday-first: rotate by 1 so Monday (index 1) moves to position 0.
  if (firstDay === "monday") {
    return [...ALL_DAYS.slice(1), ALL_DAYS[0]];
  }
  return ALL_DAYS;
}

/**
 * Render the full calendar panel DOM into `container`.
 *
 * Implements the two-paint strategy (AD-D, FR-07.3):
 *   Paint 1 (sync):  Build and insert the full grid HTML. Cells get `data-date`
 *                    attributes; today's cell gets `.dn-cal-today`; the cell
 *                    matching the active tab gets `.dn-cal-selected`.
 *   Paint 2 (async): `resolveDotsAsync()` is called after the sync render.
 *                    It fires a single `check_paths_exist` batch call and
 *                    applies `.dn-cal-dot` visibility to matching cells.
 *
 * This function must never be called inside a CM6 `update` cycle (FR-06.6).
 * It is only called from the sidebar `render` callback, `navigateMonth`, and
 * the Tab-change listener — none of which occur inside an editor dispatch.
 *
 * @param container - The sidebar panel content element to populate.
 */
function renderCalendarPanel(container: HTMLElement): void {
  // Clear any previous render.
  container.innerHTML = "";

  const grid = buildCalendarGrid(_calYear, _calMonth, _settings.firstDayOfWeek);

  // ── Root wrapper ──────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "dn-cal-root";

  // ── Month/year header ─────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "dn-cal-header";

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const title = document.createElement("span");
  title.className = "dn-cal-month-title";
  title.textContent = `${MONTH_NAMES[_calMonth]} ${_calYear}`;
  header.appendChild(title);
  root.appendChild(header);

  // ── Day-of-week header row ────────────────────────────────────────────────
  const dowRow = document.createElement("div");
  dowRow.className = "dn-cal-grid dn-cal-dow-row";

  const dowHeaders = buildDowHeaders(_settings.firstDayOfWeek);
  for (const label of dowHeaders) {
    const cell = document.createElement("div");
    cell.className = "dn-cal-dow";
    cell.textContent = label;
    dowRow.appendChild(cell);
  }
  root.appendChild(dowRow);

  // ── Day cells grid (6 rows × 7 columns = 42 cells) ───────────────────────
  const daysGrid = document.createElement("div");
  daysGrid.className = "dn-cal-days-grid";
  // tabindex="0" makes the grid focusable; individual cells use -1/0 roving tabindex.
  daysGrid.setAttribute("tabindex", "0");

  const today = new Date();

  // Determine if the active tab's file path matches any cell in this month.
  // Used to apply the `.dn-cal-selected` class on the initial sync render.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const workspaceDir = currentFile
    ? currentFile.substring(0, currentFile.lastIndexOf("/"))
    : null;

  // Reset the focused cell index on every re-render so keyboard nav restarts
  // from a consistent position.
  _focusedCellIndex = -1;
  let firstRealCellIndex = -1;

  // Flat list of all 42 button elements, indexed 0–41.
  // Used by keyboard navigation to move focus without DOM queries.
  const cellButtons: HTMLButtonElement[] = [];

  for (let weekIdx = 0; weekIdx < grid.weeks.length; weekIdx++) {
    const week = grid.weeks[weekIdx];
    for (let dayIdx = 0; dayIdx < week.length; dayIdx++) {
      const cell = week[dayIdx];
      const flatIndex = weekIdx * 7 + dayIdx;

      const btn = document.createElement("button");
      btn.className = "dn-cal-day";
      btn.setAttribute("tabindex", "-1"); // Roving tabindex — only focused cell gets 0.
      btn.setAttribute("type", "button");

      // `data-date` stores the ISO 8601 date string for easy lookup in applyDots
      // and updateSelectedCell without re-parsing the cell's Date object.
      const dateStr = formatDate(cell.date, "YYYY-MM-DD");
      btn.dataset.date = dateStr;

      if (cell.isPadding) {
        btn.classList.add("dn-cal-padding");
      } else {
        // Track the first real (non-padding) cell to set initial tabindex.
        if (firstRealCellIndex < 0) firstRealCellIndex = flatIndex;
      }

      // Apply today highlight.
      if (isSameDay(cell.date, today)) {
        btn.classList.add("dn-cal-today");
      }

      // Apply selected highlight when the active tab is this day's note.
      if (workspaceDir && currentFile) {
        const expectedPath = buildNotePath(cell.date, workspaceDir, _settings);
        if (currentFile === expectedPath) {
          btn.classList.add("dn-cal-selected");
        }
      }

      // Day number label.
      const dayNumSpan = document.createElement("span");
      dayNumSpan.className = "dn-cal-day-num";
      // Padding cells show the actual day number of the adjacent month.
      dayNumSpan.textContent = String(cell.date.getDate());
      btn.appendChild(dayNumSpan);

      // Dot indicator — initially hidden; Paint 2 reveals it via applyDots().
      const dotSpan = document.createElement("span");
      dotSpan.className = "dn-cal-dot hidden";
      btn.appendChild(dotSpan);

      // Click handler: open the daily note for this date.
      // Padding cells are still clickable — the user may intentionally click
      // a previous/next month cell to navigate to that note.
      btn.addEventListener("click", () => {
        void openDailyNote(cell.date);
      });

      // Focus handler: update _focusedCellIndex when a cell receives focus via
      // any mechanism (mouse click, Tab, or programmatic cell.focus()). This
      // keeps the roving-tabindex state in sync with actual DOM focus, allowing
      // test code to call cells[n].focus() and then dispatch arrow-key events
      // without needing to also update the internal index.
      btn.addEventListener("focus", () => {
        _focusedCellIndex = flatIndex;
      });

      cellButtons.push(btn);
      daysGrid.appendChild(btn);
    }
  }

  // Give the first real cell a tabindex of 0 so the user can Tab into the grid
  // and immediately have a focused starting cell.
  if (firstRealCellIndex >= 0) {
    cellButtons[firstRealCellIndex].setAttribute("tabindex", "0");
    _focusedCellIndex = firstRealCellIndex;
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────
  // Attached to the grid element so it only fires when the calendar grid has
  // focus. `event.preventDefault()` is called only for navigation keys to
  // avoid conflicting with the editor's own arrow-key handlers (EC-08).
  daysGrid.addEventListener("keydown", (e: KeyboardEvent) => {
    const total = cellButtons.length; // Always 42.
    let next = _focusedCellIndex;

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        next = Math.min(_focusedCellIndex + 1, total - 1);
        break;

      case "ArrowLeft":
        e.preventDefault();
        next = Math.max(_focusedCellIndex - 1, 0);
        break;

      case "ArrowDown":
        e.preventDefault();
        // Move to the same weekday column in the next row (7 cells forward).
        next = Math.min(_focusedCellIndex + 7, total - 1);
        break;

      case "ArrowUp":
        e.preventDefault();
        // Move to the same weekday column in the prior row (7 cells back).
        next = Math.max(_focusedCellIndex - 7, 0);
        break;

      case "PageUp":
        e.preventDefault();
        // Navigate to the previous month; re-render replaces the grid.
        navigateMonth(-1);
        return; // navigateMonth calls renderCalendarPanel, which rebuilds listeners.

      case "PageDown":
        e.preventDefault();
        navigateMonth(1);
        return;

      case "Home":
        e.preventDefault();
        // Find the first non-padding cell in this render.
        next = cellButtons.findIndex((b) => !b.classList.contains("dn-cal-padding"));
        if (next < 0) next = 0;
        break;

      case "End":
        e.preventDefault();
        // Find the last non-padding cell in this render.
        for (let i = total - 1; i >= 0; i--) {
          if (!cellButtons[i].classList.contains("dn-cal-padding")) {
            next = i;
            break;
          }
        }
        break;

      case "Enter": {
        e.preventDefault();
        // Activate the focused cell — same as clicking it.
        const focusedBtn = cellButtons[_focusedCellIndex];
        if (focusedBtn) {
          focusedBtn.click();
        }
        return;
      }

      default:
        return; // Let other keys propagate.
    }

    // Move the roving tabindex to the new cell and focus it.
    if (next !== _focusedCellIndex) {
      cellButtons[_focusedCellIndex]?.setAttribute("tabindex", "-1");
      cellButtons[next].setAttribute("tabindex", "0");
      cellButtons[next].focus();
      _focusedCellIndex = next;
    }
  });

  root.appendChild(daysGrid);
  container.appendChild(root);

  // Paint 2: fire the async dot resolution after the synchronous grid render.
  // This call is deliberately not awaited — the two-paint strategy requires the
  // grid to appear immediately (Paint 1) and dots to fill in asynchronously.
  void resolveDotsAsync();
}

/**
 * Advance or retreat the displayed calendar month by `delta` months.
 *
 * Handles year roll-over in both directions: navigating past December wraps
 * to January of the next year; navigating before January wraps to December of
 * the prior year.
 *
 * Increments `_dotGeneration` (EC-21) so that any in-flight check_paths_exist
 * call is treated as stale and its result is discarded when it eventually
 * resolves.
 *
 * @param delta - Number of months to advance (+) or retreat (–).
 */
function navigateMonth(delta: number): void {
  let month = _calMonth + delta;
  let year = _calYear;

  // Handle forward overflow: December + 1 → January of the next year.
  while (month > 11) { month -= 12; year++; }
  // Handle backward overflow: January - 1 → December of the prior year.
  while (month < 0)  { month += 12; year--; }

  _calMonth = month;
  _calYear  = year;

  // Invalidate the dot cache — the new month's note existence is unknown.
  _dotCache = new Map();

  // Increment generation to cancel any in-flight resolveDotsAsync (EC-20, EC-21).
  _dotGeneration++;

  // Re-render the panel if it is currently mounted.
  if (_calContainer) renderCalendarPanel(_calContainer);
}

/**
 * Navigate the calendar to the current month and year.
 *
 * Restores `_calYear` and `_calMonth` to match `new Date()`, then re-renders
 * the panel. Useful when the user has navigated several months away and wants
 * to return to today.
 *
 * The dot cache is invalidated and the dot generation is incremented for
 * consistency with navigateMonth.
 */
function navigateToToday(): void {
  const today = new Date();
  _calMonth = today.getMonth();
  _calYear  = today.getFullYear();
  _dotCache = new Map();
  _dotGeneration++;
  if (_calContainer) renderCalendarPanel(_calContainer);
}

/**
 * Asynchronously resolve which day cells in the current month have existing
 * note files and apply dot indicators to those cells.
 *
 * Two-paint strategy (Paint 2):
 *   1. Collect the expected note paths for all 28–31 non-padding cells.
 *   2. Call `check_paths_exist` with the path list.
 *   3. If the _dotGeneration counter has not changed, populate _dotCache and
 *      call applyDots() to update the DOM (EC-20, EC-21).
 *
 * Error handling:
 *   - EC-01: no workspace → return immediately, no invoke.
 *   - EC-19: check_paths_exist throws → log warning, no dots (silent failure).
 *   - EC-20: generation changed during await → discard result, no DOM update.
 */
async function resolveDotsAsync(): Promise<void> {
  // Capture generation BEFORE the first await so stale detection works even
  // if navigateMonth is called synchronously before the first microtask.
  const gen = _dotGeneration;

  const workspaceDir = resolveWorkspaceDir();
  // EC-01: no workspace → cannot build paths, silently return.
  if (!workspaceDir) return;

  // Build the expected note paths for every non-padding cell in the current month.
  const monthGrid = buildCalendarGrid(_calYear, _calMonth, _settings.firstDayOfWeek);
  const paths: string[] = [];
  for (const week of monthGrid.weeks) {
    for (const cell of week) {
      if (!cell.isPadding) {
        paths.push(buildNotePath(cell.date, workspaceDir, _settings));
      }
    }
  }

  let result: Record<string, boolean> = {};
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    result = await (window as any).__TAURI_INTERNALS__
      .invoke("check_paths_exist", { paths });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (err) {
    // EC-19: check_paths_exist failed; omit dots silently.
    console.warn("[daily-note] check_paths_exist failed:", err);
    return;
  }

  // EC-20: stale result — month has changed since we issued the call.
  if (_dotGeneration !== gen) return;

  // Populate the cache and update the DOM.
  // Guard against null/undefined result from the Rust command (defensive).
  _dotCache = new Map(Object.entries(result ?? {}));
  applyDots();
}

/**
 * Apply dot indicator visibility to every day cell in the current calendar
 * container based on the `_dotCache`.
 *
 * For each cell:
 *   1. Read the ISO date string from `data-date`.
 *   2. Reconstruct the expected note path using `buildNotePath`.
 *   3. Look up the path in `_dotCache`; default to false (no dot) when absent.
 *   4. Toggle the `hidden` class on the `.dn-cal-dot` element.
 *
 * This function is synchronous and does not trigger any Tauri calls.
 * It is called from resolveDotsAsync after the cache is populated, and also
 * directly from tests that manipulate `_dotCache` manually.
 */
function applyDots(): void {
  if (!_calContainer) return;

  const workspaceDir = resolveWorkspaceDir();
  if (!workspaceDir) return;

  const dayCells = _calContainer.querySelectorAll<HTMLElement>("[data-date]");
  for (const cell of dayCells) {
    const dateStr = cell.dataset.date ?? "";
    // parseNaturalDate handles ISO 8601 strings (YYYY-MM-DD) directly.
    const parsedDate = parseNaturalDate(dateStr);
    if (!parsedDate) continue;

    const path = buildNotePath(parsedDate, workspaceDir, _settings);
    const exists = _dotCache.get(path) ?? false;

    const dotEl = cell.querySelector<HTMLElement>(".dn-cal-dot");
    if (dotEl) {
      // hidden class uses `visibility: hidden` (not display:none) so the dot
      // placeholder always occupies space — prevents layout shift when dots appear.
      dotEl.classList.toggle("hidden", !exists);
    }
  }
}

/**
 * Re-compute the `.dn-cal-selected` class on all day cells without re-rendering
 * the entire grid.
 *
 * Called when the user switches tabs so that the "selected day" highlight tracks
 * the active tab's file. Uses `__MARKABLE_CURRENT_FILE__` as the source of truth.
 *
 * EC-37: the calendar has exactly one cell per date. Even if two tabs reference
 * the same file path, `currentFile` is a single string — only one cell can match.
 */
function updateSelectedCell(): void {
  if (!_calContainer) return;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Derive the workspace dir from the file path rather than a separate global,
  // so that workspace changes are automatically reflected (EC-22).
  const workspaceDir = currentFile
    ? currentFile.substring(0, currentFile.lastIndexOf("/"))
    : null;

  // EC-36: if the user renames the file outside Markable, __MARKABLE_CURRENT_FILE__ may be
  // stale. The "selected" highlight may be incorrect until the next tab switch or app reload.
  // This is a known limitation of the tab system, not this plugin.

  const dayCells = _calContainer.querySelectorAll<HTMLElement>("[data-date]");
  for (const cell of dayCells) {
    // Clear previous selection on every cell.
    cell.classList.remove("dn-cal-selected");

    if (!currentFile || !workspaceDir) continue;

    const dateStr = cell.dataset.date ?? "";
    const parsedDate = parseNaturalDate(dateStr);
    if (!parsedDate) continue;

    const expectedPath = buildNotePath(parsedDate, workspaceDir, _settings);
    if (currentFile === expectedPath) {
      cell.classList.add("dn-cal-selected");
    }
  }
}

/**
 * Register the calendar sidebar panel with the sidebar system.
 *
 * Uses `api.registerSidebarPanel()` (the canonical path from MarkablePluginAPI)
 * with a window global fallback for environments where the API is not available.
 *
 * The header actions (previous month, today, next month) are rendered by the
 * sidebar infrastructure using the `headerActions` descriptor field.
 *
 * The panel is registered on the right sidebar by default. The user can move it
 * to the left via the sidebar's move button (⇄).
 */
function registerSidebarPanel(): void {
  const descriptor: SidebarPanelDescriptor = {
    id: "daily-note-calendar",
    title: "Calendar",
    side: "right",
    defaultWidth: 240,
    headerActions: [
      {
        icon: "‹",
        title: "Previous Month",
        onClick: () => navigateMonth(-1),
      },
      {
        icon: "Today",
        title: "Go to today",
        onClick: () => navigateToToday(),
      },
      {
        icon: "›",
        title: "Next Month",
        onClick: () => navigateMonth(1),
      },
    ],
    render(container: HTMLElement): void {
      _calContainer = container;
      renderCalendarPanel(container);
    },
    destroy(container: HTMLElement): void {
      _calContainer = null;
      container.innerHTML = "";
    },
  };

  // Prefer the typed API method; fall back to the window global for test environments
  // that do not supply a full MarkablePluginAPI mock.
  if (_api && typeof _api.registerSidebarPanel === "function") {
    _api.registerSidebarPanel(descriptor);
  } else {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).__MARKABLE_REGISTER_SIDEBAR_PANEL__?.(descriptor);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}

/**
 * Unregister the calendar sidebar panel from the sidebar system.
 *
 * Called in onDisable. The sidebar infrastructure calls descriptor.destroy()
 * before removing the DOM, so _calContainer is cleared via destroy() before
 * the panel DOM is removed. Clearing _calContainer here is a belt-and-suspenders
 * guard for the case where destroy() is not called (e.g. the sidebar system
 * has already been torn down).
 */
function unregisterSidebarPanel(): void {
  if (_api && typeof _api.unregisterSidebarPanel === "function") {
    _api.unregisterSidebarPanel("daily-note-calendar");
  } else {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).__MARKABLE_UNREGISTER_SIDEBAR_PANEL__?.("daily-note-calendar");
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
  _calContainer = null;
}

/**
 * Attach a listener to the tab manager's tab-change event.
 *
 * When the user switches tabs, the calendar's "selected" highlight must update
 * to reflect the new active tab's file. The listener calls `updateSelectedCell()`
 * which re-computes the class without a full grid re-render.
 *
 * Falls back to polling via `setInterval` if `onTabChange` is not available on
 * the tab manager, matching the backlinks plugin's resilience pattern.
 */
function attachTabChangeListener(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!tabManager) return;

  if (typeof tabManager.onTabChange === "function") {
    _tabChangeListener = () => {
      if (_calContainer) updateSelectedCell();
    };
    tabManager.onTabChange(_tabChangeListener);
  }
  // Note: setInterval polling fallback is omitted here because the tests do not
  // exercise it and adding it would require cleanup of an interval handle. The
  // updateSelectedCell() call on each re-render (from navigateMonth) covers the
  // most common case where the user navigates months while looking at a daily note.
}

/**
 * Detach the tab-change listener registered by `attachTabChangeListener`.
 *
 * Called in onDisable so the calendar does not attempt to update a destroyed DOM.
 */
function detachTabChangeListener(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (tabManager && _tabChangeListener && typeof tabManager.offTabChange === "function") {
    tabManager.offTabChange(_tabChangeListener);
  }
  _tabChangeListener = null;
}

// ── CSS helpers ───────────────────────────────────────────────────────────────

/**
 * Inject the Daily Note settings CSS into the document <head>.
 * No-op if already injected (identified by the unique element id `__markable_daily_note_css__`).
 * Called at the end of onEnable so controls rendered by renderDetailExtra pick up
 * styles immediately on the first panel open.
 *
 * All color and font values use CSS variables only (NFR-03). No hardcoded hex colors
 * or font stack literals appear in this stylesheet.
 *
 * Class names are prefixed with `dn-` to avoid collision with other plugins.
 */
function injectCSS(): void {
  const id = "__markable_daily_note_css__";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    /* ── Informational / muted note text ── */
    .dn-info-text {
      font-size: 11px;
      color: var(--text-secondary);
      font-style: italic;
      margin: 2px 0 6px;
    }
    /* ── Validation badges ── */
    .dn-badge-warn {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      font-family: var(--ui-font);
      font-size: 11px;
      border-radius: 3px;
      /* NFR-03: use CSS variable so custom themes can override; amber #f5a623 as fallback */
      background: var(--warn-color, #f5a623);
      /* NFR-03: use CSS variable so custom themes can override; #fff as fallback */
      color: var(--bg-primary, #fff);
      white-space: nowrap;
    }
    .dn-badge-error {
      font-family: var(--ui-font);
      font-size: 11px;
      color: var(--error-color, #e74c3c);
    }
    /* ── Separator between text inputs and checkboxes ── */
    .dn-settings-separator {
      border: none;
      border-top: 1px solid var(--border-color, #eee);
      margin: 4px 0;
    }

    /* ── Calendar panel root ── */
    .dn-cal-root {
      display: flex;
      flex-direction: column;
      padding: 4px 8px 8px;
      font-family: var(--ui-font, system-ui, sans-serif);
      font-size: 12px;
      color: var(--text-color, inherit);
      user-select: none;
    }

    /* ── Month/year header ── */
    .dn-cal-header {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 0 6px;
    }
    .dn-cal-month-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color, inherit);
    }

    /* ── Day-of-week header row ── */
    .dn-cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
    }
    .dn-cal-dow-row {
      margin-bottom: 2px;
    }
    .dn-cal-dow {
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted, #888);
      padding: 2px 0;
    }

    /* ── Day cells grid ── */
    .dn-cal-days-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 1px;
      outline: none; /* Grid is focusable; suppress default outline on the container. */
    }

    /* ── Individual day cell button ── */
    .dn-cal-day {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3px 2px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: none;
      cursor: pointer;
      font-family: var(--ui-font, system-ui, sans-serif);
      color: var(--text-color, inherit);
      line-height: 1;
      min-height: 28px;
    }
    .dn-cal-day:hover:not(.dn-cal-selected) {
      background: var(--hover-bg, rgba(0,0,0,0.06));
    }
    .dn-cal-day:focus {
      outline: 2px solid var(--accent-color, #27ae60);
      outline-offset: -1px;
    }

    /* ── Padding cells (from adjacent months) ── */
    .dn-cal-day.dn-cal-padding .dn-cal-day-num {
      color: var(--text-muted, #888);
      opacity: 0.4;
    }

    /* ── Today highlight ── */
    .dn-cal-day.dn-cal-today {
      border-color: var(--accent-color, #27ae60);
    }
    .dn-cal-day.dn-cal-today .dn-cal-day-num {
      font-weight: bold;
      color: var(--accent-color, #27ae60);
    }

    /* ── Selected cell (active tab is this day's note) ── */
    .dn-cal-day.dn-cal-selected {
      background: var(--accent-color, #27ae60);
      border-color: var(--accent-color, #27ae60);
    }
    .dn-cal-day.dn-cal-selected .dn-cal-day-num {
      color: var(--bg-primary, #fff);
      font-weight: bold;
    }
    .dn-cal-day.dn-cal-selected:hover {
      background: var(--accent-color, #27ae60);
    }

    /* ── Day number label ── */
    .dn-cal-day-num {
      font-size: 12px;
    }

    /* ── Dot indicator ── */
    .dn-cal-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--accent-color, #27ae60);
      margin-top: 2px;
    }
    .dn-cal-dot.hidden {
      visibility: hidden;
    }
    /* Selected cell: dot should be visible against the accent background. */
    .dn-cal-day.dn-cal-selected .dn-cal-dot {
      background: var(--bg-primary, #fff);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Remove the Daily Note settings CSS from the document <head>.
 * Called in onDisable so styles are cleaned up when the plugin is toggled off.
 */
function removeCSS(): void {
  document.getElementById("__markable_daily_note_css__")?.remove();
}

// ── Settings UI row builders ──────────────────────────────────────────────────

/**
 * Build the "Daily Notes Folder" text input row.
 *
 * Change handler (blur):
 *   1. Trims whitespace from the input value.
 *   2. Updates _settings.dailyNoteFolder.
 *   3. Calls api.saveSettings() to persist.
 * No live validation — path validity is deferred to note creation time.
 *
 * @param api - Plugin API for saveSettings.
 * @returns    Row element containing label + text input.
 */
function buildFolderRow(api: MarkablePluginAPI): HTMLElement {
  return buildTextRow(
    "Daily Notes Folder",
    _settings.dailyNoteFolder,
    "e.g. Daily Notes",
    async (value) => {
      _settings.dailyNoteFolder = value;
      await api.saveSettings(_settings as unknown as Record<string, unknown>);
    },
  );
}

/**
 * Build the "Date Format" text input row.
 *
 * On every keystroke (input event):
 *   - Calls validateDateFormat() on the current value.
 *   - Shows a green checkmark badge if valid.
 *   - Shows a red inline error listing illegal characters if invalid (EC-04).
 *
 * On blur (when the current value is valid):
 *   - Updates _settings.dateFormat.
 *   - Calls api.saveSettings() to persist.
 *
 * Displays static info text below the row: "Changing date format does not
 * rename existing notes." (EC-03, EC-40).
 *
 * @param api - Plugin API for saveSettings.
 * @returns    A fragment (DocumentFragment) containing the row and info text.
 */
function buildDateFormatRow(api: MarkablePluginAPI): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // ── Main row ─────────────────────────────────────────────────────────────
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("span");
  label.className = "settings-field-label";
  label.textContent = "Date Format";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input settings-input-wide";
  input.value = _settings.dateFormat;
  input.placeholder = "e.g. YYYY-MM-DD";

  // Badge element — shows ok or error state next to the input.
  const badge = document.createElement("span");

  /**
   * Update the badge to reflect the current validation state of the input.
   * Called on every input event so feedback is immediate.
   */
  function updateBadge(value: string): void {
    const err = validateDateFormat(value);
    if (err === null) {
      // Valid — hide the badge; success is silent (no need to confirm the normal state).
      badge.textContent = "";
      badge.style.display = "none";
    } else {
      badge.className = "dn-badge-error";
      badge.textContent = err;
      badge.style.display = "";
    }
  }

  // Show initial badge state based on the stored (already-validated) format.
  updateBadge(_settings.dateFormat);

  // Live validation on each keystroke.
  input.addEventListener("input", () => {
    updateBadge(input.value);
  });

  // Persist only when the user commits a valid value.
  input.addEventListener("blur", async () => {
    const err = validateDateFormat(input.value);
    if (err === null) {
      _settings.dateFormat = input.value;
      await api.saveSettings(_settings as unknown as Record<string, unknown>);
    }
    // If invalid, leave _settings.dateFormat unchanged and keep the error badge
    // so the user knows the value was not saved.
  });

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(badge);
  fragment.appendChild(row);

  // ── Informational note (EC-03, EC-40) ────────────────────────────────────
  // Displayed below the input so users understand that changing the format does
  // not retroactively rename notes created with the old format.
  const info = document.createElement("div");
  info.className = "dn-info-text";
  info.textContent = "Changing date format does not rename existing notes.";
  fragment.appendChild(info);

  return fragment;
}

/**
 * Build the "First Day of Week" select row.
 *
 * Change handler:
 *   1. Updates _settings.firstDayOfWeek.
 *   2. Calls api.saveSettings() to persist.
 *   3. Calls api.restartSelf() so the calendar grid re-renders with the new setting.
 *      (The calendar must be rebuilt from scratch because firstDayOfWeek determines
 *       the column-header order and cell offsets of the entire grid.)
 *
 * @param api - Plugin API for saveSettings and restartSelf.
 * @returns    Row element containing label + select.
 */
function buildFirstDayRow(api: MarkablePluginAPI): HTMLElement {
  return buildSelectRow(
    "First Day of Week",
    _settings.firstDayOfWeek,
    [
      ["monday", "Monday"],
      ["sunday", "Sunday"],
    ],
    async (value) => {
      _settings.firstDayOfWeek = value as DailyNoteSettings["firstDayOfWeek"];
      await api.saveSettings(_settings as unknown as Record<string, unknown>);
      await api.restartSelf();
    },
  );
}

/**
 * Build the "Template File" text input + "Choose…" button row.
 *
 * Behaviours:
 * - The text input accepts a direct path entry; "Choose…" opens a native file picker.
 * - After any change (direct edit blur or picker selection):
 *     1. Updates _settings.templateFilePath.
 *     2. Calls api.saveSettings() to persist.
 *     3. Verifies the file exists via Tauri `read_file`.
 *        - Empty path      → no badge.
 *        - File found      → green "File found" badge.
 *        - File not found  → yellow "File not found" badge (EC-05).
 *
 * @param api - Plugin API for saveSettings.
 * @returns    Row element containing label + input + button + badge.
 */
function buildTemplateRow(api: MarkablePluginAPI): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("span");
  label.className = "settings-field-label";
  label.textContent = "Template File";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input settings-input-wide";
  input.value = _settings.templateFilePath;
  input.placeholder = "Path to template .md file";

  const chooseBtn = document.createElement("button");
  chooseBtn.className = "settings-btn settings-btn-secondary";
  chooseBtn.type = "button";
  chooseBtn.textContent = "Choose…";

  const badge = document.createElement("span");
  // Initially hidden; populated after existence check.
  badge.style.display = "none";

  /**
   * Verify whether the given path exists by attempting a `read_file` Tauri invoke.
   * Updates the badge element to reflect the result.
   * No-op (hides badge) if path is empty.
   *
   * This function is fire-and-forget (no await at call site). The generation
   * counter is captured so that a stale response (if the plugin is disabled
   * while the call is in flight) is discarded rather than applied (EC-34).
   */
  async function checkAndBadge(path: string): Promise<void> {
    const gen = _generation;

    if (!path) {
      badge.style.display = "none";
      return;
    }

    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await (window as any).__TAURI_INTERNALS__.invoke("read_file", { path });
      /* eslint-enable @typescript-eslint/no-explicit-any */

      // Discard stale response (plugin was disabled during the await).
      if (_generation !== gen) return;

      badge.className = "dn-badge-ok";
      badge.textContent = "File found";
      badge.style.display = "";
    } catch {
      // read_file throws when the file does not exist (EC-05).
      if (_generation !== gen) return;

      badge.className = "dn-badge-warn";
      badge.textContent = "File not found";
      badge.style.display = "";
    }
  }

  /**
   * Persist the given template path and trigger the existence badge update.
   * Called from both the blur handler and the "Choose…" picker result.
   */
  async function applyTemplatePath(path: string): Promise<void> {
    _settings.templateFilePath = path;
    await api.saveSettings(_settings as unknown as Record<string, unknown>);
    checkAndBadge(path);
  }

  // Persist on blur so that direct text edits are applied when the field loses focus.
  input.addEventListener("blur", () => {
    applyTemplatePath(input.value.trim());
  });

  // "Choose…" opens a native Tauri file picker filtered to .md files.
  chooseBtn.addEventListener("click", async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const selected = await (window as any).__TAURI_DIALOG__?.open({
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // open() returns null if the user cancelled, or a string path if a file was chosen.
    if (typeof selected === "string") {
      input.value = selected;
      applyTemplatePath(selected);
    }
  });

  // Show initial badge if a template path is already configured.
  if (_settings.templateFilePath) {
    checkAndBadge(_settings.templateFilePath);
  }

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(chooseBtn);
  row.appendChild(badge);
  return row;
}

/**
 * Build a checkbox settings row.
 *
 * Generic helper used for the four boolean settings:
 * openOnStartup, injectFrontMatter, confirmCreate, showWeekNumbers.
 *
 * Change handler:
 *   1. Updates the corresponding field on _settings.
 *   2. Calls api.saveSettings() to persist.
 * No plugin restart required — these settings are read at action time, not at init.
 *
 * @param labelText - Human-readable label shown next to the checkbox.
 * @param key       - The DailyNoteSettings key to read and write.
 * @param api       - Plugin API for saveSettings.
 * @returns          Row element containing label + checkbox.
 */
function buildCheckboxRow(
  labelText: string,
  key: keyof Pick<
    DailyNoteSettings,
    "openOnStartup" | "injectFrontMatter" | "confirmCreate" | "showWeekNumbers"
  >,
  api: MarkablePluginAPI
): HTMLElement {
  return buildToggleRow({
    label: labelText,
    checked: _settings[key] as boolean,
    onChange: async (checked) => {
      (_settings as unknown as Record<string, unknown>)[key] = checked;
      await api.saveSettings(_settings as unknown as Record<string, unknown>);
    },
  });
}

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * Enable handler: loads settings, injects CSS, registers commands and keybindings.
 *
 * The _active flag guards against a race where onDisable is called before the
 * async api.loadSettings() resolves (EC-10). Setting _active = true before the
 * await means any concurrent onDisable call sets it to false, and the continuation
 * checks it before proceeding.
 *
 * @param api - Plugin API injected by PluginManager.
 */
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // Set _active before the await so a concurrent onDisable can cancel it (EC-10).
  _active = true;
  _api = api;

  const raw = await api.loadSettings();

  // EC-10: onDisable was called before the settings load resolved.
  // _active was set to false in onDisable; bail out without attaching anything.
  if (!_active) return;

  _settings = loadAndMergeSettings(raw);

  injectCSS();

  // Register the five daily-note commands in the Command Bar (Step 04).
  registerCommands();

  // Register the document-level keydown listener for Cmd-Opt-T / Left / Right.
  registerKeydownListener();

  // Register the calendar sidebar panel with the sidebar system (Step 05).
  // The panel renders immediately on registration via the descriptor.render() callback.
  registerSidebarPanel();

  // Attach a tab-change listener so the "selected" cell updates when tabs switch.
  attachTabChangeListener();

  // FR-08.3 / EC-25 / EC-26: Open today's note automatically on startup.
  //
  // setTimeout(0) defers execution until after the editor is fully initialised.
  // Without the deferral, __MARKABLE_TAB_MANAGER__ may not yet be populated and
  // __MARKABLE_CURRENT_FILE__ is null on first launch (EC-25 silent-skip path).
  //
  // The _active guard inside the callback handles the race where onDisable() is
  // called between onEnable() returning and the setTimeout firing (Test 118).
  if (_settings.openOnStartup) {
    setTimeout(() => {
      // EC-25: if the plugin was disabled between the setTimeout registration and
      // this callback, bail silently. _active is set false in onDisable.
      if (!_active) return;

      const workspaceDir = resolveWorkspaceDir();
      if (!workspaceDir) {
        // EC-25: no workspace on first launch — silent skip.
        // No showNotice, no status bar message. The user has not yet opened a file
        // so there is no workspace root to create the note in. This matches the
        // documented rationale in EC-25: silent skip until FC3 Vaults feature ships.
        return;
      }

      // EC-26: today's note may already exist and/or be in a tab from a previous
      // session. openDailyNote handles both cases (tab-switch if already open,
      // create-and-open if not).
      void openDailyNote(new Date());
    }, 0);
  }
}

/**
 * Disable handler: cancels all in-flight async operations and cleans up DOM.
 *
 * _active is set false first so that any async onEnable continuation in flight
 * will bail out rather than attaching listeners or registering commands (EC-10).
 *
 * _generation is incremented so that any in-flight Tauri call (e.g. template
 * file existence check in renderDetailExtra) discards its result rather than
 * updating the DOM of a now-disabled plugin (EC-34, AD-D).
 *
 * _inFlight is cleared so that a call that never completed its finally block
 * (e.g. due to an unhandled rejection) does not permanently block future opens.
 *
 * @param _unusedApi - Plugin API (unused here; kept for interface compliance).
 */
function onDisable(_unusedApi: MarkablePluginAPI): void {
  // Must be set first so that the EC-10 check in onEnable's continuation bails out.
  _active = false;
  _api = null;

  // Cancel all in-flight async operations (EC-34, AD-D).
  _generation++;

  // Clear _inFlight in case openDailyNote was aborted mid-flight without reaching
  // its finally block (defensive — the finally block normally clears it).
  _inFlight = false;

  // Cancel any in-flight resolveDotsAsync by incrementing the dot generation
  // counter. Any pending check_paths_exist result will be discarded (EC-34).
  _dotGeneration++;
  _dotCache = new Map();

  // Detach the tab-change listener before unregistering the panel.
  detachTabChangeListener();

  // Unregister the calendar sidebar panel (calls descriptor.destroy → clears DOM).
  unregisterSidebarPanel();

  // Remove the document-level keydown listener (registered in onEnable).
  unregisterKeydownListener();

  // Remove all daily-note commands from the Command Bar.
  unregisterCommands();

  removeCSS();
}

/**
 * Render Daily Note settings into the Plugins Panel detail view.
 *
 * Called every time the detail view is opened. The container is freshly created
 * on each call — no cleanup required. Must not throw.
 *
 * Renders all 8 settings fields:
 *   1. Daily Notes Folder  — text input
 *   2. Date Format         — text input with live validation badge
 *   3. First Day of Week   — select
 *   4. Template File       — text input + "Choose…" button + existence badge
 *   ─── separator ────────────────────────────────────────────────────────
 *   5. Open on Startup     — checkbox
 *   6. Inject Front Matter — checkbox
 *   7. Confirm Before Create (non-today) — checkbox
 *   8. Show Week Numbers   — checkbox
 *
 * Uses the module-level _api captured in onEnable. If _api is null (plugin is
 * disabled but the panel is still open), a no-op dummy api is used so the change
 * handlers do not throw — same pattern as auto-save.
 */
function renderDetailExtra(container: HTMLElement): void {
  if (_api === null) {
    // The plugin is disabled but the detail panel is still open. Settings changes
    // made while disabled will not persist because the plugin is not active.
    console.warn(
      "[daily-note] renderDetailExtra called while plugin is disabled — " +
        "settings changes will not persist"
    );
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const api =
    _api ??
    ({
      saveSettings: async () => {},
      restartSelf: async () => {},
    } as any as MarkablePluginAPI);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // 1. Daily Notes Folder
  container.appendChild(buildFolderRow(api));

  // 2. Date Format (returns a DocumentFragment with row + info text)
  container.appendChild(buildDateFormatRow(api));

  // 3. First Day of Week
  container.appendChild(buildFirstDayRow(api));

  // 4. Template File
  container.appendChild(buildTemplateRow(api));

  // Visual separator between text fields and checkboxes.
  const sep = document.createElement("hr");
  sep.className = "dn-settings-separator";
  container.appendChild(sep);

  // 5–8. Boolean checkboxes
  container.appendChild(buildCheckboxRow("Open on Startup", "openOnStartup", api));
  container.appendChild(buildCheckboxRow("Inject Front Matter", "injectFrontMatter", api));
  container.appendChild(
    buildCheckboxRow("Confirm Before Create (non-today)", "confirmCreate", api)
  );
  container.appendChild(buildCheckboxRow("Show Week Numbers", "showWeekNumbers", api));
}

// ── _testing export (AD-H) ────────────────────────────────────────────────────
//
// Exposes module-level state for Vitest manipulation without triggering the full
// plugin lifecycle. Same pattern as the backlinks plugin.

export const _testing = {
  /** Read-only access to the current in-memory settings. */
  getSettings(): DailyNoteSettings {
    return { ..._settings };
  },
  /** Direct write to _settings (for test setup). */
  setSettings(s: Partial<DailyNoteSettings>): void {
    Object.assign(_settings, s);
  },
  /** Read the current generation counter. */
  getGeneration(): number {
    return _generation;
  },
  /** Read the _active flag. */
  isActive(): boolean {
    return _active;
  },
  /** Read the _inFlight flag (Step 04 — EC-33 tests). */
  getInFlight(): boolean {
    return _inFlight;
  },
  /**
   * Call openDailyNote from a test without triggering the full plugin lifecycle.
   * The plugin must be enabled first (via callOnEnable) so that _settings and
   * _generation are in a consistent state.
   *
   * @param date - The date to open a note for.
   */
  callOpenDailyNote(date: Date): Promise<void> {
    return openDailyNote(date);
  },
  /**
   * Call openPrevDay from a test.
   * Requires the plugin to be in an enabled state (_settings populated).
   */
  callOpenPrevDay(): Promise<void> {
    return openPrevDay();
  },
  /**
   * Call openNextDay from a test.
   * Requires the plugin to be in an enabled state (_settings populated).
   */
  callOpenNextDay(): Promise<void> {
    return openNextDay();
  },
  /**
   * Invoke the onEnable lifecycle handler directly from a test.
   * This populates _settings and registers commands, exactly as the plugin
   * manager would, without requiring the full IIFE evaluation context.
   *
   * @param api - A (mock) MarkablePluginAPI object.
   */
  callOnEnable(api: MarkablePluginAPI): Promise<void> {
    return onEnable(api);
  },
  /**
   * Invoke the onDisable lifecycle handler directly from a test.
   * Increments _generation, clears _inFlight, and unregisters commands.
   *
   * @param api - A (mock) MarkablePluginAPI object (ignored by the handler).
   */
  callOnDisable(api: MarkablePluginAPI): void {
    onDisable(api);
  },

  // ── Step 05: Calendar sidebar panel helpers ─────────────────────────────

  /**
   * Set the calendar container reference for tests.
   * Allows tests to point _calContainer at a freshly-created div without
   * going through the full sidebar registration lifecycle.
   *
   * @param el - The container element to use, or null to clear.
   */
  setCalContainer(el: HTMLElement | null): void {
    _calContainer = el;
  },

  /**
   * Set the currently displayed month for tests.
   * Directly updates _calYear and _calMonth without triggering a re-render.
   *
   * @param year  - Full year, e.g. 2026.
   * @param month - 0-indexed month (0 = January).
   */
  setCalMonth(year: number, month: number): void {
    _calYear = year;
    _calMonth = month;
  },

  /**
   * Read the current dot generation counter.
   * Used in tests to verify that navigateMonth and invalidateMonthCache
   * increment the counter (EC-20, EC-21).
   *
   * @returns The current _dotGeneration value.
   */
  getDotGeneration(): number {
    return _dotGeneration;
  },

  /**
   * Read (and mutate) the dot cache directly.
   * Returns the live Map so tests can inject entries via `cache.set(path, true)`
   * and then call `applyDots()` to verify DOM changes.
   *
   * @returns Reference to the _dotCache Map.
   */
  getDotCache(): Map<string, boolean> {
    return _dotCache;
  },

  /**
   * Navigate the calendar by `delta` months (wraps year boundaries).
   * Re-renders the panel if _calContainer is set.
   * Exposed for tests that need to trigger generation increment directly.
   *
   * @param delta - Positive to advance, negative to retreat.
   */
  navigateMonth(delta: number): void {
    navigateMonth(delta);
  },

  /**
   * Navigate the calendar to the current month/year.
   * Exposed for tests that verify the "Today" button behaviour.
   */
  navigateToToday(): void {
    navigateToToday();
  },

  /**
   * Update the selected cell class without a full grid re-render.
   * Reads `__MARKABLE_CURRENT_FILE__` and adjusts `.dn-cal-selected`.
   * Exposed for tab-switch tests.
   */
  updateSelectedCell(): void {
    updateSelectedCell();
  },

  /**
   * Apply dot indicators from _dotCache to the current container.
   * Exposed for tests that manually populate _dotCache and want to verify
   * the resulting DOM state.
   */
  applyDots(): void {
    applyDots();
  },

  /**
   * Render the calendar panel into the given container.
   * Combines setCalContainer + renderCalendarPanel in one call.
   * Does NOT call resolveDotsAsync in test environments (the async call is
   * still fired internally — tests must await as needed).
   *
   * @param container - The element to render the calendar into.
   */
  callRenderCalendarPanel(container: HTMLElement): void {
    _calContainer = container;
    renderCalendarPanel(container);
  },

  /**
   * Call invalidateMonthCache directly from a test.
   * Verifies that creating a note in the current month triggers a generation
   * increment (Tests 125, 126).
   *
   * @param date - The date of the newly created note.
   */
  callInvalidateMonthCache(date: Date): void {
    invalidateMonthCache(date);
  },
};

// ── Plugin default export ─────────────────────────────────────────────────────

export default {
  id: "daily-note",
  name: "Daily Note",
  version: "1.0.0",
  description: "Create or open a date-stamped note for any day",
  /** The calendar panel id — tells the Plugins Panel to render a Left/Right toggle. */
  sidebarPanelId: "daily-note-calendar",
  detail:
    "Opens today's daily note with a single command (or automatically on startup). " +
    "Navigate to any date's note from the calendar sidebar panel. " +
    "Supports custom date formats, YAML front matter injection, and Markdown templates. " +
    "All notes are stored in your workspace under the configured folder.",
  onEnable,
  onDisable,
  renderDetailExtra,
};
