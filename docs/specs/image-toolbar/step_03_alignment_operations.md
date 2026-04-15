---
title: "Image Toolbar — Step 03: Pure Alignment Operations"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 03 — Pure Alignment Operations

**Depends on:** step_02 (`extractImageCore`, `AlignmentState`)
**Adds to:** `src/plugins/image-toolbar/image-toolbar.plugin.ts` sections 12–15
**Tests:** `tests/plugins/image-toolbar/image-toolbar.test.ts` — `describe("step_03 — alignment operations", ...)`

All functions in this step are pure: given a raw image source string and target alignment, return the new Markdown string to insert. No CM6 API calls, no DOM access.

---

## Functions to implement

### `buildBareImage(alt: string, url: string): string`

Return the bare `![alt](url)` form.

```typescript
export function buildBareImage(alt: string, url: string): string {
  return `![${alt}](${url})`;
}
```

Rules:
- Alt and url are inserted verbatim — no escaping (NFR-5, EC-26).
- Works correctly when alt or url is empty string (EC-10).

### `wrapWithDiv(alt: string, url: string, align: "center" | "right", lineEnding: string): string`

Return the two-line `<div>` wrapper form. `lineEnding` is `"\n"` or `"\r\n"` (EC-22).

```typescript
export function wrapWithDiv(
  alt: string,
  url: string,
  align: "center" | "right",
  lineEnding: string,
): string {
  return `<div align="${align}">![${alt}](${url})</div>`;
}
```

Rules:
- The output is a single-line form: `<div align="...">![alt](url)</div>`. This is a valid single-line form that many Markdown renderers accept. The `lineEnding` parameter is accepted for API compatibility but a single-line `<div>` form is used (no embedded newline in the output).
- **Rationale:** FR-3a specifies the written form as `<div align="center">![alt](url)</div>`. Treating this as a single line avoids the complexity of CRLF detection for the insertion string while remaining semantically correct. The `lineEnding` parameter is reserved for a future multi-line variant and currently unused.
- If the spec requires a two-line form (i.e. `<div ...>\n![alt](url)\n</div>`), the developer must update this function and the region detection in step_02 to match.

### `buildFloatRightImg(alt: string, url: string): string`

Return the float-right inline HTML form.

```typescript
export function buildFloatRightImg(alt: string, url: string): string {
  return `<img src="${url}" alt="${alt}" align="right" style="float:right; margin:0 0 8px 16px">`;
}
```

Rules:
- Attribute order: `src`, `alt`, `align`, `style` — exactly as specified in FR-3a.
- Alt and url inserted verbatim (NFR-5, EC-26).

### `detectLineEnding(rawSource: string): string`

Detect the line ending used in `rawSource`. Returns `"\r\n"` if found, else `"\n"`.

```typescript
export function detectLineEnding(rawSource: string): string {
  return rawSource.includes("\r\n") ? "\r\n" : "\n";
}
```

This function is used by `applyAlignment` to pass the correct line ending to `wrapWithDiv` (EC-22, EC-27).

### `applyAlignment(rawSource: string, alignment: AlignmentState): string`

The master alignment operation. Takes the current raw source text of the image region and the desired alignment, and returns the new string to insert.

```typescript
export function applyAlignment(rawSource: string, alignment: AlignmentState): string
```

Algorithm:

1. `const { url, alt } = extractImageCore(rawSource)`.
2. `const le = detectLineEnding(rawSource)`.
3. Switch on `alignment`:
   - `"left"`: return `buildBareImage(alt, url)`.
   - `"center"`: return `wrapWithDiv(alt, url, "center", le)`.
   - `"right"`: return `wrapWithDiv(alt, url, "right", le)`.
   - `"float-right"`: return `buildFloatRightImg(alt, url)`.

