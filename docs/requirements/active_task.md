---
title: "Folder Table — Unified fields: Column List"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Active Task — Folder Table: Unified `fields:` Column List

## Summary

As a Markable user, I want to declare a single `fields:` list in `_folder.md`
that controls which columns appear in the `folder-table` layout, in what order,
and that accepts any YAML frontmatter key as a custom column — replacing the
separate `show-modified`, `show-tags`, `show-extensions`, `show-count`, and
`extra-fields:` flags with one unified sequence that I can reorder and annotate
directly.

---

## Background and Motivation

The current `folder-table` layout exposes column visibility through four separate
boolean flags (`show-modified`, `show-tags`, `show-extensions`, `show-count`) and
a separate `extra-fields:` sequence for custom frontmatter columns. Adding or
reordering columns requires editing multiple lines in multiple places, and there
is no mechanism to change column order at all — it is hardcoded in the renderer.

This feature replaces that fragmented system with a single `fields:` sequence.
Each item names a column to render, in the order listed. Built-in column names
map to the existing column implementations. Any unrecognised name is treated as a
custom frontmatter key (equivalent to the current `extra-fields:` mechanism).

The `folder-cards` layout is entirely unaffected. All existing `_folder.md`
files that do not include `fields:` continue to work identically — full backwards
compatibility is mandatory.

---

## Desired YAML Syntax

```yaml
layout:
  type: folder-table
  fields:
    - name
    - type        # file extension column
    - modified
    - tags
    - customtag   # any frontmatter key = extra column
```

Users control columns by editing this list:
- Delete a line to remove that column.
- Reorder lines to reorder columns.
- Add any frontmatter key name to get a custom data column.

---

## Functional Requirements

### FR-01 — New `fields:` YAML key

`_folder.md` may declare a `fields:` sequence under the `layout:` block or at
the top level (same placement flexibility as `extra-fields:`). Each item is a
plain string. Example:

```yaml
fields:
  - name
  - modified
  - tags
  - status       # custom frontmatter key
```

When `fields:` is present it supersedes all column-visibility flags (`show-modified`,
`show-tags`, `show-extensions`, `show-count`) and the `extra-fields:` sequence.
Those keys are parsed but ignored when `fields:` is present.

### FR-02 — Built-in field identifiers: Files section

The following identifiers have built-in meaning for the Files section of the table:

| Identifier | Meaning | Equivalent legacy flag |
|---|---|---|
| `name` | Filename column | always shown in legacy mode |
| `type` or `ext` | File extension column | `show-extensions: true` |
| `modified` | Last-modified date column | `show-modified: true` |
| `tags` | Tag chips column | `show-tags: true` |

Any string not in this set (and not `count`) is a custom frontmatter key and
produces an extra column (same semantics as `extra-fields:`).

### FR-03 — Built-in field identifiers: Folders section

The following identifiers have built-in meaning for the Folders section of the
table:

| Identifier | Meaning | Equivalent legacy flag |
|---|---|---|
| `name` | Folder name column | always shown in legacy mode |
| `count` | Item count column | `show-count: true` |

All other field identifiers in `fields:` produce an em-dash cell in folder rows
to keep the column structure aligned between the two sections.

`count` in the Files section produces an em-dash cell (it is folders-only).

### FR-04 — BUILTIN_FIELDS constant

A module-level constant `BUILTIN_FIELDS` is defined in `parser.ts`:

```typescript
const BUILTIN_FIELDS = new Set(["name", "type", "ext", "modified", "tags", "count"]);
```

This set is used by the parser to derive `extraFields` from `fields:` and by the
renderer to classify columns.

### FR-05 — Parser: `fields:` extraction

`parseFolderMd()` in `parser.ts` must gain a new `extractFieldsRaw()` helper
(parallel to the existing `extractExtraFieldsRaw()`) that:

1. Scans raw YAML lines for a `fields:` key at any indentation level (same
   approach as `extractExtraFieldsRaw`).
2. Collects subsequent more-indented `- item` lines as plain strings.
3. Strips inline comments (` #...`) and surrounding quotes from each item.
4. Returns a `string[]` (never null; empty array when key is absent or sequence
   is empty).

