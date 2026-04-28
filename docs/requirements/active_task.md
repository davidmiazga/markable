---
title: "Media File Preview — VSCode-Style Content Area (Replaces Sidebar Panel)"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Media File Preview — VSCode-Style Content Area

## Validation Status

**VALIDATED — requirements approved for handoff.**

---

## 1. Feature Summary

As a user I want clicking an image, PDF, or other non-markdown asset in the file
browser to open that file as a tab in the main content area — exactly as VSCode
does — so I can view it at full size while keeping the file browser sidebar open.

---

## 2. Background and Codebase Context

### 2.1 What Was Built and Why It Is Being Replaced

The previous implementation (now superseded) injected a fixed 200px
`file-browser-media-preview` panel at the bottom of the file browser sidebar.
This was rejected by the user as the wrong UX. The entire sidebar-preview
approach — `showMediaPreview()`, `closeMediaPreview()`, `_previewedPath`,
`file-browser-media-preview` CSS, and `fbmp-*` CSS classes — is removed by
this change.

### 2.2 Relevant DOM Layout

At runtime the page DOM structure around the editor is:

```
<body>
  <div id="titlebar">…</div>
  <div id="tab-strip">…</div>          <!-- tab renderer mounts here -->
  <div id="app">
    <div id="app-row">                  <!-- created by initSidebar() -->
      <div id="sidebar-left">…</div>
      <div id="editor">…</div>          <!-- CodeMirror mounts here -->
      <div id="sidebar-right">…</div>
    </div>
    <div id="statusbar">…</div>
  </div>
</body>
```

`#editor` is a flex child of `#app-row` with `flex: 1`. It is the sole
non-sidebar element in the content area.

### 2.3 Tab System Architecture

`TabManager` (in `src/tabs/tab-manager.ts`) owns the ordered list of open
`TabEntry` objects and the single shared `EditorView` instance. The CM6
`EditorView` is always mounted in `#editor` and is never destroyed. Tab
switching is performed by dispatching a transaction that replaces the
document text in the shared view.

`TabEntry` (in `src/tabs/tab-types.ts`) currently has the following shape:

```typescript
interface TabEntry {
  id: string;
  filePath: string | null;
  title: string;
  isDirty: boolean;
  doc: string;
  scrollTop: number;
}
```

There is no `kind` field. All tabs today are text/editor tabs.

### 2.4 The File Browser Plugin Is an IIFE

`file-browser.plugin.ts` is compiled to an IIFE and cannot import from
`tab-manager.ts` at runtime. It reaches the tab manager exclusively via
`window.__MARKABLE_TAB_MANAGER__`. Any new method added to `TabManager` must
also be exposed on that window global (the assignment in `main.ts` assigns the
entire `tabManager` instance, so new methods are available automatically with no
change to `main.ts`).

### 2.5 `openFileInTab` Crashes on Binary Files

`openFileInTab` calls `readFile()` (Rust `read_file` → `fs::read_to_string`),
which fails with `InvalidData` on binary files. Media files must never go through
`openFileInTab`. The new code path for media files must bypass all text-reading
logic.

### 2.6 Existing Window Globals Available in the IIFE

- `window.__MARKABLE_TAB_MANAGER__` — the `TabManager` singleton
- `window.__MARKABLE_CONVERT_FILE_SRC__(path)` — converts an absolute path to an `asset://` URL

---

## 3. Design Decisions

### 3.1 A New Tab Kind

`TabEntry` gains a discriminated-union `kind` field:

```typescript
type TabKind = "editor" | "media";
```

All current tabs are `kind: "editor"`. A new `kind: "media"` tab holds a file
path and a display title but no `doc` text (the content area renders an HTML
viewer element, not a CM6 editor state).

### 3.2 DOM Strategy: Sibling Viewer Panel Inside `#editor`

The CM6 editor (`div.cm-editor`) lives inside `#editor` as a child element
inserted by CodeMirror. Rather than moving the `EditorView` or manipulating
`#app-row`, a new `div#media-viewer` is inserted as a sibling of `div.cm-editor`
inside `#editor`. The two children of `#editor` are mutually exclusive:

