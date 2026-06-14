---
title: "Step 05 — Detection and Layout Registration"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 05 — Detection Short-Circuit + `collection-home` Stub Registration

## Goal

Wire detection so a Collection folder resolves to the `collection-home` layout key, and register a no-op stub renderer in `LAYOUT_RENDERERS`. After this step, opening a `type: collection` folder renders an empty placeholder div labelled "Collection — Home (stub)". The home-canvas renderer replaces the stub in step 06.

## Files touched

- **New** `src/plugins/file-browser/collections/detection-glue.ts`
- **Edit** `src/plugins/file-browser/folder-view/detection.ts`
- **Edit** `src/plugins/file-browser/folder-view/tab.ts`
- **New** `tests/collections/detection.test.ts`

## Function signatures to add

```typescript
// detection-glue.ts

/**
 * Async predicate. True if `folderPath` contains a `_folder.md` whose
 * frontmatter has `type: collection`.
 *
 * Reads only the top of _folder.md via extractFrontmatterKeys() —
 * does not parse the full frontmatter (NFR-1 perf).
 */
export async function isCollectionFolder(folderPath: string): Promise<boolean>;

/**
 * Resolves the layout key for a folder, applying the Collections
 * short-circuit FIRST. Returns:
 *   - "collection-home" if frontmatter has type: collection
 *   - null otherwise (caller falls through to existing layout logic)
 */
export async function detectCollectionLayout(
  folderPath: string,
): Promise<string | null>;
```

```typescript
// folder-view/detection.ts (additive)

// Re-export the new helpers so other modules can import from one place.
export { isCollectionFolder, detectCollectionLayout } from "../collections/detection-glue";
```

```typescript
// folder-view/tab.ts (additive)

// In LAYOUT_RENDERERS (~line 109), insert:
"collection-home": renderCollectionHomeStub,

// Stub used until step 12 replaces it.
function renderCollectionHomeStub(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
  bulkContext: BulkRenderContext,
): void {
  container.replaceChildren();
  const stub = document.createElement("div");
  stub.className = "fv-collection-stub";
  stub.textContent = "Collection — Home (stub)";
  container.appendChild(stub);
}
```

The async detection short-circuit is invoked in `tab.ts` at the **layout-resolution call site** — locate the current `layoutKey` resolution and prepend `const collectionLayout = await detectCollectionLayout(folderPath); if (collectionLayout) layoutKey = collectionLayout;`. If the current call site is sync, lift the entire render-tab function to async (the project already has `renderFolderViewTabAsync` per tab.ts line 545 vicinity — verify in step 05 implementation; if absent, the layout-resolution wrapper becomes async).

## Failing tests to write FIRST

`tests/collections/detection.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `isCollectionFolder returns true for folder with type: collection in _folder.md` | FR-2 | mocked readFile returns frontmatter with `type: collection` → true |
| `isCollectionFolder returns false for folder with type: stack` | FR-2 | type: stack → false |
| `isCollectionFolder returns false when _folder.md missing` | EC-4 | readFile returns `{ ok: false }` → false (no toast yet — step 06 handles that) |
| `isCollectionFolder returns false when frontmatter malformed` | EC-6 | parse fails → false |
| `detectCollectionLayout returns "collection-home" when isCollectionFolder true` | C-2 | string `"collection-home"` |
| `detectCollectionLayout returns null when not a Collection` | C-2 | null fall-through |
| `_folder.md is excluded from vault-index .md enumeration` | EC-15 | given a vault index, assert no entry with path ending in `_folder.md` |
| `LAYOUT_RENDERERS has collection-home key registered` | C-1 | `"collection-home" in LAYOUT_RENDERERS === true` |

## Implementation outline

1. **`isCollectionFolder(folderPath)`**:
   - `const path = ${folderPath}/_folder.md`
   - `const res = await bridge.readFile(path)`; if `!res.ok` return false.
   - `const keys = extractFrontmatterKeys(res.value, ["type"])`; return `keys.type === "collection"`.
2. **`detectCollectionLayout`**: `return (await isCollectionFolder(folderPath)) ? "collection-home" : null;`
3. **`detection.ts` re-export**: append the two re-exports. No other change to detection.ts.
4. **`tab.ts` integration**:
   - Add the stub renderer above `LAYOUT_RENDERERS`.
   - Add `"collection-home": renderCollectionHomeStub` to the `LAYOUT_RENDERERS` object.
   - At the layout-resolution site in the render-tab function, insert the short-circuit:
     ```typescript
     const collectionLayout = await detectCollectionLayout(folderPath);
     if (collectionLayout) {
       layoutKey = collectionLayout;
     }
     ```
   - This MUST run before any other layout-source check (frontmatter `layout:`, display-options pick, default). Per C-2 priority.

## Refactor opportunities

Step 12 replaces the stub with the real renderer in one line.

## Definition of Done

```bash
npm run test:run -- tests/collections/detection.test.ts
```
Expected: 8 tests pass. Full suite still green. Plugin rebuild required (touches `folder-view/`).

Manual: open a folder with hand-written `_folder.md` containing `type: collection` → the folder view shows "Collection — Home (stub)".
