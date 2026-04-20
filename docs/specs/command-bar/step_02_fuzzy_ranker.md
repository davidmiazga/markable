---
title: "Command Bar — Step 02: Fuzzy Ranker"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 02 — Fuzzy Ranker

## Goal

Implement a pure, self-contained fuzzy ranker function that:
- Accepts a `label` string and a `query` string.
- Returns a `FuzzyMatch | null` (`null` = no match).
- Ranks matches into four tiers as specified in FR-02.3.
- Returns the exact character positions of matched query characters for highlight rendering.

This module is a pure function with no DOM, window, or IIFE dependencies. It is
fully unit-testable in isolation.

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | Add the fuzzy ranker section (inline, no separate file — IIFE constraint) |
| `tests/plugins/command-bar/command-bar.test.ts` | Unit tests for `fuzzyMatch()` |

The ranker is written inline in the plugin source file. It is not a separate
importable module — this is an IIFE requirement (all code must be bundled into the
single plugin file, no dynamic imports).

---

## Algorithm Specification

### Types

```typescript
interface FuzzyMatch {
  tier: 1 | 2 | 3 | 4;
  positions: number[];  // indices into label (0-based) of matched characters
}
```

### Function signature

```typescript
function fuzzyMatch(label: string, query: string): FuzzyMatch | null
```

### Tier definitions

All comparisons are case-insensitive (normalize both label and query with `.toLowerCase()`
before comparison, but `positions` refer to indices in the original label).

**Tier 1 — Exact prefix**
```
labelLower.startsWith(queryLower)
```
Positions: `[0, 1, 2, ..., query.length - 1]` (first `query.length` characters).

**Tier 2 — Word-boundary prefix**
A "word" in the label is any run of characters preceded by a space, hyphen, or
underscore (or the start of the string). Check: does any word in the label start with
the query string?

Algorithm:
```
words = split label at /[\s\-_]+/ boundaries
for each word, check if wordLower.startsWith(queryLower)
if yes, record the positions of the first query.length chars of that word
```

Note: Tier 1 is a special case of Tier 2 (first word). Check Tier 1 first. If the
label starts with the query, it is Tier 1, not Tier 2.

**Tier 3 — Substring**
```
idx = labelLower.indexOf(queryLower)
idx !== -1
```
Positions: `[idx, idx+1, ..., idx+query.length-1]`.

Note: This includes cases covered by Tiers 1 and 2. Check Tier 3 only after Tiers 1
and 2 have been eliminated.

**Tier 4 — Subsequence**
Every character of `queryLower` appears in `labelLower` in order (greedy-first match).

Algorithm:
```typescript
function subsequenceMatch(labelLower: string, queryLower: string): number[] | null {
  const positions: number[] = [];
  let qi = 0;
  for (let li = 0; li < labelLower.length && qi < queryLower.length; li++) {
    if (labelLower[li] === queryLower[qi]) {
      positions.push(li);
      qi++;
    }
  }
  return qi === queryLower.length ? positions : null;
}
```

If `subsequenceMatch` returns `null`, the label does not match. Return `null` from
`fuzzyMatch`.

### Full algorithm

