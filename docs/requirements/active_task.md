---
title: "Folder Table — Extra Fields Columns"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Active Task — Folder Table: Extra Fields Columns

## Summary

As a Markable user, I want to declare a list of YAML frontmatter keys in
`_folder.md` under `extra-fields` so that the `folder-table` layout reads those
keys from each child `.md` file and displays them as additional sortable columns
in the table — allowing me to track and sort custom fields such as `status` or
`priority` directly inside the folder view.

---

## Background and Motivation

The `folder-table` layout currently displays four fixed columns: Name, Type,
Modified, Tags. Users who use YAML frontmatter to annotate their notes with
custom fields (e.g. `status: in-progress`, `priority: high`) have no way to
surface those fields in the table without opening each file individually.

This feature adds a zero-Rust, frontend-only mechanism: `_folder.md` declares
which frontmatter keys to read; the plugin reads the files in parallel at render
time; the table gains one column per declared field, each sortable.

The `folder-cards` layout is unaffected. This feature is `folder-table` only.

---

## Functional Requirements

### FR-01 — YAML declaration: simple list form

`_folder.md` may declare extra fields as a flat YAML sequence of string keys:

```yaml
extra-fields:
  - status
  - priority
```

Each key's display label defaults to the key name with its first letter
capitalised (e.g. `status` → `"Status"`, `priority` → `"Priority"`).

### FR-02 — YAML declaration: structured form (explicit label)

`_folder.md` may alternatively declare extra fields as a sequence of objects,
each with `key` and `label` sub-keys:

```yaml
extra-fields:
  - key: status
    label: Status
  - key: priority
    label: Priority
```

Both the simple and structured forms must be supported in the same `_folder.md`
file; mixing them in the same list is not required and is treated as
unrecognised (see FR-08).

### FR-03 — ExtraField type

A new exported type `ExtraField` is added to `types.ts`:

```typescript
export interface ExtraField {
  /** The YAML frontmatter key to read from child files. */
  key: string;
  /** Column header label shown in the table. */
  label: string;
}
```

### FR-04 — FolderViewConfig extension

`FolderViewConfig` gains one new field:

```typescript
extraFields: ExtraField[];   // default: []
```

`FolderMdFrontMatter` gains one new field:

```typescript
"extra-fields"?: unknown;    // raw YAML value (sequence of strings or objects)
```

### FR-05 — FolderCard extension

`FolderCard` gains one new optional field:

```typescript
/** Frontmatter values keyed by ExtraField.key. Present for .md file cards only.
 *  Missing or unreadable fields map to empty string. */
meta?: Record<string, string>;
```

Non-`.md` file cards and directory cards always have `meta` as an empty object
`{}` (never undefined after enrichment). This simplifies the renderer: it can
safely access `card.meta?.[key] ?? ""` without null-guarding per card type.

### FR-06 — Parser: extra-fields extraction

`parseFolderMd()` in `parser.ts` must:

1. Extract the raw `extra-fields` value from `rawFm` before `normalizeFm()` is
   called (the same pattern used for `exclude`).
2. Parse each item in the sequence:
   - A plain string item `"status"` produces `{ key: "status", label: "Status" }`
     (label = key with first character uppercased, rest unchanged).
   - An object item with sub-keys `key` and `label` (both non-empty strings)
     produces `{ key: item.key.trim(), label: item.label.trim() }`.
   - Items that are objects missing `key`, or whose `key` is empty after
     trimming, are silently skipped.
   - Items that are objects with a valid `key` but missing or empty `label` use
     the same capitalised-key default for `label`.
3. The resulting `ExtraField[]` is stored in `config.extraFields`.
4. An absent or empty `extra-fields` field produces `extraFields: []`.
5. `parseFolderMd()` must still never throw (NFR-06).

### FR-07 — Parser: YAML sequence handling for structured items

The existing `parseYamlLines()` function collects indented sequence items
(`- item`) as plain strings. To support structured items (`- key: value`
indented under a `- ` prefix), the parser must handle the following YAML shape:

```yaml
extra-fields:
  - key: status
    label: Status
```

The current `parseYamlLines()` records each `- item` as a raw string. For
structured items the raw string will be `"key: status"` (just the first
sub-key line). This is insufficient.

Two acceptable implementation strategies — the Architect chooses one:

