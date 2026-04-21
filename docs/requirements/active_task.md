---
title: "Insert Count Command"
last-updated: "2026-04-20"
review-cadence-days: 7
status: reference
---

# Insert Count Command (FC2 #15) Requirements Spec

## Validation Status

**VALIDATED — 2026-04-20**. All unknowns resolved. Requirements approved. Ready for architecture phase.

---

## Summary

As a user, I want to open a small configuration panel, specify a starting number N and a step value X, and then insert an auto-incrementing counter at each of my cursor positions (or at each line in my selection) so that I can number items, steps, or rows without manually typing sequential numbers.

---

## Background and Motivation

FEATURES.md item FC2 #15 reads: "Insert Count Command (Insert a number and increment by 1, or start at N and count by X)."

This is a power-user text-transformation command in the spirit of VS Code's "Insert Numeric Sequence" or Sublime Text's "Number Offset" features. The core use case is multi-cursor numbering: the user places cursors on several lines (or selects a range of lines), invokes the command, and each position receives the next value in the configured sequence. The secondary use case is single-cursor insertion of a single number at point.

The closest analogue in the codebase is the Advanced Lists plugin (`src/plugins/diagrams/diagrams.plugin.ts` for plugin structure) and the Command Bar plugin for modal overlay UI patterns. The feature ships as a toggleable core plugin with a discoverable command in the Command Bar.

---

## Goals

- Let users insert an incrementing numeric sequence at multiple cursor positions or across selected lines via a single command invocation.
- Provide a lightweight configuration UI (starting value N, step value X, optional prefix/suffix) that appears as an inline overlay anchored to the cursor position.
- Integrate with the Command Bar (Cmd-Shift-P) so the command is discoverable by name.
- Ship as a toggleable core plugin consistent with all other FC2 plugins.
- Persist the user's last-used N and X values so repeat invocations do not require re-entry.

---

## Functional Requirements

### FR-01: Command Invocation

**FR-01.1** The plugin registers a single primary action: `"edit-insert-count"`. This action is dispatched via `handleAction()` in `src/main.ts`.

**FR-01.2** The action can be triggered from:
- The Command Bar (Cmd-Shift-P) by searching "Insert Count" or "Number sequence."
- An Edit menu item (Edit > Insert Count...) with the keyboard shortcut `Cmd-Shift-3`.
- Directly via `window.__MARKABLE_HANDLE_ACTION__("edit-insert-count")` for testability.

**FR-01.3** Invoking the action while no editor is open (no active tab, or editor is null) is a silent no-op. No error dialog is shown.

### FR-02: Configuration UI

**FR-02.1** When `"edit-insert-count"` fires, the plugin opens a small configuration panel (hereafter "the Count Dialog"). The UI form is an **inline overlay anchored to the cursor position** (VS Code style) — a floating panel that appears near the cursor in the editor, not a centred modal. Dismissible with Escape or clicking outside the panel.

**FR-02.2** The Count Dialog exposes exactly three inputs:

| Field | Label | Default | Constraints |
|---|---|---|---|
| Start value | "Start at" | `1` | Any integer (positive, zero, or negative). Decimal values are rejected. |
| Step value | "Count by" | `1` | Any non-zero integer. Decimal values are rejected. A step of `0` is invalid and must be flagged. |
| Prefix/Suffix | "Wrap with" | `""` (empty) | Optional. A single string of the form `prefix__COUNTER__suffix` where `__COUNTER__` is the placeholder token. If the string contains no placeholder, the number is appended after the string. See FR-02.3. |

**FR-02.3** Prefix/Suffix format: the "Wrap with" field accepts a single free-text string. The plugin replaces all occurrences of the literal token `__COUNTER__` in that string with the computed number. Examples:

- Input `Step __COUNTER__:` → inserts `Step 1:`, `Step 2:`, etc.
- Input `(__COUNTER__)` → inserts `(1)`, `(2)`, etc.
- Input `Item ` (no token) → number is appended after the string: `Item 1`, `Item 2`, etc.
- If the field is empty, the plugin inserts bare numbers: `1`, `2`, `3`.

