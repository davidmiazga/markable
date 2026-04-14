---
title: "Step 07 — Active State Highlighting and Final Integration"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 07 — Active State Highlighting and Final Integration

**Prerequisite:** step_06 complete and visually verified.
**Produces:** `updateActiveButtons` implemented; all EC cases covered by tests; plugin complete and deployable.

---

## Goal

Implement `updateActiveButtons`, add the build config entry (if not already done in step_01), run all tests, build the plugin, copy it to the plugins directory, and do a final visual verification pass against every acceptance criterion in `00_index.md`.

After this step the plugin is feature-complete for v1.0.

---

## Files Modified

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Add: `updateActiveButtons` |
| `tests/markdown-toolbar.test.ts` | Add: `updateActiveButtons` tests using DOM stubs |
| `vite.plugins.config.ts` | Verify entry exists (step_01 may have already added it) |

---

## Detailed Specification

### 1. updateActiveButtons

```typescript
export function updateActiveButtons(
  flags: FormatFlags,
  buttons: NodeListOf<HTMLButtonElement> | null
): void {
  if (!buttons) return;
  for (const btn of buttons) {
    const fmtId = btn.dataset["format"] as FormatId | undefined;
    if (!fmtId) continue;
    if (flags[fmtId]) {
      btn.classList.add("md-toolbar__btn--active");
    } else {
      btn.classList.remove("md-toolbar__btn--active");
    }
  }
}
```

This is exported so Vitest can test it with a mock NodeList.

**Notes:**
- The `erase` button's `flags["erase"]` is always `false` (by `detectFormats` contract), so it never receives the `--active` class. This is correct behaviour.
- The function is O(n) on the number of buttons (10) — negligible cost.

### 2. Export statement (verify)

Ensure all exported pure functions are present at the end of the file (or inline on their declarations). The complete export list:

```typescript
// These exports are for Vitest only — the IIFE loader does not use them.
export {
  mergeWithDefaults,
  DEFAULT_SETTINGS,
  isUrlLike,
  FORMATS,
  detectFormats,
  computeWrap,
  computeUnwrap,
  computeErase,
  updateActiveButtons,
  resolveUrl,
};
export type {
  ToolbarMode,
  SidebarSide,
  ToolbarSettings,
  FormatId,
  FormatDef,
  FormatFlags,
  WrapResult,
  UnwrapResult,
  EraseResult,
};
```

### 3. Tests for updateActiveButtons

In `tests/markdown-toolbar.test.ts`, add a test suite that exercises `updateActiveButtons` with a synthetic button NodeList.

Because `document.querySelectorAll` is not available in the Vitest JSDOM environment without setup, create buttons directly:

```typescript
function makeButtons(ids: FormatId[]): NodeListOf<HTMLButtonElement> {
  // Build a synthetic NodeList-like iterable using a real document fragment
  // JSDOM provides document in the test environment.
  const frag = document.createElement("div");
  for (const id of ids) {
    const btn = document.createElement("button");
    btn.dataset["format"] = id;
    frag.appendChild(btn);
  }
  return frag.querySelectorAll<HTMLButtonElement>("button");
}
```

Tests to add:

#### AC-7.1: Bold button gets active class when bold flag is true
```typescript
const buttons = makeButtons(FORMATS.map(f => f.id));
const flags = Object.fromEntries(FORMATS.map(f => [f.id, false])) as FormatFlags;
flags.bold = true;
updateActiveButtons(flags, buttons);
const boldBtn = [...buttons].find(b => b.dataset["format"] === "bold")!;
expect(boldBtn.classList.contains("md-toolbar__btn--active")).toBe(true);
```

#### AC-7.2: Active class removed when flag turns false
```typescript
// First call: set bold active
flags.bold = true;
updateActiveButtons(flags, buttons);
// Second call: clear bold
flags.bold = false;
updateActiveButtons(flags, buttons);
expect(boldBtn.classList.contains("md-toolbar__btn--active")).toBe(false);
```

