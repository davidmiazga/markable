---
title: "Step 2: Keybindings + Menu Integration"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 2: Keybindings + Menu Integration

## Goal

Register three new CM6 keybindings (Alt-r, Alt-n, Alt-l) in `formatKeymap` and add four native menu items under Format > List > List Style. Wire the menu event handler in `main.ts`.

## Changes to `src/editor/format.ts`

### Import

Add at the top of the file:

```typescript
import { switchToAlphanumeric, switchToDecimal, switchToSteps, switchToStandard } from "./list-style-switch";
```

### Keymap Entries

Add three entries to the `formatKeymap` array (after the existing list-related entries at approximately line 673-674, after `format-task-list`):

```typescript
// List style switching (Alt = Option on macOS)
{ key: "Alt-r", run: switchToAlphanumeric },
{ key: "Alt-n", run: switchToDecimal },
{ key: "Alt-l", run: switchToSteps },
```

Notes:
- No `mac:` variant needed -- `Alt` maps to the Option key on macOS in CM6.
- The handlers return `boolean` (true = handled, false = fall through), which matches the CM6 `KeyBinding.run` signature.
- `switchToStandard` has no keybinding (FR-1.2) but is used by the menu handler.

## Changes to `src-tauri/src/menu.rs`

### Add List Style Submenu

Inside the existing `format-list-submenu` (currently lines 138-148), add a separator and a nested submenu after the "Task List" item:

```rust
&PredefinedMenuItem::separator(handle)?,
&Submenu::with_id_and_items(
    handle,
    "format-list-style-submenu",
    "List Style",
    true,
    &[
        &MenuItem::with_id(handle, "format-list-style-standard", "Standard", true, None::<&str>)?,
        &MenuItem::with_id(handle, "format-list-style-alphanumeric", "Alphanumeric (I. A. 1. a. i.)", true, Some("Alt+R"))?,
        &MenuItem::with_id(handle, "format-list-style-decimal", "Decimal Outline (1.1.)", true, Some("Alt+N"))?,
        &MenuItem::with_id(handle, "format-list-style-steps", "Steps (1. a. -)", true, Some("Alt+L"))?,
    ],
)?,
```

Menu IDs:
- `format-list-style-standard` -- no accelerator (set via Settings or comment override)
- `format-list-style-alphanumeric` -- accelerator `Alt+R`
- `format-list-style-decimal` -- accelerator `Alt+N`
- `format-list-style-steps` -- accelerator `Alt+L`

## Changes to `src/main.ts`

### Import

Add to the existing format imports:

```typescript
import { switchListStyle } from "./editor/list-style-switch";
```

### handleAction Cases

Add four cases in the `handleAction` switch, in the format section (after `format-task-list`):

```typescript
case "format-list-style-standard":
  if (editor) switchListStyle(editor, "standard");
  break;
case "format-list-style-alphanumeric":
  if (editor) switchListStyle(editor, "alphanumeric");
  break;
case "format-list-style-decimal":
  if (editor) switchListStyle(editor, "decimal");
  break;
case "format-list-style-steps":
  if (editor) switchListStyle(editor, "steps");
  break;
```

Note: `switchListStyle` returns boolean but we do not need to act on it here -- if the cursor is not on a list line, it silently returns false (FR-2.3).

## Edge Cases Addressed

- **EC-1**: The keybinding handlers (`switchToAlphanumeric`, etc.) return `false` when not on a list line, allowing CM6 to fall through to default key handling.
- **EC-10**: The menu handler calls the same `switchListStyle` that uses a single transaction, so Cmd-Z undoes the entire rewrite.

## Acceptance Criteria

1. Pressing `Option-R` on a list line converts the block to alphanumeric style.
2. Pressing `Option-N` on a list line converts the block to decimal outline style.
3. Pressing `Option-L` on a list line converts the block to steps style.
4. Pressing any of the above on a non-list line has no effect (key falls through).
5. Format > List > List Style > Standard converts the block to standard style.
6. Format > List > List Style > Alphanumeric shows `Alt+R` accelerator and works.
7. Format > List > List Style > Decimal Outline shows `Alt+N` accelerator and works.
8. Format > List > List Style > Steps shows `Alt+L` accelerator and works.
9. `list-keybindings.ts` is NOT modified.
10. `list-engine.ts` is NOT modified.
11. All existing tests pass.
