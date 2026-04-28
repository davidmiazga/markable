---
title: "Media File Preview v2 — VSCode-Style Content Area"
last-updated: "2026-04-27"
review-cadence-days: 7
status: reference
---

# Media File Preview v2 — Architecture Overview

## Requirements Source

`docs/requirements/active_task.md` — validated 2026-04-27.

---

## 1. Change Inventory (Files Modified / Deleted / Created)

### Modified

| File | Nature of change |
|---|---|
| `src/tabs/tab-types.ts` | Add `TabKind` type and `kind` field to `TabEntry` |
| `src/tabs/tab-manager.ts` | New `#editorContainer` field; new `openMediaInTab`, `_renderMediaViewer`, `_clearMediaViewer`; update `_applyActiveTab`, `_captureActiveTab`, `closeTab`, `saveSession`, `init`, and all `TabEntry` construction sites |
| `src/tabs/tabs.css` | Append media-viewer CSS rules |
| `src/plugins/file-browser/file-browser.plugin.ts` | Remove sidebar preview code block (see section 6); replace `buildActivateHandler` non-md branch |
| `tests/plugins/file-browser/file-browser.test.ts` | Add three new tests for updated routing behaviour |

### Deleted

| File | Reason |
|---|---|
| `tests/plugins/file-browser/media-preview.test.ts` | Tests the old sidebar-preview feature, which is entirely removed |

### Created

| File | Purpose |
|---|---|
| `tests/tabs/media-tab.test.ts` | Unit tests for all new `TabManager` behaviour |

---

## 2. Design Decision Record

### 2.1 Where `div#media-viewer` is injected

**Decision: `TabManager.init()` injects it once, unconditionally.**

Rationale: the viewer element is a permanent part of the `#editor` DOM, not a feature that should exist only after a media file is opened. Creating it in `init()` means `_applyActiveTab()` can always find it via the pre-stored `#editorContainer` reference without a null-check. Lazy creation in `openMediaInTab` would require an extra guard everywhere the element is accessed and makes the "zero tabs, last media tab closed" teardown path (EC-13) more complex.

Implementation: at the end of `init()`, after the `EditorView` has mounted (and therefore `#editor` already contains `div.cm-editor`), `TabManager.init()` calls:

```typescript
const mv = document.createElement("div");
mv.id = "media-viewer";
this.#editorContainer!.appendChild(mv);
```

The element starts hidden because `tabs.css` contains `#media-viewer { display: none; }` as the default rule.

### 2.2 CSS toggle mechanism

**Decision: CSS class `has-media-tab` on `#editor`, toggled by `_applyActiveTab`.**

Rationale: a single class toggle on the container is idempotent, survives renderer swaps, and avoids inline style mutations that would conflict with each other when both elements need to change simultaneously. The class approach also means the rules are entirely declarative and live in one CSS file.

Exact rules added to `src/tabs/tabs.css`:

```css
#media-viewer          { display: none; /* default — editor tab active */ }

#editor.has-media-tab .cm-editor    { display: none; }
#editor.has-media-tab #media-viewer { display: flex; }
```

The `#editor` element is looked up once in `init()` and stored as `this.#editorContainer`. Toggling is always `this.#editorContainer.classList.add/remove("has-media-tab")`.

### 2.3 `openMediaInTab` deduplication

**Decision: yes, deduplicate by `kind === "media" && filePath`.**

If the same path is already open as a `kind: "media"` tab, `openMediaInTab` activates that tab (via `activateTab`) and returns `false`. The duplicate guard explicitly checks `kind` because a `kind: "editor"` tab with the same path is not considered a duplicate (EC-15 from requirements).

### 2.4 Tab title for media tabs

**Decision: reuse the existing private `_titleFromPath` with one modification.**

The current `_titleFromPath` strips the file extension (e.g. `/notes/photo.jpg` → `"photo"`). Per the requirements, media tabs display the full filename including extension (e.g. `photo.jpg`). The requirements specify `title: this._titleFromPath(filePath)` in FR-3, but that produces extension-stripped names.

**Resolution:** the requirements doc at FR-3 says "title derived from `_titleFromPath(filePath)`" but the edge-case inventory calls for the basename (`photo.jpg`) as the title. The correct interpretation is the full basename — this matches VSCode. A new private helper `_basenameFromPath(filePath: string): string` returns the last path segment with extension preserved. This helper is used only by `openMediaInTab`; all existing editor-tab creation sites continue using `_titleFromPath`.

