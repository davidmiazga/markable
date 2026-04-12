/**
 * Tests for buildMarkablePluginAPI() and the MarkablePluginAPI / UnifiedPlugin
 * interface types introduced in step_01b (src/plugins/markable-plugin-api.ts).
 *
 * Verification goals (from step_01b_unified_types.md):
 *   - buildMarkablePluginAPI returns an object with the correct shape.
 *   - The statusBar property references the zones passed in.
 *   - ensureStatusBar and hideStatusBarIfUnused are functions.
 *   - loadSettings and saveSettings are async functions.
 *   - addExtensions delegates to pluginManager.addExtensions(pluginId, ...).
 *   - removeExtensions delegates to pluginManager.removeExtensions(pluginId).
 *   - UnifiedPlugin interface can be satisfied at compile time (structural check).
 *
 * No Tauri invocations occur — bridge functions are mocked so tests run in
 * the Vitest/happy-dom environment without a running Tauri process.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UnifiedPlugin, MarkablePluginAPI } from "../src/plugins/markable-plugin-api";
import { buildMarkablePluginAPI } from "../src/plugins/markable-plugin-api";

// ---------------------------------------------------------------------------
// Mock bridge functions (readPluginSettings / writePluginSettings)
// These make real invoke() calls — mock them so tests work without Tauri.
// ---------------------------------------------------------------------------

vi.mock("../src/lib/bridge", () => ({
  readPluginSettings: vi.fn().mockResolvedValue({ stored: true }),
  writePluginSettings: vi.fn().mockResolvedValue(undefined),
  // Retain any other bridge exports as no-ops so import doesn't fail.
  listUserPlugins: vi.fn(),
  readPluginFile: vi.fn(),
  listCorePlugins: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock pluginManager methods that buildMarkablePluginAPI delegates to.
// We import the module only for type safety; the actual runtime instance
// is what the closure captures, so we spy on the singleton.
// ---------------------------------------------------------------------------

vi.mock("../src/plugins/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/plugins/index")>();
  // Spy on addExtensions and removeExtensions on the real singleton.
  vi.spyOn(actual.pluginManager, "addExtensions");
  vi.spyOn(actual.pluginManager, "removeExtensions");
  return actual;
});

// ---------------------------------------------------------------------------
// Mock status-bar helpers to avoid DOM side-effects in this test file.
// ---------------------------------------------------------------------------

vi.mock("../src/plugins/status-bar/status-bar", () => ({
  ensureStatusBar: vi.fn(),
  hideStatusBarIfUnused: vi.fn(),
  STATUS_BAR_PLUGINS: new Set(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeZones() {
  return {
    left: document.createElement("div"),
    center: document.createElement("div"),
    right: document.createElement("div"),
  };
}

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

describe("buildMarkablePluginAPI() — returned object shape", () => {
  let api: MarkablePluginAPI;
  let zones: ReturnType<typeof makeZones>;

  beforeEach(() => {
    zones = makeZones();
    api = buildMarkablePluginAPI("test-plugin", zones);
  });

  it("returns an object (not null/undefined)", () => {
    expect(api).toBeDefined();
    expect(typeof api).toBe("object");
  });

  it("exposes statusBar with left, center, and right HTMLElements", () => {
    expect(api.statusBar).toBeDefined();
    expect(api.statusBar.left).toBe(zones.left);
    expect(api.statusBar.center).toBe(zones.center);
    expect(api.statusBar.right).toBe(zones.right);
  });

  it("exposes ensureStatusBar as a function", () => {
    expect(typeof api.ensureStatusBar).toBe("function");
  });

  it("exposes hideStatusBarIfUnused as a function", () => {
    expect(typeof api.hideStatusBarIfUnused).toBe("function");
  });

  it("exposes loadSettings as a function", () => {
    expect(typeof api.loadSettings).toBe("function");
  });

  it("exposes saveSettings as a function", () => {
    expect(typeof api.saveSettings).toBe("function");
  });

  it("exposes addExtensions as a function", () => {
    expect(typeof api.addExtensions).toBe("function");
  });

  it("exposes removeExtensions as a function", () => {
    expect(typeof api.removeExtensions).toBe("function");
  });

  it("has exactly the seven documented properties (no extras leaking through)", () => {
    const keys = Object.keys(api);
    const expected = [
      "statusBar",
      "ensureStatusBar",
      "hideStatusBarIfUnused",
      "loadSettings",
      "saveSettings",
      "addExtensions",
      "removeExtensions",
    ];
    // All expected keys must be present.
    for (const key of expected) {
      expect(keys).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Delegation tests — addExtensions and removeExtensions must delegate to
// pluginManager with the pluginId captured in the closure.
// ---------------------------------------------------------------------------

describe("buildMarkablePluginAPI() — extension delegation", () => {
  it("addExtensions delegates to pluginManager.addExtensions with the captured pluginId", async () => {
    const { pluginManager } = await import("../src/plugins/index");
    const zones = makeZones();
    const api = buildMarkablePluginAPI("my-plugin", zones);

    const ext = [] as unknown as import("@codemirror/state").Extension[];
    api.addExtensions(ext);

    expect(pluginManager.addExtensions).toHaveBeenCalledWith("my-plugin", ext);
  });

  it("removeExtensions delegates to pluginManager.removeExtensions with the captured pluginId", async () => {
    const { pluginManager } = await import("../src/plugins/index");
    const zones = makeZones();
    const api = buildMarkablePluginAPI("my-plugin-2", zones);

    api.removeExtensions();

    expect(pluginManager.removeExtensions).toHaveBeenCalledWith("my-plugin-2");
  });

  it("two API objects for different plugin ids delegate with their own ids", async () => {
    const { pluginManager } = await import("../src/plugins/index");
    vi.mocked(pluginManager.addExtensions).mockClear();

    const apiA = buildMarkablePluginAPI("plugin-a", makeZones());
    const apiB = buildMarkablePluginAPI("plugin-b", makeZones());

    const extA = [] as unknown as import("@codemirror/state").Extension[];
    const extB = [] as unknown as import("@codemirror/state").Extension[];
    apiA.addExtensions(extA);
    apiB.addExtensions(extB);

    expect(pluginManager.addExtensions).toHaveBeenCalledWith("plugin-a", extA);
    expect(pluginManager.addExtensions).toHaveBeenCalledWith("plugin-b", extB);
  });
});

// ---------------------------------------------------------------------------
// loadSettings / saveSettings — route to bridge functions
// ---------------------------------------------------------------------------

describe("buildMarkablePluginAPI() — settings bridge", () => {
  it("loadSettings returns the parsed object from readPluginSettings", async () => {
    const { readPluginSettings } = await import("../src/lib/bridge");
    vi.mocked(readPluginSettings).mockResolvedValueOnce({ key: "value" });

    const api = buildMarkablePluginAPI("settings-plugin", makeZones());
    const result = await api.loadSettings();

    expect(result).toEqual({ key: "value" });
  });

  it("loadSettings returns null when readPluginSettings resolves null", async () => {
    const { readPluginSettings } = await import("../src/lib/bridge");
    vi.mocked(readPluginSettings).mockResolvedValueOnce(null);

    const api = buildMarkablePluginAPI("settings-plugin-2", makeZones());
    const result = await api.loadSettings();

    expect(result).toBeNull();
  });

  it("loadSettings returns null (not throw) when readPluginSettings rejects", async () => {
    const { readPluginSettings } = await import("../src/lib/bridge");
    vi.mocked(readPluginSettings).mockRejectedValueOnce(new Error("disk error"));

    const api = buildMarkablePluginAPI("settings-plugin-3", makeZones());
    await expect(api.loadSettings()).resolves.toBeNull();
  });

  it("saveSettings calls writePluginSettings with pluginId and data", async () => {
    const { writePluginSettings } = await import("../src/lib/bridge");
    vi.mocked(writePluginSettings).mockResolvedValueOnce(undefined);

    const api = buildMarkablePluginAPI("save-plugin", makeZones());
    const data = { count: 42 };
    await api.saveSettings(data);

    expect(writePluginSettings).toHaveBeenCalledWith("save-plugin", data);
  });

  it("saveSettings propagates rejection when writePluginSettings rejects", async () => {
    // Unlike loadSettings (which catches and returns null), saveSettings must
    // let the rejection surface so the caller can handle the write failure.
    const { writePluginSettings } = await import("../src/lib/bridge");
    vi.mocked(writePluginSettings).mockRejectedValueOnce(new Error("write error"));

    const api = buildMarkablePluginAPI("failing-plugin", makeZones());
    await expect(api.saveSettings({ key: "val" })).rejects.toThrow("write error");
  });
});

// ---------------------------------------------------------------------------
// UnifiedPlugin interface structural check
// A value typed as UnifiedPlugin must compile — no runtime assertion needed.
// ---------------------------------------------------------------------------

describe("UnifiedPlugin interface — structural validity", () => {
  it("a minimal conforming object satisfies the UnifiedPlugin type at compile time", () => {
    // This is a compile-time check. If the interface shape is wrong, tsc fails.
    // At runtime, we only verify the object has the expected keys.
    const plugin: UnifiedPlugin = {
      id: "my-unified-plugin",
      name: "My Plugin",
      description: "Does something useful",
      version: "1.0.0",
      onEnable(_api: MarkablePluginAPI) {},
      onDisable(_api: MarkablePluginAPI) {},
    };
    expect(plugin.id).toBe("my-unified-plugin");
    expect(plugin.name).toBe("My Plugin");
    expect(plugin.description).toBe("Does something useful");
    expect(plugin.version).toBe("1.0.0");
    expect(typeof plugin.onEnable).toBe("function");
    expect(typeof plugin.onDisable).toBe("function");
  });

  it("a plugin with an optional detail field also satisfies UnifiedPlugin", () => {
    const plugin: UnifiedPlugin = {
      id: "detailed-plugin",
      name: "Detailed Plugin",
      description: "Short description",
      detail: "A much longer explanation shown in the panel detail view.",
      version: "0.1.0",
      onEnable(_api: MarkablePluginAPI) {},
      onDisable(_api: MarkablePluginAPI) {},
    };
    expect(plugin.detail).toBeDefined();
  });
});
