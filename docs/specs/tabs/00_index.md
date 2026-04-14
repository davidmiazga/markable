---
title: "Multi-Document Tabs — Master Blueprint"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Multi-Document Tabs — Master Blueprint

**Requirements source:** `docs/requirements/active_task.md`
**Feature prefix:** `tabs`
**Status:** Ready for implementation

---

## Architecture Summary

### Invariants (never change during implementation)

1. One `EditorView` for the app lifetime. Tab switching calls `editorView.setState(state)` only.
2. `#tab-strip` is a permanent DOM element inserted between `#titlebar` and `#app` in `index.html`. It is never removed.
3. `TabManager` is a singleton. It is never instantiated more than once.
4. Tab data (mode + session) lives in `MarkableSettings` / `settings.json`. No separate file.
5. `TabManager` does not touch plugin system code (`PluginManager`, `MarkablePluginAPI`).

### Key design insight: Rust raw-JSON pass-through

The Rust `save_settings` command writes the raw JSON value without deserializing it into the Rust struct (see `src-tauri/src/commands/settings.rs`, `write_raw_settings_to_disk`). This means **new TypeScript-side fields added to `MarkableSettings` are automatically persisted and round-tripped without any Rust struct change**. This is the same approach used for `sidebar`, `findWidget`, `keybindings`, `plugins`, and all other optional TS-only fields.

Therefore: **`tabMode`, `openFiles`, and `activeTabIndex` are TypeScript-only optional fields on `MarkableSettings`. No Rust struct modification is needed.** The Rust `get_settings` command returns raw JSON from disk, so new fields survive the round-trip transparently.

This eliminates the Rust migration concern entirely.

### DOM Layout (post-tabs)

```
<body>
  #titlebar
  #tab-strip          ← permanent, inserted by TabManager.init() at startup
  #app
    #app-row          ← created by SidebarManager.init()
      #sidebar-left
      #editor
      #sidebar-right
  #statusbar
```

The vertical tab strip is NOT in `#tab-strip`. In vertical mode, `#tab-strip` is hidden (`display:none`) and the `VerticalTabStrip` renders its DOM directly inside `#app-row` as the first flex child (before `#sidebar-left`). `#sidebar-left` is hidden via `toggleSide("left", false)`. On mode exit, `#tab-strip` is restored and the vertical strip DOM is removed.

### Renderer Delegation Pattern

```
TabManager (singleton)
  ├── tabs: TabEntry[]         ← source of truth for all tab state
  ├── activeTabIndex: number
  ├── editorView: EditorView
  └── renderer: ITabRenderer   ← swapped on mode change
        ├── MinimalTabBar
        ├── RegularTabBar
        └── VerticalTabStrip
```

Each renderer implements `ITabRenderer`:
- `mount(container: HTMLElement, tabs: TabEntry[], activeIndex: number): void`
- `update(tabs: TabEntry[], activeIndex: number): void`
- `destroy(): void`

`TabManager` calls `renderer.mount()` once on init (or mode switch) and `renderer.update()` on every state change (tab open/close/activate/dirty change).

### Settings Fields Added to `MarkableSettings` (TypeScript only)

```typescript
interface MarkableSettings {
  // ... existing fields ...
  tabMode?: "minimal" | "regular" | "vertical";   // default: "minimal"
  openFiles?: Array<{ filePath: string; scrollTop: number }>;  // session restore
  activeTabIndex?: number;                          // session restore
}
```

Default values applied in `DEFAULT_SETTINGS` and in `TabManager` on absent fields.

### Soft Warning Constant

`TAB_SOFT_WARNING_THRESHOLD = 30` — defined as a named constant in `tab-manager.ts`. OD-4 is open; the value is configurable at compile time via this constant. No hard cap is enforced.

---

## Component Map

### New Files

| File | Purpose |
|---|---|
| `src/tabs/tab-types.ts` | `TabEntry` interface, `ITabRenderer` interface, tab-related constants |
| `src/tabs/tab-manager.ts` | `TabManager` singleton class |
| `src/tabs/renderers/minimal-tab-bar.ts` | `MinimalTabBar` renderer |
| `src/tabs/renderers/regular-tab-bar.ts` | `RegularTabBar` renderer |
| `src/tabs/renderers/vertical-tab-strip.ts` | `VerticalTabStrip` renderer |
| `src/tabs/index.ts` | Public re-export facade |
| `src/tabs/tabs.css` | Shared tab strip CSS (all three renderers + CSS variables) |

