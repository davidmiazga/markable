---
title: "Step 06 — Full Test Coverage"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Step 06 — Full Test Coverage

## Goal and Scope

Complete the test suite to cover all 36 edge cases from the requirements, verify all new exported functions, and confirm the 84 existing tests remain passing. This step may involve adding tests that span multiple previous steps (integration tests) as well as filling any coverage gaps identified during implementation.

This step is a test-audit pass, not a new feature step. If any edge case from the EC inventory is not yet covered after Steps 1–5, it is covered here.

---

## Test File to Modify

`tests/plugins/command-bar/command-bar.test.ts`

---

## Import Additions

The test file needs imports for all newly exported functions:

```typescript
// ── New imports for modal command bar ────────────────────────────────────────
import type { BarMode } from "../../../src/plugins/command-bar/command-bar.plugin";
import { setMode } from "../../../src/plugins/command-bar/command-bar.plugin";
import { renderFilesResults, renderKeybindingResults } from "../../../src/plugins/command-bar/command-bar.plugin";

// From new sub-modules (these are bundled into the IIFE at runtime, but can
// be imported statically in tests because they have no window-global side effects)
import {
  buildFilesResults, countWorkspaceBeforeCap, abbreviatePath, basename, FILES_CAP,
  type TabEntry, type FilesResult,
} from "../../../src/plugins/command-bar/files-mode";

import {
  buildKeybindingResults, captureKeyFromEvent, checkConflict, isSystemReserved,
  isModifierOnly, formatKeyDisplay,
  type KeybindingResult, type ConflictInfo,
} from "../../../src/plugins/command-bar/keybindings-mode";

import {
  loadPresets, saveNewPreset, deletePreset, renamePreset, validatePresetName,
  sanitizePresetName, DEFAULT_PRESET_NAME,
  type PresetEntry, type PresetApiDeps,
} from "../../../src/plugins/command-bar/preset-manager";
```

---

## Complete Edge Case Coverage Checklist

Each EC from the requirements must have at least one test. The table below maps each EC to the step that primarily covers it and marks whether tests exist after Steps 1–5.

| EC | Description | Step | Test required here |
|---|---|---|---|
| EC-01 | Files mode — no file open | Step 2 | Verify in Step 2 tests |
| EC-02 | Files mode — no tabs and no file open | Step 2 | Verify in Step 2 tests |
| EC-03 | Files mode — `list_md_files` invoke fails | Step 2 | Verify in Step 2 tests |
| EC-04 | Files mode — workspace contains zero `.md` files | Step 2 | Verify in Step 2 tests |
| EC-05 | Files mode — workspace contains > 200 `.md` files | Step 2 | Verify in Step 2 tests |
| EC-06 | Files mode — active tab in both getAllTabs and list_md_files | Step 2 | Verify in Step 2 tests |
| EC-07 | Prefix switch — literal `>` search | Step 1 | Verify in Step 1 tests |
| EC-08 | Prefix switch — `>` when already in Commands mode | Step 1 | Verify in Step 1 tests |
| EC-09 | Prefix switch — `#` when already in Keybindings mode | Step 1 | Verify in Step 1 tests |
| EC-10 | Prefix switch — Backspace when input is empty in Files mode | Step 1 | Verify in Step 1 tests |
| EC-11 | Badge click while key-capture is active | Steps 1+4 | **Add here** |
| EC-12 | Different mode shortcut while bar is open | Step 1 | Verify in Step 1 tests |
| EC-13 | Same mode shortcut while bar is open | Step 1 | Verify in Step 1 tests |
| EC-14 | Keybindings — keybindings.json does not exist | Step 4 | Verify in Step 4 tests |
| EC-15 | Keybindings — corrupt keybindings.json | Step 4 | **Add here** |
| EC-16 | Keybindings — empty commands list | Step 4 | Verify in Step 4 tests |
| EC-17 | Key capture — Escape immediately | Step 4 | Verify in Step 4 tests |
| EC-18 | Key capture — modifier-only keypress | Step 4 | Verify in Step 4 tests |
| EC-19 | Key capture — Cmd-Q (system reserved) | Step 4 | Verify in Step 4 tests |
| EC-20 | Key capture — Cmd-W (system reserved) | Step 4 | Verify in Step 4 tests |
| EC-21 | Key capture — same-action combo | Step 4 | Verify in Step 4 tests |
| EC-22 | Key capture — keybindings.json write fails | Step 4 | Verify in Step 4 tests |
| EC-23 | Preset apply — confirmation shown when custom bindings exist | Step 5 | Verify in Step 5 tests |
| EC-24 | Preset folder missing (no user presets) | Step 5 | Verify in Step 5 tests |
| EC-25 | Preset save — duplicate name | Step 5 | Verify in Step 5 tests |
| EC-26 | Preset save — reserved name "Default" | Step 5 | Verify in Step 5 tests |
| EC-27 | Rapid mode switching — stale async results | Steps 1+2 | **Add here** |
| EC-28 | Files mode fetch resolves after bar closed | Step 2 | Verify in Step 2 tests |
| EC-29 | Keybindings — action has no defaultKey | Step 4 | Verify in Step 4 tests |
| EC-30 | Plugin disabled during key-capture | Steps 4+closeBar | Verify in Step 4 tests |
| EC-31 | Bar opened in Keybindings mode when no file open | Steps 1+4 | **Add here** |
| EC-32 | Workspace path with spaces/Unicode/~ | Step 2 | **Add here** |
| EC-33 | Preset folder exists but empty | Step 5 | Verify in Step 5 tests |
| EC-34 | Preset folder contains malformed JSON | Step 5 | Verify in Step 5 tests |
| EC-35 | Preset file deleted after dropdown populated | Step 5 | Verify in Step 5 tests |
| EC-36 | Active preset file deleted | Step 5 | Verify in Step 5 tests |

