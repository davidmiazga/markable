---
title: "Auto-Save Plugin"
last-updated: "2026-04-21"
review-cadence-days: 7
status: active
---

# Auto-Save Plugin — Requirements Spec

## Validation Status

**DRAFT — pending user review and approval.**

---

## Summary

As a user, I want the editor to save my open documents automatically on a configurable trigger (debounce timer, focus loss, or both), so that I never lose work due to forgetting to press Cmd-S, while retaining the ability to disable auto-save entirely.

---

## Background and Motivation

Markable 2.0 already has a fully working manual save system: `Cmd-S` calls `tabManager.saveActiveTab()` and `Cmd-Shift-S` calls `tabManager.saveActiveTabAs()`. The tab manager owns dirty state (`tab.isDirty`) and all atomic file writes go through the `writeFile()` function in `src/lib/bridge.ts` (which invokes the Rust `write_file` command with a temp-file-swap).

Auto-save is an opt-in quality-of-life feature. It must never silently alter untitled documents, must survive rapid-typing scenarios without hammering the filesystem, and must clean up all timers and event listeners when disabled at runtime.

---

## Goals

1. Deliver auto-save as an IIFE core plugin (same build pipeline as focus-mode, diagrams, etc.).
2. Support three trigger modes: **debounce-only**, **focus-loss-only**, and **both** (debounce + focus loss).
3. Default state: **disabled**. The user must explicitly enable the plugin via the Plugins Panel.
4. Skip auto-save silently for untitled tabs (those with `filePath === null`).
5. Skip auto-save silently for clean tabs (`isDirty === false`).
6. Allow the debounce delay to be configured per-user, with a sensible default (2000 ms).
7. Expose all settings in the plugin's detail extra panel (rendered via `renderDetailExtra`).
8. Clean up all timers and DOM event listeners when `onDisable` is called.

---

## Functional Requirements

### FR-01: Plugin Identity

**FR-01.1** Plugin `id` is `"auto-save"`. Name displayed in the Plugins Panel: `"Auto-Save"`.

**FR-01.2** The plugin is disabled by default. Its entry in `settings.json` under `plugins["auto-save"].enabled` starts as `false` (or absent, treated as disabled).

**FR-01.3** The plugin is a core plugin. Its compiled IIFE file is `auto-save.js`, placed at `src-tauri/plugins/core/auto-save.js` via `npm run build:plugins`.

### FR-02: Trigger Modes

The plugin supports three trigger modes, selectable by the user in the settings UI:

| Mode ID | Behaviour |
|---|---|
| `"debounce"` | Auto-saves the active tab N ms after the last document change. |
| `"focus-loss"` | Auto-saves the active tab when the app window loses focus (`window blur`). |
| `"both"` | Applies both triggers simultaneously. |

**FR-02.1** Default trigger mode on first run: `"both"`.

**FR-02.2** In `"debounce"` mode, the plugin installs a CM6 `updateListener` extension that resets a `setTimeout` timer on every `docChanged` transaction. When the timer fires, `saveActiveTab()` is invoked on the active tab.

**FR-02.3** In `"focus-loss"` mode, the plugin attaches a `window` `"blur"` listener. When the listener fires, `saveActiveTab()` is invoked on the active tab.

**FR-02.4** In `"both"` mode, both the CM6 `updateListener` and the `window` `"blur"` listener are active simultaneously.

**FR-02.5** Switching trigger mode at runtime (via the settings UI) calls `api.restartSelf()` after persisting the new value so that the active listener/timer set is rebuilt cleanly.

### FR-03: Debounce Delay

**FR-03.1** Default debounce delay: `2000` ms.

**FR-03.2** The user can set the delay to any integer in the range **500 – 30 000 ms** (inclusive) via a numeric input in the settings UI.

**FR-03.3** Values outside the valid range are clamped silently on read (values below 500 become 500; values above 30 000 become 30 000). Invalid non-numeric values fall back to the default (2000 ms).

**FR-03.4** The debounce timer is per-plugin-instance, not per-tab. Only one timer runs at a time. Starting a new timer cancels any pending timer.

### FR-04: Save Target

**FR-04.1** Auto-save always targets the **active tab** at the moment the timer fires or the blur event fires — not the tab that was active when the timer was started.

**FR-04.2** The plugin invokes save by calling `__MARKABLE_TAB_MANAGER__.saveActiveTab()`. This reuses the full existing save path including atomic write, dirty-flag clear, title bar update, recent-files list update, and session save.

