---
title: Layouts Feature
last-updated: "2026-05-06"
review-cadence-days: 14
status: active
---

# Layouts Feature

## Summary

As a user I want to render vault content as rich styled HTML using Handlebars-style `.layout.md` templates so that I can create custom publication views (Wikipedia-style pages, book shelves, dashboards) without leaving Markable.

---

## Part A — Custom Render Tab (Infrastructure Prerequisite)

Part A adds a third tab kind (`"custom"`) to the tab system so that any plugin (including the Layouts plugin built in Part B) can render arbitrary HTML in the main content area without touching the CodeMirror editor.

---

### Functional Requirements

**FR-01 — Extend TabKind union**

`TabKind` in `src/tabs/tab-types.ts` gains the value `"custom"`:

```
export type TabKind = "editor" | "media" | "custom";
```

**FR-02 — renderFn field on TabEntry**

`TabEntry` in `src/tabs/tab-types.ts` gains an optional field:

```
renderFn?: (container: HTMLElement) => void;
```

- Only present when `kind === "custom"`.
- Never serialized to session storage.
- `renderFn` is called once by `TabManager` immediately after the `#custom-tab-host` element is activated and cleared.

**FR-03 — Permanent #custom-tab-host DOM element**

A `<div id="custom-tab-host">` element is added to `index.html` as a direct sibling of `#media-viewer`. It is always present in the DOM. Visibility is controlled exclusively via CSS (see FR-05). It is never removed or recreated.

**FR-04 — openCustomRenderTab method on TabManager**

`TabManager` gains a public method:

```
openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void
```

Behaviour:
- Creates a new `TabEntry` with `kind: "custom"`, the given `title`, `renderFn`, `isDirty: false`, `filePath: null`, `doc: ""`, `scrollTop: 0`.
- Appends the entry to `this.tabs` and activates it.
- Clears `#custom-tab-host` innerHTML, then calls `renderFn(hostEl)`.
- If a custom tab with the identical `title` already exists, it is replaced in-place (same index, new `renderFn`); the tab strip updates but does not grow.

**FR-05 — CSS: has-custom-tab class**

When the active tab has `kind: "custom"`, `TabManager` adds the class `has-custom-tab` to `<body>` (or to `#app-root` — Architect to decide). CSS rules driven by this class:

- Hides `#editor` (the CodeMirror wrapper).
- Hides `#media-viewer`.
- Shows `#custom-tab-host` (default `display: none`).

When the active tab is not `"custom"`, the class is removed and the original layout is restored.

**FR-06 — No session persistence for custom tabs**

Custom tabs are never included in the tab session array written to `settings.json`. On session restore, any stale `"custom"` kind entries (should not exist, but defensively handled) are silently skipped.

**FR-07 — No dirty-check on close**

When a custom tab is closed, `TabManager.closeTab()` skips the unsaved-changes confirm dialog. Custom tabs are always considered clean.

**FR-08 — openCustomRenderTab on MarkablePluginAPI**

`MarkablePluginAPI` in `src/plugins/markable-plugin-api.ts` gains:

```
openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void;
```

The implementation delegates to `tabManager.openCustomRenderTab()`. The `tabManager` singleton is accessible from `markable-plugin-api.ts` (same import pattern as the existing sidebar delegation).

**FR-09 — window.__MARKABLE_OPEN_CUSTOM_TAB__ global**

`src/main.ts` (in the globals setup block, after `tabManager.init()`) sets:

```
window.__MARKABLE_OPEN_CUSTOM_TAB__ = (title, renderFn) => tabManager.openCustomRenderTab(title, renderFn);
```

This allows IIFE plugins (which cannot import `tabManager` from TypeScript) to open custom tabs via the window global.

**FR-10 — window.__MARKABLE_RENDER_MD__ global**

`src/main.ts` sets:

```
window.__MARKABLE_RENDER_MD__ = (md: string) => marked.parse(md);
```

`marked` is already imported in `live-preview.ts`. The Architect must determine whether to re-import it in `main.ts` or expose it from `live-preview.ts`. This gives IIFE plugins access to the same `marked` instance used by the editor so output is consistent.

**FR-11 — window.__MARKABLE_ACTION_EXTENSIONS__ global**

`src/main.ts` sets:

```
window.__MARKABLE_ACTION_EXTENSIONS__ = new Map<string, () => void>();
```

