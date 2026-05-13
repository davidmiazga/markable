---
title: "Step 01 — Move Shared State from table-renderer.ts to tab.ts"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 01 — Move Shared State from `table-renderer.ts` to `tab.ts`

**Goal**: Move `SelectionState`, `ToolbarRefs`, `syncToolbar`, and the three
bulk operation callbacks out of `renderFolderTable` and up into
`renderFolderViewTabAsync`. Thread them down to `renderFolderTable` via a new
`BulkContext` optional fifth argument. Table layout behavior is **zero-delta**
— all existing tests must still pass after this step.

**No behavior change for users.** This is a pure refactor that sets up the
shared infrastructure Steps 03–05 depend on.

---

## Files Changed

| File | Change |
|---|---|
| `src/plugins/file-browser/folder-view/types.ts` | Add `BulkContext` interface; widen `FolderLayoutRenderer` type |
| `src/plugins/file-browser/folder-view/tab.ts` | Construct `SelectionState`, `buildToolbar`, `syncToolbar`, operation callbacks; pass as `BulkContext` to renderer |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Accept `context?: BulkContext`; remove own `SelectionState`/`buildToolbar` construction; read from `context` |

---

## 1. `types.ts` — New `BulkContext` interface

Add the following to `types.ts` **after** the `FolderCard` interface.

Import requirements at top of types.ts — `SelectionState` and `ToolbarRefs`
are defined in `bulk-selection.ts` and `bulk-toolbar.ts` respectively. Because
`types.ts` is a pure-type file used in an IIFE bundle, add type-only imports:

```typescript
import type { SelectionState } from "./bulk-selection";
import type { ToolbarRefs } from "./bulk-toolbar";
```

New interface:
```typescript
/**
 * Bulk-selection wiring passed from renderFolderViewTabAsync (tab.ts) to
 * both layout renderers. Created once per render call and shared across all
 * sections in both renderers.
 *
 * selectionState — mutable shared selection; paths + kindMap.
 * toolbarRefs    — live DOM references for the toolbar; already attached to
 *                  host before the renderer is called.
 * syncToolbar    — closure: calls updateToolbar(toolbarRefs, selectionState).
 *                  Each row/card checkbox change calls this.
 * onMove         — async callback invoked by toolbar Confirm Move.
 * onDelete       — async callback invoked by toolbar Confirm Delete.
 * onYaml         — async callback invoked by toolbar Apply YAML.
 */
export interface BulkContext {
  selectionState: SelectionState;
  toolbarRefs: ToolbarRefs;
  syncToolbar: () => void;
  onMove:   (destDir: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onYaml:   (op: "add" | "remove", key: string, value: string) => Promise<void>;
}
```

### Widen `FolderLayoutRenderer`

Change the existing type from:
```typescript
export type FolderLayoutRenderer = (
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
) => void;
```
to:
```typescript
export type FolderLayoutRenderer = (
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
  context?: BulkContext,
) => void;
```

The fifth parameter is optional (`?`) so all existing callers (including tests
that call `renderFolderCards` / `renderFolderTable` directly without five
arguments) continue to compile with zero changes.

---

## 2. `tab.ts` — Construct `BulkContext` before renderer dispatch

### Imports to add

```typescript
import { createSelectionState } from "./bulk-selection";
import { buildToolbar, updateToolbar } from "./bulk-toolbar";
import { executeBulkMove, executeBulkDelete, executeBulkYaml, formatOperationResult }
  from "./bulk-operations";
import { showResult } from "./bulk-toolbar";
import type { BulkContext } from "./types";
```

### Location in `renderFolderViewTabAsync`

After `collectChildren` and the enrichment block, and **before** the
`LAYOUT_RENDERERS[layoutKey](...)` call, insert the following. This replaces
the bare dispatch call:

```typescript
// Before (line 463 in current tab.ts):
LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath);
```

Replace with:

```typescript
// Step 1: Construct shared bulk context for this render.
// visibleCards is computed from cards here (same exclude filter used in
// table-renderer.ts today) so the YAML callback can pass the full card list.
const excludeSet = new Set(config.exclude);
const visibleCards = excludeSet.size > 0
  ? cards.filter(c => {
      const filename = c.ext === ".md" ? c.name + ".md" : c.name;
      return !excludeSet.has(filename);
    })
  : cards;
const dirCards  = visibleCards.filter(c => c.kind === "directory");
const fileCards = visibleCards.filter(c => c.kind === "file");

const selectionState = createSelectionState();

// toolbarRefs is forward-declared so the async callbacks can close over it.
// The variable is assigned by buildToolbar immediately below.
let toolbarRefs: import("./bulk-toolbar").ToolbarRefs;

toolbarRefs = buildToolbar(
  selectionState,
  async (destDir) => {
    const result = await executeBulkMove(selectionState, destDir);
    const summary = formatOperationResult(result, "Moved");
    showResult(toolbarRefs, summary, result.failed.length > 0);
    if (result.succeeded > 0) {
      (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
    }
  },
  async () => {
    const result = await executeBulkDelete(selectionState);
    const summary = formatOperationResult(result, "Deleted");
    showResult(toolbarRefs, summary, result.failed.length > 0);
    if (result.succeeded > 0) {
      (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
    }
  },
  async (op, key, value) => {
    const yamlResult = await executeBulkYaml(
      selectionState, op, key, value, [...dirCards, ...fileCards],
    );
    const summary = formatOperationResult(
      yamlResult, "Processed", yamlResult.skippedCount,
    );
    showResult(toolbarRefs, summary, yamlResult.failed.length > 0);
    // No re-render after YAML apply (FR-6 maintained).
  },
);

const syncToolbar = (): void => updateToolbar(toolbarRefs, selectionState);

const bulkContext: BulkContext = {
  selectionState,
  toolbarRefs,
  syncToolbar,
  onMove:   toolbarRefs ? (destDir) => Promise.resolve() : async () => {},  // WRONG — see note
  onDelete: async () => {},
  onYaml:   async () => {},
};
```

