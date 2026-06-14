---
title: "step_09 — Remove legacy Select / Sidebar / Grid tabs"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_09 — Remove legacy Select / Sidebar / Grid tabs

## Goal

The legacy `openCodeBlockModal()` exposes a type-picker at the top
(Select / Sidebar / Grid). The unified View Modal owns the Select
flow; Sidebar and Grid moved to slash commands (step_07). The legacy
type-picker is now dead code. Delete it; migrate the six remaining
call sites in `src/main.ts` to `openViewModal()`. If no callers of
`openCodeBlockModal` / `openSelectBuilderModal` remain, delete those
functions entirely.

## Files touched

- **EDIT** `src/lib/codeblock-modal.ts` — delete the type-picker DOM
  (`cbm-tabs` + the `TYPES` array) and the per-type form renderers
  (`renderSidebarForm`, `renderGridForm`, `renderSelectForm`). After
  this step the file ONLY exports `openViewModal`.
- **EDIT** `src/main.ts` — replace the six `openCodeBlockModal(...)`
  call sites (lines 1037, 1054, 1471, 1501, 1543, 1562) with
  `openViewModal(...)`. The `parseSidebarFenceBody` /
  `parseGridFenceBody` parsers + their imports are no longer needed at
  these sites (sidebar/grid editing via the modal is gone — users edit
  by typing in the fence directly, or by using `/sidebar` / `/grid` to
  insert a fresh stub).
- **EDIT** `src/lib/select-builder.ts` — the `openSelectBuilderModal()`
  function may have no remaining callers. Audit during step_09; delete
  if so. `mountSelectForm()` and `buildSelectFenceFromState()` stay
  (they are reused by the View Modal).
- **EDIT** tests that import / assert on `openCodeBlockModal` or
  `openSelectBuilderModal` — rewrite to use `openViewModal` or delete.
- **EDIT** step_06's `active-modal.ts` — `KNOWN_MODAL_OVERLAY_IDS`
  drops `__select-builder-overlay__` if `openSelectBuilderModal` is
  deleted.

## Function signatures

After step_09, `codeblock-modal.ts` exports ONLY:

```typescript
export type ViewModalMode = "create" | "insert" | "edit";
export interface ViewModalContext { /* ... */ }
export function openViewModal(mode: ViewModalMode, ctx: ViewModalContext): void;
```

The following exports are DELETED:

- `openCodeBlockModal`
- `BlockKind`
- `SidebarFormState`
- `GridFormState`
- `CodeBlockModalOptions`
- `buildSidebarFence`
- `buildGridFence`
- `TYPES`

In `main.ts`, the existing `findCustomFenceAtCursor` / `parseSelectBodyForBuilder` flow at line 1024 narrows to the Select-only branch:

```typescript
case "code-block": {
  if (!editor) break;
  const ed = editor;
  const ruleRowContext = getRuleRowContext();
  const detected = findCustomFenceAtCursor(ed);

  if (detected) {
    const langFirst = detected.lang.split(/\s+/)[0];
    if (langFirst === "select") {
      const initial = parseSelectBodyForBuilder(detected.body);
      openViewModal("edit", {
        editor: { view: ed, from: detected.from, to: detected.to },
        initial,
        ruleRowContext,
      });
    } else if (langFirst === "sidebar" || langFirst === "sidebar-left" || langFirst === "grid" || langFirst === "grid-card") {
      // Step_09: sidebar/grid no longer open a modal. The fence is
      // editable in place; the user can use `/sidebar` or `/grid` to
      // insert a fresh stub. Surface a quick toast so the user is not
      // confused by the silent no-op.
      showToast("Edit sidebar/grid fences inline. Use /sidebar or /grid to insert.");
    }
  } else {
    const cursorPos = ed.state.selection.main.head;
    openViewModal("insert", {
      editor: { view: ed, from: cursorPos, to: cursorPos },
      ruleRowContext,
    });
  }
  break;
}
```

## Failing tests FIRST

Path: `tests/view-modal/legacy-modal-deleted.test.ts`. Tests:

1. **"openCodeBlockModal is not exported from codeblock-modal.ts"** — dynamic import attempt, assert symbol is `undefined`.
2. **"openSelectBuilderModal is not exported from select-builder.ts"** — same.
3. **"buildSidebarFence / buildGridFence are not exported"** — same.
4. **"the literal string `cbm-tabs` does not appear in codeblock-modal.ts"** — read source, assert no match.
5. **"BlockKind type is not exported"** — TypeScript: `import type { BlockKind }` produces a compile error. (Vitest test: dynamic import, assert undefined.)
6. **"main.ts no longer imports parseSidebarFenceBody or parseGridFenceBody"** — read source, assert no import line referencing these symbols.

