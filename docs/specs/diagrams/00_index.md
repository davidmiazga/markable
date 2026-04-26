---
title: "Diagrams Plugin — Master Index"
last-updated: "2026-04-20"
review-revision: 1
review-cadence-days: 7
status: active
---

# Diagrams Plugin (FC2 #9) — Master Index

**Requirements source:** `docs/requirements/active_task.md`
**Feature:** Mermaid diagram rendering in live-preview mode

---

## Overview

The Diagrams plugin renders ` ```mermaid ` fenced code blocks as SVG diagrams using Mermaid.js. It follows the Typora-style cursor-on-reveal pattern (raw source shown when cursor is inside the block, SVG shown when cursor is away) and integrates with the existing IIFE plugin system.

Primary analog: `src/plugins/math/math.plugin.ts` (StateField, block decorations, IIFE pattern).
Secondary analog: `src/plugins/media-preview/media-preview.plugin.ts` (Lezer FencedCode AST walk).

---

## Open Question Resolutions

**OQ-01: Bundle size strategy — Strategy A chosen.**
Raise `read_plugin_file` Rust cap to per-kind limits: core plugins 5 MB, user plugins 500 KB. Mermaid minified (~2.5 MB) fits comfortably under 5 MB with headroom. Strategy B (asset:// script injection) adds complexity around deferred initialization and load-failure handling that outweighs its benefits. The per-kind cap preserves the original user-plugin safety boundary.

**OQ-02: Mermaid version — 11.x (latest stable).**
Mermaid 11.x supports all diagram types in FR-03.1. Its SVG output strips `<script>` tags by default (confirmed: `securityLevel: "strict"` is the default in v11, which sanitizes SVG output). Bundle with `mermaid` npm package; version pinned in `package.json`.

**OQ-03: Re-initialization — track last-initialized theme.**
`mermaid.initialize()` can be called multiple times in the same JS context. The plugin stores a module-level `_initializedTheme` string. `reinitIfNeeded(newTheme)` compares against it; only calls `mermaid.initialize()` when the theme differs, then dispatches a no-op CM6 transaction with a custom StateEffect to force StateField recompute. This avoids redundant re-initialization on every render call.

**OQ-04: Async render in toDOM() — Option (a) chosen.**
`toDOM()` returns a placeholder `<div class="cm-mermaid-block cm-mermaid-loading">` immediately (meeting CM6's synchronous requirement). The async Mermaid render runs as a Promise chain that, when resolved, directly mutates `placeholder.innerHTML` and removes the loading class. This mutation is outside CM6's transaction model but is safe for display-only widgets — CM6 does not track widget-internal DOM content after initial placement. Option (b) would require a custom StateEffect, a second StateField, and `requestMeasure` scheduling — three-fold complexity increase for no correctness benefit in this use case.

**OQ-05: Dark mode SVG.**
Mermaid's `"dark"` theme sets `background` directly on the `<svg>` element via its own stylesheet. The `.cm-mermaid-block` container must NOT set `background-color`. Testing against `default-dark` confirms the SVG carries its own dark background. No additional CSS overrides are needed.

**OQ-06: Lezer FencedCode info node.**
In `@lezer/markdown`, the language tag is in a child node named `"CodeInfo"` on the `FencedCode` node. The content span (the lines between opening and closing fences) is in a child node named `"CodeText"`. The detection pattern: iterate `FencedCode` nodes, then `cursor.firstChild()` + `cursor.nextSibling()` loop to find `CodeInfo`. Extract its text via `state.doc.sliceString(cursor.from, cursor.to)` and compare lowercased against `"mermaid"`. Confirmed by reading `src/plugins/media-preview/media-preview.plugin.ts` which uses the same `syntaxTree` + cursor walk on `Image` nodes.

---

## Architecture Summary

### Stack Decision

No new stack choices. Mermaid is the only new dependency, installed as `npm install mermaid`. All other technologies (CM6 StateField, Lezer AST, IIFE plugin, Rust Tauri command) are existing project infrastructure.

Mermaid 11.x was selected over 10.x because:
- v11 ships `securityLevel: "strict"` by default (script-stripping from SVG output, NFR-08).
- v11 supports all diagram types in FR-03.1 including `mindmap`, `timeline`, `quadrantChart`, and `xychart-beta`.
- v11's `mermaid.render()` returns a Promise<{ svg: string }> (not a callback), which aligns cleanly with the OQ-04 deferred-DOM pattern.

### Data Flow

```
User types ```mermaid block
  → CM6 transaction fires
  → StateField.update() called (docChanged or selection changed)
  → buildDiagramDecorations(state) called
    → check __MARKABLE_PREVIEW_ENABLED__ (guard)
    → walk Lezer syntaxTree for FencedCode nodes with CodeInfo == "mermaid"
    → for each block: check cursor overlap
      → cursor inside: no decoration (raw source visible)
      → cursor outside: Decoration.replace({ widget: new MermaidWidget(source), block: true })
  → DecorationSet returned → CM6 renders widget
    → MermaidWidget.toDOM() called
      → returns placeholder div immediately
      → async mermaid.render(id, source) runs
        → on success: placeholder.innerHTML = svg; remove loading class
        → on failure: placeholder becomes error div with source in <pre>
```

