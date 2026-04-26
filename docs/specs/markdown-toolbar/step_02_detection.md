---
title: "Step 02 — Format Detection Engine"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 02 — Format Detection Engine

**Prerequisite:** step_01 complete and passing.
**Produces:** `detectFormats` pure function plus `FORMATS` registry; tests covering all 10 formats and all EC detection cases.

---

## Goal

Implement the canonical format registry (`FORMATS`) and the `detectFormats` pure function that reads a document string and a selection range, and returns a `FormatFlags` record indicating which formats are active. This is the only data source for active-state button highlighting (step_07) and the toggle decision in step_03.

No CM6 or DOM dependency in this step. All code is testable with plain strings.

---

## Files Modified

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Add: `FormatId`, `FormatDef`, `FormatFlags`, `FORMATS`, `detectFormats`, `isUrlLike` |
| `tests/markdown-toolbar.test.ts` | Add: detection test suite |

---

## Detailed Specification

### 1. Type definitions to add

```typescript
export type FormatId =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "inlineCode"
  | "superscript"
  | "link"
  | "image"
  | "erase";

export interface FormatDef {
  readonly id: FormatId;
  readonly label: string;
  readonly open?: string;        // opening marker (e.g. "**")
  readonly close?: string;       // closing marker; defaults to open when absent
  readonly isHtml?: true;        // true for <u>…</u>
  readonly isLink?: true;        // true for [text](url)
  readonly isImage?: true;       // true for ![alt](url)
}

export type FormatFlags = Record<FormatId, boolean>;
```

### 2. FORMATS registry

