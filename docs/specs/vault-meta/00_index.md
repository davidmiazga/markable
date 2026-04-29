---
title: Vault Meta System — Tag Browser + YAML Validation — Architecture Index
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Vault Meta System — Tag Browser + YAML Validation

## Architecture Overview

This feature adds three capabilities to Markable:

1. **Meta vocabulary storage** — a `{VaultName}_meta/` folder at the vault root; each field gets its own `{VaultName}_{fieldname}.md` bullet-list file.
2. **Tag Browser** — a new `"tags"` BarMode (⌘5) in the Command Bar that shows defined tags and uncategorised tags derived from the vault index.
3. **YAML chip validation** — `.yaml-pane-chip--warning` modifier on chips whose value is absent from the corresponding meta vocabulary.

The architecture uses four implementation layers:

```
Rust backend (vault.rs)
  └── build_vault_index ← add vault_name param; filter {name}_meta/ from walk

TypeScript core (src/lib/)
  └── meta-manager.ts     ← pure functions: sanitise, path helpers, parser, loader
  └── vault-manager.ts    ← pass vault.name to buildAndCacheIndex
  └── bridge.ts           ← no new commands (readFile + writeFile used as-is)

App bootstrap (src/main.ts)
  └── window.__MARKABLE_META__  ← populated on vault init + onVaultChanged
  └── onIndexUpdated handler    ← meta hot-reload when meta files change on disk

IIFE plugins (read window globals, cannot import ES modules)
  └── command-bar.plugin.ts     ← "tags" BarMode + tag browser renderer
  └── yaml-pane.plugin.ts       ← chip warning modifier from __MARKABLE_META__
```

---

## Stack Decision

No new technology is introduced. This feature extends the existing Tauri v2 + TypeScript + CodeMirror 6 stack:

- **Rust side**: extends `build_vault_index` with one new `String` parameter. No new crates (NFR-4).
- **TypeScript side**: one new ES module (`meta-manager.ts`); no new npm packages.
- **IIFE plugins**: reads `window.__MARKABLE_META__` set by `main.ts`. Pattern mirrors `window.__MARKABLE_VAULT_MANAGER__`.

---

## Data Flow

### Meta vocabulary load (on vault activation)

```
main.ts::initMeta(vault)
  → meta-manager.ts::buildMetaStore(vault, readFile)
    → bridge.ts::readFile("{root}/{name}_meta/{name}_tags.md")
    → bridge.ts::listFiles("{root}/{name}_meta/")   [scan other field files]
    → parseMetaBulletList(rawText)
  → window.__MARKABLE_META__ = { tags: [...], fields: {...}, vaultId }
```

### Meta hot-reload (file watcher event)

```
vaultManager.onIndexUpdated callback in main.ts
  → if event.path contains "{vaultName}_meta/"
    → re-run initMeta(activeVault)
    → window.__MARKABLE_META__ replaced in-place
```

### Tag Browser open (⌘5)

```
user presses ⌘5
  → openBar("tags") in command-bar.plugin.ts
  → renderTagsMode(query)
    → reads window.__MARKABLE_META__.tags        [defined section]
    → reads window.__MARKABLE_VAULT_MANAGER__.getVaultIndex().entries  [uncategorised]
    → DOM render (no Tauri calls)
```

### YAML chip validation (every rebuildPanelDOM call)

```
rebuildPanelDOM()
  → renderFieldControl(field, container)
    → renderChipWidget(field, container)
      → buildChipElement(val, ...) now calls isValueInVocabulary(fieldKey, val)
        → reads window.__MARKABLE_META__ synchronously
        → adds .yaml-pane-chip--warning + title attr when vocab non-empty and val absent
```

### Meta file write ("Add to meta" action)

```
user clicks "Add to meta" on uncategorised tag row
  → appendToMetaFile(tag, vault)
    → bridge.ts::writeFile(path, updatedContent)  [atomic swap on Rust side]
    → if ok: update window.__MARKABLE_META__.tags in-memory; re-render tag browser
    → if error: emit console.warn + toast; do NOT update in-memory (EC-14)
```