Unlike `extra-fields:`, `fields:` items are always plain strings — no inline
`key: label` or structured `key:/label:` sub-key syntax is supported. Built-in
column labels are hardcoded in the renderer; custom field labels default to the
capitalised key.

### FR-06 — Parser: `config.fields` and derived `config.extraFields`

`parseFolderMd()` sets `config.fields` as follows:

- When `fields:` is present and non-empty: `config.fields = rawFields` (the
  extracted `string[]`).
- When `fields:` is absent or the sequence is empty: `config.fields = null`.

When `config.fields !== null`, the parser also derives `config.extraFields` from
it for backwards compatibility with the enrichment phase in `tab.ts`:

```typescript
config.extraFields = config.fields
  .filter(f => !BUILTIN_FIELDS.has(f))
  .map(f => ({ key: f, label: f.charAt(0).toUpperCase() + f.slice(1) }));
```

This means the enrichment guard in `tab.ts` (`config.extraFields.length > 0`)
continues to work without modification.

When `config.fields === null`, `config.extraFields` is derived from the legacy
`extra-fields:` sequence exactly as it is today.

### FR-07 — `FolderViewConfig` changes

`FolderViewConfig` gains one new field:

```typescript
/**
 * Ordered list of column identifiers from the fields: YAML sequence.
 * null when fields: is absent — triggers legacy flag-based column logic.
 */
fields: string[] | null;
```

Default value: `null`.

All other existing fields on `FolderViewConfig` remain unchanged. The `showModified`,
`showExtensions`, `showTags`, `showCount`, and `extraFields` fields are all still
populated from their existing YAML sources; they are just ignored by the renderer
when `fields !== null`.

### FR-08 — `FolderMdFrontMatter` changes

`FolderMdFrontMatter` gains one new field:

```typescript
/** Raw YAML value for the fields: sequence. */
"fields"?: unknown;
```

### FR-09 — Renderer: `resolveFields()` helper

A new module-level helper is added to `table-renderer.ts`:

```typescript
function resolveFields(config: FolderViewConfig, isFiles: boolean): string[]
```

Behaviour:

- When `config.fields !== null` and `isFiles === true`: return `config.fields`
  with `"count"` filtered out (count is folders-only).
- When `config.fields !== null` and `isFiles === false`: return `config.fields`
  with only `"name"` and `"count"` retained as recognised; all others are passed
  through as a signal to render an em-dash cell (see FR-11).
- When `config.fields === null`: derive the column list from legacy flags (see
  FR-12).

### FR-10 — Renderer: fields-mode column construction (Files section)

When `config.fields !== null`, `buildSectionTable()` for the Files section must
iterate `resolveFields(config, true)` to construct both `<th>` header elements
and `<td>` data cells in each file row, in that order.

Column construction rules per field identifier (Files section):

| Field identifier | `<th>` label | `<td>` content | Sortable? |
|---|---|---|---|
| `name` | "Name" | Filename (respecting extensions display) | Yes (name-asc/desc) |
| `type` or `ext` | "Type" | `card.ext` | Yes (ext sort) |
| `modified` | "Modified" | `formatModified(card.modified)` or "—" | Yes (modified-asc/desc) |
| `tags` | "Tags" | Tag chip elements | No |
| Any other string | Capitalised key | `card.meta?.[key]` or "—" | Yes (extra-field sort) |

The icon column (`<td class="fv-td-icon">`) is always rendered first, before any
field columns, regardless of the `fields:` list. It does not appear in `fields:`
and cannot be removed or reordered by the user.

### FR-11 — Renderer: fields-mode column construction (Folders section)

When `config.fields !== null`, `buildSectionTable()` for the Folders section
iterates `resolveFields(config, false)`. For each identifier in the resolved
list:

- `name`: render the folder name `<td>` (standard behaviour).
- `count`: render the item count `<td>`.
- Any other identifier: render an em-dash `<td>` with class `fv-td-placeholder`
  to keep rows aligned with the files table.

The icon column is always rendered first as per FR-10.

### FR-12 — Renderer: legacy (backwards-compat) column construction

