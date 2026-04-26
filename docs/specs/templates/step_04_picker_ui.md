---
title: "Step 04 — Picker UI, Setup Wizard, and Settings UI"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Step 04: Picker UI, Setup Wizard, and Settings UI

**Goal**: Implement the modal template picker, the first-use setup wizard, the plugin detail settings UI, and all CSS. Replace the stubs from step_03.

## Requirement Traceability

- FR-3 (picker UI), FR-6 (setup wizard)
- FR-8.2/8.3 (CSS injection/removal)
- FR-8.4 (no CM6 extensions)
- FR-9.4 (renderDetailExtra)
- EC-3, EC-12, EC-13, EC-15, EC-19

## 1. CSS

The `injectTemplatesCSS()` function injects a `<style>` tag with id `__markable_templates_css__`. All colors use existing CSS variables for theme compatibility (NFR-4).

### CSS Classes

```
.templates-overlay          — Full-screen backdrop (rgba(0,0,0,0.5)), position:fixed, z-index:9999
.templates-card             — Centered modal card, max-width:420px, max-height:60vh
.templates-header           — Card header with title text
.templates-filter           — Text input for type-to-filter
.templates-list             — Scrollable list container, overflow-y:auto
.templates-item             — Individual template entry (button), full-width
.templates-item.selected    — Highlighted item (keyboard navigation)
.templates-item:hover       — Hover state
.templates-empty            — Empty state message
.templates-wizard-card      — Setup wizard card (slightly different layout)
.templates-wizard-field     — Text input for folder name
.templates-wizard-checkbox  — Checkbox row for "Create starter templates"
.templates-wizard-actions   — Button row (Create Folder / Cancel)
.templates-btn              — Generic button base
.templates-btn-primary      — Primary action button (Create Folder, etc.)
.templates-btn-secondary    — Secondary button (Cancel)
```

All CSS uses `var(--bg-primary)`, `var(--bg-secondary)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--border-color)`, `var(--selection-bg)` (FR-3.6).

## 2. Template Picker UI

### `showPickerUI(templatesFolder: string, templates: string[])`

Replaces the stub from step_03.

**DOM structure**:

```html
<div class="templates-overlay">
  <div class="templates-card">
    <div class="templates-header">New from Template</div>
    <input class="templates-filter" type="text" placeholder="Filter templates..." autofocus>
    <div class="templates-list">
      <!-- If templates.length === 0: -->
      <div class="templates-empty">
        No templates found in {folderName}/. Create a template using File > Save as Template.
      </div>
      <!-- Otherwise, one per template: -->
      <button class="templates-item">meeting-notes</button>
      <button class="templates-item selected">note</button>
      <!-- etc -->
    </div>
  </div>
</div>
```

**Behavior**:

1. Set `_pickerOpen = true`.
2. Append overlay to `document.body`.
3. Create the filter input and template list from the `templates` array.
4. Display names are filenames with `.md` stripped (FR-2.3).
5. First item is highlighted by default (index 0).
6. Focus the filter input.

**Filter logic** (FR-3.3):

- On `input` event, filter `templates` by case-insensitive substring match against display name.
- Rebuild the list DOM with matching items only.
- Reset selection index to 0.
- If no matches, show: "No matching templates."

**Keyboard navigation** (FR-3.4):

- `ArrowDown`: move selection index + 1 (clamp to list length - 1).
- `ArrowUp`: move selection index - 1 (clamp to 0).
- `Enter`: apply the currently highlighted template.
- `Escape`: close picker without action (FR-3.5, EC-19).
- All keyboard handlers are on the overlay element (captures while filter is focused).

**Click handling** (FR-3.2):

- Each `.templates-item` button has a `click` listener that applies that template.
- Click on the overlay backdrop (outside the card) dismisses the picker (FR-3.5).

**Template application on selection**:

```typescript
// Capture templatesFolder at picker open time (EC-10)
const selectedFilename = templates[filteredList[selectedIndex]]; // original filename
const templatePath = `${templatesFolder}/${selectedFilename}`;
closePicker();
await applyTemplate(templatePath);
```

**EC-13 (rapid double-click)**: After the first selection triggers `closePicker()`, the overlay is removed from the DOM. The second click has no target.

### `closePicker()`

1. Remove the overlay element from `document.body`.
2. Set `_pickerOpen = false`.

### `closePickerIfOpen()`

Replaces the stub from step_03. Calls `closePicker()` if `_pickerOpen` is true.

## 3. Setup Wizard UI

### `showSetupWizard()`

Replaces the stub from step_03. Called when `_settings.setupComplete` is false.