---

## Component Map

### New files to create

| File | Purpose |
|------|---------|
| `src/lib/meta-manager.ts` | Pure functions for meta path construction, parsing, and store building. Shared between main.ts and tests. ES module (not IIFE). |

### Existing files to modify

| File | Change summary |
|------|----------------|
| `src-tauri/src/commands/vault.rs` | Add `vault_name: String` param to `build_vault_index`; call `should_exclude_meta(rel, &sanitised_name)` in walk loop |
| `src/lib/vault-manager.ts` | Pass `vault.name` to `invoke("build_vault_index", ...)` in `buildAndCacheIndex()` |
| `src/main.ts` | Import `meta-manager.ts`; call `initMeta()` after vault init; subscribe `onVaultChanged` + `onIndexUpdated` for hot-reload; set `window.__MARKABLE_META__` |
| `src/plugins/command-bar/command-bar.plugin.ts` | Add `"tags"` to `BarMode`; extend all mode-keyed Record constants; add ⌘5 shortcut handler; add tags render path in `filterAndRender()` |
| `src/plugins/yaml-pane/yaml-pane.plugin.ts` | Modify `buildChipElement()` to call `isValueInVocabulary()`; add `.yaml-pane-chip--warning` CSS; suppress when vocab empty |

### Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/files.rs` | `read_file` / `write_file` used as-is |
| `src/lib/vault-types.ts` | `VaultIndexEntry.tags` already present; no new types needed here |
| `src/lib/settings.ts` | Meta path derived at runtime; no new settings |
| `src-tauri/src/lib.rs` | Window size invariant must not regress |

---

## Architecture Decisions

**AD-1 — TypeScript parses meta bullet lists (not a new Rust command)**
`readFile()` + in-TypeScript parsing is sufficient for small vocabulary files. Avoids new Rust surface area (NFR-4). `meta-manager.ts` owns `parseMetaBulletList()`.

**AD-2 — `window.__MARKABLE_META__` is the shared global between main bundle and IIFE plugins**
Pattern mirrors `window.__MARKABLE_VAULT_MANAGER__`. Set and refreshed by `main.ts`; plugins read it synchronously at render time with no I/O (NFR-7).

**AD-3 — Meta store is replaced atomically on vault change (no merge)**
`window.__MARKABLE_META__` is assigned a new object on every vault switch and every hot-reload. This prevents cross-vault contamination (EC-7) and stale-value bugs.

**AD-4 — Meta folder exclusion via `vault_name` param on `build_vault_index`**
The Rust walk already has `should_exclude()`. A companion `should_exclude_meta(rel_path, sanitised_meta_folder_name)` function checks whether any path component equals `{sanitised_name}_meta`. Called before the existing `should_exclude()` check. Non-breaking: callers that do not pass `vault_name` (none currently) would need updating; only `buildAndCacheIndex()` calls this command.

**AD-5 — `sanitiseVaultName()` is a pure TypeScript function in `meta-manager.ts`**
Replaces `/`, `:`, and null bytes with `_`. Also applied on the Rust side as a simple string replacement when constructing the meta folder component for comparison (no shared code path needed — both implementations are trivially identical one-liners).

**AD-6 — Tags render path in command-bar uses a new `renderTagsMode()` function analogous to `renderContentResults()`**
`filterAndRender()` gains a `_mode === "tags"` branch that calls `renderTagsMode(query)` directly, bypassing the standard `_allResults` / `_visibleResults` pipeline. The tags mode data is computed fresh from `window.__MARKABLE_META__` and `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex()` on every call — no stale result cache to invalidate.

**AD-7 — "Add to meta" is write-then-update (not optimistic)**
`writeFile()` is called first. On success, `window.__MARKABLE_META__.tags` is updated in-memory and the tag browser re-renders. On failure, neither update occurs and a warning is emitted (EC-14).

