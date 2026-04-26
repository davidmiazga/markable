# Markable 2.0 -- Phase 2B: Native Menu System -- Master Blueprint

**Date:** 2026-04-08
**Status:** Architecture Complete -- Ready for Lead Developer
**Based on:** `docs/requirements/phase2b_menu_system.md`
**Depends on:** Phase 2A Chromeless Window (complete)

---

## Executive Summary

Phase 2B adds a native macOS menu bar with 7 menus (Markable, File, Edit, Format, Theme, Window, Help) and keyboard shortcuts. Menus are built entirely in Rust using Tauri v2's menu API. Custom menu events are routed to the frontend via Tauri's event system. The current HTML toolbar is removed -- all file operations move to the menu bar.

---

## Stack Decision

No new npm dependencies. One new Rust module (`src-tauri/src/menu.rs`).

| Technology | Usage in Phase 2B |
|---|---|
| `tauri::menu::*` | Menu, Submenu, MenuItem, PredefinedMenuItem for native menu construction |
| `MenuItem::with_id` | Custom items with stable string IDs for event matching |
| `AppHandle::on_menu_event` | Rust-side event handler that emits Tauri events to frontend |
| `@tauri-apps/api/event` | Frontend listener for menu events from Rust |

---

## High-Level Architecture

### Data Flow

```
App Startup (Rust)
  |
  v
menu.rs: build_menu(app_handle) -> Menu
  |
  v
lib.rs: .menu(|handle| build_menu(handle))
  |
  v
macOS renders native menu bar with all 7 menus
  |
  v
User clicks menu item or presses keyboard shortcut
  |
  v
Tauri routes event:
  - PredefinedMenuItem (Copy, Paste, etc.) -> handled natively, no custom code
  - Custom MenuItem -> on_menu_event fires in Rust
      |
      v
  Rust matches item ID, emits event: app_handle.emit("menu-event", payload)
      |
      v
  Frontend (main.ts) listener receives event, dispatches to handler
      |
      v
  Handler executes action (newFile, openFile, saveFile, saveFileAs)
```

### Component Map

```
markable-2.0/
  src-tauri/
    src/
      menu.rs                 [NEW]    Menu construction: build_menu() function
      lib.rs                  [MODIFY] Add .menu() and on_menu_event to Builder chain
    capabilities/default.json [MODIFY] Add event permissions if needed
  src/
    main.ts                   [MODIFY] Add menu event listener, newFile() handler
  index.html                  [MODIFY] Remove toolbar HTML
  src/styles.css              [MODIFY] Remove toolbar CSS
```

---

## API Contracts

### Menu Item IDs (Stable Strings)

Custom menu items use `MenuItem::with_id` with these string IDs. These IDs are the contract between Rust menu construction and Rust event routing.

| Menu | Item | ID String |
|---|---|---|
| File | New | `"file-new"` |
| File | Open | `"file-open"` |
| File | Save | `"file-save"` |
| File | Save As | `"file-save-as"` |
| File | Export | `"file-export"` |
| File | Import | `"file-import"` |
| Edit | Find | `"edit-find"` |
| Edit | Find and Replace | `"edit-find-replace"` |
| Format | (all items) | `"format-h1"` through `"format-clear"` |
| Theme | Next/Previous | `"theme-next"`, `"theme-prev"` |
| App | Settings | `"app-settings"` |
| App | Check for Updates | `"app-updates"` |
| Help | Quickstart | `"help-quickstart"` |
| Help | Cheatsheet | `"help-cheatsheet"` |

### Tauri Event Contract (Rust -> Frontend)

```rust
// Rust emits:
app_handle.emit("menu-event", json!({ "action": "file-new" }))?;
```

```typescript
// Frontend listens:
import { listen } from "@tauri-apps/api/event";

listen<{ action: string }>("menu-event", (event) => {
  switch (event.payload.action) {
    case "file-new": newFile(); break;
    case "file-open": openFile(); break;
    case "file-save": saveFile(); break;
    case "file-save-as": saveFileAs(); break;
  }
});
```

### Accelerator Strings

Tauri/muda accelerator format used for custom MenuItem shortcuts:

| Shortcut | Accelerator String |
|---|---|
| Cmd-N | `"CmdOrCtrl+N"` |
| Cmd-O | `"CmdOrCtrl+O"` |
| Cmd-S | `"CmdOrCtrl+S"` |
| Cmd-Shift-S | `"CmdOrCtrl+Shift+S"` |
| Cmd-Alt-E | `"CmdOrCtrl+Alt+E"` |
| Cmd-I (Import) | `"CmdOrCtrl+I"` |
| Cmd-, | `"CmdOrCtrl+Comma"` |
| Cmd-F | `"CmdOrCtrl+F"` |
| Cmd-Shift-F | `"CmdOrCtrl+Shift+F"` |
| Cmd-1 through 6 | `"CmdOrCtrl+1"` through `"CmdOrCtrl+6"` |
| Cmd-B | `"CmdOrCtrl+B"` |
| Cmd-I (Italic) | Note: conflicts with Import. Italic uses `"CmdOrCtrl+I"` -- Import deferred/disabled. |
| Alt-C | `"Alt+C"` |
| Alt-Q | `"Alt+Q"` |
| Alt-. | `"Alt+."` |
| Alt-O | `"Alt+O"` |
| Alt-X | `"Alt+X"` |
| Alt-/ | `"Alt+/"` |
| Ctrl-Shift-Down | `"Ctrl+Shift+ArrowDown"` |
| Ctrl-Shift-Up | `"Ctrl+Shift+ArrowUp"` |
| Ctrl-F | `"Ctrl+F"` |