**Note**: The `onMove`/`onDelete`/`onYaml` fields in `BulkContext` are the
same async lambdas that were passed to `buildToolbar`. The cleanest approach
is to extract them as named `const` values **before** passing to `buildToolbar`,
then reference the same closures in `BulkContext`. The actual button wiring
happens inside `buildToolbar` — the callbacks in `BulkContext` are only
needed by `renderer.ts` if it ever needs to trigger operations programmatically
(which it does not in v1). For v1, `BulkContext.onMove/onDelete/onYaml` are
carried for completeness but not called by `renderer.ts` directly.

**Revised construction** (cleaner):

```typescript
const onMove = async (destDir: string): Promise<void> => {
  const result = await executeBulkMove(selectionState, destDir);
  const summary = formatOperationResult(result, "Moved");
  showResult(toolbarRefs, summary, result.failed.length > 0);
  if (result.succeeded > 0) {
    (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
  }
};

const onDelete = async (): Promise<void> => {
  const result = await executeBulkDelete(selectionState);
  const summary = formatOperationResult(result, "Deleted");
  showResult(toolbarRefs, summary, result.failed.length > 0);
  if (result.succeeded > 0) {
    (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
  }
};

const onYaml = async (
  op: "add" | "remove", key: string, value: string,
): Promise<void> => {
  const yamlResult = await executeBulkYaml(
    selectionState, op, key, value, [...dirCards, ...fileCards],
  );
  const summary = formatOperationResult(
    yamlResult, "Processed", yamlResult.skippedCount,
  );
  showResult(toolbarRefs, summary, yamlResult.failed.length > 0);
};

const toolbarRefs = buildToolbar(selectionState, onMove, onDelete, onYaml);
const syncToolbar = (): void => updateToolbar(toolbarRefs, selectionState);

const bulkContext: BulkContext = {
  selectionState, toolbarRefs, syncToolbar, onMove, onDelete, onYaml,
};

LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath, bulkContext);
```

### Note on `visibleCards` duplication

The same `exclude` filter is also applied inside `renderFolderTable` and
`renderFolderCards`. With the `BulkContext` carrying `dirCards`/`fileCards`
for the YAML operation callback, `tab.ts` now filters once for that purpose.
Each renderer still applies its own filter for its own section building —
the two are independent. There is no functional duplication risk because both
produce the same result from the same `config.exclude` and `cards` arrays.

---

## 3. `table-renderer.ts` — Accept `context`, remove own construction

### Signature change

```typescript
// Before:
export function renderFolderTable(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
): void {

// After:
export function renderFolderTable(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
  context?: import("./types").BulkContext,
): void {
```

### Body changes

Remove the existing block that creates `selectionState`, the three operation
callbacks, and `toolbarRefs` (lines 851–902 in current `table-renderer.ts`).

Replace with:

```typescript
// ── Bulk selection + toolbar ──────────────────────────────────────────────
// Shared state comes from tab.ts via BulkContext (Step 01).
// For backward compat (tests calling renderFolderTable without context),
// fall back to creating a local context.
const selectionState: SelectionState = context?.selectionState ?? createSelectionState();
const toolbarRefs    = context?.toolbarRefs ?? buildToolbar(
  selectionState,
  async () => {},
  async () => {},
  async () => {},
);
const syncToolbar = context?.syncToolbar ?? (() => updateToolbar(toolbarRefs, selectionState));
```

The fallback (`?? ...`) ensures tests that call `renderFolderTable(config, cards,
container, path)` without a fifth argument continue to work and produce a fully
functional (if non-operational) toolbar. This is the "no-context graceful
degradation" contract.

The existing line `host.appendChild(toolbarRefs.toolbar)` is **kept** in
`table-renderer.ts` because `tab.ts` does not append the toolbar to `host`
— only the renderer has access to `host`. The `toolbarRefs.toolbar` node is
the same DOM node whether it was created by `tab.ts` or by the fallback;
appending it from inside the renderer is correct.

---

## Tests to Write (TDD — write before implementing)

File: `tests/folder-view/table-renderer-bulk.test.ts` (already exists — extend)

### New test: `table-renderer accepts BulkContext and uses shared SelectionState`

```
Given: a BulkContext created externally with a fresh SelectionState
When:  renderFolderTable is called with that BulkContext as the fifth argument
Then:  checking a row checkbox adds the path to the BulkContext.selectionState.paths
       (not to a renderer-internal selection state)
```

This test verifies that the `selectionState` inside the renderer is the same
reference as the one passed in via `BulkContext`.

### Regression: all existing `table-renderer-bulk.test.ts` tests must pass

No tests should fail. The fallback path (no context provided) must produce the
same behavior as the current implementation.

---

## Acceptance Criteria

- [ ] `BulkContext` and widened `FolderLayoutRenderer` exist in `types.ts`
- [ ] `renderFolderViewTabAsync` in `tab.ts` constructs `BulkContext` and passes it as the fifth argument
- [ ] `renderFolderTable` accepts optional `context` and uses it when present
- [ ] Fallback (no context) path in `renderFolderTable` still produces a working toolbar
- [ ] All existing `table-renderer-bulk.test.ts` tests pass
- [ ] All other existing tests pass (`npm run test:run`)
- [ ] No `let toolbarRefs: ...` forward-declaration left in final code (use `const` via extracted lambdas)
