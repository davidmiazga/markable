---
title: Create Note from Broken Wiki-Link
last-updated: "2026-04-30"
review-cadence-days: 90
status: archive
---

> **COMPLETED 2026-04-30.** Implemented and code-reviewer approved. See PROGRESS.md.

# Create Note from Broken Wiki-Link

## Feature Summary

As a user writing in Markable with a vault open, I want to hover over a red
broken wiki-link (`[[stem]]` whose target does not exist in the vault) and click
a "Create note" button in the hover popover, so that the missing file is created
at the correct vault path and immediately opened in a new tab — letting me
capture ideas by typing `[[new idea]]` first and creating the note on demand.

---

## Codebase Context Findings

### Finding 1 — All wiki-link and hover-popover logic lives in `backlinks.plugin.ts`

Despite the context brief referring to separate files
`wiki-link-decorations.ts` and `wiki-link-hover.ts`, those files do not exist in
the repository. The entire implementation — decoration, click navigation, hover
popover, backlinks panel, and plugin lifecycle — is contained in
`src/plugins/backlinks/backlinks.plugin.ts` (roughly 3 000 lines). This is a
compiled IIFE plugin that is evaluated at runtime by the plugin manager.

The relevant sections by step label:
- **Step 4** (`buildWikiLinkDecorations`, `computeWikiLinkDecorationRanges`): marks
  broken links with `class="cm-live-link cm-wiki-link cm-wiki-link-broken"` and
  `data-wiki-target` attribute. Broken flag set when target stem absent from
  vault `stemSet`.
- **Step 5** (`handleWikiLinkClick`, `buildClickHandler`): click-to-navigate; resolves
  path via `resolveWikiLinkPath` then calls `tabManager.openFileInTab()`.
- **Step 10** (`showWikiPopover`, `dismissWikiPopover`, `createPopoverElement`,
  `positionPopover`, `buildHoverHandler`): 180 ms delayed popover with title,
  vault-relative path label, and body excerpt. Popover is built for valid links
  only today — it reads the file, and if `result.ok === false` (file not found),
  silently returns without rendering (`EC-01` in Step 10 comments).

### Finding 2 — Broken link has `data-wiki-target` set but triggers no popover today

In `showWikiPopover()`, the code calls `resolveWikiLinkPath(currentFile, target)`
then `invokeReadFile(resolvedPath)`. If the read fails (`!result.ok`), the
function returns immediately with a `console.debug` log (line ~2722). So broken
links currently produce no popover at all. The hover handler does NOT check
whether the span has the `cm-wiki-link-broken` class before starting the 180 ms
timer — the timer fires for all `.cm-wiki-link` spans regardless. The "Create
note" button must therefore be injected into the code path that runs when the
file read fails.

### Finding 3 — `writeFile` and `ensureDirectory` are already in `bridge.ts`

`bridge.ts` exports `writeFile(path, content): Promise<FileResult<void>>` (atomic
temp-file-swap, line 79) and `ensureDirectory(path): Promise<void>` (line 243,
wraps `ensure_directory` Rust command). Both are available to IIFE plugins only
via `window.__TAURI_INTERNALS__.invoke` — they cannot import ES modules directly.
The "Create note" flow must call both Tauri commands via
`__TAURI_INTERNALS__.invoke('write_file', …)` and
`__TAURI_INTERNALS__.invoke('ensure_directory', …)`.

### Finding 4 — Vault root path and index access

`window.__MARKABLE_VAULT_MANAGER__.getActiveVault()` returns the `VaultEntry`
object. `VaultEntry.rootPaths[0]` is the vault root. The `VaultIndexEntry.name`
field is the lowercase stem (no extension) used for broken-link detection. After
note creation the stem must appear in the vault index so the decoration re-renders
as a valid link. `window.__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()` is the
correct call (triggers a full rebuild + `emitVaultChanged`), which causes the
backlinks plugin's `_onVaultChangedForDecorations` callback to dispatch
`forceRebuildEffect` and refresh all decorations.

### Finding 5 — Path resolution for wikilinks with path prefixes

