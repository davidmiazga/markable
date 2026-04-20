---
title: "Step 03 — Plugin Scaffold: skeleton file + CSS injection"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 03: Plugin Scaffold

**Requirement:** FR-10 (Plugin Lifecycle), AD-01 (IIFE plugin pattern), NFR-04 (CSS variables)
**Files created:** `src/plugins/diagrams/diagrams.plugin.ts`

---

## Goal

Create the `src/plugins/diagrams/` directory and the plugin source file with:
- File-level boilerplate comment matching the math and media-preview plugins
- CM6 globals destructure at IIFE evaluation time
- Plugin CSS injection (idempotent, removable)
- Plugin metadata (`id`, `name`, `version`, `description`, `detail`)
- `onEnable` and `onDisable` stubs (no logic yet — added in subsequent steps)
- The `export default` UnifiedPlugin object

After this step the plugin builds (`npm run build:plugins` produces `diagrams.js`) but does nothing when enabled.

---

## Files to Create

- `src/plugins/diagrams/` (directory)
- `src/plugins/diagrams/diagrams.plugin.ts` (plugin source)

---

## Implementation Instructions

Create the file `src/plugins/diagrams/diagrams.plugin.ts` with the following exact content. Subsequent steps will add to this file (detection, widget, StateField, etc.) — do not implement those yet.

