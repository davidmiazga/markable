---
title: "Step 04 — Core Actions and Command Registration"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Step 04 — Core Actions and Command Registration

## Goal and Scope

Implement the core note-opening logic and register all five commands in `__MARKABLE_COMMANDS__`. This step wires the plugin into the Command Bar, the Keybinding Editor, and the `__MARKABLE_HANDLE_ACTION__` dispatcher.

Steps 03's stub `onEnable`/`onDisable` are expanded here.

---

## Files to Modify

| File | Change |
|---|---|
| `src/plugins/daily-note/daily-note.plugin.ts` | Add `openDailyNote`, `resolveWorkspaceDir`, `registerCommands`, `openForDatePrompt`, expand `onEnable`/`onDisable` |

No new files in this step — all logic goes into `daily-note.plugin.ts`.

---

## Implementation Spec

### `resolveWorkspaceDir(): string | null`

```typescript
function resolveWorkspaceDir(): string | null {
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return null;
  // Extract directory: everything before the last '/'
  const lastSlash = currentFile.lastIndexOf('/');
  if (lastSlash < 0) return null;
  return currentFile.slice(0, lastSlash);
}
```

Returns null when `__MARKABLE_CURRENT_FILE__` is null (EC-01) or has no directory component.

### `showNotice(message: string): void`

Displays a user-facing error or info message. Two-tier fallback:
1. If a status bar message function exists: use it (TODO: check what the status bar API exposes — follow the same pattern as the advanced-lists status bar message).
2. Else: use `console.warn` + inject a temporary floating notice div into `document.body` that auto-dismisses after 4 seconds.

The floating notice uses CSS variables only (`--bg-primary`, `--text-primary`, `--accent-color`). The div has `position: fixed; bottom: 48px; right: 16px; z-index: 9999; padding: 8px 12px; border-radius: 4px; background: var(--bg-secondary); border: 1px solid var(--border-color); font-family: var(--ui-font); font-size: 13px;`.

This function must never throw.

### `openDailyNote(date: Date): Promise<void>`

This is the single shared code path for all entry points (FR-01.7).

```typescript
// Module-level flag to prevent double-invocation (EC-33)
let _inFlight = false;

async function openDailyNote(date: Date): Promise<void> {
  // EC-33: guard against concurrent invocations
  if (_inFlight) return;
  _inFlight = true;

  // Capture generation before first await
  const gen = _generation;

  try {
    // EC-01: workspace unknown
    const workspaceDir = resolveWorkspaceDir();
    if (!workspaceDir) {
      showNotice('Open a file first to set the workspace for daily notes.');
      return;
    }

    // Compute the absolute path for this date
    const absolutePath = buildNotePath(date, workspaceDir, _settings);

    // EC-33: check generation after synchronous path building (still none here)

    // FR-08.6: confirmCreate for non-today dates
    if (_settings.confirmCreate && !isSameDay(date, new Date())) {
      const formattedDate = formatDate(date, _settings.dateFormat);
      const confirmed = await confirmCreateDialog(formattedDate);
      if (_generation !== gen) return;   // EC-34: plugin disabled during confirm
      if (!confirmed) return;            // EC-27: user cancelled
    }

    // Check if tab already open (EC-10, EC-11)
    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    if (!tabManager) {
      showNotice('Tab manager not available.');
      return;
    }

    // Check if any open tab already has this file
    const existingTab = tabManager.getAllTabs?.()?.find(
      (t: any) => t.filePath === absolutePath
    );
    if (existingTab) {
      tabManager.switchToTab?.(existingTab.id);
      return;   // File already open — no write needed
    }

    // Determine initial content
    let content = '';
    if (_settings.templateFilePath) {
      try {
        const templateContent: string = await (window as any).__TAURI_INTERNALS__
          .invoke('read_file', { path: _settings.templateFilePath });
        if (_generation !== gen) return;   // EC-34
        // EC-09: warn for large templates
        if (templateContent.length > 100_000) {
          console.warn('[daily-note] Template file is large (>100KB); proceeding.');
        }
        content = templateContent;
      } catch (_err) {
        // EC-05: template missing → create empty note, no error thrown
        console.warn('[daily-note] Template file not found; creating empty note.');
        content = '';
      }
    }

    // Substitute tokens
    content = substituteTokens(content, { date, dateFormat: _settings.dateFormat });

    // Inject front matter if enabled
    if (_settings.injectFrontMatter) {
      const dateStr = formatDate(date, 'YYYY-MM-DD');
      content = injectFrontMatter(content, dateStr);
    }

    // Call Rust to create dirs + write file (idempotent on dirs)
    try {
      await (window as any).__TAURI_INTERNALS__
        .invoke('create_daily_note', { path: absolutePath, content });
    } catch (err: unknown) {
      if (_generation !== gen) return;   // EC-34: plugin disabled; discard
      // EC-35 and other write errors
      const msg = typeof err === 'string' ? err : String(err);
      showNotice(`Could not create daily note: ${msg}`);
      return;
    }

    if (_generation !== gen) return;   // EC-34

    // Open in tab
    tabManager.openFile(absolutePath);

    // Invalidate the calendar dot cache for this month (trigger re-check)
    invalidateMonthCache(date);

  } finally {
    _inFlight = false;
  }
}
```

