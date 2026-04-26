---
title: "step_01 — menu.rs label rename"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# step_01 — Rename "Export as HTML..." to "Export..." in menu.rs

**Depends on**: nothing (first step, isolated)
**Blocks**: nothing (label is cosmetic; TypeScript steps are independent)

---

## What to change

**File**: `src-tauri/src/menu.rs`

### Current state (line 52)

```rust
&MenuItem::with_id(handle, "file-export", "Export as HTML...", true, Some("CmdOrCtrl+Alt+E"))?,
```

### Target state

```rust
&MenuItem::with_id(handle, "file-export", "Export...", true, Some("CmdOrCtrl+Alt+E"))?,
```

The item ID (`"file-export"`) and accelerator (`"CmdOrCtrl+Alt+E"`) are
unchanged. Only the display string changes.

---

## Verification

The `file-print` item on the line immediately below must remain untouched:

```rust
&MenuItem::with_id(handle, "file-print", "Print...", true, Some("CmdOrCtrl+P"))?,
```

---

## Acceptance criteria

- [ ] `cargo tauri build` (or `npm run tauri dev`) compiles without errors.
- [ ] The File menu shows "Export..." with shortcut `Cmd-Alt-E`.
- [ ] The File menu still shows "Print..." with shortcut `Cmd-P`.
- [ ] Clicking "Export..." fires the `file-export` menu event (confirmed by
      existing handler; can verify by checking the existing HTML-export flow
      still works before step_03 replaces the handler).

---

## Gotchas

- This is a Rust compilation step. If the dev server is running, a full restart
  (`npm run tauri dev` restart, not just a hot-reload) is required to pick up
  Rust changes.
- No Rust tests needed — the change is a string literal, not logic.
