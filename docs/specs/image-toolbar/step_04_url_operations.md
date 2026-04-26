---
title: "Image Toolbar — Step 04: Pure URL Operations"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 04 — Pure URL Operations

**Depends on:** step_02 (`extractImageCore`), step_03 (`buildBareImage`, `wrapWithDiv`, `buildFloatRightImg`)
**Adds to:** `src/plugins/image-toolbar/image-toolbar.plugin.ts` sections 16–17
**Tests:** `tests/plugins/image-toolbar/image-toolbar.test.ts` — `describe("step_04 — URL operations", ...)`

All functions in this step are pure: they take strings and return strings. No I/O, no DOM, no CM6.

---

## Functions to implement

### `replaceImageSrc(rawSource: string, newUrl: string): string`

Replace only the URL portion of the image region with `newUrl`, preserving all other attributes (alt text, alignment wrapper, float style).

```typescript
export function replaceImageSrc(rawSource: string, newUrl: string): string
```

Algorithm:

1. `const { url: oldUrl, alt } = extractImageCore(rawSource)`.
2. If `oldUrl === ""` and `rawSource` does not contain a recognisable image form, return `rawSource` unchanged (graceful no-op).
3. Replace `oldUrl` with `newUrl` in `rawSource`:
   - For bare `![alt](url)` form: replace the URL inside `(...)` using a targeted string replace, not a global regex, so only the URL portion changes.
   - For `<div align="...">![alt](url)</div>` form: same — only the `(url)` inside the inner image syntax.
   - For `<img src="oldUrl" ...>` form: replace `src="oldUrl"` with `src="newUrl"`.
4. Return the modified string.

**Implementation strategy:** Use `rawSource.replace(oldUrl, newUrl)` only if `oldUrl` is non-empty and appears exactly once in `rawSource`. If `oldUrl` appears more than once (rare), replace only the first occurrence. If `oldUrl` is empty string and `rawSource` is `"![]()"`  or `'<img src="" ...>'`, construct the output fresh using `buildBareImage`, `wrapWithDiv`, or `buildFloatRightImg` with the `newUrl`.

**Simpler alternative (preferred):** Fully reconstruct the output form rather than string-replace. This avoids substring collision bugs:

1. Detect the current alignment from `detectAlignment(rawSource)`.
2. `const { alt } = extractImageCore(rawSource)`.
3. `const le = detectLineEnding(rawSource)`.
4. Switch on alignment:
   - `"left"`: return `buildBareImage(alt, newUrl)`.
   - `"center"`: return `wrapWithDiv(alt, newUrl, "center", le)`.
   - `"right"`: return `wrapWithDiv(alt, newUrl, "right", le)`.
   - `"float-right"`: return `buildFloatRightImg(alt, newUrl)`.

This reconstruction approach is preferred because it guarantees NFR-5 (alt verbatim, alignment preserved) and handles the empty-url edge case (EC-10) cleanly.

```typescript
export function replaceImageSrc(rawSource: string, newUrl: string): string
```

Rules:
- Alt text is preserved verbatim (NFR-5, EC-26).
- Alignment wrapper is preserved.
- `newUrl` is used verbatim — no URL-encoding (EC-31, NFR-5).
- If `rawSource` cannot be parsed (no recognisable image form), return `rawSource` unchanged.

### `resolveRelativePath(selectedAbsPath: string, docPath: string | null): string`

Convert `selectedAbsPath` to a path relative to `docPath`'s directory, when possible.

```typescript
export function resolveRelativePath(
  selectedAbsPath: string,
  docPath: string | null,
): string
```

Algorithm:

1. If `docPath` is null or empty: return `selectedAbsPath` as-is (EC-8 — untitled document).
2. `const docDir = dirname(docPath)` — compute using string manipulation (split on `/`, remove last segment, rejoin). Do not import `path` — this is pure string manipulation for the plugin sandbox.
3. Check if `selectedAbsPath` starts with `docDir + "/"`. If not: return `selectedAbsPath` as-is (EC-7 — file is outside document directory).
4. Return the relative suffix: `selectedAbsPath.slice(docDir.length + 1)`.
   - This gives a plain relative path (no `./` prefix). If the file is in a subdirectory, it includes the subdirectory: `images/photo.png`.
   - Prepend `./` to make the relative path unambiguous: return `"./" + selectedAbsPath.slice(docDir.length + 1)`.