**AD-8 — YAML chip warning reads `window.__MARKABLE_META__` via a helper `getVocabularyForField(fieldKey)`**
Returns `string[] | null`. Returns `null` (not `[]`) when the field has no vocabulary, enabling the "null means no vocabulary defined; empty means vocabulary exists but is empty" distinction required by FR-11.

**AD-9 — Meta folder scan uses `bridge.ts::listFiles()` if available; falls back to individual `readFile` attempts**
On first pass: check if `listFiles` (or equivalent) is available in `bridge.ts`. If not, `main.ts` reads only the tags file by convention and skips the full meta folder scan for `fields`. A future step can add general field scanning without blocking this release.

**AD-10 — ⌘5 shortcut registered via the same keybindings mechanism as ⌘1–⌘4**
The command-bar IIFE registers its own shortcut handlers. The ⌘5 handler calls `openBar("tags")` following the exact same pattern as the existing ⌘1–⌘4 handlers.

---

## TypeScript Type Definitions

### `MetaStore` (defined in `src/lib/meta-manager.ts`, exported)

```typescript
export interface MetaStore {
  /** Tag vocabulary from the tags meta file. Empty when no file exists. */
  tags: string[];
  /** Field-name → vocabulary mapping for non-tags meta files. */
  fields: Record<string, string[]>;
  /** Vault id this meta belongs to. Used for stale-check. */
  vaultId: string | null;
}
```

### Window global declaration (in `src/lib/meta-manager.ts`)

```typescript
declare global {
  interface Window {
    __MARKABLE_META__: MetaStore;
  }
}
```

---

## Implementation Checklist

- [x] step_01 — Meta parser, vault_name exclusion, window global
  - [x] Create `src/lib/meta-manager.ts` with all pure functions
  - [x] Modify `src-tauri/src/commands/vault.rs`: add `vault_name` to `build_vault_index`
  - [x] Modify `src/lib/vault-manager.ts`: pass `vault.name` in `buildAndCacheIndex()`
  - [x] Modify `src/main.ts`: import meta-manager, call `initMeta`, subscribe hot-reload

- [x] step_02 — Tag Browser
  - [x] Add `"tags"` to `BarMode` union
  - [x] Extend all 5 mode-keyed Record constants (`MODE_PLACEHOLDERS`, `MODE_FOOTER_HINTS`, `MODE_BADGE_LABELS`, `MODE_TAB_SHORTCUTS`, `MODE_CYCLE`)
  - [x] Add ⌘5 shortcut handler in command-bar IIFE
  - [x] Add `renderTagsMode(query)` function
  - [x] Add `appendToMetaFile(tag, vault)` helper
  - [x] Handle all 4 empty states (FR-7) and EC-17 (index still loading)

- [x] step_03 — YAML chip validation
  - [x] Add `getVocabularyForField(fieldKey)` helper reading `window.__MARKABLE_META__`
  - [x] Modify `buildChipElement()` to accept vocabulary check
  - [x] Add `.yaml-pane-chip--warning` CSS class with amber border using CSS variables
  - [x] Add `title` attribute to warning chips

- [x] step_04 — Tests
  - [x] `meta-manager.ts` unit tests (pure functions) — 38 tests
  - [x] Rust `build_vault_index` meta exclusion tests — 11 new Rust tests (161 total pass)
  - [x] Command-bar tags mode unit tests — 11 tests in `tags-mode.test.ts`
  - [x] YAML pane chip warning unit tests — 14 tests in `chip-warning.test.ts`

---

## Deferred Work (Out of Scope for This Release)

- General field vocabulary scanning (only tags file handled in v1; `fields` map populated if a `listFiles` bridge function exists — see AD-9)
- Tag autocomplete in the editor
- Non-array field validation (string fields with meta vocabulary)
- Case-insensitive vocabulary comparison
- Multi-root vault meta folder selection

---

## Requirements Traceability

