---
title: Global Search — Command Bar Integration
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Global Search — Command Bar Integration

## Feature Summary

As a user, I want the Command Bar's Files mode to search all `.md` files in the active vault (not just the current file's directory), and I want a new content search mode triggered by typing `/` so I can search file contents from a single, familiar entry point.

---

## Codebase Context Findings

### Finding 1 — Current Files mode uses `list_md_files` with directory-of-current-file scope

`fetchWorkspaceFiles()` in `command-bar.plugin.ts` (around line 2567) derives a directory from `window.__MARKABLE_CURRENT_FILE__` by stripping the filename, then calls `invoke("list_md_files", { dir: workspaceDir })`. The `list_md_files` Rust command (`src-tauri/src/commands/files.rs`) does a **shallow, non-recursive** scan of a single directory and returns filenames only (not full paths). This is the source of the scoping bug: the scan is limited to one flat directory, not the full vault.

### Finding 2 — `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex()` is the correct source for vault-wide file paths

`vault-manager.ts` exposes `getVaultIndex(): VaultIndex | null` on the `window.__MARKABLE_VAULT_MANAGER__` global (line 623). The `VaultIndex.entries` array contains `VaultIndexEntry` objects each with an `path: string` (absolute path) and `name: string` (filename stem). `VaultIndex.entries` covers ALL `.md` files in ALL root paths of the vault, recursively, respecting `excludePatterns`. This is the correct source for the vault-wide file list. No new Rust command is required for FR-1.

### Finding 3 — The `list_md_files` Rust command must not be changed; the call site must be replaced

`list_md_files` is used by the backlinks plugin (confirmed via its doc comment: "backlinks feature"). Changing its signature or behavior would risk regressions outside the scope of this feature. The fix is entirely in `fetchWorkspaceFiles()` in `command-bar.plugin.ts`: replace the `invoke("list_md_files", ...)` call path with a `getVaultIndex()` lookup. The Rust command `list_md_files` itself is untouched.

### Finding 4 — Files mode: `workspaceFiles` in the builder pipeline expects absolute paths

`buildFilesResults()` in `files-mode.ts` accepts `workspaceFiles: string[]` as absolute paths (used to build `filePath` on each `FilesResult`, and compared against `openPaths` set of absolute paths in `tabs`). The vault index's `entries[i].path` is already an absolute path. No transformation is needed beyond extracting `.path` from each entry.

### Finding 5 — Files mode fallback when no vault is open

The existing `fetchWorkspaceFiles()` logic already handles the no-open-file state: sets `_fileListLoaded = true` with no results and shows the "no-workspace" notice. The same notice can be repurposed for "no vault open." When `getVaultIndex()` returns `null` AND `getActiveVault()` returns `null`, the "no-workspace" load state is set (same path, same rendering). If a vault is active but the index is not yet built (null), a brief loading state is appropriate.

### Finding 6 — The `workspaceLoadState` of `"no-workspace"` is already wired into the renderer

`filterAndRenderFiles()` calls `buildFilesResults()` with `workspaceLoadState`, which is consumed in the files mode renderer to show inline notice rows. The existing `"no-workspace"` state produces a notice row — the text of this notice needs to be updated to say something vault-appropriate when no vault is open.

### Finding 7 — Content search mode requires a new Rust command `search_vault_content`

Content search must read `.md` file contents for substring matching. The existing vault index does NOT store raw file content (confirmed: `VaultIndexEntry` stores `path`, `name`, `modified`, `size`, `title`, `tags`, `outboundLinks` — no content). A new `#[tauri::command] pub async fn search_vault_content` must be added. It is placed in `src-tauri/src/commands/vault.rs` to reuse `should_exclude`, `system_time_to_ms`, and the existing walkdir infrastructure. No new Cargo dependencies are required (`walkdir` and `std::fs` are already present).

### Finding 8 — The `/` prefix switching mechanism must follow the existing `>` and `#` prefix pattern

The `onInput()` handler in `command-bar.plugin.ts` (line 3129) already handles `>` → commands and `#` → keybindings prefix switching while in files mode. The new `/` → content search prefix must follow exactly the same pattern: check `_mode === "files" && raw === "/"`, call `setMode("content")` (new mode value), clear the input. Backspace from an empty input in content mode must return to files mode (same Backspace-to-files logic at line 3237).

