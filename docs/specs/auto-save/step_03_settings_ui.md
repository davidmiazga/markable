---
title: "Auto-Save — Step 3: Settings UI"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 3 — Settings UI

## Goal

Implement `renderDetailExtra` to render the Auto-Save configuration controls into
the Plugins Panel detail view. The UI must present a trigger mode dropdown and a
debounce delay numeric input. All controls must use CSS variables (`--ui-font`,
`--accent-color`) so they respect the active theme. Settings are persisted eagerly
on every change.

---

## Prerequisite

Step 2 complete: `attemptSave`, `onEnable`, `onDisable` all implemented and verified.

---

## 3.1 — CSS Injection

The plugin needs a small amount of CSS to style the settings rows consistently with
other plugins (diagrams, media-preview use the same `.plugin-detail-setting-row` class
pattern). Inject it once in `onEnable` (using the idempotent `getElementById` guard)
and remove it in `onDisable`.

```typescript
function injectCSS(): void {
  const id = "__markable_auto_save_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .auto-save-settings-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-family: var(--ui-font);
      font-size: 13px;
    }
    .auto-save-settings-row label {
      flex: 0 0 140px;
      color: var(--text-color, inherit);
    }
    .auto-save-settings-row select,
    .auto-save-settings-row input[type="number"] {
      font-family: var(--ui-font);
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border-color, #ccc);
      background: var(--input-bg, #fff);
      color: var(--text-color, inherit);
    }
    .auto-save-delay-unit {
      color: var(--text-muted, #888);
      font-family: var(--ui-font);
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById("__markable_auto_save_css__")?.remove();
}
```

Add `injectCSS()` at the end of `onEnable` (after listeners are attached).
Add `removeCSS()` at the end of `onDisable` (after listeners are removed).

---

## 3.2 — `buildTriggerRow()` Helper

Builds the "Trigger" setting row. Saves the new trigger mode then calls
`api.restartSelf()` so the listener set is rebuilt cleanly (FR-06.3, AD-4).

```typescript
/**
 * Build the trigger mode selector row.
 *
 * Change handler:
 *   1. Updates _settings.triggerMode in memory.
 *   2. Calls api.saveSettings() to persist.
 *   3. Calls api.restartSelf() so the new listener set takes effect (FR-06.3, EC-11).
 *
 * Note: after restartSelf() the detail panel may re-render; the next open will
 * show the updated setting because renderDetailExtra reads _settings directly.
 */
function buildTriggerRow(api: MarkablePluginAPI): HTMLElement {
  const row = document.createElement("div");
  row.className = "auto-save-settings-row";

  const label = document.createElement("label");
  label.textContent = "Trigger";

  const select = document.createElement("select");
  const options: Array<[TriggerMode, string]> = [
    ["debounce",    "Debounce Timer"],
    ["focus-loss",  "Focus Loss"],
    ["both",        "Both"],
  ];
  for (const [value, text] of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    opt.selected = _settings.triggerMode === value;
    select.appendChild(opt);
  }

  select.addEventListener("change", async () => {
    _settings.triggerMode = select.value as TriggerMode;
    await api.saveSettings(_settings as unknown as Record<string, unknown>);
    await api.restartSelf();
    // Note: after restartSelf the plugin is re-enabled with the new mode;
    // the detail panel container reference is no longer live — no further
    // DOM updates are needed here.
  });

  row.appendChild(label);
  row.appendChild(select);
  return row;
}
```

---

## 3.3 — `buildDelayRow()` Helper

Builds the "Debounce Delay" row. The row is hidden when trigger mode is `"focus-loss"`
(FR-06.2). Updates `_settings.debounceDelayMs` in memory on change; persists eagerly.
The new delay takes effect on the next timer reset without a plugin restart (FR-06.4).

