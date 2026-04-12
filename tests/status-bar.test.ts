/**
 * Tests for status-bar infrastructure (src/plugins/status-bar/status-bar.ts).
 *
 * These tests cover the status bar visibility helpers independent of any plugin wrapper.
 * Extracted from status-bar-plugin.test.ts during step_04b cleanup.
 *
 * EC-1:  ensureStatusBar does not throw when #statusbar is absent from the DOM.
 * EC-2:  hideStatusBarIfUnused does NOT hide the bar when a dependent is registered.
 * EC-3:  registerStatusBarDependent is idempotent (Set semantics).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureStatusBar,
  hideStatusBarIfUnused,
  registerStatusBarDependent,
  unregisterStatusBarDependent,
  getStatusBarVisible,
  setStatusBarVisible,
} from "../src/plugins/status-bar/status-bar";

beforeEach(() => {
  // The status-bar module uses module-level mutable state. Reset to known
  // baseline (hidden, no dependents) before each test to prevent cross-test
  // contamination.
  setStatusBarVisible(false);
  unregisterStatusBarDependent("wordCount");
  unregisterStatusBarDependent("focusMode");
  unregisterStatusBarDependent("typewriterMode");
  unregisterStatusBarDependent("statusBar");
});

describe("EC-1: ensureStatusBar — safe when #statusbar element is absent", () => {
  it("does not throw when #statusbar is not in the DOM", () => {
    // jsdom starts with an empty body. No #statusbar element exists unless created.
    // The optional chaining guards this path — confirm no exception is thrown.
    expect(() => ensureStatusBar()).not.toThrow();
  });

  it("sets the internal visible flag to true even without a DOM element", () => {
    ensureStatusBar();
    expect(getStatusBarVisible()).toBe(true);
  });
});

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