The `handleAction()` `default` branch is extended: after the existing `__MARKABLE_COMMANDS__` lookup, also check `__MARKABLE_ACTION_EXTENSIONS__`:

```
const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__;
if (ext instanceof Map && ext.has(action)) {
  ext.get(action)!();
  return;
}
```

This allows IIFE plugins to register arbitrary action IDs that `handleAction()` will dispatch to their callbacks without requiring changes to the switch statement.

---

## Part B — Layouts Engine + Plugin

Part B delivers the `.layout.md` template system and the `layouts.plugin.ts` IIFE plugin that drives it.

---

### Functional Requirements

**FR-12 — Layout file location and format**

Layout files are stored at `{vaultRoot}/VaultSettings/layouts/{name}.layout.md`.

- `VaultSettings/` is already excluded from the vault index (no change needed to exclusion logic).
- Each file has YAML frontmatter with required fields `name` (string), `description` (string), and `applies-to` (`"single"` | `"collection"` | `"any"`).
- The file body is HTML with embedded `{{ }}` template expressions.

**FR-13 — Template engine: double-brace escaped output**

`{{variable.path}}` resolves the dot-separated property path on the current data context and outputs HTML-escaped text. Missing paths resolve to `""` (empty string, not an error, not thrown).

**FR-14 — Template engine: triple-brace raw output**

`{{{variable.path}}}` outputs the resolved value without HTML escaping (raw HTML pass-through). Missing paths resolve to `""`.

**FR-15 — Template engine: pipe filters**

Pipe filters are applied via `{{value | filterName}}` or `{{value | filterName:arg}}`:

| Filter | Behaviour |
|---|---|
| `date` | Formats a unix-ms or ISO string as a human-readable local date |
| `upper` | Converts string to uppercase |
| `lower` | Converts string to lowercase |
| `truncate:N` | Truncates string to N characters, appending `…` if truncated |
| `join:", "` | Joins an array with the given separator string |

An unknown filter name outputs the literal `[unknown filter: filterName]` inline (not an error thrown).

**FR-16 — Template engine: #if block**

`{{#if expr}}...{{/if}}` conditionally renders the block body. `expr` is a dot-path on the context. The block renders when the resolved value is truthy (non-empty string, non-zero number, non-empty array, non-null object).

**FR-17 — Template engine: #each block**

`{{#each collection}}...{{/each}}` iterates over arrays or plain objects.

- For arrays: each iteration exposes `this` (the current item) and `@index` (zero-based integer).
- For plain objects: each key-value pair exposes `@key` (string) and `this` (the value).
- Nested field access within the block uses `this.field`.

**FR-18 — Template engine: #where block**

`{{#where collection field operator value}}...{{/where}}` filters a collection before iterating. Supported operators:

| Operator | Matches when |
|---|---|
| `eq` | `item[field] === value` (string comparison) |
| `neq` | `item[field] !== value` |
| `contains` | `String(item[field]).includes(value)` |
| `hasTag` | `item.tags` array includes `value` |

**FR-19 — Template engine: embed helper**

`{{embed "path/to/file.md"}}` reads the file at the given path relative to the vault root, renders it as HTML via `marked.parse`, and inlines the HTML output. On read failure, renders `<span class="layout-error">Failed to load: {path}</span>`.

**FR-20 — Template engine: partial helper**

`{{partial "partials/name.md"}}` loads and renders a sub-template from `VaultSettings/layouts/partials/`. Partials are themselves full `.md` layout files (same syntax, same data context). Recursive depth is capped at 3 levels. When the cap is reached, the partial call renders `<!-- partial depth limit reached -->`.

**FR-21 — Template data context**

The following top-level context object is available in every template render:

| Key | Type | Description |
|---|---|---|
| `file` | object or null | Present when a single file triggered the render (see below) |
| `vault` | object | Always present when a vault is active |
| `meta` | object | Always present (may have empty arrays) |

`file` sub-fields (when present):

| Field | Source |
|---|---|
| `file.title` | `VaultIndexEntry.title` |
| `file.content` | Raw Markdown string (read from disk) |
| `file.rendered` | HTML string from `marked.parse(file.content)` |
| `file.tags` | `VaultIndexEntry.tags` array |
| `file.yaml` | Parsed YAML frontmatter object |
| `file.path` | `VaultIndexEntry.path` (absolute) |
| `file.name` | `VaultIndexEntry.name` (stem without extension) |
| `file.modified` | `VaultIndexEntry.modified` (unix ms) |

