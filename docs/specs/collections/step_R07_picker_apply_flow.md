---
title: "Step R07 — Verify Picker Apply Flow"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R07 — Verify End-to-End Picker → Render Round-Trip

## Goal

Add integration-level tests that exercise the full path from picking
"Collection" in the codeblock display modal through to a fully-rendered
Collections layout. This step typically has NO source-code edits — if
R02–R06 landed cleanly, the picker round-trip already works. The
verification tests catch any wire-up regression and document the
contract.

If a test reveals a wire-up gap, fix it in this step (record the fix
in the Implementation outline below).

## Files touched

- **New** `tests/collections/picker.test.ts`
- **Edit** (only if a wire-up gap is found) any of:
  - `src/editor/select-widget.ts`
  - `src/plugins/file-browser/folder-view/display-options.ts`
  - `src/lib/select-builder.ts`

## Failing tests to write FIRST

### `tests/collections/picker.test.ts` (new)

| Test name | EC / FR | Asserts |
|---|---|---|
| `"EC-13 — picker writes `display: collection-home` into the codefence on Apply"` | EC-13 | Mount the select-builder form via `mountSelectBuilder` (existing helper); programmatically set `state.display = "collection-home"`; call `buildSelectFenceFromState(form.getState())`; assert the returned fence string contains `display: collection-home`. |
| `"EC-13 — applying Collection on an existing select codefence does NOT lose unrelated keys"` | EC-13 / EC-23 (carries forward) | Pre-populate `initial: { display: "cards", sort: "name-asc", showName: true }`; switch to `collection-home`; assert the returned fence preserves `sort` and `showName` (they may be irrelevant for Collections but should not be silently discarded). |
| `"EC-13 — picker round-trip: write, re-read, parse, assert layout is collection-home"` | EC-13 | Full round-trip: build fence string via the picker; parse via `parseFolderMd` or the codefence parser; assert the parsed `display === "collection-home"` (or `config.layout === "collection-home"` depending on which parser path is exercised). |
| `"EC-14 — switching FROM Collection to Cards leaves all .md files and subfolders byte-identical"` | EC-14 | Pre-populate a folder with subfolders + notes; switch the codefence from `display: collection-home` to `display: cards`; assert: (a) every `.md` file on disk is byte-identical; (b) every subfolder still exists with its `_folder.md` intact. |
| `"EC-13 — picker on a folder with no `_folder.md` creates the file on Apply"` | EC-13 / RQ-6 | Folder has no `_folder.md`; user opens via the file browser → `_folder.md` is created (existing behaviour of `openFolderViewTab` opens the file in edit mode and the codeblock modal pops); user selects Collection and applies; assert `_folder.md` was created on disk via the existing autosave path; assert it contains the `select` codefence with `display: collection-home`. |
| `"EC-27 — picker shows Collection as the active pill for a layout: collection-home folder"` | EC-27 | Mount the select-builder form with `initial: { display: "collection-home" }`; query the DOM for `.sb-display-pill.is-active`; assert its `data-slug === "collection-home"` (or whatever attribute select-builder uses to identify pills — verify and write to match). |
| `"RENDERERS[collection-home] is exactly renderCollectionHome (reference equality)"` | RQ-3 | This duplicates a step_R02 assertion but adds the round-trip dimension: after the picker writes `display: collection-home`, the dispatch path must call `renderCollectionHome` and not some other renderer. Spy on `renderCollectionHome` and confirm it was invoked when the select-widget renders the fence. |

## Implementation outline

1. **Write the new tests.** They exercise the picker / select-builder /
   select-widget chain. Use the existing test helpers — `mountSelectBuilder`,
   `buildSelectFenceFromState`, and the codeblock modal mounting pattern
   already established in `tests/codeblock/` (or `tests/select-builder/`
   — locate the existing test directory and follow the same pattern).

2. **Run the tests:**
   ```bash
   npm run test:run -- tests/collections/picker.test.ts
   ```

   - **If all green**: the round-trip works. Step is done.
   - **If any fail**: identify the wire-up gap. Most likely candidates:
     - The select-builder's pill click handler does not handle a slug
       with a hyphen (`collection-home`) correctly. Check
       `select-builder.ts:444–448` which renders pills by mapping
       `spec.options`. Hyphens are valid characters in HTML attributes
       so this should work; verify the attribute name matches.
     - The select-widget's `RENDERERS` map lookup uses an internal
       dispatch that bypasses the simple object lookup. Check
       `select-widget.ts:472` (`RENDERERS[display] ?? RENDERERS.cards`).
     - The codefence parser strips hyphens. Verify by reading the
       parsed `display` value from a fence containing `display:
       collection-home`.

3. **Fix any wire-up gap** with the smallest possible edit. Record the
   edit in the Refactor opportunities section so the next reader sees
   what changed.

4. **Plugin rebuild**: `npm run build:plugins && npm run sync:plugins`.

## Refactor opportunities

(Empty by default; populate with any wire-up fixes discovered during
implementation.)

## Definition of Done

```bash
npm run test:run -- tests/collections/picker.test.ts
npm run test:run -- tests/collections/
```

Expected: every test green; the picker round-trip is mechanically
verified.

Manual smoke check (end-to-end UX):
1. Open a fresh folder with no `_folder.md`.
2. Click the folder in the file browser → `_folder.md` opens; the
   codeblock modal pops.
3. Click the "Collection" pill.
4. Click "Default" sub-pill (auto-selected anyway).
5. Click Apply.
6. The fence body now contains `display: collection-home`; the
   widget renders the Collections Home canvas (empty-state popover
   since the folder has no subfolders / notes yet).
7. Click `+ Stack` → a Stack appears.
8. Re-open the file browser; the folder is recognised as a
   Collection (its `_folder.md`'s parsed layout via the codefence
   `display:` matches `collection-home`).

Plugin rebuild required if any source file was touched in this step.
