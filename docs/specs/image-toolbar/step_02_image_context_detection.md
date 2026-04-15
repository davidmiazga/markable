---
title: "Image Toolbar — Step 02: Pure Image Context Detection"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 02 — Pure Image Context Detection

**Depends on:** step_01 (file skeleton exists; `ImageContext` type introduced here)
**Adds to:** `src/plugins/image-toolbar/image-toolbar.plugin.ts` sections 6–10
**Tests:** `tests/plugins/image-toolbar/image-toolbar.test.ts` — `describe("step_02 — context detection", ...)`

All functions in this step are pure: they take strings or simple value types and return new values. No DOM access, no CM6 API calls, no module-level state mutation. Fully testable with plain inputs.

---

## Types to introduce

### `AlignmentState`

```typescript
export type AlignmentState = "left" | "center" | "right" | "float-right";
```

### `ImageContext` (AD-4)

```typescript
export interface ImageContext {
  from: number;           // document position of region start (inclusive)
  to: number;             // document position of region end (exclusive)
  rawSource: string;      // raw Markdown/HTML text of the full image region
  url: string;            // extracted URL (Markdown src, not resolved asset URL)
  alt: string;            // extracted alt text verbatim
  alignment: AlignmentState;
  anchorEl: HTMLElement;  // populated by the caller; not set by pure functions
}
```

---

## Functions to implement

### `parseImageSyntax(text: string): { url: string; alt: string } | null`

Parse `![alt](url)` from raw text. Return `null` if the text does not match.

Rules:
- Pattern: `/^!\[([^\]]*)\]\(([^)]*)\)$/` applied to `text.trim()`.
- `alt` = capture group 1 (may be empty — EC-10).
- `url` = capture group 2 (may be empty — EC-10).
- If no match: return `null`.
- Alt text is returned verbatim — no trimming, no unescaping (EC-26, NFR-5).

```typescript
export function parseImageSyntax(text: string): { url: string; alt: string } | null
```

### `detectDivWrapper(lineText: string, nextLineText: string | null): { align: "center" | "right"; innerText: string } | null`

Detect the `<div align="...">![alt](url)</div>` two-line form.

Rules:
- `lineText` is the full text of the candidate first line.
- `nextLineText` is the text of the following line (null if there is no following line).
- Pattern for `lineText`: `/^<div\s+align="(center|right)">(.*)<\/div>$/i`
  - If the pattern matches on a single line (open and close tag on same line), return `{ align, innerText: capture2 }`.
