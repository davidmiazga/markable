---
title: "Tabs Step 01 — Core State (TabEntry, ITabRenderer, TabManager skeleton)"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 01 — Core State

**Goal:** Define all types and the `TabManager` class with full logic but no renderer and no DOM manipulation. The app still behaves as a single-document editor after this step.

**App state after this step:** Compiles and runs; no visible behavior change. All tab logic is present but dormant because `tabManager.init()` is not yet called from `main.ts`.

---

## Files to Create

### `src/tabs/tab-types.ts`

Define all shared types. No imports from outside `src/tabs/`.

```typescript
import type { EditorState } from "@codemirror/state";

export interface TabEntry {
  id: string;                  // crypto.randomUUID()
  filePath: string | null;     // null = untitled
  title: string;               // filename without extension, or "Untitled"
  isDirty: boolean;
  editorState: EditorState;    // CM6 snapshot, captured on tab-away
  scrollTop: number;           // editorView.scrollDOM.scrollTop at last tab-away
}

export interface ITabRenderer {
  /**
   * Called once: build all DOM inside container and attach event listeners.
   * The container is always #tab-strip (horizontal modes) or a new element
   * inserted into #app-row (vertical mode).
   */
  mount(container: HTMLElement, tabs: TabEntry[], activeIndex: number): void;

  /**
   * Called after any state change (open/close/activate/dirty).
   * Implementations must re-render efficiently (diff or full innerHTML swap).
   */
  update(tabs: TabEntry[], activeIndex: number): void;

  /**
   * Called before mode switch or app teardown.
   * Remove all DOM added by mount(). Remove all event listeners.
   */
  destroy(): void;
}

/** Soft warning threshold. OD-4: value is 30, confirmed as candidate. Change here only. */
export const TAB_SOFT_WARNING_THRESHOLD = 30;
```

---

### `src/tabs/tab-manager.ts`

The `TabManager` class. Import `EditorState` and `EditorView` from CodeMirror. Import `ITabRenderer`, `TabEntry`, `TAB_SOFT_WARNING_THRESHOLD` from `./tab-types`. Import settings helpers from `../lib/settings`. Import `toggleSide` from `../sidebar`.

**Do NOT import any renderer class yet** — renderers are added in steps 02–04.

#### Module-level singleton

```typescript
export const tabManager = new TabManager();
```

#### Constructor

The constructor takes no arguments. It initializes:
- `private tabs: TabEntry[] = []`
- `private activeIndex: number = 0`
- `private editorView: EditorView | null = null`
- `private renderer: ITabRenderer | null = null`
- `private tabStripEl: HTMLElement | null = null`
- `private mode: "minimal" | "regular" | "vertical" = "minimal"`

#### `init(editorView: EditorView): Promise<void>`

This is the full async initialization method called from `main.ts`. Steps in order:

1. Store `editorView`.
2. Find `#tab-strip` in the DOM; store as `this.tabStripEl`. If not found, log error and return early — this is a programming error (the `index.html` change in step_02 must be in place).
3. Read `getCurrentSettings()`. Extract `tabMode` (default `"minimal"`), `openFiles` (default `[]`), `activeTabIndex` (default `0`).
4. Set `this.mode = tabMode`.
5. **Session restore** (FR-6): For each entry in `openFiles`:
   a. Call `readFile(entry.filePath)` (import from `../lib/bridge`).
   b. On success: create a `TabEntry` with `EditorState.create({ doc: content })`, `scrollTop: entry.scrollTop`, `filePath: entry.filePath`, `title` derived from path.
   c. On error (file missing, no permission): skip silently (EC-1, EC-6).
6. If no tabs were restored, create one untitled tab (FR-6.5).
7. Clamp `activeTabIndex` to valid range (FR-6.6).
8. Set `this.activeIndex`.
9. Instantiate the correct renderer based on `this.mode`. **In step_01, this is a no-op** (renderer is `null`). Renderers are wired in steps 02–04 via `setMode()`.
10. If `this.renderer !== null`: call `this.renderer.mount(this.tabStripEl, this.tabs, this.activeIndex)`.
11. Apply the active tab to the EditorView: call `this._applyActiveTab()`.