When `config.fields === null`, `buildSectionTable()` behaves exactly as it does
today — columns are constructed from the individual boolean flags
(`config.showExtensions`, `config.showModified`, `config.showTags`,
`config.showCount`, and `config.extraFields`). No change to this code path.

This is the "no `fields:` key" case. All existing `_folder.md` files that lack
`fields:` continue to work identically.

### FR-13 — Sort: fields-mode pre-selection

In fields mode, initial sort pre-selection works as follows:

- The sort column is determined from `config.sort` as today.
- If `config.sort` matches a built-in builtin (`name`, `modified`, `ext`) the
  appropriate `<th>` receives the `fv-sorted-*` class on initial render.
- If `config.sort` matches a custom field key present in `fields:`, that custom
  column header receives the `fv-sorted-asc` class on initial render.
- If `config.sort` does not match any column in `fields:`, no column is
  pre-selected (no `fv-sorted-*` class applied); the sort falls back to name-asc
  on first click.

Sort interaction (click to sort, click again to toggle direction) continues to
work for all sortable columns regardless of mode.

### FR-14 — Sort: `name` absent from `fields:` is valid

When `name` is absent from `fields:`, the name column is simply not rendered.
The sort fallback column for the name header click handler does not exist; no
error occurs. If `config.sort` would normally select the name column but the
name column is absent, no column is pre-selected.

### FR-15 — `name` absent from `fields:` — name still accessible in sort

Even when `name` is not in `fields:`, `card.name` still exists on the data model
and the renderer can still sort by name internally as a tie-breaker. The absence
of a `name` field only removes the visual column — it does not affect data model
availability.

### FR-16 — `fields: []` (empty list)

An explicitly empty `fields:` sequence (key present, no items) is treated as
`config.fields = null` (falls through to legacy mode). This preserves the
invariant that a present-but-empty `fields:` does not suppress all columns.

### FR-17 — Enrichment phase: unchanged guard logic

The enrichment phase guard in `renderFolderViewTabAsync()` (`tab.ts`):

```typescript
if (layoutKey === "folder-table" && config.extraFields.length > 0)
```

is NOT modified. Because the parser derives `config.extraFields` from
`config.fields` when `fields:` is present (FR-06), this guard fires correctly
in both modes.

### FR-18 — XSS prevention

Custom field values read from child `.md` frontmatter are inserted via
`.textContent` (never `.innerHTML`). Em-dash fallback values are also set via
`.textContent`. Column header labels derived from capitalised key names are set
via `.textContent`.

### FR-19 — `FOLDER_VIEW_STARTER` update

The `FOLDER_VIEW_STARTER` constant in `file-browser.plugin.ts` gains a commented-
out `fields:` block in the position of the former `# extra-fields:` comment
block:

```text
"# fields:",
"#   - name",
"#   - type       # file extension column",
"#   - modified",
"#   - tags",
"# uncomment to control which columns appear and in what order",
"# add any frontmatter key as a custom column (folder-table only)",
```

The three lines of `# extra-fields:` comments are removed from the starter (they
are superseded by the `# fields:` block). All other starter lines are unchanged.

### FR-20 — `folder-cards` layout: unaffected

The `folder-cards` renderer (`renderer.ts`) is not modified. `config.fields`
is parsed and stored regardless of layout but is never read by the cards renderer.

---

## Non-Functional Requirements

- **NFR-01** — No new npm dependencies. No new Rollup bundle targets.
- **NFR-02** — No Rust changes. All frontmatter reads use the existing `read_file`
  Tauri command.
- **NFR-03** — `parseFolderMd()` must never throw. The new `fields:` extraction
  path is wrapped in the existing top-level try/catch.
- **NFR-04** — When `config.fields === null` the renderer code path is identical
  to the current implementation. No regression to existing tests.
- **NFR-05** — Column order in fields mode is determined solely by the `fields:`
  list. The renderer must not impose any hardcoded ordering on top of the list.
- **NFR-06** — The icon column is always rendered first and is not part of
  `fields:`. This is implementation-internal and must not be surfaced as a
  user-facing field identifier.

---

## Acceptance Criteria

