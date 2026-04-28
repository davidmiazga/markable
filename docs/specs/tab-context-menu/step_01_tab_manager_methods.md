---
title: Step 01 — TabManager: closeOtherTabs and closeAllTabs
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 01 — TabManager: `closeOtherTabs` and `closeAllTabs`

## File to modify

`src/tabs/tab-manager.ts`

Insert both methods in the `// ── Tab operations` section, immediately after
the existing `closeTab()` method (around line 825).

---

## Method 1: `closeOtherTabs(id: string): Promise<void>`

### Purpose

Closes every tab whose ID is not `id`. The tab the user right-clicked is
guaranteed to survive. After all closes complete, `id` becomes the active tab.

### Acceptance criteria

- The tab with `id` is never closed.
- All other tabs are iterated. For each tab:
  - If `isDirty && kind !== "media"`: call `confirm(...)` with the same string
    already used in `closeTab()`. If the user cancels, skip this tab.
  - If clean or media: close without dialog.
- Cancelling one dirty tab's dialog does not skip remaining tabs.
- After the loop, call `activateTab(id)` unconditionally (even if it was already
  active — `activateTab` is a no-op when the index matches).
- Call `saveSession()` once at the end.
- `_notifyRenderer()` is called once at the end (via `activateTab`, which already
  calls it internally — do NOT add a second call).

### Implementation sketch

```typescript
/**
 * Closes all tabs except the one with the given id.
 *
 * Each dirty "other" tab receives its own confirm dialog. Cancelling one
 * does not prevent the remaining tabs from being evaluated.
 * After the loop, the right-clicked tab is activated and the session saved.
 *
 * @param id  The TabEntry.id of the tab to keep open.
 */
async closeOtherTabs(id: string): Promise<void> {
  // Build the list of tabs to attempt closing (all except `id`).
  // Use getTabs() (shallow copy) to avoid iterating this.tabs directly —
  // the array will be mutated by the removes below.
  const others = this.getTabs().filter((t) => t.id !== id);

  for (const tab of others) {
    if (tab.isDirty && tab.kind !== "media") {
      const confirmed = confirm(
        `"${tab.title}" has unsaved changes. Close without saving?`
      );
      if (!confirmed) continue;   // Skip this tab; continue with the rest.
    }

    // Remove the tab from the array. Find its current index each time because
    // previous iterations have already shifted the array.
    const idx = this.tabs.findIndex((t) => t.id === tab.id);
    if (idx === -1) continue;  // Already gone (should not happen, but guard).

    this.tabs.splice(idx, 1);

    // Recalculate activeIndex the same way closeTab() does.
    if (idx < this.activeIndex) {
      this.activeIndex -= 1;
    } else if (idx === this.activeIndex) {
      this.activeIndex = Math.min(this.activeIndex, this.tabs.length - 1);
    }
  }

  // Make the right-clicked tab active (and call _notifyRenderer via activateTab).
  // activateTab is a no-op if id is already active.
  this.activateTab(id);

  void this.saveSession();
}
```

### Edge cases

- EC-03: Multiple dirty "other" tabs. Each dirty tab in `others` gets its own
  `confirm()`. The `continue` on cancel means later tabs are still processed.
- EC-15: Right-clicked tab is not active at the time. After the loop,
  `activateTab(id)` makes it active. The user's viewport matches what they
  right-clicked.
- If `id` is not found in `this.tabs` at call time (stale reference), the method
  still closes everything in `others` correctly; `activateTab(id)` will be a
  no-op. This case should not occur in practice.
- If `others` is empty (only one tab exists), the loop body never executes, and
  `activateTab(id)` + `saveSession()` are called — both harmless no-ops in that
  state.

---

## Method 2: `closeAllTabs(): Promise<void>`

### Purpose

Closes every open tab. Dirty tabs each receive an individual confirm dialog.
Cancels are independent — cancelling one tab does not stop the others. The
last-tab side effects (vault: drop to 0 tabs; no vault: close window) occur
once, at the end, for the final remaining tab.

### Why NOT use `closeTab()` in a loop

`closeTab()` checks `this.tabs.length === 1` on every call and fires the
last-tab branch (window.close or empty-app) when only one tab remains. In a
loop that starts with N tabs:
- Iteration N−1 reduces the count to 1 and triggers the branch early.
- Session is saved on every call instead of once.

The safe pattern: take a snapshot before any mutation, collect confirmed IDs,
apply all removals, then execute the last-tab branch once.

### Acceptance criteria

- Take a snapshot: `const snapshot = [...this.tabs]`.
- For each tab in the snapshot:
  - If `isDirty && kind !== "media"`: confirm dialog. If cancelled, do NOT add
    to the close set (the tab survives).
  - If clean or media: add to the close set.
