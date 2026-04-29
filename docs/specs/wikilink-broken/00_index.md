---
title: Wiki-link Broken Link Highlighting — Architecture Overview
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Wiki-link Broken Link Highlighting — Architecture Overview

## Requirements Source

`docs/requirements/active_task.md` — all decisions below are traceable to a
functional requirement (FR-*) or edge case (EC-*) in that document.

---

## Stack Decision

No new technology is introduced. This feature is a pure TypeScript extension
within the existing stack:

- **CodeMirror 6 ViewPlugin** — existing decoration mechanism; extended
  with a `broken` flag on mark ranges (FR-1, NFR-5)
- **CSS custom property** — `--link-broken-color` on `:root` in `styles.css`
  (FR-7, NFR-6)
- **vault-manager event bus** — `onVaultChanged` / `onIndexUpdated` already
  present and exposed on `window.__MARKABLE_VAULT_MANAGER__` (FR-5)
- **CM6 `StateEffect`** — used to force a view re-render when the vault
  index changes outside of a CM6 transaction (Finding 9 from requirements)

No Rust changes. No new settings fields. No new npm dependencies.

---

## High-Level Architecture

### Data Flow

```
Vault index change                    Editor transaction
        │                                    │
        ▼                                    ▼
onVaultChanged / onIndexUpdated      CM6 update cycle
        │                                    │
        └──── dispatch StateEffect ──────────┘
                        │
                        ▼
              WikiLinkPlugin.update()
                        │
                        ▼
              buildWikiLinkDecorations(view)
                        │
                  reads vault index
                        │
                  builds stemSet  ← O(n) once per call
                        │
                        ▼
        computeWikiLinkDecorationRanges(text, activeLines,
                                        visibleRanges, stemSet)
                        │
           for each mark range:
             lookup stem in stemSet  ← O(1) per link
             set range.broken = true if not found
                        │
                        ▼
        buildWikiLinkDecorations maps ranges → CM6 Decoration
          broken range → class: "cm-live-link cm-wiki-link cm-wiki-link-broken"
          valid range  → class: "cm-live-link cm-wiki-link"
                        │
                        ▼
                   DOM render
```

### No-vault Fast Path

When `getVaultIndex()` returns `null`, `stemSet` is passed as `undefined` to
`computeWikiLinkDecorationRanges`. The pure function treats an absent `stemSet`
as "no broken-link classification"; all links receive only the standard
classes. This preserves EC-01 and NFR-1.

---

## Component Map

### Files Modified

| File | Change summary |
|------|----------------|
| `src/plugins/backlinks/backlinks.plugin.ts` | Four targeted changes (see below) |
| `src/styles.css` | Add `--link-broken-color` variable to `:root` and `[data-theme="dark"]` |

### Files Created

| File | Purpose |
|------|---------|
| `tests/plugins/backlinks/wikilink-broken.test.ts` | Unit tests for broken-link logic (14 edge cases) |

### Files NOT Modified

- `src/editor/live-preview.ts` — wiki-links not decorated here
- `src/editor/extensions.ts` — no new compartment needed
- `src/lib/vault-manager.ts` — public API sufficient
- `src/lib/vault-types.ts` — no new types needed
- `src-tauri/` — no Rust changes (NFR-3)
- `src/lib/settings.ts` — no new settings (NFR-4)

### Four Targeted Changes Inside `backlinks.plugin.ts`

**Change A — `WikiLinkDecorationRange` interface** (line ~415)
Add `broken?: boolean` field to the existing interface. This is the only
type-level change; all other changes flow from it.

**Change B — `computeWikiLinkDecorationRanges` signature + body** (line ~485)
Add optional fourth parameter `stemSet?: Set<string>`. When present, mark
ranges receive `broken: true` if the normalized stem is absent from `stemSet`.
The stem extraction rule: call `normalizeTarget(target)` then strip the `.md`
suffix and take the filename portion after the last `/`.

**Change C — `buildWikiLinkDecorations`** (line ~580)
Build `stemSet` once from `getVaultIndex()` before calling
`computeWikiLinkDecorationRanges`. Pass `stemSet` (or `undefined` when no
vault) as the fourth argument. In the mark-decoration branch, append
`cm-wiki-link-broken` to the class string when `range.broken === true`.

**Change D — `_buildCmExtensions` + `onDisable`** (line ~2822)
Subscribe to `onVaultChanged` and `onIndexUpdated` during `_buildCmExtensions`.
Each callback dispatches a `forceRebuildEffect` `StateEffect` to `_view`.
Store the two callback references in module-level variables. Unsubscribe in
`onDisable`.

**Change E — `injectWikiLinkStyles`** (line ~702)
Add a `.cm-wiki-link-broken` rule to the injected `<style>` tag using
`var(--link-broken-color)`.

---

## Architectural Decisions

### AD-1: `stemSet` passed as parameter, not read from `window` inside pure function