### 2.5 Session persistence exclusion — exact location

In `saveSession()`, the current filter at line 866 of `tab-manager.ts`:

```typescript
.filter((t) => t.filePath !== null)
```

becomes:

```typescript
.filter((t) => t.kind === "editor" && t.filePath !== null)
```

This is the only change needed for FR-9. There is no second filter site. The `saveSession` scroll-capture at line 861 reads `this.tabs[this.activeIndex].scrollTop` — this is safe for media tabs because `scrollTop: 0` is always correct for them.

### 2.6 Old code removal — exact scope

The following are removed from `src/plugins/file-browser/file-browser.plugin.ts`:

**Module-level variable (line 732):**
```
let _previewedPath: string | null = null;
```

**Function `closeMediaPreview` (lines 1506–1528):** entire function body.

**Function `showMediaPreview` (lines 1554–1660):** entire function body.

**CSS block in `FILE_BROWSER_CSS` (lines 517–587):** the block beginning `/* ── Media Preview Panel (FR-12, FR-13) ──── */` through the closing `}` of `.tree-node-active { opacity: 1; }` — the entire `fbmp-*` CSS block. Note that the `.tree-node-active { opacity: 1; }` rule at the bottom of this block (line 586) is part of the sidebar-preview feature (it restores opacity on the active preview node); it is removed along with the rest of this block. The main `.tree-node-active` rule (line 154 of FILE_BROWSER_CSS) that sets `background` and `box-shadow` is in a different part of the CSS and is NOT removed.

**In `buildActivateHandler` (lines 1699–1703):** the non-md branch body:
```typescript
if (_previewedPath === path) {
  closeMediaPreview();
} else {
  showMediaPreview(path);
}
```
replaced with:
```typescript
void (window as any).__MARKABLE_TAB_MANAGER__?.openMediaInTab?.(path);
```

**In `buildNodeEl` (line 1083):** the `|| node.path === _previewedPath` predicate removed from the `tree-node-active` condition.

**In `renderPanel` (line 1207):** the `closeMediaPreview()` call before `innerHTML = ""` removed.

**In `_vaultChangedCb` (line 2887):** the `closeMediaPreview()` call removed.

**In the `destroy` panel method (line 2953):** the `closeMediaPreview()` call removed.

**In the `_testing` export object (lines 3201–3212):** remove `getPreviewedPath`, `setPreviewedPath`, `showMediaPreview`, and `closeMediaPreview` exports.

---

## 3. Data Model

### 3.1 Updated `TabEntry` shape

```typescript
export type TabKind = "editor" | "media";

export interface TabEntry {
  id: string;
  kind: TabKind;           // NEW
  filePath: string | null;
  title: string;
  isDirty: boolean;
  doc: string;
  scrollTop: number;
}
```

All existing `TabEntry` construction sites must add `kind: "editor"` explicitly:
- `_createUntitledTab()` — line 225
- `openFileInTab()` — line 443
- `openContentTab()` — line 503
- Session restore loop in `init()` — line 134

### 3.2 New `TabManager` private state

```typescript
private editorContainer: HTMLElement | null = null;   // #editor, set in init()
private mediaViewerEl: HTMLElement | null = null;     // #media-viewer, set in init()
```

---

## 4. Method-Level Specifications

### 4.1 `TabManager.init()` — two additions

1. After `this.tabStripEl = document.getElementById("tab-strip")`, add:
   ```typescript
   this.editorContainer = document.getElementById("editor");
   ```

2. After `this._applyActiveTab()` at the end of `init()`, inject `#media-viewer`:
   ```typescript
   if (this.editorContainer) {
     const mv = document.createElement("div");
     mv.id = "media-viewer";
     this.editorContainer.appendChild(mv);
     this.mediaViewerEl = mv;
   }
   ```

### 4.2 `TabManager.openMediaInTab(filePath: string): boolean` — new public method

```
1. Duplicate guard: find first tab where kind === "media" && filePath === filePath.
   If found: _captureActiveTab(), activeIndex = foundIdx, _applyActiveTab(),
   _notifyRenderer(), return false.
2. _captureActiveTab().
3. Construct TabEntry { id, kind: "media", filePath, title: _basenameFromPath(filePath),
   isDirty: false, doc: "", scrollTop: 0 }.
4. Push tab, set activeIndex = tabs.length - 1.
5. _applyActiveTab().
6. _notifyRenderer().
7. void addRecentFile(filePath).
8. void saveSession().
9. Auto-close clean Untitled: if tabs.length === 2, find the other tab;
   if it has kind === "editor" && filePath === null && !isDirty, splice it out,
   recalculate activeIndex, _notifyRenderer(), void saveSession().
10. return true.
```