#### AC-7.3: Multiple active buttons simultaneously (EC-3)
```typescript
flags.bold = true;
flags.italic = true;
updateActiveButtons(flags, buttons);
// Both bold and italic buttons have active class
```

#### AC-7.4: Erase button never active
```typescript
flags.erase = false;    // detectFormats always returns false for erase
updateActiveButtons(flags, buttons);
const eraseBtn = [...buttons].find(b => b.dataset["format"] === "erase")!;
expect(eraseBtn.classList.contains("md-toolbar__btn--active")).toBe(false);
```

#### AC-7.5: Null buttons — no crash
```typescript
expect(() => updateActiveButtons(allFalseFlags, null)).not.toThrow();
```

---

## Final Integration Checklist

Before marking the plugin complete, verify each item:

### Build verification
- [ ] `npm run build:plugins` exits 0
- [ ] `src-tauri/plugins/core/markdown-toolbar.js` exists
- [ ] File size is reasonable (< 50 KB unminified)
- [ ] No `require(` calls in the output (grep the file)
- [ ] `npm test` — all existing tests still pass; new tests pass

### Visual verification — floating mode
- [ ] AC-4.1: Toolbar appears on text selection
- [ ] AC-4.2: Toolbar disappears when selection cleared
- [ ] AC-4.3: Bold wrap works
- [ ] AC-4.4: Bold unwrap (toggle off) works
- [ ] AC-4.5: Link prompt appears when clipboard has non-URL text
- [ ] AC-4.6: Link uses clipboard URL silently
- [ ] AC-4.7: Cancel prompt leaves document unchanged
- [ ] AC-4.8: Erase strips multiple formats in one undo step
- [ ] AC-4.9: No duplicate toolbar on rapid toggle
- [ ] AC-4.10: Toolbar removed immediately on disable
- [ ] AC-4.11: Toolbar flips below selection when near viewport top
- [ ] AC-4.12: Editor focus preserved after button click
- [ ] Active state: Bold button highlights when cursor is inside `**text**`
- [ ] Active state: Both Bold and Italic highlight simultaneously for `***text***` (EC-3)

### Visual verification — sidebar mode
- [ ] AC-5.1: Panel appears in sidebar
- [ ] AC-5.2: Panel appears on correct side
- [ ] AC-5.3: Buttons greyed out when selection empty
- [ ] AC-5.4: Buttons enabled when text selected
- [ ] AC-5.5: Bold works in sidebar mode
- [ ] AC-5.6: Panel unregistered on disable
- [ ] AC-5.7: No duplicate panels after rapid toggle
- [ ] AC-5.8: Panel always visible (no hide-on-empty-selection)

### Edge case verification
- [ ] EC-11: Erase on plain text → no undo entry, no document change
- [ ] EC-15: No duplicate `<style>` tags after rapid enable/disable/enable
- [ ] EC-18: First run (no settings file) → floating mode, no crash
- [ ] EC-19: Partial settings object → missing key falls back to default

---

## Deploy Steps

After all checks pass:

```bash
npm run build:plugins
cp src-tauri/plugins/core/markdown-toolbar.js \
   ~/Library/Application\ Support/com.markable.app/plugins/core/
```

Then restart Markable and enable the Markdown Toolbar plugin via the Plugins Panel.

---

## Notes for the Developer

**This step completes the feature.** All prior steps must be merged before this step closes. Do not check off items in `00_index.md` until the corresponding AC passes.

**JSDOM and NodeList in tests.** Vitest uses JSDOM. `document.createElement` and `querySelectorAll` work in tests. The `makeButtons` helper above creates real DOM nodes via the JSDOM `document` — no special setup is required beyond what Vitest already provides.

**updateActiveButtons is exported.** Unlike other DOM functions (`buildToolbarDOM`, `updatePosition`), `updateActiveButtons` is exported because it accepts a `NodeListOf<HTMLButtonElement>` that can be created with JSDOM in tests, making it unit-testable without a full browser environment.
