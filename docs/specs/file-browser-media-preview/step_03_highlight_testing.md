---
title: "Step 03 — buildNodeEl Highlight, _testing Exports, Full Test Suite Completion"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 03 — `buildNodeEl` Highlight, `_testing` Exports, Full Test Suite Completion

Single responsibility: extend `buildNodeEl` to apply `tree-node-active` to the currently-
previewed non-md file on re-renders; extend the `_testing` export so all internal functions
are accessible from tests; add the remaining test suites; confirm the complete 14-edge-case
coverage.

Prerequisite: step_01 and step_02 are complete and all their tests are Green.

---

## Files Touched

- `src/plugins/file-browser/file-browser.plugin.ts`
- `tests/plugins/file-browser/media-preview.test.ts`

---

## 3A. Red Tests — Write These First

Add the following suites to `tests/plugins/file-browser/media-preview.test.ts`.

### Suite: `FR-8 — active highlight persists across renderPanel` (FR-8)

```typescript
describe("FR-8 — previewed non-md file keeps tree-node-active on re-render", () => {
  it("re-rendering the panel re-applies tree-node-active to the previewed file's node", () => {
    // Arrange: vault index has "/notes/image.png"
    // Set up: _testing.setPreviewedPath("/notes/image.png")
    //   (direct state injection, simulating an open preview without clicking)
    // Act: renderPanel()
    // Assert: node [data-path="/notes/image.png"] has class tree-node-active
  });

  it("tree-node-active is NOT applied to non-previewed non-md files", () => {
    // Index has /notes/a.png and /notes/b.png; only a.png is previewed.
    // After renderPanel(), b.png node does NOT have tree-node-active.
  });

  it("closeMediaPreview removes tree-node-active from the node after renderPanel", () => {
    // Set previewedPath, renderPanel to get the node in DOM.
    // Call closeMediaPreview().
    // Assert tree-node-active removed.
  });
});
```

### Suite: `FR-11 — opacity override` (FR-11)

```typescript
describe("FR-11 — opacity override for previewed source file", () => {
  it(".tree-node-active rule is present in the injected CSS", () => {
    // injectFileBrowserCSS()
    // const styleEl = document.getElementById("__markable_file_browser_css__")
    // Assert styleEl.textContent includes ".tree-node-active" and "opacity: 1"
    // This verifies the cascade override was appended.
  });

  it(".tree-node-source-file class and .tree-node-active class can coexist on the same node", () => {
    // Build a node el for a non-md file that is previewed.
    // Assert it has BOTH classes.
    // (The CSS cascade handles the visual outcome; the DOM structure is what we test here.)
  });
});
```

### Suite: `EC-13 — no vault index lookup at click time`

```typescript
describe("EC-13 — data-path attribute is the only input to showMediaPreview", () => {
  it("showMediaPreview does not call __TAURI_INTERNALS__.invoke", () => {
    // Set up vault manager.
    // Render panel with a non-md file.
    // Call _testing.showMediaPreview(path) directly.
    // Assert __TAURI_INTERNALS__.invoke was NOT called.
  });
});
```

### Suite: `search-filtered view — non-md preview` (EC-05)

The EC-05 test was specified in step_02 under `buildActivateHandler` suites. Verify it is
included. If it was deferred, add it here.

```typescript
describe("EC-05 — non-md file in search-filtered view", () => {
  it("clicking a non-md node in search results opens preview correctly", () => {
    // _testing.setSearchQuery("png")
    // renderPanel() — flat search list
    // click the non-md node
    // assert _testing.getPreviewedPath() === path
  });
});
```

All these tests should be **Red** until the `buildNodeEl` change and `_testing` extensions
are implemented.

---

## 3B. Green Implementation

### 1. Extend `buildNodeEl` active-highlight condition

Current code (lines ~989–998 of `file-browser.plugin.ts`):

```typescript
/* Active file highlight */
if (node.type === "file" && activeFile && node.path === activeFile) {
  li.classList.add("tree-node-active");
}

/* Source-file dimming: non-folder, non-.md files (images, PDFs, etc.)
   are editable only in source mode — dim them to 50% to show this. */
if (node.type === "file" && !node.path.toLowerCase().endsWith(".md")) {
  li.classList.add("tree-node-source-file");
}
```

Replace **only the active-highlight block** with:

```typescript
/* Active file highlight — open tab (markdown) OR currently-previewed non-md file (FR-8). */
if (
  node.type === "file" &&
  ((activeFile && node.path === activeFile) || node.path === _previewedPath)
) {
  li.classList.add("tree-node-active");
}
```

The `tree-node-source-file` block immediately below is unchanged.