**FR-04.3** If the active tab is untitled (`filePath === null`), `saveActiveTab()` internally redirects to `saveActiveTabAs()`, which opens the native Save dialog. Auto-save **must not** allow this redirect. Before calling `saveActiveTab()`, the plugin must check that the active tab has a non-null `filePath`. If `filePath` is null, the auto-save attempt is silently skipped.

**FR-04.4** If the active tab is not dirty (`isDirty === false`), the save call is skipped to avoid a redundant write. The plugin checks `__MARKABLE_TAB_MANAGER__.getActiveTab()?.isDirty` before invoking save.

**FR-04.5** If the tab manager is not yet available (window global absent or returns null), the save attempt is silently skipped with a `console.warn`.

### FR-05: Settings Schema

Settings are persisted via `api.saveSettings()` / `api.loadSettings()` to:
`~/Library/Application Support/com.markable.app/plugins/auto-save/settings.json`

| Key | Type | Default | Description |
|---|---|---|---|
| `triggerMode` | `"debounce" \| "focus-loss" \| "both"` | `"both"` | Which event(s) trigger a save. |
| `debounceDelayMs` | integer (500 – 30 000) | `2000` | Milliseconds of inactivity before auto-save fires in debounce mode. |

**FR-05.1** Settings are loaded in `onEnable`. If `loadSettings()` returns `null` (first run or read error), the plugin uses the defaults above.

**FR-05.2** Settings are persisted immediately when the user changes any value in the settings UI (not deferred to `onDisable`).

### FR-06: Settings UI

**FR-06.1** The plugin implements `renderDetailExtra(container: HTMLElement)` to render its settings controls into the Plugins Panel detail view. No separate settings panel is required.

**FR-06.2** The settings UI must include:
- A **"Trigger"** dropdown or segmented control with the three mode options: "Debounce Timer", "Focus Loss", "Both".
- A **"Debounce Delay"** numeric input (visible and enabled only when trigger mode is `"debounce"` or `"both"`; hidden or disabled when mode is `"focus-loss"`).
- A unit label ("ms") adjacent to the delay input.

**FR-06.3** When the trigger mode is changed, the plugin saves the new value, then calls `api.restartSelf()` so the new listener set takes effect immediately.

**FR-06.4** When the debounce delay is changed, the plugin saves the new value. The new delay takes effect on the next timer reset (no restart required — the plugin reads the delay from its in-memory settings object, which is updated immediately).

**FR-06.5** The settings UI must use `--ui-font` and existing CSS variables so it matches the active theme. No hardcoded font stacks.

### FR-07: Status Bar Indicator (Optional v1)

**FR-07.1** The plugin does **not** add a status bar indicator in v1. This is explicitly out of scope. The Architect may propose one in v2 if user feedback indicates demand.

### FR-08: Plugin Enable / Disable Lifecycle

**FR-08.1** `onEnable`:
1. Load settings from disk (defaults on null).
2. Attach the appropriate listener(s) based on `triggerMode`.
3. If mode includes `"debounce"`: call `api.addExtensions([updateListenerExtension])`.
4. If mode includes `"focus-loss"`: attach `window.addEventListener("blur", blurHandler)`.

**FR-08.2** `onDisable`:
1. Cancel any pending debounce timer (`clearTimeout`).
2. Call `api.removeExtensions()` (no-op if no extensions were added).
3. Remove the `window` `"blur"` listener if it was attached.

**FR-08.3** The plugin must be safe to enable and disable multiple times in the same session without leaking timers or event listeners (EC guard: always remove before re-adding).

---

## Non-Functional Requirements

**NFR-01: No New Rust Commands** — Auto-save reuses the existing `write_file` Tauri command via `__MARKABLE_TAB_MANAGER__.saveActiveTab()`. No new Tauri commands are needed.

**NFR-02: No Save Dialog on Auto-Save** — Auto-save must never open a native save dialog. The untitled-tab guard in FR-04.3 is the enforcement mechanism.

**NFR-03: No Interruption of Manual Save** — If the user presses `Cmd-S` while an auto-save debounce is pending, the manual save proceeds normally. The auto-save timer should be cancelled after the manual save completes to avoid a redundant second write. Implementation note: the CM6 `updateListener` only fires on `docChanged`, and a manual save does not change the document, so the timer will naturally not re-fire unless the document changes again after the manual save.

**NFR-04: Self-Contained IIFE** — The plugin must follow all IIFE sandbox rules (see `focus-mode.plugin.ts` header): no app-internal imports, CM6 globals via `window.__CM_VIEW__` / `window.__CM_STATE__`, app globals via typed `window` cast.