#### `confirmCreateDialog(formattedDate: string): Promise<boolean>`

Uses `window.__TAURI_DIALOG__` if available (via `confirm` method), or falls back to `window.confirm`. Returns true if confirmed, false if cancelled (EC-27).

```typescript
async function confirmCreateDialog(formattedDate: string): Promise<boolean> {
  const message = `Create daily note for ${formattedDate}?`;
  // Tauri dialog provides a native confirmation dialog
  const dialog = (window as any).__TAURI_DIALOG__;
  if (dialog?.confirm) {
    return await dialog.confirm(message, { title: 'Create Daily Note', kind: 'info' });
  }
  // Fallback: browser confirm
  return window.confirm(message);
}
```

#### `invalidateMonthCache(date: Date): void`

Stub in this step; expanded in Step 05 when the calendar panel exists. For now it is a no-op.

### Command Registration

#### `registerCommands(): void`

Adds five command objects to `window.__MARKABLE_COMMANDS__`:

```typescript
const COMMANDS = [
  {
    id: 'daily-note-today',
    label: 'Daily Note: Open Today',
    defaultKey: 'Cmd-Opt-T',
    category: 'Daily Note',
    action: () => { void openDailyNote(new Date()); },
    isContextInvalid: () => false,   // FR-09.2: never context-invalid
  },
  {
    id: 'daily-note-prev',
    label: 'Daily Note: Open Previous Day',
    defaultKey: 'Cmd-Opt-Left',
    category: 'Daily Note',
    action: () => { void openPrevDay(); },
    isContextInvalid: () => false,
  },
  {
    id: 'daily-note-next',
    label: 'Daily Note: Open Next Day',
    defaultKey: 'Cmd-Opt-Right',
    category: 'Daily Note',
    action: () => { void openNextDay(); },
    isContextInvalid: () => false,
  },
  {
    id: 'daily-note-for-date',
    label: 'Daily Note: Open for Date…',
    defaultKey: null,
    category: 'Daily Note',
    action: () => { openForDatePrompt(); },
    isContextInvalid: () => false,
  },
  {
    id: 'daily-note-toggle-calendar',
    label: 'Daily Note: Toggle Calendar Panel',
    defaultKey: null,
    category: 'Daily Note',
    action: () => { toggleCalendarPanel(); },
    isContextInvalid: () => false,
  },
];
```

Use the same pattern as Command Bar's own command registration: push to `window.__MARKABLE_COMMANDS__` and call `window.__MARKABLE_HANDLE_ACTION__` dispatch mapping in the plugin's command descriptor `action` callback.

`toggleCalendarPanel` is a stub at this step that will be connected to the sidebar panel in Step 05.

