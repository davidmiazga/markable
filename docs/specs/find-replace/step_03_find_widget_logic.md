# Step 03 — FindWidget CM6 Search Logic

**Goal:** Wire the CM6 search engine into `FindWidget`. This step adds: query dispatch on input, navigation commands, replace commands, match count display, toggle button state, keyboard shortcuts inside inputs, and invalid regexp handling.

**Precondition:** step_02 complete (DOM structure and open/close API exist).

---

## Files to Change

| File | Change type |
|---|---|
| `src/editor/find-widget.ts` | Add: search logic, count logic, keyboard handlers, toggle logic |

---

## 1. Imports to Add

```typescript
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
```

---

## 2. Toggle State Fields

Add to the class:

```typescript
private _matchCase: boolean = false;
private _wholeWord: boolean = false;
private _regexp: boolean = false;
```

---

## 3. `_buildSearchQuery()` Private Method

Constructs a `SearchQuery` from current field and toggle state. Called on every input event and when toggles change.

```typescript
private _buildSearchQuery(): SearchQuery {
  // EC-6 / EC-25: If regexp mode is on, SearchQuery handles invalid patterns
  // internally — setting query.valid to false. No throw from constructor.
  return new SearchQuery({
    search: this.findInput.value,
    caseSensitive: this._matchCase,
    wholeWord: this._wholeWord,
    regexp: this._regexp,
    replace: this.replaceInput.value,
  });
}
```

---

## 4. `_dispatchQuery()` Private Method

Dispatches the current query to the CM6 view and updates the count.

```typescript
private _dispatchQuery(): void {
  const query = this._buildSearchQuery();
  this.view.dispatch({ effects: setSearchQuery.of(query) });
  this._updateCount(query);
}
```

---

## 5. `_updateCount()` Private Method

Counts all matches in the document for the current query and updates the count label.

```typescript
private _updateCount(query: SearchQuery): void {
  const term = this.findInput.value;

  // FR-12.3: Empty search term — hide count label
  if (!term) {
    this.countLabel.textContent = '';
    this.countLabel.classList.remove('no-results');
    this.findInput.classList.remove('find-widget-no-results', 'find-widget-invalid-regexp');
    return;
  }

  // EC-6 / EC-25: Invalid regexp — query.valid is false
  if (!query.valid) {
    this.countLabel.textContent = 'Invalid';
    this.countLabel.classList.add('no-results');
    this.findInput.classList.remove('find-widget-no-results');
    this.findInput.classList.add('find-widget-invalid-regexp');
    return;
  }

  // Count total matches (EC-7: cap at 999+ to prevent hang on zero-width patterns)
  let totalCount = 0;
  const cursor = query.getCursor(this.view.state);
  while (!cursor.next().done) {
    totalCount++;
    if (totalCount > 999) {
      // EC-7: Zero-width match pattern (e.g., .*) can produce thousands of matches.
      // Display "999+" and stop iterating.
      this.countLabel.textContent = '999+';
      this.countLabel.classList.remove('no-results');
      this.findInput.classList.remove('find-widget-no-results', 'find-widget-invalid-regexp');
      return;
    }
  }

  // FR-12.2 / EC-3: Zero matches
  if (totalCount === 0) {
    this.countLabel.textContent = 'No results';
    this.countLabel.classList.add('no-results');
    this.findInput.classList.add('find-widget-no-results');
    this.findInput.classList.remove('find-widget-invalid-regexp');
    return;
  }

  // FR-12.1: Count index — count matches from doc start to current selection
  const selFrom = this.view.state.selection.main.from;
  let currentIndex = 0;
  const indexCursor = query.getCursor(this.view.state);
  while (!indexCursor.next().done) {
    currentIndex++;
    if (indexCursor.value.to > selFrom) break;
  }

  this.countLabel.textContent = `${currentIndex} of ${totalCount}`;
  this.countLabel.classList.remove('no-results');
  this.findInput.classList.remove('find-widget-no-results', 'find-widget-invalid-regexp');
}
```

---

## 6. Event Listeners Registered in `_buildDom()` (or a new `_attachLogic()` method)

### Find input — `input` event

```typescript
this.findInput.addEventListener('input', () => {
  // FR-4.1: Dispatch updated SearchQuery on every keystroke
  this._dispatchQuery();
});
```

### Replace input — `input` event

```typescript
this.replaceInput.addEventListener('input', () => {
  // Keep replace text in sync with SearchQuery (needed for replaceNext/replaceAll)
  this._dispatchQuery();
});
```

### Toggle buttons — `click` events

Register one handler per toggle button using the `data-name` attribute:

```typescript
this.toggleMatchCase.addEventListener('click', () => {
  this._matchCase = !this._matchCase;
  this.toggleMatchCase.classList.toggle('active', this._matchCase);
  // EC-19: Immediate re-dispatch on toggle change
  this._dispatchQuery();
});

this.toggleWholeWord.addEventListener('click', () => {
  this._wholeWord = !this._wholeWord;
  this.toggleWholeWord.classList.toggle('active', this._wholeWord);
  // EC-20: Immediate re-dispatch on toggle change
  this._dispatchQuery();
});

this.toggleRegexp.addEventListener('click', () => {
  this._regexp = !this._regexp;
  this.toggleRegexp.classList.toggle('active', this._regexp);
  this._dispatchQuery();
});
```

### Navigation buttons — `click` events

