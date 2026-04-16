---
title: "Step 4: Settings Panel Dropdown"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 4: Settings Panel Dropdown

## Goal

Add a "List Style" section to the Settings panel with a `<select>` dropdown for the four list styles. Changing the dropdown persists the setting immediately.

## Changes to `src/settings/settings-panel.ts`

### HTML (in `createSettingsPanel()`)

Add a new section inside `.settings-body`, between the "Tabs" section and the "Recent Files" section. This placement groups editor behavior settings together (Window, Tabs, List Style, Recent Files).

```html
<div class="settings-section">
  <label class="settings-label">List Style</label>
  <select class="settings-select" id="settings-list-style">
    <option value="standard">Standard (1. 2. 3.)</option>
    <option value="alphanumeric">Alphanumeric (I. A. 1. a. i.)</option>
    <option value="decimal">Decimal Outline (1. 1.1.)</option>
    <option value="steps">Steps (1. a. -)</option>
  </select>
  <p class="settings-description">Default style for new lists. Existing lists auto-detect their style from markers, or use a <code>&lt;!-- list: style --&gt;</code> comment override.</p>
</div>
```

### Event Wiring (in `wireEvents()`)

```typescript
const listStyleSelect = panelElement.querySelector("#settings-list-style") as HTMLSelectElement;
listStyleSelect?.addEventListener("change", async () => {
  await updateSettings((s) => ({
    ...s,
    listStyle: listStyleSelect.value as "standard" | "alphanumeric" | "decimal" | "steps",
  }));
});
```

This follows the exact same pattern as the window size dropdowns (lines 197-210).

### Sync (in `syncPanelToSettings()`)

```typescript
// List style dropdown
const listStyleSelect = document.querySelector("#settings-list-style") as HTMLSelectElement;
if (listStyleSelect) {
  listStyleSelect.value = settings.listStyle ?? "standard";
}
```

The `?? "standard"` fallback handles EC-13 (absent `listStyle` field in old settings files).

### Reset Handling

In the "Reset to defaults" click handler (line ~274), the `structuredClone(DEFAULT_SETTINGS)` already produces a settings object without `listStyle` (since it is optional and not in `DEFAULT_SETTINGS`). The `syncPanelToSettings()` call after reset will set the dropdown to "standard" via the `?? "standard"` fallback. No additional reset logic is needed.

## Edge Cases Addressed

- **EC-13**: Old settings files without `listStyle` field. The dropdown defaults to "standard" via the null-coalescing fallback. `getCurrentSettings().listStyle` returns `undefined`, and all consuming code (list-keybindings.ts:41, format.ts:17) already has `?? "standard"` fallbacks.

## Acceptance Criteria

1. Settings panel shows a "List Style" section with a dropdown containing four options.
2. Dropdown displays the current `listStyle` value when the panel opens.
3. If `listStyle` is absent from settings (migration), dropdown defaults to "Standard".
4. Changing the dropdown immediately persists via `updateSettings()`.
5. Description text reads: "Default style for new lists. Existing lists auto-detect their style from markers, or use a `<!-- list: style -->` comment override."
6. "Reset All" resets the dropdown to "Standard".
7. The section appears between "Tabs" and "Recent Files" in the panel layout.
8. All existing tests pass.
