# Step 05 — `main.ts` Wiring

**Goal:** Replace all `openSearchPanel`/`closeSearchPanel` calls with `FindWidget` API. Add the `document` keydown listener for direct Cmd-F/Cmd-Shift-F keypresses. Update the window focus handler. Wire the pre-fill behavior.

**Precondition:** step_04 complete (drag and persistence work).

---

## Files to Change

| File | Change type |
|---|---|
| `src/main.ts` | Remove CM6 panel imports, add FindWidget, update all call sites |

---

## 1. Remove CM6 Panel Imports

**Before (line 14):**
```typescript
import { openSearchPanel, closeSearchPanel } from "@codemirror/search";
```

**After:** Delete this line entirely.

---

## 2. Add FindWidget Import

Add after the `createEditor` import:

```typescript
import { createFindWidget } from "./editor/find-widget";
import type { FindWidget } from "./editor/find-widget";
```

---

## 3. Add `findWidget` Module-Level Variable

After the existing module-level declarations (`let editor`, `let currentFilePath`, `let previewEnabled`):

```typescript
let findWidget: FindWidget | null = null;
```

---

## 4. Initialize `findWidget` in `initApp()`

After the `editor = createEditor(...)` call and the null check:

```typescript
// Create the find/replace widget (appended to document.body, hidden by default)
findWidget = createFindWidget(editor);
```

This must come after `editor` is confirmed non-null but before the menu-event listener is set up.

---

## 5. Replace Menu Event Cases

### `"edit-find"` case

**Before:**
```typescript
case "edit-find":
  if (!editor) break;
  openSearchPanel(editor);
  break;
```

**After:**
```typescript
case "edit-find":
  // EC-1: Guard against editor not yet initialized
  if (!editor || !findWidget) break;
  {
    // FR-5.1/5.2: Pre-fill with selection if present
    const sel = editor.state.selection.main;
    if (sel.from !== sel.to) {
      const selectedText = editor.state.sliceDoc(sel.from, sel.to);
      // FR-5.3 / EC-13: Only use first line of multi-line selection
      findWidget.setPreFill(selectedText);
    }
    findWidget.open('find');
  }
  break;
```

### `"edit-find-replace"` case

**Before:**
```typescript
case "edit-find-replace": {
  if (!editor) break;
  const view = editor;
  openSearchPanel(view);
  requestAnimationFrame(() => {
    const replaceInput = view.dom.querySelector<HTMLInputElement>(
      '.cm-search input[name="replace"]'
    );
    replaceInput?.focus();
    replaceInput?.select();
  });
  break;
}
```

**After:**
```typescript
case "edit-find-replace":
  // EC-16: Guard against editor not yet initialized
  if (!editor || !findWidget) break;
  {
    // FR-5.1/5.2: Pre-fill with selection if present
    const sel = editor.state.selection.main;
    if (sel.from !== sel.to) {
      const selectedText = editor.state.sliceDoc(sel.from, sel.to);
      // FR-5.3 / EC-13: Only use first line of multi-line selection
      findWidget.setPreFill(selectedText);
    }
    findWidget.open('replace');
  }
  break;
```

---

## 6. Replace `closeSearchPanel` in File-Load Functions

### `newFile()`

**Before:**
```typescript
closeSearchPanel(editor);
```

**After:**
```typescript
// FR-11.1: Close widget and clear search state on new file (replaces closeSearchPanel)
findWidget?.close();
findWidget?.clearQuery();
```

### `openFile()`

Same replacement in the `if (editor)` block:

**Before:**
```typescript
closeSearchPanel(editor);
```

**After:**
```typescript
// FR-11.1: EC-12: Close widget and clear search state before loading new document
findWidget?.close();
findWidget?.clearQuery();
```

### `openRecentFileByPath()`

Same replacement:

**Before:**
```typescript
closeSearchPanel(editor);
```

**After:**
```typescript
// FR-11.1: EC-12: Close widget and clear search state before loading recent file
findWidget?.close();
findWidget?.clearQuery();
```

---

## 7. Add Document-Level Keydown Listener for Direct Keypresses

### Context