`vault` sub-fields:

| Field | Source |
|---|---|
| `vault.files` | `VaultIndex.entries` (`VaultIndexEntry[]`) |
| `vault.name` | `VaultEntry.name` |
| `vault.directories` | `VaultIndex.directories` (string array) |

`meta` sub-fields:

| Field | Source |
|---|---|
| `meta.tags` | `MetaStore.tags` |
| `meta.fields` | `MetaStore.fields` |

**FR-22 — Sidebar panel: layout browser**

The layouts plugin registers a sidebar panel (id `"layouts-panel"`) via `api.registerSidebarPanel()`. The panel contains:

- A scrollable list of all discovered `.layout.md` files in `VaultSettings/layouts/` (display name from frontmatter `name` field, falling back to filename stem).
- An "Apply to current file" button below the list. When clicked, renders the selected layout with the current active file as the `file` context and opens a custom render tab.
- If no vault is active, the panel shows a placeholder message: "Open a vault to use layouts."
- If no active file is open and the selected layout has `applies-to: single`, the button is disabled with tooltip "Open a file first."

**FR-23 — Command bar integration**

On `onEnable`, the plugin registers an action via `__MARKABLE_ACTION_EXTENSIONS__` with id `"layouts-open-picker"` and also pushes a command entry to `__MARKABLE_COMMANDS__`:

```
{ id: "layouts-open-picker", name: "Open with Layout…", action: () => { /* open picker modal */ } }
```

**FR-24 — Layout picker modal**

The layout picker modal is a keyboard-navigable overlay (matching the visual style of the templates picker in `templates.plugin.ts`):

- Lists all available layouts.
- Supports ArrowUp/ArrowDown navigation, Enter to apply, Escape to dismiss.
- Backdrop click dismisses.
- Shows the layout `description` as a subtitle beneath the name.
- Only one picker may be open at a time (singleton guard).

**FR-25 — Auto-render on file open**

The plugin registers a CM6 `updateListener` extension via `api.addExtensions()`. When the active file path changes (detected via `update.docChanged` + frontmatter re-parse, or TabManager activation event via `__MARKABLE_TAB_MANAGER__`) and the active file's YAML frontmatter contains a `layout: name` field, the plugin automatically opens the named layout in a custom render tab. If the named layout does not exist, the auto-render is silently skipped (not an error).

**FR-26 — First-run: bundled starter layouts**

On `onEnable`, if `VaultSettings/layouts/` does not exist or is empty, the plugin writes two bundled starter layout files:

1. `wikipedia.layout.md` — Two-column layout: rendered body content on the left, YAML infobox on the right, title as `<h1>`, tag chips below the title, serif body font.
2. `bookshelf.layout.md` — Responsive card grid showing all vault files as clickable cards (title + tags). `applies-to: collection`.

Writing is best-effort: if the write fails (no vault active, permissions), the plugin continues without error.

**FR-27 — Click-to-open via data-path attributes**

The template engine's post-render hook scans the rendered HTML container for all elements with a `data-path` attribute and attaches click listeners that call `__MARKABLE_TAB_MANAGER__.openFileInTab(path)`. This is the only mechanism for in-layout file navigation. No `<script>` tags are executed in templates.

---

### Non-Functional Requirements

**NFR-01 — Render performance**

Template rendering (parse + substitute + DOM write) must complete in under 200 ms for a vault of up to 500 files. Embed file reads are performed in parallel (via `Promise.all`) rather than sequentially.

**NFR-02 — No script injection**

Template engine must never execute `<script>` tags found in template bodies or embed outputs. `innerHTML` assignment may be used for the final render output but `<script>` tags must be stripped from the rendered HTML before insertion. Stripping is performed by iterating `querySelectorAll("script")` on a detached `div` and removing all matches before appending to the live DOM.

**NFR-03 — XSS from double-brace output**

Double-brace (`{{ }}`) resolved values are HTML-escaped before insertion. Only triple-brace (`{{{ }}}`) bypasses escaping. This is a deliberate opt-in by the template author, not a default behaviour.

**NFR-04 — Error visibility**

Template engine errors (unknown filter, embed failure, partial depth exceeded) are rendered inline as visually distinct `<span class="layout-error">` elements so the user sees exactly which expression failed without the whole render aborting.

**NFR-05 — Theme compatibility**

