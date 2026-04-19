---
title: "step_03 — ImageWidget"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# step_03 — ImageWidget

## Goal

Implement the `ImageWidget` CM6 `WidgetType` that produces the `<img>` DOM element shown
in the editor for each image reference when the cursor is away. This step also implements
the broken-image placeholder and the `renderBrokenImage()` helper.

---

## `ImageWidget` Design

`ImageWidget` extends `WidgetType` obtained from `window.__CM_VIEW__` (same pattern as
`InlineMathWidget` and `BlockMathWidget` in `math.plugin.ts`).

The constructor receives a fully resolved `ImageRange` plus the `maxDisplayWidth` setting.
It does not call `resolveImageSrc()` — that was already called by `buildImageDecorations()`
to produce the `resolvedSrc` passed in. This keeps `toDOM()` pure and testable.

```typescript
export class ImageWidget extends (WidgetType as typeof WidgetTypeClass) {
  constructor(
    readonly resolvedSrc: string,
    readonly cleanAlt: string,
    readonly cssClasses: string[],
    readonly cssStyle: string | undefined,
    readonly displayWidth: number | undefined,
    readonly displayHeight: number | undefined,
    readonly maxDisplayWidth: number,
    readonly originalSrc: string, // Raw URL for broken-image hover title
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.resolvedSrc === this.resolvedSrc &&
      other.cleanAlt === this.cleanAlt &&
      other.cssClasses.join(",") === this.cssClasses.join(",") &&
      other.cssStyle === this.cssStyle &&
      other.displayWidth === this.displayWidth &&
      other.displayHeight === this.displayHeight &&
      other.maxDisplayWidth === this.maxDisplayWidth
    );
  }

  toDOM(): HTMLElement {
    // Outer container — needed so onerror can replace the <img> with the
    // broken-image placeholder without losing the CM6 widget mount point.
    const container = document.createElement("span");
    container.className = "cm-media-container";

    // Broken-image immediately for empty/invalid resolved src
    if (!this.resolvedSrc) {
      renderBrokenImage(container, this.cleanAlt, this.originalSrc);
      return container;
    }

    const img = document.createElement("img");

    // FR-1.2: required classes
    const classes = ["cm-media-image", ...this.cssClasses];
    img.className = classes.join(" ");

    img.src = this.resolvedSrc;
    img.alt = this.cleanAlt; // NFR-5: always set alt (even if empty string)

    // FR-2.4: inline CSS via style.cssText (EC-31: not setAttribute)
    if (this.cssStyle) {
      img.style.cssText = this.cssStyle;
    }

    // Apply dimension constraints
    // Priority: explicit annotation > maxDisplayWidth default
    this._applyDimensions(img);

    // FR-5.2: broken-image onerror handler
    img.onerror = () => {
      container.removeChild(img);
      renderBrokenImage(container, this.cleanAlt, this.originalSrc);
    };

    container.appendChild(img);
    return container;
  }

  private _applyDimensions(img: HTMLImageElement): void {
    if (this.displayWidth !== undefined) {
      // Explicit annotation takes precedence.
      // Cap at maxDisplayWidth if the constraint is enabled (maxDisplayWidth > 0).
      const w = (this.maxDisplayWidth > 0)
        ? Math.min(this.displayWidth, this.maxDisplayWidth)
        : this.displayWidth;
      img.style.width = `${w}px`;
      // Height: use annotated height, or auto for proportional scaling (FR-2.1)
      img.style.height = this.displayHeight !== undefined
        ? `${this.displayHeight}px`
        : "auto";
    } else if (this.maxDisplayWidth > 0) {
      // No explicit width — use maxDisplayWidth as the default width (AD-5)
      img.style.width = `${this.maxDisplayWidth}px`;
      img.style.height = "auto";
    }
    // If maxDisplayWidth === 0 and no annotation: no width/height applied
    // (natural image size). The CSS max-width rule on .cm-media-image still applies
    // via the plugin stylesheet for a loose visual constraint.
  }

  ignoreEvent(): boolean {
    // FR-1.5: returning false lets CM6 move the cursor into this widget's
    // document position when clicked, triggering cursor-on-reveal.
    return false;
  }
}
```

---

## `renderBrokenImage(container, cleanAlt, originalSrc)` Helper

Called from `ImageWidget.toDOM()` for empty `resolvedSrc` (EC-03) and from the `onerror`
handler for load failures (FR-5.1).

```typescript
/**
 * Populate `container` with a broken-image placeholder.
 *
 * The placeholder displays a visual icon (inline SVG), the alt text as a caption
 * below the icon, and the original src URL as a title for hover inspection.
 *
 * @param container   The <span class="cm-media-container"> to populate.
 * @param cleanAlt    Cleaned alt text (shown as caption).
 * @param originalSrc Raw URL from Markdown (shown on hover via title attribute).
 */
export function renderBrokenImage(
  container: HTMLElement,
  cleanAlt: string,
  originalSrc: string,
): void {
  container.className = "cm-media-container cm-media-broken";
  container.title = originalSrc || "(empty URL)";

  // Inline SVG broken-image icon — no external asset dependency
  const icon = document.createElement("span");
  icon.className = "cm-media-broken-icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M3 17l5-5 4 4 3-3 6 4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>' +
    '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.5"/>' +
    "</svg>";

  container.appendChild(icon);

  if (cleanAlt) {
    const caption = document.createElement("span");
    caption.className = "cm-media-broken-caption";
    caption.textContent = cleanAlt;
    container.appendChild(caption);
  }
}
```

