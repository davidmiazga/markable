---
title: Step 01 — Broken Class Logic and CSS
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 01 — Broken Class Logic and CSS

## Goal

Add the `cm-wiki-link-broken` CSS class to mark decorations whose target stem
is absent from the vault index. This step covers the pure-function layer and
the CSS surface. Vault-change subscriptions that trigger re-renders are in
step_02.

After this step:
- `computeWikiLinkDecorationRanges` classifies links as broken when a
  `stemSet` is provided and the target is not in it.
- `buildWikiLinkDecorations` passes a `stemSet` built from the current vault
  index and applies the extra CSS class.
- `injectWikiLinkStyles` includes the `.cm-wiki-link-broken` rule.
- `styles.css` defines `--link-broken-color`.
- All FR-1 through FR-9 except FR-5 (vault-change re-render) are satisfied.

---

## Files to Change

1. `src/plugins/backlinks/backlinks.plugin.ts`
2. `src/styles.css`

---

## Precise Changes

### Change A — Extend `WikiLinkDecorationRange` interface

**File:** `src/plugins/backlinks/backlinks.plugin.ts`
**Location:** The `WikiLinkDecorationRange` interface at approximately line 415.

Add one optional field after `target?`:

```typescript
export interface WikiLinkDecorationRange {
  from: number;
  to: number;
  type: "replace" | "mark";
  /**
   * Raw (un-normalized) wiki-link target. Present on `type === "mark"`
   * ranges only.
   */
  target?: string;
  /**
   * True when the target stem is not present in the vault index.
   * Only set on `type === "mark"` ranges when a `stemSet` is supplied to
   * `computeWikiLinkDecorationRanges`. Undefined (falsy) means either
   * "valid" or "no vault active".
   */
  broken?: boolean;
}
```

No other types change.

---

### Change B — Update `computeWikiLinkDecorationRanges` signature

**File:** `src/plugins/backlinks/backlinks.plugin.ts`
**Location:** The `computeWikiLinkDecorationRanges` function export, approximately line 485.

**Signature change** (add fourth optional parameter):

```typescript
export function computeWikiLinkDecorationRanges(
  text: string,
  activeLines: Set<number>,
  visibleRanges: { from: number; to: number }[],
  stemSet?: Set<string>
): WikiLinkDecorationRange[]
```

**JSDoc addition** — add to the existing `@param` block:

```
 * @param stemSet - Optional set of lowercased vault stems. When provided,
 *                  mark ranges whose target stem is absent from this set
 *                  have their `broken` field set to `true`. When absent
 *                  (no vault active), no broken classification is applied
 *                  and all links render as valid (EC-01, NFR-5).
```

**Body change** — the mark-range push sites. There are two: one for the simple
`[[target]]` case and one for the `[[target|display]]` case. For each, after
the existing push, set `broken` when `stemSet` is provided and the stem is
absent.

The stem extraction helper must be added immediately before the two push sites
or defined as a local inline. Use this extraction logic (matches AD-2 in
`00_index.md`):

```typescript
/**
 * Extract the bare lowercase stem from a raw wiki-link target for vault
 * index lookup.
 *
 * Steps:
 *   1. normalizeTarget(t)            e.g. "subdir/notes.md"
 *   2. Strip ".md" suffix            "subdir/notes"
 *   3. Take filename after last "/"  "notes"
 *   4. Lowercase                     "notes"
 */
function stemForLookup(rawTarget: string): string {
  const normalized = normalizeTarget(rawTarget);
  const withoutExt = normalized.endsWith(".md")
    ? normalized.slice(0, -3)
    : normalized;
  const slashIdx = withoutExt.lastIndexOf("/");
  return (slashIdx === -1 ? withoutExt : withoutExt.slice(slashIdx + 1)).toLowerCase();
}
```

Place `stemForLookup` as a module-private function immediately above
`computeWikiLinkDecorationRanges` (not exported; keep the exported API surface
minimal).

**Mark-range push — simple wiki-link branch** (approximately line 553):

Before this step, the site reads:
```typescript
if (openEnd < closeStart) {
  results.push({ from: openEnd, to: closeStart, type: "mark", target: match.target });
}
```

