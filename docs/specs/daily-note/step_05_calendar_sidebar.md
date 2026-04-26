---
title: "Step 05 — Calendar Sidebar Panel"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Step 05 — Calendar Sidebar Panel

## Goal and Scope

Implement the "Calendar" sidebar panel: month grid DOM, navigation controls, dot indicators (via `check_paths_exist`), "today" and "selected" cell highlighting, keyboard navigation, and tab-change listener. Wire the panel into the sidebar system using the `SidebarPanelDescriptor` pattern from backlinks.

The calendar panel DOM is built once on `onEnable` (FR-11.5) and mutated in place — no tear-down/rebuild per interaction.

---

## Files to Modify

| File | Change |
|---|---|
| `src/plugins/daily-note/daily-note.plugin.ts` | Add all calendar panel code, expand `onEnable`/`onDisable` |

---

## Module-Level Calendar State

Add these variables alongside the existing module-level state in `daily-note.plugin.ts`:

```typescript
// Current month displayed in the calendar (may differ from today or the selected note)
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();   // 0-indexed

// The dot-existence cache: maps absolute path → boolean.
// Keyed per-month; invalidated when _calYear/_calMonth changes or a new note is created.
let _dotCache: Map<string, boolean> = new Map();

// Generation counter for the async check_paths_exist call.
// Separate from _generation which is the plugin-level counter.
// _dotGeneration is incremented on every month navigation.
let _dotGeneration = 0;

// The calendar panel container (set by panel render(), nulled by destroy())
let _calContainer: HTMLElement | null = null;

// Tab-change listener reference for cleanup
let _tabChangeListener: (() => void) | null = null;
```

---

## Implementation Spec

### Panel Registration

#### `registerSidebarPanel(): void`

```typescript
function registerSidebarPanel(): void {
  const descriptor: SidebarPanelDescriptor = {
    id: 'daily-note-calendar',
    title: 'Calendar',
    side: 'right',     // default; user can reassign in sidebar
    defaultWidth: 240,
    headerActions: [
      {
        icon: '‹',
        title: 'Previous Month',
        onClick: () => navigateMonth(-1),
      },
      {
        icon: 'Today',
        title: 'Go to today',
        onClick: () => navigateToToday(),
      },
      {
        icon: '›',
        title: 'Next Month',
        onClick: () => navigateMonth(1),
      },
    ],
    render(container: HTMLElement): void {
      _calContainer = container;
      renderCalendarPanel(container);
    },
    destroy(container: HTMLElement): void {
      _calContainer = null;
      container.innerHTML = '';
    },
  };

  // Register with the sidebar system.
  // Check for both the modern API (api.registerSidebarPanel) and the window global fallback.
  if (_api && typeof (_api as any).registerSidebarPanel === 'function') {
    (_api as any).registerSidebarPanel(descriptor);
  } else {
    (window as any).__MARKABLE_REGISTER_SIDEBAR_PANEL__?.(descriptor);
  }
}
```

**Note**: check the actual `MarkablePluginAPI` interface to confirm the correct method name. The backlinks plugin uses `api.registerSidebarPanel` — verify this is correct before implementing.

#### `unregisterSidebarPanel(): void`

```typescript
function unregisterSidebarPanel(): void {
  if (_api && typeof (_api as any).unregisterSidebarPanel === 'function') {
    (_api as any).unregisterSidebarPanel('daily-note-calendar');
  } else {
    (window as any).__MARKABLE_UNREGISTER_SIDEBAR_PANEL__?.('daily-note-calendar');
  }
  _calContainer = null;
}
```

### DOM Structure

`renderCalendarPanel(container)` builds this structure inside `container`:

```html
<div class="dn-cal-root">
  <!-- Header row: month/year title + nav arrows (if not using headerActions) -->
  <div class="dn-cal-header">
    <span class="dn-cal-month-title">{Month} {Year}</span>
  </div>

  <!-- Day-of-week header -->
  <div class="dn-cal-grid dn-cal-dow-row">
    <!-- 7 cells: Mon Tue Wed Thu Fri Sat Sun (or Sun Mon…) -->
    <div class="dn-cal-dow">Mon</div> ...
  </div>

  <!-- Optional: week number column header if showWeekNumbers -->
  <!-- Week number cells are siblings in the same grid (CSS grid layout) -->

  <!-- Day cells: 6 rows × 7 columns = 42 cells -->
  <!-- If showWeekNumbers: 6 rows × 8 columns (week col + 7 day cols) -->
  <div class="dn-cal-grid dn-cal-days-grid" tabindex="0">
    <!-- per week row, optionally with a week number cell first -->
    <button class="dn-cal-day [dn-cal-padding] [dn-cal-today] [dn-cal-selected]"
            data-date="YYYY-MM-DD" tabindex="-1">
      <span class="dn-cal-day-num">{day}</span>
      <span class="dn-cal-dot hidden"></span>
    </button>
    ...
  </div>
</div>
```

