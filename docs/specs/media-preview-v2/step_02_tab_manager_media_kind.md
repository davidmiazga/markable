---
title: "Step 02 — Add kind to TabEntry and Implement TabManager Media Support"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 02 — Add `kind` to `TabEntry` and Implement TabManager Media Support

## Goal

1. Add `TabKind` type and `kind` field to `TabEntry` in `tab-types.ts`.
2. Implement all media-related changes in `tab-manager.ts`:
   - `#editorContainer` and `#mediaViewerEl` private fields.
   - `init()` injects `#media-viewer` into `#editor`.
   - `openMediaInTab(filePath)` public method.
   - `_basenameFromPath(filePath)` private helper.
   - `_renderMediaViewer(filePath)` private method.
   - `_applyActiveTab()` updated for media/editor branching.
   - `_captureActiveTab()` short-circuits for media tabs.
   - `closeTab()` dirty-check guard updated.
   - `saveSession()` filter updated.
   - All existing `TabEntry` construction sites gain `kind: "editor"`.

After this step `TabManager.openMediaInTab` exists and is callable. The file
browser does not call it yet (that wiring is step_03).

---

## Files Changed

| File | Action |
|---|---|
| `src/tabs/tab-types.ts` | Add `TabKind` type and `kind` field |
| `src/tabs/tab-manager.ts` | Multiple additions and modifications |

---

## Changes to `src/tabs/tab-types.ts`

### T-1: Add `TabKind` type

Insert before the `TabEntry` interface:

```typescript
/**
 * Discriminant for a tab's content kind.
 *
 * "editor" — a Markdown document managed by the shared CodeMirror 6 EditorView.
 * "media"  — an image, PDF, or other non-text asset rendered in #media-viewer.
 *
 * All tabs created before this field was added default to "editor". No
 * migration is required because session restore only persists editor tabs.
 */
export type TabKind = "editor" | "media";
```

### T-2: Add `kind` field to `TabEntry`

Add as the second field (after `id`, before `filePath`):

```typescript
  /**
   * Discriminates between a Markdown editor tab and a media-file viewer tab.
   * Defaults to "editor" for all tabs created before this field existed.
   */
  kind: TabKind;
```

---

## Changes to `src/tabs/tab-manager.ts`

### TM-1: Add `convertFileSrc` import

At the top of `tab-manager.ts`, alongside existing imports from `@tauri-apps/api/*`:

```typescript
import { convertFileSrc } from "@tauri-apps/api/core";
```

### TM-2: Update the `TabEntry` type import

The import line:
```typescript
import type { TabEntry, ITabRenderer } from "./tab-types";
```
becomes:
```typescript
import type { TabEntry, TabKind, ITabRenderer } from "./tab-types";
```

(`TabKind` is used in `_basenameFromPath`'s return-type annotation — importing it
is optional if the developer prefers inline `"editor" | "media"` syntax, but
importing the named type is preferred for consistency.)

### TM-3: Add private fields for editor container and media viewer

After the `private _hidSidebarForVertical = false;` line, add:

```typescript
/** The #editor DOM element, stored in init() for fast access in _applyActiveTab. */
private editorContainer: HTMLElement | null = null;

/** The #media-viewer DOM element injected by init(). Never removed from DOM. */
private mediaViewerEl: HTMLElement | null = null;
```

### TM-4: Update `_createUntitledTab()` — add `kind: "editor"`

Change the returned object literal from:
```typescript
    return {
      id: crypto.randomUUID(),
      filePath: null,
      title: "Untitled",
      isDirty: false,
      doc: "",
      scrollTop: 0,
    };
```
to:
```typescript
    return {
      id: crypto.randomUUID(),
      kind: "editor",
      filePath: null,
      title: "Untitled",
      isDirty: false,
      doc: "",
      scrollTop: 0,
    };
```

### TM-5: Update session restore in `init()` — add `kind: "editor"`

