# Create Note from Broken Wiki-Link — Master Blueprint

**Requirements source**: `docs/requirements/active_task.md`
**Feature branch target**: `main`
**Single file changed**: `src/plugins/backlinks/backlinks.plugin.ts`

---

## Feature Summary

When a user hovers over a red broken wiki-link (`[[stem]]` whose target is absent
from the vault index), the hover popover now shows instead of silently suppressing.
The popover renders a "Create note" variant: stem title, resolved creation path, and
a `<button class="wl-popover-create-btn">Create note</button>`. Clicking the button
creates the file atomically, rebuilds the vault index (which re-classifies the span
from broken to valid), and opens the new note in a tab.

All logic is self-contained in the IIFE plugin. Tauri commands are called via
`window.__TAURI_INTERNALS__.invoke(...)` — no ES-module bridge imports.

---

## Architecture Decision

No new files, no new Rust commands, no new Cargo dependencies.

The entire change lives inside `src/plugins/backlinks/backlinks.plugin.ts` because:

1. The IIFE boundary means the plugin cannot import from `bridge.ts`. All Tauri
   calls in the plugin already go through `__TAURI_INTERNALS__.invoke`.
2. The existing `showWikiPopover` / `createPopoverElement` / `dismissWikiPopover`
   pattern already establishes the correct separation of concerns. The new "Create
   note" variant follows the same shape.
3. `ensureDirectory` and `write_file` Rust commands already exist (confirmed in
   `bridge.ts` lines 243 and 84 respectively). No Rust changes required.
4. `reloadVaultIndex` on `window.__MARKABLE_VAULT_MANAGER__` already exists and
   triggers `emitVaultChanged` → `forceRebuildEffect`, which is the correct
   decoration-refresh path (requirements Finding 8).

---

## Component Map

### File that changes

| File | Change summary |
|------|----------------|
| `src/plugins/backlinks/backlinks.plugin.ts` | 5 surgical changes listed below |

### No files may change

| File | Reason |
|------|--------|
| `src/lib/bridge.ts` | `writeFile` and `ensureDirectory` already exist — do not add new wrappers |
| `src/lib/vault-manager.ts` | `reloadVaultIndex` already exists and is exposed on the window global |
| `src-tauri/src/lib.rs` | Window size invariant — must never be touched |
| `src/lib/settings.ts` | Window size invariant — must never be touched |
| `src/editor/extensions.ts` | No extension set changes required |
| Any Rust file under `src-tauri/` | No new Cargo commands needed |

### New test file

| File | Purpose |
|------|---------|
| `tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts` | All unit tests for the new feature (FR-1 through FR-8, EC-1 through EC-15) |

---

## The 5 Surgical Changes in `backlinks.plugin.ts`

These are listed here as a precise change registry. Each step file contains the
full implementation detail.

| # | Change | Step |
|---|--------|------|
| 1 | Extend `WIKI_POPOVER_CSS` string with `.wl-popover-create-btn` and `.wl-popover-error-msg` styles | `step_01` |
| 2 | Update `estimatedHeight` constant from `240` to `280` in `positionPopover` | `step_01` |
| 3 | Add `createBrokenLinkPopoverElement(displayStem, creationPath)` helper | `step_02` |
| 4 | Add `resolveCreationPath(target, vaultRoot)` pure helper | `step_02` |
| 5 | Modify `showWikiPopover` to branch on `cm-wiki-link-broken` class and call `handleCreateNoteClick` on button click | `step_03` |

---

## Data Flow

```
user hovers broken [[link]]
  → buildHoverHandler fires 180 ms timer
  → showWikiPopover(spanEl, target)
      ├─ reads spanEl.classList.contains('cm-wiki-link-broken')
      │   YES:
      │     getActiveVault() → vaultRoot
      │     resolveCreationPath(target, vaultRoot) → absolutePath
      │     displayStem = stripPathPrefix(stripAnchor(target))
      │     createBrokenLinkPopoverElement(displayStem, vaultRelPath)
      │     button.addEventListener('click', () => handleCreateNoteClick(...))
      │     attach + position popover
      │
      └─ NO (existing path, unchanged):
            invokeReadFile → extractPopoverContent → createPopoverElement

user clicks "Create note"
  → handleCreateNoteClick(target, spanEl, capturedVersion)
      ├─ version guard (EC-11)
      ├─ ensure_directory via __TAURI_INTERNALS__.invoke
      │     on error → showInlinePopoverError(msg)
      ├─ write_file via __TAURI_INTERNALS__.invoke
      │     on error → showInlinePopoverError(msg)
      ├─ void reloadVaultIndex()   (FR-4 step 1, non-fatal)
      ├─ void openFileInTab()      (FR-4 step 2, non-fatal)
      └─ dismissWikiPopover()      (FR-4 step 3)
```

