---
title: "step_03 — export.ts: printDocument, createExportSheet, openExportDialog"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# step_03 — Add printDocument, createExportSheet, openExportDialog to export.ts

**Depends on**: nothing (TypeScript-only; can land before or after step_01/02)
**Blocks**: step_04 (main.ts imports `openExportDialog` and `printDocument`)

---

## Overview

This step adds three new exported functions to `src/lib/export.ts`. No existing
function is modified. All existing exports retain their current signatures.

---

## 1. printDocument

Move the logic from `main.ts` into `export.ts` with these changes:
- Accepts `editor: EditorView | null` as a parameter (removes closure dependency).
- Wraps `window.print()` in a `try/finally` block (EC-15).
- Uses the existing `MINIMAL_CSS` constant already defined in this file.
- Uses the existing `markdownToHtml()` function already defined in this file.

### Function signature

```ts
export function printDocument(editor: EditorView | null): void
```

### Implementation

Place this after the `exportAsHtml` function in the "Orchestration" section.

```ts
/**
 * Triggers the macOS system print dialog for the current document.
 *
 * Injects a rendered HTML overlay + print-only @media stylesheet into the DOM,
 * calls window.print() (which surfaces the system print dialog), then removes
 * both elements unconditionally in a finally block.
 *
 * FR-05.2 / FR-05.3: Refactored from main.ts; editor is passed as a parameter.
 * FR-05.4: Overlay is injected immediately before window.print() and removed after.
 * FR-05.5: Returns immediately if editor is null.
 * FR-05.6: @media print stylesheet hides all editor chrome.
 * EC-15:   finally block guarantees cleanup even if window.print() throws.
 */
export function printDocument(editor: EditorView | null): void {
  if (!editor) return;

  const html = markdownToHtml(editor.state.doc.toString());

  const style = document.createElement("style");
  style.id = "markable-print-style";
  style.textContent = `
    @media print {
      body > *:not(#markable-print-overlay) { display: none !important; }
      #markable-print-overlay {
        display: block !important;
        position: static !important;
      }
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "markable-print-overlay";
  overlay.style.cssText = "display:none";
  overlay.innerHTML = `<style>${MINIMAL_CSS}</style><div class="content">${html}</div>`;
  document.body.appendChild(overlay);

  try {
    window.print();
  } finally {
    style.remove();
    overlay.remove();
  }
}
```

---

## 2. createExportSheet

A pure DOM factory that builds the format selection sheet, appends it to
`document.body`, and returns a `Promise` that resolves when the user makes a
choice. The sheet destroys itself before the Promise resolves.

### Function signature

```ts
function createExportSheet(): Promise<"html" | "pdf" | "cancel">
```

This function is **not exported** — it is an internal helper called only by
`openExportDialog`. It does not need to be in the public API.

### DOM structure

```
<div id="markable-export-sheet" role="dialog" aria-modal="true"
     aria-label="Export format">
  <p class="mes-label">Export as:</p>
  <div class="mes-options" role="radiogroup" aria-label="Format">
    <label class="mes-option">
      <input type="radio" name="export-format" value="html" checked> HTML
    </label>
    <label class="mes-option">
      <input type="radio" name="export-format" value="pdf"> PDF
    </label>
  </div>
  <div class="mes-actions">
    <button id="mes-cancel-btn" type="button">Cancel</button>
    <button id="mes-export-btn" type="button" class="mes-primary">Export</button>
  </div>
