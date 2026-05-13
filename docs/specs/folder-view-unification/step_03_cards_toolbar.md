---
title: "Step 03 — Wire Bulk Toolbar into renderer.ts (Cards Layout)"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 03 — Wire Bulk Toolbar into `renderer.ts` (Cards Layout)

**Goal**: When `context` is provided to `renderFolderCards`, attach
`context.toolbarRefs.toolbar` to the `host` element as its first child,
above the description block and all sections. The toolbar DOM node is already
fully built by `tab.ts` (Step 01); this step only attaches it to the correct
position in the cards host element.

**No checkbox wiring yet** — that is Step 04. After this step the toolbar node
is present in the DOM and correctly positioned, but no checkboxes exist to
trigger its visibility. (The toolbar remains hidden because
`updateToolbar`/`syncToolbar` is only called when checkboxes change.)

---

## Files Changed

| File | Change |
|---|---|
| `src/plugins/file-browser/folder-view/renderer.ts` | Accept `context?: BulkContext`; attach `toolbarRefs.toolbar` to host |

---

## 1. `renderer.ts` — Accept `context` and attach toolbar

### Import to add

```typescript
import type { BulkContext } from "./types";
```

### Signature change for `renderFolderCards`

```typescript
// Before:
export function renderFolderCards(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
): void {

// After:
export function renderFolderCards(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
  context?: BulkContext,
): void {
```

### Toolbar attachment — position in the function body

The toolbar must be the **first child** of `host`, before the description block
and before any section content. Insert after `host.className` assignment and
the `folder-view-host--constrained` class-toggle, and before the description
block:

```typescript
// (existing lines)
const host = document.createElement("div");
host.className = "folder-view-host";
if (!config.contentAreaOverride) host.classList.add("folder-view-host--constrained");

// NEW: attach toolbar as first child when bulk context is provided.
// The toolbar node is already fully constructed in tab.ts and hidden by default
// (fv-bulk-toolbar has display:none; becomes visible via fv-bulk-toolbar--visible
// when syncToolbar() is called after a checkbox change).
if (context?.toolbarRefs) {
  host.appendChild(context.toolbarRefs.toolbar);
}

// (existing description block follows)
if (config.body.trim()) {
  ...
}
```

This mirrors the exact position `host.appendChild(toolbarRefs.toolbar)` has in
`renderFolderTable` (line 898 in current `table-renderer.ts`).

---

## 2. `buildSection` / `appendCardsToGrid` — Pass `scrollRoot`

**No change in this step.** The `scrollRoot` parameter of `appendCardsToGrid`
and `buildSection` uses `host` as the IntersectionObserver root. This is
already handled correctly for cards. No changes to these functions in Step 03.

---

## 3. Fallback when `context` is absent

When `context` is `undefined` (e.g. in existing tests that call
`renderFolderCards(config, cards, container, path)` without a fifth argument),
the `if (context?.toolbarRefs)` guard is falsy and nothing is appended. The
function behaves identically to the pre-refactor version for all existing
callers.

---

## Tests to Write (TDD — write before implementing)

File: `tests/folder-view/renderer.test.ts` (already exists — add new test group)

### New test group: `bulk toolbar — folder-cards layout`

#### Test A: `toolbar node is inserted as first child of host when context provided`

```
Given: a BulkContext with a toolbarRefs.toolbar DOM node
When:  renderFolderCards is called with that context
Then:  container.querySelector(".fv-bulk-toolbar") is not null
       container.querySelector(".folder-view-host").firstChild ===
         container.querySelector(".fv-bulk-toolbar")
```

#### Test B: `toolbar node is absent when no context provided`

```
Given: no context (renderFolderCards called without fifth argument)
When:  renderFolderCards is called
Then:  container.querySelector(".fv-bulk-toolbar") is null
```

#### Test C: `toolbar is hidden by default (no fv-bulk-toolbar--visible class)`

```
Given: a BulkContext with a fresh SelectionState (no paths selected)
When:  renderFolderCards is called with that context
Then:  container.querySelector(".fv-bulk-toolbar") does not have class
       "fv-bulk-toolbar--visible"
```

This verifies the toolbar starts hidden — it becomes visible only when
checkboxes are checked (Step 04 wires that path).

### Regression: all existing `renderer.test.ts` tests must pass

---

## Acceptance Criteria

- [ ] `renderFolderCards` accepts optional `context?: BulkContext`
- [ ] When `context` is provided, `context.toolbarRefs.toolbar` is appended to `host` as first child
- [ ] When `context` is absent, no toolbar is appended (identical to pre-refactor behavior)
- [ ] Toolbar node appears before the description block and sections in the DOM
- [ ] Tests A, B, C pass
- [ ] All existing `renderer.test.ts` tests pass
- [ ] All other existing tests pass (`npm run test:run`)
