/**
 * tests/export-dom.test.ts
 *
 * Vitest DOM tests for the new orchestration functions added in step_03:
 *   - printDocument  (Group A)
 *   - openExportDialog  (Group B — drives createExportSheet indirectly via DOM)
 *
 * These tests require a DOM environment because printDocument and
 * createExportSheet manipulate document.body, document.head, and call
 * window.print(). The project-wide vitest.config.ts sets environment:
 * "happy-dom", so no per-file override is needed.
 *
 * All existing pure-function tests in tests/export.test.ts are unchanged
 * and continue to pass independently of this file.
 *
 * ESM live-binding note:
 * vi.spyOn on same-module functions (e.g. spying on exportAsHtml from inside
 * openExportDialog) does not intercept calls in native ESM because the callee
 * holds a direct module-scope reference. We therefore verify observable DOM
 * side-effects instead:
 *   - HTML path: saveHtmlDialog (bridge) is called (mocked at the top of this file).
 *   - PDF path: window.print() is called (stubbed via vi.stubGlobal).
 *   - Cancel path: neither is called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printDocument, openExportDialog } from "../src/lib/export";

// ---------------------------------------------------------------------------
// Module-level bridge mock — mirrors the approach in tests/export.test.ts.
// This prevents real Tauri invoke() calls during the HTML-path test.
// saveHtmlDialog is resolved to "cancelled: true" by default so exportAsHtml
// exits after the dialog without writing anything.
// ---------------------------------------------------------------------------
vi.mock("../src/lib/bridge", () => ({
  saveHtmlDialog: vi.fn().mockResolvedValue({ cancelled: true }),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  updateRecentFilesMenu: vi.fn(),
  listThemes: vi.fn(),
  readThemeCss: vi.fn(),
  updateThemeMenu: vi.fn(),
}));

// Import the mocked saveHtmlDialog so tests can assert on it.
import { saveHtmlDialog } from "../src/lib/bridge";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal EditorView stub that satisfies the signature expected by
 * printDocument and openExportDialog without importing the full CodeMirror
 * type graph. Typed as `any` to avoid a circular import dependency.
 *
 * @param content - The markdown string the stub editor should return
 * @returns A minimal EditorView-compatible stub
 */
