---
title: "Step 3: Wiki-Link Regex + Pure Link Extraction"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 3: Wiki-Link Regex + Pure Link Extraction

## Goal

Implement the pure (zero DOM/CM6 dependency) functions for wiki-link parsing, outgoing link extraction, and target normalization. These functions are the testable core of the entire backlinks feature and are exported from the plugin file for direct test imports.

## Acceptance Criteria

1. `WIKI_LINK_RE` regex matches `[[target]]` and `[[target|display text]]` correctly.
2. `parseWikiLinks(text)` returns all wiki-link matches with `from`, `to`, `target`, and `displayText` fields.
3. `extractOutgoingLinks(content)` returns all outgoing link targets from a document (both wiki-links and standard `[text](target.md)` links).
4. `normalizeTarget(target)` trims whitespace, strips leading `./`, and appends `.md` if no extension.
5. `resolveWikiLinkPath(currentFilePath, target)` returns the absolute path to the target file.
6. All functions are pure -- no window globals, no DOM, no CM6 imports at call time.

## Functions to Implement

All functions live in `src/plugins/backlinks/backlinks.plugin.ts` and are exported for testing.

### `WIKI_LINK_RE` (Regex Constant)

```typescript
/**
 * Regex for wiki-link syntax: [[target]] or [[target|display text]].
 *
 * Rules (FR-1.2):
 * - Opening: exactly [[ (two left brackets)
 * - Closing: exactly ]] (two right brackets)
 * - Content must not contain [[, ]], or newlines
 * - Pipe separates target from display text (first pipe only)
 * - Global flag for multiple matches per line
 *
 * Capture groups:
 *   match[0] = full match including [[ and ]]
 *   match[1] = content between [[ and ]] (target or target|display)
 *   match.index = start position in input string
 */
export const WIKI_LINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
```

### `parseWikiLinks(text: string): WikiLinkMatch[]`

```typescript
export interface WikiLinkMatch {
  /** Character offset of the opening [[ in the input text. */
  from: number;
  /** Character offset just after the closing ]]. */
  to: number;
  /** The target filename (before the pipe, if any). NOT normalized. */
  target: string;
  /** Display text (after the first pipe), or null if no pipe. */
  displayText: string | null;
}
```

Implementation:
1. Reset regex lastIndex to 0.
2. For each match, split `match[1]` on the first `|` to extract target and optional display text.
3. Return array of `WikiLinkMatch` objects.

### `normalizeTarget(target: string): string`

```typescript
/**
 * Normalize a link target for comparison and file resolution.
 *
 * Rules (FR-6.3):
 * 1. Trim whitespace.
 * 2. Strip leading "./" if present.
 * 3. Append ".md" if the target has no file extension.
 *
 * A target "has no extension" if it does not contain a "." after
 * the last "/" (or has no "/" and no "."). This avoids treating
 * "archive.tar" as extensionless.
 */
```

### `resolveWikiLinkPath(currentFilePath: string, target: string): string`

```typescript
/**
 * Resolve a wiki-link target to an absolute file path.
 *
 * Steps (FR-3.2):
 * 1. Normalize the target (trim, strip ./, append .md if needed).
 * 2. Extract the directory from currentFilePath.
 * 3. Return directory + "/" + normalizedTarget.
 *
 * @param currentFilePath  Absolute path to the current file.
 * @param target           Raw target string from the wiki-link.
 * @returns Absolute path to the target file.
 */
```

### `extractOutgoingLinks(content: string): string[]`

```typescript
/**
 * Extract all outgoing link targets from document content.
 *
 * Scans for:
 * 1. Wiki-links: [[target]] and [[target|display]] -- extracts target.
 * 2. Standard Markdown links: [text](target.md) -- extracts target
 *    (relative paths only; absolute paths and URLs are ignored per FR-6.2).
 *
 * All targets are normalized via normalizeTarget().
 * Duplicates are preserved (the index builder handles deduplication).
 *
 * @param content  Full document text.
 * @returns Array of normalized link target filenames.
 */
```

Standard Markdown link regex:
```typescript
const MD_LINK_RE = /\[(?:[^\[\]])*\]\(([^)]+)\)/g;
```