```typescript
function fuzzyMatch(label: string, query: string): FuzzyMatch | null {
  if (query === "") return null; // empty query = no match (caller handles separately)

  const labelLower = label.toLowerCase();
  const queryLower = query.toLowerCase();

  // Tier 1: exact prefix
  if (labelLower.startsWith(queryLower)) {
    const positions = Array.from({ length: queryLower.length }, (_, i) => i);
    return { tier: 1, positions };
  }

  // Tier 2: word-boundary prefix
  const wordBoundaryPositions = wordBoundaryMatch(labelLower, queryLower);
  if (wordBoundaryPositions) {
    return { tier: 2, positions: wordBoundaryPositions };
  }

  // Tier 3: substring
  const idx = labelLower.indexOf(queryLower);
  if (idx !== -1) {
    const positions = Array.from({ length: queryLower.length }, (_, i) => idx + i);
    return { tier: 3, positions };
  }

  // Tier 4: subsequence
  const seqPositions = subsequenceMatch(labelLower, queryLower);
  if (seqPositions) {
    return { tier: 4, positions: seqPositions };
  }

  return null; // no match
}

function wordBoundaryMatch(labelLower: string, queryLower: string): number[] | null {
  // Find all word start positions (every position after /[\s\-_]/).
  const starts: number[] = [];
  for (let i = 1; i < labelLower.length; i++) {
    const prev = labelLower[i - 1];
    if (prev === " " || prev === "-" || prev === "_") {
      starts.push(i);
    }
  }
  for (const start of starts) {
    // Check if the substring from `start` starts with the query
    if (labelLower.startsWith(queryLower, start)) {
      return Array.from({ length: queryLower.length }, (_, i) => start + i);
    }
  }
  return null;
}
```

### Sorting

When the caller sorts a collection of `MatchedResult[]`:

1. Primary sort: `match.tier` ascending (lower tier = better).
2. Secondary sort (same tier): `result.label.toLowerCase()` alphabetically.

For empty query, no sorting is applied — results are displayed in their natural order
(category order, then insertion order within category).

---

## HTML-safe highlight rendering

The ranker returns `positions: number[]` — indices into the label string. The overlay
renderer (step_04) uses these positions to inject `<mark>` spans. The renderer must
**never use `innerHTML`** with unsanitized label text. Instead, it builds the DOM
node-by-node:

```typescript
function renderHighlightedLabel(label: string, positions: number[]): HTMLElement {
  const span = document.createElement("span");
  const posSet = new Set(positions);
  let i = 0;
  while (i < label.length) {
    if (posSet.has(i)) {
      const mark = document.createElement("mark");
      mark.className = "cb-match";
      // Collect consecutive highlighted chars into one <mark> for cleaner DOM
      let j = i;
      while (j < label.length && posSet.has(j)) {
        mark.textContent = (mark.textContent ?? "") + label[j];
        j++;
      }
      span.appendChild(mark);
      i = j;
    } else {
      // Collect consecutive unhighlighted chars into one text node
      let j = i;
      while (j < label.length && !posSet.has(j)) j++;
      span.appendChild(document.createTextNode(label.slice(i, j)));
      i = j;
    }
  }
  return span;
}
```

This handles EC-10 (HTML injection) because `textContent` on `<mark>` and
`createTextNode` never parse HTML.

---

## Test Cases

File: `tests/plugins/command-bar/command-bar.test.ts`

All tests call `fuzzyMatch()` directly after importing the function. Since the ranker
is inline in the plugin file, the test file imports it from a shared test-utility
export or the function is extracted to a separate module that the plugin inlines via the
build step. See Implementation Note below.

### Implementation Note for testing

The fuzzy ranker must be testable without loading the entire plugin. Two options:

**Option A (recommended)**: Extract the ranker to
`src/plugins/command-bar/fuzzy-ranker.ts` as a pure TypeScript module with standard
`export`. The plugin file imports from it. Vitest tests import directly from
`fuzzy-ranker.ts`. The IIFE build bundles it inline (Rollup resolves local imports).

**Option B**: Inline in plugin, test via a module-level export that is stripped from
the IIFE output. This is fragile.

**Use Option A.** The fuzzy-ranker.ts module exports `fuzzyMatch`, `FuzzyMatch` type,
and `renderHighlightedLabel`. The plugin imports them. The build script bundles them
inline per the existing external-only-for-@codemirror strategy.

### Test cases for `fuzzyMatch()`

