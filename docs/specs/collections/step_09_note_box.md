---
title: "Step 09 — Note Box (framed-box rendering)"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 09 — Framed Note Box

## Goal

Render a single note as either a placeholder or a fully-rendered framed box with HTML preview. Provide the right-click context menu (canonical, reference, broken variants). No editor mounting yet (step 11).

## Files touched

- **New** `src/plugins/file-browser/collections/note-box.ts`
- **New** `tests/collections/note-box.test.ts`

## Function signatures to add

```typescript
import type { NoteBoxKind, PreviewCacheHandle } from "./types";

export interface NoteBoxHandle {
  readonly el: HTMLElement;
  readonly notePath: string;          // absolute path on disk (canonical home)
  readonly kind: NoteBoxKind;
  state: "placeholder" | "rendered" | "editing";
}

export interface NoteBoxHandlers {
  readonly onClick: (handle: NoteBoxHandle) => void;
  readonly onContextMenu: (
    handle: NoteBoxHandle,
    event: MouseEvent,
  ) => void;
  readonly onRenameCommit: (
    handle: NoteBoxHandle,
    newFilename: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Create a placeholder box (no preview rendered yet). Cheap.
 * Used for off-screen entries — the IntersectionObserver in step 10
 * calls `renderPreview` when the box scrolls into view.
 */
export function createPlaceholder(
  notePath: string,
  kind: NoteBoxKind,
  displayLabel: string,
  handlers: NoteBoxHandlers,
): NoteBoxHandle;

/**
 * Render the preview HTML into a placeholder box.
 * - Resolves preview HTML from the cache; on miss, reads the file
 *   via bridge, renders via `marked`, stores in cache.
 * - Measures actual height post-render; stores in cache via setHeight.
 * - Marks handle.state = "rendered".
 * - For "broken" kind, renders a dimmed broken-link placeholder
 *   regardless of cache (no file read).
 */
export async function renderPreview(
  handle: NoteBoxHandle,
  cache: PreviewCacheHandle,
): Promise<void>;

/**
 * Reset to placeholder shell sized by the cached height.
 * Releases the inner DOM; preserves outer height so the scroll bar
 * doesn't jump (FR-29).
 */
export function recycleToPlaceholder(
  handle: NoteBoxHandle,
  cache: PreviewCacheHandle,
): void;

/**
 * Show inline rename input over the box label (FR-7-style flow for
 * notes). Returns a Promise that resolves with the committed name
 * or null on cancel.
 */
export function beginInlineRename(handle: NoteBoxHandle): Promise<string | null>;

/**
 * Build the right-click menu items for a box. Returned as a
 * declarative list the file-browser's existing showContextMenu can
 * consume.
 */
export function buildNoteBoxContextItems(
  handle: NoteBoxHandle,
): ReadonlyArray<{ label: string; action: string; danger?: boolean }>;
```

DOM shape (rendered state):

```html
<article class="fv-collection-note-box [is-reference|is-broken]"
         data-note-path="/abs/path/Note.md"
         tabindex="0">
  <header class="fv-collection-note-box-label">Note name</header>
  <div class="fv-collection-note-box-body">
    <!-- marked output -->
  </div>
</article>
```

Trailing "+ Note" affordance is **not** in this file — that lives in stack-panel.ts (step 10) since it isn't a per-note box.

## Failing tests to write FIRST

