---
title: "Step R08 — Regression Sweep"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R08 — Regression Sweep + Deferred-Work Audit

## Goal

Final pass over the test suite. Confirms every refactor EC has a
passing test, every deleted test is actually deleted, every edited
test uses the new fixtures, and every new deferred-work entry is
recorded in the 00_index. No source-code edits are expected — this
is a clean-up + audit step.

## Files touched

- **Edit** `tests/collections/ec-sweep.test.ts` (consolidation)
- **Edit** `docs/specs/collections/00_index.md` (DW-R2 / DW-R3 entries
  added to the Deferred Work section — already present from R06, but
  verify they're recorded)

## Failing tests to write FIRST

The bulk of the failing tests already landed in R01–R07. This step
adds the final consolidating cases to `ec-sweep.test.ts` for any EC
that didn't get a dedicated test in earlier steps.

### Add to `tests/collections/ec-sweep.test.ts`

| Test name | EC / FR | Asserts |
|---|---|---|
| `"EC-14 — window-size invariant is intact"` | EC-14 / NFR-3 | Reference the existing `tests/settings/window-defaults.test.ts` and assert it passes. Defensive — covers regression risk from any prior step accidentally touching `src/lib/settings.ts` or `src-tauri/src/lib.rs`. |
| `"EC-15 — vault index excludes `_folder.md`"` | EC-15 | Build a minimal vault index containing a `_folder.md` entry as `entries[0]`; call `collectChildren(parent, index)`; assert no returned card has `path` ending in `_folder.md`. |
| `"EC-16 / EC-19 — schemaVersion-too-new produces ok:false with `schema-too-new`"` | EC-19 | Pre-populate `_folder.md` with `schemaVersion: 999`; call `writeCollectionMeta` with any patch; assert returned `FileResult` is `{ ok: false, error: { message: "schema-too-new", ... } }`. |
| `"EC-25 — custom-icon Stack renders with the user-assigned icon"` | EC-25 | Pre-populate a Stack's `_folder.md` with `icon: bookshelf`; render the home canvas; assert the tile has class `folder-icon-bookshelf` (not `folder-icon-notebook`). |
| `"EC-26 — breadcrumb updates when a Stack is renamed inside the same render pass"` | EC-26 | Inside `navigateToStack`, rename the Stack (call `store.writeStackMeta` with a new displayName); trigger a re-navigate (matches the renderer's existing context-menu behaviour); assert the breadcrumb middle segment text matches the new displayName. |
| `"EC-28 — Make Collection / Unmake Collection symbols are absent from public API"` | EC-28 | Import the collections package barrel (or each module); assert none export `makeCollection`, `unmakeCollection`, `buildMakeUnmakeCollectionItem`, `detectCollectionLayout`, `isCollectionFolder`. |

### Audit script

Optionally add a small audit script (in `scripts/` or
`tests/collections/audit.test.ts`) that:
1. Greps `src/` for the string literals `"Make Collection"`,
   `"Unmake Collection"`, `collection:make-collection`,
   `collection:unmake-collection`, `detectCollectionLayout`,
   `isCollectionFolder`, `buildMakeUnmakeCollectionItem`. The expected
   count is zero.
2. Greps `src/plugins/file-browser/collections/` for `type:
   collection` and `type: stack` literal writes (not reads). Expected
   count: zero.

If a test framework integration is heavy, a simple shell script
invoked from `package.json:scripts` works fine.

## Implementation outline

1. **Run the full Collections suite:**
   ```bash
   npm run test:run -- tests/collections/
   ```

   Expected: every test green.

2. **Cross-check the EC-to-step map** in `00_index.md`:
   - Walk EC-1 through EC-28 in the requirements doc.
   - For each, locate the test file + name documented in
     `00_index.md → Test inventory → EC → step mapping`.
   - Run that specific test by name (`-t`) to confirm it passes.

3. **Confirm DW entries are recorded:**
   - DW-1 through DW-16 carry forward from the MVP §6.
   - DW-10 (drag UI) is now CLOSED — mark it `[x] CLOSED — landed in
     step_R06` in the 00_index DW table.
   - DW-R1 (cross-Stack drag), DW-R2 (parent-folder note ordering on
     Home), DW-R3 (reference-box drag-reorder) are NEW. Verify all
     three are present in the 00_index "Deferred work" section.

4. **Run the full project suite:**
   ```bash
   npm run test:run
   ```

   Expected: full project green; the 4655 baseline (or whatever the
   post-fix count is) is maintained.

5. **Run the window invariant:**
   ```bash
   npm run test:run -- tests/settings/window-defaults.test.ts
   ```

   Expected: green.

6. **Plugin rebuild:**
   ```bash
   npm run build:plugins && npm run sync:plugins
   ```

7. **TypeScript build:**
   ```bash
   npm run build
   ```

   Expected: clean (no errors, no unused-export warnings).

## Refactor opportunities

- Consolidate the EC-sweep tests file. Each refactor EC currently has
  a test that lives in either its dedicated test file (e.g.
  `drag-reorder.test.ts`) OR `ec-sweep.test.ts`. Move every EC into
  the consolidated `ec-sweep.test.ts` for a single audit view, or
  leave them in their dedicated homes for locality. Pick one and
  document the convention in the test file header.
- The audit-grep approach (counting literal strings) is a thin
  regression net. If the codebase grows a new `Collection` UI string
  unrelated to "Make Collection" gesture, that grep won't false-
  positive (the literals are specific). Still, audit-greps are
  brittle — consider a single `tests/collections/audit.test.ts` with
  explicit assertions rather than a shell script.

## Definition of Done

```bash
npm run test:run                            # full project
npm run test:run -- tests/collections/      # collections specifically
npm run test:run -- tests/settings/window-defaults.test.ts
npm run build
npm run build:plugins && npm run sync:plugins
```

Expected: every command green / clean.

Manual end-to-end (smoke test before merge):
1. Boot the app in `npm run tauri dev`.
2. Open a vault.
3. Right-click any folder → confirm NO "Make Collection" /
   "Unmake Collection" entry.
4. Open the command bar (`Cmd-K`) → confirm NO "Make Collection from
   Folder" entry.
5. Open a folder. The codeblock modal pops with the picker.
   Confirm a "Collection" pill is present (after Bookshelf in the
   row order). Pick it; pick "Default"; Apply.
6. The folder renders as Collections. With no subfolders / notes,
   the empty-state popover appears.
7. Click `+ Stack` → a new Stack tile appears with `notebook` icon.
8. Click the Stack → drill into it. Breadcrumb shows
   `Home / Stack 01`.
9. Add 3 notes via `+ Note`. Drag note 2 to position 1. Close +
   reopen the tab. Order persists.
10. Back on Home, drag Stack tiles to reorder. Close + reopen.
    Order persists.
11. Try to drag a note from Stack A onto Stack B's tile. Drag is
    refused (no `_folder.md` change after close + reopen).
12. Open a legacy folder created via the pre-refactor "Make
    Collection" (the `_folder.md` has `type: collection` with no
    `layout:` field). It renders as Collections. Inspect file on
    disk: still `type: collection`.
13. Trigger any mutation. Inspect file: `type: collection` is gone,
    `layout: collection-home` is present.
14. Switch back to Cards via the picker. Notes + subfolders intact
    on disk.
15. Confirm window-size invariant: window launches at 50% × 80%.

After this manual pass: declare the refactor complete. Flip
`00_index.md` status back to `reference` in the same commit.