The Architect may choose to implement this as a single "Wrap with" token-substitution field (as specified) or as separate Prefix and Suffix fields that are joined around the number. Either implementation is acceptable provided the user-visible behaviour matches the examples above.

**FR-02.4** The Count Dialog has two action buttons:
- **Insert** (primary): applies the sequence and closes the dialog.
- **Cancel** (secondary): closes the dialog without any document changes.

**FR-02.5** Pressing Enter while the dialog is focused is equivalent to clicking Insert.

**FR-02.6** Pressing Escape while the dialog is focused is equivalent to clicking Cancel.

**FR-02.7** The dialog must not block keyboard input to the rest of the UI in a way that prevents Escape from working. Focus must be trapped inside the dialog while it is open (Tab cycles between the three inputs and the two buttons only).

### FR-03: Insertion Logic

**FR-03.1** When Insert is confirmed, the plugin reads the current editor state and determines the set of insertion positions. There are two modes, resolved in priority order:

**Mode A — Multi-cursor (multiple selections)**: If `editor.state.selection.ranges` has more than one range, each range receives the next value in the sequence. Ranges are processed in document order (ascending `from` position). The first range receives `start`, the second receives `start + step`, the third `start + 2 * step`, and so on.

**Mode B — Selection range (single selection spanning multiple lines)**: If there is exactly one selection range and `from !== to`, the plugin counts the lines that are fully or partially covered by the selection. Each line receives a counter value at its start (column 0) or at the line's current insertion point (see FR-03.3). Lines are processed top to bottom.

**Mode C — Single cursor (no selection)**: If there is exactly one selection range with `from === to` (a bare cursor), the plugin inserts the single value `start` at that position. No incrementing occurs.

**FR-03.2** A "position" in Modes A and C is the `from` offset of the selection range (the anchor or head, whichever is smaller). The counter value is inserted as a string at that offset, pushing existing text to the right.

**FR-03.3** In Mode B (selection spanning lines), insertion happens at the **cursor's current column** on each covered line (maintaining alignment). Each line's insertion offset is computed as `lineStart + cursorColumn`, where `cursorColumn` is the column offset of the selection's `head` position. If a line is shorter than `cursorColumn`, the counter is appended at the end of that line (no padding is added).

**FR-03.4** All insertions in a single invocation must be applied as a single CM6 transaction (`editor.dispatch({ changes: [...] })`). This ensures a single Undo step reverts the entire insertion, not N separate steps (EC-05).

**FR-03.5** After insertion, the editor selection **collapses to the position immediately after the last inserted value** (i.e., a bare cursor placed at `lastInsertionOffset + lastFormattedString.length`). No text is selected post-insertion. The editor is focused.

**FR-03.6** The formatted value for position `i` (0-indexed) is computed as:
```
value = start + (i * step)
formatted = wrapString.includes("__COUNTER__")
  ? wrapString.replaceAll("__COUNTER__", String(value))
  : wrapString + String(value)
```
If `wrapString` is empty, `formatted = String(value)`. All occurrences of `__COUNTER__` in the Wrap string are replaced (using `String.prototype.replaceAll`), not just the first. This is the intended behavior for patterns like `__COUNTER__/__COUNTER__` → `3/3`.

### FR-04: Settings Persistence

**FR-04.1** The plugin persists the last-used values of `start`, `step`, and `wrap` via `api.loadSettings()` / `api.saveSettings()`.

**FR-04.2** When the Count Dialog opens, the three fields are pre-populated with the persisted values. On first run (null from `loadSettings`), the defaults from FR-02.2 apply.

**FR-04.3** Settings are saved when the user clicks Insert (not on every keystroke in the dialog). Cancelled invocations do not update the persisted values.

**FR-04.4** Settings key names: `{ "start": number, "step": number, "wrap": string }`.

### FR-05: Input Validation

