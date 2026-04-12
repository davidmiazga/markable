/**
 * Tests for StatusBarPlugin (src/plugins/status-bar/index.ts) and the
 * underlying status-bar infrastructure (src/plugins/status-bar/status-bar.ts).
 *
 * All tests are pure unit tests — no real editor or DOM element is required
 * for the core logic (the optional chaining guards ensure safety). Where DOM
 * elements are created they are standalone divs not attached to a document body.
 *
 * Edge cases covered:
 *   EC-1:  ensureStatusBar does not throw when #statusbar is absent from the DOM.
 *   EC-2:  hideStatusBarIfUnused does NOT hide the bar when Word Count is registered.
 *   EC-3:  registerStatusBarDependent is idempotent (same id twice → set size = 1).
 *   EC-12: StatusBarPlugin.onDisable does not force the bar hidden when Word Count
 *          is still registered as a dependent.
 *   EC-15: restoreFromSettings correctly enables (visible: true), disables (visible:
 *          false), or leaves disabled (undefined) the status bar.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StatusBarPlugin } from "../src/plugins/status-bar/index";
import {
  ensureStatusBar,
  hideStatusBarIfUnused,
  registerStatusBarDependent,
  unregisterStatusBarDependent,
  getStatusBarVisible,
  setStatusBarVisible,
} from "../src/plugins/status-bar/status-bar";
import type { PluginContext } from "../src/plugins/plugin-types";
import type { MarkableSettings } from "../src/lib/settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal PluginContext stub.
 * None of the StatusBarPlugin lifecycle methods use editor or statusBar zones,
 * but the stub must satisfy the interface shape.
 */
function makeCtx(): PluginContext {
  return {
    editor: { dispatch: vi.fn() } as unknown as PluginContext["editor"],
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
    ensureStatusBar: vi.fn(),
    hideStatusBarIfUnused: vi.fn(),
  };
}

/**
 * Builds a minimal MarkableSettings object.
 * The `statusBar` field is the structured object type, not a plain boolean.
 *
 * @param statusBar - Optional statusBar settings. Omit for undefined.
 */
function makeSettings(
  statusBar?: { visible: boolean },
): MarkableSettings {
  return {
    version: 1,
    window: { sizeW: "80%", sizeH: "80%", maximizeOnLaunch: false },
    editor: { contentWidth: "900px", fontSize: 16 },
    theme: { active: "system" },
    recentFiles: [],
    findWidget: null,
    statusBar,
  } as unknown as MarkableSettings;
}

// ---------------------------------------------------------------------------
// Reset shared module state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // The status-bar module uses module-level mutable state. Reset to known
  // baseline (hidden, no dependents) before each test to prevent cross-test
  // contamination.
  setStatusBarVisible(false);
  // Clear any dependents registered by previous tests by unregistering known ids.
  unregisterStatusBarDependent("wordCount");
  unregisterStatusBarDependent("focusMode");
  unregisterStatusBarDependent("typewriterMode");
  unregisterStatusBarDependent("statusBar");
});

// ---------------------------------------------------------------------------
// EC-1: ensureStatusBar does not throw when #statusbar is absent from DOM
// ---------------------------------------------------------------------------

describe("EC-1: ensureStatusBar — safe when #statusbar element is absent", () => {
  it("does not throw when #statusbar is not in the DOM", () => {
    // jsdom starts with an empty body. No #statusbar element exists unless created.
    // The optional chaining `getElementById("statusbar")?.classList.remove(...)` guards
    // this path. Confirm no exception is thrown.
    expect(() => ensureStatusBar()).not.toThrow();
  });

  it("sets the internal visible flag to true even without a DOM element", () => {
    ensureStatusBar();
    expect(getStatusBarVisible()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EC-2: hideStatusBarIfUnused respects registered dependents
// ---------------------------------------------------------------------------

describe("EC-2: hideStatusBarIfUnused — does not hide when a dependent is registered", () => {
  it("hides the bar when no dependents are registered", () => {
    setStatusBarVisible(true);
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(false);
  });

  it("does NOT hide when Word Count is registered as a dependent", () => {
    setStatusBarVisible(true);
    registerStatusBarDependent("wordCount");
    hideStatusBarIfUnused();
    // The bar must remain visible because wordCount is still in the set.
    expect(getStatusBarVisible()).toBe(true);
  });

  it("hides the bar once the sole dependent is unregistered", () => {
    setStatusBarVisible(true);
    registerStatusBarDependent("wordCount");
    unregisterStatusBarDependent("wordCount");
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EC-3: registerStatusBarDependent is idempotent
// ---------------------------------------------------------------------------

describe("EC-3: registerStatusBarDependent — idempotent (Set semantics)", () => {
  it("registering the same id twice keeps effective set size at 1", () => {
    registerStatusBarDependent("wordCount");
    registerStatusBarDependent("wordCount");
    // After two registers, one unregister should empty the set so
    // hideStatusBarIfUnused() can hide the bar.
    unregisterStatusBarDependent("wordCount");
    setStatusBarVisible(true);
    hideStatusBarIfUnused();
    // If size were 2 after two registers, one unregister would leave it at 1
    // and hideStatusBarIfUnused would keep the bar visible — that would be wrong.
    expect(getStatusBarVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EC-12: StatusBarPlugin.onDisable does not force-hide when Word Count is active
// ---------------------------------------------------------------------------

describe("EC-12: StatusBarPlugin.onDisable respects dependents", () => {
  it("does not hide the bar when Word Count is still registered", () => {
    // Simulate: StatusBar is enabled, Word Count is also enabled.
    setStatusBarVisible(true);
    registerStatusBarDependent("wordCount");

    // The user disables the Status Bar toggle explicitly.
    StatusBarPlugin.onDisable(makeCtx());

    // Because hideStatusBarIfUnused() checks the set and finds wordCount still
    // registered, the bar must remain visible.
    expect(getStatusBarVisible()).toBe(true);
  });

  it("hides the bar when no dependents remain at onDisable time", () => {
    setStatusBarVisible(true);
    // No dependents registered.
    StatusBarPlugin.onDisable(makeCtx());
    expect(getStatusBarVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EC-15: restoreFromSettings — all three paths
// ---------------------------------------------------------------------------

describe("EC-15: StatusBarPlugin.restoreFromSettings", () => {
  it("enables (shows) the bar when settings.statusBar.visible is true", () => {
    StatusBarPlugin.restoreFromSettings!(makeSettings({ visible: true }), makeCtx());
    expect(StatusBarPlugin.isEnabled()).toBe(true);
  });

  it("leaves the bar hidden when settings.statusBar.visible is false", () => {
    StatusBarPlugin.restoreFromSettings!(makeSettings({ visible: false }), makeCtx());
    expect(StatusBarPlugin.isEnabled()).toBe(false);
  });

  it("leaves the bar hidden when settings.statusBar is undefined", () => {
    // settings.statusBar is absent; .visible is therefore undefined.
    StatusBarPlugin.restoreFromSettings!(makeSettings(undefined), makeCtx());
    expect(StatusBarPlugin.isEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StatusBarPlugin metadata
// ---------------------------------------------------------------------------

describe("StatusBarPlugin metadata", () => {
  it("has id 'statusBar' matching the MarkableSettings key", () => {
    expect(StatusBarPlugin.id).toBe("statusBar");
  });

  it("has handlesOwnPersistence: true to prevent generic boolean overwrite", () => {
    // This flag tells PluginManager.toggle() to skip the generic updateSettings
    // call that would write `{ statusBar: true }` and corrupt the structured value.
    expect(StatusBarPlugin.handlesOwnPersistence).toBe(true);
  });
});
