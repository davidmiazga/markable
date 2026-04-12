# Step 02a — Vite IIFE Build Pipeline

**Chunk:** 2 — Base Plugin Build Pipeline
**Prerequisite:** Chunk 1 complete (step_01a + step_01b approved)
**Goal:** Compile each of the four existing TypeScript plugins into a self-contained IIFE `.js` file that the unified loader can evaluate via `new Function(source)()`. No existing TypeScript plugin code is deleted in this step.

---

## Overview

Each core plugin must ship as a standalone `.js` file inside the Tauri app bundle under `src-tauri/resources/plugins/core/`. Each file is evaluated by the loader as:

```javascript
const plugin = new Function(source)();
```

The IIFE must therefore:

1. End with a `return { id, name, ... }` statement so `new Function(source)()` yields the plugin object.
2. Bundle all `@codemirror/*` and other `npm` dependencies — no externals, no `import` statements in the output.
3. Inline any required CSS as DOM injection (the IIFE runs inside a Webview without a bundler).
4. Conform to the `UnifiedPlugin` interface from `src/plugins/markable-plugin-api.ts`.

The existing `index.ts` files are **not modified**. Each plugin gets a new sibling file (`focus-mode.plugin.ts`, etc.) that is the IIFE entry point.

---

## 1. New IIFE entry files

### 1a. Focus Mode — `src/plugins/focus-mode/focus-mode.plugin.ts`

This file is the Vite entry point. It imports CM6 extension logic from `focus-mode.ts` (the pure logic file — **no changes** to `focus-mode.ts`), inlines the CSS, and returns a `UnifiedPlugin` object.

```typescript
// src/plugins/focus-mode/focus-mode.plugin.ts
//
// IIFE entry point for the Focus Mode core plugin.
// Compiled by vite.plugins.config.ts to src-tauri/resources/plugins/core/focus-mode.js
// Evaluated at runtime via: new Function(source)()
//
// NOTE: Do NOT import from "../plugin-types" or "../../lib/bridge" here —
// those are app-internal TypeScript modules that are not available at runtime
// inside the IIFE sandbox. The only imports allowed are:
//   - Relative imports within this plugin's own directory (pure logic files)
//   - @codemirror/* packages (bundled by Vite)

import {
  StateField,
  StateEffect,
  type Extension,
  type EditorState,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Inline CSS (replaces the focus-mode.css import which cannot be evaluated
//    inside the IIFE sandbox at runtime) ───────────────────────────────────────

function injectCSS(): void {
  const id = "__markable_focus_mode_css__";
  if (document.getElementById(id)) return; // idempotent
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `.cm-focus-dimmed { opacity: 0.25; transition: opacity 0.15s ease; }`;
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById("__markable_focus_mode_css__")?.remove();
}

// ── CM6 extension (duplicated from focus-mode.ts to keep IIFE self-contained) ─

const setFocusMode = StateEffect.define<boolean>();

const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFocusMode)) return e.value;
    }
    return value;
  },
});

function findParagraphRange(
  state: EditorState,
  pos: number,
): { from: number; to: number } {
  const doc = state.doc;
  const curLine = doc.lineAt(pos);
  let startLine = curLine.number;
  while (startLine > 1) {
    const prev = doc.line(startLine - 1);
    if (prev.text.trim() === "") break;
    startLine--;
  }
  let endLine = curLine.number;
  const totalLines = doc.lines;
  while (endLine < totalLines) {
    const next = doc.line(endLine + 1);
    if (next.text.trim() === "") break;
    endLine++;
  }
  return {
    from: doc.line(startLine).from,
    to: doc.line(endLine).to,
  };
}

const dimmedLine = Decoration.line({ class: "cm-focus-dimmed" });

const focusModeViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.startState.field(focusModeField) !==
          update.state.field(focusModeField)
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    buildDecorations(view: EditorView): DecorationSet {
      const enabled = view.state.field(focusModeField);
      if (!enabled) return Decoration.none;
      const head = view.state.selection.main.head;
      const { from: paraFrom, to: paraTo } = findParagraphRange(view.state, head);
      const builder: { from: number; value: Decoration }[] = [];
      const doc = view.state.doc;
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (line.from >= paraFrom && line.to <= paraTo) continue;
        builder.push({ from: line.from, value: dimmedLine });
      }
      return Decoration.set(builder.map((d) => d.value.range(d.from)));
    }
  },
  { decorations: (v) => v.decorations },
);

const focusModeExtension: Extension = [focusModeField, focusModeViewPlugin];

// ── Plugin object ─────────────────────────────────────────────────────────────

export default {
  id: "focus-mode",
  name: "Focus Mode",
  version: "1.0.0",
  description: "Dim all content except the current paragraph",
  detail:
    "Dims all lines except the paragraph containing your cursor, helping you focus on what you're writing. The active paragraph stays at full opacity while everything else fades. Works at the paragraph/block level — code fences and list items are treated as single blocks.",

  onEnable(api: MarkablePluginAPI): void {
    injectCSS();
    api.addExtensions([focusModeExtension]);
    // Find the live EditorView and dispatch the enable effect.
    // The IIFE has no direct EditorView reference; the effect is dispatched
    // by reaching through the compartment dispatch in PluginManager.addExtensions.
    // The StateEffect below is dispatched separately via a synthetic view access.
    // IMPORTANT: The StateField defaults to false. addExtensions re-registers
    // the field in the compartment. After compartment reconfigure, dispatch the
    // enable effect via the EditorView stored on the PluginManager — in Chunk 4,
    // the loader will pass the view reference through the API. For Chunk 2 only
    // (static path unchanged), this IIFE output is never executed at runtime;
    // it is only compiled to verify the build pipeline is correct.
    //
    // The dispatch-after-addExtensions pattern for StateEffect will be specified
    // in step_04a when the full PluginManager is rewritten. This file is
    // pre-wired for that: api.addExtensions registers the extension; the
    // StateField defaults to `false` (dim nothing) until the effect fires.
    // For a complete enable, the loader must dispatch setFocusMode.of(true)
    // through the view after addExtensions. That dispatch site lives in
    // PluginManager._enablePlugin (step_04a). The IIFE itself does not hold
    // the EditorView.
  },

  onDisable(api: MarkablePluginAPI): void {
    api.removeExtensions();
    removeCSS();
  },
};
```