**Strategy A (extend parseYamlLines)**: Extend `parseYamlLines()` so that when
the block is a sequence and a sequence item is itself a mapping (i.e. the item
line `"- key: status"` is detected as containing a colon after the `"- "`
prefix), subsequent indented lines (`"  label: Status"`) are collected into an
object. The sequence element is stored as a `Record<string,string>` rather than
a plain string.

**Strategy B (post-parse object detection)**: Leave `parseYamlLines()` unchanged.
In `parseFolderMd()`, after extracting `rawFm["extra-fields"]` as `string[]`,
detect items that look like `"key: value"` (contain a colon) and treat them as
the start of an inline mapping. A second pass re-reads the raw YAML block
specifically for the `extra-fields` block to extract structured items.

Either strategy must pass the acceptance tests in TR-03.

### FR-08 — Sort: extra-field sort values pass through parser

The `VALID_SORTS` set in `parser.ts` currently contains exactly:
`{ "name-asc", "name-desc", "modified-asc", "modified-desc" }`.

The `sort:` field in `FolderViewConfig` is typed as `FolderSortOrder`. For
extra-field sort pre-selection, the sort value is a plain field key (e.g.
`sort: status`). The type system must be updated so that:

- `FolderSortOrder` is widened to `string` (or a tagged union) to accommodate
  extra-field sort keys, OR
- A separate `extraSort` field is added to `FolderViewConfig`.

Preferred approach: widen `FolderSortOrder` to:

```typescript
export type BuiltinSortOrder =
  | "name-asc" | "name-desc"
  | "modified-asc" | "modified-desc";

export type FolderSortOrder = BuiltinSortOrder | string;
```

And update `FolderViewConfig.sort` to `FolderSortOrder` (already `string`
-compatible). The `VALID_SORTS` check in `parseFolderMd()` is changed to: if
the raw sort value matches a builtin, use it as-is; otherwise, store it verbatim
(it may be an extra-field key). The parser does **not** validate that the raw
sort value matches a declared `extra-fields` key — that is the renderer's
responsibility.

`safeDefaults.sort` remains `"name-asc"` (the canonical fallback).

The parser must pass an unrecognised sort value (e.g. `"status"`) through
unchanged in `config.sort`, rather than defaulting it to `"name-asc"`.

### FR-09 — Frontmatter reading: enrichment phase in tab.ts

After `collectChildren()` builds the card array and before dispatching to
`renderFolderTable()`, the async render function `renderFolderViewTabAsync()`
must run an enrichment phase when `config.extraFields` is non-empty and the
layout is `"folder-table"`:

1. Filter the card array to `.md` file cards only.
2. For each `.md` file card, invoke the Tauri `read_file` command to read the
   file's content. Use `Promise.all(mdCards.map(...))` so all reads are
   concurrent.
3. For each card, parse the YAML frontmatter from the file content (a
   lightweight inline parse — not a full `parseFolderMd()` call) to extract
   only the declared extra-field keys.
4. Attach the extracted key-value pairs to `card.meta`.
5. Non-`.md` cards (kind `"file"` with a non-`.md` extension) and directory
   cards get `card.meta = {}`.
6. If a file read fails (Tauri throws), that card's `meta` is set to `{}` and
   the render continues. The error is not surfaced to the user.
7. The enrichment phase runs only when `config.extraFields.length > 0`. When
   `extraFields` is empty, no Tauri calls are made and `card.meta` is left
   undefined.

The enrichment must complete before `renderFolderTable()` is called. The
`Promise.all` result is awaited before dispatch.

### FR-10 — Frontmatter reading: inline YAML parse

The inline YAML parse needed for step 3 of FR-09 must:

- Extract only the YAML frontmatter block (between the first `---` and the
  closing `---`).
- For each declared extra-field key, scan lines for `key: value` patterns.
- Ignore lines that do not match. No need to support nested blocks.
- Return a `Record<string, string>` of key → trimmed string value.
- Strip inline comments (` #...`) and surrounding quotes from values, matching
  the behaviour of `parseYamlLines()` for scalar values.
- If the file has no frontmatter block, return `{}`.
- Must not throw (any error returns `{}`).

This logic is extracted into a new internal helper function
`extractFrontmatterKeys(content: string, keys: string[]): Record<string, string>`
in `tab.ts` (or in a new `frontmatter-reader.ts` helper module — Architect
decides based on testability).