`resolveWikiLinkPath(currentFile, target)` already handles path prefixes in
targets. For `[[folder/note]]`, it produces
`{directory-of-current-file}/folder/note.md`. However, for the "Create note"
feature the resolution must be vault-root-relative when the target contains a
slash, not current-file-directory-relative. This is a deliberate design decision
that needs to be locked down (see Functional Requirements FR-2).

### Finding 6 — `openFileInTab` signature

`tabManager.openFileInTab(path: string): Promise<boolean>` is exposed on
`window.__MARKABLE_TAB_MANAGER__` (set in `main.ts` line 899). It reads the file
from disk, creates a tab, and switches to it. For a freshly-created note, the
file exists on disk before this call is made.

### Finding 7 — Existing popover DOM structure

`createPopoverElement(title, pathLabel, excerpt)` builds a `<div
data-markable-wiki-popover>` containing `.wl-popover-title`, `.wl-popover-path`,
and `.wl-popover-excerpt` rows. The returned element is appended to
`document.body`. A "Create note" button needs a fourth row below the excerpt (or
replacing title/path when the file does not exist). The element is created fresh
on every `showWikiPopover` call and removed on `dismissWikiPopover`.

### Finding 8 — The `reloadVaultIndex` path updates decorations

`reloadVaultIndex()` in `vault-manager.ts` calls `buildAndCacheIndex()` then
calls `emitVaultChanged(activeVault)`. The backlinks plugin subscribes to
`onVaultChanged` via `_onVaultChangedForDecorations`; that callback dispatches
`forceRebuildEffect` to the editor view, which triggers a ViewPlugin update and
rebuilds the `stemSet`, classifying the newly-created stem as valid. This is the
correct and existing mechanism — no special decoration invalidation is required.

### Finding 9 — `normalizeTarget` and `stemForLookup` define the vault-root path logic

`normalizeTarget(t)` (module-private helper) lowercases and normalises slashes.
`stemForLookup(rawTarget)` extracts the basename stem. For `[[folder/note]]` the
lookup stem is `"note"` (just the filename, not the full path). This means two
notes in different folders with the same stem are treated as ambiguous. The
"Create note" feature must use the same basename stem logic to determine what
folder path to create the note in.

### Finding 10 — Banner/toast pattern for error feedback

The file-browser plugin uses an inline `showInlineError(container, msg)` pattern
for errors within its panel DOM. `main.ts` and `vault-manager.ts` use
`console.error` for non-UI errors. For a creation failure inside the popover, a
short inline error label within the popover is the most coherent UX (consistent
with popover-contained UI). A separate toast infrastructure does not exist; the
popover itself is the feedback surface.

---

## Functional Requirements

### FR-1 — Trigger: "Create note" button in hover popover for broken links

When the hover popover is triggered on a span with `cm-wiki-link-broken` class
(i.e., the read in `showWikiPopover` returns `!result.ok`), the popover must
still be displayed. Instead of title/excerpt content, it shows:

- Title row: the stem text (e.g. `"New Idea"`, derived from the target after
  stripping path prefix and capitalising for display purposes — see FR-3 for
  initial file content).
- Path row: the resolved creation path, vault-root-relative (e.g.
  `"folder/new-idea.md"`), so the user sees where the file will land.
- Excerpt row: omitted (no content yet).
- Action row: a `<button class="wl-popover-create-btn">Create note</button>`.

When no vault is active, the broken-link popover is suppressed entirely (same
as today's behaviour — `getActiveVault()` returns null, no creation path can be
computed).

### FR-2 — Path resolution for new note creation

The target string from `data-wiki-target` is resolved to an absolute creation
path using the following rule:

- **No path prefix** (e.g. `[[new idea]]`): create at
  `{vaultRoot}/{stem}.md`. The stem is taken from `stemForLookup` logic
  (basename, lowercase, `.md`-stripped). The filename on disk uses the raw
  (un-lowercased) target text as given, preserving the author's capitalisation
  (e.g. `[[New Idea]]` creates `{vaultRoot}/New Idea.md`). The vault index stem
  lookup is case-insensitive (current behaviour) so the decoration will resolve
  after creation.
- **Path prefix** (e.g. `[[folder/note]]`): create at
  `{vaultRoot}/{target}.md` where `{target}` is the raw (un-lowercased) target
  string. If the path is relative (no leading `/`), it is always resolved
  relative to the vault root, NOT the current file's directory. This is
  intentional: wiki-links with path prefixes in Obsidian-style vaults are
  vault-root-relative.
