---
title: "Step 01 — Module State, CSS Additions, closeMediaPreview, showMediaPreview"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 01 — Module State, CSS Additions, `closeMediaPreview`, `showMediaPreview`

Single responsibility: add the new module-level variable, append the CSS, and implement
the two new pure-DOM functions. Nothing in `buildActivateHandler` or `renderPanel` is
touched in this step. Tests for these two functions can be written and made Green
independently of step_02.

---

## Files Touched

Only: `src/plugins/file-browser/file-browser.plugin.ts`

---

## 1A. Red Tests — Write These First

Create `tests/plugins/file-browser/media-preview.test.ts`.

Copy the following helpers verbatim from `file-browser.test.ts` (do not create a shared
fixture module yet):

- `makeVault()`
- `makeVaultIndex()`
- `makeContainer()`
- `setupVaultManager()`
- `setupTabManager()`
- `setupTauriInternals()`
- `makeMockApi()`
- The `beforeEach` / `afterEach` blocks (reset `_testing` state, teardown window globals)

Add `__MARKABLE_CONVERT_FILE_SRC__` setup to `beforeEach`:

```typescript
beforeEach(() => {
  // ... existing resets ...
  (window as any).__MARKABLE_CONVERT_FILE_SRC__ = (p: string) =>
    "asset://localhost/" + encodeURIComponent(p);
});

afterEach(() => {
  // ... existing cleanups ...
  delete (window as any).__MARKABLE_CONVERT_FILE_SRC__;
});
```

### Suite: `showMediaPreview — panel creation` (FR-2, FR-4)

```typescript
describe("showMediaPreview — panel creation", () => {
  it("creates .file-browser-media-preview as last child of .file-browser-panel", () => { ... });
  it("preview element contains .fbmp-header and .fbmp-content children", () => { ... });
  it("fbmp-header contains .fbmp-filename with the basename", () => { ... });
  it("fbmp-header contains .fbmp-close button with aria-label 'Close preview'", () => { ... });
  it("fbmp-close button has text content '×'", () => { ... });
  it("preview panel is visible (display is not 'none') after showMediaPreview", () => { ... });
});
```

### Suite: `showMediaPreview — type routing` (FR-3, EC-06, EC-07)

```typescript
describe("showMediaPreview — file type routing", () => {
  it("renders <img> for .jpg", () => { ... });
  it("renders <img> for .jpeg", () => { ... });
  it("renders <img> for .png", () => { ... });
  it("renders <img> for .gif", () => { ... });
  it("renders <img> for .webp", () => { ... });
  it("renders <img> for .bmp", () => { ... });
  it("renders <img> for .ico", () => { ... });
  it("renders <img> for .svg (not <object>)", () => { ... });
  it("renders <embed type='application/pdf'> for .pdf", () => { ... });
  it("renders .fbmp-unsupported <p> for .txt (EC-06)", () => { ... });
  it("renders .fbmp-unsupported for a file with no extension (EC-06)", () => { ... });
  it("renders <img> for .JPG — case insensitive (EC-07)", () => { ... });
  it("renders <embed> for .PDF — case insensitive (EC-07)", () => { ... });
  it("<img> has alt attribute equal to the basename", () => { ... });
  it("<img> src is the asset:// URL from __MARKABLE_CONVERT_FILE_SRC__", () => { ... });
  it("<embed> src is the asset:// URL", () => { ... });
});
```

### Suite: `showMediaPreview — in-place replacement` (FR-5, EC-03, EC-14)

```typescript
describe("showMediaPreview — in-place replacement (FR-5)", () => {
  it("clicking a second non-md file replaces content without adding a second preview element", () => { ... });
  it("fbmp-filename is updated to the new basename on replacement", () => { ... });
  it("only one .file-browser-media-preview element exists after two successive calls", () => { ... });
});
```

### Suite: `closeMediaPreview — dismiss` (FR-7 clause 1, EC-02)

```typescript
describe("closeMediaPreview", () => {
  it("clicking the × button hides the preview panel (display:none)", () => { ... });
  it("clicking the × button sets _previewedPath to null", () => { ... });
  it("closeMediaPreview() is idempotent — double call does not throw", () => { ... });
  it("closeMediaPreview() is a no-op when _previewedPath is null", () => { ... });
});
```

