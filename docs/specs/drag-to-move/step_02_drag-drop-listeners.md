---
title: Step 02 — Harden attachDragDropListeners
last-updated: "2026-04-30"
review-cadence-days: 90
status: active
---

# Step 02 — Harden `attachDragDropListeners`

## Prerequisites

Step 01 is complete and `npm run test:run` passes.

## Goal

Update `attachDragDropListeners` in `file-browser.plugin.ts` to:

1. Use the namespaced MIME type `"text/x-markable-path"` (and add
   `"text/x-markable-type"`) instead of `"text/plain"` — prevents false
   positives from external drag sources (NFR-2, EC-17).
2. Add `.is-dragging` class to the source node on `dragstart`, remove on
   `dragend` (FR-2, FR-3, EC-13).
3. Register `dragover`, `dragleave`, and `drop` on file nodes in addition to
   directory and vault nodes (FR-4, FR-5, EC-2).
4. In the `drop` handler, resolve the target directory correctly for file nodes
   (FR-5), and add the own-parent no-op guard (FR-7, EC-3).

After this step, `npm run test:run` must pass. Then run the plugin build step.

---

## File to edit

`src/plugins/file-browser/file-browser.plugin.ts`

---

## Current implementation (lines 2481–2537)

```typescript
function attachDragDropListeners(el: HTMLElement, _vaultId: string): void {
  const type = el.getAttribute("data-type");
  const path = el.getAttribute("data-path") ?? "";

  /* All file and directory nodes are draggable */
  if (type === "file" || type === "directory") {
    el.setAttribute("draggable", "true");

    el.addEventListener("dragstart", (e: DragEvent) => {
      e.dataTransfer?.setData("text/plain", path);
      e.stopPropagation();
    });

    el.addEventListener("dragend", () => {
      /* Remove drag-over highlights from all nodes after a drag ends */
      _treeEl?.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
    });
  }

  /* Directories and vault roots accept drops */
  if (type === "directory" || type === "vault") {
    el.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over");
    });

    el.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over");

      const sourcePath = e.dataTransfer?.getData("text/plain");
      if (!sourcePath || sourcePath === path) return;

      /* Prevent dropping into a descendant of the dragged node */
      if (path.startsWith(sourcePath + "/")) return;

      void moveNode(sourcePath, path, _panelContainer).catch((err) => {
        console.error("[file-browser] move failed:", err);
        if (_panelContainer) {
          showInlineError(_panelContainer, `Move failed: ${String(err)}`);
        }
      });
    });
  }
}
```

---

## Required changes — diff by section

### Section 1: `dragstart` — switch MIME keys and add `.is-dragging`

Replace:
```typescript
el.addEventListener("dragstart", (e: DragEvent) => {
  e.dataTransfer?.setData("text/plain", path);
  e.stopPropagation();
});
```

With:
```typescript
el.addEventListener("dragstart", (e: DragEvent) => {
  e.dataTransfer?.setData("text/x-markable-path", path);
  e.dataTransfer?.setData("text/x-markable-type", type);  // "file" | "directory"
  el.classList.add("is-dragging");
  e.stopPropagation();
});
```

### Section 2: `dragend` — also remove `.is-dragging` from source

Replace:
```typescript
el.addEventListener("dragend", () => {
  _treeEl?.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
});
```

With:
```typescript
el.addEventListener("dragend", () => {
  el.classList.remove("is-dragging");
  _treeEl?.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
});
```

### Section 3: drop target condition — add file nodes

Replace:
```typescript
if (type === "directory" || type === "vault") {
```

With:
```typescript
if (type === "file" || type === "directory" || type === "vault") {
```

### Section 4: `drop` handler — MIME key, own-parent guard, file-on-file resolution

Replace the entire `drop` handler:
```typescript
el.addEventListener("drop", (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  el.classList.remove("drag-over");

  const sourcePath = e.dataTransfer?.getData("text/plain");
  if (!sourcePath || sourcePath === path) return;

  /* Prevent dropping into a descendant of the dragged node */
  if (path.startsWith(sourcePath + "/")) return;

  void moveNode(sourcePath, path, _panelContainer).catch((err) => {
    console.error("[file-browser] move failed:", err);
    if (_panelContainer) {
      showInlineError(_panelContainer, `Move failed: ${String(err)}`);
    }
  });
});
```

