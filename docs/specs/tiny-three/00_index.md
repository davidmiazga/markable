# Tiny-Three Feature Batch — Master Index

**Requirements source:** `docs/requirements/active_task.md`
**Status:** Architecture complete — ready for implementation
**Feature Checkpoint 1 gaps closed:** Paste Link (Cmd-K), Move Line Up/Down (Opt-Up/Down), Close All (Cmd-Shift-W)

---

## Scope Summary

Three self-contained editor enhancements shipped as a single commit batch. Each step is
independent and can be implemented and tested in isolation.

| Step | Feature | Files Modified |
|------|---------|----------------|
| step_01 | Paste Link (Cmd-K) | `src/editor/format.ts`, `src-tauri/src/menu.rs`, `src-tauri/src/lib.rs`, `src/main.ts` |
| step_02 | Move Line Up / Down (Opt-Up / Opt-Down) | `src/editor/format.ts` only |
| step_03 | Close All (Cmd-Shift-W) | `src-tauri/src/menu.rs`, `src-tauri/src/lib.rs`, `src/main.ts` |
| step_04 | Tests | `tests/` (Vitest frontend), `src-tauri/src/` (cargo test) |

---

## Implementation Checklist

### step_01 — Paste Link

- [x] Add `insertLink(view: EditorView): Promise<void>` to `format.ts`
- [x] Add `formatKeymap` entry for `Meta-k` / `Meta-k` that calls `void insertLink(v); return true`
- [x] Export `insertLink` from `format.ts`
- [x] Add `"Insert Link..."` menu item in `menu.rs` Format menu after `format-highlight`, before the separator that precedes `format-code-fence`
- [x] Add `"format-link"` to the forwarded-IDs match arm in `lib.rs` `on_menu_event`
- [x] Add `import { insertLink }` in `main.ts`
- [x] Add `case "format-link":` branch in `main.ts` `menu-event` switch

### step_02 — Move Line

- [x] Add `moveLineUp(view: EditorView): void` to `format.ts`
- [x] Add `moveLineDown(view: EditorView): void` to `format.ts`
- [x] Add two `formatKeymap` entries for `Alt-ArrowUp` and `Alt-ArrowDown`
- [x] Export both functions from `format.ts`

### step_03 — Close All

- [x] Add `"Close All"` `MenuItem` in `menu.rs` File menu immediately after `PredefinedMenuItem::close_window`
- [x] Add `"file-close-all"` to the forwarded-IDs match arm in `lib.rs` `on_menu_event`
- [x] Add `case "file-close-all":` branch in `main.ts` `menu-event` switch

### step_04 — Tests

- [x] Vitest: 7 tests for `insertLink` covering all four behavior cases + EC-L1/L2/L5
- [x] Vitest: 7 tests for `moveLineUp` / `moveLineDown` covering AC-M1–M6 + EC-M5/M7
- [x] Vitest: menu forwarding and `insertLink` / `moveLineUp` / `moveLineDown` export presence
- [ ] Manual verification: Cmd-K, Opt-Up/Down, Cmd-Shift-W behave as specified

---

## API Contracts

### `insertLink(view: EditorView): Promise<void>` — `format.ts`

```
async function insertLink(view: EditorView): Promise<void>
```

Reads the clipboard. Applies one of four document mutations based on
(hasSelection, hasValidUrl). Dispatches a single CM6 transaction. Calls
`view.focus()`.

URL validity regex: `/^https?:\/\/\S+/`

Clipboard trimming: `clipboardText.trim()` before the regex test and before
inserting into the document.

Clipboard failure: `catch` block falls through to the `url = ""` path; logs
`console.warn(...)`. No alert.

### `moveLineUp(view: EditorView): void` — `format.ts`

```
function moveLineUp(view: EditorView): void
```

Operates on `state.selection.main` only (consistent with `toggleOrderedList`).
Identifies the contiguous line block from `lineAt(main.from).number` through
`lineAt(main.to).number`. If the first line of the block is line 1, returns
without dispatching. Otherwise builds a single `ChangeSet`-equivalent `changes`
array that atomically swaps the block and the line above it. Restores the
selection to track the moved lines. Calls `view.focus()`.

### `moveLineDown(view: EditorView): void` — `format.ts`

Mirror of `moveLineUp`. No-op if the last line of the block equals
`state.doc.lines` (the total line count).

---

## Insertion Points — Exact File Locations

### `menu.rs` — Format menu insert point

After line 102 (`format-highlight`) and before line 103 (separator before
`format-code-fence`):

```rust
&PredefinedMenuItem::separator(handle)?,
&MenuItem::with_id(handle, "format-link", "Insert Link...", true, Some("CmdOrCtrl+K"))?,
```

The separator that currently sits between `format-highlight` and
`format-code-fence` moves to just before `format-code-fence`, so the new block
reads:

```
... format-highlight
--- separator ---
format-link         <-- NEW
--- separator ---   <-- existing separator, kept
format-code-fence
...
```

### `menu.rs` — File menu insert point

After line 50 (`PredefinedMenuItem::close_window`) and before the closing `]`:

```rust
&MenuItem::with_id(handle, "file-close-all", "Close All", true, Some("CmdOrCtrl+Shift+W"))?,
```

### `lib.rs` — `on_menu_event` forwarding match arm

The string `"file-close-all"` is added to the explicit match list alongside the
other `file-*` IDs. The `format-link` ID is covered automatically by the
`_ if id.starts_with("format-")` arm and requires no change to `lib.rs`.

### `main.ts` — `menu-event` switch, three new cases

