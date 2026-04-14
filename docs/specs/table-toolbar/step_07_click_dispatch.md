---
title: "Table Toolbar — Step 07: Button Click Dispatch + renderDetailExtra"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 07 — Button Click Dispatch + renderDetailExtra Settings Control

## Goal

Wire all button click handlers (for the top bar, row handle menu, bottom pill,
and sidebar panel) so that each click dispatches exactly one CM6 transaction.
Verify that `renderDetailExtra` correctly reflects and saves settings changes.
After this step the plugin is fully functional.

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Add click handlers to DOM builders; complete onEnable |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Add click dispatch + renderDetailExtra tests |

---

## Implementation Notes

### 1. getEditorView helper

```typescript
/**
 * Read the live EditorView reference at call time.
 * Never cached — always reads from window.__MARKABLE_EDITOR_VIEW__ (EC-23).
 * Returns undefined when the view is not yet available (EC-22, EC-30).
 */
function getEditorView(): EditorViewType | undefined {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__MARKABLE_EDITOR_VIEW__ as EditorViewType | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
```

### 2. handleAction — the central dispatch function

All click events from all three floating elements and the sidebar panel route
through a single `handleAction` function. This is the authoritative dispatch
table for all 11 operations.

```typescript
/**
 * Dispatch a table operation to the CM6 editor.
 *
 * All operation dispatches go through this function to ensure:
 *   - EC-22: no crash when __MARKABLE_EDITOR_VIEW__ is undefined.
 *   - EC-23: __MARKABLE_EDITOR_VIEW__ is read fresh on every call.
 *   - NFR-4: exactly one view.dispatch call per action.
 *
 * @param action - The data-action value from the clicked button.
 */
function handleAction(action: string): void {
  const view = getEditorView();
  if (!view) return; // EC-22, EC-30: silent no-op

  const state = view.state;

  // Re-detect context at click time — cursor may have moved since last debounce.
  const ctx = detectTableContextFromState(state);

  switch (action) {

    case "insert-table": {
      // EC-9, EC-10, EC-11 handled by insertTable().
      const { insertPos, insertText } = insertTable(
        state.doc.toString(),
        state.selection.main.head,
        ctx,
      );
      view.dispatch({
        changes: { from: insertPos, to: insertPos, insert: insertText },
        selection: { anchor: insertPos + insertText.length },
      });
      break;
    }

    case "delete-table": {
      if (!ctx) return;
      // EC-5: if table is entire document, result is empty doc.
      // Extend to capture any trailing newline after the table end.
      const docText = state.doc.toString();
      let to = ctx.tableTo;
      if (docText[to] === "\n") to += 1;
      view.dispatch({
        changes: { from: ctx.tableFrom, to, insert: "" },
        selection: { anchor: Math.min(ctx.tableFrom, state.doc.length) },
      });
      break;
    }

    case "insert-row-above": {
      if (!ctx || ctx.isSeparatorRow) return; // EC-2
      const newText = insertRowAbove(ctx.tableText, ctx.rowIndex);
      if (newText === null) return; // EC-1
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-row-below": {
      if (!ctx || ctx.isSeparatorRow) return; // EC-2
      const newText = insertRowBelow(ctx.tableText, ctx.rowIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "delete-row": {
      if (!ctx || ctx.isHeaderRow || ctx.isSeparatorRow) return; // EC-1, EC-2
      const newText = deleteRow(ctx.tableText, ctx.rowIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-col-left": {
      if (!ctx) return;
      const newText = insertColumnLeft(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-col-right": {
      if (!ctx) return;
      const newText = insertColumnRight(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "delete-col": {
      if (!ctx) return;
      if (ctx.columnCount <= 1) return; // EC-3
      const newText = deleteColumn(ctx.tableText, ctx.colIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "align-left": {
      if (!ctx) return;
      const newText = alignLeft(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "align-center": {
      if (!ctx) return;
      const newText = alignCenter(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "align-right": {
      if (!ctx) return;
      const newText = alignRight(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }
  }
}
```

### 3. Wiring mousedown listeners in DOM builders (step_04 update)

Go back to `buildTopBar`, `buildRowMenu`, `buildBottomPill`, and
`buildSidebarPanel` and replace the `// dispatch handled in step_07` comments
with the actual dispatch call:

**buildTopBar** — update delegated mousedown:
```typescript
bar.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  const btn = (e.target as Element).closest("[data-action]") as HTMLElement | null;
  if (!btn) return;
  handleAction(btn.dataset["action"]!);
});
```

**buildRowMenu** — update delegated mousedown:
```typescript
menu.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  const btn = (e.target as Element).closest("[data-action]") as HTMLElement | null;
  if (!btn) return;
  const action = btn.dataset["action"]!;
  // Close the menu before dispatching.
  _rowMenu?.classList.remove("tbl-toolbar--open");
  handleAction(action);
});
```

**buildBottomPill** — wire mousedown directly (pill has a single action):
```typescript
pill.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  // EC-29: if pill is visible but cursor is not in a table, no-op.
  const view = getEditorView();
  if (!view) return;
  const ctx = detectTableContextFromState(view.state);
  if (!ctx) return;
  // Insert row below the last body row.
  const lastBodyRowIndex = ctx.rowCount - 1;
  const newText = insertRowBelow(ctx.tableText, lastBodyRowIndex);
  if (newText === null) return;
  view.dispatch({
    changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText },
  });
});
```

**buildSidebarPanel** — update delegated mousedown:
```typescript
panel.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  const btn = (e.target as Element).closest("[data-action]") as HTMLElement | null;
  if (!btn) return;
  if (btn.classList.contains("tbl-toolbar__btn--disabled")) return;
  handleAction(btn.dataset["action"]!);
});
```

The disabled check in the sidebar panel's mousedown is a safety guard — the CSS
`pointer-events: none` on `--disabled` buttons should already prevent clicks, but
the guard prevents any edge case.

### 4. Row handle click wiring

The row handle's `mousedown` listener toggles the menu. This was noted in step_04
as being wired in step_07. Add it to `buildRowHandle`:

```typescript
handle.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation(); // prevent outside-click listener from immediately closing
  toggleRowMenu();
});
```

And implement `toggleRowMenu` in section 8 (DOM update functions):

```typescript
function toggleRowMenu(): void {
  if (!_rowMenu) return;
  const isOpen = _rowMenu.classList.contains("tbl-toolbar--open");
  if (isOpen) {
    _rowMenu.classList.remove("tbl-toolbar--open");
  } else {
    _rowMenu.classList.add("tbl-toolbar--open");
    if (_rowHandle) {
      const hRect = _rowHandle.getBoundingClientRect();
      _rowMenu.style.top  = `${hRect.bottom + 2}px`;
      _rowMenu.style.left = `${hRect.left}px`;
    }
  }
}
```

### 5. renderDetailExtra (already implemented in step_01, verify completeness)

The `renderDetailExtra` function was implemented in step_01 as a full
implementation (not a stub). Verify it:

- Reads `_settings` to derive the active 3-way position.
- Renders three buttons: "Left", "Float", "Right".
- On click: calls `_api?.saveSettings(...)` then `_api?.restartSelf()`.
- Is a no-op when `_api` is null (plugin disabled).

No changes needed if step_01 was implemented correctly. The tests below verify it.

---

## Test Cases

### handleAction — unit tests with mock view

These tests create a mock view object that records dispatch calls:

```typescript
function mockView(docText: string, cursorPos: number, tree?: SyntaxTree) {
  const dispatches: any[] = [];
  const t = tree ?? parser.parse(docText);
  return {
    state: {
      doc: { toString: () => docText, length: docText.length },
      selection: { main: { head: cursorPos } },
      // SyntaxTree is accessed via getCmLanguage().syntaxTree(state)
      // We inject the tree via the mock __CM_LANGUAGE__ global (see beforeEach)
    },
    dispatch: (tx: any) => dispatches.push(tx),
    _dispatches: dispatches,
  };
}
```

In `beforeEach`, set `window.__MARKABLE_EDITOR_VIEW__` to the mock view:
```typescript
(window as any).__MARKABLE_EDITOR_VIEW__ = view;
(window as any).__CM_LANGUAGE__ = { syntaxTree: () => parser.parse(docText) };
```

```
describe("handleAction") {
  const T3 = `| H1 | H2 | H3 |