All plugin CSS uses existing CSS custom properties (`--bg-primary`, `--text-primary`, `--border-color`, etc.) for colors. The two starter layouts embed their own minimal inline styles for structure (two-column, card grid) but use CSS variables for color.

**NFR-06 — IIFE boundary**

The layouts plugin is built as an IIFE `.js` file (`src/plugins/layouts/layouts.plugin.ts` compiled to `src-tauri/plugins/core/layouts.js`). It must not import from `@tauri-apps/api` directly — all Tauri commands go through `__TAURI_INTERNALS__.invoke`. It must not import TypeScript modules from the main bundle at runtime.

**NFR-07 — No DOM leaks on disable**

`onDisable` must close the picker modal if open, remove injected CSS, delete all window globals registered by the plugin, remove all `__MARKABLE_ACTION_EXTENSIONS__` entries registered by the plugin, and remove the command entry from `__MARKABLE_COMMANDS__`.

---

### Design Constraints

**DC-01 — IIFE plugin boundary**

The layouts plugin runs as a compiled IIFE. It accesses host state only via the documented window globals: `__MARKABLE_OPEN_CUSTOM_TAB__`, `__MARKABLE_RENDER_MD__`, `__MARKABLE_TAB_MANAGER__`, `__MARKABLE_ACTION_EXTENSIONS__`, `__MARKABLE_COMMANDS__`, `__TAURI_INTERNALS__`, `__MARKABLE_META__`. No direct imports from main-bundle TypeScript modules.

**DC-02 — No inline script tags in templates**

Template bodies and embed outputs must not execute JavaScript. The engine strips `<script>` elements post-parse. The `{{embed}}` and `{{partial}}` helpers inherit this constraint.

**DC-03 — marked shared via window global**

The plugin uses `window.__MARKABLE_RENDER_MD__(md)` to convert Markdown to HTML. It must not bundle a second copy of `marked`. This keeps the same slot-ID namespace and rendering behaviour as the editor's live preview.

**DC-04 — Action extensions pattern**

Plugin commands that need to be callable from `handleAction()` (e.g. via keybindings or future native menu items) are registered via `__MARKABLE_ACTION_EXTENSIONS__`. The plugin must not modify the `COMMANDS` array in `src/keybindings/keybindings-panel.ts` directly.

**DC-05 — Template engine is pure TypeScript in the plugin**

The template engine (parse, resolve, render) is implemented entirely within the IIFE plugin file. No server-side or Rust-side rendering. All file reads use `__TAURI_INTERNALS__.invoke("read_file", { path })`.

**DC-06 — VaultSettings/ exclusion**

Layout files live inside `VaultSettings/layouts/`. They must not appear in `vault.files` (the vault index). This exclusion is already implemented; no change to vault indexing is required.

**DC-07 — Custom tab replace-by-title behaviour**

`openCustomRenderTab` with a title that matches an existing custom tab replaces that tab in-place. This prevents the layouts plugin from accumulating duplicate render tabs when the user repeatedly applies the same layout.

---

## Impact Analysis

| Area | Change |
|---|---|
| `src/tabs/tab-types.ts` | Add `"custom"` to `TabKind`; add `renderFn?` to `TabEntry` |
| `src/tabs/tab-manager.ts` | Add `openCustomRenderTab()`; CSS class toggle; skip dirty-check for custom tabs; exclude custom tabs from session persist |
| `src/plugins/markable-plugin-api.ts` | Add `openCustomRenderTab()` to `MarkablePluginAPI` interface and `buildMarkablePluginAPI()` factory |
| `src/main.ts` | Add `__MARKABLE_OPEN_CUSTOM_TAB__`, `__MARKABLE_RENDER_MD__`, `__MARKABLE_ACTION_EXTENSIONS__` globals; extend `handleAction()` default branch |
| `index.html` | Add `<div id="custom-tab-host">` sibling to `#media-viewer` |
| `src/styles.css` (or equivalent) | Add `body.has-custom-tab` rules hiding editor/media-viewer, showing host |
| `src/plugins/layouts/layouts.plugin.ts` | New file — full IIFE plugin |
| `src-tauri/plugins/core/layouts.js` | Compiled IIFE output (generated by build step) |
| No Rust changes | All file I/O uses existing `read_file`, `write_file`, `ensure_directory` commands |

No existing plugins are modified. `templates.plugin.ts` is used as a reference pattern only.

