---
title: "Step 03 — Commands Mode Refactor"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Step 03 — Commands Mode Refactor

## Goal and Scope

Migrate the existing single-mode result pipeline into the `"commands"` mode branch of the new `buildResultsForMode()` dispatcher. Remove the `showRecentFiles` setting from the active code path and settings UI. Ensure all 84 existing tests continue to pass without modification (except for the `renderDetailExtra` tests which must be updated to reflect the removed checkbox).

At the end of this step:

- `buildResultsForMode("commands")` produces exactly the same results as the old `buildAllResults()` did for commands + headings categories
- `buildRecentFileResults` is still exported but is no longer called from the active pipeline
- The settings UI (`renderDetailExtra`) no longer shows the `showRecentFiles` checkbox
- The `showRecentFiles` setting value is accepted on load but ignored (FR-09.2)
- All 84 existing tests pass

---

## Files to Modify

### `src/plugins/command-bar/command-bar.plugin.ts`

1. **Replace `buildAllResults()` with `buildResultsForMode()`**:

   The existing `buildAllResults(settings)` function reads globals and calls all three category builders. Replace it with a dispatcher that calls only the relevant builder for the current mode:

   ```typescript
   /**
    * Build the result set for the current mode.
    * Called synchronously on openBar() for commands mode.
    * For files mode, results are built in fetchWorkspaceFiles() instead.
    * For keybindings mode, results are built in buildKeybindingResults() (Step 4).
    */
   function buildResultsForMode(mode: BarMode, settings: CommandBarSettings): CommandBarResult[] {
     if (mode === "commands") {
       return buildCommandModeResults(settings);
     }
     // files and keybindings modes build results separately
     return [];
   }

   /**
    * Build results for Commands mode: Commands + Headings categories.
    * Functionally identical to the old buildAllResults() minus the Recent Files category.
    */
   function buildCommandModeResults(settings: CommandBarSettings): CommandBarResult[] {
     const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
     const pm   = (window as any).__MARKABLE_PLUGIN_MANAGER__ as PluginManagerLike | undefined;
     const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
     const appSettings: MarkableSettingsSubset =
       typeof getSettings === "function"
         ? getSettings()
         : { recentFiles: [], keybindings: {} };
     const cmState     = (window as any).__MARKABLE_EDITOR_VIEW__?.state ?? null;
     const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
     const handleAction = (window as any).__MARKABLE_HANDLE_ACTION__;

     const results: CommandBarResult[] = [];

     if (settings.showCommands) {
       results.push(...buildCommandResults({
         commands: cmds,
         pluginManager: pm!,
         keybindings: appSettings.keybindings ?? {},
         currentFile,
         navigateToPlugin: (_id: string) => {
           if (typeof handleAction === "function") handleAction("app-plugins");
         },
       }));
     }

     if (settings.showHeadings) {
       results.push(...buildHeadingResults({ cmState, currentFile }));
     }

     // showRecentFiles is intentionally NOT used here (FR-09.2, AD-02)

     return results;
   }
   ```

2. **Update `openBar()`** to call `buildResultsForMode()` for commands mode:
   ```typescript
   // In openBar(), for commands mode:
   if (targetMode === "commands") {
     _lastBuildError = null;
     try {
       _allResults = buildResultsForMode("commands", _settings);
     } catch (err) {
       _lastBuildError = String(err);
       console.error("[CommandBar] buildResultsForMode('commands') failed:", err);
       _allResults = [];
     }
     _visibleResults = _allResults;
     _selectedId = firstSelectableId(_visibleResults);
     renderResults(_resultsEl!, _visibleResults, "", _selectedId);
     updateAriaActiveDescendant(_inputEl!, _selectedId);
     scrollSelectedIntoView(_resultsEl!);
   }
   ```

3. **Keep `buildAllResults()` as a private alias** (for backward-compat with tests that may indirectly test it):

   Actually, the existing 84 tests import `buildCommandResults`, `buildHeadingResults`, and `buildRecentFileResults` directly — they do NOT import `buildAllResults`. `buildAllResults` is a private function (not exported). It is safe to remove it entirely and replace with `buildResultsForMode`. No test changes required.

4. **Update `renderResults()` empty state** to remove the `sr:${_settings.showRecentFiles}` debug indicator:
   ```typescript
   // Replace the showRecentFiles reference in the debug empty-state message:
   empty.textContent = `No results — COMMANDS:${(cmds as any[]).length} PM:${pm ? "ok" : "missing"} HA:${ha ? "ok" : "missing"} | sc:${_settings.showCommands} sh:${_settings.showHeadings}`;
   ```