With:
```typescript
el.addEventListener("drop", (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  el.classList.remove("drag-over");

  // Read source path from the namespaced MIME key.
  // External drags (OS Finder, browser links) will return "" here — silently ignored.
  const sourcePath = e.dataTransfer?.getData("text/x-markable-path") ?? "";
  if (!sourcePath) return;  // EC-17: external drop guard

  // Resolve targetDir: for file nodes, move into the file's parent directory.
  const targetDir = type === "file" ? getParentDir(path) : path;

  // EC-4: dropped on self (directory dragged onto its own <li>)
  if (targetDir === sourcePath) return;

  // EC-3: dropped into own parent directory (no-op — resolves to same location)
  if (targetDir === getParentDir(sourcePath)) return;

  // EC-5: dropped into a descendant of the dragged node (cycle prevention)
  if (targetDir.startsWith(sourcePath + "/")) return;

  void moveNode(sourcePath, targetDir, _panelContainer).catch((err) => {
    console.error("[file-browser] move failed:", err);
    if (_panelContainer) {
      showInlineError(_panelContainer, `Move failed: ${String(err)}`);
    }
  });
});
```

Note: `getParentDir` is already exported from `file-browser-ops.ts` and is
imported at the top of the plugin file. Verify the import is present before
adding the call. If not already imported, add it to the existing import line.

---

## CSS — add `.is-dragging` rule

The `.drag-over` rule is already defined in `FILE_BROWSER_CSS` (line ~346).
Add the following rule immediately after the `.drag-over` block:

```css
.is-dragging {
  opacity: 0.5;
}
```

Locate the CSS template literal in `file-browser.plugin.ts` and insert the
rule. The exact location is adjacent to the `.drag-over` rule block.

---

## Complete updated `attachDragDropListeners` for reference

```typescript
function attachDragDropListeners(el: HTMLElement, _vaultId: string): void {
  const type = el.getAttribute("data-type");
  const path = el.getAttribute("data-path") ?? "";

  /* File and directory nodes are draggable; vault root is not */
  if (type === "file" || type === "directory") {
    el.setAttribute("draggable", "true");

    el.addEventListener("dragstart", (e: DragEvent) => {
      e.dataTransfer?.setData("text/x-markable-path", path);
      e.dataTransfer?.setData("text/x-markable-type", type);
      el.classList.add("is-dragging");
      e.stopPropagation();
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("is-dragging");
      _treeEl?.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
    });
  }

  /* All node types accept drops (file nodes resolve to parent dir) */
  if (type === "file" || type === "directory" || type === "vault") {
    el.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over");
    });

    el.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over");

      const sourcePath = e.dataTransfer?.getData("text/x-markable-path") ?? "";
      if (!sourcePath) return;

      const targetDir = type === "file" ? getParentDir(path) : path;

      if (targetDir === sourcePath) return;
      if (targetDir === getParentDir(sourcePath)) return;
      if (targetDir.startsWith(sourcePath + "/")) return;

      void moveNode(sourcePath, targetDir, _panelContainer).catch((err) => {
        console.error("[file-browser] move failed:", err);
        if (_panelContainer) {
          showInlineError(_panelContainer, `Move failed: ${String(err)}`);
        }
      });
    });
  }
}
```

---

## Tests to add in `tests/plugins/file-browser/drag-to-move.test.ts`

These tests cover `attachDragDropListeners` behaviour. They test the
`drop`-handler logic by invoking the handler through simulated DOM events.

### Testing approach

`attachDragDropListeners` is not exported. The recommended test approach is
to test the plugin function that calls it (the tree-render path) or, preferably,
to **extract the pure guard logic** into a standalone exported helper
`resolveDropTarget` in `file-browser.plugin.ts` and test that directly.

**Alternative that avoids exporting internals**: write tests for `moveNode`
integration by creating a real `<li>` element, calling
`attachDragDropListeners` via a minimal render harness, and dispatching
synthetic `DragEvent`s. This is the established approach in
`tests/plugins/file-browser/file-browser.test.ts`. Check that file for the
existing render-harness pattern and follow it exactly.

If the render harness is too heavy, the **preferred approach for this step** is:

Export a pure helper from `file-browser.plugin.ts`:

```typescript
/**
 * Pure guard logic extracted for unit testing.
 * @internal exported for tests only
 */
export function resolveDropTarget(
  targetPath: string,
  targetType: string,
  sourcePath: string,
): string | null {
  const targetDir = targetType === "file" ? getParentDir(targetPath) : targetPath;
  if (!sourcePath) return null;
  if (targetDir === sourcePath) return null;
  if (targetDir === getParentDir(sourcePath)) return null;
  if (targetDir.startsWith(sourcePath + "/")) return null;
  return targetDir;
}
```

Import and test `resolveDropTarget` directly. This is clean, zero-DOM, and
makes every guard branch directly testable.

The decision between the render-harness approach and the `resolveDropTarget`
export is left to the Lead Developer. Either passes review as long as all
guard branches are covered.

### Required test cases

**Test D1 — external drop (empty sourcePath) returns null (EC-17, FR-7)**
```
resolveDropTarget("/vault/dir", "directory", "") === null
```

**Test D2 — drop on own directory returns null (EC-4)**
```
resolveDropTarget("/vault/docs", "directory", "/vault/docs") === null
```

**Test D3 — drop on own parent directory returns null (EC-3)**
```
resolveDropTarget("/vault", "directory", "/vault/docs") === null
// targetDir="/vault", getParentDir("/vault/docs")="/vault" → own-parent guard fires
```

**Test D4 — file dropped on own parent file (resolves same parent) returns null (EC-3, EC-2)**
```
// File node at "/vault/A/note.md" receives drop of source "/vault/A/other.md"
// targetDir = getParentDir("/vault/A/note.md") = "/vault/A"
// getParentDir("/vault/A/other.md") = "/vault/A"
// own-parent guard fires
resolveDropTarget("/vault/A/note.md", "file", "/vault/A/other.md") === null
```

**Test D5 — cycle prevention: folder dropped into descendant returns null (EC-5)**
```
resolveDropTarget("/vault/docs/sub", "directory", "/vault/docs") === null
// targetDir="/vault/docs/sub", startsWith("/vault/docs/") → cycle guard fires
```

**Test D6 — valid file-on-file drop resolves to parent dir (EC-2, FR-5)**
```
resolveDropTarget("/vault/B/note.md", "file", "/vault/A/source.md") === "/vault/B"
```

**Test D7 — valid drop onto directory returns the directory path (FR-10)**
```
resolveDropTarget("/vault/B", "directory", "/vault/A/note.md") === "/vault/B"
```

**Test D8 — valid drop onto vault root returns vault root path (EC-20)**
```
resolveDropTarget("/vault", "vault", "/vault/docs") === "/vault"
```

**Test D9 — .is-dragging added on dragstart and removed on dragend (FR-2, FR-3)**

This test requires a minimal DOM setup. Create a `<li>` with `data-type="file"`
and `data-path="/vault/note.md"`, call `attachDragDropListeners` if accessible,
or use the existing render harness. If `attachDragDropListeners` is private,
confirm the class behaviour is covered by a visual-verification note and skip
the automated DOM assertion — it is low-risk CSS-only behaviour.

If the render harness is available:
```
dispatch "dragstart" on the <li>
assert <li>.classList.contains("is-dragging") === true
dispatch "dragend" on the <li>
assert <li>.classList.contains("is-dragging") === false
```

**Test D10 — `.drag-over` removed from target on drop (FR-12)**

Using the render harness:
```
add "drag-over" class to target <li>
dispatch "drop" with empty sourcePath (external drop guard fires)
assert <li>.classList.contains("drag-over") === false
// The drop handler removes drag-over before the early return
```

---

## After this step

```bash
npm run test:run -- tests/plugins/file-browser/drag-to-move.test.ts
```

All tests pass. Then:

```bash
npm run test:run
```

Zero regressions. Then build the plugin:

```bash
npm run build:plugins && npm run sync:plugins
```

Build succeeds with no TypeScript errors. Feature is complete.

---

## Deferred work

- Multi-file drag (NFR-4: out of scope — log in this file if requested later).
- "Move to…" context menu: disabled menu item remains disabled; not unlocked
  by this feature.
- Cross-vault drag (NFR-5: out of scope).
