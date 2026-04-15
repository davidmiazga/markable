---
title: "Image Toolbar Plugin"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Image Toolbar Plugin — Requirements Spec

## Summary

As a user, I want a floating popover toolbar that appears whenever I interact with a Markdown image — either by clicking on the rendered preview or by moving the cursor onto the image syntax line — so that I can change the image source and control its alignment without editing raw Markdown.

---

## Functional Requirements

### FR-1: Trigger Conditions

The toolbar is displayed under exactly two conditions. Both conditions produce the same popover UI.

| Trigger | Detection Method |
|---|---|
| Live preview mode — user clicks on a rendered `<img class="cm-live-image">` element | A DOM `click` listener on `document` (event delegation) checks `event.target.closest("img.cm-live-image")`. On match, the toolbar is shown and positioned relative to the clicked image element. |
| Edit mode — cursor moves onto the line containing `![alt](url)` syntax | A CM6 `updateListener` extension reads `state.selection.main.head`, resolves the line, and checks the syntax tree for an `Image` node whose range overlaps that line. On match, the toolbar is shown and positioned relative to the CM6 widget coordinates for that image node. |

Both triggers identify the same logical image (the `![alt](url)` or `<img>` at a given document position). The popover is anchored to the image's bounding rect in both cases.

When the cursor moves to a different line (or off an image line entirely) in edit mode, the toolbar hides. When the user clicks outside the popover in live preview mode, the toolbar hides (see FR-5).

Only one toolbar instance exists at a time. If a second trigger fires while the toolbar is already visible for a different image, the toolbar repositions and reinitialises for the new image.

### FR-2: Popover Structure

The toolbar is a single `<div>` fixed-positioned over `document.body`. It contains two sections rendered inline:

1. A two-tab strip: "Select" and "Embed Link".
2. An alignment control group: four buttons — Left, Center, Right, Float Right.

The two sections are always visible simultaneously (they are not in separate tabs relative to each other). The tab strip controls which source-editing panel is shown within the popover; the alignment buttons are always present.

#### FR-2a: Select Tab

Content: a single button labelled "Choose File".

Behaviour: clicking the button calls `window.__TAURI_DIALOG__.open(...)` (see AD-3) with a filter restricting to image extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`. If the user selects a file, the plugin:
1. Calls `resolveRelativePath(selectedAbsPath, currentDocumentPath)` to produce a relative path when the image is inside or below the document's directory, or retains the absolute path otherwise.
2. Dispatches a CM6 transaction that replaces the URL portion of the current image's Markdown source with the new path (see FR-6).
3. Closes the toolbar.

If the user cancels the dialog (dialog returns `null`), no dispatch is emitted and the toolbar remains open.

`currentDocumentPath` is obtained from `(window as any).__MARKABLE_CURRENT_FILE__` (the same global used by `live-preview.ts` via `setLivePreviewFilePath`). If that global is `null` (untitled document), the absolute path is used as-is.

#### FR-2b: Embed Link Tab

Content: a text `<input>` pre-filled with the current image's `src` value (the raw Markdown URL, not the resolved Tauri asset URL). Below the input: an "Embed Image" button.

Behaviour: clicking "Embed Image" reads the current input value. If it is non-empty and differs from the existing URL, the plugin dispatches a CM6 transaction replacing the URL in the Markdown source (see FR-6). If the value is unchanged or empty, no dispatch is emitted. The toolbar closes after a successful dispatch.

"Embed Image" is enabled regardless of URL scheme — it accepts relative paths, absolute paths, `https://` URLs, and data URIs.

### FR-3: Alignment Controls

Four buttons: **Left** | **Center** | **Right** | **Float Right**.

The active alignment is visually indicated (CSS accent border or background) on the button that matches the current image's alignment state (detected at open time — see FR-4).

Each button, when clicked, dispatches a single CM6 transaction that replaces the image's surrounding Markdown source with the aligned form (see FR-6). The toolbar closes after dispatch.

#### FR-3a: Alignment Source Forms

