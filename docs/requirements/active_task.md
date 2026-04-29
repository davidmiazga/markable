---
title: Vault Meta System — Tag Browser + YAML Validation
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Vault Meta System — Tag Browser + YAML Validation

## Feature Summary

As a user, I want to define a controlled vocabulary of tags for my vault in a
simple Markdown file, browse those tags and which notes use them in a new
Command Bar mode (⌘5), and see a warning indicator in the YAML pane whenever a
field value is not in the corresponding meta vocabulary — so I can keep my
notes consistently tagged and discoverable.

---

## Codebase Context Findings

### Finding 1 — Meta folder and file naming convention (design decision, already locked)

The meta folder lives at `{vaultRootPath}/{VaultName}_meta/` (e.g. for vault
"Work Notes" at `/Users/dave/Notes`, the folder is
`/Users/dave/Notes/Work Notes_meta/`). Each meta file follows
`{VaultName}_{fieldname}.md` (e.g. `Work Notes_tags.md`). The vault name used
for path construction comes from `VaultEntry.name` (a string stored in
settings and exposed via `window.__MARKABLE_VAULT_MANAGER__.getActiveVault()`).
The vault's first `rootPaths[0]` is the base directory for the meta folder.

### Finding 2 — Meta file format (design decision, already locked)

The meta file format is a plain Markdown bullet list with an optional H1
heading:

```markdown
# Tags
- productivity
- work
- personal
```

The heading line is optional and is ignored during parsing. Only lines that
begin with `- ` (dash space) are treated as vocabulary entries. Leading and
trailing whitespace on each entry is trimmed. Empty entries after trimming are
discarded.

### Finding 3 — VaultIndexEntry already carries tags from front matter

`VaultIndexEntry` in `vault-types.ts` has `tags: string[]` (line 84). These
are populated by `parse_front_matter()` in `vault.rs` (lines 261-342), which
handles both inline `tags: [a, b]` and block-sequence forms. The vault index
therefore already has all the data needed for the "which files use each tag"
view. No new per-file scanning is required for the tag browser.

### Finding 4 — Meta files must be excluded from the vault index

`build_vault_index` in `vault.rs` walks all `.md` files under `rootPaths`.
Files inside `{VaultName}_meta/` are not currently excluded. Because meta
files are configuration/vocabulary files (not notes), they must be filtered
out of the index so they do not appear in file search, backlinks, or wiki-link
completion. The exclusion must be applied in `should_exclude()` (or in the
walk loop) by checking whether any path component matches the
`{VaultName}_meta` pattern. This requires the vault name to be passed to the
`build_vault_index` command, which currently does not receive it.

### Finding 5 — Command Bar BarMode union and tab strip pattern

`BarMode = "files" | "commands" | "keybindings" | "content"` is defined at
line 67 of `command-bar.plugin.ts`. All mode-keyed constants (`MODE_PLACEHOLDERS`,
`MODE_FOOTER_HINTS`, `MODE_BADGE_LABELS`, `MODE_TAB_SHORTCUTS`, `MODE_CYCLE`)
are `Record<BarMode, string>` — adding a new mode value requires updating every
one of these objects. `MODE_CYCLE` defines the tab-strip cycling order; the
content mode was appended at the end. The tags mode must follow the same
pattern, appended after content in `MODE_CYCLE`.

Current shortcuts: `commands` = ⌘1, `files` = ⌘2, `keybindings` = ⌘3,
`content` = ⌘4. The tags mode is assigned ⌘5.

### Finding 6 — Content mode established the pattern for a non-file-list mode

The existing content mode renders search results (not a flat list of
`CommandBarResult` items) using a custom DOM path inside the bar. The tags mode
similarly needs a custom render path: it shows tags as grouped sections rather
than the standard `cb-result` row list. The implementation must add a new
rendering branch inside the bar's `renderResults()` (or equivalent dispatcher)
analogous to how content mode bypasses the standard result pipeline.

### Finding 7 — YAML pane validation: current schema mechanism uses a JSON schema file

The YAML pane (`yaml-pane.plugin.ts`) has a configurable `schemaPath`
(absolute path to a `.json` file) that provides `SchemaFieldDef` per field key.
The `SchemaFieldDef` type supports `type: "select" | "multiselect"` with a
`values: string[]` controlled vocabulary. Currently, the pane renders chips for
array/multiselect fields, and the chip input does not validate against any list.
The meta system adds a second validation source: for the `tags` field (and any
other field that has a corresponding meta file), values not in the meta
vocabulary are flagged. This is a separate, lower-priority warning distinct from
the schema's structural type-checking.