### Finding 9 — `BarMode` type must gain the `"content"` variant

`BarMode = "files" | "commands" | "keybindings"` is defined in `command-bar.plugin.ts` (line 66). All mode-keyed constants (`MODE_PLACEHOLDERS`, `MODE_FOOTER_HINTS`, `MODE_BADGE_LABELS`, `MODE_TAB_SHORTCUTS`, `MODE_CYCLE`) must be extended with a `"content"` entry. The tab strip DOM construction loop must include the content tab.

### Finding 10 — Content mode uses Enter-to-search (not live), matching the prior Global Search spec

The vault may contain hundreds of files. Running a Rust file-walk on each keystroke is impractical. Content mode must be Enter-triggered: pressing Enter invokes `search_vault_content`; keystrokes alone do not. This matches FR-2 of the previous Global Search requirements doc (now superseded by this document for UI placement).

### Finding 11 — New Rust command must be registered in `mod.rs` and `lib.rs`

`src-tauri/src/commands/mod.rs` exports all commands via `pub use vault::...`. The `invoke_handler` in `src-tauri/src/lib.rs` lists every command. Both files must be updated to register `search_vault_content`.

### Finding 12 — The command bar is an IIFE plugin; Tauri calls go through `window.__TAURI_INTERNALS__.invoke`

The command bar plugin cannot use `bridge.ts` directly (IIFE constraint). It uses `(window as any).__TAURI_INTERNALS__.invoke(...)` for Tauri calls — the same pattern as `fetchWorkspaceFiles` does today for `list_md_files`. A typed wrapper must still be added to `bridge.ts` for testability and for any future non-IIFE consumer.

### Finding 13 — Files mode placeholder text is currently "Open file or tab…"

`MODE_PLACEHOLDERS.files = "Open file or tab…"`. This does not communicate vault scope at all. The placeholder must be updated to make it clear that the entire vault is being searched.

---

## Functional Requirements

### FR-1 — Fix Files mode to use vault index instead of directory scan

When the command bar opens in files mode and a vault is active, `fetchWorkspaceFiles()` must call `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex()` and extract `entries.map(e => e.path)` to build the `workspaceFiles` array. The `invoke("list_md_files", ...)` call must NOT be made when a vault is active. The vault index path is preferred because it is recursive and already filtered by `excludePatterns`.

### FR-2 — Fallback to `list_md_files` when no vault is open

When `getActiveVault()` returns `null` (no vault configured or selected), `fetchWorkspaceFiles()` must fall back to the current behavior: derive `workspaceDir` from `__MARKABLE_CURRENT_FILE__` and invoke `list_md_files`. If `__MARKABLE_CURRENT_FILE__` is also null, set `workspaceLoadState = "no-workspace"` (existing path). The Rust command `list_md_files` is called only in this fallback path.

### FR-3 — Vault index not yet loaded shows loading state

When `getActiveVault()` is non-null but `getVaultIndex()` returns `null` (index still building on first launch), `fetchWorkspaceFiles()` must set `workspaceLoadState = "loading"` and show the existing loading notice. The function should subscribe to `onVaultChanged` or poll with a short timeout to retry once the index is available. (Implementation detail: a single retry after 1.5s is sufficient; continuous polling is not required.)

### FR-4 — Update Files mode placeholder text

`MODE_PLACEHOLDERS.files` must be changed to `"Search vault files…"` (when vault is active) or remain contextual. Because the placeholder is static (not dynamic per-open), the value must unambiguously describe vault-wide scope: `"Search vault files…"`.

### FR-5 — New content search mode ("content")

A new `"content"` mode value is added to `BarMode`. All mode-keyed constant objects must gain a `"content"` entry:
- `MODE_PLACEHOLDERS["content"]`: `"Search file contents…"`
- `MODE_FOOTER_HINTS["content"]`: `"Enter to search  ·  Esc to close"`
- `MODE_BADGE_LABELS["content"]`: `"Content"`
- `MODE_TAB_SHORTCUTS["content"]`: `""` (no dedicated shortcut; accessed via `/` prefix only)
- `MODE_CYCLE`: add `"content"` at the end

### FR-6 — `/` prefix in Files mode switches to content mode

When `_mode === "files"` and the input value equals `"/"`, `onInput()` must call `setMode("content")` and clear the input. This mirrors the `>` and `#` prefix handling at lines 3135–3171.

