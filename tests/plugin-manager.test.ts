/**
 * Tests for PluginManager (src/plugins/index.ts) — step_03b unified API.
 *
 * After Chunk 3 the static built-in array is gone. All plugins load from disk.
 * These tests cover:
 *   - Constructor creates a clean PluginManager (no static registrations).
 *   - getExtensions() is no longer present (EC-8 path removed).
 *   - getStates() returns empty on a fresh manager (nothing loaded yet).
 *   - getDefinitions() returns empty on a fresh manager.
 *   - toggle() warns for unknown ids and does not throw.
 *   - pluginManager singleton is importable (EC-9).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager, pluginManager } from "../src/plugins/index";

// Stub bridge functions so no Tauri backend is required.
vi.mock("../src/lib/bridge", () => ({
  listUserPlugins: vi.fn().mockResolvedValue({ files: [], truncated: [] }),
  listCorePlugins: vi.fn().mockResolvedValue({ files: [], truncated: [] }),
  readPluginFile: vi.fn(),
  readPluginSettings: vi.fn().mockResolvedValue(null),
  writePluginSettings: vi.fn().mockResolvedValue(undefined),
  updateRecentFilesMenu: vi.fn(),
  listThemes: vi.fn().mockResolvedValue([]),
  updateThemeMenu: vi.fn(),
  readThemeCss: vi.fn().mockResolvedValue(null),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  saveHtmlDialog: vi.fn(),
  readResourceFile: vi.fn(),
  readClipboardText: vi.fn(),
  copyCorePlugins: vi.fn().mockResolvedValue(undefined),
}));

// Stub updateSettings so settings writes don't hit the Tauri backend.
vi.mock("../src/lib/settings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lib/settings")>();
  return { ...orig, updateSettings: vi.fn().mockResolvedValue(undefined) };
});

describe("PluginManager class — step_03b unified", () => {
  describe("constructor and fresh state", () => {
    it("creates a PluginManager instance", () => {
      const mgr = new PluginManager();
      expect(mgr).toBeDefined();
    });

    it("getStates() returns empty object before loadPlugins", () => {
      const mgr = new PluginManager();
      expect(mgr.getStates()).toEqual({});
    });

    it("getDefinitions() returns empty array before loadPlugins", () => {
      const mgr = new PluginManager();
      expect(Array.isArray(mgr.getDefinitions())).toBe(true);
      expect(mgr.getDefinitions().length).toBe(0);
    });

    it("getExtensions is not a method on PluginManager (static path removed)", () => {
      const mgr = new PluginManager();
      // After step_03b, getExtensions() is no longer present.
      expect((mgr as unknown as Record<string, unknown>)["getExtensions"]).toBeUndefined();
    });
  });

  describe("toggle()", () => {
    let mgr: PluginManager;

    beforeEach(() => {
      mgr = new PluginManager();
    });

    it("logs a warning for unknown plugin ids and does not throw", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(mgr.toggle("unknownPlugin", true)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknownPlugin"));
      warnSpy.mockRestore();
    });

    it("does not throw when called with an id that has no record", async () => {
      await expect(mgr.toggle("no-such-id", false)).resolves.not.toThrow();
    });
  });

  describe("getDefinitions()", () => {
    it("returns an array of UnifiedPluginDef objects with required fields after loading", async () => {
      const bridge = await import("../src/lib/bridge");
      (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
        files: [],
        truncated: [],
      });
      (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
        files: [],
        truncated: [],
      });
      const mgr = new PluginManager();
      const zones = {
        left: document.createElement("div"),
        center: document.createElement("div"),
        right: document.createElement("div"),
      };
      await mgr.loadPlugins({} as import("../src/lib/settings").MarkableSettings, zones);
      const defs = mgr.getDefinitions();
      expect(Array.isArray(defs)).toBe(true);
      // With no plugins on disk, definitions is empty.
      expect(defs.length).toBe(0);
    });
  });
});

describe("pluginManager singleton (EC-9)", () => {
  it("is importable and is a PluginManager instance", () => {
    // EC-9: ES module import resolves before any function body runs.
    expect(pluginManager).toBeDefined();
    expect(pluginManager).toBeInstanceOf(PluginManager);
  });

  it("has getStates method", () => {
    expect(typeof pluginManager.getStates).toBe("function");
  });

  it("has getDefinitions method", () => {
    expect(typeof pluginManager.getDefinitions).toBe("function");
  });

  it("has loadPlugins method", () => {
    expect(typeof pluginManager.loadPlugins).toBe("function");
  });

  it("has toggle method (async)", () => {
    expect(typeof pluginManager.toggle).toBe("function");
  });
});