**FR-05.1** The Start and Step fields accept only integer values. Non-numeric input must be flagged inline (e.g., red border or helper text) and the Insert button must be disabled until both fields contain valid integers.

**FR-05.2** A Step of `0` is explicitly invalid. An inline error "Step cannot be zero" must be shown and the Insert button disabled.

**FR-05.3** Start and Step values are not bounded (any integer is valid). Extremely large values (e.g., `Number.MAX_SAFE_INTEGER`) are not rejected; the resulting string is simply very long. The Architect may add a soft warning for values outside a reasonable range (e.g., ±10,000,000) but this is not required.

**FR-05.4** The Wrap field is free-text with no validation. Any string is accepted, including empty.

### FR-06: Plugin Lifecycle

**FR-06.1** Plugin file: `src/plugins/insert-count/insert-count.plugin.ts`

**FR-06.2** Plugin metadata:
- `id`: `"insert-count"`
- `name`: `"Insert Count"`
- `version`: `"1.0.0"`
- `description`: `"Insert an auto-incrementing numeric sequence at cursor positions"`
- `detail`: A longer description explaining Mode A (multi-cursor), Mode B (selection), and Mode C (single cursor) behaviors.

**FR-06.3** `onEnable` sequence:
1. Load settings via `api.loadSettings()`; store in module state.
2. Inject CSS for the Count Dialog (`<style>` tag, idempotent, guarded by element ID).
3. Register the `edit-insert-count` action handler via `window.__MARKABLE_INSERT_COUNT_OPEN__ = openDialog` (same pattern as `__MARKABLE_COMMAND_BAR_OPEN__`).

**FR-06.4** `onDisable` sequence:
1. Remove any open Count Dialog from the DOM (if the user has the dialog open when they disable the plugin, close it without inserting).
2. Remove injected CSS `<style>` tag.
3. Set `window.__MARKABLE_INSERT_COUNT_OPEN__ = null`.

**FR-06.5** The plugin does not add any CM6 extensions (`api.addExtensions` is not called). All functionality is triggered imperatively on command invocation, not continuously via CM6 state.

**FR-06.6** The plugin is added to `scripts/build-plugins.mjs`'s `PLUGINS` array:
`["insert-count", "src/plugins/insert-count/insert-count.plugin.ts"]`

### FR-07: Command Bar Discoverability

**FR-07.1** The `"edit-insert-count"` action is added to the `COMMANDS` array in `src/keybindings/keybindings-panel.ts` (or wherever COMMANDS is defined) with:
- `id`: `"edit-insert-count"`
- `label`: `"Insert Count"`
- `section`: `"Edit"`
- `defaultKey`: `"Cmd-Shift-3"`

**FR-07.1a** The Edit menu item (FR-08.1) must display `Cmd-Shift-3` as its keyboard shortcut accelerator. The Architect must verify that `Cmd-Shift-3` is not already bound in `src/keybindings/` and document the check in the architecture step files.

**FR-07.2** The Command Bar's category A builder will automatically include this entry once it is in the COMMANDS array. No additional Command Bar work is required.

### FR-08: Edit Menu Integration

**FR-08.1** An "Insert Count..." menu item is added to the Edit menu in `src-tauri/src/menu.rs` (or the equivalent Tauri v2 menu construction file). The item dispatches `"edit-insert-count"` via the Tauri menu event mechanism.

**FR-08.2** The menu item is always enabled regardless of plugin state. If the plugin is disabled when the menu item is clicked, the `handleAction` case for `"edit-insert-count"` checks `window.__MARKABLE_INSERT_COUNT_OPEN__`; if null, it shows a brief alert: "Enable the Insert Count plugin in Markable > Plugins to use this feature." (Consistent with the Templates plugin pattern in `src/main.ts`.)

---

## UX / Interaction Design

### Trigger Flow

1. User places cursors (one or many) or selects a range of lines.
2. User invokes the command (Cmd-Shift-P → "Insert Count", or Edit > Insert Count..., or keyboard shortcut if assigned).
3. Count Dialog opens. Fields are pre-filled from last-used values.
4. User adjusts Start, Step, and Wrap as needed.
5. User presses Enter or clicks Insert.
6. Numbers are inserted at each cursor/line position in a single transaction.
7. Dialog closes. Editor is focused.

