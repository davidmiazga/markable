---
title: "Step 06 — Integration and Edge Case Audit"
last-updated: "2026-04-23"
review-cadence-days: 7
status: active
---

# Step 06 — Integration and Edge Case Audit

## Goal and Scope

Complete the plugin by implementing the two remaining lifecycle features (`openOnStartup` and `confirmCreate` dialog integration), wiring the `toggleCalendarPanel` command fully, auditing all 40 Edge Cases from `docs/requirements/active_task.md` for test coverage, and performing a final integration review.

This step also covers any edge cases not already addressed in Steps 01–05 that require plugin-level integration to test.

---

## Files to Modify

| File | Change |
|---|---|
| `src/plugins/daily-note/daily-note.plugin.ts` | Add `openOnStartup` trigger in `onEnable`, finalize `confirmCreate` dialog |
| `tests/plugins/daily-note/daily-note.test.ts` | Add the final integration tests |

---

## Implementation Spec

### `openOnStartup` Logic

In `onEnable`, after all setup is complete, add:

```typescript
if (_settings.openOnStartup) {
  // Use setTimeout(0) to defer until after the editor is fully initialized.
  // This matches the behavior of other startup-time plugin actions.
  setTimeout(() => {
    if (!_active) return;    // guard: plugin may have been disabled between setTimeout and callback
    const workspaceDir = resolveWorkspaceDir();
    if (!workspaceDir) {
      // EC-25: no workspace on first launch — silent skip, no error, no message
      return;
    }
    // EC-26: note may already exist and be open; openDailyNote handles the tab-switch
    void openDailyNote(new Date());
  }, 0);
}
```

EC-25: `workspaceDir` is null → silent return. No `showNotice`, no status bar message.
EC-26: note exists and may or may not be in a tab → `openDailyNote` handles both cases via the `getAllTabs` check.

### `confirmCreate` Dialog (completion)

The `confirmCreateDialog` function was defined in Step 04. In this step, verify it is correctly connected to all entry points:
- `openDailyNote` calls it when `_settings.confirmCreate === true` and the target date is not today.
- The "Open for Date…" prompt calls `openDailyNote`, which has the confirmCreate guard — so it is automatically covered.
- Calendar cell click calls `openDailyNote` — also automatically covered.
- EC-28: target date is today → `isSameDay(date, new Date())` is true → dialog is skipped.
- EC-27: user clicks "Cancel" → `openDailyNote` returns early without write.

No additional code changes needed if Steps 04–05 were implemented correctly.

### `toggleCalendarPanel` finalization

Ensure `toggleCalendarPanel` (wired in `registerCommands` in Step 04) calls the correct sidebar API. Check the actual `MarkablePluginAPI` interface:

```typescript
function toggleCalendarPanel(): void {
  // FR-09 — the command must work even when the calendar panel is not visible (EC-23).
  // The sidebar toggle API hides or shows the panel without affecting note opening.
  if (_api && typeof (_api as any).toggleSidebarPanel === 'function') {
    (_api as any).toggleSidebarPanel('daily-note-calendar');
  }
}
```

EC-23: the "Open Today" command does not call this function — it calls `openDailyNote` directly. The calendar panel's visibility state is independent of note opening.

### EC-36 Documentation

EC-36 (active tab renamed outside Markable) is a known limitation of the tab system, not specific to this plugin. No special handling is required. Add a code comment in `updateSelectedCell`:

```typescript
// EC-36: if the user renames the file outside Markable, __MARKABLE_CURRENT_FILE__ may be
// stale. The "selected" highlight may be incorrect until the next tab switch or app reload.
// This is a known limitation of the tab system, not this plugin.
```

---

## Edge Case Audit Checklist

Walk through all 40 ECs and confirm each is covered by a test or has a documented rationale.