#### `unregisterCommands(): void`

Filter `window.__MARKABLE_COMMANDS__` to remove all entries whose `id` starts with `'daily-note-'`:
```typescript
(window as any).__MARKABLE_COMMANDS__ = ((window as any).__MARKABLE_COMMANDS__ ?? [])
  .filter((cmd: any) => !cmd.id?.startsWith('daily-note-'));
```

### Prev / Next Day Logic

#### `openPrevDay(): Promise<void>`

```typescript
async function openPrevDay(): Promise<void> {
  const date = getCurrentDailyNoteDate() ?? new Date();
  void openDailyNote(addDays(date, -1));
}
```

#### `openNextDay(): Promise<void>`

```typescript
async function openNextDay(): Promise<void> {
  const date = getCurrentDailyNoteDate() ?? new Date();
  void openDailyNote(addDays(date, 1));
}
```

#### `getCurrentDailyNoteDate(): Date | null`

```typescript
function getCurrentDailyNoteDate(): Date | null {
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return null;
  // Extract filename from path (last segment)
  const filename = currentFile.split('/').pop() ?? '';
  // Attempt to parse the date from the filename
  return parseDateFromFilename(filename, _settings.dateFormat);
}
```

Returns null if the active tab is not a daily note (FR-03.2 fallback). Callers use `?? new Date()` to fall back to today.

### "Open for Date…" Prompt

#### `openForDatePrompt(): void`

This injects a minimal inline prompt UI into the Command Bar area (if open) or as a floating overlay if the bar is not open.

For this spec, implement as a **floating overlay** approach (simpler; avoids coupling to command bar internals):

1. Create a `div#dn-date-prompt` with `position: fixed; top: 40%; left: 50%; transform: translateX(-50%); z-index: 10000; padding: 16px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; font-family: var(--ui-font); min-width: 300px;`.
2. Contains: a label "Open daily note for date:", a text input (placeholder: "YYYY-MM-DD or today/yesterday/tomorrow"), an error span (initially hidden), and two buttons "Open" and "Cancel".
3. Input auto-focuses on creation.
4. On Enter or "Open" click:
   - Parse via `parseNaturalDate(input.value.trim())`.
   - If null → show inline error "Invalid date." (EC-29).
   - If valid → remove overlay, call `openDailyNote(parsedDate)`.
5. On Escape or "Cancel" click → remove overlay. (FR-04.3)
6. Double-instantiation guard: if `document.getElementById('dn-date-prompt')` already exists, focus it and return.

EC-29: `"2026-02-30"` — `parseNaturalDate` returns null → show "Invalid date."
EC-30: `"yesterday"` on Jan 1 → `parseNaturalDate` returns Dec 31 of prior year → `openDailyNote` called correctly.