**Self-containment rationale:** The CM6 extension logic is duplicated from `focus-mode.ts` rather than imported, because `focus-mode.ts` imports from `@codemirror/state` and `@codemirror/view` using ES module syntax. Vite will bundle those correctly. However the `focus-mode.ts` file also imports a `.css` file which Vite handles as a virtual module — that pattern does not survive the IIFE sandbox at runtime. The `.plugin.ts` file therefore re-implements the logic inline and injects CSS via a `<style>` tag. The source-of-truth extension logic in `focus-mode.ts` is **unchanged**.

### 1b. Typewriter Mode — `src/plugins/typewriter-mode/typewriter-mode.plugin.ts`

Same pattern. No CSS to inject (typewriter mode uses inline padding only).

```typescript
// src/plugins/typewriter-mode/typewriter-mode.plugin.ts

import {
  StateField,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

const setTypewriterMode = StateEffect.define<boolean>();

const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTypewriterMode)) return e.value;
    }
    return value;
  },
});

function updatePadding(view: EditorView, enabled: boolean): void {
  const content = view.contentDOM;
  if (enabled) {
    const halfHeight = Math.round(view.dom.clientHeight / 2);
    content.style.paddingTop = `${halfHeight}px`;
    content.style.paddingBottom = `${halfHeight}px`;
  } else {
    content.style.paddingTop = "";
    content.style.paddingBottom = "";
  }
}

const typewriterUpdateListener = EditorView.updateListener.of(
  (update: ViewUpdate) => {
    const enabled = update.state.field(typewriterModeField);
    const wasEnabled = update.startState.field(typewriterModeField);
    if (enabled !== wasEnabled) {
      updatePadding(update.view, enabled);
    }
    if (!enabled) return;
    const modeToggled = enabled !== wasEnabled;
    if (!update.docChanged && !update.selectionSet && !modeToggled) return;
    const head = update.state.selection.main.head;
    update.view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
  },
);

const resizePlugin = ViewPlugin.define((view) => {
  const observer = new ResizeObserver(() => {
    const enabled = view.state.field(typewriterModeField);
    if (enabled) updatePadding(view, true);
  });
  observer.observe(view.dom);
  return { destroy() { observer.disconnect(); } };
});

const typewriterModeExtension: Extension = [
  typewriterModeField,
  typewriterUpdateListener,
  resizePlugin,
];

export default {
  id: "typewriter-mode",
  name: "Typewriter Mode",
  version: "1.0.0",
  description: "Keep the cursor line vertically centered",
  detail:
    "Keeps the line you're typing on vertically centered in the viewport, like a typewriter. Allows blank space above and below at document edges so the cursor is always in the middle of the screen. Can be combined with Focus Mode.",

  onEnable(api: MarkablePluginAPI): void {
    api.addExtensions([typewriterModeExtension]);
    // StateEffect dispatch for setTypewriterMode.of(true) is handled by
    // PluginManager._enablePlugin in step_04a (same rationale as focus-mode).
  },

  onDisable(api: MarkablePluginAPI): void {
    api.removeExtensions();
  },
};
```