### Modified Files

| File | What Changes |
|---|---|
| `index.html` | Add `<div id="tab-strip"></div>` between `#titlebar` and `#app` |
| `src/lib/settings.ts` | Add `tabMode?`, `openFiles?`, `activeTabIndex?` to `MarkableSettings` interface and `DEFAULT_SETTINGS` |
| `src/main.ts` | Import `TabManager`; call `tabManager.init()` after `initSidebar()`; replace `newFile()`, `openFile()`, `openFileByPath()`, `openRecentFileByPath()`, `saveFile()`, `saveFileAs()` with tab-aware versions; add tab action cases to `handleAction()`; wire `close-requested` event for session save; update dirty-state listener; update drag-and-drop handler |
| `src/keybindings/keybindings-panel.ts` | Add `tab-new`, `tab-close`, `tab-1` through `tab-9` to the `COMMANDS` array |

### Files NOT Modified

- `src/sidebar/sidebar-manager.ts` — TabManager calls `toggleSide` via the public API; no internal changes needed.
- `src/plugins/markable-plugin-api.ts` — No changes.
- `src/plugins/index.ts` — No changes.
- `src-tauri/src/commands/settings.rs` — No changes (raw-JSON pass-through already works).

---

## Implementation Phases

Each phase leaves the app in a working, runnable state. No phase breaks the existing single-document behavior until phase 7 replaces it.

| # | Step File | Deliverable | App State After |
|---|---|---|---|
| 1 | `step_01_core_state.md` | `TabEntry`, `ITabRenderer`, `TabManager` class (no UI, no DOM) | Compiles; no visible change |
| 2 | `step_02_minimal_tab_bar.md` | `MinimalTabBar` renderer + CSS; `index.html` update; `TabManager.init()` called at startup | Minimal dot strip visible, not yet functional |
| 3 | `step_03_regular_tab_bar.md` | `RegularTabBar` renderer | Regular tab bar renderable (mode switch from settings) |
| 4 | `step_04_vertical_tab_strip.md` | `VerticalTabStrip` renderer + sidebar interaction | Vertical mode renderable |
| 5 | `step_05_settings_persistence.md` | Settings fields; session restore; `updateSettings` calls on tab events | Tab mode persists across restart; session restores |
| 6 | `step_06_keyboard_shortcuts.md` | `COMMANDS` additions; `handleAction` tab cases; Cmd-T/N/W/1-9 | All keyboard shortcuts functional |
| 7 | `step_07_main_integration.md` | Replace single-doc open/save functions with tab-aware equivalents | Full multi-document tab experience |
| 8 | `step_08_soft_warning.md` | Soft warning indicator at `TAB_SOFT_WARNING_THRESHOLD` tabs | Warning appears at 30+ tabs |

---

## Implementation Checklist

- [x] step_01 — Core state (TabEntry, ITabRenderer, TabManager skeleton)
- [x] step_02 — MinimalTabBar renderer + CSS + DOM insertion
- [x] step_03 — RegularTabBar renderer
- [x] step_04 — VerticalTabStrip renderer
- [x] step_05 — Settings persistence + session restore
- [x] step_06 — Keyboard shortcuts
- [x] step_07 — main.ts full integration (tab-aware file ops)
- [x] step_08 — Soft warning indicator

---

## API Contracts

### `TabEntry` (defined in `src/tabs/tab-types.ts`)

```typescript
export interface TabEntry {
  id: string;                   // UUID (crypto.randomUUID())
  filePath: string | null;      // null = untitled
  title: string;                // filename without extension, or "Untitled"
  isDirty: boolean;
  editorState: EditorState;     // CM6 EditorState snapshot
  scrollTop: number;            // editorView.scrollDOM.scrollTop at last tab-away
}
```

### `ITabRenderer` (defined in `src/tabs/tab-types.ts`)

```typescript
export interface ITabRenderer {
  mount(container: HTMLElement, tabs: TabEntry[], activeIndex: number): void;
  update(tabs: TabEntry[], activeIndex: number): void;
  destroy(): void;
}
```

### `TabManager` public surface (defined in `src/tabs/tab-manager.ts`)

