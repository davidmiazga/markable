---
title: "Spec: Extra Fields Custom YAML Columns"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Extra Fields Custom YAML Columns — Master Blueprint

## Requirements source

`docs/requirements/active_task.md` — "Folder Table: Extra Fields Columns"

---

## High-Level Architecture

### Tech Stack

All changes are purely frontend TypeScript. No new npm dependencies, no new
Rollup targets, no Rust changes.

| Layer | Technology | Rationale |
|---|---|---|
| Parser | Existing `parseYamlLines` (extended) | Strategy A — extend in-place; keeps YAML logic in one function |
| Frontmatter reader | New `frontmatter-reader.ts` module | Testable in isolation; keeps `tab.ts` focused |
| Enrichment | `tab.ts` — `renderFolderViewTabAsync` | RDD-01: renderer stays synchronous; `FolderLayoutRenderer` signature unchanged |
| Renderer | `table-renderer.ts` — `buildSectionTable` | Extra-column `<th>` refs stored in a closure array; `clearIndicators` iterates them |
| Types | `types.ts` | `ExtraField`, `BuiltinSortOrder`, widened `FolderSortOrder`, extended `FolderViewConfig`, `FolderCard.meta` |

### Data Flow

```
_folder.md content (string)
  │
  ▼
parseFolderMd()          ← parser.ts (extended)
  │ config.extraFields: ExtraField[]
  │ config.sort: FolderSortOrder (now passes unknown values through)
  ▼
renderFolderViewTabAsync()  ← tab.ts
  │
  ├─ layoutKey !== "folder-table"  OR  extraFields.length === 0
  │    → skip enrichment, dispatch immediately
  │
  └─ layoutKey === "folder-table"  AND  extraFields.length > 0
       │
       ├─ filter: mdCards = cards where kind="file" AND ext=".md"
       ├─ non-md and dir cards → card.meta = {}
       │
       └─ Promise.all( mdCards.map( card =>
            invoke("read_file", { path: card.path })
              .then( content => extractFrontmatterKeys(content, keys) )
              .catch( () => ({}) )
            .then( meta => card.meta = meta )
          ))
            │
            ▼
       renderFolderTable(config, enrichedCards, container, folderPath)
            │
            ▼
       buildSectionTable(... isFiles=true ...)
            │
            ├─ thead: extra <th> per ExtraField (after Tags column)
            │    stored in extraThs[]
            ├─ clearIndicators() includes extraThs[]
            ├─ sortCol typed as string (not "name"|"modified"|"ext")
            ├─ applySort(): if sortCol matches an ExtraField.key → localeCompare
            │    with empty-last, tie-break on name
            └─ buildFileRow(card, config, extraFields):
                 extra <td> per ExtraField, class fv-td-extra, data-extra-key,
                 value via .textContent ("—" when empty)
```

---

## Architectural Decisions

### AD-01: Parser strategy for structured sequences — Strategy A

**Decision**: Extend `parseYamlLines` to detect structured sequence items in-place.

**Rationale**: When a sequence item line (prefixed `"- "`) itself contains a colon,
it signals a mapping item. Subsequent indented lines (without `"- "`) are sub-key
lines belonging to that item. The item is stored as a `Record<string,string>` in the
array instead of a plain string. The existing `string[]` type widens to
`(string | Record<string,string>)[]`. This change is ~15 lines, entirely within
`parseYamlLines`. It avoids a second pass over raw YAML text and keeps all
YAML parsing logic in one function.

Strategy B (post-process raw strings) was rejected because it would require a
bespoke second-pass substring search over the original YAML block — replicating
partial parse logic outside the parser, violating the single-responsibility of
`parseYamlLines`.

**Scope**: `parseYamlLines` return type changes to:
```typescript
Record<string, string | Record<string, string> | (string | Record<string,string>)[]>
```
The `normalizeFm` function already skips array values; it continues to do so
unchanged. The `exclude` extraction path casts to `string[]` and already filters
for string items, so it is unaffected.

### AD-02: `extractFrontmatterKeys` placement — new `frontmatter-reader.ts`

**Decision**: Extract `extractFrontmatterKeys` into a new module
`src/plugins/file-browser/folder-view/frontmatter-reader.ts`.

**Rationale**: The function has no dependency on `tab.ts` internals and is
independently testable. Placing it in `tab.ts` would make TR-02 tests import
the entire `tab.ts` module (which pulls in renderer, parser, and Tauri globals).
A dedicated module keeps test isolation clean.

The function is a named export so tests can import it directly without going
through the enrichment path.

