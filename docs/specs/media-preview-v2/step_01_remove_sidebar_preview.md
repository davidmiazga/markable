---
title: "Step 01 — Remove Sidebar Preview Code"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 01 — Remove Sidebar Preview Code

## Goal

Delete the old sidebar media-preview feature from `file-browser.plugin.ts` and
remove the test file that tested it. After this step the plugin no longer
contains any reference to `_previewedPath`, `showMediaPreview`,
`closeMediaPreview`, or `fbmp-*` CSS.

The non-md click branch is gutted to a no-op comment — it is NOT yet wired to
`openMediaInTab` (that happens in step_03, after the tab-manager is ready in
step_02). This keeps each step independently compilable and testable.

---

## Files Changed

| File | Action |
|---|---|
| `src/plugins/file-browser/file-browser.plugin.ts` | Multiple removals (see below) |
| `tests/plugins/file-browser/media-preview.test.ts` | Delete file entirely |

---

## Removals in `file-browser.plugin.ts`

Work through these removals in order. Each removal is identified by a search
anchor (a unique string to find in the file) so the developer does not need to
rely on line numbers that shift after each edit.

### R-1: Module-level variable `_previewedPath`

Find and delete the entire line:
```
let _previewedPath: string | null = null;
```
Also delete its JSDoc comment block above it (lines starting with `/*` that
describe `_previewedPath` — the comment block beginning "Set by showMediaPreview"
on approximately line 728).

### R-2: CSS block in `FILE_BROWSER_CSS`

Find:
```
/* ── Media Preview Panel (FR-12, FR-13) ──────────────────────────────────── */
.file-browser-media-preview {
```

Delete from that comment line through the closing of `.tree-node-active { opacity: 1; }`
which is the last rule in the FILE_BROWSER_CSS constant (the backtick closing
the template literal is on the line after that rule).

The `.tree-node-active` rule at the top of FILE_BROWSER_CSS (the one that sets
`background` and `box-shadow` — around line 154) is in a different part of the
CSS and must NOT be removed.

After removal, the template literal backtick that closes `FILE_BROWSER_CSS`
should follow the last rule that precedes the deleted block. Verify by checking
that no `fbmp-` class names remain in the file.

### R-3: Function `closeMediaPreview`

Find:
```
function closeMediaPreview(): void {
```

Delete the entire function from its JSDoc comment block (beginning
"Idempotent — safe to call when no preview is open") through its closing `}`.

### R-4: Function `showMediaPreview`

Find:
```
function showMediaPreview(path: string): void {
```

Delete the entire function from its JSDoc comment block (beginning
"Open or replace the media preview panel") through its closing `}`.

### R-5: `buildActivateHandler` non-md branch

Find:
```typescript
        if (_previewedPath === path) {
          closeMediaPreview();
        } else {
          showMediaPreview(path);
        }
```

Replace with a stub comment (the real call arrives in step_03):
```typescript
        // Non-md file: will be wired to openMediaInTab in step_03.
        void path;
```

### R-6: `buildNodeEl` — `_previewedPath` predicate

Find:
```typescript
    ((activeFile && node.path === activeFile) || node.path === _previewedPath)
```

Replace with:
```typescript
    (activeFile && node.path === activeFile)
```

Also remove the surrounding JSDoc comment lines that reference `_previewedPath`
(the lines that say "Reading _previewedPath here (module scope) ensures...").

### R-7: `renderPanel` — `closeMediaPreview()` call

Find the call to `closeMediaPreview()` inside `renderPanel` (described in
comments as "calls closeMediaPreview() before clearing the container DOM").
Delete the single `closeMediaPreview();` call line and its associated comment
block above it. Do NOT delete any surrounding code.

### R-8: `_vaultChangedCb` — `closeMediaPreview()` call

Find inside `_vaultChangedCb`:
```typescript
    closeMediaPreview();
```
(accompanied by a comment block about EC-04 and belt-and-suspenders).
Delete the entire comment block and the `closeMediaPreview();` call.

### R-9: `destroy` panel method — `closeMediaPreview()` call

Find inside the `destroy(container: HTMLElement)` method:
```typescript
      closeMediaPreview();
```
(with a comment about EC-08 and clearing `_previewedPath` before nulling refs).
Delete the comment block and the `closeMediaPreview();` call.

### R-10: `_testing` export — remove four entries

Find and remove these four entries from the `_testing` export object:

```typescript
  /** Get the currently-previewed path (null when no preview is open). */
  getPreviewedPath(): string | null {
    return _previewedPath;
  },
  /** Directly set the previewed path (for test state injection). */
  setPreviewedPath(p: string | null): void {
    _previewedPath = p;
  },
  /** Expose showMediaPreview for direct testing. */
  showMediaPreview,
  /** Expose closeMediaPreview for direct testing. */
  closeMediaPreview,
```

---

## Delete Test File

Delete `tests/plugins/file-browser/media-preview.test.ts` entirely.

```bash
rm tests/plugins/file-browser/media-preview.test.ts
```

---

## Verification

After making all removals:

1. TypeScript compile — no references to removed symbols should remain:
   ```bash
   npx tsc --noEmit
   ```

2. Search for any stray references:
   ```bash
   grep -n "_previewedPath\|showMediaPreview\|closeMediaPreview\|fbmp-\|file-browser-media-preview" \
     src/plugins/file-browser/file-browser.plugin.ts
   ```
   Expected: zero matches.

3. Run the existing file-browser tests (the subset that do not touch media-preview):
   ```bash
   npm run test:run -- tests/plugins/file-browser/file-browser.test.ts
   ```
   All tests that previously passed must still pass. Tests that reference
   `_testing.getPreviewedPath` or `_testing.showMediaPreview` will fail because
   those are removed — those tests are updated in step_04.

4. Confirm the `media-preview.test.ts` file no longer exists:
   ```bash
   ls tests/plugins/file-browser/
   ```
   Should show only `file-browser.test.ts` (and `vault-ux.test.ts` if present).

---

## Notes for the Developer

- The TypeScript compiler will report errors on any remaining references to
  removed symbols. This is the correct signal — fix by completing all removals.
- Do not run `npm run build:plugins` yet. The plugin build happens in step_03
  after the routing update is applied.
- The `beforeEach` in `file-browser.test.ts` still calls
  `_testing.setPreviewedPath(null)` — this will cause a TypeScript / runtime
  error. That call is removed in step_04 when the test file is updated.
  For now, suppress the error by leaving it (the test suite will still run but
  that one `beforeEach` call will be a no-op or throw depending on strict mode).
  The cleaner approach is to remove that single line from `file-browser.test.ts`
  as part of this step — your call.
