---
title: "Step 02 — Menu Integration and handleAction Wiring"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Step 02: Menu Integration and handleAction Wiring

**Goal**: Add native menu items for "New from Template" and "Save as Template", forward their events to the frontend, and wire the `handleAction()` dispatcher.

## Requirement Traceability

- FR-7.1: "New from Template..." menu item (Cmd-Shift-N)
- FR-7.2: "Save as Template..." menu item (no shortcut)
- FR-7.3: Both dispatched via handleAction()
- FR-7.4: Plugin-disabled guard
- EC-9: Plugin disabled when menu action triggered

## 1. Menu Items

**File**: `src-tauri/src/menu.rs`

### "New from Template..."

Insert after the `"file-new"` MenuItem and before the `"file-open"` MenuItem in the `file_menu` Submenu:

```rust
&MenuItem::with_id(handle, "file-new-from-template", "New from Template...", true, Some("CmdOrCtrl+Shift+N"))?,
```

The File menu order becomes:
1. New (Cmd-N)
2. **New from Template... (Cmd-Shift-N)** -- NEW
3. Open... (Cmd-O)
4. Open Recent >
5. ---separator---
6. Save (Cmd-S)
7. Save As... (Cmd-Shift-S)
8. **Save as Template...** -- NEW
9. ---separator---
10. Export as HTML...
11. ...rest unchanged

### "Save as Template..."

Insert after the `"file-save-as"` MenuItem and before the separator that precedes Export:

```rust
&MenuItem::with_id(handle, "file-save-as-template", "Save as Template...", true, None::<&str>)?,
```

No keyboard shortcut -- accessed via menu only (FR-7.2).

## 2. Menu Event Forwarding

**File**: `src-tauri/src/lib.rs`

In the `on_menu_event` closure, add the two new action IDs to the pipe-separated match arm that starts with `"file-new" | "file-open" | ...`:

```rust
| "file-new-from-template" | "file-save-as-template"
```

Add these to the existing line that lists `file-*` actions so they are forwarded as `menu-event` payloads to the frontend.

## 3. handleAction Dispatcher

**File**: `src/main.ts`

Add two new cases in the `handleAction()` switch statement. Place them after the `case "file-new":` block and before the tab operations section:

```typescript
// "file-new-from-template" (Cmd-Shift-N): open the template picker.
// Delegates to the Templates plugin via window global (AD-1, FR-7.3).
case "file-new-from-template": {
  const templates = (window as any).__MARKABLE_TEMPLATES__;
  if (templates && typeof templates.openPicker === "function") {
    templates.openPicker();
  } else {
    alert("Enable the Templates plugin in Markable > Plugins to use this feature.");
  }
  break;
}

// "file-save-as-template": save current doc as a template file.
// Delegates to the Templates plugin via window global (AD-1, FR-7.3).
case "file-save-as-template": {
  const templates = (window as any).__MARKABLE_TEMPLATES__;
  if (templates && typeof templates.saveAsTemplate === "function") {
    templates.saveAsTemplate();
  } else {
    alert("Enable the Templates plugin in Markable > Plugins to use this feature.");
  }
  break;
}
```

**Design note**: The `__MARKABLE_TEMPLATES__` check pattern matches how `handleAction` already interacts with other globals like `__MARKABLE_TAB_MANAGER__`. The plugin sets the global in `onEnable` and removes it in `onDisable`, so the existence check doubles as the "plugin enabled" guard (EC-9, FR-7.4).

## Verification

After this step:
- The File menu shows "New from Template..." between "New" and "Open...".
- The File menu shows "Save as Template..." after "Save As...".
- Pressing Cmd-Shift-N triggers `handleAction("file-new-from-template")`.
- Both actions show the "Enable the Templates plugin" alert (the plugin is not yet built).
- `cargo test` still passes (no Rust logic changes beyond forwarding).

## Files Changed

| File | Change |
|---|---|
| `src-tauri/src/menu.rs` | Add 2 MenuItem entries to file_menu |
| `src-tauri/src/lib.rs` | Add 2 action IDs to menu event forwarding match |
| `src/main.ts` | Add 2 cases to handleAction() switch |