- Apply the close set: remove each confirmed tab from `this.tabs` in one pass.
- After all removals:
  - If `this.tabs.length > 0`: the tabs that survived (cancelled dirty tabs)
    remain. Recalculate `activeIndex`. Call `_applyActiveTab()` and
    `_notifyRenderer()`. Call `saveSession()`. Return.
  - If `this.tabs.length === 0`: follow the exact same vault/no-vault branch as
    `closeTab()`:
    - Vault active: set `activeIndex = -1`, call `_applyActiveTab()`,
      `_notifyRenderer()`, `saveSession()`. Return.
    - No vault: clear state, call `window.close()` via
      `getCurrentWebviewWindow().close()`.
- Call `saveSession()` once (only in the non-window-close paths).

### Implementation sketch

```typescript
/**
 * Closes all open tabs.
 *
 * Dirty tabs each receive their own confirm dialog. Cancelling one does not
 * prevent others from being evaluated. The last-tab side effects (vault-stay
 * vs window-close) are applied once after all removals, not per-iteration.
 *
 * Implementation uses a snapshot to avoid "mutation during iteration" hazards
 * and to prevent closeTab()'s per-call window-close logic from firing early.
 */
async closeAllTabs(): Promise<void> {
  if (this.tabs.length === 0) return;

  // Step 1: Take a snapshot so array mutations do not affect iteration.
  const snapshot = [...this.tabs];

  // Step 2: Collect IDs that the user confirmed closing.
  const confirmedIds = new Set<string>();
  for (const tab of snapshot) {
    if (tab.isDirty && tab.kind !== "media") {
      const confirmed = confirm(
        `"${tab.title}" has unsaved changes. Close without saving?`
      );
      if (confirmed) confirmedIds.add(tab.id);
      // If not confirmed, the tab is implicitly kept (not added to confirmedIds).
    } else {
      // Clean tabs and media tabs close without dialog.
      confirmedIds.add(tab.id);
    }
  }

  // Step 3: Apply removals in one pass.
  // Filter the live array rather than splicing by index to avoid off-by-one
  // issues when multiple removes happen in sequence.
  this.tabs = this.tabs.filter((t) => !confirmedIds.has(t.id));

  // Step 4: Post-removal state.
  if (this.tabs.length > 0) {
    // Some dirty tabs were cancelled. Clamp activeIndex to the new length.
    this.activeIndex = Math.max(
      0,
      Math.min(this.activeIndex, this.tabs.length - 1)
    );
    this._applyActiveTab();
    this._notifyRenderer();
    void this.saveSession();
    return;
  }

  // All tabs were closed (confirmedIds covered every tab, or there were no
  // dirty tabs to begin with).
  this.activeIndex = -1;

  const hasActiveVault = this._settingsHaveActiveVault();
  if (hasActiveVault) {
    // Vault active: stay at 0 tabs. File browser leads the next action.
    this._applyActiveTab();
    this._notifyRenderer();
    void this.saveSession();
    return;
  }

  // No vault: close the app window.
  // Clear state before closing so a saveSession() triggered by the window-close
  // event (if any) writes empty state.
  const appWindow = getCurrentWebviewWindow();
  await appWindow.close();
}
```

### Edge cases

- EC-04: All tabs dirty. The loop presents a confirm per tab. If the user
  cancels all, `confirmedIds` is empty, `this.tabs` is unchanged, and
  `_applyActiveTab()` + `_notifyRenderer()` run without change.
- EC-05: Last tab behavior. When `this.tabs.length === 0` after the filter,
  the vault/no-vault branch applies once — not once per tab as it would
  with a `closeTab()` loop.
- If `confirmedIds` covers only some tabs (partial cancel), the surviving tabs
  remain. `activeIndex` is clamped to the valid range. The active tab may
  change if the previously active tab was in the confirmed set.
- `saveSession()` is called exactly once in both the partial and full close
  paths (not at all in the window-close path, which closes before the
  settings write matters).

---

## Integration with existing `closeTab` invariants

Both new methods respect these invariants from `closeTab()`:
- Dirty state check uses `tab.isDirty && tab.kind !== "media"` — media tabs
  are never dirty and never need a confirm dialog.
- `_captureActiveTab()` does not need to be called here because we are removing
  tabs, not switching to them; the tab being removed does not need its state
  saved.
- The `markable-tab-closed` CustomEvent dispatched in `closeTab()` is NOT
  dispatched here. That event is for the Command Bar plugin to close defensively
  on any single-tab close. Batch closes are a different interaction; the
  Command Bar does not open during a right-click context menu (the two UIs
  are mutually exclusive).

---

## Tests

See `step_06_tests.md` for the complete unit test plan. Key cases:

1. `closeOtherTabs` with only one tab: no-op, tab count unchanged.
2. `closeOtherTabs` with two clean tabs: one tab remains; `activateTab` called.
3. `closeOtherTabs` with a dirty "other" tab, user cancels: both tabs remain.
4. `closeAllTabs` with all clean tabs, no vault: window.close() called.
5. `closeAllTabs` with all clean tabs, vault active: 0 tabs, no window close.
6. `closeAllTabs` with some dirty tabs, user cancels all: all tabs remain.
7. `closeAllTabs` with some dirty tabs, user confirms all: 0 tabs.
8. `closeAllTabs` with mixed (some cancel, some confirm): only cancelled tabs survive.