### FR-7 — Backspace from empty input in content mode returns to files mode

The Backspace-to-files guard (line 3237) already handles `_mode !== "files"`. Because content mode is a new non-files mode, Backspace from an empty input in content mode naturally returns to files mode without any additional code change — the existing guard handles it. This must be verified in tests.

### FR-8 — Content mode shows "Search file contents…" placeholder and "No vault" empty state

When the bar opens in content mode (via the `/` prefix switch):
- The input placeholder is `"Search file contents…"`.
- If no vault is active: show the message `"No vault open — content search requires a vault"` in the results area. The input is present but non-functional (submitting Enter does nothing).
- If a vault is active: show an empty results area with the footer hint `"Enter to search  ·  Esc to close"`.

### FR-9 — Enter in content mode triggers `search_vault_content` Rust command

Pressing Enter while in content mode and the input is non-empty invokes `search_vault_content` via `(window as any).__TAURI_INTERNALS__.invoke(...)`. A loading indicator replaces the results list during the async call. Results replace the loading indicator when the call completes.

### FR-10 — Content search results: file header + up to 3 line excerpts

Each `FileContentResult` returned by `search_vault_content` is rendered as a result group:
1. A clickable file name header showing the `title` (from the Rust result) — clicking opens the file.
2. Up to 3 `LineMatch` excerpt rows beneath the header. Each row shows `line_number: line_text` with the matched substring visually highlighted (e.g. bold or accent color).
3. When a file has more than 3 matches, a non-clickable `"N more matches"` row is appended to the group.

### FR-11 — Clicking any result row in content mode opens the file and closes the bar

Clicking the file header row or any excerpt row in content mode calls `window.__MARKABLE_TAB_MANAGER__.openFile(absolutePath)` (or activates the existing tab if already open) and then calls `closeBar()`. This is the same action pattern as the Files mode `openFile` closure.

### FR-12 — Escape or clearing `/` prefix returns to files mode

Pressing Escape in content mode closes the bar entirely (same as all other modes — existing `onOverlayKeydown` handles Escape regardless of mode). Clearing the input so it is empty and pressing Backspace returns to files mode (FR-7).

### FR-13 — New Rust command `search_vault_content`

A new async Tauri command must be added to `src-tauri/src/commands/vault.rs`:

```
pub async fn search_vault_content(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    query: String,
    max_results: u32,
) -> Result<ContentSearchPayload, String>
```

`ContentSearchPayload` has fields: `results: Vec<FileContentResult>`, `capped: bool`, `skipped_count: u32`.
`FileContentResult` has: `path: String`, `title: String`, `matches: Vec<LineMatch>`.
`LineMatch` has: `line_number: u32`, `line_text: String`, `column_start: u32`.

The command walks `root_paths` using `WalkDir`, respects `should_exclude`, reads each `.md` file via `std::fs::read_to_string` (skipping on error, incrementing `skipped_count`), scans lines for case-insensitive substring matches, and stops adding new files once `results.len() == max_results` (`capped = true`). It reuses all existing vault.rs helpers: `should_exclude`, `extract_h1`, `parse_front_matter`.

### FR-14 — `search_vault_content` registered in `mod.rs` and `lib.rs`

`src-tauri/src/commands/mod.rs` must add `pub use vault::search_vault_content;`. `src-tauri/src/lib.rs` must add `search_vault_content` to the `tauri::generate_handler![]` array.

### FR-15 — Typed bridge wrapper in `bridge.ts`

A typed `searchVaultContent(params)` async function must be added to `src/lib/bridge.ts` returning `FileResult<ContentSearchPayload>`. The IIFE plugin does not use this wrapper, but it must exist for testability.

### FR-16 — Empty query guard in content mode

If the user presses Enter in content mode with an empty or whitespace-only query, no Rust call is made. A hint `"Enter a search term"` is displayed in the results area.

---

## Edge Case Inventory

**EC-1 — Vault active but index is null (still building)**
`getActiveVault()` is non-null, `getVaultIndex()` is null. Expected: Files mode shows "loading" notice. Content mode shows "loading" notice when Enter is pressed. No crash.

**EC-2 — No vault open (Files mode fallback)**
`getActiveVault()` returns null. Expected: Files mode falls back to `list_md_files` on current file's directory. If `__MARKABLE_CURRENT_FILE__` is also null, the "no-workspace" notice is shown.