| Button | Written Markdown form |
|---|---|
| Left | `![alt](url)` (bare — removes any existing `<div align="...">` wrapper) |
| Center | `<div align="center">![alt](url)</div>` |
| Right | `<div align="right">![alt](url)</div>` |
| Float Right | `<img src="url" alt="alt" align="right" style="float:right; margin:0 0 8px 16px">` |

"Left" is the removal/reset case: if the image already has no wrapper it is a no-op dispatch (still emits to normalise any float-right inline HTML back to Markdown — see EC-5).

#### FR-3b: Detection of Current Alignment

At toolbar open time, the plugin reads the raw Markdown source of the current image region (see FR-4 for region detection) and classifies it:

- If the source matches `<div align="center">...</div>` — active alignment is Center.
- If the source matches `<div align="right">...</div>` — active alignment is Right.
- If the source matches `<img ... align="right" ...>` (inline `<img>` with `align="right"`) — active alignment is Float Right.
- Otherwise (bare `![alt](url)`, `<div align="left">...</div>`, or any unrecognised form) — active alignment is Left.

### FR-4: Image Region Detection

"Image region" is the span of document text that the plugin reads and replaces on each operation. The region must capture the full image expression including any wrapper element.

Detection algorithm (applied at each trigger event):

1. Obtain the document position of the image. In click-trigger mode this is the CM6 widget position recovered from the clicked `<img>` element's dataset attribute (see AD-2). In edit-mode this is the `Image` node's `from` position from the CM6 syntax tree.
2. From that position, call `syntaxTree(state).resolveInner(pos)` and walk up to find the `Image` node.
3. Obtain the raw line text for the line containing `node.from`.
4. Check if the line matches a `<div align="...">` open tag immediately before the image, and if the following line contains the corresponding `</div>` close tag. If so, the region is the combined span from the start of the `<div>` tag to the end of the `</div>` tag (including the newline between them if present).
5. Check if the line itself is a standalone `<img ... >` tag (Float Right form). If so, the region is that entire line.
6. Otherwise the region is exactly the `Image` node's range (`node.from` to `node.to`).

The detected region, raw source text, alt text, and url are stored in a module-level `currentImageContext` object and used by all toolbar actions.

### FR-5: Popover Dismiss Behaviour

The toolbar distinguishes two open modes — **edit-triggered** (cursor moved onto an image line) and **click-triggered** (user clicked an `<img class="cm-live-image">` in live preview). A module-level `triggerMode: "edit" | "click" | null` flag tracks which mode is active.

**Edit-triggered mode dismiss conditions:**

- The CM6 `updateListener` fires and the cursor is no longer on an image line. The toolbar hides immediately (no debounce). This mirrors the Table Toolbar which calls `updateFloatingVisibility(null)` from its `updateListener` when the cursor leaves the table.

**Click-triggered mode dismiss conditions:**

- A `mousedown` event fires on `document` outside the toolbar element (click-outside). The toolbar hides on the `mousedown` event itself (not `mouseup`) so that clicking the editor body feels instantaneous.
- The CM6 `updateListener` fires and the cursor moves to a non-image line AND `triggerMode` is `"click"`. The cursor's position at click time was irrelevant to opening the toolbar, but if the user subsequently navigates the cursor off every image line the toolbar still hides.

**Both modes — additional dismiss conditions:**