Filter rules for standard links:
- Skip if target starts with `http://`, `https://`, or `/` (FR-6.2: relative paths only).
- Skip if target starts with `#` (fragment-only links).
- Only include if normalized target ends with `.md`.

### `filenameFromPath(filePath: string): string`

```typescript
/**
 * Extract the filename from an absolute path.
 * "/Users/me/docs/notes.md" => "notes.md"
 */
```

## TDD Test Plan

### Test File: `tests/plugins/backlinks/backlinks.test.ts`

Tests for pure functions only in this step. CM6 integration tests are added in later steps.

```
describe("WIKI_LINK_RE", () => {
  test("matches simple wiki-link [[target]]")
  test("matches wiki-link with display text [[target|text]]")
  test("matches multiple wiki-links on one line")
  test("does not match across newlines (EC-8)")
  test("does not match malformed [[[text]]] -- matches inner [[text]] (EC-7)")
  test("does not match single brackets [text]")
  test("matches empty wiki-link [[]] (EC-9)")
  test("matches wiki-link with very long filename (EC-10)")
})

describe("parseWikiLinks", () => {
  test("returns correct from/to/target for [[notes]]")
  test("splits target and display text on first pipe (EC-4)")
  test("preserves subsequent pipes in display text (EC-5)")
  test("handles empty target [[]] (EC-9)")
  test("handles multiple wiki-links in one string (EC-27)")
  test("returns empty array for text with no wiki-links")
})

describe("normalizeTarget", () => {
  test("trims whitespace")
  test("strips leading ./")
  test("appends .md when no extension")
  test("does not append .md when extension exists")
  test("handles target with path separators (EC-16)")
  test("handles empty string (EC-9)")
})

describe("resolveWikiLinkPath", () => {
  test("resolves target relative to current file directory")
  test("appends .md to extensionless target")
  test("handles target that already has .md")
  test("handles target with path separators (EC-16)")
})

describe("extractOutgoingLinks", () => {
  test("extracts wiki-link targets")
  test("extracts standard markdown link targets (EC-17)")
  test("strips ./ from relative paths (EC-18)")
  test("ignores absolute paths (EC-19)")
  test("ignores URLs (EC-19)")
  test("ignores fragment-only links")
  test("normalizes all targets")
  test("returns empty array for document with no links")
  test("handles mixed wiki-links and standard links")
})

describe("filenameFromPath", () => {
  test("extracts filename from absolute path")
  test("handles path with no directory")
})
```

## Edge Cases Addressed

| EC | Handling |
|---|---|
| EC-4 | `parseWikiLinks` splits on first `\|` only; display text is everything after first pipe |
| EC-5 | Subsequent pipes are part of display text (only first pipe is separator) |
| EC-7 | `WIKI_LINK_RE` matches `[^\[\]\n]+?` (lazy, no nested brackets) -- `[[[text]]]` matches inner `[[text]]` |
| EC-8 | `[^\[\]\n]` excludes newlines -- multi-line wiki-links are not matched |
| EC-9 | `[^\[\]\n]+?` uses `+?` (one or more, lazy). For `[[]]`, there is zero content. Regex should use `*?` to match empty. **Correction**: use `*?` instead of `+?` in the regex: `/\[\[([^\[\]\n]*?)\]\]/g` |
| EC-10 | No length limit in regex -- long filenames match normally |
| EC-16 | `normalizeTarget` and `resolveWikiLinkPath` pass path separators through -- in Foundation scope the resolved path will not match a sibling file, so click shows "File not found" |
| EC-17 | `extractOutgoingLinks` scans for `[text](target.md)` pattern |
| EC-18 | `normalizeTarget` strips leading `./` |
| EC-19 | `extractOutgoingLinks` filters out absolute paths (`/`-prefixed) and URLs (`http://`, `https://`) |

## Important Regex Correction

The requirements say `[[]]` (empty wiki-link) should be recognized as valid syntax (EC-9). The regex content group must use `*?` (zero or more) not `+?` (one or more):

```typescript
export const WIKI_LINK_RE = /\[\[([^\[\]\n]*?)\]\]/g;
```

This matches `[[]]` with capture group 1 = empty string.