### FR-11 — Table renderer: extra columns

`renderFolderTable()` in `table-renderer.ts` must:

1. Accept cards that may have a `meta` field populated by the enrichment phase.
2. For each `ExtraField` in `config.extraFields`, add one `<th>` column header
   to the files section thead. The column header's text is `field.label`. Extra
   columns appear after the Tags column (or after the Modified column when
   `showTags=false`).
3. In each file row, add one `<td>` per extra field. The cell's text content is
   `card.meta?.[field.key] ?? ""`. An empty or missing value is displayed as
   `"—"` (em-dash, U+2014). The cell has class `fv-td-extra` plus a
   data attribute `data-extra-key="<field.key>"`.
4. Extra columns are NOT added to the folders section (directories do not have
   frontmatter).
5. Extra field columns are sortable: clicking the column header sorts the files
   section using `localeCompare` on the field value. Empty values (`""`)
   always sort last regardless of direction.
6. The initial sort state: if `config.sort` matches an `ExtraField.key` (exact
   string match, case-sensitive), that extra-field column is pre-selected as the
   active sort column (ascending). All other column headers start unsorted.

### FR-12 — Sort: empty values sort last

When sorting by an extra-field column:
- Empty string values (missing field) always appear after non-empty values,
  regardless of sort direction (ascending or descending).
- Among non-empty values, sort uses `String.prototype.localeCompare()` with no
  explicit locale (browser default).
- Tie-breaking within equal values: fall back to ascending name sort.

### FR-13 — Column ordering

In the files section thead, columns appear in this fixed order:

1. Icon (no header text)
2. Name
3. Type (if `showExtensions=true`)
4. Modified (if `showModified=true`)
5. Tags (if `showTags=true`)
6. Extra fields (in declaration order from `extra-fields` YAML list)

### FR-14 — Folder-cards layout: unaffected

The `folder-cards` layout (`renderer.ts`) is entirely unaffected by this
feature. `extra-fields` in `_folder.md` is parsed and stored in
`FolderViewConfig.extraFields` regardless of layout, but the `folder-cards`
renderer ignores `extraFields` entirely.

### FR-15 — Non-.md files and directories: empty meta

Non-`.md` files (e.g. `.png`, `.pdf`) and all directory cards receive
`meta: {}`. No frontmatter read is attempted for these cards. The renderer
displays `"—"` for every extra-field cell in their rows.

Wait — directories are excluded from the files section already (they appear in
the folders section). Clarification: extra columns only exist in the files
section. Non-`.md` files in the files section get `meta: {}` → all extra-field
cells display `"—"`.

### FR-16 — XSS prevention

Extra field values read from child `.md` frontmatter are user-controlled text.
They must be set via `.textContent` (never `.innerHTML`) when inserted into
table cells. The em-dash fallback `"—"` is also set via `.textContent`.
Column header labels from `ExtraField.label` are likewise set via `.textContent`.

### FR-17 — FolderLayoutRenderer signature: no change

The `FolderLayoutRenderer` type signature is unchanged. The enrichment phase
happens inside `renderFolderViewTabAsync()` before the renderer is called;
the renderer receives the already-enriched card array.

---

## Non-Functional Requirements

- **NFR-01** — No new npm dependencies. No new Rollup bundle targets.
- **NFR-02** — No Rust changes. All frontmatter reads use the existing
  `read_file` Tauri command already called in `renderFolderViewTabAsync()`.
- **NFR-03** — The enrichment phase uses `Promise.all` (concurrent reads). The
  total extra latency for N files is bounded by the slowest single file read,
  not the sum of all reads.
- **NFR-04** — `parseFolderMd()` must never throw (NFR-06 from original spec).
  The new `extra-fields` parsing path is wrapped in the existing top-level
  try/catch in `parseFolderMd()`.
- **NFR-05** — The feature degrades gracefully: if `extra-fields` is absent,
  the table renders identically to the current implementation. No regression to
  existing `folder-table` tests.
- **NFR-06** — Performance: for folders with many files, the `Promise.all` over
  all `.md` files runs concurrently. The Architect may impose a maximum
  concurrency cap (e.g. 20 parallel reads) via `Promise.all` over batched
  chunks, documented in the spec. This is at the Architect's discretion; the
  requirement is that N reads do not run strictly serially.
