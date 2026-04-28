---
title: "Step 01 — Add data-wiki-target to Decoration.mark"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 01: Add `data-wiki-target` to `Decoration.mark`

## Requirement Traceability

- FR-7.1 — Mark decorations must carry `data-wiki-target` with the raw target string.
- FR-7.2 — For piped links `[[target|display]]`, the attribute holds `target` (before the pipe).
- FR-7.3 — The `Decoration.mark` call in `buildWikiLinkDecorations` must include `attributes`.

## Context

`buildWikiLinkDecorations` (line ~559–604 in `backlinks.plugin.ts`) iterates over
`decoRanges` produced by `computeWikiLinkDecorationRanges` and converts them into
actual CM6 Decoration objects. The `"mark"` type ranges represent the visible text
of the wiki-link.

Currently the mark decoration is created as:

```typescript
Decoration.mark({
  class: "cm-live-link cm-wiki-link",
}).range(range.from, range.to)
```

The hover handler (added in step_03) needs to know the `target` string when the
user hovers over a span, without reverse-parsing the span's text content. Setting
`data-wiki-target` directly on the span at decoration time is the minimal
no-overhead approach: no extra DOM query, no text parsing at hover time.

## Why This is Backward-Compatible

No existing code reads `data-wiki-target`. The `_wikiLinkClickHandler` already
in `onEnable` uses `posAtDOM` + `findWikiLinkAtPosition` to find the target from
the document text. It does NOT need to be changed — it keeps its existing
approach. The attribute is additive only.

## Exact Change Required

### Location

`src/plugins/backlinks/backlinks.plugin.ts`

Function `buildWikiLinkDecorations`, in the `for (const range of decoRanges)`
loop, inside the `else` branch (`range.type === "mark"`).

### What to Change

The loop body currently reads (approximately lines 589–601):

```typescript
for (const range of decoRanges) {
  if (range.type === "replace") {
    decorations.push(
      Decoration.replace({}).range(range.from, range.to)
    );
  } else {
    decorations.push(
      Decoration.mark({
        class: "cm-live-link cm-wiki-link",
      }).range(range.from, range.to)
    );
  }
}
```

The `WikiLinkDecorationRange` type (defined above) carries `from`, `to`, and
`type` only — it does NOT carry the `target` string. To add the attribute, the
target string must be threaded through.

### Two-Part Change

**Part A: Extend `WikiLinkDecorationRange` to carry the target.**

Add an optional `target` field:

```typescript
export interface WikiLinkDecorationRange {
  from: number;
  to: number;
  type: "replace" | "mark";
  /** Raw (un-normalized) wiki-link target. Present on type === "mark" ranges only. */
  target?: string;
}
```

**Part B: Populate `target` in `computeWikiLinkDecorationRanges`.**

In the function `computeWikiLinkDecorationRanges`, in the two places where a
`"mark"` range is pushed (piped link display text and simple link target text),
add `target: match.target`:

```typescript
// Piped wiki-link: mark display text
if (pipeEnd < closeStart) {
  results.push({ from: pipeEnd, to: closeStart, type: "mark", target: match.target });
}

// Simple wiki-link: mark target text
if (openEnd < closeStart) {
  results.push({ from: openEnd, to: closeStart, type: "mark", target: match.target });
}
```

Note: `match.target` is the part before the first pipe (FR-7.2). For
`[[notes/project|Project Notes]]`, `match.target` is `"notes/project"`. This is
exactly what the hover handler needs to call `resolveWikiLinkPath`.

**Part C: Use `range.target` in `buildWikiLinkDecorations`.**

```typescript
} else {
  decorations.push(
    Decoration.mark({
      class: "cm-live-link cm-wiki-link",
      attributes: range.target !== undefined
        ? { "data-wiki-target": range.target }
        : {},
    }).range(range.from, range.to)
  );
}
```

The conditional `range.target !== undefined` is a defensive guard; in practice
every `"mark"` range produced by `computeWikiLinkDecorationRanges` will have a
target. The guard prevents a TypeScript type error from the optional field.

## Acceptance Criteria

1. `computeWikiLinkDecorationRanges` returns `"mark"` ranges that include a `target` string equal to `match.target` (before the pipe for piped links).
2. `buildWikiLinkDecorations` produces CM6 mark decorations with an `attributes` property containing `"data-wiki-target"`.
3. In the DOM, a rendered `.cm-wiki-link` span has `data-wiki-target` set to the raw target string.
4. All existing tests in `tests/plugins/backlinks/backlinks.test.ts` continue to pass (the interface change is backward-compatible: `target` is optional).
5. For `[[note]]`: attribute is `"note"`.
6. For `[[subfolder/note]]`: attribute is `"subfolder/note"`.
7. For `[[note|display]]`: attribute is `"note"` (not `"display"`).
8. For `[[a|b|c]]`: attribute is `"a"` (only the part before the first pipe).

## Implementation Notes

- Do NOT change `computeWikiLinkDecorations` return type — adding an optional field to the interface is non-breaking.
- Do NOT change `buildWikiLinkDecorationExtension` or `WikiLinkPlugin` — they only call `buildWikiLinkDecorations(view)` and are unaffected.
- The `computeWikiLinkDecorationRanges` function is tested directly in `backlinks.test.ts`. The existing tests check `from`, `to`, and `type` fields. Adding `target` to `"mark"` ranges does not break those assertions (they do not assert `target` is absent).
- After this step, update the existing decoration test suite to also assert that `"mark"` ranges have the correct `target` field (this is part of step_05).
