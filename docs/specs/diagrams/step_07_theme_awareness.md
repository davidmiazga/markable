---
title: "Step 07 — Theme Awareness: dark/light detection + re-init"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 07: Theme Awareness

**Requirement:** FR-07 (Theme Awareness), US-05 (Theme Adaptation), EC-10 (Theme switch re-renders), OQ-03 (Re-initialization), OQ-05 (Dark mode SVG)
**Files modified:** `src/plugins/diagrams/diagrams.plugin.ts`

---

## Goal

Add Mermaid theme detection and re-initialization logic. After this step:
- `mermaid.initialize()` is called during `onEnable` with the appropriate theme
- A `MutationObserver` detects theme changes on `document.body` and triggers re-initialization
- Re-initialization only occurs when the theme actually changes (OQ-03)
- Re-initialization dispatches a `themeChangedEffect` transaction to force StateField recompute
- All rendered diagrams update their SVG theme on theme switch (EC-10)

---

## Implementation Instructions

### Part 1: Theme resolution helpers

Remove the stub comment `// resolveMermaidTheme() + reinitIfNeeded() — added in step_07` and replace with these three functions, inserted after `createDiagramsField`:

```typescript
// ── Theme detection ───────────────────────────────────────────────────────────

/**
 * Determine the appropriate Mermaid theme string based on the current app theme.
 *
 * Strategy (FR-07.2, OQ-05):
 *   1. If _settings.mermaidTheme is not "auto", use that value directly.
 *   2. For "auto": inspect the CSS custom property --color-scheme on :root.
 *      Markable's themes set this to "dark" or "light". If the property is
 *      "dark", return Mermaid's "dark" theme. Otherwise return "default".
 *   3. Fallback: read the computed background-color of document.body using
 *      getComputedStyle. If the perceived luminance is below 0.5, the theme
 *      is dark. This covers custom themes that may not set --color-scheme.
 *
 * Returns one of Mermaid's valid theme strings: "dark", "default", "neutral",
 * "forest", or "base".
 */
export function resolveMermaidTheme(): string {
  // Non-auto: user has explicitly chosen a Mermaid theme.
  if (_settings.mermaidTheme !== "auto") {
    return _settings.mermaidTheme;
  }

  // Strategy 1: Check --color-scheme CSS variable (set by Markable themes).
  const colorScheme = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-scheme")
    .trim();
  if (colorScheme === "dark") return "dark";
  if (colorScheme === "light") return "default";

  // Strategy 2: Luminance of document.body background-color.
  // getComputedStyle returns "rgb(R, G, B)" or "rgba(R, G, B, A)".
  const bg = getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    // sRGB relative luminance approximation (WCAG formula, simplified).
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance < 0.5) return "dark";
  }

  // Default: light theme.
  return "default";
}

/**
 * Call mermaid.initialize() if the resolved theme differs from the last
 * initialized theme (OQ-03). This avoids redundant re-initialization when
 * the user moves the cursor or edits non-mermaid content.
 *
 * mermaid.initialize() is idempotent and can be called multiple times in the
 * same JS context. Each call updates Mermaid's internal config. The new config
 * applies to subsequent mermaid.render() calls.
 *
 * securityLevel: "strict" is always set as a belt-and-suspenders XSS guard
 * (NFR-08, EC-15), regardless of the theme.
 *
 * @returns true if initialization was performed (theme changed), false if skipped.
 */
export function reinitIfNeeded(): boolean {
  const theme = resolveMermaidTheme();
  if (theme === _initializedTheme) return false;

  mermaid.initialize({
    startOnLoad: false,
    theme,
    // securityLevel: "strict" strips <script> tags from SVG output (NFR-08, EC-15).
    securityLevel: "strict",
  });

  _initializedTheme = theme;
  return true;
}

/**
 * Force a StateField recompute by dispatching a themeChangedEffect transaction.
 *
 * After mermaid.initialize() is called with a new theme, existing widget DOM
 * nodes contain SVG with the old theme colors. To trigger re-render, the
 * StateField must recompute — which causes CM6 to call toDOM() again for all
 * visible widgets (since the DOM nodes cannot be reused after a theme change:
 * new MermaidWidget instances are created with the same source but new render IDs).
 *
 * Wait: eq() returns true for same source — wouldn't CM6 reuse the old DOM node?
 * No. After removeExtensions() + addExtensions() cycle (which reinitMermaid does NOT
 * do), the StateField is fresh. But here we only dispatch themeChangedEffect, which
 * triggers update() to call buildDiagramDecorations(). buildDiagramDecorations()
 * creates new MermaidWidget instances. Because the StateField is the same field,
 * CM6 compares the new DecorationSet's widgets against the existing ones via eq().
 *
 * For eq() to return false (forcing new DOM), the widget must compare differently.
 * Solution: embed the current Mermaid theme string in the widget for eq() comparison.
 * See the updated MermaidWidget eq() note below — this step patches eq() to include
 * the theme string.
 */
function dispatchThemeEffect(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (view) {
    view.dispatch({ effects: [themeChangedEffect.of(null)] });
  }
}
```