- **NFR-07** — Extra-field column headers follow the same accessibility pattern
  as existing sortable headers: cursor pointer, `aria-sort` attribute updated
  on sort change (optional enhancement — at minimum, the `fv-sorted-asc` /
  `fv-sorted-desc` CSS classes must be applied consistently).

---

## Acceptance Criteria

- **AC-01** — A `_folder.md` with `extra-fields: [status, priority]` (simple
  list) results in `config.extraFields` containing two entries:
  `{ key: "status", label: "Status" }` and `{ key: "priority", label: "Priority" }`.

- **AC-02** — A `_folder.md` with the structured form produces `ExtraField`
  objects whose `label` exactly matches the declared `label` value.

- **AC-03** — When `extra-fields` is absent from `_folder.md`, `config.extraFields`
  is `[]` and `renderFolderTable()` produces identical output to the current
  implementation (zero extra columns).

- **AC-04** — For a folder containing `note.md` with `status: in-progress` in
  its frontmatter, the rendered table shows `"in-progress"` in the Status column
  for that row.

- **AC-05** — For a folder containing `note.md` with no `status` field in its
  frontmatter, the rendered table shows `"—"` in the Status column for that row.

- **AC-06** — For a non-`.md` file (e.g. `photo.png`), the Status column cell
  displays `"—"`.

- **AC-07** — `sort: status` in `_folder.md` pre-selects the Status extra-field
  column as the active sort column on initial render (the `fv-sorted-asc` class
  is applied to the Status column header).

- **AC-08** — Clicking the Status column header sorts rows by the `status` field
  value ascending; clicking again sorts descending.

- **AC-09** — Empty `status` values sort last in both ascending and descending
  directions.

- **AC-10** — `sort: status` in `_folder.md` does not default to `"name-asc"`
  at parse time; `config.sort` is the string `"status"`.

- **AC-11** — Extra columns appear after the Tags column (or after Modified when
  Tags is hidden).

- **AC-12** — The `folder-cards` layout is unaffected; it renders identically
  regardless of `extra-fields` in `_folder.md`.

- **AC-13** — A failed `read_file` call for an individual child `.md` file does
  not abort the render; that card's extra-field cells display `"—"`.

- **AC-14** — Extra field values are inserted via `.textContent`; no HTML is
  injected.

---

## Files to Change

| File | Action | Notes |
|---|---|---|
| `src/plugins/file-browser/folder-view/types.ts` | Add types | Add `ExtraField` interface; add `extraFields: ExtraField[]` to `FolderViewConfig`; add `"extra-fields"?: unknown` to `FolderMdFrontMatter`; add `meta?: Record<string,string>` to `FolderCard`; widen `FolderSortOrder` |
| `src/plugins/file-browser/folder-view/parser.ts` | Extend | Extract `extra-fields` sequence; parse string and object items into `ExtraField[]`; store in config; pass unknown sort values through unchanged |
| `src/plugins/file-browser/folder-view/tab.ts` | Extend | Add `extractFrontmatterKeys()` helper; add enrichment phase in `renderFolderViewTabAsync()` before dispatch to `folder-table` renderer |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Extend | Add extra-field column headers; add extra-field cells in file rows; extend `sortCol` type; add extra-field sort logic with empty-last behaviour; wire header click handlers for extra columns; extend `clearIndicators()` to include extra column ths |
| `tests/folder-view/parser.test.ts` | Add tests | New describe block for `extra-fields` parsing (TR-01) |
| `tests/folder-view/tab.test.ts` | Add tests | New tests for `extractFrontmatterKeys` and enrichment phase (TR-02) |
| `tests/folder-view/table-renderer.test.ts` | Add tests | New tests for extra columns render, sort, empty values (TR-03) |

