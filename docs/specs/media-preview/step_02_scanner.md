---
title: "step_02 — Scanner and Annotation Parser"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# step_02 — Scanner and Annotation Parser

## Goal

Implement the three pure, unit-testable functions that form the data-extraction layer of
the plugin:

1. `parseAltAnnotations(rawAlt)` — Extract dimension, class shorthand, and inline CSS
   annotations from raw alt text; return cleaned alt text plus parsed metadata.

2. `scanImageRanges(state)` — Walk the lezer syntax tree to find all `Image` nodes and
   produce an array of `ImageRange` objects.

3. `resolveImageSrc(src, currentFile)` — Resolve a URL to a displayable form, applying
   `window.__MARKABLE_CONVERT_FILE_SRC__` for local paths and rejecting `file://`.

4. `isCursorInsideRange(anchor, head, from, to)` — Cursor overlap test (identical formula
   to math plugin).

These functions are exported from `media-preview.plugin.ts` so the Vitest test suite
(step_06) can import them directly.

---

## Types to Define

Place these at the top of `media-preview.plugin.ts`, after the CM6 globals destructure:

```typescript
/**
 * A single image reference found in the document, with all annotation metadata
 * pre-parsed. Produced by scanImageRanges(); consumed by buildImageDecorations().
 */
export interface ImageRange {
  /** Document offset of the opening `!` (inclusive). */
  from: number;
  /** Document offset one past the closing `)` (exclusive). */
  to: number;
  /** Raw URL string, exactly as written in the Markdown (no encoding applied). */
  src: string;
  /** Cleaned alt text with all annotation tokens stripped. */
  cleanAlt: string;
  /** CSS class names derived from dot-prefix shorthand in alt text (e.g. `["center", "shadow"]`). */
  cssClasses: string[];
  /** Raw CSS string from `{...}` token in alt text, or undefined if absent. */
  cssStyle: string | undefined;
  /** Explicit pixel width from `|WxH` or `|W` annotation, or undefined. */
  displayWidth: number | undefined;
  /** Explicit pixel height from `|WxH` annotation, or undefined. */
  displayHeight: number | undefined;
}

/**
 * Result of parseAltAnnotations().
 * All annotation tokens have been stripped from cleanAlt.
 */
export interface AltAnnotations {
  cleanAlt: string;
  cssClasses: string[];
  cssStyle: string | undefined;
  displayWidth: number | undefined;
  displayHeight: number | undefined;
}
```

---

## `parseAltAnnotations(rawAlt: string): AltAnnotations`

### Parsing order

Annotations are parsed in this order (order matters for stripping):

1. **Inline CSS** — Match `{[^}]*}` anywhere in the string. Extract the content between
   `{` and `}` as `cssStyle`. Remove the `{...}` token from the working string.

2. **Dimension** — Match `\s*\|\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*` in the working string
   after CSS extraction. Extract width (and optional height). Remove the `|...` token.
   Zero or negative values are treated as undefined (FR-2.5).

3. **Class shorthand** — Match all `.token` patterns in the working string after
   dimension extraction. A valid class token matches `\.[a-zA-Z_-][a-zA-Z0-9_-]*`.
   Tokens with invalid characters (spaces, `!`, etc.) are silently discarded (EC-33).
   Remove all valid and invalid `.token` patterns from the working string.

4. **Clean alt** — Trim the remaining string. This is the `<img alt="">` value.

### Implementation skeleton

```typescript
export function parseAltAnnotations(rawAlt: string): AltAnnotations {
  let working = rawAlt;

  // Step 1: Extract {css} block
  let cssStyle: string | undefined;
  working = working.replace(/\{([^}]*)\}/, (_, content: string) => {
    cssStyle = content.trim() || undefined;
    return "";
  });

  // Step 2: Extract |WxH or |W dimension annotation
  let displayWidth: number | undefined;
  let displayHeight: number | undefined;
  working = working.replace(
    /\s*\|\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*/,
    (_, w: string, h: string | undefined) => {
      const pw = parseInt(w, 10);
      const ph = h !== undefined ? parseInt(h, 10) : undefined;
      if (pw > 0) displayWidth = pw;
      if (ph !== undefined && ph > 0) displayHeight = ph;
      return "";
    },
  );

  // Step 3: Extract .classname tokens
  const cssClasses: string[] = [];
  // Match any dot-prefixed token (valid or invalid — we extract all, validate below)
  working = working.replace(/\.([^\s.{}|]+)/g, (_, token: string) => {
    // Validate: CSS class names must start with letter/underscore/hyphen,
    // followed by letters, digits, underscores, hyphens only.
    if (/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(token)) {
      cssClasses.push(token);
    }
    // Always remove from working string even if invalid (EC-33)
    return "";
  });

  // Step 4: Clean alt text
  const cleanAlt = working.trim();

  return { cleanAlt, cssClasses, cssStyle, displayWidth, displayHeight };
}
```

