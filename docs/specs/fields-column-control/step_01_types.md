---
title: "step_01 — Types"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 01 — Types

## Goal

Extend `FolderViewConfig` and `FolderMdFrontMatter` with the new `fields` field.
This step touches exactly one file and has no runtime behaviour — it is a pure
type change that unlocks steps 02 and 03.

---

## File to Change

`src/plugins/file-browser/folder-view/types.ts`

---

## Precise Changes

### 1. Add `"fields"?: unknown` to `FolderMdFrontMatter`

Insert after the `"extra-fields"?: unknown` line (currently line 90):

```typescript
  /**
   * Raw YAML value for the fields: sequence.
   * Extracted by extractFieldsRaw() in parser.ts.
   */
  "fields"?: unknown;
```

The placement keeps `extra-fields` and `fields` adjacent since they are related
raw-value holders. Both use `unknown` because the parser validates and converts
them — the interface is intentionally permissive at this level.

### 2. Add `fields: string[] | null` to `FolderViewConfig`

Insert as a new field after the `extraFields: ExtraField[]` field (currently
the last field in the interface, around line 163):

```typescript
  /**
   * Ordered list of column identifiers from the fields: YAML sequence.
   * null when fields: is absent or empty — triggers legacy flag-based column logic.
   * When non-null, supersedes showModified, showExtensions, showTags, showCount,
   * and extraFields for the purposes of column rendering in table-renderer.ts.
   */
  fields: string[] | null;
```

Place it as the last field in the `FolderViewConfig` interface so it is easy to
locate and does not disturb any existing field order.

---

## Tests to Write / Update

No tests target `types.ts` directly. TypeScript compilation errors in steps 02
and 03 will flag any type contract violations introduced here.

After this step, running `npm run test:run` will fail with a TypeScript error in
`tests/folder-view/table-renderer.test.ts` because `makeConfig()` does not yet
include `fields`. That error is resolved in step_03 when `makeConfig` is updated.

Alternatively, the developer may add `fields: null` to `makeConfig()` in
`tests/folder-view/table-renderer.test.ts` at this step to keep tests green
throughout. Either ordering is acceptable.

---

## Verification

```bash
# Type-check only (no emit) to verify the interface compiles correctly.
npx tsc --noEmit
```

There should be zero new type errors from this change alone. The only expected
errors are downstream in files that construct `FolderViewConfig` objects without
the new `fields` field (parser.ts and table-renderer.test.ts) — those are
resolved in subsequent steps.

---

## Edge Cases Addressed

- **EC-18** — `makeConfig()` in `table-renderer.test.ts` must gain `fields: null`.
  This is a test-fixture concern tracked in step_03. This step only defines the type.