**DOM structure**:

```html
<div class="templates-overlay">
  <div class="templates-wizard-card">
    <div class="templates-header">Templates Setup</div>
    <p>No templates folder is configured for this directory.</p>
    <label>Folder name:</label>
    <input class="templates-wizard-field" type="text" value="Templates">
    <label class="templates-wizard-checkbox">
      <input type="checkbox" checked> Create starter templates
    </label>
    <div class="templates-wizard-actions">
      <button class="templates-btn templates-btn-secondary">Cancel</button>
      <button class="templates-btn templates-btn-primary">Create Folder</button>
    </div>
  </div>
</div>
```

**"Create Folder" action** (FR-6.3):

```typescript
async function handleCreateFolder(folderName: string, createStarters: boolean): Promise<void> {
  const workDir = getWorkingDirectory();
  if (!workDir) return;

  const folderPath = `${workDir}/${folderName}`;

  // 1. Create the folder
  try {
    await (window as any).__TAURI_INTERNALS__.invoke("ensure_directory", { path: folderPath });
  } catch (error) {
    alert(`Could not create templates folder: ${String(error)}`);
    return; // EC-15: dialog stays open
  }

  // 2. Write starter templates if checked
  if (createStarters) {
    for (const [filename, content] of Object.entries(STARTER_TEMPLATES)) {
      try {
        await (window as any).__TAURI_INTERNALS__.invoke("write_file", {
          path: `${folderPath}/${filename}`,
          content,
        });
      } catch (error) {
        console.warn(`[templates] Failed to write starter template ${filename}:`, error);
        // Non-fatal: continue with remaining starters
      }
    }
  }

  // 3. Save settings
  _settings.templatesFolderName = folderName;
  _settings.createStarterTemplates = createStarters;
  _settings.setupComplete = true;
  if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);

  // 4. Close wizard and immediately open picker (FR-6.4)
  closePicker(); // reuse same overlay cleanup
  const templates = await discoverTemplates(folderPath);
  showPickerUI(folderPath, templates);
}
```

**"Cancel" button**: closes the wizard overlay, sets `_pickerOpen = false`.

**Escape key**: closes the wizard (same as Cancel).

**Validation**: folder name must be non-empty and not contain `/` or `\`. Show inline error if invalid.

## 4. Plugin Detail Settings UI

### `renderDetailExtra(container: HTMLElement)`

Add this to the plugin export object. It renders a settings section in the Plugins Panel detail view.

**DOM**:

```html
<div style="padding: 8px 0;">
  <div style="margin-bottom: 8px;">
    <label style="...">Templates folder name:</label>
    <input type="text" value="{_settings.templatesFolderName}" style="...">
    <button style="...">Save</button>
  </div>
  <button style="...">Reconfigure Templates Folder</button>
</div>
```

**"Save" button**: Updates `_settings.templatesFolderName` with the input value and persists via `_api.saveSettings()`.

**"Reconfigure Templates Folder" button** (FR-6.4): Resets `_settings.setupComplete = false`, saves, then calls `openPicker()` which will trigger the wizard.

## 5. Implementation Checklist

- [ ] `injectTemplatesCSS()` — inject full CSS string with all classes listed above
- [ ] `removeTemplatesCSS()` — remove style tag by id (already stubbed in step_03)
- [ ] `showPickerUI()` — replace stub with full DOM + event handlers
- [ ] `closePicker()` — remove overlay, reset `_pickerOpen`
- [ ] `closePickerIfOpen()` — replace stub
- [ ] `showSetupWizard()` — replace stub with full wizard DOM + handlers
- [ ] `handleCreateFolder()` — wizard "Create Folder" logic
- [ ] `renderDetailExtra` — add to plugin export object
- [ ] Keyboard event handler on overlay (ArrowUp/Down, Enter, Escape)
- [ ] Filter input handler (real-time substring filtering)
- [ ] Backdrop click dismissal

## Verification

After this step:
- Cmd-Shift-N opens the setup wizard on first use (no settings saved).
- After setup, Cmd-Shift-N opens the template picker showing discovered templates.
- Typing in the filter narrows the list.
- Arrow keys navigate, Enter selects, Escape dismisses.
- Clicking outside dismisses.
- Selected template creates a new tab with template content.
- Empty templates folder shows the empty state message (EC-3).
- Plugin detail view in Plugins Panel shows folder name setting and reconfigure button.

## Files Changed

| File | Change |
|---|---|
| `src/plugins/templates/templates.plugin.ts` | Replace stubs with full UI implementations |