#### `_applyActiveTab(): void` (private)

Applies the currently active tab's state to the shared EditorView:
1. If `this.tabs.length === 0` or `this.editorView === null`: return.
2. Get `tab = this.tabs[this.activeIndex]`.
3. Call `this.editorView.setState(tab.editorState)`.
4. Set `this.editorView.scrollDOM.scrollTop = tab.scrollTop`.
5. Call `setLivePreviewFilePath(tab.filePath)` (import from `../editor/live-preview`).
6. Update the window title bar: call `this._updateTitleBar(tab)`.

**Note:** `setState()` replaces the entire CM6 state including history. This is correct — each tab has isolated undo history.

#### `_updateTitleBar(tab: TabEntry): void` (private)

```typescript
private _updateTitleBar(tab: TabEntry): void {
  const titleEl = document.getElementById("titlebar-title");
  if (!titleEl) return;
  const base = tab.title;
  titleEl.textContent = tab.isDirty ? `${base} •` : base;
}
```

#### `_captureActiveTab(): void` (private)

Called before switching away from a tab. Captures current editor state into the tab record:
1. If `this.tabs.length === 0` or `this.editorView === null`: return.
2. `tab = this.tabs[this.activeIndex]`.
3. `tab.editorState = this.editorView.state`.
4. `tab.scrollTop = this.editorView.scrollDOM.scrollTop`.

#### `_titleFromPath(filePath: string | null): string` (private)

```typescript
private _titleFromPath(filePath: string | null): string {
  if (!filePath) return "Untitled";
  const name = filePath.split("/").pop() ?? filePath;
  // Strip extension for display
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(0, dotIdx) : name;
}
```

#### `_createUntitledTab(): TabEntry` (private)

Creates a new empty TabEntry:
```typescript
private _createUntitledTab(): TabEntry {
  return {
    id: crypto.randomUUID(),
    filePath: null,
    title: "Untitled",
    isDirty: false,
    editorState: EditorState.create({ doc: "" }),
    scrollTop: 0,
  };
}
```

#### `openNewTab(): void`

1. Call `_captureActiveTab()`.
2. Create a new untitled tab via `_createUntitledTab()`.
3. Push to `this.tabs`.
4. Set `this.activeIndex = this.tabs.length - 1`.
5. Call `_applyActiveTab()`.
6. Call `_notifyRenderer()`.
7. Call `saveSession()` (fire-and-forget, `void`).

#### `openFileInTab(filePath: string): Promise<boolean>`

Returns `true` if a new tab was opened; returns `false` if an existing tab was activated (duplicate path, EC-4).

1. Resolve duplicates: check `this.tabs.find(t => t.filePath === filePath)`. If found:
   a. Call `_captureActiveTab()`.
   b. Set `this.activeIndex` to the found tab's index.
   c. Call `_applyActiveTab()`.
   d. Call `_notifyRenderer()`.
   e. Return `false`.
2. Read the file: `const result = await readFile(filePath)`. On failure: `alert(...)` and return `false`.
3. Call `_captureActiveTab()`.
4. Create new `TabEntry`:
   - `id`: `crypto.randomUUID()`
   - `filePath`: `filePath`
   - `title`: `_titleFromPath(filePath)`
   - `isDirty`: `false`
   - `editorState`: `EditorState.create({ doc: result.value })`
   - `scrollTop`: `0`
5. Push to `this.tabs`.
6. Set `this.activeIndex = this.tabs.length - 1`.
7. Call `_applyActiveTab()`.
8. Call `_notifyRenderer()`.
9. Call `addRecentFile(filePath)` (import from `../lib/settings`).
10. Call `saveSession()` (fire-and-forget).
11. Return `true`.

