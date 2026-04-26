---
title: "Table Toolbar — Step 04: Floating UI DOM + Positioning"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 04 — Floating UI DOM (Top Bar, Row Handle, Bottom Pill) + Positioning

## Goal

Implement the three floating DOM elements (top bar, row handle + inline menu,
bottom pill), the full CSS ruleset, and the positioning/visibility helpers.
After this step the three elements are correctly created, styled, positioned,
shown, and hidden. No CM6 wiring yet — that is step_06.

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Fill sections 4, 7, 8 |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Add floating-UI DOM tests |

---

## Implementation Notes

### 1. Full TOOLBAR_CSS (Section 4)

Replace the placeholder CSS from step_01 with the full ruleset. All colours MUST
use CSS custom properties for theme adoption (FR-9).

```css
/* ── Shared container base ── */
.tbl-toolbar {
  position: fixed;
  z-index: 10000;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  display: none;          /* hidden by default; show/hide via JS */
}

/* ── Top bar ── */
.tbl-toolbar--top {
  display: none;
  flex-direction: row;
  gap: 4px;
  padding: 5px 8px;
}
.tbl-toolbar--top.tbl-toolbar--visible {
  display: flex;
}

/* ── Buttons ── */
.tbl-toolbar__btn {
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tbl-toolbar__btn:hover {
  background: var(--selection-bg);
}
.tbl-toolbar__btn--disabled {
  opacity: 0.35;
  pointer-events: none;
  cursor: default;
}

/* ── Row handle ── */
.tbl-toolbar__row-handle {
  position: fixed;
  z-index: 10000;
  display: none;
  width: 20px;
  height: 20px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 4px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-secondary);
  user-select: none;
}
.tbl-toolbar__row-handle.tbl-toolbar--visible {
  display: flex;
}

/* ── Row handle menu ── */
.tbl-toolbar__row-menu {
  position: fixed;
  z-index: 10001;
  display: none;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.30);
  overflow: hidden;
  min-width: 160px;
}
.tbl-toolbar__row-menu.tbl-toolbar--open {
  display: flex;
}
.tbl-toolbar__row-menu-item {
  padding: 7px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  background: none;
  border: none;
  text-align: left;
  white-space: nowrap;
}
.tbl-toolbar__row-menu-item:hover {
  background: var(--selection-bg);
}
.tbl-toolbar__row-menu-item--disabled {
  opacity: 0.35;
  pointer-events: none;
}

/* ── Bottom pill ── */
.tbl-toolbar__bottom-pill {
  position: fixed;
  z-index: 10000;
  display: none;
  width: 28px;
  height: 18px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 9px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--text-secondary);
  user-select: none;
}
.tbl-toolbar__bottom-pill.tbl-toolbar--visible {
  display: flex;
}

/* ── Sidebar mode override ── */
.sidebar-panel-content .tbl-toolbar-sidebar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}
.sidebar-panel-content .tbl-toolbar__btn {
  width: auto;
  height: 28px;
  justify-content: flex-start;
  padding: 0 8px;
  font-size: 13px;
}
```

### 2. buildTopBar (Section 7)

```typescript
/**
 * Button config for the top bar.
 * Each entry: [data-action, icon-text, tooltip]
 */
const TOP_BAR_BUTTONS = [
  ["insert-col-left",  "◁+", "Insert Column Left"],
  ["insert-col-right", "+▷", "Insert Column Right"],
  ["align-left",       "⇤",  "Align Left"],
  ["align-center",     "⇔",  "Align Center"],
  ["align-right",      "⇥",  "Align Right"],
  ["delete-col",       "✕col", "Delete Column"],
  ["delete-table",     "⊠",  "Delete Table"],
] as const;

function buildTopBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.id        = "__markable_tbl_top_bar__";
  bar.className = "tbl-toolbar tbl-toolbar--top";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Table column controls");

  for (const [action, icon, title] of TOP_BAR_BUTTONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tbl-toolbar__btn";
    btn.dataset["action"] = action;
    btn.title = title;
    btn.textContent = icon;
    bar.appendChild(btn);
  }

  // Delegated mousedown — prevent editor focus steal.
  bar.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    // dispatch handled in step_07
  });

  return bar;
}
```

### 3. buildRowHandle and buildRowMenu (Section 7)