- If the target starts with `/` (absolute path), treat it as absolute without
  prepending vault root (unusual, but must not crash).

The directory component of the resolved path (if any) is created via
`ensure_directory` before the file is written.

### FR-3 — Initial file content

New notes are created with the following content template:

```
# {DisplayStem}
```

where `{DisplayStem}` is the target text after stripping any path prefix
(e.g. `[[folder/New Idea]]` → `New Idea`).

Rationale: A bare H1 heading is the lightest possible starting point. It gives
the file a title that the popover and vault index can discover immediately
(title extraction priority 2 in `extractPopoverContent`). YAML front matter is
not required and adds friction for quick capture. Front matter can always be
inserted by the user or a template plugin after creation.

### FR-4 — Post-creation behaviour

After successful file creation:

1. Call `window.__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()` to rebuild the
   vault index, which triggers `emitVaultChanged` and causes the decoration
   plugin to rebuild its `stemSet`. The formerly-broken link decoration re-renders
   as a valid link (blue underline, no wavy red).
2. Call `window.__MARKABLE_TAB_MANAGER__.openFileInTab(absolutePath)` to open
   the new note immediately in a tab. The user is taken to the new file.
3. Dismiss the popover via `dismissWikiPopover()`.

The index reload and tab open are performed in that order. Both calls are
fire-and-forget via `void`; errors are caught and logged, not surfaced to the user
unless the write step itself fails (see FR-5).

### FR-5 — Error handling for creation failure

If any step fails:

- `ensure_directory` failure: show an inline error message inside the popover
  (replacing the "Create note" button with text such as
  `"Could not create folder: {error}"`). The popover remains open so the user
  can read the error.
- `write_file` failure: same — show inline error inside the popover.
- `reloadVaultIndex` failure: logged to console, not surfaced (non-fatal; the
  tab still opens and the user can reload manually).
- `openFileInTab` failure: logged to console, not surfaced as a dialog (the
  file was created; the user can navigate to it from the file browser).

### FR-6 — Decoration update after creation

Decoration update is achieved by the `reloadVaultIndex()` → `emitVaultChanged`
→ `forceRebuildEffect` chain already established in the codebase (Finding 8).
No additional decoration invalidation mechanism is required. The decoration will
update within the time it takes `buildAndCacheIndex` to complete (typically
under 100 ms for small vaults).

### FR-7 — Button style and placement in the popover

The "Create note" button is appended as a final row inside the popover element.
It uses a new CSS class `wl-popover-create-btn` injected alongside the existing
`WIKI_POPOVER_CSS` string in `injectWikiPopoverStyles()`. The button style must
use existing CSS variables only:
- Background: `var(--link-color)` at 15% opacity or `var(--bg-secondary)`.
- Text colour: `var(--link-color)`.
- Border: `1px solid var(--link-color)`.
- Padding: `4px 10px`.
- Border-radius: `4px`.
- Font: `var(--ui-font)`, 12px.
- Cursor: `pointer`.
- Hover state: background increases to `var(--link-color)` at 25% opacity.

### FR-8 — Popover shown for broken links even when file read fails

Today `showWikiPopover` returns early on `!result.ok`. The implementation must
be changed so that for broken links (identified by the `cm-wiki-link-broken`
class on the span element), a popover IS shown (the "Create note" popover
variant). For valid links that fail to read for other reasons (permissions,
etc.) the existing early-return behaviour is preserved.

The span element is available as the first argument to `showWikiPopover`. The
broken state is detected by checking `spanEl.classList.contains('cm-wiki-link-broken')`.

---

## Edge Case Inventory

**EC-1 — No vault active when "Create note" is clicked**
`getActiveVault()` returns null. No vault root can be computed. Expected: the
broken-link popover is suppressed entirely (no popover shown, same as today for
valid links without a current file). The 180 ms hover timer still fires but
`showWikiPopover` returns early before rendering. No crash.

**EC-2 — `__MARKABLE_TAB_MANAGER__` or `__MARKABLE_VAULT_MANAGER__` not available**
The window globals may be absent in edge cases (race during startup, test
environment). Expected: each access is null-guarded with optional chaining.
Button click is a no-op with a `console.warn` if the global is missing.

