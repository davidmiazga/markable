/**
 * Tests for FocusModePlugin (src/plugins/focus-mode/index.ts).
 *
 * Tests are pure unit tests — they exercise the MarkablePlugin interface
 * implementation without launching a real CM6 editor. The EditorView and
 * PluginContext are minimal stubs sufficient to verify:
 *   - onEnable/onDisable update the isEnabled() state correctly.
 *   - restoreFromSettings enables or disables based on the settings flag.
 *   - getExtensions() returns a non-empty array (the focusModeExtension array).
 *   - The plugin id equals the MarkableSettings key "focusMode".
 *
 * EC-4: getExtensions() is called without an editor and returns a static array.
 * EC-15: restoreFromSettings sets _enabled to true before calling onEnable.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { FocusModePlugin } from "../src/plugins/focus-mode/index";
import type { PluginContext } from "../src/plugins/plugin-types";
import type { MarkableSettings } from "../src/lib/settings";

// --- Minimal PluginContext stub ---

/** Creates a PluginContext stub that records dispatched effects. */
function makeCtx(): PluginContext & { dispatched: unknown[] } {
  const dispatched: unknown[] = [];
  return {
    editor: {
      dispatch(tr: unknown) { dispatched.push(tr); },
    } as unknown as PluginContext["editor"],
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
    ensureStatusBar: vi.fn(),
    hideStatusBarIfUnused: vi.fn(),
    dispatched,
  };
}

/** Minimal MarkableSettings with all required fields defaulted. */
function makeSettings(focusMode?: boolean): MarkableSettings {
  return {
    version: 1,
    window: { sizeW: "80%", sizeH: "80%", maximizeOnLaunch: false },
    editor: { contentWidth: "900px", fontSize: 16 },
    theme: { active: "system" },
    recentFiles: [],
    findWidget: null,
    focusMode,
  } as unknown as MarkableSettings;
}

describe("FocusModePlugin", () => {
  it("has id 'focusMode' matching the MarkableSettings key", () => {
    expect(FocusModePlugin.id).toBe("focusMode");
  });

  it("has required metadata fields (name, description, detail)", () => {
    expect(FocusModePlugin.name).toBe("Focus Mode");
    expect(FocusModePlugin.description).toBeTruthy();
    expect(FocusModePlugin.detail).toBeTruthy();
  });

  describe("isEnabled()", () => {
    it("returns false by default", () => {
      // Note: module-level state may be dirty from other tests; we use
      // onDisable to reset it to a known state before asserting.
      FocusModePlugin.onDisable(makeCtx());
      expect(FocusModePlugin.isEnabled()).toBe(false);
    });
  });

  describe("onEnable()", () => {
    beforeEach(() => {
      // Reset state before each test in this group
      FocusModePlugin.onDisable(makeCtx());
    });

    it("sets isEnabled() to true", () => {
      FocusModePlugin.onEnable(makeCtx());
      expect(FocusModePlugin.isEnabled()).toBe(true);
    });

    it("dispatches exactly one transaction to the editor", () => {
      const ctx = makeCtx();
      FocusModePlugin.onEnable(ctx);
      // A single dispatch call must have been made.
      expect(ctx.dispatched.length).toBe(1);
      // The dispatched object must have an effects property (CM6 transaction spec).
      const tr = ctx.dispatched[0] as { effects: unknown };
      expect(tr.effects).toBeDefined();
    });
  });

  describe("onDisable()", () => {
    beforeEach(() => {
      FocusModePlugin.onEnable(makeCtx());
    });

    it("sets isEnabled() to false", () => {
      FocusModePlugin.onDisable(makeCtx());
      expect(FocusModePlugin.isEnabled()).toBe(false);
    });

    it("dispatches exactly one transaction to the editor", () => {
      const ctx = makeCtx();
      FocusModePlugin.onDisable(ctx);
      expect(ctx.dispatched.length).toBe(1);
      const tr = ctx.dispatched[0] as { effects: unknown };
      expect(tr.effects).toBeDefined();
    });
  });

  describe("restoreFromSettings()", () => {
    it("enables when settings.focusMode is true", () => {
      FocusModePlugin.onDisable(makeCtx()); // start disabled
      FocusModePlugin.restoreFromSettings!(makeSettings(true), makeCtx());
      expect(FocusModePlugin.isEnabled()).toBe(true);
    });

    it("stays disabled when settings.focusMode is false", () => {
      FocusModePlugin.onDisable(makeCtx()); // already disabled
      FocusModePlugin.restoreFromSettings!(makeSettings(false), makeCtx());
      expect(FocusModePlugin.isEnabled()).toBe(false);
    });

    it("stays disabled when settings.focusMode is undefined", () => {
      FocusModePlugin.onDisable(makeCtx());
      FocusModePlugin.restoreFromSettings!(makeSettings(undefined), makeCtx());
      expect(FocusModePlugin.isEnabled()).toBe(false);
    });
  });

  describe("getExtensions()", () => {
    it("is defined and returns a non-empty array (EC-4: pure call, no editor needed)", () => {
      // getExtensions must be callable before the editor exists.
      const exts = FocusModePlugin.getExtensions!();
      expect(Array.isArray(exts)).toBe(true);
      expect(exts.length).toBeGreaterThan(0);
    });

    it("returns the same array on repeated calls (idempotent)", () => {
      const first = FocusModePlugin.getExtensions!();
      const second = FocusModePlugin.getExtensions!();
      // Structural equality — same elements in same order
      expect(first).toEqual(second);
    });
  });
});