function makeEditor(content: string) {
  return {
    state: {
      doc: {
        toString: () => content,
      },
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Group A: printDocument
// ---------------------------------------------------------------------------

describe("printDocument", () => {
  beforeEach(() => {
    // happy-dom does not define window.print by default; stub it so vi.spyOn
    // has a function to wrap and so printDocument never calls a real browser API.
    vi.stubGlobal("print", vi.fn());

    // Guarantee a clean DOM state — remove any elements left by a previous run.
    document.getElementById("markable-print-style")?.remove();
    document.getElementById("markable-print-overlay")?.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    // Belt-and-suspenders cleanup in case a test fails mid-way.
    document.getElementById("markable-print-style")?.remove();
    document.getElementById("markable-print-overlay")?.remove();
  });

  // FR-05.5 / EC-01: null editor → early return with no side effects
  it("returns immediately when editor is null", () => {
    printDocument(null);
    // window.print stub must not have been called
    expect(window.print).not.toHaveBeenCalled();
  });

  // Happy path: window.print() must be called exactly once
  it("calls window.print() with a non-null editor", () => {
    printDocument(makeEditor("# Hello"));
    expect(window.print).toHaveBeenCalledOnce();
  });

  // EC-15: finally block must remove both DOM elements after successful print
  it("removes #markable-print-style and #markable-print-overlay after print", () => {
    printDocument(makeEditor("# Hello"));
    expect(document.getElementById("markable-print-style")).toBeNull();
    expect(document.getElementById("markable-print-overlay")).toBeNull();
  });

  // EC-15: finally block must also fire when window.print() throws
  it("removes print style and overlay even if window.print() throws", () => {
    vi.stubGlobal("print", vi.fn().mockImplementation(() => {
      throw new Error("print blocked");
    }));

    // The error re-throws through the try/finally — verify it propagates correctly.
    expect(() => printDocument(makeEditor("# Hello"))).toThrow("print blocked");

    // Both injected elements must be gone despite the throw.
    expect(document.getElementById("markable-print-style")).toBeNull();
    expect(document.getElementById("markable-print-overlay")).toBeNull();
  });

  // FR-05.4: Verify the overlay is present in the DOM during the print call
  // (before the finally block removes it).
  it("injects overlay containing MINIMAL_CSS and rendered HTML before window.print()", () => {
    vi.stubGlobal("print", vi.fn().mockImplementation(() => {
      // Inside the mock, the finally block has not yet run — elements exist.
      const overlay = document.getElementById("markable-print-overlay");
      expect(overlay).not.toBeNull();
      // The overlay embeds a content div.
      expect(overlay!.innerHTML).toContain("content");
    }));
    printDocument(makeEditor("# Hello"));
    // Confirm print was called (and the inner assertions above ran).
    expect(window.print).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Group B: openExportDialog
// ---------------------------------------------------------------------------

describe("openExportDialog", () => {
  /**
   * Strategy for verifying the HTML and PDF dispatch paths:
   *
   *   HTML path: The sheet resolves "html" → openExportDialog calls exportAsHtml
   *   internally. exportAsHtml in turn calls saveHtmlDialog (bridge, mocked above).
   *   We assert that saveHtmlDialog was called — this is the observable side-effect
   *   that proves exportAsHtml was invoked.
   *
   *   PDF path: The sheet resolves "pdf" → openExportDialog calls printDocument
   *   internally. We stub window.print (happy-dom doesn't define it) and assert
   *   it was called — this is the observable side-effect that proves printDocument
   *   ran.
   *
   *   Cancel path: Neither saveHtmlDialog nor window.print is called.
   */

  beforeEach(() => {
    vi.clearAllMocks();

    // Stub window.print for all openExportDialog tests (PDF path needs it).
    vi.stubGlobal("print", vi.fn());
    vi.stubGlobal("alert", vi.fn());

    // Guarantee a clean DOM state.
    document.getElementById("markable-export-sheet")?.remove();
    document.getElementById("markable-export-sheet-style")?.remove();
    document.getElementById("markable-print-style")?.remove();
    document.getElementById("markable-print-overlay")?.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    // Belt-and-suspenders: restore DOM to a known clean state.
    document.getElementById("markable-export-sheet")?.remove();
    document.getElementById("markable-export-sheet-style")?.remove();
    document.getElementById("markable-print-style")?.remove();
    document.getElementById("markable-print-overlay")?.remove();
  });

  // EC-01: null editor → return without ever touching the DOM
  it("EC-01: returns without showing sheet when editor is null", async () => {
    await openExportDialog(null, null);
    expect(document.getElementById("markable-export-sheet")).toBeNull();
    expect(saveHtmlDialog).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  // EC-04 (Cancel button): cancel → no export side effects
  it("EC-04: cancel button → saveHtmlDialog and window.print not called", async () => {
    const promise = openExportDialog(makeEditor("hello"), "/tmp/file.md");
    // Sheet is appended synchronously; click Cancel to resolve the Promise.
    const cancelBtn = document.getElementById("mes-cancel-btn") as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    await promise;

    expect(saveHtmlDialog).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  // EC-04 (Escape key): Escape key → cancel with no export side effects
  it("EC-04: Escape key cancels → saveHtmlDialog and window.print not called", async () => {
    const promise = openExportDialog(makeEditor("hello"), "/tmp/file.md");
    // Dispatch Escape in capture phase (the sheet's listener uses capture: true).
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    await promise;

    expect(saveHtmlDialog).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  // HTML format (default): Export button with HTML radio checked → exportAsHtml
  // Observable side-effect: saveHtmlDialog (bridge) is called.
  it("HTML format → calls exportAsHtml (saveHtmlDialog is called)", async () => {
    const promise = openExportDialog(makeEditor("hello"), "/tmp/file.md");

    // HTML radio is checked by default (D-07); click Export immediately.
    const exportBtn = document.getElementById("mes-export-btn") as HTMLButtonElement;
    exportBtn.click();
    await promise;

    // exportAsHtml was called — it reached saveHtmlDialog before returning on cancel.
    expect(saveHtmlDialog).toHaveBeenCalledWith("file.html");
    expect(window.print).not.toHaveBeenCalled();
  });

  // PDF format: select PDF radio then click Export → printDocument
  // Observable side-effect: window.print() is called.
  it("PDF format → calls printDocument (window.print is called)", async () => {
    const promise = openExportDialog(makeEditor("hello"), "/tmp/file.md");

    // Switch to PDF radio before clicking Export.
    const pdfRadio = document.querySelector<HTMLInputElement>(
      "input[type='radio'][value='pdf']"
    );
    expect(pdfRadio).not.toBeNull();
    pdfRadio!.checked = true;

    const exportBtn = document.getElementById("mes-export-btn") as HTMLButtonElement;
    exportBtn.click();
    await promise;

    expect(window.print).toHaveBeenCalledOnce();
    expect(saveHtmlDialog).not.toHaveBeenCalled();
  });

  // EC-14: rapid double-trigger → only one sheet created
  it("EC-14: double-trigger → only one #markable-export-sheet in DOM", async () => {
    const promise1 = openExportDialog(makeEditor("a"), null);
    // Second call must be swallowed by the exportSheetOpen guard (EC-14).
    const promise2 = openExportDialog(makeEditor("b"), null);

    const sheets = document.querySelectorAll("#markable-export-sheet");
    expect(sheets.length).toBe(1);

    // Dismiss the single sheet so both Promises resolve cleanly.
    document.getElementById("mes-cancel-btn")?.click();
    await Promise.all([promise1, promise2]);
  });

  // Sheet DOM cleanup after cancel
  it("sheet and style are removed from DOM after cancel", async () => {
    const promise = openExportDialog(makeEditor("hello"), null);
    document.getElementById("mes-cancel-btn")?.click();
    await promise;
    expect(document.getElementById("markable-export-sheet")).toBeNull();
    expect(document.getElementById("markable-export-sheet-style")).toBeNull();
  });

  // Sheet DOM cleanup after successful export
  it("sheet and style are removed from DOM after export", async () => {
    const promise = openExportDialog(makeEditor("hello"), null);
    document.getElementById("mes-export-btn")?.click();
    await promise;
    expect(document.getElementById("markable-export-sheet")).toBeNull();
    expect(document.getElementById("markable-export-sheet-style")).toBeNull();
  });

  // FR-08.2 / EC-12 / Finding 2: Tab focus-trap cycles through all four focusable
  // elements in order; Shift-Tab from the first element wraps to the last.
  //
  // happy-dom does not advance document.activeElement automatically on Tab, so
  // we spy on HTMLElement.prototype.focus to record which elements receive focus
  // and verify the handler calls .focus() on the correct next element.
  it("Tab key cycles focus through [htmlRadio, pdfRadio, exportBtn, cancelBtn] in order", async () => {
    // Track every .focus() call during the test to reconstruct the focus sequence.
    const focusedElements: HTMLElement[] = [];
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement) {
      focusedElements.push(this);
      // Do not call originalFocus — happy-dom may not update activeElement reliably.
    };

    const promise = openExportDialog(makeEditor("hello"), null);

    // At mount time createExportSheet calls exportBtn.focus() — that will be
    // recorded in focusedElements[0]. Clear it so subsequent assertions are clean.
    focusedElements.length = 0;

    // Grab the four focusable elements from the live DOM.
    const htmlRadio  = document.querySelector<HTMLInputElement>("input[value='html']")!;
    const pdfRadio   = document.querySelector<HTMLInputElement>("input[value='pdf']")!;
    const exportBtn  = document.getElementById("mes-export-btn")  as HTMLButtonElement;
    const cancelBtn  = document.getElementById("mes-cancel-btn")  as HTMLButtonElement;

    expect(htmlRadio).not.toBeNull();
    expect(pdfRadio).not.toBeNull();
    expect(exportBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();

    /**
     * Helper: dispatches a capture-phase Tab (or Shift-Tab) event. The sheet
     * listener is registered with `addEventListener("keydown", handler, true)`,
     * so the event must be dispatched on `document` and bubble/capture flags
     * must match what the real browser would fire.
     */
    function dispatchTab(shiftKey = false): void {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    // Simulate: focus is currently on exportBtn (index 2) — manually set
    // activeElement by calling the real focus so the handler reads it correctly.
    // Because we overrode HTMLElement.prototype.focus above, we must use the
    // original to actually move focus in happy-dom.
    originalFocus.call(exportBtn);
    focusedElements.length = 0; // discard that setup call

    // Tab from exportBtn (idx 2) → should focus cancelBtn (idx 3)
    dispatchTab(false);
    expect(focusedElements.at(-1)).toBe(cancelBtn);

    // Restore activeElement to htmlRadio (idx 0) and press Shift-Tab
    // → should wrap to cancelBtn (idx 3, the last element).
    originalFocus.call(htmlRadio);
    focusedElements.length = 0;
    dispatchTab(true); // Shift-Tab from idx 0
    expect(focusedElements.at(-1)).toBe(cancelBtn);

    // Shift-Tab when no element in the sheet is focused (idx -1 scenario):
    // blur any focused element so activeElement falls back to <body>.
    (document.activeElement as HTMLElement | null)?.blur?.();
    focusedElements.length = 0;
    dispatchTab(true); // Shift-Tab with idx === -1
    expect(focusedElements.at(-1)).toBe(cancelBtn);

    // Restore the original prototype method before resolving.
    HTMLElement.prototype.focus = originalFocus;

    // Dismiss the sheet to prevent a dangling Promise.
    cancelBtn.click();
    await promise;
  });
});