| Requirement | Addressed by |
|-------------|-------------|
| FR-1 (meta folder creation on demand) | step_01: `ensureMetaFile()` in meta-manager.ts |
| FR-2 (meta vocabulary loading) | step_01: `buildMetaStore()` + main.ts `initMeta()` |
| FR-3 (MetaStore shape) | step_01: `MetaStore` interface in meta-manager.ts |
| FR-4 (meta files excluded from vault index) | step_01: vault.rs `build_vault_index` + vault-manager.ts |
| FR-5 (⌘5 tag browser mode) | step_02: BarMode union + mode constants + shortcut |
| FR-6 (tag browser layout) | step_02: `renderTagsMode()` + section headers + file expansion |
| FR-7 (empty states) | step_02: four empty-state branches in `renderTagsMode()` |
| FR-8 ("Add to meta" action) | step_02: `appendToMetaFile()` + "Add to meta" button on uncategorised rows |
| FR-9 (YAML tag chip warnings) | step_03: `buildChipElement()` modification + `.yaml-pane-chip--warning` |
| FR-10 (non-tags field validation) | step_03: `getVocabularyForField()` reads `fields` map |
| FR-11 (suppress warnings when vocab empty) | step_03: null-check in `getVocabularyForField()` |
| FR-12 (meta hot reload) | step_01: `onIndexUpdated` handler in main.ts |
| FR-13 (sanitised vault name) | step_01: `sanitiseVaultName()` in meta-manager.ts |
| EC-1 through EC-20 | Covered by step_04 test spec |
| NFR-1 (non-blocking load) | step_01: fire-and-forget `initMeta()` in main.ts |
| NFR-2 (tag browser ≤100 ms) | step_02: pure in-memory DOM construction, no Tauri calls |
| NFR-3 (CSS variables only) | step_02 + step_03: all new CSS uses var(--*) |
| NFR-4 (no new Cargo deps) | step_01: no new crates |
| NFR-5 (Record<BarMode, string> exhaustive) | step_02: all 4 records extended |
| NFR-6 (meta folder excluded) | step_01: Rust walk exclusion |
| NFR-7 (validation synchronous) | step_03: synchronous window global read |

---

## Review Request

- **Files changed**:
  - `src/lib/meta-manager.ts` (created) — pure functions: MetaStore, sanitiseVaultName, metaFolderPath, metaFilePath, parseMetaBulletList, buildMetaStore, emptyMetaStore, isMetaFolderEvent, getVocabularyForField
  - `src-tauri/src/commands/vault.rs` (modified) — add vault_name param to build_vault_index; add sanitise_vault_name() and is_meta_folder_component() helpers; 11 new Rust tests
  - `src/lib/vault-manager.ts` (modified) — pass vaultName to build_vault_index invoke
  - `src/main.ts` (modified) — initMeta(), window.__MARKABLE_META__ setup, onVaultChanged + onIndexUpdated hot-reload subscriptions, command-bar-open-tags action handler
  - `src/plugins/command-bar/command-bar.plugin.ts` (modified) — tags BarMode, all mode-keyed Record constants extended, renderTagsMode(), buildTagRows() (exported), handleAddToMeta(), tag browser CSS
  - `src/plugins/yaml-pane/yaml-pane.plugin.ts` (modified) — getVocabularyForField() (exported), buildChipElement() warning logic, .yaml-pane-chip--warning CSS
  - `src/keybindings/keybindings-panel.ts` (modified) — command-bar-open-tags keybinding entry
  - `tests/lib/meta-manager.test.ts` (created) — 38 tests for all meta-manager.ts pure functions
  - `tests/plugins/command-bar/tags-mode.test.ts` (created) — 11 tests for buildTagRows()
  - `tests/plugins/yaml-pane/chip-warning.test.ts` (created) — 14 tests for getVocabularyForField() and buildChipElement() warning modifier
  - `tests/plugins/command-bar/command-bar.test.ts` (modified) — 3 existing tests updated to reflect 5-mode MODE_CYCLE (was 4)

- **Steps completed**:
  - step_01_meta_parser.md
  - step_02_tag_browser.md
  - step_03_yaml_validation.md
  - step_04_tests.md

