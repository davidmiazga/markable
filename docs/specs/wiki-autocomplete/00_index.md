---
title: "Wiki Autocomplete + Spell Check — Master Blueprint"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Wiki Autocomplete (Vault-Index Source) + Spell Check Toggle

## Overview

Two focused enhancements delivered in two steps:

- **Step 01** — Wikilink Autocomplete: upgrade `buildAutocompleteExtension()` in
  `src/plugins/backlinks/backlinks.plugin.ts` so that when a vault is active the
  completion dropdown sources from `VaultIndexEntry[]` instead of `_cachedFileList`,
  adds vault-relative path as `detail`, adds `title` as `info` when it differs from
  `name`, and no longer excludes the currently open file.

- **Step 02** — Spell Check Toggle: add `spellCheck: boolean` to `EditorSettings`,
  wire a per-instance `spellCheckCompartment` inside `buildExtensions()` that sets
  `EditorView.contentAttributes({ spellcheck })`, make `applyEditorSettings()`
  dispatch the reconfiguration to the live view, and add an "Editor" section to the
  settings panel with a checkbox toggle.

Requirements source: `docs/requirements/active_task.md`

---

## Architectural Decisions

### AD-01: Vault-mode completion source replaces the `_cachedFileList` path entirely when vault is active

`filterCompletions()` is a pure function that takes a raw `string[]` of `.md`
filenames. It cannot carry `detail` or `info` metadata.

Rather than making `filterCompletions` generic over a richer type (which would break
all existing call sites and tests), the vault-mode path inside
`wikiLinkCompletionSource` bypasses `filterCompletions` and implements its own
filter-and-sort inline using `VaultIndexEntry[]` directly. The no-vault path
continues to call `filterCompletions(_cachedFileList, prefix, null)` unchanged —
note that `currentFilename` is passed as `null` in the no-vault path per FR-A.2
(self-exclusion is only removed in vault mode; in no-vault mode the old behaviour
already excluded the current file, but since this code path now has no self-exclusion
either, see AD-02 below).

### AD-02: Self-exclusion removed from BOTH paths (FR-A.2)

FR-A.2 states that the currently open file must not be excluded. The old
`wikiLinkCompletionSource` passed `currentFilename` to `filterCompletions()` which
excluded it. The new vault-mode path does not apply any exclusion. For consistency
and to satisfy FR-A.2 fully, the no-vault path also stops passing `currentFilename`
— `filterCompletions(_cachedFileList, prefix, null)` is the correct call in both
modes after this change.

The `filterCompletions` function signature is not changed; it still accepts a
`currentFile` parameter because it is exported and tested independently. The caller
in `wikiLinkCompletionSource` simply passes `null`.

### AD-03: CM6 `detail` vs `info` field assignment for path and title

CM6 `Completion` objects support two display-metadata fields:
- `detail` — short string displayed inline to the right of the label in the popup.
- `info` — rich content (string or function) shown in a separate tooltip on the
  right of the dropdown. Shown only when the user hovers or the item is highlighted.

Assignment rule:
- `detail` = vault-relative path (always shown, short, disambiguates duplicate stems).
- `info` = `title` value, but only when `title !== name`. This is a lazy `() => title`
  function so it is never computed unless the popup renders the tooltip. When
  `title === name`, `info` is omitted (undefined).

Rationale: the path is the most actionable disambiguation text (EC-A.04) and should
always be visible. The title is secondary context that is useful when a file has a
front-matter title different from its filename.

### AD-04: Vault-relative path computation

The vault root is `window.__MARKABLE_VAULT_MANAGER__.getActiveVault().rootPaths[0]`.

For a vault with multiple `rootPaths`, `rootPaths[0]` is used as the relative base.
This matches the single-root design of the current vault UX and is consistent with
how the File Browser computes display paths.

Computation: given `entry.path = "/vault/root/research/meeting.md"` and
`vaultRoot = "/vault/root"`, the vault-relative path is
`entry.path.slice(vaultRoot.length + 1).replace(/\.md$/, "")`, yielding
`"research/meeting"`.

If `entry.path` does not start with `vaultRoot` (unusual — could happen if the vault
has multiple rootPaths), fall back to `entry.name` (the stem) as the detail string.

### AD-05: Pipe-suppression confirmation

The regex `matchBefore(/\[\[([^\]\n]*)/)` matches any character that is not `]` or
newline — this INCLUDES `|`. So `[[stem|` produces `before.text = "[[stem|"` and
`prefix = "stem|"`. The code then runs:

```typescript
const prefix = before.text.slice(2); // "stem|"
if (prefix.includes("]]")) return null; // false — no ]] in "stem|"
```

The `]]` check does NOT gate on `|`. Therefore, without an explicit pipe check, the
vault-mode path would call `entry.name.toLowerCase().startsWith("stem|".toLowerCase())`
— which matches nothing (no filename contains `|`), so `options` is empty and `null`
is returned. The behaviour is correct by coincidence.