**Shortcut conflict resolution:** Cmd-I is used for both Import and Italic in the feature spec. Since Import is disabled in this phase and Italic is also disabled, no conflict exists now. When both are enabled, Import will be reassigned.

---

## Edge Case Coverage Matrix

| EC # | Edge Case | Step | Coverage Strategy |
|---|---|---|---|
| EC-1 | Cmd-S with untitled doc | Step 02 | Frontend saveFile() already handles this (triggers Save As) |
| EC-2 | Cmd-N with unsaved changes | Step 02 | newFile() clears without prompt (dirty-tracking is future work) |
| EC-3 | Cmd-O replaces current content | Step 02 | Existing openFile() already handles this |
| EC-4 | Cmd-W hides window | Step 01 | PredefinedMenuItem::close_window triggers existing hide-on-close |
| EC-5 | Cmd-Q quits app | Step 01 | PredefinedMenuItem::quit handles this natively |
| EC-6 | Disabled item clicked | Step 01 | MenuItem created with enabled=false; Tauri ignores clicks |
| EC-7 | Shortcut for disabled item | Step 01 | Tauri does not fire accelerator for disabled items |
| EC-8 | Menu open while editor focused | Step 02 | Native menu does not interfere with CodeMirror state |
| EC-9 | Rapid Cmd-S presses | Step 02 | Frontend saveFile() is async; sequential writes via atomic swap |
| EC-10 | Undo/Redo via menu | Step 01 | PredefinedMenuItem handles natively; CodeMirror intercepts |

---

## Implementation Checklist

### Step 01: Rust Menu Construction
- [ ] Create `src-tauri/src/menu.rs` with `build_menu()` function
- [ ] Build all 7 menus: App, File, Edit, Format, Theme, Window, Help
- [ ] Use PredefinedMenuItem for native items (About, Quit, Hide, Copy, Paste, etc.)
- [ ] Use MenuItem::with_id for custom items with stable ID strings
- [ ] Set enabled=false for stub items (Export, Import, Find, Format, Theme, Help items, Settings, Updates)
- [ ] Wire accelerator strings for all items with keyboard shortcuts
- [ ] Add `.menu(|handle| build_menu(handle))` to Builder in lib.rs
- [ ] Verify: `cargo check` passes
- [ ] Verify: app launches with native menu bar visible

### Step 02: Event Routing & Frontend Handlers
- [ ] Add `on_menu_event` handler in lib.rs that emits "menu-event" to frontend
- [ ] Match custom item IDs: file-new, file-open, file-save, file-save-as
- [ ] Add `listen("menu-event", ...)` in main.ts
- [ ] Implement `newFile()` function (clear editor, reset currentFilePath, update title)
- [ ] Wire openFile, saveFile, saveFileAs to existing functions
- [ ] Add event-related permissions to capabilities if needed
- [ ] Verify: Cmd-N/O/S/Shift-S all work via menu and keyboard
- [ ] Verify: menu items and toolbar buttons both work (toolbar still present in this step)

### Step 03: Toolbar Removal & Cleanup
- [ ] Remove toolbar HTML from index.html
- [ ] Remove toolbar CSS from styles.css
- [ ] Remove toolbar button event listeners from main.ts
- [ ] Verify: editor fills full height below title bar
- [ ] Verify: all file operations work via menu only
- [ ] Verify: no console errors

### Code Quality
- [ ] No TODO comments in source files
- [ ] All Rust code compiles with `cargo check` (no warnings)
- [ ] All TypeScript code passes `tsc --noEmit` (strict mode)
- [ ] `npm run tauri dev` launches correctly

---

## Handoff Summary

**Requirements source:** `docs/requirements/phase2b_menu_system.md`

**Architecture blueprint:** This file (`docs/specs/phase2b-menu-system/00_index.md`)

**Step files:**
- `step_01_rust_menu_construction.md` -- Build all menus in Rust
- `step_02_event_routing_frontend.md` -- Wire menu events to frontend handlers
- `step_03_toolbar_removal.md` -- Remove old toolbar, clean up

**Next Step:** Activate lead-developer. Start with `step_01`, verify menu appears, then `step_02` for event routing, then `step_03` for cleanup.

---

**Architecture Complete -- Ready for Implementation**