**Files that must NOT be changed:**
- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/detection.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`
- Any Rust source files
- `src-tauri/` (no changes)

---

## Test Requirements

### TR-01 — `tests/folder-view/parser.test.ts` additions

New `describe("extra-fields parsing")` block covering:

- **T-01** — Simple list: `extra-fields: [status, priority]` →
  `extraFields` = `[{key:"status",label:"Status"},{key:"priority",label:"Priority"}]`.
- **T-02** — Structured form: `key: status / label: Status` →
  `extraFields` = `[{key:"status",label:"Status"}]`.
- **T-03** — Mixed form (one string, one object) — implementation-defined
  behaviour; at minimum must not throw and must return the parseable items.
- **T-04** — `extra-fields` absent → `extraFields` = `[]`.
- **T-05** — Object item with empty `key` → item silently skipped.
- **T-06** — Object item with valid `key` but missing `label` → label defaults
  to capitalised key.
- **T-07** — `sort: status` (not in VALID_SORTS) → `config.sort` = `"status"`
  (not defaulted to `"name-asc"`).
- **T-08** — `sort: unknown-sort` (not a builtin, not declared in
  `extra-fields`) → `config.sort` = `"unknown-sort"` (pass-through; renderer
  handles it as a no-op or name-asc fallback).

### TR-02 — `tests/folder-view/tab.test.ts` additions

New `describe("extractFrontmatterKeys")` block (if extracted as a named export
or tested via the enrichment path):

- **T-09** — File with `status: in-progress` in frontmatter →
  `extractFrontmatterKeys(content, ["status"])` returns `{status:"in-progress"}`.
- **T-10** — File with no frontmatter → returns `{}`.
- **T-11** — Key absent from frontmatter → returns `{}` for that key (not an
  error).
- **T-12** — Inline comment stripped: `status: done # comment` → `"done"`.
- **T-13** — Quoted value stripped: `status: "in-progress"` → `"in-progress"`.
- **T-14** — Read failure (mocked Tauri invoke rejects) → card gets `meta: {}`
  and render continues without throwing.

### TR-03 — `tests/folder-view/table-renderer.test.ts` additions

New `describe("extra-fields columns")` block:

- **T-15** — `extraFields: [{key:"status",label:"Status"}]` and a card with
  `meta:{status:"done"}` → `<th>` with text `"Status"` present, `<td>` with
  text `"done"` present.
- **T-16** — Card with `meta:{}` (field absent) → cell displays `"—"`.
- **T-17** — `extraFields: []` (default) → no extra `<th>` columns rendered.
- **T-18** — `sort: "status"` with `extraFields: [{key:"status",…}]` → Status
  header has `fv-sorted-asc` class on initial render.
- **T-19** — Clicking Status column header sorts rows by `status` value
  ascending (non-empty first, then `"—"` rows last).
- **T-20** — Clicking Status column header twice sorts rows by `status` value
  descending (non-empty first in reverse, then `"—"` rows last).
- **T-21** — Empty `status` value sorts last in both directions.
- **T-22** — Clicking Status header clears `fv-sorted-*` classes from Name,
  Type, and Modified headers.
- **T-23** — Extra column cells use class `fv-td-extra` and
  `data-extra-key="status"`.
- **T-24** — Extra columns appear after Tags column in the header row.
- **T-25** — `makeConfig()` fixture in the test file gains `extraFields: []` in
  its defaults so existing tests are unaffected.

---

## Edge Case Inventory

This list is the Reviewer's mandatory test checklist. Every EC must have a
corresponding test or be explicitly justified as untestable in isolation.

- **EC-01** — `extra-fields` key present in `_folder.md` but the sequence is
  empty (no items). Result: `extraFields = []`. No columns added. No Tauri reads
  triggered. Render is identical to the no-`extra-fields` case.

- **EC-02** — A declared extra-field key contains special characters (e.g.
  `my-field`, `field_name`). The key is treated as a raw string; no
  normalisation (lowercasing, hyphen stripping) is applied. The YAML frontmatter
  in child files must use the same exact key to match.

- **EC-03** — A child `.md` file is locked or unreadable (Tauri `read_file`
  rejects). The enrichment phase sets `meta = {}` for that card and continues.
  The render completes normally; the unreadable file's extra-field cells show
  `"—"`.

- **EC-04** — A child `.md` file has no YAML frontmatter block (no opening
  `---`). `extractFrontmatterKeys()` returns `{}`. All extra-field cells for
  that row display `"—"`.

- **EC-05** — A child `.md` file's frontmatter contains the declared key with a
  value that is itself a YAML object or sequence (e.g. `tags: [a, b]`). The
  inline parse treats this as the raw string `"[a, b]"` or the first line of the
  block. The value is stored verbatim as a string (no special handling). The
  result is implementation-defined but must not throw.