---

## Edge Case Inventory

| # | Scenario | Expected behaviour |
|---|---|---|
| EC-01 | No vault is active when user opens the layouts panel | Panel shows "Open a vault to use layouts." Apply button is absent or disabled. |
| EC-02 | `VaultSettings/layouts/` directory does not exist | Plugin treats the directory as empty. First-run check writes bundled starters (FR-26). If write fails, no error is shown; panel shows empty state. |
| EC-03 | Layouts directory exists but contains no `.layout.md` files | Sidebar panel shows empty list. "Apply to current file" button is disabled. Picker modal shows "No layouts found." |
| EC-04 | A `.layout.md` file has missing or malformed YAML frontmatter | `name` falls back to filename stem; `description` falls back to empty string; `applies-to` defaults to `"any"`. Layout is still listed and selectable. |
| EC-05 | No active file when user clicks "Apply to current file" for a `single` layout | Button is disabled when `applies-to === "single"` and no active editor file. For `collection` or `any` layouts the button remains enabled and `file` context is null. |
| EC-06 | Active tab is a custom render tab (not an editor tab) when user triggers "Apply" | The `file` context is null. Layouts with `applies-to: single` show the button as disabled. `collection` layouts render with `file: null`. |
| EC-07 | `{{embed "path"}}` targets a file outside the vault root | File is read via `read_file` regardless of vault membership. If read fails, inline error span is rendered. |
| EC-08 | `{{embed}}` or `{{partial}}` reference forms a cycle (A includes B includes A) | Depth counter reaches 3; subsequent calls render `<!-- partial depth limit reached -->`. |
| EC-09 | `{{partial}}` references a file that does not exist | Renders `<span class="layout-error">Failed to load partial: {path}</span>`. |
| EC-10 | Template variable path resolves to a non-string value (object, array) | `JSON.stringify` is used for double-brace output of objects/arrays. Triple-brace passes the same string through. |
| EC-11 | `{{#each}}` over a non-array, non-object value (e.g. a string or number) | Block is silently skipped (zero iterations). |
| EC-12 | `{{value | join:", "}}` applied to a non-array | Output is the stringified value unchanged (filter is a no-op for non-arrays). |
| EC-13 | `{{value | truncate:N}}` where N is not a valid integer | Filter is treated as unknown; renders `[unknown filter: truncate:N]`. |
| EC-14 | Layout picker opened while a render is in progress | Singleton guard prevents duplicate overlays. Opening while the previous render is async is handled by the replace-by-title behaviour (FR-04 / DC-07). |
| EC-15 | `renderFn` throws during `openCustomRenderTab` | Error is caught; `#custom-tab-host` displays a `<div class="layout-error">Render error: {message}</div>` fallback. The custom tab remains active. |
| EC-16 | User closes a custom render tab while a file read inside the render is still in-flight | The `_enabled` flag and a per-render cancelled flag prevent stale callbacks from writing to the detached container. |
| EC-17 | `openCustomRenderTab` called before `tabManager.init()` completes | Guarded by null-check on `this.editorView`; custom tab is queued and opened once init completes, mirroring the existing `addExtensions` queue pattern. |
| EC-18 | `__MARKABLE_RENDER_MD__` global is not set when plugin enables | Plugin checks for the global and logs a warning; embed/partial rendering degrades to raw Markdown text rather than HTML. No throw. |
| EC-19 | Layout file's `applies-to` field contains an unrecognised value | Treated as `"any"`. |
| EC-20 | `{{date}}` filter receives a value that is neither a valid ISO string nor a unix ms number | Filter returns the original value unchanged. |
| EC-21 | Vault has more than 500 files (index capped) | `vault.files` reflects only the capped set. Template renders what is available; no special error. |
| EC-22 | Plugin is disabled while a layout render tab is open | The render tab remains in the tab strip (it is a DOM artifact). Clicking into it shows the already-rendered HTML unchanged. The plugin no longer listens for click-to-open events (listeners were added by the engine and remain on the DOM until the tab is closed). |
| EC-23 | Two plugins both try to register `"layouts-open-picker"` in `__MARKABLE_ACTION_EXTENSIONS__` | Last registration wins (Map semantics). No error is thrown. |
| EC-24 | `window.__MARKABLE_ACTION_EXTENSIONS__` is not a Map (set incorrectly) | `handleAction()` guards with `instanceof Map`; lookup is skipped and the action falls through to a no-op. |
| EC-25 | `#custom-tab-host` element is missing from the DOM at render time | `openCustomRenderTab` logs a console error and does not open the tab. The error is non-fatal. |
| EC-26 | User activates a non-custom tab after viewing a custom tab | `TabManager` removes `has-custom-tab` from body, hides `#custom-tab-host`, restores editor/media-viewer visibility. |
| EC-27 | Auto-render triggered by frontmatter `layout:` field names a layout that exists but `applies-to: collection` | Auto-render proceeds with `file` context set to the current file's data. The template author is responsible for appropriate use. |
| EC-28 | `ensureDirectory` for `VaultSettings/layouts/` fails on first-run starter write | Failure is swallowed silently. The plugin continues loading without starters. |

