---
title: "Step 04 — Tests"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 04 — Tests

## Goal

1. Create `tests/tabs/media-tab.test.ts` covering all 16 edge cases and the 9
   functional behaviours specified in FR-14 of the requirements.
2. Update `tests/plugins/file-browser/file-browser.test.ts` with three new
   tests for the updated routing behaviour and removal of `_previewedPath` exports.
3. Fix the `_testing.setPreviewedPath(null)` call in `file-browser.test.ts`
   `beforeEach` that was left as a stub after step_01.

After this step all tests must pass with `npm run test:run`.

---

## Files Changed

| File | Action |
|---|---|
| `tests/tabs/media-tab.test.ts` | Create new file |
| `tests/plugins/file-browser/file-browser.test.ts` | Add 3 tests; fix beforeEach |

---

## `tests/tabs/media-tab.test.ts` — Full Specification

### Preamble and Mocks

Copy the `vi.mock` preamble from `tests/tabs/tab-manager.test.ts` exactly, then
add one extra mock for `convertFileSrc`:

```typescript
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => "asset://localhost/" + encodeURIComponent(p)),
}));
```

The `convertFileSrc` mock returns a deterministic URL so `_renderMediaViewer`
tests can assert exact `src` values without real Tauri.

### DOM scaffold

The `setupDom()` helper must include `#editor` (required by `init()` to inject
`#media-viewer`):

```typescript
function setupDom() {
  document.body.innerHTML = `
    <div id="titlebar"><span id="titlebar-title"></span></div>
    <div id="tab-strip"></div>
    <div id="app">
      <div id="app-row">
        <div id="editor"></div>
      </div>
    </div>
  `;
}
```

### EditorView mock

Reuse `makeEditorView()` from `tab-manager.test.ts` verbatim (copy the function).

### Test groups

---

#### Group A: `openMediaInTab` — creation

```
describe("openMediaInTab — creates a kind:media tab")

it("returns true when a new tab is created")
  - init manager with no open files
  - result = openMediaInTab("/vault/photo.png")
  - expect(result).toBe(true)

it("creates a tab with kind === 'media'")
  - openMediaInTab("/vault/photo.png")
  - tab = manager.getActiveTab()
  - expect(tab.kind).toBe("media")

it("uses the full basename including extension as the title")
  - openMediaInTab("/vault/photo.png")
  - expect(manager.getActiveTab().title).toBe("photo.png")

it("title for a path with no extension is the full filename")
  - openMediaInTab("/vault/LICENSE")
  - expect(manager.getActiveTab().title).toBe("LICENSE")

it("sets isDirty to false")
  - openMediaInTab("/vault/photo.png")
  - expect(manager.getActiveTab().isDirty).toBe(false)

it("sets doc to empty string")
  - openMediaInTab("/vault/photo.png")
  - expect(manager.getActiveTab().doc).toBe("")

it("getTabCount() reflects the new tab")
  - manager starts with 1 untitled tab
  - openMediaInTab — auto-removes untitled (see below)
  - expect(manager.getTabCount()).toBe(1)
```

---

#### Group B: `openMediaInTab` — deduplication (EC-01)

```
describe("openMediaInTab — duplicate guard (EC-01)")

it("returns false when the same path is already open as a media tab")
  - openMediaInTab("/vault/photo.png") → true
  - result = openMediaInTab("/vault/photo.png") → false
  - expect(result).toBe(false)

it("does not create a second tab for the same media path")
  - openMediaInTab("/vault/photo.png")
  - openMediaInTab("/vault/photo.png")
  - expect(manager.getTabCount()).toBe(1)

it("a kind:editor tab with the same path is NOT treated as a duplicate (EC-15)")
  - Mock readFile to return ok
  - await openFileInTab("/vault/image.md") — creates editor tab
  - result = openMediaInTab("/vault/image.md") — different kind
  - expect(result).toBe(true)
  - expect(manager.getTabCount()).toBe(2)
```

---

#### Group C: `openMediaInTab` — auto-close Untitled (EC-02 equivalent)

