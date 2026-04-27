---
title: "Step 02 — Same-stem guard in renameNode"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 02 — Same-stem guard in `renameNode`

## Requirement Traceability

- FR-02.11.1 — Trigger: Post-Rename Detection
- AD-01 — Suppress banner when `oldStem === newStem`
- EC-04 — Rename to same name: no banner shown

---

## Context

`renameNode` in `src/plugins/file-browser/file-browser-ops.ts` (lines 273–310)
currently calls `checkAndShowLinkBanner(container, oldStem, stem)` unconditionally
whenever `isFile` is true (line 308). If the user opens the inline rename input and
presses Enter without changing the text, `oldStem` and `stem` are equal. The call
to `checkAndShowLinkBanner` would then:

1. Query the vault index for files linking to `oldStem`.
2. If any are found, show the banner offering to replace `[[oldStem]]` with
   `[[oldStem]]` — a no-op rewrite.

This is misleading. Per AD-01 the banner must be suppressed when `oldStem === stem`.

Note: the `filenameExistsInDir` check at line 293 will catch a rename to an
identical name for files that already exist at the new path. However that guard
raises an error rather than silently no-oping, and it would not apply if the
`rename_file` Rust command allows identical source and destination paths. The
explicit stem equality guard is therefore required as documented intent regardless
of the upstream guard's behavior.

---

## Change Required

### `src/plugins/file-browser/file-browser-ops.ts`

Inside `renameNode`, at the point where `checkAndShowLinkBanner` is called, add a
stem equality guard:

Before (line 307–309):
```typescript
if (isFile) {
  checkAndShowLinkBanner(container, oldStem, stem);
}
```

After:
```typescript
if (isFile && oldStem !== stem) {
  checkAndShowLinkBanner(container, oldStem, stem);
}
```

No other changes to `renameNode` are required in this step.

---

## Acceptance Criteria

1. TypeScript compiles with no errors.
2. The existing `renameNode link-update banner (EC-18)` tests in
   `file-browser.test.ts` (lines 1622–1735) all continue to pass — those tests
   rename from `"old-note"` to `"new-note"` so `oldStem !== stem` holds and the
   banner still appears.
3. The new EC-04 test added in step_03 passes: after a rename where `oldStem ===
   newStem`, no `.file-browser-link-banner` element appears in the container.

---

## Files Touched

- `src/plugins/file-browser/file-browser-ops.ts`
