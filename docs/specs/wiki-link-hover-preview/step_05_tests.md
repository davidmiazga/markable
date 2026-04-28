---
title: "Step 05 — Tests: hover-popover.test.ts"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 05: Test Plan — `hover-popover.test.ts`

## File Location

`tests/plugins/backlinks/hover-popover.test.ts`

This is a new file, sibling to `tests/plugins/backlinks/backlinks.test.ts`.
It imports the same module but focuses exclusively on the Step 10 additions.

## Imports

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractPopoverContent,
  positionPopover,
  dismissWikiPopover,
  computeWikiLinkDecorationRanges,
  injectWikiPopoverStyles,
  removeWikiPopoverStyles,
} from "../../../src/plugins/backlinks/backlinks.plugin";
```

Note: `showWikiPopover` is NOT exported (internal function). Its behavior is
tested indirectly via integration-style tests that mock `invokeReadFile` globals
and observe DOM state, but the primary coverage comes from testing the exported
helpers. The fetch-version counter test requires direct module state access;
use the `_testing` accessor pattern extended for Step 10 (or test via
`dismissWikiPopover` side effects).

---

## Test Suite Structure

```
hover-popover.test.ts
  ├── extractPopoverContent
  │   ├── YAML front matter title
  │   ├── H1 heading fallback
  │   ├── filename stem fallback
  │   ├── piped-link file (title from content not from display text)
  │   ├── file longer than 2048 bytes (byte cap)
  │   ├── front-matter-only file (empty excerpt)
  │   ├── empty file
  │   └── excerpt strips fenced code, heading markers, bold/italic
  ├── positionPopover
  │   ├── span in viewport middle (default: below, left-aligned)
  │   ├── span near right edge (left is clamped)
  │   └── span near bottom edge (top is flipped above)
  ├── buildWikiLinkDecorations (data-wiki-target)
  │   ├── simple [[note]] mark range has target === "note"
  │   ├── piped [[note|display]] mark range has target === "note"
  │   └── multi-pipe [[a|b|c]] mark range has target === "a"
  ├── fetch version counter (race safety)
  │   └── dismissWikiPopover increments _hoverFetchVersion
  ├── CSS injection
  │   ├── injectWikiPopoverStyles inserts style tag (idempotent)
  │   └── removeWikiPopoverStyles removes the tag
  └── edge cases
      ├── EC-01: file not found (ok: false) — popover not shown
      ├── EC-07: null __MARKABLE_CURRENT_FILE__ — popover not shown
      └── EC-12: empty target string — no crash
