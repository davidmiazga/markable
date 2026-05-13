---
title: "Step 02 — Remove Layout Key Guard from Enrichment Gate"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 02 — Remove Layout Key Guard from Enrichment Gate

**Goal**: Remove `layoutKey === "folder-table" &&` from the `needsEnrichment`
condition in `tab.ts`. After this step, enrichment runs for **all** layouts
whenever `config.extraFields.length > 0` or `imageColumnsRequested(config)`
returns true. This enables the `folder-cards` layout to receive `card.meta`
values in Step 05.

**No behavior change for users of the `folder-table` layout.** The enrichment
body is untouched. The only change is that the same enrichment now also runs
for `folder-cards` (and any future layout) when the config requests it.

---

## Files Changed

| File | Change |
|---|---|
| `src/plugins/file-browser/folder-view/tab.ts` | One-line deletion from `needsEnrichment` condition |

---

## 1. The Change

### Before (current `tab.ts`, lines 327–329)

```typescript
const needsEnrichment =
  layoutKey === "folder-table" &&
  (config.extraFields.length > 0 || imageColumnsRequested(config));
```

### After

```typescript
const needsEnrichment =
  config.extraFields.length > 0 || imageColumnsRequested(config);
```

That is the entire code change in this step. The comment block immediately
above it (lines 320–329) must also be updated to remove the "NFR-5: no
enrichment runs for layouts other than folder-table" line:

### Before (comment)

```typescript
// Step 3a: Enrichment phase — read child metadata for folder-table columns.
// Runs when:
//   (a) extra-fields are declared (custom frontmatter columns), OR
//   (b) image built-in columns are requested (width, height, date-taken, camera).
// NFR-5: no enrichment runs for layouts other than folder-table or when neither
// condition is met.
```

### After (comment)

```typescript
// Step 3a: Enrichment phase — read child metadata from disk.
// Runs when any layout requests enriched field values:
//   (a) extra-fields are declared (custom frontmatter keys), OR
//   (b) image built-in columns are requested (width, height, date-taken, camera).
// When neither condition is met, enrichment is skipped for all layouts (no-op).
```

---

## 2. Why This Is Sufficient

The enrichment body below the gate was already written without any reference
to `layoutKey`. It iterates `cards`, reads `.md` frontmatter, calls Tauri
image commands, and sets `card.meta[key]`. None of that is table-specific.

`imageColumnsRequested(config)` checks `config.fields` (fields: mode) and
falls back to `config.extraFields` (legacy mode). Both layouts use the same
`FolderViewConfig`, so the function works correctly for cards config with no
modification.

`config.extraFields` is populated from the `fields:` YAML sequence (for
non-builtin items) by `parseFolderMd` — this was already the case before this
refactor (parser.ts lines 572–578). So a cards config that declares:

```yaml
fields:
  - name
  - modified
  - status
```

produces `config.extraFields = [{ key: "status", label: "Status" }]` and
`config.fields = ["name", "modified", "status"]`. The enrichment gate fires
because `config.extraFields.length > 0`. All `.md` file cards get their
`status` frontmatter key read into `card.meta["status"]`. Step 05 reads this
value to build the metadata line.

---

## 3. `imageColumnsRequested` — No Change Needed

The current implementation of `imageColumnsRequested` in `tab.ts` already
handles both `config.fields !== null` (fields: mode) and `config.extraFields`
(legacy mode). It does not reference `layoutKey`. No modification is needed.

---

## Tests to Write (TDD — write before implementing)

File: `tests/folder-view/tab.test.ts` (already exists — add new test group)

### New test group: `enrichment gate — folder-cards layout`

#### Test A: `enrichment runs for folder-cards when custom field is declared`

```
Given: a config with layout = "folder-cards", fields: ["name", "status"]
       (which produces extraFields = [{ key: "status", ... }])
And:   a cards array with two .md files
When:  renderFolderViewTabAsync is called (via buildFolderViewRenderFn)
Then:  read_file is invoked for each .md file (to read status frontmatter)
       card.meta["status"] is set for each card
```

Implement by mocking `window.__TAURI_INTERNALS__.invoke` to capture `read_file`
calls, consistent with existing `tab-image-enrichment.test.ts` pattern.

#### Test B: `enrichment does not run for folder-cards when no custom fields`

```
Given: a config with layout = "folder-cards", fields: null, extraFields: []
And:   a cards array with two .md files
When:  renderFolderViewTabAsync is called
Then:  read_file is NOT called for those .md files
       (The read_file call for _folder.md itself is still expected)
```

#### Test C: `table layout enrichment unchanged after gate removal`

```
Given: a config with layout = "folder-table", fields: ["name", "status"]
And:   a cards array with two .md files
When:  renderFolderViewTabAsync is called
Then:  read_file is invoked for each .md file (same as before Step 02)
       card.meta["status"] is set for each card
```

This is a regression test — behavior must be identical to pre-refactor.

#### Test D: `enrichment failure for one card (EC-17)`

```
Given: a config with layout = "folder-cards", fields: ["name", "status"]
And:   a cards array with two .md files
And:   read_file throws for the second card
When:  renderFolderViewTabAsync is called
Then:  the first card has card.meta["status"] set
       the second card has card.meta = {}
       renderFolderCards is called (no exception thrown)
```

### Regression: `tab-image-enrichment.test.ts` must pass unchanged

The existing image enrichment tests assert that `get_image_dimensions` and
`get_exif_data` are called when image fields are declared. These tests use
`layout = "folder-table"`. They must still pass — the gate removal does not
break the behavior because `imageColumnsRequested` is unchanged.

---

## Acceptance Criteria

- [ ] `layoutKey === "folder-table" &&` is removed from `needsEnrichment`
- [ ] Comment above `needsEnrichment` is updated (no longer mentions folder-table restriction)
- [ ] `tab.test.ts` tests A, B, C, D pass
- [ ] All existing `tab-image-enrichment.test.ts` tests pass
- [ ] All other existing tests pass (`npm run test:run`)
