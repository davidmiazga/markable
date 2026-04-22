---
title: "Modal Command Bar + Keybinding Editor"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Modal Command Bar + Keybinding Editor — Requirements Spec

## Validation Status

**VALIDATED — all clarifying questions resolved 2026-04-22. Ready for architecture phase.**

---

## Summary

As a user, I want the command bar to operate in three distinct modes (Files, Commands, Keybindings) that I can switch between by shortcut or by typing a prefix, so that file navigation, command execution, and keybinding assignment each feel focused and purpose-built rather than mixed into a single unfocused list.

---

## Background and Motivation

The existing command bar (FC2 #11) is a single-mode fuzzy palette that mixes Commands, Headings, and Recent Files into one list under `Cmd-Shift-P`. It has 84 tests, a 4-tier fuzzy ranker, context-invalid dimming, and a fully IIFE-compliant architecture.

This feature replaces the single-mode bar with a three-mode modal system. The existing code is the starting point: the fuzzy ranker, overlay DOM, and IIFE plugin structure are all reused. The Categories labeling system changes, the keybinding storage in `keybindings.json` gains a new caller, and a new "Files" mode replaces the "Recent Files" category with a full workspace file scan.

No new Rust commands are needed. All file I/O uses existing `api.loadSettings` / `api.saveSettings` or direct `__TAURI_INTERNALS__.invoke` calls already available in the frontend.

---

## Goals

1. Replace the single-mode command bar with a three-mode modal system while preserving the existing `Cmd-Shift-P` muscle memory for Commands mode.
2. Deliver Files mode as the new default bar entry (`Cmd-P`), which searches all `.md` files in the workspace and shows open tabs.
3. Deliver Keybindings mode (`Cmd-Shift-K`) as an in-bar visual keybinding editor that replaces a separate settings panel.
4. Support prefix-based mode switching while the bar is open (`>` for Commands, `#` for Keybindings, Backspace to return to Files).
5. Add a visible mode badge to the bar that identifies the current mode and can be clicked to cycle modes.
6. Deliver keybinding presets: a built-in read-only "Default" preset plus file-based user presets scanned from `~/Library/Application Support/com.markable.app/keybinding-presets/`.
7. Maintain all existing NFRs: IIFE constraint, CSS variable theming, ARIA/focus-trap, sub-80ms open latency.

---

## Functional Requirements

### FR-01: Mode System

**FR-01.1** The command bar operates in exactly one of three modes at any given time: `files`, `commands`, or `keybindings`. The current mode is tracked in a module-level variable `_mode`.

**FR-01.2** The mode is displayed via a **mode badge** — a small pill element rendered inside the input row, to the left of the text input. Badge labels: `"Files"`, `"Commands"`, `"Keybindings"`.

**FR-01.3** Clicking the mode badge cycles to the next mode in the order `files → commands → keybindings → files`. Cycling updates `_mode`, updates the badge text, updates the input placeholder, and re-runs the filter pipeline.

**FR-01.4** The active mode badge is always visible regardless of input content or result count.

**FR-01.5** When the bar is opened via `Cmd-P`, it opens in `files` mode with an empty input.

**FR-01.6** When the bar is opened via `Cmd-Shift-P`, it opens in `commands` mode with an empty input.

**FR-01.7** When the bar is opened via `Cmd-Shift-K`, it opens in `keybindings` mode with an empty input.

**FR-01.8** If the bar is already open and the user presses an opening shortcut for the currently active mode, the bar closes (toggle behavior — preserves EC-05 from the original spec). If the bar is already open and the user presses an opening shortcut for a *different* mode, the bar switches to that mode (input clears, results rebuild) rather than closing.

**FR-01.9** On close, `_mode` resets to `files` so the next open-by-`Cmd-P` always starts in Files mode. Mode is not persisted between sessions.

---

### FR-02: Files Mode

**FR-02.1** Files mode searches all `.md` files in the current workspace directory. The workspace directory is the directory containing the currently open file (`__MARKABLE_CURRENT_FILE__`), falling back to an empty result set if no file is open.

**FR-02.2** The file list is fetched via `__TAURI_INTERNALS__.invoke("list_md_files", { dir: workspaceDir })` — the same call used by the Backlinks plugin. The result is an array of absolute paths.

**FR-02.3** Currently open tabs (from `__MARKABLE_TAB_MANAGER__.getAllTabs()`) are shown at the top of the result list in a section labelled `"Open Tabs"`, regardless of whether they are also in the workspace file list. Workspace files are shown in a section labelled `"Files"` below.

**FR-02.4** A file already open as a tab is not duplicated in the `"Files"` section (it appears only in `"Open Tabs"`).

**FR-02.5** Pressing Enter on an open-tab result calls `__MARKABLE_TAB_MANAGER__.switchToTab(tab.id)`.

**FR-02.6** Pressing Enter on a workspace file result calls `__MARKABLE_TAB_MANAGER__.openFile(path)` (or equivalent tab-manager open method).

**FR-02.7** Each result in Files mode shows the filename as label and the abbreviated directory path as sublabel (same `~/` abbreviation as the original Recent Files category).

**FR-02.8** Empty query in Files mode shows all open tabs followed by all workspace files (up to a fixed display cap of 200 workspace file entries — not user-configurable). Open-tab entries are never capped.

**FR-02.9** Non-empty query applies the existing 4-tier fuzzy ranker to both sections; results within each section are ranked independently, sections remain separate.

**FR-02.10** The file list is fetched once per bar-open (same "rebuild on open" contract as `buildAllResults()` today). It is not re-fetched on each keystroke.

**FR-02.11** While the file list is loading (async `invoke`), the results area shows a neutral `"Loading…"` state. On load completion the results are rendered and the first item is pre-selected.

**FR-02.12** The existing `showRecentFiles` plugin setting is retired. The "Recent Files" result category is removed from Commands mode. The plugin settings UI is updated to remove that toggle.

**FR-02.13** Input placeholder in Files mode: `"Open file or tab…"`.

---

### FR-03: Commands Mode

**FR-03.1** Commands mode is functionally equivalent to the existing single-mode command bar behavior for the Commands and Headings categories. The result set is built using the existing `buildCommandResults()` and `buildHeadingResults()` functions (no behavioral change).

**FR-03.2** Section labels are `"Commands"` and `"Headings"` (unchanged).

**FR-03.3** Prefix entry: typing `>` as the first character of an otherwise empty input while in Files mode switches the bar to Commands mode and removes the `>` from the input (the `>` is consumed as a switch signal, not treated as a search query).

**FR-03.4** Input placeholder in Commands mode: `"Type a command or search headings…"` (updated from the current generic placeholder).

**FR-03.5** The `showCommands` and `showHeadings` plugin settings remain functional and are respected in Commands mode.

**FR-03.6** Footer hint text in Commands mode: `"Enter to run  ·  Esc to close"`.

---

### FR-04: Keybindings Mode

**FR-04.1** Keybindings mode searches the same command list as Commands mode (`__MARKABLE_COMMANDS__` array) but excludes headings and file results. Section label: `"Actions"`.

**FR-04.2** Each result in Keybindings mode shows: the action label, the current active keybinding for that action (from `keybindings.json` if overridden, else the default), and a secondary label `"(default)"` when the binding is the default or `"(custom)"` when overridden.

**FR-04.3** Prefix entry: typing `#` as the first character of an otherwise empty input while in Files mode switches the bar to Keybindings mode and removes the `#` from the input.

**FR-04.4** Input placeholder in Keybindings mode: `"Search actions to assign shortcut…"`.

**FR-04.5** Footer hint text in Keybindings mode: `"Enter to assign shortcut  ·  Esc to close"`.

**FR-04.6** Pressing Enter on a result in Keybindings mode enters **key-capture sub-state** for that action (see FR-05).

**FR-04.7** A preset row is rendered above the search input (but inside the panel) when in Keybindings mode. It shows the active preset name and a small dropdown button. The preset row is hidden in Files and Commands modes.

---

### FR-05: Key-Capture Sub-State

**FR-05.1** When key-capture sub-state is entered for a given action, the input clears and its placeholder changes to `"Press keys…"`. The results list is replaced by a single-item capture view showing the action name and `"Waiting for key combo…"`.

**FR-05.2** In key-capture sub-state, the next keydown event (other than Escape, Tab, and modifier-only keystrokes such as bare Shift/Cmd/Ctrl/Alt) is captured as the new binding. The full combo is recorded (e.g. `Cmd-Shift-S`).

**FR-05.3** Modifier-only keystrokes (bare `Meta`, `Shift`, `Control`, `Alt` without a non-modifier key) are ignored in key-capture sub-state — the state remains active and continues waiting.

**FR-05.4** After a valid keypress is captured, a conflict check is performed synchronously: scan `keybindings.json` and all `defaultKey` values in `__MARKABLE_COMMANDS__` to determine if the captured combo is already bound to a different action.

**FR-05.5** If the captured combo is free (no conflict), the new binding is saved immediately via `api.saveSettings()` (updating `keybindings.json`) and the bar closes.

**FR-05.6** If the captured combo conflicts with an existing binding, the capture view updates inline to show: `"⚠ Already bound to: [Action Name]"` with two buttons: `"Override"` and `"Cancel"`. Pressing `"Override"` saves the new binding (removing it from the conflicting action first) and closes the bar. Pressing `"Cancel"` returns to Keybindings mode search (key-capture sub-state exits, input focus returns).

**FR-05.7** Pressing Escape during key-capture sub-state cancels the capture and returns to Keybindings mode search. The existing binding is unchanged.

**FR-05.8** System-reserved combos (`Cmd-Q`, `Cmd-W`, `Cmd-Tab`, `Cmd-M`, `Cmd-H`) are treated as conflicts with a special label `"System reserved"`. Override is allowed but a second confirmation prompt is shown: `"This shortcut is reserved by macOS. Are you sure?"` with `"Assign Anyway"` and `"Cancel"` options.

**FR-05.9** The existing binding for the selected action is shown in the capture view before a new key is pressed, so the user knows what they are replacing.

---

### FR-06: Prefix-Based Mode Switching

**FR-06.1** When the bar is in `files` mode and the user types `>` into an otherwise empty input, the bar switches to `commands` mode. The `>` character is consumed and does not appear in the input.

**FR-06.2** When the bar is in `files` mode and the user types `#` into an otherwise empty input, the bar switches to `keybindings` mode. The `#` character is consumed.

**FR-06.3** When the bar is in `commands` or `keybindings` mode and the input contains only the prefix character (`>` or `#`) and the user presses Backspace, the bar returns to `files` mode and the input clears.

**FR-06.4** When the bar is in `commands` or `keybindings` mode and the input contains the prefix followed by additional characters (e.g. `>save`), Backspace deletes the rightmost character normally (no mode switch).

**FR-06.5** If the user genuinely wants to search for a string starting with `>` or `#` in Files mode, they can type the second character immediately (e.g. `>f` switches to Commands mode with query `f`). There is no escape mechanism for literal `>` or `#` search in Files mode — this is an accepted constraint.

---

### FR-07: Keybinding Presets

**FR-07.1** A preset is a `.json` file whose content is an object mapping action ids to key strings, plus a required `name` field (string). Presets are stored as individual files in `~/Library/Application Support/com.markable.app/keybinding-presets/`. This mirrors the custom-themes directory pattern already used by Markable.

**FR-07.2** The only built-in preset is `"Default"` — a read-only synthetic preset (not a real file on disk) that represents all bindings set to their `defaultKey` values (equivalent to an empty `keybindings.json`). It is always present as the first entry in the dropdown and cannot be renamed or deleted. There are no other hardcoded presets in the codebase.

**FR-07.3** On each bar open in Keybindings mode, the plugin scans `keybinding-presets/` for `.json` files. The scanned list is appended after "Default" in the dropdown. Files that fail JSON validation are skipped with `console.warn`.

**FR-07.4** The active preset name is stored as `activePreset: string` in the plugin settings (written via `api.saveSettings()`). Default value: `"Default"`.

**FR-07.5** Switching presets via the preset row dropdown applies the preset's bindings by writing them to `keybindings.json` via `api.saveSettings()` and emitting a lightweight in-memory cache-invalidation signal so that `resolveAction()` picks up the new bindings without a page reload or plugin restart. The bar closes after applying.

**FR-07.6** The user can save the current bindings as a new preset via a `"Save as preset…"` button in the preset row dropdown. A text input appears inline (within the bar) for the preset name. Pressing Enter writes a new `.json` file to `keybinding-presets/` and adds it to the dropdown; pressing Escape cancels. Preset names must be unique (case-insensitive); `"Default"` is reserved and cannot be used.

**FR-07.7** User-created presets can be renamed (renames the file) and deleted (removes the file) from the preset row dropdown. The built-in "Default" preset cannot be renamed or deleted.

**FR-07.8** Applying any non-Default preset overwrites the current `keybindings.json` bindings. This is a destructive operation; a confirmation prompt is shown: `"Replace all current shortcuts with the [Preset Name] preset?"` with `"Apply"` and `"Cancel"`.

**FR-07.9** "Reset to default" for a single action (not a full preset switch) is supported: in key-capture sub-state, a `"Reset to default"` button appears in the capture view alongside the current binding. Clicking it removes the custom binding for that action, restoring the `defaultKey`.

**FR-07.10** The `resolveAction()` hot-reload signal is a lightweight in-memory mechanism (e.g. incrementing a module-level version counter checked on each `resolveAction()` call, or dispatching a custom DOM event) that forces the cached keybinding map to be rebuilt from disk on the next resolution. No page reload or plugin restart is required. The exact mechanism is left to the Architect.

---

### FR-08: Mode Badge

**FR-08.1** The mode badge is a `<button>` element with class `cb-mode-badge`, rendered inside `.cb-input-row` before the `<input>` element.

**FR-08.2** The badge label is: `"Files"`, `"Commands"`, or `"Keybindings"` depending on `_mode`.

**FR-08.3** Clicking the badge cycles the mode (Files → Commands → Keybindings → Files). The input clears and results rebuild. Key-capture sub-state is cancelled if active.

**FR-08.4** The badge is keyboard-accessible: it must not steal focus from the input. It responds to `click` only; keyboard users cycle modes via prefix characters or opening shortcuts.

---

### FR-09: Plugin Settings

**FR-09.1** Settings schema (persisted via `api.saveSettings()` / `api.loadSettings()`):

| Key | Type | Default | Description |
|---|---|---|---|
| `showCommands` | boolean | `true` | Show app commands in Commands mode |
| `showHeadings` | boolean | `true` | Show document headings in Commands mode |
| `activePreset` | string | `"Default"` | Name of the currently active keybinding preset |

The workspace file cap (200) is a fixed internal constant, not a user-configurable setting.

**FR-09.2** The `showRecentFiles` setting from the previous version is removed. Saved values are ignored on load (treated as absent).

**FR-09.3** The plugin settings UI (rendered by `renderDetailExtra`) is updated to remove the `showRecentFiles` checkbox and reflect the new settings above.

---

### FR-10: Keyboard Navigation (All Modes)

**FR-10.1** Arrow Up / Arrow Down navigate the result list in all modes.

**FR-10.2** Tab / Shift-Tab navigate the result list (focus trap preserved).

**FR-10.3** Enter activates the selected result (or enters key-capture in Keybindings mode).

**FR-10.4** Escape closes the bar from any mode or sub-state (key-capture is cancelled first; if already in base mode, the bar closes).

**FR-10.5** All keys are consumed via `preventDefault` + `stopPropagation` on the overlay `keydown` handler to prevent CM6 editor from receiving events while the bar is open.

---

### FR-11: IIFE Plugin Structure

**FR-11.1** The feature is implemented within the existing `command-bar.plugin.ts` file. No new plugin file is created.

**FR-11.2** The plugin id, name, and all IIFE sandbox rules (no app-internal imports, CM6 globals via window, `MarkablePluginAPI` pattern) are preserved.

**FR-11.3** `__MARKABLE_COMMAND_BAR_OPEN__` is updated to accept an optional mode argument: `openBar(mode?: "files" | "commands" | "keybindings")`. Existing callers that call `openBar()` with no argument open in Files mode.

**FR-11.4** `__MARKABLE_COMMAND_BAR_IS_OPEN__` boolean flag behavior is unchanged.

---

## Non-Functional Requirements

**NFR-01: Open latency** — Bar must be visible and interactive within 80ms of the triggering shortcut, including the async workspace file fetch. The fetch runs in parallel with DOM display; the bar opens immediately and shows a `"Loading…"` state until the file list resolves.

**NFR-02: Filter latency** — Keystroke-to-render latency must remain under 50ms for up to 200 workspace files plus the commands + headings result set.

**NFR-03: No new Rust commands** — All file I/O uses existing Tauri commands (`list_md_files`) and the plugin settings API. The keybindings preset file is read/written using existing `api.loadSettings()` / `api.saveSettings()` conventions.

**NFR-04: CSS variable theming** — All new CSS uses existing CSS variables (`--bg-primary`, `--text-primary`, `--accent-color`, etc.). No hardcoded hex values or font stack names.

**NFR-05: ARIA / accessibility** — The mode badge must have `aria-label="Switch mode"`. The preset dropdown must be keyboard-accessible (Enter/Escape). Key-capture view must announce the current state to screen readers via `aria-live`.

**NFR-06: Single DOM instance** — The overlay (including badge, preset row, and footer) is built once in `onEnable` and reused across open/close cycles. Mode switching mutates the existing DOM; it does not tear down and rebuild the overlay.

**NFR-07: Focus management** — On bar close from any mode or sub-state, focus returns to the CM6 editor view (`__MARKABLE_EDITOR_VIEW__.focus()`). On mode switch, focus stays in the search input.

**NFR-08: Test coverage** — A Vitest test file (`tests/plugins/command-bar/command-bar.test.ts`) must be updated to cover all new exported functions: mode switching logic, prefix detection, key-capture sub-state, conflict check, preset loading/saving, and all edge cases in the Edge Case Inventory. Existing 84 tests must continue to pass.

---

## Integration Points

| Global / API | Role | Notes |
|---|---|---|
| `__MARKABLE_COMMAND_BAR_OPEN__` | Exposed by plugin; called by keybinding system | Gains optional `mode` arg |
| `__MARKABLE_COMMAND_BAR_IS_OPEN__` | Boolean flag; prevents CM6 focus-steal | Unchanged |
| `__MARKABLE_COMMANDS__` | Source of command list for Commands and Keybindings modes | Unchanged |
| `__MARKABLE_TAB_MANAGER__` | `getAllTabs()`, `switchToTab(id)`, `openFile(path)` | Used by Files mode |
| `__MARKABLE_CURRENT_FILE__` | Derive workspace directory for file scan | Used by Files mode |
| `__MARKABLE_EDITOR_VIEW__` | Heading navigation dispatch; focus restore on close | Unchanged |
| `__MARKABLE_HANDLE_ACTION__` | Dispatch commands from Commands mode | Unchanged |
| `__MARKABLE_PLUGIN_MANAGER__` | Plugin toggle dual-results in Commands mode | Unchanged |
| `__MARKABLE_GET_SETTINGS__` | Read `keybindings` map for current binding display | Unchanged |
| `__TAURI_INTERNALS__.invoke("list_md_files")` | Fetch workspace `.md` files for Files mode | Existing command |
| `resolveAction()` | Reads updated `keybindings.json` after preset apply or key save | Must be hot-reloaded via an in-memory invalidation signal after each write (FR-07.10); no page reload permitted |
| `api.loadSettings()` / `api.saveSettings()` | Persist plugin settings and keybinding presets | Plugin settings API |

---

## Out of Scope

1. Visual keyboard map (Adobe Premiere-style full keyboard diagram).
2. Keybinding sync across devices or iCloud.
3. Importing keybinding files from VSCode, JetBrains, or other editors.
4. Undo history for keybinding changes (reset-to-default per-action per FR-07.8 is sufficient).
5. Any changes to the Rust backend beyond using already-existing commands.
6. Non-`.md` file types in Files mode.
7. Searching files outside the current workspace directory (no global file index).
8. Non-recursive file scan is not a constraint — `list_md_files` already supports recursive traversal (used by Backlinks) and Files mode uses it. Deep directory recursion performance is bounded by the 200-entry cap (FR-02.8).

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer.

**EC-01: Files mode — no file open (workspace directory unknown)** — `__MARKABLE_CURRENT_FILE__` is null. Expected: Files mode shows only the `"Open Tabs"` section (if any tabs are open) and a `"No workspace — open a file first"` notice in place of the Files section. No error is thrown; the bar remains functional.

**EC-02: Files mode — no open tabs and no file open** — Both `getAllTabs()` returns an empty array and `__MARKABLE_CURRENT_FILE__` is null. Expected: the results area shows `"Open a file to browse the workspace"`. No crash.

**EC-03: Files mode — `list_md_files` invoke fails (Rust error or timeout)** — The async file scan rejects. Expected: the `"Loading…"` placeholder is replaced with `"Could not load workspace files"`. Open-tab results remain visible and functional. No unhandled promise rejection.

**EC-04: Files mode — workspace contains zero `.md` files** — `list_md_files` resolves with an empty array. Expected: `"Open Tabs"` section renders normally; `"Files"` section shows `"No markdown files in workspace"` notice.

**EC-05: Files mode — workspace contains more than 200 `.md` files** — `list_md_files` returns more than 200 entries. Expected: results are capped at 200; a notice `"Showing 200 of N files — type to filter"` appears at the bottom of the Files section. No UI freeze.

**EC-06: Files mode — currently active tab appears in both `getAllTabs()` and `list_md_files`** — Expected: the active tab appears only once, in the `"Open Tabs"` section. It is not duplicated in `"Files"`.

**EC-07: Prefix switch — user wants to search for a literal string beginning with `>`** — e.g. user wants to find a file named `>archive.md`. There is no escape mechanism; typing `>` switches to Commands mode. This is an accepted constraint (documented in FR-06.5). Expected behavior: mode switches to Commands. No crash or unexpected state.

**EC-08: Prefix switch — typing `>` when already in Commands mode** — Expected: the `>` is treated as a normal search character and filtered against commands/headings. No mode-switch loop.

**EC-09: Prefix switch — typing `#` when already in Keybindings mode** — Expected: the `#` is treated as a normal search character filtered against actions. No mode-switch loop.

**EC-10: Prefix switch — Backspace when input is empty (no prefix)** — The user is in Files mode with an empty input and presses Backspace. Expected: no-op. No mode change; no error.

**EC-11: Mode cycle via badge — clicking badge while in key-capture sub-state** — Expected: key-capture is cancelled (existing binding unchanged), mode cycles, search view restores, input clears.

**EC-12: Opening shortcut for different mode while bar is open** — Bar is open in Commands mode; user presses `Cmd-P`. Expected: bar switches to Files mode (does not close). Input clears, badge updates, results rebuild.

**EC-13: Opening shortcut for same mode while bar is open** — Bar is open in Commands mode; user presses `Cmd-Shift-P` again. Expected: bar closes (toggle behavior per FR-01.8).

**EC-14: Keybindings mode — `keybindings.json` does not exist yet (first run)** — `api.loadSettings()` returns null. Expected: all actions show their `defaultKey` values with `"(default)"` labels. The file is created only when the first custom binding is saved.

**EC-15: Keybindings mode — `keybindings.json` exists but is corrupt or unparseable** — Expected: bindings fall back to defaults for all actions; a `console.warn` is emitted. No crash or blank results list.

**EC-16: Keybindings mode — empty commands list (`__MARKABLE_COMMANDS__` is empty or absent)** — Expected: results area shows `"No actions available"` notice. No crash.

**EC-17: Key capture — Escape pressed immediately on entering key-capture sub-state** — Expected: key-capture is cancelled; bar returns to Keybindings mode search; the input is focused and the previous query is restored; existing binding is unchanged.

**EC-18: Key capture — modifier-only keypress (bare Shift, Cmd, Ctrl, Alt)** — Expected: state remains in key-capture; `"Press keys…"` placeholder persists; no binding is recorded.

**EC-19: Key capture — system-reserved combo (`Cmd-Q`)** — Expected: `Cmd-Q` is consumed by `preventDefault` within the bar keydown handler; it does not quit the app; the conflict view renders with label `"System reserved"` and a second confirmation prompt (FR-05.8). The app does not quit.

**EC-20: Key capture — `Cmd-W` pressed during capture** — `Cmd-W` closes the current tab in Markable. Expected: `preventDefault` on the bar keydown handler suppresses the tab-close action; system-reserved conflict flow triggers (FR-05.8).

**EC-21: Key capture — capturing a combo already bound to the same action** — User opens key-capture for "File Save" (currently `Cmd-S`) and presses `Cmd-S`. Expected: the capture view shows `"Already bound to: File Save (current)"` with a note that pressing Override will leave the binding unchanged, or simply succeeds silently (since source and target are the same action). No conflict blocker.

**EC-22: Key capture — `keybindings.json` write fails** — `api.saveSettings()` rejects. Expected: an inline error notice `"Could not save binding"` appears in the capture view; the bar does not close; existing binding is unchanged; the user can retry or cancel.

**EC-23: Preset apply — switching to a built-in preset while custom bindings exist** — Expected: confirmation dialog appears (FR-07.7); if user confirms, all custom bindings are overwritten; bar closes; `resolveAction()` reflects the new bindings on next use.

**EC-24: Preset folder missing (first run, no user presets saved)** — The `keybinding-presets/` directory does not exist on disk. Expected: the preset dropdown shows only the built-in "Default" entry and a `"Save as preset…"` option. The folder is created lazily only when the user saves their first preset. No error is thrown on the scan attempt.

**EC-25: Preset save — user saves a preset with a name that already exists (duplicate name)** — Expected: inline validation error `"A preset named '[name]' already exists"` appears; the save is blocked until the user changes the name or cancels.

**EC-26: Preset save — user saves a preset with the reserved name "Default"** — Expected: same duplicate-name validation as EC-25; `"Default"` is reserved and cannot be used for a user preset file. The check is case-insensitive (`"default"`, `"DEFAULT"` are also rejected).

**EC-27: Rapid mode switching** — User cycles through modes by clicking the badge several times in under 200ms. Expected: each click cancels any in-flight async fetch from the previous mode and starts fresh; no stale results from a prior mode bleed through; no uncaught promise rejection.

**EC-28: Files mode — `list_md_files` fetch resolves after bar is already closed** — User opens bar in Files mode, immediately presses Escape before the async fetch resolves, then the fetch resolves. Expected: the resolved result is discarded silently; no DOM manipulation occurs on the (now hidden or removed) results element; no error.

**EC-29: Keybindings mode — action has no `defaultKey` (empty string)** — Expected: the result shows `"(unbound)"` in place of the key badge. No crash; the user can assign a new key normally.

**EC-30: Plugin disabled while key-capture sub-state is active** — The user disables the command-bar plugin via the Plugins Panel (possible if they have two windows or use the menu). Expected: `onDisable` exits key-capture state, closes the bar cleanly, removes all DOM, and nulls all module globals. No binding is saved. No error.

**EC-31: Bar opened via `__MARKABLE_COMMAND_BAR_OPEN__("keybindings")` when no file is open** — Files mode would show no workspace, but keybindings mode has no file dependency. Expected: opens cleanly in Keybindings mode with the full action list visible.

**EC-32: Workspace directory path contains special characters (spaces, Unicode, `~`)** — Path passed to `list_md_files` must be an absolute resolved path (not a `~/`-abbreviated path). Expected: the path is resolved to an absolute path before the invoke call; no path resolution errors.

**EC-33: Preset folder exists but is empty** — `keybinding-presets/` exists but contains no `.json` files. Expected: the preset dropdown shows only "Default" and `"Save as preset…"`. No error or empty-state crash.

**EC-34: Preset folder contains a malformed `.json` file** — One or more files in `keybinding-presets/` are not valid JSON (e.g. truncated or syntactically broken). Expected: the malformed files are silently skipped with a `console.warn` identifying the filename; all valid preset files still load normally. The bar remains functional.

**EC-35: Preset file deleted from disk while the app is running** — A user (or external process) deletes a preset file from `keybinding-presets/` after the dropdown has already been populated for the current bar session. Expected: if the user then selects the deleted preset and presses Apply, the read attempt fails gracefully with an inline error notice `"Preset file not found"`. The bar does not close and the existing `keybindings.json` is unchanged. On the next bar open, the scan rebuilds the list and the deleted preset no longer appears.

**EC-36: Active preset file deleted while it is the `activePreset`** — The file backing the currently active preset is removed from disk between sessions. Expected: on the next session launch (or bar open), the scan does not find the file; the `activePreset` setting falls back to `"Default"` with a `console.warn`. The dropdown shows "Default" as selected. No crash.

---

## Resolved Decisions

**AD-01 — Extend the existing plugin rather than creating a new one**: The command bar already has 84 tests and a mature IIFE structure. A new plugin would duplicate the overlay, input, focus-trap, and fuzzy-ranker infrastructure. Extension minimizes risk.

**AD-02 — Files mode replaces Recent Files, not augments it**: The `showRecentFiles` category in Commands mode was a workaround for the absence of a dedicated file picker mode. Now that Files mode exists as a first-class mode, the Recent Files category is removed to eliminate confusion.

**AD-03 — Async file fetch with optimistic open**: Opening the bar immediately (before the file list resolves) meets NFR-01 and avoids a visible delay on `Cmd-P`. The `"Loading…"` state is a common UX pattern users recognize.

**AD-04 — Keybinding storage stays in `keybindings.json`**: The existing `resolveAction()` → `keybindings.json` pipeline is already in place. The Keybindings mode writes to the same file via the same API. No new storage mechanism is needed.

**AD-05 — Key-capture sub-state is inline (no separate modal)**: Opening a second overlay within the bar would add z-index and focus management complexity. The capture view replaces the results list area within the same bar panel — consistent with the existing single-overlay architecture.

**AD-06 — `Cmd-Q` and `Cmd-W` are captured by `preventDefault` inside the bar**: The bar's keydown handler already calls `preventDefault` + `stopPropagation` on all keys. This is the correct behavior — while the bar is open, those combos trigger the conflict flow rather than quitting or closing a tab.

**AD-07 — Presets are file-based, not hardcoded**: No preset other than "Default" is hardcoded in the application. Users and the community distribute preset files by dropping `.json` files into `keybinding-presets/`. This matches the custom-themes pattern, avoids hard-coding taste decisions into the app, and makes the system extensible without code changes.

**AD-08 — Files mode scan is recursive**: `list_md_files` already supports recursion (Backlinks depends on it). Restricting Files mode to a flat scan would produce an inconsistent and less useful result for users with nested directory structures. The 200-entry cap prevents performance issues on very large trees.

**AD-09 — Pressing a different mode's shortcut while the bar is open switches modes, not closes**: Closing via the opening shortcut is reserved for the "toggle same mode" case (FR-01.8). Switching to a different mode via shortcut is more useful and avoids accidental dismissal when the user simply wants a different mode.

**AD-10 — `resolveAction()` invalidation is in-memory only**: No page reload, Tauri event, or plugin restart is needed. A version counter or custom DOM event is sufficient because `resolveAction()` runs in the same JS context as the keybinding write. The Architect chooses the exact mechanism.

---

## Proposed Constraints

1. The plugin must not import any app-internal modules. All cross-boundary communication goes through `window` globals.
2. The async workspace file fetch must be guarded by a generation counter or `_isOpen` check so that stale results from a prior open do not render after the bar is closed (EC-28).
3. Key capture must call `event.preventDefault()` on every keydown event while in sub-state, including `Cmd-Q` and `Cmd-W`, to prevent destructive system actions while the bar has focus (EC-19, EC-20).
4. All new CSS follows the existing `cb-` BEM-style prefix and uses only CSS variables for colors and fonts.
5. Test file `tests/plugins/command-bar/command-bar.test.ts` must export all new pure functions (mode-switch logic, conflict check, preset loader, key-capture state machine) for isolated unit testing. No logic that requires a live DOM may live in non-testable closures.
6. Preset files in `keybinding-presets/` are written via `api.saveSettings()` using the preset filename as the key (or an equivalent plugin-API-mediated write), not via a raw Tauri `write_file` call. The active preset name is persisted in plugin settings via `api.saveSettings()`.
7. Preset files must be validated on load: each `.json` file must parse successfully and its root value must be an object. Invalid files are skipped with a `console.warn` naming the offending file; they do not prevent valid preset files from loading.
