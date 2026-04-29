---
title: Wiki-link Visual Decorations — Broken Link Highlighting
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Wiki-link Visual Decorations — Broken Link Highlighting

## Feature Summary

As a user, I want `[[wikilinks]]` whose target file does not exist in the vault index to be visually distinct from valid links, so I can immediately see which links are broken without opening each one.

---

## Codebase Context Findings

### Finding 1 — Where wiki-link spans are created

Wiki-link decorations are produced entirely inside
`src/plugins/backlinks/backlinks.plugin.ts` (the backlinks core plugin, not
`live-preview.ts`). The key functions are:

- `computeWikiLinkDecorationRanges()` — pure function; scans document text and
  returns `WikiLinkDecorationRange[]` (type = `"replace"` or `"mark"`, optional
  `target` field on mark ranges).
- `buildWikiLinkDecorations(view)` — converts those ranges to CM6 `Decoration`
  objects. Mark decorations are emitted with:
  `class: "cm-live-link cm-wiki-link"` and
  `attributes: { "data-wiki-target": range.target }`.
- `buildWikiLinkDecorationExtension()` — wraps the above into a CM6
  `ViewPlugin` that rebuilds on every update.

The `WikiLinkPlugin` ViewPlugin calls `buildWikiLinkDecorations(view)` in its
constructor and on every `update()`. It currently has no awareness of the vault
index and cannot distinguish broken from valid links.

### Finding 2 — How to query vault index existence

`src/lib/vault-manager.ts` exposes `getVaultIndex()` (returns `VaultIndex |
null`). The `VaultIndex.entries` array contains `VaultIndexEntry` objects where
`entry.name` is the filename stem without extension (i.e. `"notes"` for
`notes.md`). This is the canonical lookup key for wiki-link resolution.

The vault manager is exposed as `window.__MARKABLE_VAULT_MANAGER__` for IIFE
plugin use (vault-manager.ts line 623). The backlinks plugin already accesses
it this way in autocomplete and index-building code (e.g. lines 1112–1113).

For O(1) lookup a `Set<string>` of lowercased stems must be built from
`vaultIndex.entries` and passed to (or rebuilt inside) `buildWikiLinkDecorations`.
Building the `Set` is O(n) once per decoration rebuild, but individual lookups
within the loop are O(1).

### Finding 3 — Vault index change notifications

`vault-manager.ts` exposes `onVaultChanged(cb)` and `onIndexUpdated(cb)`. The
backlinks plugin's `_buildCmExtensions` (lines 2874–2904) uses a CM6
`EditorView.updateListener` and a 500ms poll timer to detect file changes but
does NOT subscribe to `onVaultChanged` or `onIndexUpdated`. Adding subscriptions
would allow the decoration to react to vault switches and file-watcher events
without waiting for the next editor transaction.

### Finding 4 — No-vault mode

When no vault is active, `getVaultIndex()` returns `null`. In this state the
backlinks plugin degrades gracefully (autocomplete falls back to directory
scan). Broken-link highlighting must similarly degrade: when the vault index is
null, no broken-link decoration is applied — all wiki-links render with the
standard `cm-live-link cm-wiki-link` class as today.

### Finding 5 — Current CSS surface

`src/styles.css` defines `.cm-live-link` (color: `var(--link-color)`,
underline, pointer cursor). The backlinks plugin injects a minimal `<style>`
tag (identified by `data-markable-wiki-link-styles`) that adds only
`cursor: pointer` to `.cm-wiki-link`. There is no existing broken-link class.

The broken-link color should use a new CSS variable — e.g.
`--link-broken-color` — so themes can override it without touching the plugin.
A fallback value (e.g. `#cc3333` for light / `#ff6b6b` for dark) must be
defined in `styles.css`.

### Finding 6 — Target normalization

`normalizeTarget(target)` strips `./`, trims whitespace, and appends `.md` if
the target has no extension. The vault index `entry.name` is the bare stem
without `.md`. Therefore the lookup must compare the normalized target's stem
(without extension) against `entry.name`. The comparison must be
case-insensitive because macOS HFS+ is case-insensitive.

### Finding 7 — `computeWikiLinkDecorationRanges` is the pure testable core

This function has no access to the vault index because it takes only `text`,
`activeLines`, and `visibleRanges`. To keep it testable, the vault stem set
should be passed as an optional fourth parameter rather than reading from
`window` globals inside the pure function.

### Finding 8 — The `WikiLinkDecorationRange` type must be extended

`WikiLinkDecorationRange` currently has: `from`, `to`, `type` (`"replace"` |
`"mark"`), optional `target`. A new optional boolean field `broken` is needed
on `"mark"` ranges so `buildWikiLinkDecorations` knows which spans to annotate
with the broken class.

### Finding 9 — Decoration rebuild trigger for vault changes