**EC-3 — No vault open (content mode)**
`getActiveVault()` returns null. Expected: the results area shows `"No vault open — content search requires a vault"`. Enter does nothing. No Rust call.

**EC-4 — Vault with 0 `.md` files (Files mode)**
`getVaultIndex().entries` is empty. Expected: Files mode shows open tabs only (no workspace files section). No error.

**EC-5 — Vault with 0 `.md` files (content mode)**
`search_vault_content` walks the vault and finds no `.md` files. Expected: `results: []`, `capped: false`. UI shows `"No results for 'query'"`. No error.

**EC-6 — Content mode: query matches nothing**
`search_vault_content` returns `results: []`. Expected: UI shows `"No results for 'query'"`.

**EC-7 — Content mode: results cap reached**
`capped: true` in the payload. Expected: a notice `"Showing matches in the first N files — refine your query to see more"` is prepended to the results list.

**EC-8 — Content mode: file unreadable during search**
`std::fs::read_to_string` fails for a file. Expected: file is skipped, `skipped_count` incremented. If `skipped_count > 0`, a notice `"N files could not be searched"` is shown in the overlay.

**EC-9 — Content mode: binary data in a `.md` file**
`read_to_string` returns `Err` for invalid UTF-8. Expected: same as EC-8 — file skipped, counted.

**EC-10 — Content mode: file larger than 1 MB**
The Rust command applies a per-file cap of 1 MB (reads only the first 1,048,576 bytes). Lines beyond the cap are not searched. The truncation is invisible to the user. This prevents memory spikes on giant files.

**EC-11 — Content mode: query contains regex special characters**
The Rust command uses substring matching (`to_lowercase().contains()`), not regex. Characters like `[`, `*`, `.`, `(` are treated as literals. No panic.

**EC-12 — Content mode: Enter pressed while previous search is in-flight**
A second Enter press while a `search_vault_content` invoke is pending must not launch a duplicate call. A generation/guard pattern (increment `_contentSearchGeneration` per call; discard results if stale) prevents duplicate renders.

**EC-13 — Plugin disabled while content search is in-flight**
`onDisable` removes the DOM. When the async result arrives, the generation check silently discards it. No JS error from accessing removed DOM nodes.

**EC-14 — Vault switch while content search is in-flight**
`onVaultChanged` fires while `search_vault_content` is pending. Expected: the in-flight result is discarded via the generation counter. The overlay resets to the new vault's ready state.

**EC-15 — `/` typed inside a non-empty query in files mode**
The prefix switch only triggers when the ENTIRE input is the single character `/`. If the user types `design/` or `foo/`, no mode switch occurs. Fuzzy filtering continues normally.

**EC-16 — Content mode opened via `/` prefix; bar closed and reopened**
`closeBar()` resets `_mode = "files"` (line 3089). Re-opening the bar always starts in files mode. The `/` prefix must be re-typed to enter content mode. This is intentional and consistent with how `>` and `#` work.

**EC-17 — `getVaultIndex()` returns entries with no `path` field (corrupt index)**
A defensive guard must check that each entry has a truthy `path` before adding to `workspaceFiles`. Entries with empty or null paths are silently skipped.

**EC-18 — Very large vault (500+ files) in Files mode**
`getVaultIndex().entries` may have up to 500 entries (vault cap). All 500 absolute paths are passed to `buildFilesResults()` as `workspaceFiles`. The existing `FILES_CAP = 200` display cap already handles limiting the rendered list to 200 rows. No additional cap logic needed.

**EC-19 — Content search result file is already open as a tab**
Clicking a result row calls `window.__MARKABLE_TAB_MANAGER__.openFile(path)`. This function already handles the "file is already open" case by activating the existing tab. No special handling needed in the content mode renderer.

**EC-20 — Multi-root vault (2+ root paths) in content mode**
`search_vault_content` walks all root paths. Results from all roots are merged into a single flat `results` array. The TypeScript renderer displays them in the order returned (most matches first if Rust sorts by match count).

**EC-21 — `/` prefix while already in content mode**
Once in content mode, typing `/` is a normal search character (not a prefix switch). Only triggers when `_mode === "files"`.

---

## Non-Functional Requirements

