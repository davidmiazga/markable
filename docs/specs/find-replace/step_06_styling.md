# Step 06 — Finalize find-widget.css + Theming Verification

**Goal:** Complete the `find-widget.css` with any missing visual polish, verify all theming tokens display correctly in light, dark, and custom themes, and confirm no layout regressions exist.

**Precondition:** step_05 complete (widget is fully functional).

---

## Files to Change

| File | Change type |
|---|---|
| `src/editor/find-widget.css` | Finalize: complete any visual polish, verify token coverage |
| `src/styles.css` | No changes expected — `--search-*` tokens already defined for both themes |

---

## 1. CSS Token Coverage Checklist

The widget CSS skeleton from step_02 already uses the correct tokens. Verify each is correctly defined in `styles.css` under both `:root` (light) and `[data-theme="dark"]`:

| Token | Light value | Dark value | Widget usage |
|---|---|---|---|
| `--search-panel-bg` | `hsl(0, 0%, 97%)` | `hsl(216, 28%, 10%)` | Widget background (FR-9.1) |
| `--search-panel-border` | `hsl(0, 0%, 88%)` | `hsl(216, 28%, 30%)` | Widget border (FR-9.2) |
| `--bg-primary` | `hsl(0, 0%, 100%)` | `hsl(216, 28%, 7%)` | Input backgrounds (FR-9.3) |
| `--text-primary` | `hsl(213, 13%, 16%)` | `hsl(216, 28%, 93%)` | Input text, button text (FR-9.3) |
| `--text-secondary` | `hsl(212, 10%, 38%)` | `hsl(216, 28%, 65%)` | Count label, toggle buttons |
| `--border-color` | `hsl(0, 0%, 88%)` | `hsl(216, 28%, 30%)` | Input borders (FR-9.3) |
| `--link-color` | `hsl(212, 95%, 40%)` | `hsl(212, 92%, 45%)` | Toggle active state (FR-9.5) |
| `--search-match-bg` | `hsla(45, 95%, 55%, 0.4)` | `rgba(56, 139, 253, 0.25)` | `.cm-searchMatch` (kept in search-theme.ts) |
| `--search-match-selected-bg` | `hsla(45, 95%, 45%, 0.75)` | `rgba(56, 139, 253, 0.60)` | `.cm-searchMatch-selected` (kept in search-theme.ts) |

All tokens are already present in `styles.css`. No additions needed.

---

## 2. Complete CSS Rules

The following items from the step_02 skeleton may need polish during this step. Verify each visually:

### Box shadow in dark mode

The default shadow `0 4px 16px rgba(0, 0, 0, 0.15)` may be too subtle in dark mode. Add a dark-mode override:

```css
[data-theme="dark"] .find-widget {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
}
```

### Custom theme compatibility (EC-10)

Custom themes (nord, solarized-dark) inject a `<style>` element that overrides CSS variables on `:root[data-theme="dark"]`. Since the widget inherits from `:root`, it updates automatically when the theme changes. No JS update is needed. Verify visually with the nord and solarized-dark themes.

### Button label sizing on narrow widget

At minimum widget width (320px), ensure the button labels `Aa`, `ab`, `.*`, `↑`, `↓`, `×` fit without truncation. The 26px width allocated in step_02 is sufficient for these single-glyph labels.

### Replace button sizing

The "Replace" and "All" labels must be legible. If they truncate, increase the padding or use shorter labels ("→1" / "→all" are alternatives). Default is "Replace" / "All".

### Scrolling prevention

The widget has no scroll. If the find row somehow wraps (very narrow viewport + long search term), the `flex-wrap: nowrap` on `.find-widget-find-row` prevents it. The find input's `min-width: 0` allows it to shrink.

---

## 3. Visual Verification Checklist

Test each item in the running app. User sign-off required before this step is marked complete.

### Light theme (default-light)

- [ ] Widget background is slightly off-white (`--search-panel-bg`), visually distinct from the editor background.
- [ ] Widget border is visible.
- [ ] Find input has a white background with dark text.
- [ ] Toggle buttons (inactive) show grey text; active toggles show a blue tint.
- [ ] Count label "3 of 12" is readable in secondary text color.
- [ ] "No results" label appears red.
- [ ] Navigation and close buttons are visible and respond to hover.
- [ ] Replace row inputs and buttons match the find row visual style.

### Dark theme (default-dark)

- [ ] Widget background is darker than the editor (`--search-panel-bg` dark value).
- [ ] All text is legible on the dark background.
- [ ] Input fields show the dark primary background.
- [ ] Active toggle buttons show a blue tint using `--link-color`.
- [ ] Box shadow is visible against the dark editor.

### Custom themes — nord.css

- [ ] Widget adopts nord theme colors (overriding the dark base CSS variables).
- [ ] No hardcoded colors bleed through.

### Custom themes — solarized-dark.css

- [ ] Same as nord check.

---

## 4. Acceptance Criteria

- [ ] AC-9: Widget background, border, and text match the active theme on both light and dark.
- [ ] AC-10: Custom themes style the widget correctly via CSS variables (no hardcoded colors in widget CSS).
- [ ] EC-10: Switching theme while widget is open updates widget colors immediately (CSS variable change propagates without any JS).
- [ ] Widget does not push editor content down in either theme (AC-7) — use DevTools layout inspector.
- [ ] No visible CM6 panel DOM at the bottom of the editor in any theme.
- [ ] Replace row background is consistent with find row background.
- [ ] Toggle button active state is visually distinct in both themes.
- [ ] "No results" and "Invalid" count states are visually distinct in both themes.
- [ ] Box shadow is visible in both themes.
- [ ] `tsc --noEmit` still passes after any CSS file changes (only matters if TypeScript types for CSS imports are involved).

---

## 5. No Changes to `styles.css`

The `--search-*` CSS custom properties defined in `styles.css` under `:root` and `[data-theme="dark"]` are retained unchanged, as specified in FR-9.8. The widget CSS uses these properties through inheritance. No new tokens are added to `styles.css`.