- **AC-01** — A `_folder.md` with `fields: [name, modified, tags]` renders a
  files-section table with exactly those three data columns in that order (plus
  the always-present icon column).
- **AC-02** — A `_folder.md` with `fields: [modified, name]` renders the Modified
  column before the Name column.
- **AC-03** — A `_folder.md` with `fields: [name, status]` where `status` is a
  custom frontmatter key renders a "Status" column populated from child `.md`
  frontmatter.
- **AC-04** — A `_folder.md` with no `fields:` key renders identically to the
  current implementation (legacy flags control visibility; all existing tests
  pass).
- **AC-05** — A `_folder.md` with `fields: [name, count]` renders the Folders
  section with Name and Count columns; Files section renders Name column only
  (count produces an em-dash in files rows — wait, `count` is excluded from files
  by `resolveFields`; Name column only).
- **AC-06** — A `_folder.md` with `fields: [name, modified]` renders the Folders
  section with Name column and an em-dash column (Modified is not a folder
  built-in); folder rows show "—" in the second column.
- **AC-07** — A `_folder.md` with `fields: [modified, tags]` (name omitted)
  renders no Name column. Rows exist but the Name `<th>` and name `<td>` are
  absent.
- **AC-08** — `fields: []` (empty sequence) falls through to legacy mode;
  `config.fields` is `null`.
- **AC-09** — `show-modified: false` in the YAML is ignored when `fields:`
  includes `modified`; the Modified column is rendered.
- **AC-10** — `extra-fields: [status]` is ignored when `fields:` is present;
  only columns in `fields:` appear.
- **AC-11** — `fields:` items with inline comments (`- modified  # last changed`)
  parse the item as `modified` (comment stripped).
- **AC-12** — The `folder-cards` layout renders identically regardless of whether
  `fields:` is present or absent.

---

## Files to Change

| File | Action | Notes |
|---|---|---|
| `src/plugins/file-browser/folder-view/types.ts` | Extend | Add `fields: string[] \| null` to `FolderViewConfig`; add `"fields"?: unknown` to `FolderMdFrontMatter` |
| `src/plugins/file-browser/folder-view/parser.ts` | Extend | Add `BUILTIN_FIELDS` constant; add `extractFieldsRaw()` helper; populate `config.fields` and derive `config.extraFields` from it when non-null; add `fields: null` to `safeDefaults` |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Extend | Add `resolveFields()` helper; replace column construction in `buildSectionTable()` with fields-mode path when `config.fields !== null`; legacy path unchanged |
| `src/plugins/file-browser/file-browser.plugin.ts` | Update | Replace `# extra-fields:` comment block in `FOLDER_VIEW_STARTER` with `# fields:` comment block (FR-19) |
| `tests/folder-view/parser.test.ts` | Add tests | New describe block for `fields:` extraction and `config.fields` / derived `extraFields` |
| `tests/folder-view/table-renderer.test.ts` | Add tests | New describe block for fields-mode rendering: column order, omitted columns, custom fields, folder em-dash cells, empty list fallback, backwards-compat mode unchanged |

**Files that must NOT be changed:**
- `src/plugins/file-browser/folder-view/tab.ts` (no changes required)
- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/detection.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`
- `src/plugins/file-browser/folder-view/frontmatter-reader.ts`
- Any Rust source files

---

## Test Requirements

### TR-01 — `tests/folder-view/parser.test.ts` additions

New `describe("fields: extraction")` block covering:

- **T-01** — `fields: [name, modified, tags]` → `config.fields = ["name", "modified", "tags"]`;
  `config.extraFields = []` (no non-builtin items).
- **T-02** — `fields: [name, status, priority]` → `config.fields = ["name", "status", "priority"]`;
  `config.extraFields = [{key:"status",label:"Status"}, {key:"priority",label:"Priority"}]`.
- **T-03** — `fields:` absent → `config.fields = null`; `config.extraFields` is
  derived from `extra-fields:` as before (existing tests cover this path).
- **T-04** — `fields:` present at top level (not nested under `layout:`) →
  correctly extracted.
- **T-05** — `fields:` nested under `layout:` block → correctly extracted (same
  as the `extra-fields:` top-level / nested duality).
- **T-06** — Item with inline comment: `- modified  # last changed` → item parsed
  as `"modified"`.