The `WikiLinkPlugin.update()` rebuilds on every CM6 transaction. Vault index
changes (file added / deleted externally) do not produce a CM6 transaction.
The fix is to subscribe to `onVaultChanged` and `onIndexUpdated` during
`onEnable`, and dispatch a no-op `EditorView.scrollIntoView(0)` or a
custom `StateEffect` when the vault index changes so CM6 forces a re-render
of the `WikiLinkPlugin`. The subscription must be cleaned up in `onDisable`
via `offVaultChanged` / `offIndexUpdated`.

### Finding 10 — Plugin is an IIFE compiled file

`backlinks.plugin.ts` is the source that compiles to
`plugins/core/backlinks.plugin.js` at build time. Changes to this file affect
the compiled IIFE. No other plugin files need changing.

---

## Functional Requirements

**FR-1 — Broken link visual indicator**
When a vault is active and a wiki-link's target stem does not exist in the
vault index, the link span must receive an additional CSS class
`cm-wiki-link-broken` alongside the existing `cm-live-link cm-wiki-link`
classes. This class must apply a visually distinct color (e.g. muted red or
orange) to distinguish it from valid links.

**FR-2 — Valid link appearance unchanged**
When a vault is active and a wiki-link's target stem resolves to a file in
the vault index, the link span must render identically to today: only
`cm-live-link cm-wiki-link` classes, no additional class.

**FR-3 — No-vault graceful degradation**
When no vault is active (`getVaultIndex()` returns `null`), no broken-link
decoration is applied. All wiki-links render as standard `cm-live-link
cm-wiki-link` spans. This matches the existing no-vault behavior.

**FR-4 — Case-insensitive stem comparison**
Target stem lookup against vault index entries must be case-insensitive
(lowercase both sides) to match macOS HFS+ case-insensitivity semantics.

**FR-5 — Decoration updates on vault index changes**
When the vault index changes (vault switch, file added, file deleted, file
renamed), the broken-link highlighting must update within one CM6 render cycle
after the change is reflected in `getVaultIndex()`. This requires subscribing
to `onVaultChanged` and `onIndexUpdated` and dispatching an effect that forces
the `WikiLinkPlugin` to rebuild.

**FR-6 — Active line exclusion preserved**
Wiki-links on the active cursor line must continue to show raw Markdown syntax
(existing behavior). The broken-link class must not be applied to links on
active lines, consistent with the existing `activeLines` filter.

**FR-7 — CSS variable for broken link color**
The broken link color must be defined as `--link-broken-color` in `styles.css`
with a fallback value, allowing theme overrides. The plugin's injected `<style>`
tag (identified by `data-markable-wiki-link-styles`) must add the
`.cm-wiki-link-broken` rule using `var(--link-broken-color)`.

**FR-8 — `data-wiki-target` attribute preserved on broken links**
Broken link spans must still carry `data-wiki-target` so the existing hover
popover (Step 10 of backlinks.plugin.ts) and click-to-navigate handler (Step 5)
continue to function. The only change is an additional CSS class.

**FR-9 — O(1) per-link vault lookup**
A `Set<string>` of lowercased stems must be built once per `buildWikiLinkDecorations`
call from `vaultIndex.entries`, and individual link lookups must use `Set.has()`.
Building the set is O(n) in vault size but is bounded by `maxIndexSize` (default
500). Per-link lookup is O(1).

---

## Edge Case Inventory

**EC-01 — No vault active**
`getVaultIndex()` returns `null`. Expected: all wiki-links render as valid
(standard `cm-live-link cm-wiki-link`). No broken-link class applied.

**EC-02 — Vault active but index is empty (`entries: []`)**
The stem set is empty; every wiki-link is classified as broken. This is correct
behavior: an empty vault has no files. (The user may want to create those files.)

**EC-03 — Empty wiki-link `[[]]`**
`computeWikiLinkDecorationRanges` already skips `[[]]` (EC-9 in the existing
spec). No mark range is produced, so no broken-link check is needed.

**EC-04 — Piped wiki-link with broken target `[[missing|Display Text]]`**
`WikiLinkDecorationRange.target` carries `"missing"` (the raw target before
the pipe). After normalization the stem is `"missing"`. If `"missing"` is not
in the vault index, the span covering `"Display Text"` receives
`cm-wiki-link-broken`. The display text itself is unchanged.

**EC-05 — Piped wiki-link with valid target `[[exists|Custom Label]]`**
Target normalizes to `"exists"`. Stem `"exists"` is in the vault index. Span
renders without `cm-wiki-link-broken`.

**EC-06 — Target with subdirectory path `[[subdir/notes]]`**
`normalizeTarget` appends `.md` → `"subdir/notes.md"`. The stem for lookup is
`"notes"` (filename part only, without `.md`). The vault index `entry.name` is
`"notes"` (stem without extension). Lookup must extract the filename portion
from the normalized target before comparing against `entry.name`.

**EC-07 — Case mismatch `[[Notes]]` vs vault entry `"notes"`**
Both sides lowercased → match. No broken-link class applied.