```typescript
function buildRowHandle(): HTMLElement {
  const handle = document.createElement("div");
  handle.id        = "__markable_tbl_row_handle__";
  handle.className = "tbl-toolbar__row-handle";
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Row options");
  handle.title = "Row options";
  handle.textContent = "≡";
  return handle;
}

function buildRowMenu(): HTMLElement {
  const menu = document.createElement("div");
  menu.id        = "__markable_tbl_row_menu__";
  menu.className = "tbl-toolbar__row-menu";
  menu.setAttribute("role", "menu");

  const items = [
    ["insert-row-above", "Insert Row Above"],
    ["insert-row-below", "Insert Row Below"],
    ["delete-row",       "Delete Row"],
  ] as const;

  for (const [action, label] of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tbl-toolbar__row-menu-item";
    btn.dataset["action"] = action;
    btn.textContent = label;
    menu.appendChild(btn);
  }

  // Delegated mousedown — prevent editor focus steal + dispatch (step_07).
  menu.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    // dispatch handled in step_07
  });

  return menu;
}
```

The row handle click handler (wired in step_07) toggles the menu open/closed:
```typescript
handle.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  toggleRowMenu();
});
```

`toggleRowMenu()` implementation:
```typescript
function toggleRowMenu(): void {
  if (!_rowMenu) return;
  const isOpen = _rowMenu.classList.contains("tbl-toolbar--open");
  if (isOpen) {
    _rowMenu.classList.remove("tbl-toolbar--open");
  } else {
    _rowMenu.classList.add("tbl-toolbar--open");
    // Position menu just below/right of the row handle
    if (_rowHandle) {
      const hRect = _rowHandle.getBoundingClientRect();
      _rowMenu.style.top  = `${hRect.bottom + 2}px`;
      _rowMenu.style.left = `${hRect.left}px`;
    }
  }
}
```

The outside-click listener (wired in `onEnable` — see step_01):
```typescript
_outsideClickListener = (e: MouseEvent) => {
  if (!_rowMenu) return;
  if (_rowMenu.contains(e.target as Node)) return;
  if (_rowHandle && _rowHandle.contains(e.target as Node)) return;
  _rowMenu.classList.remove("tbl-toolbar--open");
};
document.addEventListener("mousedown", _outsideClickListener);
```

### 4. buildBottomPill (Section 7)

```typescript
function buildBottomPill(): HTMLElement {
  const pill = document.createElement("div");
  pill.id        = "__markable_tbl_bottom_pill__";
  pill.className = "tbl-toolbar__bottom-pill";
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-label", "Add row");
  pill.title = "Add row";
  pill.textContent = "+";

  pill.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    // dispatch handled in step_07
  });

  return pill;
}
```

### 5. clampPosition helper (Section 8)

```typescript
/**
 * Clamp `left` so the element of width `elWidth` stays within the viewport.
 * EC-15: prevents the top bar from overflowing the right or left viewport edge.
 */
function clampHorizontal(left: number, elWidth: number): number {
  const maxLeft = window.innerWidth - elWidth - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;
  return left;
}
```

### 6. updateFloatingPositions (Section 8)

Called synchronously on every selection/doc change in the updateListener (AD-8).

