---
title: "Step 06 — Home Canvas (frames 01 + 04)"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 06 — Home Canvas Renderer

## Goal

Render the Home view: frame 01 (empty Collection with `+ Notecard/Stack` popover) and frame 04 (Stack glyphs with note-count badges and a `+` affordance). Right-click context handlers on Stack glyphs.

## Files touched

- **New** `src/plugins/file-browser/collections/home-canvas.ts`
- **New** `src/plugins/file-browser/collections/popover.ts`
- **New** `tests/collections/home-canvas.test.ts`

## Function signatures to add

```typescript
// home-canvas.ts

import type { FolderCard, FolderViewConfig, BulkRenderContext } from "../folder-view/types";

export interface HomeCanvasOptions {
  readonly collectionPath: string;
  readonly onStackClick: (stackPath: string) => void;
  readonly onCreateStack: () => Promise<void>;
  readonly onCreateNotecard: () => Promise<void>;
  readonly onStackRename: (stackPath: string, newName: string) => Promise<void>;
  readonly onStackReorder: (stackPath: string, direction: "up" | "down") => Promise<void>;
  readonly onStackDelete: (stackPath: string) => Promise<void>;
  readonly onStackSetIcon: (stackPath: string) => void; // delegates to existing picker
}

export async function renderHomeCanvas(
  container: HTMLElement,
  opts: HomeCanvasOptions,
): Promise<void>;
```

```typescript
// popover.ts

export interface NotecardStackPopoverHandlers {
  readonly onStack: () => void;
  readonly onNotecard: () => void;
}

export function showNotecardStackPopover(
  anchorEl: HTMLElement,
  handlers: NotecardStackPopoverHandlers,
): void;
```

Internal:

```typescript
// home-canvas.ts

interface StackGlyphData {
  readonly stackPath: string;
  readonly stackFolderName: string;
  readonly displayName: string;
  readonly iconValue: string;   // catalog id or absolute path
  readonly noteCount: number;   // order.length + references.length
}

async function loadStackGlyphs(
  collectionPath: string,
  stackOrder: readonly string[],
): Promise<StackGlyphData[]>;

function renderStackGlyph(data: StackGlyphData, opts: HomeCanvasOptions): HTMLElement;
function renderEmptyState(opts: HomeCanvasOptions): HTMLElement;
function attachStackContextMenu(glyphEl: HTMLElement, data: StackGlyphData, opts: HomeCanvasOptions): void;
```

## Failing tests to write FIRST

`tests/collections/home-canvas.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `empty Collection renders frame-01 empty state with + Notecard/Stack button` | FR-16 | container has one `.fv-collection-empty-state` element with a button labelled `+ Notecard/Stack` |
| `populated Collection renders one glyph per stack in stackOrder` | FR-13, FR-14 | container has N `.fv-collection-stack-glyph` children matching `stackOrder.length` |
| `stack glyph shows noteCount = len(order) + len(references)` | FR-13 | badge text === total count |
| `stack glyph uses Stack's icon (catalog) via getFolderIconClass` | FR-13, EC-22 | glyph contains element with class `folder-icon-notebook` (default) |
| `stack glyph renders custom-SVG path icon` | EC-22 | glyph contains a `.folder-icon-custom` element with injected SVG body (mocks folder-icon-custom-cache) |
| `clicking a stack glyph calls onStackClick with the Stack's absolute path` | FR-15 | mock spy receives correct path |
| `clicking + affordance below glyphs calls onCreateStack` | FR-14 | spy fires once |
| `right-click a stack glyph offers Rename / Move up / Move down / Set folder icon… / Delete` | FR-14 | menu has exactly these five items |
| `stack glyph order matches stackOrder (not directory listing)` | FR-14 | DOM order preserved |
| `stale stackOrder entries pointing to missing folders are silently dropped` | EC-8 | glyph count = number of folders that actually exist |
| `delete last stack returns container to frame-01 empty state on next render` | EC-9 | second render with empty stackOrder yields the empty-state element |
| `+ Notecard/Stack popover offers Stack and Notecard buttons` | FR-5 | popover DOM has both options |
| `popover Notecard button calls onCreateNotecard` | FR-5, EC-12 | spy fires |
```

## Implementation outline

1. **`loadStackGlyphs`**:
   - For each `stackName` in `stackOrder`, compute `stackPath = ${collectionPath}/${stackName}`.
   - `await store.readStack(stackPath)`; tolerate missing/malformed per EC-5/EC-6 (use defaults).
   - If `bridge.readDirectory(stackPath)` (or vault-index lookup) shows the folder doesn't exist, skip (EC-8).
   - Compute `noteCount = order.length + references.length`.
   - Return the list in original `stackOrder` sequence.
2. **`renderHomeCanvas`**:
   - `const collection = await store.readCollection(collectionPath);`
   - `container.replaceChildren();`
   - If `collection.value.stackOrder.length === 0` → append `renderEmptyState`.
   - Else, load glyphs, append a `.fv-collection-glyph-grid` parent + glyph children + trailing `+` affordance.
3. **`renderStackGlyph`**:
   - Outer `.fv-collection-stack-glyph` div.
   - Icon span using `getFolderIconClass(iconValue)` for the class. If `interpretIconValue(iconValue).kind === "custom"`, inject sanitised inline SVG body from `folder-icon-custom-cache.ts` (out-of-band, same pattern as file-browser.plugin's post-mount injection).
   - Badge `<span class="fv-collection-badge">{noteCount}</span>` overlaid via CSS.
   - Label `<div class="fv-collection-stack-label">{displayName}</div>`.
   - Click handler on the outer div calls `opts.onStackClick(stackPath)`.
   - `attachStackContextMenu`.
4. **`renderEmptyState`**:
   - Centered dashed-border rectangle. One button `+ Notecard/Stack` whose click invokes `showNotecardStackPopover` anchored to itself.
   - Popover handlers wire to `opts.onCreateStack` and `opts.onCreateNotecard`.
5. **`showNotecardStackPopover`**:
   - Build a small floating div with two buttons (`Stack`, `Notecard`).
   - Position absolute relative to `anchorEl` (use `getBoundingClientRect()`).
   - Dismiss on outside click / Escape / button click.
   - Reuses no existing chrome — small enough to inline. Theme tokens only.

Inline rename (FR-7, FR-11) is **not** in this step — it's invoked from the renderer (step 12). Step 06 only provides the click and right-click handlers.

## Refactor opportunities

If multiple call sites need a generic stack glyph, extract to a shared widget. Defer — only Home canvas uses it.

## Definition of Done

```bash
npm run test:run -- tests/collections/home-canvas.test.ts
```
Expected: 13 tests pass. Plugin rebuild required.
