---
title: Layouts Feature — Master Blueprint
last-updated: "2026-05-06"
review-cadence-days: 14
status: active
---

# Layouts Feature — Master Blueprint

## Overview

The Layouts feature lets users render vault content as rich HTML using
Handlebars-style `.layout.md` template files stored inside the vault at
`VaultSettings/layouts/`. It is delivered in two parts:

- **Part A** — Custom Render Tab infrastructure: a new `"custom"` TabKind
  that lets any plugin display arbitrary HTML in the main content area,
  plus three new window globals for IIFE plugin access.
- **Part B** — Layout engine + `layouts` IIFE plugin: a Handlebars-style
  template engine, sidebar panel, keyboard picker, auto-render on file open,
  and two bundled starter layouts.

## Requirements source

`docs/requirements/active_task.md` (Layouts Feature, all FRs, NFRs, DCs, ECs,
and ACs).

---

## Stack Decision

No third-party template engine is introduced. The requirements lock the engine
to a purpose-built TypeScript implementation (DC-05). Using Handlebars or
Mustache as an npm dependency would:

1. Bundle the library into the IIFE (violating the "no second copy of major
   deps" principle established for `marked`).
2. Expose eval-based compilation that is harder to audit for script injection
   (NFR-02).

Decision: pure TypeScript recursive-descent tokenizer + evaluator inside the
plugin IIFE. All dependencies are either bundled (none needed at this size) or
accessed via the existing `window.__MARKABLE_*__` globals.

`marked` for Markdown-to-HTML is already in the main bundle and shared via
`window.__MARKABLE_RENDER_MD__` (FR-10, DC-03). No second copy is bundled.

---

## High-Level Architecture

### Data flow — single-file render

```
User clicks "Apply to current file"
  → layouts.plugin reads active file via __TAURI_INTERNALS__.invoke("read_file")
  → layout-engine.ts buildContext(file, vault, meta) → TemplateContext
  → layout-engine.ts render(templateSrc, ctx, depth=0) → HTML string
    ├── tokenize(src) → Token[]
    ├── evaluate(tokens, ctx, depth)
    │     ├── {{var}}   → escape(resolve(path, ctx))
    │     ├── {{{var}}} → resolve(path, ctx)
    │     ├── {{#if}}   → conditional block
    │     ├── {{#each}} → iteration (array or object)
    │     ├── {{#where}}→ filter then iterate
    │     ├── {{embed}} → invoke("read_file") + renderMD
    │     └── {{partial}}→ invoke("read_file") + render(depth+1)
    └── stripScripts(html) → sanitised HTML string
  → window.__MARKABLE_OPEN_CUSTOM_TAB__(title, (el) => {
      el.innerHTML = sanitised HTML
      wireDataPathListeners(el)
    })
  → TabManager.openCustomRenderTab()
      → clears #custom-tab-host
      → calls renderFn(hostEl)
      → adds body.has-custom-tab
```

### Data flow — global state

```
main.ts globals block (after tabManager.init()):
  window.__MARKABLE_OPEN_CUSTOM_TAB__   → tabManager.openCustomRenderTab
  window.__MARKABLE_RENDER_MD__         → marked.parse
  window.__MARKABLE_ACTION_EXTENSIONS__ → new Map<string, () => void>()

handleAction() default branch (after COMMANDS lookup):
  checks __MARKABLE_ACTION_EXTENSIONS__.has(action)
  → calls ext.get(action)()
```

---

## Component Map

### New files to create

| File | Description |
|---|---|
| `src/plugins/layouts/layouts.plugin.ts` | Full IIFE plugin (sidebar, picker, auto-render, first-run, onEnable/onDisable) |
| `src/plugins/layouts/layout-engine.ts` | Tokenizer, evaluator, context builder, filters, embed/partial (bundled inline by Rollup) |
| `tests/tabs/custom-tab.test.ts` | Unit tests for Part A (openCustomRenderTab, CSS class, session, dirty-check) |
| `tests/plugins/layouts/layout-engine.test.ts` | Unit tests for Part B engine (all token types, filters, edge cases) |

### Files to modify

| File | Change |
|---|---|
| `src/tabs/tab-types.ts` | Add `"custom"` to `TabKind`; add `renderFn?` to `TabEntry` |
| `src/tabs/tab-manager.ts` | Add `openCustomRenderTab()`; body class toggle; skip dirty-check for custom; exclude from session |
| `src/tabs/tabs.css` | Add `body.has-custom-tab` rules |
| `src/plugins/markable-plugin-api.ts` | Add `openCustomRenderTab()` to interface + factory |
| `src/main.ts` | Add three window globals; extend `handleAction()` default branch |
| `index.html` | Add `<div id="custom-tab-host">` sibling to `#media-viewer` |
| `src/plugins/index.ts` | Add `"layouts"` to `WORKFLOW_PLUGINS` |
| `scripts/build-plugins.mjs` | Add `["layouts", "src/plugins/layouts/layouts.plugin.ts"]` entry |

No Rust files change. All file I/O uses existing `read_file`, `write_file`,
`ensure_directory` Tauri commands.

---

## Implementation Phases

| Step | File | What it delivers |
|---|---|---|
| step_01 | Custom Render Tab infrastructure | tab-types, tab-manager, tabs.css, index.html, markable-plugin-api, main.ts globals |
| step_02 | Layout engine | `layout-engine.ts` — tokenizer, evaluator, context builder, filters, embed, partial |
| step_03 | Layouts plugin | `layouts.plugin.ts` — sidebar, picker, auto-render, first-run starters, build wiring |
| step_04 | Tests | `tests/tabs/custom-tab.test.ts` + `tests/plugins/layouts/layout-engine.test.ts` |

---

## Key Design Decisions

### D-01: `#custom-tab-host` placement

`#custom-tab-host` is added to `index.html` as a direct child of `#app`
(sibling to `#editor`, just as `#media-viewer` is a sibling to `.cm-editor`
inside `#editor`). The CSS class `has-custom-tab` is placed on `<body>`, which
lets rules target both `#editor` (to hide it) and `#custom-tab-host` (to show
it) from a single selector scope.

Rationale: `has-media-tab` is a class on `#editor` (not body) because
`#media-viewer` lives inside `#editor`. `#custom-tab-host` is a peer of
`#editor`, so the controlling class must live higher in the tree — `<body>`.

### D-02: `marked` exposure

`marked` is already imported in `src/editor/live-preview.ts`. The cleanest
approach is to also import `marked` in `src/main.ts` (it is already a
dependency; the import is deduplicated by the bundler). This avoids a
cross-module re-export that would introduce a non-obvious dependency path from
`main.ts` into `live-preview.ts` internals.

### D-03: `tabManager` import in `markable-plugin-api.ts`

`markable-plugin-api.ts` does not currently import `tabManager`. The safe
pattern used elsewhere (e.g. `pluginManager`) is to import the singleton from
`../tabs/tab-manager` inside the method body closure, not at the module root,
to avoid a circular dependency at evaluation time. The `openCustomRenderTab`
factory method in `buildMarkablePluginAPI` delegates to
`tabManager.openCustomRenderTab(title, renderFn)`.

### D-04: `layout-engine.ts` is a local TypeScript module

`layout-engine.ts` lives in `src/plugins/layouts/` alongside the plugin. Rollup
bundles it inline into the IIFE because it is a local relative import (no
`@codemirror/*` marker). This is the same pattern used for any multi-file plugin
that needs helpers without exposing them as shared modules.

### D-05: Template tokenizer strategy

A single-pass regex tokenizer is sufficient: the grammar has no ambiguous
productions and all block tags are identifiable from the opening `{{` and
closing `}}` delimiters. The tokenizer produces a flat `Token[]`; a recursive
evaluator handles nesting by consuming tokens until the matching closing tag.
This avoids the complexity of a full parse-tree for a grammar this small.

### D-06: Embed reads are parallel

Per NFR-01, `{{embed}}` calls within a template are collected in a first pass
and resolved in parallel via `Promise.all` before the second-pass string join.
Partials are resolved sequentially because their output participates in the
surrounding evaluation context; they do not share the same depth slot.

### D-07: `has-custom-tab` on `<body>` vs `#app-root`

The requirements say "body or #app-root — Architect to decide." The codebase
does not have an `#app-root` element (only `#app`), and the existing
`has-media-tab` pattern uses a class on `#editor`. Since `#custom-tab-host`
is a sibling of `#editor` (both children of `#app`), the controlling class
needs to be on `<body>` to address both targets in one rule. Consistent with
how `tab-mode-*` classes are managed by TabManager.

---

## Edge Cases Addressed by Architecture

All 28 edge cases from the requirements are covered. Highlights:

- **EC-15** (`renderFn` throws): `openCustomRenderTab` wraps `renderFn` in
  try/catch and writes a `<div class="layout-error">` fallback to the host.
- **EC-16** (tab closed during in-flight read): `layouts.plugin.ts` captures
  `_enabled` and a per-render `cancelled` flag at render start; async callbacks
  check both before touching the DOM.
- **EC-17** (`openCustomRenderTab` before `init()`): `_applyActiveTab` in
  TabManager already guards on `this.editorContainer !== null` (same as
  `openMediaInTab`). The custom tab is pushed to `this.tabs` and activated
  once the guard clears; no separate queue is needed because the same
  `_applyActiveTab()` call at the end of `init()` will pick it up.
- **EC-25** (`#custom-tab-host` missing): `openCustomRenderTab` reads
  `document.getElementById("custom-tab-host")` at call time (not stored in
  init), logs a console error, and returns without opening the tab.

---

## Deferred / Out of Scope

Items not addressed in this implementation phase (defer to future work):

- Live-reload of layout files when they change on disk (would require vault
  file-watcher extension; not in requirements).
- A layout authoring mode / preview-while-editing UX.
- Export of rendered layout to HTML file (save-as-HTML).
- Parametric layouts (inputs beyond `file` / `vault` / `meta` context).
- `{{#each}}` `@last` / `@first` / `@odd` / `@even` index helpers.

---

## Acceptance Criteria Coverage

All 29 ACs from `active_task.md` are addressed:

- AC-01 through AC-11: covered by step_01 (Custom Render Tab) + step_04 tests.
- AC-12 through AC-20: covered by step_02 (Layout Engine) + step_04 tests.
- AC-21 through AC-29: covered by step_03 (Layouts Plugin) + step_04 tests.

---

## Implementation Checklist

- [x] step_01 complete and tests green
- [x] step_02 complete and tests green
- [x] step_03 complete and `npm run build:plugins && npm run sync:plugins` passes
- [x] step_04 complete — `npm run test:run` passes with no regressions (3507 passed, 39 skipped)
- [x] All 29 ACs verified
- [ ] `docs/requirements/active_task.md` status updated to `reference`

---

## Review Request

- **Files changed**:
  - `src/tabs/tab-types.ts` — added `"custom"` to `TabKind`; added `renderFn?` to `TabEntry`
  - `src/tabs/tab-manager.ts` — added `openCustomRenderTab()`; `body.has-custom-tab` class toggle; skip dirty-check for custom tabs; exclude custom tabs from session save
  - `src/tabs/tabs.css` — added `#custom-tab-host` and `body.has-custom-tab` CSS rules; added `.layout-error` style
  - `index.html` — added `<div id="custom-tab-host"></div>` as sibling of `#editor` inside `#app`
  - `src/plugins/markable-plugin-api.ts` — added `openCustomRenderTab()` to `MarkablePluginAPI` interface and `buildMarkablePluginAPI()` factory
  - `src/main.ts` — added `import { marked }` and three window globals (`__MARKABLE_OPEN_CUSTOM_TAB__`, `__MARKABLE_RENDER_MD__`, `__MARKABLE_ACTION_EXTENSIONS__`); extended `handleAction()` default branch to check action extensions map
  - `src/plugins/layouts/layout-engine.ts` _(new)_ — full Handlebars-style template engine: tokenizer, evaluator, context builder, filter pipeline, embed/partial resolution, `stripScripts`, `wireDataPathListeners`
  - `src/plugins/layouts/layouts.plugin.ts` _(new)_ — full IIFE plugin: sidebar panel, keyboard picker, auto-render on file open, first-run starter layouts, `onEnable`/`onDisable`
  - `src/plugins/index.ts` — added `"layouts"` to `WORKFLOW_PLUGINS`
  - `scripts/build-plugins.mjs` — added `["layouts", "src/plugins/layouts/layouts.plugin.ts"]` entry
  - `tests/tabs/custom-tab.test.ts` _(new)_ — 14 tests covering TC-01 through TC-14 (openCustomRenderTab, body class, duplicate tab replacement, renderFn invocation, error fallback, session exclusion, dirty-check skip, EC-25, MarkablePluginAPI delegation, window globals)
  - `tests/plugins/layouts/layout-engine.test.ts` _(new)_ — 51 tests covering all token types, path resolver, HTML escaper, all filters, evaluator (if/each/each-object/each-nonArray/where/embed/partial/depth-limit/script-strip/EC-10/EC-08), wireDataPathListeners, buildContext

- **Steps completed**:
  - `step_01_custom_render_tab.md` — Custom Render Tab infrastructure
  - `step_02_layout_engine.md` — Layout engine (tokenizer + evaluator)
  - `step_03_layouts_plugin.md` — Layouts IIFE plugin + build wiring
  - `step_04_tests.md` — Full test suite (Red → Green for all 65 new tests)

- **Known limitations**:
  - Live-reload of layout files when they change on disk is deferred (requires vault file-watcher extension; not in requirements).
  - Layout authoring / preview-while-editing UX is deferred.
  - Export of rendered layout to HTML file (save-as-HTML) is deferred.
  - Parametric layouts (user-supplied input beyond `file`/`vault`/`meta` context) are deferred.
  - `{{#each}}` `@last`/`@first`/`@odd`/`@even` index helpers are deferred.
  - `docs/requirements/active_task.md` status field still reads `active`; the reviewer should flip it to `reference` after sign-off.

- **Edge cases covered by tests**:
  - EC-08 (partial depth limit >= 3) → `layout-engine.test.ts` "partial depth limit stops at depth 3"
  - EC-10 ({{#each}} on non-array, non-object input) → `layout-engine.test.ts` "each on non-array non-object renders nothing"
  - EC-15 (renderFn throws → layout-error fallback) → `custom-tab.test.ts` TC-06 "renderFn exception writes .layout-error fallback"
  - EC-16 (tab closed mid-render — cancellation flag) → covered by `layouts.plugin.ts` `_enabled`/`cancelled` guard; integration-level; no unit test (requires async race setup that is out of scope for unit tests)
  - EC-19 (`{{#where hasTag}}` filter) → `layout-engine.test.ts` "where hasTag filter"
  - EC-19 (`{{#where neq}}` filter) → `layout-engine.test.ts` "where neq filter"
  - EC-19 (`{{#where contains}}` filter) → `layout-engine.test.ts` "where contains filter"
  - EC-25 (`#custom-tab-host` missing / not connected) → `custom-tab.test.ts` TC-09 "no-op when #custom-tab-host is not connected"
  - Duplicate tab replacement → `custom-tab.test.ts` TC-03
  - Session save exclusion (custom tabs) → `custom-tab.test.ts` TC-11
  - Dirty-check bypass (closeTab/closeAllTabs/closeOtherTabs) → `custom-tab.test.ts` TC-12
  - `join:","` filter with quoted separator → `layout-engine.test.ts` "join filter with quoted separator"
  - `stripScripts` removes `<script>` tags → `layout-engine.test.ts` "stripScripts removes script elements"