- When a `kind: "editor"` tab is active, `div.cm-editor` has `display: flex`
  (its normal value) and `div#media-viewer` has `display: none`.
- When a `kind: "media"` tab is active, `div.cm-editor` has `display: none`
  and `div#media-viewer` has `display: flex`.

`#editor` keeps `flex: 1` and fills the content area exactly as before. No
changes to `index.html`, `#app-row`, or the sidebar layout are required.

`div#media-viewer` is created once by `TabManager.init()`, inserted into
`#editor`, and toggled via CSS class rather than inline style. `TabManager`
adds class `has-media-tab` to `#editor` when the active tab is `kind: "media"`,
and removes it when switching back to an editor tab. The styles that show/hide
the two panels live in `src/tabs/tabs.css`:

```css
/* Default: editor visible, viewer hidden */
#media-viewer { display: none; }
/* When a media tab is active */
#editor.has-media-tab .cm-editor { display: none; }
#editor.has-media-tab #media-viewer { display: flex; }
```

### 3.3 TabManager Gets One New Public Method

`TabManager` gains a single new public method:

```typescript
openMediaInTab(filePath: string): boolean
```

This method:
1. Checks for a duplicate-path guard (same as `openFileInTab` EC-4 equivalent).
2. Creates a `TabEntry` with `kind: "media"`, `doc: ""`, `filePath`, and a title
   derived from `_titleFromPath(filePath)`.
3. Pushes the tab, updates `activeIndex`, calls `_notifyRenderer()`.
4. Calls a new private method `_applyActiveTab()` that already handles both
   kinds (see FR-4 below).
5. Returns `true` if a new tab was created, `false` if an existing media tab for
   the same path was activated.

The method does NOT call `readFile()` and does NOT access the `EditorView`
document. It only populates the viewer element.

### 3.4 Sidebar Preview Code Is Fully Removed

All of the following are deleted in this change:

- The `file-browser-media-preview` CSS block and all `fbmp-*` CSS rules
  from `FILE_BROWSER_CSS` in `file-browser.plugin.ts`.
- The module-level variable `_previewedPath`.
- The functions `showMediaPreview()` and `closeMediaPreview()`.
- All call sites of `closeMediaPreview()` (in `renderPanel()`, `destroy()`,
  `_vaultChangedCb`).
- The `buildActivateHandler` branch that called `showMediaPreview` / `closeMediaPreview`.
- The test file `tests/plugins/file-browser/media-preview.test.ts`.

The `buildActivateHandler` non-md branch is replaced with a single call:
```typescript
void (window as any).__MARKABLE_TAB_MANAGER__?.openMediaInTab?.(path);
```

The active-highlight logic in `buildNodeEl` that read `_previewedPath` is removed.
Only `_activeFile` (the currently open `.md` tab path) continues to drive
`tree-node-active`. Non-md files no longer receive a special active highlight
in the sidebar when their tab is open; this matches VSCode's behaviour.

### 3.5 Session Persistence for Media Tabs

Media tabs are excluded from `saveSession()` serialization (same rule as
`openContentTab` — no `filePath`-based persistence for non-editor tabs). When
Markable restarts, media tabs are not restored. This is consistent with VSCode,
which also does not restore binary-file tabs across restarts.

---

## 4. Functional Requirements

### FR-1 — New `TabEntry.kind` Field

`tab-types.ts` gains a `kind` field on `TabEntry`:

```typescript
export type TabKind = "editor" | "media";

export interface TabEntry {
  id: string;
  kind: TabKind;           // NEW — defaults to "editor" for all existing tabs
  filePath: string | null;
  title: string;
  isDirty: boolean;
  doc: string;
  scrollTop: number;
}
```

All existing `TabEntry` construction sites in `tab-manager.ts`
(`_createUntitledTab`, `openFileInTab`, `openContentTab`, session restore) must
add `kind: "editor"` explicitly. No runtime breakage is acceptable.

### FR-2 — `div#media-viewer` Created Once in `TabManager.init()`

`TabManager.init()` creates a `div` with `id="media-viewer"` and appends it
as a child of `#editor` after the CM6 editor mounts (the CM6 `EditorView` is
passed to `init()` so `#editor` is already populated by then). The element
starts with no special class (hidden by the default CSS rule `display: none`).

