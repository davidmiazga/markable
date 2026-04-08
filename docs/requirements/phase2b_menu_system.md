# Phase 2B: Native Menu System & Keyboard Shortcuts

**Status:** Requirements Validated
**Date:** 2026-04-08
**Depends on:** Phase 2A Chromeless Window (complete)
**Feature Checkpoint:** 1 -- Base Features (item 5: Base menu UI)

---

## Executive Summary

Phase 2B adds a native macOS menu bar with full keyboard shortcuts. This replaces the current toolbar-only interaction model with the standard menu system that macOS users expect. All menus from the user's Feature Checkpoint 1 spec are implemented, including System (app), File, Edit, Format, Theme, Window, and Help menus.

Custom menu items (Open, Save, New, etc.) fire events handled in Rust, which communicates with the frontend via Tauri's event system. PredefinedMenuItems (Copy, Paste, Undo, Redo, Quit, etc.) use Tauri's built-in behavior with no custom handling needed.

This phase does NOT implement the actions behind every menu item -- only the menu structure, keyboard shortcuts, and event routing. Items whose backend logic doesn't exist yet (Export, Import, Find & Replace, Format commands, Theme switching) will be wired as disabled or stub events that log to console, to be enabled in later phases.

---

## Functional Requirements

### R1: App (System) Menu

**What must be built:**
A macOS-standard application menu using the app name "Markable".

| Item | Shortcut | Type | Behavior |
|---|---|---|---|
| About Markable | -- | PredefinedMenuItem::about | Shows native About dialog |
| Check for updates... | -- | Custom (disabled) | Stub: opens URL in future |
| Separator | -- | Separator | -- |
| Settings | Cmd-, | Custom (disabled) | Stub: settings UI in future phase |
| Separator | -- | Separator | -- |
| Hide Markable | Cmd-H | PredefinedMenuItem::hide | Native hide |
| Hide Others | Cmd-Alt-H | PredefinedMenuItem::hide_others | Native hide others |
| Show All | -- | PredefinedMenuItem::show_all | Native show all |
| Separator | -- | Separator | -- |
| Quit Markable | Cmd-Q | PredefinedMenuItem::quit | Native quit |

**Acceptance Criteria:**
- "Markable" menu appears in the macOS menu bar.
- About shows a native dialog with app name and version.
- Hide/Show All/Quit work as standard macOS behavior.
- Settings and Check for Updates are visible but disabled (grayed out).

---

### R2: File Menu

**What must be built:**

| Item | Shortcut | Type | Behavior |
|---|---|---|---|
| New | Cmd-N | Custom | Emit "menu-new" event to frontend |
| Open... | Cmd-O | Custom | Emit "menu-open" event to frontend |
| Separator | -- | Separator | -- |
| Save | Cmd-S | Custom | Emit "menu-save" event to frontend |
| Save As... | Cmd-Shift-S | Custom | Emit "menu-save-as" event to frontend |
| Separator | -- | Separator | -- |
| Export | Cmd-Alt-E | Custom (disabled) | Stub for future |
| Import | Cmd-I | Custom (disabled) | Stub for future |
| Separator | -- | Separator | -- |
| Close | Cmd-W | PredefinedMenuItem::close_window | Hides window (matches Phase 2A behavior) |

**Acceptance Criteria:**
- New creates a blank editor state (clears content, resets filename to "Untitled").
- Open triggers the file dialog and loads the selected file.
- Save writes the current content (or triggers Save As if no file path).
- Save As triggers the save dialog.
- Close hides the window (consistent with hide-on-close from Phase 2A).
- Export/Import are visible but disabled.

---

### R3: Edit Menu

**What must be built:**

| Item | Shortcut | Type | Behavior |
|---|---|---|---|
| Undo | Cmd-Z | PredefinedMenuItem::undo | Native undo (CodeMirror handles this) |
| Redo | Cmd-Shift-Z | PredefinedMenuItem::redo | Native redo |
| Separator | -- | Separator | -- |
| Cut | Cmd-X | PredefinedMenuItem::cut | Native cut |
| Copy | Cmd-C | PredefinedMenuItem::copy | Native copy |
| Paste | Cmd-V | PredefinedMenuItem::paste | Native paste |
| Separator | -- | Separator | -- |
| Select All | Cmd-A | PredefinedMenuItem::select_all | Native select all |
| Separator | -- | Separator | -- |
| Find... | Cmd-F | Custom (disabled) | Stub: CodeMirror find in future |
| Find and Replace... | Cmd-Shift-F | Custom (disabled) | Stub for future |

**Note on deferred Edit items:** The following items from the feature spec are deferred to later phases because they require editor-level integration that doesn't exist yet:
- Paste Link Over Text (Cmd-K) -- requires selection detection + link wrapping
- Copy As Markdown (Cmd-Shift-C) -- requires content transformation
- Copy As HTML (Cmd-Alt-C) -- requires markdown-to-HTML conversion
- Paste Without Formatting (Cmd-Shift-V) -- requires paste interception
- Move Line Up/Down (Alt-Up/Down) -- requires CodeMirror command binding