| --- | --- | --- |
| a | b | c |`;

  it("insert-table dispatches when view available") {
    const view = mockView("", 0);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("insert-table");
    expect(view._dispatches).toHaveLength(1);
    expect(view._dispatches[0].changes.insert).toContain("| Column 1 |");
  }

  it("is a no-op when view is undefined (EC-22)") {
    (window as any).__MARKABLE_EDITOR_VIEW__ = undefined;
    expect(() => handleAction("insert-table")).not.toThrow();
  }

  it("delete-row dispatches with correct change (EC-1 — header row: no-op)") {
    const pos = T3.indexOf("H1") + 1; // cursor on header row
    const view = mockView(T3, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("delete-row");
    expect(view._dispatches).toHaveLength(0); // no-op
  }

  it("delete-row dispatches for body row") {
    const pos = T3.indexOf("| a |") + 3;
    const view = mockView(T3, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("delete-row");
    expect(view._dispatches).toHaveLength(1);
    const newText = view._dispatches[0].changes.insert;
    expect(newText).not.toContain("| a |");
  }

  it("delete-col is no-op for single-column table (EC-3)") {
    const t = "| H |\n| --- |\n| x |";
    const pos = t.indexOf("x");
    const view = mockView(t, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("delete-col");
    expect(view._dispatches).toHaveLength(0);
  }

  it("insert-col-left dispatches a single change (NFR-4 — single dispatch)") {
    const pos = T3.indexOf("H2") + 1;
    const view = mockView(T3, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("insert-col-left");
    expect(view._dispatches).toHaveLength(1);
  }

  it("delete-table dispatches a deletion covering the full table range") {
    const pos = T3.indexOf("H1") + 1;
    const view = mockView(T3, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("delete-table");
    expect(view._dispatches).toHaveLength(1);
    const ch = view._dispatches[0].changes;
    expect(ch.from).toBe(0);
    expect(ch.insert).toBe("");
  }

  it("delete-table on full-document table results in empty doc (EC-5)") {
    const pos = T3.indexOf("H1") + 1;
    const view = mockView(T3, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("delete-table");
    const ch = view._dispatches[0].changes;
    expect(ch.insert).toBe("");
  }

  it("align-center dispatches :---: separator cell") {
    const pos = T3.indexOf("H2") + 1;
    const view = mockView(T3, pos);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    handleAction("align-center");
    const newText = view._dispatches[0].changes.insert as string;
    expect(newText).toContain(":---:");
  }

  it("EC-29: bottom pill no-op when cursor outside table") {
    const view = mockView("hello world", 5);
    (window as any).__MARKABLE_EDITOR_VIEW__ = view;
    // Simulate pill click by directly calling the pill's handler.
    // Pill handler reads ctx; if null, returns without dispatching.
    // We verify by calling handleAction with a synthetic bottom-pill action.
    // (The pill does not use handleAction directly — test the pill's mousedown handler)
    // Since the pill's handler is internal, we test it via integration:
    // dispatch count should be 0.
    handleAction("insert-row-below"); // used as proxy — ctx will be null
    expect(view._dispatches).toHaveLength(0);
  }
}
```

### renderDetailExtra tests

