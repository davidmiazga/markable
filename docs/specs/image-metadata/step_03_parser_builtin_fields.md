---
title: "Step 03 — parser.ts: Add Image Built-in Fields to BUILTIN_FIELDS"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 03 — parser.ts: BUILTIN_FIELDS Extension

## Goal

Add the four new image column identifiers to `BUILTIN_FIELDS` in `parser.ts` so they are
not misclassified as custom frontmatter keys by `parseFolderMd` and `resolveFields`.

This is the smallest and most isolated change in the feature. It is a prerequisite for
steps 04, 05, and 06.

## Prerequisite

None. This step is independent of steps 01 and 02.

---

## Files Modified

| File | Change |
|------|--------|
| `src/plugins/file-browser/folder-view/parser.ts` | Add four identifiers to `BUILTIN_FIELDS` |

---

## TDD Sequence

The existing `tests/folder-view/parser.test.ts` has tests for `BUILTIN_FIELDS` and
`parseFolderMd`. Add tests to the existing file (do not create a new test file).

Alternatively, create `tests/folder-view/parser-image-fields.test.ts` to keep image-specific
tests isolated. The developer may choose either approach.

### New tests to add

```
PI-01  BUILTIN_FIELDS.has("width")      → true
PI-02  BUILTIN_FIELDS.has("height")     → true
PI-03  BUILTIN_FIELDS.has("date-taken") → true
PI-04  BUILTIN_FIELDS.has("camera")     → true
PI-05  parseFolderMd with fields: [name, width, height] → config.extraFields is []
       (width/height are built-in, not custom — resolvedExtraFields filter should exclude them)
PI-06  parseFolderMd with fields: [name, width, rating] → config.extraFields has one entry
       with key="rating" (rating is custom; width is built-in and filtered out)
PI-07  parseFolderMd with fields: [date-taken, camera] → config.fields = ["date-taken","camera"],
       config.extraFields = [] (both are built-in)
```

Tests PI-05 through PI-07 verify the interaction between BUILTIN_FIELDS and the `fields:`
parsing logic in `parseFolderMd`. They exercise the `resolvedExtraFields` derivation at
lines 569-572 of the current parser.ts.

---

## Implementation

### Change in parser.ts

The single line change:

```typescript
// Before:
export const BUILTIN_FIELDS = new Set(["name", "type", "ext", "modified", "tags", "count", "icon"]);

// After:
export const BUILTIN_FIELDS = new Set([
  "name", "type", "ext", "modified", "tags", "count", "icon",
  "width", "height", "date-taken", "camera",
]);
```

Keep the set on multiple lines for readability. The existing format uses a single line; the
developer may choose either layout style, but must ensure all 11 members are present.

### Why this is sufficient for the parser

The `parseFolderMd` function at lines 562-572 computes `resolvedExtraFields` by filtering
out `BUILTIN_FIELDS` from `config.fields`:

```typescript
resolvedExtraFields = fields
  .filter(f => !BUILTIN_FIELDS.has(f))
  .map(f => ({ key: f, label: ... }));
```

Adding the four image keys to `BUILTIN_FIELDS` ensures they are filtered out of
`extraFields`. The enrichment guard in `tab.ts` (step 05) will detect them via
`config.fields` directly, not via `config.extraFields`.

### No change to resolveFields in table-renderer.ts

`resolveFields` in `table-renderer.ts` is not affected by this step. It operates on
`config.fields` directly (the raw `fields:` sequence from `_folder.md`), and the image
keys will be present in `config.fields` when declared. The `fieldHeaderLabel` change for
image keys is in step 06.

---

## Acceptance Criteria

- [ ] `npm run test:run -- tests/folder-view/parser.test.ts` passes (or the new file if separate)
- [ ] `BUILTIN_FIELDS.has("width")` === true
- [ ] `BUILTIN_FIELDS.has("height")` === true
- [ ] `BUILTIN_FIELDS.has("date-taken")` === true
- [ ] `BUILTIN_FIELDS.has("camera")` === true
- [ ] `parseFolderMd` with `fields: [name, width, rating]` produces `extraFields = [{ key: "rating" }]`
- [ ] All existing parser tests still pass (no regression)