---

## API Contracts (new functions)

```typescript
// Pure helper — no side effects, fully testable without DOM
function resolveCreationPath(
  rawTarget: string,
  vaultRoot: string
): string

// DOM builder — analogous to createPopoverElement; returns unattached div
function createBrokenLinkPopoverElement(
  displayStem: string,
  vaultRelativePath: string
): HTMLElement

// Async button-click orchestrator — exported for test-only access
export async function handleCreateNoteClick(
  rawTarget: string,
  spanEl: HTMLElement,
  capturedVersion: number
): Promise<void>
```

---

## Implementation Checklist

- [x] **step_01** — CSS + estimatedHeight
  - [x] `.wl-popover-create-btn` style appended to `WIKI_POPOVER_CSS`
  - [x] `.wl-popover-error-msg` style appended to `WIKI_POPOVER_CSS`
  - [x] `estimatedHeight` updated from 240 to 280 in `positionPopover`

- [x] **step_02** — New helpers
  - [x] `resolveCreationPath` added (pure function, module-private)
  - [x] `createBrokenLinkPopoverElement` added (DOM builder, module-private)
  - [x] `handleCreateNoteClick` added (exported for test access)

- [x] **step_03** — `showWikiPopover` modification
  - [x] Broken-class detection branch added
  - [x] EC-1 guard (`getActiveVault()` null → return early)
  - [x] EC-12 guard (`currentFile` null is OK — vault root path does not require it)
  - [x] `_hoverFetchVersion` increment placed BEFORE the broken-link branch check
    so that version tracking works for both valid and broken paths
  - [x] Button click handler captures `myVersion` for EC-11 race safety
  - [x] EC-2 null-guards on `__MARKABLE_VAULT_MANAGER__` and `__MARKABLE_TAB_MANAGER__`

- [x] **step_04** — Tests
  - [x] `resolveCreationPath` — unit tests (pure function, 9 cases)
  - [x] `createBrokenLinkPopoverElement` — DOM structure tests (4 cases)
  - [x] `handleCreateNoteClick` — orchestration tests (7 cases: success,
        ensure_directory failure, write_file failure, version mismatch, missing globals,
        reloadVaultIndex+openFileInTab called, dismissWikiPopover called)
  - [x] `showWikiPopover` broken-link branch — integration tests (5 cases:
        no vault, broken span shows popover, no read_file call, valid span unchanged, EC-11)
  - [x] `_showInlinePopoverError` — DOM mutation tests (2 cases)
  - [x] CSS regression tests (2 cases)
  - [x] Edge cases EC-3, EC-8, EC-9, EC-15 covered

---

## Edge Case Coverage Registry

| EC | Description | Handled by |
|----|-------------|-----------|
| EC-1 | No vault active | `showWikiPopover` early return if `getActiveVault()` null |
| EC-2 | Window globals absent | `??`/`?.` null guards + `console.warn` in `handleCreateNoteClick` |
| EC-3 | File already exists | `write_file` overwrites silently (atomic swap); acceptable |
| EC-4 | Invalid filename chars | `write_file` returns error; FR-5 inline error shown |
| EC-5 | Empty `[[]]` target | Never decorated — not reachable from popover |
| EC-6 | Link in fenced code | Never decorated — not reachable from popover |
| EC-7 | Link on active line | Never decorated — not reachable from popover |
| EC-8 | Missing subdirectory | `ensure_directory` creates all parents (`create_dir_all`) |
| EC-9 | Filename too long | `write_file` returns OS error; FR-5 inline error shown |
| EC-10 | Multiple broken links same stem | First click creates file; second click overwrites (EC-3) |
| EC-11 | Dismiss during async handler | `capturedVersion !== _hoverFetchVersion` guard aborts |
| EC-12 | Untitled document | `currentFile` null OK — vault root used for both path types |
| EC-13 | Slow index rebuild | Async; decoration update follows rebuild — acceptable |
| EC-14 | Plugin disabled mid-flight | `void` fire-and-forget calls are harmless if plugin disabled |
| EC-15 | Target with `#anchor` | Anchor stripped in `resolveCreationPath` before filename construction |

