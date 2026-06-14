---
title: "step_10 — Regression sweep + final verification"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_10 — Regression sweep + final verification

## Goal

Confirm every EC and FR is covered by at least one passing test. Audit
the DW-* list against the shipped code. Run the full Verification
Checklist from `00_index.md` §8. Update `active_task.md` EC-10 wording
per the Architect-confirmed amendment (step_07 §"EC-10 clarification").

## Files touched

- **EDIT** `docs/requirements/active_task.md` — amend EC-10's
  description to match the actual slash-command convention (the typed
  text remains in the doc after Esc). Add a one-line marginal note
  citing step_07 for the resolution.
- **NEW (optional)** any gap-fill tests discovered during the sweep.
- **EDIT** `00_index.md` — update the Implementation Progress section
  with a checkmark for each completed step and the final test counts.

## What this step does NOT do

- Introduce new behaviour.
- Add new files (other than gap-fill tests).
- Touch `src/lib/settings.ts` or `src-tauri/src/lib.rs`.

## Failing tests FIRST

This step does not have new failing tests — it is a sweep that
ratifies the work of steps 01-09. The "failing test" discipline is
relaxed: the Lead Developer treats any RED test discovered during the
sweep as a step_10 deliverable (write a fix, write a regression pin,
land both in one commit referencing step_10).

If an EC or FR is found to lack a passing test, add one in the
appropriate `tests/view-modal/*.test.ts` file with a comment
`// step_10 — gap-fill for EC-NN / FR-NN`.

## Verification matrix (every EC and FR must be ✓ before sign-off)

### Edge Cases (21 total)

| EC | Status | Test file |
|---|---|---|
| EC-1 | ✓ | `tests/view-modal/submit-create.test.ts` |
| EC-2 | ✓ | `tests/view-modal/submit-create.test.ts`, `read-compat.test.ts` |
| EC-3 | ✓ | `tests/view-modal/submit-insert.test.ts` |
| EC-4 | ✓ | `tests/view-modal/config-row.test.ts` |
| EC-5 | ✓ | `tests/view-modal/config-row.test.ts` |
| EC-6 | ✓ | `tests/view-modal/tab-switch.test.ts` |
| EC-7 | ✓ | `tests/view-modal/read-compat.test.ts` |
| EC-8 | ✓ | `tests/view-modal/migration-on-write.test.ts` |
| EC-9 | ✓ | `tests/view-modal/slash-commands.test.ts` |
| EC-10 | ✓ (amended) | `tests/view-modal/slash-commands.test.ts` |
| EC-11 | ✓ | `tests/view-modal/modal-mount.test.ts` |
| EC-12 | ✓ | `tests/view-modal/modal-mount.test.ts` (step_06 additions) |
| EC-13 | ✓ | `tests/settings/window-defaults.test.ts` (existing — verified untouched) |
| EC-14 | ✓ | `tests/view-modal/submit-create.test.ts`, `tests/collections/renderer.test.ts` (verified) |
| EC-15 | ✓ | `tests/view-modal/css.test.ts` |
| EC-16 | ✓ | `tests/view-modal/read-compat.test.ts` |
| EC-17 | ✓ | `tests/view-modal/submit-create.test.ts`, `config-row.test.ts` |
| EC-18 | ✓ | `tests/view-modal/tab-switch.test.ts` |
| EC-19 | ✓ | `tests/view-modal/migration-on-write.test.ts` |
| EC-20 | ✓ | `tests/view-modal/migration-on-write.test.ts`, `tests/collections/migration-codeblock.test.ts` |
| EC-21 | ✓ | `tests/view-modal/submit-create.test.ts` |

### Functional Requirements (~50)

| Cluster | Verified by |
|---|---|
| FR-1 … FR-8 (triggers) | `submit-create.test.ts`, `submit-insert.test.ts` |
| FR-10 … FR-13 (six tabs) | `tab-switch.test.ts` |
| FR-14 … FR-18 (Path) | `config-row.test.ts`, `submit-create.test.ts` |
| FR-20 … FR-22 (Filter) | `config-row.test.ts` |
| FR-25, FR-26 (Sort) | `config-row.test.ts` |
| FR-30 … FR-32 (toggles) | `config-row.test.ts`, `modal-mount.test.ts` |
| FR-35 … FR-37 (Content Width) | `config-row.test.ts` |
| FR-40 … FR-42 (Action button) | `modal-mount.test.ts` |
| FR-45 … FR-47 (Preview area) | `modal-mount.test.ts`, `tab-switch.test.ts` |
| FR-50 … FR-52 (write) | `submit-create.test.ts`, `migration-on-write.test.ts` |
| FR-55 … FR-57 (read-compat) | `read-compat.test.ts` |
| FR-60 … FR-63 (migration-on-write) | `migration-on-write.test.ts`, `tests/collections/migration-codeblock.test.ts` |
| FR-70 … FR-74 (slash commands) | `slash-commands.test.ts` |
| FR-80 … FR-83 (Collection tab) | `submit-create.test.ts`, `tests/collections/*` (existing) |

### Non-Functional Requirements