- **EC-06** — `sort: status` is declared in `_folder.md` but `extra-fields` does
  not include `status`. The table renders with no extra columns. The sort value
  `"status"` does not match any builtin or extra-field key; the renderer falls
  back to `name-asc`. No crash.

- **EC-07** — `extra-fields` contains a duplicate key (e.g. `[status, status]`).
  The parser produces two `ExtraField` entries with the same key. The renderer
  adds two identically-headed columns, both backed by the same `card.meta` value.
  No crash. (Deduplication is not required in v1; it is a user authoring error.)

- **EC-08** — Folder contains zero `.md` files (only images, PDFs, etc.). The
  enrichment phase runs `Promise.all([])` (empty array). No reads occur.
  All extra-field cells in non-`.md` file rows display `"—"`.

- **EC-09** — Folder contains a very large number of `.md` files (e.g. 500).
  `Promise.all` fires all reads concurrently. This may produce a large burst of
  file system calls. The Architect must decide whether to cap concurrency (see
  NFR-06) and document the chosen approach in the spec.

- **EC-10** — The `_folder.md` itself is a `.md` file but is excluded from the
  card array by `collectChildren()` (FR-23 from the original spec). The
  enrichment phase never reads `_folder.md` as a child card, so there is no
  risk of reading the config file's own frontmatter into a row.

- **EC-11** — A child `.md` file's frontmatter value contains HTML-like content
  (e.g. `status: <b>done</b>`). The value is inserted via `.textContent` (FR-16),
  so `<b>done</b>` is displayed literally as text — no HTML injection.

- **EC-12** — The `folder-cards` layout is active (layout = `"folder-cards"`).
  Even if `extra-fields` is declared and `config.extraFields` is populated,
  `renderFolderCards()` is called (not `renderFolderTable()`). No enrichment
  phase runs (the enrichment is guarded by `layoutKey === "folder-table"`).
  `folder-cards` renders identically to the current implementation.

- **EC-13** — Lazy loading interacts with extra-field columns: the first 50 rows
  are rendered immediately; subsequent batches rendered by the
  `IntersectionObserver` callback also include the correct extra-field cells.
  The `buildRow` factory closure captures `config.extraFields` at
  `buildSectionTable()` call time, so lazily appended rows use the same field
  list.

- **EC-14** — `sort: status` is set, and the user clicks the Name header to
  change the active sort column. The Status column header must lose its
  `fv-sorted-*` class. `clearIndicators()` must be extended to include all
  dynamically created extra-field header elements.

- **EC-15** — The structured YAML form uses a key name that differs only in
  whitespace (e.g. `key: " status"`). The parser trims the key value before
  storing it. The resulting `ExtraField.key` is `"status"` (no leading space).

- **EC-16** — `extra-fields` is declared as a top-level sequence alongside a
  nested `layout:` block. The parser must correctly extract both the nested
  `layout` block and the `extra-fields` sequence from `rawFm` (the same pattern
  used for `exclude` + nested `layout:` in the existing `FVB-05` tests).

---

## Resolved Design Decisions

- **RDD-01** — Enrichment happens in `tab.ts` (`renderFolderViewTabAsync`), not
  in the renderer. This keeps the renderer synchronous and maintains the
  `FolderLayoutRenderer` signature contract.

- **RDD-02** — `FolderSortOrder` is widened to `string` (via a union) rather
  than adding a separate `extraSort` field. This keeps `FolderViewConfig.sort`
  as a single source of truth for initial sort state, simplifying the renderer
  initialisation logic.

- **RDD-03** — The em-dash `"—"` (not a hyphen) is the empty-value display
  character, consistent with the existing `formatModified` fallback in
  `table-renderer.ts` (line 167: `card.modified > 0 ? formatModified(...) : "—"`).

- **RDD-04** — Enrichment is guarded by `layoutKey === "folder-table"`. This
  ensures zero overhead for `folder-cards` and any future layout types that do
  not use `meta`.

- **RDD-05** — `extractFrontmatterKeys()` is a lightweight helper, not a reuse
  of `parseFolderMd()`. Using the full parser for each child file would parse
  many fields that are not needed (aspect-ratio, card-width, etc.) and return
  a `FolderViewConfig` — the wrong type. A targeted key extractor is simpler
  and faster.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 16 items in Edge Case Inventory (EC-01 through EC-16)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
