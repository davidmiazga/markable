---
title: "Step 02 — Pure Markdown Logic"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 02 — Pure Markdown Logic

## What to Build

Port sections 5–8 of `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (the
original file) verbatim into the unified file. These are pure functions with no CM6
runtime dependency — they operate on plain strings and character arrays only.

After this step the unified file contains the complete formatting logic for the markdown
sub-toolbar.

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (the unified file being built)

Append these sections immediately after section 4 (CSS lifecycle helpers).

---

## Precise Specification

### Section 5 — Format registry and `detectFormats` / `isUrlLike`

Copy verbatim from the original `markdown-toolbar.plugin.ts` sections 5–6. Preserve:
- The `FormatId` union type
- The `FormatFlags` interface
- The `FORMATS` constant (10 entries, one per button)
- The `detectFormats` function (pure, operates on text + cursor offset)
- The `isUrlLike` function

No changes to any logic, types, or comments except:
- Update the section header comment to read `── 5. Format registry ──` (matching AD-2
  section numbering in `00_index.md`).

Exports required (for test file compatibility):
```typescript
export type { FormatId, FormatFlags };
export { FORMATS, detectFormats, isUrlLike };
```

### Section 6 — Pure format functions

Copy verbatim from the original `markdown-toolbar.plugin.ts` section 7:
- `computeWrap`
- `computeUnwrap`
- `computeErase`

Copy verbatim from the original `markdown-toolbar.plugin.ts` section 8:
- `resolveUrl` (async)

No changes to any logic. Update the section header comment to `── 6. Pure format
functions ──`.

Exports required:
```typescript
export { computeWrap, computeUnwrap, computeErase, resolveUrl };
```

---

## Acceptance Criteria

### AC-2.1 — All existing markdown-toolbar tests pass

Run:
```
npx vitest run tests/plugins/markdown-toolbar/markdown-toolbar.test.ts
```

All 679 lines of existing tests must pass. No test may be skipped. This validates that
the ported pure functions are bit-for-bit identical to the originals.

### AC-2.2 — detectFormats: bold detection
Pure function regression — a text `**hello**` with cursor inside reports `bold: true`.

### AC-2.3 — detectFormats: italic does not fire on bullet lists (H-1 regression)
A line `* item` with cursor at position 2 reports `italic: false`.

### AC-2.4 — computeWrap: single-range wrap
Given text `hello world`, selection `[6, 11]` ("world"), `computeWrap("**", "**")`
returns changes that produce `hello **world**`.

### AC-2.5 — computeUnwrap: removes markers
Given text `**hello**`, selection `[0, 9]`, `computeUnwrap("**", "**")` returns changes
that produce `hello`.

### AC-2.6 — computeErase: clears all active formats in range
Given `**_hello_**`, `computeErase` with the full range removes all markers.

### AC-2.7 — isUrlLike recognises https URLs
`isUrlLike("https://example.com")` returns `true`.

### AC-2.8 — isUrlLike rejects plain words
`isUrlLike("hello")` returns `false`.

---

## Risks and Dependencies

- **Risk**: Silently changing a regex or boundary condition while reformatting. Mitigation:
  copy the function body character-for-character; the full existing test suite (AC-2.1)
  is the regression guard.
- **Dependency**: Step 01 must be complete and passing before this step begins. The module-
  level state variables declared in step 01 are referenced by functions added in steps 07+.
- **No test file changes**: The existing `markdown-toolbar.test.ts` imports from the same
  path (`../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin`). As long as the
  exports are preserved, those tests will find them without modification.
