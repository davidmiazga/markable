---
title: "Math Step 03 — KaTeX Widgets"
last-updated: "2026-04-18"
review-cadence-days: 14
status: active
---

# Step 03 — KaTeX Widgets

## Objective

Implement the two CM6 `WidgetType` subclasses (`InlineMathWidget` and `BlockMathWidget`) that call `katex.renderToString()` and produce DOM nodes. Implement `injectCSS()` and `removeCSS()` CSS helpers. These classes live inside `math.plugin.ts`.

## What to Implement

### 3a. CM6 globals access (top of plugin file)

At the top of `math.plugin.ts`, after the imports, destructure the required CM6 values from the window globals:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  WidgetType,
  Decoration,
  EditorView: _EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");

const {
  StateField,
  RangeSetBuilder,
} = (window as any).__CM_STATE__ as typeof import("@codemirror/state");
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Note: `EditorView` is destructured as `_EditorView` (prefixed underscore) to avoid TS2749 — it is used only for its static `theme()` method, not as a type annotation. If the theme approach is not used, omit `EditorView` from the destructure entirely.

Type-only imports (safe, erased by tsc):

```typescript
import type { DecorationSet } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

KaTeX import (bundled by Rollup — NOT external):

```typescript
import katex from "katex";
import { KATEX_CSS } from "./katex-css";
```

### 3b. CSS injection helpers

```typescript
const CSS_ELEMENT_ID = "__markable_math_css__";

/**
 * Inject KaTeX CSS (with base64 fonts) into document <head>.
 * Idempotent: guarded by the element id (EC-23).
 */