### Expanded `onEnable`

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _active = true;
  _api = api;
  const raw = await api.loadSettings();
  if (!_active) return;
  _settings = loadAndMergeSettings(raw);
  injectCSS();
  registerCommands();
  // Step 05 will add: registerSidebarPanel()
  // Step 06 will add: openOnStartup logic
}
```

### Expanded `onDisable`

```typescript
function onDisable(api: MarkablePluginAPI): void {
  _active = false;
  _api = null;
  _generation++;
  _inFlight = false;
  unregisterCommands();
  // Step 05 will add: unregisterSidebarPanel()
  removeCSS();
}
```

---

## Test Cases (added to `tests/plugins/daily-note/daily-note.test.ts`)

These tests require dynamic import with window globals set up (same pattern as the auto-save test `beforeAll`).

Required globals to mock: `window.__CM_VIEW__` (real cmView), `window.__MARKABLE_CURRENT_FILE__`, `window.__MARKABLE_TAB_MANAGER__`, `window.__TAURI_INTERNALS__`.

### Group 10: `openDailyNote` paths (10 tests)

76. **EC-01: no workspace — shows notice, no Tauri invoke**
    Set `__MARKABLE_CURRENT_FILE__` to null. Spy on `showNotice`. Assert invoked with expected message. Assert `__TAURI_INTERNALS__.invoke` not called.

77. **EC-10: today's note already open as active tab — switches, no write**
    Set `getAllTabs()` to return a tab with the expected absolute path. Spy on `switchToTab`. Assert `invoke('create_daily_note')` not called.

78. **EC-11: today's note already open, not active — switches**
    Same as above but the tab is not the active tab. Assert `switchToTab` called.

79. **happy path: new note created and tab opened**
    `getAllTabs()` returns empty array. Mock `invoke('create_daily_note')` to resolve. Assert `openFile` called with the correct absolute path.

80. **EC-05: template file not found — creates empty note, no error thrown**
    `_settings.templateFilePath = '/nonexistent/template.md'`. Mock `invoke('read_file')` to throw. Assert `invoke('create_daily_note')` called with `content: ''`.

81. **EC-33: double invocation — second call is a no-op**
    Call `openDailyNote` twice rapidly (both before any await resolves). Mock `invoke` to delay. Assert `invoke('create_daily_note')` called exactly once.

82. **EC-34: plugin disabled while Tauri call in flight — tab not opened**
    Start `openDailyNote`; before the `invoke` promise resolves, call `onDisable`. After the promise resolves, assert `tabManager.openFile` was NOT called.

83. **EC-27: confirmCreate enabled, user cancels — no write**
    `_settings.confirmCreate = true`. Target date is yesterday. Mock `confirmCreateDialog` to return false. Assert `invoke` not called.

84. **EC-28: confirmCreate enabled, target is today — no dialog shown**
    `_settings.confirmCreate = true`. Target date is today. Assert `confirmCreateDialog` not called. Assert `invoke('create_daily_note')` called.

85. **EC-35: Rust returns "path exists as a directory" — showNotice called**
    Mock `invoke('create_daily_note')` to throw `"path exists as a directory: ..."`. Assert `showNotice` called with message containing that text.

### Group 11: Prev/Next/today commands (8 tests)

86. **openPrevDay from a daily note tab (YYYY-MM-DD format) — opens correct date**
    Set `__MARKABLE_CURRENT_FILE__` to `/notes/Daily Notes/2026-04-23.md`. Assert `openDailyNote` called with April 22.

87. **openNextDay from a daily note tab — opens correct date**
    Same file; assert `openDailyNote` called with April 24.

88. **EC-12: openPrevDay from non-daily-note tab — falls back to yesterday**
    `__MARKABLE_CURRENT_FILE__` = `/notes/readme.md`. Assert `openDailyNote` called with yesterday relative to today.

89. **EC-13: openPrevDay from Jan 1 — navigates to Dec 31**
    `__MARKABLE_CURRENT_FILE__` = `/notes/2026-01-01.md`. Assert `openDailyNote` called with Dec 31 2025.

90. **EC-14: openNextDay from Dec 31 — navigates to Jan 1**
    Assert `openDailyNote` called with Jan 1 next year.

91. **EC-15: openNextDay from Feb 28 in a leap year — navigates to Feb 29**

92. **EC-15: openNextDay from Feb 29 in a leap year — navigates to Mar 1**

93. **today command calls openDailyNote(today)**

---

## Definition of Done

- [ ] `openDailyNote` is implemented with all guards described above.
- [ ] All 5 commands registered in `__MARKABLE_COMMANDS__` on `onEnable`.
- [ ] Commands removed from `__MARKABLE_COMMANDS__` on `onDisable`.
- [ ] `openForDatePrompt` injects the overlay and handles valid/invalid/escape inputs.
- [ ] Double-instantiation guard present on `openForDatePrompt`.
- [ ] `_inFlight` flag prevents EC-33 double-write.
- [ ] `_generation` check after every `await` in `openDailyNote` (EC-34).
- [ ] All 18 tests in Groups 10 and 11 pass.
- [ ] `showNotice` never throws.
- [ ] No `console.error` for EC-05 (template missing is a warn, not an error).
