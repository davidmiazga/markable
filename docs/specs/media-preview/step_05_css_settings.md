---
title: "step_05 — CSS and Settings"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# step_05 — CSS and Settings

## Goal

1. Implement the plugin CSS injected by `injectPluginCSS()` and removed by
   `removePluginCSS()` — covering image sizing, broken-image placeholder, alignment
   class helpers, and theme-compatible variables.

2. Implement the `maxDisplayWidth` settings load/save flow (already partially sketched
   in step_04; this step specifies the exact structure and the `renderDetailExtra`
   settings UI hook).

---

## CSS Implementation

### Style tag ID

```typescript
const PLUGIN_CSS_ELEMENT_ID = "__markable_media_preview_css__";
```

### `injectPluginCSS()` and `removePluginCSS()`

```typescript
export function injectPluginCSS(): void {
  if (document.getElementById(PLUGIN_CSS_ELEMENT_ID)) return; // idempotent (EC-30)
  const style = document.createElement("style");
  style.id = PLUGIN_CSS_ELEMENT_ID;
  style.textContent = PLUGIN_CSS;
  document.head.appendChild(style);
}

export function removePluginCSS(): void {
  document.getElementById(PLUGIN_CSS_ELEMENT_ID)?.remove();
}
```

### `PLUGIN_CSS` constant

Define as a template literal string constant near the CSS helpers section:

```typescript
const PLUGIN_CSS = `
/* ── Media Preview Plugin CSS ─────────────────────────────────────────────── */

/* Container span wrapping each image widget */
.cm-media-container {
  display: inline-block;
  vertical-align: middle;
  max-width: 100%;
  line-height: 0; /* prevents extra space below inline-block image */
}

/* Rendered image */
.cm-media-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--media-image-radius, 4px);
  /* Subtle border using CSS variable for theme overrides */
  border: var(--media-image-border, 1px solid transparent);
}

/* Loading state — applied before the image loads (native browser handles this) */
.cm-media-image[src=""] {
  min-width: 60px;
  min-height: 40px;
  background: var(--media-loading-bg, rgba(128, 128, 128, 0.1));
}

/* ── Built-in alignment helpers (applied via .classname alt text annotation) ─ */

.cm-media-image.center,
.cm-media-container:has(.cm-media-image.center) {
  display: block;
  margin-left: auto;
  margin-right: auto;
}

.cm-media-image.left {
  float: left;
  margin-right: 1em;
  margin-bottom: 0.5em;
}

.cm-media-image.right {
  float: right;
  margin-left: 1em;
  margin-bottom: 0.5em;
}

.cm-media-image.shadow {
  box-shadow: 0 2px 8px var(--media-shadow-color, rgba(0, 0, 0, 0.25));
}

.cm-media-image.rounded {
  border-radius: var(--media-rounded-radius, 12px);
}

/* ── Broken-image placeholder ─────────────────────────────────────────────── */