```typescript
/**
 * Diagrams Plugin — IIFE entry point (FC2 #9).
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/diagrams.js
 *
 * Renders ```mermaid fenced code blocks as SVG diagrams using Mermaid.js.
 * Implements the Typora-style live preview contract: raw Mermaid source is
 * hidden when the cursor is away from the block and shown when the cursor
 * enters it. Identical cursor-on-reveal contract to the Math plugin (FC2 #8).
 *
 * Architecture: docs/specs/diagrams/00_index.md
 *
 * IIFE self-containment rules:
 *   - Mermaid is bundled into the IIFE (not external). Strategy A (FR-09).
 *   - No app-internal module imports at runtime.
 *   - CM6 accessed via window globals only (__CM_VIEW__, __CM_STATE__, __CM_LANGUAGE__).
 *   - CSS injected via <style> tags in onEnable, removed in onDisable.
 *   - Plugin exports `export default` a UnifiedPlugin object.
 */

import mermaid from "mermaid";

// Type-only imports — erased at compile time, safe in IIFE context.
import type { DecorationSet, WidgetType as WidgetTypeClass } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── CM6 globals access ────────────────────────────────────────────────────────
//
// All @codemirror/* runtime values come from window globals set by cm-globals.ts.
// The destructure runs at IIFE evaluation time. By contract, cm-globals.ts has
// already executed before any plugin IIFE is evaluated (plugin loader ordering).

/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  WidgetType,
  Decoration,
  EditorView: _EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");

const {
  StateField,
  StateEffect,
  RangeSetBuilder,
} = (window as any).__CM_STATE__ as typeof import("@codemirror/state");

const {
  syntaxTree,
} = (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Plugin settings type ──────────────────────────────────────────────────────

interface DiagramsSettings {
  /** Mermaid theme override. "auto" uses dark/light detection from the active app theme. */
  mermaidTheme: "auto" | "dark" | "default" | "neutral" | "forest";
  /** Maximum SVG container width in pixels. Wide diagrams scroll horizontally. */
  maxRenderWidth: number;
  /** When true, error placeholder shows the raw Mermaid source in a <pre> block. */
  showErrorSource: boolean;
}

const DEFAULT_SETTINGS: DiagramsSettings = {
  mermaidTheme: "auto",
  maxRenderWidth: 900,
  showErrorSource: true,
};

// ── Module-level state ────────────────────────────────────────────────────────

/** Currently loaded settings. Populated in onEnable. */
let _settings: DiagramsSettings = { ...DEFAULT_SETTINGS };

/** The active StateField instance. Null between enable cycles. */
let _diagramsField: ReturnType<typeof StateField.define> | null = null;

/** Theme-change MutationObserver. Null when plugin is disabled. */
let _themeObserver: MutationObserver | null = null;

/** Tracks the last Mermaid theme passed to mermaid.initialize(). Empty string = never initialized. */
let _initializedTheme = "";

/** Module-level counter for generating unique Mermaid render IDs. Incremented per widget instance. */
let _renderCounter = 0;

// ── CSS injection helpers ─────────────────────────────────────────────────────

const PLUGIN_CSS_ELEMENT_ID = "__markable_diagrams_plugin_css__";

/**
 * Inject plugin CSS into document <head>.
 * Idempotent — guarded by element id (EC-12).
 *
 * CSS design notes:
 *   - .cm-mermaid-block: display block, horizontally scrollable, horizontally centered.
 *   - No background-color on .cm-mermaid-block — Mermaid's SVG sets its own background (OQ-05).
 *   - .cm-mermaid-loading: shows a subtle loading indicator while async render completes (NFR-01).
 *   - .cm-mermaid-error: error placeholder, theme-compatible via CSS variable (FR-05.2).
 */
export function injectPluginCSS(): void {
  if (document.getElementById(PLUGIN_CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = PLUGIN_CSS_ELEMENT_ID;
  style.textContent = `
/* ── Diagrams Plugin CSS ──────────────────────────────────────────────────── */

/* SVG container — block-level, horizontally centered, scrollable for wide diagrams */
.cm-mermaid-block {
  display: block;
  max-width: var(--mermaid-max-width, 900px);
  margin: 0.75em auto;
  overflow-x: auto;
  /* No background-color: Mermaid's SVG sets its own via its theme (OQ-05) */
}

/* SVG element itself — constrain width, allow natural height */
.cm-mermaid-block svg {
  display: block;
  max-width: 100%;
  height: auto;
}

/* Loading placeholder — shown while async render completes (NFR-01) */
.cm-mermaid-loading::before {
  content: "Rendering diagram…";
  display: block;
  padding: 0.5em 1em;
  color: var(--mermaid-loading-color, rgba(128, 128, 128, 0.6));
  font-style: italic;
  font-size: 0.85em;
}

/* Error placeholder — theme-compatible via CSS variable (FR-05.2) */
.cm-mermaid-error {
  display: block;
  padding: 0.5em 1em;
  border: 1px dashed var(--mermaid-error-color, #c0392b);
  border-radius: 4px;
  color: var(--mermaid-error-color, #c0392b);
  cursor: help; /* Signals actionable info on hover (FR-05.3) */
  margin: 0.5em 0;
}

.cm-mermaid-error-label {
  font-weight: 600;
  font-size: 0.9em;
}

.cm-mermaid-error pre {
  margin: 0.4em 0 0;
  font-size: 0.8em;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 0.8;
}
`;
  document.head.appendChild(style);
}

/**
 * Remove the injected plugin CSS style tag.
 * Called from onDisable. Safe when tag does not exist.
 */
export function removePluginCSS(): void {
  document.getElementById(PLUGIN_CSS_ELEMENT_ID)?.remove();
}

// ── Stubs (filled in subsequent steps) ───────────────────────────────────────

// buildDiagramDecorations() — added in step_04
// MermaidWidget class — added in step_05
// createDiagramsField() factory — added in step_06
// resolveMermaidTheme() + reinitIfNeeded() — added in step_07
// renderDetailExtra settings UI — added in step_08

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // Step 08 will load settings here.
  _settings = { ...DEFAULT_SETTINGS };

  // Step 07 will initialize Mermaid here.

  injectPluginCSS();

  // Step 06 will create and register the StateField here.

  // Step 07 will register the theme-change observer here.
}

function onDisable(api: MarkablePluginAPI): void {
  api.removeExtensions();
  removePluginCSS();

  // Step 07 will disconnect the MutationObserver here.
  if (_themeObserver) {
    _themeObserver.disconnect();
    _themeObserver = null;
  }

  _diagramsField = null;
  _initializedTheme = "";
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export default {
  id: "diagrams",
  name: "Diagrams",
  version: "1.0.0",
  description: "Render Mermaid diagrams in live preview mode",
  detail:
    "Renders ```mermaid fenced code blocks as SVG diagrams in live preview mode. " +
    "Supports flowcharts, sequence diagrams, Gantt charts, class diagrams, state diagrams, " +
    "ER diagrams, pie charts, mindmaps, timelines, and more. " +
    "Raw Mermaid source is shown when your cursor is inside the block; " +
    "the rendered SVG appears when your cursor moves away. " +
    "Diagram theme adapts automatically to the active Markable theme (dark/light).",
  onEnable,
  onDisable,
};
```

---

## Notes

- The `StateEffect` destructure is included now (needed in step_07 for the theme-change re-render trigger) — destructure all needed CM6 values upfront to avoid later edits to the globals block.
- The `_renderCounter` module-level variable is declared here for step_05 (unique render IDs).
- The `_themeObserver` is declared here and the `onDisable` cleanup is written now so the cleanup is never forgotten.
- Do not use `async` on `onDisable` — the UnifiedPlugin interface allows `void | Promise<void>` but synchronous cleanup is simpler and there is no async work needed in disable.
- The `DiagramsSettings` interface and `DEFAULT_SETTINGS` are defined here so subsequent steps can reference them without needing to add new types.

---

## Acceptance Criteria

- [ ] `src/plugins/diagrams/diagrams.plugin.ts` exists
- [ ] `npm run build:plugins` completes with 12 plugins built (no TypeScript errors)
- [ ] `src-tauri/plugins/core/diagrams.js` is produced and is 2–5 MB in size
- [ ] The plugin can be enabled in the Plugins Panel without crashing (onEnable is a no-op stub)
- [ ] Enabling the plugin injects a `<style id="__markable_diagrams_plugin_css__">` tag
- [ ] Disabling the plugin removes that style tag
- [ ] No TODO comments in the created file

---

## Files Created in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/diagrams/diagrams.plugin.ts` | CREATE | IIFE plugin skeleton |