```typescript
export const FORMATS: readonly FormatDef[] = [
  { id: "bold",          label: "Bold",          open: "**" },
  { id: "italic",        label: "Italic",        open: "*" },
  { id: "underline",     label: "Underline",     open: "<u>",  close: "</u>", isHtml: true },
  { id: "strikethrough", label: "Strikethrough", open: "~~" },
  { id: "highlight",     label: "Highlight",     open: "==" },
  { id: "inlineCode",    label: "Inline Code",   open: "`" },
  { id: "superscript",   label: "Superscript",   open: "^" },
  { id: "link",          label: "Link",                               isLink: true },
  { id: "image",         label: "Image",                              isImage: true },
  { id: "erase",         label: "Erase Formatting" },
];
```

The `erase` entry has no markers. `detectFormats` always returns `false` for `erase`.

### 3. isUrlLike

```typescript
export function isUrlLike(s: string): boolean {
  return (
    s.startsWith("https://") ||
    s.startsWith("http://")  ||
    s.startsWith("ftp://")   ||
    s.startsWith("/")
  );
}
```

Exported for testability; used by `resolveUrl` in step_03.

### 4. detectFormats — full specification

```typescript
export function detectFormats(
  docText: string,
  from: number,
  to: number
): FormatFlags {
```

**Algorithm:**

```
CONTEXT_RADIUS = 64
ctxStart = Math.max(0, from - CONTEXT_RADIUS)
ctxEnd   = Math.min(docText.length, to + CONTEXT_RADIUS)
ctx      = docText.slice(ctxStart, ctxEnd)
localFrom = from - ctxStart
localTo   = to   - ctxStart
```

For each `FormatDef` in `FORMATS`:

**Case: `erase`** — always false.

**Case: `isLink === true`**
- Regex: `/\[([^\]]*)\]\(([^)]*)\)/g` applied to `ctx`.
- A match `m` indicates active if `ctxStart + m.index <= from` and `ctxStart + m.index + m[0].length >= to`.
- This means the selection is fully inside or overlapping the link syntax.

**Case: `isImage === true`**
- Regex: `/!\[([^\]]*)\]\(([^)]*)\)/g` applied to `ctx`.
- Same overlap test as link.

**Case: `isHtml === true` (underline)**
- Regex: `/<u>([\s\S]*?)<\/u>/g` applied to `ctx`.
- Same overlap test.

**Case: standard format (open/close markers)**
- `open = fmt.open!`, `close = fmt.close ?? fmt.open!`
- Check: does `open` appear anywhere in `ctx.slice(0, localFrom)` AND `close` appear anywhere in `ctx.slice(localTo)`?
- **Bold/italic disambiguation:** Bold uses `**`; italic uses `*`. When testing for italic (`*`), exclude positions where the character is part of `**`. Implementation: after finding `*` in the left context, verify the character before it is not also `*`, and the character after it (if within the string) is not also `*`. Equivalently, use negative lookahead/lookbehind or check that the match is not `**`:
  - Regex for italic open: `/(?<!\*)\*(?!\*)/` — a single `*` not preceded or followed by another `*`.
  - Regex for italic close: same.
- This prevents `**text**` from triggering the italic detection.

Return the `FormatFlags` object with one key per `FormatId`.

---

## Acceptance Criteria

### AC-2.1: Bold detection — cursor inside
`detectFormats("**hello**", 2, 2).bold === true`
(cursor at position 2, inside `**hello**`)

### AC-2.2: Bold detection — cursor outside
`detectFormats("**hello**", 0, 0).bold === false`
(cursor before the opening `**`)

### AC-2.3: Italic detection — cursor inside
`detectFormats("*hello*", 1, 1).italic === true`

### AC-2.4: Italic not triggered inside bold
`detectFormats("**hello**", 2, 7).italic === false`
(selection spans `hello` inside bold; italic must not fire on `**`)

### AC-2.5: Bold AND italic — both active simultaneously (EC-3)
`doc = "***hello***"`: `detectFormats(doc, 3, 8)` → `bold: true, italic: true`

### AC-2.6: Nested italic inside bold (EC-4)
`doc = "**_nested_**"`: `detectFormats(doc, 3, 9)` → `bold: true` (the `_` variant is not in our format list, so italic may be false — this is acceptable; the requirement only specifies `*` markers).

### AC-2.7: Underline detection
`detectFormats("<u>hello</u>", 3, 8).underline === true`

### AC-2.8: Strikethrough detection
`detectFormats("~~hello~~", 2, 7).strikethrough === true`

### AC-2.9: Highlight detection
`detectFormats("==hello==", 2, 7).highlight === true`

### AC-2.10: Inline code detection
`detectFormats("\`hello\`", 1, 6).inlineCode === true`

### AC-2.11: Superscript detection
`detectFormats("^hello^", 1, 6).superscript === true`

### AC-2.12: Link detection
`detectFormats("[text](https://example.com)", 1, 5).link === true`

### AC-2.13: Image detection
`detectFormats("![alt](https://img.com/x.png)", 2, 5).image === true`

### AC-2.14: Erase is always false
`detectFormats("**hello**", 2, 7).erase === false`

### AC-2.15: Empty document returns all false
All flags in `detectFormats("", 0, 0)` are `false`.

### AC-2.16: Multi-line selection (EC-20)
```
doc = "Some text\n**bold across\nlines**\nMore text"
from = 10 (start of **)
to = 30   (end of **)
detectFormats(doc, from, to).bold === true
```

### AC-2.17: isUrlLike
- `isUrlLike("https://example.com")` → `true`
- `isUrlLike("http://x.com")` → `true`
- `isUrlLike("ftp://files.com")` → `true`
- `isUrlLike("/relative/path")` → `true`
- `isUrlLike("example.com")` → `false`
- `isUrlLike("")` → `false`
- `isUrlLike("not a url")` → `false`

### AC-2.18: detectFormats is a pure function
Calling twice with the same arguments returns equal objects. First call does not mutate `docText`.

---

## Notes for the Developer

**Bold/italic disambiguation is critical.** The italic detector must not fire for text wrapped in `**`. Use the negative lookahead regex `/(?<!\*)\*(?!\*)/` to match a lone `*`. Test this thoroughly with AC-2.4.

**Context window rationale.** The `CONTEXT_RADIUS = 64` window is sufficient for all standard inline format markers which are at most a few characters wide. A very long link URL could in theory exceed 64 characters, causing the closing `)` to fall outside the window. If the URL portion is longer than 64 characters, the detection simply returns `false` — this is an acceptable false-negative for an uncommon case. Do not increase the radius to the full document length; that would make the function O(document size) instead of O(1).

**Do not use `syntaxTree`.** Detection is text-based, not AST-based. This keeps the function independent of the CM6 language extension and testable with plain strings.

**`FORMATS` is the single source of truth** for button order (step_04 iterates `FORMATS` to build the DOM), for detection (this step), and for wrap/unwrap dispatch (step_03). Never hardcode a format list anywhere else.
