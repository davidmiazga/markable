---
title: "YAML Pane — Step 04: Panel DOM"
last-updated: "2026-04-17"
review-cadence-days: 7
status: active
---

# Step 04 — Panel DOM

## Goal

Implement all **DOM rendering functions** for the YAML Pane sidebar panel. This step produces the full visible UI: field rows with type-appropriate controls, empty/error states, "Add Front Matter" and "Add Field" interactions, schema-driven validation, and the CSS.

This step is the most complex. Break it into sub-units for clarity.

---

## Files to Modify

| Action | File |
|---|---|
| Modify | `src/plugins/yaml-pane/yaml-pane.plugin.ts` — add all DOM functions and CSS |
| Modify | `tests/plugins/yaml-pane/yaml-pane.test.ts` — add DOM tests (jsdom environment) |

The DOM tests require `environment: 'jsdom'` in the Vitest config for the test file. Add a `@vitest-environment jsdom` inline comment at the top of the test file for this group, or configure per-file environment in `vitest.config.ts`.

---

## CSS

Define as a string constant `YAML_PANE_CSS`. Inject via `<style id="__markable_yaml_pane_css__">` in `onEnable`; remove in `onDisable`. All colors use CSS variables from the active theme.

### Required CSS classes

```
.yaml-pane-container         — outer flex column, fills sidebar content area
.yaml-pane-scroll            — flex: 1, overflow-y: auto, padding: 8px 0
.yaml-pane-warning           — schema load warning banner (yellow/amber tint)
.yaml-pane-warning-text      — warning message text
.yaml-pane-reload-btn        — "Reload Schema" button inside warning banner
.yaml-pane-field-row         — one field: label + control + delete button
.yaml-pane-field-label       — key name label, 11px, font-weight: 500, color: --text-secondary
.yaml-pane-field-description — optional description text under label, 10px, color: --text-secondary, opacity: 0.7
.yaml-pane-required-dot      — red dot or asterisk on label for required fields (FR-5.5)
.yaml-pane-control           — the editing control (input/select/toggle/textarea/chips)
.yaml-pane-delete-btn        — per-row delete button, visible on hover of .yaml-pane-field-row
.yaml-pane-chips-container   — wrapping flex container for chip widget
.yaml-pane-chip              — individual tag chip (text + × button)
.yaml-pane-chip-remove       — the × button on each chip
.yaml-pane-chip-input        — the text input for adding new chips
.yaml-pane-chip-error        — inline error message below chip input (EC-9)
.yaml-pane-empty-state       — centered empty state message
.yaml-pane-error-state       — error state message (red/error tint)
.yaml-pane-add-fm-btn        — "Add Front Matter" button
.yaml-pane-add-field-row     — inline "Add Field" input row at bottom
.yaml-pane-add-field-key     — key name input in "Add Field" row
.yaml-pane-add-field-val     — value input in "Add Field" row
.yaml-pane-add-field-btn     — confirm/cancel buttons for "Add Field"
.yaml-pane-nested-section    — collapsible sub-section for nested objects (FR-2.3)
.yaml-pane-nested-toggle     — expand/collapse button for nested section
.yaml-pane-raw-value         — read-only textarea for deep-nested values (EC-6)
```

### Theme variable usage (NFR-4)

Use these CSS variables throughout (defined by Markable themes):
- `--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`
- `--border-color`, `--accent-color`, `--selection-bg`
- `--ui-font`, `--mono-font`

Field inputs: `background: var(--bg-secondary)`, `color: var(--text-primary)`, `border: 1px solid var(--border-color)`, `border-radius: 3px`.

---

## Module-Level Panel State

```typescript
let _panelContainer: HTMLElement | null = null;
let _panelState: PanelState = { kind: "empty" };
let _editingKey: string | null = null;    // key of field currently being edited (FR-3.7)
let _addFieldVisible: boolean = false;    // whether "Add Field" row is open
let _nestedExpanded: Set<string> = new Set();  // keys of expanded nested sections
```

---

## Functions to Implement

### CSS lifecycle helpers

```typescript
function injectYamlPaneCSS(): void
function removeYamlPaneCSS(): void
```

Same pattern as backlinks/auto-toc. Guard with `document.getElementById("__markable_yaml_pane_css__")`.

### `renderPanel(container: HTMLElement): void`

Entry point called by the sidebar panel `render()` callback. Sets `_panelContainer`, then calls `rebuildPanelDOM()`.

### `rebuildPanelDOM(): void`

Clears and fully rebuilds `_panelContainer`'s children based on `_panelState`.