### SVG icon rationale

An inline SVG avoids any external asset dependency and works in the Tauri WebView with
no network access. The icon is a standard broken-image symbol: a picture frame with a
diagonal line through it. Using `currentColor` means it respects the CSS variable
`--media-error-color` applied on the container (NFR-4, FR-5.4).

---

## Implementation Notes

### The container `<span>` pattern

The widget renders into a `<span class="cm-media-container">` rather than directly as
`<img>`. This is required because:

1. The `onerror` handler needs to replace the `<img>` child element with the broken-image
   markup. If the widget's root element *were* the `<img>`, it could not replace itself.
   CM6 holds a reference to the root element returned by `toDOM()`, so that element cannot
   be removed.

2. The container makes it straightforward to append a caption element after the image.

The container `<span>` has `display: inline-block` set by the plugin CSS (step_05), so
it does not break flow.

### `style.cssText` vs `setAttribute("style", ...)`

Per EC-31 and FR-2.4, the CSS string from `{...}` alt text annotation is applied via:

```typescript
img.style.cssText = this.cssStyle;
```

**Do not use `img.setAttribute("style", this.cssStyle)`**. The `style.cssText` DOM property
goes through the browser's CSS value sanitizer. `javascript:` values and other dangerous
content are silently ignored. `setAttribute` bypasses some sanitization paths in older
implementations.

### `eq()` comparison

CM6 calls `eq()` to decide whether to reuse an existing DOM node when decorations are
rebuilt. The comparison must be deterministic. For `cssClasses`, comparing
`other.cssClasses.join(",")` covers arrays where the class order was preserved by
`parseAltAnnotations()` (class order follows appearance order in alt text — stable).

### `ignoreEvent()` behavior change

The existing `ImageWidget` in `live-preview.ts` uses `ignoreEvent(): true`. This plugin
widget uses `ignoreEvent(): false` (FR-1.5). This is a behavior difference — the plugin
widget is *clickable*. When the user clicks, CM6 moves the cursor into `[from, to)`, the
StateField's `update()` is called (because `tr.selection` is truthy), and the cursor-on-
reveal logic shows the raw Markdown source.

---

## Test Cases for This Step

(Full tests in step_06. Checklist here.)

`ImageWidget.toDOM()`:
- With valid `resolvedSrc`: returns a `<span>` containing an `<img>`.
- `<img>` has `className = "cm-media-image"` when no `cssClasses`.
- `<img>` has `className = "cm-media-image center"` when `cssClasses = ["center"]`.
- `<img>` has `style.cssText` set when `cssStyle` is provided (EC-31 guard: cssStyle
  `"background:url(javascript:alert(1))"` — verify via `style.cssText` round-trip that
  the browser strips the dangerous value in jsdom).
- With `displayWidth = 400`, `displayHeight = 300`: `img.style.width = "400px"`,
  `img.style.height = "300px"`.
- With `displayWidth = 400` only: `img.style.width = "400px"`, `img.style.height = "auto"`.
- With `maxDisplayWidth = 600` and no annotation: `img.style.width = "600px"`.
- With `maxDisplayWidth = 600` and `displayWidth = 800`: `img.style.width = "600px"` (capped).
- With `maxDisplayWidth = 0` and no annotation: no explicit width/height set.
- Empty `resolvedSrc` `""`: returns container with broken-image markup (no `<img>`).

`renderBrokenImage()`:
- Container gets class `cm-media-broken`.
- Container `title` is set to `originalSrc`.
- Icon SVG is present as child element.
- When `cleanAlt` is non-empty: caption span is present with correct text.
- When `cleanAlt` is empty: no caption element.

`ImageWidget.eq()`:
- Same values → `true`.
- Different `resolvedSrc` → `false`.
- Different `cssClasses` order → `false` (order matters — stable from parser).

---

## Definition of Done

- [ ] `ImageWidget` class defined in `media-preview.plugin.ts`; extends WidgetType from
  `window.__CM_VIEW__`.
- [ ] `renderBrokenImage()` exported and unit-testable.
- [ ] `toDOM()` uses `style.cssText`, not `setAttribute`.
- [ ] `ignoreEvent()` returns `false`.
- [ ] `onerror` handler removes `<img>` and calls `renderBrokenImage()` in-place.
- [ ] `_applyDimensions()` correctly handles all four cases: annotated, capped, default,
  and unconstrained.
- [ ] Empty `resolvedSrc` immediately calls `renderBrokenImage()` without creating `<img>`.
- [ ] No TODO comments in source.
- [ ] TypeScript compilation passes.