After this step:
```typescript
if (openEnd < closeStart) {
  const markRange: WikiLinkDecorationRange = {
    from: openEnd,
    to: closeStart,
    type: "mark",
    target: match.target,
  };
  if (stemSet !== undefined) {
    markRange.broken = !stemSet.has(stemForLookup(match.target));
  }
  results.push(markRange);
}
```

**Mark-range push — piped wiki-link branch** (approximately line 543):

Before this step:
```typescript
if (pipeEnd < closeStart) {
  results.push({ from: pipeEnd, to: closeStart, type: "mark", target: match.target });
}
```

After this step:
```typescript
if (pipeEnd < closeStart) {
  const markRange: WikiLinkDecorationRange = {
    from: pipeEnd,
    to: closeStart,
    type: "mark",
    target: match.target,
  };
  if (stemSet !== undefined) {
    markRange.broken = !stemSet.has(stemForLookup(match.target));
  }
  results.push(markRange);
}
```

Both sites use identical logic — the only input difference is `match.target`
(the raw target string before normalization), which is identical in both the
piped and simple cases.

---

### Change C — Update `buildWikiLinkDecorations`

**File:** `src/plugins/backlinks/backlinks.plugin.ts`
**Location:** `buildWikiLinkDecorations` function, approximately line 580.

**Step C-1: Build `stemSet` before calling `computeWikiLinkDecorationRanges`.**

Add this block immediately after `const docText = state.doc.toString();` and
before the `computeWikiLinkDecorationRanges` call:

```typescript
/* Build vault stem set for broken-link detection (FR-9, AD-1).
 * O(n) in vault size; individual lookups in the decoration loop are O(1).
 * When no vault is active, stemSet is undefined and no broken-link
 * classification is applied (EC-01, FR-3). */
const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
const vaultIndex = vaultManager?.getVaultIndex?.() ?? null;
let stemSet: Set<string> | undefined;
if (vaultIndex !== null) {
  stemSet = new Set(
    (vaultIndex.entries as { name: string }[]).map((e) => e.name.toLowerCase())
  );
}
```

**Step C-2: Pass `stemSet` as the fourth argument.**

Change the existing call from:
```typescript
const decoRanges = computeWikiLinkDecorationRanges(
  docText,
  activeLines,
  view.visibleRanges
);
```
to:
```typescript
const decoRanges = computeWikiLinkDecorationRanges(
  docText,
  activeLines,
  view.visibleRanges,
  stemSet
);
```

**Step C-3: Apply `cm-wiki-link-broken` class in the mark branch.**

The existing mark decoration creation reads:
```typescript
decorations.push(
  Decoration.mark({
    class: "cm-live-link cm-wiki-link",
    attributes: range.target !== undefined
      ? { "data-wiki-target": range.target }
      : {},
  }).range(range.from, range.to)
);
```

Replace with:
```typescript
const linkClass = range.broken
  ? "cm-live-link cm-wiki-link cm-wiki-link-broken"
  : "cm-live-link cm-wiki-link";
decorations.push(
  Decoration.mark({
    class: linkClass,
    attributes: range.target !== undefined
      ? { "data-wiki-target": range.target }
      : {},
  }).range(range.from, range.to)
);
```

The `attributes` block is unchanged. `data-wiki-target` remains on all mark
decorations, broken or valid (FR-8, AD-6).

---

### Change D — Update `injectWikiLinkStyles`

**File:** `src/plugins/backlinks/backlinks.plugin.ts`
**Location:** `injectWikiLinkStyles` function, approximately line 702.

The current `style.textContent` is:
```typescript
style.textContent = `
/* Wiki-link decoration styles (Step 4).
 * The .cm-live-link class provides base link styling (color, underline).
 * The .cm-wiki-link class enables click targeting by the click handler. */
.cm-wiki-link {
  cursor: pointer;
}
`;
```

Replace with:
```typescript
style.textContent = `
/* Wiki-link decoration styles.
 * The .cm-live-link class provides base link styling (color, underline).
 * The .cm-wiki-link class enables click targeting by the click handler.
 * The .cm-wiki-link-broken class marks links whose target does not exist
 * in the vault index. Color is controlled by --link-broken-color in
 * styles.css so themes can override it. */