Guard: if `this.editorContainer === null` (called before `init()` completes, EC-10), push the tab but skip `_applyActiveTab()`. The tab will be applied when `init()` calls `_applyActiveTab()` at step 8 of init.

### 4.3 `TabManager._applyActiveTab()` — updated

Before the existing early return at `if (this.tabs.length === 0 || this.editorView === null) return;`, add a zero-tab guard:

```typescript
if (this.tabs.length === 0) {
  // Last tab was closed — ensure editor is visible again.
  this.editorContainer?.classList.remove("has-media-tab");
  if (this.mediaViewerEl) this.mediaViewerEl.innerHTML = "";
  return;
}
if (this.editorView === null) return;
```

After getting `tab`:
```typescript
if (tab.kind === "media") {
  this.editorContainer?.classList.add("has-media-tab");
  this._renderMediaViewer(tab.filePath!);
  this._updateTitleBar(tab);
} else {
  this.editorContainer?.classList.remove("has-media-tab");
  // ... existing dispatch transaction unchanged ...
}
```

### 4.4 `TabManager._renderMediaViewer(filePath: string)` — new private method

```
1. If mediaViewerEl is null, return (should not happen after init).
2. mediaViewerEl.innerHTML = "" (clear stale content).
3. const ext = filePath.split(".").pop()?.toLowerCase() ?? "".
4. const assetUrl = convertFileSrc(filePath)  // direct ES import from @tauri-apps/api/core.
5. const basename = filePath.split("/").pop() ?? filePath.
6. Switch on ext:
   - jpg/jpeg/png/gif/webp/bmp/ico/svg → createElement("img");
     img.src = assetUrl; img.alt = basename;
     img.addEventListener("error", () => { this.mediaViewerEl!.innerHTML =
       '<p class="mv-load-error">Could not load file.</p>'; });
     mediaViewerEl.appendChild(img).
   - pdf → createElement("embed");
     embed.src = assetUrl; embed.type = "application/pdf";
     embed.addEventListener("error", () => { this.mediaViewerEl!.innerHTML =
       '<p class="mv-load-error">Could not load file.</p>'; });
     mediaViewerEl.appendChild(embed).
   - default → createElement("p"); p.className = "mv-unsupported";
     p.textContent = "Cannot preview this file type.";
     mediaViewerEl.appendChild(p).
```

`convertFileSrc` is imported at the top of `tab-manager.ts`:
```typescript
import { convertFileSrc } from "@tauri-apps/api/core";
```

### 4.5 `TabManager._captureActiveTab()` — short-circuit for media tabs

At the top of `_captureActiveTab()`, after the early return on empty tabs, add:
```typescript
const tab = this.tabs[this.activeIndex];
if (tab.kind === "media") return;  // Nothing to capture — no doc/scroll state.
```

### 4.6 `TabManager.closeTab(id)` — dirty-check guard update

Change:
```typescript
if (tab.isDirty) {
```
to:
```typescript
if (tab.isDirty && tab.kind !== "media") {
```

This applies to both the last-tab branch and the multi-tab branch. There are exactly two `if (tab.isDirty)` checks in `closeTab` — both must be updated.

### 4.7 `TabManager.saveSession()` — filter update

Change:
```typescript
.filter((t) => t.filePath !== null)
```
to:
```typescript
.filter((t) => t.kind === "editor" && t.filePath !== null)
```

---

## 5. New Private Helper: `_basenameFromPath`

```typescript
private _basenameFromPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
```

Returns the full filename including extension. Used only by `openMediaInTab`.

---

## 6. CSS Plan

All media-viewer rules are appended to the end of `src/tabs/tabs.css`. The complete block is specified verbatim in FR-6 of the requirements doc. Key points:

- `#media-viewer { display: none; }` is the default state.
- `#editor.has-media-tab .cm-editor { display: none; }` hides the editor.
- `#editor.has-media-tab #media-viewer { display: flex; }` shows the viewer.
- All colors use CSS variables (`--bg-color`, `--text-muted`, `--ui-font`).
- No hardcoded hex values.

---

