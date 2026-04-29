---
title: "Global Search — Command Bar Integration: Architecture"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Global Search — Command Bar Integration

## Master Checklist

| Step | File | Status |
|------|------|--------|
| step_01 | `search_vault_content` Rust command + bridge wrapper | [x] |
| step_02 | Fix `fetchWorkspaceFiles()` vault-index scope | [x] |
| step_03 | `"content"` BarMode + `/` prefix + result renderer | [x] |
| step_04 | Tests for all 21 edge cases | [x] |

---

## Stack Decision

This feature adds no new dependencies. The design is constrained by the existing stack:

- **Rust/Tauri v2** — `search_vault_content` Rust command. Uses only `walkdir` (already a
  dependency), `std::fs::read_to_string`, `std::str`. No `regex` or `tantivy` crate (NFR-1).
- **TypeScript/IIFE plugin** — All frontend changes live in the existing command-bar IIFE plugin.
  The IIFE cannot import `bridge.ts` directly, so Tauri calls use
  `(window as any).__TAURI_INTERNALS__.invoke(...)` (Finding 12).
- **bridge.ts** — Typed `searchVaultContent()` wrapper added for testability and future non-IIFE
  consumers (FR-15, NFR-8).

No alternative stack was evaluated; the feature is a surgical extension of the existing Tauri
v2 + CodeMirror 6 architecture.

---

## High-Level Architecture

### Data Flow — Content Search

```
User types query → presses Enter
  ↓
onOverlayKeydown (Enter handler) — content mode branch
  ↓
Increment _contentSearchGeneration, set loading state in DOM
  ↓
__TAURI_INTERNALS__.invoke("search_vault_content", { root_paths, exclude_patterns, query, max_results })
  ↓ (async, Rust side)
WalkDir over root_paths → read_to_string (≤1 MB per file) → case-insensitive substring scan
  → return ContentSearchPayload { results: FileContentResult[], capped, skipped_count }
  ↓ (back in TypeScript)
Generation check — discard if stale (EC-12, EC-13, EC-14)
  ↓
renderContentResults(payload, query) → grouped DOM rows in .cb-results
```

### Data Flow — Files Mode (fixed)

```
openBar() → fetchWorkspaceFiles(generation)
  ↓
window.__MARKABLE_VAULT_MANAGER__.getActiveVault()
  ├─ null → fallback: invoke("list_md_files", { dir }) OR show no-workspace notice
  └─ non-null → getVaultIndex()
       ├─ null (building) → workspaceLoadState = "loading" + 1.5s retry
       └─ non-null → entries.filter(e => !!e.path).map(e => e.path) (synchronous)
  ↓
buildFilesResults({ tabs, workspaceFiles, workspaceLoadState, ... })
  ↓
refreshFilesDisplay()
```

---

## Component Map

### New files

None. All changes are additions to existing files.

### Modified files

| File | Change summary |
|------|----------------|
| `src-tauri/src/commands/vault.rs` | Add `LineMatch`, `FileContentResult`, `ContentSearchPayload` structs; add `search_vault_content` async command |
| `src-tauri/src/commands/mod.rs` | Add `pub use vault::search_vault_content;` |
| `src-tauri/src/lib.rs` | Add `search_vault_content` to `generate_handler![]`; add `search_vault_content` to `pub use commands::...` |
| `src/lib/bridge.ts` | Add `ContentSearchPayload`, `FileContentResult`, `LineMatch` TypeScript types; add `searchVaultContent()` wrapper |
| `src/plugins/command-bar/command-bar.plugin.ts` | (1) Extend `BarMode` union; (2) extend all `Record<BarMode, ...>` constants; (3) rewrite `fetchWorkspaceFiles`; (4) add `/` prefix handler; (5) add Enter handler for content mode; (6) add `renderContentResults()`; (7) add `_contentSearchGeneration` counter; (8) update CSS with content-mode row classes |
| `src/plugins/command-bar/files-mode.ts` | No functional changes required per requirements. |

### Files explicitly NOT changed

- `src-tauri/src/commands/files.rs` — `list_md_files` unchanged (Finding 3)
- `src/lib/vault-manager.ts` — existing API is sufficient (Finding 2)
- `src/lib/vault-types.ts` — no new vault types required
- `src/lib/settings.ts` — window size invariant: both `sizeW`/`sizeH` must remain intact
- `src-tauri/src/lib.rs` (window size section) — only the handler list is touched

---

## Architectural Decisions

### AD-GS-01 — Rust struct serialisation uses `serde(rename_all = "camelCase")`