```
describe("openMediaInTab — auto-close clean Untitled tab")

it("removes the only Untitled editor tab when opening the first media tab")
  - manager starts with 1 Untitled tab (default init with no vault)
  - openMediaInTab("/vault/photo.png")
  - expect(manager.getTabCount()).toBe(1)
  - expect(manager.getActiveTab().kind).toBe("media")

it("does NOT remove a dirty Untitled tab")
  - init, markActiveTabDirty()
  - openMediaInTab("/vault/photo.png")
  - expect(manager.getTabCount()).toBe(2)

it("does NOT remove an Untitled tab when two other tabs exist")
  - init, openNewTab() [now 2 untitled tabs]
  - openMediaInTab("/vault/photo.png") [now 3 tabs]
  - expect(manager.getTabCount()).toBe(3)
```

---

#### Group D: `_applyActiveTab` — DOM effects (EC-06, EC-07, EC-08)

```
describe("_applyActiveTab — media tab DOM effects")

it("adds has-media-tab class to #editor when a media tab is active")
  - openMediaInTab("/vault/photo.png")
  - editorEl = document.getElementById("editor")
  - expect(editorEl.classList.contains("has-media-tab")).toBe(true)

it("removes has-media-tab class when switching to an editor tab")
  - openMediaInTab("/vault/photo.png")
  - openNewTab()
  - expect(document.getElementById("editor").classList.contains("has-media-tab")).toBe(false)

it("does NOT call editorView.dispatch when applying a media tab")
  - const view = makeEditorView()
  - await manager.init(view)
  - const dispatchSpy = vi.spyOn(view, "dispatch")
  - openMediaInTab("/vault/photo.png")
  - expect(dispatchSpy).not.toHaveBeenCalled()

it("populates #media-viewer with <img> for a .png file")
  - openMediaInTab("/vault/photo.png")
  - mv = document.getElementById("media-viewer")
  - expect(mv.querySelector("img")).not.toBeNull()

it("<img> alt attribute equals the basename")
  - openMediaInTab("/vault/photo.png")
  - img = document.querySelector("#media-viewer img")
  - expect(img.alt).toBe("photo.png")

it("populates #media-viewer with <embed> for a .pdf file")
  - openMediaInTab("/vault/doc.pdf")
  - expect(document.querySelector("#media-viewer embed")).not.toBeNull()

it("<embed> has type='application/pdf'")
  - openMediaInTab("/vault/doc.pdf")
  - embed = document.querySelector("#media-viewer embed")
  - expect(embed.type).toBe("application/pdf")

it("renders .mv-unsupported for an unrecognised extension (EC-04)")
  - openMediaInTab("/vault/Makefile")
  - expect(document.querySelector("#media-viewer .mv-unsupported")).not.toBeNull()

it("renders <img> for .JPG — case-insensitive extension matching (EC-05)")
  - openMediaInTab("/vault/PHOTO.JPG")
  - expect(document.querySelector("#media-viewer img")).not.toBeNull()

it("renders <embed> for .PDF — case insensitive")
  - openMediaInTab("/vault/DOC.PDF")
  - expect(document.querySelector("#media-viewer embed")).not.toBeNull()

it("clears #media-viewer innerHTML when switching between media tabs (EC-06, NFR-3)")
  - openMediaInTab("/vault/a.png")
  - openMediaInTab("/vault/b.pdf")
  - mv = document.getElementById("media-viewer")
  - expect(mv.querySelectorAll("img").length).toBe(0)
  - expect(mv.querySelectorAll("embed").length).toBe(1)
```

---

#### Group E: `_captureActiveTab` — media tab skipped (EC-08)

```
describe("_captureActiveTab — skipped for media tabs (EC-08)")

it("does not read editorView.state.doc.toString when active tab is kind:media")
  - const view = makeEditorView()
  - const docSpy = vi.spyOn(view.state.doc, "toString")
  - await manager.init(view)
  - openMediaInTab("/vault/photo.png")  — active tab is now media
  - docSpy.mockClear()
  - activateTab(some_other_id)  — this triggers _captureActiveTab on the media tab
  - NOTE: activateTab captures BEFORE switching, so we need to trigger a second
    switch back to the media tab to capture it. Alternatively call activateNextTab.
  - expect(docSpy).not.toHaveBeenCalled()
```

Implementation note for this test: the sequence that exercises `_captureActiveTab`
on a media tab is: (1) open media tab [it becomes active], (2) open a second tab,
(3) switch back to the media tab — step 2's `activateTab` calls
`_captureActiveTab()` on the media tab first. Alternatively:

```typescript
// Simpler sequence:
await openFileInTab("/vault/note.md")    // editor tab — active
openMediaInTab("/vault/photo.png")       // _captureActiveTab called on editor tab (ok)
// Now media tab is active. Open another editor tab → _captureActiveTab fires on media tab.
await openFileInTab("/vault/other.md")
// doc.toString must NOT have been called for the media tab
```

---

#### Group F: `saveSession` — excludes media tabs (EC-16)

```
describe("saveSession — excludes media tabs (EC-16)")

it("media tab with non-null filePath is excluded from openFiles")
  - await init with vault (so no untitled tab)
  - mock readFile to return ok for /vault/note.md
  - await openFileInTab("/vault/note.md")
  - openMediaInTab("/vault/photo.png")
  - mockUpdateSettings.mockClear()
  - await saveSession()
  - const call = mockUpdateSettings.mock.calls[0][0]
  - const result = call({ openFiles: [], activeTabIndex: 0 })  // invoke the updater
  - expect(result.openFiles.map(f => f.filePath)).toContain("/vault/note.md")
  - expect(result.openFiles.map(f => f.filePath)).not.toContain("/vault/photo.png")
```

---

#### Group G: `closeTab` — media-specific paths (FR-7, EC-12, EC-13)

```
describe("closeTab — media tab behaviour")

it("does not invoke confirm() when closing a media tab")
  - const confirmSpy = vi.spyOn(window, "confirm")
  - openMediaInTab("/vault/photo.png")
  - await manager.closeTab(manager.getActiveTab().id)
  - expect(confirmSpy).not.toHaveBeenCalled()

it("closing the last media tab (vault active) drops to 0 tabs and removes has-media-tab (EC-13)")
  - mock _settingsHaveActiveVault to return true
    (set the getCurrentSettings mock to return a settings object with a vault)
  - openMediaInTab("/vault/photo.png") — only tab
  - Close the Untitled tab first if it exists (or init with vault settings so no untitled)
  - await manager.closeTab(mediaTabId)
  - expect(manager.getTabCount()).toBe(0)
  - expect(document.getElementById("editor").classList.contains("has-media-tab")).toBe(false)

it("closing the last media tab (vault active) clears #media-viewer innerHTML (EC-13)")
  - same setup as above
  - await manager.closeTab(mediaTabId)
  - expect(document.getElementById("media-viewer").innerHTML).toBe("")
```

---

#### Group H: `_renderMediaViewer` — error handling (EC-03)

```
describe("_renderMediaViewer — error handling (EC-03)")

it("img error event replaces #media-viewer with .mv-load-error")
  - openMediaInTab("/vault/photo.png")
  - img = document.querySelector("#media-viewer img")
  - img.dispatchEvent(new Event("error"))
  - expect(document.querySelector("#media-viewer .mv-load-error")).not.toBeNull()
  - expect(document.querySelector("#media-viewer img")).toBeNull()

it("embed error event replaces #media-viewer with .mv-load-error")
  - openMediaInTab("/vault/doc.pdf")
  - embed = document.querySelector("#media-viewer embed")
  - embed.dispatchEvent(new Event("error"))
  - expect(document.querySelector("#media-viewer .mv-load-error")).not.toBeNull()
  - expect(document.querySelector("#media-viewer embed")).toBeNull()
```

---

#### Group I: EC-10 — `openMediaInTab` before `init()` completes

```
describe("EC-10 — openMediaInTab before init()")

it("calling openMediaInTab before init() does not throw")
  - manager = new TabManager()  // no init() called
  - expect(() => manager.openMediaInTab("/vault/photo.png")).not.toThrow()

it("tab is pushed to the array even when editorContainer is null")
  - manager = new TabManager()
  - manager.openMediaInTab("/vault/photo.png")
  - expect(manager.getTabCount()).toBe(1)
```

---

## `tests/plugins/file-browser/file-browser.test.ts` — Updates

### Fix 1: Remove `_testing.setPreviewedPath(null)` from `beforeEach`

Find in the `beforeEach` block:
```typescript
  _testing.setPreviewedPath(null);
```
Delete this line entirely.