### Dialog Appearance

- Small, minimal panel (approximately 280px wide).
- Three labelled input fields stacked vertically: "Start at", "Count by", "Wrap with".
- Inline validation error text below Start/Step fields when invalid.
- Two buttons aligned right: Cancel (secondary), Insert (primary, disabled when invalid).
- Styled using existing CSS variables (`--ui-font`, `--accent-color`, `--bg-color`, etc.) for theme compatibility.

### Keyboard Shortcut

The default keyboard shortcut is `Cmd-Shift-3`. This shortcut triggers the `"edit-insert-count"` action. The Architect must verify no conflict exists before committing. Users may override via `keybindings.json`.

---

## Non-Functional Requirements

**NFR-01: Single Transaction** — All insertions for one invocation must be applied as a single CM6 transaction so Undo reverts the entire insertion in one step.

**NFR-02: Performance** — Inserting at up to 500 cursor positions must complete in under 100ms from the time Insert is clicked to the time the editor reflects the changes.

**NFR-03: No CM6 Extensions** — The plugin does not register any CM6 extensions. It is purely an imperative command plugin. This keeps the editor's extension compartment clean when the feature is not in active use.

**NFR-04: Theme Compatibility** — All plugin CSS uses variables from `:root`. No hardcoded hex values except as fallbacks in `var()` declarations.

**NFR-05: Focus Management** — When the dialog closes (Insert or Cancel), keyboard focus must be returned to the editor (`__MARKABLE_EDITOR_VIEW__.focus()`).

**NFR-06: IIFE Self-Containment** — All IIFE plugin rules apply. No app-internal module imports at runtime. CM6 accessed via `window.__MARKABLE_EDITOR_VIEW__` for the live view/state. CSS injected via `<style>` tags.

---

## Integration Points

| System | Integration | Notes |
|---|---|---|
| Plugin system (IIFE loader) | Plugin loaded as `plugins/core/insert-count.js` | Add to `build-plugins.mjs` PLUGINS array and `copy_core_plugins` bundle |
| `handleAction` dispatcher | Add `"edit-insert-count"` case in `src/main.ts` | Delegates to `window.__MARKABLE_INSERT_COUNT_OPEN__` |
| Edit menu | Add "Insert Count..." item in Tauri menu construction | Dispatches `"edit-insert-count"` |
| COMMANDS array | Add `"edit-insert-count"` entry | Command Bar discoverability |
| CM6 editor state | Reads `__MARKABLE_EDITOR_VIEW__.state.selection` | No extensions registered |
| CM6 dispatch | `__MARKABLE_EDITOR_VIEW__.dispatch({ changes: [...] })` | Single-transaction insertion |
| Plugin settings persistence | `api.loadSettings()` / `api.saveSettings()` | start, step, wrap |
| Plugin detail view | `renderDetailExtra` hook | Optional settings summary; no complex settings needed |
| Plugins Panel | Automatic via plugin system | Toggle, detail view |

---

## Out of Scope

1. **Roman numeral or alphabetic sequences** — Insert Count produces integers only. Roman numerals and letter sequences (A, B, C...) are a separate concern deferred to a future feature.
2. **Date/time sequence generation** — Not part of this feature.
3. **Decimal (floating-point) steps** — Start and Step are integers only. Decimal values (e.g., 0.5 step) are not supported in this version.
4. **Clipboard-based counter** — Reading a starting value from the clipboard is not supported. The dialog is the only input mechanism.
5. **Persistent counter state between sessions** — Each invocation starts fresh from the configured Start value. There is no "global counter" that increments across invocations automatically.
6. **Regex-based find-and-replace numbering** — Numbering lines that match a pattern is out of scope. The plugin acts on cursor positions/selected lines only.
7. **Visual preview of the sequence in the dialog** — A live preview showing the first N values is a nice-to-have but explicitly out of scope for the initial implementation.
8. **Auto-save on Insert** — The plugin does not trigger a document save after insertion.

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer. Every item must be covered by a test or a documented manual verification step.

