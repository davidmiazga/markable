---
title: "Step 10 — Stack Panel (lazy section view)"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 10 — Stack Section View with Lazy Rendering

## Goal

Render frames 02/03: the Stack panel listing all notes (canonical + references) as framed boxes, lazy-rendered via IntersectionObserver, with a trailing `+ Note` affordance. No editor mount yet (step 11).

## Files touched

- **New** `src/plugins/file-browser/collections/stack-panel.ts`
- **New** `tests/collections/stack-panel.test.ts`

## Function signatures to add

```typescript
import type { NoteBoxHandle, NoteBoxHandlers } from "./note-box";
import type { PreviewCacheHandle } from "./types";

export interface StackPanelOptions {
  readonly stackPath: string;
  readonly cache: PreviewCacheHandle;
  readonly onNoteClick: (handle: NoteBoxHandle) => void;
  readonly onNoteContextMenu: (handle: NoteBoxHandle, ev: MouseEvent) => void;
  readonly onNoteRenameCommit: NoteBoxHandlers["onRenameCommit"];
  readonly onCreateNote: () => Promise<NoteBoxHandle | null>;
  readonly initialScrollTop?: number;
}

export interface StackPanelHandle {
  readonly el: HTMLElement;          // outer scroll container
  readonly listEl: HTMLElement;      // list of boxes
  readonly addNote: (handle: NoteBoxHandle) => void;   // append at end (before +Note tile)
  readonly removeNote: (notePath: string) => void;
  readonly destroy: () => void;
}

export async function renderStackPanel(
  container: HTMLElement,
  opts: StackPanelOptions,
): Promise<StackPanelHandle>;
```

DOM shape:

```html
<section class="fv-collection-stack-panel">
  <header class="fv-collection-stack-header">
    <span class="folder-icon-notebook"></span>
    <span class="fv-collection-stack-panel-title">Stack 01</span>
  </header>
  <div class="fv-collection-stack-list">
    <article class="fv-collection-note-box" ...>...</article>
    ...
    <button class="fv-collection-stack-add-note" type="button">
      <span class="fv-collection-stack-add-note-plus">+</span>
    </button>
  </div>
</section>
```

## Failing tests to write FIRST

`tests/collections/stack-panel.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `renders one box per entry in order + references` | FR-9, FR-22 | DOM count: order.length + references.length + 1 trailing +Note |
| `canonical boxes come before reference boxes` | FR-22 | first N children are kind=canonical; remaining are kind=reference |
| `reference boxes carry is-reference class` | FR-22 | every reference box has the modifier |
| `broken reference renders is-broken (file not in vault index)` | EC-16 | when vault index lacks the canonical path → broken modifier set |
| `trailing +Note affordance present` | FR-11 | last child is `.fv-collection-stack-add-note` |
| `clicking +Note invokes onCreateNote and appends new box before the tile` | FR-11 | DOM order: ...notes, new note, +Note tile |
| `200-note stack: only viewport-visible boxes have rendered preview` | FR-27, EC-18 | mock IntersectionObserver: only intersecting entries get renderPreview called |
| `scrolling far out recycles old boxes to placeholder` | FR-27, EC-18 | mock IO exit event → recycleToPlaceholder called; DOM body empty |
| `placeholder height equals last-rendered height (no scroll jump)` | FR-29, EC-18 | el.style.height matches cache.get(path).height |
| `DOM node count bounded across full top-to-bottom scroll` | EC-18 | count of "rendered" boxes ≤ visible + overscan throughout |
| `removeNote drops the box and frees its cache entry` | FR-12 | DOM gone; cache.invalidate called |
| `destroy disconnects both IntersectionObservers` | leak | mock observers' disconnect called twice |
| `restores initialScrollTop on first render` | restore | container.scrollTop === opts.initialScrollTop |

## Implementation outline

1. **Build outer DOM**: scroll container + header + list. Header reads the Stack's display name and icon via `store.readStack`.
2. **Load entries**:
   - `const meta = await store.readStack(stackPath);`
   - Canonical list: each filename in `meta.order` → `{ kind: "canonical", stackPath, noteFilename }`.
   - For references: for each vault-rel in `meta.references`, check vault-index for existence; on miss → `kind: "broken"`; on hit → `kind: "reference"`.
3. **Build boxes**:
   - For each entry, compute `notePath` (absolute) and `displayLabel` (basename without `.md`).
   - `const initialHeight = cache.get(notePath, lastKnownMtime)?.height ?? null;` (caller-provided overload to placeholder creator).
   - `const handle = createPlaceholder(notePath, kind, displayLabel, ...);`
   - Append to `listEl`.
4. **Two observers**:
   ```typescript
   const enterObserver = new IntersectionObserver((entries) => {
     for (const entry of entries) {
       if (!entry.isIntersecting) continue;
       const handle = handlesByEl.get(entry.target as HTMLElement);
       if (!handle || handle.state !== "placeholder") continue;
       void renderPreview(handle, cache);
     }
   }, { root: scrollContainer, rootMargin: "200px 0px" });

   const exitObserver = new IntersectionObserver((entries) => {
     for (const entry of entries) {
       if (entry.isIntersecting) continue;
       const handle = handlesByEl.get(entry.target as HTMLElement);
       if (!handle || handle.state !== "rendered") continue;
       recycleToPlaceholder(handle, cache);
     }
   }, { root: scrollContainer, rootMargin: "1000px 0px" });
   ```
   Both observe every box element. The asymmetric `rootMargin` (200px enter, 1000px exit) creates the hysteresis that prevents flicker (1.8.D).
5. **Trailing `+ Note` tile**:
   - `<button class="fv-collection-stack-add-note" type="button">+</button>`.
   - `click` → `const newHandle = await opts.onCreateNote();` if non-null, `addNote(newHandle)`.
6. **`addNote(handle)`**:
   - Insert `handle.el` before the trailing tile.
   - Register both observers.
7. **`removeNote(notePath)`**:
   - Find `handle`; `handle.el.remove(); enterObserver.unobserve(handle.el); exitObserver.unobserve(handle.el); cache.invalidate(notePath);`.
8. **`destroy`**: disconnect both observers; null out the `handlesByEl` map.

`initialScrollTop`: assign `container.scrollTop = opts.initialScrollTop ?? 0;` after first paint (`queueMicrotask` to let layout settle).

## Refactor opportunities

If profiling shows the two observers add cost, replace with a single observer that branches on the box's current state. Defer — two observers is simpler to reason about for the EC-18 test.

## Definition of Done

```bash
npm run test:run -- tests/collections/stack-panel.test.ts
```
Expected: 13 tests pass. Plugin rebuild required.
