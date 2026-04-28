---
title: "Step 02 — buildActivateHandler Routing, renderPanel + destroy Integration"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 02 — `buildActivateHandler` Routing, `renderPanel` + `destroy` Integration

Single responsibility: wire the new functions from step_01 into the existing event and
lifecycle code paths. No new DOM construction is introduced here — this step is purely
about call-site integration.

Prerequisite: step_01 is complete and all its tests are Green.

---

## Files Touched

Only: `src/plugins/file-browser/file-browser.plugin.ts`

---

## 2A. Red Tests — Write These First

Add the following suites to `tests/plugins/file-browser/media-preview.test.ts`.

### Suite: `buildActivateHandler — click routing` (FR-1, EC-02, EC-05)

```typescript
describe("buildActivateHandler — click routing", () => {
  it("clicking a non-md file node does NOT call openFileInTab (FR-1)", () => {
    // Set up vault index with a non-md file.
    // Render the panel.
    // Click the non-md file node.
    // Assert openFileInTab was NOT called.
  });

  it("clicking a non-md file node calls showMediaPreview (via _testing.getPreviewedPath)", () => {
    // Click the non-md node.
    // Assert _testing.getPreviewedPath() === the file path.
  });

  it("clicking a .md file node still calls openFileInTab (FR-1 — md path unchanged)", () => {
    // Click an .md node.
    // Assert openFileInTab was called with the md path.
  });

  it("clicking a .MD file (uppercase extension) calls showMediaPreview, not openFileInTab (EC-07)", () => {
    // index has "/notes/photo.JPG"
    // click that node
    // assert openFileInTab not called
    // assert _previewedPath === "/notes/photo.JPG"
  });

  it("clicking the same non-md file twice closes the preview (EC-02 toggle)", () => {
    // First click: preview opens.
    // Second click: _previewedPath becomes null, panel hidden.
  });

  it("clicking the same non-md file twice: second click does NOT call openFileInTab (EC-02)", () => {
    // Assert openFileInTab never called for non-md, even on toggle.
  });

  it("clicking a second non-md file replaces the preview (EC-03)", () => {
    // click file A → preview A open
    // click file B → preview B open, _previewedPath === path B
    // only one .file-browser-media-preview element in DOM
  });

  it("clicking a non-md file in search-filtered view shows preview (EC-05)", () => {
    // Set _testing.setSearchQuery("jpg").
    // Render panel (flat search list).
    // Click the non-md node.
    // Assert preview opens.
  });
});
```

### Suite: `vault-change cleanup` (EC-04)

```typescript
describe("vault-change cleanup (EC-04)", () => {
  it("onVaultChanged closes an open preview before re-rendering", () => {
    // Open a preview.
    // Emit vault-changed via vm._emitVaultChanged().
    // Assert _testing.getPreviewedPath() is null after re-render.
  });

  it("after vault change the new render has no .file-browser-media-preview visible", () => {
    // Open a preview.
    // Emit vault-changed.
    // Assert no .file-browser-media-preview with display !== 'none' in DOM.
  });
});
```

### Suite: `destroy cleanup` (EC-08, EC-09)

```typescript
describe("destroy cleanup (EC-08 / EC-09)", () => {
  it("destroy clears _previewedPath", () => {
    // Open a preview.
    // Call descriptor.destroy(container).
    // Assert _testing.getPreviewedPath() is null.
  });

  it("destroy does not throw when no preview is open", () => {
    // No preview opened.
    // descriptor.destroy(container) — must not throw.
  });

  it("onDisable with an open preview leaves _previewedPath null", () => {
    // Enable plugin, open preview, call onDisable.
    // Assert _testing.getPreviewedPath() is null.
  });
});
```

### Suite: `renderPanel clears preview` (NFR-3)

```typescript
describe("renderPanel clears preview state (NFR-3)", () => {
  it("calling renderPanel while a preview is open hides the preview", () => {
    // Open a preview.
    // Call renderPanel() again (simulates vault index refresh).
    // Assert no visible .file-browser-media-preview after re-render.
  });
});
```

