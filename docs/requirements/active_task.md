# Active Task: Three Small Editor Features

**Status:** Requirements Validated
**Date:** 2026-04-09
**Covers:** Paste Link (Cmd-K), Move Line Up/Down (Opt-Up/Opt-Down), Close All (Cmd-Shift-W)

---

## 1. Feature Scope

This task delivers three self-contained editor enhancements that close known gaps in Feature Checkpoint 1. Each feature is independent and can be implemented and tested in isolation, but all three will ship in a single commit batch.

| Feature | Trigger | Layers touched |
|---------|---------|----------------|
| Paste Link Over Text | Cmd-K (CM6 keymap) + new Format menu item | `format.ts`, `menu.rs`, `main.ts` |
| Move Line Up / Down | Opt-Up / Opt-Down (CM6 keymap only) | `format.ts` |
| Close All | Cmd-Shift-W (new File menu item) | `menu.rs`, `main.ts` |

---

## 2. Functional Requirements

### Feature 1: Paste Link Over Text (Cmd-K)

**Summary:** As a user I want to press Cmd-K to wrap selected text as a Markdown link using the clipboard URL, or to insert a bare link scaffold when there is no selection or no URL.

#### Current state (confirmed from source)
- No link-insertion function exists in `src/editor/format.ts`.
- No `format-link` or `insert-link` menu item exists in `src-tauri/src/menu.rs`.
- No corresponding case exists in the `menu-event` switch in `src/main.ts`.

#### Required behavior (all four cases)

| Condition | Result |
|-----------|--------|
| Text selected AND clipboard contains a valid URL | Replace selection with `[<selection>](<url>)`. No prompt. |
| Text selected AND clipboard does NOT contain a valid URL | Replace selection with `[<selection>]()`. Cursor inside the empty parens. |
| No selection AND clipboard contains a valid URL | Insert `[](<url>)`. Cursor inside the empty square brackets. |
| No selection AND clipboard does NOT contain a valid URL | Insert `[]()`. Cursor inside the square brackets. |

#### URL validity rule
A string is considered a "valid URL" for this feature if it matches the pattern `^https?://\S+` (starts with `http://` or `https://` followed by at least one non-whitespace character). No full URL parsing is required.

#### Asynchronous clipboard constraint
`navigator.clipboard.readText()` is asynchronous. The CM6 keymap `run` callback must return `true` synchronously while performing the clipboard read and CM6 dispatch inside an async wrapper (`void asyncFn()`). This pattern is already used in the `document.addEventListener("keydown", ...)` block in `main.ts` and is therefore precedented in this codebase.

#### Menu item placement
Add "Insert Link" to the Format menu in `menu.rs`, after the "Highlight" item and before the separator that precedes "Code Fence". Accelerator: `CmdOrCtrl+K`. Menu event action string: `"format-link"`.

#### Frontend wiring
Add a `case "format-link":` branch to the `menu-event` listener in `main.ts`. Both the keymap path and the menu-event path must call a single shared function; the link-insertion logic must not be duplicated between them.

---

### Feature 2: Move Line Up / Down (Opt-Up / Opt-Down)

**Summary:** As a user I want to press Option-Up or Option-Down to move the current line (or all lines covered by the selection) one position upward or downward in the document.

#### Current state (confirmed from source)
- No move-line function exists in `src/editor/format.ts`.
- No move-line menu items exist in `src-tauri/src/menu.rs`.
- The Format menu has indent/outdent but no move-line entries.

#### Required behavior

- **Opt-Up:** The contiguous block of lines covered by the selection moves one line upward by swapping with the line immediately above. If any line in the selection is line 1, the operation is a no-op.
- **Opt-Down:** The contiguous block of lines covered by the selection moves one line downward by swapping with the line immediately below. If any line in the selection is the last line of the document, the operation is a no-op.
- After the move the selection tracks the moved lines so the user can press the shortcut again to keep moving.
- Multi-line selections move as a unit, not line-by-line independently.

