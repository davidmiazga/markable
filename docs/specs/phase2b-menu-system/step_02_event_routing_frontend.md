# Step 02: Event Routing & Frontend Handlers

**Phase:** 2B -- Native Menu System
**Depends on:** Step 01 (menu bar visible)
**Modifies:** `src-tauri/src/lib.rs`, `src/main.ts`, `src-tauri/capabilities/default.json`

---

## Overview

Wire custom menu item clicks to frontend actions. When the user clicks a custom menu item (or presses its keyboard shortcut), Rust emits a Tauri event that the frontend listens for and dispatches to the appropriate handler.

---

## Task 1: Add `on_menu_event` in lib.rs

After `.menu()` in the Builder chain, add the event handler. Only route the 4 active custom items (file operations). Disabled items won't fire events, but include a catch-all log for debugging.

```rust
use serde_json::json;

// In run(), after .menu():
.on_menu_event(|app_handle, event| {
    let id = event.id().as_ref();
    match id {
        "file-new" | "file-open" | "file-save" | "file-save-as" => {
            let _ = app_handle.emit("menu-event", json!({ "action": id }));
        }
        _ => {
            // Future menu items -- log for debugging
            #[cfg(debug_assertions)]
            eprintln!("Unhandled menu event: {}", id);
        }
    }
})
```

**Placement in Builder chain:** `.on_menu_event()` must be called after `.menu()` and before `.build()`.

---

## Task 2: Add Event Listener in main.ts

Import the `listen` function from Tauri's event API and set up a listener in `initApp()`.

```typescript
import { listen } from "@tauri-apps/api/event";

// Inside initApp(), after editor setup:
await listen<{ action: string }>("menu-event", (event) => {
  const action = event.payload.action;
  switch (action) {
    case "file-new":
      newFile();
      break;
    case "file-open":
      openFile();
      break;
    case "file-save":
      saveFile();
      break;
    case "file-save-as":
      saveFileAs();
      break;
    default:
      console.log(`Unhandled menu action: ${action}`);
  }
});
```

---

## Task 3: Implement `newFile()` Function

Add a new function in main.ts that resets the editor to a blank state:

```typescript
function newFile() {
  if (editor) {
    const transaction = editor.state.update({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: "",
      },
    });
    editor.dispatch(transaction);
  }

  currentFilePath = null;
  updateTitleBar();
  console.log("New file created");
}
```

---

## Task 4: Update Capabilities (if needed)

The `emit` function from Rust to frontend may require event permissions. Check if `core:event:allow-emit` is needed in `capabilities/default.json`. If the events don't arrive at the frontend, add:

```json
"core:event:allow-emit",
"core:event:allow-listen"
```

Note: `core:default` may already include event permissions. Test first, add only if needed.

---

## Acceptance Criteria

- [ ] Cmd-N clears editor content and resets title to "Untitled"
- [ ] Cmd-O opens file dialog and loads selected file
- [ ] Cmd-S saves current file (or triggers Save As if untitled)
- [ ] Cmd-Shift-S opens Save As dialog
- [ ] All 4 shortcuts work via both menu click and keyboard
- [ ] Menu actions and toolbar buttons both work (toolbar still present)
- [ ] No console errors when menu items are used
- [ ] Disabled menu items (Export, Find, Format) produce no errors when clicked
- [ ] Editor content and cursor position are preserved when menu is opened/closed

---

## Troubleshooting

**Events not arriving at frontend**: Check capabilities. Add `"core:event:allow-emit"` and `"core:event:allow-listen"` to `default.json`.

**"Cannot find module @tauri-apps/api/event"**: This module should already be available from the `@tauri-apps/api` package installed in Phase 1.

**Cmd-N doesn't work**: Ensure `newFile()` is defined before the `listen` callback references it (or use a named function reference).