5. EC-6: file in same directory → returns `"./photo.png"`.

**`dirname` helper (internal, not exported):**

```typescript
function _dirname(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/") || "/";
}
```

Rules:
- macOS paths use `/` separator. No Windows path support required for v1.0.
- Path is returned verbatim — spaces and Unicode characters are preserved (EC-31).
- No URL-encoding applied.

---

## Tests for step_04

### `replaceImageSrc`

| # | rawSource | newUrl | Expected output |
|---|---|---|---|
| 4.1 | `"![photo](old.png)"` | `"new.png"` | `"![photo](new.png)"` |
| 4.2 | `"![photo](old.png)"` | `"https://example.com/img.png"` | `"![photo](https://example.com/img.png)"` |
| 4.3 | `'<div align="center">![photo](old.png)</div>'` | `"new.png"` | `'<div align="center">![photo](new.png)</div>'` |
| 4.4 | `'<div align="right">![photo](old.png)</div>'` | `"new.png"` | `'<div align="right">![photo](new.png)</div>'` |
| 4.5 | `'<img src="old.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` | `"new.png"` | `'<img src="new.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` |
| 4.6 | `"![]()"`  | `"new.png"` | `"![](new.png)"` (EC-10 — empty alt preserved) |
| 4.7 | `'![alt with "quotes"](old.png)'` | `"new.png"` | `'![alt with "quotes"](new.png)'` (EC-26 — alt verbatim) |
| 4.8 | `"not an image"` | `"new.png"` | `"not an image"` (unrecognised — unchanged) |
| 4.9 | `"![photo](path with spaces.png)"` | `"new path.png"` | `"![photo](new path.png)"` (EC-31 — no encoding) |

### `resolveRelativePath`

| # | selectedAbsPath | docPath | Expected |
|---|---|---|---|
| 4.10 | `"/Users/dm/Notes/images/cat.png"` | `"/Users/dm/Notes/doc.md"` | `"./images/cat.png"` (EC-6) |
| 4.11 | `"/Users/dm/Notes/cat.png"` | `"/Users/dm/Notes/doc.md"` | `"./cat.png"` (EC-6 — same dir) |
| 4.12 | `"/Users/dm/Other/cat.png"` | `"/Users/dm/Notes/doc.md"` | `"/Users/dm/Other/cat.png"` (EC-7 — outside dir) |
| 4.13 | `"/Users/dm/Notes/cat.png"` | `null` | `"/Users/dm/Notes/cat.png"` (EC-8 — untitled) |
| 4.14 | `"/Users/dm/Notes/cat.png"` | `""` | `"/Users/dm/Notes/cat.png"` (empty string = untitled) |
| 4.15 | `"/Users/dm/Notes/sub/deep/cat.png"` | `"/Users/dm/Notes/doc.md"` | `"./sub/deep/cat.png"` (EC-6 — nested subdir) |
| 4.16 | `"/path/with spaces/img.png"` | `"/path/with spaces/doc.md"` | `"./img.png"` (EC-31 — spaces preserved) |
| 4.17 | `"/path/café/img.png"` | `"/path/café/doc.md"` | `"./img.png"` (EC-31 — Unicode preserved) |

---

## Acceptance Criteria for Step 04

- [ ] All 17 test cases pass
- [ ] `replaceImageSrc` never throws regardless of input
- [ ] Alt text and alignment are preserved exactly in `replaceImageSrc` output
- [ ] No URL-encoding applied in `replaceImageSrc` or `resolveRelativePath`
- [ ] `resolveRelativePath(path, null)` returns the absolute path unchanged (EC-8)
- [ ] `resolveRelativePath` returns a relative path only when `selectedAbsPath` is inside `docDir` (EC-6 vs EC-7)
