---
title: "Math Step 05 — Plugin Scaffold"
last-updated: "2026-04-18"
review-cadence-days: 14
status: active
---

# Step 05 — Plugin Scaffold

## Objective

Assemble all components from steps 01–04 into the final `math.plugin.ts`. Replace the stub from step_01 with the complete plugin file. Register in the build system. Verify the built IIFE loads in the app.

## What to Implement

### 5a. Complete `math.plugin.ts`

The full plugin file structure (combining all previous steps):

```typescript
/**
 * IIFE entry point for the Math core plugin.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/math.js
 *
 * Renders inline $...$ and display $$...$$ LaTeX expressions using KaTeX.
 * Implements the Typora-style live preview contract: raw LaTeX is hidden when
 * the cursor is away from an expression and shown when the cursor enters it.
 *
 * IIFE self-containment rules:
 *   - KaTeX is bundled (not external). Only @codemirror/* is external.
 *   - katex-css.ts is a pre-generated module with base64-inlined fonts.
 *   - No app-internal module imports at runtime.
 *   - CM6 accessed via window.__CM_STATE__ and window.__CM_VIEW__.
 *   - CSS injected via <style> tags in onEnable.
 *
 * Architecture: docs/specs/math/00_index.md
 */

import katex from "katex";
import { KATEX_CSS } from "./katex-css";

import type { DecorationSet } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";

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

// ── Types ─────────────────────────────────────────────────────────────────────
// (MathRange interface — from step_02)

// ── Scanner ───────────────────────────────────────────────────────────────────
// (scanMathRanges — from step_02)

// ── CSS ───────────────────────────────────────────────────────────────────────
// (injectCSS, removeCSS, injectPluginCSS, removePluginCSS — from step_03)

// ── Widgets ───────────────────────────────────────────────────────────────────
// (renderMathError, InlineMathWidget, BlockMathWidget — from step_03)

// ── StateField ────────────────────────────────────────────────────────────────
// (isCursorInsideRange, buildMathDecorations, createMathField — from step_04)

// ── Module state ─────────────────────────────────────────────────────────────

let _mathField: ReturnType<typeof StateField.define> | null = null;

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * onEnable sequence (FR-6.3):
 * 1. Inject KaTeX CSS (idempotent, guarded by element id).
 * 2. Inject plugin CSS (margin, error colors).
 * 3. Construct a fresh mathField StateField.
 * 4. Register via api.addExtensions([mathField]).
 */
function onEnable(api: MarkablePluginAPI): void {
  injectCSS();
  injectPluginCSS();
  _mathField = createMathField();
  api.addExtensions([_mathField]);
}

/**
 * onDisable sequence (FR-6.4):
 * 1. api.removeExtensions() — removes mathField from the editor compartment.
 * 2. Remove both injected CSS style tags.
 * 3. Clear _mathField reference.
 */
function onDisable(api: MarkablePluginAPI): void {
  api.removeExtensions();
  removeCSS();
  removePluginCSS();
  _mathField = null;
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export default {
  id: "math",
  name: "Math",
  version: "1.0.0",
  description: "Render LaTeX math expressions using KaTeX",
  detail:
    "Renders inline $...$ and display $$...$$ LaTeX expressions as typeset mathematics " +
    "in live preview mode. Raw LaTeX is shown when your cursor is inside the expression " +
    "and hidden with the rendered output when the cursor moves away. " +
    "Powered by KaTeX — fast, synchronous, offline-capable.",
  onEnable,
  onDisable,
};
```

### 5b. Reserved settings structure (FR-7.2)

Add a comment block after the module-state section to document reserved future settings. This is NOT implemented — it serves as the handoff note to future developers:

```typescript
// ── Future settings (reserved — FR-7.2) ──────────────────────────────────────
//
// When user-configurable settings are added, the structure will be:
//
// interface MathPluginSettings {
//   /** KaTeX macro dictionary. Key: macro name (e.g. "\\R"), value: LaTeX expansion. */
//   macros?: Record<string, string>;
//   /** Whether to center display math. Default: true (KaTeX default). */
//   displayCenter?: boolean;
// }
//
// onEnable would call api.loadSettings() and pass macros to katex.renderToString options.
// No settings UI or persistence is implemented in Phase 1.
```

### 5c. Build system registration