```typescript
export class TabManager {
  // Lifecycle
  init(editorView: EditorView): Promise<void>;

  // Tab operations
  openNewTab(): void;
  openFileInTab(filePath: string): Promise<boolean>;  // returns false if duplicate activated
  closeTab(id: string): Promise<void>;
  activateTab(id: string): void;
  activateTabByIndex(index: number): void;  // 1-based; Cmd-9 = last

  // Save operations
  saveActiveTab(): Promise<void>;
  saveActiveTabAs(): Promise<void>;

  // Dirty state
  markActiveTabDirty(): void;
  markActiveTabClean(): void;

  // Mode
  setMode(mode: "minimal" | "regular" | "vertical"): void;

  // Session
  saveSession(): Promise<void>;

  // Accessors
  getActiveTab(): TabEntry | null;
  getActiveFilePath(): string | null;
  getTabs(): TabEntry[];
  getTabCount(): number;
}
```

### `src/tabs/index.ts` (public facade)

```typescript
export { TabManager } from "./tab-manager";
export type { TabEntry, ITabRenderer } from "./tab-types";
export { tabManager } from "./tab-manager";  // singleton export
```

---

## Edge Case Coverage Map

Each EC from the requirements is addressed by a specific step file:

| EC | Scenario | Addressed In |
|---|---|---|
| EC-1 | All restored files missing from disk | step_05 (session restore skips missing) |
| EC-2 | Close last tab → window close | step_07 (main integration) |
| EC-3 | Close last dirty tab → unsaved dialog | step_07 |
| EC-4 | Open already-open file → activate existing tab | step_07 |
| EC-5 | Tab switch during in-flight CM6 transaction | step_01 (state capture uses `editorView.state` which is always post-transaction) |
| EC-6 | Session restore: file exists but no read permission | step_05 (readFile error → skip silently) |
| EC-7 | Corrupt settings → defaults + untitled tab | step_05 |
| EC-8 | Cmd-1..9 with fewer tabs than index | step_06 (no-op check) |
| EC-9 | Cmd-9 with one tab | step_06 (activates index 0) |
| EC-10 | Mode switch vertical → other → restore left sidebar | step_04 + step_07 |
| EC-11 | Mode switch to vertical during sidebar animation | step_04 (synchronous call) |
| EC-12 | Save As cancelled on untitled | step_07 (early return on cancel) |
| EC-13 | Duplicate tab race | step_07 (all open paths go through openFileInTab) |
| EC-14 | Drag-and-drop while tabs open | step_07 (drag handler calls openFileInTab) |
| EC-15 | Force-quit between tab operations | step_05 (session saved on tab-change/close/close-requested) |
| EC-16 | Cmd-T/N in vertical mode | step_06 (renderer update handles new tab) |
| EC-17 | Session restore > soft warning threshold | step_05 + step_08 |
| EC-18 | Settings panel before TabManager init | step_05 (tabMode reads DEFAULT_SETTINGS fallback) |
| EC-19 | Cmd-N pre-existing shortcut | step_06 (both tab-new and file-new map to same action) |
| EC-20 | External file modification while tab open | out of scope (documented) |

---

## Review Request

- **Files changed**:
  - `src/tabs/tabs.css` (new) — all tab-strip CSS; CSS custom properties for all three modes
  - `src/tabs/renderers/minimal-tab-bar.ts` (new) — MinimalTabBar implementing ITabRenderer
  - `src/tabs/tab-manager.ts` (modified) — added import of MinimalTabBar; added `_instantiateRenderer()` private method; updated `init()` to call it; updated `setMode()` to call it instead of the placeholder comment
  - `index.html` (modified) — added `<div id="tab-strip"></div>` between `#titlebar` and `#app`
  - `src/main.ts` (modified) — added `tabManager` import; added `await tabManager.init(editor)` after `restoreSidebarFromSettings()`; extended dirty-state listener to call `tabManager.markActiveTabDirty()`
  - `tests/tabs/minimal-tab-bar.test.ts` (new) — 21 unit tests for MinimalTabBar

- **Steps completed**: `step_02_minimal_tab_bar.md`

- **Known limitations**:
  - The legacy `isDirty` / `setDirty()` path in `main.ts` is kept alive in parallel with `tabManager.markActiveTabDirty()`. Both run on every `docChanged` event until step_07 removes the legacy path. This is intentional per the spec ("The existing isDirty and setDirty() in main.ts are not removed in this step").
  - `_mockWriteFile` and `_mockSaveFileDialog` unused-variable TS errors in `tests/tabs/tab-manager.test.ts` are pre-existing from step_01 and are not introduced by this step.