The viewer element is created once for the app lifetime. It is not destroyed on
tab close or vault switch.

### FR-3 — `TabManager.openMediaInTab(filePath)` Public Method

```typescript
openMediaInTab(filePath: string): boolean
```

Behaviour:

1. **Duplicate guard**: if any existing tab has `kind: "media"` and
   `filePath === filePath`, activate that tab and return `false`.
2. Capture the current active tab via `_captureActiveTab()`.
3. Create a new `TabEntry`:
   ```typescript
   {
     id: crypto.randomUUID(),
     kind: "media",
     filePath,
     title: this._titleFromPath(filePath),
     isDirty: false,
     doc: "",
     scrollTop: 0,
   }
   ```
4. Push the tab, set `activeIndex` to its position.
5. Call `_applyActiveTab()` — the modified version (see FR-4) handles the
   media case.
6. Call `_notifyRenderer()`.
7. Call `addRecentFile(filePath)` (non-blocking, void).
8. Call `saveSession()` (non-blocking, void) — the session serialization
   filter already excludes media tabs because `saveSession` only saves
   `kind: "editor"` tabs with a `filePath`.

   > Note: `saveSession()` must be updated to filter `t.kind === "editor" && t.filePath !== null` instead of the current `t.filePath !== null` to ensure a future media tab with a non-null `filePath` is never accidentally serialised.

9. Return `true`.

The auto-close-clean-Untitled logic that exists in `openFileInTab` (removes the
Untitled tab when opening the first real file) also applies to
`openMediaInTab`. If, after pushing the media tab, exactly two tabs exist and
the other tab is `kind: "editor"`, `filePath === null`, and `isDirty === false`,
remove it and recalculate `activeIndex`.

### FR-4 — `_applyActiveTab()` Updated for Media Tabs

The existing `_applyActiveTab()` dispatches a document-replacement transaction
into the `EditorView`. For media tabs this must not happen (the CM6 editor
should not receive binary content).

Updated logic:

```
if (tab.kind === "media") {
  // 1. Hide the CM6 editor; show the media viewer.
  editorContainer.classList.add("has-media-tab");
  // 2. Populate #media-viewer with the appropriate element.
  _renderMediaViewer(tab.filePath!);
  // 3. Update the title bar.
  _updateTitleBar(tab);
} else {
  // Existing editor-tab path (unchanged).
  editorContainer.classList.remove("has-media-tab");
  // ... existing dispatch transaction ...
}
```

`editorContainer` is `document.getElementById("editor")` — looked up once in
`init()` and stored, matching the pattern already used for `tabStripEl`.

### FR-5 — `_renderMediaViewer(filePath)` Private Method

Creates or replaces the content of `div#media-viewer`. Must be synchronous.

Routing table (extension matching is case-insensitive):

| Category | Extensions | Rendered element |
|---|---|---|
| Raster image | jpg, jpeg, png, gif, webp, bmp, ico | `<img src="{asset_url}" alt="{basename}">` |
| SVG | svg | `<img src="{asset_url}" alt="{basename}">` |
| PDF | pdf | `<embed src="{asset_url}" type="application/pdf">` |
| Unsupported | everything else | `<p class="mv-unsupported">Cannot preview this file type.</p>` |

The asset URL is produced by `convertFileSrc(filePath)` (available as a direct
import from `@tauri-apps/api/core` — `tab-manager.ts` is NOT an IIFE and can
import app internals directly).

The viewer element is cleared (`innerHTML = ""`) before each render to prevent
stale content when switching between media tabs.

The `<img>` element uses inline style `object-fit: contain; max-width: 100%;
max-height: 100%` so images are proportionally scaled within the content area
at any window size. No explicit `width` or `height` attributes.

An `error` event listener on `<img>` and `<embed>` replaces the viewer content
with `<p class="mv-load-error">Could not load file.</p>` (see EC-05).

### FR-6 — Media Viewer CSS in `src/tabs/tabs.css`

New rules added to `tabs.css`:

```css
/* Media viewer: fills #editor when a media tab is active */
#media-viewer {
  display: none;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: auto;
  align-items: center;
  justify-content: center;
  background: var(--bg-color);
  padding: var(--content-padding, 24px);
  box-sizing: border-box;
}

#editor.has-media-tab .cm-editor {
  display: none;
}

#editor.has-media-tab #media-viewer {
  display: flex;
}

#media-viewer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

#media-viewer embed {
  width: 100%;
  height: 100%;
  display: block;
}

.mv-unsupported,
.mv-load-error {
  font-size: 14px;
  color: var(--text-muted);
  font-family: var(--ui-font);
  text-align: center;
}
```

No hardcoded hex colors. No hardcoded font families.

### FR-7 — Closing a Media Tab

`closeTab(id)` already handles all tab types. For media tabs:

- If the media tab is the last tab and a vault is active: tabs drop to 0,
  `activeIndex` to -1, renderer notified. `_applyActiveTab()` with zero tabs
  calls a new guard to remove `has-media-tab` from `#editor` and clear
  `#media-viewer` (so the CM6 editor is visible again for the next file opened).
- If the media tab is the last tab and no vault is active: existing window-close
  path unchanged.
- If other tabs remain: after tab removal and `activeIndex` recalculation, the
  new active tab determines whether `has-media-tab` is added or removed in
  `_applyActiveTab()`.

A media tab's `isDirty` is always `false` — no confirmation dialog is shown on
close. The dirty-check guard in `closeTab` must be updated:
```typescript
if (tab.isDirty && tab.kind !== "media") { /* show confirm */ }
```

### FR-8 — `_captureActiveTab()` Skips Media Tabs

The existing `_captureActiveTab()` reads `editorView.state.doc.toString()` and
the scroll position. For media tabs, neither field is meaningful. The method
must short-circuit when `tab.kind === "media"` rather than writing garbage into
`tab.doc`.

### FR-9 — `saveSession()` Filters to Editor Tabs Only

The filter expression:
```typescript
this.tabs.filter((t) => t.filePath !== null)
```
becomes:
```typescript
this.tabs.filter((t) => t.kind === "editor" && t.filePath !== null)
```

### FR-10 — Renderers Receive No Changes

All three renderers (`MinimalTabBar`, `RegularTabBar`, `VerticalTabStrip`)
iterate over `tabs: TabEntry[]` and render one button/pill per tab. They read
`tab.title`, `tab.id`, `tab.isDirty`, and `activeIndex`. None of these properties
change meaning for media tabs. Renderers do not need modification. A media tab
appears in the tab strip with its filename title, no dirty bullet, and standard
close-button behaviour — identical to a read-only content tab.

### FR-11 — File Browser Plugin: Routing Update

In `buildActivateHandler` inside `file-browser.plugin.ts`, the non-md branch is
replaced entirely:

```typescript
// Before (removed):
if (_previewedPath === path) {
  closeMediaPreview();
} else {
  showMediaPreview(path);
}

// After:
void (window as any).__MARKABLE_TAB_MANAGER__?.openMediaInTab?.(path);
```

No other changes to `file-browser.plugin.ts` routing logic are required.

### FR-12 — Remove All Sidebar Preview Code

The following are deleted from `file-browser.plugin.ts`:

1. Module-level variable `let _previewedPath: string | null = null;`
2. Function `showMediaPreview(path: string): void` (approx. lines 1554–1660)
3. Function `closeMediaPreview(): void` (approx. lines 1506–1527)
4. CSS block `/* ── Media Preview Panel … */` through to end of `fbmp-*` rules
   (approx. CSS lines 517–577 of the `FILE_BROWSER_CSS` constant)
5. In `buildNodeEl`: the `|| node.path === _previewedPath` predicate in the
   `tree-node-active` condition
6. In `renderPanel`: the `closeMediaPreview()` call before `innerHTML = ""`
7. In `_vaultChangedCb` (or `onVaultChanged`): the `closeMediaPreview()` call
8. In `destroy`: the `closeMediaPreview()` call

### FR-13 — Remove `tests/plugins/file-browser/media-preview.test.ts`

The test file for the old sidebar preview feature is deleted entirely, as the
feature it tested no longer exists.

### FR-14 — New Test Coverage