`computeWikiLinkDecorationRanges` must remain testable without any DOM or
window globals (NFR-5). Passing `stemSet` as an optional parameter keeps the
function pure and lets tests exercise it with arbitrary vault states.

### AD-2: Stem extraction algorithm

Given a raw target `t` from a mark range:
```
normalized = normalizeTarget(t)         // e.g. "subdir/notes.md"
withoutExt = normalized.replace(/\.md$/, "")  // "subdir/notes"
stem = withoutExt.slice(withoutExt.lastIndexOf("/") + 1)  // "notes"
lookupKey = stem.toLowerCase()
```
This matches `VaultIndexEntry.name` (which is already the bare stem, no path,
no extension). Case-insensitive to match macOS HFS+ semantics (FR-4, EC-07).

### AD-3: `StateEffect` for vault-change-triggered re-render

`WikiLinkPlugin.update()` only runs on CM6 transactions. Vault changes
(file created/deleted, vault switch) happen outside CM6. The fix is to
dispatch a no-op `StateEffect` to `_view` from the vault subscription
callbacks. This triggers a CM6 update cycle, which calls
`WikiLinkPlugin.update()`, which calls `buildWikiLinkDecorations` with the
freshly updated vault index.

The effect is defined once at module scope:
```typescript
const forceRebuildEffect = StateEffect.define<void>();
```
The dispatch call:
```typescript
_view?.dispatch({ effects: forceRebuildEffect.of(undefined) });
```

`_view` is captured from the `updateListener` already wired in step 4 of
`_buildCmExtensions`. No new view-reference mechanism is needed.

### AD-4: Module-level variables for subscription callbacks

Two new module-level variables hold the subscription callbacks so they can
be unsubscribed in `onDisable` by exact reference (the vault-manager
`offVaultChanged`/`offIndexUpdated` use `Set.delete` which requires the same
function reference):

```typescript
let _onVaultChangedForDecorations: ((v: VaultEntry | null) => void) | null = null;
let _onIndexUpdatedForDecorations: ((e: VaultFileChangedEvent) => void) | null = null;
```

Both are set in `_buildCmExtensions`, nulled in `onDisable`.

### AD-5: CSS architecture — variable in `styles.css`, rule in injected `<style>`

`--link-broken-color` belongs in `styles.css` alongside `--link-color` so
themes can override it with one CSS rule. The `.cm-wiki-link-broken` selector
belongs in the injected `<style>` tag (identified by
`data-markable-wiki-link-styles`) because that tag is the plugin's CSS surface —
consistent with the existing `.cm-wiki-link` rule already there.

### AD-6: `data-wiki-target` attribute preserved on broken links (FR-8)

The only difference between a broken and a valid mark decoration is the class
string. The `attributes` object (including `data-wiki-target`) is built
identically for both cases. Click-to-navigate and hover popover are unaffected.

### AD-7: No `broken` flag on `replace`-type ranges

`broken` is only meaningful for `"mark"` ranges (the visible link text). It
is never set on `"replace"` ranges (`[[`, `|`, `]]` hiding). The interface
field is optional (`broken?: boolean`) and only checked in the `"mark"` branch
of `buildWikiLinkDecorations`.

---

## Implementation Roadmap

| Step | File | Summary |
|------|------|---------|
| `step_01_broken_class.md` | `backlinks.plugin.ts`, `styles.css` | Type extension, pure-function logic, CSS class, CSS variable |
| `step_02_vault_subscription.md` | `backlinks.plugin.ts` | Vault-change subscriptions, StateEffect dispatch, onDisable cleanup |
| `step_03_tests.md` | `tests/plugins/backlinks/wikilink-broken.test.ts` | Full test suite for all 14 edge cases |

Implementation order is strict: step_01 must be complete before step_02 (the
subscription callbacks call `buildWikiLinkDecorations`, which requires the
changes from step_01). step_03 can be written in parallel with step_01 for
the pure-function tests, but vault-subscription tests depend on step_02.

---

## Master Checklist

- [x] `step_01` — `WikiLinkDecorationRange.broken` field added
- [x] `step_01` — `computeWikiLinkDecorationRanges` accepts optional `stemSet`
- [x] `step_01` — stem extraction + case-insensitive lookup correct
- [x] `step_01` — `buildWikiLinkDecorations` builds `stemSet` from vault index
- [x] `step_01` — `cm-wiki-link-broken` class applied only when `range.broken`
- [x] `step_01` — `data-wiki-target` attribute still present on broken links
- [x] `step_01` — `injectWikiLinkStyles` adds `.cm-wiki-link-broken` rule
- [x] `step_01` — `--link-broken-color` added to `:root` in `styles.css`
- [x] `step_01` — `--link-broken-color` dark-mode override added to `[data-theme="dark"]`
- [x] `step_02` — `forceRebuildEffect` `StateEffect` defined at module scope
- [x] `step_02` — `_onVaultChangedForDecorations` module-level variable declared
- [x] `step_02` — `_onIndexUpdatedForDecorations` module-level variable declared
- [x] `step_02` — subscriptions wired in `_buildCmExtensions`
- [x] `step_02` — subscriptions unsubscribed in `onDisable`
- [x] `step_02` — callback variables nulled in `onDisable`
- [x] `step_03` — EC-01 through EC-14 each have at least one test
- [x] `step_03` — existing `computeWikiLinkDecorationRanges` tests pass without change
- [x] All existing backlinks tests still pass (`npm run test:run -- tests/plugins/backlinks/backlinks.test.ts`)