- **Edge cases covered by tests** (step_02):
  - NFR-3 (accessibility): `mount` sets `role="tablist"`; each dot has `aria-selected` and `aria-label`; tooltip has `aria-live="polite"` — covered by "sets role=tablist", "marks active tab with aria-selected", "sets aria-label to tab title" tests.
  - FR-3.1 (dot/pill strip): 3 dots for 3 tabs; click calls onActivate with correct id — covered by "renders exactly one .tab-dot per tab" and two click tests.
  - FR-7 (dirty state): dirty tab gets `.is-dirty` class — covered by "marks a dirty tab with .is-dirty class".
  - FR-9 (soft warning): `tab-over-limit` class added above threshold, absent at exactly threshold — covered by two threshold tests.
  - NFR-5 (teardown): `destroy()` clears innerHTML, removes mode class, removes role, removes tooltip from body — covered by four destroy tests.
  - Tooltip lifecycle: tooltip added on mount, removed on destroy, no duplicates on repeated mount/destroy — covered by two tooltip DOM tests.

---

## Review Request (step_03)

- **Files changed**:
  - `src/tabs/renderers/regular-tab-bar.ts` (new) — RegularTabBar implementing ITabRenderer; constructor takes onActivate, onClose, onNew callbacks; mount/update/destroy lifecycle; _buildTabEl private helper
  - `src/tabs/tabs.css` (modified) — replaced placeholder `.tab-label { }` with full regular-mode CSS rules for `.tab-bar-inner`, `.tab-label`, `.tab-label[aria-selected="true"]`, `.tab-label-text`, `.tab-label-dirty`, `.tab-label.is-dirty .tab-label-dirty`, `.tab-close`, `.tab-new-btn`, `.tab-new-btn.tab-over-limit`; also added `#tab-strip.tab-mode-regular` override for align-items
  - `src/tabs/tab-manager.ts` (modified) — added import of RegularTabBar; added `case "regular"` branch in `_instantiateRenderer()`; updated stale comments

- **Steps completed**: `step_01_core_state.md`, `step_02_minimal_tab_bar.md`, `step_03_regular_tab_bar.md`

- **Known limitations**:
  - The legacy `isDirty` / `setDirty()` path in `main.ts` is kept alive in parallel with `tabManager.markActiveTabDirty()`. Both run on every `docChanged` event until step_07 removes the legacy path. This is intentional per the spec.
  - `_mockWriteFile` and `_mockSaveFileDialog` unused-variable TS errors in `tests/tabs/tab-manager.test.ts` are pre-existing from step_01 and are not introduced by this step.
  - Horizontal overflow scrolling for `.tab-bar-inner` is deferred out-of-scope per spec (overflow:hidden used as specified).
  - Settings UI to switch to regular mode is deferred to step_05 per spec.

- **Edge cases covered by tests** (step_03):
  - NFR-3 (accessibility): `mount` sets `role="tablist"`; each label has `aria-selected` and `aria-label` — covered by "sets role=tablist", "marks active tab with aria-selected", "sets aria-label" tests.
  - FR-3.2 (regular tab labels): 3 labels for 3 tabs; `.tab-label-text` shows title; `.tab-close` button inside each label — covered by "renders exactly one .tab-label per tab", "renders .tab-label-text", "renders .tab-close button" tests.
  - FR-7 (dirty state): dirty tab gets `.is-dirty` class; `.tab-label-dirty` span present — covered by "marks dirty tab with .is-dirty", "shows .tab-label-dirty element" tests.
  - FR-5.2 (close button isolation): close button click calls onClose; does NOT call onActivate (stopPropagation) — covered by "calls onClose", "does NOT call onActivate when close clicked" tests.
  - FR-5.1 (new tab button): "+" click fires onNew — covered by "calls onNew when + button clicked".
  - FR-9 (soft warning): `tab-over-limit` on `.tab-new-btn` above threshold, absent at threshold — covered by two threshold tests.
  - NFR-5 (teardown): `destroy()` clears innerHTML, removes mode class, removes role — covered by three destroy tests; also safe to call before mount.

---