```
if _panelState.kind === "empty"  → renderEmptyState(container)
if _panelState.kind === "error"  → renderErrorState(container, message)
if _panelState.kind === "fields" → renderFieldsState(container, fields)
```

Always: if `_schemaLoadError` is non-null, prepend the schema warning banner before the main content.

### `renderEmptyState(container: HTMLElement): void`

Renders:
```
[centered message: "No front matter"]
[Add Front Matter button]
```

Clicking "Add Front Matter":
1. Derive `title` from the document using `deriveTitle()` (see below).
2. Derive `date` as today's ISO 8601 string: `new Date().toISOString().slice(0, 10)`.
3. Build fields array: `[{ key: "date", value: date, ... }, { key: "title", value: title, ... }]`.
4. Build front matter string using `buildFrontMatterString(fields, [], { kind: "structural" })`.
5. Call `dispatchFrontMatterUpdate(fmString, 0)` (insert at position 0, no existing front matter to replace, so `closingOffset = 0`).
6. Set `_panelState = { kind: "fields", fields }` and call `rebuildPanelDOM()`.

### `deriveTitle(): string`

Pure function. Derives the `title` value for auto-population (FR-6.1):

1. Read `window.__MARKABLE_EDITOR_VIEW__?.state.doc.toString()`.
2. Scan for the first line matching `/^# (.+)/` (H1 heading). Extract the text after `# `. Strip any inline Markdown: remove `**`, `_`, `` ` ``, `[text](url)` → `text`. Return the cleaned text.
3. If no H1: read `window.__MARKABLE_CURRENT_FILE__`. Extract the filename without extension. Replace `-` and `_` with spaces. Return it.
4. If no file path: return `"Untitled"`.

### `renderErrorState(container: HTMLElement, message: string): void`

Renders a styled error message: "Front matter contains invalid YAML. Edit the raw text to fix it." (EC-2). The actual parse error message from the parser can be shown as a sub-line in smaller, monospace text.

### `renderFieldsState(container: HTMLElement, fields: EnrichedField[]): void`

Renders the full field list:
1. For each `field` in `fields`, call `renderFieldRow(scrollContainer, field)`.
2. Append "Add Field" button at the bottom.
3. If `_addFieldVisible`, append the "Add Field" inline row.

### `renderFieldRow(container: HTMLElement, field: EnrichedField): void`

Renders one field row. Layout: `[label] [control] [delete-btn]`.

Label section:
- Display `field.key` as the label text.
- If `field.required`: append `.yaml-pane-required-dot` (a red asterisk).
- If `field.description`: add a sub-line with description text.
- If `field.isMissing`: apply a yellow/amber highlight to the row to indicate it's absent from the document (FR-5.5).

Control section: delegate to `renderFieldControl(field, row)`.

Delete button:
- Visible on `.yaml-pane-field-row:hover` (CSS `visibility: hidden` / `visible`).
- On click: remove the field from the current field model and call `commitFieldDelete(field.key)`.

### `renderFieldControl(field: EnrichedField, container: HTMLElement): void`

Selects and renders the appropriate control based on `field.effectiveType`:

| effectiveType | Control | Notes |
|---|---|---|
| `"boolean"` | `<input type="checkbox">` | FR-4.1 |
| `"number"` | `<input type="number">` | FR-4.2 |
| `"date"` | `<input type="date">` | FR-4.6 |
| `"string"` + `isBlockScalar=false` | `<input type="text">` | FR-4.3 |
| `"string"` + `isBlockScalar=true` | `<textarea>` | FR-2.6, FR-4.3 |
| `"null"` | `<input type="text" placeholder="(empty)">` | FR-4.5 |
| `"array"` or `"multiselect"` | chip widget | FR-2.4 |
| `"select"` | `<select>` dropdown | FR-5.3 |
| `"object"` | collapsible nested section | FR-2.3 |

For all scalar inputs (text, number, date, checkbox):
- Set initial value from `field.value`.
- On `focus`: set `_editingKey = field.key` (FR-3.7 — suppresses updateListener re-render for this field).
- On `blur` or `Enter` keydown: call `commitScalarEdit(field.key, newValue)`, then set `_editingKey = null`.

### `renderChipWidget(field: EnrichedField, container: HTMLElement): void`

Renders the chip/tag widget for array, multiselect, and array-with-schema fields.

Structure:
```
.yaml-pane-chips-container
  [chip for each existing value]
    [chip text]  [× button]
  .yaml-pane-chip-input  (text input, always shown at end)
  .yaml-pane-chip-error  (hidden unless validation fails)