.cm-media-broken {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  min-width: 80px;
  min-height: 60px;
  background: var(--media-broken-bg, rgba(192, 57, 43, 0.08));
  border: 1px dashed var(--media-error-color, #c0392b);
  border-radius: 4px;
  color: var(--media-error-color, #c0392b);
  font-size: 0.8em;
  cursor: help; /* Signals that hovering shows the URL */
}

.cm-media-broken-icon {
  display: block;
  opacity: 0.7;
}

.cm-media-broken-icon svg {
  display: block;
}

.cm-media-broken-caption {
  display: block;
  font-style: italic;
  font-size: 0.85em;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
`;
```

### CSS variables used (all with fallback values for theme compatibility — NFR-4)

| Variable | Fallback | Purpose |
|----------|---------|---------|
| `--media-image-radius` | `4px` | Image corner rounding |
| `--media-image-border` | `1px solid transparent` | Image border (theme can add visible border) |
| `--media-loading-bg` | `rgba(128,128,128,0.1)` | Background during load |
| `--media-shadow-color` | `rgba(0,0,0,0.25)` | Drop shadow for `.shadow` class |
| `--media-rounded-radius` | `12px` | Border radius for `.rounded` class |
| `--media-broken-bg` | `rgba(192,57,43,0.08)` | Broken-image background tint |
| `--media-error-color` | `#c0392b` | Broken-image border, icon, caption |

Themes may override any of these variables in their custom CSS file. No changes are
needed to existing theme files — the fallbacks provide sensible defaults.

---

## Settings

### Settings interface

```typescript
interface MediaPreviewSettings {
  /** Maximum display width in pixels. 0 = no constraint. Default: 600. */
  maxDisplayWidth: number;
}
```

### Settings load in `onEnable`

The load pattern (already outlined in step_04, fully specified here):

```typescript
const saved = await api.loadSettings();
const maxDisplayWidth: number =
  typeof saved?.maxDisplayWidth === "number" && saved.maxDisplayWidth >= 0
    ? saved.maxDisplayWidth
    : 600;
```

Validation: `>= 0` accepts `0` (disables cap) and rejects negative values. Any non-numeric
value (e.g. `null`, `"auto"`) falls back to the default `600`.

### Settings save

Settings are saved via `api.saveSettings()`. In Phase 1, there is no interactive settings
UI — the only write point is if a `renderDetailExtra` control is added. If no UI is
provided, settings remain read-only from the Plugins panel and must be edited by
directly modifying the settings JSON file (acceptable for Phase 1 per FR-7.3).

### `renderDetailExtra` hook (Phase 1 minimal UI)

The `UnifiedPlugin` interface supports an optional `renderDetailExtra(container)` hook
called when the Plugins panel detail view is opened. Implement a minimal numeric input:

```typescript
function renderDetailExtra(container: HTMLElement): void {
  const row = document.createElement("div");
  row.className = "plugin-detail-extra-row";
  row.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:12px;";

  const label = document.createElement("label");
  label.textContent = "Max display width (px):";
  label.style.fontSize = "0.9em";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "4096";
  input.step = "50";
  input.style.cssText = "width: 80px; font-size: 0.9em;";
  input.placeholder = "600";

  // Read current persisted value asynchronously
  void (async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const api = (window as any).__MARKABLE_PLUGIN_API__?.["media-preview"];
    /* eslint-enable @typescript-eslint/no-explicit-any */
    // If the plugin API is not directly accessible via a window global (it is not
    // normally exposed this way), skip the read — input will show placeholder.
    // The canonical way to read/write settings is via api.loadSettings() in onEnable.
  })();

  const note = document.createElement("span");
  note.textContent = "0 = no limit. Restart plugin to apply.";
  note.style.cssText = "font-size: 0.8em; opacity: 0.65;";

  row.append(label, input, note);
  container.appendChild(row);

  // Save on change (best-effort — no API handle available in renderDetailExtra)
  // The plugin manager does not inject the API into renderDetailExtra.
  // A restart-self pattern is used: the user changes the value, the panel
  // shows a note to restart the plugin.
  // Full interactive settings UI is deferred to Phase 2 (FR-7.3).
}
```

Note: `renderDetailExtra` does not receive the `api` object. For Phase 1, the UI is
informational only. Settings changes require the plugin to be restarted after the JSON
settings file is updated manually, OR a future enhancement adds a `restartSelf()`-based
save flow. This is explicitly acceptable per FR-7.3.

Export `renderDetailExtra` and include it in the default export object:

```typescript
export default {
  id: "media-preview",
  name: "Media Preview",
  version: "1.0.0",
  description: "Render images inline in the live editor",
  detail: "...",
  renderDetailExtra,  // ADD THIS
  onEnable,
  onDisable,
};
```

---

## Implementation Notes

### `line-height: 0` on `.cm-media-container`

Setting `line-height: 0` on the container prevents the browser from adding extra
whitespace below inline-block elements (the "phantom space" caused by the inline
formatting context). This is a well-known CSS technique for inline image alignment.

### `max-width: 100%` on `.cm-media-image`

This is a CSS-level safety net. Even if `maxDisplayWidth` is set to 0 (no JS constraint),
images will not overflow the editor column. This is purely visual — it does not affect
the `width` attribute set by `_applyDimensions()`.

### `float: left/right` for `.left` / `.right` classes

Floated images in a CodeMirror editor have limited support — CM6 block-level layout may
not reflow text around floated elements in the same way a browser document does. The
`.left` and `.right` classes are provided for completeness but may produce imperfect
visual results in the editor. This is a known limitation and is acceptable for Phase 1.

---

## Test Cases for This Step

Manual / visual verification:

1. Enable the plugin and add `![photo](img.png)` to a document. Widget renders with
   `cm-media-container` class on the outer element.
2. Add `![photo.center](img.png)`. Confirm the image is centered.
3. Add `![photo.shadow](img.png)`. Confirm shadow is visible.
4. Add `![photo{border: 3px solid blue}](img.png)`. Confirm blue border on `<img>`.
5. Add a broken image `![broken](nonexistent.png)`. Confirm broken-image placeholder
   with dashed red border and icon.
6. Toggle the plugin off and on twice. Confirm no duplicate `<style>` tags in the DOM
   (EC-30 idempotency — check `document.querySelectorAll("#__markable_media_preview_css__").length === 1`).
7. Set `maxDisplayWidth: 0` in settings JSON and restart the plugin. Confirm images
   display at natural size (no explicit width/height applied).

---

## Definition of Done

- [ ] `PLUGIN_CSS` constant defined with all sections documented above.
- [ ] `injectPluginCSS()` and `removePluginCSS()` implemented and idempotent.
- [ ] All seven CSS variables have fallback values.
- [ ] `.center`, `.left`, `.right`, `.shadow`, `.rounded` alignment helpers present.
- [ ] Broken-image CSS fully styled with CSS variable fallbacks.
- [ ] Settings load validates `maxDisplayWidth >= 0` with fallback to `600`.
- [ ] `renderDetailExtra` hook implemented (informational UI for Phase 1).
- [ ] `renderDetailExtra` included in the plugin `export default` object.
- [ ] No duplicate `<style>` tags after multiple enable/disable cycles.
- [ ] No TODO comments in source.