- The editor loses focus (`blur` event on the editor's DOM node).
- `onDisable` is called.

**Unified logic summary:** any path that hides the toolbar calls a single `hideToolbar()` helper that sets `display: none`, clears `currentImageContext` to `null`, and resets `triggerMode` to `null`. This ensures all dismiss paths are symmetric.

Hiding means `display: none` on the popover element. It does not destroy the element — the same DOM node is reused on the next trigger.

### FR-6: Document Mutations

All document mutations follow the same contract as the Table Toolbar plugin:

- Each action dispatches exactly one `view.dispatch({ changes: { from, to, insert } })` call covering the full image region (from FR-4).
- The `from`/`to` span is the image region detected at open time and stored in `currentImageContext`.
- The `insert` string is the fully composed new Markdown form for the image.
- A single dispatch = a single undo step (one Cmd-Z reversal).

URL replacement preserves the existing alt text. Alt text replacement (future) preserves the existing URL.

### FR-7: Popover Positioning

The toolbar uses the same positioning strategy as the Table Toolbar:

- Default: appear above the image element, vertically offset by `toolbarHeight + 8px`.
- Flip: if the computed top position would place the toolbar above the viewport top edge (`< 0`), flip to appear below the image instead.
- Horizontal clamp: if the toolbar's right edge would exceed `window.innerWidth`, shift left until it is fully within the viewport.
- The position is recalculated on each trigger (open), not continuously tracked during scroll. If the user scrolls after opening, the toolbar may drift. The toolbar auto-closes on cursor movement (edit mode) or click-away (preview mode) so visible drift is brief.

### FR-8: Plugin Integration Contracts

- File: `src/plugins/image-toolbar/image-toolbar.plugin.ts`
- Compiled output: `src-tauri/plugins/core/image-toolbar.js`
- Plugin object fields:
  - `id: "image-toolbar"`
  - `name: "Image Toolbar"`
  - `version: "1.0.0"`
  - `description`: one-line summary
  - `detail`: multi-sentence description for the Plugins Panel
  - `sidebarPanelId`: omitted (this plugin is floating-only; no sidebar mode)
- `onEnable(api)`: loads settings (none in v1.0 but the hook must exist for future extensibility), injects CSS, adds the CM6 `updateListener` extension via `api.addExtensions()`, creates the floating popover DOM element, attaches the `document` click-delegation listener and the click-away dismiss listener.
- `onDisable(api)`: calls `api.removeExtensions()`, removes the popover DOM element from `document.body`, removes all `document`-level event listeners, resets all module-level state to initial values.
- CM6 globals pattern: `window.__CM_VIEW__` for CM6 value access (same as `table-toolbar.plugin.ts`). Never accessed at module-evaluation time. Direct editor dispatch via `(window as any).__MARKABLE_EDITOR_VIEW__`.
- No `@codemirror/*` value imports at module level; only `import type` annotations.
- No app-internal module imports.

### FR-9: Build System Integration

- Add one entry to `scripts/build-plugins.mjs` `PLUGINS` array:
  `["image-toolbar", "src/plugins/image-toolbar/image-toolbar.plugin.ts"]`
- Add one `pluginConfig(...)` call to `vite.plugins.config.ts` (same pattern as existing entries; `clearOutput: false`).
- Update the success-count log message in `build-plugins.mjs` from "All 7 core plugins" to "All 8 core plugins".
- Both files must be updated before the plugin can be compiled.

### FR-10: CSS Scoping and Injection

- All CSS class names prefixed `.img-toolbar` (e.g. `.img-toolbar`, `.img-toolbar__tab`, `.img-toolbar__tab--active`, `.img-toolbar__align-btn`, `.img-toolbar__align-btn--active`, `.img-toolbar__input`).
- CSS injected as `<style id="__markable_img_toolbar_css__">` in `onEnable`.
- Guard: check `document.getElementById(STYLE_ID)` before inserting to prevent duplicate injection on rapid toggle cycles.
- CSS removed in `onDisable` by id.
- CSS uses `var(--bg-primary)`, `var(--bg-chrome)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--accent-color)`, `var(--selection-bg)` for automatic theme adoption.

### FR-11: Persistent Settings

No user-configurable settings in v1.0. `onEnable` still calls `api.loadSettings()` as a no-op scaffold so the pattern is in place for future additions (e.g., a default alignment preference). The settings file is not written unless a user action requires it.

---

## Non-Functional Requirements

### NFR-1: No New Dependencies

The plugin uses only vanilla TypeScript/DOM APIs. `@tauri-apps/plugin-dialog` is accessed via a `window` global (AD-3) — not imported directly — so no new `package.json` entries are required for the plugin bundle. CM6 APIs are accessed through `window.__CM_VIEW__`.

### NFR-2: Performance

- The CM6 `updateListener` runs on every editor transaction. The image-detection check (resolve syntax node for cursor line) must complete in under 1 ms on a typical document. No debounce is applied to the show/hide decision — the toolbar must respond immediately to cursor movement.
- The popover DOM element is created once in `onEnable` and reused; it is not rebuilt per transaction.
- `currentImageContext` is updated only when the trigger image changes, not on every transaction.

### NFR-3: Toggle Cycle Correctness

The plugin must survive repeated enable/disable cycles without leaking DOM nodes, event listeners, or CM6 extensions:

- All module-level state is reset in `onDisable`.
- The `<style>` tag is removed in `onDisable`.
- The popover DOM element is removed from `document.body` in `onDisable`.
- `api.removeExtensions()` is called in `onDisable`.
- All `document`-level listeners registered in `onEnable` are removed in `onDisable` using identical function references (listeners must be stored as module-level variables, not anonymous functions, to allow removal).

### NFR-4: Undo Atomicity

Every document mutation dispatches exactly one CM6 transaction. No action may call `view.dispatch` more than once. Alignment changes that require replacing a multi-line `<div>...</div>` wrapper must compute the full replacement string before the single dispatch.

### NFR-5: Source Fidelity

All mutations preserve:
- Alt text verbatim (no trimming, no escaping changes).
- URL verbatim (no re-encoding except the deliberate relative-path resolution in FR-2a).
- Line endings of the surrounding document (LF or CRLF) when constructing multi-line `<div>` wrapper forms.

---

## Architectural Decisions

### AD-1: `ignoreEvent` Override on ImageWidget

`ImageWidget.ignoreEvent()` currently returns `true` (line 126 of `live-preview.ts`), which prevents the CM6 editor from processing any DOM events that originate within the `<img>` element. This means a `click` event on the image does not move the cursor.

The image toolbar requires click events on `<img class="cm-live-image">` elements to be detectable. The chosen approach is **event delegation on `document`** rather than modifying `ignoreEvent`. The plugin registers a `mousedown` (or `click`) listener on `document`; this fires regardless of `ignoreEvent` because `ignoreEvent` only affects CM6's internal event handling, not native DOM bubbling.

`ImageWidget.ignoreEvent()` in `live-preview.ts` is NOT modified. The plugin is entirely self-contained.

### AD-2: Mapping Clicked `<img>` to Document Position

When the user clicks an `<img class="cm-live-image">` in live preview mode, the plugin must recover the corresponding CM6 document position to identify which image was clicked.

Mechanism: when the popover opens via an image click, the plugin iterates `view.visibleRanges` and walks the decoration set (`view.state.field(decorationsField)` or via `view.dom.querySelectorAll("img.cm-live-image")`) to find the DOM node whose identity matches `event.target`. The plugin uses `view.posAtDOM(event.target)` (CM6 API) to obtain the document position, then resolves the syntax node.

`view.posAtDOM` is confirmed as standard CM6 public API — no deviation from this approach is required. Proceed as specified.

If `posAtDOM` is unavailable or throws, fall back to scanning the syntax tree for `Image` nodes and matching `resolveImageSrc(node.url)` against `event.target.src`. Throw an error log and abort (no toolbar shown) only if both methods fail.

### AD-3: Tauri Dialog Access Pattern

`@tauri-apps/plugin-dialog` cannot be imported directly inside a plugin IIFE bundle because the resulting `require()` call is not available in the `new Function()` sandbox.

`window.__TAURI_DIALOG__` does NOT exist yet and must be added as part of this feature's implementation. The exposure is performed in `main.ts`, matching the pattern used for `window.__MARKABLE_EDITOR_VIEW__` at line 776 of `main.ts`.

Implementation in `main.ts`:

```typescript
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
// (at the point where __MARKABLE_EDITOR_VIEW__ is set, add:)
(window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"] = { open: dialogOpen };
```

The plugin accesses it as `(window as any).__TAURI_DIALOG__?.open(...)`. If the global is absent (test environment), the Select tab button is a no-op and the toolbar logs a warning.

This pattern is analogous to `window.__MARKABLE_EDITOR_VIEW__` used by the Table Toolbar.

### AD-4: `currentImageContext` Module-Level State Shape

```
interface ImageContext {
  from: number;          // document position of region start (inclusive)
  to: number;            // document position of region end (exclusive)
  rawSource: string;     // raw Markdown/HTML text of the full region
  url: string;           // extracted URL (Markdown src, not resolved asset URL)
  alt: string;           // extracted alt text
  alignment: "left" | "center" | "right" | "float-right";
  anchorEl: HTMLElement; // the <img> DOM element used to position the popover
}
```

`currentImageContext` is `null` when the toolbar is hidden. It is set on each toolbar open and cleared on hide.

### AD-5: No Sidebar Mode

The Image Toolbar is floating-only. There is no sidebar mode and no position toggle in the Plugins Panel detail view. `sidebarPanelId` is omitted from the plugin object. This simplifies the plugin relative to the Table Toolbar and can be revisited in a later iteration.

### AD-6: `__MARKABLE_CURRENT_FILE__` Global

`window.__MARKABLE_CURRENT_FILE__` does NOT exist yet and must be added as part of this feature's implementation. It tracks the absolute filesystem path of the currently active document, or `null` for untitled documents.

**Exposure point:** `main.ts`, inside (or immediately after) the call to `setLivePreviewFilePath()` — which is already called from `tab-manager.ts`'s `_applyActiveTab()` whenever a tab becomes active. The same `null`-or-string value passed to `setLivePreviewFilePath()` must also be written to the global.

Implementation in `main.ts` (or wherever `setLivePreviewFilePath` is called):

```typescript
(window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = filePath; // string | null
```

This must be set on every tab switch so the value is always current. It must be set to `null` when a new untitled document is opened.

The plugin reads this global in the Select tab handler:

```typescript
const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
```

If the global is `undefined` (not yet set, or test environment), it is treated identically to `null` — the selected file's absolute path is used as-is.

---

## Out of Scope (v1.0)

- Alt text editing.
- Image resize controls (width/height).
- Delete image button.
- Sidebar/docked mode.
- Caption support.
- Drag-and-drop image insert.
- Image alignment for images inside tables or blockquotes (behaviour is undefined in v1.0 — the toolbar may not open or may operate incorrectly in those contexts).
- Multiple images on the same line — only the first `Image` node on the line is targeted.
- Future merge into the unified `markdown-toolbar` plugin.

---

## Edge Case Inventory

All items below are mandatory test cases for the Code Reviewer.

| # | Scenario | Expected Behaviour |
|---|---|---|
| EC-1 | Image inside `<div align="center">...</div>` wrapper — alignment buttons | The entire `<div>...</div>` span (both lines) is detected as the region. Clicking a different alignment replaces both lines in a single dispatch. Clicking Left removes the wrapper entirely, leaving bare `![alt](url)`. |
| EC-2 | Image inside `<div align="right">...</div>` wrapper — alignment detection | Toolbar opens with "Right" button shown as active. |
| EC-3 | Float-right image (inline `<img ... align="right" style="float:right...">`) — source detection | Toolbar opens with "Float Right" shown as active. The entire `<img>` line is the region. Clicking Left replaces the `<img>` line with bare `![alt](url)`. |
| EC-4 | Float-right image — clicking Center | Replaces the inline `<img>` line with `<div align="center">![alt](url)</div>` (two-line form). Single dispatch. |
| EC-5 | Left alignment on image already at Left (no wrapper) | Dispatch is still emitted so any float-right or wrapper form is normalised to bare `![alt](url)`. Idempotent write is acceptable. |
| EC-6 | Relative path image (`![photo](./images/photo.png)`) — Select tab file picked from same directory | New path is expressed relative to document directory. URL in dispatch is a relative path, not an absolute path. |
| EC-7 | Relative path image — Select tab file picked from outside document directory | Absolute path is used as-is. URL in dispatch is the absolute filesystem path. |
| EC-8 | Untitled document (`__MARKABLE_CURRENT_FILE__` is null) — Select tab | Selected file's absolute path is used directly. No crash. |
| EC-9 | Image clicked in live preview mode, cursor is on a different line | Toolbar opens and shows the clicked image's context. Cursor position does not affect the shown image. The toolbar closes only on click-away or cursor moving onto a different image line (not merely to a non-image line, since the trigger was a click, not cursor movement — see dismiss behaviour in FR-5). |
| EC-10 | Empty src — `![]()` | Toolbar opens. Embed Link tab shows empty input. Select tab is functional. Alignment buttons write the correct form with empty URL. No crash on region detection. |
| EC-11 | Cursor moves onto image line in edit mode, then moves off before user interacts | Toolbar hides within one CM6 update cycle. No dangling event listeners. |
| EC-12 | Tauri dialog cancelled (user clicks Cancel) | `dialog.open()` returns `null`. No dispatch. Toolbar remains open. |
| EC-13 | Tauri dialog global `__TAURI_DIALOG__` is undefined (test environment) | Select tab button click is a no-op. Warning logged to console. No crash. |
| EC-14 | `window.__MARKABLE_EDITOR_VIEW__` is undefined when an alignment button is clicked | Click handler is a no-op. No uncaught exception. Toolbar remains open. |
| EC-15 | `view.posAtDOM(imgEl)` throws (image not in visible range) | Plugin falls back to syntax-tree scan. If fallback also fails, logs error and does not open toolbar. No crash. |
| EC-16 | Two images on the same line — cursor on that line in edit mode | The first `Image` node encountered on the line is used. The toolbar opens for that image only. This is documented as a known limitation (Out of Scope). |
| EC-17 | Rapid toggle — enable/disable/enable in quick succession | No duplicate `<style>` tags, no orphaned DOM elements, no stale CM6 extensions, no duplicate `document` listeners. |
| EC-18 | Plugin disabled while toolbar is visible | `onDisable` removes the popover from `document.body` immediately. No dangling element after disable. |
| EC-19 | `loadSettings()` returns `null` (first run) | No crash. Plugin initialises with no saved settings (no settings to load in v1.0). `onEnable` completes normally. |
| EC-20 | Embed Link tab — "Embed Image" clicked with unchanged URL | No dispatch emitted. Toolbar remains open. |
| EC-21 | Embed Link tab — "Embed Image" clicked with empty input | No dispatch emitted. Toolbar remains open. |
| EC-22 | CRLF document — alignment adds `<div>` wrapper | The `\r\n` line ending is preserved in the inserted `<div align="...">![alt](url)</div>\r\n` string. No mixed line endings introduced. |
| EC-23 | Image toolbar popover would render above viewport top edge | Toolbar flips to render below the image element instead. |
| EC-24 | Image toolbar popover right edge overflows viewport | Toolbar is clamped leftward so it is fully within the viewport. |
| EC-25 | New tab opened while plugin is enabled (editor view replaced) | `__MARKABLE_EDITOR_VIEW__` is read fresh on each action. The previous tab's context is not used for dispatches on the new tab. |
| EC-26 | Alt text contains special characters (`"`, `\`, `[`, `]`) | Alt text is preserved verbatim in all written forms. No escaping or unescaping is applied by the plugin. |
| EC-27 | `<div align="...">` wrapper spans lines with CRLF — region detection | Region `from`/`to` correctly includes both the open tag line and the close tag line, accounting for `\r\n` line endings. |
| EC-28 | Image inside a blockquote or table cell | Region detection may fail or produce incorrect spans. Behaviour is undefined. Plugin should not crash — if region detection fails, the toolbar does not open and an error is logged. |
| EC-29 | Build: `image-toolbar` entry missing from `build-plugins.mjs` | `npm run build:plugins` does not produce `image-toolbar.js`. CI catches the omission. |
| EC-30 | Build: `image-toolbar` entry missing from `vite.plugins.config.ts` | `npm run build:plugins` (via vite.plugins.config.ts path) does not include the plugin. Both files must be updated. |
| EC-31 | Select tab — file picker returns a path with spaces or Unicode characters | Path is used verbatim in the Markdown source. No URL-encoding is applied unless the file picker itself returns a URL (it returns a filesystem path on macOS). |
| EC-32 | Clicking the already-active alignment button | Dispatch is still emitted (idempotent normalisation). Active button visual state is unchanged. |