### Suite: `FR-10 — error states` (EC-01, EC-10)

```typescript
describe("FR-10 error states", () => {
  it("img error event replaces content with .fbmp-load-error paragraph (EC-01)", () => { ... });
  it("embed error event replaces content with .fbmp-load-error paragraph", () => { ... });
  it("fallback to raw path when __MARKABLE_CONVERT_FILE_SRC__ is undefined (EC-10)", () => { ... });
});
```

### Suite: `EC-11 — null panel guard`

```typescript
describe("EC-11 — null _panelContainer guard", () => {
  it("showMediaPreview with null _panelContainer does not throw", () => { ... });
  it("showMediaPreview when .file-browser-panel is absent does not throw", () => { ... });
});
```

At this point all tests should be **Red** (fail with import errors or runtime errors)
because `_testing.showMediaPreview` and `_testing.closeMediaPreview` do not exist yet.

---

## 1B. Green Implementation

### 1. Add `_previewedPath` variable

Locate the block around line 652 in `file-browser.plugin.ts` (after `_fsDebounceTimer`):

```typescript
/** FS event debounce timer handle. Null when no pending event. */
let _fsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
```

Add immediately after:

```typescript
/**
 * The absolute path of the currently-previewed non-md file, or null.
 * Set by showMediaPreview, cleared by closeMediaPreview.
 */
let _previewedPath: string | null = null;
```

### 2. Append CSS to `FILE_BROWSER_CSS`

Locate the end of the `FILE_BROWSER_CSS` template literal. The final visible rule before the
closing backtick is `.manage-vaults-list-header { ... }` ending at approximately line 516.
Insert the following block **before** the closing backtick:

```css

/* ── Media Preview Panel (FR-12, FR-13) ──────────────────────────────────── */
.file-browser-media-preview {
  flex-shrink: 0;
  height: var(--fbmp-height, 200px);
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-color, rgba(128,128,128,.2));
  background: var(--sidebar-bg, var(--bg-color));
  font-family: var(--ui-font);
}
.fbmp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.15));
}
.fbmp-filename {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.fbmp-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  padding: 0 0 0 6px;
  flex-shrink: 0;
}
.fbmp-close:hover { color: var(--accent-color); }
.fbmp-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--code-bg, var(--bg-color));
}
.fbmp-content img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.fbmp-content embed {
  width: 100%;
  height: 100%;
  display: block;
}
.fbmp-unsupported,
.fbmp-load-error {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  margin: 0;
  padding: 8px;
}
/*
 * FR-11: lift opacity dim from source files when actively previewed.
 * This rule MUST appear after .tree-node-source-file in the cascade.
 * Appending it here (end of FILE_BROWSER_CSS) guarantees that order
 * because both rules are in the same <style> element.
 */
.tree-node-active { opacity: 1; }
```

### 3. Implement `closeMediaPreview`

Insert this function after the module-level variable block and before `buildActivateHandler`
(approximately after line 655 and before the activate handler section around line 1399):

```typescript
/**
 * Hide the media preview panel and clear the previewed-path state.
 *
 * Idempotent — safe to call when no preview is open (_previewedPath === null).
 * Uses display:none (not DOM removal) so the element can be re-shown cheaply.
 *
 * Called from:
 *   - closeBtn click handler (inside showMediaPreview)
 *   - buildActivateHandler (toggle: same file clicked twice)
 *   - renderPanel (before innerHTML = "")
 *   - destroy (before container.innerHTML = "")
 */
function closeMediaPreview(): void {
  if (_previewedPath === null) return;
  const prev = _previewedPath;
  _previewedPath = null;
  if (_treeEl) {
    const prevNode = _treeEl.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(prev)}"]`,
    );
    prevNode?.classList.remove("tree-node-active");
  }
  const panel = _panelContainer?.querySelector<HTMLElement>(
    ".file-browser-media-preview",
  );
  if (panel) panel.style.display = "none";
}
```

### 4. Implement `showMediaPreview`

Insert immediately after `closeMediaPreview`:

```typescript
/**
 * Open or replace the media preview panel for a non-md file.
 *
 * Synchronous (NFR-1). Reuses the existing .file-browser-media-preview element
 * if present (FR-5 in-place replacement). Creates it and appends it to
 * .file-browser-panel on first call.
 *
 * Guards:
 *   - Returns early if _panelContainer is null or .file-browser-panel is absent (EC-11).
 *   - Optional-chains __MARKABLE_CONVERT_FILE_SRC__ with path fallback (EC-10).
 *
 * @param path - Absolute filesystem path of the file to preview.
 */
