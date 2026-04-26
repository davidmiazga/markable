---
title: "Command Bar — Step 06: Plugin Settings UI"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 06 — Plugin Settings UI

## Goal

Implement the `renderDetailExtra` hook that renders three checkbox controls in the
Plugins Panel detail view, allowing the user to toggle each result category
independently (FR-07).

---

## Files to Modify

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | `renderDetailExtra()` implementation |

---

## Settings schema

```typescript
interface CommandBarSettings {
  showCommands: boolean;    // default: true
  showHeadings: boolean;    // default: true
  showRecentFiles: boolean; // default: true
}

const DEFAULT_SETTINGS: CommandBarSettings = {
  showCommands: true,
  showHeadings: true,
  showRecentFiles: true,
};
```

---

## `renderDetailExtra(container: HTMLElement): void`

This function is called by the Plugins Panel when the user opens the Command Bar's
detail view. The `container` is freshly created on each call — no cleanup needed.

```typescript
function renderDetailExtra(container: HTMLElement): void {
  const items: Array<{ key: keyof CommandBarSettings; label: string; description: string }> = [
    {
      key: "showCommands",
      label: "Show Commands",
      description: "Include app commands and plugin toggles in results",
    },
    {
      key: "showHeadings",
      label: "Show Headings",
      description: "Include document headings for quick navigation",
    },
    {
      key: "showRecentFiles",
      label: "Show Recent Files",
      description: "Include recently opened files",
    },
  ];

  const section = document.createElement("div");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.className = "settings-label";
  title.textContent = "Result Categories";
  section.appendChild(title);

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "settings-row";

    const labelWrap = document.createElement("div");
    labelWrap.className = "settings-row-label";

    const labelEl = document.createElement("label");
    const id = `cb-setting-${item.key}`;
    labelEl.htmlFor = id;
    labelEl.className = "settings-label";
    labelEl.textContent = item.label;

    const descEl = document.createElement("p");
    descEl.className = "settings-description";
    descEl.textContent = item.description;

    labelWrap.appendChild(labelEl);
    labelWrap.appendChild(descEl);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.className = "settings-checkbox";
    checkbox.checked = _settings[item.key];

    checkbox.addEventListener("change", () => {
      _settings[item.key] = checkbox.checked;
      // Persist immediately (FR-07.2).
      if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
    });

    row.appendChild(labelWrap);
    row.appendChild(checkbox);
    section.appendChild(row);
  }

  container.appendChild(section);
}
```

---

## Settings load in `onEnable`

```typescript
async function loadPluginSettings(api: MarkablePluginAPI): Promise<void> {
  const saved = await api.loadSettings();
  if (saved) {
    _settings = {
      showCommands:    typeof saved.showCommands    === "boolean" ? saved.showCommands    : DEFAULT_SETTINGS.showCommands,
      showHeadings:    typeof saved.showHeadings    === "boolean" ? saved.showHeadings    : DEFAULT_SETTINGS.showHeadings,
      showRecentFiles: typeof saved.showRecentFiles === "boolean" ? saved.showRecentFiles : DEFAULT_SETTINGS.showRecentFiles,
    };
  } else {
    _settings = { ...DEFAULT_SETTINGS };
  }
}
```

---

## EC-18 behavior: all categories disabled

When all three settings are `false`, `buildAllResults()` returns `[]`. The bar opens
with the "No results" placeholder (EC-18, FR-07.3). The input field remains functional
— the user can type but will see only "No results". The user must re-enable categories
via the Plugins Panel detail view.

The bar is still closeable (Escape, backdrop click). This is the correct behavior — the
Command Bar is still functional as a UI element; it simply has no content configured.

---

## Test Cases

```typescript
// Default settings are applied when no saved data exists
_settings = { ...DEFAULT_SETTINGS };
expect(_settings.showCommands).toBe(true);
expect(_settings.showHeadings).toBe(true);
expect(_settings.showRecentFiles).toBe(true);

// loadPluginSettings with partial saved data falls back to defaults
const partial = { showCommands: false };
// After loading: showCommands = false, showHeadings = true (default), showRecentFiles = true (default)

// EC-18: buildAllResults with all disabled returns empty array
_settings = { showCommands: false, showHeadings: false, showRecentFiles: false };
const results = buildAllResults(_settings);
expect(results).toHaveLength(0);

// renderDetailExtra creates three checkboxes
const container = document.createElement("div");
renderDetailExtra(container);
const checkboxes = container.querySelectorAll("input[type=checkbox]");
expect(checkboxes.length).toBe(3);
expect((checkboxes[0] as HTMLInputElement).checked).toBe(true); // showCommands default
```

---

## Acceptance Criteria

- [ ] `renderDetailExtra` renders three labeled checkboxes with descriptions.
- [ ] Checkboxes reflect the current `_settings` state.
- [ ] Changing a checkbox persists the setting via `api.saveSettings()` immediately.
- [ ] Settings are loaded in `onEnable` via `api.loadSettings()`.
- [ ] Missing or corrupt saved data falls back to `DEFAULT_SETTINGS` (no crash).
- [ ] EC-18: with all categories disabled, bar opens with "No results" placeholder.
- [ ] Settings use the existing Plugins Panel CSS class names (`settings-section`,
  `settings-row`, `settings-label`, `settings-description`, `settings-checkbox`)
  for visual consistency.
- [ ] All settings tests pass via `npm test`.
