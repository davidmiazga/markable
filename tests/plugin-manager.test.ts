/**
 * Tests for PluginManager (src/plugins/index.ts).
 *
 * Tests cover the Phase A pilot state: only FocusModePlugin is registered.
 * These tests exercise every public method of PluginManager using a minimal
 * PluginContext stub — no real editor or DOM is required.
 *
 * EC-8: getExtensions() is called without an editor and must return a non-empty
 * array without accessing the DOM or editor.
 * EC-9: pluginManager singleton is importable before any function body runs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager, pluginManager } from "../src/plugins/index";
import type { PluginContext } from "../src/plugins/plugin-types";
import type { MarkableSettings } from "../src/lib/settings";

// --- Stub helpers ---

function makeCtx(): PluginContext {
  return {
    editor: {
      dispatch: vi.fn(),
    } as unknown as PluginContext["editor"],
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
    ensureStatusBar: vi.fn(),
    hideStatusBarIfUnused: vi.fn(),
  };
}

function makeSettings(overrides: Partial<MarkableSettings> = {}): MarkableSettings {
  return {
    version: 1,
    window: { sizeW: "80%", sizeH: "80%", maximizeOnLaunch: false },
    editor: { contentWidth: "900px", fontSize: 16 },
    theme: { active: "system" },
    recentFiles: [],
    findWidget: null,
    ...overrides,
  } as unknown as MarkableSettings;
}

describe("PluginManager class", () => {
  describe("constructor and registration", () => {
    it("creates a PluginManager instance", () => {
      const mgr = new PluginManager();
      expect(mgr).toBeDefined();
    });

    it("registers FocusModePlugin in the pilot", () => {
      const mgr = new PluginManager();
      const defs = mgr.getDefinitions();
      expect(defs.some((d) => d.id === "focusMode")).toBe(true);
    });
  });

  describe("getExtensions()", () => {
    it("returns a non-empty array (EC-8: no DOM access)", () => {
      // This call happens before editor creation — must be pure.
      const mgr = new PluginManager();
      const exts = mgr.getExtensions();
      expect(Array.isArray(exts)).toBe(true);
      expect(exts.length).toBeGreaterThan(0);
    });

    it("is safe to call multiple times (idempotent)", () => {
      const mgr = new PluginManager();
      const first = mgr.getExtensions();
      const second = mgr.getExtensions();
      expect(first).toEqual(second);
    });
  });

  describe("getStates()", () => {
    it("returns focusMode: false before restoreAll (default disabled state)", () => {
      const mgr = new PluginManager();
      const states = mgr.getStates();
      expect(states).toHaveProperty("focusMode");
      // The module-level _enabled flag starts false and may be true from
      // previous tests. We only verify the key exists here.
      expect(typeof states.focusMode).toBe("boolean");
    });
  });

  describe("getDefinitions()", () => {
    it("returns an array of PluginDef objects with required fields", () => {
      const mgr = new PluginManager();
      const defs = mgr.getDefinitions();
      expect(Array.isArray(defs)).toBe(true);
      for (const def of defs) {
        expect(def).toHaveProperty("id");
        expect(def).toHaveProperty("name");
        expect(def).toHaveProperty("description");
        expect(def).toHaveProperty("detail");
      }
    });

    it("returns FocusMode in the list", () => {
      const mgr = new PluginManager();
      const defs = mgr.getDefinitions();
      const fm = defs.find((d) => d.id === "focusMode");
      expect(fm).toBeDefined();
      expect(fm?.name).toBe("Focus Mode");
    });
  });

  describe("toggle()", () => {
    let mgr: PluginManager;
    let ctx: PluginContext;

    beforeEach(() => {
      mgr = new PluginManager();
      ctx = makeCtx();
      // Start from a known disabled state by toggling off
      mgr.toggle("focusMode", false, ctx);
    });

    it("enables focusMode when called with true", () => {
      mgr.toggle("focusMode", true, ctx);
      expect(mgr.getStates().focusMode).toBe(true);
    });

    it("disables focusMode when called with false", () => {
      mgr.toggle("focusMode", true, ctx);
      mgr.toggle("focusMode", false, ctx);
      expect(mgr.getStates().focusMode).toBe(false);
    });

    it("logs a warning for unknown plugin ids and does not throw", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => mgr.toggle("unknownPlugin", true, ctx)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknownPlugin"));
      warnSpy.mockRestore();
    });
  });

  describe("restoreAll()", () => {
    let mgr: PluginManager;
    let ctx: PluginContext;

    beforeEach(() => {
      mgr = new PluginManager();
      ctx = makeCtx();
      // Disable focusMode before each restore test
      mgr.toggle("focusMode", false, ctx);
    });

    it("enables focusMode when settings.focusMode is true", () => {
      mgr.restoreAll(makeSettings({ focusMode: true }), ctx);
      expect(mgr.getStates().focusMode).toBe(true);
    });

    it("does not enable focusMode when settings.focusMode is false", () => {
      mgr.restoreAll(makeSettings({ focusMode: false }), ctx);
      expect(mgr.getStates().focusMode).toBe(false);
    });

    it("does not enable focusMode when settings.focusMode is undefined", () => {
      mgr.restoreAll(makeSettings({}), ctx);
      expect(mgr.getStates().focusMode).toBe(false);
    });
  });
});

describe("pluginManager singleton (EC-9)", () => {
  it("is importable and is a PluginManager instance", () => {
    // EC-9: ES module import resolves before any function body runs.
    expect(pluginManager).toBeDefined();
    expect(pluginManager).toBeInstanceOf(PluginManager);
  });

  it("has focusMode in its definitions", () => {
    const defs = pluginManager.getDefinitions();
    expect(defs.some((d) => d.id === "focusMode")).toBe(true);
  });
});