### Edge cases this handles

- EC-04: Empty alt `""` — `working` is empty after all steps; `cleanAlt = ""`. No dim parsing.
- EC-17: `|400` only — `displayWidth = 400`, `displayHeight = undefined`.
- EC-33: `.my class!` — invalid token discarded; `cssClasses = []`.
- EC-34: `photo.center|400x300{opacity:0.8}` — all three annotations extracted correctly.
- FR-2.5: `|0x300` — zero width treated as undefined; only height applied (but height
  without width would be unusual — apply it anyway; CSS will handle proportional scaling).

---

## `scanImageRanges(state: EditorState): ImageRange[]`

Uses lezer `syntaxTree(state)` to walk all `Image` nodes in the document.

The function accesses `syntaxTree` from `window.__CM_LANGUAGE__` (destructured at IIFE
top level). It accesses `state.doc` to extract text and uses `state.selection` for
nothing — selection is handled by `buildImageDecorations()`.

```typescript
export function scanImageRanges(state: EditorState): ImageRange[] {
  const results: ImageRange[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Image") return;

      // Walk Image children to find URL node
      let url = "";
      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.name === "URL") {
            url = state.doc.sliceString(cursor.from, cursor.to);
          }
        } while (cursor.nextSibling());
      }

      // Extract raw alt text from the full node text: everything between ![ and ]
      const fullText = state.doc.sliceString(node.from, node.to);
      const altMatch = fullText.match(/^!\[([^\]]*)\]/);
      const rawAlt = altMatch ? altMatch[1] : "";

      const annotations = parseAltAnnotations(rawAlt);

      results.push({
        from: node.from,
        to: node.to,
        src: url,
        cleanAlt: annotations.cleanAlt,
        cssClasses: annotations.cssClasses,
        cssStyle: annotations.cssStyle,
        displayWidth: annotations.displayWidth,
        displayHeight: annotations.displayHeight,
      });

      return false; // Do not descend into Image children
    },
  });

  // Results are already in document order (lezer iterates left-to-right).
  // Sort as a safety net for correctness (RangeSetBuilder requires ascending order).
  results.sort((a, b) => a.from - b.from);
  return results;
}
```

### Why lezer instead of regex

- Lezer natively excludes `Image` nodes inside fenced code blocks and inline code spans
  (EC-13, EC-14) — no additional filtering required.
- Handles URL content with balanced parentheses (EC-06) via the parser's own grammar rules.
- Handles images inside blockquotes (EC-22) — lezer includes `Image` nodes in any block context.
- EC-32 (incomplete tree on first render): if `syntaxTree(state)` returns a partial tree,
  `iterate()` simply finds fewer nodes. The StateField recomputes on the next transaction.
  No crash; safe degradation.

---

## `resolveImageSrc(src: string, currentFile: string | null): string`

Determines the displayable URL for an image. Returns `""` (empty string) to signal
broken-image for cases that cannot be resolved.

```typescript
/**
 * Resolve an image src string to a displayable URL.
 *
 * Returns an empty string for cases that must show a broken-image placeholder
 * (empty src, file:// protocol).
 *
 * Accesses window.__MARKABLE_CONVERT_FILE_SRC__ defensively (EC-35).
 *
 * @param src         Raw URL string from the Markdown image syntax.
 * @param currentFile Absolute path of the currently open file, or null.
 * @returns           Resolved URL ready for use as <img src>, or "" for broken.
 */
export function resolveImageSrc(src: string, currentFile: string | null): string {
  // EC-03: Empty URL — broken-image immediately
  if (!src || src.trim() === "") return "";

  // EC-09: file:// protocol — rejected per FR-3.3
  if (src.startsWith("file://")) return "";

  // FR-3.1: Remote URLs and data: URIs — pass through unchanged
  if (/^(https?:|data:)/.test(src)) return src;

  // Get convertFileSrc defensively (EC-35)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const convertFileSrc = (window as any).__MARKABLE_CONVERT_FILE_SRC__;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (typeof convertFileSrc !== "function") {
    // EC-35: global not yet assigned — pass src as-is (will likely fail to load;
    // onerror will show broken-image placeholder)
    console.warn("[media-preview] __MARKABLE_CONVERT_FILE_SRC__ is not defined");
    return src;
  }

  // FR-3.1: Absolute local path
  if (src.startsWith("/")) {
    return convertFileSrc(src) as string;
  }

  // FR-3.1: Relative local path — resolve against current file's directory
  // EC-07: If currentFile is null (unsaved document), attempt src as-is (will fail;
  // onerror fires and broken-image placeholder is shown — acceptable behavior)
  if (currentFile) {
    const dir = currentFile.replace(/\/[^/]*$/, "");
    return convertFileSrc(`${dir}/${src}`) as string;
  }

  // EC-07: No current file path — pass through (will fail to load)
  return src;
}
```