- **T-07** — `fields: []` (empty sequence) → `config.fields = null`.
- **T-08** — `fields:` and `extra-fields:` both present → `config.fields` is
  populated from `fields:`; `config.extraFields` is derived from `fields:`
  (non-builtin items); `extra-fields:` is ignored.
- **T-09** — `show-modified: false` with `fields: [modified]` → `config.fields`
  contains `"modified"` and `config.showModified` is `false` (both parsed
  independently; renderer decides which takes precedence).

### TR-02 — `tests/folder-view/table-renderer.test.ts` additions

New `describe("fields-mode rendering")` block covering:

- **T-10** — `fields: ["name", "modified"]` → files thead has exactly Icon, Name,
  Modified headers in that order.
- **T-11** — `fields: ["modified", "name"]` → files thead has exactly Icon,
  Modified, Name headers in that order (Modified before Name).
- **T-12** — `fields: ["name", "status"]` with `extraFields: [{key:"status",label:"Status"}]`
  and a card with `meta: {status:"draft"}` → Status `<th>` present and `<td>`
  shows `"draft"`.
- **T-13** — `fields: ["name", "status"]` with a card with `meta: {}` → Status
  `<td>` shows `"—"`.
- **T-14** — `fields: ["name", "modified"]` → no Tags or Type column rendered.
- **T-15** — `fields: ["modified", "tags"]` (name omitted) → no Name `<th>` in
  the files thead.
- **T-16** — `fields: ["name", "count"]` → Files section: `count` field excluded
  by `resolveFields`; files thead has Icon, Name only. Folders section: has Icon,
  Name, Count.
- **T-17** — `fields: ["name", "modified"]` in Folders section → Modified column
  produces em-dash `<td>` cells in folder rows (Modified is not a folder built-in).
- **T-18** — `config.fields = null` (legacy mode) → `makeConfig()` fixture with
  `showModified: true, showExtensions: true` produces the same thead and cells as
  the current implementation; all existing table-renderer tests pass unmodified.
- **T-19** — `fields: ["name", "status"]`, `sort: "status"` → Status `<th>` has
  `fv-sorted-asc` class on initial render; Name `<th>` has no sort class.
- **T-20** — `fields: ["name"]` (only name) → files section renders a single data
  column (Name) plus icon; no other headers present.

---

## Edge Case Inventory

This list is the Reviewer's mandatory test checklist. Every EC must have a
corresponding test or be explicitly justified as untestable in isolation.

- **EC-01** — `fields:` key present but sequence is empty (`fields:` with no
  items). Result: `config.fields = null` (falls through to legacy mode). No
  columns suppressed; renders as if `fields:` were absent.

- **EC-02** — `name` is absent from `fields:`. The Name column is not rendered
  in either section. No crash. Sort tie-breaking by `card.name` still works
  internally (the data exists; only the visual column is absent).

- **EC-03** — `count` appears in the Files `fields:` list. `resolveFields` filters
  `count` from the files column list; it is not rendered as a file column.
  No crash, no em-dash cell (count is simply excluded, not rendered as a
  placeholder).

- **EC-04** — `type` and `ext` are aliases. Both identifiers produce the same Type
  column. If both appear in `fields:`, two Type columns are rendered (it is a
  user authoring error; deduplication is not required in v1).

- **EC-05** — An unknown string that happens to match a CSS class name or a DOM
  property name (e.g. `fields: [constructor]`) is treated as a custom
  frontmatter key. The key is used only as a lookup in `card.meta` and as a
  column label (capitalised); no eval or property access on native objects occurs.

- **EC-06** — `fields:` contains a custom key but no child `.md` files have that
  key in their frontmatter. All custom-field cells display `"—"`. The enrichment
  phase runs (because `config.extraFields.length > 0`) but returns empty strings
  for every card. No crash.

- **EC-07** — `fields:` and `extra-fields:` both present. `fields:` wins
  entirely: `config.extraFields` is derived from `fields:` (non-builtin items
  only); `extra-fields:` is ignored. This means any custom keys that were only in
  `extra-fields:` and not in `fields:` produce no columns.

