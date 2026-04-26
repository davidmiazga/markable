---
title: "Step 04 — Integration Points"
last-updated: "2026-04-20"
review-cadence-days: 14
status: active
---

# Step 04 — Integration Points

## Goal

Wire the plugin into the four external integration points: `handleAction`, Edit menu, COMMANDS array, and build script. After this step the plugin is fully discoverable via the Command Bar, triggerable via the keyboard shortcut, and visible in the Edit menu.

---

## 1. handleAction Case — `src/main.ts`

### Location

Find the `command-bar-open` case in `handleAction` (around line 545). Add the new case immediately after the block for `"edit-select-none"` or at the end of the Edit group. Exact placement: after the `"edit-delete-line"` case.

### Code to Add

```typescript
// "edit-insert-count" (Cmd-Shift-3): open the Insert Count dialog.
// Delegates to the Insert Count plugin via window global (same pattern as command-bar-open).
// If the plugin is disabled, __MARKABLE_INSERT_COUNT_OPEN__ is null → show alert (EC-02, FR-08.2).
case "edit-insert-count": {
  const openIC = (window as any).__MARKABLE_INSERT_COUNT_OPEN__;
  if (typeof openIC === "function") {
    openIC();
  } else {
    alert("Enable the Insert Count plugin in Markable > Plugins to use this feature.");
  }
  break;
}
```

### Rationale

This mirrors the `"file-new-from-template"` / `"file-save-as-template"` pattern verbatim (lines 569–588 in `main.ts`). The alert string matches FR-08.2 exactly.

---

## 2. COMMANDS Array Entry — `src/keybindings/keybindings-panel.ts`

### Location

In the `COMMANDS` array, under the `// Edit` section (around line 49). Add after the existing `"edit-goto-line"` entry so Edit commands are grouped together.

### Code to Add

```typescript
{ id: "edit-insert-count", label: "Insert Count", defaultKey: "Cmd-Shift-3", section: "Edit" },
```

### Notes

- `Cmd-Shift-3` was verified free: no existing COMMANDS entry uses this key (searched `keybindings-panel.ts`). The `tab-3` entry uses `Cmd-3` (without Shift) — no conflict.
- The Command Bar's category A builder reads directly from `window.__MARKABLE_COMMANDS__` (which is set to the COMMANDS array in `initApp`). No additional Command Bar work is needed (FR-07.2).
- The Keybindings Panel will display this entry automatically once it is in COMMANDS.

---

## 3. Edit Menu Item — `src-tauri/src/menu.rs`

### Location

In the `edit_menu` Submenu::with_items call (around line 65), after the `"edit-find-replace"` item at the bottom of the list. Add a separator then the new item.

### Code to Add

```rust
&PredefinedMenuItem::separator(handle)?,
&MenuItem::with_id(handle, "edit-insert-count", "Insert Count...", true, Some("CmdOrCtrl+Shift+3"))?,
```

### Notes

- Tauri v2 accelerator format uses `CmdOrCtrl` (not `Cmd`). This maps to `Cmd` on macOS and `Ctrl` on Windows/Linux. For Markable (macOS-only at this stage), the user sees `⌘⇧3` in the menu.
- The ellipsis `...` in the label signals that the action opens a dialog (standard macOS HIG convention).
- The item is always enabled (`true` fourth argument). The `handleAction` case handles the disabled-plugin fallback in JS (FR-08.2).

---

## 4. Build Script Entry — `scripts/build-plugins.mjs`

### Location

In the `PLUGINS` array (after the existing `"diagrams"` entry). Add at the end of the list.

### Code to Add

```javascript
["insert-count", "src/plugins/insert-count/insert-count.plugin.ts"],
```

### Full Context

The array tail will look like:

```javascript
  ["diagrams",      "src/plugins/diagrams/diagrams.plugin.ts", { inlineDynamicImports: true }],
  ["insert-count",  "src/plugins/insert-count/insert-count.plugin.ts"],
```

### Notes

- No `inlineDynamicImports: true` needed — Insert Count does not bundle any library with internal dynamic imports.
- The first entry in PLUGINS triggers `clearOutputDir()`, so ordering does not affect this entry.
- After building, `src-tauri/plugins/core/insert-count.js` will exist and Tauri's `bundle.resources` glob `"plugins/core/*"` picks it up automatically.

---

## 5. Stale Plugin Cleanup — `src-tauri/src/commands/plugins.rs`

No change required. The `copy_core_plugins` Rust command already removes all `.js` files not present in the bundle. Once `insert-count.js` is built and present, it is included; if it is absent (older build), it is not copied. No stale file issue.

---

## Edge Cases Addressed

| EC | How |
|---|---|
| EC-01 | `openDialog()` checks `window.__MARKABLE_EDITOR_VIEW__`; no editor → silent no-op. `handleAction` reaches the function regardless. |
| EC-02 | `__MARKABLE_INSERT_COUNT_OPEN__` is null when plugin is off → `handleAction` shows alert (FR-08.2) |

---

## Acceptance Criteria

- `handleAction("edit-insert-count")` with plugin enabled calls `openDialog()`.
- `handleAction("edit-insert-count")` with plugin disabled shows alert with correct message.
- COMMANDS array contains `{ id: "edit-insert-count", label: "Insert Count", defaultKey: "Cmd-Shift-3", section: "Edit" }`.
- Command Bar search for "Insert Count" returns the command.
- Keybindings Panel shows "Insert Count" entry under Edit section with `Cmd-Shift-3`.
- Edit menu contains "Insert Count..." item with `Cmd-Shift-3` accelerator.
- `npm run build:plugins` produces `src-tauri/plugins/core/insert-count.js` without error.
- `Cmd-Shift-3` keydown triggers the dialog when no other field has focus.