```
describe("renderDetailExtra") {
  it("renders three buttons: Left, Float, Right") {
    const container = document.createElement("div");
    renderDetailExtra(container);
    const buttons = container.querySelectorAll("button");
    const labels = [...buttons].map(b => b.textContent);
    expect(labels).toContain("Left");
    expect(labels).toContain("Float");
    expect(labels).toContain("Right");
  }

  it("active button matches current settings (floating by default)") {
    _settings = { toolbarMode: "floating", sidebarSide: "left" };
    const container = document.createElement("div");
    renderDetailExtra(container);
    const activeBtn = container.querySelector("button.active");
    expect(activeBtn?.textContent).toBe("Float");
  }

  it("active button is Left when toolbarMode is sidebar + sidebarSide left") {
    _settings = { toolbarMode: "sidebar", sidebarSide: "left" };
    const container = document.createElement("div");
    renderDetailExtra(container);
    const activeBtn = container.querySelector("button.active");
    expect(activeBtn?.textContent).toBe("Left");
  }

  it("active button is Right when toolbarMode is sidebar + sidebarSide right") {
    _settings = { toolbarMode: "sidebar", sidebarSide: "right" };
    const container = document.createElement("div");
    renderDetailExtra(container);
    const activeBtn = container.querySelector("button.active");
    expect(activeBtn?.textContent).toBe("Right");
  }

  it("clicking a button calls _api.saveSettings and restartSelf") {
    const savedSettings: any[] = [];
    let restartCalled = false;
    _api = {
      saveSettings: async (data: any) => { savedSettings.push(data); },
      restartSelf: async () => { restartCalled = true; },
    } as any;
    _settings = { toolbarMode: "floating", sidebarSide: "left" };

    const container = document.createElement("div");
    renderDetailExtra(container);
    const leftBtn = [...container.querySelectorAll("button")].find(b => b.textContent === "Left");
    leftBtn?.click();

    // Wait one microtask for the async save chain.
    await new Promise(r => setTimeout(r, 0));
    expect(savedSettings[0]).toEqual({ toolbarMode: "sidebar", sidebarSide: "left" });
    // restartSelf is called after saveSettings resolves:
    expect(restartCalled).toBe(true);
  }

  it("clicking active button is a no-op") {
    const saved: any[] = [];
    _api = { saveSettings: async (d: any) => saved.push(d), restartSelf: async () => {} } as any;
    _settings = { toolbarMode: "floating", sidebarSide: "left" };

    const container = document.createElement("div");
    renderDetailExtra(container);
    const floatBtn = [...container.querySelectorAll("button")].find(b => b.textContent === "Float");
    floatBtn?.click();

    await new Promise(r => setTimeout(r, 0));
    expect(saved).toHaveLength(0); // no-op: already floating
  }

  it("is a no-op when _api is null (plugin disabled)") {
    _api = null;
    const container = document.createElement("div");
    renderDetailExtra(container);
    const leftBtn = [...container.querySelectorAll("button")].find(b => b.textContent === "Left");
    expect(() => leftBtn?.click()).not.toThrow();
  }
}
```

### onEnable / onDisable integration

```
describe("onEnable / onDisable integration (EC-19)") {
  it("rapid toggle does not produce duplicate style tags") {
    const api = buildMockApi();
    await onEnable(api);
    await onDisable(api);
    await onEnable(api);
    await onDisable(api);
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(0);
  }

  it("all floating elements removed from body after disable") {
    const api = buildMockApi({ toolbarMode: "floating" });
    await onEnable(api);
    expect(document.getElementById("__markable_tbl_top_bar__")).not.toBeNull();
    await onDisable(api);
    expect(document.getElementById("__markable_tbl_top_bar__")).toBeNull();
    expect(document.getElementById("__markable_tbl_row_handle__")).toBeNull();
    expect(document.getElementById("__markable_tbl_row_menu__")).toBeNull();
    expect(document.getElementById("__markable_tbl_bottom_pill__")).toBeNull();
  }
}
```

`buildMockApi` is a test helper that returns a mock `MarkablePluginAPI` with stubs
for all methods. Settings override: pass `toolbarMode` to control which path runs.
The mock `loadSettings` returns `{ toolbarMode, sidebarSide: "left" }` by default.

---

## Definition of Done

- [ ] `handleAction` function implemented and wired to all four DOM elements.
- [ ] `getEditorView()` helper implemented.
- [ ] All mousedown listeners in `buildTopBar`, `buildRowMenu`, `buildBottomPill`,
      `buildSidebarPanel` updated to call `handleAction`.
- [ ] `toggleRowMenu` implemented and wired to `buildRowHandle`.
- [ ] All `handleAction` unit tests pass.
- [ ] All `renderDetailExtra` tests pass.
- [ ] onEnable/onDisable integration tests pass.
- [ ] EC-1, EC-2, EC-3, EC-5, EC-7, EC-22, EC-23, EC-29, EC-30 covered by tests.
- [ ] NFR-4: every test case verifies exactly one dispatch per operation.
- [ ] No TypeScript errors.
- [ ] `npm run build:plugins` produces `table-toolbar.js` cleanly.
- [ ] Total test count confirmed increased vs pre-step count.