### Finding 8 — YAML pane chip widget is the injection point for tag validation warnings

`renderChipWidget` (not shown in the read range, but referenced in `renderFieldControl`)
renders array/tag values as chip pills inside `.yaml-pane-chips-container`. The
warning indicator for a value not in the meta vocabulary is most naturally placed
as a style variant on the chip itself (e.g. a `.yaml-pane-chip--warning` modifier
with an amber border/background), plus an optional tooltip. The pane already has
a `.yaml-pane-chip-error` CSS class (line 1106) for use after chip entry; a
similar `.yaml-pane-chip--warning` class is needed for meta-vocabulary mismatches.

### Finding 9 — The YAML pane is an IIFE plugin; meta data must be surfaced via a window global

Like the command bar, the YAML pane cannot import ES modules. It accesses vault
data via `window.__MARKABLE_VAULT_MANAGER__`. The meta vocabulary must be either
(a) read lazily by the YAML pane itself via `__TAURI_INTERNALS__.invoke` when
it needs to validate, or (b) pre-loaded into a new window global
`window.__MARKABLE_META__` by `main.ts`. Option (b) is preferred because it
keeps the pane decoupled from the meta read logic and allows the tag browser
(also an IIFE) to share the same loaded vocabulary. The meta global must be
refreshed when the vault changes (subscribed via `onVaultChanged`).

### Finding 10 — New Rust command needed: `read_meta_file`

Reading the meta file and parsing its bullet list must go through the Rust
backend (IIFE plugins cannot use the Node/Tauri filesystem API directly without
going through `__TAURI_INTERNALS__.invoke`). A new command
`read_meta_file(vault_root: String, vault_name: String, field_name: String)`
returning `Vec<String>` (the parsed vocabulary entries) is the cleanest
interface. It constructs the meta folder path, reads the file, parses bullet
items, and returns them. `read_file` already exists in `src-tauri/src/commands/files.rs`;
`read_meta_file` is a thin wrapper that adds path construction and bullet parsing.

Alternatively, `main.ts` can call `read_file` directly via the existing bridge
and parse bullets in TypeScript. This avoids a new Rust command and is
sufficient since path construction is simple string concatenation. **The
TypeScript parse-in-main approach is preferred** to minimise new Rust surface
area, unless the Rust approach is needed for performance or security reasons.
Given the file is small and parsing is trivial, TypeScript is adequate.

### Finding 11 — bridge.ts searchVaultContent is the model for new bridge functions

`bridge.ts`'s `searchVaultContent()` (line 481) wraps `invoke()` with a
`FileResult<T>` discriminated union. Any new bridge function that reads meta
files must follow the same pattern: never throws, returns `{ ok: true, value }`
or `{ ok: false, error }`.

### Finding 12 — Vault name character safety for filesystem paths

`VaultEntry.name` is validated to be 1-100 characters but is not restricted to
filesystem-safe characters. A vault named `"Work: Notes"` produces a meta folder
path with a colon, which is invalid on macOS HFS+ and APFS. Path construction
must sanitise the vault name by replacing characters that are invalid in macOS
directory names (colon, slash, null byte) with an underscore or similar safe
substitute before constructing the meta path. The vault name used in meta path
construction is the sanitised version; it does not change the vault's display
name.

### Finding 13 — `build_vault_index` does not currently receive vault name

The `buildAndCacheIndex()` call in `vault-manager.ts` (line 140) passes
`vaultId`, `rootPaths`, `excludePatterns`, and `maxCount` to the Rust command.
It does NOT pass `vaultName`. To filter out meta folder files, the Rust command
either needs the vault name (to construct `{name}_meta`) or a computed meta
folder path. The simplest approach is to pass `vault_name: String` as an
additional parameter to `build_vault_index` and construct the exclusion inside
the Rust walk loop. This is a non-breaking change to the Rust command signature
(adds one parameter) but requires updating `buildAndCacheIndex()` in
`vault-manager.ts`.

---

## Functional Requirements

### FR-1 — Meta folder creation (on demand)

When no `{VaultName}_meta/` folder exists at the vault root and the user
performs an action that requires a meta file (e.g. opens the Tag Browser for the
first time, or clicks a "Create meta file" prompt), the application must create
the folder and an empty `{VaultName}_tags.md` file containing only the `# Tags`
heading. Creation must use the existing `write_file` Tauri command with the
atomic temp-file-swap pattern. No folder is created on vault open or index
build; creation is deferred until first use.