In `scripts/build-plugins.mjs`, the PLUGINS array already has the entry added in step_01f. Verify it is present:

```javascript
["math", "src/plugins/math/math.plugin.ts"],
```

No other changes to the build script.

### 5d. Manual verification checklist

After `npm run build:plugins`, perform this manual verification:

1. Open the app with `npm run tauri dev`.
2. Open Plugins Panel (Cmd-Shift-P).
3. Verify "Math" plugin appears in the plugin list with id `math`, version `1.0.0`.
4. Enable the plugin.
5. Type `$x^2$` in the editor and move the cursor away — verify the KaTeX widget renders.
6. Click on the rendered widget — verify the raw `$x^2$` source appears.
7. Type a display block:
   ```
   $$
   E = mc^2
   $$
   ```
   Move cursor away — verify the display widget renders centered.
8. Click on the display block — verify raw source appears.
9. Type invalid LaTeX: `$\badcommand{$` — verify the error placeholder appears (not a crash).
10. Disable the plugin — verify all widgets disappear and raw LaTeX is visible throughout.
11. Re-enable — verify all widgets reappear (EC-15).
12. Toggle off-on three times in a row — verify no duplicate CSS style tags accumulate (EC-23).

## onEnable/onDisable Flow Diagram

```
onEnable:
  injectCSS()          → <style id="__markable_math_css__">KATEX_CSS</style> in <head>
  injectPluginCSS()    → <style id="__markable_math_plugin_css__">...</style> in <head>
  _mathField = createMathField()
  api.addExtensions([_mathField])
    → PluginManager installs mathField in the shared Compartment
    → CM6 editor recomputes: StateField.create() called, decorations built

onDisable:
  api.removeExtensions()
    → PluginManager removes mathField from the Compartment
    → CM6 editor recomputes: no math decorations, raw LaTeX visible
  removeCSS()          → <style id="__markable_math_css__"> removed from <head>
  removePluginCSS()    → <style id="__markable_math_plugin_css__"> removed from <head>
  _mathField = null
```

## Acceptance Criteria

- [ ] `math.plugin.ts` compiles with `tsc --noEmit` (no TypeScript errors).
- [ ] `npm run build:plugins` produces `src-tauri/plugins/core/math.js`.
- [ ] The built `math.js` contains `renderToString` (KaTeX bundled) and does not contain `require(` (no externalized dependencies).
- [ ] The plugin appears in the Plugins Panel with the correct metadata.
- [ ] Inline math renders as KaTeX widget when cursor is away.
- [ ] Block math renders as KaTeX display widget when cursor is away.
- [ ] Cursor entering a math expression reveals raw LaTeX.
- [ ] Invalid LaTeX shows error placeholder, not a blank widget or crash.
- [ ] Plugin disable removes all widgets.
- [ ] Plugin re-enable re-renders all math (EC-15).
- [ ] No duplicate CSS style tags after multiple enable/disable cycles (EC-23).

## CM6-Specific Gotchas

**StateField constructed in `onEnable`, not at module level.** Some CM6 patterns construct the field at module evaluation time. The factory approach is required here because `StateField` is accessed from `window.__CM_VIEW__`, which must be available. While the globals are set before the IIFE runs (so module-level construction would work), the factory pattern makes the fresh-state-per-enable-cycle guarantee explicit (EC-15).

**`api.addExtensions` accepts an `Extension[]`.** `StateField<T>` satisfies the `Extension` type. Passing `[_mathField]` is correct.

**`api.removeExtensions()` removes ALL extensions registered by this plugin id.** Since the math plugin registers only `_mathField`, this is equivalent to removing the field. No need to pass the field reference to `removeExtensions`.

**Tab switching (EC-21).** When the user switches tabs, the editor is re-mounted with a new document state. The tab switch triggers a `docChanged` transaction on the new document. The StateField's `update` method fires, `scanMathRanges` runs on the new document, and decorations are recomputed. No special handling is needed in the plugin.

**IIFE globals access happens at plugin evaluation time.** The `const { WidgetType, ... } = (window as any).__CM_VIEW__` statement runs when the IIFE is evaluated by `new Function()`. At that point, `main.ts` has already imported `cm-globals.ts` which set `window.__CM_VIEW__`. This ordering is guaranteed by the plugin loader (it loads plugins after CM6 is initialized).