Existing tests in `tests/view-modal/` continue to pass; they only
referenced `openViewModal`.

EC mapping in this step: none new; this is destructive cleanup.

FR mapping: matches the locked decision that the unified modal always
emits `select` (FR-50, FR-52) and that `/sidebar` and `/grid` are the
exclusive entry points for those fence types (FR-70…FR-74).

## Implementation outline

The deletion is straightforward — remove the type-picker DOM and the
per-type form renderers from `codeblock-modal.ts`. The
`openViewModal()` function (introduced in step_04, wired in step_05)
becomes the file's only export.

Specific deletion ranges in `codeblock-modal.ts` (line numbers
approximate, Lead Developer confirms during step_09):

- Lines 138-184: `BlockKind`, `SidebarFormState`, `GridFormState`,
  `CodeBlockModalOptions`, `widthSuffix`, `buildSidebarFence`,
  `buildGridFence`, `TYPES`.
- Lines 186-485: the entire `openCodeBlockModal` function.

Replace with the `openViewModal` function that was introduced in
step_04/step_05. Keep:

- `OVERLAY_ID` (now `__codeblock-modal-overlay__` — keep the same
  sentinel id so `KNOWN_MODAL_OVERLAY_IDS` doesn't need a rename).
- `STYLES` / `injectStyles()` — the CSS is reused by the new modal
  layout via the existing `.cbm-*` class names (NFR-5 / C-2).

The six call sites in `src/main.ts`:

| Line | Existing | After step_09 |
|---|---|---|
| 1037 | `openCodeBlockModal({ initial: {...detected...}, onApply, onRemove })` for an edit | `openViewModal("edit", { editor, initial: parseSelectBodyForBuilder(...) })` — Select only |
| 1054 | `openCodeBlockModal({ onApply })` for an insert | `openViewModal("insert", { editor })` |
| 1471 | (similar edit flow) | `openViewModal("edit", ...)` |
| 1501 | (similar insert flow) | `openViewModal("insert", ...)` |
| 1543 | (similar edit flow) | `openViewModal("edit", ...)` |
| 1562 | (similar insert flow) | `openViewModal("insert", ...)` |

The Lead Developer audits each call site for context (what's the
`detected.lang`? is this a Select-only path or general?) and applies
the migration accordingly. The Sidebar / Grid edit branches become
the toast-and-return shape shown above.

### `openSelectBuilderModal` deletion (conditional)

`grep -rln "openSelectBuilderModal" src/ tests/` to identify callers.
Expected results (based on Architect's read of the codebase): only
references are inside `select-builder.ts` itself (the function
definition + maybe a comment) and possibly an old test. If so:

1. Delete `openSelectBuilderModal` from `select-builder.ts`.
2. Delete or rewrite any test that referenced it.
3. Drop `__select-builder-overlay__` from
   `KNOWN_MODAL_OVERLAY_IDS` in `active-modal.ts`.

`mountSelectForm()` and `buildSelectFenceFromState()` stay regardless.

## Refactor opportunities

- After deletion, `codeblock-modal.ts` is significantly smaller.
  Consider renaming it to `view-modal.ts` and updating the seven or
  eight import sites. Defer to a follow-up PR — not strictly required
  by the requirements and a rename can be a separate commit for
  reviewability.
- The `STYLES` block at line 32 of `codeblock-modal.ts` still
  references `cbm-*` class names. The names are arbitrary now; a
  future polish pass could rename them to `vm-*` (view-modal). Defer.

## Definition of Done

- All 6 tests in `tests/view-modal/legacy-modal-deleted.test.ts` pass.
- All existing `tests/view-modal/` tests continue to pass (the View
  Modal still works end-to-end).
- All existing `tests/folder-view/`, `tests/collections/`,
  `tests/editor/` tests continue to pass.
- `npm run test:run` runs clean.
- `npm run build` runs clean — no dangling imports.
- `npm run build:plugins && npm run sync:plugins` runs clean.
- Manual: in-doc `/block` opens the unified View Modal directly (no
  Select/Sidebar/Grid tabs visible).
- Manual: place cursor inside a `select` codefence; trigger "Edit
  CodeBlock" via the right-click menu (or whichever entry point); modal
  opens in edit mode with the fence prefilled.
- Manual: place cursor inside a `sidebar` codefence; trigger the same
  entry. Toast appears guiding the user to inline edit or `/sidebar`.
- Window-defaults invariant test continues to pass.
