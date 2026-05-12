---
title: "Step 04 — tab.ts: Sidecar Exclusion in collectChildren"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 04 — tab.ts: Sidecar Exclusion in collectChildren

## Goal

Extend `collectChildren` in `tab.ts` to exclude sidecar `.md` files from the card array
(FR-9). A sidecar is a `.md` file whose stem (the filename without the final `.md`)
contains a dot where the portion after the last dot is a known image extension.

Also define the `IMAGE_EXTENSIONS` constant at module scope so it can be shared with the
enrichment loop in step 05.

## Prerequisite

Step 03 complete (for consistency of image extension list, though not a hard dependency).

---

## Files Modified

| File | Change |
|------|--------|
| `src/plugins/file-browser/folder-view/tab.ts` | Add `IMAGE_EXTENSIONS` constant; add sidecar filter in `collectChildren` markdown loop |

---

## TDD Sequence

The existing `tests/folder-view/tab.test.ts` has tests for `collectChildren`. Add new
tests — either inline in `tab.test.ts` or in a separate
`tests/folder-view/tab-sidecar-exclusion.test.ts`.

### New tests

```
SC-01  collectChildren with a vault containing photo.jpg.md → photo.jpg.md NOT in returned cards,
       but photo.jpg IS in returned cards (as a nonMdFile)
SC-02  collectChildren with banner.png.md → banner.png.md excluded
SC-03  collectChildren with my.project.jpg.md → excluded (EC-20: last dot segment is "jpg")
SC-04  collectChildren with readme.md (not a sidecar) → included in cards normally
SC-05  collectChildren with notes.txt.md → excluded only if "txt" is in IMAGE_EXTENSIONS.
       Verify: "txt" is NOT in IMAGE_EXTENSIONS, so notes.txt.md SHOULD appear in the cards.
SC-06  collectChildren with sunset.heic.md → excluded ("heic" in IMAGE_EXTENSIONS)
SC-07  collectChildren with sunset.heif.md → excluded
SC-08  collectChildren with sunset.webp.md → excluded
SC-09  collectChildren with sunset.gif.md → excluded
SC-10  EC-12: user-named standalone note "photography.jpg.md" → excluded (accepted trade-off)
```

Test setup: construct a minimal `vaultIndex` with `entries` (MD files) and `nonMdFiles`
arrays using the same pattern as existing `tab.test.ts` tests (see the `setupWindowMocks`
helper pattern).

---

## Implementation

### IMAGE_EXTENSIONS constant (module scope in tab.ts)

Add near the top of `tab.ts`, after the imports and before `escapeHtml`:

```typescript
/**
 * Set of image file extensions that may have sidecar .md companions.
 * Used both for sidecar exclusion in collectChildren (FR-9) and for
 * image type dispatch in the enrichment loop (step 05).
 * Lowercase, without leading dot.
 */
export const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif",
]);
```

Export it so it can be imported in tests and (in step 05) used in the enrichment loop.

### Sidecar detection helper (module scope, private)

```typescript
/**
 * Return true if this .md vault entry is a sidecar for an image file.
 *
 * A sidecar has a stem (entry.name, which is the filename without ".md") that
 * itself contains a dot, and whose last dot-segment is a known image extension.
 *
 * Examples:
 *   entry.name = "photo.jpg"    → true  (stem has ".jpg" suffix)
 *   entry.name = "banner.png"   → true
 *   entry.name = "my.project.jpg" → true  (EC-20: last segment is "jpg")
 *   entry.name = "_folder"      → false (no dot in stem)
 *   entry.name = "readme"       → false (no dot)
 *   entry.name = "notes.txt"    → false ("txt" not an image extension)
 *
 * @param stem - The entry.name field (filename without ".md").
 */
function isSidecarStem(stem: string): boolean {
  const lastDot = stem.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = stem.slice(lastDot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}
```

### Modification to the markdown loop in collectChildren

Current code (lines 129-141 of tab.ts):

```typescript
// ── Markdown file children ────────────────────────────────────────────────────
for (const entry of vaultIndex.entries) {
  if (!entry.path.startsWith(prefix)) continue;
  if (entry.path.slice(prefix.length).includes("/")) continue;
  // FR-23: exclude _folder.md from the card grid.
  if (entry.name === "_folder" && entry.path.endsWith(".md")) continue;
  cards.push({ ... });
}
```

Modified code — add one guard line after the `_folder.md` exclusion:

```typescript
// ── Markdown file children ────────────────────────────────────────────────────
for (const entry of vaultIndex.entries) {
  if (!entry.path.startsWith(prefix)) continue;
  if (entry.path.slice(prefix.length).includes("/")) continue;
  // FR-23: exclude _folder.md from the card grid.
  if (entry.name === "_folder" && entry.path.endsWith(".md")) continue;
  // FR-9: exclude sidecar .md files (e.g. photo.jpg.md) from the card grid.
  // entry.name is the stem (filename without ".md"). A sidecar stem ends in an
  // image extension (e.g. "photo.jpg"). See isSidecarStem() for the algorithm.
  if (isSidecarStem(entry.name)) continue;
  cards.push({
    path: entry.path,
    name: entry.name,
    kind: "file",
    ext: ".md",
    modified: entry.modified ?? 0,
    tags: (entry as any).tags ?? [],
  });
}
```

---

## Acceptance Criteria

- [ ] `npm run test:run -- tests/folder-view/tab.test.ts` passes (no regressions)
- [ ] New sidecar exclusion tests SC-01 through SC-10 pass
- [ ] `IMAGE_EXTENSIONS` is exported from `tab.ts`
- [ ] `isSidecarStem` is NOT exported (it is a private helper)
- [ ] `_folder.md` is still excluded (FR-23 guard unchanged, runs before FR-9 guard)
- [ ] `notes.txt.md` is NOT excluded (SC-05: "txt" is not an image extension)
- [ ] `photo.jpg` (nonMdFile) still appears in cards