Rules:
- Single-function entry point — all alignment button clicks route through here.
- Dispatching the result is the caller's responsibility (step_07).
- EC-5: calling `applyAlignment(rawSource, "left")` where `rawSource` is already bare produces `"![alt](url)"` — an idempotent write is acceptable. The operation always dispatches.
- EC-4: calling `applyAlignment(floatRightImgSource, "center")` extracts alt and url from the `<img>` form and rewrites as `<div align="center">...</div>` — correct.
- EC-3: calling `applyAlignment(floatRightImgSource, "left")` produces bare `![alt](url)`.

---

## Tests for step_03

### `buildBareImage`

| # | Input | Expected |
|---|---|---|
| 3.1 | `("photo", "./img/cat.png")` | `"![photo](./img/cat.png)"` |
| 3.2 | `("", "")` | `"![]()"`  (EC-10) |
| 3.3 | `('alt with "quotes"', "url")` | `'![alt with "quotes"](url)'` (EC-26 — verbatim) |

### `wrapWithDiv`

| # | Input | Expected |
|---|---|---|
| 3.4 | `("photo", "a.png", "center", "\n")` | `'<div align="center">![photo](a.png)</div>'` |
| 3.5 | `("photo", "a.png", "right", "\n")` | `'<div align="right">![photo](a.png)</div>'` |
| 3.6 | `("", "", "center", "\n")` | `'<div align="center">![]()}</div>'` — wait: `'<div align="center">![]()</div>'` (EC-10) |
| 3.7 | `('alt"quote"', "a.png", "center", "\n")` | `'<div align="center">![alt"quote"](a.png)</div>'` (EC-26 — verbatim) |

### `buildFloatRightImg`

| # | Input | Expected |
|---|---|---|
| 3.8 | `("photo", "a.png")` | `'<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` |
| 3.9 | `("", "")` | `'<img src="" alt="" align="right" style="float:right; margin:0 0 8px 16px">'` (EC-10) |

### `detectLineEnding`

| # | Input | Expected |
|---|---|---|
| 3.10 | `"![a](b)"` | `"\n"` |
| 3.11 | `"<div align=\"center\">![a](b)\r\n</div>"` | `"\r\n"` (EC-22) |
| 3.12 | `""` | `"\n"` (fallback) |

### `applyAlignment`

| # | rawSource | alignment | Expected output |
|---|---|---|---|
| 3.13 | `"![photo](a.png)"` | `"left"` | `"![photo](a.png)"` (EC-5 — idempotent) |
| 3.14 | `"![photo](a.png)"` | `"center"` | `'<div align="center">![photo](a.png)</div>'` |
| 3.15 | `"![photo](a.png)"` | `"right"` | `'<div align="right">![photo](a.png)</div>'` |
| 3.16 | `"![photo](a.png)"` | `"float-right"` | `'<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` |
| 3.17 | `'<div align="center">![photo](a.png)</div>'` | `"left"` | `"![photo](a.png)"` (EC-1 — removes wrapper) |
| 3.18 | `'<div align="right">![photo](a.png)</div>'` | `"center"` | `'<div align="center">![photo](a.png)</div>'` |
| 3.19 | `'<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` | `"left"` | `"![photo](a.png)"` (EC-3) |
| 3.20 | `'<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` | `"center"` | `'<div align="center">![photo](a.png)</div>'` (EC-4) |
| 3.21 | `"![]()"`  | `"center"` | `'<div align="center">![]()</div>'` (EC-10 — empty url/alt) |
| 3.22 | `'![alt with "quotes"](url)'` | `"center"` | `'<div align="center">![alt with "quotes"](url)</div>'` (EC-26) |
| 3.23 | `'<div align="right">![photo](a.png)</div>'` | `"float-right"` | `'<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` |

---

## Acceptance Criteria for Step 03

- [ ] All 23 test cases pass
- [ ] `applyAlignment` never throws regardless of malformed input (returns a string, possibly with empty alt/url)
- [ ] Alt and url are passed verbatim through all write functions — no trimming, encoding, or escaping
- [ ] `applyAlignment("![a](b)", "left")` returns `"![a](b)"` (idempotent — EC-5)
- [ ] Float-right → left and float-right → center conversions produce correct output (EC-3, EC-4)
