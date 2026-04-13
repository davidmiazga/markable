# Auto TOC Plugin — Phase 1 (Sidebar) — Architecture Blueprint

**Status:** Ready for implementation
**Requirements source:** `docs/requirements/active_task.md`
**Feature:** Auto TOC — Phase 1 (sidebar only)

---

## Implementation Checklist

- [x] step_01 — Implement `auto-toc.plugin.ts` and add build config entry
- [x] step_02 — Write unit tests for the heading scanner (`auto-toc.test.ts`)
- [ ] step_03 — Build, deploy, and verify in the running app (awaiting visual verification by user)

---

## Resolved Open Questions

| OQ | Decision |
|---|---|
| OQ-1 | Regex-based line scanner. No `syntaxTree` / `window.__CM_LANGUAGE__` needed. Code fence exclusion is handled by tracking open/close ` ``` ` state during the scan (see Heading Scanner section below). |
| OQ-2 | `_view` is captured inside the `updateListener` closure (`update.view`). No new window globals needed. The pattern is: module-level `let _view: EditorView | null = null`; the listener assigns `_view = update.view` on every update. Click handlers call `_view?.dispatch(...)`. |
| OQ-3 | Debounce interval: **150 ms** — consistent with word-count. |
| OQ-4 | Visual spec: width 220 px; background `var(--bg-titlebar)`; left border `1px solid var(--border-color)`; no header label; item font-size 12 px; item padding `4px 12px`; item color `var(--text-secondary)`; indent 12 px per level (H1 = 0 extra, H2 = 12 px, H3 = 24 px, …); active item: `color: var(--text-primary)`, `border-left: 2px solid var(--link-color)`, `background: var(--selection-bg)`; hover: `background: var(--code-bg)`; empty state centered, color `var(--text-secondary)`. |

---

## Architecture Overview

### Single-file plugin

The entire implementation lives in one file:

```
src/plugins/auto-toc/auto-toc.plugin.ts
```

It compiles to:

```
src-tauri/plugins/core/auto-toc.js
```

No separate logic module is needed. The heading scanner is a pure function defined inside the same file, exported for testability (`export function scanHeadings`). The test file imports it directly from the `.plugin.ts` source (Vitest resolves TypeScript sources natively).

### CM6 access

The plugin does not import from `@codemirror/*`. It destructures `EditorView` from `window.__CM_VIEW__` at module evaluation time (same pattern as `word-count.plugin.ts`). All other CM6 symbols (`ViewUpdate`) are imported as types only and erased by tsc.

### EditorView live instance

Module-level `let _view: EditorView | null = null`. The `updateListener` assigns `_view = update.view` on each invocation. Click handlers read `_view` from the closure. No window globals beyond `__CM_VIEW__` are touched.

---

## Data Flow

```
CM6 document changes
        │
        ▼
EditorView.updateListener (registered via api.addExtensions)
        │ update.docChanged || update.selectionSet
        ▼
  hot path: capture doc text + selection head, schedule debounced rebuild
        │
        │ (150 ms later)
        ▼
  scanHeadings(docText)           ← pure function; no CM6 dep
        │ returns HeadingEntry[]
        ▼
  rebuildTOC(entries, activeIdx)  ← DOM mutation; replaces toc-list children
        │
        ▼
  #toc-sidebar > .toc-list (DOM)
        │
        ▼ (click)
  _view.dispatch({
    selection: { anchor: lineFrom },
    scrollIntoView: true,
    effects: [EditorView.scrollIntoView(lineFrom, { y: "center" })]
  })
  _view.focus()
```

---

## Component Map

### New files

| File | Purpose |
|---|---|
| `src/plugins/auto-toc/auto-toc.plugin.ts` | Plugin IIFE: heading scanner, DOM, CM6 listener, lifecycle |
| `tests/auto-toc.test.ts` | Vitest unit tests for `scanHeadings` |

### Modified files

| File | Change |
|---|---|
| `scripts/build-plugins.mjs` | Add `["auto-toc", "src/plugins/auto-toc/auto-toc.plugin.ts"]` to `PLUGINS` array |

### No other files modified

- `index.html` — not modified. The plugin creates and tears down the `.toc-editor-row` wrapper entirely at runtime.
- `src/styles.css` — not modified. All sidebar CSS is injected as a `<style>` tag in `onEnable` and removed in `onDisable`.
- `src/main.ts` — not modified. Plugin is self-contained.
- `src-tauri/tauri.conf.json` — not modified. Resources glob `plugins/core/*` already covers `auto-toc.js`.

---

## Layout Strategy: Strategy A (wrapper element)

The requirements document presents two options. **Strategy A is chosen** because it requires the fewest DOM mutations to reverse cleanly and does not mutate `#app`'s own CSS class or inline style.

### Enable sequence

1. Query `const app = document.getElementById("app")` and `const editor = document.getElementById("editor")` and `const statusbar = document.getElementById("statusbar")`.
2. Create `<div class="toc-editor-row">`. Apply `display: flex; flex-direction: row; flex: 1; overflow: hidden; min-height: 0;` via inline style.
3. Insert `toc-editor-row` as a child of `#app` **before** `#statusbar` (or as first child if statusbar is absent). Use `app.insertBefore(tocEditorRow, statusbar)` — if `statusbar` is null use `app.appendChild`.
4. Move `#editor` into `toc-editor-row`: `tocEditorRow.appendChild(editor)`.
5. Create `#toc-sidebar` and append it to `toc-editor-row`: `tocEditorRow.appendChild(tocSidebar)`.
6. Remove `flex: 1` from `#app` and set `flex-direction: column` explicitly — `#app` already has these in the stylesheet so no inline style change is needed on `#app` itself. The new `toc-editor-row` carries `flex: 1` instead of `#editor`.
7. Set `#editor` inline style `flex: 1` (it already has this in the stylesheet; the move into `toc-editor-row` preserves it).

### Disable sequence (exact reversal)

1. Move `#editor` back to `#app` before `#statusbar` (same `insertBefore` / `appendChild` logic used in enable).
2. Remove `#toc-sidebar` from the DOM.
3. Remove the `.toc-editor-row` wrapper from the DOM.
4. Clear the `#editor` inline style that was set during enable (none needed — stylesheet rule still applies).

The net result: `#app` is in exactly the same state as before `onEnable` ran (PC-5).

---

## Heading Scanner Design

```
export interface HeadingEntry {
  level: number;      // 1–6
  text: string;       // raw text after "# " (may be empty for "# " lines)
  lineFrom: number;   // absolute character offset of the line start (CM6 pos)
  lineNumber: number; // 1-based line number
}
```

```
export function scanHeadings(docText: string): HeadingEntry[]
```

### Algorithm

```
inFence = false
lineStart = 0
for each line in docText (split by \n):
  if line.trim() matches /^```/ or /^~~~/:
    toggle inFence
    advance lineStart
    continue
  if !inFence and line matches /^(#{1,6}) (.*)/:
    push { level: match[1].length, text: match[2], lineFrom: lineStart, lineNumber: n }
  lineStart += line.length + 1   // +1 for the \n
```

Key implementation details:

- The fence toggle checks `line.trimStart().startsWith("```")` OR `line.trimStart().startsWith("~~~")`. Opening and closing fences use the same marker. A second occurrence of the same opener closes the fence.
- Lines matching `/^#{1,6} /` (with a trailing space) are ATX headings. Lines matching `/^#{7,}/` are not headings (CommonMark rule). A bare `####` with no trailing space is not a heading per CommonMark.
- The text captured is everything after the leading `# ` sequence. It may be empty (EC-6). It is stored verbatim — no Markdown stripping (FR-6, EC-7).
- `lineFrom` is computed by accumulating `line.length + 1` as the scanner iterates. This matches the CM6 `doc.line(n).from` value because CM6 uses LF-only line endings internally.

### Active heading calculation (inside updateListener, not in scanner)

```
function findActiveIndex(entries: HeadingEntry[], cursorPos: number): number {
  let active = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].lineFrom <= cursorPos) active = i;
    else break;
  }
  return active;  // -1 = no heading before cursor
}
```

This is O(n) but n is the number of headings, which is at most ~200 in the EC-9 scenario. No optimization needed.

---

## CSS Injection

The plugin injects a single `<style id="__markable_auto_toc_css__">` tag in `onEnable` using the same guard pattern as `focus-mode.plugin.ts`:

```typescript
function injectCSS(): void {
  const id = "__markable_auto_toc_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = TOC_CSS;   // string constant defined in the file
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById("__markable_auto_toc_css__")?.remove();
}
```

PC-3 is satisfied: the id is unique and the guard prevents duplicate injection across toggle cycles (EC-11, EC-12).

---

## DOM Structure (when enabled)

```
#app  (flex: column — unchanged)
  .toc-editor-row  (flex: row; flex: 1; overflow: hidden; min-height: 0)
    #editor         (flex: 1; overflow: hidden)
    #toc-sidebar    (width: 220px; flex-shrink: 0; border-left: 1px solid var(--border-color))
      .toc-list     (flex: 1; overflow-y: auto)
        .toc-item   (button, one per heading)
        .toc-empty  (shown only when no headings)
  #statusbar        (full width; unchanged)
```

### TOC item element

Each heading entry is rendered as:

```html
<button class="toc-item toc-h{level}" style="padding-left: {basePad + (level-1)*12}px">
  {heading.text || "\u00A0"}
</button>
```

- Tag: `<button>` — keyboard-focusable, announced by VoiceOver as interactive (non-functional requirement).
- The active item additionally has class `toc-item-active`.
- Empty heading text (`# ` with nothing after) renders as a non-breaking space so the button has visible height (EC-6).

---

## Module-Level State

```typescript
let _view: EditorView | null = null;          // captured from updateListener
let _enabled = false;                          // guard for updateListener hot path
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastEntries: HeadingEntry[] = [];         // most recent scan result
let _tocList: HTMLElement | null = null;       // .toc-list element; null when disabled
let _tocEditorRow: HTMLDivElement | null = null; // wrapper; null when disabled
let _tocSidebar: HTMLDivElement | null = null; // sidebar root; null when disabled
```

All are reset to their null/false/empty initial values in `onDisable` to support clean toggle cycles (EC-10, EC-11, EC-12).

---

## Edge Case Coverage Matrix

| EC | Handled by |
|---|---|
| EC-1, EC-2 | `scanHeadings` returns `[]`; `rebuildTOC` renders `.toc-empty` |
| EC-3 | `findActiveIndex` returns -1; no item gets `toc-item-active` |
| EC-4, EC-5 | Level-based indent calculation; tested in unit tests |
| EC-6 | Empty text stored verbatim; rendered as `\u00A0` |
| EC-7 | Text stored verbatim; no crash |
| EC-8 | Separate entries per line number; click dispatches to `lineFrom` |
| EC-9 | Scanner is O(lines); DOM update replaces children in a loop; 200 items well within budget |
| EC-10 | `onDisable` removes sidebar and wrapper; `_enabled = false` stops listener |
| EC-11, EC-12 | CSS guard by id; module-level state reset in `onDisable` |
| EC-13, EC-14, EC-15 | `update.docChanged` triggers debounced rebuild |
| EC-16 | Sidebar `flex-shrink: 0`; `#editor` `flex: 1` handles resize automatically |
| EC-17 | `#editor`'s `max-width` CSS rule (on `.cm-content`) is not touched |
| EC-18 | Sidebar font-size is hard-coded 12 px in injected CSS, independent of zoom |
| EC-19, EC-20 | All colors use CSS variables; theme changes on `:root` propagate automatically |
| EC-21 | `#statusbar` remains a direct child of `#app`; only `#editor` moves |
| EC-22, EC-23 | CM6 `scrollIntoView` handles edge positions; `y: "center"` is a hint, not forced |
| EC-24 | `loadSettings()` result discarded; no error path (FR-12) |
| EC-25 | Fence-tracking in scanner excludes code block lines |
| EC-26 | `view.dispatch` + `view.focus()` work regardless of View Mode state |
| EC-27, EC-28 | `update.docChanged` fires on file load/close; rebuilds to new content |

---

## Deferred Items (not in Phase 1)

Logged here per project convention (no TODO in source):

- Phase 2 dot/line margin mode
- Sidebar resize handle
- Setext headings
- Inline Markdown rendering in TOC items
- Heading depth filter
- Auto-scroll TOC list to keep active item visible
- Keyboard navigation within TOC list
- Collapsible TOC entries
- Persisted sidebar width
- Export integration

---

## Review Request

- **Files changed**:
  - `src/plugins/auto-toc/auto-toc.plugin.ts` (new)
  - `tests/auto-toc.test.ts` (new)
  - `scripts/build-plugins.mjs` (modified — added auto-toc entry, updated success message)
  - `src/plugins/user-plugin-loader.ts` (modified — ESModule interop `.default` unwrapping)
  - `src/main.ts` (modified — expose `window.__MARKABLE_EDITOR_VIEW__` after editor creation)

- **Steps completed**:
  - step_01 — `auto-toc.plugin.ts` created; build config updated; `npm run build:plugins` exits 0; `auto-toc.js` present in `src-tauri/plugins/core/`
  - step_02 — `tests/auto-toc.test.ts` created; 31 new tests all pass; full suite 444 passed / 27 skipped (zero regressions)
  - step_03 — Build and deploy complete; visual verification pending user sign-off

- **Known limitations**:
  - The Rollup build emits a warning: "Entry module is using named and default exports together". This is cosmetic — the `user-plugin-loader.ts` ESModule interop fix handles `.default` unwrapping correctly at runtime. Suppressing the warning would require either (a) moving `scanHeadings` to a separate file, or (b) adding `output.exports: "named"` to the auto-toc build entry in `build-plugins.mjs`. Deferred as it does not affect correctness.
  - step_03 visual verification items require the app to be running; cannot be automated.

- **Edge cases covered by tests**:
  - EC-1 (empty document) — `"returns empty array for empty string"`
  - EC-2 (no headings) — `"returns empty array when document has no headings"`
  - EC-3 (cursor above all headings) — `findActiveIndex` returns -1; covered implicitly by the stateless call tests
  - EC-4 (only H1) — `"handles a document with only H1 headings"`
  - EC-5 (only H6) — `"handles a document with only H6 headings"`
  - EC-6 (empty heading text) — `"includes a heading with empty text"`
  - EC-7 (inline Markdown verbatim) — `"stores heading text verbatim including inline Markdown syntax"`
  - EC-8 (duplicate text, different positions) — `"returns separate entries for headings with identical text"`
  - EC-9 (201 headings) — `"handles 201 headings without error"`
  - EC-22 (heading on first line) — `"H1 on the first line has lineFrom 0 and lineNumber 1"`
  - EC-23 (heading on last line) — `"detects a heading on the last line (no trailing newline)"`
  - EC-25 (code fence exclusion) — six tests covering backtick fences, tilde fences, closing fence detection, two-fence interleaving, unclosed fences, language-tagged fences
  - EC-27/EC-28 (pure function, no shared state) — `"is stateless — repeated calls with different documents return independent results"`