**CSS grid**: `dn-cal-days-grid` uses `display: grid; grid-template-columns: repeat(7, 1fr);` (or `repeat(8, ...)` if week numbers). Day cells have `aspect-ratio: 1` or a fixed height to keep the grid square.

All colors via CSS variables. Key styles:
- `.dn-cal-today .dn-cal-day-num` — `font-weight: bold; color: var(--accent-color);`
- `.dn-cal-today` — `border: 1px solid var(--accent-color);`
- `.dn-cal-selected` — `background: var(--accent-color); color: var(--bg-primary);`
- `.dn-cal-padding .dn-cal-day-num` — `color: var(--text-muted); opacity: 0.4;`
- `.dn-cal-dot` — `width: 4px; height: 4px; border-radius: 50%; background: var(--accent-color);`
- `.dn-cal-dot.hidden` — `visibility: hidden;`

### `renderCalendarPanel(container: HTMLElement): void`

1. Clear `container.innerHTML`.
2. Build `CalendarMonth` from `buildCalendarGrid(_calYear, _calMonth, _settings.firstDayOfWeek)`.
3. Build the DOM as described above.
4. For each day button, attach:
   - `click` handler → `openDailyNote(cell.date)` (for non-padding cells)
   - `data-date` attribute = `formatDate(cell.date, 'YYYY-MM-DD')` (for lookup)
5. Apply "today" class if `isSameDay(cell.date, new Date())`.
6. Apply "selected" class if the active tab's file path matches this cell's expected note path.
   - Get `__MARKABLE_CURRENT_FILE__`; call `buildNotePath(cell.date, workspaceDir, _settings)` and compare.
7. Trigger `resolveDotsAsync()` after the synchronous grid render (FR-07.3 two-paint strategy).

### `navigateMonth(delta: number): void`

```typescript
function navigateMonth(delta: number): void {
  // Advance or retreat the month, handling year rollover
  let month = _calMonth + delta;
  let year = _calYear;
  while (month > 11) { month -= 12; year++; }
  while (month < 0)  { month += 12; year--; }
  _calMonth = month;
  _calYear  = year;
  _dotCache = new Map();     // invalidate dot cache for new month
  _dotGeneration++;          // cancel any in-flight check_paths_exist
  if (_calContainer) renderCalendarPanel(_calContainer);
}
```

EC-21: each call to `navigateMonth` increments `_dotGeneration`. Rapid clicking calls this many times; only the last generation's `check_paths_exist` result will be applied.

### `navigateToToday(): void`

```typescript
function navigateToToday(): void {
  const today = new Date();
  _calMonth = today.getMonth();
  _calYear  = today.getFullYear();
  _dotCache = new Map();
  _dotGeneration++;
  if (_calContainer) renderCalendarPanel(_calContainer);
}
```

### `resolveDotsAsync(): Promise<void>`

```typescript
async function resolveDotsAsync(): Promise<void> {
  const gen = _dotGeneration;   // capture current generation

  const workspaceDir = resolveWorkspaceDir();
  if (!workspaceDir) return;    // EC-01: no workspace, no dots

  // Build the list of expected file paths for every non-padding cell in the current month
  const grid = buildCalendarGrid(_calYear, _calMonth, _settings.firstDayOfWeek);
  const paths: string[] = [];
  for (const week of grid.weeks) {
    for (const cell of week) {
      if (!cell.isPadding) {
        paths.push(buildNotePath(cell.date, workspaceDir, _settings));
      }
    }
  }

  let result: Record<string, boolean> = {};
  try {
    result = await (window as any).__TAURI_INTERNALS__
      .invoke('check_paths_exist', { paths });
  } catch (err) {
    // EC-19: check_paths_exist failed; omit dots silently
    console.warn('[daily-note] check_paths_exist failed:', err);
    return;
  }

  // EC-20: stale result — month has changed since we issued the call
  if (_dotGeneration !== gen) return;

  // EC-22: workspace may have changed — paths built above may no longer be valid
  // The generation check handles this because navigateMonth invalidates the generation.

  _dotCache = new Map(Object.entries(result));

  // Apply dots to the current DOM
  applyDots();
}
```

### `applyDots(): void`

