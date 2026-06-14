---
title: "step_07 — `/sidebar` and `/grid` slash commands"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_07 — `/sidebar` and `/grid` slash commands

## Goal

Register two new leaf slash commands (`/sidebar`, `/grid`) in
`src/editor/quick-commands.ts`. Each inserts an empty codefence stub
at the cursor's slash range and lands the cursor on the inner blank
line. No modal, no inline picker. FR-70…FR-74.

## Files touched

- **EDIT** `src/editor/quick-commands.ts` — add two leaf entries in
  `makeCommands()`.
- **NEW** `tests/view-modal/slash-commands.test.ts` — unit tests for
  the new commands.

## Function signatures

No new public exports. Two new entries in the `makeCommands(deps)`
array:

```typescript
{
  name: "sidebar",
  description: "Insert a right-floating sidebar",
  apply(view, from, to) {
    const insert = "```sidebar\n\n```";
    view.dispatch({
      changes: { from, to, insert },
      // Cursor lands on the empty inner line.
      selection: { anchor: from + "```sidebar\n".length },
    });
    deps.enterPreviewMode();
  },
},
{
  name: "grid",
  description: "Insert an NxM grid",
  apply(view, from, to) {
    const insert = "```grid\n\n```";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + "```grid\n".length },
    });
    deps.enterPreviewMode();
  },
},
```

Insertion position rationale:
- `from = this.slashFrom = line.from` (per `quick-commands.ts:327`),
  so the leaf replaces from the start of the line through the cursor's
  current position (which is where the typed `/sidebar` ends).
- `to = view.state.selection.main.head` per `acceptAt()` line 425.
- The result: the typed `/sidebar` is replaced with the empty fence,
  and the cursor lands at the inner blank line.

The existing `/sidebar-left` command (line 231 in `quick-commands.ts`)
is kept unchanged. `/sidebar` is the new right-floating variant; the
naming intentionally mirrors the two-flavor fence languages
(`sidebar` and `sidebar-left` are both already recognised by the
sidebar widget).

## Failing tests FIRST

Path: `tests/view-modal/slash-commands.test.ts`. Tests:

1. **"`/sidebar` inserts `` ```sidebar\\n\\n``` `` at cursor (FR-70)"** — set up an EditorView with empty doc, simulate typing "/sidebar", press Enter. Assert doc reads ` ```sidebar\n\n``` `. Assert cursor at offset of the inner blank line.
2. **"`/grid` inserts `` ```grid\\n\\n``` `` at cursor (FR-71)"** — same for `/grid`.
3. **"`/sidebar` on a mid-line cursor — leading-newline handled (FR-72)"** — set up doc `"Hello"`, place cursor at offset 3, simulate `/sidebar`. The slash-command trigger requires `/` at start of line (per `quick-commands.ts:319`), so the cursor is moved to a new line first, OR the leading-newline is added. **Architect decision: the existing slash-command trigger never fires mid-line** because the regex `/^\/(\w*)$/` matches against `before = line.slice(line.from, sel.head)`, which is "Hello/" mid-line, NOT starting with `/`. So `/sidebar` cannot be typed mid-line in the first place. Test 3 therefore verifies the popup does NOT open when typing `/sidebar` in the middle of a non-empty line.
4. **"`/sidebar` is filterable to a single match"** — type "/s", popup shows multiple results (`/sidebar`, `/sidebar-left`); narrow to "/side" → still multiple; "/sidebar" (no -) → narrows to `/sidebar` + `/sidebar-left` (both prefix-match). The first selected is `/sidebar` because alphabetical order puts plain "sidebar" before "sidebar-left". Test asserts the first chip in the filtered list is `/sidebar`.
5. **"`/sidebar` followed by Esc cancels — literal `/sidebar` text remains"** — type "/sidebar", press Esc. **Architect re-check**: the existing `Esc` handler (line 65 in `quick-commands.ts`) calls `_active.close()` but does NOT undo the typed text. The user's literal "/sidebar" remains in the doc. EC-10 says "the literal `/grid` text the user typed is removed (existing slash-command convention — Architect confirms)". **Verification action**: grep `quick-commands.ts` for any undo-on-Esc behaviour. If found, the test asserts the typed text is removed. If not found, the requirement is **AMENDED**: EC-10's "literal text removed" expectation does not match the existing convention; the test is rewritten to assert the popup closes and the typed text persists. **The Lead Developer files a clarifying note in step_07 implementation if this turns out to differ from EC-10**.
6. **"`/sidebar` typed inside an open code fence does NOT fire (EC-9)"** — set up a doc with an unclosed `` ```js\n` `` block; place cursor inside; type "/sidebar". Assert the popup does NOT open. Implementation: extend the `update()` method in `QuickCommandsPlugin` to use `syntaxTree(state).resolveInner(sel.head, -1)` and skip when the resolved node's name is `FencedCode` or `CodeBlock`. (Step_07 implementation includes this guard if it does not already exist; the existing implementation does not check syntax tree position.)
7. **"`/grid` typed inside an open fence does NOT fire (EC-9)"** — same as 6 for `/grid`.
8. **"`/sidebar` followed by Esc — popup closes (EC-10 amended)"** — see test 5; assert `document.querySelector(".slash-cmd-popup")` is null after Esc.
9. **"`/sidebar` and `/sidebar-left` are both registered"** — assert both leaf entries exist in the popup when "/s" is typed.
10. **"`/grid` is registered (separately from any future `/grid-card`)"** — same.
11. **"Cursor lands on inner blank line after `/sidebar` insert"** — after Enter, assert `view.state.selection.main.head === <expected offset>`.

EC mapping in this step: EC-9, EC-10.

FR mapping: FR-70, FR-71, FR-72, FR-73, FR-74.

## Implementation outline

Two new entries in `makeCommands(deps)` (code shown above).

If the syntax-tree guard is needed (test 6, EC-9), the change is in
`QuickCommandsPlugin.update()`:

```typescript
import { syntaxTree } from "@codemirror/language";