function showMediaPreview(path: string): void {
  const panelWrapper = _panelContainer?.querySelector<HTMLElement>(
    ".file-browser-panel",
  );
  if (!panelWrapper) return; // EC-11

  const basename = path.split("/").pop() ?? path;

  // Remove active class from the previously-previewed node before updating state.
  if (_previewedPath !== null && _treeEl) {
    const prev = _treeEl.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(_previewedPath)}"]`,
    );
    prev?.classList.remove("tree-node-active");
  }
  _previewedPath = path;

  // Apply tree-node-active to the newly-clicked node.
  if (_treeEl) {
    const node = _treeEl.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(path)}"]`,
    );
    node?.classList.add("tree-node-active");
  }

  // Reuse existing element or create it (FR-5).
  let previewEl = panelWrapper.querySelector<HTMLElement>(
    ".file-browser-media-preview",
  );
  if (!previewEl) {
    previewEl = document.createElement("div");
    previewEl.className = "file-browser-media-preview";
    panelWrapper.appendChild(previewEl);
  }
  previewEl.style.display = ""; // un-hide if previously hidden by closeMediaPreview

  // Build header (FR-4).
  const header = document.createElement("div");
  header.className = "fbmp-header";

  const filenameEl = document.createElement("span");
  filenameEl.className = "fbmp-filename";
  filenameEl.textContent = basename;
  filenameEl.title = basename;

  const closeBtn = document.createElement("button");
  closeBtn.className = "fbmp-close";
  closeBtn.setAttribute("aria-label", "Close preview");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => closeMediaPreview());

  header.appendChild(filenameEl);
  header.appendChild(closeBtn);

  // Build content area (FR-3).
  const content = document.createElement("div");
  content.className = "fbmp-content";

  // EC-10: optional-chain the global; fall back to raw path if absent.
  const assetUrl =
    (window as any).__MARKABLE_CONVERT_FILE_SRC__?.(path) ?? path;

  const ext = path.toLowerCase().split(".").pop() ?? "";
  const RASTER_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "svg"];

  if (RASTER_EXTS.includes(ext)) {
    const img = document.createElement("img");
    img.src = assetUrl;
    img.alt = basename;
    img.addEventListener("error", () => {
      content.innerHTML = `<p class="fbmp-load-error">Could not load file.</p>`;
    });
    content.appendChild(img);
  } else if (ext === "pdf") {
    const embed = document.createElement("embed");
    embed.src = assetUrl;
    embed.type = "application/pdf";
    embed.width = "100%";
    embed.height = "100%";
    embed.addEventListener("error", () => {
      content.innerHTML = `<p class="fbmp-load-error">Could not load file.</p>`;
    });
    content.appendChild(embed);
  } else {
    const msg = document.createElement("p");
    msg.className = "fbmp-unsupported";
    msg.textContent = "Cannot preview this file type.";
    content.appendChild(msg);
  }

  // Replace inner content in-place; old media element and its listeners are discarded.
  previewEl.innerHTML = "";
  previewEl.appendChild(header);
  previewEl.appendChild(content);
}
```

### 5. Verify tests are Green

```
npm run test:run -- tests/plugins/file-browser/media-preview.test.ts
```

All suites defined in section 1A should pass. No other tests should break.

### 6. Build and sync

```
npm run build:plugins && npm run sync:plugins
```

---

## Definition of Done for Step 01

- `_previewedPath` declared at module level, initialized to `null`.
- All `.fbmp-*` CSS rules appended to `FILE_BROWSER_CSS`; `.tree-node-active { opacity:1 }`
  is the last rule in the string.
- `closeMediaPreview()` implemented and exported through `_testing`.
- `showMediaPreview(path)` implemented and exported through `_testing`.
- All Red tests from section 1A are now Green.
- No existing tests in `file-browser.test.ts` are broken.