In the `for (const entry of openFiles)` loop, the `this.tabs.push({...})` object:
```typescript
      this.tabs.push({
        id: crypto.randomUUID(),
        filePath: entry.filePath,
        title: this._titleFromPath(entry.filePath),
        isDirty: false,
        doc: result.value,
        scrollTop: entry.scrollTop,
      });
```
becomes:
```typescript
      this.tabs.push({
        id: crypto.randomUUID(),
        kind: "editor",
        filePath: entry.filePath,
        title: this._titleFromPath(entry.filePath),
        isDirty: false,
        doc: result.value,
        scrollTop: entry.scrollTop,
      });
```

### TM-6: Add `editorContainer` and `mediaViewerEl` setup to `init()`

After `this.tabStripEl = document.getElementById("tab-strip");`, add:

```typescript
    // Store the #editor container for fast access by _applyActiveTab.
    this.editorContainer = document.getElementById("editor");
```

After the final `this._applyActiveTab();` call at the end of `init()`, append:

```typescript
    // Inject #media-viewer as a sibling to .cm-editor inside #editor.
    // Created once for the app lifetime; hidden by default via CSS.
    if (this.editorContainer) {
      const mv = document.createElement("div");
      mv.id = "media-viewer";
      this.editorContainer.appendChild(mv);
      this.mediaViewerEl = mv;
    }
```

### TM-7: Update `openFileInTab()` — add `kind: "editor"` to new tab

In `openFileInTab`, the `newTab` object literal:
```typescript
    const newTab: TabEntry = {
      id: crypto.randomUUID(),
      filePath,
      title: this._titleFromPath(filePath),
      isDirty: false,
      doc: result.value,
      scrollTop: 0,
    };
```
becomes:
```typescript
    const newTab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "editor",
      filePath,
      title: this._titleFromPath(filePath),
      isDirty: false,
      doc: result.value,
      scrollTop: 0,
    };
```

### TM-8: Update `openContentTab()` — add `kind: "editor"` to content tab

In `openContentTab`, the `tab` object literal:
```typescript
    const tab: TabEntry = {
      id: crypto.randomUUID(),
      filePath: null,
      title,
      isDirty: false,
      doc: content,
      scrollTop: 0,
    };
```
becomes:
```typescript
    const tab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "editor",
      filePath: null,
      title,
      isDirty: false,
      doc: content,
      scrollTop: 0,
    };
```

### TM-9: Add private helper `_basenameFromPath`

Add after `_titleFromPath`:

```typescript
  /**
   * Returns the full filename (including extension) from an absolute path.
   *
   * Used for media tab titles where the extension is part of the identity
   * (e.g. "photo.jpg" rather than "photo").
   *
   * @param filePath  Absolute file path.
   * @returns  The last path component with extension, never empty.
   */
  private _basenameFromPath(filePath: string): string {
    return filePath.split("/").pop() ?? filePath;
  }
```

### TM-10: Add public method `openMediaInTab`

Insert after `openContentTab()` and before `closeTab()`:

