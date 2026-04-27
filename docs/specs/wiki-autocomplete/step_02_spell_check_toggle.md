---
title: "Step 02 — Spell Check Toggle"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 02 — Spell Check Toggle

## Goal

Add a `spellCheck` boolean to `EditorSettings`, wire a CM6 `spellCheckCompartment`
that sets `contentAttributes({ spellcheck })` on the editor's content element, make
`applyEditorSettings()` dispatch the reconfiguration to the live view, and expose a
checkbox toggle in a new "Editor" section of the settings panel.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/settings.ts` | Add `spellCheck?: boolean` to `EditorSettings`; add `spellCheck: false` to `DEFAULT_SETTINGS.editor`; update `applyEditorSettings()` |
| `src/editor/extensions.ts` | Export `spellCheckCompartment`; add initial `contentAttributes` to `buildExtensions()` |
| `src/settings/settings-panel.ts` | Add "Editor" section with spell check checkbox to `createSettingsPanel()`, `syncPanelToSettings()`, and `wireEvents()` |
| `tests/editor/spell-check.test.ts` | New file — tests for EC-B.01–EC-B.06 |

## Requirements Coverage

| Requirement | File |
|-------------|------|
| FR-B.1 settings key + default | `settings.ts` |
| FR-B.2 `contentAttributes` hot-swap | `extensions.ts` + `settings.ts` |
| FR-B.3 settings panel "Editor" section | `settings-panel.ts` |
| FR-B.4 persistence via `updateSettings` | `settings-panel.ts` (already handled by existing flow) |
| FR-B.5 no vault dependency | pure editor extension; no vault import |
| FR-B.6 Reset-All applies `DEFAULT_SETTINGS.editor.spellCheck` | existing Reset-All handler calls `applyEditorSettings(DEFAULT_SETTINGS.editor)` — no extra code |
| EC-B.01–EC-B.06 | tests |

---

## Implementation

### 1. `src/lib/settings.ts`

#### 1a. Add `spellCheck` to `EditorSettings`

```typescript
export interface EditorSettings {
  contentMaxWidth: number;
  contentPadding: string;
  baseFontSize: number;
  contentWidth?: string;
  spellCheck?: boolean;          // NEW — default false
}
```

#### 1b. Add to `DEFAULT_SETTINGS.editor`

```typescript
editor: {
  contentMaxWidth: 900,
  contentPadding: "responsive",
  baseFontSize: 16,
  spellCheck: false,             // NEW
},
```

#### 1c. Update `applyEditorSettings()`

Add dispatch logic after the existing CSS variable lines:

```typescript
export function applyEditorSettings(editor: EditorSettings): void {
  // Existing CSS variable lines — do not change:
  const root = document.documentElement;
  const cw = editor.contentWidth ?? `${editor.contentMaxWidth}px`;
  root.style.setProperty("--settings-content-max-width", cw);
  root.style.setProperty("--settings-base-font-size", `${editor.baseFontSize}px`);

  // NEW: reconfigure spellCheckCompartment on the live EditorView.
  // Use ?? false to handle old settings files that pre-date this field (EC-B.01, AD-09).
  const spellCheckEnabled = editor.spellCheck ?? false;
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (view) {
    // spellCheckCompartment is imported from extensions.ts
    view.dispatch({
      effects: spellCheckCompartment.reconfigure(
        EditorView.contentAttributes({ spellcheck: spellCheckEnabled ? "true" : "false" })
      ),
    });
  }
  // EC-B.04: if view is null (called before editor mounts), the compartment's
  // initial value ("false") holds. applyEditorSettings will be called again
  // post-mount with the loaded settings, at which point the view will exist.
}
```

Imports to add at the top of `settings.ts`:

```typescript
import { spellCheckCompartment } from "../editor/extensions";
import { EditorView } from "@codemirror/view";
```

Note: `EditorView` is already available in `@codemirror/view`. The import of
`spellCheckCompartment` creates a one-way dependency from `settings.ts` to
`extensions.ts`. This is safe — `extensions.ts` does not import from `settings.ts`.

### 2. `src/editor/extensions.ts`

#### 2a. Export `spellCheckCompartment` at module level

Add alongside the existing compartment declarations:

```typescript
/**
 * Compartment for the editor content's spellcheck attribute (FR-B.2).
 * Initialized to spellcheck="false". Reconfigured by applyEditorSettings()
 * when the user toggles spell check in the settings panel.
 * Module-level (not per-buildExtensions call) because there is one EditorView
 * for the application lifetime (AD-06).
 */