### 1c. Word Count — `src/plugins/word-count/word-count.plugin.ts`

Word Count has no CM6 extensions. It writes to a status bar DOM element.

The existing implementation's `scheduleUpdate` function is called from `main.ts`'s CM6 `updateListener` — that call site uses the static TypeScript import and is NOT in scope for this step. For the IIFE version, the plugin must register its own CM6 `updateListener` via `api.addExtensions` so it is self-contained. This is a behavior addition in the IIFE vs the static path; it is acceptable because the static path continues to run until Chunk 4.

```typescript
// src/plugins/word-count/word-count.plugin.ts

import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

const DEBOUNCE_MS = 150;

let _targetEl: HTMLElement | null = null;
let _enabled = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function updateDisplay(docText: string, selFrom: number, selTo: number): void {
  if (!_targetEl || !_enabled) return;
  const totalWords = countWords(docText);
  const totalChars = docText.length;
  if (selFrom !== selTo) {
    const selText = docText.slice(selFrom, selTo);
    _targetEl.textContent = `${countWords(selText)} / ${totalWords} words    ${selText.length} / ${totalChars} chars`;
  } else {
    _targetEl.textContent = `${totalWords} words    ${totalChars} chars`;
  }
}

const wordCountListener = EditorView.updateListener.of((update: ViewUpdate) => {
  if (!_enabled) return;
  if (!update.docChanged && !update.selectionSet) return;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const docText = update.state.doc.toString();
  const sel = update.state.selection.main;
  _debounceTimer = setTimeout(
    () => updateDisplay(docText, sel.from, sel.to),
    DEBOUNCE_MS,
  );
});

export default {
  id: "word-count",
  name: "Word Count",
  version: "1.0.0",
  description: "Word and character count in the status bar",
  detail:
    "Displays a live word count and character count in the status bar. Updates as you type. Shows selection count when text is selected.",

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;
    _targetEl = api.statusBar.center;
    api.ensureStatusBar();
    api.addExtensions([wordCountListener]);
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;
    if (_targetEl) _targetEl.textContent = "";
    _targetEl = null;
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    api.removeExtensions();
    api.hideStatusBarIfUnused();
  },
};
```

**Key difference from static path:** The static `word-count.ts` receives `scheduleUpdate` calls from `main.ts`'s `updateListener`. The IIFE version registers its own `EditorView.updateListener` via `api.addExtensions`. Both approaches are correct; after Chunk 4 the static call site in `main.ts` is removed.

### 1d. Status Bar — `src/plugins/status-bar/status-bar.plugin.ts`

Status Bar has no CM6 extensions and no `updateSettings` call (in the IIFE context, `updateSettings` is an app-internal module — unavailable in the sandbox). Plugin enable state is persisted by the new unified PluginManager (step_04a), not by the plugin itself.

```typescript
// src/plugins/status-bar/status-bar.plugin.ts

import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Inline CSS (replaces status-bar.css import) ───────────────────────────────

function injectCSS(): void {
  const id = "__markable_status_bar_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  // Minimal status-bar rules needed for the plugin to function.
  // The full theme-aware CSS lives in the main app bundle (status-bar.css).
  // This injection is a safety net for when the IIFE runs before the app CSS loads.
  style.textContent = `
    #statusbar { display: flex; align-items: center; height: 24px; }
    #statusbar.hidden { display: none; }
    .statusbar-left, .statusbar-center, .statusbar-right { flex: 1; }
    .statusbar-center { text-align: center; }
    .statusbar-right { text-align: right; }
  `;
  document.head.appendChild(style);
}

export default {
  id: "status-bar",
  name: "Status Bar",
  version: "1.0.0",
  description: "Show a status bar at the bottom of the editor",
  detail:
    "Adds a status bar at the bottom of the editor window. Other plugins (like Word Count) display their information here. The bar is hidden when no plugins use it.",

  onEnable(api: MarkablePluginAPI): void {
    injectCSS();
    api.ensureStatusBar();
  },

  onDisable(api: MarkablePluginAPI): void {
    api.hideStatusBarIfUnused();
  },
};
```

**Note on `handlesOwnPersistence`:** The old static `StatusBarPlugin` set `handlesOwnPersistence: true` to prevent the PluginManager from writing `{ statusBar: true }` (a boolean) over the structured `{ statusBar: { visible: true } }` object. The IIFE version does not have this problem because the new unified PluginManager (step_04a) persists state under `plugins["status-bar"].enabled: boolean`, never under the old `statusBar` key.

