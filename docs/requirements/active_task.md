---
title: "Command Bar Entry Points for Apply View / Apply Layout"
last-updated: "2026-05-20"
review-cadence-days: 7
status: active
---

# Command Bar Entry Points for Apply View / Apply Layout

## Summary

Two new Command Bar entries — **Apply View** and **Apply Layout** — that open
the existing assign modal for the currently active file. Both entries call the
same function that the file-browser right-click menu and the right-side icon
already use. No new behavior, no signature changes — just two new entry points
to an existing flow.

---

## Knowns

### What exists today

- `openAssignModal(filePath, deps)` in `src/lib/assign-modal.ts` shows the
  unified View / Layout assignment modal.
- It is invoked from two places today: the file-browser right-click context
  menu, and the right-side icon. Both go through the window global
  `window.__MARKABLE_OPEN_ASSIGN_MODAL__(path)` set in `src/main.ts` (around
  line 1247).
- `window.__MARKABLE_CURRENT_FILE__` holds the path of the active file (set by
  `main.ts` on tab activation).
- `REQUIRES_FILE_IDS` in `src/plugins/command-bar/command-bar.plugin.ts`
  (around line 192) drives "dim when no file open" behavior.
- `COMMANDS: CommandDef[]` in `src/keybindings/keybindings-panel.ts` (around
  line 16) holds command-bar entries.
- `handleAction()` in `src/main.ts` (around line 575) is the central switch.
- Per CLAUDE.md: changes to `src/plugins/**/*.ts` require
  `npm run build:plugins && npm run sync:plugins`.

### Decisions locked

1. **Two entries, identical behavior.** Both `apply-view` and `apply-layout`
   call the same existing modal trigger. The two labels exist purely for
   discoverability in the command bar — typing "view" or "layout" both find
   the right entry.
2. **Reuse `window.__MARKABLE_OPEN_ASSIGN_MODAL__`.** No signature changes
   to `openAssignModal`. No new options. No section focus. The commands
   call the same function the right-click already calls.
3. **Dim when no usable file.** Both ids appear in `REQUIRES_FILE_IDS` so
   they dim when `__MARKABLE_CURRENT_FILE__` is null.
4. **No default keybinding.** Both ship with `defaultKey: ""`.
5. **Section in keybindings panel:** `"View"`.

---

## Proposed Constraints

- **C-1 (Two `COMMANDS` entries).** Add to `keybindings-panel.ts` `COMMANDS`:
  - `{ id: "apply-view", label: "Apply View", section: "View", defaultKey: "" }`
  - `{ id: "apply-layout", label: "Apply Layout", section: "View", defaultKey: "" }`

- **C-2 (Two identical `handleAction` cases).** Add cases in `main.ts`
  `handleAction()` for `"apply-view"` and `"apply-layout"`. Both read
  `window.__MARKABLE_CURRENT_FILE__` and invoke
  `window.__MARKABLE_OPEN_ASSIGN_MODAL__(path)` if set. No path → no-op.

- **C-3 (`REQUIRES_FILE_IDS` membership).** Both ids added to the set in
  `command-bar.plugin.ts`. Existing dimming logic (checks
  `__MARKABLE_CURRENT_FILE__` for null) is sufficient — no extension needed.

- **C-4 (Plugin rebuild is mandatory).** After editing
  `command-bar.plugin.ts`, run `npm run build:plugins && npm run sync:plugins`
  per the CLAUDE.md plugin-build rule.

---

## Files That Change

| File | Nature of change |
|---|---|
| `src/keybindings/keybindings-panel.ts` | Add two `CommandDef` entries (C-1) |
| `src/main.ts` | Add two cases to `handleAction` switch; both invoke `__MARKABLE_OPEN_ASSIGN_MODAL__` (C-2) |
| `src/plugins/command-bar/command-bar.plugin.ts` | Add both ids to `REQUIRES_FILE_IDS` (C-3); requires rebuild (C-4) |

## Files That Do NOT Change

| File | Reason |
|---|---|
| `src/lib/assign-modal.ts` | No signature change; the existing function is reused as-is |
| `window.__MARKABLE_OPEN_ASSIGN_MODAL__` at `main.ts:1247` | Used as-is, no modification |
| File-browser right-click context menu | Existing entry point unchanged |
| Frontmatter mechanics (`view:` / `layout:`) | Out of scope |

---

## Edge Case Inventory

**EC-1 — Active tab is a saved `.md` file.**
Expected: both commands open the existing modal for that file. Behavior is
identical to right-clicking the file in the browser.

**EC-2 — Active tab is untitled (no path on disk).**
Expected: both commands are dimmed. `__MARKABLE_CURRENT_FILE__` is null;
existing `REQUIRES_FILE_IDS` dimming handles this.

**EC-3 — Active tab is `_folder.md` or `view-*.md`.**
Expected: both commands open the modal. Existing modal behavior (graying the
Layouts section for these file kinds) applies as-is.

**EC-4 — Modal is already open.**
Expected: `OVERLAY_ID` guard inside `openAssignModal` prevents double-open.
The second invocation is a no-op.

**EC-5 — Command Bar plugin is disabled.**
Expected: neither command surfaces in the bar. Keybindings panel entries
have no command-bar UI to attach to but still appear in the keybindings
panel so users can assign a hotkey.

**EC-6 — Plugin rebuild forgotten.**
Expected: commands appear in the bar (because `keybindings-panel.ts` is
not the plugin) but `REQUIRES_FILE_IDS` is stale, so dimming is wrong.
Lead developer must verify `npm run build:plugins && npm run sync:plugins`
ran after editing `command-bar.plugin.ts`.

---

## Out of Scope

- Any change to `openAssignModal` (signature, behavior, focus, scrolling)
- Section-specific scroll or focus in the modal
- Default keybindings
- Changes to the file-browser right-click menu or the right-side icon
- Frontmatter mechanics

---

## Handoff Summary
- Artifact: docs/requirements/active_task.md
- Status: Requirements Validated
- Edge cases to verify: 6 items
