---
title: "step_05 — tests/export.test.ts additions"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# step_05 — Add new test groups to tests/export.test.ts

**Depends on**: step_03 (functions must exist before tests can import them)
**Blocks**: Code Reviewer sign-off

---

## Overview

The existing `tests/export.test.ts` file tests the pure functions. This step
adds three new `describe` groups covering the new orchestration functions added
in step_03. All existing tests must remain unchanged and continue to pass.

---

## New imports required

Add to the existing import from `../src/lib/export`:

```ts
import {
  escapeHtml,
  extractTitle,
  deriveExportFilename,
  enforceHtmlExtension,
  markdownToHtml,
  buildStandaloneHtml,
  exportAsHtml,
  printDocument,
  openExportDialog,
} from "../src/lib/export";
```

`createExportSheet` is not exported and therefore not directly imported. It is
tested indirectly through `openExportDialog` (see below).

---

## Test environment prerequisites

`printDocument` and `createExportSheet` manipulate `document.body`,
`document.head`, and call `window.print()`. Vitest with the `jsdom` environment
provides these. Confirm `vitest.config.ts` (or `vite.config.ts`) has
`environment: "jsdom"` set. If the current tests already run in jsdom (check
whether `document` is referenced anywhere in the existing test file — it is not,
suggesting a node environment), the new tests may need to be in a separate file
or the environment config updated.

**Preferred approach**: Add `@vitest-environment jsdom` docblock comment at the
top of the new describe groups, or split DOM-dependent tests into a separate
`tests/export-dom.test.ts` file with `@vitest-environment jsdom` at the top.

**The existing pure-function tests must not be disrupted.** If splitting, keep
the original `tests/export.test.ts` unchanged and create
`tests/export-dom.test.ts` for the DOM tests.

---

## Group A: printDocument

```ts
describe("printDocument", () => {
  let printSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    // Ensure clean DOM state
    document.getElementById("markable-print-style")?.remove();
    document.getElementById("markable-print-overlay")?.remove();
  });

  afterEach(() => {
    printSpy.mockRestore();
    document.getElementById("markable-print-style")?.remove();
    document.getElementById("markable-print-overlay")?.remove();
  });

  it("returns immediately when editor is null", () => {
    printDocument(null);
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("calls window.print()", () => {
    printDocument(makeEditor("# Hello"));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("removes print style and overlay after print", () => {
    printDocument(makeEditor("# Hello"));
    expect(document.getElementById("markable-print-style")).toBeNull();
    expect(document.getElementById("markable-print-overlay")).toBeNull();
  });

  it("removes print style and overlay even if window.print() throws", () => {
    printSpy.mockImplementation(() => { throw new Error("print blocked"); });
    expect(() => printDocument(makeEditor("# Hello"))).toThrow("print blocked");
    expect(document.getElementById("markable-print-style")).toBeNull();
    expect(document.getElementById("markable-print-overlay")).toBeNull();
  });

  it("injects overlay with MINIMAL_CSS and rendered HTML", () => {
    printSpy.mockImplementation(() => {
      const overlay = document.getElementById("markable-print-overlay");
      expect(overlay).not.toBeNull();
      expect(overlay!.innerHTML).toContain("markable-print-overlay");
    });
    printDocument(makeEditor("# Hello"));
  });
});
```

---

## Group B: openExportDialog

`createExportSheet` is not exported, so we cannot vi.mock it by path. Instead,
test `openExportDialog` by interacting with the DOM it creates. In jsdom,
`createExportSheet` appends elements synchronously; click events can be
dispatched synchronously to resolve the Promise.

An alternative: mock `createExportSheet` at the module level using
`vi.doMock`/`vi.importActual`. However, because `createExportSheet` is not
exported, the simplest reliable approach is DOM interaction.