New tests are added to `tests/plugins/file-browser/file-browser.test.ts`:

- Non-md file click calls `window.__MARKABLE_TAB_MANAGER__.openMediaInTab(path)`.
- `.md` file click still calls `window.__MARKABLE_TAB_MANAGER__.openFileInTab(path)`.
- The `_previewedPath` symbol is no longer exported by `_testing`.

New tests are added to a new file `tests/tabs/media-tab.test.ts`:

- `openMediaInTab` creates a `kind: "media"` tab with correct title.
- `openMediaInTab` activates an existing media tab if path already open (duplicate guard).
- `openMediaInTab` auto-removes a clean Untitled editor tab when it is the only other tab.
- `_applyActiveTab` adds `has-media-tab` class to `#editor` for a media tab.
- `_applyActiveTab` removes `has-media-tab` class when switching back to an editor tab.
- `_captureActiveTab` does not read `editorView.state.doc` when tab is `kind: "media"`.
- `saveSession` excludes media tabs from the serialized `openFiles` list.
- `closeTab` on a media tab does not show a confirm dialog.
- `closeTab` on the last media tab (vault active) drops to 0 tabs and clears `#media-viewer`.

---

## 5. Out of Scope (v1)

- Audio playback (`<audio>` element) for `.mp3`, `.wav`, `.ogg`, etc.
- Video playback (`<video>` element) for `.mp4`, `.mov`, etc.
- Zoom / pan controls on images.
- PDF page navigation controls (native browser embed only).
- File size or pixel dimension display in the tab title or a status bar entry.
- A "reveal in Finder" or "copy asset URL" button in the media viewer.
- Resizing the viewer (the content area is always full-width).
- Persisting open media tabs across app restarts.
- Media tabs opened from sources other than the file browser (e.g., drag-and-drop).
- A thumbnail or inline preview remaining in the sidebar when a media tab is open.
- Preview of files outside the active vault.

---

## 6. Edge Case Inventory

**EC-01: Non-md file already open in a media tab — user clicks it again in the
file browser.** `openMediaInTab` finds the existing tab via the duplicate-path
guard, activates it, and returns `false`. No second tab is created.

**EC-02: User closes the media tab, then re-clicks the file in the file browser.**
The previous media tab no longer exists. `openMediaInTab` creates a fresh tab.
The `#media-viewer` is re-populated. Normal flow.

**EC-03: Media file is deleted between file-browser render and the user clicking
it.** `openMediaInTab` succeeds (no disk read). The `<img>` or `<embed>` fires an
`error` event. `_renderMediaViewer`'s error listener replaces the viewer content
with `<p class="mv-load-error">Could not load file.</p>`. No crash.

**EC-04: Non-md file with no extension (e.g., `Makefile`, `LICENSE`).** Extension
lookup finds no match. The "unsupported" path renders
`<p class="mv-unsupported">Cannot preview this file type.</p>`. A media tab is
still created with the correct filename title. No crash. No text-read attempted.

**EC-05: Non-md file with an uppercase extension (e.g., `photo.JPG`, `report.PDF`).** Extension check uses `.toLowerCase()`. File is correctly routed to raster-image
or PDF rendering. The `asset://` URL is passed with the original case preserved.

**EC-06: Multiple media tabs open simultaneously (e.g., image.png, diagram.svg,
notes.pdf).** Each is a separate `TabEntry` with `kind: "media"`. Switching
between them calls `_applyActiveTab()` each time, which re-populates
`#media-viewer` for each tab. No stale content remains. Each tab button appears
in the tab strip renderer.

**EC-07: User switches from a media tab to an editor tab.** `_applyActiveTab()`
removes the `has-media-tab` class from `#editor`. The `cm-editor` becomes
visible again. `#media-viewer` is hidden. The CM6 editor receives the correct
document dispatch. Title bar updated to the editor tab's title.

**EC-08: User switches from an editor tab to a media tab.** `_captureActiveTab()`
correctly saves the editor tab's doc and scroll position before switching.
`_applyActiveTab()` adds `has-media-tab`, populates `#media-viewer`, and does
NOT dispatch a doc-replacement transaction to the CM6 editor. The editor's
current doc is preserved for when the user switches back.