```typescript
  /**
   * Opens a non-text asset (image, PDF, etc.) in a new media tab.
   *
   * Unlike openFileInTab(), this method does NOT read file contents from disk —
   * the file is rendered directly in #media-viewer via an asset:// URL. This
   * prevents the InvalidData error that fs::read_to_string raises on binary files.
   *
   * @param filePath  Absolute path to the media file.
   * @returns  true if a new tab was created; false if an existing media tab
   *           for the same path was activated (duplicate guard).
   */
  openMediaInTab(filePath: string): boolean {
    // Duplicate guard: activate existing media tab for this path rather than
    // opening a second copy (EC-01 / requirements FR-3 step 1).
    const existingIdx = this.tabs.findIndex(
      (t) => t.kind === "media" && t.filePath === filePath,
    );
    if (existingIdx !== -1) {
      this._captureActiveTab();
      this.activeIndex = existingIdx;
      this._applyActiveTab();
      this._notifyRenderer();
      return false;
    }

    this._captureActiveTab();

    const newTab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "media",
      filePath,
      title: this._basenameFromPath(filePath),
      isDirty: false,
      doc: "",
      scrollTop: 0,
    };

    this.tabs.push(newTab);
    this.activeIndex = this.tabs.length - 1;

    // Guard for EC-10: called before init() completes (editorContainer is null).
    // Push the tab into the array so it exists, but defer _applyActiveTab until
    // init() calls it at the end of its own sequence.
    if (this.editorContainer !== null) {
      this._applyActiveTab();
    }

    this._notifyRenderer();

    void addRecentFile(filePath);
    void this.saveSession();

    // Auto-close a clean Untitled editor tab when it was the only other tab
    // (matches the same behaviour in openFileInTab).
    if (this.tabs.length === 2) {
      const otherIdx = this.tabs.findIndex((t) => t.id !== newTab.id);
      const other = otherIdx !== -1 ? this.tabs[otherIdx] : null;
      if (other && other.kind === "editor" && other.filePath === null && !other.isDirty) {
        this.tabs.splice(otherIdx, 1);
        this.activeIndex = this.tabs.findIndex((t) => t.id === newTab.id);
        this._notifyRenderer();
        void this.saveSession();
      }
    }

    return true;
  }
```

### TM-11: Update `_applyActiveTab()` for media branching

Replace the entire body of `_applyActiveTab()` with:

```typescript
  private _applyActiveTab(): void {
    // Zero-tab guard: last tab was closed. Restore the editor view so the next
    // file opened from the file browser is not obscured by the media viewer.
    if (this.tabs.length === 0) {
      this.editorContainer?.classList.remove("has-media-tab");
      if (this.mediaViewerEl) this.mediaViewerEl.innerHTML = "";
      return;
    }

    if (this.editorView === null) return;

    const tab = this.tabs[this.activeIndex];

    if (tab.kind === "media") {
      // Show the media viewer; hide the CM6 editor.
      this.editorContainer?.classList.add("has-media-tab");
      this._renderMediaViewer(tab.filePath!);
      this._updateTitleBar(tab);
      // AD-6: expose current file path for IIFE plugins.
      (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] =
        tab.filePath;
      return;
    }

    // Editor tab: hide the media viewer and restore the CM6 editor.
    this.editorContainer?.classList.remove("has-media-tab");

    // Set the file path BEFORE dispatching the document so that
    // buildDecorations() has the correct path on its first run.
    setLivePreviewFilePath(tab.filePath);
    (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] =
      tab.filePath;

    // Replace doc text in one transaction.
    this.editorView.dispatch({
      changes: { from: 0, to: this.editorView.state.doc.length, insert: tab.doc },
      selection: { anchor: 0 },
      effects: tab.filePath !== null ? setViewMode.of(true) : undefined,
    });

    this.editorView.scrollDOM.scrollTop = tab.scrollTop;

    this._updateTitleBar(tab);
  }
```

### TM-12: Add private method `_renderMediaViewer`

Insert after `_updateTitleBar`:

```typescript
  /**
   * Populates #media-viewer with the appropriate element for the given file.
   *
   * Synchronous — no Tauri IPC. The file is loaded by the browser's native
   * rendering after src is set (NFR-1).
   *
   * @param filePath  Absolute path to the media file.
   */
  private _renderMediaViewer(filePath: string): void {
    if (!this.mediaViewerEl) return;

    // Clear stale content from a previous media tab (NFR-3).
    this.mediaViewerEl.innerHTML = "";

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const assetUrl = convertFileSrc(filePath);
    const basename = this._basenameFromPath(filePath);

    const RASTER_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "svg"]);

    if (RASTER_EXTS.has(ext)) {
      const img = document.createElement("img");
      img.src = assetUrl;
      img.alt = basename;
      img.addEventListener("error", () => {
        if (this.mediaViewerEl) {
          this.mediaViewerEl.innerHTML = '<p class="mv-load-error">Could not load file.</p>';
        }
      });
      this.mediaViewerEl.appendChild(img);
    } else if (ext === "pdf") {
      const embed = document.createElement("embed");
      embed.src = assetUrl;
      embed.type = "application/pdf";
      embed.addEventListener("error", () => {
        if (this.mediaViewerEl) {
          this.mediaViewerEl.innerHTML = '<p class="mv-load-error">Could not load file.</p>';
        }
      });
      this.mediaViewerEl.appendChild(embed);
    } else {
      const p = document.createElement("p");
      p.className = "mv-unsupported";
      p.textContent = "Cannot preview this file type.";
      this.mediaViewerEl.appendChild(p);
    }
  }
```