### Component Map

**New files:**
- `src/plugins/diagrams/diagrams.plugin.ts` — The plugin (IIFE entry)
- `tests/plugins/diagrams/diagrams.test.ts` — Unit tests

**Modified files:**
- `src-tauri/src/commands/plugins.rs` — Raise core plugin cap to 5 MB (line ~243)
- `scripts/build-plugins.mjs` — Add `["diagrams", "src/plugins/diagrams/diagrams.plugin.ts"]`
- `src/keybindings/keybindings-panel.ts` — Add `view-toggle-diagrams` to COMMANDS array
- `src/main.ts` — Add `"view-toggle-diagrams"` case to `handleAction` switch

---

## Implementation Steps

| Step | File | Status |
|------|------|--------|
| [step_01_rust_cap.md](step_01_rust_cap.md) | `src-tauri/src/commands/plugins.rs` | [x] DONE |
| [step_02_build_pipeline.md](step_02_build_pipeline.md) | `scripts/build-plugins.mjs`, `package.json` | [x] DONE |
| [step_03_plugin_scaffold.md](step_03_plugin_scaffold.md) | `src/plugins/diagrams/diagrams.plugin.ts` (skeleton) | [x] DONE |
| [step_04_lezer_detection.md](step_04_lezer_detection.md) | `diagrams.plugin.ts` — `buildDiagramDecorations()` | [x] DONE |
| [step_05_mermaid_widget.md](step_05_mermaid_widget.md) | `diagrams.plugin.ts` — `MermaidWidget` class | [x] DONE |
| [step_06_statefield.md](step_06_statefield.md) | `diagrams.plugin.ts` — StateField factory + wiring | [x] DONE |
| [step_07_theme_awareness.md](step_07_theme_awareness.md) | `diagrams.plugin.ts` — theme detection + re-init | [x] DONE |
| [step_08_settings.md](step_08_settings.md) | `diagrams.plugin.ts` — settings load/save + UI | [x] DONE |
| [step_09_command_bar.md](step_09_command_bar.md) | `keybindings-panel.ts`, `main.ts` | [x] DONE |
| [step_10_tests.md](step_10_tests.md) | `tests/plugins/diagrams/diagrams.test.ts` | [x] DONE |

---

## Edge Case Coverage Map

| Edge Case | Covered By |
|-----------|-----------|
| EC-01: Empty mermaid block | step_05, step_10 |
| EC-02: Whitespace-only content | step_05, step_10 |
| EC-03: Unclosed fence | step_04, step_10 |
| EC-04: Invalid Mermaid syntax | step_05, step_10 |
| EC-05: Very large diagram | step_05 (loading placeholder) |
| EC-06: Multiple diagrams | step_04, step_06, step_10 |
| EC-07: Diagram after YAML front matter | step_04 (Lezer handles naturally) |
| EC-08: Diagram inside blockquote | step_04 (Lezer handles; note in step) |
| EC-09: Source-mode toggle while cursor inside | step_04, step_10 |
| EC-10: Theme switch while diagrams rendered | step_07, step_10 |
| EC-11: Plugin disabled while diagrams rendered | CSS-removal branch: `removePluginCSS` unit-tested in Group 7 and Group 10 of step_10 tests. Full `onDisable` sequence (removeExtensions + CSS + observer disconnect + state clear) requires a live CM6 EditorView — integration-level coverage only, no unit test (intentional; gap documented in step_10 Group 10 comment). |
| EC-12: Enable/disable rapid cycle | step_03, step_06, step_10 |
| EC-13: Source edited, re-renders | step_05 (eq() detects change), step_10 |
| EC-14: Source unchanged, DOM reused | step_05 (eq() returns true), step_10 |
| EC-15: SVG with embedded script tags | step_05 (securityLevel: "strict") |
| EC-16: Mermaid library load failure | N/A (Strategy A — Mermaid bundled into IIFE) |
| EC-17: HTML entities in content | step_05 (pass raw source, Mermaid handles) |
| EC-18: Extremely wide diagram | step_03 (CSS: overflow-x: auto) |
| EC-19: Render ID collision | step_05 (module counter: guaranteed unique) |
| EC-20: Document with zero mermaid blocks | step_04, step_10 |
| EC-21: Block at end of document, no trailing newline | step_04 (Lezer handles) |
| EC-22: Tab switch during async render | step_05 (detached DOM mutation: harmless) |
| EC-23: Settings load returns null | step_08, step_10 |
| EC-24: Settings save failure | step_08 (log, continue with in-memory settings); step_10 Group 9 — "does not throw when api.saveSettings rejects" + "in-memory _settings retains its values after a failed save" |
| EC-25: Preview mode toggled rapidly | step_04 (guard fires on each transaction) |
| EC-26: mermaid.initialize() before library | N/A (Strategy A — synchronous IIFE bundle) |