- **Known limitations**:
  - General field vocabulary scanning (`fields` map) is limited to the `tags` file only in v1. The `fields` key in `MetaStore` is always `{}` until AD-9 is revisited. Deferred per the "Out of Scope" section above.
  - "Add to meta" write failure (EC-14) is covered only by console.warn + toast, not unit-testable because mocking Tauri invoke inside an IIFE is impractical in the unit test environment.
  - EC-19 (⌘5 with no vault open) and EC-20 (concurrent write safety) are manual-test only as noted in the edge case coverage matrix in step_04_tests.md.

- **Edge cases covered by tests**:
  - EC-1 (no vault): tags-mode.test.ts "EC-1: returns empty sections when no vault is open"; chip-warning.test.ts "does NOT add warning class when no meta global is set"
  - EC-2 (no meta file): meta-manager.test.ts "returns empty tags when file does not exist"
  - EC-3 (empty meta file): meta-manager.test.ts "returns empty tags when file exists but is empty", "returns empty array for heading-only content"
  - EC-4 (duplicate entries): meta-manager.test.ts "deduplicates entries from meta file"
  - EC-5 (tag in index not in meta): tags-mode.test.ts "puts vocab tags in defined section and index-only tags in uncategorised"
  - EC-6 (vault rename → empty store): meta-manager.test.ts "returns empty store for new vault name after rename" — accepts that the empty result is the correct behaviour until the user renames the meta folder
  - EC-8 (special chars / case-sensitivity): meta-manager.test.ts "round-trips tags with special characters"; chip-warning.test.ts "comparison is case-sensitive"
  - EC-9 (YAML boolean strings): meta-manager.test.ts "handles 'yes' tag without coercion"; chip-warning.test.ts "handles 'yes' string correctly"
  - EC-10 (large meta file): meta-manager.test.ts "handles large file with many entries efficiently"
  - EC-12 (field not in meta): chip-warning.test.ts "EC-12: field with no meta vocabulary never produces a warning"
  - EC-13 (stale MetaStore on rapid vault switch): accepted limitation — stale-check is handled by atomic MetaStore replacement in onVaultChanged; a sub-millisecond async window is the known trade-off (documented in meta-manager.ts vaultId comment)
  - EC-15 (no tags anywhere): tags-mode.test.ts "EC-15: both sections empty when no tags exist anywhere"
  - EC-16 (filter stateless): tags-mode.test.ts "EC-16: filter state does not persist between calls"
  - EC-17 (index not yet built): tags-mode.test.ts "EC-17: returns only defined tags with 0 file counts when index is null"
  - EC-18 (unsafe vault name): meta-manager.test.ts "sanitises unsafe vault name in file path"; vault.rs sanitise_vault_name_replaces_multiple_unsafe_chars

---

## Review Sign-off

- **Date**: 2026-04-28
- **Findings summary**: 1 Critical, 2 High, 3 Medium, 3 Low — 4 outstanding blocking items (C-1, H-1, H-2, M-1). 5 accepted or advisory (M-2, M-3, L-1, L-2, L-3).
- **Requirements traceability**: All items in `docs/requirements/active_task.md` addressed by implementation. FR-4/NFR-6 partial gap: `list_vault_files` exclusion missing (H-1).
- **Edge case coverage**: EC-1 through EC-20 addressed. EC-6 and EC-13 have rationale gaps (M-3, H-2). EC-11, EC-14, EC-19, EC-20 accepted as manual-test only per known limitations.
- **Status**: NOT APPROVED — resolve C-1, H-1, H-2, M-1 before merge.

### Blocking issues to resolve

1. **C-1** — `keybindings-panel.ts` line 75: change `defaultKey: "Cmd-5"` to `defaultKey: ""` for `command-bar-open-tags`. The in-bar ⌘5 context-scoped handler already works; only the global binding conflicts with `tab-5`.
2. **H-1** — `vault.rs` `list_vault_files`: add `vault_name: String` parameter and apply `is_meta_folder_component` guard in the walk loop, matching `build_vault_index`.
3. **H-2** — `meta-manager.ts` line 41: either implement the stale-check (`vaultId` comparison) in `getVocabularyForField` and `buildTagRows`, or change the comment from "Used for stale-check" to "Stored for diagnostics; stale-check deferred to a future step."
4. **M-1** — `yaml-pane.plugin.ts` lines 1087–1093: remove hardcoded hex fallbacks `#e8a50a` and `#333` from `.yaml-pane-chip--warning` CSS (NFR-3 violation).