function injectCSS(): void {
  if (document.getElementById(CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ELEMENT_ID;
  style.textContent = KATEX_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the injected KaTeX CSS. Called from onDisable (EC-23).
 */
function removeCSS(): void {
  document.getElementById(CSS_ELEMENT_ID)?.remove();
}
```

### 3c. `InlineMathWidget`

```typescript
/**
 * CM6 WidgetType for inline math ($...$).
 *
 * Replaces the entire $...$ source range with a KaTeX-rendered <span>.
 * eq() compares latex source strings so CM6 can reuse the DOM node
 * when the cursor moves without changing the expression content (FR-4.6).
 */
class InlineMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return other.latex === this.latex;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-math-inline";
    try {
      span.innerHTML = katex.renderToString(this.latex, {
        displayMode: false,
        throwOnError: false,
        output: "html",
      });
    } catch (err) {
      renderMathError(span, this.latex, false);
    }
    return span;
  }

  /**
   * Prevent CM6 from placing a cursor inside the widget's DOM.
   * Returning true means the widget is treated as a single atomic unit.
   */
  ignoreEvent(): boolean {
    return false;
  }
}
```

### 3d. `BlockMathWidget`

```typescript
/**
 * CM6 WidgetType for display math ($$...$$).
 *
 * The decoration that uses this widget must set block: true (FR-2.2).
 * The widget renders in display mode (centered, larger operators).
 */
class BlockMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }

  eq(other: BlockMathWidget): boolean {
    return other.latex === this.latex;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-math-block";
    try {
      div.innerHTML = katex.renderToString(this.latex, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
    } catch (err) {
      renderMathError(div, this.latex, true);
    }
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
```

### 3e. Error placeholder helper

```typescript
/**
 * Render an error placeholder into `container` when KaTeX fails.
 *
 * Uses a distinct visual via CSS variable for theme compatibility (FR-5.4).
 * The tooltip shows the raw LaTeX so the user can identify what failed (FR-5.2).
 *
 * @param container - The <span> or <div> to populate.
 * @param latex     - The raw LaTeX source (shown as tooltip).
 * @param isBlock   - Whether this is a block (display) or inline expression.
 */
function renderMathError(
  container: HTMLElement,
  latex: string,
  isBlock: boolean,
): void {
  container.className = isBlock ? "cm-math-error cm-math-block" : "cm-math-error cm-math-inline";
  container.textContent = "Math error";
  container.title = latex;
}
```

### 3f. Plugin CSS (appended to `KATEX_CSS` injection or separate style tag)

The math plugin needs a small amount of CSS beyond KaTeX's own stylesheet. Inject this as a SECOND style tag with its own id (e.g., `__markable_math_plugin_css__`), OR append it to the KaTeX CSS string before injection. Prefer the second style tag approach so they can be removed independently.

```css
/* Inline math widget wrapper */
.cm-math-inline {
  display: inline-block;
  vertical-align: middle;
}

/* Block math widget wrapper */
.cm-math-block {
  display: block;
  text-align: center;
  margin: 0.5em 0;
  overflow-x: auto;
}

/* Error state — uses CSS variable for theme compatibility (FR-5.4) */
.cm-math-error {
  color: var(--math-error-color, #c0392b);
  font-style: italic;
  font-size: 0.9em;
  cursor: help;
}
```

Two injection helpers (analogous to `injectCSS`/`removeCSS`):

```typescript
const PLUGIN_CSS_ELEMENT_ID = "__markable_math_plugin_css__";

function injectPluginCSS(): void {
  if (document.getElementById(PLUGIN_CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = PLUGIN_CSS_ELEMENT_ID;
  style.textContent = `
    .cm-math-inline { display: inline-block; vertical-align: middle; }
    .cm-math-block  { display: block; text-align: center; margin: 0.5em 0; overflow-x: auto; }
    .cm-math-error  { color: var(--math-error-color, #c0392b); font-style: italic; font-size: 0.9em; cursor: help; }
  `;
  document.head.appendChild(style);
}

function removePluginCSS(): void {
  document.getElementById(PLUGIN_CSS_ELEMENT_ID)?.remove();
}
```

## Function/Class Signatures (Summary)

```typescript
// CSS helpers
function injectCSS(): void
function removeCSS(): void
function injectPluginCSS(): void
function removePluginCSS(): void

// Error helper
function renderMathError(container: HTMLElement, latex: string, isBlock: boolean): void

// Widgets
class InlineMathWidget extends WidgetType {
  constructor(readonly latex: string)
  eq(other: InlineMathWidget): boolean
  toDOM(): HTMLElement
  ignoreEvent(): boolean
}

class BlockMathWidget extends WidgetType {
  constructor(readonly latex: string)
  eq(other: BlockMathWidget): boolean
  toDOM(): HTMLElement
  ignoreEvent(): boolean
}
```

## Test Cases to Write (Red Phase First)

Widget `toDOM()` requires a DOM environment. Vitest uses `happy-dom` (already in `devDependencies`). Configure the test file with `@vitest-environment happy-dom` or use `vitest.config.ts` global environment.

```typescript
// At top of test file or in vitest.config.ts:
// @vitest-environment happy-dom
```

### Group: InlineMathWidget rendering

```typescript
describe("InlineMathWidget", () => {
  it("renders a <span> with class cm-math-inline", () => {
    const w = new InlineMathWidget("x^2");
    const dom = w.toDOM();
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-math-inline")).toBe(true);
  });

  it("contains KaTeX output in innerHTML (not empty)", () => {
    const w = new InlineMathWidget("x^2");
    const dom = w.toDOM();
    expect(dom.innerHTML.length).toBeGreaterThan(0);
    // KaTeX HTML output always contains a <span class="katex"> root
    expect(dom.innerHTML).toContain("katex");
  });

  it("eq() returns true when latex is identical", () => {
    const w1 = new InlineMathWidget("x^2");
    const w2 = new InlineMathWidget("x^2");
    expect(w1.eq(w2)).toBe(true);
  });

  it("eq() returns false when latex differs", () => {
    const w1 = new InlineMathWidget("x^2");
    const w2 = new InlineMathWidget("y^2");
    expect(w1.eq(w2)).toBe(false);
  });
});
```

### Group: BlockMathWidget rendering

```typescript
describe("BlockMathWidget", () => {
  it("renders a <div> with class cm-math-block", () => {
    const w = new BlockMathWidget("E = mc^2");
    const dom = w.toDOM();
    expect(dom.tagName).toBe("DIV");
    expect(dom.classList.contains("cm-math-block")).toBe(true);
  });

  it("renders empty latex without throwing (EC-7)", () => {
    const w = new BlockMathWidget("");
    expect(() => w.toDOM()).not.toThrow();
  });

  it("eq() returns true for same latex", () => {
    expect(new BlockMathWidget("E").eq(new BlockMathWidget("E"))).toBe(true);
  });
});
```

### Group: Error handling (FR-5)

```typescript
describe("Math widget error handling", () => {
  it("InlineMathWidget renders error placeholder for invalid LaTeX (EC-9)", () => {
    // \frac{1}{ is invalid (unclosed brace) — KaTeX may still render with throwOnError:false
    // Force an error by passing something KaTeX definitely cannot render:
    const w = new InlineMathWidget("\\invalidcommand{");
    const dom = w.toDOM();
    // Either renders or shows error — must not throw
    expect(dom).toBeTruthy();
  });

  it("BlockMathWidget renders error placeholder for invalid LaTeX (EC-10)", () => {
    const w = new BlockMathWidget("\\badcommand{");
    expect(() => w.toDOM()).not.toThrow();
  });

  it("error placeholder has cm-math-error class when KaTeX throws", () => {
    // Use a mock or spy if needed to force the catch branch.
    // Alternative: test renderMathError directly.
    const container = document.createElement("span");
    renderMathError(container, "bad latex", false);
    expect(container.classList.contains("cm-math-error")).toBe(true);
    expect(container.textContent).toBe("Math error");
    expect(container.title).toBe("bad latex");
  });

  it("block error placeholder has cm-math-error and cm-math-block classes", () => {
    const container = document.createElement("div");
    renderMathError(container, "bad", true);
    expect(container.classList.contains("cm-math-block")).toBe(true);
    expect(container.classList.contains("cm-math-error")).toBe(true);
  });
});
```

### Group: CSS injection (EC-23)

```typescript
describe("CSS injection", () => {
  beforeEach(() => {
    // Clean slate for each test
    document.getElementById("__markable_math_css__")?.remove();
    document.getElementById("__markable_math_plugin_css__")?.remove();
  });

  it("injectCSS creates a <style> tag with the correct id", () => {
    injectCSS();
    expect(document.getElementById("__markable_math_css__")).toBeTruthy();
  });

  it("injectCSS is idempotent — second call does not create duplicate", () => {
    injectCSS();
    injectCSS();
    const tags = document.querySelectorAll("#__markable_math_css__");
    expect(tags.length).toBe(1);
  });

  it("removeCSS removes the injected <style> tag", () => {
    injectCSS();
    removeCSS();
    expect(document.getElementById("__markable_math_css__")).toBeNull();
  });

  it("removeCSS is safe when tag does not exist (no throw)", () => {
    expect(() => removeCSS()).not.toThrow();
  });
});
```

## Acceptance Criteria

- [ ] `InlineMathWidget.toDOM()` returns a `<span class="cm-math-inline">` containing KaTeX HTML output for valid LaTeX.
- [ ] `BlockMathWidget.toDOM()` returns a `<div class="cm-math-block">` containing KaTeX display-mode HTML output for valid LaTeX.
- [ ] Both widgets catch KaTeX errors and render an error placeholder with class `cm-math-error` (FR-5.1, FR-5.2).
- [ ] `eq()` returns `true` for identical latex strings, `false` for different strings (FR-4.6).
- [ ] `injectCSS()` is idempotent (EC-23).
- [ ] `removeCSS()` removes the injected style tag (EC-23).
- [ ] No `@codemirror/*` values imported directly — all accessed via `window.__CM_VIEW__` / `window.__CM_STATE__`.
- [ ] Widget classes access `WidgetType` from the destructured global, not from an import.

## CM6-Specific Gotchas

**`WidgetType` class extension in IIFE context.** Because `WidgetType` is not a bundled class (it comes from the window global at runtime), TypeScript cannot verify class extension at compile time. The `extends WidgetType` pattern will cause a TS error unless `WidgetType` is declared as the runtime value. The destructure `const { WidgetType } = (window as any).__CM_VIEW__` makes `WidgetType` a `typeof WidgetType` value — TypeScript will accept `extends WidgetType` on it.

If TypeScript still complains, the workaround is:

```typescript
// In the plugin file, after the destructure:
type WidgetTypeClass = typeof WidgetType;
// Then: class InlineMathWidget extends (WidgetType as WidgetTypeClass) { ... }
```

This is the same pattern used by the backlinks plugin for `autocompletion`.

**`block: true` on replace decoration.** In step_04, the `BlockMathWidget` decoration MUST be created with `Decoration.replace({ widget: new BlockMathWidget(latex), block: true })`. Without `block: true`, CM6 will not render the block decoration correctly for multi-line ranges. The widget itself does not set this — it is specified in the `Decoration.replace()` call in the StateField.

**`ignoreEvent()` returning `false`.** Returning `false` allows the editor to handle mouse clicks on the widget, which causes the cursor to move to the widget's position (showing the raw source). This is the correct Typora-style behavior. Returning `true` would swallow click events.
