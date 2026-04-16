---
title: "Advanced Lists — Polish & Completion"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Advanced Lists — Polish & Completion Requirements Spec

## Summary

As a user, I want to switch an existing list block between the four supported list styles (standard, alphanumeric, decimal, steps) via dedicated keybindings or the Format menu, see the active style in the status bar, configure the global default style in the Settings panel, and trust that the existing comment-override feature works correctly — so that I can produce richly formatted outlines without manually rewriting markers.

---

## Background and Motivation

The Advanced Lists engine (`src/editor/list-engine.ts`, 474 lines) and its keybinding handlers (`src/editor/list-keybindings.ts`, 182 lines) are already implemented and stable. The engine supports four styles (standard, alphanumeric, decimal, steps), seven marker types, comment-override parsing (`<!-- list: style -->`), style inference, and marker generation. Enter, Tab, Shift-Tab, and Backspace all work on list lines.

What is missing to consider Advanced Lists **complete** (FC2 #5):

1. **Style-switching keybindings** — No way to convert an existing list block to a different style without manually rewriting every marker.
2. **Format menu integration** — No native menu items for the list styles (only Bullet/Ordered/Task exist under Format > List).
3. **Status bar indicator** — No visual feedback showing which list style is active at the cursor.
4. **Settings panel dropdown** — The `listStyle` field exists in `MarkableSettings` but has no UI to change it.
5. **Comment-override verification** — The `<!-- list: style -->` feature exists in the engine but has no dedicated test coverage for the full round-trip (comment present -> style used by keybindings -> correct markers generated).

### What Already Works (Do Not Modify)

- `list-engine.ts` — all pure functions, 637 lines of passing tests
- `list-keybindings.ts` — Enter/Tab/Shift-Tab/Backspace at `Prec.highest`
- `format.ts` — `indentLines`/`outdentLines` already call the list engine
- `settings.ts` — `listStyle` field on `MarkableSettings`, `getCurrentSettings().listStyle` used by keybindings

---

## Functional Requirements

### FR-1: Style-Switching Keybindings

**FR-1.1** Three new CM6 keybindings are registered:
- `Alt-r` — convert current list block to **alphanumeric** style (I. A. 1. a. i.)
- `Alt-n` — convert current list block to **decimal** style (1. 1.1. 1.1.1.)
- `Alt-l` — convert current list block to **steps** style (1. a. -)

**FR-1.2** The **standard** style (1. 2. 3. at all depths) is the default and has no dedicated keybinding. It is set via the Settings panel or comment override only.

**FR-1.3** When a style-switching keybinding fires:
1. Identify the list block containing the cursor using `findListBlockRange()`.
2. For every list line in the block, compute the correct marker for the target style at that line's depth using `markerTypeForDepth()` and `generateMarker()`.
3. Replace all markers in a **single CM6 transaction** (one undo step).
4. Preserve all line content (text after the marker) and indentation depth.
5. Cursor position remains at the same line and approximate character offset after the rewrite.

**FR-1.4** If the cursor is not on a list line when a style-switching keybinding fires, the keybinding is a no-op (returns `false`, falls through to default CM6 handling).

**FR-1.5** The keybinding does NOT change the global `listStyle` setting. It only rewrites the current block's markers.

### FR-2: Format Menu Integration

**FR-2.1** Add a **"List Style"** submenu inside the existing Format > List submenu in `menu.rs`. The submenu contains four items:
- "Standard" — menu id `format-list-style-standard`
- "Alphanumeric (I. A. 1. a. i.)" — menu id `format-list-style-alphanumeric`, accelerator `Alt+R`
- "Decimal Outline (1.1.)" — menu id `format-list-style-decimal`, accelerator `Alt+N`
- "Steps (1. a. -)" — menu id `format-list-style-steps`, accelerator `Alt+L`

**FR-2.2** Each menu item triggers the same logic as the corresponding keybinding (FR-1.3). The "Standard" menu item converts the current list block to standard style.

**FR-2.3** Menu items are always enabled. If the cursor is not on a list line, the action is a no-op.

### FR-3: Status Bar Indicator

**FR-3.1** When the cursor is inside a list block, the status bar displays the active list style name. Display text:
- "Standard" for standard
- "Alphanumeric" for alphanumeric
- "Decimal" for decimal
- "Steps" for steps

**FR-3.2** When the cursor is not inside a list block, the indicator is hidden (no text, no placeholder).

**FR-3.3** The indicator updates on every cursor movement (CM6 `updateListener` that checks `docChanged || selectionSet`).

**FR-3.4** Placement: the indicator appears in the status bar. Exact zone and styling will be refined during implementation — do not over-engineer the initial version.

### FR-4: Settings Panel Dropdown

**FR-4.1** Add a "List Style" section to the Settings panel (`settings-panel.ts`), following the existing pattern of labeled sections with description text.

**FR-4.2** The section contains a `<select>` dropdown with four options:
- "Standard (1. 2. 3.)" — value `"standard"`
- "Alphanumeric (I. A. 1. a. i.)" — value `"alphanumeric"`
- "Decimal Outline (1. 1.1.)" — value `"decimal"`
- "Steps (1. a. -)" — value `"steps"`

**FR-4.3** Changing the dropdown calls `updateSettings()` to persist the new `listStyle` value immediately.

**FR-4.4** The dropdown syncs from `getCurrentSettings().listStyle` when the panel opens (`syncPanelToSettings()`). If the field is absent (migration from old settings), default to `"standard"`.

**FR-4.5** Description text below the dropdown: "Default style for new lists. Existing lists auto-detect their style from markers, or use a `<!-- list: style -->` comment override."

### FR-5: Comment Override Verification

**FR-5.1** Add dedicated integration-style tests (Vitest, no CM6 runtime needed) that verify the full inference chain:
- A `<!-- list: alphanumeric -->` comment preceding a `1. 2. 3.` list causes `inferListStyle()` to return `"alphanumeric"`.
- The comment override takes priority over marker inference (e.g., a list with `I.` markers but a `<!-- list: steps -->` comment returns `"steps"`).
- The comment on the first line of the block (not preceding) also works.
- Whitespace variations in the comment (`<!--list:steps-->`, `<!-- list: steps -->`) are accepted.

**FR-5.2** These tests are additive. The existing 637-line test suite must pass unchanged.

---

## Non-Functional Requirements

**NFR-1: Single Transaction** — The style-switch rewrite (FR-1.3) must be dispatched as one CM6 transaction so that Cmd-Z undoes the entire rewrite in a single step.

**NFR-2: No Engine Modification** — `list-engine.ts` must not be modified. All new functionality is in new files or existing integration points (keybindings, format, menu handler, settings panel, status bar).

**NFR-3: Existing Tests Pass** — The 637-line `tests/list-engine.test.ts` and all other existing tests (909 Vitest total) must pass without modification.

**NFR-4: Performance** — The status bar indicator must not cause visible lag on every keystroke. Use the same `updateListener` pattern as existing status bar plugins (check `update.docChanged || update.selectionSet`, bail early if neither).

**NFR-5: Platform Convention** — Keybindings use `Alt` (macOS Option key). Menu accelerators display as `Alt+R`, `Alt+N`, `Alt+L` per Tauri/macOS convention.

---

## Architectural Decisions

**AD-1: New File for Style Switching** — Create a new file `src/editor/list-style-switch.ts` containing the `switchListStyle(view: EditorView, targetStyle: ListStyle)` function and the three keybinding handlers. This keeps the stable engine and keybinding files untouched.

**AD-2: Keymap Registration** — The new keybindings are added to `formatKeymap` in `format.ts` (same pattern as all other formatting keybindings), NOT to `listKeymap` in `list-keybindings.ts`. This avoids modifying the stable `Prec.highest` keymap.

**AD-3: Menu Handler Dispatch** — Menu item click events are dispatched from the existing Tauri menu event handler (wherever `format-bullet-list`, `format-ordered-list`, etc. are handled). The handler calls the same `switchListStyle()` function.

**AD-4: Status Bar Integration** — The list style indicator is implemented as a lightweight status bar update within the existing status bar infrastructure, not as a separate plugin. It follows whatever pattern the word-count or other status bar items use.

**AD-5: Settings Panel Placement** — The "List Style" dropdown is added to the Settings panel body, after the "Tabs" section and before the "Recent Files" section (or wherever the Architect determines is most logical given the current layout).

---

## Out of Scope

1. **Changing the list engine** — `list-engine.ts` is stable and passes all tests. No modifications.
2. **New list styles** — Only the four existing styles (standard, alphanumeric, decimal, steps) are supported.
3. **Auto-renumbering on paste** — Pasting list items does not trigger automatic renumbering.
4. **Multi-cursor style switching** — Style switching operates on the primary cursor's list block only.
5. **Nested list splitting** — If a block contains mixed styles at different depths, the switch rewrites all markers uniformly. Per-depth style preservation is not in scope.
6. **Comment override insertion UI** — No UI to insert `<!-- list: style -->` comments. Users type them manually.
7. **Table editing in preview mode** — Separate feature, not related to lists.

---

## Edge Case Inventory

**EC-1: Cursor not on a list line** — Keybinding fires but cursor is on a paragraph, heading, or blank line. Expected: no-op, return `false`.

**EC-2: Single-item list** — A list block with exactly one line (e.g., `1. Only item`). Expected: the single marker is rewritten to the target style's depth-0 marker.

**EC-3: Deeply nested list (5+ levels)** — A list with depth 5+ in alphanumeric style cycles back through the marker types (roman-upper at depth 5 = depth 0). Expected: `markerTypeForDepth` handles the modulo correctly (already tested, but style switch must also produce correct output).

**EC-4: Empty list items** — Lines like `1. ` (marker with no content). Expected: marker is rewritten; empty content is preserved.

**EC-5: Mixed depths with decimal-outline** — Switching TO decimal style requires building parent chains. A flat `1. / 2. / 3.` list at depth 0 becomes `1. / 2. / 3.` (no change in decimal-outline at depth 0). An indented item at depth 1 under item 2 becomes `2.1.`. Expected: parent chain is computed from the sequential position of ancestor items.

**EC-6: Comment override already present** — A block preceded by `<!-- list: alphanumeric -->` is switched to steps via `Alt-L`. Expected: markers are rewritten to steps style, but the comment is NOT modified or removed. On the next Enter/Tab, the comment override will win again (inferListStyle checks comment first). The user must manually delete the comment if they want the keybinding's style to persist.

**EC-7: Switching to the same style** — User presses `Alt-R` on a block that is already alphanumeric. Expected: no-op or idempotent rewrite (markers remain the same). Either behavior is acceptable; the transaction should not corrupt content.

**EC-8: Alpha overflow (>26 items)** — A list at an alpha-lower depth with 27+ items. `toAlphaLower(27)` returns `"27"` (the string). Expected: the marker becomes `27. ` which looks like a decimal marker. This is existing engine behavior and is not changed by this feature.

**EC-9: Roman numeral ambiguity during switch** — Switching to alphanumeric on a list where depth-0 items will get roman-upper markers. Items like "I." are both valid alpha-upper and roman-upper. Expected: `generateMarker("roman-upper", ordinal)` is used directly (no detection/disambiguation needed since we are generating, not parsing).

**EC-10: Undo after style switch** — User switches from standard to alphanumeric, then presses Cmd-Z. Expected: the entire list reverts to standard markers in one undo step (NFR-1).

**EC-11: Status bar on non-list line** — Cursor moves from a list line to a heading. Expected: status bar indicator disappears (FR-3.2).

**EC-12: Status bar with comment override** — Cursor is inside a list block preceded by `<!-- list: steps -->`, but the markers look like standard `1. 2. 3.`. Expected: status bar shows "Steps" (because inferListStyle returns "steps" due to the comment override).

**EC-13: Settings migration — absent listStyle** — Old settings file has no `listStyle` field. Expected: dropdown defaults to "standard"; `getCurrentSettings().listStyle` returns `undefined`; all code falls back to `"standard"`.

**EC-14: Decimal outline parent chain computation** — When switching TO decimal style, the parent chain must be computed by scanning preceding lines at shallower depths. Example: lines at depths [0, 1, 1, 0, 1, 2] with ordinals [1, 1, 2, 2, 1, 1] should produce markers [1., 1.1., 1.2., 2., 2.1., 2.1.1.]. This is the most complex edge case and requires careful sequential scanning.

**EC-15: Bullet markers in steps style** — Switching to steps with items at depth 2+. Expected: those items get bullet markers (`- `). Bullets have no ordinal progression, so all depth-2+ items show `- ` regardless of position.

**EC-16: Empty document / no list block** — `findListBlockRange` returns null. Expected: keybinding is a no-op, status bar shows nothing.

**EC-17: Selection spans multiple list blocks** — Cursor is on line 5 which is in a list, but lines 3-4 are a blank line separating two lists. Expected: only the block containing line 5 is rewritten. `findListBlockRange` already handles this by stopping at blank lines.

**EC-18: List block starts with comment line** — `findListBlockRange` walks backward and includes `isListMetaComment` lines. Expected: the comment line is included in the range but not rewritten (it has no list marker).

---

## Migration Notes

### Already Implemented (Stable, Do Not Modify)

| Component | File | Status |
|---|---|---|
| List engine (4 styles, 7 markers, inference, comment parsing) | `src/editor/list-engine.ts` | Stable, 474 lines |
| List keybindings (Enter, Tab, Shift-Tab, Backspace) | `src/editor/list-keybindings.ts` | Stable, 182 lines |
| `listStyle` field in settings type | `src/lib/settings.ts` line 132 | Stable |
| `listStyle` read in keybindings | `list-keybindings.ts:41` via `getCurrentSettings().listStyle` | Stable |
| `listStyle` read in format.ts | `format.ts:17` via `getCurrentSettings().listStyle` | Stable |
| Existing test suite | `tests/list-engine.test.ts` | 637 lines, all passing |
| Format > List submenu in native menu | `menu.rs` lines 138-148 | Bullet/Ordered/Task items exist |

### New Work Required

| Component | Target File | Notes |
|---|---|---|
| `switchListStyle()` function | `src/editor/list-style-switch.ts` (new) | Core rewrite logic, single transaction |
| Three Alt keybindings | Added to `formatKeymap` in `src/editor/format.ts` | `Alt-r`, `Alt-n`, `Alt-l` |
| "List Style" submenu in Format > List | `src-tauri/src/menu.rs` | 4 new menu items with accelerators |
| Menu event handler wiring | Wherever menu events are dispatched to JS | Calls `switchListStyle()` |
| Status bar indicator | Status bar infrastructure file | updateListener, show style name |
| Settings panel dropdown | `src/settings/settings-panel.ts` | New section with `<select>` |
| Comment override integration tests | `tests/list-engine.test.ts` (additive) | Verify full inference chain |
| Style switch unit tests | `tests/list-style-switch.test.ts` (new) | All edge cases above |