| EC | Coverage | Notes |
|---|---|---|
| EC-01 | Step 04 test 76 | `openDailyNote` shows notice, no write |
| EC-02 | Step 01 test 2 | Rust `create_dir_all` |
| EC-03 | Step 03 settings UI | Informational note in settings panel |
| EC-04 | Step 02 test 27-28, Step 03 test 67 | `validateDateFormat` + settings merge |
| EC-05 | Step 04 test 80 | Template not found → empty note, console.warn |
| EC-06 | Step 02 tests 48-49 | `injectFrontMatter` merge |
| EC-07 | Step 02 tests 50-51 | `injectFrontMatter` overwrite |
| EC-08 | Step 02 test 47 | Unknown token left verbatim; malformed format suffix does not throw |
| EC-09 | Step 04 test 80 | console.warn for template >100KB; test 80 covers missing template |
| EC-10 | Step 04 test 77 | switchToTab if already open as active tab |
| EC-11 | Step 04 test 78 | switchToTab if open but not active |
| EC-12 | Step 04 test 88 | Prev/next fallback to yesterday/tomorrow |
| EC-13 | Step 02 test 9, Step 04 test 89 | addDays(Jan 1, -1) |
| EC-14 | Step 02 test 10, Step 04 test 90 | addDays(Dec 31, +1) |
| EC-15 | Step 02 tests 11-12, Step 04 tests 91-92 | Leap day arithmetic |
| EC-16 | Step 01 test 3 | create_dir_all idempotent |
| EC-17 | Step 01 test 15 | check_paths_exist with nested paths |
| EC-18 | Step 02 tests 58-59, Step 05 test 94 | Feb 28/29 cell count |
| EC-19 | Step 05 test 102 | check_paths_exist failure → dots omitted |
| EC-20 | Step 05 test 103 | Stale dot result discarded |
| EC-21 | Step 05 test 104 | Rapid navigation only shows last result |
| EC-22 | Step 05 test 98 | Workspace change → updateSelectedCell uses new workspace |
| EC-23 | Step 06 test 114 | Calendar not visible → Open Today still works |
| EC-24 | Step 05 test 99 | Panel registers even without sidebar slot |
| EC-25 | Step 06 test 115 | openOnStartup, no file → silent skip |
| EC-26 | Step 06 test 116 | openOnStartup, note exists → opens/switches |
| EC-27 | Step 04 test 83 | confirmCreate, user cancels |
| EC-28 | Step 04 test 84 | confirmCreate, today → no dialog |
| EC-29 | Step 02 test 21, Step 06 test 117 | Invalid date in "open for date" prompt |
| EC-30 | Step 02 test 22 | "yesterday" on Jan 1 |
| EC-31 | Step 02 test 31 | Absolute folder path |
| EC-32 | Step 01 test 7, Step 02 test 34 | Spaces in path |
| EC-33 | Step 04 test 81 | Double invocation — only one write |
| EC-34 | Step 04 test 82 | Plugin disabled mid-flight |
| EC-35 | Step 01 test 4, Step 04 test 85 | Target is a directory |
| EC-36 | Code comment only | Known tab-system limitation |
| EC-37 | Step 05 test 100 | Two tabs, same daily note |
| EC-38 | Step 01 test 13 | Empty path list to check_paths_exist |
| EC-39 | Step 02 test 32 | Empty dailyNoteFolder = workspace root |
| EC-40 | Step 03 settings UI | Informational note; dots appear missing until new notes created |

---

## Test Cases (added to `tests/plugins/daily-note/daily-note.test.ts`)

### Group 15: Integration / lifecycle (10 tests)

114. **EC-23: Open Today works when calendar panel is not visible (not mounted)**
     `_calContainer = null`. Call `openDailyNote(new Date())`. Assert `invoke('create_daily_note')` called — panel visibility has no effect on note opening.

115. **EC-25: openOnStartup when __MARKABLE_CURRENT_FILE__ is null → no note created, no error**
     Set `_settings.openOnStartup = true`. Set `__MARKABLE_CURRENT_FILE__ = null`. Call `onEnable`. Advance fake timers. Assert `invoke('create_daily_note')` not called. Assert no `showNotice` call. Assert no thrown error.