## Review Request (step_04)

- **Files changed**:
  - `src/tabs/renderers/vertical-tab-strip.ts` (new) — VerticalTabStrip implementing ITabRenderer; constructor takes onActivate, onClose callbacks; mount() inserts #tab-vertical-strip into #app-row as first child; update() full re-render with is-dirty, aria-selected, tab-over-limit; destroy() removes strip and removes tab-mode-vertical class; _buildItemEl private helper
  - `src/tabs/tabs.css` (modified) — replaced placeholder `#tab-vertical-strip { }` with full vertical-mode CSS rules: `#tab-vertical-strip`, `.tab-vertical-item`, `.tab-vertical-item[aria-selected="true"]`, `.tab-vertical-text`, `.tab-vertical-item.is-dirty .tab-vertical-text::after`, `.tab-vertical-item .tab-close`, `.tab-vertical-item:hover .tab-close`, `#tab-vertical-strip.tab-over-limit::after`
  - `src/tabs/tab-manager.ts` (modified) — added import of VerticalTabStrip; added `case "vertical"` branch in `_instantiateRenderer()`; updated `setMode()` to use DOM-check pattern before calling `toggleSide()` (guards against double-toggle); updated stale comments

- **Steps completed**: `step_01_core_state.md`, `step_02_minimal_tab_bar.md`, `step_03_regular_tab_bar.md`, `step_04_vertical_tab_strip.md`

- **Known limitations**:
  - The legacy `isDirty` / `setDirty()` path in `main.ts` is kept alive in parallel with `tabManager.markActiveTabDirty()`. Both run on every `docChanged` event until step_07 removes the legacy path. This is intentional per the spec.
  - `_mockWriteFile` and `_mockSaveFileDialog` unused-variable TS errors in `tests/tabs/tab-manager.test.ts` are pre-existing from step_01 and are not introduced by this step.
  - `toggleSide` behavior when `sidebar-left` has `display` controlled by `flex` (not `""`) vs `"none"` — the DOM-check pattern uses `!== "none"` to determine visibility, which is consistent with how sidebar-manager.ts sets display on open. If sidebar-manager ever uses a CSS class instead of inline style, this check would need updating. Deferred to step_07 integration testing.
  - Settings UI to switch to vertical mode is deferred to step_05 per spec.

