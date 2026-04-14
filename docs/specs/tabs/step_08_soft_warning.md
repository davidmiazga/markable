---
title: "Tabs Step 08 — Soft Tab Count Warning"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 08 — Soft Tab Count Warning

**Goal:** Implement the visual warning indicator that appears when `tabs.length > TAB_SOFT_WARNING_THRESHOLD`. No hard cap is enforced. The user can continue opening tabs indefinitely.

**App state after this step:** When the user opens more than 30 tabs (or whatever the threshold constant is), a visual indicator appears in the tab strip. No functionality is blocked.

---

## What "Soft Warning" Means

Per FR-9 and the locked decisions:
- A visual indicator is shown in the tab strip.
- No hard cap — new tabs can still be opened beyond the threshold.
- `TAB_SOFT_WARNING_THRESHOLD = 30` defined as a constant in `tab-types.ts` (already done in step_01). This is the single place to change the threshold.

---

## Warning Indicator Design

The warning indicator varies slightly by renderer mode. All three renderers must handle it because `_notifyRenderer()` calls `update()` after every tab open.

### Minimal mode

`#tab-strip` receives the CSS class `tab-over-limit` and the data attribute `data-tab-warning` when the threshold is exceeded. The CSS in step_02 already handles this:

```css
#tab-strip.tab-over-limit::after {
  content: attr(data-tab-warning);
  font-size: 10px;
  color: var(--tab-dot-dirty-indicator-color);
  margin-left: 4px;
  white-space: nowrap;
}
```

The `MinimalTabBar.update()` already sets this class and attribute in step_02. Verify:

```typescript
// In MinimalTabBar.update():
const overLimit = tabs.length > TAB_SOFT_WARNING_THRESHOLD;
container.classList.toggle("tab-over-limit", overLimit);
if (overLimit) {
  container.dataset.tabWarning = `${tabs.length} tabs open`;
} else {
  delete container.dataset.tabWarning;
}
```

### Regular mode

The "+" button gets class `tab-over-limit` when the threshold is exceeded. The button changes color (amber/warning) to signal the count. A `title` tooltip is added.

```typescript
// In RegularTabBar.update():
const overLimit = tabs.length > TAB_SOFT_WARNING_THRESHOLD;
this.newBtn.classList.toggle("tab-over-limit", overLimit);
if (overLimit) {
  this.newBtn.title = `${tabs.length} tabs open — consider closing some tabs`;
} else {
  this.newBtn.title = "New Tab (Cmd-T)";
}
```

CSS (add to `tabs.css`):

```css
.tab-new-btn.tab-over-limit {
  color: var(--tab-dot-dirty-indicator-color);
  position: relative;
}

.tab-new-btn.tab-over-limit::after {
  content: "!";
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 9px;
  font-weight: bold;
  line-height: 1;
}
```

### Vertical mode

A small badge or indicator appears at the bottom of the vertical strip.

```typescript
// In VerticalTabStrip.update():
const overLimit = tabs.length > TAB_SOFT_WARNING_THRESHOLD;
this.stripEl.classList.toggle("tab-over-limit", overLimit);
```

CSS for vertical (already in step_04's CSS additions):

```css
#tab-vertical-strip.tab-over-limit::after {
  content: "!";
  color: var(--tab-dot-dirty-indicator-color);
  font-size: 10px;
  font-weight: bold;
  padding: 4px;
}
```

---

## `TabManager` — no changes needed

`TabManager` already calls `_notifyRenderer()` after every tab open operation. The renderers check `tabs.length > TAB_SOFT_WARNING_THRESHOLD` in their `update()` methods. No new code in `TabManager` is needed for the warning.

---

## `TAB_SOFT_WARNING_THRESHOLD` Constant Placement

Confirm the constant is exported from `tab-types.ts` and imported wherever needed:

```typescript
// tab-types.ts (already from step_01)
export const TAB_SOFT_WARNING_THRESHOLD = 30;
```

Import in each renderer:
```typescript
import { TAB_SOFT_WARNING_THRESHOLD } from "../tab-types";
```

---

## EC-17: Session Restore Beyond Threshold

When session restore produces more tabs than the threshold (e.g., user had 35 tabs open), all tabs are restored and the warning indicator is shown. The warning is a cosmetic feature — it does not prevent restore. This is handled automatically because `init()` calls `_notifyRenderer()` after mounting, which triggers `update()` which checks the count.

---

## Tests to Write (`tests/tabs/soft-warning.test.ts`)

| Test | Covers |
|---|---|
| `MinimalTabBar.update` with 31 tabs adds `tab-over-limit` class | FR-9 |
| `MinimalTabBar.update` with 31 tabs sets `data-tab-warning` attribute | FR-9 |
| `MinimalTabBar.update` with 29 tabs does NOT add `tab-over-limit` | FR-9 |
| `RegularTabBar.update` with 31 tabs adds `tab-over-limit` to new button | FR-9 |
| `VerticalTabStrip.update` with 31 tabs adds `tab-over-limit` to strip | FR-9 |
| Session restore with 35 tabs shows warning after mount | EC-17 |
| Tab close that brings count from 31 to 30 removes warning indicator | FR-9 |

---

## Verification

After implementing step_08:
1. Open 31 tabs (use Cmd-T repeatedly).
2. In minimal mode: the tab strip shows a small "31 tabs open" label to the right of the dots.
3. Switch to regular mode: the "+" button turns amber/warning color.
4. Switch to vertical mode: a "!" indicator appears at the bottom of the vertical strip.
5. Close a tab to bring count to 30: warning disappears.
6. No hard cap — user can open tab 32, 33, etc. without any block.
7. Session restore with 35 tabs (simulate by manually editing `settings.json`) — all 35 restore and warning is shown.
