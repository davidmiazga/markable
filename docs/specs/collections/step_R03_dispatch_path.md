---
title: "Step R03 — Remove Detection Short-Circuit; Use Standard Dispatch"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R03 — Standard Layout Dispatch for Collections

## Goal

Remove the `tab.ts:339–355` Collections short-circuit so layout
resolution flows through the standard `config.layout` → `LAYOUT_RENDERERS`
path. After this step, a folder with `layout: collection-home` in
`_folder.md` frontmatter renders Collections via the same dispatch
mechanism every other layout uses. The legacy `detection-glue.ts` file
becomes dead code and is deleted.

This step depends on step_R04 for the read-compat shim that aliases
legacy `type: collection` → `layout: collection-home` inside
`store.readCollection`. The dispatch path itself does not perform the
aliasing — it reads `config.layout` (from `parseFolderMd`) which only
sees what is literally on disk. Legacy folders with `type: collection`
but no `layout:` field will NOT render as Collections after R03 unless
R04 also lands.

**Step order constraint:** R03 and R04 can land in either order, but
the combined behaviour requires both. The Lead Developer should land
R03 first (this step), accept that legacy folders are temporarily
broken, and then land R04 in the same PR / same commit chain. The
test suite catches the regression via the EC-7 test added in R04.

## Files touched

- **Edit**   `src/plugins/file-browser/folder-view/tab.ts`
- **Delete** `src/plugins/file-browser/collections/detection-glue.ts`
- **New**    `tests/collections/dispatch.test.ts`
- **Edit**   `tests/collections/detection.test.ts` (delete obsolete cases)

## Function signatures to add / edit / delete

### Edit `tab.ts`

```typescript
// DELETE the import (line 22):
import { detectCollectionLayout } from "../collections/detection-glue";

// DELETE the short-circuit block (lines 339–355 inclusive).
// Replace with: nothing. The `let layoutKey = config.layout.toLowerCase();`
// stays as the sole source of truth.

// AFTER edit, the relevant region of renderFolderViewTabAsync reads:
//
//   // Step 3: Dispatch to layout renderer (FR-27/FR-28).
//   const layoutKey = config.layout.toLowerCase();
//   if (!layoutKey) {
//     renderFallback(config.body, "No layout specified — showing raw content.", container);
//   } else if (!LAYOUT_RENDERERS[layoutKey]) {
//     renderFallback(...);
//   } else {
//     const cards = collectChildren(folderPath, vaultIndex);
//     /* ... enrichment + bulk context + dispatch ... unchanged ... */
//     LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath, bulkContext);
//   }
//
// Note: `let` becomes `const` since layoutKey is no longer reassigned.
```

The `LAYOUT_RENDERERS["collection-home"]` entry at line 125 is NOT
touched — it stays.

### Delete `detection-glue.ts`

```typescript
// DELETE the entire file:
// src/plugins/file-browser/collections/detection-glue.ts
```

Verify no remaining imports of `isCollectionFolder` / `detectCollectionLayout`
from this module (step_R01 deleted the file-browser-plugin import
chain; tab.ts:22 is the last one removed in this step).

## Failing tests to write FIRST

### `tests/collections/dispatch.test.ts` (new)

| Test name | EC / FR | Asserts |
|---|---|---|
| `"tab.ts source does not import detection-glue"` | C-2 | Read `tab.ts` content; assert no `from "../collections/detection-glue"` substring. |
| `"tab.ts source does not contain detectCollectionLayout"` | C-2 | Read `tab.ts` content; assert no `detectCollectionLayout` substring. |
| `"tab.ts LAYOUT_RENDERERS still routes collection-home to renderCollectionHome"` | FR-1 | Import `LAYOUT_RENDERERS`; assert `LAYOUT_RENDERERS["collection-home"] === renderCollectionHome` (use reference equality against the imported module). |
| `"detection-glue.ts no longer exists in the source tree"` | (cleanup) | `fs.existsSync(path/to/detection-glue.ts) === false`. (If preferred, assert the module fails to import — `import("../../../src/plugins/file-browser/collections/detection-glue")` rejects with a module-not-found error.) |

### Add to `tests/collections/ec-sweep.test.ts`

| Test name | EC | Asserts |
|---|---|---|
| `"EC-1 — folder with `layout: zzz-nonsense` in _folder.md falls back to standard view"` | EC-1 | Mock `parseFolderMd` to return `config.layout === "zzz-nonsense"`; run `renderFolderViewTabAsync` (via `buildFolderViewRenderFn`); assert `renderFallback` was called with the "Unknown layout" message. No crash. |

### Edit `tests/collections/detection.test.ts`

Delete every case that asserts `detectCollectionLayout` or
`isCollectionFolder` directly. Keep the "vault index excludes
`_folder.md`" assertion if it exists — that one tests `collectChildren`,
which is unaffected. If after deletion the file is empty, delete the
file.

## Implementation outline

1. **Write the new dispatch tests.** They fail until the short-circuit
   is removed.
2. **Delete the short-circuit:**
   - Remove the import at `tab.ts:22`.
   - Remove the comment block (lines 339–350) and the three executable
     lines (351–355).
   - Change `let layoutKey` to `const layoutKey` — it's no longer
     reassigned.
3. **Delete `detection-glue.ts`** with `rm` (`git rm`).
4. **Delete obsolete tests** from `detection.test.ts`.
5. **Verify**:
   - `npm run test:run -- tests/collections/dispatch.test.ts` green.
   - `npm run test:run -- tests/collections/ec-sweep.test.ts` green
     (EC-1 fallback case passes).
   - `npm run test:run -- tests/collections/` — confirm no test
     references the deleted module.
   - `npm run build` — TypeScript clean.
6. **Plugin rebuild**: `npm run build:plugins && npm run sync:plugins`.

## Refactor opportunities

- The `renderFolderViewTabAsync` function in `tab.ts` no longer needs
  to be `async` if no other `await` remains. Verify — there's an
  existing `await invoke("read_file", ...)` for the `_folder.md` read,
  so it stays async. No change.
- The `let` → `const` switch on `layoutKey` is the only other small
  cleanup.

## Definition of Done

```bash
npm run test:run -- tests/collections/dispatch.test.ts
npm run test:run -- tests/collections/ec-sweep.test.ts
npm run test:run -- tests/collections/
```

Expected: all green. Specifically:
- The new dispatch tests assert no detection-glue import and no
  short-circuit branch.
- EC-1 (invalid layout) falls back cleanly.
- No legacy detection tests reference the deleted file.

⚠️ **Expected regression until R04 lands** — pre-existing folders
created via the shipped Make Collection gesture (with `type:
collection` but no `layout:` field) will NOT render as Collections
after this step. R04's read-compat shim fixes that. Land R04 before
shipping to users.

Plugin rebuild required (touches `folder-view/`).