```typescript
/**
 * Recompute the positions of all three floating elements using coordsAtPos.
 *
 * The view parameter is the live CM6 EditorView from the updateListener.
 * tableFrom and tableTo are the absolute document offsets of the current table.
 * rowFrom is the absolute offset of the start of the current row.
 *
 * All elements that cannot be positioned (coordsAtPos returns null — element
 * scrolled out of view) are hidden (EC-16).
 */
function updateFloatingPositions(
  view: EditorViewType,
  tableFrom: number,
  tableTo: number,
  rowFrom: number,
): void {
  const VERT_GAP = 8;

  // ── Top bar ─────────────────────────────────────────────────────────────────
  if (_topBar) {
    const topCoords = view.coordsAtPos(tableFrom);
    if (!topCoords) {
      _topBar.style.display = "none";
    } else {
      const barHeight = _topBar.offsetHeight || 36;
      const barWidth  = _topBar.offsetWidth  || 260;

      // Preferred: above the first table line.
      let top = topCoords.top - barHeight - VERT_GAP;

      // EC-14: if no room above, flip to below the last table line.
      if (top < 0) {
        const bottomCoords = view.coordsAtPos(tableTo);
        if (bottomCoords) {
          top = bottomCoords.bottom + VERT_GAP;
        } else {
          top = topCoords.bottom + VERT_GAP;
        }
      }

      const left = clampHorizontal(topCoords.left, barWidth);

      _topBar.style.top     = `${top}px`;
      _topBar.style.left    = `${left}px`;
      _topBar.classList.add("tbl-toolbar--visible");
    }
  }

  // ── Row handle ──────────────────────────────────────────────────────────────
  if (_rowHandle) {
    const rowCoords = view.coordsAtPos(rowFrom);
    if (!rowCoords) {
      // EC-16: row scrolled out of view — hide handle.
      _rowHandle.classList.remove("tbl-toolbar--visible");
      _rowMenu?.classList.remove("tbl-toolbar--open");
    } else {
      const handleHeight = _rowHandle.offsetHeight || 20;
      // Vertically centred on the row line.
      const top  = rowCoords.top + (rowCoords.bottom - rowCoords.top) / 2 - handleHeight / 2;
      // Left-edge of editor minus handle width minus 6px gap.
      const editorRect = view.dom.getBoundingClientRect();
      const left = editorRect.left - (_rowHandle.offsetWidth || 20) - 6;

      _rowHandle.style.top  = `${top}px`;
      _rowHandle.style.left = `${Math.max(0, left)}px`;
      _rowHandle.classList.add("tbl-toolbar--visible");
    }
  }

  // ── Bottom pill ─────────────────────────────────────────────────────────────
  if (_bottomPill) {
    const bottomCoords = view.coordsAtPos(tableTo);
    if (!bottomCoords) {
      _bottomPill.classList.remove("tbl-toolbar--visible");
    } else {
      const pillHeight = _bottomPill.offsetHeight || 18;
      const top  = bottomCoords.bottom + VERT_GAP;
      const left = bottomCoords.left + 4;

      _bottomPill.style.top  = `${top}px`;
      _bottomPill.style.left = `${left}px`;
      _bottomPill.classList.add("tbl-toolbar--visible");
    }
  }
}
```

### 7. updateFloatingVisibility (Section 8)

Called from the debounced branch of the updateListener. Shows or hides all three
elements based on whether the cursor is currently inside a table.

```typescript
/**
 * Show or hide all three floating elements.
 * When `context` is null (cursor outside table), all elements are hidden
 * and the row menu is closed.
 */
function updateFloatingVisibility(context: TableContext | null): void {
  if (context === null) {
    _topBar?.classList.remove("tbl-toolbar--visible");
    _rowHandle?.classList.remove("tbl-toolbar--visible");
    _rowMenu?.classList.remove("tbl-toolbar--open");
    _bottomPill?.classList.remove("tbl-toolbar--visible");
    return;
  }

  // Visibility is shown — positions are set by the synchronous path.
  // We update disabled states for the top bar buttons here.
  updateTopBarButtonStates(context);
}
```

### 8. updateTopBarButtonStates (Section 8)

```typescript
/**
 * Enable/disable top bar buttons based on the current TableContext.
 *
 * Disabled conditions:
 *   - delete-col: disabled when columnCount <= 1 (EC-3)
 *   - delete-col: also disabled when isSeparatorRow (EC-2 — no row context,
 *     but delete-col is column-level so it remains enabled on separator)
 *     NOTE: per requirements, column operations remain enabled on separator (EC-2).
 *     Only ROW operations are disabled on separator. delete-col is a column op → enabled.
 */
function updateTopBarButtonStates(context: TableContext | null): void {
  if (!_topBar) return;
  const buttons = _topBar.querySelectorAll<HTMLButtonElement>("[data-action]");

  for (const btn of buttons) {
    const action = btn.dataset["action"];
    let disabled = false;

    if (context === null) {
      disabled = true;
    } else if (action === "delete-col") {
      disabled = context.columnCount <= 1; // EC-3
    }
    // All other top-bar buttons (col insert, align, delete-table) are always
    // enabled when inside a table.

    if (disabled) {
      btn.classList.add("tbl-toolbar__btn--disabled");
    } else {
      btn.classList.remove("tbl-toolbar__btn--disabled");
    }
  }
}
```

---

## Test Cases (must all pass before step is done)

File: add to `tests/plugins/table-toolbar/table-toolbar.test.ts`

Use `jsdom` (provided by Vitest). No real CM6 EditorView needed for DOM
construction tests — mock `view.coordsAtPos` and `view.dom.getBoundingClientRect`.