**NFR-1 — No new Cargo dependencies**
`search_vault_content` must be implemented using only existing crates: `walkdir`, `std::fs`, `std::str`. No `regex`, `tantivy`, or ripgrep crate.

**NFR-2 — Content search is Enter-triggered, not live-as-you-type**
No Rust call is made on keydown. Only Enter triggers the invocation. This prevents thrashing on large vaults.

**NFR-3 — Content search must complete within 3 seconds for a 500-file vault**
On a modern MacBook Pro (M-series), searching 500 small-to-medium `.md` files (average 10 KB each) with a simple substring scan must complete within 3 seconds. The 1 MB per-file cap (EC-10) enforces an upper bound on per-file read time.

**NFR-4 — Files mode vault lookup is synchronous (no additional async latency)**
Replacing `invoke("list_md_files", ...)` with `getVaultIndex().entries.map(e => e.path)` is a synchronous in-memory read. The Files mode open-to-results latency must not increase when a vault is active.

**NFR-5 — All mode-keyed constants must remain exhaustive**
`MODE_PLACEHOLDERS`, `MODE_FOOTER_HINTS`, `MODE_BADGE_LABELS`, `MODE_TAB_SHORTCUTS` are `Record<BarMode, string>`. Adding `"content"` to `BarMode` must be accompanied by adding a `"content"` key to every one of these objects. TypeScript's type system will enforce this if the types are declared as `Record<BarMode, string>`.

**NFR-6 — CSS for content mode results uses existing CSS variables**
Any new CSS classes for content mode result rows (excerpt rows, file header rows, "N more" rows) must use `var(--bg-primary)`, `var(--border-color)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--accent-color)` etc. No hardcoded hex or font names.

**NFR-7 — Per-file 1 MB read cap in Rust**
Files larger than 1 MB are read only up to the first 1,048,576 bytes before line scanning begins. This is implemented in `search_vault_content` before the line iteration loop.

**NFR-8 — Bridge wrapper uses `FileResult` discriminated union**
`bridge.ts`'s `searchVaultContent()` wrapper returns `FileResult<ContentSearchPayload>` (never throws).

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | (1) Add `"content"` to `BarMode`; (2) extend all mode-keyed constants; (3) update `fetchWorkspaceFiles` to use vault index; (4) add `/` prefix handler in `onInput`; (5) add content mode Enter handler; (6) add content mode result renderer; (7) update Files mode placeholder |
| `src/plugins/command-bar/files-mode.ts` | Update `FILES_SECTION_LABELS` if a new label is needed; update `FilesModeBuilderDeps.workspaceLoadState` if a new "no-vault" state is added |
| `src-tauri/src/commands/vault.rs` | Add `FileContentResult`, `LineMatch`, `ContentSearchPayload` structs; add `search_vault_content` async command |
| `src-tauri/src/commands/mod.rs` | Add `pub use vault::search_vault_content;` |
| `src-tauri/src/lib.rs` | Add `search_vault_content` to `tauri::generate_handler![]` |
| `src/lib/bridge.ts` | Add `searchVaultContent(params)` typed wrapper returning `FileResult<ContentSearchPayload>` |

### Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/files.rs` | `list_md_files` is unchanged; the fallback path still calls it |
| `src/lib/vault-manager.ts` | Existing public API is sufficient; no new exports needed |
| `src/lib/vault-types.ts` | No new vault types required |
| `src-tauri/src/lib.rs` (window size section) | Window size invariant must not regress — the only change is adding a command to the handler list |
| `src/lib/settings.ts` | No new settings fields |

---

## Out of Scope

- **Regex query mode** — substring matching only.
- **Live-as-you-type content search** — Enter-triggered only.
- **Scrolling to the exact matched line** — the user is navigated to the file, not the line.
- **Search-and-replace across vault** — separate feature.
- **Searching non-`.md` files** — only Markdown.
- **Saved search history** — no persistence.
- **Dedicated keyboard shortcut for content mode** — accessed only via `/` prefix; no global keybinding.
- **Highlighting matched text inside the editor** after navigation — deferred.
- **The prior Global Search plugin** (`src/plugins/global-search/global-search.plugin.ts`) — this spec supersedes and replaces the previous `active_task.md` which described a standalone overlay plugin. That plugin is NOT built; content search lives inside the Command Bar.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 21 items in Edge Case Inventory (EC-1 through EC-21)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