```typescript
this.nextBtn.addEventListener('click', () => {
  // FR-4.2 / AC-13: Advance to next match (wraps — EC-18 is CM6 default behavior)
  findNext(this.view);
  // FR-12.4: Update count after navigation
  this._updateCount(this._buildSearchQuery());
});

this.prevBtn.addEventListener('click', () => {
  // FR-4.3 / AC-13: Go to previous match
  findPrevious(this.view);
  this._updateCount(this._buildSearchQuery());
});
```

### Replace buttons — `click` events

```typescript
this.replaceOneBtn.addEventListener('click', () => {
  // FR-4.4 / AC-21: Replace current match and advance
  // EC-28: replaceNext is a no-op when there are zero matches — CM6 handles this
  replaceNext(this.view);
  this._updateCount(this._buildSearchQuery());
});

this.replaceAllBtn.addEventListener('click', () => {
  // FR-4.5 / AC-22: Replace all matches in a single CM6 transaction (EC-8, EC-9)
  replaceAll(this.view);
  this._updateCount(this._buildSearchQuery());
});
```

### Close button — `click` event

```typescript
this.closeBtn.addEventListener('click', () => {
  this.close();
});
```

### Find input — keyboard shortcuts (FR-6.6, FR-6.7, FR-6.8)

```typescript
this.findInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    // FR-6.6: Enter in find input → next match
    e.preventDefault();
    findNext(this.view);
    this._updateCount(this._buildSearchQuery());
  } else if (e.key === 'Enter' && e.shiftKey) {
    // FR-6.7: Shift-Enter → previous match
    e.preventDefault();
    findPrevious(this.view);
    this._updateCount(this._buildSearchQuery());
  } else if (e.key === 'Tab' && !e.shiftKey && this._replaceVisible) {
    // FR-6.8: Tab moves focus to replace input when replace row is visible
    e.preventDefault();
    this.replaceInput.focus();
  }
  // Escape is handled by the root keydown listener (step_02)
});
```

---

## 7. `clearQuery()` Public Method

Called by `main.ts` (via `close()`) to clear highlights when switching files.

```typescript
clearQuery(): void {
  this.findInput.value = '';
  this.replaceInput.value = '';
  this.countLabel.textContent = '';
  this.countLabel.classList.remove('no-results');
  this.findInput.classList.remove('find-widget-no-results', 'find-widget-invalid-regexp');
  // Dispatch empty query to CM6 to clear match highlight decorations (FR-11.1)
  this.view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: '' })),
  });
}
```

Update `close()` to call `clearQuery()` only when switching files, not on every close. `main.ts` will call `findWidget.clearQuery()` explicitly after `findWidget.close()` in the file-load handlers. Do NOT auto-clear on every `close()` — the user may close and reopen the widget mid-session and expect the last search term to persist.

Revise `close()`:

```typescript
close(): void {
  if (!this._isOpen) return;
  this.root.style.display = 'none';
  this._isOpen = false;
  this.view.focus();
  // Note: clearQuery() is NOT called here. Callers that want to clear
  // (file open, new file) must call findWidget.clearQuery() explicitly after close().
}
```

---

## 8. `updateView(newView: EditorView)` Public Method

Called if the editor view is ever recreated (defensive, not expected in current implementation):

```typescript
updateView(newView: EditorView): void {
  this.view = newView;
}
```

---

## 9. EC-4 and EC-8 Notes

**EC-4 (empty search):** The `input` event fires when the input is cleared. `_dispatchQuery()` dispatches a `SearchQuery({ search: '' })`. The `getSearchQuery` state reflects this. CM6's highlight ViewPlugin observes `searchState` and clears all decorations. The count label is hidden.

**EC-8 (Replace All atomicity):** `replaceAll` from `@codemirror/search` dispatches a single transaction grouping all replacements. This is a CM6 invariant — no additional code needed. Undo (Cmd-Z) reverses it in one step (EC-9).

**EC-28 (findNext with zero matches):** CM6's `findNext` command calls `findNextOccurrence` which returns false when there are no matches. The `Command` type returns `boolean`. No throw occurs. The editor selection is unchanged.

---

## Acceptance Criteria

- [ ] Typing in the find input dispatches `setSearchQuery` to the view (observable as `.cm-searchMatch` decorations appearing in the editor).
- [ ] Count label shows "N of M" when matches exist; "No results" when search term is non-empty with zero matches; empty when search term is empty.
- [ ] EC-3: Zero matches — find input gets `find-widget-no-results` class (red tint).
- [ ] EC-4: Clearing the find input clears all `.cm-searchMatch` decorations.
- [ ] EC-6 / EC-25: Typing `[abc` with regexp enabled shows "Invalid" in count label and an orange/red tint on input. No throw.
- [ ] EC-7: Typing `.*` with regexp enabled shows "999+" count. Widget does not hang.
- [ ] Clicking Next / Previous navigates matches. Count updates.
- [ ] Enter in find input navigates to next match. Shift-Enter to previous.
- [ ] Tab in find input moves to replace input when replace row is visible.
- [ ] Match Case / Whole Word / Regexp toggles update search immediately. Toggle buttons show active state.
- [ ] EC-19: Switching Match Case while matches are highlighted updates decorations and count.
- [ ] EC-20: Same for Whole Word toggle.
- [ ] Replace One replaces current match and advances. Count updates.
- [ ] Replace All replaces all matches in one transaction. Count becomes 0 (no matches remain).
- [ ] EC-9: Cmd-Z after Replace All restores the document in one undo step (manual verification required).
- [ ] EC-28: Clicking Next when there are zero matches does not throw.
- [ ] `tsc --noEmit` passes with no errors.