**NFR-05: Test Coverage** — A Vitest test file (`tests/plugins/auto-save/auto-save.test.ts`) must cover: settings loading, settings defaults on null, triggerMode routing logic, debounce timer reset, untitled-tab skip, clean-tab skip, deactivation timer cleanup, and deactivation listener cleanup.

---

## Integration Points

| Module / Global | Role | Notes |
|---|---|---|
| `__MARKABLE_TAB_MANAGER__` | Invoke `saveActiveTab()`, read `getActiveTab()?.isDirty` and `getActiveTab()?.filePath` | Must null-check the global and the returned tab before use |
| `api.addExtensions()` / `api.removeExtensions()` | Register / deregister the CM6 `updateListener` for debounce mode | Standard plugin API — no new API surface needed |
| `window` `"blur"` event | Trigger save on focus loss | Attached in `onEnable`; removed in `onDisable`; named function reference required for removal |
| `api.loadSettings()` / `api.saveSettings()` | Persist `triggerMode` and `debounceDelayMs` | Per-plugin settings path auto-managed by plugin API |
| `api.restartSelf()` | Re-initialise listener set after trigger mode change | Called after `saveSettings()` in the UI change handler |
| `renderDetailExtra(container)` | Render the trigger mode + delay UI in the Plugins Panel detail view | Standard plugin hook; container is freshly created on each open |

---

## Out of Scope (v1)

1. **Per-tab auto-save toggle** — Auto-save applies uniformly to all named tabs. Per-tab opt-out is a v2 consideration.
2. **Auto-save of untitled documents** — Untitled tabs (no file path) are silently skipped. This deliberately avoids surprise Save-As dialogs.
3. **"Auto-saved N seconds ago" status bar indicator** — Not in v1 (FR-07.1).
4. **Conflict detection** — If the file on disk changed since last read (external edit), auto-save overwrites silently. Conflict detection is a separate feature.
5. **Auto-save interval mode** — A wall-clock timer that fires every N minutes regardless of document activity is not part of v1.
6. **Backup / versioning** — Auto-save writes to the same file. No backup copy or version history is created.
7. **"Pause auto-save"** — No in-session pause without fully disabling the plugin.
8. **Notification on auto-save** — No toast, alert, or transient UI message when an auto-save fires.
9. **Auto-save on tab switch** — Switching the active tab does not trigger a save. Only the debounce timer expiry and the window blur event are triggers.

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer.

**EC-01: Untitled tab is active when timer fires** — The debounce timer fires but the active tab has `filePath === null`. Expected: auto-save is silently skipped; no Save-As dialog opens; no error is thrown; the dirty indicator remains visible on the tab.

**EC-02: Clean tab when trigger fires** — The blur event fires (or timer fires) but the active tab is not dirty (`isDirty === false`). Expected: `saveActiveTab()` is not called; no write is issued; no error.

**EC-03: Rapid typing resets debounce** — The user types continuously. Expected: each `docChanged` transaction resets the timer; only one save fires, N ms after the final keystroke. No intermediate saves occur during the typing burst.

**EC-04: Manual Cmd-S while debounce timer is pending** — The user presses `Cmd-S` before the timer fires. Expected: the manual save proceeds immediately; the pending auto-save timer continues running but when it fires the tab is clean (`isDirty === false`) and is therefore skipped. No duplicate write occurs.

**EC-05: Plugin disabled while timer is pending** — The user disables the plugin (via the Plugins Panel toggle) while a debounce timer is in flight. Expected: `onDisable` cancels the timer with `clearTimeout`; no save fires after disable; the dirty indicator remains.

**EC-06: App window loses focus during active typing (blur fires mid-debounce)** — In `"both"` mode, focus-loss fires while a debounce timer is pending. Expected: the blur handler saves immediately; the pending timer is cancelled (or fires redundantly but finds the tab clean and skips). No double write.

**EC-07: Focus-loss fires when no tab is open** — The window blurs but there are no open tabs. Expected: `getActiveTab()` returns null; the save is silently skipped; no error.

**EC-08: Save write failure** — `saveActiveTab()` calls `writeFile()` which returns `{ ok: false }`. Expected: the existing `alert()` in `tabManager.saveActiveTab()` fires (unchanged behaviour). The tab remains dirty. The auto-save plugin does not add its own error UI.

**EC-09: Settings file absent on first enable** — `loadSettings()` returns `null` (first-run, no settings file yet). Expected: the plugin uses defaults (`triggerMode: "both"`, `debounceDelayMs: 2000`). The settings file is created the first time the user changes a setting.