### FR-2 — Meta vocabulary loading

On vault activation (and on vault change), `main.ts` must attempt to read the
tags meta file (`{vaultRoot}/{VaultName}_meta/{VaultName}_tags.md`) via
`bridge.ts`'s `readFile()`. If the file exists, parse it: split on newlines,
keep lines that start with `- ` after trim, strip the `- ` prefix, trim each
entry, discard empty results. Store the result as a `string[]` in
`window.__MARKABLE_META__.tags`. If the file does not exist or cannot be read,
store an empty array. The meta global is replaced (not merged) on each vault
switch.

### FR-3 — Meta vocabulary structure (`window.__MARKABLE_META__`)

`window.__MARKABLE_META__` must be set by `main.ts` to an object of the
following shape:

```typescript
interface MetaStore {
  /** Tag vocabulary from the tags meta file. Empty when no file exists. */
  tags: string[];
  /** Field-name → vocabulary mapping for any non-tags meta files. */
  fields: Record<string, string[]>;
  /** Vault id this meta data belongs to. Used for stale-check. */
  vaultId: string | null;
}
```

The `fields` map is populated by reading any meta file whose name matches
`{VaultName}_{fieldname}.md`. On first release, only `tags` is explicitly
handled; all other field meta files are loaded into `fields` by scanning the
meta folder for files matching the naming pattern.

### FR-4 — Meta files excluded from vault index

`build_vault_index` must not include files inside `{VaultName}_meta/` in the
`entries` array. The exclusion is applied by passing `vault_name: String` to
the Rust command and filtering out any file whose path contains a component
equal to `{vault_name}_meta` (using the sanitised vault name). `vault-manager.ts`
must pass `vault.name` to the updated command invocation.

### FR-5 — Tag Browser: new ⌘5 mode in Command Bar

A new `"tags"` value is added to `BarMode`. All mode-keyed constants gain a
`"tags"` entry:

- `MODE_PLACEHOLDERS["tags"]`: `"Filter tags…"`
- `MODE_FOOTER_HINTS["tags"]`: `"Enter to open files  ·  Esc to close"`
- `MODE_BADGE_LABELS["tags"]`: `"Tags"`
- `MODE_TAB_SHORTCUTS["tags"]`: `"⌘5"`
- `MODE_CYCLE`: append `"tags"` after `"content"` so cycling goes
  `commands → files → keybindings → content → tags → commands`

The ⌘5 global keyboard shortcut must open the Command Bar in tags mode
(analogous to the ⌘1–⌘4 shortcuts). The shortcut is registered in the
keybindings system.

### FR-6 — Tag Browser: layout

The tags mode result area renders as two sections, separated by a section
header each:

1. **Defined tags** (section header: `"DEFINED TAGS"`): all tags present in
   `window.__MARKABLE_META__.tags`, sorted alphabetically. Each row shows the
   tag name and a count badge (`N files`). Clicking a row expands it inline to
   show the list of file titles that use the tag; clicking a file title opens
   the file and closes the bar.

2. **Uncategorised** (section header: `"UNCATEGORISED"`): tags found in
   `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex().entries` (by scanning
   `entry.tags`) that are NOT present in `window.__MARKABLE_META__.tags`. Same
   row format (tag name + `N files` count). Clicking expands to show files.

The filter input at the top of the bar filters both sections simultaneously by
tag name substring (case-insensitive). When the filter is empty, all tags are
shown. The `"UNCATEGORISED"` section is omitted entirely when there are no
uncategorised tags.

### FR-7 — Tag Browser: empty states

- No vault open: show `"No vault open — open a vault to browse tags"`. The
  input is non-functional.
- Vault open, no meta file and no tags in any file: show `"No tags found.
  Add tags: to a note's front matter to get started"`.
- Vault open, meta file exists but is empty and no tags in files: same as above.
- Filter input has text that matches nothing: show `"No tags match 'query'"`.

### FR-8 — Tag Browser: "Add to meta" action on uncategorised tags

Each row in the Uncategorised section has an "Add to meta" button (visible on
hover). Clicking it appends the tag as a new bullet to the tags meta file
(creating the file/folder if needed per FR-1) and immediately moves the row
from the Uncategorised section to the Defined section without closing the bar.
The meta vocabulary in `window.__MARKABLE_META__.tags` is updated in-memory
and the meta file is written via `writeFile`.