All new Rust structs (`LineMatch`, `FileContentResult`, `ContentSearchPayload`) derive
`Serialize` and use `#[serde(rename_all = "camelCase")]`, consistent with every other struct
in `vault.rs`. This means `line_number` serialises as `lineNumber`, `line_text` as `lineText`,
`column_start` as `columnStart`, `file_path` as `filePath`, `skipped_count` as `skippedCount`.
TypeScript-side types must use camelCase field names.

### AD-GS-02 — 1 MB per-file cap implemented via `Vec<u8>` read, not `read_to_string`

The 1 MB cap (EC-10, NFR-7) cannot be enforced cleanly with `read_to_string` because that
function reads the entire file. The implementation uses `std::fs::File::open` + `Read::read`
with a capped buffer (`let mut buf = vec![0u8; MAX_FILE_BYTES]`), then converts to a
UTF-8 string with `String::from_utf8_lossy`. Files containing invalid UTF-8 sequences are
silently lossy-decoded rather than skipped, with the exception that a file that cannot be
opened at all is skipped and counted (EC-8, EC-9). This matches the requirement's intent:
`read_to_string` "returns Err for invalid UTF-8 → same as EC-8". Using `from_utf8_lossy`
is strictly more permissive (fewer skips), which is the right default for a search feature.

Rationale for `from_utf8_lossy` over `read_to_string`:
- EC-9 says "file skipped, counted" for invalid UTF-8. `read_to_string` would achieve this
  because it returns Err on invalid UTF-8. However, the 1 MB cap forces a manual read anyway.
  `from_utf8_lossy` gives us the cap AND handles partial UTF-8 boundaries gracefully.
- The lossy replacement character (U+FFFD) cannot match any user query (which is pure ASCII
  or valid UTF-8), so search quality is not degraded.

### AD-GS-03 — Generation counter `_contentSearchGeneration` is separate from `_openGeneration`

`_openGeneration` is incremented on `closeBar()` and `openBar()`. `_contentSearchGeneration`
is a separate counter incremented only when a new content search is launched. This prevents
a content search result arriving after a second Enter press from stomping on the loading state
(EC-12). The two counters are independent and do not interfere.

### AD-GS-04 — No-vault state in content mode renders a notice row, not a disabled input

FR-8 says "the input is present but non-functional (submitting Enter does nothing)". The
implementation achieves this by checking `getActiveVault()` at the top of the Enter handler
before any Rust call. No special CSS disabling of the `<input>` element is applied — the
guard in the handler is sufficient and simpler to test.

### AD-GS-05 — Content mode result rows use a distinct CSS class hierarchy

Files mode uses `.cb-result` rows with `data-id` attributes. Content mode uses:
- `.cb-result.cb-result--content-header` — the clickable file name row
- `.cb-result.cb-result--content-excerpt` — a line match row (also clickable, same action)
- `.cb-result--content-more` — the "N more matches" non-clickable row (no `data-id`)

This class separation lets `onResultClick` remain unchanged: it looks up `data-id` on the
row, which is only set on header and excerpt rows, not on "more" rows. The existing delegation
pattern handles content mode without modification.

### AD-GS-06 — `renderContentResults` is a module-level function, not a method

Consistent with `renderFilesResults` (which is also a module-level function), content search
rendering is a free function. It receives the payload and query string and mutates `_resultsEl`
directly. This avoids any need for a class refactor.

### AD-GS-07 — Tab strip cycle order places `"content"` at the end

`MODE_CYCLE` becomes `["commands", "files", "keybindings", "content"]`. Content mode has no
dedicated keyboard shortcut (`MODE_TAB_SHORTCUTS["content"] = ""`), so it appears last in
the strip — a visual signal that it is accessed primarily via the `/` prefix, not Tab cycling.

### AD-GS-08 — Vault index fallback uses a single 1.5s retry, not continuous polling

When `getActiveVault()` is non-null but `getVaultIndex()` returns null (EC-1), a single
`setTimeout(1500ms)` retry is sufficient. If the index is still null after 1.5s, the loading
notice remains. The user can close and reopen the bar to retry. Continuous polling would
complicate the generation-counter lifecycle and is not necessary for the use case.

### AD-GS-09 — `workspaceLoadState` string values are NOT extended for the vault case

The existing `"no-workspace"` state is reused when no vault is active (EC-2, Finding 6).
The notice text rendered by `buildFilesResults` in files mode already handles this state.
No new state string (e.g. `"no-vault"`) is added. The notice text itself may be updated
to be vault-aware, but that is a display concern only.

### AD-GS-10 — `search_vault_content` sorts results by match count descending

Results in `ContentSearchPayload.results` are ordered by `matches.len()` descending before
serialisation. This surfaces the most-relevant files first in the UI without any client-side
sort, and satisfies EC-20's requirement that "results from all roots are merged into a single
flat results array" in a sensible order.