## 7. File Browser Routing Update

In `buildActivateHandler` in `src/plugins/file-browser/file-browser.plugin.ts`, the non-md branch body (currently lines 1699–1703) is replaced with a single line:

```typescript
void (window as any).__MARKABLE_TAB_MANAGER__?.openMediaInTab?.(path);
```

The `openMediaInTab` method is exposed automatically on `window.__MARKABLE_TAB_MANAGER__` because `main.ts` assigns the entire `tabManager` instance to that global (line 854 of `main.ts`). No change to `main.ts` is needed.

After this change, `npm run build:plugins && npm run sync:plugins` must be run to recompile and sync the file-browser IIFE.

---

## 8. Test Strategy

### 8.1 Files to delete

- `tests/plugins/file-browser/media-preview.test.ts` — deleted entirely (FR-13).

### 8.2 `tests/plugins/file-browser/file-browser.test.ts` — additions only

Three new tests replacing the sidebar-preview routing assertions:

1. Non-md file click calls `window.__MARKABLE_TAB_MANAGER__.openMediaInTab(path)` — NOT `openFileInTab`.
2. `.md` file click still calls `openFileInTab(path)` (regression guard).
3. `_testing` no longer exports `getPreviewedPath`, `setPreviewedPath`, `showMediaPreview`, or `closeMediaPreview`.

The `setupTabManager()` helper in this test file must add `openMediaInTab: vi.fn()` to the mock object.

### 8.3 `tests/tabs/media-tab.test.ts` — new file

All 16 edge cases from the requirements must have a corresponding assertion. The test file follows the pattern of `tests/tabs/tab-manager.test.ts`:

- Same `vi.mock` preamble for Tauri, bridge, settings, live-preview, sidebar.
- Add `vi.mock("@tauri-apps/api/core", ...)` to mock `convertFileSrc`.
- `setupDom()` must include `<div id="editor"></div>` so `init()` can store `#editorContainer` and inject `#media-viewer`.

Specific test groups:

**`openMediaInTab` — creation (EC-01, EC-02, EC-03, EC-04, EC-05, EC-14)**
- Creates a `kind: "media"` tab with correct title (full basename).
- Returns `true` on new tab creation.
- Deduplication: second call with same path returns `false`, tab count unchanged (EC-01).
- Auto-removes clean Untitled editor tab when it is the only other tab.
- `tabs.length` is correct after push.

**`_applyActiveTab` — DOM behaviour (EC-06, EC-07, EC-08)**
- Adds `has-media-tab` class to `#editor` for a media tab.
- Removes `has-media-tab` class when switching back to an editor tab.
- Does NOT call `editorView.dispatch` when applying a media tab.
- Populates `#media-viewer` with an `<img>` for a `.png` path.
- Populates `#media-viewer` with an `<embed>` for a `.pdf` path.
- Populates `#media-viewer` with `.mv-unsupported` for an unrecognised extension (EC-04).
- Case-insensitive extension matching: `.JPG` renders `<img>` (EC-05).

**`_captureActiveTab` — media tab skipped (EC-08)**
- Does not read `editorView.state.doc` when active tab is `kind: "media"`.

**`saveSession` — filter (EC-16)**
- Media tab with a non-null `filePath` is excluded from `openFiles` serialisation.
- Editor tabs are still included.

**`closeTab` — media-specific paths (FR-7, EC-12, EC-13)**
- Closing a media tab does not invoke `confirm()`.
- Closing the last media tab (vault active): drops to 0 tabs, `has-media-tab` removed from `#editor`, `#media-viewer` cleared.
- Closing the last media tab (no vault): window close path (existing behaviour, not broken).

**`_renderMediaViewer` — error handler (EC-03)**
- `img` error event replaces `#media-viewer` content with `.mv-load-error`.
- `embed` error event replaces content with `.mv-load-error`.

**EC-10 — `openMediaInTab` before `init()` completes**
- Calling `openMediaInTab` with `editorContainer === null` pushes the tab but does not throw.

---

## 9. Implementation Phases

Work is split into four independently completable steps. Each step file defines the exact lines to touch and a verification command.

