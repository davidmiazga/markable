# Step 04: Editor Settings (Content Width + Font Size)

**Covers:** R3, R4, TC-6, NF3
**Edge Cases:** EC-20, EC-21
**Depends on:** Step 02 (settings singleton, bridge), Step 03 (window state pattern established)
**Files Modified:** `src/styles.css`, `src/editor/extensions.ts`, `src/main.ts`, `src/lib/settings.ts`

---

## Objective

Apply `editor.contentMaxWidth` and `editor.baseFontSize` from settings to the editor. Content width uses a CSS custom property. Font size uses a CSS custom property that the CM6 preview theme references. Responsive padding uses CSS media queries. All changes take effect immediately (no restart).

---

## 1. CSS Custom Properties

Add to `src/styles.css` in the `:root` block:

```css
:root {
  /* ... existing variables ... */

  /* Settings-driven variables (set by JavaScript) */
  --settings-content-max-width: 900px;
  --settings-base-font-size: 16px;
}
```

Update the preview-mode content rule to use the new variable:

```css
.preview-mode .cm-content {
  max-width: var(--settings-content-max-width);
  margin: 0 auto;
  padding: 24px var(--preview-padding);
}
```

This replaces the hardcoded `var(--preview-max-width)` with `var(--settings-content-max-width)`. The `--preview-max-width` variable in `:root` can be removed or kept as a fallback.

---

## 2. Responsive Padding Breakpoints (TC-6)

Add CSS media queries to `src/styles.css`. These are based on **window width**, not container width, so standard `@media` queries are appropriate:

```css
/* ============================================================
   Responsive Padding Breakpoints (R3 / TC-6)
   Applied only in preview mode. Uses window-width media queries.
   ============================================================ */

/* Small: window < 640px */
@media (max-width: 639px) {
  .preview-mode .cm-content {
    padding-left: 16px;
    padding-right: 16px;
  }
}

/* Medium: 640px - 767px */
@media (min-width: 640px) and (max-width: 767px) {
  .preview-mode .cm-content {
    padding-left: 24px;
    padding-right: 24px;
  }
}

/* Large: 768px - 1023px */
@media (min-width: 768px) and (max-width: 1023px) {
  .preview-mode .cm-content {
    padding-left: 64px;
    padding-right: 64px;
  }
}

/* Extra large: >= 1024px */
@media (min-width: 1024px) {
  .preview-mode .cm-content {
    padding-left: 64px;
    padding-right: 64px;
  }
}
```

**Design note:** These breakpoints are pure CSS. No JavaScript resize listeners are needed (TC-6). The padding values are defined per the requirements spec (R3). The `contentPadding: "responsive"` setting value is honored by using these media queries when the value is "responsive". If a future version allows fixed padding values, the JavaScript can set `--preview-padding` directly and skip the media queries.

---

## 3. Font Size: CSS Custom Property Approach

The base font size affects the `.cm-editor` in preview mode. Rather than using a CM6 compartment for font size (which requires recreating the theme), we use a CSS custom property that the CM6 theme references.

**Update the `previewTheme` in `src/editor/extensions.ts`:**

```typescript
export const previewTheme = EditorView.theme({
  "&": {
    fontFamily: interStack,
    fontSize: "var(--settings-base-font-size)",  // Changed from "16px"
    lineHeight: "1.7",
  },
  ".cm-content": {
    fontFamily: interStack,
  },
  ".cm-line": {
    fontFamily: interStack,
  },
});
```

This means the CM6 preview theme reads the font size from a CSS variable. When JavaScript updates `--settings-base-font-size`, the editor picks it up via CSS. The heading em-based scaling (3em for H1, 2.2em for H2, etc.) in `styles.css` continues to work because `em` is relative to the parent font size, which is now `var(--settings-base-font-size)`.

**Advantage:** No CM6 compartment reconfiguration is needed for font size changes. CSS custom property changes are instant and don't require dispatching an editor transaction.

---

## 4. Apply Editor Settings Function

Add to `src/lib/settings.ts`:

```typescript
/**
 * Apply editor settings to the DOM via CSS custom properties.
 * Called on init and whenever settings change.
 *
 * This function does NOT touch CM6 state -- it only sets CSS variables.
 * CM6 reads these variables through its theme configuration.
 */
export function applyEditorSettings(editor: EditorSettings): void {
  const root = document.documentElement;

  // Content max-width
  root.style.setProperty(
    "--settings-content-max-width",
    `${editor.contentMaxWidth}px`
  );

  // Base font size
  root.style.setProperty(
    "--settings-base-font-size",
    `${editor.baseFontSize}px`
  );
}
```