```ts
describe("openExportDialog", () => {
  let exportAsHtmlSpy: ReturnType<typeof vi.spyOn>;
  let printDocumentSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // We cannot spy on unexported createExportSheet, but we can spy on the
    // downstream functions that openExportDialog calls.
    // Use vi.mock at module level for exportAsHtml (already mocked via bridge).
    // For printDocument, spy on the module export.
    exportAsHtmlSpy = vi.spyOn(
      await import("../src/lib/export"),
      "exportAsHtml"
    ).mockResolvedValue(undefined);
    printDocumentSpy = vi.spyOn(
      await import("../src/lib/export"),
      "printDocument"
    ).mockImplementation(() => {});
  });

  afterEach(() => {
    exportAsHtmlSpy.mockRestore();
    printDocumentSpy.mockRestore();
    document.getElementById("markable-export-sheet")?.remove();
    document.getElementById("markable-export-sheet-style")?.remove();
  });

  it("EC-01: returns without showing sheet when editor is null", async () => {
    await openExportDialog(null, null);
    expect(document.getElementById("markable-export-sheet")).toBeNull();
    expect(exportAsHtmlSpy).not.toHaveBeenCalled();
    expect(printDocumentSpy).not.toHaveBeenCalled();
  });

  it("EC-04: cancel → no export or print called", async () => {
    const promise = openExportDialog(makeEditor("hello"), "/tmp/file.md");
    // Sheet is now in DOM; click Cancel
    const cancelBtn = document.getElementById("mes-cancel-btn") as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    await promise;
    expect(exportAsHtmlSpy).not.toHaveBeenCalled();
    expect(printDocumentSpy).not.toHaveBeenCalled();
  });

  it("EC-04: Escape key cancels → no export or print called", async () => {
    const promise = openExportDialog(makeEditor("hello"), "/tmp/file.md");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await promise;
    expect(exportAsHtmlSpy).not.toHaveBeenCalled();
    expect(printDocumentSpy).not.toHaveBeenCalled();
  });

  it("HTML format → calls exportAsHtml with editor and filePath", async () => {
    const ed = makeEditor("hello");
    const promise = openExportDialog(ed, "/tmp/file.md");
    const exportBtn = document.getElementById("mes-export-btn") as HTMLButtonElement;
    exportBtn.click();  // HTML radio is checked by default
    await promise;
    expect(exportAsHtmlSpy).toHaveBeenCalledWith(ed, "/tmp/file.md");
    expect(printDocumentSpy).not.toHaveBeenCalled();
  });

  it("PDF format → calls printDocument with editor", async () => {
    const ed = makeEditor("hello");
    const promise = openExportDialog(ed, "/tmp/file.md");
    // Select PDF radio, then click Export
    const pdfRadio = document.querySelector<HTMLInputElement>(
      "input[type='radio'][value='pdf']"
    );
    expect(pdfRadio).not.toBeNull();
    pdfRadio!.checked = true;
    const exportBtn = document.getElementById("mes-export-btn") as HTMLButtonElement;
    exportBtn.click();
    await promise;
    expect(printDocumentSpy).toHaveBeenCalledWith(ed);
    expect(exportAsHtmlSpy).not.toHaveBeenCalled();
  });

  it("EC-14: double-trigger → only one sheet in DOM", async () => {
    const promise1 = openExportDialog(makeEditor("a"), null);
    const promise2 = openExportDialog(makeEditor("b"), null);
    const sheets = document.querySelectorAll("#markable-export-sheet");
    expect(sheets.length).toBe(1);
    // Clean up
    document.getElementById("mes-cancel-btn")?.click();
    await Promise.all([promise1, promise2]);
  });

  it("sheet is removed from DOM after cancel", async () => {
    const promise = openExportDialog(makeEditor("hello"), null);
    document.getElementById("mes-cancel-btn")?.click();
    await promise;
    expect(document.getElementById("markable-export-sheet")).toBeNull();
    expect(document.getElementById("markable-export-sheet-style")).toBeNull();
  });

  it("sheet is removed from DOM after export", async () => {
    const promise = openExportDialog(makeEditor("hello"), null);
    document.getElementById("mes-export-btn")?.click();
    await promise;
    expect(document.getElementById("markable-export-sheet")).toBeNull();
    expect(document.getElementById("markable-export-sheet-style")).toBeNull();
  });
});
```

---

## Group C: EC-19 regression — file-print path (integration note)

EC-19 (the `file-print` menu item must still work after refactoring) cannot be
directly unit tested in isolation because the handler lives in `main.ts`. It is
verified by the `printDocument` unit tests in Group A plus the visual acceptance
criterion in step_04. No additional automated test is required beyond Group A.

---

## Acceptance criteria

- [ ] All existing tests in `tests/export.test.ts` pass unchanged.
- [ ] Group A (printDocument): all 5 tests pass.
- [ ] Group B (openExportDialog): all 8 tests pass.
- [ ] `npm test` (or `npx vitest run`) exits with code 0.
- [ ] No new skipped (`it.skip`) tests — only add tests that can run in jsdom.

---

## Gotchas

**vi.spyOn on same-module functions**: Spying on `exportAsHtml` from within
`openExportDialog` requires that both are in the same ES module and that the
spy patches the live binding. In Vitest with ES modules this works when you spy
on the module's named export object (use `vi.spyOn(module, 'exportAsHtml')`
with a dynamic `import()`). If ESM live bindings cause issues, wrap
`exportAsHtml` and `printDocument` calls in `openExportDialog` through a
re-exported namespace object — but try the spy approach first.

**jsdom and window.print()**: jsdom does not implement `window.print()` by
default; calling it throws or is a no-op. Mock it with `vi.spyOn(window, 'print')`.

**Async timer in tests**: `createExportSheet` has no timeouts or debounces, so
no `vi.useFakeTimers()` is needed.

**DOM cleanup between tests**: Use `beforeEach`/`afterEach` to remove any
leftover `#markable-export-sheet` and `#markable-export-sheet-style` elements.