### TM-13: Update `_captureActiveTab()` — short-circuit for media tabs

At the top of `_captureActiveTab()`, after the existing early-return:
```typescript
    if (this.tabs.length === 0 || this.editorView === null) return;
```
add immediately after:
```typescript
    const tab = this.tabs[this.activeIndex];
    // Media tabs have no document text or meaningful scroll position.
    // Capturing them would overwrite doc: "" with stale EditorView content.
    if (tab.kind === "media") return;
```

Then remove the duplicate `const tab = ...` line that follows in the existing
body (since `tab` is now declared above). The rest of the method is unchanged.

### TM-14: Update `closeTab()` — dirty-check guards

There are exactly two `if (tab.isDirty)` checks in `closeTab`:

**First** (inside the `this.tabs.length === 1` branch):
```typescript
      if (tab.isDirty) {
```
becomes:
```typescript
      if (tab.isDirty && tab.kind !== "media") {
```

**Second** (inside the multi-tab branch, after the comment "Multiple tabs remain"):
```typescript
    if (tab.isDirty) {
```
becomes:
```typescript
    if (tab.isDirty && tab.kind !== "media") {
```

### TM-15: Update `saveSession()` — filter to editor tabs only

Change:
```typescript
    const openFiles = this.tabs
      .filter((t) => t.filePath !== null)
      .map((t) => ({ filePath: t.filePath!, scrollTop: t.scrollTop }));
```
to:
```typescript
    const openFiles = this.tabs
      .filter((t) => t.kind === "editor" && t.filePath !== null)
      .map((t) => ({ filePath: t.filePath!, scrollTop: t.scrollTop }));
```

---

## Verification

```bash
# TypeScript: no errors
npx tsc --noEmit

# Run tab-manager unit tests (all must still pass)
npm run test:run -- tests/tabs/tab-manager.test.ts

# Run session-restore tests
npm run test:run -- tests/tabs/session-restore.test.ts

# No test for openMediaInTab yet — that arrives in step_04.
```

At this point `TabManager.openMediaInTab` is implemented but untested in isolation
and not yet called by the file browser. That is intentional.

---

## Checklist

- [ ] `tab-types.ts`: `TabKind` exported, `kind` field on `TabEntry`
- [ ] `tab-manager.ts`: `convertFileSrc` imported from `@tauri-apps/api/core`
- [ ] `tab-manager.ts`: `editorContainer` and `mediaViewerEl` private fields added
- [ ] `tab-manager.ts`: `init()` stores `editorContainer`, injects `#media-viewer`
- [ ] `tab-manager.ts`: all four `TabEntry` construction sites have `kind: "editor"`
- [ ] `tab-manager.ts`: `_basenameFromPath` helper added
- [ ] `tab-manager.ts`: `openMediaInTab` public method added
- [ ] `tab-manager.ts`: `_applyActiveTab` handles both `"editor"` and `"media"` kinds
- [ ] `tab-manager.ts`: `_renderMediaViewer` private method added
- [ ] `tab-manager.ts`: `_captureActiveTab` short-circuits for media tabs
- [ ] `tab-manager.ts`: both `isDirty` guards in `closeTab` updated
- [ ] `tab-manager.ts`: `saveSession` filter updated to `kind === "editor"`
- [ ] All pre-existing tab tests still pass