The `searchKeymap` registered in `extensions.ts` includes `{ key: "Mod-f", run: openSearchPanel }`. With the suppressed panel factory, this fires `openSearchPanel` which dispatches `togglePanel` internally (harmless) but does NOT open the `FindWidget`. The direct Cmd-F keypress must be intercepted before it reaches the CM6 editor so `FindWidget.open()` is called.

### Where to add

Inside `initApp()`, after `findWidget` is initialized, add a listener on `document`:

```typescript
// D-7: Intercept Cmd-F and Cmd-Shift-F at the document level so the custom
// FindWidget opens for both the menu path and the direct keypress path.
// event.metaKey is true on macOS for the Command key.
document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Only when editor is ready and findWidget exists
  if (!editor || !findWidget) return;

  const isCmdF = e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key === 'f';
  const isCmdShiftF = e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key === 'F';

  if (isCmdF) {
    e.preventDefault();
    e.stopPropagation();
    const sel = editor.state.selection.main;
    if (sel.from !== sel.to) {
      findWidget.setPreFill(editor.state.sliceDoc(sel.from, sel.to));
    }
    findWidget.open('find');
    return;
  }

  if (isCmdShiftF) {
    e.preventDefault();
    e.stopPropagation();
    const sel = editor.state.selection.main;
    if (sel.from !== sel.to) {
      findWidget.setPreFill(editor.state.sliceDoc(sel.from, sel.to));
    }
    findWidget.open('replace');
    return;
  }
});
```

**Note on key casing:** On macOS, `e.key` for Cmd-F is `'f'` (lowercase). For Cmd-Shift-F it is `'F'` (uppercase, because Shift is held). The listener checks for both cases accordingly.

**Note on TC-4:** No `Alt-` only shortcuts are used. Both listeners require `e.metaKey`.

---

## 8. Update Window Focus Handler

### Before:
```typescript
window.addEventListener("focus", () => {
  if (editor) editor.focus();
});
```

### After (FR-10.4 / EC-29):
```typescript
window.addEventListener("focus", () => {
  // EC-29: If the FindWidget is open, focus goes to the find input (not the editor).
  // The FindWidget manages its own focus state when visible.
  if (findWidget?.isOpen()) {
    // FindWidget is responsible for maintaining focus on its input when the
    // window regains focus. No action needed here — the browser restores
    // focus to the last focused element within the widget automatically.
    return;
  }
  if (editor) editor.focus();
});
```

---

## 9. AC-5 Verification Checklist

Before marking this step complete, verify in the source:

- [ ] `AC-36`: No call to `openSearchPanel` or `closeSearchPanel` remains anywhere in `main.ts`. Search for both identifiers — zero results.
- [ ] `AC-5`: Cases `"edit-find"` and `"edit-find-replace"` in the menu-event switch call `findWidget.open()`.
- [ ] `FR-11.2`: All three file-load functions (`newFile`, `openFile`, `openRecentFileByPath`) call `findWidget?.close()` and `findWidget?.clearQuery()`.

---

## Acceptance Criteria

- [ ] `tsc --noEmit` passes with no TypeScript errors.
- [ ] AC-36: No `openSearchPanel` or `closeSearchPanel` import or call in `main.ts`.
- [ ] AC-3: Cmd-F via menu opens widget in find mode (replace row hidden).
- [ ] AC-4: Cmd-Shift-F via menu opens widget in replace mode (replace row visible).
- [ ] Direct Cmd-F keypress (not via menu) opens FindWidget in find mode.
- [ ] Direct Cmd-Shift-F keypress opens FindWidget in replace mode.
- [ ] FR-5.1: When text is selected in the editor, Cmd-F pre-fills the find input with the selection.
- [ ] EC-13: Multi-line selection pre-fill uses only the first line.
- [ ] EC-1: Cmd-F with `editor` null does not throw.
- [ ] EC-16: Cmd-Shift-F with `editor` null does not throw.
- [ ] EC-12: Opening a new file closes the widget and clears the search query.
- [ ] EC-12: Opening a file via dialog closes the widget and clears the search query.
- [ ] EC-12: Opening a recent file closes the widget and clears the search query.
- [ ] EC-29: Window focus event with widget open does not steal focus away from find input.
- [ ] EC-11: Toggling preview (Cmd-E) while widget is open does not close the widget (the `"view-toggle-preview"` case has no interaction with `findWidget`).
