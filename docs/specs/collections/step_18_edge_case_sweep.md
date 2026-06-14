---
title: "Step 18 — Edge Case Sweep + Final Audit"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 18 — Edge Case Gap-Fill + Verification

## Goal

Every EC in active_task.md (EC-1…EC-24) must have at least one passing test. Most are covered by earlier steps; this step audits the gaps and adds focused tests where coverage is thin. Also: confirm the window-size invariant survived, the plugin rebuild ran, and the deferred-work log is honest.

## Files touched

- Whatever test files are needed to fill the gap (additive only)
- **Edit** `docs/specs/collections/00_index.md` — finalise the EC test inventory (update the table) and the verification checklist

## Audit table — what each EC needs after step 17

| EC | Covered by | Gap-fill needed? |
|---|---|---|
| EC-1  | step 04 `commands.test.ts` | no |
| EC-2  | step 04 | no |
| EC-3  | step 02, 04 | no |
| EC-4  | step 05 | confirm toast shown (UI-level) — add manual verification line |
| EC-5  | step 02 | no |
| EC-6  | step 02 | no |
| EC-7  | step 13 | no |
| EC-8  | step 06 | no |
| EC-9  | step 06 | no |
| EC-10 | step 02 | no |
| EC-11 | step 09 | no |
| EC-12 | step 04 | no |
| EC-13 | step 02 | no |
| EC-14 | continuous; run `tests/settings/window-defaults.test.ts` in this step | confirm green |
| EC-15 | step 05 | no |
| EC-16 | step 09, 13 | no |
| EC-17 | step 13 | no |
| EC-18 | step 10 | no |
| EC-19 | step 11, 12 | no |
| EC-20 | step 13 | no |
| EC-21 | step 13 | no |
| EC-22 | step 06 | no |
| EC-23 | step 04 | no |
| EC-24 | step 07, 12 | no |

If the audit reveals an EC not actually covered, write the missing test here. Anticipated gaps (defensive sweep):

- **EC-4 toast wording**: explicit assertion that the standard-folder-fallback toast text appears once and only once per session. Add `tests/collections/ec4-toast.test.ts` if step 05's tests don't already cover it.
- **EC-22 round-trip**: store-side stays put through Finder rename of a Stack with a custom-SVG `icon` value. Add cross-test in `tests/collections/store.test.ts` if absent.

## Drag-reorder Phase-1.5 hook documentation

This step explicitly records the design surface for the Phase-1.5 drag-reorder follow-up (Q5, DW-10) so the future PR does not re-design:

- **API**: `store.reorderStack(collectionPath, stackName, { toIndex: number })` and `store.reorderNote(stackPath, noteFilename, { toIndex: number })` (already shipped in step 02).
- **Hooks**: in `home-canvas.ts`, add `draggable="true"` to `.fv-collection-stack-glyph`; `dragstart` records the dragged stack name; `dragover` on each glyph computes a target index; `drop` calls `store.reorderStack(..., { toIndex })`.
- **In stack-panel.ts**: same shape on `.fv-collection-note-box`.
- **Visual**: a `[data-drag-over="true"]` class triggers a thin accent-color left border to indicate insertion point. Uses existing `--accent-color` token.
- **Tests**: simulated `dragstart`/`dragover`/`drop` event sequence; assert reorderStack/reorderNote called with the expected toIndex.

No code lands in this step for the drag UI — the design hook above is the deliverable. The Lead Developer can lift it directly when Phase 1.5 starts.

## Final verification

Run, in order:

```bash
npm run test:run                                              # full suite
npm run test:run -- tests/settings/window-defaults.test.ts    # invariant
npm run test:run -- tests/folder-icons/                       # prerequisite
npm run test:run -- tests/collections/                        # this feature
cargo test --manifest-path src-tauri/Cargo.toml               # no Rust changes — should be no-op green
npm run build:plugins && npm run sync:plugins                 # mandatory
```

All must be green. Total expected new test count across `tests/collections/`:

- step 01: 10
- step 02: 17
- step 03: 10
- step 04: 15
- step 05: 8
- step 06: 13
- step 07: 10
- step 08: 10
- step 09: 16
- step 10: 13
- step 11: 13
- step 12: 12
- step 13: 14
- step 14: 11
- step 15: 11
- step 16: 10
- step 17: 8

Total: **191 new tests** (give or take 10 for gap-fill in step 18).

Manual smoke tests (from `00_index.md` §7):

- Make Collection → frame-01 empty state.
- + Notecard/Stack → Stack → frame-02 with inline-rename active.
- Add 3 notes → frame-03 boxes render with HTML preview.
- Click box → CM6 mounts in place; edit → click outside → save + preview re-render.
- Add reference to another Stack → navigate → reference box with arrow glyph.
- Edit reference → canonical updates.
- Rename canonical via tree → reference rewrites.
- Set custom icon on a Stack → Home glyph updates.
- 200-note Stack scroll → no jumps, bounded DOM.
- Unmake Collection → standard view; non-Collections keys preserved; all notes byte-identical.

## Definition of Done

- Every EC-1…EC-24 has at least one passing test in `tests/collections/` (or a reused existing test in `tests/settings/` for EC-14).
- `00_index.md` test inventory table verified accurate.
- DW-1…DW-16 recorded in `00_index.md` are honest — nothing in source code is a hidden TODO.
- Window invariant: `tests/settings/window-defaults.test.ts` green; `src-tauri/src/lib.rs` and `src/lib/settings.ts` `window.{sizeW,sizeH}` untouched.
- Plugin build artifacts current: `npm run build:plugins && npm run sync:plugins` ran after the final TS edit.

After this step, the feature is ready for `@code-reviewer` activation.
