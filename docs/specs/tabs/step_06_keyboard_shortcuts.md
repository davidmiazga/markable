---
title: "Tabs Step 06 — Keyboard Shortcuts"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 06 — Keyboard Shortcuts

**Goal:** Add all tab keyboard shortcuts to the `COMMANDS` list and `handleAction()`. After this step, `Cmd-T`, `Cmd-W`, `Cmd-N` (tab-aware), and `Cmd-1` through `Cmd-9` are all functional.

**App state after this step:** All keyboard shortcuts are live. Cmd-N no longer creates a single-document blank file — it opens a new tab. Cmd-W closes the active tab.

---

## Modify: `src/keybindings/keybindings-panel.ts`

### Add new commands to the `COMMANDS` array

Insert in the "File" section, after `file-new`:

```typescript
// Tabs — in "File" section
{ id: "tab-new",    label: "New Tab",            defaultKey: "Cmd-T",  section: "File" },
{ id: "tab-close",  label: "Close Tab",          defaultKey: "Cmd-W",  section: "File" },
{ id: "tab-1",      label: "Switch to Tab 1",    defaultKey: "Cmd-1",  section: "File" },
{ id: "tab-2",      label: "Switch to Tab 2",    defaultKey: "Cmd-2",  section: "File" },
{ id: "tab-3",      label: "Switch to Tab 3",    defaultKey: "Cmd-3",  section: "File" },
{ id: "tab-4",      label: "Switch to Tab 4",    defaultKey: "Cmd-4",  section: "File" },
{ id: "tab-5",      label: "Switch to Tab 5",    defaultKey: "Cmd-5",  section: "File" },
{ id: "tab-6",      label: "Switch to Tab 6",    defaultKey: "Cmd-6",  section: "File" },
{ id: "tab-7",      label: "Switch to Tab 7",    defaultKey: "Cmd-7",  section: "File" },
{ id: "tab-8",      label: "Switch to Tab 8",    defaultKey: "Cmd-8",  section: "File" },
{ id: "tab-9",      label: "Switch to Last Tab", defaultKey: "Cmd-9",  section: "File" },
```

### Modify `file-new` default key

The existing `file-new` command maps to `Cmd-N`:
```typescript
{ id: "file-new", label: "New", defaultKey: "Cmd-N", section: "File" },
```

Per AD-7 (OD-2 resolved): `Cmd-N` and `Cmd-T` are both "open new blank tab". The `file-new` action is **not removed or suppressed** — instead, `handleAction("file-new")` is redirected to call `tabManager.openNewTab()` in step_07. This means `file-new` and `tab-new` produce identical behavior. Both remain in the `COMMANDS` list so users can see and remap both shortcuts in the Keybindings panel.

**No change to `file-new`'s `defaultKey`**. The conflict is intentional and acceptable — the Keybindings panel will show a conflict indicator for `Cmd-N` vs `Cmd-T` only if `file-new` is remapped away from `Cmd-N`. In the default state, `file-new` = `Cmd-N` and `tab-new` = `Cmd-T` — no conflict.

---

## Modify: `src/main.ts`

### Import `tabManager`

Already imported in step_02. No change.

### Update `handleAction()` — add tab cases

Add the following `case` branches to the `switch` statement in `handleAction()`:

```typescript
// Tab operations
case "tab-new":
  tabManager.openNewTab();
  break;

case "tab-close":
  void (async () => {
    const tab = tabManager.getActiveTab();
    if (tab) await tabManager.closeTab(tab.id);
  })();
  break;

case "tab-1":  tabManager.activateTabByIndex(1); break;
case "tab-2":  tabManager.activateTabByIndex(2); break;
case "tab-3":  tabManager.activateTabByIndex(3); break;
case "tab-4":  tabManager.activateTabByIndex(4); break;
case "tab-5":  tabManager.activateTabByIndex(5); break;
case "tab-6":  tabManager.activateTabByIndex(6); break;
case "tab-7":  tabManager.activateTabByIndex(7); break;
case "tab-8":  tabManager.activateTabByIndex(8); break;
case "tab-9":  tabManager.activateTabByIndex(9); break;
```

### Redirect `file-new` to `tabManager.openNewTab()`

**In step_07** the `newFile()` function is fully replaced. For this step only: redirect `file-new` case to use TabManager:

```typescript
case "file-new":
  tabManager.openNewTab();
  break;
```

This satisfies AD-7 (Cmd-N ≡ Cmd-T) by making both `file-new` and `tab-new` call the same method.

**The old `newFile()` function in `main.ts` is NOT deleted in step_06** — it is still used by `file-close-all`. That function is removed in step_07.

---

## Conflict Analysis

With the new COMMANDS:

| Shortcut | Command IDs using it | Resolution |
|---|---|---|
| Cmd-N | `file-new` (default) | Redirected to `tabManager.openNewTab()` in handleAction |
| Cmd-T | `tab-new` (default) | Calls `tabManager.openNewTab()` |
| Cmd-W | `tab-close` (default) | Calls `tabManager.closeTab()` |
| Cmd-1..8 | `tab-1` through `tab-8` | No existing conflict (Cmd-1 was unused, Cmd-0 is zoom-reset) |
| Cmd-9 | `tab-9` | No conflict |

**Note:** `Cmd-W` was previously a macOS system shortcut (not in the COMMANDS list). Adding it explicitly means users can see it in the Keybindings panel and override it. This is intentional.

**Important:** `Cmd-1` through `Cmd-8` must NOT conflict with `format-ordered-list` (`Cmd-Shift-1`). They are distinct because the Shift key differs. No conflict.

---

## Tests to Write (`tests/tabs/keyboard-shortcuts.test.ts`)

These are integration tests simulating `handleAction` calls.

| Test | Covers |
|---|---|
| `handleAction("tab-new")` calls `tabManager.openNewTab()` | FR-5.1 |
| `handleAction("file-new")` calls `tabManager.openNewTab()` | AD-7, EC-19 |
| `handleAction("tab-close")` calls `tabManager.closeTab(activeId)` | FR-5.2 |
| `handleAction("tab-1")` calls `tabManager.activateTabByIndex(1)` | FR-5.3 |
| `handleAction("tab-9")` calls `tabManager.activateTabByIndex(9)` | FR-5.3 |
| `resolveAction` on Cmd-T event returns `"tab-new"` | FR-8 |
| `resolveAction` on Cmd-W event returns `"tab-close"` | FR-8 |
| `resolveAction` on Cmd-9 event returns `"tab-9"` | FR-8 |

---

## Verification

After implementing step_06:
1. Press `Cmd-T` — new untitled tab opens (visible in the tab strip).
2. Press `Cmd-N` — same result as Cmd-T.
3. Press `Cmd-W` — if two tabs open, one closes; if one tab open, window closes (after confirm if dirty).
4. Open 3 tabs, press `Cmd-2` — second tab becomes active.
5. Press `Cmd-9` — last tab becomes active.
6. Press `Cmd-5` with only 3 tabs — no-op.
7. Open Keybindings panel (Cmd-Shift-K) — new tab commands are listed.
