# Step 03 — Style the Search Panel

**Goal:** Define new CSS custom properties for search match and panel colors in both light and dark theme blocks in `styles.css`. The `search-theme.ts` (created in step_02) references these variables — this step provides their values for all theme contexts.

**Requirements covered:** FR-4.1 through FR-4.5, AC-15 through AC-18, EC-10

**Files to change:**
- `src/styles.css` (add custom properties to `:root` and `[data-theme="dark"]` blocks)

---

## Design Decisions

### Color Strategy

Four new CSS custom properties are needed:

| Variable | Purpose | Usage |
|---|---|---|
| `--search-panel-bg` | Background of the `.cm-panels` host | Should be slightly offset from `--bg-primary` to visually separate the panel from the editor |
| `--search-panel-border` | Top border of the panel | Should match `--border-color` for consistency |
| `--search-match-bg` | Background of all non-active match highlights | Must be legible on both light and dark backgrounds; semi-transparent so text is still readable |
| `--search-match-selected-bg` | Background of the active (current) match | Must be visually distinct from `--search-match-bg`; typically more saturated |

### Light Theme Values

The light theme uses a white base (`--bg-primary: hsl(0, 0%, 100%)`). Browser default search highlight is typically bright yellow. For Markable's clean aesthetic, use an amber-tinted highlight similar to Safari/Spotlight:

- `--search-match-bg`: `hsla(45, 95%, 55%, 0.4)` — warm amber, semi-transparent, legible on white
- `--search-match-selected-bg`: `hsla(45, 95%, 45%, 0.75)` — deeper amber, clearly distinct
- `--search-panel-bg`: `hsl(0, 0%, 97%)` — slightly off-white, distinguishable from white editor
- `--search-panel-border`: `hsl(0, 0%, 88%)` — matches existing `--border-color` in light

### Dark Theme Values

The dark theme uses `hsl(216, 28%, 7%)` as base. Blue highlights are appropriate and consistent with `--selection-bg: rgba(56, 139, 253, 0.2)`:

- `--search-match-bg`: `rgba(56, 139, 253, 0.25)` — blue tint, consistent with selection color
- `--search-match-selected-bg`: `rgba(56, 139, 253, 0.6)` — more saturated blue, clearly the active match
- `--search-panel-bg`: `hsl(216, 28%, 10%)` — slightly lighter than the editor background
- `--search-panel-border`: `hsl(216, 28%, 30%)` — matches existing `--border-color` in dark

### Custom Theme Compatibility (EC-10)

Custom themes inject a `<style id="markable-custom-theme">` element and set `data-theme="dark"`. The CSS custom properties in `[data-theme="dark"]` will apply to custom themes as their base. Custom theme authors who want to override search colors can add `--search-match-bg` etc. to their own CSS.

---

## Changes to `src/styles.css`

### 1. Add to `:root` block (light theme defaults)

After the last existing variable in `:root` (currently `--settings-base-font-size: 16px;`), add:

```css
  /* Search panel */
  --search-panel-bg: hsl(0, 0%, 97%);
  --search-panel-border: hsl(0, 0%, 88%);
  --search-match-bg: hsla(45, 95%, 55%, 0.4);
  --search-match-selected-bg: hsla(45, 95%, 45%, 0.75);
```

### 2. Add to `[data-theme="dark"]` block

After the last existing variable in `[data-theme="dark"]` (currently `--hr-color: hsl(216, 28%, 30%);`), add:

```css
  /* Search panel */
  --search-panel-bg: hsl(216, 28%, 10%);
  --search-panel-border: hsl(216, 28%, 30%);
  --search-match-bg: rgba(56, 139, 253, 0.25);
  --search-match-selected-bg: rgba(56, 139, 253, 0.60);
```

### Exact insertion points

**In `:root` block** — insert after line 33 (after `--settings-base-font-size: 16px;`):

```css
  /* Settings-driven variables (set by JavaScript) */
  --settings-content-max-width: 900px;
  --settings-base-font-size: 16px;

  /* Search panel */
  --search-panel-bg: hsl(0, 0%, 97%);
  --search-panel-border: hsl(0, 0%, 88%);
  --search-match-bg: hsla(45, 95%, 55%, 0.4);
  --search-match-selected-bg: hsla(45, 95%, 45%, 0.75);
```

**In `[data-theme="dark"]` block** — insert after line 58 (after `--hr-color: hsl(216, 28%, 30%);`):

```css
  --hr-color: hsl(216, 28%, 30%);

  /* Search panel */
  --search-panel-bg: hsl(216, 28%, 10%);
  --search-panel-border: hsl(216, 28%, 30%);
  --search-match-bg: rgba(56, 139, 253, 0.25);
  --search-match-selected-bg: rgba(56, 139, 253, 0.60);
```

---

## No Additional `styles.css` Changes Needed

The `EditorView.theme()` block in `search-theme.ts` handles all CM6-injected elements (`.cm-search`, `.cm-textfield`, `.cm-button`, `.cm-panels`, `.cm-searchMatch`). These are scoped to the CM6 shadow DOM tree and do not need global CSS rules. The global CSS variables defined here feed into those `EditorView.theme()` rules via `var(--...)`.

There is one exception: if the `.cm-panels` element is not inside `.cm-editor` (CM6 appends it as a sibling to `.cm-scroller` inside `.cm-editor`), the `EditorView.theme()` scope covers it correctly because CM6 scopes its theme styles to the `.cm-editor` root. No global CSS overrides are needed for `.cm-panels`.

---

## Theming Compatibility Matrix

| Theme | `data-theme` | Panel bg | Match highlight | Active match |
|---|---|---|---|---|
| Default Light | `light` | `hsl(0,0%,97%)` | amber 40% | amber 75% |
| Default Dark | `dark` | `hsl(216,28%,10%)` | blue 25% | blue 60% |
| System (light OS) | `light` | same as Default Light | same | same |
| System (dark OS) | `dark` | same as Default Dark | same | same |
| Custom (e.g., nord.css) | `dark` + injected CSS | same as Default Dark (unless theme overrides) | same | same |

EC-10 (theme switch while panel open): When `setTheme()` in `main.ts` calls `document.documentElement.setAttribute("data-theme", ...)`, the `:root` CSS variables update immediately (CSS cascade). The `EditorView.theme()` rules use `var(--...)` which read from the DOM at paint time. Therefore, theme switching while the panel is open automatically updates all panel colors without any JS intervention.

---

## Acceptance Criteria for Step 03

- [ ] In Default Light theme: search panel background is visibly distinct from the white editor background.
- [ ] In Default Light theme: match highlights are amber-tinted and legible (text is readable through the highlight).
- [ ] In Default Light theme: active match is clearly more saturated / distinct from other matches.
- [ ] In Default Dark theme: search panel background is a darker shade within the dark palette.
- [ ] In Default Dark theme: match highlights are blue-tinted, consistent with selection color.
- [ ] In Default Dark theme: active match is clearly more saturated / distinct from other matches.
- [ ] Switching from Dark to Light (or vice versa) while the panel is open: colors update immediately without reloading the panel.
- [ ] Custom themes (solarized-dark, nord): panel uses the dark theme values as a base, which is legible.
- [ ] `tsc --noEmit` still passes (CSS changes have no TypeScript impact).
- [ ] No TODO comments introduced.