- **EC-08** — `show-modified: false` is present alongside `fields: [name, modified]`.
  `config.showModified` is `false` and `config.fields` contains `"modified"`.
  The renderer uses `config.fields` (fields mode); the Modified column IS rendered.
  The legacy `showModified` flag is ignored when `fields !== null`.

- **EC-09** — `fields: [name, modified]` is present alongside `show-count: true`.
  The Count column is NOT rendered (not in `fields:`) even though `config.showCount`
  is `true`. Fields mode supersedes legacy flags.

- **EC-10** — `fields:` contains only custom keys with no `name` (e.g.
  `fields: [status, priority]`). The Folders section iterates
  `resolveFields(config, false)` and finds neither `name` nor `count`. All folder
  rows render only the icon cell plus em-dash cells for `status` and `priority`.
  No crash; folder rows are visually sparse but structurally valid.

- **EC-11** — `fields:` item value is an empty string after comment-stripping
  (e.g. `- # just a comment`). The empty string is silently skipped; it produces
  no column.

- **EC-12** — `fields:` contains duplicate identifiers (e.g. `[name, name]`).
  Two Name columns are rendered. This is a user authoring error; deduplication is
  not required in v1.

- **EC-13** — Sort interaction in fields mode: clicking a column header that is
  present in `fields:` works normally. Clicking a column that is absent from
  `fields:` cannot happen (the `<th>` element does not exist). No stale click
  handler references exist.

- **EC-14** — `clearIndicators()` in fields mode must clear the sort indicator
  from all dynamically constructed column headers, including custom-field headers
  and any built-in column headers present in `fields:`. The existing `extraThs`
  array pattern is sufficient when fields-mode headers are added to it.

- **EC-15** — `folder-cards` layout with `fields:` present in `_folder.md`.
  `config.fields` is populated but the `folder-cards` renderer never reads it.
  Render output is identical to `folder-cards` without `fields:`.

- **EC-16** — `fields:` extracted from a nested `layout:` block: the
  `extractFieldsRaw()` helper uses indentation comparison (same as
  `extractExtraFieldsRaw()`), so it correctly finds `fields:` inside a `layout:`
  block where it is more-indented than the top level.

- **EC-17** — `fields:` item with surrounding quotes: `- "modified"`. Quote-
  stripping in `extractFieldsRaw()` produces the identifier `modified` (no
  quotes in the resulting string).

- **EC-18** — The `makeConfig()` test fixture in `table-renderer.test.ts` does not
  yet include `fields: null`. After this change, `makeConfig()` must include
  `fields: null` in its default spread to ensure all existing table-renderer tests
  remain in legacy mode and pass without modification.

---

## Resolved Design Decisions

- **RDD-01** — `fields:` items are always plain strings. No `key: label` inline
  syntax is supported (unlike `extra-fields:`). Built-in column labels are
  hardcoded; custom field labels default to capitalised key. This simplifies the
  parser and keeps the YAML clean.

- **RDD-02** — The parser derives `config.extraFields` from `config.fields` when
  `fields:` is present. This avoids modifying the enrichment phase guard in
  `tab.ts`, keeping the change surface small.

- **RDD-03** — `fields: []` (empty sequence) falls through to legacy mode
  (`config.fields = null`) rather than producing a table with zero columns. A
  user who writes an empty `fields:` key is more likely to have made an authoring
  error than to intentionally want no columns.

- **RDD-04** — `count` is excluded from the Files section by `resolveFields`, not
  by treating it as a custom key with an em-dash cell. This avoids adding a
  phantom column to the files section.

- **RDD-05** — The icon column is renderer-internal and not part of `fields:`.
  Exposing it as a field identifier would allow users to remove it or reorder it,
  which would break the visual design (icon is always the first cell for both
  directories and files).

- **RDD-06** — `tab.ts` requires no changes. The enrichment guard
  `config.extraFields.length > 0` fires correctly because the parser populates
  `config.extraFields` from `config.fields` when applicable.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 18 items in Edge Case Inventory (EC-01 through EC-18)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