**EC-01: No editor active** — `handleAction("edit-insert-count")` is called while no editor view exists (`__MARKABLE_EDITOR_VIEW__` is null or undefined). Expected: silent no-op; no dialog opens, no crash.

**EC-02: Plugin disabled, menu item clicked** — User clicks Edit > Insert Count... while the Insert Count plugin is toggled off. Expected: `__MARKABLE_INSERT_COUNT_OPEN__` is null; `handleAction` falls through to the alert path showing "Enable the Insert Count plugin..." message.

**EC-03: Single cursor, no selection (Mode C)** — One cursor, no selected text. Expected: dialog opens; user enters Start=5, Step=3, Wrap=""; dialog inserts `5` at cursor position. Only one number is inserted.

**EC-04: Multiple cursors (Mode A)** — Three cursors on three different lines. Expected: the first cursor gets `start`, the second gets `start + step`, the third gets `start + 2 * step`. All three insertions are applied in a single CM6 transaction.

**EC-05: Single undo reverts all insertions** — After Mode A insertion of 5 numbers, Cmd-Z must undo all 5 insertions at once (single transaction). Expected: the document returns to its pre-insertion state in one undo step.

**EC-06: Selection spanning N lines (Mode B)** — User selects 4 lines, invokes Insert Count. Expected: each of the 4 lines receives an incrementing counter. The Architect specifies the exact insertion point (column 0 vs. cursor column).

**EC-07: Selection that does not span a full line** — User selects partial text on a single line (e.g., characters 3-8 on one line). Expected: this is treated as Mode C (single cursor, `from` position used as insertion point) because only one line is involved.

**EC-08: Step of zero** — User enters Step=0 in the dialog. Expected: the Insert button is disabled and an inline error "Step cannot be zero" is shown. The dialog cannot be submitted with Step=0.

**EC-09: Negative step** — User enters Start=10, Step=-2. Expected: valid input; dialog accepts it. Insertions produce 10, 8, 6, 4... in order across cursor positions.

**EC-10: Wrap string with no placeholder** — User enters Wrap="Item ". Expected: bare string is prepended to each number: `Item 1`, `Item 2`, etc. (per FR-03.6 fallback logic).

**EC-11: Wrap string with placeholder** — User enters Wrap="Step __COUNTER__:". Expected: placeholder is replaced: `Step 1:`, `Step 2:`, etc.

**EC-12: Wrap string with multiple placeholder occurrences** — User enters Wrap="__COUNTER__/__COUNTER__". Expected: all occurrences are replaced — `3/3`, `4/4`, etc. Implemented via `replaceAll` (FR-03.6). No crash.

**EC-13: Non-integer input in Start field** — User types "abc" or "1.5" in the Start field. Expected: inline validation error shown, Insert button disabled, the dialog cannot be submitted.

**EC-14: Non-integer input in Step field** — Same as EC-13 but for the Step field.

**EC-15: Empty Start field** — User clears the Start field entirely. Expected: treated as invalid (not `0`); Insert button disabled.

**EC-16: Cancel dismisses without insertion** — User opens the dialog, changes fields, then clicks Cancel or presses Escape. Expected: no document changes; persisted settings are NOT updated to reflect the cancelled changes; editor focus is restored.

**EC-17: Enter key submits dialog** — While focus is on any input field or the Insert button, pressing Enter triggers insertion. Expected: same result as clicking Insert.

**EC-18: Escape key dismisses dialog** — While dialog is open, pressing Escape closes it without insertion, regardless of which element has focus.

**EC-19: Dialog already open, command invoked again** — User somehow triggers `edit-insert-count` while the dialog is already visible. Expected: no second dialog is created; the existing dialog receives focus.