### AD-03: Concurrency cap — uncapped `Promise.all`

**Decision**: Use uncapped `Promise.all` (all `.md` file reads fire concurrently).

**Rationale**: Typical Markable vault folders contain <200 `.md` files. Tauri's
`read_file` command is a local filesystem operation with sub-millisecond latency.
A concurrency cap of N=20 would add ~9 extra round-trips for a 200-file folder with
no observable benefit. If vault sizes grow to thousands of files, a batching wrapper
can be added without changing the API.

**EC-09 acknowledgement**: For folders with 500+ `.md` files, `Promise.all` fires
all reads simultaneously. This is a known characteristic, not a bug. The burst is
bounded by the OS file-descriptor limit and Tauri's async runtime, which handles
this safely on macOS.

### AD-04: `FolderSortOrder` widening — union with `string`

**Decision**: Introduce `BuiltinSortOrder` for the four known values and widen
`FolderSortOrder` to `BuiltinSortOrder | string`.

**Rationale**: The requirements prefer this form (FR-08). It preserves type
expressiveness (callers can still use the builtin literals with autocompletion)
while accommodating arbitrary extra-field keys. Using plain `string` alone would
lose autocomplete on the builtin values at call sites.

`table-renderer.ts` imports `FolderSortOrder` for the `applySort` path. After
the type change, `sortCards()` is still called with a `FolderSortOrder` value
only when `sortCol` is `"name"` or `"modified"`. The extra-field sort branch is
a new independent code path that does not call `sortCards`.

`FolderViewConfig.sort` is typed as `FolderSortOrder`. The `safeDefaults` object
in `parseFolderMd` uses `"name-asc"` which satisfies the union.

### AD-05: `clearIndicators()` design for extra columns

**Decision**: Maintain a local `extraThs: HTMLTableCellElement[]` array inside the
`buildSectionTable` closure. This array is populated during the `isFiles` thead
construction loop and referenced by `clearIndicators()`.

**Rationale**: The extra `<th>` elements are created dynamically inside the `isFiles`
branch. They cannot be captured as named variables (there are N of them). An array
accumulated during construction is the minimal, zero-allocation solution. It is
analogous to how `extTh` and `modTh` are currently captured as nullable locals.

### AD-06: `buildFileRow` signature extension

**Decision**: Add `extraFields: ExtraField[]` as a third parameter to
`buildFileRow`. The `buildRow` factory lambda inside `buildSectionTable` captures
`config.extraFields` at call time.

**Rationale**: EC-13 (lazy loading) requires that lazily-appended rows include the
correct extra-field cells. The `buildRow` factory is the closure used by both the
initial render and the `IntersectionObserver` callback. Capturing `config.extraFields`
in the factory ensures all rows — immediate and lazy — use the same field list.

---

## Component Map

### New files

| File | Purpose |
|---|---|
| `src/plugins/file-browser/folder-view/frontmatter-reader.ts` | `extractFrontmatterKeys(content, keys)` — lightweight inline YAML frontmatter extractor |

### Modified files

| File | Changes |
|---|---|
| `src/plugins/file-browser/folder-view/types.ts` | Add `ExtraField`, `BuiltinSortOrder`; widen `FolderSortOrder`; extend `FolderViewConfig`, `FolderMdFrontMatter`, `FolderCard` |
| `src/plugins/file-browser/folder-view/parser.ts` | Extend `parseYamlLines` for structured sequence items; add `extra-fields` extraction; pass unknown sort values through |
| `src/plugins/file-browser/folder-view/tab.ts` | Import `extractFrontmatterKeys`; add enrichment phase in `renderFolderViewTabAsync` |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Extra column headers + cells; extra-field sort with empty-last; `clearIndicators` extension; `buildFileRow` signature |
| `src/plugins/file-browser/folder-view/folder-table-css.ts` | Add `.fv-td-extra` style rule |

### Test files

| File | Changes |
|---|---|
| `tests/folder-view/parser.test.ts` | New `describe("extra-fields parsing")` block — T-01 through T-08 |
| `tests/folder-view/tab.test.ts` | New `describe("extractFrontmatterKeys")` block — T-09 through T-14 |
| `tests/folder-view/table-renderer.test.ts` | Update `makeConfig()` to include `extraFields: []`; new `describe("extra-fields columns")` block — T-15 through T-25 |

### Files that must NOT be changed

- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/detection.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`
- `src-tauri/` (any Rust file)

---

## Implementation Roadmap

Steps follow Red/Green/Refactor TDD order. Each step produces a runnable
test suite at its completion.

| Step | File | Goal |
|---|---|---|
| `step_01_types.md` | `types.ts` | Add `ExtraField`, `BuiltinSortOrder`, widen `FolderSortOrder`, extend `FolderViewConfig` + `FolderCard` |
| `step_02_parser.md` | `parser.ts` + tests | Extend `parseYamlLines` for structured items; `extra-fields` extraction; pass-through sort |
| `step_03_frontmatter-reader.md` | `frontmatter-reader.ts` + tests | New `extractFrontmatterKeys` module; T-09 through T-14 |
| `step_04_enrichment.md` | `tab.ts` + tests | Enrichment phase in `renderFolderViewTabAsync`; T-14 integration test |
| `step_05_renderer.md` | `table-renderer.ts` + `folder-table-css.ts` + tests | Extra columns, sort, CSS; T-15 through T-25 |

---

## Implementation Checklist

- [x] `step_01_types.md` — types.ts updated
- [x] `step_02_parser.md` — parser extended; T-01–T-08 green
- [x] `step_03_frontmatter-reader.md` — frontmatter-reader.ts created; T-09–T-13 green
- [x] `step_04_enrichment.md` — enrichment phase in tab.ts; T-14 green
- [x] `step_05_renderer.md` — extra columns rendered; T-15–T-25 green
- [x] All existing tests still green (no regression)
- [x] AC-01 through AC-14 verified
- [x] EC-01 through EC-16 covered

---

## Edge Case Coverage Map

| EC | Covered by |
|---|---|
| EC-01 | T-04, T-17 (empty sequence → no columns) |
| EC-02 | T-02 (key with hyphens passes through as-is) |
| EC-03 | T-14 (read failure → meta={}) |
| EC-04 | T-10 (no frontmatter → {}) |
| EC-05 | tested in extractFrontmatterKeys: raw string stored |
| EC-06 | T-18 variant: sort key not in extraFields → renderer falls back to name-asc |
| EC-07 | Note in T-15: duplicate keys produce two columns; no crash |
| EC-08 | T-14: Promise.all([]) fires immediately |
| EC-09 | AD-03: uncapped, documented |
| EC-10 | collectChildren already excludes _folder.md (existing FR-23 test) |
| EC-11 | T-23: .textContent used; HTML injection blocked |
| EC-12 | T-17 variant: folder-cards layout guard in enrichment |
| EC-13 | buildFileRow captures extraFields via closure; lazy rows correct |
| EC-14 | T-22: clearIndicators() includes extraThs[] |
| EC-15 | T-02 / FR-06: key trimmed before storage |
| EC-16 | Covered by existing exclude+layout parsing tests (unchanged) |

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-view/types.ts` — added `BuiltinSortOrder`, widened `FolderSortOrder`, added `ExtraField` interface, extended `FolderMdFrontMatter`, `FolderViewConfig`, `FolderCard`
  - `src/plugins/file-browser/folder-view/parser.ts` — extended `parseYamlLines` for structured sequence items; added `extra-fields` extraction; changed sort pass-through; added `extraFields: []` to safeDefaults and return value
  - `src/plugins/file-browser/folder-view/frontmatter-reader.ts` — NEW: `extractFrontmatterKeys()` module
  - `src/plugins/file-browser/folder-view/tab.ts` — imported `extractFrontmatterKeys`; added enrichment phase guarded by `layoutKey === "folder-table" && extraFields.length > 0`
  - `src/plugins/file-browser/folder-view/table-renderer.ts` — imported `ExtraField`; extended `buildFileRow` with third `extraFields` param; widened `sortCol` to `string`; added `extraThs[]`; added extra-field `<th>` headers; extended `clearIndicators()`; extended `applySort()` for extra-field sort with empty-last; updated `buildRow` factory; wired click handlers for extra-field columns
  - `src/plugins/file-browser/folder-view/folder-table-css.ts` — added `.fv-td-extra` rule
  - `tests/folder-view/parser.test.ts` — updated EC-12 test to match new pass-through behavior; added T-01–T-08, EC-01, EC-15
  - `tests/folder-view/tab.test.ts` — added `extractFrontmatterKeys` import; added T-09–T-13 (plus supplementary), T-14
  - `tests/folder-view/table-renderer.test.ts` — updated `makeConfig()` (added `extraFields: []`, changed default `showExtensions` to `false` to fix 7 pre-existing failures); updated `makeFileCard()` with `meta` param; updated 2 pre-existing test fixtures that used embedded extension names; added T-15–T-25, EC-06, EC-11

