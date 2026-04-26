---
title: "Step 08 — Plugin Settings: persistence + detail UI"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 08: Plugin Settings

**Requirement:** FR-08 (Plugin Settings), EC-23 (null settings first run), EC-24 (save failure handling)
**Files modified:** `src/plugins/diagrams/diagrams.plugin.ts`

---

## Goal

Wire up settings persistence via `api.loadSettings()` / `api.saveSettings()` and implement the `renderDetailExtra` hook to expose the settings UI in the Plugins Panel detail view.

Settings managed:
| Key | Type | Default |
|-----|------|---------|
| `mermaidTheme` | `"auto" \| "dark" \| "default" \| "neutral" \| "forest"` | `"auto"` |
| `maxRenderWidth` | `number` | `900` |
| `showErrorSource` | `boolean` | `true` |

---

## Implementation Instructions

### Part 1: Replace settings stub in onEnable

Replace `_settings = { ...DEFAULT_SETTINGS };` at the top of `onEnable` with a full `api.loadSettings()` call that merges loaded values with defaults:

```typescript
// Load persisted settings. Returns null on first run (EC-23) — defaults are used.
const raw = await api.loadSettings();
if (raw !== null) {
  // Merge: only keys that exist in DEFAULT_SETTINGS and have the right type are applied.
  // Unknown keys in raw are silently ignored (forward compatibility).
  if (typeof raw.mermaidTheme === "string" &&
      ["auto", "dark", "default", "neutral", "forest"].includes(raw.mermaidTheme as string)) {
    _settings.mermaidTheme = raw.mermaidTheme as DiagramsSettings["mermaidTheme"];
  }
  if (typeof raw.maxRenderWidth === "number" && raw.maxRenderWidth > 0) {
    _settings.maxRenderWidth = raw.maxRenderWidth;
  }
  if (typeof raw.showErrorSource === "boolean") {
    _settings.showErrorSource = raw.showErrorSource;
  }
}
```

The `_settings` is initialized to `{ ...DEFAULT_SETTINGS }` at module level (step_03). The `if (raw !== null)` guard handles EC-23. Properties with unexpected types are silently skipped, so a corrupted settings file does not crash the plugin.

### Part 2: Settings save helper

Add this helper function after the `dispatchThemeEffect` function (step_07):

```typescript
/**
 * Save current _settings to disk via the plugin API.
 *
 * Logs and swallows any save error — the in-memory settings remain active
 * for the session even if the disk write fails (EC-24, FR-08.1).
 *
 * @param api - The MarkablePluginAPI from the current enable cycle.
 */
function saveSettings(api: MarkablePluginAPI): void {
  api.saveSettings({ ..._settings }).catch((err: unknown) => {
    console.warn("[diagrams] Failed to save settings:", err);
  });
}
```

### Part 3: renderDetailExtra

Add the `renderDetailExtra` method to the plugin's `export default` object. This method is called by the Plugins Panel when the user opens the Diagrams plugin's detail view. It renders a simple settings form.