`tests/collections/note-box.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `createPlaceholder returns a box with state="placeholder"` | basic | handle.state === "placeholder"; el classList contains "fv-collection-note-box" |
| `placeholder height defaults to cache height when available` | FR-29 | given cache.height = 200, placeholder el.style.height === "200px" |
| `placeholder height falls back to a constant when cache miss` | FR-29 | el.style.height === default ("160px" or similar — pick in implementation) |
| `renderPreview reads file and injects sanitised marked HTML` | FR-9 | el.querySelector(".fv-collection-note-box-body").innerHTML !== "" |
| `renderPreview reuses cache on hit, no bridge.readFile call` | FR-28 | bridge mock not invoked |
| `renderPreview caches measured height after render` | FR-29 | cache.setHeight called with measured value |
| `reference kind renders with is-reference class` | FR-22 | el.classList.contains("is-reference") |
| `broken kind renders dimmed text, no file read` | EC-16 | bridge.readFile never called; body text === "(referenced note not found)" |
| `recycleToPlaceholder restores placeholder with cached height` | FR-28 | post: state === "placeholder"; el.style.height matches pre-measured value |
| `beginInlineRename commits new filename on Enter` | FR-7 | resolves with the typed string |
| `beginInlineRename returns null on Escape` | FR-7 | resolves with null |
| `beginInlineRename refuses filename collision via handlers.onRenameCommit` | EC-11 | onRenameCommit returns { ok: false, error: "exists" } → inline error shown; promise stays pending until valid name typed or Escape |
| `buildNoteBoxContextItems for canonical returns Rename/Move up/Move down/Move to other Stack…/Add reference to another Stack…/Delete` | FR-12 | exact list |
| `buildNoteBoxContextItems for reference returns Open canonical/Remove reference (from this Stack)/Edit in place` | FR-24 | exact list |
| `buildNoteBoxContextItems for broken returns Remove reference (from this Stack) only` | EC-16 | exact list |
| `marked output sanitises raw <script> in note body` | XSS hardening | innerHTML does not contain "<script>" |

## Implementation outline

1. `createPlaceholder`:
   - Build `<article>` with `fv-collection-note-box` and kind-specific modifier class.
   - `<header>` with `displayLabel` as `textContent`.
   - Empty body div.
   - `el.style.height = (cachedHeight ?? PLACEHOLDER_DEFAULT_HEIGHT) + "px";` — but cache is not passed to `createPlaceholder`; instead, the caller (stack-panel) provides the cached height via a per-call argument: add `initialHeight?: number` to the signature. (Refine the signature in the test pass.)
   - Wire `click` → `handlers.onClick(handle)`.
   - Wire `contextmenu` → `handlers.onContextMenu(handle, ev)` with `preventDefault()`.
   - Return handle.
2. `renderPreview`:
   - If `handle.kind.kind === "broken"`, render dimmed body + return.
   - `const stat = await bridge.statFile(handle.notePath);` (use existing wrapper from folder-icon work; if not present for files, add a typed wrapper to bridge.ts).
   - `const cached = cache.get(handle.notePath, stat.mtimeMs);`
   - If `cached`, inject `cached.html` into body, `handle.state = "rendered"`, return.
   - Else `const content = await bridge.readFile(handle.notePath);`, render via `marked.parse(content.value)`, sanitise via the existing `stripScripts()` (folder-view/shared.ts) — same pattern folder-view's bookshelf renderer uses for preview HTML.
   - Inject into body. Measure `el.getBoundingClientRect().height`. `cache.set(...)` then `cache.setHeight(...)`.
   - `handle.state = "rendered"`.
3. `recycleToPlaceholder`:
   - `el.querySelector(".fv-collection-note-box-body")!.replaceChildren();`
   - `el.style.height = (cache.get(handle.notePath, _)?.height ?? PLACEHOLDER_DEFAULT_HEIGHT) + "px";` — but we can't pass `_` for mtime here. Instead, **track** the last-known height as a property on `handle` itself: `handle.lastRenderedHeight: number | null`. Update on render, read on recycle. Cache holds the canonical value; handle holds the local copy.
   - `handle.state = "placeholder";`
4. `beginInlineRename`:
   - Hide the `<header>` text, insert an `<input>` with the current label, focus, select.
   - On Enter: `const result = await handlers.onRenameCommit(handle, input.value.trim());` — if `!result.ok`, show inline error (red border + tooltip-style message), keep focus. Else resolve.
   - On Escape: resolve null, restore label.
   - On Blur (outside the input): treat as Escape unless the value differs from the original and is non-empty → treat as Enter.
5. `buildNoteBoxContextItems`: switch on `handle.kind.kind`. Pure data.

Markdown rendering uses the **same** `marked` instance imported by `src/editor/live-preview.ts` (C-10). To avoid re-instantiation, import it via:

```typescript
import { marked } from "marked";
// The project's live-preview.ts already calls `marked.use({...extensions...})`
// at module load. As long as live-preview.ts is loaded somewhere in the
// process (it is — every tab editor imports from it), the global `marked`
// already carries the project's extension wiring.
```

If at runtime the assertion fails (e.g., live-preview.ts is tree-shaken), import live-preview's `ensureMarkedConfigured()` if it exists, or add one. Step 09 implementation verifies the runtime state via a unit test that asserts `marked.use` has been called at least once at module-load time.

## Refactor opportunities

`buildNoteBoxContextItems`'s shape may be unified with the file-browser's existing menu-item type. Verify the type signature during step 14 wiring.

## Definition of Done

```bash
npm run test:run -- tests/collections/note-box.test.ts
```
Expected: 16 tests pass. Plugin rebuild required.