```

---

## Detailed Test Specifications

### Suite: `extractPopoverContent`

All tests in this suite are pure: no DOM, no window globals needed (except
where `__MARKABLE_VAULT_MANAGER__` affects `pathLabel`).

**Test 1 — YAML front matter title**

```typescript
it("extracts title from YAML front matter", () => {
  const raw = `---\ntitle: My Note\n---\n\nSome body text here.`;
  const { title } = extractPopoverContent(raw, "/vault/my-note.md");
  expect(title).toBe("My Note");
});
```

**Test 2 — YAML front matter title with quotes**

```typescript
it("strips quotes from YAML front matter title", () => {
  const raw = `---\ntitle: "Quoted Title"\n---\n\nBody.`;
  const { title } = extractPopoverContent(raw, "/vault/x.md");
  expect(title).toBe("Quoted Title");
});
```

**Test 3 — H1 heading fallback**

```typescript
it("falls through to H1 heading when no front matter title", () => {
  const raw = `# My Heading\n\nSome body text.`;
  const { title } = extractPopoverContent(raw, "/vault/x.md");
  expect(title).toBe("My Heading");
});
```

**Test 4 — Filename stem fallback**

```typescript
it("falls through to filename stem when no front matter and no H1", () => {
  const raw = `Some body text without any heading.`;
  const { title } = extractPopoverContent(raw, "/vault/my-document.md");
  expect(title).toBe("my-document");
});
```

**Test 5 — File longer than 2048 bytes**

```typescript
it("caps content at 2048 characters before processing", () => {
  // Create content where the 'secret' word appears only after 2048 chars
  const prefix = "a".repeat(2048);
  const raw = prefix + " secret content";
  const { excerpt } = extractPopoverContent(raw, "/vault/large.md");
  expect(excerpt).not.toContain("secret");
});
```

**Test 6 — Front-matter-only file (EC-18)**

```typescript
it("returns empty excerpt for front-matter-only file", () => {
  const raw = `---\ntitle: Front Matter Only\nauthor: Test\n---\n`;
  const { excerpt } = extractPopoverContent(raw, "/vault/fm.md");
  expect(excerpt).toBe("");
});
```

**Test 7 — Empty file**

```typescript
it("returns filename stem as title and empty excerpt for empty file", () => {
  const { title, excerpt } = extractPopoverContent("", "/vault/empty-file.md");
  expect(title).toBe("empty-file");
  expect(excerpt).toBe("");
});
```

**Test 8 — Excerpt strips fenced code blocks**

```typescript
it("strips fenced code block contents from excerpt", () => {
  const raw = `Some text.\n\`\`\`js\nconst x = 1;\n\`\`\`\nMore text.`;
  const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
  expect(excerpt).not.toContain("const x");
  expect(excerpt).toContain("Some text");
  expect(excerpt).toContain("More text");
});
```

**Test 9 — Excerpt strips heading markers**

```typescript
it("strips heading markers from excerpt", () => {
  const raw = `## Section Header\n\nBody text.`;
  const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
  expect(excerpt).not.toContain("##");
  expect(excerpt).toContain("Section Header");
});
```

**Test 10 — Excerpt strips bold/italic markers**

```typescript
it("strips bold and italic markers from excerpt", () => {
  const raw = `This is **bold** and _italic_ text.`;
  const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
  expect(excerpt).not.toMatch(/\*|\*/);
  expect(excerpt).toContain("bold");
  expect(excerpt).toContain("italic");
});
```

**Test 11 — pathLabel without vault manager**

```typescript
it("falls back to filename when no vault manager", () => {
  // window.__MARKABLE_VAULT_MANAGER__ is undefined in test env
  const { pathLabel } = extractPopoverContent("Body", "/some/path/note.md");
  expect(pathLabel).toBe("note.md");
});
```

**Test 12 — Excerpt truncated at 200 words adds ellipsis**

```typescript
it("truncates excerpt at 200 words and adds ellipsis", () => {
  const raw = Array.from({ length: 250 }, (_, i) => `word${i}`).join(" ");
  const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
  const wordCount = excerpt.replace(/\u2026$/, "").trim().split(/\s+/).length;
  expect(wordCount).toBe(200);
  expect(excerpt.endsWith("\u2026")).toBe(true);
});
```

---

### Suite: `positionPopover`

These tests require jsdom (the vitest environment). Mock `getBoundingClientRect`
and `window.innerWidth`/`window.innerHeight`.

**Setup helper:**

```typescript
function makeSpan(rect: { left: number; right: number; top: number; bottom: number }): HTMLElement {
  const el = document.createElement("span");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: rect.left, right: rect.right,
    top: rect.top, bottom: rect.bottom,
    width: rect.right - rect.left, height: rect.bottom - rect.top,
    x: rect.left, y: rect.top, toJSON: () => {}
  } as DOMRect);
  return el;
}

