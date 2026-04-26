---
title: "Step 05 — Keyboard Shortcuts"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 05 — Keyboard Shortcuts

## Goal

Register `sidebar.toggleLeft` and `sidebar.toggleRight` as named commands in the keybindings system so they appear in the Keyboard Shortcuts panel and are user-customisable.

**Conflict audit result (from `src/editor/format.ts` lines 675–676):**
- `Cmd-[` is bound to `outdentLines` (`Meta-[`). **Conflict.**
- `Cmd-]` is bound to `indentLines` (`Meta-]`). **Conflict.**
- `Cmd-Shift-[` — confirmed free in `format.ts` and `keybindings-panel.ts`. **Use this.**
- `Cmd-Shift-]` — confirmed free. **Use this.**

**Dependencies:** step_04 (sidebar module imported in main.ts, `handleAction` wired).

---

## Files Changed

| File | Action |
|---|---|
| `src/keybindings/keybindings-panel.ts` | Add two entries to the `COMMANDS` array |

---

## Exact Change

In `src/keybindings/keybindings-panel.ts`, the `COMMANDS` array has a "View" section (lines 36–43 in the current file). Add two new entries at the end of the View section, after `view-toggle-typewriter`:

```typescript
  { id: "sidebar.toggleLeft",  label: "Toggle Left Sidebar",  defaultKey: "Cmd-Shift-[", section: "View" },
  { id: "sidebar.toggleRight", label: "Toggle Right Sidebar", defaultKey: "Cmd-Shift-]", section: "View" },
```

No other changes are needed in `keybindings-panel.ts`. The existing keydown dispatch loop in `main.ts` uses `eventMatchesKey` against all COMMANDS entries, and `handleAction(id)` was wired in step_04 to dispatch `sidebar.toggleLeft` and `sidebar.toggleRight` to `toggleSidebarSide()`.

---

## How the Keybinding System Works (for context)

The Markable keybinding system (from `keybindings-panel.ts` architecture notes in MEMORY.md) works as follows:

1. `COMMANDS` defines the command registry with `id`, `label`, `defaultKey`, and `section`.
2. The keybindings panel allows users to override any `defaultKey` with a custom key string. Overrides are stored in `settings.keybindings[commandId]`.
3. In `main.ts`, a `document.addEventListener("keydown", ...)` handler checks each pressed key against custom bindings (checked first) then default bindings using `eventMatchesKey`. When matched, it calls `handleAction(commandId)`.
4. `handleAction` is the central dispatch switch — it was updated in step_04 to handle `sidebar.toggleLeft` and `sidebar.toggleRight`.

The sidebar shortcuts participate in this system identically to all other commands. No special handling is required.

---

## Acceptance Criteria

1. Opening the Keyboard Shortcuts panel (Cmd-Opt-Shift-K) shows "Toggle Left Sidebar" and "Toggle Right Sidebar" in the View section with default keys `Cmd-Shift-[` and `Cmd-Shift-]`.
2. Pressing `Cmd-Shift-]` when at least one panel is registered on the right side toggles `#sidebar-right` visibility.
3. Pressing `Cmd-Shift-]` when no panels are registered is a no-op (no error, no DOM mutation).
4. Customising the shortcut in the panel (e.g. changing `Cmd-Shift-]` to `Cmd-Shift-T`) and pressing the new shortcut triggers the toggle correctly.
5. Conflict detection (⚠) in the keybindings panel fires if the user tries to assign `Cmd-Shift-[` or `Cmd-Shift-]` to another command — this is handled automatically by the existing conflict detection logic.
6. `Cmd-[` and `Cmd-]` continue to function as `outdentLines` / `indentLines` in the editor — no regression.
