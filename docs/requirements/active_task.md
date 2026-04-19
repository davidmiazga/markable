---
title: "Math LaTeX Rendering — FC2 #8"
last-updated: "2026-04-18"
review-cadence-days: 7
status: active
---

# Math LaTeX Rendering (FC2 #8) Requirements Spec

## Summary

As a user, I want inline `$...$` and display `$$...$$` math expressions to render as typeset mathematics in the live preview — so that equations are readable as formatted output rather than raw LaTeX strings, while still becoming editable source text when my cursor is inside them.

---

## Background and Motivation

Markable already ships syntax insertion for both math forms: `insertInlineMath()` and `insertMathBlock()` in `src/editor/format.ts`, bound to Cmd-Shift-M (inline) and accessible via the toolbar. The help docs explicitly note: _"Math is inserted as syntax only in Phase 1 — rendering requires a future plugin."_ This feature delivers that rendering.

The Typora-style live preview contract already established for other Markdown syntax (headings, bold, links) must be extended to math: raw LaTeX is hidden when the cursor is away from the expression and revealed when the cursor enters it.

### Existing Infrastructure Leveraged

| Component | File | Relevance |
|---|---|---|
| Math insertion (inline) | `src/editor/format.ts` — `insertInlineMath()` | Inserts `$...$`; produces source text this plugin renders |
| Math insertion (block) | `src/editor/format.ts` — `insertMathBlock()` | Inserts `$$\n...\n$$`; produces source text this plugin renders |
| IIFE plugin system | `src/plugins/`, `scripts/build-plugins.mjs` | New plugin must register in PLUGINS array; follow IIFE self-containment rules |
| CM6 globals | `src/lib/cm-globals.ts` | `window.__CM_VIEW__` / `window.__CM_STATE__` are the only CM6 access points inside the IIFE |
| Plugin API | `src/plugins/markable-plugin-api.ts` | `api.addExtensions()` / `api.removeExtensions()` for CM6 registration |
| Focus mode pattern | `src/plugins/focus-mode/focus-mode.plugin.ts` | Reference for ViewPlugin + CSS injection pattern |
| YAML pane pattern | `src/plugins/yaml-pane/yaml-pane.plugin.ts` | Reference for bundling a third-party library (js-yaml precedent) into the IIFE |
| Build system | `scripts/build-plugins.mjs` | `external: [/^@codemirror\//]` rule — @codemirror/* must NOT be imported as values; KaTeX must be bundled |

---

## Functional Requirements

### FR-1: Inline Math Rendering

**FR-1.1** An inline math span is any occurrence of `$<content>$` in the document where:
- The opening `$` is not preceded by another `$` (not the start of a display block).
- The closing `$` is not followed by another `$`.
- `<content>` is non-empty.
- The expression does not span more than one line.

**FR-1.2** When the cursor is NOT inside an inline math span (i.e., `selection.main.head` is not in the range `[dollarOpen, dollarClose]` inclusive), the plugin replaces the entire `$...$` source text with a rendered HTML widget produced by KaTeX in inline mode.

**FR-1.3** When the cursor IS inside an inline math span (cursor head is at any position from the opening `$` through the closing `$` inclusive), the raw LaTeX source is visible and fully editable. The rendered widget is not shown.

**FR-1.4** A selection that spans across an inline math expression (anchor outside, head inside, or vice versa) counts as "cursor inside" and shows the raw source for the entire expression.

**FR-1.5** The rendered widget for inline math is a `WidgetDecoration` that replaces the entire `$...$` range in the CM6 document (a `ReplaceDecoration` with `widget` set). The widget's DOM is a `<span class="cm-math-inline">` containing KaTeX output.

### FR-2: Block (Display) Math Rendering

**FR-2.1** A display math block is a sequence of lines matching:
```
$$
<content lines>
$$
```
Where the opening `$$` occupies a complete line (optionally with trailing whitespace) and the closing `$$` occupies a complete line. The content may span zero or more lines between the delimiters.

**FR-2.2** When the cursor is NOT anywhere within the block (from the first character of the opening `$$` line through the last character of the closing `$$` line), the entire multi-line block is replaced by a single block `WidgetDecoration` containing KaTeX output rendered in display mode. The widget is a `<div class="cm-math-block">`.

**FR-2.3** When the cursor IS inside the block (any position from the opening `$$` line through the closing `$$` line), the raw LaTeX is visible and fully editable. No widget is shown.

**FR-2.4** The same "selection spans boundary" rule from FR-1.4 applies: any selection that touches the block range causes the raw source to be shown.

**FR-2.5** A display block with zero content lines between the delimiters (i.e., `$$\n$$`) renders as a KaTeX widget for an empty expression (KaTeX renders an empty string without error).

### FR-3: KaTeX Rendering Library

**FR-3.1** KaTeX is the required rendering library. MathJax is explicitly out of scope. Rationale: KaTeX is synchronous, ~250 KB minified+gzipped, and designed for IIFE bundling. MathJax is async and large.

**FR-3.2** KaTeX must be bundled into the plugin IIFE output (`math.js`). It must NOT be loaded from a CDN. Bundling follows the js-yaml precedent established in `yaml-pane.plugin.ts` (import at the top of the `.plugin.ts` file; Vite bundles it because `@codemirror/*` is the only external).

**FR-3.3** KaTeX CSS must be injected as a `<style>` tag by the plugin's `onEnable`, following the pattern in `focus-mode.plugin.ts` (inject by `document.createElement("style")`). The CSS must be sourced from the KaTeX npm package at build time — the Architect must determine the exact import path (e.g., `katex/dist/katex.min.css` read as a string via Vite's `?inline` or `?raw` import, or inlined manually).

**FR-3.4** KaTeX font files. KaTeX uses web fonts. The Architect must propose a strategy for font delivery. Two candidate approaches:
- Bundle fonts as base64 data URIs embedded in the injected CSS (simplest for IIFE).
- Copy font files into Tauri's resource bundle and reference them via `asset://` protocol.
The chosen strategy must be specified before implementation begins.

**FR-3.5** KaTeX rendering calls use `katex.renderToString(latex, options)`. Options:
- `displayMode: false` for inline math (FR-1), `displayMode: true` for block math (FR-2).
- `throwOnError: false` — rendering errors must not throw; invalid LaTeX must produce a visible error state (FR-5).
- `output: "html"` — SVG output is out of scope.

### FR-4: CM6 Implementation Architecture

**FR-4.1** The math rendering plugin uses a single CM6 `StateField<DecorationSet>` (not a `ViewPlugin`) for the decoration set. Rationale: math blocks can span multiple lines and therefore require block decorations, which are only stable in a `StateField`.

**FR-4.2** The `StateField` computes its `DecorationSet` by:
1. Scanning the full document text for all inline `$...$` spans and all display `$$...$$` blocks.
2. Comparing each found range against the current cursor selection.
3. For ranges where the cursor is NOT inside: producing a `Decoration.replace({ widget: ... })` that covers the entire `$...$` or `$$...$$` source range.
4. For ranges where the cursor IS inside: producing no decoration (raw source is shown).

**FR-4.3** The `StateField` recomputes on every `docChanged` or `selectionSet` transaction (same trigger pattern as `focusModeViewPlugin.update()`).

**FR-4.4** CM6 globals are accessed via the window globals pattern — no `@codemirror/*` value imports in the `.plugin.ts` file:
```typescript
const { StateField, StateEffect } = (window as any).__CM_STATE__;
const { Decoration, WidgetType, EditorView } = (window as any).__CM_VIEW__;
```
All `@codemirror/*` references in the file must be `import type` only, following the precedent in `focus-mode.plugin.ts` and the bug #5 fix documented in `cm-globals.ts`.

**FR-4.5** The `StateField` is registered via `api.addExtensions([mathField])` in `onEnable` and removed via `api.removeExtensions()` in `onDisable`.

**FR-4.6** Each rendered KaTeX widget extends `WidgetType`. The widget's `toDOM()` method calls `katex.renderToString()` and sets the result as the `innerHTML` of a container element. The widget must implement `eq()` to return `true` when the LaTeX source string is identical, enabling CM6 to skip DOM reconstruction for unchanged math.

### FR-5: Error Handling for Invalid LaTeX

**FR-5.1** When KaTeX fails to parse a math expression (even with `throwOnError: false`, it may still throw for certain inputs), the failure is caught and the widget renders an error placeholder instead of a blank or broken widget.

**FR-5.2** The error placeholder is a `<span class="cm-math-error">` (inline) or `<div class="cm-math-error">` (block) containing a short human-readable message: `"Math error"` with a tooltip (`title` attribute) showing the raw LaTeX source, allowing the user to understand what failed.

**FR-5.3** An invalid LaTeX expression that is currently cursor-away still produces the error placeholder widget (the raw source is not exposed). The user must move the cursor into the expression to see and correct the raw LaTeX.

**FR-5.4** The error state is styled with a distinct visual (e.g., red text or red underline) using a CSS variable-compatible approach so it respects the active theme.

### FR-6: Plugin Lifecycle

**FR-6.1** The plugin is a new file: `src/plugins/math/math.plugin.ts`. It does NOT modify `markdown-toolbar.plugin.ts` or any other existing plugin.

**FR-6.2** Plugin metadata:
- `id`: `"math"`
- `name`: `"Math"`
- `version`: `"1.0.0"`
- `description`: `"Render LaTeX math expressions using KaTeX"`
- `detail`: A longer description explaining that inline `$...$` and display `$$...$$` expressions are rendered in live preview mode; raw LaTeX is shown when the cursor is inside the expression.

**FR-6.3** `onEnable` sequence:
1. Inject KaTeX CSS as a `<style>` tag (idempotent — guard by element id).
2. Construct the `mathStateField` (`StateField<DecorationSet>`).
3. Register via `api.addExtensions([mathStateField])`.

**FR-6.4** `onDisable` sequence:
1. `api.removeExtensions()`.
2. Remove the injected KaTeX CSS `<style>` tag.

**FR-6.5** The plugin is added to the `PLUGINS` array in `scripts/build-plugins.mjs` as:
```javascript
["math", "src/plugins/math/math.plugin.ts"],
```

### FR-7: Settings

**FR-7.1** Phase 1 of this feature has no user-configurable settings beyond the standard plugin on/off toggle (handled by `PluginManager`).

**FR-7.2** The Architect may reserve a settings structure for future options (e.g., macros dictionary, display-math centering toggle), but no settings UI is required for this implementation.

### FR-8: Interaction with Existing Live Preview Mode

**FR-8.1** The math plugin's `StateField` is independent of the live preview (Typora-style syntax hiding) `StateField`. They coexist as separate CM6 extensions. No coupling between the two is required.

**FR-8.2** When the math plugin hides a `$...$` span via a `ReplaceDecoration`, the live preview mode has no `$` syntax to process for that range — the replace decoration takes precedence. This is expected and correct behavior.

**FR-8.3** The rendered KaTeX widget must not interfere with the editor's scroll position, selection restoration, or undo history. Widget decorations in CM6 are non-editable by default (cursor skips over them); this is the desired behavior.

---

## Non-Functional Requirements

**NFR-1: Render Performance** — KaTeX `renderToString()` is synchronous. For documents with up to 50 math expressions, the full `StateField` recomputation (scanning + rendering all non-cursor expressions) must complete within 50ms. For documents with more than 50 expressions, rendering is still synchronous but the Architect should evaluate whether incremental recomputation (only re-render changed ranges) is needed.

**NFR-2: IIFE Bundle Size** — KaTeX minified is approximately 80 KB (JS only, excluding fonts). The plugin IIFE `math.js` is expected to be approximately 100–120 KB. This is acceptable given KaTeX's rendering quality and the js-yaml precedent (~40 KB bundled in yaml-pane).

**NFR-3: IIFE Self-Containment** — The plugin follows all IIFE rules: no app-internal imports at runtime, CM6 accessed via window globals only, CSS injected via `<style>` tag, all third-party dependencies bundled.

**NFR-4: Theme Compatibility** — Math widget containers (`cm-math-inline`, `cm-math-block`) use CSS variables for margin, padding, and background so they adopt the active theme. KaTeX's own internal CSS is self-contained and must not conflict with Markable theme variables.

**NFR-5: Undo/Redo Safety** — The `StateField` decorations are derived state; they do not participate in the undo history. Undo/redo of the underlying LaTeX source text works normally via CM6's built-in history.

**NFR-6: No KaTeX CDN Dependency** — The app is designed to work offline. KaTeX must be fully bundled.

---

## Architectural Decisions (Proposed — for Architect to confirm)

**AD-1: StateField over ViewPlugin** — A `StateField<DecorationSet>` is required (not a `ViewPlugin`) because multi-line `$$...$$` blocks require block-level `ReplaceDecoration`, which must be stable across transactions and is only reliable in a `StateField`. Single-line ViewPlugin decorations are insufficient for the block math case.

**AD-2: Full Document Scan per Transaction** — The `StateField.provide()` computes decorations by scanning the full document on every relevant transaction. This is O(N) in document size. For typical note-taking documents (under 10,000 lines), this is acceptable. The Architect may propose incremental scan optimization if benchmarks indicate a problem.

**AD-3: KaTeX Bundled as IIFE Dependency** — KaTeX is imported at the top of `math.plugin.ts` (`import katex from "katex"`). The build system's `external: [/^@codemirror\//]` rule does not affect KaTeX; Vite/Rollup will bundle it into `math.js`. This is identical to how js-yaml is bundled into `yaml-pane.js`.

**AD-4: Font Strategy (Architect Must Decide)** — The two options for KaTeX fonts are:
- Option A: Inline fonts as base64 in the injected CSS. Pro: single self-contained `<style>` tag. Con: increases injected CSS size by ~500 KB.
- Option B: Copy KaTeX font files into `src-tauri/plugins/core/katex-fonts/` and reference them via Tauri's `asset://` protocol in the injected CSS. Pro: smaller CSS injection, fonts cached by browser. Con: requires Tauri resource bundling configuration.
The Architect must evaluate and select one option.

---

## Open Questions (for Architecture Phase)

**OQ-1: KaTeX CSS Import Strategy** — How should KaTeX's CSS be imported at build time into the IIFE? Options: (a) `import katexCss from "katex/dist/katex.min.css?inline"` (Vite raw import), (b) manually copy the CSS into a string constant, (c) post-process the build output. The Architect must confirm which approach works cleanly with the IIFE build format and does not introduce `require()` calls.

**OQ-2: Font Delivery** — See AD-4 above. The Architect must select Option A or Option B and specify the exact implementation.

**OQ-3: `__CM_STATE__` Exports** — `StateField` and `RangeSetBuilder` are accessed from `window.__CM_STATE__`. Confirm that `RangeSetBuilder` is exported by `@codemirror/state` and is present in `window.__CM_STATE__` (currently `cm-globals.ts` exports `import * as _cmState from "@codemirror/state"`, so all named exports are included — this should be confirmed).

**OQ-4: `WidgetType` Access** — `WidgetType` is in `@codemirror/view`. Confirm it is accessible as `(window as any).__CM_VIEW__.WidgetType` (it should be, per the `import * as _cmView` pattern in `cm-globals.ts`).

**OQ-5: Inline Math Regex Edge Cases** — The regex for detecting `$...$` must handle: escaped dollar signs (`\$`), dollar signs inside code spans (`` ` `` ... `` ` ``), and dollar signs inside fenced code blocks. The Architect must specify whether the scanner uses a simple regex or a lightweight parser that respects code fences.

**OQ-6: KaTeX Version** — Confirm the current stable KaTeX version (expected: 0.16.x). Check for any known IIFE bundling issues with the current release.

---

## Out of Scope

1. **MathJax** — Not supported; KaTeX only.
2. **SVG output** — KaTeX `output: "svg"` is not used; HTML output only.
3. **Custom macro definitions via settings UI** — No settings UI in this phase. Macros may be considered as a future enhancement.
4. **Math rendering in exported HTML** — The HTML export command (`Cmd-Opt-E`) is out of scope for this feature; it uses `marked` for rendering, not CM6 decorations.
5. **Multi-cursor math editing** — CM6's built-in multi-cursor works on the source text; no special handling of multi-cursor interactions with math widgets is required.
6. **Inline math spanning multiple lines** — Multi-line inline math (`$...\n...$`) is not supported. Only single-line inline math is rendered. Multi-line inline math is displayed as raw text (no widget).
7. **Nested math delimiters** — `$a $ b$` (dollar sign inside an inline math span) is out of scope. The scanner uses the first valid pair match.
8. **Server-side or pre-rendering** — All rendering is client-side via KaTeX in the IIFE.

---

## Edge Case Inventory

**EC-1: Cursor exactly on the opening `$`** — The cursor is at the position of the `$` character that opens an inline math span. Expected: raw LaTeX is shown (cursor is "inside" the expression). The widget is not rendered.

**EC-2: Cursor exactly on the closing `$`** — The cursor is at the position of the `$` character that closes an inline math span. Expected: raw LaTeX is shown. Same rule as EC-1.

**EC-3: Cursor on the line containing `$$` (block math delimiter)** — The cursor is on the opening or closing `$$` line of a display block. Expected: raw LaTeX block is shown (entire block is "active").

**EC-4: Two adjacent inline math spans on the same line** — E.g., `$a$ and $b$` with cursor between them (outside both). Expected: both are rendered as separate widgets. The inter-expression text `" and "` is shown as-is.

**EC-5: Inline math immediately adjacent to other syntax** — E.g., `**bold $x^2$ bold**`. The `$...$` span is inside a bold run. Expected: the inner math renders as a widget; the outer bold decoration (from the live preview layer) applies independently.

**EC-6: Empty inline math — `$$` (two dollars, no content)** — This is actually the block math opening delimiter pattern when followed by a newline. When both `$` characters are on the same line with no content between them: the inline scanner finds zero-length content and should NOT produce a decoration (zero-length math is not valid). Treated as raw text.

**EC-7: Block math with only whitespace content** — `$$\n   \n$$`. Expected: KaTeX renders an empty expression (whitespace-only LaTeX renders as empty). The widget shows an empty display box.

**EC-8: Block math immediately at start of document** — The opening `$$` is on line 1 of the document. Expected: no special handling needed; block detection is position-agnostic.

**EC-9: Invalid LaTeX inside an inline span** — E.g., `$\frac{1}{$` (unclosed brace). Expected: error placeholder widget per FR-5.2. The expression is not rendered; the error indicator is shown when cursor is away.

**EC-10: Invalid LaTeX inside a display block** — Same as EC-9 but for block math. Expected: block-level error placeholder (`<div class="cm-math-error">`).

**EC-11: Dollar sign inside a fenced code block** — A `$...$` pattern appears inside a ` ``` ` fenced code block. Expected: the scanner must not produce a decoration for math inside code fences. This is a code block; no math rendering occurs.

**EC-12: Dollar sign inside an inline code span** — E.g., `` `$x$` `` — a dollar sign inside backtick-delimited code. Expected: no math decoration; the content is a code span, not math.

**EC-13: Escaped dollar sign — `\$`** — A backslash-escaped dollar sign. Expected: the scanner must recognize `\$` as a literal dollar sign and not treat it as a math delimiter. The `\$` sequence must not open or close a math span.

**EC-14: Math plugin disabled while cursor is inside a math span** — `onDisable` calls `api.removeExtensions()`, which removes the `StateField`. Expected: all widgets are removed; the raw LaTeX source text is visible throughout the document. No error or stale DOM elements.

**EC-15: Math plugin re-enabled (toggle off, then on)** — Expected: a fresh `StateField` is created in `onEnable`; all math spans in the current document are rendered correctly. No residual state from the previous enable cycle.

**EC-16: Very large math expression — LaTeX string > 1000 characters** — KaTeX must handle this without hanging. Expected: KaTeX renders it (or returns an error placeholder if it exceeds internal limits). No UI freeze.

**EC-17: Block math delimiter `$$` appears inside an inline code span** — E.g., `` `$$` ``. Expected: same as EC-12 — code spans take precedence; no math decoration produced.

**EC-18: Multiple display blocks in the document** — Ten or more `$$...$$` blocks, none of which the cursor is in. Expected: all blocks render as widgets. Performance must remain within NFR-1 bounds.

**EC-19: Display block with no closing `$$`** — An opening `$$` on its own line with no matching closing `$$` before end of document. Expected: the scanner treats this as an unterminated block and produces no widget. The raw `$$` and subsequent text are shown as-is.

**EC-20: Inline math containing a newline (multi-line inline)** — `$a\n+b$`. Expected: the inline scanner requires single-line content (FR-1.1). This is not rendered as a widget; raw text is shown.

**EC-21: Tab switch while a math widget is displayed** — User switches to a different tab. The new document may contain different math. Expected: the `StateField` recomputes on the new document state (tab switch triggers a document change or editor re-mount); widgets for the new document are rendered correctly.

**EC-22: Undo past a math expression deletion** — User types over and deletes a `$x^2$` span, then presses Cmd-Z. Expected: the undo restores the source text; the `StateField` recomputes and the widget re-renders. No stale widget fragments remain.

**EC-23: KaTeX CSS injection — toggle off then on** — `onDisable` removes the `<style>` tag. `onEnable` re-injects it. Expected: the CSS injection is idempotent (guarded by a fixed element id per focus-mode pattern). No duplicate `<style>` tags accumulate across toggle cycles.

---

## New Work Required

| Component | Target File | Notes |
|---|---|---|
| Math plugin | `src/plugins/math/math.plugin.ts` (new) | IIFE plugin: StateField, KaTeX widget, CSS injection |
| Plugin build registration | `scripts/build-plugins.mjs` | Add `["math", "src/plugins/math/math.plugin.ts"]` to PLUGINS array |
| KaTeX npm dependency | `package.json` | Add `"katex": "^0.16.x"` to `dependencies`; add `"@types/katex"` to `devDependencies` |
| KaTeX font strategy | TBD by Architect (OQ-2 / AD-4) | Either base64 inline or Tauri resource bundle |
| Plugin settings store | None required | No user settings in Phase 1 |
| Math plugin tests | `tests/plugins/math/math.test.ts` (new) | Unit tests for scanner pure functions (EC-11 through EC-20 are highest priority) |