**EC-09: Vault is switched while a media tab is open.** Vault change fires
`onVaultChanged`. The file browser re-renders. Any media tab for a file in the
old vault remains open (consistent with VSCode — switching vault does not close
tabs). The user can close it manually. The vault file browser does not show
a stale active highlight for the media file because `_previewedPath` no longer
exists.

**EC-10: `openMediaInTab` called before `TabManager.init()` completes.** The
`editorView` field is `null` and `this.editorContainer` would be `null`.
`openMediaInTab` must guard on `this.editorContainer !== null` before calling
`_applyActiveTab()`. If the guard fires, the tab is pushed to the array but not
displayed; on `init()` completion `_applyActiveTab()` is called normally.

**EC-11: `convertFileSrc` is unavailable (hypothetical startup ordering bug).**
`tab-manager.ts` is a compiled module, not an IIFE — `convertFileSrc` is a
direct ES module import from `@tauri-apps/api/core`. It cannot be absent unless
the Tauri API package is broken. No guard required; failure is a hard import
error that surfaces at module load time.

**EC-12: Media tab is the only open tab and the user closes it — vault is NOT
active.** Existing `closeTab` last-tab + no-vault path closes the window via
`appWindow.close()`. This path is unchanged and correct.

**EC-13: Media tab is the only open tab and the user closes it — vault IS active.**
Existing `closeTab` last-tab + vault path drops to `tabs = []`, `activeIndex = -1`,
notifies renderer. `_applyActiveTab()` early-returns when `tabs.length === 0`.
The new zero-tab guard must also remove `has-media-tab` from `#editor` and call
`_clearMediaViewer()` so the CM6 editor is visible (ready for the next file
the user opens from the file browser).

**EC-14: Rapid successive clicks on different non-md files in the file browser.**
Each click calls `openMediaInTab`. The first call pushes a new tab; subsequent
calls for different paths push additional tabs (they are not duplicates). For the
same path the duplicate guard activates the existing tab. All operations are
synchronous on the JS thread. No race condition.

**EC-15: `openMediaInTab` called for a path that is currently open as a
`kind: "editor"` tab (e.g., a `.md` file renamed to `.png` outside the app).**
The duplicate guard checks `kind: "media"` AND `filePath`. A `kind: "editor"`
tab with the same path is not considered a duplicate. A new media tab is
created. Two tabs with the same `filePath` but different `kind` co-exist. This
is an edge case that does not require special handling in v1.

**EC-16: Session restore on next launch — media tabs are absent from saved state.**
`saveSession` filters to `kind: "editor"` tabs only. On next launch the session
restore loop sees no entry for the media file. The media tab is not re-created.
This is correct and intentional.

---

## 7. Non-Functional Requirements

**NFR-1: No Tauri IPC in the media-tab open path.** `openMediaInTab` is entirely
synchronous (no `readFile` call, no `invoke` call). The only async work is the
browser's native load of the `asset://` URL inside the `<img>` or `<embed>`.

**NFR-2: One `EditorView` for the app lifetime.** This change does not create a
second `EditorView`. The invariant documented in `tab-manager.ts` line 1 is
preserved.

**NFR-3: No orphaned DOM.** `div#media-viewer` is created once in `init()` and
never removed. Its `innerHTML` is replaced (not appended) on each media tab
activation. On switch back to an editor tab, `innerHTML` is cleared. No element
accumulation.

**NFR-4: CSS variable compliance.** All colors, backgrounds, and fonts in
`tabs.css` media-viewer rules use CSS variables from the existing Markable
theme system. No hardcoded hex colors.

**NFR-5: Renderer unchanged.** The `ITabRenderer` interface, and all three
renderer implementations, must not be modified. A media tab is visually
indistinguishable from a read-only content tab in the tab strip.

**NFR-6: Test coverage.** All 16 edge cases in the Edge Case Inventory must have
a corresponding test assertion (unit or integration, in jsdom). EC-03 (file
deleted) and EC-11 (convertFileSrc) are covered with mocked `convertFileSrc`
returning a URL whose load triggers an error event.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 16 items (EC-01 through EC-16)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
