---
title: "Step 06 — table-renderer.ts: fieldHeaderLabel for Image Built-ins"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 06 — table-renderer.ts: Column Header Labels

## Goal

Add four `case` entries to the `fieldHeaderLabel` switch statement in `table-renderer.ts`
so the new image built-in identifiers map to their correct English column header labels (FR-6).

This is the smallest change in the feature: four lines added to a switch statement.

## Prerequisite

Step 03 complete (identifiers are in BUILTIN_FIELDS — this step adds the display labels).
Steps 01, 02, 04, 05 do NOT need to be complete before this step.

---

## Files Modified

| File | Change |
|------|--------|
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Add four cases to `fieldHeaderLabel` |

---

## TDD Sequence

The existing `tests/folder-view/table-renderer.test.ts` or
`tests/folder-view/table-renderer-bulk.test.ts` may already import `fieldHeaderLabel`
indirectly (via the rendered DOM). Add direct tests for the label mappings.

Since `fieldHeaderLabel` is not exported, tests should verify the rendered table header
text via `buildSectionTable` or `renderFolderTable`. Alternatively, the developer may
choose to export `fieldHeaderLabel` temporarily for testing and unexport after.

The most practical approach given the existing test patterns (which test rendered DOM):
add tests to `tests/folder-view/table-renderer.test.ts` that render a minimal folder-table
with each image column in `config.fields` and assert the `<th>` text content.

### New tests

```
TH-01  Render folder-table with fields: ["name","width"] → <th> with text "Width" present
TH-02  Render folder-table with fields: ["name","height"] → <th> with text "Height" present
TH-03  Render folder-table with fields: ["name","date-taken"] → <th> with text "Date Taken" present
TH-04  Render folder-table with fields: ["name","camera"] → <th> with text "Camera" present
TH-05  All four fields in one config → all four header labels present in the rendered table
TH-06  Existing labels not regressed: "name"→"Name", "modified"→"Modified", "tags"→"Tags",
       "type"→"Type", "count"→"Items" still correct
```

---

## Implementation

### Change in table-renderer.ts

Current `fieldHeaderLabel` function (lines 144-160):

```typescript
function fieldHeaderLabel(field: string, extraFields: ExtraField[]): string {
  switch (field) {
    case "name":     return "Name";
    case "type":
    case "ext":      return "Type";
    case "modified": return "Modified";
    case "tags":     return "Tags";
    case "count":    return "Items";
    default: {
      const ef = extraFields.find(e => e.key === field);
      if (ef) return ef.label;
      return field.charAt(0).toUpperCase() + field.slice(1);
    }
  }
}
```

Modified `fieldHeaderLabel` — add four cases before `default`:

```typescript
function fieldHeaderLabel(field: string, extraFields: ExtraField[]): string {
  switch (field) {
    case "name":       return "Name";
    case "type":
    case "ext":        return "Type";
    case "modified":   return "Modified";
    case "tags":       return "Tags";
    case "count":      return "Items";
    case "width":      return "Width";
    case "height":     return "Height";
    case "date-taken": return "Date Taken";
    case "camera":     return "Camera";
    default: {
      const ef = extraFields.find(e => e.key === field);
      if (ef) return ef.label;
      return field.charAt(0).toUpperCase() + field.slice(1);
    }
  }
}
```

### No other changes to table-renderer.ts

The four new identifiers fall through the existing `else` branch in `buildFileRow` (fields
mode, line ~387):

```typescript
} else {
  // Custom frontmatter field — value from card.meta, em-dash fallback.
  const td = document.createElement("td");
  td.className = "fv-td fv-td-extra";
  td.setAttribute("data-extra-key", field);
  const value = card.meta?.[field] ?? "";
  td.textContent = value === "" ? "—" : value;
  tr.appendChild(td);
}
```

This `else` branch already handles any field identifier that is not `icon`, `name`,
`type/ext`, `modified`, `tags`, or `count`. The image keys (`width`, `height`, `date-taken`,
`camera`) fall into this `else` branch and are rendered correctly via `card.meta?.[field]`
— which is populated by the enrichment step (step 05).

**No change is needed to `buildFileRow` or `buildFolderRow`** for cell rendering.

### Sort wiring for image columns

Sort wiring in `buildSectionTable` (fields-mode sort wiring, lines ~742-760):

```typescript
for (const { th, field } of fieldThPairs) {
  if (field === "icon" || field === "tags" || field === "count") continue;
  const sortKey =
    field === "type" || field === "ext" ? "ext" :
    field === "name" ? "name" :
    field === "modified" ? "modified" :
    field; // custom fields use the key directly
  ...
}
```

The `field` (default branch) handles `"width"`, `"height"`, `"date-taken"`, `"camera"` —
they are passed through verbatim as `sortKey`. The sort logic in `applySort` uses
`a.meta?.[sortCol] ?? ""` for unknown sort keys, which is exactly the right behaviour
for image column sorting (locale-aware string comparison per requirements FR-2/FR-3).

**No change is needed to sort wiring.**

---

## Acceptance Criteria

- [ ] `npm run test:run -- tests/folder-view/table-renderer.test.ts` passes (no regressions)
- [ ] New tests TH-01 through TH-06 pass
- [ ] `fieldHeaderLabel("width", [])` returns `"Width"`
- [ ] `fieldHeaderLabel("height", [])` returns `"Height"`
- [ ] `fieldHeaderLabel("date-taken", [])` returns `"Date Taken"`
- [ ] `fieldHeaderLabel("camera", [])` returns `"Camera"`
- [ ] No change to `buildFileRow`, `buildFolderRow`, or sort wiring (they already handle unknown keys)
