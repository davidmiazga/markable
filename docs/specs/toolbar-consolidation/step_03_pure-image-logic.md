---
title: "Step 03 — Pure Image Logic"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 03 — Pure Image Logic

## What to Build

Port sections 5–12 of `src/plugins/image-toolbar/image-toolbar.plugin.ts` verbatim into
the unified file. These are pure functions (no CM6 runtime dependency) plus the
`ImageContext` type and alignment state types.

After this step the unified file contains the complete image manipulation logic.

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (unified)

Append after section 6 (pure markdown functions).

---

## Precise Specification

### Section 7 — Image types and pure image functions

Copy verbatim from the original `image-toolbar.plugin.ts` sections 5–12:

**Types:**
- `AlignmentState` union
- `ImageContext` interface

**Pure detection functions:**
- `parseImageSyntax(line: string): ImageContext | null`
- `detectDivWrapper(doc, lineNumber): { start: number; end: number } | null`
- `detectFloatRight(line: string): boolean`
- `detectAlignment(lines, lineNumber, imgCtx): AlignmentState`
- `extractImageCore(line: string): string`

**Pure construction functions:**
- `buildBareImage(alt: string, src: string): string`
- `wrapWithDiv(align: string, content: string, lineEnding: string): string`
- `buildFloatRightImg(alt: string, src: string): string`
- `detectLineEnding(doc): "\r\n" | "\n"` — note: the table-toolbar also exports a
  function named `detectLineEnding`. They are identical implementations. In the unified
  file, define it ONCE in this section (section 7) and reference it from table operations
  in section 8. Do NOT duplicate it.
- `applyAlignment(state, ctx, newAlign, lineEnding): string`

**Source manipulation functions:**
- `replaceImageSrc(line: string, newSrc: string): string`
- `resolveRelativePath(src: string, currentFile: string | null): string`

Update the section header comment to `── 7. Pure image logic ──`.

Exports required (for test file compatibility — must match what
`image-toolbar.test.ts` currently imports):
```typescript
export type { AlignmentState, ImageContext };
export {
  parseImageSyntax,
  detectDivWrapper,
  detectFloatRight,
  detectAlignment,
  extractImageCore,
  buildBareImage,
  wrapWithDiv,
  buildFloatRightImg,
  detectLineEnding,
  applyAlignment,
  replaceImageSrc,
  resolveRelativePath,
};
```

**`detectLineEnding` deduplication note**: The table-toolbar's `detectLineEnding` and the
image-toolbar's `detectLineEnding` are functionally identical (both inspect `doc.lineAt(1).text`
for `\r\n`). Define the function once here in section 7 and import it by reference in
section 8. The export stays in section 7 only (single export point).

---

## Acceptance Criteria

### AC-3.1 — All existing image-toolbar tests pass with updated import path

After step_09 the image-toolbar tests will be migrated. For now, verify by running the
original test file against the unified source directly (create a temporary alias or update
the import path to the unified file). Every test in `tests/plugins/image-toolbar/image-toolbar.test.ts`
must pass when its import is changed to:
```typescript
from "../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin"
```

This is the pre-migration smoke test. The test file itself is NOT modified yet (that
happens in step_09).

### AC-3.2 — parseImageSyntax: standard image
`parseImageSyntax("![alt](https://example.com/img.png)")` returns an object with
`altText: "alt"`, `src: "https://example.com/img.png"`.

### AC-3.3 — parseImageSyntax: null on non-image line
`parseImageSyntax("just some text")` returns `null`.

### AC-3.4 — Two images on same line (EC-21)
`parseImageSyntax("![a](x.png) and ![b](y.png)")` returns the first image's context
(existing behaviour preserved).

### AC-3.5 — detectAlignment: left-aligned div wrapper
A document with `<div align="left">![alt](img.png)</div>` around the image line is
recognised as `AlignmentState = "left"`.

### AC-3.6 — applyAlignment: produces CRLF-safe output (EC-29)
When `detectLineEnding` returns `"\r\n"`, `applyAlignment` produces `<div>` wrappers
with `\r\n` line endings. No mixed endings.

### AC-3.7 — Tauri dialog cancelled (EC-27)
`replaceImageSrc` called with an empty string (`""`) from a cancelled dialog returns
the original line unchanged. This is validated by confirming no dispatch is emitted
when `newSrc === ""`.

### AC-3.8 — window.__TAURI_DIALOG__ undefined (EC-28)
The `choose-file` action path guards on `window.__TAURI_DIALOG__` being truthy before
calling it. When undefined, a `console.warn` is emitted and no crash occurs. (Note:
the guard logic lives in step_08 / handleAction, but the pure function `resolveRelativePath`
must not itself call `__TAURI_DIALOG__`.)

### AC-3.9 — detectLineEnding: single definition
`grep -n "detectLineEnding" src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts`
returns exactly ONE function definition and zero duplicate definitions.

---

## Risks and Dependencies

- **Risk**: `detectLineEnding` name collision between the two originals. Mitigation:
  define once in section 7; in section 8 reference the same function by name (no
  re-declaration). The compiler will catch any duplicate `function` declaration.
- **Risk**: `ImageContext` is referenced as a type in module-level state (section 3)
  before it is defined (section 7). TypeScript handles forward references for types
  without issue; the `let currentImageContext: ImageContext | null = null` declaration
  is annotated with a comment pointing to section 7.
- **Dependency**: Step 02 must be complete. Section 7 appends after section 6; the file
  must already compile cleanly with sections 1–6.