These will be added when the live preview / advanced editing phase is implemented.

**Acceptance Criteria:**
- Undo/Redo/Cut/Copy/Paste/Select All all work via both menu and keyboard shortcut.
- Find and Find & Replace are visible but disabled.

---

### R4: Format Menu

**What must be built:**

All Format menu items are **custom items that are disabled (grayed out)** in this phase. They establish the menu structure and keyboard shortcut reservations, but the formatting logic requires the live preview engine (Phase 2C+).

| Item | Shortcut | Type |
|---|---|---|
| Heading 1 | Cmd-1 | Custom (disabled) |
| Heading 2 | Cmd-2 | Custom (disabled) |
| Heading 3 | Cmd-3 | Custom (disabled) |
| Heading 4 | Cmd-4 | Custom (disabled) |
| Heading 5 | Cmd-5 | Custom (disabled) |
| Heading 6 | Cmd-6 | Custom (disabled) |
| Separator | -- | Separator |
| Bold | Cmd-B | Custom (disabled) |
| Italic | Cmd-I | Custom (disabled) |
| Underline | Cmd-U | Custom (disabled) |
| Strikethrough | Cmd-Shift-< | Custom (disabled) |
| Highlight | Cmd-Shift-H | Custom (disabled) |
| Separator | -- | Separator |
| Code Fence | Alt-C | Custom (disabled) |
| Quote | Alt-Q | Custom (disabled) |
| Bullet List | Alt-. | Custom (disabled) |
| Ordered List | Alt-O | Custom (disabled) |
| Task List | Alt-X | Custom (disabled) |
| Separator | -- | Separator |
| Indent | Cmd-] | Custom (disabled) |
| Outdent | Cmd-[ | Custom (disabled) |
| Horizontal Rule | Alt-/ | Custom (disabled) |
| Separator | -- | Separator |
| Clear All Formatting | Cmd-. | Custom (disabled) |

**Acceptance Criteria:**
- All Format items appear in the menu with their keyboard shortcuts displayed.
- All items are grayed out / disabled.
- No errors when the menu is opened.

---

### R5: Theme Menu

**What must be built:**

| Item | Shortcut | Type |
|---|---|---|
| Next Theme | Ctrl-Shift-Down | Custom (disabled) |
| Previous Theme | Ctrl-Shift-Up | Custom (disabled) |
| Separator | -- | Separator |
| (Placeholder: "No themes installed") | -- | Custom (disabled) |

**Acceptance Criteria:**
- Theme menu exists with placeholder items.
- All items are disabled.

---

### R6: Window Menu

**What must be built:**

| Item | Shortcut | Type | Behavior |
|---|---|---|---|
| Minimize | Cmd-M | PredefinedMenuItem::minimize | Native minimize |
| Maximize | -- | PredefinedMenuItem::maximize | Native maximize |
| Separator | -- | Separator | -- |
| Fullscreen | Ctrl-F | PredefinedMenuItem::fullscreen | Native fullscreen toggle |

**Note:** Zoom In/Out (Cmd-+/Cmd--) are deferred. They require WebView zoom level control which is a separate concern.

**Acceptance Criteria:**
- Minimize, Maximize, and Fullscreen all work via menu.
- Fullscreen has Ctrl-F keyboard shortcut.

---

### R7: Help Menu

**What must be built:**

| Item | Shortcut | Type |
|---|---|---|
| Quickstart | -- | Custom (disabled) |
| Markdown Cheatsheet | -- | Custom (disabled) |

**Acceptance Criteria:**
- Help menu exists with stub items.
- All items are disabled.

---

### R8: Menu Event Routing (Rust -> Frontend)

**What must be built:**

For custom menu items that are enabled (File > New, Open, Save, Save As), clicking the menu item or pressing the keyboard shortcut must trigger the corresponding action in the frontend.

**Architecture:**
1. Rust `on_menu_event` handler matches the menu item ID.
2. Rust emits a Tauri event (e.g., `"menu-event"` with payload `{ "action": "new" }`).
3. Frontend listens for `"menu-event"` and dispatches to the appropriate handler.

This keeps all file I/O logic in the existing frontend code (main.ts) and avoids duplicating it in Rust.

**Acceptance Criteria:**
- Cmd-N creates a new document (clears editor, resets title to "Untitled").
- Cmd-O opens the file dialog and loads a file.
- Cmd-S saves the current file (or triggers Save As if untitled).
- Cmd-Shift-S triggers Save As dialog.
- All shortcuts work even when the toolbar buttons are removed or hidden.

---

### R9: Remove Toolbar (Replace with Menu)

**What must be built:**

The current toolbar (Open/Save buttons + file name display) is replaced by the menu system. The toolbar HTML and CSS are removed from `index.html` and `styles.css`.

The file name display moves to the title bar (already showing filename from Phase 2A).

**Acceptance Criteria:**
- No toolbar visible in the app.
- All file operations accessible via menu and keyboard shortcuts.
- Editor area gains the vertical space previously used by the toolbar.

---

## Non-Functional Requirements

### NF1: Native macOS Feel
- Menus must use the native macOS menu bar (not a custom HTML menu).
- Keyboard shortcuts must display in the menu using standard macOS symbols (Cmd, Shift, Alt, Ctrl).
- Menu behavior must match native macOS apps (highlight, submenus, separators).

### NF2: Performance
- Menu creation happens once at app startup.
- Menu event handling must not block the main thread.
- No perceptible delay between pressing a shortcut and the action executing.

### NF3: Extensibility
- Menu item IDs must be stable strings that can be referenced by future phases.
- The event routing pattern must support adding new menu actions without restructuring.

---

## Edge Case Inventory

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | Cmd-S with no file open (untitled) | Triggers Save As dialog |
| EC-2 | Cmd-N with unsaved changes | For now: discards changes (no dirty-tracking yet). Future: prompt to save. |
| EC-3 | Cmd-O when file is already open | Replaces current content with new file |
| EC-4 | Cmd-W (Close) | Hides window, app stays in dock (matches Phase 2A) |
| EC-5 | Cmd-Q (Quit) | Fully quits the app |
| EC-6 | Disabled menu item clicked | No action, no error |
| EC-7 | Keyboard shortcut for disabled item | No action, no error |
| EC-8 | Menu opened while editor has focus | Editor does not lose content or cursor position |
| EC-9 | Multiple rapid Cmd-S presses | Writes are serialized, no corruption |
| EC-10 | Undo/Redo via menu vs keyboard | Both work identically (CodeMirror handles both) |

---

## Technical Constraints

### TC-1: Tauri v2 Menu API (Rust-side)
- Menus are built in Rust using `tauri::menu::{Menu, Submenu, MenuItem, PredefinedMenuItem}`.
- The `.menu()` builder method on `tauri::Builder` is used.
- Event handling uses `on_menu_event`.

### TC-2: Accelerator String Format
- Tauri uses muda's accelerator format: `"CmdOrCtrl+S"`, `"CmdOrCtrl+Shift+S"`, `"Alt+C"`, etc.
- Use `"CmdOrCtrl"` instead of `"Cmd"` for cross-platform compatibility (even though we're macOS-first).

### TC-3: No Frontend Menu API
- Menus are entirely Rust-side. The frontend only listens for events emitted by the Rust menu handler.
- No `@tauri-apps/api/menu` imports needed on the frontend.

### TC-4: PredefinedMenuItems Handle Their Own Shortcuts
- Items like Copy, Paste, Undo, Redo, Quit, etc. have built-in accelerators. Do not manually specify shortcuts for these.

---

## Files to Modify

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` | Add `.menu()` builder, add `on_menu_event` handler |
| `src-tauri/src/menu.rs` | NEW: Menu construction module |
| `src/main.ts` | Add event listener for `"menu-event"`, implement `newFile()` action |
| `index.html` | Remove toolbar HTML |
| `src/styles.css` | Remove toolbar CSS |
| `src-tauri/capabilities/default.json` | Add menu-related permissions if needed |

---

## Out of Scope

- Implementing the actions behind disabled menu items (Export, Import, Find, Format commands, Theme switching)
- Dirty-tracking / "unsaved changes" prompts
- Context menus (right-click)
- Dynamic menu updates (enabling/disabling items based on state)
- Zoom In/Out (requires WebView zoom control)

---

## Visual Verification Checklist (for user sign-off)

- [ ] "Markable" app menu appears in macOS menu bar
- [ ] File menu: New, Open, Save, Save As, Close all present with shortcuts
- [ ] Edit menu: Undo, Redo, Cut, Copy, Paste, Select All all present
- [ ] Format menu: All items present and grayed out
- [ ] Theme menu: Present with placeholder items
- [ ] Window menu: Minimize, Maximize, Fullscreen present
- [ ] Help menu: Present with stub items
- [ ] Cmd-N creates a new blank document
- [ ] Cmd-O opens file dialog
- [ ] Cmd-S saves (or triggers Save As if untitled)
- [ ] Cmd-Shift-S triggers Save As
- [ ] Cmd-W hides window
- [ ] Cmd-Q quits app
- [ ] Old toolbar is removed
- [ ] Editor takes full height below title bar

---

## Feature Checkpoint 1 Progress After This Phase

| # | Feature | Status |
|---|---|---|
| 1 | Typora-style live preview editing | Not started |
| 2 | Performance (no flash, instant open) | DONE |
| 3 | Settings & persistence | Not started |
| 4 | Theming (hot-swappable CSS) | Not started |
| 5 | Menu system + keyboard shortcuts | **DONE** (structure complete, stubs for future items) |

---

**Next step:** Activate software-architect to produce step files for this phase.