- **Edge cases covered by tests** (step_04):
  - FR-3.3 (vertical strip): `mount` creates `#tab-vertical-strip` in `#app-row` as first child — covered by "creates #tab-vertical-strip", "inserts as first child" tests.
  - NFR-3 (accessibility): `mount` sets `role="tablist"` on strip; each item has `aria-selected` and `aria-label` — covered by "sets role=tablist", "marks active tab with aria-selected", "sets aria-label" tests.
  - FR-7 (dirty state): dirty tab gets `.is-dirty` class — covered by "adds is-dirty class to dirty tabs" test.
  - FR-5.2 (close button isolation): close button click calls onClose and does NOT call onActivate (stopPropagation) — covered by "calls onClose" and "does NOT call onActivate when close clicked" tests.
  - FR-9 (soft warning): `tab-over-limit` added to strip above threshold, absent at exactly threshold — covered by two threshold tests.
  - NFR-5 (teardown): `destroy()` removes `#tab-vertical-strip` from DOM, removes `tab-mode-vertical` from container — covered by two destroy tests; safe before mount and safe called twice (idempotent).
  - EC-11 (missing #app-row): `mount` logs error and returns cleanly when `#app-row` is not found — covered by "logs an error and returns without creating the strip" test.

---

## Review Request (step_05)

- **Files changed**:
  - `src/lib/settings.ts` (modified) — exported new `SessionTabEntry` interface; updated `openFiles?` field type from inline object literal to `SessionTabEntry[]`
  - `src/main.ts` (modified) — wired `tauri://close-requested` listener in `initApp()`; listener calls `tabManager.saveSession()` then `appWindow.destroy()` (FR-6.7d)
  - `src-tauri/tauri.conf.json` (modified) — added `"closeRequestedEvent": true` to `app.windows[0]` so the close-requested event is fired before window destruction
  - `src/settings/settings-panel.ts` (modified) — added import of `tabManager`; added "Tabs" section HTML with `#tab-mode-control` segmented control; wired click handler using event delegation; added `syncTabModeControl()` helper; added call to `syncTabModeControl()` in `syncPanelToSettings()`
  - `src/settings/settings-panel.css` (modified) — added `.settings-row`, `.settings-segmented`, `.settings-segmented button`, `.settings-segmented button.is-active` CSS rules
  - `tests/tabs/session-restore.test.ts` (new) — 14 unit tests covering all step_05 test cases

- **Steps completed**: `step_01_core_state.md`, `step_02_minimal_tab_bar.md`, `step_03_regular_tab_bar.md`, `step_04_vertical_tab_strip.md`, `step_05_settings_persistence.md`

- **Known limitations**:
  - The legacy `isDirty` / `setDirty()` path in `main.ts` is kept alive in parallel with `tabManager.markActiveTabDirty()`. Both run on every `docChanged` event until step_07 removes the legacy path. This is intentional per the spec.
  - `_mockWriteFile` and `_mockSaveFileDialog` unused-variable TS errors in `tests/tabs/tab-manager.test.ts` are pre-existing from step_01 and are not introduced by this step.
  - The `main.ts` unused-import TS error for `eventMatchesKey` is pre-existing from step_06 forward work and is not introduced by this step.

- **Edge cases covered by tests** (step_05):
  - FR-6.1 / FR-6.2: valid openFiles creates correct tab count and correct filePaths — covered by "creates one tab per valid path in openFiles" and "sets the correct filePath on each restored tab".
  - EC-1 / EC-6: readFile error → tab silently skipped — covered by "skips a file path whose readFile returns an error".
  - FR-6.5 (all missing): all reads fail → one untitled tab — covered by "creates one untitled tab when all restored paths fail".
  - FR-6.5 (empty): openFiles is `[]` or `undefined` → one untitled tab — covered by two tests.
  - FR-6.6: savedActiveIndex too large → clamped to last valid index — covered by "clamps activeTabIndex to last tab when saved index is too large".
  - FR-6.6 (in range): valid activeIndex preserved — covered by "does not alter activeTabIndex when it is within valid range".
  - FR-6.3: untitled tabs excluded from openFiles — covered by "excludes untitled tabs from the openFiles list".
  - FR-6.7: activeTabIndex persisted correctly — covered by "persists the current activeTabIndex".
  - FR-6.3 (all untitled): empty openFiles when only untitled tabs open — covered by "writes empty openFiles when only untitled tabs are open".
  - EC-18: absent tabMode → defaults to minimal — covered by "defaults tab mode to minimal when tabMode is absent from settings".
  - EC-7 (null openFiles): corrupt null → one untitled tab — covered by "falls back to one untitled tab when openFiles is null".
  - EC-7 (empty object): fully empty settings → one untitled tab — covered by "falls back to one untitled tab when settings object is empty".

---

## Review Request (step_06)

- **Files changed**:
  - `src/keybindings/keybindings-panel.ts` (modified) — added `tab-new`, `tab-close`, `tab-1` through `tab-9` to the `COMMANDS` array in the "File" section; each entry has a `defaultKey` and descriptive label
  - `src/main.ts` (modified) — redirected `case "file-new"` to `tabManager.openNewTab()` (AD-7, EC-19); added `case "tab-new"`, `case "tab-close"`, and `case "tab-1"` through `case "tab-9"` to `handleAction()`
  - `tests/tabs/keyboard-shortcuts.test.ts` (new) — 22 unit/integration tests covering FR-5.1, FR-5.2, FR-5.3, FR-8, AD-7, EC-8, EC-9, EC-19

- **Steps completed**: `step_01_core_state.md`, `step_02_minimal_tab_bar.md`, `step_03_regular_tab_bar.md`, `step_04_vertical_tab_strip.md`, `step_05_settings_persistence.md`, `step_06_keyboard_shortcuts.md`

- **Known limitations**:
  - The legacy `isDirty` / `setDirty()` path in `main.ts` is kept alive in parallel with `tabManager.markActiveTabDirty()`. Both run on every `docChanged` event until step_07 removes the legacy path. This is intentional per the spec.
  - `_mockWriteFile` and `_mockSaveFileDialog` unused-variable TS errors in `tests/tabs/tab-manager.test.ts` are pre-existing from step_01 and are not introduced by this step.
  - The `main.ts` TS6133 unused-import error for `eventMatchesKey` is pre-existing and not introduced by this step.
  - The old `newFile()` function in `main.ts` is NOT removed in this step — it is still referenced by `case "file-close-all"`. Removal is deferred to step_07 per spec.

- **Edge cases covered by tests** (step_06):
  - FR-5.1: `openNewTab()` called for "tab-new" — covered by "openNewTab() adds a second tab" spy test.
  - AD-7 / EC-19: Cmd-N resolves to "file-new" (not "tab-new"), and handleAction("file-new") now calls `tabManager.openNewTab()` — covered by `resolveAction` test for Cmd-N and redirect in main.ts.
  - FR-5.2: `closeTab()` silent no-op for unknown id — covered by "closeTab() is a no-op for an unknown id".
  - FR-5.3 / EC-8: `activateTabByIndex()` no-op for out-of-range index — covered by "is a no-op for out-of-range index" test.
  - EC-9: `activateTabByIndex(9)` with zero tabs → no crash — covered by "EC-9" test.
  - FR-8: All 11 new commands (tab-new, tab-close, tab-1..tab-9) resolve correctly from `resolveAction()` — covered by the parameterised COMMANDS list completeness tests.

---

## Review Request (step_07)

- **Files changed**:
  - `src/tabs/tab-manager.ts` (modified) — changed `import type { EditorView }` to value import; added import of `editableCompartment` from `../editor/extensions`; added `openContentTab(title, content, opts?)` public method for help-file tabs
  - `src/main.ts` (modified) — removed `currentFilePath`, `isDirty`, `isReadOnly`, `setDirty()`, `setCurrentFile()`, `newFile()`, `openHelpFile()`, `updateTitleBar()`; removed unused imports (`readFile`, `writeFile`, `saveFileDialog`, `addRecentFile`, `editableCompartment`, `setLivePreviewFilePath`, `eventMatchesKey`); rewrote `openFile()`, `openFileByPath()`, `openRecentFileByPath()`, `saveFile()`, `saveFileAs()` as tab-aware thin wrappers; added `openHelpFileInTab()`; updated `handleAction()` for `file-close-all`, `file-export`, and all `help-*` cases; replaced single-file drag-drop handler with multi-file loop calling `tabManager.openFileInTab()`; removed legacy `isDirty` path from updateListener; removed standalone `updateTitleBar()` call at end of `initApp()`
  - `tests/tabs/main-integration.test.ts` (new) — 19 unit tests covering FR-5.5, FR-5.6, EC-2, EC-4, EC-12, EC-14
  - `tests/tabs/tab-manager.test.ts` (modified) — extended live-preview mock to include `livePreviewExtension`, `tablePreviewField`, `viewModeField` (needed by transitive `extensions.ts` import)
  - `tests/tabs/keyboard-shortcuts.test.ts` (modified) — same live-preview mock extension
  - `tests/tabs/session-restore.test.ts` (modified) — same live-preview mock extension

- **Steps completed**: `step_01_core_state.md`, `step_02_minimal_tab_bar.md`, `step_03_regular_tab_bar.md`, `step_04_vertical_tab_strip.md`, `step_05_settings_persistence.md`, `step_06_keyboard_shortcuts.md`, `step_07_main_integration.md`

- **Known limitations**:
  - `tabMode`, `tabMode`, and `activeTabIndex` fields in `DEFAULT_SETTINGS` in `settings.ts` are not explicitly set to defaults (they remain `undefined` at the TypeScript level). `TabManager.init()` uses `?? "minimal"` / `?? 0` fallbacks, which is correct per the architecture note about TypeScript-only optional fields.

- **Edge cases covered by tests** (step_07):
  - FR-5.5 (open): `openFileInTab()` creates a new tab for a new path — "creates a new tab when the file is not yet open"
  - EC-4 (duplicate): `openFileInTab()` activates existing tab, no duplicate — "activates the existing tab if the path is already open", "returns false (not true) when an existing tab is re-activated"
  - EC-14 (drag-drop): `openFileInTab()` opens drag-and-drop path — "opens a new tab for drag-and-drop file path"; multiple files "open one new tab per unique path"
  - FR-5.5 (recent missing): read failure returns false and shows alert — "returns false and shows alert when the file cannot be read"; "distinguishes already-open from read-failed"
  - FR-5.6 (save): `saveActiveTab()` calls `writeFile` with correct path — "writes the file content to the active tab's path"; clears dirty flag — "marks the active tab clean after a successful write"; untitled redirects to save-as — "on an untitled tab opens the save-as dialog"
  - FR-5.6 (save-as): `saveActiveTabAs()` updates `filePath` after success — "updates the tab filePath after a successful save"; EC-12 cancel — "cancellation leaves the tab unchanged"
  - FR-5.6 (export): `getActiveFilePath()` returns correct value — "returns null for untitled tab", "returns the current file path after opening a file"
  - FR-5.2 / EC-2 (close-all): `closeTab()` on last tab calls `appWindow.close()` — "on the last clean tab calls appWindow.close()"; non-last tab does not — "removes one tab at a time without window close"
  - addRecentFile tracking: `addRecentFile` called on success — "calls addRecentFile with the opened path"; NOT called on failure — "does NOT call addRecentFile when file read fails"

---

## Review Request (step_08)

- **Files changed**:
  - `tests/tabs/soft-warning.test.ts` (new) — 12 unit/integration tests covering FR-9 and EC-17 across all three renderers
  - `src/tabs/renderers/regular-tab-bar.ts` (modified) — added `newBtnEl.title` assignment in `update()`: set to tab count message when over limit, reset to "New Tab (Cmd-T)" when under limit
  - `src/tabs/tabs.css` (modified) — extended `.tab-new-btn.tab-over-limit` with `position: relative`; added `.tab-new-btn.tab-over-limit::after` rule for the "!" badge

- **Steps completed**: All 8 steps — `step_01_core_state.md` through `step_08_soft_warning.md`

- **Known limitations**: None. All spec requirements for step_08 are implemented and tested.

- **Edge cases covered by tests** (step_08):
  - FR-9 (MinimalTabBar class): `tab-over-limit` added to container above threshold — "adds tab-over-limit class when tab count is one above threshold"
  - FR-9 (MinimalTabBar attribute): `data-tab-warning` set with count above threshold — "sets data-tab-warning attribute when tab count exceeds threshold"
  - FR-9 (MinimalTabBar below threshold): no class at 29 tabs — "does NOT add tab-over-limit class when tab count is below threshold"
  - FR-9 (MinimalTabBar toggle-off class): class removed when count drops from 31 to 30 — "removes tab-over-limit class when count drops from 31 to 30"
  - FR-9 (MinimalTabBar toggle-off attribute): data attribute deleted when count drops — "removes data-tab-warning attribute when count drops to threshold"
  - FR-9 (RegularTabBar class): `tab-over-limit` added to `.tab-new-btn` above threshold — "adds tab-over-limit class to .tab-new-btn when tab count exceeds threshold"
  - FR-9 (RegularTabBar class toggle-off): class removed on drop to threshold — "removes tab-over-limit from .tab-new-btn when count drops to threshold"
  - FR-9 (RegularTabBar tooltip set): `newBtn.title` contains count when over limit — "sets title tooltip on .tab-new-btn when over limit"
  - FR-9 (RegularTabBar tooltip reset): `newBtn.title` contains "Cmd-T" when back under limit — "resets title tooltip on .tab-new-btn when count drops to threshold"
  - FR-9 (VerticalTabStrip class): `tab-over-limit` added to strip above threshold — "adds tab-over-limit class to strip when tab count exceeds threshold"
  - FR-9 (VerticalTabStrip class toggle-off): class removed on drop to threshold — "removes tab-over-limit from strip when count drops to threshold"
  - EC-17 (session restore beyond threshold): 35 tabs restored and `tab-over-limit` visible on `#tab-strip` immediately after `init()` — "shows warning indicator after init() restores tabs beyond threshold"

---

## Review Sign-off

- **Date**: 2026-04-13
- **Reviewer**: Code Reviewer (Claude Sonnet 4.6)
- **Findings summary**: 0 Critical, 0 High, 3 Medium, 4 Low — all Medium items require fixes before merge; Low items documented below and accepted where noted.
- **Requirements traceability**: All FR-1 through FR-9, NFR-1 through NFR-5 items verified against implementation. All AD-1 through AD-8 architectural decisions implemented correctly.
- **Edge case coverage**: EC-1 through EC-20 reviewed; see findings below for gaps.
- **Status**: APPROVED WITH REQUIRED FIXES — the three Medium findings must be resolved before merge.