```
case "format-link":
  if (!editor) break;
  void insertLink(editor);
  break;

case "file-close-all":
  void getCurrentWebviewWindow().hide();
  break;
```

---

## Edge Case Coverage Map

| Edge Case | Addressed in Step |
|-----------|-------------------|
| EC-L1 clipboard permission denied | step_01 (catch block) |
| EC-L2 trailing whitespace/newline | step_01 (trim before test) |
| EC-L3 multi-line selection as label | step_01 (no special handling needed) |
| EC-L4 selection already a link | step_01 (no toggle; wrap as-is) |
| EC-L5 non-http/https URL | step_01 (regex fails; no-URL path) |
| EC-L6 editor null on menu event | step_01 (guard in main.ts) |
| EC-M1 cursor on line 1, Opt-Up | step_02 (boundary check) |
| EC-M2 cursor on last line, Opt-Down | step_02 (boundary check) |
| EC-M3 selection starts at line 1 | step_02 (boundary check on block start) |
| EC-M4 selection ends at last line | step_02 (boundary check on block end) |
| EC-M5 single-line document | step_02 (both boundary checks trigger) |
| EC-M6 multi-cursor | step_02 (only `selection.main` used) |
| EC-M7 last line no trailing newline | step_02 (use `line.to` not `line.to + 1`) |
| EC-C1 unsaved changes on Close All | step_03 (hide without prompt, consistent with Cmd-W) |
| EC-C2 window already hidden | step_03 (Tauri `hide()` is safe on hidden window) |
| EC-C3 event before listener ready | step_03 (acceptable; consistent with all menu items) |
| EC-C4 re-open after Close All | step_03 (dock resume handler already in lib.rs) |

---

## Out of Scope (Deferred)

- URL dialog / prompt for Cmd-K
- Toggle-off (Remove Link) on existing Markdown links
- `ftp://`, `mailto:`, `file://` URL recognition
- Move Line menu items
- Unsaved-changes prompt on Close All
- Multi-window Close All iteration

---

## Review Request

- **Files changed**:
  - `src/editor/format.ts` — added `insertLink`, `moveLineUp`, `moveLineDown`; added `Meta-k`, `Alt-ArrowUp`, `Alt-ArrowDown` entries to `formatKeymap`
  - `src-tauri/src/menu.rs` — added `format-link` item (Format menu) and `file-close-all` item (File menu)
  - `src-tauri/src/lib.rs` — added `"file-close-all"` to `on_menu_event` forwarding match arm
  - `src/main.ts` — added `insertLink` import; added `case "format-link"` and `case "file-close-all"` to `menu-event` switch
  - `tests/format-tiny-three.test.ts` — 21 new Vitest tests for all three features

- **Steps completed**: step_01_paste_link.md, step_02_move_line.md, step_03_close_all.md, step_04_tests.md

- **Known limitations**:
  - Manual visual verification of Cmd-K, Opt-Up/Down, Cmd-Shift-W is marked unchecked in the checklist — requires the user to run the built app and confirm behavior against the step_04 manual verification checklist.
  - `ftp://`, `mailto:`, `file://` URLs are not recognised as valid links (deferred per spec).
  - Move Line has no menu items (deferred per spec).
  - Close All hides without an unsaved-changes prompt (deferred per spec; matches existing Cmd-W behavior).

- **Edge cases covered by tests**:
  - EC-L1 (clipboard permission denied) — `"EC-L1: clipboard rejection falls back to no-URL path without throwing"` in `format-tiny-three.test.ts`
  - EC-L2 (trailing whitespace/newline on clipboard URL) — `"EC-L2: trims trailing whitespace and newline from clipboard URL"`
  - EC-L5 (ftp:// treated as invalid) — `"EC-L5: ftp:// URL is treated as invalid"`
  - EC-M1 (cursor on line 1, move up) — `"EC-M1 / AC-M5: no-op when cursor is on line 1"`
  - EC-M2 (cursor on last line, move down) — `"EC-M2 / AC-M6: no-op when cursor is on the last line"`
  - EC-M3 (multi-line selection starting at line 1, move up) — `"EC-M3: no-op when multi-line selection starts at line 1 (moveLineUp)"`
  - EC-M4 (multi-line selection ending at last line, move down) — `"EC-M4: no-op when multi-line selection ends at last line (moveLineDown)"`
  - EC-M5 (single-line document) — `"EC-M5: no-op on single-line document (moveLineUp)"` and `"EC-M5: no-op on single-line document (moveLineDown)"`
  - EC-M6 (multi-cursor; only selection.main used) — `"EC-M6: only selection.main is moved; secondary cursor line is unaffected"` (state now updated after each dispatch)
  - EC-M7 (no trailing newline gained or lost) — `"EC-M7: no trailing newline gained or lost when last line has no trailing newline"`
  - EC-C1, EC-C2, EC-C3, EC-C4 — addressed architecturally (no unit test possible for Tauri window hide; see step_03 analysis)

---

## Review Sign-off

- **Date**: 2026-04-09
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all prior blocking issues resolved; no new issues found.
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified. All functional requirements for Paste Link, Move Line Up/Down, and Close All are satisfied by the implementation as documented in the Review Request section.
- **Edge case coverage**: All Edge Case Inventory items covered. EC-M3 and EC-M4 now have dedicated tests with genuine multi-line selections. EC-M6 stub corrected to materialise each dispatched `TransactionSpec` via `state.update()` and update `currentState` after each dispatch. AC-M3 (repeated move until no-op) and AC-M4 mirror (moveLineDown multi-line block) tests added and verified correct.
- **Status**: Approved for Merge
