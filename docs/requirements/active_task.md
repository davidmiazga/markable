---
title: "Wikilink Autocomplete (Vault-Index Source) + Spell Check Toggle"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Wikilink Autocomplete (Vault-Index Source) + Spell Check Toggle

## Validation Status

**VALIDATED — requirements approved for handoff.**

---

## 1. Feature Summaries

**Feature A — Wikilink Autocomplete (Vault-Index Source)**
As a user I want typing `[[` in the editor to show an inline autocomplete dropdown of every `.md` file in the active vault, filtered as I type, so I can insert a correctly formatted `[[stem]]` link without leaving the keyboard.

**Feature B — Spell Check Toggle**
As a user I want a "Spell check" toggle in the Editor settings section so I can enable or disable the browser's native spell-check underlines on editor content, with the setting persisted across sessions.

---

## 2. Background and Codebase Context

### 2.1 Existing Autocomplete Infrastructure (Feature A)

The backlinks plugin (`src/plugins/backlinks/backlinks.plugin.ts`) already contains a working autocomplete implementation. The following functions exist and are exported for testing:

- `getCompletionContext(lineText, cursorInLine)` — pure helper; detects open `[[` context and returns `{ from, prefix }` or `null`.
- `filterCompletions(cachedFileList, prefix)` — pure helper; filters filenames by prefix and strips `.md` extension.
- `setCachedFileList(files: string[])` — updates the module-level `_cachedFileList` array used as the completion source.
- `buildAutocompleteExtension()` — builds the CM6 `autocompletion()` extension with `wikiLinkCompletionSource` as the override.

The `buildIndex()` function (Step 7) currently calls `setCachedFileList()` with the result of `list_md_files` (a flat filename list). When a vault is active, `scheduleIndexRebuild` uses `getVaultIndex()` entries to populate the same cache via `e.name + ".md"`.

**The change required by Feature A** is:
1. The autocomplete dropdown must source completions from the vault index (`VaultIndexEntry[]`) when a vault is active — specifically using `VaultIndexEntry.name` as the stem and either `VaultIndexEntry.title` or vault-relative path as the detail line shown in the dropdown.
2. When no vault is active, the existing `_cachedFileList` fallback (populated from `list_md_files`) continues unchanged — no regression on pre-vault workflows.

No new plugin or new CM6 extension is needed. The Architect must determine whether `buildAutocompleteExtension` and the completion source need modification to carry `detail` text from vault index entries, or whether a separate vault-aware completion source is wired in alongside the existing one.

### 2.2 Spell Check (Feature B)

`applyEditorSettings()` in `src/lib/settings.ts` currently applies CSS variables for font size and content width. It does not touch `contentAttributes`. The `EditorSettings` interface does not have a `spellCheck` field. The `buildExtensions()` function in `src/editor/extensions.ts` does not include any `contentAttributes` extension. The settings panel (`src/settings/settings-panel.ts`) has an "Appearance" and a "Tabs" section but no "Editor" section. There is no existing spell-check control anywhere in the codebase.

---

## 3. Feature A — Functional Requirements: Wikilink Autocomplete

### FR-A.1 — Trigger

The autocomplete dropdown must activate whenever the CM6 cursor position immediately follows `[[` with zero or more characters that are not `]` or newline. Concretely: the `matchBefore(/\[\[([^\]\n]*)/)` pattern used by the existing `wikiLinkCompletionSource` is the canonical trigger definition. No other trigger mechanism is required.

The dropdown must activate on explicit invocation (the user types `[[` and then characters) and must NOT re-trigger when the cursor moves into or after an already-closed `[[stem]]` link.

### FR-A.2 — Completion Source: Vault-Active Mode

When the active vault's index is available (i.e., `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex()` returns a `VaultIndex` with a non-empty `entries` array), the completion source must:

- Use `VaultIndexEntry.name` as the completion label (the stem, without `.md`).
- Use the vault-relative path of the file as the `detail` string shown in the dropdown (e.g., `"research/meeting"` for a file at `<vault-root>/research/meeting.md`). The vault root is available from `window.__MARKABLE_VAULT_MANAGER__` — the Architect must identify the correct accessor.
- If `VaultIndexEntry.title` differs from `VaultIndexEntry.name` (i.e., the file has a front-matter title or an H1 different from the filename stem), display `title` as the CM6 `info` or `detail` field so the user can distinguish files with the same stem. The Architect will decide whether to use the CM6 `detail` or `info` property for the path vs. title distinction.
- Filter completions using the typed prefix (text after `[[` up to the cursor), case-insensitively.
- Sort completions alphabetically by stem (locale-insensitive, case-insensitive), matching the existing `filterCompletions` sort behavior.
- The currently open file must NOT be excluded from completions (self-linking is a valid pattern in PKM workflows).

### FR-A.3 — Completion Source: No-Vault Fallback Mode

When no vault is active, or when `getVaultIndex()` returns `null` or an index with zero entries, the completion source must fall back to the existing `_cachedFileList` behavior (populated by `list_md_files` via `setCachedFileList`). No `detail` text is shown in this mode (preserves existing behavior).

If `_cachedFileList` is also empty (e.g., fresh untitled document, no directory scanned), the completion source returns `null` (no dropdown shown). This is not an error state.

### FR-A.4 — Completion Insertion

Selecting a completion item must:

- Replace the typed partial stem (the text between `[[` and the cursor) with the selected stem, and close the link with `]]`.
- Result in `[[stem]]` with the cursor positioned immediately after `]]`.
- Not insert `[[` a second time (the user has already typed `[[`; the completion source's `from` position starts after `[[`).
- Not leave a dangling or unclosed `[[` in any code path.

The CM6 `apply` callback on the `Completion` object controls insertion behavior. The Architect must implement an `apply` function that replaces from `before.from + 2` (after the `[[`) to `context.pos` (current cursor) with `stem + "]]"`. This is the same approach used in the existing implementation; it must be verified to work correctly when the user has typed a partial prefix (e.g., `[[not` → select `notes` → result is `[[notes]]`).

### FR-A.5 — Pipe Syntax: No Retrigger on Display Text

If the user types `[[stem|` and continues typing, the autocomplete must NOT re-trigger for the display-text portion. The existing `matchBefore(/\[\[([^\]\n]*)/)` pattern already captures text containing `|` because `|` is not excluded from `[^\]\n]`. The `getCompletionContext` pure helper must be verified to return `null` when a `|` is present between `[[` and the cursor, OR the completion source must detect a `|` in the matched prefix and return `null` explicitly. The Architect must confirm or fix the pipe-suppression behavior before implementation.

### FR-A.6 — Already-Closed Link: No Retrigger

When the cursor is positioned inside or after a fully closed `[[stem]]` (i.e., a `]]` exists between the `[[` and the cursor position), the completion source must return `null`. The existing `getCompletionContext` already implements this check — it must be preserved.

### FR-A.7 — Works in Both Preview Modes

The autocomplete extension must function identically in live-preview mode (the `previewCompartment` active) and in plain-syntax mode. No mode-switching logic is required; since both modes use the same underlying CM6 `EditorState`, the completion source operates on raw document text in both cases.

### FR-A.8 — Performance

The vault index is in-memory. No Tauri IPC call and no disk I/O is permitted inside the completion source callback. The completion source reads `VaultIndexEntry[]` directly from the in-memory object returned by `getVaultIndex()`. For a vault of up to 500 files (the documented `maxIndexSize`), the completion source must produce its result set within the synchronous execution time of a single CM6 update cycle (target: under 5ms on a modern Apple Silicon chip). No debouncing or async completion sources are required.

---

## 4. Feature A — Edge Case Inventory

**EC-A.01: No vault active, no directory scanned** — `getVaultIndex()` returns null and `_cachedFileList` is empty. Completion source returns `null`. No dropdown is shown. No error is thrown.

**EC-A.02: Vault active but index is empty (zero entries)** — `getVaultIndex()` returns a `VaultIndex` with `entries: []`. The vault-mode completion path produces an empty options array. No dropdown is shown (CM6 hides the dropdown when `options` is empty). The fallback to `_cachedFileList` does NOT apply — an active vault with zero entries is a legitimate vault-mode result, not a missing-vault scenario.

**EC-A.03: Typed prefix matches no stems** — e.g., user types `[[zzz` and no file has a stem starting with `zzz`. The completion source returns `{ from, options: [] }`. CM6 hides the dropdown. No error.

**EC-A.04: Two files share the same stem in different folders** — e.g., `notes/meeting.md` and `work/meeting.md`, both have `name: "meeting"`. Both appear in the dropdown as separate completions. The `detail` field (vault-relative path) disambiguates them visually. Both are selectable and both insert `[[meeting]]` on selection (bare-stem insertion — path qualification is out of scope for v1).

**EC-A.05: Cursor is placed inside an already-closed `[[stem]]`** — e.g., document contains `[[notes]]` and the user clicks between `[` and `n`. The completion source must return `null` because `getCompletionContext` detects the `]]` closure. No dropdown appears.

**EC-A.06: User types `[[stem|` (pipe present)** — The completion source detects the `|` in the matched prefix and returns `null`. No dropdown appears for the display-text portion. The Architect must confirm this is correctly handled by `getCompletionContext` or add a `|`-check in the completion source.

**EC-A.07: Completion selected when prefix is empty — `[[` with cursor immediately after** — `getCompletionContext` returns `{ from: <pos after [[>, prefix: "" }`. All vault stems are shown unfiltered. Selecting one inserts `[[stem]]`. The cursor lands after `]]`.

**EC-A.08: Completion selected when partial prefix present** — e.g., `[[not` → user selects `notes`. The `apply` callback replaces from `before.from + 2` to `context.pos` (current cursor, which is after `t`) with `"notes]]"`. The result is `[[notes]]`. No duplicate `[[` or stray characters.

**EC-A.09: Vault index refreshes while dropdown is open** — The vault watcher triggers a `getVaultIndex()` update while the user has the autocomplete dropdown visible. The completion source re-runs on the next keypress and reflects the new index. There is no mechanism to update an already-rendered dropdown mid-display; this is acceptable (CM6 behavior). No crash or stale pointer.

**EC-A.10: `window.__MARKABLE_VAULT_MANAGER__` is undefined** — The vault manager global has not been set (e.g., the plugin is loaded before the vault manager initializes). The optional-chain accessor `?.getVaultIndex?.()` returns `undefined`. The completion source falls through to the `_cachedFileList` path. No error.

**EC-A.11: `VaultIndexEntry.name` contains special characters (spaces, hyphens, Unicode)** — e.g., `name: "meeting notes"`. The stem `"meeting notes"` is used as the label and inserted as `[[meeting notes]]`. No escaping is applied. CM6 displays the label verbatim. No crash.

**EC-A.12: Fenced code block context** — The user types `[[` inside a fenced code block. The existing `wikiLinkCompletionSource` uses `context.matchBefore()` on the raw document text. Whether completions suppress inside fenced code blocks depends on whether CM6's autocomplete respects language context. For v1, completions inside fenced code blocks are acceptable (not a regression from current behavior). If the Architect determines suppression is feasible via `context.tokenBefore()`, it may be added — but it is not a hard requirement.

**EC-A.13: Plugin disabled while dropdown is open** — The backlinks plugin is disabled (toggled off) via the plugins panel while the autocomplete dropdown is visible. CM6 reconfigures the `pluginCompartment`, removing the `autocompletion()` extension. CM6 closes any open autocomplete dropdown automatically on extension removal. No crash or orphaned UI.

---

## 5. Feature B — Functional Requirements: Spell Check Toggle

### FR-B.1 — Settings Key

A new boolean field `spellCheck` is added to the `EditorSettings` interface in `src/lib/settings.ts`. Default value: `false`. The `DEFAULT_SETTINGS.editor` object must include `spellCheck: false`.

### FR-B.2 — Applying the Setting to the Editor

When `spellCheck` is `true`, the editor's content element must have the HTML attribute `spellcheck="true"` applied. When `false` (or absent for backwards compatibility with old settings files that pre-date this field), the attribute must be absent or set to `"false"`.

The implementation mechanism is `EditorView.contentAttributes({ spellcheck: booleanValue ? "true" : "false" })`. This extension must be hot-swappable without a full editor rebuild. The Architect must introduce a new `Compartment` — named `spellCheckCompartment` — in `src/editor/extensions.ts`, initialized to `spellCheckCompartment.of(EditorView.contentAttributes({ spellcheck: "false" }))`. When the setting changes, `applyEditorSettings()` must dispatch a `spellCheckCompartment.reconfigure(...)` effect to the active `EditorView`.

The `applyEditorSettings()` function in `src/lib/settings.ts` requires access to the active `EditorView` to dispatch the reconfiguration. The Architect must determine the cleanest injection pattern (e.g., accept an optional `view?: EditorView` parameter, or use the existing `window.__MARKABLE_EDITOR__` global if one exists, or add a setter function). This architectural decision must be documented in the spec.

### FR-B.3 — Settings Panel UI

A new "Editor" section must be added to the settings panel in `src/settings/settings-panel.ts` (currently no Editor section exists). The section must be labeled `"Editor"` and must contain:

- A checkbox-style toggle row labeled `"Spell check"`.
- A brief description below the toggle: `"Underline misspelled words using the system dictionary."` (or equivalent short copy; the Architect may refine wording).

The toggle element must use the existing settings panel's checkbox markup pattern (matching the "Maximize on Launch" checkbox as a structural reference). It must be wired to read the current `editor.spellCheck` value on panel open (`syncPanelToSettings`) and write the new value immediately via `updateSettings` on toggle change, followed by a call to `applyEditorSettings`.

### FR-B.4 — Persistence

The `spellCheck` value is persisted as part of the standard `MarkableSettings` object via the existing `updateSettings` / `saveSettings` flow. No new Tauri command or new settings file is required. Old settings files that pre-date this field load with `spellCheck` absent; the in-memory merge in `loadSettings` (`{ ...structuredClone(DEFAULT_SETTINGS), ...result.value }`) does not merge nested objects — it replaces `editor` wholesale. Therefore `DEFAULT_SETTINGS.editor.spellCheck` must be `false` to ensure the field is present after load when old files are opened.

> Note: the current merge strategy in `loadSettings` uses a shallow spread. Nested objects like `editor` are replaced by the persisted value, which will not contain `spellCheck` if the file predates this feature. The Architect must verify that `applyEditorSettings` treats an absent `spellCheck` field as `false` (i.e., uses `settings.editor.spellCheck ?? false`), not as `undefined`, which could incorrectly set `spellcheck="undefined"` on the content element.

### FR-B.5 — No Vault Dependency

Spell check is a pure editor attribute. It must work with or without an active vault and must not depend on the plugin system. It is part of the core editor setup, not a plugin extension.

### FR-B.6 — Reset to Defaults

The "Reset All" button in the settings panel footer calls `DEFAULT_SETTINGS`. After reset, `editor.spellCheck` is `false`. The editor's `spellCheckCompartment` must be reconfigured to `{ spellcheck: "false" }` as part of the reset flow.

---

## 6. Feature B — Edge Case Inventory

**EC-B.01: Old settings file without `spellCheck` field** — `result.value.editor` does not contain `spellCheck`. After the shallow merge in `loadSettings`, `currentSettings.editor` is the persisted `editor` object, which lacks `spellCheck`. `applyEditorSettings` must use `settings.editor.spellCheck ?? false` to prevent setting `spellcheck="undefined"` on the content element. Expected: spell check remains off; no attribute error.

**EC-B.02: Toggle on, close app, reopen** — `spellCheck: true` is written to `settings.json`. On next launch, `loadSettings` reads it, `applyEditorSettings` is called during init, and the editor content element receives `spellcheck="true"`. The setting survives a full app restart.

**EC-B.03: Toggle flipped rapidly multiple times** — Each toggle change dispatches a `spellCheckCompartment.reconfigure(...)` effect. CM6 handles compartment reconfiguration synchronously within a transaction; rapid successive dispatches do not cause errors or desync. The final toggle state is the one applied to the DOM.

**EC-B.04: Editor view not yet initialized when `applyEditorSettings` is called** — During the settings load sequence, `applyEditorSettings` may be called before the CM6 `EditorView` is constructed (e.g., if settings are applied before the editor is mounted). The Architect must ensure the `spellCheckCompartment.reconfigure` dispatch is a no-op or deferred when no `EditorView` is available. Expected: no crash; the initial compartment value (`{ spellcheck: "false" }`) holds until the view is available and `applyEditorSettings` is called again post-mount.

**EC-B.05: Settings panel "Reset All" with spell check enabled** — User has spell check on, clicks "Reset All." `DEFAULT_SETTINGS` has `spellCheck: false`. The settings panel checkbox updates to unchecked. `applyEditorSettings` is called with the reset settings, reconfiguring the compartment to `{ spellcheck: "false" }`. The red underlines disappear immediately.

**EC-B.06: Multiple editor tabs open** — Markable supports multiple tabs, each with its own CM6 `EditorState`. However, `buildExtensions` is called once per editor instance. The `spellCheckCompartment` is a module-level singleton. If `spellCheckCompartment.reconfigure` is dispatched on only one view, other tab views' compartments retain their current value. The Architect must determine whether `spellCheckCompartment` should be per-tab or shared, and document the decision. Suggested resolution: the compartment is per-tab (instantiated inside `buildExtensions` rather than at module level), and `applyEditorSettings` reconfigures all active editor views. Alternatively, since `contentAttributes` is a low-cost extension, it can be re-applied on tab switch.

---

## 7. Non-Functional Requirements

**NFR-1: Autocomplete latency** — The completion source (Feature A) must execute synchronously and complete within 5ms for a vault of up to 500 entries on Apple Silicon. No async operations are permitted inside the completion source callback.

**NFR-2: Autocomplete UX responsiveness** — The dropdown must appear within one frame (16ms) of the user typing `[[` or any character after `[[`. CM6's built-in `autocompletion()` handles display timing; no additional debounce is required beyond what CM6 applies by default. The `activateOnTyping` option (CM6 default: true) must not be overridden to false.

**NFR-3: No disk I/O in completion path** — The completion source reads only from the in-memory vault index. No Tauri `invoke()` calls are permitted in the hot path.

**NFR-4: Spell check toggle latency** — Toggling spell check in the settings panel must cause the editor's `spellcheck` attribute to change within one animation frame. A CM6 compartment reconfiguration dispatched synchronously in the toggle handler achieves this without any additional debouncing.

**NFR-5: Backward compatibility** — Both features must be additive only. No existing behavior is regressed. The backlinks plugin's existing autocomplete (in no-vault mode using `_cachedFileList`) must continue working without a vault. Settings files pre-dating these features must load without errors.

**NFR-6: CSS variable compliance** — Any new UI elements (settings section, toggle row) must use CSS variables for colors and typography, matching the existing settings panel conventions. No hardcoded hex or font values.

**NFR-7: Test coverage** — All edge cases in the Edge Case Inventories (Sections 4 and 6) must have a corresponding test in the appropriate test file, or a documented rationale for exclusion. Feature A tests belong in `tests/plugins/backlinks/backlinks.test.ts` (or a new `wikilink-autocomplete.test.ts` if the Architect judges the file size warrants a split). Feature B tests belong in a settings-focused test file; the Architect must determine the appropriate location given no dedicated settings test file currently exists.

---

## 8. Out of Scope (v1)

- Path-qualified autocomplete insertions (`[[folder/stem]]`). Bare-stem insertion only.
- Autocomplete for `[[stem|` display-text portion.
- Grammar checking or third-party spell-check dictionaries.
- Custom dictionary additions (OS-native spell check only).
- Suppressing autocomplete inside fenced code blocks (acceptable if trivially implemented; not required).

---

## Handoff Summary

- Artifact: docs/requirements/active_task.md
- Status: Requirements Validated
- Edge cases to verify in tests: 13 items in Edge Case Inventory (EC-A.01 through EC-A.13 for Feature A; EC-B.01 through EC-B.06 for Feature B)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
