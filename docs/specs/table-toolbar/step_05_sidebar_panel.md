---
title: "Table Toolbar — Step 05: Sidebar Panel Mode"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 05 — Sidebar Panel Mode

## Goal

Implement the sidebar panel: the `buildSidebarPanel` DOM factory and the
`updateSidebarButtonStates` function that enables/disables sidebar buttons based
on the current `TableContext`. After this step the sidebar panel can be registered,
rendered, and destroyed correctly. No CM6 wiring yet — button state updates are
stubs that will be triggered from step_06's updateListener.

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Fill section 9 |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Add sidebar panel tests |

---

## Implementation Notes

### 1. Sidebar button registry

```typescript
/**
 * All sidebar panel buttons in display order.
 * [data-action, label, alwaysEnabled]
 * alwaysEnabled: true → never disabled regardless of cursor position.
 */
const SIDEBAR_BUTTONS = [
  ["insert-table",      "Insert Table",       true ],
  ["insert-row-above",  "Insert Row Above",   false],
  ["insert-row-below",  "Insert Row Below",   false],
  ["delete-row",        "Delete Row",         false],
  ["insert-col-left",   "Insert Column Left", false],
  ["insert-col-right",  "Insert Column Right",false],
  ["delete-col",        "Delete Column",      false],
  ["align-left",        "Align Left",         false],
  ["align-center",      "Align Center",       false],
  ["align-right",       "Align Right",        false],
  ["delete-table",      "Delete Table",       false],
] as const;
```

### 2. buildSidebarPanel (Section 9)

```typescript
/**
 * Build the sidebar panel DOM element containing all 11 table operation buttons.
 *
 * The returned element is passed to `api.registerSidebarPanel`'s render callback.
 * Buttons are wired for click dispatch in step_07; here they are just DOM nodes.
 *
 * @returns The root panel element.
 */
function buildSidebarPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.id        = "__markable_tbl_sidebar_panel__";
  panel.className = "tbl-toolbar-sidebar";
  panel.setAttribute("role", "toolbar");
  panel.setAttribute("aria-label", "Table controls");

  for (const [action, label] of SIDEBAR_BUTTONS) {
    const btn = document.createElement("button");
    btn.type          = "button";
    btn.className     = "tbl-toolbar__btn";
    btn.dataset["action"] = action;
    btn.textContent   = label;
    btn.title         = label;
    panel.appendChild(btn);
  }

  // Delegated mousedown on panel container — prevent editor focus steal.
  panel.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    // dispatch handled in step_07
  });

  return panel;
}
```

### 3. updateSidebarButtonStates (Section 9)

```typescript
/**
 * Enable or disable sidebar buttons based on the current TableContext.
 *
 * Disabled rules (FR-3):
 *   - All non-alwaysEnabled buttons are disabled when context is null.
 *   - delete-row: also disabled when isHeaderRow (EC-1) or isSeparatorRow (EC-2).
 *   - delete-col: also disabled when columnCount <= 1 (EC-3).
 *   - insert-row-above, insert-row-below: disabled when isSeparatorRow (EC-2).
 *     NOTE: per FR-4, a cursor on the separator row means rowIndex is null;
 *     row operations are disabled; column and table ops remain enabled (EC-2).
 *
 * @param panel   - The sidebar panel element returned by buildSidebarPanel.
 * @param context - Current table context, or null when cursor is outside table.
 */
export function updateSidebarButtonStates(
  panel: HTMLElement,
  context: TableContext | null,
): void {
  const buttons = panel.querySelectorAll<HTMLButtonElement>("[data-action]");

  for (const btn of buttons) {
    const action      = btn.dataset["action"] as string;
    const alwaysEntry = SIDEBAR_BUTTONS.find(([a]) => a === action);
    const alwaysEnabled = alwaysEntry ? alwaysEntry[2] : false;

    if (alwaysEnabled) {
      btn.classList.remove("tbl-toolbar__btn--disabled");
      continue;
    }

    let disabled = context === null;

    if (!disabled && context !== null) {
      switch (action) {
        case "delete-row":
          // EC-1: disabled on header row. EC-2: disabled on separator.
          disabled = context.isHeaderRow || context.isSeparatorRow;
          break;
        case "insert-row-above":
        case "insert-row-below":
          // EC-2: disabled on separator row.
          disabled = context.isSeparatorRow;
          break;
        case "delete-col":
          // EC-3: disabled when only one column.
          disabled = context.columnCount <= 1;
          break;
        // All column align and insert operations remain enabled on separator row.
        // delete-table is always enabled when inside a table.
      }
    }

    if (disabled) {
      btn.classList.add("tbl-toolbar__btn--disabled");
    } else {
      btn.classList.remove("tbl-toolbar__btn--disabled");
    }
  }
}
```

### 4. Module-level sidebar panel element variable

Add to Section 3 (module-level state):

```typescript
let _sidebarPanelEl: HTMLElement | null = null;
```

This is the element built by `buildSidebarPanel()`, passed to `render()`, and
nulled in `onDisable` after the panel is unregistered.

### 5. onEnable sidebar path (update from step_01 skeleton)

In the sidebar branch of `onEnable`, replace the skeleton with:

```typescript
_sidebarPanelEl = buildSidebarPanel();

const sidebarDescriptor = {
  id:           "table-toolbar",
  title:        "Table Toolbar",
  side:         _settings.sidebarSide,
  defaultWidth: 200,

  render(container: HTMLElement): void {
    if (_sidebarPanelEl) {
      container.appendChild(_sidebarPanelEl);
    }
    // Initial disabled state: check if the editor is open and cursor is in a table.
    // If not available, default to all disabled.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
      | EditorViewType | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ctx = liveView ? detectTableContextFromState(liveView.state) : null;
    if (_sidebarPanelEl) {
      updateSidebarButtonStates(_sidebarPanelEl, ctx);
    }
  },

  destroy(_container: HTMLElement): void {
    _sidebarPanelEl = null;
  },
};

api.registerSidebarPanel(sidebarDescriptor);
_sidebarPanelRegistered = true;
```

### 6. onDisable sidebar path update

After `api.unregisterSidebarPanel("table-toolbar")`, also null `_sidebarPanelEl`:

```typescript
_sidebarPanelEl = null;
```

(The `destroy` callback nulls it first, but `onDisable` should be defensive.)

---

## Test Cases

### buildSidebarPanel

```
describe("buildSidebarPanel") {
  it("creates element with correct id") {
    const panel = buildSidebarPanel();
    expect(panel.id).toBe("__markable_tbl_sidebar_panel__");
  }
  it("has 11 buttons") {
    const panel = buildSidebarPanel();
    expect(panel.querySelectorAll(".tbl-toolbar__btn")).toHaveLength(11);
  }
  it("insert-table button is present") {
    const panel = buildSidebarPanel();
    expect(panel.querySelector("[data-action='insert-table']")).not.toBeNull();
  }
  it("all required actions are present") {
    const panel = buildSidebarPanel();
    const expected = [
      "insert-table", "insert-row-above", "insert-row-below", "delete-row",
      "insert-col-left", "insert-col-right", "delete-col",
      "align-left", "align-center", "align-right", "delete-table",
    ];
    for (const action of expected) {
      expect(panel.querySelector(`[data-action='${action}']`)).not.toBeNull();
    }
  }
}
```

### updateSidebarButtonStates

```
describe("updateSidebarButtonStates") {
  let panel: HTMLElement;
  beforeEach(() => { panel = buildSidebarPanel(); });

  const makeCtx = (overrides: Partial<TableContext> = {}): TableContext => ({
    tableFrom: 0, tableTo: 100, tableText: "",
    rowIndex: 2, colIndex: 0,
    isHeaderRow: false, isSeparatorRow: false,
    columnCount: 3, rowCount: 4,
    ...overrides,
  });

  it("insert-table is always enabled regardless of context") {
    updateSidebarButtonStates(panel, null);
    const btn = panel.querySelector("[data-action='insert-table']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(false);
  }

  it("non-alwaysEnabled buttons disabled when context is null") {
    updateSidebarButtonStates(panel, null);
    const btn = panel.querySelector("[data-action='delete-row']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
  }

  it("delete-row disabled on header row (EC-1)") {
    updateSidebarButtonStates(panel, makeCtx({ rowIndex: 0, isHeaderRow: true }));
    const btn = panel.querySelector("[data-action='delete-row']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
  }

  it("delete-row disabled on separator row (EC-2)") {
    updateSidebarButtonStates(panel, makeCtx({ rowIndex: null, isSeparatorRow: true }));
    const btn = panel.querySelector("[data-action='delete-row']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
  }

  it("insert-row-above disabled on separator row (EC-2)") {
    updateSidebarButtonStates(panel, makeCtx({ rowIndex: null, isSeparatorRow: true }));
    const btn = panel.querySelector("[data-action='insert-row-above']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
  }

  it("column ops remain enabled on separator row (EC-2)") {
    updateSidebarButtonStates(panel, makeCtx({ rowIndex: null, isSeparatorRow: true, columnCount: 3 }));
    const btn = panel.querySelector("[data-action='insert-col-left']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(false);
  }

  it("delete-col disabled when columnCount is 1 (EC-3)") {
    updateSidebarButtonStates(panel, makeCtx({ columnCount: 1 }));
    const btn = panel.querySelector("[data-action='delete-col']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(true);
  }

  it("delete-col enabled when columnCount > 1") {
    updateSidebarButtonStates(panel, makeCtx({ columnCount: 3 }));
    const btn = panel.querySelector("[data-action='delete-col']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(false);
  }

  it("all non-alwaysEnabled buttons enabled on normal body row context") {
    updateSidebarButtonStates(panel, makeCtx());
    const nonAlways = [
      "insert-row-above", "insert-row-below", "delete-row",
      "insert-col-left",  "insert-col-right", "delete-col",
      "align-left",       "align-center",     "align-right",
      "delete-table",
    ];
    for (const action of nonAlways) {
      const btn = panel.querySelector(`[data-action='${action}']`)!;
      expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(false);
    }
  }

  it("delete-table always enabled when inside table (not in EC-3 bucket)") {
    updateSidebarButtonStates(panel, makeCtx({ columnCount: 1 }));
    const btn = panel.querySelector("[data-action='delete-table']")!;
    expect(btn.classList.contains("tbl-toolbar__btn--disabled")).toBe(false);
  }
}
```

### EC-18: panel unregistered on disable

This is an integration test — verify in the onEnable/onDisable integration test
suite (step_06/07) that `api.unregisterSidebarPanel` is called when sidebar mode
was active.

---

## Definition of Done

- [ ] `buildSidebarPanel` implemented with all 11 buttons.
- [ ] `updateSidebarButtonStates` implemented with all disabled-state rules.
- [ ] `_sidebarPanelEl` added to module state and reset in `onDisable`.
- [ ] `onEnable` sidebar path updated (no longer a skeleton).
- [ ] All sidebar panel tests pass.
- [ ] EC-1, EC-2, EC-3 covered by `updateSidebarButtonStates` tests.
- [ ] No TypeScript errors.