#### Shortcut safety
Option-Up and Option-Down do not produce characters on macOS (they are pure navigation keys). This is safe per the project's keyboard shortcut conventions — the "avoid Alt- as sole modifier" rule applies only to keys that type characters.

#### CM6 keymap bindings
Add two entries to `formatKeymap` in `format.ts`:

```
{ key: "Alt-ArrowUp",   mac: "Alt-ArrowUp",   run: (v) => { moveLineUp(v);   return true; } }
{ key: "Alt-ArrowDown", mac: "Alt-ArrowDown",  run: (v) => { moveLineDown(v); return true; } }
```

#### Menu items
No menu items are required. This feature is keyboard-only.

---

### Feature 3: Close All (Cmd-Shift-W)

**Summary:** As a user I want to press Cmd-Shift-W to close all open Markable windows, with each window following the same hide-on-close behavior as Cmd-W.

#### Current state (confirmed from source)
- The File menu contains `PredefinedMenuItem::close_window` labeled "Close" (line 50 of `menu.rs`). This maps to Cmd-W via the OS.
- No "Close All" item exists anywhere in the menu.
- No `file-close-all` case exists in the `menu-event` switch in `main.ts`.

#### Required behavior
- Cmd-Shift-W triggers "Close All."
- In the current single-window architecture, the observable effect is identical to "Close" — the window hides rather than the process quitting.
- The implementation calls `getCurrentWebviewWindow().hide()` in `main.ts`.
- The action is handled via a `"file-close-all"` menu-event case.

#### Menu item placement
Add "Close All" to the File menu in `menu.rs`, immediately after `PredefinedMenuItem::close_window` (line 50). Accelerator: `CmdOrCtrl+Shift+W`. Menu event action string: `"file-close-all"`.

#### Future multi-window note (out of scope for this task)
When Markable gains multiple windows, Close All will need to iterate over all `WebviewWindow` instances. This is deferred.

---

## 3. Edge Case Inventory

All items in this inventory are mandatory test cases for the Code Reviewer.

### Feature 1 — Paste Link

| # | Edge Case | Expected Behavior |
|---|-----------|-------------------|
| EC-L1 | Clipboard permission denied (`readText()` rejects) | Catch the rejection; fall back to the "no URL" path. Log to console. Do not show an alert. |
| EC-L2 | Clipboard string has trailing whitespace or a newline (e.g., `"https://example.com \n"`) | Trim the clipboard string before the URL validity check and before inserting into the document. |
| EC-L3 | Selection spans multiple lines | Treat the full selected text as the link label including embedded newlines. No special handling is required. |
| EC-L4 | Selection is already a complete Markdown link (e.g., `[foo](bar)`) | No toggle-off behavior. Wrap the entire selection as a new link label: `[[foo](bar)](url)`. This is intentional. |
| EC-L5 | Clipboard contains a non-http/https URL (`ftp://`, `file://`, `mailto:`) | Fails the `^https?://` check. Fall back to the "no valid URL" path. |
| EC-L6 | Editor instance is null when the menu item fires | Guard with `if (!editor) break;`, consistent with all other Format menu cases in `main.ts`. |

### Feature 2 — Move Line

| # | Edge Case | Expected Behavior |
|---|-----------|-------------------|
| EC-M1 | Cursor is on line 1; user presses Opt-Up | No-op. Document unchanged. |
| EC-M2 | Cursor is on the last line; user presses Opt-Down | No-op. Document unchanged. |
| EC-M3 | Selection spans from line 1 through line N; user presses Opt-Up | No-op because one of the selected lines is already at line 1. |
| EC-M4 | Selection spans from line N through the last line; user presses Opt-Down | No-op because one of the selected lines is already the last line. |
| EC-M5 | Document contains exactly one line | Both Opt-Up and Opt-Down are no-ops. |
| EC-M6 | Multiple selection ranges (multi-cursor) | Apply the move to `state.selection.main` only. Ignore secondary ranges. Consistent with `toggleOrderedList` and `insertHorizontalRule` in the existing codebase. |
| EC-M7 | Last line has no trailing newline and is being moved upward | The swap must not gain or lose a trailing newline. Line boundary offsets must be used precisely. |