</div>
```

### CSS (injected as `<style id="markable-export-sheet-style">`)

The style block is injected into `document.head` when the sheet is created and
removed as part of the sheet's cleanup. Use CSS custom properties for theme
compatibility (FR-08.5).

```css
#markable-export-sheet {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  background: var(--panel-bg, #fff);
  border: 1px solid var(--border-color, #d0d0d0);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  padding: 16px 20px;
  min-width: 260px;
  box-shadow: 0 -4px 16px rgba(0,0,0,0.12);
  font-family: var(--ui-font, -apple-system, sans-serif);
  font-size: 13px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mes-label {
  margin: 0;
  font-weight: 500;
  color: var(--text-color, #1a1a1a);
}
.mes-options {
  display: flex;
  gap: 16px;
}
.mes-option {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-color, #1a1a1a);
}
.mes-option input[type="radio"] {
  accent-color: var(--accent-color, #0066cc);
  cursor: pointer;
}
.mes-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.mes-actions button {
  font-family: var(--ui-font, -apple-system, sans-serif);
  font-size: 13px;
  padding: 5px 14px;
  border-radius: 5px;
  border: 1px solid var(--border-color, #d0d0d0);
  background: var(--button-bg, #f5f5f5);
  color: var(--text-color, #1a1a1a);
  cursor: pointer;
}
.mes-primary {
  background: var(--accent-color, #0066cc) !important;
  color: #fff !important;
  border-color: var(--accent-color, #0066cc) !important;
}
```

### Implementation notes

**Focusable elements array** (for Tab cycling — EC-12):
```ts
const focusable = [htmlRadio, pdfRadio, exportBtn, cancelBtn];
```

**Keyboard handler** (attached to `document` at capture phase, removed on cleanup):
```ts
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    cleanup();
    resolve("cancel");
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const idx = focusable.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey
      ? (idx - 1 + focusable.length) % focusable.length
      : (idx + 1) % focusable.length;
    focusable[next].focus();
  }
  if (e.key === "Enter" || e.key === " ") {
    // Let the focused element handle Enter/Space naturally
    // (radio checked, button clicked)
  }
}
document.addEventListener("keydown", onKeyDown, true);
```

**Cleanup function** (called before every resolve path):
```ts
function cleanup(): void {
  sheet.remove();
  sheetStyle.remove();
  document.removeEventListener("keydown", onKeyDown, true);
}
```

**Initial focus**: set to `exportBtn` after the sheet is appended, so the user
can press Enter immediately to export as HTML.

**Full Promise scaffolding**:
```ts
return new Promise<"html" | "pdf" | "cancel">((resolve) => {
  cancelBtn.addEventListener("click", () => { cleanup(); resolve("cancel"); });
  exportBtn.addEventListener("click", () => {
    const fmt = pdfRadio.checked ? "pdf" : "html";
    cleanup();
    resolve(fmt);
  });
  // keyboard handler wired above
  document.body.appendChild(sheet);
  document.head.appendChild(sheetStyle);
  exportBtn.focus();
});
```

---

## 3. openExportDialog

The entry point orchestrator. This is the function `main.ts` calls from the
`file-export` dispatch case.

### Function signature

```ts
export async function openExportDialog(
  editor: EditorView | null,
  currentFilePath: string | null
): Promise<void>
```

### Module-level guard

Add a module-level flag at the top of the "Orchestration" section:

```ts
// Guard: prevents double-instantiation of the export sheet (EC-14).
let exportSheetOpen = false;
```

### Implementation

```ts
/**
 * Unified export orchestrator.
 *
 * FR-06.3: Shows the format selection sheet, then routes to exportAsHtml or
 * printDocument based on user choice. Cancellation is silent.
 *
 * EC-01:  Returns immediately if editor is null.
 * EC-14:  Returns immediately if the sheet is already open.
 */
export async function openExportDialog(
  editor: EditorView | null,
  currentFilePath: string | null
): Promise<void> {
  if (!editor) return;          // EC-01
  if (exportSheetOpen) return;  // EC-14

  exportSheetOpen = true;
  try {
    const choice = await createExportSheet();
    if (choice === "cancel") return;
    if (choice === "html") {
      await exportAsHtml(editor, currentFilePath);
    } else {
      printDocument(editor);
    }
  } finally {
    exportSheetOpen = false;
  }
}
```

The `finally` block resets the flag regardless of whether `exportAsHtml` throws
or `printDocument` throws, so the guard never gets stuck in the `true` state.

---

## Sequencing within export.ts

Place the new code in this order at the bottom of the file, after the existing
`exportAsHtml` function:

1. `let exportSheetOpen = false;`  (module-level flag)
2. `function createExportSheet(): Promise<...>` (internal, unexported)
3. `export function printDocument(...)` (exported, used by main.ts for file-print)
4. `export async function openExportDialog(...)` (exported, entry point)

---

## Acceptance criteria

- [ ] `export.ts` compiles with `tsc --noEmit` (no new type errors).
- [ ] `printDocument(null)` returns without error.
- [ ] `printDocument(fakeEditor)` calls `window.print()` and removes the overlay
      and style elements from the DOM afterward.
- [ ] If `window.print()` throws, overlay and style are still removed.
- [ ] `openExportDialog(null, null)` returns without showing a sheet.
- [ ] `openExportDialog(editor, null)` with a cancel response returns without
      calling `exportAsHtml` or `printDocument`.
- [ ] `openExportDialog(editor, path)` with an "html" response calls `exportAsHtml`.
- [ ] `openExportDialog(editor, path)` with a "pdf" response calls `printDocument`.
- [ ] `exportSheetOpen` flag prevents second instantiation while sheet is open.
- [ ] All previously passing tests in `tests/export.test.ts` continue to pass.

---

## Gotchas

**`window.print()` is synchronous on macOS**: The call blocks until the user
dismisses the print dialog. No async handling is needed. The `try/finally`
pattern works correctly for this synchronous blocking call.

**Do not import EditorView at the top of the test file**: `EditorView` is a
CodeMirror class that requires the browser DOM. The existing test file uses a
hand-rolled `makeEditor()` stub typed as `any`. New tests must follow the same
pattern.

**`createExportSheet` is not exported**: Tests for the sheet's Promise resolution
should drive it through `openExportDialog` with `createExportSheet` mocked at
the module level, OR test it by manipulating the DOM directly (click the Cancel
button after creating a real sheet in a jsdom environment). See step_05 for the
test approach.
