/**
 * Tests for Step 2: CM6 Autocomplete Global
 *
 * Verifies that importing cm-globals.ts correctly assigns the
 * @codemirror/autocomplete module to window.__CM_AUTOCOMPLETE__,
 * while preserving the three existing CM6 globals.
 *
 * The tab manager global (__MARKABLE_TAB_MANAGER__) is assigned in main.ts
 * at runtime and cannot be tested in isolation here. Its assignment is
 * verified by inspecting the source placement (before pluginManager.loadPlugins).
 * EC-29 and EC-30 graceful-degradation tests live in step 9.
 */

import { describe, it, expect } from "vitest";

// Trigger the side-effect module. In Vitest, static imports execute the module
// exactly once before any tests run, which matches the real application behavior
// (cm-globals.ts is imported once at the top of main.ts).
import "../../../src/lib/cm-globals";

describe("cm-globals: __CM_AUTOCOMPLETE__", () => {
  it("assigns __CM_AUTOCOMPLETE__ to the window after import", () => {
    const cmAutocomplete = (window as any).__CM_AUTOCOMPLETE__;
    expect(cmAutocomplete).toBeDefined();
  });

  it("exposes the autocompletion function from @codemirror/autocomplete", () => {
    const cmAutocomplete = (window as any).__CM_AUTOCOMPLETE__;
    // The backlinks plugin uses autocompletion() to create a CM6 extension.
    expect(typeof cmAutocomplete.autocompletion).toBe("function");
  });

  it("exposes CompletionContext from @codemirror/autocomplete", () => {
    const cmAutocomplete = (window as any).__CM_AUTOCOMPLETE__;
    // CompletionContext is a class used to build custom completion sources.
    expect(cmAutocomplete.CompletionContext).toBeDefined();
  });
});

describe("cm-globals: existing globals remain intact", () => {
  it("still assigns __CM_STATE__ after adding __CM_AUTOCOMPLETE__", () => {
    expect((window as any).__CM_STATE__).toBeDefined();
    expect(typeof (window as any).__CM_STATE__.EditorState).toBe("function");
  });

  it("still assigns __CM_VIEW__ after adding __CM_AUTOCOMPLETE__", () => {
    expect((window as any).__CM_VIEW__).toBeDefined();
    expect(typeof (window as any).__CM_VIEW__.EditorView).toBe("function");
  });

  it("still assigns __CM_LANGUAGE__ after adding __CM_AUTOCOMPLETE__", () => {
    expect((window as any).__CM_LANGUAGE__).toBeDefined();
    expect(typeof (window as any).__CM_LANGUAGE__.syntaxTree).toBe("function");
  });
});