### Feature 3 — Close All

| # | Edge Case | Expected Behavior |
|---|-----------|-------------------|
| EC-C1 | Document has unsaved changes when Cmd-Shift-W is pressed | Hide without prompt, consistent with Cmd-W behavior. No unsaved-changes guard is introduced in this task. |
| EC-C2 | Window is already hidden when Close All fires | `hide()` on an already-hidden window must be a safe no-op. Verify the Tauri v2 API contract; if it is not safe, add an `isVisible()` guard. |
| EC-C3 | Menu event arrives before `initApp()` has registered the listener | Events arriving before the listener is registered are dropped by the Tauri event system. This is acceptable and consistent with all other menu items. |
| EC-C4 | Window is re-opened after Close All via the Dock icon | The window must reappear normally, confirming it was hidden and not destroyed. |

---

## 4. Acceptance Criteria

### Feature 1 — Paste Link

- AC-L1: Cmd-K with text selected and a valid URL on the clipboard wraps the selection as `[selection](url)` in a single undoable transaction.
- AC-L2: Cmd-K with text selected and non-URL clipboard content produces `[selection]()` with cursor between the empty parens.
- AC-L3: Cmd-K with no selection and a valid URL inserts `[](url)` with cursor between the square brackets.
- AC-L4: Cmd-K with no selection and non-URL clipboard content inserts `[]()` with cursor between the square brackets.
- AC-L5: The Format menu shows "Insert Link" with accelerator Cmd-K, after "Highlight" and before the "Code Fence" group.
- AC-L6: Triggering "Insert Link" from the menu produces identical behavior to the Cmd-K keymap binding.
- AC-L7: Clipboard read failure silently falls back to the no-URL path; no alert is presented to the user.

### Feature 2 — Move Line

- AC-M1: Opt-Up on a cursor line moves that line one position upward; cursor remains on the moved line.
- AC-M2: Opt-Down on a cursor line moves that line one position downward; cursor remains on the moved line.
- AC-M3: Pressing Opt-Up repeatedly from line 3 succeeds until line 1; a further press on line 1 is a no-op.
- AC-M4: A multi-line selection moves as a contiguous block; the selection after the move spans the same lines in their new positions.
- AC-M5: Opt-Up on line 1 does not alter the document content.
- AC-M6: Opt-Down on the last line does not alter the document content.

### Feature 3 — Close All

- AC-C1: Cmd-Shift-W hides the window (the process continues running; the app remains in the Dock).
- AC-C2: The File menu shows "Close All" with accelerator Cmd-Shift-W, immediately below "Close".
- AC-C3: Triggering "Close All" from the menu produces the same hide behavior as the keyboard shortcut.
- AC-C4: After Close All, clicking the Dock icon re-shows the window confirming it was hidden, not destroyed.

---

## 5. Out of Scope

- **URL dialog / prompt:** Feature 1 never opens a modal to ask the user to type a URL.
- **Toggle-off link (Remove Link):** Pressing Cmd-K on an already-formatted Markdown link does not unwrap it. That is a separate future feature.
- **Non-http/https URL recognition:** `ftp://`, `mailto:`, and `file://` are not recognized as valid URLs for this feature.
- **Move Line menu items:** Opt-Up / Opt-Down are keyboard-only in this task. No menu items are added.
- **Unsaved-changes prompt on Close All:** A "dirty document" indicator and save prompt is a separate future feature covering all close paths.
- **Multi-window Close All:** Iterating over multiple Tauri windows is deferred to the multi-window architecture phase.
- **Paste Without Formatting, Copy as Markdown, Copy as HTML:** Remain in the FC1 gap list; not addressed here.
- **Insert Image, Insert Table, Superscript, Subscript, Math, Front Matter Fence:** Not part of this task.