- Pattern for two-line form:
  - `lineText` matches `/^<div\s+align="(center|right)">(.*)$/i` (no `</div>` on same line)
  - `nextLineText` is not null and matches `/^(.*)<\/div>$/i`
  - `innerText` = `capture2_from_line1 + "\n" + capture1_from_nextLine` (or with `\r\n` if the document uses CRLF — but for this pure function accept the raw strings; the caller has already split on the document's line ending).
- If neither form matches: return `null`.

```typescript
export function detectDivWrapper(
  lineText: string,
  nextLineText: string | null,
): { align: "center" | "right"; innerText: string } | null
```

### `detectFloatRight(lineText: string): boolean`

Return `true` if `lineText` (trimmed) matches the float-right `<img>` form.

Rules:
- Pattern: `/^<img\b[^>]*\balign="right"[^>]*>/i`
- `lineText` is tested after `.trim()`.

```typescript
export function detectFloatRight(lineText: string): boolean
```

### `detectAlignment(rawSource: string): AlignmentState`

Classify the alignment state of a raw image region string.

Rules (applied in order — first match wins):

1. If `rawSource` matches `/^<div\s+align="center">/i` → return `"center"`.
2. If `rawSource` matches `/^<div\s+align="right">/i` → return `"right"`.
3. If `detectFloatRight(rawSource.trim())` returns `true` → return `"float-right"`.
4. Otherwise → return `"left"` (bare `![alt](url)`, `<div align="left">`, or unrecognised form).

```typescript
export function detectAlignment(rawSource: string): AlignmentState
```

### `extractImageCore(rawSource: string): { url: string; alt: string }`

Extract the `url` and `alt` from any supported image form. Must not crash on any input — return empty strings as fallback.

Algorithm:

1. Try `parseImageSyntax(rawSource.trim())` — matches bare `![alt](url)` form. If match: return result.
2. Try matching `<div align="...">![alt](url)</div>` — extract the inner `![alt](url)` part via the pattern `/!\[([^\]]*)\]\(([^)]*)\)/` applied to `rawSource`. If match: return `{ alt: g1, url: g2 }`.
3. Try matching the float-right `<img>` form via the pattern `/<img\b[^>]*\bsrc="([^"]*)"[^>]*\balt="([^"]*)"[^>]*>/i`. If match: return `{ url: g1, alt: g2 }`.
   - Also try the reverse attribute order `alt` before `src`:  `/<img\b[^>]*\balt="([^"]*)"[^>]*\bsrc="([^"]*)"[^>]*>/i`.
4. Fallback: return `{ url: "", alt: "" }`.

```typescript
export function extractImageCore(rawSource: string): { url: string; alt: string }
```

---

## `detectImageRegion` (CM6-dependent — not exported for unit tests)

This function lives in section 18 of the plugin and is called by both the `updateListener` and the click-delegation handler. It requires a live CM6 `EditorState` and the `syntaxTree` function from `window.__CM_STATE__`. It is described here for completeness but tested only through integration in step_06/07.

```typescript
function detectImageRegion(
  state: EditorStateType,
  pos: number,
): Omit<ImageContext, "anchorEl"> | null
```

Algorithm:

1. `const { syntaxTree } = getCmState()`. If `getCmState()` is undefined: return `null` and log error.
2. `const tree = syntaxTree(state)`.
3. `let node = tree.resolveInner(pos, 1)`. Walk up via `node = node.parent` until `node.name === "Image"` or `node === null`.
4. If no `Image` node found: return `null`.
5. `const lineObj = state.doc.lineAt(node.from)`.
6. `const lineText = lineObj.text`.
7. Determine if there is a next line: `const hasNext = node.from + lineText.length < state.doc.length`.
8. `const nextLineText = hasNext ? state.doc.lineAt(lineObj.to + 1).text : null`.
9. Call `detectDivWrapper(lineText, nextLineText)`:
   - If match (two-line form): `from = lineObj.from`, `to = state.doc.lineAt(lineObj.to + 1).to`.
   - If match (single-line form): `from = lineObj.from`, `to = lineObj.to`.
10. If no div wrapper: check `detectFloatRight(lineText)`:
    - If true: `from = lineObj.from`, `to = lineObj.to`.
11. If neither: `from = node.from`, `to = node.to`.
12. `rawSource = state.doc.sliceString(from, to)`.
13. `const { url, alt } = extractImageCore(rawSource)`.
14. `const alignment = detectAlignment(rawSource)`.
15. Return `{ from, to, rawSource, url, alt, alignment }`.

---

## Tests for step_02

### `parseImageSyntax`

| # | Input | Expected output |
|---|---|---|
| 2.1 | `"![photo](./images/cat.png)"` | `{ url: "./images/cat.png", alt: "photo" }` |
| 2.2 | `"![]()"`  | `{ url: "", alt: "" }` (EC-10) |
| 2.3 | `"![alt with spaces](url with spaces)"` | `{ url: "url with spaces", alt: "alt with spaces" }` |
| 2.4 | `"not an image"` | `null` |
| 2.5 | `"![alt](url) extra text"` | `null` (not a pure image syntax) |
| 2.6 | `'![quote"alt"](url)'` | `{ url: "url", alt: 'quote"alt"' }` (EC-26 — verbatim) |
| 2.7 | `"![bracket\\]alt](url)"` | `null` (bracket in alt breaks pattern — document as known edge case) |

### `detectDivWrapper`

| # | lineText | nextLineText | Expected |
|---|---|---|---|
| 2.8 | `'<div align="center">![a](b)</div>'` | `null` | `{ align: "center", innerText: "![a](b)" }` |
| 2.9 | `'<div align="right">![a](b)'` | `'</div>'` | `{ align: "right", innerText: "![a](b)\n</div>" }` — wait, re-read spec: innerText for two-line form = the content between tags. Clarification: `innerText = "![a](b)"` (content before `</div>`). |
| 2.10 | `'<div align="center">![a](b)'` | `'![x](y)</div>'` | `{ align: "center", innerText: "![a](b)\n![x](y)" }` |
| 2.11 | `'<div align="left">![a](b)</div>'` | `null` | `null` — only "center" and "right" are recognised |
| 2.12 | `"![a](b)"` | `null` | `null` |
| 2.13 | `'<div align="CENTER">![a](b)</div>'` | `null` | `{ align: "center", ... }` (case-insensitive match) |

**Clarification on two-line `innerText`:** For the two-line form `<div align="right">![a](b)` / `</div>`, the inner content of the first line is `"![a](b)"` and the next line before `</div>` is empty string. Return `innerText = "![a](b)"`.

### `detectFloatRight`

| # | Input | Expected |
|---|---|---|
| 2.14 | `'<img src="a.png" alt="x" align="right" style="float:right; margin:0 0 8px 16px">'` | `true` |
| 2.15 | `'<img src="a.png" alt="x">'` | `false` (no `align="right"`) |
| 2.16 | `"![a](b)"` | `false` |
| 2.17 | `'<img align="RIGHT" src="a.png">'` | `true` (case-insensitive) |
| 2.18 | `'  <img src="a.png" align="right">  '` | `true` (trimmed before test) |

### `detectAlignment`

| # | Input | Expected |
|---|---|---|
| 2.19 | `'<div align="center">![a](b)</div>'` | `"center"` (EC-2) |
| 2.20 | `'<div align="right">![a](b)</div>'` | `"right"` |
| 2.21 | `'<img src="a.png" alt="a" align="right" style="float:right; margin:0 0 8px 16px">'` | `"float-right"` (EC-3) |
| 2.22 | `"![a](b)"` | `"left"` |
| 2.23 | `'<div align="left">![a](b)</div>'` | `"left"` (unrecognised wrapper = left) |
| 2.24 | `""` | `"left"` (fallback — no crash) |

### `extractImageCore`

| # | Input | Expected |
|---|---|---|
| 2.25 | `"![photo](./img/cat.png)"` | `{ url: "./img/cat.png", alt: "photo" }` |
| 2.26 | `'<div align="center">![photo](./img/cat.png)</div>'` | `{ url: "./img/cat.png", alt: "photo" }` |
| 2.27 | `'<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` | `{ url: "a.png", alt: "photo" }` |
| 2.28 | `'<img alt="photo" src="a.png">'` | `{ url: "a.png", alt: "photo" }` (alt before src) |
| 2.29 | `"![]()"`  | `{ url: "", alt: "" }` (EC-10) |
| 2.30 | `"not an image"` | `{ url: "", alt: "" }` (fallback — no crash) |
| 2.31 | `'![alt with "quotes"](url)'` | `{ url: "url", alt: 'alt with "quotes"' }` (EC-26) |

---

## Acceptance Criteria for Step 02

- [ ] All 31 test cases pass
- [ ] No function imports from `@codemirror/*` or app-internal modules
- [ ] `extractImageCore("")` returns `{ url: "", alt: "" }` without throwing
- [ ] `detectAlignment` never throws regardless of input string
- [ ] `parseImageSyntax` returns verbatim alt and url without trimming or unescaping