| Step | File | Focus | Status |
|---|---|---|---|
| `step_01` | `file-browser.plugin.ts` + test file deletion | Remove all sidebar-preview code; delete `media-preview.test.ts` | [x] Complete |
| `step_02` | `tab-types.ts`, `tab-manager.ts` | Add `kind` to `TabEntry`; implement `openMediaInTab`, `_applyActiveTab`, `_captureActiveTab`, `closeTab`, `saveSession`, `init` updates | [x] Complete |
| `step_03` | `tabs.css`, `file-browser.plugin.ts` routing | Append media-viewer CSS; wire `openMediaInTab` call in `buildActivateHandler`; rebuild plugin | [x] Complete |
| `step_04` | `tests/tabs/media-tab.test.ts`, `file-browser.test.ts` | All new tests | [x] Complete |

---

## 10. Invariants That Must Not Regress

- One `EditorView` for the app lifetime. `openMediaInTab` never creates an `EditorView`.
- `div.cm-editor` is never removed from DOM — only hidden with `display: none`.
- `div#media-viewer` is created exactly once, in `init()`.
- `saveSession` never serialises a `kind: "media"` tab.
- The three renderers (`MinimalTabBar`, `RegularTabBar`, `VerticalTabStrip`) are not modified.
- `main.ts` is not modified.
- Window launch size (50% x 80%) is not touched.
- `src-tauri/` is not touched — no new Rust commands.

---

## Review Request

- **Files changed**:
  - `src/tabs/tab-types.ts` — Added `TabKind` type and `kind` field to `TabEntry`
  - `src/tabs/tab-manager.ts` — Added `editorContainer`/`mediaViewerEl` fields; `init()` injection; `openMediaInTab`; `_basenameFromPath`; `_renderMediaViewer`; updated `_applyActiveTab`, `_captureActiveTab`, `closeTab`, `saveSession`; all `TabEntry` construction sites
  - `src/tabs/tabs.css` — Appended media-viewer CSS rules
  - `src/plugins/file-browser/file-browser.plugin.ts` — Removed all `_previewedPath`, `showMediaPreview`, `closeMediaPreview`, `fbmp-*` code; wired `openMediaInTab` in `buildActivateHandler`
  - `tests/tabs/test-helpers.ts` — Added `kind: "editor"` to `makeTab()` default object
  - `tests/tabs/media-tab.test.ts` — Created new file (34 tests, groups A–I)
  - `tests/plugins/file-browser/file-browser.test.ts` — Updated `setupTabManager()`, added 3 new routing tests
  - `tests/plugins/file-browser/media-preview.test.ts` — Deleted (superseded)
  - `docs/specs/media-preview-v2/00_index.md` — Marked all steps complete
  - `src-tauri/plugins/core/file-browser.js` (via `sync:plugins`) — Rebuilt IIFE

- **Steps completed**: `step_01`, `step_02`, `step_03`, `step_04`

- **Known limitations**:
  - No deferred items. All spec requirements implemented.

- **Edge cases covered by tests**:

  | Requirement EC | Test group | Test(s) |
  |---|---|---|
  | EC-01 (duplicate path) | Group B | "returns false when same path already open", "does not create second tab" |
  | EC-02 (re-click / auto-close) | Group C | "removes only Untitled editor tab when opening first media tab" |
  | EC-03 (load error) | Group H | "img error event replaces #media-viewer with .mv-load-error", "embed error event..." |
  | EC-04 (no extension / unsupported) | Group D | "renders .mv-unsupported for unrecognised extension" |
  | EC-05 (uppercase extension) | Group D | "renders img for .JPG", "renders embed for .PDF" |
  | EC-06 (multiple media tabs) | Group D | "clears #media-viewer innerHTML when switching between media tabs" |
  | EC-07 (switch media to editor) | Group D | "removes has-media-tab class when switching to an editor tab" |
  | EC-08 (capture skipped for media) | Group E | "does not read editorView.state.doc.toString when active tab is kind:media" |
  | EC-10 (before init) | Group I | "calling openMediaInTab before init() does not throw", "tab is pushed even when editorContainer is null" |
  | EC-12 (no confirm for media) | Group G | "does not invoke confirm() when closing a media tab" |
  | EC-13 (last media tab vault active) | Group G | "drops to 0 tabs and removes has-media-tab", "clears #media-viewer innerHTML" |
  | EC-15 (editor tab same path not duplicate) | Group B | "kind:editor tab with same path is NOT treated as duplicate" |
  | EC-16 (session excludes media) | Group F | "media tab excluded from openFiles", "editor tabs still included" |
  | File-browser routing | Routing | "non-md file calls openMediaInTab not openFileInTab", ".md file calls openFileInTab regression guard" |
