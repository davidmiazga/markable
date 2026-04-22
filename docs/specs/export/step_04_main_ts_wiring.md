---
title: "step_04 — main.ts wiring"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# step_04 — Wire main.ts to openExportDialog; remove inline printDocument

**Depends on**: step_03 (export.ts must have `openExportDialog` and `printDocument`
exported before main.ts can import them)
**Blocks**: step_05 (tests may mock the import path)

---

## Overview

Three changes to `src/main.ts`:

1. Update the import from `./lib/export` to include `openExportDialog` and
   `printDocument`.
2. Replace the `case "file-export"` dispatch with a call to `openExportDialog`.
3. Remove the inline `printDocument()` function definition.
4. Update the `case "file-print"` dispatch to pass `editor` to the imported
   `printDocument`.

---

## Change 1 — Update import

### Current (line 89)

```ts
import { exportAsHtml, markdownToHtml, MINIMAL_CSS } from "./lib/export";
```

### Target

```ts
import { exportAsHtml, markdownToHtml, MINIMAL_CSS, openExportDialog, printDocument } from "./lib/export";
```

`exportAsHtml` and `MINIMAL_CSS` remain in the import because they may be used
elsewhere in `main.ts` (e.g. `MINIMAL_CSS` is used in the old `printDocument`).
After the inline `printDocument` is removed, audit whether `MINIMAL_CSS` and
`exportAsHtml` are still referenced directly in `main.ts`. If neither is used
elsewhere, they can be removed from the import to keep it tidy — but this is
optional cleanup and must not break compilation.

---

## Change 2 — Update case "file-export" dispatch

### Current (around line 645)

```ts
case "file-export":     void exportAsHtml(editor, tabManager.getActiveFilePath()); break;
```

### Target

```ts
case "file-export":     void openExportDialog(editor, tabManager.getActiveFilePath()); break;
```

The surrounding comment on the line above ("file-export uses getActiveFilePath()
— no longer references the removed currentFilePath variable") can be removed or
updated to reflect the new orchestrator name.

---

## Change 3 — Remove inline printDocument function definition

Delete the entire `printDocument` function block from `main.ts` (currently
approximately lines 440-476 based on reading):

```ts
/**
 * Print the current document.
 * ...
 */
function printDocument(): void {
  if (!editor) return;
  ...
  window.print();
  style.remove();
  overlay.remove();
}
```

This function is now replaced by the exported `printDocument(editor)` from
`./lib/export`.

---

## Change 4 — Update case "file-print" dispatch

The `case "file-print"` handler currently calls the now-deleted local
`printDocument()` function. Update it to call the imported one with `editor`
as a parameter.

### Current (around line 646)

```ts
case "file-print":      printDocument(); break;
```

### Target

```ts
case "file-print":      printDocument(editor); break;
```

This is the only change to the `file-print` path. The menu item ID, accelerator,
and command bar entry are all untouched.

---

## Sequencing note

All four changes are in `src/main.ts` and should be made in a single edit
session to avoid a transient broken state where `printDocument` is both defined
locally and imported.

---

## Acceptance criteria

- [ ] `main.ts` compiles without errors.
- [ ] The inline `printDocument()` function no longer exists in `main.ts`.
- [ ] `case "file-export"` calls `openExportDialog(editor, ...)`.
- [ ] `case "file-print"` calls `printDocument(editor)`.
- [ ] `Cmd-Alt-E` (file-export) opens the format selection sheet.
- [ ] `Cmd-P` (file-print) still opens the system print dialog directly,
      without showing the format selection sheet.
- [ ] HTML export via the sheet produces a valid `.html` file.
- [ ] PDF path via the sheet opens the macOS print dialog.
- [ ] `npm run tauri dev` starts without TypeScript errors.

---

## Gotchas

**Closure → parameter migration**: The old `printDocument()` closed over the
module-level `editor` variable. The new `printDocument(editor)` receives it as
a parameter. `editor` in `main.ts` is always the module-level `editor` variable
(or `null` before initialization), so `printDocument(editor)` passes the same
value that the closure read. No behavioral change.

**MINIMAL_CSS still needed?**: After removing the inline `printDocument`,
`MINIMAL_CSS` is no longer directly referenced in `main.ts` — it is only used
inside the new `printDocument` in `export.ts`. Remove it from the `main.ts`
import if it is not used elsewhere. Check with a `grep` before removing.
