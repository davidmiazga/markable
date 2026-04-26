---
title: "Step 05 — Context Resolver"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 05 — Context Resolver

## What to Build

Introduce the unified context resolver — the single function that inspects the current
CM6 `ViewUpdate` and returns one of three context tags: `"image"`, `"table"`, or
`"default"`. This is the heart of the consolidated plugin's logic.

This step also provides the two CM6-aware wrapper functions:
- `detectImageRegion(update): ImageContext | null` — wraps the existing `detectImageRegion`
  from image-toolbar using `window.__CM_LANGUAGE__` or `window.__MARKABLE_EDITOR_VIEW__`.
- `detectTableContextFromState(update): TableContext | null` — wraps `detectTableContext`
  from section 8 using `window.__CM_LANGUAGE__`.

After this step the context resolution logic is isolated and directly unit-testable
(by stubbing the window globals).

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (unified)

Append after section 8 (pure table logic). This section becomes section 11 per AD-2, but
it is built before sections 9 and 10 (DOM builders) to allow the updateListener in
step_07 to be specified before the DOM layer is finalised. Internally, position the
resolver code in section 11 of the file; steps 06 will fill sections 9 and 10.

---

## Precise Specification

### Context type

```typescript
export type ToolbarContext = "image" | "table" | "default";
```

### `detectImageRegion` wrapper

Port verbatim from `image-toolbar.plugin.ts` section 15: `detectImageRegion`,
`_resolveAnchorForEditMode`, and `_fallbackPosFromImgEl`. These functions access:
- `window.__CM_LANGUAGE__`
- `window.__MARKABLE_EDITOR_VIEW__`
- The live `ViewUpdate.view`

Signature:
```typescript
function detectImageRegion(update: ViewUpdate): ImageContext | null
```

This function is NOT exported (it is internal to the updateListener). If the original
image-toolbar exports it as a test helper (e.g. `_resolveAnchorForEditMode`), do NOT
export it from the unified file — instead the test file (step_09) will test it
indirectly via `handleAction` or the updateListener integration path.

### `detectTableContextFromState` wrapper

Port verbatim from `table-toolbar.plugin.ts` section 6's CM6-aware portion
(`detectTableContextFromState`). This function:
1. Accesses `window.__CM_LANGUAGE__` to get the lezer parser.
2. Parses the current editor state's document into a syntax tree.
3. Calls the pure `detectTableContext(tree, state)` from section 8.

Signature:
```typescript
function detectTableContextFromState(update: ViewUpdate): TableContext | null
```

Not exported.

### `resolveContext` function

```typescript
export function resolveContext(update: ViewUpdate): ToolbarContext {
  // 1. Image check first (cheapest — one line text scan) (NFR-5).
  const imgCtx = detectImageRegion(update);
  if (imgCtx) {
    // Store the context in the module-level variable for use by action handlers.
    currentImageContext = imgCtx;
    return "image";
  }

  // Clear stale image context if we are no longer on an image line.
  currentImageContext = null;

  // 2. Table check (only if image check failed — short-circuit from NFR-5).
  const tblCtx = detectTableContextFromState(update);
  if (tblCtx) return "table";

  // 3. Default context.
  return "default";
}
```

Exported so tests can call it directly with a stubbed `ViewUpdate`.

The function has a side effect: it writes to `currentImageContext`. This is intentional —
the action handler for image alignment reads that module-level variable. Document this
clearly in the JSDoc.

---

## Acceptance Criteria

### AC-5.1 — resolveContext returns "image" when cursor is on image line (EC-3)
Stub `window.__CM_LANGUAGE__` and `window.__MARKABLE_EDITOR_VIEW__` to return a
document where the cursor line contains `![alt](url)`. `resolveContext(update)` returns
`"image"` and sets `currentImageContext` to a non-null `ImageContext`.

### AC-5.2 — resolveContext returns "table" when cursor is in a table and not on image line
Given a view with cursor inside a GFM table and no image syntax on the cursor line,
`resolveContext(update)` returns `"table"`.

### AC-5.3 — Image wins over table when image is in a table cell (EC-3)
Given a cursor line containing `![alt](url)` that is also inside a GFM table,
`resolveContext(update)` returns `"image"` (not `"table"`).

### AC-5.4 — resolveContext clears currentImageContext when leaving image line
Call `resolveContext` twice: first with an image-line update (returns `"image"`), then
with a non-image-line update (returns `"table"` or `"default"`). After the second call,
`currentImageContext` is `null`.

### AC-5.5 — resolveContext returns "default" for plain text
Given a plain text document, `resolveContext(update)` returns `"default"`.

### AC-5.6 — Short-circuit: detectTableContextFromState not called when image detected (NFR-5)
Use a spy on `detectTableContextFromState` (or test indirectly by timing). When
`detectImageRegion` returns a non-null context, `detectTableContextFromState` must not
be called. Document as a code review check if a spy is not feasible in the test environment.

---

## Risks and Dependencies

- **Risk**: The original `image-toolbar.plugin.ts` may also write to `currentImageContext`
  in its `buildUpdateListener`. After consolidation, `resolveContext` becomes the ONLY place
  that writes to `currentImageContext`. Verify no leftover assignments remain in the ported
  code.
- **Risk**: `detectTableContextFromState` and `detectImageRegion` both access window globals.
  In test environments those globals must be stubbed via `vi.stubGlobal`. Ensure the
  context resolver does not crash when they return `null` (graceful null-return path).
- **Dependency**: Steps 03 and 04 must be complete. `ImageContext`, `detectImageRegion`,
  `TableContext`, and `detectTableContext` must already be declared above this section.