### FR-9 — YAML pane: tag validation warning indicators

When the active document's YAML front matter contains a `tags` field whose
value is an array, and `window.__MARKABLE_META__.tags` is non-empty, the YAML
pane chip renderer must compare each chip value against the meta vocabulary. A
chip value that is NOT in the meta vocabulary is rendered with a
`.yaml-pane-chip--warning` CSS modifier (amber-bordered chip). A tooltip on the
chip (via `title` attribute) reads `"'value' is not in the tags vocabulary"`.

This check is performed on every `rebuildPanelDOM()` call. It requires no async
operation: the meta vocabulary is already in-memory via
`window.__MARKABLE_META__.tags`.

### FR-10 — YAML pane: validation for non-tags meta fields

If any field other than `tags` has a corresponding meta vocabulary in
`window.__MARKABLE_META__.fields[fieldKey]`, and that vocabulary is non-empty,
the same warning chip logic (FR-9) applies to that field's array values. This
allows future meta files (e.g. `Work Notes_author.md`) to provide vocabulary
validation automatically without code changes.

### FR-11 — YAML pane: "not in vocabulary" warning only when vocabulary is non-empty

The vocabulary warning is suppressed entirely when
`window.__MARKABLE_META__.tags` is empty (or `fields[key]` is empty/absent).
An empty vocabulary means "no vocabulary defined" — it does not mean "all values
are invalid". This prevents spurious warnings before the user has set up any
meta file.

### FR-12 — Meta file hot reload

When a meta file is modified on disk (the vault file watcher emits a
`VaultFileChangedEvent` for a path inside `{VaultName}_meta/`), `main.ts` must
re-read the affected meta file and update `window.__MARKABLE_META__`. The YAML
pane must re-render on next `updateListener` tick (which happens automatically
since `rebuildPanelDOM` reads the global synchronously). The tag browser must
re-render on the next open.

### FR-13 — Sanitised vault name in path construction

All code constructing `{VaultName}_meta/` paths must sanitise the vault name
with a function that replaces `/`, `:`, and null bytes with `_`. The sanitised
name is used only for path construction; the display name is unchanged.

---

## Edge Case Inventory

**EC-1 — No vault open**
`getActiveVault()` returns null. Tag browser shows "No vault open" message.
YAML pane validation is suppressed (no meta vocabulary available). No crash,
no Tauri calls attempted.

**EC-2 — Meta folder does not exist yet**
`readFile()` on the tags meta file returns `{ ok: false }`. Expected:
`window.__MARKABLE_META__.tags = []`. Validation warnings suppressed (FR-11).
Tag browser shows only the Uncategorised section (derived from vault index
tags). No "Add to meta" causes folder+file creation (FR-1).

**EC-3 — Meta file exists but is empty (no bullet items)**
File contains only `# Tags` or is completely empty. Parsing yields zero
vocabulary entries. Expected: same behaviour as EC-2 — empty vocabulary,
no validation warnings.

**EC-4 — Meta file contains duplicate entries**
`- productivity` appears twice. Deduplication must occur at parse time so the
vocabulary array and UI tag counts are not doubled. Expected: the parsed
vocabulary contains each unique entry once.

**EC-5 — Tag in file not in meta vocabulary**
`entry.tags` for a vault file contains `"research"`, but
`window.__MARKABLE_META__.tags` does not. Expected: "research" appears in the
Uncategorised section of the tag browser; chip for "research" in the YAML pane
gets the `.yaml-pane-chip--warning` modifier.

**EC-6 — Vault rename (meta folder name changes)**
`updateVault()` changes `VaultEntry.name` from "Work Notes" to "Projects". The
old `Work Notes_meta/` folder is not automatically renamed. Expected:
after the rename, `main.ts` attempts to read `Projects_meta/` and finds
nothing; `window.__MARKABLE_META__.tags = []`. The old folder persists on disk
but is unreachable via the new name. The user must rename the folder manually.
The UI shows no crash; validation warnings are suppressed.

**EC-7 — Multiple vaults configured; user switches vaults**
`window.__MARKABLE_META__` is rebuilt on `onVaultChanged`. Each vault has its
own `{name}_meta/` folder. After switching, the in-memory meta reflects only
the new vault. The YAML pane re-renders on its next `updateListener` call.
The tag browser reflects the new vault's tags. No cross-vault contamination.