---

## 2. Vite plugin build config — `vite.plugins.config.ts`

Create at project root alongside the existing `vite.config.ts`. This is a completely separate build invocation.

```typescript
// vite.plugins.config.ts
//
// Builds the four core plugins as self-contained IIFE bundles.
// Each output is evaluated at runtime via: new Function(source)()
// Output dir: src-tauri/resources/plugins/core/
//
// Run with: npm run build:plugins
// Or as part of: npm run tauri build (via beforeBuildCommand — see package.json)

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    // Output next to the Tauri resources so `tauri build` picks them up.
    outDir: "src-tauri/resources/plugins/core",
    // Do not clear the whole resources/ dir — only the core/ subdir is ours.
    emptyOutDir: true,
    // No sourcemaps in plugin bundles (they are evaluated via new Function).
    sourcemap: false,
    lib: {
      // Multiple entry points — one per plugin.
      entry: {
        "focus-mode":      resolve(__dirname, "src/plugins/focus-mode/focus-mode.plugin.ts"),
        "typewriter-mode": resolve(__dirname, "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"),
        "word-count":      resolve(__dirname, "src/plugins/word-count/word-count.plugin.ts"),
        "status-bar":      resolve(__dirname, "src/plugins/status-bar/status-bar.plugin.ts"),
      },
      // IIFE format so the file is self-executing.
      // `name` is intentionally omitted — the IIFE return value is what matters,
      // not a global variable name. The loader calls new Function(source)() and
      // captures the return value directly.
      formats: ["iife"],
    },
    rollupOptions: {
      // NO externals. Every @codemirror/* package must be bundled into the IIFE.
      // EC-31: if any import is accidentally externalized the build output will
      // contain a bare `require()` call that throws at eval time. Vite's IIFE
      // format with no externals prevents this.
      external: [],
      output: {
        // Rename the output files from the default Vite lib naming pattern
        // ("[name].[format].js") to plain "[name].js".
        entryFileNames: "[name].js",
        // No code splitting — each plugin is a single file.
        inlineDynamicImports: false,
        // Minify in production; skip for debug builds.
        // (Controlled by NODE_ENV; tauri build sets NODE_ENV=production.)
      },
    },
  },
});
```

**Critical constraint — IIFE return value format:**

Vite's `lib` mode with `format: "iife"` and `name` omitted does NOT automatically produce a `return` statement. By default Vite wraps the entry point as:

```javascript
(function() {
  // ...bundled code...
  // default export assigned to a temp variable but not returned
})();
```

This means `new Function(source)()` returns `undefined`. To make the return value work, the plugin entry file must be structured so Vite emits a return. The reliable technique is to configure a `name` for the IIFE and then extract the global rather than relying on the return value.

**Revised approach — use `name` + global extraction:**