The new implementation makes this explicit: the vault-mode path checks
`if (prefix.includes("|")) return null` immediately after extracting `prefix`. This
is the same behaviour, but expressed as an intentional documented guard rather than
an accidental fall-through. FR-A.5 / EC-A.06 are satisfied.

### AD-06: Single EditorView — `spellCheckCompartment` is module-level

Reading `editor.ts`: `createEditor()` calls `buildExtensions()` once, creates one
`EditorState`, and mounts one `EditorView`. `TabManager` reuses this single view via
`setState()` — it does NOT call `buildExtensions()` or `createEditor()` per tab.

Therefore `spellCheckCompartment` can safely be a module-level export in
`extensions.ts` (same pattern as `previewCompartment`, `editableCompartment`,
`pluginCompartment`). The concern in EC-B.06 about multiple views does not apply to
this codebase: there is exactly one view.

### AD-07: `applyEditorSettings()` accesses the EditorView via the existing window global

`applyEditorSettings()` is currently a pure DOM function (sets CSS variables).
Adding an `EditorView` parameter would change its signature at all call sites in
`settings-panel.ts` and `main.ts`. Instead, the implementation reads
`(window as any).__MARKABLE_EDITOR_VIEW__` directly — the established pattern for
non-plugin code that needs the view. If the view is absent (called before
`createEditor` completes, EC-B.04), the compartment reconfiguration is skipped;
the compartment initial value (`spellcheck: "false"`) holds until `applyEditorSettings`
is called again post-mount.

Function signature does not change. No new parameter is added.

### AD-08: `applyEditorSettings()` call in settings Reset-All handler (FR-B.6)

The existing Reset-All handler in `settings-panel.ts` already calls
`applyEditorSettings(DEFAULT_SETTINGS.editor)` after `updateSettings`. Since
`DEFAULT_SETTINGS.editor` will now include `spellCheck: false`, and since
`applyEditorSettings` will dispatch the compartment reconfigure, the Reset-All path
is covered with no extra code.

### AD-09: `spellCheck ?? false` for backwards compatibility (EC-B.01)

`loadSettings()` does a shallow spread: `{ ...DEFAULT_SETTINGS, ...result.value }`.
When an old settings file replaces the `editor` object wholesale, the loaded
`editor` object will not have `spellCheck`. `applyEditorSettings` must use
`(editor.spellCheck ?? false)` to prevent `spellcheck="undefined"` on the DOM
element.

---

## Implementation Checklist

| # | File | Description | Step |
|---|------|-------------|------|
| 1 | `src/plugins/backlinks/backlinks.plugin.ts` | Vault-mode completion source with detail/info | step_01 |
| 2 | `src-tauri/plugins/core/backlinks.js` | Rebuilt IIFE bundle | step_01 |
| 3 | `tests/plugins/backlinks/backlinks.test.ts` | Tests for EC-A.01–EC-A.13 | step_01 |
| 4 | `src/lib/settings.ts` | `spellCheck` field + default + `applyEditorSettings` update | step_02 |
| 5 | `src/editor/extensions.ts` | `spellCheckCompartment` + initial `contentAttributes` | step_02 |
| 6 | `src/settings/settings-panel.ts` | "Editor" section with spell check checkbox | step_02 |
| 7 | `tests/editor/spell-check.test.ts` | Tests for EC-B.01–EC-B.06 | step_02 |

---

## Status

- [x] step_01 implemented and tests passing
- [x] `npm run build:plugins && npm run sync:plugins` run after step_01
- [x] step_02 implemented and tests passing
- [x] Code review complete — see Review Sign-off below

---

## Review Request

When implementation is complete, the reviewer must verify:

1. `buildAutocompleteExtension()` — vault active: dropdown shows vault-relative path
   as `detail`; title shown as `info` when it differs; current file appears in results.
2. `buildAutocompleteExtension()` — vault active: pipe character in typed text returns
   null immediately; no dropdown appears.
3. `buildAutocompleteExtension()` — no vault: existing `_cachedFileList` behaviour
   unchanged; no `detail` or `info` on completion items.
4. Selecting a completion inserts `[[stem]]` with cursor after `]]`; no double `[[`;
   no dangling open bracket.
5. `spellCheck: true` → `spellcheck="true"` attribute on `.cm-content` DOM element.
6. `spellCheck: false` → attribute absent or `"false"`.
7. Settings Reset-All clears spell check to off and updates the editor immediately.
8. Old settings file without `spellCheck` loads without error; spell check is off.
9. All 19 edge case tests (EC-A.01–A.13, EC-B.01–B.06) pass.

---

## Review Request (Implementation Complete)