Explanation: on a `renderPanel()` call (e.g. after a vault-index rebuild), both the active
markdown file and the currently-previewed asset must show their highlights. Reading
`_previewedPath` from module scope here is the idiomatic pattern used by `activeFile`
(which is read from `window.__MARKABLE_CURRENT_FILE__` in `renderTreeContent`).

Important ordering note: `renderPanel` calls `closeMediaPreview()` first, which sets
`_previewedPath = null` before `buildNodeEl` runs. This means that when `renderPanel`
is called as part of a vault-change teardown, the highlight is correctly absent. When
`_previewedPath` is non-null (a preview is actively open and `renderPanel` was called
for an incremental update, e.g. via `_indexUpdatedCb`), the highlight re-applies correctly.

The `_indexUpdatedCb` path calls `renderPanel()` directly. Because `renderPanel` now calls
`closeMediaPreview()`, an index update while a preview is open will close the preview.
This is the correct behaviour per EC-04 (vault changes clear the preview). Index updates
and vault changes are equivalent from the user's perspective — both indicate the vault
contents have changed.

### 2. Extend `_testing` export

Add the following entries to the `_testing` object (lines ~2787–2887):

```typescript
/** Get the currently-previewed path (null when no preview is open). */
getPreviewedPath(): string | null {
  return _previewedPath;
},
/** Directly set the previewed path (for test state injection). */
setPreviewedPath(p: string | null): void {
  _previewedPath = p;
},
/** Expose showMediaPreview for direct testing. */
showMediaPreview,
/** Expose closeMediaPreview for direct testing. */
closeMediaPreview,
```

Also add `_previewedPath` reset to the `beforeEach` in both test files:

```typescript
_testing.setPreviewedPath(null);
```

### 3. Update `beforeEach` in `media-preview.test.ts`

Ensure the `beforeEach` block resets `_previewedPath`:

```typescript
beforeEach(() => {
  _testing.setPanelContainer(null);
  _testing.setTreeEl(null);
  _testing.setSearchQuery("");
  _testing.setIsLoading(false);
  _testing.setCurrentTree([]);
  _testing.setExpandedPaths(new Set());
  _testing.setPreviewedPath(null);   // <-- add this line

  (window as any).__MARKABLE_CURRENT_FILE__ = null;
  (window as any).__MARKABLE_CONVERT_FILE_SRC__ = (p: string) =>
    "asset://localhost/" + encodeURIComponent(p);

  document.body.innerHTML = "";
  setupTabManager();
  setupTauriInternals();
});
```

### 4. Verify all tests are Green

Run the complete test suite:

```
npm run test:run
```

Expected: all tests in both `file-browser.test.ts` and `media-preview.test.ts` pass.
No regressions.

### 5. Build and sync

```
npm run build:plugins && npm run sync:plugins
```

---

## 3C. Edge Case Coverage Verification

Before marking this step complete, verify that every edge case from `active_task.md` has
a test assertion:

| Edge Case | Test suite / describe | Status |
|---|---|---|
| EC-01 | `FR-10 error states` / img error event | step_01 |
| EC-02 | `buildActivateHandler` / toggle | step_02 |
| EC-03 | `showMediaPreview — in-place replacement` | step_01 |
| EC-04 | `vault-change cleanup` | step_02 |
| EC-05 | `buildActivateHandler` / search-filtered view | step_02 / step_03 |
| EC-06 | `showMediaPreview — type routing` / no extension | step_01 |
| EC-07 | `showMediaPreview — type routing` / uppercase | step_01 |
| EC-08 | `destroy cleanup` | step_02 |
| EC-09 | `destroy cleanup` / onDisable | step_02 |
| EC-10 | `FR-10 error states` / undefined global | step_01 |
| EC-11 | `EC-11 — null guard` | step_01 |
| EC-12 | Accepted — no test needed (WKWebView PDF is out of scope) | N/A |
| EC-13 | `EC-13 — no vault index lookup` | step_03 |
| EC-14 | `showMediaPreview — in-place replacement` (synchronous, no race) | step_01 |

---

## Definition of Done for Step 03

- `buildNodeEl` applies `tree-node-active` to nodes matching `_previewedPath`.
- `_testing` exports include `getPreviewedPath`, `setPreviewedPath`,
  `showMediaPreview`, `closeMediaPreview`.
- All Red tests from section 3A are now Green.
- All step_01 and step_02 tests remain Green.
- All 14 edge cases have a corresponding test assertion (EC-12 explicitly waived).
- No existing tests in `file-browser.test.ts` are broken.
- Feature is complete and ready for code review.
