---
title: "Auto-Save — Step 2: Core Logic"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 2 — Core Logic

## Goal

Implement the full runtime behaviour of the plugin: the `attemptSave` helper, the
CM6 `updateListener` (debounce), the `blurHandler` (focus-loss), the complete
`onEnable` body (trigger mode routing), and the complete `onDisable` body
(timer cancel, extension remove, listener remove). All edge cases from the
requirements EC inventory must be handled at this step.

---

## Prerequisite

Step 1 complete: `auto-save.plugin.ts` exists with stubs; `npm run build:plugins`
passes with the new entry.

---

## 2.1 — `attemptSave()` Implementation

Replace the stub from step 1:

```typescript
/**
 * Attempt to auto-save the currently active tab.
 *
 * Guards applied in order:
 *   1. Tab manager global absent → warn + skip (EC-15, FR-04.5)
 *   2. No active tab (getActiveTab() returns null) → skip silently (EC-07)
 *   3. Tab is untitled (filePath === null) → skip silently (EC-01, FR-04.3)
 *   4. Tab is clean (isDirty === false) → skip silently (EC-02, FR-04.4)
 *   5. All guards pass → call saveActiveTab()
 *
 * Exported for unit testing.
 */
export function attemptSave(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!tabManager) {
    console.warn("[auto-save] __MARKABLE_TAB_MANAGER__ is not available; skipping.");
    return;
  }

  const tab = tabManager.getActiveTab();

  // EC-07: no open tab
  if (!tab) return;

  // EC-01 / FR-04.3: untitled tab — never open Save-As dialog via auto-save
  if (tab.filePath === null) return;

  // EC-02 / FR-04.4: nothing to save
  if (!tab.isDirty) return;

  tabManager.saveActiveTab();
}
```

### Key contract notes

- The function reads the tab manager global at call time (not at `onEnable` time),
  satisfying EC-15: if the global is set between plugin enable and first trigger, it
  will be found.
- `saveActiveTab()` is called without `await`. The function is intentionally
  fire-and-forget from the plugin's perspective; the tab manager owns the async
  save path. EC-08 (write failure) surfaces through the tab manager's own `alert()`.

---

## 2.2 — `autoSaveListener` Extension Implementation

Replace the updateListener stub from step 1:

```typescript
/**
 * CM6 updateListener that resets the debounce timer on every docChanged transaction.
 *
 * Short-circuits if:
 *   - The transaction did not change the document (EC-03 implicit: cursor moves
 *     don't start the timer).
 *
 * Starting a new timer always cancels any pending timer first (FR-03.4, EC-03).
 * The delay is read from _settings.debounceDelayMs at each reset — changes to
 * the setting take effect on the next reset without a restart (FR-06.4, AD-5).
 *
 * Exported for unit testing.
 */
export const autoSaveListener = EditorView.updateListener.of((update: ViewUpdate) => {
  if (!update.docChanged) return;
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    attemptSave();
  }, _settings.debounceDelayMs);
});
```

---

## 2.3 — `onEnable` Implementation