**EC-10: Plugin enabled then immediately disabled before settings load resolves** — `onEnable` is async (awaits `loadSettings()`); `onDisable` is called before the load resolves. Expected: no timer is started; no listener is attached; `onDisable` completes safely. (Guard: check an `_active` flag set to `false` in `onDisable` before proceeding with setup in the `onEnable` continuation.)

**EC-11: Trigger mode changed to "focus-loss" while debounce timer is pending** — User changes mode in the settings UI. Expected: `api.restartSelf()` is called; `onDisable` cancels the pending timer and removes the CM6 extension; `onEnable` with new mode attaches only the blur listener.

**EC-12: Debounce delay changed to value below 500 ms** — User enters `100` in the delay input. Expected: the value is clamped to 500 ms on read; the UI may show `100` until the input loses focus, at which point it is corrected to `500`.

**EC-13: Multiple rapid toggle cycles (enable / disable / enable)** — User rapidly toggles the plugin on and off. Expected: each `onDisable` cancels any pending timer and removes listeners; each `onEnable` attaches fresh listeners; no stale listeners accumulate. (Verifiable: after N cycles, only one `"blur"` listener is attached.)

**EC-14: App quit with unsaved changes and auto-save pending** — The Tauri `"CloseRequested"` event fires (or the system sends a kill signal) while a debounce timer is in flight. Expected: the pending timer has not fired yet at quit time; the existing quit-time dirty-check dialog (in `TabManager.closeTab()` / `closeAll` flow) still presents the user with "Save / Don't Save / Cancel" as normal. Auto-save does not bypass the quit-time confirmation.

**EC-15: `__MARKABLE_TAB_MANAGER__` global not yet set** — The plugin is somehow enabled before the tab manager global is assigned in `main.ts`. Expected: the plugin reads the global inside the timer/blur callback (not at `onEnable` time), so by the time any trigger fires the global is available. If it is still absent at callback time, the plugin logs a `console.warn` and skips.

**EC-16: Focus loss triggered by opening a native OS dialog (e.g., Cmd-S Save-As dialog)** — Opening a native dialog causes the webview to lose focus, which fires `"blur"`. If the user opened a Save-As dialog manually, the auto-save blur handler fires. Expected: `getActiveTab()?.filePath` is null for an untitled tab (skipped, EC-01) or the tab is already in the process of being saved manually. Worst case: a redundant `saveActiveTab()` call is made for a named tab; `TabManager.saveActiveTab()` is idempotent (it calls `writeFile` again, which is atomic). Acceptable behaviour for v1.

---

## Resolved Decisions

**AD-01 — Reuse `__MARKABLE_TAB_MANAGER__.saveActiveTab()` directly**: This reuses the full existing save path (atomic write, dirty-flag clear, title bar, recent files, session save) without duplicating logic in the plugin.

**AD-02 — No new Tauri commands**: The save infrastructure already exists. The plugin is pure TypeScript with no Rust surface.

**AD-03 — Per-plugin settings file, not a new key in `settings.json`**: Consistent with all other plugins. The Rust raw-JSON pass-through in `settings.json` would accommodate a new key, but the plugin settings API (`api.loadSettings()` / `api.saveSettings()`) is the correct pattern.

**AD-04 — `api.restartSelf()` for mode changes**: Cleanest way to rebuild the listener set after a trigger mode change without manually threading teardown logic through the UI callback.

**AD-05 — Skip auto-save for untitled tabs rather than blocking**: The untitled-tab case is a silent skip. This avoids surprise Save-As dialogs during auto-save, which would be disruptive mid-flow. The user can always save untitled documents manually.

**AD-06 — Disabled by default**: Auto-save is a behaviour-altering feature. Opt-in is the safer default; users who want it will enable it.

---

## Proposed Constraints

1. The plugin must not import any app-internal modules. All app interaction goes through `window` globals (`__MARKABLE_TAB_MANAGER__`, `__CM_VIEW__`, `__CM_STATE__`) and the `api` parameter.
2. All timers and event listeners created in `onEnable` must be cleaned up in `onDisable`. An `_active` flag must guard the `onEnable` async continuation against a race with `onDisable`.
3. The blur handler must be stored as a named function reference (not an inline arrow) so `removeEventListener` can remove the exact listener added by `onEnable`.
4. Settings changes are saved eagerly (not deferred to `onDisable`) because the window may close before `onDisable` completes.
5. The plugin must not add a global `"blur"` listener at module evaluation time — only inside `onEnable`.
6. Test file location: `tests/plugins/auto-save/auto-save.test.ts`. Minimum coverage targets: debounce reset logic, untitled skip, clean-tab skip, disable teardown.