5. **Update `loadPluginSettings()`** — accept `showRecentFiles` from saved data but do not apply it:
   ```typescript
   async function loadPluginSettings(api: MarkablePluginAPI): Promise<void> {
     const saved = await api.loadSettings();
     if (saved) {
       _settings = {
         showCommands:  typeof saved.showCommands  === "boolean" ? (saved.showCommands  as boolean) : DEFAULT_SETTINGS.showCommands,
         showHeadings:  typeof saved.showHeadings  === "boolean" ? (saved.showHeadings  as boolean) : DEFAULT_SETTINGS.showHeadings,
         showRecentFiles: true,   // ignored; always true for deprecated-compat (FR-09.2)
         activePreset:  typeof saved.activePreset  === "string"  ? (saved.activePreset  as string)  : DEFAULT_SETTINGS.activePreset,
       };
     } else {
       _settings = { ...DEFAULT_SETTINGS };
     }
   }
   ```

6. **Update `renderDetailExtra()`** — remove the `showRecentFiles` checkbox from the settings UI. The `items` array in `renderDetailExtra` changes from three entries to two:

   ```typescript
   const items: Array<{ key: keyof CommandBarSettings; label: string; description: string }> = [
     {
       key: "showCommands",
       label: "Show Commands",
       description: "Include app commands and plugin toggles in results",
     },
     {
       key: "showHeadings",
       label: "Show Headings",
       description: "Include document headings for quick navigation",
     },
     // showRecentFiles removed — FR-09.2, AD-02
   ];
   ```

   Also add a note for the active preset display (populated in Step 5):
   ```typescript
   // After the checkboxes, add a placeholder section for "Active Preset"
   // that Step 5 will populate. For now, a static label is sufficient.
   const presetSection = document.createElement("div");
   presetSection.className = "settings-section";
   const presetTitle = document.createElement("h3");
   presetTitle.className = "settings-label";
   presetTitle.textContent = "Keybinding Preset";
   const presetDesc = document.createElement("p");
   presetDesc.className = "settings-description";
   presetDesc.textContent = `Active preset: ${_settings.activePreset}`;
   presetSection.appendChild(presetTitle);
   presetSection.appendChild(presetDesc);
   container.appendChild(presetSection);
   ```

---

## Existing Tests That Must Be Updated (not the 84, but specific assertions)

The existing test for `renderDetailExtra` checks the number of checkboxes or their labels. If such a test exists, it must be updated to expect 2 checkboxes (not 3). Search the test file for `showRecentFiles` references in the `renderDetailExtra` test block and update accordingly.

The 84 test total includes tests for `buildRecentFileResults` directly — those tests still pass because the function still exists and is still exported. They just test a function that is no longer in the active call path.

---

## Verification: No Behavioral Regression in Commands Mode

The following assertions must hold after this step (verifiable by running the existing test suite):

1. `buildCommandResults()` signature and behavior: unchanged
2. `buildHeadingResults()` signature and behavior: unchanged
3. `buildRecentFileResults()` signature and behavior: unchanged (exported, tests pass)
4. `buildOverlayDOM()`: unchanged in terms of the DOM structure tested by existing tests (badge and footer additions from Step 1 don't break existing assertions because those tests check for specific elements, not the absence of new ones)
5. `renderResults()`: the `sr:` debug indicator is the only change — not tested by existing tests
6. `firstSelectableId()`: unchanged
7. `renderDetailExtra()`: the `showRecentFiles` checkbox is removed; tests for this function must be updated

---

## TDD Anchors

New describe block: `"Step 03 — Commands Mode Refactor"`:

```
it("buildResultsForMode('commands') returns commands category results when showCommands=true")
it("buildResultsForMode('commands') returns headings category results when showHeadings=true")
it("buildResultsForMode('commands') respects showCommands=false")
it("buildResultsForMode('commands') respects showHeadings=false")
it("buildResultsForMode('commands') does NOT include recent files results (FR-09.2)")
it("buildResultsForMode('files') returns empty array (handled separately)")
it("buildResultsForMode('keybindings') returns empty array before Step 4")
it("loadPluginSettings ignores showRecentFiles from saved settings (FR-09.2)")
it("renderDetailExtra renders exactly 2 checkboxes (showCommands, showHeadings)")
it("renderDetailExtra no longer renders a showRecentFiles checkbox")
it("renderDetailExtra renders an 'Active preset' note")
```

Additionally: run the full existing 84-test suite. All must pass.

---

## Definition of Done

- [ ] `buildAllResults()` is replaced by `buildResultsForMode()` + `buildCommandModeResults()`
- [ ] `buildRecentFileResults` is still exported and still tested (function retained, not called by active pipeline)
- [ ] `showRecentFiles` is accepted from saved settings but ignored (value always `true` internally)
- [ ] `renderDetailExtra` shows only 2 checkboxes
- [ ] Commands mode behavior is identical to the existing bar behavior
- [ ] All 84 existing tests pass (the only required update is the `renderDetailExtra` checkbox count test, if one exists)
- [ ] New commands-mode refactor tests pass