.cm-wiki-link {
  cursor: pointer;
}
.cm-wiki-link-broken {
  color: var(--link-broken-color);
  text-decoration-style: wavy;
}
`;
```

Rationale for `text-decoration-style: wavy`: inherits the underline from
`.cm-live-link` but makes it visually distinct without adding a second
declaration. The color override takes precedence over `.cm-live-link`'s
`color: var(--link-color)` due to class specificity (both classes are on the
same element; `.cm-wiki-link-broken` is lower in the injected style tag but
the injected tag is appended to `<head>` after `styles.css`, giving it higher
cascade order for same-specificity rules).

Note on specificity: Both `.cm-live-link` (in `styles.css`) and
`.cm-wiki-link-broken` (in the injected style tag) are single-class selectors
with equal specificity. The injected `<style>` tag is appended after the
`<link>` or inline `<style>` for `styles.css`, so the injected rule wins
without needing `!important`.

---

### Change E — Add CSS variable to `styles.css`

**File:** `src/styles.css`

**Change E-1:** Add `--link-broken-color` to the `:root` block immediately
after `--link-color`:

```css
--link-color: hsl(212, 95%, 40%);
--link-broken-color: hsl(0, 72%, 45%);  /* muted red for broken wiki-links */
```

The value `hsl(0, 72%, 45%)` is a muted red that is clearly distinct from
the blue `--link-color` without being as harsh as a pure `#ff0000`.

**Change E-2:** Add a dark-mode override inside `[data-theme="dark"]`
immediately after `--link-color: hsl(212, 92%, 45%);`:

```css
--link-color: hsl(212, 92%, 45%);
--link-broken-color: hsl(0, 90%, 65%);  /* lighter red for dark backgrounds */
```

The dark-mode value `hsl(0, 90%, 65%)` is lighter to maintain sufficient
contrast against the dark background.

---

## Acceptance Criteria

1. A `[[notes]]` link whose stem `"notes"` is in the vault index renders with
   class `cm-live-link cm-wiki-link` only. No `cm-wiki-link-broken`.

2. A `[[missing]]` link whose stem `"missing"` is absent from the vault index
   renders with class `cm-live-link cm-wiki-link cm-wiki-link-broken`.

3. When `getVaultIndex()` returns `null`, no link receives `cm-wiki-link-broken`.

4. `[[missing|Display Text]]` — the span covering `"Display Text"` receives
   `cm-wiki-link-broken`; `data-wiki-target` is `"missing"`.

5. `[[subdir/notes]]` — lookup key is `"notes"` (filename stem only, lowercased).
   Matches `entry.name = "notes"`.

6. `[[Notes]]` with `entry.name = "notes"` — case-insensitive match; no broken
   class.

7. `[[file.md]]` — lookup key is `"file"` (`.md` stripped before filename
   extraction).

8. `--link-broken-color` is defined in `:root` in `styles.css` with a
   dark-mode override in `[data-theme="dark"]`.

9. `.cm-wiki-link-broken` rule is present in the injected `<style>` tag.

10. All existing `computeWikiLinkDecorationRanges` tests pass without
    modification (no third parameter change — existing call sites pass only
    three arguments, which is still valid because the fourth is optional).

---

## Test Requirements for This Step

Tests live in `tests/plugins/backlinks/wikilink-broken.test.ts` (created in
step_03). The following cases must be green after step_01:

- EC-01 (no vault, `stemSet` absent): all links get no broken flag
- EC-02 (empty vault, empty stemSet): all links get broken flag
- EC-03 (empty `[[]]`): no mark range produced, no broken check
- EC-04 (piped link, broken target): display text span gets broken flag
- EC-05 (piped link, valid target): no broken flag
- EC-06 (subdirectory path `[[subdir/notes]]`): stem extracted as `"notes"`
- EC-07 (case mismatch `[[Notes]]` vs `"notes"`): no broken flag
- EC-11 (inside fenced code): no decoration, no broken check
- EC-12 (`[[file.md]]` explicit extension): stem extracted as `"file"`

These are all pure-function tests requiring no CM6 or DOM.