function makePopover(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}
```

**Test 13 — Span in viewport middle (default positioning)**

```typescript
it("positions popover below span when span is in the viewport middle", () => {
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  const span = makeSpan({ left: 400, right: 500, top: 300, bottom: 320 });
  const popover = makePopover();

  positionPopover(span, popover);

  const top = parseFloat(popover.style.top);
  const left = parseFloat(popover.style.left);
  expect(top).toBeGreaterThanOrEqual(320 + 8); // below span (bottom + gap)
  expect(left).toBe(400); // left-aligned with span
});
```

**Test 14 — Span near right edge**

```typescript
it("clamps popover left so it does not overflow right viewport edge", () => {
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  // Span at right edge; 320px popover would overflow
  const span = makeSpan({ left: 900, right: 950, top: 300, bottom: 320 });
  const popover = makePopover();

  positionPopover(span, popover);

  const left = parseFloat(popover.style.left);
  // left + 320 must not exceed 1000 - 16 = 984
  expect(left + 320).toBeLessThanOrEqual(984);
});
```

**Test 15 — Span near bottom edge**

```typescript
it("flips popover above span when span is near the bottom of the viewport", () => {
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  // Span near the bottom; popover would overflow below
  const span = makeSpan({ left: 400, right: 500, top: 550, bottom: 570 });
  const popover = makePopover();

  positionPopover(span, popover);

  const top = parseFloat(popover.style.top);
  // Popover should be above the span
  expect(top).toBeLessThan(550);
});
```

---

### Suite: `computeWikiLinkDecorationRanges` — data-wiki-target

These extend the existing decoration tests by also asserting the `target` field.

**Test 16 — Simple wiki-link mark range has correct target**

```typescript
it("mark range for simple [[note]] has target === 'note'", () => {
  const ranges = computeWikiLinkDecorationRanges(
    "See [[note]] here",
    new Set<number>(),
    [{ from: 0, to: 17 }]
  );
  const markRange = ranges.find(r => r.type === "mark");
  expect(markRange).toBeDefined();
  expect(markRange!.target).toBe("note");
});
```

**Test 17 — Piped wiki-link mark range has target before pipe**

```typescript
it("mark range for [[target|display]] has target === 'target'", () => {
  const ranges = computeWikiLinkDecorationRanges(
    "[[target|display text]]",
    new Set<number>(),
    [{ from: 0, to: 23 }]
  );
  const markRange = ranges.find(r => r.type === "mark");
  expect(markRange).toBeDefined();
  expect(markRange!.target).toBe("target");
});
```

**Test 18 — Multi-pipe wiki-link mark range has only first segment as target (EC-11)**

```typescript
it("mark range for [[a|b|c]] has target === 'a' (EC-11)", () => {
  const ranges = computeWikiLinkDecorationRanges(
    "[[a|b|c]]",
    new Set<number>(),
    [{ from: 0, to: 9 }]
  );
  const markRange = ranges.find(r => r.type === "mark");
  expect(markRange).toBeDefined();
  expect(markRange!.target).toBe("a");
});
```

---

### Suite: CSS Injection

**Test 19 — injectWikiPopoverStyles inserts one style tag (idempotent)**

```typescript
it("injectWikiPopoverStyles inserts exactly one style tag", () => {
  removeWikiPopoverStyles(); // clean slate
  injectWikiPopoverStyles();
  injectWikiPopoverStyles(); // second call is no-op
  const tags = document.querySelectorAll("[data-markable-wiki-popover-styles]");
  expect(tags).toHaveLength(1);
  removeWikiPopoverStyles(); // cleanup
});
```

**Test 20 — removeWikiPopoverStyles removes the tag**

```typescript
it("removeWikiPopoverStyles removes the injected style tag", () => {
  injectWikiPopoverStyles();
  removeWikiPopoverStyles();
  const tags = document.querySelectorAll("[data-markable-wiki-popover-styles]");
  expect(tags).toHaveLength(0);
});
```

**Test 21 — removeWikiPopoverStyles does not throw if no tag**

```typescript
it("removeWikiPopoverStyles is safe to call when no tag exists", () => {
  removeWikiPopoverStyles();
  expect(() => removeWikiPopoverStyles()).not.toThrow();
});
```

---

### Suite: Edge Cases

**Test 22 — EC-07: null `__MARKABLE_CURRENT_FILE__` → no popover shown**

This test exercises `showWikiPopover` indirectly by simulating the 180 ms timer.
Since `showWikiPopover` is not exported, test via the observable side effect:
`_activePopoverEl` stays null and no `<div data-markable-wiki-popover>` appears
in the DOM.

Approach: mock `window.__MARKABLE_CURRENT_FILE__` to null, call the show function
via a timer tick (use fake timers). Since we cannot import `showWikiPopover`
directly, this test must be implemented as an integration test that uses
`vi.useFakeTimers`, triggers a DOM hover event, and checks the outcome.

Alternative: extend `_testing` to expose `showWikiPopover` for testing:

```typescript
// In _testing accessor (backlinks.plugin.ts):
showWikiPopoverForTest: showWikiPopover,
```

Or, simpler: add `showWikiPopover` as an export with a note that it is
exported-for-test only. This is the recommended approach, consistent with how
`computeWikiLinkDecorationRanges` is exported despite being an internal detail.

```typescript
// In hover-popover.test.ts:
it("EC-07: shows nothing when __MARKABLE_CURRENT_FILE__ is null", async () => {
  (window as any).__MARKABLE_CURRENT_FILE__ = null;
  // Enable the plugin's _enabled flag is a prerequisite;
  // since we cannot set it directly, this test calls showWikiPopover directly
  // by exporting it, and checks that no popover is added to the DOM.
  const span = document.createElement("span");
  document.body.appendChild(span);
  await showWikiPopover(span, "some-target");
  const popovers = document.querySelectorAll("[data-markable-wiki-popover]");
  expect(popovers).toHaveLength(0);
  span.remove();
});
```

Note: `showWikiPopover` checks `_enabled` first. In tests, `_enabled` is false
(plugin not started). The function will return early before the null-file check.
To test EC-07 in isolation, either: (a) export `showWikiPopover` and add a way to
set `_enabled` in `_testing`, or (b) test the null-file guard as part of a
full-lifecycle integration test that calls `plugin.onEnable(mockApi)` first.

**Recommended approach for EC-07**: Extend the `_testing` accessor:

```typescript
// In _testing:
setEnabled(val: boolean): void { _enabled = val; },
getHoverFetchVersion(): number { return _hoverFetchVersion; },
getActivePopoverEl(): HTMLElement | null { return _activePopoverEl; },
```

Then in the test:

```typescript
it("EC-07: shows nothing when __MARKABLE_CURRENT_FILE__ is null", async () => {
  _testing.setEnabled(true);
  (window as any).__MARKABLE_CURRENT_FILE__ = null;
  (window as any).__TAURI_INTERNALS__ = undefined;
  const span = document.createElement("span");
  await showWikiPopover(span, "target");
  expect(_testing.getActivePopoverEl()).toBeNull();
  _testing.setEnabled(false);
});
```

**Test 23 — EC-01: file not found → popover not shown**

```typescript
it("EC-01: shows nothing when invokeReadFile returns ok: false", async () => {
  _testing.setEnabled(true);
  (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn().mockRejectedValue(new Error("File not found")),
  };
  const span = document.createElement("span");
  await showWikiPopover(span, "nonexistent");
  expect(_testing.getActivePopoverEl()).toBeNull();
  _testing.setEnabled(false);
});
```

**Test 24 — EC-12: empty target string → no crash**

```typescript
it("EC-12: empty target string does not crash", async () => {
  _testing.setEnabled(true);
  (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn().mockRejectedValue(new Error("invalid path")),
  };
  const span = document.createElement("span");
  // Should not throw
  await expect(showWikiPopover(span, "")).resolves.toBeUndefined();
  expect(_testing.getActivePopoverEl()).toBeNull();
  _testing.setEnabled(false);
});
```

**Test 25 — Race condition: fetch version counter**

```typescript
it("dismissWikiPopover increments _hoverFetchVersion (race safety)", () => {
  const before = _testing.getHoverFetchVersion();
  dismissWikiPopover();
  const after = _testing.getHoverFetchVersion();
  expect(after).toBe(before + 1);
});
```

---

## Required `_testing` Accessor Additions

The following additions are needed to `_testing` in `backlinks.plugin.ts` to
support the EC-07, EC-01, and EC-12 tests:

```typescript
// In the _testing object:
setEnabled(val: boolean): void { _enabled = val; },
getHoverFetchVersion(): number { return _hoverFetchVersion; },
getActivePopoverEl(): HTMLElement | null { return _activePopoverEl; },
```

These are testing-only surface additions consistent with the existing `_testing`
pattern. They must not be used in production code.

If `showWikiPopover` is not exported, add it to `_testing` as well:

```typescript
showWikiPopoverForTest(spanEl: HTMLElement, target: string): Promise<void> {
  return showWikiPopover(spanEl, target);
},
```

---

## Pre-existing Test Regression Guard

After implementing all steps, run the full test suite:

```bash
npm run test:run -- tests/plugins/backlinks/backlinks.test.ts
npm run test:run -- tests/plugins/backlinks/hover-popover.test.ts
```

The first command must pass with zero failures (FR-10.6). The second command
must pass all 25 tests listed above.

The step_01 change to `WikiLinkDecorationRange` (adding optional `target` field)
does not break any existing assertions since tests assert `from`, `to`, `type`
fields only. The only risk is if any test asserts the exact object shape of the
range and would fail if an extra property is present. Review the existing
`computeWikiLinkDecorationRanges` tests before merging.

## Coverage Notes

The following edge cases from the requirements are covered by test number:

| EC | Test |
|----|------|
| EC-01 | Test 23 |
| EC-03 | Test 5 |
| EC-04 | Test 25 (partial — via version increment on dismiss) |
| EC-07 | Test 22 |
| EC-09 | Test 17 (piped link target is before pipe) |
| EC-11 | Test 18 (multi-pipe) |
| EC-12 | Test 24 |
| EC-18 | Test 6 (front-matter-only) |

EC-02, EC-05, EC-06, EC-08, EC-10, EC-13, EC-14, EC-15, EC-16, EC-17, EC-19
are addressed by design (existing helpers handle them) and are not separately
tested at unit level. EC-08 (grace period) is verified at integration level via
the state machine documentation in step_03.
