# Step 03 — Close All (Cmd-Shift-W)

**Requirements:** `docs/requirements/active_task.md` §2 Feature 3, §3 EC-C1–C4, §4 AC-C1–C4
**Files modified:**
- `src-tauri/src/menu.rs`
- `src-tauri/src/lib.rs`
- `src/main.ts`

---

## 1. Overview

A single new menu item in the File menu emitting `"file-close-all"`. The
frontend handler calls `getCurrentWebviewWindow().hide()`, matching the
existing hide-on-close behavior implemented in `lib.rs`
`on_window_event(CloseRequested)`. In the current single-window architecture
the observable result is identical to Cmd-W.

---

## 2. `src-tauri/src/menu.rs`

### 2a. File menu — Close All item

The File menu currently ends with:

```rust
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, Some("Close"))?,
        ],
    )?;
```

Replace that closing block with:

```rust
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, Some("Close"))?,
            &MenuItem::with_id(handle, "file-close-all", "Close All", true, Some("CmdOrCtrl+Shift+W"))?,
        ],
    )?;
```

"Close All" appears immediately below "Close" in the native File menu with the
`Cmd-Shift-W` accelerator shown in the menu bar.

---

## 3. `src-tauri/src/lib.rs`

### 3a. `on_menu_event` forwarding match arm

The current explicit match list is:

```rust
                "app-settings"
                | "file-new" | "file-open" | "file-save" | "file-save-as" | "file-export"
                | "view-toggle-preview"
                | "view-zoom-in" | "view-zoom-out" | "view-zoom-reset"
                | "theme-next" | "theme-prev"
                | "theme-light" | "theme-dark" | "theme-system" => true,
```

Add `"file-close-all"` to the `file-*` group:

```rust
                "app-settings"
                | "file-new" | "file-open" | "file-save" | "file-save-as" | "file-export"
                | "file-close-all"
                | "view-toggle-preview"
                | "view-zoom-in" | "view-zoom-out" | "view-zoom-reset"
                | "theme-next" | "theme-prev"
                | "theme-light" | "theme-dark" | "theme-system" => true,
```

No other changes to `lib.rs` are required. The existing show-then-emit logic
in `on_menu_event` will run for `"file-close-all"` exactly as it does for all
other forwarded IDs — showing the window if hidden, then emitting the event.
Showing then immediately hiding is correct: the webview must be visible to
receive the event, and the frontend handler immediately re-hides it.

---

## 4. `src/main.ts`

### 4a. `menu-event` switch case

Add the new case after `case "file-save-as":` and before `case "file-export":`:

```typescript
      case "file-close-all":
        void getCurrentWebviewWindow().hide();
        break;
```

`getCurrentWebviewWindow` is already imported at the top of `main.ts`:

```typescript
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
```

No additional import is needed.

The `void` prefix follows the same pattern used for `file-export` above it —
`hide()` returns a `Promise<void>` and we intentionally do not await it in the
synchronous event listener.

---

## 5. Edge Case Analysis

### EC-C1 — Unsaved changes

No change needed. The existing `on_window_event(CloseRequested)` handler in
`lib.rs` also hides without a prompt. This feature matches that behavior
exactly.

### EC-C2 — Window already hidden

Tauri v2 `WebviewWindow.hide()` is safe to call on an already-hidden window —
it is a no-op per the Tauri v2 API documentation (returns `Ok(())` without
error). No `isVisible()` guard is required.

If a future Tauri version changes this contract, the guard can be added as:

```typescript
const win = getCurrentWebviewWindow();
if (await win.isVisible()) await win.hide();
```

For this task the simple `void win.hide()` form is correct and sufficient.

### EC-C3 — Event arrives before listener registered

All menu events are dropped if the `listen("menu-event", ...)` listener has not
yet been registered by `initApp()`. This is identical behavior to every other
menu item in the application (e.g., `file-new`, `file-open`) and is
architecturally acceptable.

### EC-C4 — Re-open after Close All

The existing `RunEvent::Resumed` handler in `lib.rs` already shows and focuses
the main window when the dock icon is clicked:

```rust
        if let tauri::RunEvent::Resumed = event {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
```

No additional code is required. EC-C4 is fully covered by existing
infrastructure.

---

## 6. Acceptance Criteria Traceability

| AC | Satisfied by |
|----|-------------|
| AC-C1 | `void getCurrentWebviewWindow().hide()` in the menu-event case |
| AC-C2 | `MenuItem` with `CmdOrCtrl+Shift+W` accelerator in File menu after "Close" |
| AC-C3 | Shared `"file-close-all"` event action used by both keyboard shortcut (via menu) and menu click |
| AC-C4 | `RunEvent::Resumed` handler in `lib.rs` (existing, no change needed) |