```

Chip widget behavior:
- Each chip's `×` button removes the item and calls `commitArrayEdit(key, newArray)`.
- The text input shows an autocomplete dropdown from `field.schemaValues` (if present) as the user types.
  - Autocomplete: a `<datalist>` element linked to the input via `list` attribute, filtered to values not already in the chip array.
  - Free-text is allowed unless `field.effectiveType === "multiselect"` AND `field.schemaValues` is non-null and non-empty.
- On `Enter` or comma in the chip input:
  1. Trim and validate the input value.
  2. If `field.schemaValues` is non-empty AND value is not in `field.schemaValues`: show inline error (EC-9), do not add.
  3. If value is already in the chip list (case-insensitive compare): show inline error "Already added", do not add.
  4. Otherwise: add chip, clear input, call `commitArrayEdit`.
- On `blur` of the chip input: if input is non-empty, attempt to commit it as above.

### `renderSelectControl(field: EnrichedField, container: HTMLElement): void`

Renders a `<select>` for `"select"` type fields.

- Options: from `field.schemaValues`. If `field.schemaValues` is empty: log `console.warn` (EC-24), render a disabled select with placeholder "No options defined".
- On `change`: call `commitScalarEdit(field.key, selectedValue)`.

### `renderNestedSection(field: EnrichedField, container: HTMLElement): void`

Renders a collapsible sub-section for `"object"` type fields (FR-2.3).

- The nested object's value (a `Record<string, unknown>`) is iterated one level.
- Each sub-key/sub-value pair is rendered as a simplified field row (label + read-only value display, no delete button).
- Sub-values that are themselves objects or arrays: display as a raw YAML string in a `.yaml-pane-raw-value` textarea (read-only, EC-6).
- Toggle button shows/hides the sub-section. State stored in `_nestedExpanded` Set.

### Commit functions (effect functions — access globals)

```typescript
function commitScalarEdit(key: string, newValue: unknown): void
function commitArrayEdit(key: string, newArray: unknown[]): void
function commitFieldDelete(key: string): void
function commitAddField(key: string, value: string): void
```

Each commit function:
1. Validates the change (EC-21: duplicate key check in `commitAddField`, EC-22: key quoting).
2. Updates the in-memory field model (`_panelState.fields`).
3. Calls `buildFrontMatterString` with appropriate `changeType`.
4. Calls `dispatchFrontMatterUpdate` with the new string and current `closingOffset`.
5. Calls `rebuildPanelDOM()` to re-render the panel.

`commitAddField` additionally:
- Checks for duplicate key (EC-21): scan `_panelState.fields` for existing key. If found: show inline error in the "Add Field" row.
- Validates key characters: any key is valid (YAML allows nearly any string as a key when quoted); apply `formatYamlKey` to handle quoting automatically.

### `renderAddFieldRow(container: HTMLElement): void`

Renders the inline "Add Field" row when `_addFieldVisible === true`:
```
[key input: "Field name..."]  [value input: "Value..."]  [Add] [Cancel]
```

If a schema is loaded, the key input uses a `<datalist>` showing schema field names not yet present in the document (OQ-5 hybrid: free-text + schema suggestions).

On "Add" button click or `Enter` in the value input: call `commitAddField(key, value)`.
On "Cancel" or `Escape` keydown: set `_addFieldVisible = false`, call `rebuildPanelDOM()`.

### `updatePanelState(newState: PanelState): void`

Called by the CM6 updateListener (Step 05) when the document changes. Updates `_panelState` and calls `rebuildPanelDOM()` — unless the currently edited field would be disrupted.

FR-3.7 guard: if `_editingKey` is non-null, only update fields for which the change did NOT originate from the YAML Pane's own dispatch. This is handled in Step 05 by checking the transaction's `userEvent`.

---

## Test Cases to Write First (Red Phase)

DOM tests use `@vitest-environment jsdom`. They test DOM output, not behavior.

### Group: `renderEmptyState`

```
1.  Container has element with class "yaml-pane-empty-state"
2.  Container has "Add Front Matter" button
3.  "Add Front Matter" button has visible text
```

### Group: `renderErrorState`

```
4.  Container has element with class "yaml-pane-error-state"
5.  Error message text is visible in the DOM
```

### Group: `renderFieldRow` — scalar types

```
6.  String field → renders <input type="text"> with correct value
7.  Number field → renders <input type="number"> with correct value
8.  Boolean field → renders <input type="checkbox"> checked/unchecked
9.  Date field → renders <input type="date"> with value in YYYY-MM-DD format
10. Null field → renders <input type="text"> with placeholder "(empty)"
11. Block scalar string field → renders <textarea>
12. Field with description → description sub-label present in DOM
13. Required field → required dot/asterisk present in DOM
14. Missing required field → row has amber/yellow highlight class
```

### Group: `renderFieldRow` — chip widget

```
15. Array ["a", "b"] → two chips rendered, each with × button
16. Empty array → no chips, only the input
17. Chip × click removes chip from DOM (check DOM, not dispatch)
18. Chip input accepts new value on Enter
19. Schema multiselect: value not in schemaValues → error message shown (EC-9)
20. Schema multiselect: value already in list → error message "Already added"
21. Schema array with values → datalist present with schema options
```

### Group: `renderFieldRow` — select control

```
22. Select field with values ["a", "b"] → <select> with two <option> elements
23. Select field with values [] → disabled select with placeholder (EC-24)
```

### Group: `renderFieldRow` — nested object

```
24. Object field "meta" → nested section rendered
25. Nested section toggle collapses/expands (DOM state change)
26. Deeply nested sub-object → raw YAML textarea (EC-6)
```

### Group: `renderFieldsState`

```
27. Two fields rendered in correct order
28. "Add Field" button present at bottom
29. `_addFieldVisible = true` → "Add Field" row rendered
```

### Group: `renderAddFieldRow`

```
30. Row has key input and value input
31. Cancel button hides the row (_addFieldVisible = false)
32. Schema loaded → datalist with schema field names present on key input
```

### Group: `deriveTitle` (pure function — no jsdom needed)

```
33. Document text "# My Title\n\nSome content" → "My Title"
34. Document text "## H2 not H1\n" (no H1) + currentFile="/docs/my-note.md" → "my note"
35. Document text "" + currentFile="/docs/my_note.md" → "my note"
36. No document, no file → "Untitled" (EC-18)
37. H1 with inline Markdown "# **Bold** Title" → "Bold Title" (Markdown stripped)
```

---

## Implementation Notes

1. **`rebuildPanelDOM` vs incremental update:** Full DOM rebuild on every state change. This is the same strategy used by `rebuildBacklinksDOM` and `rebuildTOC`. With up to 50+ fields (EC-16) the rebuild is still fast — avoid premature optimization. The `overflow-y: auto` on `.yaml-pane-scroll` handles the scrolling (EC-16).

2. **`_editingKey` guard (FR-3.7):** When `updatePanelState` is called while `_editingKey` is non-null, the correct behavior is:
   - If the incoming change is from the YAML Pane's own dispatch (`userEvent === YAML_PANE_USER_EVENT`): skip re-render entirely (the panel already reflects the committed value).
   - If the incoming change is external (undo, another plugin): force re-render anyway, discarding the in-progress edit. The user loses their uncommitted input. This is the documented EC-13 behavior.

3. **Chip input autocomplete via `<datalist>`:** Using native `<datalist>` is the simplest approach that works in Tauri's WebKit. No custom dropdown component needed. Filter the datalist on each `input` event to only show values not already in the chip array.

4. **Date input value format:** `<input type="date">` requires `YYYY-MM-DD` value format. When the field value is already a date string (`rawType === "date"`), it is already in this format. On commit, read `.valueAsDate` or `.value` and pass the string directly.

5. **Schema warning banner placement:** The warning banner (`.yaml-pane-warning`) is prepended before the scroll container, so it is always visible even when the user has scrolled the field list. It must be outside `.yaml-pane-scroll`.

6. **Nested section click-to-navigate removal:** The nested section does not support click-to-navigate (it's not a link panel). Toggle is purely expand/collapse. Sub-fields in the nested section are rendered without delete buttons and without commit wiring — read-only display only for MVP.

7. **`commitAddField` key quoting:** The key entered by the user is stored as the display key in the panel. In the written YAML, if the key requires quoting (per `needsKeyQuoting`), `formatYamlKey` wraps it. The display label always shows the unquoted form (EC-22).

8. **"Add Field" default value type:** The "Add Field" row always writes the new field as a string value initially. The panel will then infer the type from the written YAML on the next parse cycle (after the dispatch triggers the updateListener). This keeps the "Add Field" UX simple.

---

## Acceptance Criteria

- [ ] All DOM test cases pass (jsdom environment)
- [ ] All three panel states (empty, error, fields) render correctly
- [ ] Chip widget correctly validates against schema values and rejects duplicates
- [ ] Select control warns on empty values (EC-24)
- [ ] Required fields show visual indicator (FR-5.5)
- [ ] Missing required fields show as placeholders (FR-5.5)
- [ ] Nested object fields are collapsible and show raw YAML for deep nesting (EC-6)
- [ ] `deriveTitle` correctly prioritizes H1 → filename → "Untitled" (FR-6.1)
- [ ] CSS uses only `--` variable references, no hardcoded theme colors (NFR-4)
- [ ] Panel scrolls when field list overflows (EC-16)