116. **EC-26: openOnStartup when today's note does not exist → note is created**
     `openOnStartup = true`. `__MARKABLE_CURRENT_FILE__` = `/notes/readme.md`. Mock `getAllTabs()` returns []. Mock `invoke('create_daily_note')` resolves. Advance fake timers. Assert `invoke('create_daily_note')` called once.

117. **EC-29: openForDatePrompt with "2026-02-30" → inline error, no invoke**
     Trigger `openForDatePrompt`. Type "2026-02-30" into the input. Click "Open". Assert the error span shows "Invalid date." Assert `invoke` not called.

118. **Plugin disabled during openOnStartup timeout → no note created**
     `openOnStartup = true`. Call `onEnable`. Before the `setTimeout` fires, call `onDisable`. Advance timers. Assert `invoke` not called (the `_active` check fires after the timeout).

119. **onDisable increments _generation — in-flight openDailyNote discards result**
     (Covered by step 04 test 82, but verify here with full lifecycle: call `onEnable`, start `openDailyNote`, call `onDisable`, verify tab not opened.)

120. **Settings change via renderDetailExtra → api.saveSettings called**
     Simulate a change to the `dailyNoteFolder` input. Assert `api.saveSettings` called with the new value.

121. **dateFormat invalid chars blocked in settings — previous valid format retained**
     Set `_settings.dateFormat = 'YYYY-MM-DD'`. Simulate typing `YYYY:MM:DD` into the format field. Assert no `api.saveSettings` called (blocked). Assert `_settings.dateFormat` unchanged.

122. **Full happy-path integration: loadSettings → openDailyNote → create note → open tab**
     Full `onEnable` with mocked settings, template, and Tauri commands. Assert final tab open call includes the correctly formatted path.

123. **Plugin export shape is correct**
     Assert the default export has `id: 'daily-note'`, `name`, `onEnable`, `onDisable`, `renderDetailExtra`.

---

## NFR Verification Notes

These cannot be unit-tested in Vitest but must be verified manually during visual testing:

**NFR-01 (300ms first-open latency)**: verify on device by enabling the plugin with no existing notes, pressing Cmd-Opt-T, and observing the tab appears within ~300ms. The critical path is: `check getAllTabs` (sync) + `invoke('create_daily_note')` (one round-trip) + `tabManager.openFile` (sync).

**NFR-02 (100ms calendar render)**: verify that the month grid HTML is visible (before dots) within a frame after the panel becomes visible. The `resolveDotsAsync` call is a second async paint.

**NFR-03 (CSS variables)**: verified by the DoD checklist in Steps 03–05 (no hardcoded hex). Also verified manually by switching between themes.

**NFR-05 (60+ tests)**: Final test count target is 123 tests. Well above the 60-test floor.

---

## Definition of Done

- [ ] `openOnStartup` triggers `openDailyNote` deferred via `setTimeout(0)`.
- [ ] EC-25 silent skip when `__MARKABLE_CURRENT_FILE__` is null at startup.
- [ ] EC-36 documented with a code comment in `updateSelectedCell`.
- [ ] All 40 Edge Cases have a test number or documented rationale in the audit table above.
- [ ] All 10 tests in Group 15 pass.
- [ ] Total Vitest test count for the feature is at least 60 (actual target: 123).
- [ ] `cargo test` still passes (no regressions to Rust commands from Step 01).
- [ ] `npm run build:plugins` compiles `daily-note.js` without TypeScript errors.
- [ ] The compiled plugin file is under 5 MB (core plugin cap).
- [ ] Manual visual test: Cmd-Opt-T opens today's note in under 300ms.
- [ ] Manual visual test: calendar grid renders and dots appear after first async paint.
- [ ] Manual visual test: all themes display the calendar correctly (CSS variables only).
- [ ] `00_index.md` step checklist is fully checked off.