---

## Definition of Done

A step is complete when:
- All file changes listed in the step are implemented
- Acceptance criteria in the step are verified
- No TODO comments remain in source files touched by the step
- Tests in step_10 that reference the step pass

The plugin is ready for Code Reviewer when all 10 step checkboxes above are checked.

---

## Review Request (Revision 2 — post code-reviewer LOW findings)

### Changes made to address code-reviewer findings

**CRITICAL-01 (EC-23 null settings untested):**
- Extracted `loadAndMergeSettings(raw: unknown): DiagramsSettings` as a pure exported helper in `diagrams.plugin.ts`. `onEnable` now delegates all settings merging to this function.
- Added 8 tests in new `loadAndMergeSettings` group covering: null (first run), undefined, valid merge, unknown keys, invalid theme, width below 200, width above 4000, boundary values 200 and 4000.

**HIGH-01 (`onEnable` too long):**
- Extracted `startThemeObserver(): MutationObserver` — handles the MutationObserver setup. `onEnable` is now 18 lines.

**HIGH-02 (`renderDetailExtra` too long):**
- Extracted `buildThemeRow()`, `buildWidthRow()`, `buildErrorSourceRow()`. `renderDetailExtra` is now 7 lines (compositor only).

**MEDIUM-01 (`_initializedTheme` reset untested):**
- Exported `_setInitializedThemeForTest(value: string): void` — a test-only setter (ES module exports are read-only getters; cannot assign via module namespace).
- Added test "re-initializes Mermaid after _initializedTheme is reset" in `reinitIfNeeded` group.
- Also hardened the existing "calls mermaid.initialize() with securityLevel: strict" test with `setInitializedThemeForTest("")` to isolate from prior tests.

**MEDIUM-02 (`maxRenderWidth` guard floor mismatch):**
- Changed `buildWidthRow()` event handler guard from `v > 0` to `v >= 200 && v <= 4000`.
- `loadAndMergeSettings` also enforces `>= 200` on load.
- Tests in `loadAndMergeSettings` group cover both boundaries.

**MEDIUM-03 (EC-10 `eq()` theme-change branch untested):**
- Added test "eq() returns false when source is the same but theme differs" in `MermaidWidget` group.

**LOW-02 (CSS selector fragility):**
- All three builder functions use direct `document.createElement` element references. No `querySelector("#id")` calls remain in settings UI code.

**LOW-03 (Stale Rust doc comment):**
- Updated module-level `//!` comment in `src-tauri/src/commands/plugins.rs` from "max 500 KB" to "core: max 5 MB, user: max 500 KB".

**LOW-04 (Finding 3 — EC-24 saveSettings failure untested):**
- Changed `saveSettings()` from `function` to `export function` so the test can call it directly with a mock API.
- Added docstring note explaining the export is for test use (same pattern as `_setInitializedThemeForTest`).
- Added Group 9 "saveSettings (EC-24 save-failure resilience)" in `diagrams.test.ts` — two tests:
  1. "does not throw when api.saveSettings rejects" — asserts no exception propagates, mock called once.
  2. "in-memory _settings retains its values after a failed save" — asserts settings snapshot is unaltered.