---

## Acceptance Criteria Checklist

- [ ] AC-01: `TabKind` includes `"custom"` and `TabEntry` has `renderFn?` field.
- [ ] AC-02: `TabManager.openCustomRenderTab("My Title", fn)` opens a new tab, clears `#custom-tab-host`, calls `fn(hostEl)`, and adds `has-custom-tab` to body.
- [ ] AC-03: `has-custom-tab` on body hides `#editor` and `#media-viewer` and shows `#custom-tab-host`.
- [ ] AC-04: Activating any non-custom tab removes `has-custom-tab` and restores editor visibility.
- [ ] AC-05: Custom tabs are excluded from session save; restarting the app does not restore them.
- [ ] AC-06: Closing a custom tab bypasses the unsaved-changes dialog.
- [ ] AC-07: `MarkablePluginAPI.openCustomRenderTab()` delegates to `tabManager.openCustomRenderTab()`.
- [ ] AC-08: `window.__MARKABLE_OPEN_CUSTOM_TAB__` is set before plugins load and calls `openCustomRenderTab`.
- [ ] AC-09: `window.__MARKABLE_RENDER_MD__(md)` returns HTML identical to `marked.parse(md)`.
- [ ] AC-10: `window.__MARKABLE_ACTION_EXTENSIONS__` is a `Map`; entries registered by plugins are called by `handleAction()`.
- [ ] AC-11: `openCustomRenderTab` with a duplicate title replaces the existing tab rather than appending a second one.
- [ ] AC-12: Layout files at `VaultSettings/layouts/*.layout.md` are discovered by the plugin and listed in the sidebar panel.
- [ ] AC-13: `{{escaped}}` output is HTML-escaped; `{{{raw}}}` is not escaped.
- [ ] AC-14: All five pipe filters (`date`, `upper`, `lower`, `truncate:N`, `join:", "`) produce correct output.
- [ ] AC-15: An unknown filter name renders `[unknown filter: X]` inline without throwing.
- [ ] AC-16: `{{#each vault.files}}{{this.title}}{{/each}}` renders one line per indexed file.
- [ ] AC-17: `{{#where vault.files tags hasTag "project"}}` correctly filters to tagged files only.
- [ ] AC-18: `{{embed "relative/path.md"}}` inlines rendered HTML; embed failure renders the error span.
- [ ] AC-19: `{{partial}}` depth beyond 3 renders the depth-limit comment and does not recurse.
- [ ] AC-20: `<script>` tags in template output are stripped before DOM insertion.
- [ ] AC-21: `data-path` attributes on rendered elements receive click handlers that open the file in a new tab.
- [ ] AC-22: With no vault active, the sidebar panel shows the placeholder message and does not crash.
- [ ] AC-23: First-run with empty layouts directory writes `wikipedia.layout.md` and `bookshelf.layout.md`.
- [ ] AC-24: Active file with `layout: wikipedia` in frontmatter automatically opens the Wikipedia layout tab on file open.
- [ ] AC-25: Disabling the layouts plugin removes `"layouts-open-picker"` from `__MARKABLE_ACTION_EXTENSIONS__` and cleans up DOM, CSS, and the command entry.
- [ ] AC-26: `renderFn` that throws results in an error fallback in `#custom-tab-host`, not an uncaught exception.
- [ ] AC-27: All EC-01 through EC-28 edge cases are covered by automated tests or documented manual test notes in the spec.
- [ ] AC-28: `npm run test:run` passes with no regressions to existing tests.
- [ ] AC-29: `npm run build:plugins && npm run sync:plugins` successfully compiles and copies `layouts.js`.
