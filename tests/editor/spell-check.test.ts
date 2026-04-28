/**
 * tests/editor/spell-check.test.ts
 *
 * Unit tests for the spell-check toggle feature (step_02 of the
 * wiki-autocomplete + spell-check spec).
 *
 * Tests cover EC-B.01 through EC-B.06 as mapped in the spec.
 *
 * The tests mock `window.__MARKABLE_EDITOR_VIEW__` and assert that
 * `applyEditorSettings()` dispatches compartment-reconfigure effects
 * to the live EditorView. They do NOT mount a real CM6 view.
 *
 * EC-B.06 (multiple tabs) is documented as N/A — Markable has a single
 * EditorView for the application lifetime (AD-06 in 00_index.md). No
 * failing test is needed; the comment below serves as the coverage record.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { applyEditorSettings, DEFAULT_SETTINGS } from "../../src/lib/settings";

// ---------------------------------------------------------------------------
// EC-B.06 (N/A) — Multiple EditorView instances
// ---------------------------------------------------------------------------
//
// This project has exactly ONE EditorView for the application lifetime
// (AD-06). TabManager reuses the single view via setState(), it does NOT
// call buildExtensions() or createEditor() per tab. Therefore
// spellCheckCompartment is safely module-level (same pattern as
// previewCompartment and editableCompartment). No multi-view test is
// required or meaningful.

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Install mock globals for the spell-check dispatch path:
 *   __MARKABLE_EDITOR_VIEW__           — mock EditorView with dispatch spy
 *   __MARKABLE_SPELL_CHECK_COMPARTMENT__ — mock Compartment with reconfigure stub
 *   __CM_VIEW__                        — mock CM6 view module with contentAttributes stub
 *
 * Returns the `dispatch` spy so callers can assert on it.
 */
function installMockView(): ReturnType<typeof vi.fn> {
  const dispatchMock = vi.fn();
  (window as any).__MARKABLE_EDITOR_VIEW__ = { dispatch: dispatchMock };
  (window as any).__MARKABLE_SPELL_CHECK_COMPARTMENT__ = {
    reconfigure: vi.fn(() => "mock-effect"),
  };
  (window as any).__CM_VIEW__ = {
    EditorView: {
      contentAttributes: { of: vi.fn(() => "mock-attr") },
    },
  };
  return dispatchMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spell check — applyEditorSettings", () => {
  afterEach(() => {
    delete (window as any).__MARKABLE_EDITOR_VIEW__;
    delete (window as any).__MARKABLE_SPELL_CHECK_COMPARTMENT__;
    delete (window as any).__CM_VIEW__;
    vi.restoreAllMocks();
  });

  // EC-B.04 — view not yet initialised (called before createEditor completes)
  it("is a no-op when __MARKABLE_EDITOR_VIEW__ is absent", () => {
    /*
     * EC-B.04: applyEditorSettings is called during startup before the
     * EditorView has been created. The function must not throw and must
     * silently skip the compartment dispatch. The compartment's initial
     * value ("false") holds until applyEditorSettings is called again
     * after the view has mounted (AD-07).
     */
    delete (window as any).__MARKABLE_EDITOR_VIEW__;
    expect(() =>
      applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true })
    ).not.toThrow();
  });

  // EC-B.02 — toggle on
  it("spellCheck: true causes dispatch to be called", () => {
    /*
     * EC-B.02: When spellCheck is true, applyEditorSettings must dispatch
     * a compartment reconfiguration to the live EditorView. The exact
     * effect payload is implementation-internal; we assert that dispatch
     * was called at least once (FR-B.2).
     */
    const dispatchMock = installMockView();
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  // EC-B.02 — toggle off
  it("spellCheck: false causes dispatch to be called", () => {
    /*
     * Toggling off must also dispatch (the compartment value changes from
     * "true" to "false"). Both transitions produce a dispatch call.
     */
    const dispatchMock = installMockView();
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: false });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  // EC-B.01 — old settings file without spellCheck field
  it("treats absent spellCheck as false — dispatch is called, not undefined", () => {
    /*
     * EC-B.01: When an old settings file is loaded, the editor object will
     * not have the spellCheck field. applyEditorSettings must use
     * `?? false` to coerce undefined → false, preventing `spellcheck="undefined"`
     * on the .cm-content DOM element (AD-09).
     *
     * We assert: dispatch IS called (the function did not throw or early-return),
     * and the call argument's effects property is defined (not undefined).
     */
    const dispatchMock = installMockView();
    const oldEditor = {
      contentMaxWidth: 900,
      contentPadding: "responsive",
      baseFontSize: 16,
      // spellCheck deliberately absent to simulate old settings file
    };
    applyEditorSettings(oldEditor as any);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const callArg = dispatchMock.mock.calls[0][0];
    // The call argument must have an `effects` property (not undefined)
    // so that CM6 can process the compartment reconfiguration.
    expect(callArg.effects).toBeDefined();
  });

  // EC-B.03 — rapid toggle
  it("rapid calls each dispatch independently without error", () => {
    /*
     * EC-B.03: The user may rapidly toggle the checkbox multiple times.
     * Each applyEditorSettings call must be independent and synchronous.
     * Three alternating calls → three dispatch calls, no errors.
     */
    const dispatchMock = installMockView();
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true });
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: false });
    applyEditorSettings({ ...DEFAULT_SETTINGS.editor, spellCheck: true });
    expect(dispatchMock).toHaveBeenCalledTimes(3);
  });

  // EC-B.05 — DEFAULT_SETTINGS has spellCheck: false
  it("DEFAULT_SETTINGS.editor.spellCheck is false", () => {
    /*
     * EC-B.05: The factory default must be spellCheck: false so that
     * (a) new installs start with spell check off, and (b) the Reset-All
     * handler (which calls applyEditorSettings(DEFAULT_SETTINGS.editor))
     * turns spell check off when reset is triggered (FR-B.6, AD-08).
     */
    expect(DEFAULT_SETTINGS.editor.spellCheck).toBe(false);
  });
});