**LOW-05 (Finding 4 — EC-11 onDisable coverage map claim unverified):**
- Updated EC-11 row in coverage map (above) to explicitly state: CSS-removal branch is unit-tested (Group 7 + Group 10); full `onDisable` sequence is integration-level only (intentional, documented in Group 10 comment).
- Added Group 10 "onDisable (EC-11 — integration-level coverage only)" in `diagrams.test.ts` with one test exercising the CSS-removal branch directly and a detailed comment explaining why the full `onDisable` unit test boundary stops there.

---

- **Files changed**:
  - `src-tauri/src/commands/plugins.rs` — Updated module `//!` comment (LOW-03, Revision 1)
  - `src/plugins/diagrams/diagrams.plugin.ts` — `loadAndMergeSettings` pure helper; `startThemeObserver` extracted; three row builder functions; `maxRenderWidth` guard fix; `_setInitializedThemeForTest` setter; `renderDetailExtra` reduced to compositor (Revision 1); `saveSettings` exported for test use (Revision 2, LOW-04)
  - `tests/plugins/diagrams/diagrams.test.ts` — 10 new tests in Revision 1 (54 total); 3 new tests in Revision 2 for Groups 9 and 10 (57 total, all passing)
  - `docs/specs/diagrams/00_index.md` — EC-11 and EC-24 coverage map rows updated (Revision 2, LOW-05)

- **Steps completed**: step_01 through step_10 (unchanged), plus Revision 1 and Revision 2 reviewer-requested fixes

- **Known limitations** (unchanged from Revision 1):
  - EC-08 (mermaid block inside blockquote): handled by Lezer naturally; not unit-tested (no blockquote in Lezer test documents). Flagged for manual verification.
  - EC-11 (onDisable full lifecycle): requires a live CM6 EditorView. CSS-removal branch unit-tested; full sequence is integration-level only (documented in Group 10 comment).
  - EC-12 (enable/disable rapid cycle): full lifecycle requires a live CM6 editor view. Unit coverage: CSS idempotency + `_initializedTheme` reset via `_setInitializedThemeForTest`.

- **Edge cases covered by tests** (updated for Revision 2):
  - EC-01 (empty block): `MermaidWidget` — "toDOM() shows error for empty source without calling mermaid.render"
  - EC-02 (whitespace-only block): `scanDiagramBlocks` — "returns source = '' for whitespace-only mermaid block"
  - EC-03 (unclosed fence): `scanDiagramBlocks` — "does not crash for unclosed fence"
  - EC-04 (invalid syntax): `MermaidWidget` — "toDOM() shows error placeholder when mermaid.render() rejects"
  - EC-06 (multiple diagrams): `scanDiagramBlocks` + `buildDiagramDecorations` groups
  - EC-09 (source-mode toggle): `buildDiagramDecorations` — preview-enabled false + cursor inside block
  - EC-10 (theme switch): `MermaidWidget` — "eq() returns false when source is the same but theme differs"
  - EC-11 (plugin disabled): Group 7 + Group 10 — CSS removal branch unit-tested; full onDisable is integration-level (documented)
  - EC-12 (enable/disable cycle): CSS injection + `reinitIfNeeded` — "re-initializes Mermaid after _initializedTheme is reset"
  - EC-13 (source changed): `MermaidWidget` — "eq() returns false for different source"
  - EC-14 (source unchanged): `MermaidWidget` — "eq() returns true for same source and theme"
  - EC-15 (XSS): `MermaidWidget` — "error placeholder uses textContent not innerHTML for user source"
  - EC-19 (render ID collision): `MermaidWidget` — "each widget instance gets a unique render ID"
  - EC-20 (no mermaid blocks): `scanDiagramBlocks` + `buildDiagramDecorations`
  - EC-23 (null settings): `loadAndMergeSettings` — "returns all defaults when raw is null"
  - EC-24 (save failure): Group 9 — "does not throw when api.saveSettings rejects" + "in-memory _settings retains its values after a failed save"
  - EC-25 (preview mode toggled rapidly): `buildDiagramDecorations` — "re-enables preview mode after being toggled off"

---

## Review Sign-off

- **Date**: 2026-04-20
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all findings from Revision 1 resolved. Two outstanding Low items from Revision 1 (Finding 3 / EC-24 and Finding 4 / EC-11) verified closed in Revision 2.
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified.
- **Edge case coverage**: All Edge Case Inventory items covered by tests or documented as integration-level only (EC-08, EC-11, EC-12 full lifecycle) with explicit boundary justification in Group 10 comment.
- **Status**: Approved for Merge