### Fix 2: Update `setupTabManager()` helper

The current `setupTabManager()` creates a mock with only `openFileInTab`. The
new routing calls `openMediaInTab`. Update the function to add it:

```typescript
function setupTabManager() {
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn().mockResolvedValue(true),
    openMediaInTab: vi.fn(),
  };
}
```

### Fix 3: Add three new tests

Add a new describe block after the existing routing tests:

```typescript
describe("buildActivateHandler — openMediaInTab routing (media-preview-v2)")

it("clicking a non-md file calls openMediaInTab, not openFileInTab")
  - const container = renderWithPaths(["/notes/photo.jpg"])
  - node = container.querySelector('[data-path="/notes/photo.jpg"]')
  - node.click()
  - expect(window.__MARKABLE_TAB_MANAGER__.openMediaInTab).toHaveBeenCalledWith("/notes/photo.jpg")
  - expect(window.__MARKABLE_TAB_MANAGER__.openFileInTab).not.toHaveBeenCalled()

it("clicking a .md file still calls openFileInTab (regression guard)")
  - const container = renderWithPaths(["/notes/note.md"])
  - node = container.querySelector('[data-path="/notes/note.md"]')
  - node.click()
  - expect(window.__MARKABLE_TAB_MANAGER__.openFileInTab).toHaveBeenCalledWith("/notes/note.md")
  - expect(window.__MARKABLE_TAB_MANAGER__.openMediaInTab).not.toHaveBeenCalled()

it("_testing no longer exports getPreviewedPath, setPreviewedPath, showMediaPreview, closeMediaPreview")
  - expect((_testing as any).getPreviewedPath).toBeUndefined()
  - expect((_testing as any).setPreviewedPath).toBeUndefined()
  - expect((_testing as any).showMediaPreview).toBeUndefined()
  - expect((_testing as any).closeMediaPreview).toBeUndefined()
```

---

## Verification

```bash
# All tab tests — must be green
npm run test:run -- tests/tabs/

# file-browser tests — must be green
npm run test:run -- tests/plugins/file-browser/file-browser.test.ts

# Full suite
npm run test:run
```

Expected: all tests pass. No test file references `media-preview.test.ts`.

---

## Edge Cases Cross-Reference

| Requirement EC | Test group | Test description |
|---|---|---|
| EC-01 (duplicate path) | B | "returns false when same path already open" |
| EC-02 (re-click after close) | A | Covered by creation test sequence |
| EC-03 (file deleted) | H | img/embed error event → .mv-load-error |
| EC-04 (no extension) | D | ".mv-unsupported for unrecognised extension" |
| EC-05 (uppercase extension) | D | ".JPG renders img", ".PDF renders embed" |
| EC-06 (multiple media tabs) | D | "clears innerHTML when switching media tabs" |
| EC-07 (switch media→editor) | D | "removes has-media-tab when switching to editor" |
| EC-08 (switch editor→media) | E | "_captureActiveTab skipped for media" |
| EC-09 (vault switch) | — | Covered implicitly by vault-change path in file-browser tests; no tab-manager test needed |
| EC-10 (before init) | I | "openMediaInTab before init does not throw" |
| EC-11 (convertFileSrc unavailable) | — | Not applicable: convertFileSrc is a direct ES import; test environment mocks it unconditionally |
| EC-12 (last tab, no vault, window close) | G | Covered by existing closeTab tests (not broken) |
| EC-13 (last tab, vault active) | G | "last media tab vault active clears has-media-tab and innerHTML" |
| EC-14 (rapid successive clicks) | A/B | Each click is synchronous; dedup guard + creation tests cover this |
| EC-15 (editor tab same path not duplicate) | B | "kind:editor tab not treated as duplicate" |
| EC-16 (session restore excludes media) | F | "media tab excluded from openFiles" |

---

## Checklist

- [ ] `tests/tabs/media-tab.test.ts` created with all groups A–I
- [ ] All 16 EC assertions present
- [ ] `file-browser.test.ts` `beforeEach` no longer calls `setPreviewedPath`
- [ ] `setupTabManager()` in `file-browser.test.ts` includes `openMediaInTab` spy
- [ ] Three new routing tests added to `file-browser.test.ts`
- [ ] `npm run test:run` exits 0 with no failing tests