**Note on view mode:** After loading a file, dispatch `setViewMode.of(true)` effect to enter live preview mode and blur the editor, matching existing `openFileByPath` behavior.

#### `closeTab(id: string): Promise<void>`

1. Find `idx = this.tabs.findIndex(t => t.id === id)`. If `-1`: return.
2. If `this.tabs.length === 1`:
   a. If `this.tabs[0].isDirty`: show confirmation dialog. On cancel: return. On confirm: continue.
   b. Close the window: `import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"` and call `appWindow.close()`. Return.
3. If `this.tabs[idx].isDirty`: show confirmation dialog (same pattern as `file-close-all`). On cancel: return.
4. Call `_captureActiveTab()` (to preserve state of currently active tab if different from closing tab).
5. Remove `this.tabs[idx]` from the array.
6. Recalculate `this.activeIndex`:
   - If `idx < this.activeIndex`: `this.activeIndex -= 1`.
   - Else if `idx === this.activeIndex`: `this.activeIndex = Math.min(this.activeIndex, this.tabs.length - 1)`.
7. Call `_applyActiveTab()`.
8. Call `_notifyRenderer()`.
9. Call `saveSession()` (fire-and-forget).

#### `activateTab(id: string): void`

1. Find `idx = this.tabs.findIndex(t => t.id === id)`. If `-1`: return.
2. If `idx === this.activeIndex`: return (no-op).
3. Call `_captureActiveTab()`.
4. Set `this.activeIndex = idx`.
5. Call `_applyActiveTab()`.
6. Call `_notifyRenderer()`.
7. Call `saveSession()` (fire-and-forget).

#### `activateTabByIndex(oneBased: number): void`

```typescript
activateTabByIndex(oneBased: number): void {
  if (this.tabs.length === 0) return;
  // Cmd-9 → last tab convention (FR-5.3)
  const idx = oneBased >= 9 ? this.tabs.length - 1 : oneBased - 1;
  // EC-8: out of range → no-op
  if (idx < 0 || idx >= this.tabs.length) return;
  this.activateTab(this.tabs[idx].id);
}
```

#### `saveActiveTab(): Promise<void>`

1. `const tab = this.getActiveTab()`. If null: return.
2. If `tab.filePath === null`: delegate to `saveActiveTabAs()`. Return.
3. Get content: `this.editorView!.state.doc.toString()`.
4. Call `writeFile(tab.filePath, content)`. On error: `alert(...)`.
5. On success: `tab.isDirty = false`. Call `_updateTitleBar(tab)`. Call `_notifyRenderer()`.
6. Call `addRecentFile(tab.filePath)`.
7. Call `saveSession()` (fire-and-forget).

#### `saveActiveTabAs(): Promise<void>`

1. Call `saveFileDialog()` (import from `../lib/bridge`). On cancel: return (EC-12).
2. `const path = result.path`.
3. Get content: `this.editorView!.state.doc.toString()`.
4. Call `writeFile(path, content)`. On error: `alert(...)`.
5. On success:
   a. `tab.filePath = path`.
   b. `tab.title = _titleFromPath(path)`.
   c. `tab.isDirty = false`.
   d. Call `_updateTitleBar(tab)`.
   e. Call `_notifyRenderer()`.
   f. Call `addRecentFile(path)`.
   g. Call `setLivePreviewFilePath(path)`.
6. Call `saveSession()` (fire-and-forget).

#### `markActiveTabDirty(): void`

```typescript
markActiveTabDirty(): void {
  const tab = this.getActiveTab();
  if (!tab || tab.isDirty) return;
  tab.isDirty = true;
  this._updateTitleBar(tab);
  this._notifyRenderer();
}
```

#### `markActiveTabClean(): void`

```typescript
markActiveTabClean(): void {
  const tab = this.getActiveTab();
  if (!tab || !tab.isDirty) return;
  tab.isDirty = false;
  this._updateTitleBar(tab);
  this._notifyRenderer();
}
```