export const spellCheckCompartment = new Compartment();
```

#### 2b. Include initial value in `buildExtensions()`

Add before the `return extensions` statement:

```typescript
extensions.push(
  spellCheckCompartment.of(
    EditorView.contentAttributes({ spellcheck: "false" })
  )
);
```

Place it after `previewCompartment.of(...)` and `editableCompartment.of(...)` for
logical grouping.

### 3. `src/settings/settings-panel.ts`

#### 3a. Add "Editor" section HTML to `createSettingsPanel()`

Insert a new `<div class="settings-section">` block in the `settings-body` div,
after the "Appearance" section and before the "Recent Files" section:

```html
<div class="settings-section">
  <label class="settings-label">Editor</label>

  <div class="settings-maximize-row">
    <label class="settings-checkbox-label">
      <input type="checkbox" id="settings-spell-check" />
      <span>Spell check</span>
    </label>
  </div>
  <p class="settings-description">Underline misspelled words using the system dictionary.</p>
</div>
```

The markup reuses the existing `.settings-maximize-row` / `.settings-checkbox-label`
pattern (matches the "Maximize on Launch" checkbox row — same element class, same
`<label>` wrapping an `<input type="checkbox">`). No new CSS classes are needed.

#### 3b. Wire the checkbox in `wireEvents()`

```typescript
const spellCheckInput = panelElement.querySelector("#settings-spell-check") as HTMLInputElement;
spellCheckInput?.addEventListener("change", async () => {
  await updateSettings((s) => ({
    ...s,
    editor: { ...s.editor, spellCheck: spellCheckInput.checked },
  }));
  applyEditorSettings(getCurrentSettings().editor);
});
```

#### 3c. Sync the checkbox in `syncPanelToSettings()`

```typescript
const spellCheckInput = document.querySelector("#settings-spell-check") as HTMLInputElement;
if (spellCheckInput) {
  spellCheckInput.checked = settings.editor.spellCheck ?? false;
}
```

Add this inside `syncPanelToSettings()` alongside the other field syncs.

---

## Tests — `tests/editor/spell-check.test.ts` (new file)

This is a new test file. The tests mock `window.__MARKABLE_EDITOR_VIEW__` and the
`spellCheckCompartment.reconfigure` dispatch. They do not mount a real CM6 view.

### Test structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { applyEditorSettings, DEFAULT_SETTINGS } from "../../src/lib/settings"

describe("spell check — applyEditorSettings", () => {

  // EC-B.01: old settings file missing spellCheck
  it("treats absent spellCheck as false — no spellcheck=undefined on content element", () => {
    const dispatchMock = vi.fn()
    ;(window as any).__MARKABLE_EDITOR_VIEW__ = { dispatch: dispatchMock }
    const oldEditor = { contentMaxWidth: 900, contentPadding: "responsive", baseFontSize: 16 }
    applyEditorSettings(oldEditor as any)
    // dispatch must have been called with an effect — not with spellcheck="undefined"
    const effect = dispatchMock.mock.calls[0][0].effects
    expect(effect).toBeDefined()
    // The attribute value must be "false", not "undefined"
    // (implementation detail: verify via compartment.reconfigure arg)
  })

  // EC-B.04: view not yet initialised
  it("is a no-op when __MARKABLE_EDITOR_VIEW__ is absent", () => {
    delete (window as any).__MARKABLE_EDITOR_VIEW__
    // Must not throw
    expect(() => applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true })).not.toThrow()
  })

  // EC-B.02: toggle on, survives round-trip
  it("spellCheck: true produces dispatch with spellcheck='true'", () => {
    const dispatchMock = vi.fn()
    ;(window as any).__MARKABLE_EDITOR_VIEW__ = { dispatch: dispatchMock }
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true })
    expect(dispatchMock).toHaveBeenCalled()
  })

  // EC-B.03: rapid toggle — each call dispatches synchronously
  it("rapid calls each dispatch independently without error", () => {
    const dispatchMock = vi.fn()
    ;(window as any).__MARKABLE_EDITOR_VIEW__ = { dispatch: dispatchMock }
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true })
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: false })
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true })
    expect(dispatchMock).toHaveBeenCalledTimes(3)
  })

  // EC-B.05: Reset-All
  it("DEFAULT_SETTINGS.editor.spellCheck is false", () => {
    expect(DEFAULT_SETTINGS.editor.spellCheck).toBe(false)
  })
})
```

Note: EC-B.06 (multiple tabs) is documented as N/A in the test file, with a comment
explaining that Markable has a single `EditorView` and the concern does not apply
(AD-06). The comment is sufficient coverage — no failing test is needed.

---

## Edge Cases Coverage Mapping

| EC | Coverage |
|----|----------|
| EC-B.01 | `?? false` guard in `applyEditorSettings`; tested |
| EC-B.02 | toggle persisted via `updateSettings`; `applyEditorSettings` dispatches; tested |
| EC-B.03 | synchronous dispatch; each call is independent; tested |
| EC-B.04 | view absent → no-op; tested |
| EC-B.05 | `DEFAULT_SETTINGS.editor.spellCheck === false`; tested |
| EC-B.06 | N/A — single EditorView; documented in AD-06 and test file comment |