---

## Reviewer Fix Implementation — 2026-04-28

All blocking and advisory findings from the code review resolved.

### Issues resolved

- **C-1 (Critical)** — `keybindings-panel.ts`: `command-bar-open-tags` `defaultKey` changed from `"Cmd-5"` to `""`. Conflict with `tab-5` eliminated. In-bar ⌘5 context-scoped hint in `MODE_TAB_SHORTCUTS` left unchanged (correct behaviour, no global scope).
- **H-1 (High)** — `vault.rs` `list_vault_files`: added `vault_name: String` parameter; pre-computes `meta_component` and applies `is_meta_folder_component` guard on every entry in the walk, matching the pattern in `build_vault_index`. New Rust test `list_vault_files_excludes_meta_folder` added.
- **H-2 (High)** — `meta-manager.ts`: `vaultId` field comment updated from "Used for stale-check" to a full explanation of the accepted limitation (atomic replacement in `onVaultChanged`) with EC-13 cross-reference.
- **M-1 (Medium)** — `yaml-pane.plugin.ts`: hardcoded hex fallbacks `#e8a50a` and `#333` removed from `.yaml-pane-chip--warning` CSS rule. NFR-3 now satisfied.
- **M-2 (Medium)** — `command-bar.plugin.ts` `handleAddToMeta`: early-exit guard added for `__TAURI_INTERNALS__` unavailability with `console.warn`.
- **M-3 (Medium)** — `tests/lib/meta-manager.test.ts`: EC-6 vault rename test added (`"returns empty store for new vault name after rename"`).
- **L-1 (Low)** — `command-bar.plugin.ts` `buildTagRow`: one-line justification comment added at function start.
- **L-3 (Low)** — `main.ts`: redundant no-op `initMeta(vaultManager.getActiveVault())` call removed (was always `initMeta(null)` because `init()` is non-blocking). Replaced with explanatory comment.

### Test results after fixes

- `npm run test:run` — 3101 passed, 39 skipped, 0 failed
- `cargo test` (from `src-tauri/`) — 162 passed, 0 failed
- `npx tsc --noEmit` — exits 0 (no type errors)

### Review Request (post-fix)

- **Files changed**:
  - `src/keybindings/keybindings-panel.ts` — C-1: defaultKey cleared for command-bar-open-tags
  - `src-tauri/src/commands/vault.rs` — H-1: vault_name param + meta folder guard in list_vault_files; new Rust test
  - `src/lib/meta-manager.ts` — H-2: vaultId comment updated with accepted limitation
  - `src/main.ts` — L-3: redundant initMeta no-op removed
  - `src/plugins/command-bar/command-bar.plugin.ts` — M-2: Tauri guard in handleAddToMeta; L-1: buildTagRow justification comment
  - `src/plugins/yaml-pane/yaml-pane.plugin.ts` — M-1: hex fallbacks removed from .yaml-pane-chip--warning
  - `tests/lib/meta-manager.test.ts` — M-3: EC-6 vault rename test added

- **Steps completed**: All reviewer findings resolved (C-1, H-1, H-2, M-1, M-2, M-3, L-1, L-3)

- **Known limitations**:
  - L-2 (test coverage for handleAddToMeta write path) remains manual-test only: mocking `__TAURI_INTERNALS__` inside an IIFE plugin is impractical in the Vitest environment.
  - EC-13 (stale MetaStore on rapid vault switch): the sub-millisecond async window is documented in the vaultId comment and accepted as a trade-off.

- **Edge cases covered by tests**:
  - EC-6 (vault rename): meta-manager.test.ts "returns empty store for new vault name after rename" (M-3)
  - H-1 guard: vault.rs `list_vault_files_excludes_meta_folder` Rust unit test