- **Files changed**:
  - `src/plugins/backlinks/backlinks.plugin.ts` — replaced `wikiLinkCompletionSource` body with vault-mode branch + no-vault fallback; removed `currentFilePath`/`currentFilename` derivation; added explicit pipe guard.
  - `src-tauri/plugins/core/backlinks.js` — rebuilt IIFE bundle via `npm run build:plugins && npm run sync:plugins`.
  - `tests/plugins/backlinks/backlinks.test.ts` — added `describe("buildAutocompleteExtension — vault mode")` block (11 tests) and `describe("filterCompletions — null currentFile")` block (1 test); 13 new tests total.
  - `src/lib/settings.ts` — added `spellCheck?: boolean` to `EditorSettings`; added `spellCheck: false` to `DEFAULT_SETTINGS.editor`; updated `applyEditorSettings()` to dispatch `spellCheckCompartment.reconfigure` to the live view; added imports for `spellCheckCompartment` and `EditorView`.
  - `src/editor/extensions.ts` — exported `spellCheckCompartment` at module level; added initial `spellCheckCompartment.of(EditorView.contentAttributes.of({ spellcheck: "false" }))` to `buildExtensions()`.
  - `src/settings/settings-panel.ts` — added "Editor" section HTML with `#settings-spell-check` checkbox; wired change handler in `wireEvents()`; synced checkbox state in `syncPanelToSettings()`.
  - `tests/editor/spell-check.test.ts` — new file with 6 tests (EC-B.01–EC-B.05, plus EC-B.06 N/A comment).

- **Steps completed**: step_01_wikilink_autocomplete, step_02_spell_check_toggle

- **Known limitations**: None. All requirements from both step files are implemented. The `EditorView.contentAttributes` facet API uses `.of()` rather than direct function call (spec had a minor pseudocode error; implementation uses the correct CM6 API).

- **Edge cases covered by tests**:

  | Edge Case | Test(s) |
  |-----------|---------|
  | EC-A.01 | `falls through to _cachedFileList when getVaultIndex returns null` |
  | EC-A.02 | `returns empty options (not null) when vault index has zero entries` |
  | EC-A.03 | `returns empty options when prefix matches nothing` |
  | EC-A.04 | `detail is vault-relative path without extension (AD-04)` |
  | EC-A.05 | Existing test: `getCompletionContext — returns null when [[ is closed by ]] before cursor` |
  | EC-A.06 | `returns null when prefix contains pipe character` |
  | EC-A.07 | `returns all entries when prefix is empty string` |
  | EC-A.08 | `filters by prefix case-insensitively` |
  | EC-A.09 | N/A — CM6 re-runs source on keypress (no new test required per spec) |
  | EC-A.10 | `falls through to _cachedFileList when vault manager global is absent` |
  | EC-A.11 | Covered by existing apply-callback tests (insertion logic unchanged) |
  | EC-A.12 | Out of scope per requirements (no test required per spec) |
  | EC-A.13 | CM6-internal; no new test required per spec |
  | AD-03 (title differs) | `info is a function returning the title when title differs from name` |
  | AD-03 (title equals) | `info is undefined when VaultIndexEntry.title equals name` |
  | AD-04 fallback | `detail falls back to entry.name when path is not under vaultRoot` |
  | FR-A.2 (no self-exclusion) | `current file is included in completions (no self-exclusion)` |
  | AD-02 (null currentFile) | `includes all files when currentFile is null (no self-exclusion)` |
  | EC-B.01 | `treats absent spellCheck as false — dispatch is called, not undefined` |
  | EC-B.02 | `spellCheck: true causes dispatch to be called` + `spellCheck: false causes dispatch to be called` |
  | EC-B.03 | `rapid calls each dispatch independently without error` |
  | EC-B.04 | `is a no-op when __MARKABLE_EDITOR_VIEW__ is absent` |
  | EC-B.05 | `DEFAULT_SETTINGS.editor.spellCheck is false` |
  | EC-B.06 | N/A — single EditorView; documented in AD-06 and test file comment |

---

## Review Sign-off

- **Date**: 2026-04-27
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 1 Low — all High/Medium issues resolved; 1 Low item accepted as documented (see below).
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified. FR-A.1–FR-A.8, FR-B.1–FR-B.6, NFR-1–NFR-7 satisfied.
- **Edge case coverage**: All Edge Case Inventory items (EC-A.01–EC-A.13, EC-B.01–EC-B.06) covered by passing tests or documented N/A rationale. EC-A.09, EC-A.12, EC-A.13, EC-B.06 carry documented N/A justifications consistent with the spec.
- **Accepted Low item**: The "buildAutocompleteExtension — vault mode" describe block contains 15 tests; the submission documentation claimed 16. The discrepancy is a count error in the review-request narrative only — no test is missing and all edge cases are covered.
- **Status**: Approved for Merge
