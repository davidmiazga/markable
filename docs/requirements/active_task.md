---
title: "Mermaid Diagrams Plugin"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Mermaid Diagrams Plugin (FC2 #9) Requirements Spec

## Summary

As a user, I want to write Mermaid diagram syntax inside fenced code blocks tagged ` ```mermaid ` and have them rendered as SVG diagrams in live-preview mode — with the raw source revealed when my cursor enters the block — so that I can embed flowcharts, sequence diagrams, and other Mermaid diagram types directly in my Markdown notes without leaving the editor.

---

## Background and Motivation

FEATURES.md item FC2 #9 reads: "Diagrams support: Mermaid diagram support or excalidraw (or separate into separate plugins)." This spec covers Mermaid only. Excalidraw is explicitly deferred to FC3 #17 and is out of scope here.

Mermaid is the de facto standard for text-based diagrams in Markdown tools (GitHub, Obsidian, Notion all support it). Users author diagrams as fenced code blocks with the language tag `mermaid`. The plugin intercepts these blocks in the CM6 document, renders them as SVG, and applies the same Typora-style cursor-on-reveal interaction used by the Math plugin (FC2 #8).

The closest analog in this codebase is `src/plugins/math/math.plugin.ts` (KaTeX StateField, block decorations, cursor-reveals-source, IIFE pattern). The Media Preview plugin (`src/plugins/media-preview/media-preview.plugin.ts`) is a secondary analog for Lezer AST-based block detection.

---

## Goals

- Render ` ```mermaid ` fenced code blocks as SVG diagrams in live-preview mode.
- Reveal raw Mermaid source when the cursor is inside the fenced block.
- Support the most common Mermaid diagram types (see FR-03).
- Respect the existing source-mode guard (`__MARKABLE_PREVIEW_ENABLED__`) — no widgets in raw/source view.
- Adapt diagram theme to the active app theme (dark/light CSS variable awareness).
- Ship as a toggleable core plugin consistent with all other FC2 plugins.
- Address the Mermaid bundle size problem (Mermaid minified is approximately 2.5 MB) before implementation begins — the current 500 KB Rust `read_plugin_file` cap must be resolved.

## Non-Goals (Explicitly Out of Scope)

- **Excalidraw support** — deferred to FC3 #17. A separate plugin will be created for that.
- **Diagram editing UI** — no drag-and-drop canvas, no shape palette, no visual editing. Raw text only.
- **Export of individual diagrams** — the Extended Exports plugin (FC2 #16) handles document-level export. Per-diagram SVG export is not in scope for this plugin.
- **Mermaid config file support** — `mermaid.config.json` or `%%{init}` front matter configuration is not supported in this iteration. The Architect may revisit in a later pass.
- **Click-to-edit on rendered SVG** — clicking a rendered diagram moves the cursor into the source block (same as Math). There is no "click a shape to select it" mode.
- **Mermaid Live Editor integration** — no external URL launch or embedded browser pane.

---

## User Stories and Acceptance Criteria

**US-01: Basic Rendering**
Given a document in live-preview mode containing a fenced code block tagged `mermaid` with valid syntax, when I move the cursor away from the block, the block is replaced by a rendered SVG diagram.

Acceptance: the rendered SVG is visible, correctly scaled, and does not overflow the editor's content width.

**US-02: Cursor-On Reveals Source**
Given a rendered diagram, when I click anywhere inside it (or move my cursor into the block's line range), the SVG decoration is removed and the raw Mermaid source text becomes visible and editable.

Acceptance: the raw text is fully editable. Moving the cursor away re-renders the diagram.

**US-03: Invalid Syntax Error Display**
Given a fenced mermaid block with invalid Mermaid syntax, when I move the cursor away, the block is replaced by a visible error indicator (not a crash, not a blank space) that identifies the block as containing a diagram syntax error.

Acceptance: an error placeholder with a brief message is shown. The raw source is revealed when the cursor re-enters.

**US-04: Source-Mode Guard**
Given the app is in source/raw mode (`__MARKABLE_PREVIEW_ENABLED__` is false), no diagram widgets are rendered. The fenced code block appears as plain Markdown source text.

Acceptance: toggling preview mode off and on causes diagrams to disappear and reappear correctly.

**US-05: Theme Adaptation**
Given the user switches the active theme (dark to light or vice versa), diagram rendering matches the new theme (background, text, and arrow colors are appropriate for the theme).

Acceptance: diagrams do not show a white-box-on-dark-background problem or vice versa after a theme switch.

**US-06: Multiple Diagrams Per Document**
Given a document with three or more mermaid fenced blocks, all blocks render independently. Moving the cursor into one block reveals only that block's source; the others remain rendered.

Acceptance: no cross-contamination of decoration state between blocks.

**US-07: Plugin Disable Removes All Decorations**
Given the Mermaid plugin is enabled and diagrams are rendered, when I disable the plugin via the Plugins Panel, all diagram widgets are removed and the raw fenced blocks are visible as plain text.

Acceptance: no residual SVG elements remain in the DOM after disable.

---

## Functional Requirements

### FR-01: Fenced Block Detection

**FR-01.1** The plugin detects fenced code blocks whose opening fence line exactly matches ` ```mermaid ` (three or more backticks followed by the language tag `mermaid`, case-insensitive). The language tag may have leading or trailing whitespace on the fence line.

**FR-01.2** Detection uses the Lezer syntax tree (`syntaxTree` from `window.__CM_LANGUAGE__`) to locate `FencedCode` nodes, consistent with the media-preview plugin pattern. This avoids false positives for mermaid text inside inline code spans or non-code block contexts.

**FR-01.3** The Lezer AST approach ensures mermaid blocks nested inside blockquotes or other container elements are correctly detected (the tree walk handles nesting naturally).

**FR-01.4** The `from` and `to` offsets for the decoration span the entire fenced block: from the first character of the opening fence line to the last character of the closing fence line (exclusive end, CM6 convention). This is the range that is replaced by the widget decoration when the cursor is away.

**FR-01.5** A fenced block with no closing fence (unclosed block) produces no decoration. The raw text remains visible. (See EC-03.)

### FR-02: StateField and Decoration

**FR-02.1** Diagram decorations are managed by a CM6 `StateField<DecorationSet>`, not a `ViewPlugin`. Block decorations require `StateField` per project convention (D-1).

**FR-02.2** The `StateField` is constructed fresh on each `onEnable` call (factory function, not a module-level constant), consistent with the Math plugin pattern. This eliminates residual state across enable/disable cycles.

**FR-02.3** The `StateField.update()` method recomputes decorations when `tr.docChanged` or `tr.selection` is truthy. Transactions with neither document change nor selection change skip recomputation (performance optimization for O(N) Lezer tree walk).

**FR-02.4** The decoration uses `Decoration.replace({ widget, block: true })` to replace the entire fenced block (opening fence, content, closing fence) with the rendered SVG widget. `block: true` is mandatory for multi-line block decorations in CM6.

**FR-02.5** Cursor overlap detection uses the same `isCursorInsideRange(anchor, head, from, to)` logic as the Math plugin: if any part of the selection overlaps `[from, to)`, the decoration is suppressed and the raw source is visible.

**FR-02.6** The `StateField.provide()` callback wires the field to `EditorView.decorations.from(field)` for CM6-idiomatic decoration rendering.

### FR-03: Mermaid Diagram Type Support

**FR-03.1** The following Mermaid diagram types must render correctly in this version:

| Type | Mermaid keyword |
|---|---|
| Flowchart | `flowchart`, `graph` |
| Sequence Diagram | `sequenceDiagram` |
| Gantt Chart | `gantt` |
| Class Diagram | `classDiagram` |
| State Diagram | `stateDiagram`, `stateDiagram-v2` |
| Entity Relationship | `erDiagram` |
| Pie Chart | `pie` |
| User Journey | `journey` |
| Timeline | `timeline` |
| Mindmap | `mindmap` |
| Quadrant Chart | `quadrantChart` |
| XY Chart | `xychart-beta` |

**FR-03.2** Diagram types not in the table above are passed to Mermaid's renderer as-is. If Mermaid supports them natively (e.g., future additions), they render. If not, the error display path (FR-05) handles the failure.

**FR-03.3** The plugin does not whitelist or blacklist specific diagram types at the source-detection level. All ` ```mermaid ` fences are processed; Mermaid itself determines whether the type is supported.

### FR-04: Rendering Strategy and Widget

**FR-04.1** Each diagram block is rendered by calling `mermaid.render(id, source)` (or `mermaid.renderAsync`, whichever the bundled version exposes). The result is an SVG string, which is injected into a container `<div>` via `innerHTML`. The container `<div>` is the widget's DOM element.

**FR-04.2** The SVG container has `class="cm-mermaid-block"`. It is styled to be `display: block`, horizontally scrollable for wide diagrams, and horizontally centered within the editor's content width.

**FR-04.3** Mermaid rendering is asynchronous (returns a Promise). The `toDOM()` method on the widget must handle the async nature: it must return a placeholder `<div>` immediately and update it once the render resolves. This deferred-render approach avoids blocking the CM6 render cycle. (The Architect must specify the exact deferred-DOM-update strategy.)

**FR-04.4** Each widget instance carries the Mermaid source string. The `eq()` method compares source strings so CM6 can reuse the DOM node when the source has not changed (cursor movement that does not modify the block should not re-render the SVG).

**FR-04.5** Widget DOM element `ignoreEvent()` returns `false`, allowing mouse clicks to pass through to CM6, which moves the cursor into the block range and triggers source reveal.

**FR-04.6** Each Mermaid render call requires a unique element ID. The plugin must generate stable, unique IDs per block to avoid Mermaid's internal ID-collision errors. IDs should be deterministic based on block position or a document-stable hash (the Architect specifies the approach).

### FR-05: Error Display

**FR-05.1** When Mermaid rendering fails (thrown error or rejected Promise), the widget displays an error placeholder `<div class="cm-mermaid-error">` with:
- The text "Diagram error" as the visible label.
- The raw Mermaid source shown in a `<pre>` block below the label, or available via `title` attribute on hover, so the user can identify and fix the syntax.

**FR-05.2** Error placeholders use CSS variables for theme compatibility: `--mermaid-error-color` (with fallback `#c0392b` or equivalent).

**FR-05.3** The error placeholder has `cursor: help` to signal to the user that there is actionable information available (hover or click to edit).

**FR-05.4** Moving the cursor into the error placeholder's range reveals the raw source for editing, identical to the non-error path.

### FR-06: Source-Mode Guard

**FR-06.1** The `buildDiagramDecorations()` function checks `window.__MARKABLE_PREVIEW_ENABLED__` before processing any ranges. If false, it returns `Decoration.none` immediately with no Lezer tree walk.

**FR-06.2** This guard applies to both the `create` and `update` paths of the `StateField`.

**FR-06.3** When preview mode is toggled back on after being off, the next `tr.docChanged` or `tr.selection` event triggers a full recomputation and diagrams re-render.

### FR-07: Theme Awareness

**FR-07.1** Mermaid exposes a `theme` configuration option accepting values `"default"`, `"dark"`, `"neutral"`, `"forest"`, `"base"`. The plugin must select the appropriate Mermaid theme based on the active Markable theme.

**FR-07.2** The mapping strategy: the plugin reads the current computed background color of the editor container (via `getComputedStyle` on a known element) and determines dark vs. light mode. Dark mode maps to Mermaid `"dark"` theme; light mode maps to Mermaid `"default"` theme. The Architect may refine this with a CSS variable check (e.g., reading a dedicated `--color-scheme` variable if one exists in the theme system).

**FR-07.3** When the active theme changes (detected via the `__MARKABLE_HANDLE_ACTION__` dispatch for theme-switch actions, or via a MutationObserver on `document.body`'s class/attribute), rendered diagrams must re-render with the new theme. The StateField recompute cycle handles this if the plugin triggers a CM6 transaction on theme change.

**FR-07.4** Mermaid's `initialize()` must be called before the first render. Re-initialization with a new theme configuration is required when the theme changes. The Architect must specify whether Mermaid supports re-initialization or requires re-import.

**FR-07.5** The SVG container background must not be hardcoded white. Mermaid's SVG output sets its own background; the plugin must not override it with a conflicting color.

### FR-08: Plugin Settings

**FR-08.1** The plugin exposes the following settings (persisted via `api.loadSettings()` / `api.saveSettings()`):

| Setting Key | Type | Default | Description |
|---|---|---|---|
| `mermaidTheme` | `"auto" \| "dark" \| "default" \| "neutral" \| "forest"` | `"auto"` | Override Mermaid theme. `"auto"` uses theme-detection logic (FR-07.2). |
| `maxRenderWidth` | `number` | `900` | Maximum SVG container width in pixels. Diagrams wider than this scroll horizontally. |
| `showErrorSource` | `boolean` | `true` | When true, error placeholder shows the raw source in a `<pre>` block. When false, shows only "Diagram error." |

**FR-08.2** Settings are loaded in `onEnable` via `api.loadSettings()`. If null (first run), defaults above are used.

**FR-08.3** Settings UI is provided in the plugin detail view via the `renderDetailExtra` hook on the `UnifiedPlugin` descriptor.

### FR-09: Bundle Size Strategy

**FR-09.1** Mermaid's minified bundle is approximately 2.5 MB. The current `read_plugin_file` Rust command enforces a 500 KB cap. This is a hard blocker that must be resolved before the plugin can be loaded.

**FR-09.2** Three candidate strategies exist. The Architect must choose one and document the decision in the architecture spec:

**Strategy A — Raise the Rust cap.** Modify `read_plugin_file` in `src-tauri/src/commands/plugins.rs` to raise `MAX_BYTES` from 500 KB to a value that accommodates the full Mermaid bundle (3 MB or higher to provide headroom). This is the simplest approach. The tradeoff is that the cap no longer protects against accidentally large user plugins; a separate per-kind cap (core vs. user) could mitigate this.

**Strategy B — Tauri `asset://` protocol for Mermaid.** Bundle Mermaid as a static `.js` file in `src-tauri/plugins/core/` or `src-tauri/resources/` and load it via `<script src="asset://...">` injection rather than via `read_plugin_file`. The plugin IIFE itself would be small (< 50 KB) and only contain the CM6 StateField and widget logic; Mermaid would be loaded as a separate asset. This avoids modifying the file-size cap entirely. The tradeoff is increased complexity: the plugin must defer execution until the Mermaid script has loaded, and the asset URL must be resolved via `window.__MARKABLE_CONVERT_FILE_SRC__` or a new Tauri protocol handler.

**Strategy C — Split IIFE (chunked load).** Mermaid is imported dynamically inside `onEnable` using a Tauri `invoke` call that reads the Mermaid bundle in chunks or via a streaming read command. This is the most complex strategy and is not recommended unless Strategies A and B are ruled out.

**FR-09.3** Strategy A is the recommended default. The Architect should verify whether a per-kind cap (larger for core, 500 KB for user) is a worthwhile guard before prescribing the exact new limit.

**FR-09.4** Regardless of the chosen strategy, the Mermaid library must be bundled or loaded in a way that makes it available synchronously at `onEnable` time (or deferred but resolved before the first render attempt). It must not block the app startup path.

### FR-10: Plugin Lifecycle

**FR-10.1** Plugin file: `src/plugins/diagrams/diagrams.plugin.ts`

**FR-10.2** Plugin metadata:
- `id`: `"diagrams"`
- `name`: `"Diagrams"`
- `version`: `"1.0.0"`
- `description`: `"Render Mermaid diagrams in live preview mode"`
- `detail`: describing the supported diagram types and the cursor-on-reveal interaction.

**FR-10.3** `onEnable` sequence:
1. Load settings via `api.loadSettings()`.
2. Initialize Mermaid (`mermaid.initialize()`) with the resolved theme.
3. Inject plugin CSS (`<style>` tag, idempotent, guarded by element ID).
4. If Strategy B (asset:// load): inject a `<script>` tag pointing to the Mermaid asset URL and wait for it to load before proceeding.
5. Construct a fresh `StateField` instance (factory, not module-level constant).
6. Register the StateField via `api.addExtensions([diagramsField])`.
7. Register a theme-change listener (MutationObserver or action dispatch hook) to trigger re-initialization and StateField recompute on theme switches.

**FR-10.4** `onDisable` sequence:
1. `api.removeExtensions()` — removes the StateField and all diagram decorations.
2. Remove injected CSS `<style>` tags.
3. If Strategy B: remove the injected `<script>` tag for Mermaid.
4. Remove the theme-change listener.
5. Clear module-level state references to null.

**FR-10.5** The plugin must be added to `scripts/build-plugins.mjs`'s `PLUGINS` array:
`["diagrams", "src/plugins/diagrams/diagrams.plugin.ts"]`

**FR-10.6** The plugin must be added to the `COMMANDS` array in `src/keybindings/keybindings-panel.ts` as a toggle command (id: `"view-toggle-diagrams"`, defaultKey: `""`, section: `"View"`) consistent with other plugin toggles. This makes it discoverable and toggleable via the Command Bar.

### FR-11: Command Bar Discoverability

**FR-11.1** Because the Command Bar (FC2 #11) reads from the `COMMANDS` array at open time and generates dual-results for plugin toggles, the Diagrams plugin is automatically discoverable in the Command Bar once its toggle command is added to the array (FR-10.6). No additional Command Bar work is required.

---

## Non-Functional Requirements

**NFR-01: Initial Render Latency** — From cursor leaving a mermaid block to the SVG widget being visible must be under 300ms for diagrams with fewer than 100 nodes. Mermaid's async render call may take longer for complex diagrams; the user must see a loading placeholder within 16ms (one frame) while the async render completes.

**NFR-02: Re-render on Edit** — After the user edits mermaid source and moves the cursor away, the updated SVG must render within 500ms. Debounce of 200–300ms on the StateField recompute is acceptable for large documents to avoid re-rendering on every keystroke while the cursor is outside the block.

**NFR-03: IIFE Self-Containment** — All IIFE plugin rules apply. No app-internal module imports at runtime. CM6 accessed via window globals only (`__CM_VIEW__`, `__CM_STATE__`, `__CM_LANGUAGE__`). CSS injected via `<style>` tags. Mermaid accessed via the bundled or asset-loaded library.

**NFR-04: Theme Compatibility** — All plugin-defined CSS uses variables from `:root`. No hardcoded hex values or font names except as fallbacks in `var()` declarations.

**NFR-05: No Persistent DOM Leaks** — `onDisable` must remove all `<style>` tags, all SVG DOM nodes injected by widgets, and all event listeners registered during `onEnable`. The editor must return to a clean state after the plugin is toggled off.

**NFR-06: SVG Output Only** — The plugin uses Mermaid's SVG output mode. Canvas output is not acceptable: canvas elements cannot be serialized for export and do not integrate well with CM6 block decorations.

**NFR-07: No Network Requests** — Mermaid rendering is entirely offline. The plugin must not make any HTTP requests. All resources (Mermaid library, fonts) are bundled or loaded from `asset://` protocol paths.

**NFR-08: XSS Safety** — Mermaid diagram source is author-controlled content, not untrusted user input from a network. However, the SVG output must not be injected into the document in a way that allows embedded `<script>` elements to execute. The plugin must verify that Mermaid's SVG output is safe to inject via `innerHTML` (Mermaid strips scripts from its SVG output by default; the Architect must confirm this for the bundled version).

---

## Architecture Decisions (Pre-Resolved Constraints)

These constraints are established by the codebase and must be encoded in the architecture spec, not re-debated.

**AD-01: IIFE plugin pattern** — The plugin is an IIFE bundle (`export default` object implementing `UnifiedPlugin`). No ESM imports at runtime. Built by `scripts/build-plugins.mjs` into `src-tauri/plugins/core/diagrams.js`.

**AD-02: CM6 globals** — `__CM_VIEW__`, `__CM_STATE__`, `__CM_LANGUAGE__` are module namespaces, not instances. Instance methods (`dispatch()`, `focus()`, `.doc`) are only available on `window.__MARKABLE_EDITOR_VIEW__`. The plugin destructures CM6 class constructors from these globals at IIFE evaluation time.

**AD-03: Block decorations require StateField** — `ViewPlugin` is insufficient for multi-line block replacements. `StateField<DecorationSet>` with `block: true` decorations is mandatory.

**AD-04: Source-mode guard is mandatory** — `buildDiagramDecorations()` must check `window.__MARKABLE_PREVIEW_ENABLED__` and short-circuit to `Decoration.none` when false.

**AD-05: Lezer AST for block detection** — Use `syntaxTree(state).cursor()` to walk `FencedCode` nodes (same pattern as media-preview plugin). This is preferred over a line-by-line text scan because the Lezer tree correctly excludes mermaid-tagged text inside inline code, blockquotes, and other contexts where a regex scan would false-positive.

**AD-06: StateField factory** — The StateField is created inside a factory function called from `onEnable`, not as a module-level constant. This ensures fresh slot IDs on each enable/disable cycle.

**AD-07: Async render deferred-DOM pattern** — Mermaid's render is async. `toDOM()` must return synchronously (CM6 requirement). The widget returns a placeholder div immediately and resolves the SVG into it when the Promise settles. The Architect must specify whether this uses a `requestAnimationFrame` update, a direct DOM mutation after `await`, or a separate ViewPlugin update cycle.

**AD-08: Unique render IDs** — Mermaid requires a unique string ID per `render()` call. Use a module-level counter or a position-based hash to generate stable IDs. Unstable IDs (e.g., `Math.random()`) cause unnecessary re-renders when `eq()` on the widget returns true but Mermaid still creates a new SVG element.

---

## Integration Points

| System | Integration | Notes |
|---|---|---|
| Plugin system (IIFE loader) | Plugin loaded as `plugins/core/diagrams.js` | Add to `build-plugins.mjs` PLUGINS array and `copy_core_plugins` bundle |
| CM6 StateField | `api.addExtensions([diagramsField])` in `onEnable` | Block decoration pattern |
| CM6 Lezer AST | `syntaxTree` from `window.__CM_LANGUAGE__` | FencedCode node detection |
| `read_plugin_file` Rust command | Cap must be raised (FR-09) | Mermaid bundle ~2.5 MB; current cap is 500 KB |
| `__MARKABLE_PREVIEW_ENABLED__` global | Checked in `buildDiagramDecorations()` | Source-mode guard |
| `__MARKABLE_EDITOR_VIEW__` global | Used for triggering StateField recompute on theme change | Not `__CM_VIEW__` (that is a module namespace) |
| Plugin settings persistence | `api.loadSettings()` / `api.saveSettings()` | Theme override, max width, error source display |
| Plugin detail view | `renderDetailExtra` hook on `UnifiedPlugin` | Settings UI row |
| COMMANDS array | Add `"view-toggle-diagrams"` toggle entry | Command Bar discoverability (FC2 #11) |
| Plugins Panel | Automatic via plugin system | Toggle, detail view, sidebar assignment (not applicable — no sidebar panel) |

---

## Open Questions

The following questions are unresolved and must be answered before architecture begins. The Architect may research and answer them as part of the architecture phase.

**OQ-01: Bundle size strategy** — Which of the three strategies in FR-09.2 should be implemented? The Architect must evaluate Strategy A (raise Rust cap) versus Strategy B (asset:// load) and choose one. Recommendation: Strategy A with a per-kind cap (core plugins: 5 MB, user plugins: 500 KB) to preserve user-plugin safety while accommodating Mermaid.

**OQ-02: Mermaid version** — What version of Mermaid should be bundled? The latest stable release at architecture time should be used. The Architect must verify that the chosen version supports all diagram types in FR-03.1 and produces safe SVG output (NFR-08).

**OQ-03: Mermaid re-initialization** — Does `mermaid.initialize()` support being called multiple times in the same JS context with different configurations (e.g., switching from dark to light theme)? If not, does the plugin need to track "initialized theme" state and only re-initialize when the theme changes? The Architect must test this with the chosen Mermaid version.

**OQ-04: Async render in toDOM()** — What is the cleanest pattern for deferred SVG injection into a CM6 widget DOM element? Options: (a) `toDOM()` sets up a Promise chain that mutates the placeholder div directly after `await mermaid.render()`; (b) the widget triggers a StateField update that replaces the placeholder decoration with the real SVG decoration. Option (a) is simpler but mutates DOM outside CM6's transaction model; option (b) is more correct but requires additional StateField machinery. The Architect must specify and justify the choice.

**OQ-05: Mermaid SVG and dark mode** — Does Mermaid's `"dark"` theme produce correct SVG output when the SVG is embedded in a non-white DOM background? Are there known issues with SVG `currentColor` inheritance in Mermaid's output that require additional CSS overrides? The Architect should test against the two most common Markable themes.

**OQ-06: `syntaxTree` FencedCode info node** — In the Lezer Markdown grammar, the language tag (e.g., `mermaid`) is accessible via the `CodeInfo` child node of `FencedCode`. The Architect must confirm the exact node type name in `@lezer/markdown` for the language tag and the content span, as this drives the detection implementation (FR-01.2).

---

## Out of Scope

1. **Excalidraw** — FC3 #17, separate plugin.
2. **Mermaid `%%{init}` configuration** — per-diagram initialization overrides. Deferred.
3. **Per-diagram SVG export** — handled by Extended Exports (FC2 #16).
4. **Diagram click-to-edit shapes** — raw source only, no visual editing.
5. **Mermaid Live Editor URL launch** — no external browser integration.
6. **Syntax highlighting inside mermaid fences** — the raw source is plain text when revealed. No custom Lezer grammar for Mermaid syntax tokens.
7. **Diagram caching across sessions** — diagrams are re-rendered on each document open. No persistent SVG cache.
8. **Mermaid `securityLevel` configuration** — the Architect sets an appropriate `securityLevel` value in `mermaid.initialize()`. End users cannot override it via plugin settings.

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer. Every item must be covered by a test or a documented manual verification step.

**EC-01: Empty mermaid block** — A ` ```mermaid ` fence with no content (empty lines only between fences). Expected: Mermaid receives an empty string. The result is either an empty SVG, a Mermaid error, or a blank render. The error path (FR-05) handles any failure gracefully; no crash.

**EC-02: Block with only whitespace content** — Same as EC-01 but with spaces/tabs between fences. Expected: same behavior as EC-01.

**EC-03: Unclosed fence (no closing ```)** — The opening ` ```mermaid ` line exists but there is no closing fence before end-of-document. Expected: no decoration is produced for this block. The raw source remains visible. (Lezer's FencedCode node does not produce a well-formed node for unclosed fences; the detection logic must handle this gracefully.)

**EC-04: Invalid Mermaid syntax** — A closed fenced block with valid fence delimiters but invalid Mermaid content (e.g., `graph TD\n  A --INVALID--> B`). Expected: Mermaid render rejects with an error. Error placeholder displayed (FR-05). Raw source revealed on cursor entry.

**EC-05: Very large diagram** — A flowchart with 500+ nodes. Expected: the async render completes eventually (may exceed NFR-01 timing; a loading placeholder must be shown). The editor must not freeze or become unresponsive while Mermaid renders.

**EC-06: Multiple diagrams in document** — Three or more mermaid blocks. Expected: all render independently. Cursor inside block 2 reveals block 2's source; blocks 1 and 3 remain rendered as SVG.

**EC-07: Diagram immediately after YAML front matter** — A mermaid block at the very top of the document, below a `---` YAML fence. Expected: the Lezer tree correctly identifies this as a FencedCode node (not confused by the YAML fence). Renders correctly.

**EC-08: Mermaid block inside blockquote** — ` > ```mermaid ` syntax. Expected: the Lezer tree walks blockquote-contained FencedCode nodes. The plugin must handle this case (render or skip — the Architect decides whether blockquote diagrams are supported; if skipped, the block remains as raw source with no crash).

**EC-09: Source-mode toggle while cursor is inside a diagram block** — User disables preview mode while their cursor is in a mermaid block. Expected: the decoration is not applied (guard fires), the raw source is visible. Re-enabling preview mode with cursor still inside the block: the block is visible as raw source (cursor overlap suppresses the decoration). Moving the cursor away: the diagram renders.

**EC-10: Theme switch while diagrams are rendered** — User switches theme from light to dark (or vice versa). Expected: all rendered diagrams re-render with the new Mermaid theme. No old-theme SVG artifacts remain.

**EC-11: Plugin disabled while diagrams are rendered** — User toggles the Diagrams plugin off from the Plugins Panel. Expected: all SVG widgets are removed from the editor. The raw fenced blocks are visible. No SVG DOM nodes remain. Re-enabling the plugin re-renders all diagrams.

**EC-12: Enable/disable cycle (rapid toggle)** — Plugin enabled, disabled, and re-enabled in quick succession. Expected: no duplicate StateFields, no duplicate CSS style tags, no duplicate Mermaid initialization. Each enable cycle starts from a clean state.

**EC-13: Diagram source edited while cursor is inside** — User edits the mermaid source. When they move the cursor away, the updated source is rendered. Expected: the `eq()` comparison on the widget detects that the source has changed and creates a new render. The old SVG is replaced with the new one.

**EC-14: Diagram source unchanged, cursor moves in and out** — User moves cursor into a mermaid block and immediately back out without editing. Expected: `eq()` returns true on the re-created widget (same source), CM6 reuses the existing DOM node, and no re-render of the SVG occurs.

**EC-15: Mermaid render produces an SVG with embedded `<script>` tags** — A maliciously crafted or edge-case diagram source that causes Mermaid's SVG output to include a `<script>` element. Expected: the plugin's `innerHTML` injection must not execute the script. (Mermaid strips scripts by default; the Architect must verify this claim for the bundled version and document the finding. If not guaranteed, the plugin must sanitize the SVG output before injection.)

**EC-16: Mermaid library load failure** — Strategy B only: the `<script>` tag for the Mermaid asset fails to load (asset file missing or corrupt). Expected: `onEnable` must detect the failure, log an error, and leave the editor in a clean state (no StateField registered, no broken references to an unavailable `mermaid` global). The plugin should display a warning in the Plugins Panel detail view if possible.

**EC-17: Mermaid block content contains HTML entities** — Diagram source containing `&`, `<`, `>` in label text (e.g., `A["value < 10"]`). Expected: Mermaid handles these as part of its own parsing. The plugin passes the raw source string to `mermaid.render()` without pre-escaping. Mermaid's output SVG is correct.

**EC-18: Extremely wide diagram (overflows content area)** — A sequence diagram or Gantt chart that renders wider than `maxRenderWidth` pixels. Expected: the SVG container scrolls horizontally (CSS `overflow-x: auto` on `.cm-mermaid-block`). The surrounding editor layout is not broken.

**EC-19: Render ID collision** — Two mermaid blocks in the same document that somehow generate the same render ID (edge case in the ID generation strategy). Expected: Mermaid detects the ID collision and throws an error, which the error path (FR-05) handles. The ID generation strategy must be designed to make this practically impossible (the Architect specifies the strategy — see AD-08).

**EC-20: Document with zero mermaid blocks** — The plugin is enabled but the document has no mermaid fences. Expected: the Lezer tree walk produces no results; `Decoration.none` is returned; no performance regression. The StateField update path is O(N) in document size but effectively a no-op for non-mermaid documents.

**EC-21: Mermaid block at end of document with no trailing newline** — The closing fence is the last byte of the document with no `\n` after it. Expected: Lezer still produces a valid FencedCode node; the `to` offset is at the document's last position; the decoration is applied correctly.

**EC-22: Tab switch while a diagram is being rendered** — The user switches to a different tab while Mermaid's async render is in flight. Expected: when the async render completes, its DOM mutation targets the widget placeholder. If the widget is no longer in the active view (tab switched), the mutation should be harmless (the DOM node is detached). No error is thrown; no crash.

**EC-23: Settings load returns null (first run)** — `api.loadSettings()` returns null. Expected: all default values from FR-08.1 are used. The plugin initializes correctly with defaults and does not attempt to read properties from a null object.

**EC-24: Settings save failure** — `api.saveSettings()` rejects (e.g., disk full). Expected: the plugin logs the error but continues running. The in-memory settings remain active for the session; on next launch, the default or previously saved values are used.

**EC-25: Preview mode toggled rapidly** — User rapidly toggles between source and preview mode (e.g., via a keybinding). Expected: the StateField guard fires correctly on each toggle. No leftover decorations when source mode is active. No missing decorations when preview mode re-activates.

**EC-26: Mermaid `initialize()` called before library is available** — Strategy B timing issue: `onEnable` calls `mermaid.initialize()` before the `<script>` tag's `onload` fires. Expected: the plugin must await the library load before calling any Mermaid API. An `onload` or Promise-based guard is required.

---

## New Work Required

| Component | Target File | Notes |
|---|---|---|
| Diagrams plugin source | `src/plugins/diagrams/diagrams.plugin.ts` (new) | IIFE plugin: Lezer FencedCode detection, StateField, MermaidWidget, error placeholder, CSS injection, theme-change listener |
| Diagrams plugin directory | `src/plugins/diagrams/` (new directory) | |
| Plugin build registration | `scripts/build-plugins.mjs` | Add `["diagrams", "src/plugins/diagrams/diagrams.plugin.ts"]` to PLUGINS array |
| Mermaid bundle | `src-tauri/plugins/core/` or `src-tauri/resources/` | Depends on bundle strategy (FR-09). If Strategy A: bundled into IIFE. If Strategy B: copied as a separate `.js` asset. |
| Rust file-size cap | `src-tauri/src/commands/plugins.rs` | Raise `MAX_BYTES` in `read_plugin_file` (Strategy A) or add asset protocol handler (Strategy B) |
| COMMANDS array toggle entry | `src/keybindings/keybindings-panel.ts` | Add `view-toggle-diagrams` to COMMANDS array |
| handleAction dispatch | `src/main.ts` | Add `"view-toggle-diagrams"` case that calls `pluginManager.toggle("diagrams", ...)` |
| Plugin tests | `tests/plugins/diagrams/diagrams.test.ts` (new) | Unit tests: FencedCode detection, cursor overlap suppression, EC-01 (empty block), EC-03 (unclosed fence), EC-04 (invalid syntax), EC-06 (multiple blocks), EC-09 (source-mode guard), EC-12 (enable/disable cycle), EC-13 (source changed re-renders), EC-14 (source unchanged reuses DOM), EC-20 (no mermaid blocks) |