---

## `isCursorInsideRange(anchor, head, from, to): boolean`

Identical to the math plugin implementation. Copy exactly:

```typescript
export function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number,
): boolean {
  const selFrom = Math.min(selectionAnchor, selectionHead);
  const selTo   = Math.max(selectionAnchor, selectionHead);
  return selFrom < to && selTo >= from;
}
```

This formula satisfies EC-01 (cursor on `!`), EC-02 (cursor on `)`), and all selection
overlap cases (FR-1.4).

---

## Implementation Notes

- All four functions are **exported** from the plugin file so Vitest can import them
  directly in `tests/plugins/media-preview/media-preview.test.ts`.

- `scanImageRanges` has a dependency on the CM6 globals (`syntaxTree`, `state`). In
  tests, use a helper that exercises `parseAltAnnotations` and `resolveImageSrc` directly
  rather than needing a real EditorState. See step_06 for the test strategy.

- The regex in `parseAltAnnotations` for class extraction uses `[^\s.{}|]+` to capture
  multi-character tokens between dots. The validation regex `^[a-zA-Z_-][a-zA-Z0-9_-]*$`
  is the whitelist — anything not matching is silently discarded. Do not use a blocklist.

- `parseAltAnnotations` must handle the annotation tokens in the order documented above.
  In particular, the `{css}` block must be extracted before dimension parsing, because a
  `{` or `}` character inside a dimension annotation would be unusual but could confuse
  the dimension regex.

---

## Test Cases for This Step

(Full tests implemented in step_06. Listed here as a design checklist.)

`parseAltAnnotations`:
- `""` → `{ cleanAlt: "", cssClasses: [], cssStyle: undefined, displayWidth: undefined, displayHeight: undefined }`
- `"photo"` → `{ cleanAlt: "photo", ... }`
- `"photo|400x300"` → width=400, height=300, cleanAlt="photo"
- `"photo|400"` → width=400, height=undefined, cleanAlt="photo"
- `"photo|0x300"` → width=undefined (zero), height=300
- `"photo.center"` → cssClasses=["center"], cleanAlt="photo"
- `"photo.center.shadow"` → cssClasses=["center","shadow"], cleanAlt="photo"
- `"photo{opacity:0.8}"` → cssStyle="opacity:0.8", cleanAlt="photo"
- `"photo.center|400x300{opacity:0.8}"` → all three, cleanAlt="photo"
- `"photo.my class!"` → cssClasses=[] (invalid token discarded), cleanAlt has no dot prefix
- `"photo.valid-name_1"` → cssClasses=["valid-name_1"]

`resolveImageSrc`:
- `("", null)` → `""`
- `("file:///Users/x/img.png", null)` → `""`
- `("https://example.com/a.png", null)` → `"https://example.com/a.png"`
- `("data:image/png;base64,abc", null)` → `"data:image/png;base64,abc"`
- `("/Users/x/img.png", null)` → calls `convertFileSrc("/Users/x/img.png")`
- `("img.png", "/Users/x/doc.md")` → calls `convertFileSrc("/Users/x/img.png")`
- `("./img.png", "/Users/x/doc.md")` → calls `convertFileSrc("/Users/x/./img.png")`
- `("img.png", null)` → returns `"img.png"` (EC-07 — no current file, pass through)

`isCursorInsideRange`:
- cursor at `from` → inside (EC-01)
- cursor at `to - 1` → inside (EC-02)
- cursor at `to` → outside
- cursor before `from` → outside
- selection spanning the entire range → inside
- selection starting before, ending inside → inside

---

## Definition of Done

- [ ] `ImageRange` and `AltAnnotations` interfaces exported from `media-preview.plugin.ts`.
- [ ] `parseAltAnnotations()` exported and unit-testable.
- [ ] `scanImageRanges()` exported; uses `syntaxTree` from `window.__CM_LANGUAGE__`; returns
  sorted `ImageRange[]`.
- [ ] `resolveImageSrc()` exported; handles all six URL categories + EC-07 + EC-09 + EC-35.
- [ ] `isCursorInsideRange()` exported; formula matches math plugin exactly.
- [ ] No TODO comments in source.
- [ ] TypeScript compilation passes.