**EC-8 — Tags with special characters (spaces, hyphens, unicode)**
Tag values like `"project management"`, `"c++"`, or `"日本語"` must round-trip
through the meta file format without corruption. Bullet parsing uses simple
string trimming; it does not escape or interpret any characters. The chip
renderer displays the raw string. The vocabulary comparison is case-sensitive
exact-match.

**EC-9 — Tags with YAML-special characters in front matter**
A tag value like `"yes"` or `"true"` in a YAML `tags:` array is parsed by
js-yaml as the string `"yes"` (CORE_SCHEMA is used, which does not coerce).
The comparison against the meta vocabulary must use the same string. No
coercion mismatch.

**EC-10 — Very large meta file (hundreds of tags)**
The meta file is a plain text file; reading and parsing hundreds of bullet
items is fast. No UI cap is enforced on vocabulary size. The tag browser
renders all defined tags. Filtering is applied client-side.

**EC-11 — Meta folder contains non-field files**
Files not matching `{VaultName}_{fieldname}.md` are ignored when scanning the
meta folder. A file named `README.md` inside the meta folder does not produce
a vocabulary entry.

**EC-12 — Meta file for a field not in current document**
`Work Notes_author.md` exists and defines an `author` vocabulary, but the
current document has no `author:` field. Expected: no warning shown (no chips
to warn about). The vocabulary is loaded into `window.__MARKABLE_META__.fields`
regardless; it is simply not consulted.

**EC-13 — YAML pane open when vault switches mid-session**
`onVaultChanged` fires. `window.__MARKABLE_META__` is rebuilt. On the next
`updateListener` call from CodeMirror, `rebuildPanelDOM()` reads the updated
meta and re-renders with no stale warnings.

**EC-14 — Meta file write fails (disk full, permissions)**
`writeFile()` returns `{ ok: false }`. Expected: the in-memory
`window.__MARKABLE_META__.tags` is NOT updated (the optimistic update is
rolled back or the write is attempted before the in-memory update). An error
toast or console.warn is emitted. The tag browser row reverts to the
Uncategorised section.

**EC-15 — Tag browser opened with no tags in vault index and no meta file**
Both `window.__MARKABLE_META__.tags` and all `entry.tags` in the vault index
are empty. Expected: the "No tags found" empty state is shown (FR-7). No
crash.

**EC-16 — Tag browser filter input clears between opens**
The bar closes on item activation or Escape. On re-open in tags mode, the
filter input is blank and all tags are shown. Consistent with files and content
modes.

**EC-17 — Vault index not yet built when tag browser opens**
`getVaultIndex()` returns null. Expected: the Uncategorised section cannot be
computed; only Defined tags (from the already-loaded meta vocabulary) are
shown, with a `0` file count. A "Index still loading" notice may be appended.

**EC-18 — Vault name contains filesystem-unsafe characters**
`VaultEntry.name = "Work: Notes/2024"`. The sanitise function converts this to
`"Work_ Notes_2024"` for path construction. The meta folder path becomes
`/vault/root/Work_ Notes_2024_meta/`. Display name is unchanged. The
sanitised path is used consistently in all reads and writes.

**EC-19 — ⌘5 pressed when no vault is open**
Tag browser opens in the "No vault open" empty state. No Tauri calls are made.
The input is disabled. Escape or ⌘5 again closes the bar.

**EC-20 — Concurrent meta file write from two sources**
The file watcher (EC-12) and an "Add to meta" action fire within milliseconds
of each other. Because `writeFile()` uses the atomic temp-file-swap pattern on
the Rust side, the last write wins. The in-memory vocabulary is rebuilt from
the final file content on the watcher event.

---

## Non-Functional Requirements

**NFR-1 — Meta vocabulary load is non-blocking on vault open**
Reading the meta file must not block the vault index load. `main.ts` fires both
operations concurrently (Promise.all or fire-and-forget for meta). Vault UI
must not be gated on meta load completion.

**NFR-2 — Tag browser renders within 100 ms for up to 500 distinct tags**
The tag browser assembles its data from two in-memory sources
(`window.__MARKABLE_META__.tags` and `getVaultIndex().entries`). No Rust call
is made on open. All DOM construction must complete within 100 ms on an
M-series Mac for ≤500 tags.