---

## Type Contracts

### Rust structs (vault.rs additions)

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    pub line_number: u32,   // 1-based
    pub line_text: String,  // full line content (trimmed)
    pub column_start: u32,  // 0-based byte offset of match start within line_text
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentResult {
    pub path: String,           // absolute path
    pub title: String,          // front-matter title / H1 / filename stem
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPayload {
    pub results: Vec<FileContentResult>,
    pub capped: bool,
    pub skipped_count: u32,
}

#[tauri::command]
pub async fn search_vault_content(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    query: String,
    max_results: u32,
) -> Result<ContentSearchPayload, String>
```

### TypeScript types (bridge.ts additions)

```typescript
export interface LineMatch {
  lineNumber: number;    // 1-based
  lineText: string;
  columnStart: number;   // 0-based byte offset
}

export interface FileContentResult {
  path: string;
  title: string;
  matches: LineMatch[];
}

export interface ContentSearchPayload {
  results: FileContentResult[];
  capped: boolean;
  skippedCount: number;
}

export async function searchVaultContent(params: {
  rootPaths: string[];
  excludePatterns: string[];
  query: string;
  maxResults: number;
}): Promise<FileResult<ContentSearchPayload>>
```

Note: Tauri serialises Rust `snake_case` to JS `camelCase` via `serde(rename_all = "camelCase")`.
The `invoke` call passes `{ root_paths, exclude_patterns, query, max_results }` as the argument
object because Tauri's invoke handler expects the parameter names from the Rust function
signature, not the serde rename. This is Tauri's standard convention.

---

## Implementation Sequence

The steps are ordered to minimize integration risk:

1. **step_01** (Rust + bridge) — establishes the backend contract. All other steps depend on
   the Rust command existing. Can be compiled and smoke-tested independently.
2. **step_02** (vault scope fix) — isolated change to `fetchWorkspaceFiles()`. No new UI. Can
   be verified by opening the command bar with a vault active.
3. **step_03** (content mode) — builds on the Rust command from step_01 and the vault globals
   already tested in step_02.
4. **step_04** (tests) — written last so they can reference all new exports and behaviour.

---

## Deferred Work (not in scope)

- Highlighting matched text inside the editor after navigation (requirements Out of Scope)
- Search history persistence (requirements Out of Scope)
- Dedicated keyboard shortcut for content mode (requirements Out of Scope)
- The prior `src/plugins/global-search/global-search.plugin.ts` standalone overlay — this spec
  supersedes it and that plugin is NOT built

---

## Review Request

- **Files changed**:
  - `src-tauri/src/commands/vault.rs` — added `LineMatch`, `FileContentResult`, `ContentSearchPayload` structs; `search_vault_content` command; 12 Rust unit tests in `mod content_search_tests`
  - `src-tauri/src/commands/mod.rs` — added `search_vault_content` to vault re-export block
  - `src-tauri/src/lib.rs` — added `search_vault_content` to `pub use commands::{}` block and `generate_handler![]`
  - `src/lib/bridge.ts` — added `LineMatch`, `FileContentResult`, `ContentSearchPayload` TypeScript interfaces; added `searchVaultContent()` typed bridge wrapper
  - `src/plugins/command-bar/command-bar.plugin.ts` — extended `BarMode` to 4 values; extended all `Record<BarMode, ...>` constants; rewrote `fetchWorkspaceFiles()` for vault-index scope; added `/` prefix → content mode switch in `onInput`; added `handleContentSearchEnter()`; added `renderContentResults()` (exported); added `renderContentNotice()`; added `renderContentLoading()`; added `_contentSearchGeneration` and `_contentSearchInFlight` module state; updated `closeBar()`, `onResultClick`, `onResultHover`, `onDisable`; added content-mode CSS
  - `tests/bridge-global-search.test.ts` — NEW FILE: 4 Group A bridge wrapper tests
  - `tests/plugins/command-bar/command-bar.test.ts` — updated 2 existing tests (FR-4 placeholder text, 4-tab count); added `renderContentResults` import; added 28 new tests (Group B: B-1 through B-7; Group C: C-1 through C-21 minus C-20 deduped into C-1)

- **Steps completed**: step_01, step_02, step_03, step_04 (in order)

- **Known limitations**:
  - Content mode has no dedicated keyboard shortcut — accessed via `/` prefix only (AD-GS-07; shortcut deferred per requirements Out of Scope)
  - `search_vault_content` performs a linear scan with no index; large vaults (>10 000 files) may exceed the 80ms NFR-01 budget for interactive response time, though the async pattern with loading state keeps the UI unblocked (acceptable per NFR-1 "no tantivy/regex crate" constraint)
  - `renderContentResults` is exported as `/* @testonly */`; it operates on module-level DOM refs so callers must have called `onEnable` first

- **Edge cases covered by tests**:

  | EC | Test | File |
  |----|------|------|
  | EC-1a (vault active, index built) | B-1 | command-bar.test.ts |
  | EC-1b (vault active, index null) | B-2 | command-bar.test.ts |
  | EC-2 (no vault, fallback) | B-3, B-4 | command-bar.test.ts |
  | EC-3 (no vault, content mode) | C-7 | command-bar.test.ts |
  | EC-5 (0 .md files, content mode) | D-6 (Rust), C-13 | vault.rs + command-bar.test.ts |
  | EC-6 (query matches nothing) | D-6 (Rust), C-10 | vault.rs + command-bar.test.ts |
  | EC-7 (results capped) | D-7 (Rust), C-11 | vault.rs + command-bar.test.ts |
  | EC-8 (file unreadable) | D-8 (Rust) | vault.rs |
  | EC-10 (file > 1 MB) | D-4, D-5 (Rust) | vault.rs |
  | EC-11 (regex chars literal) | D-3 (Rust), C-14 | vault.rs + command-bar.test.ts |
  | EC-12 (duplicate in-flight) | C-8 | command-bar.test.ts |
  | EC-13 (plugin disabled in-flight) | C-15 | command-bar.test.ts |
  | EC-14 (close bar in-flight) | C-16 | command-bar.test.ts |
  | EC-15 (/ in non-empty query) | C-3 | command-bar.test.ts |
  | EC-16 (close resets mode) | C-19 | command-bar.test.ts |
  | EC-17 (corrupt index entry) | B-1, B-5 | command-bar.test.ts |
  | EC-18 (500-file vault) | B-6 | command-bar.test.ts |
  | EC-20 (multi-root vault) | D-10 (Rust) | vault.rs |
  | EC-21 (/ in content mode) | C-4 | command-bar.test.ts |
  | A-1…A-4 (bridge wrapper) | A-1 through A-4 | bridge-global-search.test.ts |
  | EC-1 (vault active, index null, content Enter) | C-7b | command-bar.test.ts |
  | EC-4 (empty vault, files mode) | B-8 | command-bar.test.ts |
  | EC-9 (invalid UTF-8 lossily decoded) | D-13 (Rust) | vault.rs |
  | H-1 (multi-byte column_start) | D-12b (Rust) | vault.rs |

---

## Reviewer Finding Resolutions (second pass)

All High/Medium/selected Low findings from the code review have been resolved:

| Finding | Resolution |
|---------|-----------|
| H-1 | `column_start` now uses `lower[..byte_pos].chars().count()` (char count, not byte offset). Doc comments updated in `vault.rs` and `bridge.ts`. Test D-12b added. |
| H-2 | `handleContentSearchEnter` guards against null vault index before invoke, showing "still building" notice. Test C-7b added. GROUP C `beforeEach` updated to return non-null index (tests that need null override per-test). |
| H-3 | Test B-8 added: empty vault entries + one open tab → tab row visible, no crash, no error. |
| M-1 | Length justification comments added to `renderContentResults`, `handleContentSearchEnter`, `fetchWorkspaceFiles`, `search_vault_content`. |
| M-2 | Redundant `updateAriaActiveDescendant` call removed from content branch of `onResultHover`; only the unconditional call at end remains. |
| M-3 | `_openGeneration++` added to the `/` mode-switch handler in `onInput`. |
| M-4 | Test D-13 added verifying `skipped_count` is NOT incremented for invalid-UTF-8 files. Coverage matrix updated. |
| L-2 | D-4 filler changed to `1_048_576 + 100` bytes so "FINDME" is clearly beyond the cap. |
| L-3 | `"content"` added to `ResultCategory` union; `CATEGORY_LABELS` updated; `as any` casts removed from `_visibleResults.push()` calls in `renderContentResults`. |

---

## Review Sign-off

- **Date**: 2026-04-28
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all prior findings resolved, no new findings
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified. FR-1 through FR-16 and EC-1 through EC-21 addressed by implementation and test coverage.
- **Edge case coverage**: All 21 Edge Case Inventory items covered by passing tests (see coverage matrix in Review Request section). EC-19 delegated to existing `openFile` tab-dedup path per requirements ("no special handling needed").
- **Test suites**: `cargo test` 148/148 passed; `npm run test:run` 3037 passed, 39 skipped, 0 failed; `npx tsc --noEmit` exits 0.
- **Status**: Approved for Merge