```typescript
function applyDots(): void {
  if (!_calContainer) return;
  const dayCells = _calContainer.querySelectorAll<HTMLElement>('[data-date]');
  for (const cell of dayCells) {
    const dateStr = cell.dataset.date ?? '';
    const workspaceDir = resolveWorkspaceDir();
    if (!workspaceDir) return;
    // Reconstruct the path for this cell to look up in the cache
    const parsedDate = parseNaturalDate(dateStr);
    if (!parsedDate) continue;
    const path = buildNotePath(parsedDate, workspaceDir, _settings);
    const exists = _dotCache.get(path) ?? false;
    const dotEl = cell.querySelector<HTMLElement>('.dn-cal-dot');
    if (dotEl) {
      dotEl.classList.toggle('hidden', !exists);
    }
  }
}
```

### `invalidateMonthCache(date: Date): void` (implements the stub from Step 04)

```typescript
function invalidateMonthCache(date: Date): void {
  // If the newly created note is in the currently displayed month, invalidate and re-resolve
  if (date.getFullYear() === _calYear && date.getMonth() === _calMonth) {
    _dotCache = new Map();
    _dotGeneration++;
    if (_calContainer) void resolveDotsAsync();
  }
}
```

### Tab-Change Listener

The calendar "selected" highlighting must update when the user switches tabs. Listen for tab changes via `__MARKABLE_TAB_MANAGER__`:

```typescript
function attachTabChangeListener(): void {
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tabManager || typeof tabManager.onTabChange !== 'function') return;

  _tabChangeListener = () => {
    if (_calContainer) {
      // Re-apply "selected" class without full re-render
      updateSelectedCell();
    }
  };
  tabManager.onTabChange(_tabChangeListener);
}

function detachTabChangeListener(): void {
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  if (tabManager && _tabChangeListener && typeof tabManager.offTabChange === 'function') {
    tabManager.offTabChange(_tabChangeListener);
  }
  _tabChangeListener = null;
}
```

**Note**: verify the actual `onTabChange`/`offTabChange` API names in `tabs/` source before implementing. The backlinks plugin uses a polling fallback (`setInterval`) in addition to a tab change event. Replicate that pattern if the event API is unreliable.

### `updateSelectedCell(): void`

Re-computes which cell (if any) corresponds to the active tab's daily note and applies/removes the `dn-cal-selected` class. Does not re-render the grid. Does not trigger a new `check_paths_exist` call.

```typescript
function updateSelectedCell(): void {
  if (!_calContainer) return;
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  const workspaceDir = currentFile ? currentFile.substring(0, currentFile.lastIndexOf('/')) : null;

  const dayCells = _calContainer.querySelectorAll<HTMLElement>('[data-date]');
  for (const cell of dayCells) {
    cell.classList.remove('dn-cal-selected');
    if (!currentFile || !workspaceDir) continue;
    const dateStr = cell.dataset.date ?? '';
    const parsedDate = parseNaturalDate(dateStr);
    if (!parsedDate) continue;
    const expectedPath = buildNotePath(parsedDate, workspaceDir, _settings);
    if (currentFile === expectedPath) {
      cell.classList.add('dn-cal-selected');
    }
  }
}
```

EC-37: if two tabs have the same file open (edge case), the selected date is the same regardless of which tab is active — correct behavior by construction.

### Keyboard Navigation

Attach `keydown` to `.dn-cal-days-grid` (which has `tabindex="0"`):

```
ArrowLeft  → move focus to previous day cell (or wrap to prev month if on first cell)
ArrowRight → move focus to next day cell (or wrap to next month)
ArrowUp    → move focus to same weekday, prior week
ArrowDown  → move focus to same weekday, next week
PageUp     → navigateMonth(-1)
PageDown   → navigateMonth(1)
Enter      → activate the focused day cell (call openDailyNote)
Home       → move focus to first day of current month
End        → move focus to last day of current month
```

Implementation: maintain a module-level `_focusedCellIndex` (0-indexed into the 42-cell flat array). On each arrow key: compute new index, update `tabindex` attributes (only the focused cell has `tabindex="0"`; others have `tabindex="-1"`), call `cell.focus()`.

EC-08 (FR-07.8): keyboard nav must not conflict with the editor's own arrow-key bindings. The event handlers are attached to the `.dn-cal-days-grid` element only; they do not propagate to the editor. `event.preventDefault()` only inside the calendar grid element, not globally.

### `toggleCalendarPanel()` (implements stub from Step 04)

```typescript
function toggleCalendarPanel(): void {
  // Toggle the calendar panel visibility using the sidebar's show/hide API.
  // Check the MarkablePluginAPI for the correct method; if absent, use the window global.
  if (_api && typeof (_api as any).toggleSidebarPanel === 'function') {
    (_api as any).toggleSidebarPanel('daily-note-calendar');
  }
}
```

### Expanded `onEnable`

Add to the existing `onEnable` stub (after `registerCommands()`):

```typescript
registerSidebarPanel();
attachTabChangeListener();
```

### Expanded `onDisable`

Add before `removeCSS()`:

```typescript
_dotGeneration++;      // cancel any in-flight resolveDotsAsync
_dotCache = new Map();
detachTabChangeListener();
unregisterSidebarPanel();
```

---

## Test Cases (added to `tests/plugins/daily-note/daily-note.test.ts`)

These tests use the `_testing` export pattern to manipulate panel state.

Export a `_testing` object from `daily-note.plugin.ts` for test access:

```typescript
export const _testing = {
  setCalContainer(el: HTMLElement | null) { _calContainer = el; },
  setCalMonth(year: number, month: number) { _calYear = year; _calMonth = month; },
  getDotGeneration() { return _dotGeneration; },
  getDotCache() { return _dotCache; },
  navigateMonth,
  navigateToToday,
  updateSelectedCell,
  applyDots,
};
```

### Group 12: Calendar grid integration (8 tests)

94. **EC-18: February 2026 renders 28 non-padding cells**
    Set `_calYear = 2026, _calMonth = 1`. Create a container div. Call `renderCalendarPanel`. Count non-padding day buttons.

95. **EC-18: grid always has exactly 42 day cells (6×7)**
    Assert `container.querySelectorAll('[data-date]').length === 42`.

96. **today cell has `dn-cal-today` class**
    Set month to current month. Assert at least one cell has the class.

97. **selected cell class applied when active tab is a daily note**
    Set `__MARKABLE_CURRENT_FILE__` to a daily note path for today. Assert today's cell has `dn-cal-selected`.

98. **EC-22: workspace change mid-session causes updateSelectedCell to use new workspace**
    Change `__MARKABLE_CURRENT_FILE__` to a different directory. Call `updateSelectedCell`. Assert old selection cleared, new selection correct.

99. **EC-24: panel registers without error when no sidebar slot assigned**
    Mock `api.registerSidebarPanel` as a no-op. Assert `onEnable` does not throw.

100. **EC-37: two tabs with same daily note path — selected cell is correct**
     `getAllTabs()` returns two tabs with the same path. Assert exactly one cell has `dn-cal-selected`.

101. **navigateMonth(1) increments _dotGeneration**
     Capture `getDotGeneration()`; call `navigateMonth(1)`; assert generation incremented.

### Group 13: Dot resolution (8 tests)

102. **EC-19: check_paths_exist failure → dots not applied, no exception thrown**
     Mock `invoke('check_paths_exist')` to throw. Assert `applyDots` not called; no uncaught error.

103. **EC-20: stale result discarded after month navigation**
     Start `resolveDotsAsync()`; before the `invoke` resolves, call `navigateMonth(1)` (increments gen); after resolve, assert dots not applied to DOM.

104. **EC-21: rapid navigation — only last result applied**
     Call `navigateMonth` 5 times rapidly. Mock `invoke` to resolve. Assert only one DOM update (the last generation's).

105. **dots visible for months with existing notes**
     Mock `invoke('check_paths_exist')` to return `{ [somePath]: true }`. Assert the corresponding cell's dot loses the `hidden` class.

106. **no dots visible when all paths return false**
     Mock all false. Assert all `.dn-cal-dot` elements have `hidden` class.

107. **EC-38: resolveDotsAsync with no non-padding cells for a hypothetical empty month**
     (Defensive: even if the path list is empty, invoke is called with empty array; assert no error.)

108. **invalidateMonthCache triggers re-resolution when note is in current month**
     Create a note in current month. Call `invalidateMonthCache(date)`. Assert `_dotGeneration` incremented.

109. **invalidateMonthCache is a no-op for notes in other months**
     Create a note in a different month. Assert `_dotGeneration` unchanged.

### Group 14: Keyboard navigation (4 tests)

110. **PageUp on the grid calls navigateMonth(-1)**
111. **PageDown on the grid calls navigateMonth(1)**
112. **ArrowRight moves focus to the next day cell**
113. **Enter on a day cell calls openDailyNote with that cell's date**

---

## Definition of Done

- [ ] Calendar sidebar panel renders a 6×7 grid for any month.
- [ ] Panel header actions (Previous Month, Today, Next Month) work.
- [ ] "Today" cell has accent border and bold day number.
- [ ] "Selected" cell highlighted when active tab is a daily note.
- [ ] Dot indicators resolve asynchronously; layout does not shift.
- [ ] Generation counter prevents stale dots from overwriting the current month.
- [ ] Keyboard navigation functional (arrow keys, Page Up/Down, Enter).
- [ ] Tab-change listener updates selected cell.
- [ ] `onDisable` cleans up panel, listener, and increments dot generation.
- [ ] All 20 tests in Groups 12, 13, 14 pass.
- [ ] No hardcoded hex colors in calendar CSS.
- [ ] Calendar panel re-render is never triggered inside a CM6 `update` cycle (FR-06.6 from the requirements constraints).