#### `setMode(mode: "minimal" | "regular" | "vertical"): void`

Mode switching logic. Full renderer swap:

1. If `mode === this.mode`: return (no-op).
2. If `this.mode === "vertical"`: call `toggleSide("left", true)` via SidebarManager to restore left sidebar (EC-10).
   - Import `toggleSide` from `../sidebar/sidebar-manager` (direct internal import — tabs is not a plugin).
3. If `this.renderer !== null`: call `this.renderer.destroy()`.
4. Set `this.mode = mode`.
5. Persist: `await updateSettings(s => ({ ...s, tabMode: mode }))`.
6. If `mode === "vertical"`:
   a. Call `toggleSide("left", false)` to hide left sidebar (AD-4).
   b. The VerticalTabStrip will render into its own element in `#app-row`.
7. Instantiate new renderer based on mode. Mount it.
8. Call `_notifyRenderer()` to bring it up to date.

**In step_01:** `setMode` does nothing for renderer (no renderers exist yet). The mode is stored and persisted.

#### `saveSession(): Promise<void>`

Persists current session to `MarkableSettings` (FR-6.7):

```typescript
async saveSession(): Promise<void> {
  const openFiles = this.tabs
    .filter(t => t.filePath !== null)
    .map(t => ({ filePath: t.filePath!, scrollTop: t.scrollTop }));

  await updateSettings(s => ({
    ...s,
    openFiles,
    activeTabIndex: this.activeIndex,
  }));
}
```

#### `_notifyRenderer(): void` (private)

```typescript
private _notifyRenderer(): void {
  if (!this.renderer || !this.tabStripEl) return;
  this.renderer.update(this.tabs, this.activeIndex);
}
```

#### Accessors

```typescript
getActiveTab(): TabEntry | null {
  return this.tabs[this.activeIndex] ?? null;
}
getActiveFilePath(): string | null {
  return this.getActiveTab()?.filePath ?? null;
}
getTabs(): TabEntry[] {
  return this.tabs;
}
getTabCount(): number {
  return this.tabs.length;
}
```

---

### `src/tabs/index.ts`

```typescript
export { TabManager, tabManager } from "./tab-manager";
export type { TabEntry, ITabRenderer } from "./tab-types";
export { TAB_SOFT_WARNING_THRESHOLD } from "./tab-types";
```

---

## Tests to Write (`tests/tabs/tab-manager.test.ts`)

All tests use Vitest. Mock `readFile`, `writeFile`, `saveFileDialog`, `addRecentFile`, `updateSettings`, `getCurrentSettings`, `setLivePreviewFilePath`. Provide a minimal `EditorView` mock.

| Test | Covers |
|---|---|
| `_titleFromPath` with null → "Untitled" | FR-1 |
| `_titleFromPath` with `/foo/bar/doc.md` → "doc" | FR-1 |
| `openNewTab` creates tab and increments count | FR-5.1 |
| `openFileInTab` with already-open path activates existing, returns false | EC-4 |
| `closeTab` with one tab calls window close | EC-2 |
| `closeTab` with dirty last tab shows confirm dialog | EC-3 |
| `closeTab` recalculates activeIndex correctly when closing left-of-active | FR-5.2 |
| `activateTabByIndex(9)` with 3 tabs activates index 2 | FR-5.3 |
| `activateTabByIndex(5)` with 3 tabs is no-op | EC-8 |
| `activateTabByIndex(9)` with 1 tab activates index 0 | EC-9 |
| `markActiveTabDirty` is idempotent | FR-7 |
| `saveSession` writes only tabs with filePath | FR-6.2, FR-6.3 |
| `init` skips files that fail readFile | EC-1, EC-6 |
| `init` falls back to untitled tab when all restore files missing | FR-6.5 |

---

## Verification

After implementing step_01:
1. Run `npm run tauri dev` — app opens normally as single-document editor.
2. No TypeScript errors (`tsc --noEmit`).
3. No runtime console errors.
4. All new Vitest tests pass.