Change the Vite config to use `name: "__markablePlugin__"` (same for all entries — the name is just the IIFE's internal global assignment, overwritten on each evaluation). The loader then reads `(new Function(source + '; return __markablePlugin__;'))()`. This is simpler and more robust than fighting Vite's output wrapping.

Updated `lib` section in `vite.plugins.config.ts`:

```typescript
    lib: {
      entry: {
        "focus-mode":      resolve(__dirname, "src/plugins/focus-mode/focus-mode.plugin.ts"),
        "typewriter-mode": resolve(__dirname, "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"),
        "word-count":      resolve(__dirname, "src/plugins/word-count/word-count.plugin.ts"),
        "status-bar":      resolve(__dirname, "src/plugins/status-bar/status-bar.plugin.ts"),
      },
      formats: ["iife"],
      // All four plugins share the same global name. The name is used internally
      // by Vite's IIFE wrapper: var __markablePlugin__ = (function() { ... })();
      // The loader reads this value by appending "; return __markablePlugin__;"
      // to the source before eval. Since each plugin file is evaluated in a fresh
      // Function scope, the shared name causes no collisions.
      name: "__markablePlugin__",
    },
```

**Loader usage pattern (for the developer implementing Chunk 4):**

```typescript
// In the plugin loader (step_04a):
const fn = new Function(source + "\nreturn __markablePlugin__;");
const plugin = fn();
// plugin is the UnifiedPlugin object
```

The trailing `\nreturn __markablePlugin__;` appended by the loader extracts the IIFE result from the named global.

---

## 3. `package.json` script addition

Add one new script. The existing scripts are unchanged.

```json
"build:plugins": "vite build --config vite.plugins.config.ts"
```

The `beforeBuildCommand` in `tauri.conf.json` currently runs `npm run build`. It does NOT automatically run `build:plugins`. The developer must run `npm run build:plugins` before `npm run tauri build` (or update `beforeBuildCommand` to chain them). The requirement for chaining is tracked as a note in `00_index.md` — it is resolved in step_02b's `tauri.conf.json` update.

**Recommended `beforeBuildCommand` for production** (make this change in `tauri.conf.json`):

```json
"beforeBuildCommand": "npm run build:plugins && npm run build"
```

This ensures core plugin `.js` files are always fresh before the Tauri bundler copies them into the app bundle.

---

## 4. `tauri.conf.json` resources entry

The `bundle.resources` array currently contains only `"help/*"`. Add the core plugins directory.

Current:
```json
"resources": ["help/*"]
```

Updated:
```json
"resources": ["help/*", "plugins/core/*"]
```

This tells Tauri to copy all files in `src-tauri/resources/plugins/core/` into the app bundle's `resources/plugins/core/` directory at build time. The `copy_core_plugins` Rust command (step_02b) then copies them to the user data directory on launch.

**Note on `src-tauri/resources/` directory:** This directory does not yet exist. The developer must create it:

```bash
mkdir -p src-tauri/resources/plugins/core
```

The four `.js` files in this directory are build outputs — they should be git-ignored. Add to `.gitignore`:

```
src-tauri/resources/plugins/core/*.js
```

---

## 5. TypeScript import guard in `.plugin.ts` files

The `.plugin.ts` files import `MarkablePluginAPI` as a `type`-only import:

```typescript
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

This import is erased by the TypeScript compiler and emits no runtime code. Vite bundles only the values that are actually used. Since `MarkablePluginAPI` is only a type, no code from `markable-plugin-api.ts` is included in the IIFE output.

**Verification:** After `npm run build:plugins`, inspect the four `.js` files:
- No `require(` or `import(` calls (all deps bundled).
- No references to `bridge`, `settings`, `main`, or any app-internal module.
- The string `__markablePlugin__` appears as a `var` declaration at the top level.
- File size for focus-mode.js and typewriter-mode.js: approximately 30–80 KB (CM6 bundled). Word-count.js and status-bar.js: approximately 1–5 KB.

---

## 6. EC coverage

| EC | How this step addresses it |
|----|---------------------------|
| EC-30 (build non-zero exit) | `vite build` exits non-zero on TypeScript errors or missing imports; CI catches this. |
| EC-31 (no externals) | `rollupOptions.external: []` — Rollup bundles everything. |
| EC-32 (IIFE self-contained) | No imports in output; CSS injected via `<style>` tag; no `require()`. |
| EC-33 (authoring convention) | The `.plugin.ts` pattern documents the convention for future plugin authors. |

---

## 7. Files created / modified summary

| Action | File |
|--------|------|
| CREATE | `src/plugins/focus-mode/focus-mode.plugin.ts` |
| CREATE | `src/plugins/typewriter-mode/typewriter-mode.plugin.ts` |
| CREATE | `src/plugins/word-count/word-count.plugin.ts` |
| CREATE | `src/plugins/status-bar/status-bar.plugin.ts` |
| CREATE | `vite.plugins.config.ts` |
| CREATE | `src-tauri/resources/plugins/core/` (empty directory) |
| MODIFY | `package.json` — add `build:plugins` script |
| MODIFY | `src-tauri/tauri.conf.json` — add `"plugins/core/*"` to `bundle.resources`; update `beforeBuildCommand` |
| MODIFY | `.gitignore` — ignore built `.js` files in `src-tauri/resources/plugins/core/` |

**No changes to:**
- `src/plugins/focus-mode/focus-mode.ts` (pure CM6 extension logic)
- `src/plugins/focus-mode/index.ts` (static plugin entry — still used by current PluginManager)
- Any other existing plugin `index.ts` or `*.ts` file
- `vite.config.ts`
- Any Rust file

---

## 8. Verification checklist

- [ ] `npm run build:plugins` exits 0.
- [ ] `src-tauri/resources/plugins/core/` contains exactly: `focus-mode.js`, `typewriter-mode.js`, `word-count.js`, `status-bar.js`.
- [ ] Each `.js` file contains `var __markablePlugin__` (or equivalent IIFE assignment).
- [ ] No `.js` file contains a bare `require(` call.
- [ ] `npm run build` still exits 0 (existing main build unaffected).
- [ ] `npm test` still exits 0 (no test changes in this step).
- [ ] `src-tauri/tauri.conf.json` diff shows `"plugins/core/*"` in resources and updated `beforeBuildCommand`.