| NFR | Verified by |
|---|---|
| NFR-1 (window invariant) | `tests/settings/window-defaults.test.ts` |
| NFR-2 (atomic writes) | `migration-on-write.test.ts` (test 8: single writeFile call) |
| NFR-3 (bridge layer) | Code review: no raw `invoke()` in feature code |
| NFR-4 (no TODOs) | grep `// TODO` across new files |
| NFR-5 (theme tokens) | `tests/view-modal/css.test.ts` |
| NFR-6 (tab switch <16ms) | `tab-switch.test.ts` (test 8) |
| NFR-7 (modal mount <100ms) | Manual — measured during step_10 |
| NFR-8 (plugin build rule) | Verified at each step's "Definition of Done" |
| NFR-9 (`_folder.md` excluded from index) | `tests/folder-view/` (existing, untouched) |
| NFR-10 (codeblock parser reuse) | Code review: only `parseYamlLines` exists; `parseSelectBody` projects via it; the `_folder.md` codeblock overlay in step_01 inlines projection over the same `parseYamlLines` |

### DW-* audit

| DW | Status |
|---|---|
| DW-1 (sidebar/grid config modals) | Tracked; not implemented. Slash commands insert empty stubs (step_07) |
| DW-2 (live preview) | Tracked; not implemented. Phase 2 |
| DW-3 (Layouts flow) | Tracked; old templates deleted in step_08 |
| DW-4 (force migration) | Explicitly forbidden by Q-5; not implemented |
| DW-5 (copy/paste config) | Tracked; not implemented |
| DW-6 (per-tab sub-options) | Tracked; not implemented |
| DW-7 (expanded Sort options) | Tracked; not implemented. Q-3 |
| DW-8 (Path validation) | Tracked; renderer-side concern, unchanged |
| DW-9 (edit-mode prefill deferral) | Resolved: edit-mode SHIPS in Phase 1 |
| DW-10 (modal-stacking registry) | Tracked; not implemented. Sentinel-list guard sufficient for Phase 1 |
| DW-11 (migration audit log) | Tracked; not implemented |
| DW-12 (preview-pane CSS polish) | Tracked; Q-2 default change may need visual review |

## EC-10 resolution (LOCKED per user directive 2026-06-08)

The Architect's step_07 note flagged EC-10 for amendment based on the
existing slash-command convention (which leaves typed text in place
after Esc). **The user resolved this conflict IN FAVOR OF EC-10 as
written in `active_task.md`** — the directive is non-negotiable:

> When the user types `/sidebar` or `/grid` and the slash-command menu
> is showing, pressing Esc must:
>   1. Remove the typed slash text (the `/sidebar` or `/grid` chars).
>   2. Close the slash menu.
>   3. Return the cursor to the position where the slash started
>      (clean editor state).
>
> This is the inverse of the existing slash-command convention (which
> leaves typed text on Esc). This feature OVERRIDES that convention.
> Scope: applies ONLY to the new `/sidebar` and `/grid` slash commands
> in this feature. Existing slash commands keep their current behavior.

Implementation lives in step_07: `ESC_REMOVES_TYPED_TEXT` (a frozen
Set in `src/editor/quick-commands.ts`) opts-in only the two new
command names. `QuickCommandsPlugin.cancelOnEsc(view)` dispatches a
change that deletes the typed text range when the current filter
matches one of these names; otherwise it falls back to the legacy
`close()` which leaves typed text intact.

`docs/requirements/active_task.md` is NOT amended — the directive
preserved its EC-10 wording. The step_07 spec's "EC-10 clarification"
section is the canonical resolution record.

## Implementation outline

Run, in order:

1. `npm run test:run` — full suite. Note the total pass count (target:
   ≥ 4654 baseline + new tests).
2. `npm run test:run -- tests/settings/window-defaults.test.ts` — window
   invariant green.
3. `npm run test:run -- tests/view-modal/` — every new test green.
4. `npm run test:run -- tests/collections/ tests/folder-view/` — no
   regressions.
5. `npm run build` — TypeScript clean.
6. `npm run build:plugins && npm run sync:plugins` — clean.
7. Manual verification per the bullet list in `00_index.md` §8.
8. Grep `src/` for `// TODO`, `// FIXME`, `// XXX` introduced by this
   work; resolve or log as DW-* per NFR-4.
9. Update `00_index.md` §"Implementation Progress" with checkmarks and
   final test counts. Set `status: active` → `status: reference` once
   the Code Reviewer signs off.

## Refactor opportunities

- After step_10, the View Modal is the only consumer of
  `mountSelectForm()`. The legacy `openSelectBuilderModal` is deleted
  in step_09. `select-builder.ts` could be renamed / merged into
  `view-modal.ts` for clarity. Deferred — not blocking.
- The `cbm-*` CSS class names are arbitrary holdovers from the legacy
  `openCodeBlockModal`. A rename to `vm-*` is cosmetic; defer.

## Definition of Done

- Every EC in the matrix above has at least one ✓.
- Every FR cluster has at least one ✓.
- Every NFR has at least one ✓.
- Every DW-* is either implemented or explicitly tracked.
- Full test suite green: `npm run test:run`.
- Window-size invariant test green: `npm run test:run -- tests/settings/window-defaults.test.ts`.
- TypeScript clean: `npm run build`.
- Plugin build clean: `npm run build:plugins && npm run sync:plugins`.
- `docs/requirements/active_task.md` EC-10 amendment landed.
- `docs/specs/view-modal/00_index.md` "Implementation Progress"
  section is up to date.
- Code Reviewer hand-off: ready for `@code-reviewer`.