Replace the stub body. The implementation follows FR-08.1 exactly.

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _active = true;
  _api = api;

  const raw = await api.loadSettings();

  // EC-10: onDisable was called before settings load resolved.
  // _active was set to false in onDisable; bail out without attaching anything.
  if (!_active) return;

  _settings = loadAndMergeSettings(raw);

  const { triggerMode } = _settings;

  // Attach the CM6 updateListener for debounce mode.
  if (triggerMode === "debounce" || triggerMode === "both") {
    api.addExtensions([autoSaveListener]);
  }

  // Attach the window blur listener for focus-loss mode.
  if (triggerMode === "focus-loss" || triggerMode === "both") {
    // Construct a fresh named handler that closes over the current api reference.
    // Stored in _blurHandler so onDisable can remove the exact same reference.
    _blurHandler = () => {
      attemptSave();
    };
    window.addEventListener("blur", _blurHandler);
  }
}
```

### Why the blur handler is constructed in `onEnable` and not at module level

The requirements constraint says "named function reference, not inline arrow". The
constraint exists so `removeEventListener` can identify the same function. A closure
constructed inside `onEnable` and stored in `_blurHandler` satisfies this: the same
object reference is used for both `add` and `remove`. A module-level arrow would fail
if the plugin is restarted (`api.restartSelf()`), because the closure would reference
a stale `_api`. The pattern used here (fresh closure per enable, stored in a module
`let`) is the correct solution.

---

## 2.4 — `onDisable` Implementation

Replace the stub body. The implementation follows FR-08.2 exactly.

```typescript
function onDisable(api: MarkablePluginAPI): void {
  // Must be set first so that the EC-10 check in onEnable's continuation bails out.
  _active = false;
  _api = null;

  // Cancel any pending debounce timer (EC-05, FR-08.2.1).
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Remove the CM6 extension (no-op if it was never added). FR-08.2.2.
  api.removeExtensions();

  // Remove the blur listener if it was attached (FR-08.2.3, EC-13).
  if (_blurHandler !== null) {
    window.removeEventListener("blur", _blurHandler);
    _blurHandler = null;
  }
}
```

---

## 2.5 — Edge Case Coverage Mapping

This table maps each EC from the requirements to the code construct that satisfies it.

| EC | Description | Satisfied by |
|---|---|---|
| EC-01 | Untitled tab when timer fires | `if (tab.filePath === null) return` in `attemptSave` |
| EC-02 | Clean tab when trigger fires | `if (!tab.isDirty) return` in `attemptSave` |
| EC-03 | Rapid typing resets debounce | `clearTimeout` before each `setTimeout` in `autoSaveListener` |
| EC-04 | Manual save while timer pending | Manual save doesn't change doc; timer fires, tab is clean, `isDirty` guard skips |
| EC-05 | Plugin disabled while timer pending | `clearTimeout` in `onDisable` |
| EC-06 | Blur fires mid-debounce in "both" mode | Blur calls `attemptSave()` (saves if dirty); timer fires later, tab is clean, skips |
| EC-07 | Focus-loss with no open tab | `if (!tab) return` in `attemptSave` |
| EC-08 | Write failure | Delegated to `TabManager.saveActiveTab()` alert; plugin takes no action |
| EC-09 | Settings absent on first enable | `loadAndMergeSettings(null)` returns `DEFAULT_SETTINGS` |
| EC-10 | Disabled before settings load resolves | `if (!_active) return` after `await api.loadSettings()` |
| EC-11 | Mode changed to "focus-loss" with timer pending | `api.restartSelf()` → `onDisable` cancels timer; `onEnable` attaches only blur handler |
| EC-12 | Delay below 500 ms | `clampDelay` returns 500; UI corrects on input blur |
| EC-13 | Multiple rapid toggle cycles | Each `onDisable` clears timer + removes listener; `_blurHandler = null` prevents double-remove |
| EC-14 | App quit with pending timer | Tauri quit-time dialog fires first; timer has not fired; existing dialog unchanged |
| EC-15 | Tab manager global absent at callback time | `if (!tabManager)` check at top of `attemptSave` |
| EC-16 | Blur from native dialog | Redundant `saveActiveTab()` for named dirty tab is idempotent; acceptable v1 behaviour |

---

## 2.6 — Verification

After implementing step 2:

1. Reload the app in dev mode (`npm run tauri dev`) with the plugin rebuilt.
2. Enable the Auto-Save plugin via the Plugins Panel.
3. Open or create a named file and type — the file should save ~2 s after typing stops
   (observe title bar dirty indicator clearing).
4. Verify that typing into a new untitled document does NOT open a Save-As dialog.
5. Disable the plugin while typing — confirm no save fires after disable.

---

## Step 2 is done when

- `attemptSave`, `autoSaveListener`, `onEnable`, and `onDisable` are fully implemented.
- All module-level state (`_active`, `_debounceTimer`, `_blurHandler`) is correctly
  initialised, set, and cleared.
- Manual smoke test passes (items 2–5 above).
- `npm run build:plugins` still exits 0 with no TypeScript errors.
