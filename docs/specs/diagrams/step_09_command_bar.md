---
title: "Step 09 — Command Bar Integration"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 09: Command Bar Integration

**Requirement:** FR-10.6 (COMMANDS array toggle), FR-11 (Command Bar discoverability)
**Files modified:** `src/keybindings/keybindings-panel.ts`, `src/main.ts`

---

## Goal

Register the Diagrams plugin toggle in the `COMMANDS` array and add the corresponding `handleAction` case. After this step the plugin is discoverable and toggleable via the Command Bar (Cmd-Shift-P) and via any keyboard shortcut assigned to `view-toggle-diagrams`.

---

## Implementation Instructions

### Task 9.1: Add to COMMANDS array

Open `src/keybindings/keybindings-panel.ts`. Find the block of `view-toggle-*` entries near line 69–71:

```typescript
{ id: "view-toggle-statusbar",  label: "Status Bar",      defaultKey: "",       section: "View" },
{ id: "view-toggle-focus",      label: "Focus Mode",      defaultKey: "",       section: "View" },
{ id: "view-toggle-typewriter", label: "Typewriter Mode", defaultKey: "",       section: "View" },
```

Append the diagrams toggle immediately after the `view-toggle-typewriter` line:

```typescript
{ id: "view-toggle-diagrams",   label: "Diagrams",        defaultKey: "",       section: "View" },
```

The full block after the change:

```typescript
{ id: "view-toggle-statusbar",  label: "Status Bar",      defaultKey: "",       section: "View" },
{ id: "view-toggle-focus",      label: "Focus Mode",      defaultKey: "",       section: "View" },
{ id: "view-toggle-typewriter", label: "Typewriter Mode", defaultKey: "",       section: "View" },
{ id: "view-toggle-diagrams",   label: "Diagrams",        defaultKey: "",       section: "View" },
```

The `defaultKey` is intentionally empty — no default keyboard shortcut is assigned. Users may assign one via Settings > Keyboard Shortcuts. This matches the pattern for other optional plugin toggles (focus-mode, typewriter-mode).

### Task 9.2: Add handleAction case

Open `src/main.ts`. Find the `handleAction` switch near the `view-toggle-typewriter` case:

```typescript
case "view-toggle-typewriter":
  if (editor) void pluginManager.toggle("typewriter-mode", !pluginManager.getStates()["typewriter-mode"]);
  break;
```

Add the diagrams case immediately after:

```typescript
case "view-toggle-diagrams":
  if (editor) void pluginManager.toggle("diagrams", !pluginManager.getStates()["diagrams"]);
  break;
```

---

## How Command Bar discoverability works

The Command Bar reads the `COMMANDS` array when it opens. For any entry whose `id` matches a known plugin toggle pattern (`view-toggle-*` with a corresponding plugin id), the Command Bar generates two results:
1. "Enable Diagrams" — calls `handleAction("view-toggle-diagrams")` when the plugin is currently disabled
2. "Disable Diagrams" — calls `handleAction("view-toggle-diagrams")` when the plugin is currently enabled

This dual-result behavior is built into the command-bar plugin (FC2 #11) and requires no changes to `command-bar.plugin.ts`. The `view-toggle-diagrams` entry in `COMMANDS` and the `handleAction` case are the only integration points needed (FR-11.1).

---

## Verification

After implementing this step:
1. Open the Command Bar (Cmd-Shift-P)
2. Type "diagrams" — the result "Enable Diagrams" (or "Disable Diagrams") should appear
3. Select the result — the plugin should toggle on/off
4. Open the Plugins Panel (Cmd-Alt-P) — Diagrams should appear in the plugin list
5. In Settings > Keyboard Shortcuts, search for "Diagrams" — the entry should appear with an empty default key (user can assign one)

---

## Acceptance Criteria

- [ ] `COMMANDS` array in `keybindings-panel.ts` contains `{ id: "view-toggle-diagrams", label: "Diagrams", defaultKey: "", section: "View" }`
- [ ] The entry is placed after `view-toggle-typewriter` (section ordering consistency)
- [ ] `handleAction` switch in `main.ts` has a `case "view-toggle-diagrams":` that calls `pluginManager.toggle("diagrams", ...)`
- [ ] Command Bar shows "Enable Diagrams" / "Disable Diagrams" results when typing "diagrams"
- [ ] Selecting the command bar result toggles the plugin on/off
- [ ] `npm run build` (full app build) compiles without TypeScript errors
- [ ] No TODO comments added

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/keybindings/keybindings-panel.ts` | MODIFY | Add view-toggle-diagrams to COMMANDS |
| `src/main.ts` | MODIFY | Add view-toggle-diagrams case to handleAction switch |