---

## 5. Integration in initApp()

In `src/main.ts`, after `loadSettings()` and `createEditor()`:

```typescript
async function initApp() {
  const settings = await loadSettings();

  await applyWindowSettings(settings.window);

  // Create editor
  const editorContainer = document.getElementById("editor");
  editor = createEditor(editorContainer, "");

  // Apply editor settings (content width + font size)
  applyEditorSettings(settings.editor);

  // ... rest of init ...
  await showWindow();
}
```

---

## 6. Live Update (No Restart Required -- NF3)

When the settings panel changes `contentMaxWidth` or `baseFontSize`, it calls:

```typescript
// Example: user changes font size to 18
updateSettings((s) => ({
  ...s,
  editor: { ...s.editor, baseFontSize: 18 },
}));
applyEditorSettings(getCurrentSettings().editor);
```

The `applyEditorSettings()` function sets the CSS variables, and the editor responds immediately because:
1. `max-width` on `.cm-content` is a CSS layout property -- changing the variable triggers a relayout.
2. `font-size` on `.cm-editor` is a CSS property -- changing the variable triggers text reflow.
3. Heading sizes (3em, 2.2em, etc.) scale proportionally because they use `em` units relative to the base font size.

No CM6 compartment dispatch is needed. No DOM replacement. No restart.

---

## 7. Validation on Frontend

The Rust backend clamps values (Step 01), but the frontend should also validate when the user interacts with the settings panel (Step 07). For this step, add validation constants:

```typescript
export const EDITOR_CONSTRAINTS = {
  contentMaxWidth: { min: 500, max: 1400, step: 50 },
  baseFontSize: { min: 10, max: 28, step: 1 },
} as const;
```

These constants are used by the settings panel sliders (Step 07) and for frontend-side clamping if needed.

---

## 8. Tests

Add to `tests/settings.test.ts`:

```typescript
describe("applyEditorSettings", () => {
  it("sets --settings-content-max-width CSS variable", () => {
    applyEditorSettings({ contentMaxWidth: 800, contentPadding: "responsive", baseFontSize: 16 });
    const value = document.documentElement.style.getPropertyValue("--settings-content-max-width");
    expect(value).toBe("800px");
  });

  it("sets --settings-base-font-size CSS variable", () => {
    applyEditorSettings({ contentMaxWidth: 900, contentPadding: "responsive", baseFontSize: 20 });
    const value = document.documentElement.style.getPropertyValue("--settings-base-font-size");
    expect(value).toBe("20px");
  });

  it("uses default content width of 900px", () => {
    applyEditorSettings(DEFAULT_SETTINGS.editor);
    const value = document.documentElement.style.getPropertyValue("--settings-content-max-width");
    expect(value).toBe("900px");
  });

  it("uses default font size of 16px", () => {
    applyEditorSettings(DEFAULT_SETTINGS.editor);
    const value = document.documentElement.style.getPropertyValue("--settings-base-font-size");
    expect(value).toBe("16px");
  });
});

describe("EDITOR_CONSTRAINTS", () => {
  it("has correct content width range", () => {
    expect(EDITOR_CONSTRAINTS.contentMaxWidth.min).toBe(500);
    expect(EDITOR_CONSTRAINTS.contentMaxWidth.max).toBe(1400);
  });

  it("has correct font size range", () => {
    expect(EDITOR_CONSTRAINTS.baseFontSize.min).toBe(10);
    expect(EDITOR_CONSTRAINTS.baseFontSize.max).toBe(28);
  });
});
```

---

## Done Criteria

- [ ] `--settings-content-max-width` CSS custom property exists in `:root`
- [ ] `--settings-base-font-size` CSS custom property exists in `:root`
- [ ] `.preview-mode .cm-content` uses `var(--settings-content-max-width)` for `max-width`
- [ ] `previewTheme` in `extensions.ts` uses `var(--settings-base-font-size)` for font size
- [ ] Responsive padding breakpoints defined in CSS media queries
- [ ] `applyEditorSettings()` function sets both CSS variables
- [ ] Called during `initApp()` after `loadSettings()`
- [ ] Font size change updates all text including headings (em-based scaling preserved)
- [ ] Content width change updates editor layout immediately
- [ ] `EDITOR_CONSTRAINTS` constants exported for settings panel use
- [ ] All tests pass
- [ ] `tsc --noEmit` passes