---

## Tests to Add in This Step

### `describe("EC-11: Badge click while key-capture is active")`
```typescript
it("cancels key-capture and cycles mode when badge is clicked during capture", async () => {
  // Setup: enable plugin, open in keybindings mode, enter key-capture
  // Click badge
  // Assert: _capturingFor is null, mode has cycled, capture view is hidden
});
```

### `describe("EC-15: Corrupt keybindings.json")`
```typescript
it("EC-15: buildKeybindingResults falls back to defaults when customBindings is malformed", () => {
  // Inject a malformed value for keybindings (e.g. a string instead of object)
  // Expect: all results use defaultKey, no crash
  const cmds: CommandDef[] = [{ id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" }];
  const results = buildKeybindingResults({
    commands: cmds,
    customBindings: {},  // empty — corrupt data is coerced to {} before passing
    enterCapture: () => {},
  });
  expect(results[0].isDefault).toBe(true);
  expect(results[0].activeKey).toBe("Cmd-S");
});
```

### `describe("EC-27: Rapid mode switching")`
```typescript
it("EC-27: stale file fetch from prior mode does not update results", async () => {
  // Open bar in files mode (generation=1), trigger async fetch
  // Increment _openGeneration (simulate mode switch)
  // Resolve the fetch
  // Assert: _fileModeResults was not updated
  // This test must access _openGeneration via the module's exported generation,
  // or test via behavior (results area does not change after generation change)
});
```

### `describe("EC-31: Keybindings mode when no file open")`
```typescript
it("EC-31: openBar('keybindings') shows full action list even when no file is open", () => {
  // Set __MARKABLE_CURRENT_FILE__ = null
  // openBar("keybindings") via __MARKABLE_COMMAND_BAR_OPEN__
  // Assert: results list contains keybinding results, not a "no workspace" notice
  // Assert: mode badge shows "Keybindings"
});
```

### `describe("EC-32: Path resolution")`
```typescript
it("EC-32: workspace dir is derived as absolute path (no ~ prefix)", () => {
  // Set __MARKABLE_CURRENT_FILE__ = "/Users/test/docs/notes.md"
  // Capture the invoke call to "list_md_files"
  // Assert: dir parameter is "/Users/test/docs", not "~/docs"
});

it("EC-32: path with spaces is passed as-is to invoke", () => {
  // Set __MARKABLE_CURRENT_FILE__ = "/Users/test/My Documents/notes.md"
  // Assert: dir = "/Users/test/My Documents"
});

it("EC-32: path with Unicode characters is passed as-is to invoke", () => {
  // Set __MARKABLE_CURRENT_FILE__ = "/Users/test/Björk notes/song.md"
  // Assert: dir = "/Users/test/Björk notes"
});
```

---

## Full Regression Test Run

After all tests are written, the full test suite must report:

- **All 84 existing tests**: PASS (verified by running without any modifications to existing test blocks)
- **All new Step 1 tests**: PASS
- **All new Step 2 tests**: PASS
- **All new Step 3 tests**: PASS
- **All new Step 4 tests**: PASS
- **All new Step 5 tests**: PASS
- **All new Step 6 tests**: PASS
- **Zero skipped tests** in the new blocks (the existing 39 skipped tests are in other test files)

Minimum new test count targets (these are estimates; the Developer may add more):

| Step | Estimated new tests |
|---|---|
| Step 1 | ~20 |
| Step 2 | ~22 |
| Step 3 | ~12 |
| Step 4 | ~35 |
| Step 5 | ~25 |
| Step 6 | ~10 |
| **Total new** | **~124** |
| Existing | 84 |
| **Grand total** | **~208** |

---

## Export Completeness Audit

Before closing this step, verify that every pure function in the three new sub-modules is exported. The test file's static imports serve as the export audit: if a test imports a function, it must be exported. The following functions must be importable from their respective modules without errors:

**`files-mode.ts`**: `buildFilesResults`, `countWorkspaceBeforeCap`, `abbreviatePath`, `basename`, `dirname`, `FILES_CAP`, `FILES_SECTION_LABELS`

**`keybindings-mode.ts`**: `buildKeybindingResults`, `captureKeyFromEvent`, `checkConflict`, `isSystemReserved`, `isModifierOnly`, `formatKeyDisplay`

**`preset-manager.ts`**: `loadPresets`, `saveNewPreset`, `deletePreset`, `renamePreset`, `validatePresetName`, `sanitizePresetName`, `presetNamespace`, `DEFAULT_PRESET_NAME`

**`command-bar.plugin.ts`** (new exports): `BarMode` (type), `setMode`, `renderFilesResults`, `renderKeybindingResults`

---

## Definition of Done

- [ ] Every EC (EC-01 through EC-36) has at least one named test in the test file
- [ ] EC-11, EC-15, EC-27, EC-31, EC-32 tests added in this step
- [ ] All 84 existing tests pass without modification (except the `renderDetailExtra` checkbox count test if one exists — that is updated in Step 3)
- [ ] Import completeness audit passes (all exported functions are importable)
- [ ] No test uses `any` casts to access module-private state; all tests use exported APIs or the DOM
- [ ] `npm test` (or `npx vitest run tests/plugins/command-bar/`) exits with code 0