---

## Deferred Work (Out of Scope)

The following items are explicitly out of scope per requirements. Log here if
discovered during implementation.

- Broken-link click-to-create shortcut
- Broken link count badge in sidebar
- Non-vault relative-path broken detection
- User preference toggle for this feature
- `[[target#heading]]` explicit test coverage
- Transition animation between broken/valid states

---

## Review Request (post-code-review fixes — 2026-04-28)

All 6 findings from the code review have been resolved.

- **Files changed**:
  - `src/plugins/backlinks/backlinks.plugin.ts` — `WikiLinkDecorationRange.broken` field; `stemForLookup` helper (now with `#` anchor strip — Finding 1); `computeWikiLinkDecorationRanges` 4th param + mark-range classification + justification comment (Finding 6); `buildWikiLinkDecorations` stemSet build + `cm-wiki-link-broken` class + justification comment (Finding 6); `injectWikiLinkStyles` broken-link CSS rule now includes `text-decoration-line: underline` (Finding 5); `forceRebuildEffect` + `_onVaultChangedForDecorations` + `_onIndexUpdatedForDecorations` module-level vars; `__test_only_getDecorationCallbacks` exported accessor (Finding 2); vault subscription wiring in `_buildCmExtensions` + justification comment + `_view === null` guard comments (Findings 3, 6); `onDisable` null-vault-manager comment + justification comment (Findings 4, 6).
  - `src/styles.css` — `--link-broken-color` in `:root` (light-mode) and `[data-theme="dark"]` override.
  - `tests/plugins/backlinks/wikilink-broken.test.ts` — 28 tests (was 23); added: anchor-suffix tests (Finding 1, 3 new tests), `__test_only_getDecorationCallbacks` identity test (Finding 2), `_view === null` no-crash test (Finding 3).

- **Steps completed**: `step_01_broken_class.md`, `step_02_vault_subscription.md`, `step_03_tests.md`

- **Known limitations**:
  - `StateEffect` type argument omitted (`StateEffect.define()` instead of `StateEffect.define<void>()`) because TypeScript TS2347 forbids generic calls on untyped (`any`) functions. Behavior is identical at runtime. Documented in source comment.
  - Vault subscription tests (EC-08, EC-09, EC-10, EC-14) simulate the callback contract directly (using the callback pattern from `_buildCmExtensions`) because the plugin lifecycle requires a full CM6 environment. The `__test_only_getDecorationCallbacks()` accessor now provides a seam to verify the accessor is callable and typed correctly. End-to-end integration remains covered by the running application.

- **Edge cases covered by tests**:
  - EC-01 (no vault, stemSet absent) → "EC-01: no vault active — stemSet absent" (2 tests)
  - EC-02 (empty vault) → "EC-02: vault active with empty index" (1 test)
  - EC-03 (empty `[[]]`) → "EC-03: empty wiki-link [[]]" (1 test)
  - EC-04 (piped broken) → "EC-04: piped link with broken target" (1 test)
  - EC-05 (piped valid) → "EC-05: piped link with valid target" (1 test)
  - EC-06 (subdirectory path) → "EC-06: subdirectory path in wiki-link" (2 tests)
  - EC-07 (case mismatch) → "EC-07: case-insensitive stem comparison" (3 tests)
  - EC-08 (file deleted) → "vault subscription dispatch" EC-08 test
  - EC-09 (file created) → "vault subscription dispatch" EC-09 test
  - EC-10 (vault switch) → "vault subscription dispatch" EC-10 test
  - EC-11 (fenced code) → "EC-11: wiki-link inside fenced code block" (1 test)
  - EC-12 (explicit .md) → "EC-12: explicit .md extension in wiki-link target" (2 tests)
  - EC-13 (capped index) → "EC-13: vault index capped behavior" (1 test)
  - EC-14 (plugin disabled) → "vault subscription dispatch" EC-14 tests (2 tests)
  - Finding 1 (anchor suffix) → "anchor suffix stripping in stemForLookup" (3 tests)
  - Finding 2 (callback identity) → "__test_only_getDecorationCallbacks returns the same references passed to vault manager" (1 test)
  - Finding 3 (_view null) → "vault callbacks do not crash when _view is null" (1 test)