```typescript
// Tier 1: exact prefix
fuzzyMatch("Focus Mode", "fo") // → { tier: 1, positions: [0, 1] }
fuzzyMatch("Focus Mode", "focus") // → { tier: 1, positions: [0,1,2,3,4] }

// Tier 2: word-boundary prefix
fuzzyMatch("Toggle Focus", "fo") // → { tier: 2, positions: [7, 8] }
fuzzyMatch("Find & Replace", "re") // → { tier: 2, positions: [9, 10] }

// Tier 3: substring (not prefix, not word-boundary prefix)
fuzzyMatch("Bold", "ol") // → { tier: 3, positions: [1, 2] }
fuzzyMatch("Close All", "se") // → { tier: 3, positions: [3, 4] }

// Tier 4: subsequence
fuzzyMatch("Focus Mode", "fmd") // → { tier: 4, positions: [0, 6, 8] }
fuzzyMatch("Focus Mode", "fcs") // → { tier: 4, positions: [0, 2, 4] } (EC-23)

// No match
fuzzyMatch("Bold", "xyz") // → null
fuzzyMatch("Bold", "boldd") // → null

// Empty query (caller guards against this, but function handles it)
fuzzyMatch("Bold", "") // → null

// Case insensitivity
fuzzyMatch("FOCUS MODE", "fo") // → { tier: 1, positions: [0, 1] }
fuzzyMatch("bold", "B") // → { tier: 1, positions: [0] }

// EC-10: label with HTML characters (positions only, rendering is safe separately)
fuzzyMatch("Save <> File", "sa") // → { tier: 1, positions: [0, 1] }

// EC-23: non-consecutive match positions are correct
// fuzzyMatch("Focus Mode", "fcs") must return positions [0, 2, 4] not [0, 1, 2]
const r = fuzzyMatch("Focus Mode", "fcs");
expect(r?.positions).toEqual([0, 2, 4]);

// Tier ordering: same query on labels that would rank differently
// "Focus Mode" (tier 1 for "fo") vs "Toggle Focus" (tier 2 for "fo")
// After sorting, Focus Mode comes first
```

### Test cases for `renderHighlightedLabel()`

```typescript
// Basic rendering
const el = renderHighlightedLabel("Focus Mode", [0, 1]);
// First child: <mark class="cb-match">Fo</mark>
// Second child: text node "cus Mode"
expect(el.querySelector("mark.cb-match")?.textContent).toBe("Fo");

// HTML injection safety (EC-10)
const el2 = renderHighlightedLabel("<script>", [0]);
// Positions [0] = '<' character
// Must produce a <mark> with textContent "<", NOT innerHTML injection
expect(el2.querySelector("mark")?.textContent).toBe("<");

// Non-consecutive positions (EC-23)
const el3 = renderHighlightedLabel("Focus Mode", [0, 2, 4]);
// Should have: <mark>F</mark>o<mark>cu</mark>s Mode
// (positions 2 and 3 are consecutive, so merged into one mark)
const marks = el3.querySelectorAll("mark");
expect(marks.length).toBe(2);
expect(marks[0].textContent).toBe("F");
expect(marks[1].textContent).toBe("cu");
```

---

## Acceptance Criteria

- [ ] `fuzzyMatch("Focus Mode", "fo")` returns `{ tier: 1, positions: [0, 1] }`.
- [ ] `fuzzyMatch("Toggle Focus", "fo")` returns `{ tier: 2, ... }`.
- [ ] `fuzzyMatch("Bold", "ol")` returns `{ tier: 3, ... }`.
- [ ] `fuzzyMatch("Focus Mode", "fcs")` returns `{ tier: 4, positions: [0, 2, 4] }` (EC-23).
- [ ] `fuzzyMatch("Bold", "xyz")` returns `null`.
- [ ] `fuzzyMatch("Focus Mode", "")` returns `null`.
- [ ] All FR-02.3 tier definitions are correctly implemented.
- [ ] All tests in `tests/plugins/command-bar/command-bar.test.ts` for this module pass.
- [ ] `renderHighlightedLabel` never uses `innerHTML` (EC-10).
- [ ] `renderHighlightedLabel` with HTML-special characters in label produces safe DOM (EC-10).
- [ ] `npm run build:plugins` compiles the plugin without error (fuzzy-ranker.ts is bundled inline).