**EC-3 — File already exists at creation path (race condition)**
Two popover-create actions target the same stem, or the file was created
externally between the time the index was built and the click. `write_file`
uses atomic temp-file-swap — writing to an existing path overwrites it. Since
the initial content is just `# {stem}`, overwriting an empty/small file is
acceptable. Expected: creation succeeds silently; the file is opened. If the
file already contained content, the overwrite destroys it — this is acceptable
given the scenario (broken link means it wasn't in the index at hover time).

**EC-4 — Target stem contains characters invalid on macOS filenames**
Characters like `:`, `/` in the stem portion (after path prefix stripping). A
colon in `[[Work: Notes]]` produces a filename `Work: Notes.md`, which is
invalid on APFS/HFS+. Expected: `write_file` will fail; FR-5 error handling
surfaces the error inline. Character sanitisation of stems is out of scope (the
user chose the target text). The inline error message indicates the failure.

**EC-5 — Target is an empty string (`[[]]`)**
`computeWikiLinkDecorationRanges` skips empty spans (`if (openEnd < closeStart)`)
so no mark decoration is created for `[[]]`. This edge case cannot be triggered
from the popover. No action required.

**EC-6 — Wiki-link inside a fenced code block**
`isInsideFencedCode` check already prevents decoration of code-block links
(existing Step 4 logic). No broken-link popover fires. Not a new concern.

**EC-7 — Wiki-link on the active (cursor) line**
Active-line links are not decorated (existing behaviour — `activeLines.has(lineNum)`
skip). The hover handler never fires on undecorated spans. Not a new concern.

**EC-8 — Path prefix points to a subdirectory that does not exist**
`[[subfolder/note]]` but `{vaultRoot}/subfolder/` does not exist. Expected:
`ensure_directory` is called for `{vaultRoot}/subfolder/` before `write_file`.
`ensure_directory` creates all intermediate directories (wraps
`std::fs::create_dir_all` on the Rust side). If this fails (permissions), the
inline error is shown (FR-5).

**EC-9 — Very long target text**
A `[[note stem that is very long and approaches filesystem limits]]` target may
exceed macOS's 255-byte filename limit. Expected: `write_file` returns an error.
FR-5 inline error is shown. No truncation is applied by this feature.

**EC-10 — Multiple broken links for the same stem in the document**
Two spans share target `"missing"`. Both get the `cm-wiki-link-broken` class.
The user hovers one, clicks "Create note". The file is created and the vault
index is rebuilt. Expected: both decorations update to valid-link style when the
ViewPlugin rebuilds after `emitVaultChanged`. Only one file is created (the
first click wins; subsequent clicks would find the file already exists — EC-3).

**EC-11 — User dismisses the popover during the async `write_file` call**
`dismissWikiPopover()` increments `_hoverFetchVersion`. The button click handler
must capture `_hoverFetchVersion` before the async Tauri calls and abort if the
version changes by the time the calls return. Without this guard, a dismissed
popover could still trigger `reloadVaultIndex` and `openFileInTab`.

**EC-12 — Untitled document (no `__MARKABLE_CURRENT_FILE__`)**
`currentFile` is null. FR-2 path resolution for non-prefixed links requires a
vault root (not the current file's directory), so creation is still possible for
those. However, for path-prefixed links (`[[folder/note]]`), creation is also
vault-root-relative so `currentFile` is not needed. Expected: creation proceeds
using `getActiveVault().rootPaths[0]` as the base path. If `getActiveVault()`
is also null, EC-1 applies.

**EC-13 — `reloadVaultIndex` is slow for large vaults**
For a vault with 500 files the index rebuild takes up to a few seconds. The
decoration update is async — the decoration may briefly remain "broken" after
tab open. Expected: this is acceptable. The tab opens immediately; the
decoration update follows when the rebuild completes.

**EC-14 — Plugin disabled while the async button-click handler is in flight**
`_enabled` is checked at the start of `showWikiPopover` but the create-note
button click is a standalone DOM event listener. If the plugin is disabled while
a create-note action is in progress, the tab open and index reload may still
fire. Expected: `void` calls for `reloadVaultIndex` and `openFileInTab` are
fire-and-forget and do not harm the app state even if the plugin is disabled.

**EC-15 — Target with `#heading` anchor (e.g. `[[note#intro]]`)**
`stemForLookup` already strips the anchor before the Set lookup. For creation
the anchor must also be stripped before constructing the filename — a file
`note#intro.md` is not valid. Expected: the anchor suffix is stripped; the file
created is `{vaultRoot}/note.md`. The anchor text is discarded (no heading is
auto-created inside the new file for the anchor target).

---

## Non-Functional Requirements

**NFR-1 — No new Rust commands**
The feature uses only existing Tauri commands: `ensure_directory`, `write_file`,
`build_vault_index` (via `reloadVaultIndex`). No new Cargo dependencies.

**NFR-2 — IIFE boundary compliance**
All Tauri calls within the plugin use `window.__TAURI_INTERNALS__.invoke(...)`,
not ES module imports from `bridge.ts`. This matches the existing pattern in
`backlinks.plugin.ts`.

**NFR-3 — Popover positioning unchanged**
The `positionPopover` function requires no changes. The broken-link popover uses
the same fixed-position layout as the preview popover. The added "Create note"
button row increases the popover's height; the 240 px `estimatedHeight` constant
used in the flip-above calculation should be increased to 280 px to account for
the additional button row.

**NFR-4 — Race safety for button click**
The button click handler must use the `_hoverFetchVersion` increment pattern
(same as `dismissWikiPopover` and `showWikiPopover`) to discard results from
clicks that are superseded by a dismiss action.

**NFR-5 — CSS uses only existing CSS variables**
The new `wl-popover-create-btn` style must not introduce hardcoded colours.

**NFR-6 — Window size invariant must not regress**
No changes to `src-tauri/src/lib.rs` or `src/lib/settings.ts` are required by
this feature. The window size invariant is unaffected.

**NFR-7 — No TODO comments in source**
Any deferred work must be logged in `docs/specs/backlinks/00_index.md`, not
inline in source code.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/plugins/backlinks/backlinks.plugin.ts` | (1) Modify `showWikiPopover` to detect broken spans and render "Create note" popover variant; (2) add `createBrokenLinkPopoverElement(stem, creationPath)` helper; (3) add `handleCreateNoteClick(target, spanEl)` async handler; (4) extend `WIKI_POPOVER_CSS` with `.wl-popover-create-btn` and `.wl-popover-error-msg` styles; (5) update `estimatedHeight` constant from 240 to 280 |

### New files to create

None. All changes are contained in the existing backlinks plugin file.

### Files that must NOT change

| File | Reason |
|------|--------|
| `src/lib/bridge.ts` | `writeFile` and `ensureDirectory` already exist; no new commands needed |
| `src/lib/vault-manager.ts` | `reloadVaultIndex` already exists and is exposed on the window global |
| `src-tauri/src/lib.rs` | Window size invariant — must not be touched |
| `src/lib/settings.ts` | Window size invariant — must not be touched |
| `src/editor/extensions.ts` | No changes to extension set required |

---

## Out of Scope

- **Keyboard shortcut to trigger note creation** — the button in the popover is
  the only trigger; no keyboard shortcut is added in this iteration.
- **Subfolder picker UI** — path placement follows the deterministic rules in
  FR-2; there is no folder-picker dialog.
- **Template selection on creation** — the initial content is always `# {stem}`.
  Template support is deferred to the Templates plugin.
- **Sanitising target text for filesystem safety** — characters like `:` in the
  target are passed through; if the OS rejects them the user sees the error (EC-4).
- **Creating notes for broken links that have no vault active** — suppressed
  entirely (EC-1).
- **Anchor-to-heading generation** — `[[note#section]]` creates `note.md` with
  only `# note`; no `## section` heading is auto-generated (EC-15).
- **Disambiguation for same-stem files in different folders** — `stemForLookup`
  uses only the basename; if two files share a stem across different folders the
  index considers the link resolved by either. Creation uses vault-root placement
  for unqualified links, which may create a duplicate stem. Disambiguation UI is
  deferred.
- **Undo of note creation** — once created the file exists on disk; undo within
  CodeMirror does not delete files.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 15 items in Edge Case Inventory (EC-1 through EC-15)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