**NFR-3 — CSS uses only existing CSS variables**
All new CSS classes (`.yaml-pane-chip--warning`, tag browser rows, count
badges) must use `var(--accent-color)`, `var(--border-color)`,
`var(--text-primary)`, `var(--text-secondary)`, `var(--bg-primary)`, and
`var(--bg-secondary)`. No hardcoded hex colours or pixel sizes that conflict
with themes.

**NFR-4 — No new Cargo dependencies**
Meta file reading uses the existing `read_file` Tauri command and TypeScript
parsing. If a Rust command is added, it must use only crates already in
`Cargo.toml`. No new crates.

**NFR-5 — All BarMode record constants remain exhaustive**
`MODE_PLACEHOLDERS`, `MODE_FOOTER_HINTS`, `MODE_BADGE_LABELS`, and
`MODE_TAB_SHORTCUTS` are typed as `Record<BarMode, string>`. Adding `"tags"`
to `BarMode` will produce TypeScript compile errors on any record not updated.
All four constants must be extended.

**NFR-6 — Meta folder excluded from vault index (no bleed into search)**
Files inside `{VaultName}_meta/` must never appear in file search results,
backlinks, or wiki-link completions. This is enforced at index-build time via
the exclusion filter in `build_vault_index`.

**NFR-7 — Validation warnings are synchronous (no async in the render path)**
`rebuildPanelDOM()` is called on every CodeMirror state change. Adding an
async operation inside it would cause flickering and race conditions. The
vocabulary comparison must be a synchronous read of `window.__MARKABLE_META__`
with no I/O.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | (1) Add `"tags"` to `BarMode`; (2) extend all mode-keyed constants with `"tags"`; (3) add ⌘5 shortcut handler; (4) add tags mode render path |
| `src/plugins/yaml-pane/yaml-pane.plugin.ts` | (1) Read `window.__MARKABLE_META__` in chip renderer; (2) add `.yaml-pane-chip--warning` CSS class and modifier logic; (3) extend per-field validation to non-tags fields via `fields` map |
| `src/lib/vault-manager.ts` | Pass `vault.name` to `build_vault_index` invocation in `buildAndCacheIndex()` |
| `src-tauri/src/commands/vault.rs` | Accept `vault_name: String` in `build_vault_index`; exclude `{vault_name}_meta` directory components during the walk |
| `src/main.ts` | (1) Set and update `window.__MARKABLE_META__` on vault change; (2) subscribe to `onVaultChanged` to reload meta; (3) subscribe to `onIndexUpdated` for meta folder file changes |
| `src/lib/bridge.ts` | No new commands required if TypeScript parses the meta file. If a `read_meta_file` command is added to Rust, add a typed wrapper here. |

### New files to create

| File | Purpose |
|------|---------|
| `src/lib/meta-manager.ts` | Pure functions: `sanitiseVaultName()`, `metaFolderPath()`, `metaFilePath()`, `parseMetaBulletList()`, `buildMetaStore()`. Shared between `main.ts` and tests. Exported as ES module (not IIFE). |

### Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/files.rs` | `read_file` and `write_file` are used as-is; no changes needed |
| `src/lib/vault-types.ts` | No new vault types required; `VaultIndexEntry.tags` is already present |
| `src/lib/settings.ts` | No new settings fields; meta path is derived at runtime from vault name |
| `src-tauri/src/lib.rs` (window size section) | Window size invariant must not regress; only change is adding `vault_name` parameter threading if `build_vault_index` is updated |

---

## Out of Scope

- **Editing the meta vocabulary from within the tag browser** — the meta file
  is a plain Markdown file the user edits directly. The "Add to meta" action
  (FR-8) is the only write path from the UI.
- **Renaming or merging tags across vault files** — deferred.
- **Non-tags field validation with non-array YAML types** — validation warnings
  apply only to array-valued fields (chips). String fields with a meta
  vocabulary are deferred.
- **Tag autocomplete in the editor** — deferred to a future feature.
- **Multiple root paths for meta folder selection** — the meta folder always
  lives at `rootPaths[0]`; multi-root vaults use only the first root.
- **Case-insensitive vocabulary comparison** — the comparison is exact
  case-sensitive match. If the user defines `Productivity` in the meta file
  and uses `productivity` in a note, both appear (one defined, one
  uncategorised).
- **Cloud sync or sharing of the meta folder** — out of scope; the folder is
  local.
- **Schema JSON validation for meta fields** — the meta bullet list format and
  the existing `schemaPath` JSON mechanism are two independent systems. They
  are not merged in this release.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 20 items in Edge Case Inventory (EC-1 through EC-20)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