```typescript
/**
 * Build the debounce delay numeric input row.
 *
 * Visibility: hidden when triggerMode is "focus-loss" (FR-06.2).
 *
 * Change handler (fires on input blur or Enter — not on every keystroke):
 *   1. Clamps the raw input value via clampDelay() (EC-12).
 *   2. Updates the input's displayed value to the clamped value (corrects out-of-range input).
 *   3. Updates _settings.debounceDelayMs in memory.
 *   4. Calls api.saveSettings() to persist.
 *   No restart required — the timer reads _settings.debounceDelayMs at each reset.
 */
function buildDelayRow(api: MarkablePluginAPI): HTMLElement {
  const row = document.createElement("div");
  row.className = "auto-save-settings-row";

  // Hide row when focus-loss-only mode is active (FR-06.2).
  if (_settings.triggerMode === "focus-loss") {
    row.style.display = "none";
  }

  const label = document.createElement("label");
  label.textContent = "Debounce Delay";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "500";
  input.max = "30000";
  input.step = "100";
  input.value = String(_settings.debounceDelayMs);
  input.style.width = "80px";

  const unit = document.createElement("span");
  unit.className = "auto-save-delay-unit";
  unit.textContent = "ms";

  input.addEventListener("change", async () => {
    const clamped = clampDelay(input.value);
    // EC-12: correct out-of-range values in the UI.
    input.value = String(clamped);
    _settings.debounceDelayMs = clamped;
    await api.saveSettings(_settings as unknown as Record<string, unknown>);
    // No restartSelf() needed — the listener reads _settings.debounceDelayMs directly.
  });

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(unit);
  return row;
}
```

---

## 3.4 — `renderDetailExtra` Implementation

Replace the stub from step 1:

```typescript
/**
 * Render Auto-Save settings into the Plugins Panel detail view (FR-06.1).
 *
 * Called every time the detail view is opened. The container is freshly created
 * on each call — no cleanup required. Must not throw.
 *
 * Renders:
 *   1. buildTriggerRow() — trigger mode dropdown (always visible)
 *   2. buildDelayRow()   — debounce delay input (hidden in focus-loss mode)
 *
 * Uses the module-level _api reference set in onEnable. If the plugin is disabled
 * when the detail view is opened (unlikely but possible), _api will be null and
 * the change handlers will silently no-op because api.saveSettings / api.restartSelf
 * are not called without a valid api reference.
 *
 * The `_api` null-check is included in each handler rather than in renderDetailExtra
 * itself because the container stays in the DOM until the panel closes, and the plugin
 * could theoretically be disabled while the panel is open.
 */
function renderDetailExtra(container: HTMLElement): void {
  // Use the module-level _api captured in onEnable.
  // If plugin is somehow disabled when this renders, pass a dummy object that no-ops.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const api = _api ?? ({
    saveSettings: async () => {},
    restartSelf: async () => {},
  } as any as MarkablePluginAPI);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  container.appendChild(buildTriggerRow(api));
  container.appendChild(buildDelayRow(api));
}
```

---

## 3.5 — Full `onEnable` and `onDisable` with CSS Calls

After adding CSS helpers, update the call sites:

**`onEnable`** — add `injectCSS()` at the end of the continuation block
(after listeners are attached, inside the `if (!_active) return` guard):

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _active = true;
  _api = api;

  const raw = await api.loadSettings();
  if (!_active) return; // EC-10

  _settings = loadAndMergeSettings(raw);

  const { triggerMode } = _settings;

  if (triggerMode === "debounce" || triggerMode === "both") {
    api.addExtensions([autoSaveListener]);
  }

  if (triggerMode === "focus-loss" || triggerMode === "both") {
    _blurHandler = () => { attemptSave(); };
    window.addEventListener("blur", _blurHandler);
  }

  injectCSS();
}
```

**`onDisable`** — add `removeCSS()` at the end:

```typescript
function onDisable(api: MarkablePluginAPI): void {
  _active = false;
  _api = null;

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  api.removeExtensions();

  if (_blurHandler !== null) {
    window.removeEventListener("blur", _blurHandler);
    _blurHandler = null;
  }

  removeCSS();
}
```

---

## 3.6 — Verification

1. Enable the Auto-Save plugin and open the Plugins Panel.
2. Click on the Auto-Save plugin — the detail view should show the Trigger dropdown
   and the Debounce Delay input.
3. The Trigger dropdown should default to "Both" on first enable.
4. Change Trigger to "Focus Loss" — the Debounce Delay row should hide.
5. Change Trigger back to "Both" — the Debounce Delay row should reappear.
6. Enter `100` in the Debounce Delay input and press Tab/Enter — it should clamp to `500`.
7. Enter `35000` — it should clamp to `30000`.
8. Disable and re-enable the plugin — the saved trigger mode should persist.
9. Verify that `--ui-font` is applied (controls match the app font).

---

## Step 3 is done when

- `renderDetailExtra` renders both controls using the correct CSS variable pattern.
- Trigger mode change triggers `api.restartSelf()` after `api.saveSettings()`.
- Delay input clamps values and persists without restart.
- CSS is injected in `onEnable` and removed in `onDisable`.
- All verification steps pass.