update(update: ViewUpdate) {
  const { state } = update;
  const sel = state.selection.main;
  if (!sel.empty) { this.close(); return; }
  // ... existing in-sub-picker path ...

  // EC-9 — refuse inside an open code fence.
  const inFence = isInsideFencedCode(state, sel.head);
  if (inFence) { this.close(); return; }

  // ... existing regex match + filter ...
}

function isInsideFencedCode(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  let n: SyntaxNode | null = node;
  while (n) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
    n = n.parent;
  }
  return false;
}
```

If the existing implementation already prevents firing mid-fence
(because the slash regex matches "/" at start-of-line and a fenced
block's content lines do not start with "/" typically), the guard may
be redundant. The test (test 6) catches this either way — if the
existing flow already inhibits the firing, the guard is unnecessary.

The Lead Developer verifies during step_07 implementation by:
1. Writing test 6.
2. Running it without changes — if it passes, the existing behaviour
   already meets EC-9 and no guard is added.
3. If it fails, adding the syntax-tree guard.

### EC-10 clarification (the literal text question)

EC-10 in `active_task.md` says: "Nothing is inserted. The literal
`/grid` text the user typed is removed (existing slash-command
convention — Architect confirms)."

The Architect's confirmation here, after reading `quick-commands.ts`:
**the literal typed text is NOT removed by the existing Esc handler.**
The Esc handler at line 65 calls `_active.close()`; `close()` clears
the popup but does not dispatch any doc change to remove the user's
typed text.

This is the existing convention for ALL slash commands; the EC-10
description as written is a description of "if the convention removes
the literal text" which the convention does not.

**Architect decision (auto-mode resolution)**: amend the EC-10
expectation to "the popup closes and the typed text remains in the
doc; the user can backspace to remove it". Tests 5 and 8 reflect this.
A note is added to step_10 (regression sweep) to update
`active_task.md`'s EC-10 wording to match the actual convention.

## Refactor opportunities

- The two new commands duplicate the small `insert + cursor-on-inner-line`
  pattern. A shared helper `insertEmptyFence(view, from, to, lang)`
  may emerge. Defer to Phase 2.
- If `/grid` later needs configuration (DW-1), the leaf is upgraded to
  open a tiny modal. The current leaf is the minimal viable shape.

## Definition of Done

- All 11 tests in `tests/view-modal/slash-commands.test.ts` pass.
- `npm run test:run -- tests/view-modal/slash-commands.test.ts` is green.
- `npm run build` runs clean.
- Manual: open any `.md` file, type "/sidebar" at the start of a line.
  Popup shows `/sidebar` selected; press Enter. Empty `` ```sidebar ``
  ... `` ``` `` fence appears; cursor lands on the inner blank line.
  Same for `/grid`.
- Manual: type "/sidebar" inside an open ` ```js ` block. Popup does
  NOT appear (EC-9).
- Window-defaults invariant test continues to pass.