**EC-20: Plugin disabled while dialog is open** — User disables the Insert Count plugin via Plugins Panel while the Count Dialog is open. Expected: `onDisable` closes the dialog without inserting, removes the dialog DOM, and restores editor focus.

**EC-21: Tab switch while dialog is open** — User switches to a different document tab while the Count Dialog is open. Expected: the dialog **remains open**. When the user subsequently clicks Insert, the insertion applies to whichever document is active at that moment. The dialog's visual position should update to reflect the new editor's cursor position if possible; if position recomputation is not feasible, the dialog may remain anchored at its original screen position.

**EC-22: Very large number of cursor positions** — User uses Cmd-Opt-Up/Down (multi-cursor) to create 200 cursors. Expected: 200 counter values are inserted in a single transaction. No performance freeze visible to the user (NFR-02).

**EC-23: Cursors on same line** — Two cursors on the same line at different column positions. Expected: both receive counter values; offsets are calculated correctly accounting for the text inserted by the first cursor shifting subsequent offsets to the right. The plugin must adjust downstream offsets or sort ranges and apply changes using CM6's `ChangeSet` API which handles offset shifting automatically.

**EC-24: Start value results in very long string** — Start=9999999999 (10 digits). Expected: the string `9999999999` is inserted correctly. No truncation, no crash.

**EC-25: First run (settings null)** — `api.loadSettings()` returns null. Expected: Start=1, Step=1, Wrap="" defaults are used for the dialog pre-fill. No attempt to read properties from a null object.

**EC-26: Settings save failure** — `api.saveSettings()` rejects after a successful Insert. Expected: the insertion has already been applied to the document (it is not rolled back). The plugin logs the error but does not show a user-visible error. In-memory values remain correct for the session.

**EC-27: Read-only document or content tab** — The active tab is a read-only help file (opened via `openHelpFileInTab`). Expected: the CM6 editor is in read-only mode; the `dispatch` call either fails silently or the transaction is rejected by CM6. No crash; the dialog should ideally detect this and show a message, or the insertion simply has no effect.

---

## Resolved Decisions (formerly Unknowns)

All items below were open during analysis and are now locked. The Architect must not re-open these without a requirements change request.

**UK-01 — RESOLVED: Dialog UI pattern** — Inline overlay anchored to the cursor position (VS Code style). Not a centred modal. See FR-02.1.

**UK-02 — RESOLVED: Mode B insertion point** — Insert at the cursor's current column on each covered line, not column 0. If a line is shorter than the cursor column, append at line end. See FR-03.3.

**UK-03 — RESOLVED: Default keyboard shortcut** — `Cmd-Shift-3`. The Architect must verify no conflict exists in `src/keybindings/` and document the check. See FR-07.1 and FR-07.1a.

**UK-04 — RESOLVED: Multi-placeholder behavior** — Replace ALL occurrences of `__COUNTER__` in the Wrap string using `replaceAll`. See FR-03.6 and EC-12.

**UK-05 — RESOLVED: Tab switch mid-dialog** — Leave the dialog open. Insertion applies to whichever tab is active when the user clicks Insert. See EC-21.

**UK-06 — RESOLVED: Post-insertion selection state** — Collapse selection to immediately after the last inserted value (bare cursor, nothing selected). See FR-03.5.

---

## Proposed Constraints

1. All insertions in one invocation must be one CM6 transaction (NFR-01, EC-05).
2. The plugin must not register CM6 extensions — imperative invocation only (FR-06.5, NFR-03).
3. The dialog must be dismissible via Escape at all times (FR-02.6, EC-18).
4. Validation must block submission when Step=0 or when Start/Step fields are non-integer (FR-05).
5. Settings are saved only on successful Insert, never on Cancel (FR-04.3, EC-16).
6. The global `__MARKABLE_INSERT_COUNT_OPEN__` must be set to null in `onDisable` to allow the `handleAction` fallback alert to function correctly (FR-06.4, EC-02).
7. Offset collision when multiple cursors occupy the same line must be handled by CM6's `ChangeSet` API, not by manual offset arithmetic (EC-23).