**EC-08 — File deleted from vault while editor is open**
The file-watcher emits `VaultFileChangedEvent { eventType: "deleted" }`. The
`onIndexUpdated` subscription dispatches an effect to the CM6 editor. On the
next render, `buildWikiLinkDecorations` rebuilds with the updated index stem
set. The wiki-link targeting the deleted file now shows `cm-wiki-link-broken`.

**EC-09 — File created in vault that resolves a previously broken link**
Same mechanism as EC-08 but `eventType: "created"`. The link transitions from
`cm-wiki-link-broken` to the standard `cm-live-link cm-wiki-link` appearance
on the next render.

**EC-10 — Vault switch while the document contains wiki-links**
`onVaultChanged` fires. The subscription dispatches an effect. The new vault's
index is used for the next render. Links that existed in the old vault but not
the new one become broken (and vice versa).

**EC-11 — Wiki-link inside fenced code block**
`computeWikiLinkDecorationRanges` already excludes these via
`isInsideFencedCode`. No decoration is produced; no broken-link check is needed.

**EC-12 — Wiki-link target with `.md` extension explicitly written `[[file.md]]`**
`normalizeTarget("file.md")` → `"file.md"` (extension present, no appending).
The stem for lookup is `"file"` (strip `.md`). Must match `entry.name = "file"`.

**EC-13 — Vault index capped (`capped: true`)**
The index contains at most `maxIndexSize` entries. A wiki-link targeting a file
beyond the cap will be classified as broken even if the file exists on disk.
This is the accepted trade-off documented in `vault-types.ts`. No special
handling is needed; the behavior matches the cap semantics already in place.

**EC-14 — Plugin disabled while vault is active**
`onDisable` must call `offVaultChanged` and `offIndexUpdated` to unsubscribe
the decoration-refresh callbacks, preventing dangling listeners that dispatch
effects to a detached view.

---

## Non-Functional Requirements

**NFR-1 — No regression to existing wiki-link behavior**
All existing behavior of `computeWikiLinkDecorationRanges`,
`buildWikiLinkDecorations`, click navigation, hover popover, and autocomplete
must be preserved. The `broken` flag is additive.

**NFR-2 — O(1) per-link lookup**
See FR-9. The stem set must be constructed outside the per-link loop.

**NFR-3 — No new Rust commands**
Vault index querying is entirely in TypeScript via `getVaultIndex()`. No
changes to `src-tauri/`.

**NFR-4 — No new settings fields**
`MarkableSettings` must not be extended. No user toggle for broken-link
highlighting is required at this time.

**NFR-5 — Pure function remains testable**
`computeWikiLinkDecorationRanges` must accept an optional `stemSet:
Set<string>` fourth parameter. When absent (undefined), the function behaves
as today (no broken classification). Existing unit tests must pass unchanged;
new tests exercise the `stemSet` parameter.

**NFR-6 — CSS variable scoped to root**
`--link-broken-color` must be defined on `:root` in `styles.css` so both light
and dark theme overrides can target it.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/plugins/backlinks/backlinks.plugin.ts` | Add `broken?: boolean` to `WikiLinkDecorationRange`; add `stemSet` param to `computeWikiLinkDecorationRanges`; add `cm-wiki-link-broken` class in `buildWikiLinkDecorations`; add `--link-broken-color` CSS rule in `injectWikiLinkStyles`; subscribe to `onVaultChanged` / `onIndexUpdated` in `_buildCmExtensions`; unsubscribe in `onDisable` |
| `src/styles.css` | Add `--link-broken-color` CSS variable on `:root` with light-mode default; add dark-mode override if a dark theme selector exists |
| `tests/backlinks/` (new or existing test files) | Add unit tests for `computeWikiLinkDecorationRanges` with `stemSet`; cover EC-01 through EC-07, EC-11, EC-12 |

Files that must NOT change:

| File | Reason |
|------|--------|
| `src/editor/live-preview.ts` | Wiki-links are not decorated here; no change needed |
| `src/editor/extensions.ts` | No new compartment or extension required |
| `src/lib/vault-manager.ts` | Public API is sufficient; no new exports needed |
| `src/lib/vault-types.ts` | No new types required |
| `src-tauri/` (all Rust) | No backend changes needed |

---

## Out of Scope

- **Broken link creation shortcut** — clicking a broken link to create the
  missing file. Deferred.
- **Broken link count badge** in the sidebar backlinks panel. Deferred.
- **Non-vault mode broken detection** (e.g. resolving relative paths against the
  current file's directory when no vault is active). Deferred.
- **User preference to disable broken-link highlighting**. Deferred.
- **Animating the transition** when a link changes state (broken ↔ valid).
  Deferred.
- **`[[target#heading]]` anchor syntax** — anchor portion is stripped by the
  existing regex before the stem check, so this works transparently. No
  separate feature work needed, but explicit test coverage is out of scope.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 14 items in Edge Case Inventory (EC-01 through EC-14)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
