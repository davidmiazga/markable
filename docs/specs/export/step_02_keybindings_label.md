---
title: "step_02 — keybindings-panel.ts label rename"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# step_02 — Rename "Export as HTML" to "Export..." in COMMANDS array

**Depends on**: nothing (parallel with step_01)
**Blocks**: step_05 (tests verify the new label)

---

## What to change

**File**: `src/keybindings/keybindings-panel.ts`

### Current state (line 45)

```ts
{ id: "file-export", label: "Export as HTML", defaultKey: "Cmd-Alt-E", section: "File" },
```

### Target state

```ts
{ id: "file-export", label: "Export...",      defaultKey: "Cmd-Alt-E", section: "File" },
```

The `id`, `defaultKey`, and `section` fields are unchanged. Only `label`
changes.

The `file-print` entry on the line immediately below must remain untouched:

```ts
{ id: "file-print",  label: "Print",          defaultKey: "Cmd-P",     section: "File" },
```

---

## Why this is sufficient for the command bar

The command bar plugin reads its command list from `window.__MARKABLE_COMMANDS__`,
which is the `COMMANDS` array exported from this file (set in `main.ts` as
`(window as any).__MARKABLE_COMMANDS__ = COMMANDS`). No separate label map
exists in `command-bar.plugin.ts`. Updating `COMMANDS` is the single source
of truth for FR-07.2.

---

## EC-11 verification (no shortcut conflict)

`Cmd-Alt-E` is already in production as the `file-export` binding. Scan
`KEYBINDING_DEFS` for any other entry that uses `"Cmd-Alt-E"` as its
`defaultKey`. There must be none. The developer must confirm this at
implementation time.

---

## Acceptance criteria

- [ ] `COMMANDS` array entry for `"file-export"` has `label: "Export..."`.
- [ ] `COMMANDS` array entry for `"file-print"` is unchanged.
- [ ] `defaultKey: "Cmd-Alt-E"` is unchanged.
- [ ] Command bar shows "Export..." (not "Export as HTML") for the `file-export`
      entry after app restart.
- [ ] Keybindings panel shows "Export..." in the File section.
- [ ] No other command shares `"Cmd-Alt-E"` as its `defaultKey`.

---

## Tests (step_05 will add these)

No new unit test is strictly required for this step — it is a string constant
change, not logic. The label is verified as part of the command bar integration
smoke test in step_05.