All these tests should be **Red** until the integration changes are applied.

---

## 2B. Green Implementation

### 1. Modify `buildActivateHandler`

Current code (lines ~1405–1407 of `file-browser.plugin.ts`):

```typescript
if (type === "file") {
  void (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(path);
}
```

Replace **only the `type === "file"` branch** with:

```typescript
if (type === "file") {
  if (path.toLowerCase().endsWith(".md")) {
    // Markdown file: open in editor tab (unchanged behaviour).
    void (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(path);
  } else {
    // Non-md asset: show inline preview or toggle closed (FR-1, EC-02).
    if (_previewedPath === path) {
      closeMediaPreview();
    } else {
      showMediaPreview(path);
    }
  }
}
```

Nothing else in `buildActivateHandler` changes. The vault, directory, and keyboard
branches are untouched.

Note: the `.md` extension check is case-insensitive via `.toLowerCase()`, consistent with
the existing `tree-node-source-file` guard in `buildNodeEl` (FR-1 spec requirement).

### 2. Modify `renderPanel`

Current code (lines ~1099–1101):

```typescript
export function renderPanel(): void {
  if (!_panelContainer) return;
  _panelContainer.innerHTML = "";
```

Insert `closeMediaPreview()` call between the guard and the innerHTML reset:

```typescript
export function renderPanel(): void {
  if (!_panelContainer) return;
  closeMediaPreview(); // prevent orphaned state after DOM teardown (NFR-3, EC-04)
  _panelContainer.innerHTML = "";
```

Rationale: `innerHTML = ""` destroys the preview DOM. If `_previewedPath` were not cleared
first, the next `buildNodeEl` call inside the rebuild would incorrectly re-apply
`tree-node-active` to the re-rendered node (the `buildNodeEl` change in step_03 reads
`_previewedPath`), making the highlight appear without the preview panel being visible.
Calling `closeMediaPreview()` first resets both the DOM state and the variable atomically.

### 3. Modify `destroy`

Current code (lines ~2639–2645):

```typescript
destroy(container: HTMLElement): void {
  /* Clear DOM before nulling refs — prevents listener leaks (HIGH-1) */
  container.innerHTML = "";
  _panelContainer = null;
  _treeEl = null;
  _searchEl = null;
},
```

Insert `closeMediaPreview()` as the first statement:

```typescript
destroy(container: HTMLElement): void {
  closeMediaPreview(); // clear _previewedPath and tree-node-active before DOM teardown (EC-08)
  /* Clear DOM before nulling refs — prevents listener leaks (HIGH-1) */
  container.innerHTML = "";
  _panelContainer = null;
  _treeEl = null;
  _searchEl = null;
},
```

`closeMediaPreview()` must run **before** `container.innerHTML = ""` because at that moment
`_treeEl` still points to live DOM — the query inside `closeMediaPreview` for `[data-path]`
nodes is able to remove `tree-node-active` from the correct node. After `innerHTML = ""` the
tree nodes are detached; the query would silently find nothing. The `_previewedPath` reset is
what matters most, and that works regardless of DOM state, but the ordering is intentional
for correctness.

### 4. Verify tests are Green

```
npm run test:run -- tests/plugins/file-browser/media-preview.test.ts
```

All suites from step_01 and step_02 should pass. Run the full test suite to confirm no
regressions:

```
npm run test:run
```

### 5. Build and sync

```
npm run build:plugins && npm run sync:plugins
```

---

## Definition of Done for Step 02

- `buildActivateHandler` routes non-md files to `showMediaPreview`/`closeMediaPreview`;
  `.md` files still call `openFileInTab`.
- `renderPanel` calls `closeMediaPreview()` before `_panelContainer.innerHTML = ""`.
- `destroy` calls `closeMediaPreview()` as its first statement.
- All Red tests from section 2A are now Green.
- All step_01 tests remain Green.
- No existing tests in `file-browser.test.ts` are broken.