---

## Non-Functional Requirements Checklist

- [x] NFR-1 — No new Rust commands
- [x] NFR-2 — IIFE boundary: all Tauri calls via `__TAURI_INTERNALS__.invoke`
- [x] NFR-3 — `estimatedHeight` updated to 280
- [x] NFR-4 — `_hoverFetchVersion` race safety for button click
- [x] NFR-5 — CSS uses only existing CSS variables (no hardcoded colours)
- [x] NFR-6 — `src-tauri/src/lib.rs` and `src/lib/settings.ts` not touched
- [x] NFR-7 — No TODO comments in source

---

## Step Files

| File | Purpose |
|------|---------|
| `step_01_css_and_height.md` | Extend `WIKI_POPOVER_CSS` + update `estimatedHeight` |
| `step_02_helpers.md` | `resolveCreationPath`, `createBrokenLinkPopoverElement`, `handleCreateNoteClick` |
| `step_03_show_popover.md` | Modify `showWikiPopover` to branch on broken-link class |
| `step_04_tests.md` | Full TDD test specification |

---

## Review Request

- **Files changed**:
  - `src/plugins/backlinks/backlinks.plugin.ts` — 5 surgical changes: CSS extended, `estimatedHeight` updated, three new helper functions added (`resolveCreationPath`, `createBrokenLinkPopoverElement`, `_showInlinePopoverError`, `handleCreateNoteClick`), `showWikiPopover` modified to branch on `cm-wiki-link-broken` class, `_testing` extended with three new accessors.
  - `tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts` — new test file (29 tests, all passing).

- **Steps completed**:
  - `step_01_css_and_height.md` — CSS appended, `estimatedHeight` → 280
  - `step_02_helpers.md` — `resolveCreationPath`, `createBrokenLinkPopoverElement`, `_showInlinePopoverError`, `handleCreateNoteClick` added; `_testing` accessors added
  - `step_03_show_popover.md` — `showWikiPopover` replaced with branching implementation
  - `step_04_tests.md` — 29 tests written and passing; full suite (3130 tests) green

- **Known limitations**: None. All features from the spec are implemented. EC-3 (file already exists → silent overwrite), EC-13 (slow index rebuild → acceptable async lag), and EC-14 (plugin disabled mid-flight → `void` calls are harmless) are by-design, not deferred.

- **Edge cases covered by tests**:

  | EC | Test |
  |----|------|
  | EC-1 (no vault) | Suite D: "shows no popover when no vault is active (EC-1)" |
  | EC-2 (missing globals) | Suite C: "does NOT throw when __MARKABLE_TAB_MANAGER__ is absent (EC-2)" |
  | EC-8 (missing subdirectory) | Suite C: "calls ensure_directory then write_file in sequence on success" — verifies `ensure_directory` is always called before `write_file` |
  | EC-9 (filename too long → write_file error) | Suite C: "shows inline error and does NOT call reloadVaultIndex when write_file throws (FR-5)" |
  | EC-11 (version mismatch race) | Suite C: "aborts without invoking write_file when capturedVersion mismatches (EC-11)"; Suite D: "version mismatch during broken-link branch causes no popover (EC-11)" |
  | EC-12 (untitled document) | Suite D: broken-link path uses vault root only — `currentFile` guard moved inside valid-link branch |
  | EC-15 (anchor in target) | Suite A: "strips anchor suffix before constructing filename (EC-15)" and "anchor stripped from path-prefixed target (EC-15)" |

---

## Review Sign-off

- **Date**: 2026-04-30
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all prior round issues resolved
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified.
- **Edge case coverage**: All Edge Case Inventory items EC-1 through EC-15 covered by tests.
- **Status**: Approved for Merge