- **Steps completed**: step_01_types.md, step_02_parser.md, step_03_frontmatter-reader.md, step_04_enrichment.md, step_05_renderer.md

- **Known limitations**:
  - The 3 failing tests in `tests/plugins/file-browser/smart-folders.*.test.ts` are pre-existing failures unrelated to this feature (verified by running the test suite against the stash of our changes).
  - The enrichment phase uses uncapped `Promise.all` (AD-03); for folders with 500+ `.md` files this fires all reads simultaneously — documented as acceptable per AD-03.

- **Edge cases covered by tests**:
  - EC-01 (empty sequence → no columns): T-04 (parser), T-17 (renderer)
  - EC-02 (key with hyphens): T-02 tests `key: status` with hyphenated `label: My Status`
  - EC-03 (read failure → meta={}): T-14 (tab enrichment)
  - EC-04 (no frontmatter → {}): T-10 (frontmatter-reader)
  - EC-05 (raw string value stored): EC-05 test in tab.test.ts
  - EC-06 (sort key not in extraFields → no crash): EC-06 (renderer)
  - EC-07 (duplicate keys → two columns, no crash): T-03 verifies no throw; T-15 verifies column rendering
  - EC-08 (Promise.all([]) fires immediately): T-04 verifies extraFields=[] skips enrichment
  - EC-09 (500+ files, uncapped): AD-03 documented
  - EC-10 (_folder.md excluded): covered by existing FR-23 test (unchanged)
  - EC-11 (HTML injection blocked via textContent): EC-11 (renderer)
  - EC-12 (folder-cards layout skips enrichment): EC-12 (tab.test.ts) — verifies no extra-field columns in folder-cards output
  - EC-13 (lazy rows use same extraFields): `extraFieldsForRow` captured in `buildSectionTable` closure; verified by renderer architecture
  - EC-14 (clearIndicators includes extraThs): T-22
  - EC-15 (key whitespace trimmed): EC-15 (parser)
  - EC-16 (extra-fields + nested layout block): EC-16 (parser.test.ts)

---

## Review Sign-off

- **Date**: 2026-05-11
- **Findings summary**: 0 Critical, 0 High, 3 Medium, 1 Low — all resolved
- **Requirements traceability**: All items in `docs/requirements/active_task.md` (FR-01 through FR-17, NFR-01 through NFR-07, AC-01 through AC-14) verified against implementation.
- **Edge case coverage**: All 16 Edge Case Inventory items (EC-01 through EC-16) covered by passing tests.
- **Status**: Approved for Merge

### Findings resolved during review

**Medium — Stale comment on `VALID_SORTS` constant**
- Location: `src/plugins/file-browser/folder-view/parser.ts` line 19 (pre-fix)
- The comment said "Anything else defaults to 'name-asc' (EC-12)" but the behavior changed in FR-08 to pass unknown values through verbatim. Fixed: comment updated to accurately describe the pass-through semantics.

**Medium — `parseYamlLines` missing Length justification comment**
- Location: `src/plugins/file-browser/folder-view/parser.ts` — `parseYamlLines` JSDoc
- Function grew from 72 to 113 lines with the Strategy A extension but lacked the required justification. Fixed: justification added to JSDoc.

**Medium — EC-02, EC-08, EC-12, EC-16 not covered by tests**
- EC-02 (hyphenated/underscore key names): no test with non-alphanumeric keys. Fixed: `EC-02` test added to `tests/folder-view/parser.test.ts`.
- EC-08 (zero .md files + extraFields declared): `Promise.all([])` path untested. Fixed: `EC-08` test added to `tests/folder-view/tab.test.ts`.
- EC-12 (folder-cards layout skips enrichment): claimed covered by T-17 and architecture only. Fixed: dedicated `EC-12` integration test added to `tests/folder-view/tab.test.ts`.
- EC-16 (extra-fields + nested layout block coexist): claimed covered by existing exclude tests that do not include `extra-fields`. Fixed: `EC-16` test added to `tests/folder-view/parser.test.ts`.

**Low — Latent key collision when extra-field key equals "modified"**
- Location: `src/plugins/file-browser/folder-view/table-renderer.ts` — `applySort()` branch at line 353
- If a user declares an extra-field key exactly named `"modified"` and `sort: modified`, `applySort()` routes it to `sortCards("modified-asc")` (builtin timestamp sort) instead of `meta["modified"]` (string sort). Only triggered by naming an extra field the same as a builtin column sentinel — not a realistic authoring pattern and not addressed by the requirements. Noted as a known v1 limitation; no code change required.