### DOM construction tests

```
describe("buildTopBar") {
  it("creates element with correct id") {
    const el = buildTopBar(); // exported for testing
    expect(el.id).toBe("__markable_tbl_top_bar__");
  }
  it("has 7 buttons") {
    const el = buildTopBar();
    expect(el.querySelectorAll(".tbl-toolbar__btn")).toHaveLength(7);
  }
  it("buttons have data-action attributes") {
    const el = buildTopBar();
    const actions = [...el.querySelectorAll("[data-action]")].map(b => b.getAttribute("data-action"));
    expect(actions).toContain("insert-col-left");
    expect(actions).toContain("delete-table");
  }
}

describe("buildRowHandle") {
  it("creates element with correct id") {
    const el = buildRowHandle();
    expect(el.id).toBe("__markable_tbl_row_handle__");
  }
}

describe("buildRowMenu") {
  it("creates element with correct id") {
    const el = buildRowMenu();
    expect(el.id).toBe("__markable_tbl_row_menu__");
  }
  it("has 3 menu item buttons") {
    const el = buildRowMenu();
    expect(el.querySelectorAll(".tbl-toolbar__row-menu-item")).toHaveLength(3);
  }
  it("menu item actions are correct") {
    const el = buildRowMenu();
    const actions = [...el.querySelectorAll("[data-action]")].map(b => b.getAttribute("data-action"));
    expect(actions).toEqual(["insert-row-above", "insert-row-below", "delete-row"]);
  }
}

describe("buildBottomPill") {
  it("creates element with correct id") {
    const el = buildBottomPill();
    expect(el.id).toBe("__markable_tbl_bottom_pill__");
  }
  it("has + text content") {
    const el = buildBottomPill();
    expect(el.textContent).toBe("+");
  }
}
```

### clampHorizontal

```
describe("clampHorizontal") {
  it("clamps to right edge") {
    // window.innerWidth = 1000 (jsdom default)
    expect(clampHorizontal(980, 100)).toBeLessThanOrEqual(900);
  }
  it("clamps to left edge") {
    expect(clampHorizontal(-10, 100)).toBeGreaterThanOrEqual(8);
  }
  it("does not clamp when within bounds") {
    expect(clampHorizontal(100, 100)).toBe(100);
  }
}
```

### updateTopBarButtonStates

```
describe("updateTopBarButtonStates") {
  it("disables delete-col when columnCount is 1 (EC-3)") {
    const bar = buildTopBar();
    document.body.appendChild(bar);
    const ctx: TableContext = { ..., columnCount: 1, ... };
    updateTopBarButtonStates(ctx);
    const btn = bar.querySelector("[data-action='delete-col']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
  }
  it("enables delete-col when columnCount > 1") {
    const bar = buildTopBar();
    document.body.appendChild(bar);
    const ctx: TableContext = { ..., columnCount: 3, ... };
    updateTopBarButtonStates(ctx);
    const btn = bar.querySelector("[data-action='delete-col']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(false);
  }
  it("disables all buttons when context is null (EC-12)") {
    const bar = buildTopBar();
    document.body.appendChild(bar);
    updateTopBarButtonStates(null);
    const buttons = bar.querySelectorAll(".tbl-toolbar__btn");
    for (const btn of buttons) {
      expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
    }
  }
}
```

### updateFloatingVisibility

```
describe("updateFloatingVisibility") {
  it("hides all three elements when context is null (EC-12)") {
    // Set up module state with mock elements, then call updateFloatingVisibility(null)
    // All three elements should not have tbl-toolbar--visible
  }
  it("closes row menu when context is null") {
    // _rowMenu with tbl-toolbar--open → updateFloatingVisibility(null) → class removed
  }
}
```

---

## Definition of Done

- [ ] Full TOOLBAR_CSS implemented (all classes and rules as specified).
- [ ] `buildTopBar`, `buildRowHandle`, `buildRowMenu`, `buildBottomPill`
      implemented (not stubs).
- [ ] `clampHorizontal`, `updateFloatingPositions`, `updateFloatingVisibility`,
      `updateTopBarButtonStates` implemented.
- [ ] All DOM construction tests pass.
- [ ] All positioning tests pass.
- [ ] EC-14, EC-15, EC-16 verified by positioning test cases.
- [ ] No TypeScript errors.