```typescript
renderDetailExtra(container: HTMLElement): void {
  // Mermaid theme row
  const themeRow = document.createElement("div");
  themeRow.className = "plugin-detail-setting-row";
  themeRow.innerHTML = `
    <label for="diagrams-theme-select">Diagram theme</label>
    <select id="diagrams-theme-select">
      <option value="auto">Auto (follows app theme)</option>
      <option value="default">Default (light)</option>
      <option value="dark">Dark</option>
      <option value="neutral">Neutral</option>
      <option value="forest">Forest</option>
    </select>
  `;
  const themeSelect = themeRow.querySelector<HTMLSelectElement>("#diagrams-theme-select")!;
  themeSelect.value = _settings.mermaidTheme;
  themeSelect.addEventListener("change", () => {
    _settings.mermaidTheme = themeSelect.value as DiagramsSettings["mermaidTheme"];
    // When the user picks a non-auto theme, immediately re-init Mermaid
    // and trigger a re-render so the change is visible instantly.
    const changed = reinitIfNeeded();
    if (changed) dispatchThemeEffect();
    // Note: dispatchThemeEffect requires the editor view to be live.
    // If no document is open, this is a no-op (view is null).
    // Use the api captured via the onEnable closure — but renderDetailExtra
    // does not have direct api access. Save via the module-level _currentApi ref.
    if (_currentApi) saveSettings(_currentApi);
  });
  container.appendChild(themeRow);

  // Max render width row
  const widthRow = document.createElement("div");
  widthRow.className = "plugin-detail-setting-row";
  widthRow.innerHTML = `
    <label for="diagrams-width-input">Max render width (px)</label>
    <input id="diagrams-width-input" type="number" min="200" max="4000" step="50" />
  `;
  const widthInput = widthRow.querySelector<HTMLInputElement>("#diagrams-width-input")!;
  widthInput.value = String(_settings.maxRenderWidth);
  widthInput.addEventListener("change", () => {
    const v = parseInt(widthInput.value, 10);
    if (v > 0 && v <= 4000) {
      _settings.maxRenderWidth = v;
      if (_currentApi) saveSettings(_currentApi);
      // Update the CSS variable on all existing .cm-mermaid-block elements.
      document.querySelectorAll<HTMLElement>(".cm-mermaid-block").forEach((el) => {
        el.style.setProperty("--mermaid-max-width", `${v}px`);
      });
    }
  });
  container.appendChild(widthRow);

  // Show error source row
  const errorRow = document.createElement("div");
  errorRow.className = "plugin-detail-setting-row";
  errorRow.innerHTML = `
    <label>
      <input id="diagrams-show-error-source" type="checkbox" />
      Show diagram source in error messages
    </label>
  `;
  const errorCheck = errorRow.querySelector<HTMLInputElement>("#diagrams-show-error-source")!;
  errorCheck.checked = _settings.showErrorSource;
  errorCheck.addEventListener("change", () => {
    _settings.showErrorSource = errorCheck.checked;
    if (_currentApi) saveSettings(_currentApi);
  });
  container.appendChild(errorRow);
},
```

### Part 4: Module-level _currentApi reference

The `renderDetailExtra` method needs access to the `MarkablePluginAPI` to call `saveSettings()`. But `renderDetailExtra` is called by the Plugins Panel without passing `api` — it only receives `container`. Capture the API in a module-level reference in `onEnable` and clear it in `onDisable`.

Add this declaration near the other module-level state (step_03):

```typescript
/** Reference to the current MarkablePluginAPI. Set in onEnable, cleared in onDisable. */
let _currentApi: MarkablePluginAPI | null = null;
```

In `onEnable`, add as the very first line:

```typescript
_currentApi = api;
```

In `onDisable`, add before the `api.removeExtensions()` call:

```typescript
_currentApi = null;
```

---

## Notes

- `renderDetailExtra` does not need to clean up after itself — the Plugins Panel creates a fresh container each time the detail view is opened.
- The `saveSettings` helper catches errors and logs them (EC-24). It never throws.
- The `maxRenderWidth` live update via `document.querySelectorAll` applies to existing rendered widgets without requiring a StateField recompute — this is a purely cosmetic property update.
- The `mermaidTheme` change does trigger `reinitIfNeeded()` and `dispatchThemeEffect()` because theme changes require Mermaid to re-render all SVG content with the new color scheme.

---

## Acceptance Criteria

- [ ] On first plugin enable, `api.loadSettings()` returns null — defaults are used (EC-23)
- [ ] On subsequent enables, loaded settings override defaults for valid keys only
- [ ] An invalid `mermaidTheme` value in the saved JSON does not change `_settings` (type guard)
- [ ] A non-positive `maxRenderWidth` value in the saved JSON does not change `_settings` (range guard)
- [ ] `renderDetailExtra` is present in the `export default` object
- [ ] The Plugins Panel detail view for the Diagrams plugin shows the three settings controls
- [ ] Changing theme in the settings UI re-renders diagrams with the selected theme
- [ ] Changing maxRenderWidth updates `.cm-mermaid-block` CSS variable immediately
- [ ] `api.saveSettings()` is called after each setting change
- [ ] A save failure logs a warning and does not crash (EC-24)
- [ ] `npm run build:plugins` compiles without TypeScript errors

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/diagrams/diagrams.plugin.ts` | MODIFY | Wire api.loadSettings, saveSettings helper, renderDetailExtra, _currentApi |