### Part 2: MermaidWidget eq() patch for theme changes

The `MermaidWidget.eq()` in step_05 only compares `source` strings. This causes a problem on theme change: two widgets with the same source would be considered equal (`eq()` returns true) and CM6 would reuse the old dark-theme SVG DOM node instead of creating a new one for the light theme.

Fix: add a `theme` field to `MermaidWidget` and include it in the `eq()` comparison.

Modify `MermaidWidget`:
- Constructor: `this.theme = _initializedTheme;` (captures current theme at widget creation time)
- `eq()`: `return other.source === this.source && other.theme === this.theme;`
- Add `readonly theme: string;` to the class body

The full updated constructor and eq():

```typescript
readonly source: string;
readonly theme: string;
private readonly renderId: string;

constructor(source: string) {
  super();
  this.source = source;
  // Capture the current initialized theme so eq() can detect theme changes.
  this.theme = _initializedTheme;
  _renderCounter++;
  this.renderId = `mermaid-widget-${_renderCounter}`;
}

eq(other: MermaidWidget): boolean {
  return other.source === this.source && other.theme === this.theme;
}
```

With this change, when `reinitIfNeeded()` changes `_initializedTheme` and then `dispatchThemeEffect()` triggers StateField recompute, the newly created `MermaidWidget` instances capture the new `_initializedTheme` value. Their `eq()` returns false against the existing nodes (different theme string), forcing `toDOM()` to run and re-render with the new theme.

### Part 3: Register MutationObserver in onEnable

Replace the stub comment `// Theme-change observer — registered by step_07.` in `onEnable` with:

```typescript
// Initialize Mermaid with the current theme.
reinitIfNeeded();

// Register a MutationObserver to detect theme changes on document.body.
// Markable theme switches update data-theme or class on document.body —
// observe both attribute and class changes.
_themeObserver = new MutationObserver(() => {
  const changed = reinitIfNeeded();
  if (changed) {
    dispatchThemeEffect();
  }
});
_themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "data-theme", "data-color-scheme"],
});

// Also observe :root for CSS variable changes that themes may apply there.
_themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "data-theme"],
});
```

Note: `onDisable` in step_03 already disconnects `_themeObserver` and sets it to null. No additional cleanup is needed.

### Part 4: Full onEnable after step_07

The complete `onEnable` after this step (settings still use defaults — step_08 will replace line 1):

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // Step 08 will replace this with api.loadSettings() + merge with defaults.
  _settings = { ...DEFAULT_SETTINGS };

  injectPluginCSS();

  // Initialize Mermaid with the current theme.
  reinitIfNeeded();

  // Create a fresh StateField instance for this enable cycle (AD-06).
  _diagramsField = createDiagramsField();
  api.addExtensions([_diagramsField]);

  // Register MutationObserver for theme changes.
  _themeObserver = new MutationObserver(() => {
    const changed = reinitIfNeeded();
    if (changed) {
      dispatchThemeEffect();
    }
  });
  _themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-scheme"],
  });
  _themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
}
```

---

## Notes on --color-scheme CSS variable

Markable's built-in themes (`default-dark`, `default-light`, `system`) set `--color-scheme` on `:root`. Custom user themes may or may not set it. The luminance fallback handles custom themes that use dark backgrounds but don't set `--color-scheme`. The fallback is intentionally conservative (threshold 0.5) — themes are either clearly dark or clearly light.

---

## Acceptance Criteria

- [ ] `resolveMermaidTheme()` returns `"dark"` when `--color-scheme: dark` is on `:root`
- [ ] `resolveMermaidTheme()` returns `"default"` when `--color-scheme: light` is on `:root`
- [ ] `resolveMermaidTheme()` returns the `_settings.mermaidTheme` value when it is not `"auto"`
- [ ] `reinitIfNeeded()` calls `mermaid.initialize()` only when the theme string changes
- [ ] `reinitIfNeeded()` returns `false` on the second call with the same theme (no re-init)
- [ ] `MermaidWidget.eq()` returns `false` when themes differ (forces re-render on theme change)
- [ ] Switching app theme triggers `_themeObserver` callback → `reinitIfNeeded()` → `dispatchThemeEffect()`
- [ ] `_themeObserver` is disconnected in `onDisable` (verified in step_03 code)
- [ ] `npm run build:plugins` compiles without TypeScript errors
- [ ] Manual test: switch from a light theme to a dark theme while a mermaid diagram is rendered — diagram re-renders with the dark Mermaid theme (EC-10)

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/diagrams/diagrams.plugin.ts` | MODIFY | Add resolveMermaidTheme, reinitIfNeeded, dispatchThemeEffect, patch MermaidWidget.eq(), update onEnable |
