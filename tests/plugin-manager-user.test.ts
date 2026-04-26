/**
 * Tests for PluginManager unified loading (step_03b).
 *
 * Uses vi.mock to stub bridge functions so no Tauri runtime is needed.
 * Exercises loadPlugins, toggle, getDefinitions, and getStates.
 *
 * EC coverage: EC-3, EC-7, EC-8, EC-12, EC-13, EC-14, EC-15, EC-23.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager } from "../src/plugins/index";
import type { MarkableSettings } from "../src/lib/settings";

// Stub bridge functions so no Tauri backend is required.
vi.mock("../src/lib/bridge", () => ({
  listCorePlugins: vi.fn().mockResolvedValue({ files: [], truncated: [] }),
  listUserPlugins: vi.fn(),
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

// Unified plugin source (has version field — required for kind="user" validation).
const VALID_UNIFIED_SOURCE = `
return {
  id: "user-test-plugin",
  name: "User Test Plugin",
  description: "A test user plugin.",
  version: "1.0.0",
  onEnable(api) {},
  onDisable(api) {},
};
`;

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

function makeZones() {
  return {
    left: document.createElement("div"),
    center: document.createElement("div"),
    right: document.createElement("div"),
  };
}

describe("PluginManager — unified loading (step_03b)", () => {
  let mgr: PluginManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["my-plugin.js"],
      truncated: [],
    });
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: VALID_UNIFIED_SOURCE,
    });
    mgr = new PluginManager();
  });

  it("loads a valid user plugin and adds it to getDefinitions()", async () => {
    await mgr.loadPlugins(makeSettings(), makeZones());
    const defs = mgr.getDefinitions();
    expect(defs.some((d) => d.id === "user-test-plugin")).toBe(true);
  });

  it("sets status 'loaded' for a valid user plugin", async () => {
    await mgr.loadPlugins(makeSettings(), makeZones());
    const def = mgr.getDefinitions().find((d) => d.id === "user-test-plugin");
    expect(def?.status).toBe("loaded");
  });

  it("restores enabled state from settings.plugins (step_03c key)", async () => {
    const settings = makeSettings({
      plugins: { "user-test-plugin": { enabled: true, kind: "user" } },
    });
    await mgr.loadPlugins(settings, makeZones());
    expect(mgr.getStates()["user-test-plugin"]).toBe(true);
  });

  it("does not enable plugin when settings.plugins has enabled: false", async () => {
    const settings = makeSettings({
      plugins: { "user-test-plugin": { enabled: false, kind: "user" } },
    });
    await mgr.loadPlugins(settings, makeZones());
    expect(mgr.getStates()["user-test-plugin"]).toBe(false);
  });

  it("does not enable plugin when plugins key is absent", async () => {
    await mgr.loadPlugins(makeSettings(), makeZones());
    expect(mgr.getStates()["user-test-plugin"]).toBe(false);
  });

  it("EC-12: rejects second plugin with duplicate id", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["a.js", "b.js"],
      truncated: [],
    });
    // Both files return the same id.
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: VALID_UNIFIED_SOURCE,
    });
    await mgr.loadPlugins(makeSettings(), makeZones());
    const defs = mgr.getDefinitions();
    const loaded = defs.filter((d) => d.status === "loaded");
    const failed = defs.filter((d) => d.status === "failed");
    expect(loaded.length).toBe(1);
    expect(failed.length).toBe(1);
  });

  it("EC-3: marks plugin as failed when source has syntax error", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "return { ;;; }",
    });
    await mgr.loadPlugins(makeSettings(), makeZones());
    const def = mgr.getDefinitions()[0];
    expect(def.status).toBe("failed");
  });

  it("EC-13/EC-14: onEnable throw does not propagate to caller", async () => {
    const bridge = await import("../src/lib/bridge");
    const throwSrc = `
      return {
        id: "throwing-plugin",
        name: "Throwing",
        description: "Throws on enable.",
        version: "1.0.0",
        onEnable(api) { throw new Error("boom"); },
        onDisable(api) {},
      };
    `;
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({ source: throwSrc });
    const settings = makeSettings({
      plugins: { "throwing-plugin": { enabled: true, kind: "user" } },
    });
    await expect(mgr.loadPlugins(settings, makeZones())).resolves.not.toThrow();
    // Plugin should be marked as disabled after the throw (EC-13).
    expect(mgr.getStates()["throwing-plugin"]).toBe(false);
  });

  it("EC-14: async onEnable rejection does not propagate to caller", async () => {
    const bridge = await import("../src/lib/bridge");
    const asyncThrowSrc = `
      return {
        id: "async-throwing-plugin",
        name: "Async Throwing",
        description: "Throws async on enable.",
        version: "1.0.0",
        async onEnable(api) { throw new Error("async boom"); },
        onDisable(api) {},
      };
    `;
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({ source: asyncThrowSrc });
    const settings = makeSettings({
      plugins: { "async-throwing-plugin": { enabled: true, kind: "user" } },
    });
    await expect(mgr.loadPlugins(settings, makeZones())).resolves.not.toThrow();
    expect(mgr.getStates()["async-throwing-plugin"]).toBe(false);
  });

  it("EC-23: already-registered filenames are skipped on repeated loadPlugins calls", async () => {
    const bridge = await import("../src/lib/bridge");
    await mgr.loadPlugins(makeSettings(), makeZones());
    const readCountAfterFirst = (bridge.readPluginFile as ReturnType<typeof vi.fn>).mock.calls.length;
    // Call loadPlugins again with the same file list.
    await mgr.loadPlugins(makeSettings(), makeZones());
    // readPluginFile should NOT have been called again for the already-registered file.
    expect((bridge.readPluginFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(readCountAfterFirst);
  });

  it("getDefinitions returns empty array when no plugins are on disk", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    await mgr.loadPlugins(makeSettings(), makeZones());
    expect(mgr.getDefinitions()).toEqual([]);
  });

  it("getStates returns empty object when no plugins are loaded", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    await mgr.loadPlugins(makeSettings(), makeZones());
    expect(mgr.getStates()).toEqual({});
  });
});

describe("PluginManager — toggle() unified (step_03b)", () => {
  let mgr: PluginManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["p.js"],
      truncated: [],
    });
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: VALID_UNIFIED_SOURCE,
    });
    mgr = new PluginManager();
    await mgr.loadPlugins(makeSettings(), makeZones());
  });

  it("enables a user plugin", async () => {
    await mgr.toggle("user-test-plugin", true);
    expect(mgr.getStates()["user-test-plugin"]).toBe(true);
  });

  it("disables a user plugin", async () => {
    await mgr.toggle("user-test-plugin", true);
    await mgr.toggle("user-test-plugin", false);
    expect(mgr.getStates()["user-test-plugin"]).toBe(false);
  });

  it("warns on unknown id and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(mgr.toggle("no-such-id", true)).resolves.not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no-such-id"));
    warn.mockRestore();
  });

  it("EC-15: onDisable throw is caught and plugin is still marked disabled", async () => {
    const bridge = await import("../src/lib/bridge");
    vi.resetAllMocks();
    const throwOnDisableSrc = `
      return {
        id: "disable-thrower",
        name: "Disable Thrower",
        description: "Throws on disable.",
        version: "1.0.0",
        onEnable(api) {},
        onDisable(api) { throw new Error("disable boom"); },
      };
    `;
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["dt.js"],
      truncated: [],
    });
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: throwOnDisableSrc,
    });
    const mgr2 = new PluginManager();
    const settings = makeSettings({
      plugins: { "disable-thrower": { enabled: true, kind: "user" } },
    });
    await mgr2.loadPlugins(settings, makeZones());
    // Plugin should have been marked enabled (onEnable doesn't throw).
    expect(mgr2.getStates()["disable-thrower"]).toBe(true);
    // Now disable — onDisable throws, but must not propagate and _enabled must be false.
    await expect(mgr2.toggle("disable-thrower", false)).resolves.not.toThrow();
    expect(mgr2.getStates()["disable-thrower"]).toBe(false);
  });

  it("toggle persists to settings.plugins", async () => {
    const { updateSettings } = await import("../src/lib/settings");
    await mgr.toggle("user-test-plugin", true);
    expect(updateSettings).toHaveBeenCalled();
    const updateFn = (updateSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const result = updateFn(makeSettings());
    expect(result.plugins?.["user-test-plugin"]?.enabled).toBe(true);
    expect(result.plugins?.["user-test-plugin"]?.kind).toBe("user");
  });

  it("Issue-4: toggle(id, true) persists enabled:false when onEnable throws", async () => {
    // Issue 4: if onEnable throws, _enabled stays false. toggle() must persist
    // the ACTUAL record._enabled value (false) rather than the requested `enabled`
    // argument (true). Persisting `true` on failure would create a broken-enable
    // loop on every subsequent launch because settings would restart the enable
    // attempt immediately on next load.
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    const throwSrc = `
      return {
        id: "enable-thrower",
        name: "Enable Thrower",
        description: "Throws on enable.",
        version: "1.0.0",
        onEnable(api) { throw new Error("enable failed"); },
        onDisable(api) {},
      };
    `;
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["et.js"],
      truncated: [],
    });
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({ source: throwSrc });

    const mgr2 = new PluginManager();
    await mgr2.loadPlugins(makeSettings(), makeZones());

    const { updateSettings } = await import("../src/lib/settings");
    (updateSettings as ReturnType<typeof vi.fn>).mockClear();

    // Attempt to enable a plugin whose onEnable throws.
    await mgr2.toggle("enable-thrower", true);

    // The plugin must be marked disabled in the runtime state.
    expect(mgr2.getStates()["enable-thrower"]).toBe(false);

    // updateSettings must have been called, and the persisted value must be
    // false — not true — reflecting the actual outcome after the throw.
    expect(updateSettings).toHaveBeenCalled();
    const updateFn = (updateSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const result = updateFn(makeSettings());
    expect(result.plugins?.["enable-thrower"]?.enabled).toBe(false);
  });
});

describe("PluginManager — EC-29: truncated plugin list warning", () => {
  it("emits console.warn containing the truncated filename when listUserPlugins returns truncated entries", async () => {
    // EC-29: when the Rust backend drops plugin files due to the 50-plugin cap,
    // the truncated array lists the filenames that were excluded. PluginManager
    // must warn the user so they know a plugin was silently ignored. This test
    // verifies that the warning fires and names the dropped file.
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    // Simulate the cap being hit: one file admitted, one dropped.
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: ["dropped.js"],
    });
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: VALID_UNIFIED_SOURCE,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mgr = new PluginManager();
    await mgr.loadPlugins(makeSettings(), makeZones());

    // At least one warn call must mention the truncated filename.
    const warnMessages = warnSpy.mock.calls.map((args) => String(args[0]) + String(args[1] ?? ""));
    expect(warnMessages.some((msg) => msg.includes("dropped.js"))).toBe(true);

    warnSpy.mockRestore();
  });
});

describe("PluginManager — override detection (EC-7, EC-8)", () => {
  it("core file whose filename exists in user/ gets status 'overridden'", async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    // Core has focus-mode.js; user also has focus-mode.js.
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["focus-mode.js"],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["focus-mode.js"],
      truncated: [],
    });
    // Only the user read will actually be called.
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: VALID_UNIFIED_SOURCE.replace("user-test-plugin", "focus-mode"),
    });

    const mgr = new PluginManager();
    await mgr.loadPlugins(makeSettings(), makeZones());

    const defs = mgr.getDefinitions();
    // The core slot is overridden.
    const overridden = defs.find((d) => d.kind === "core" && d.status === "overridden");
    expect(overridden).toBeDefined();
    // The user plugin is loaded normally.
    const loaded = defs.find((d) => d.kind === "user" && d.status === "loaded");
    expect(loaded).toBeDefined();
  });

  it("EC-8: user override file fails evaluation — core slot stays 'overridden', user slot is 'failed'", async () => {
    // EC-8: when a user file has the same filename as a core file, the core slot
    // is marked "overridden" (it is not evaluated). If the user file then fails
    // evaluation (e.g. syntax error), the user record must be "failed" with a
    // failReason. The core slot must NOT revert to "loaded" — the override record
    // documents that the core version was superseded, and the user knows their
    // override failed because the user record is marked failed.
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["override.js"],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["override.js"],
      truncated: [],
    });
    // The user file has a syntax error — evaluation must fail.
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "return { ;;; bad syntax",
    });

    const mgr = new PluginManager();
    await mgr.loadPlugins(makeSettings(), makeZones());

    const defs = mgr.getDefinitions();

    // Core slot must remain "overridden" (not promoted back to loaded/failed).
    const coreRecord = defs.find((d) => d.kind === "core");
    expect(coreRecord).toBeDefined();
    expect(coreRecord?.status).toBe("overridden");

    // User slot must be "failed" with a failReason describing the parse error.
    const userRecord = defs.find((d) => d.kind === "user");
    expect(userRecord).toBeDefined();
    expect(userRecord?.status).toBe("failed");
    expect(typeof userRecord?.failReason).toBe("string");
    expect(userRecord?.failReason?.length).toBeGreaterThan(0);
  });

  it("loaded user record id does not collide with loaded core record id (EC-12)", async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    const coreSource = `
      return {
        id: "shared-id",
        name: "Core Plugin",
        description: "Core.",
        version: "1.0.0",
        onEnable(api) {},
        onDisable(api) {},
      };
    `;
    const userSource = `
      return {
        id: "shared-id",
        name: "User Plugin",
        description: "User.",
        version: "1.0.0",
        onEnable(api) {},
        onDisable(api) {},
      };
    `;
    // Different filenames so no filename-based override. Same id causes collision.
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["core-plugin.js"],
      truncated: [],
    });
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: ["user-plugin.js"],
      truncated: [],
    });
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockImplementation(
      (_filename: string, kind?: string) =>
        kind === "core"
          ? Promise.resolve({ source: coreSource })
          : Promise.resolve({ source: userSource }),
    );

    const mgr = new PluginManager();
    await mgr.loadPlugins(makeSettings(), makeZones());

    const defs = mgr.getDefinitions();
    const loaded = defs.filter((d) => d.status === "loaded");
    const failed = defs.filter((d) => d.status === "failed");
    // Only one plugin with "shared-id" can be loaded; the second collides.
    expect(loaded.length).toBe(1);
    expect(failed.length).toBe(1);
  });
});

// ── reloadUserPlugins idempotency (EC-23) ────────────────────────────────────

describe("PluginManager — reloadUserPlugins EC-23 idempotency", () => {
  /**
   * EC-23: reloadUserPlugins must skip filenames that are already registered
   * in _records. This prevents a plugin from being evaluated twice if the user
   * clicks "Reload" while the directory has not changed. The guard is exercised
   * by calling reloadUserPlugins twice with the same file list and asserting
   * that readPluginFile is called only once total.
   *
   * This test is distinct from the loadPlugins EC-23 test above — it targets
   * the reloadUserPlugins code path specifically, which maintains its own local
   * `registeredFilenames` set built from the current _records on each call.
   */
  it("calls readPluginFile only once when the same filename is present on both invocations", async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");

    // Core directory is empty so only the user file is in play.
    (bridge.listCorePlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    // loadPlugins (first scan) returns no user files — the plugin is unknown at startup.
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [],
      truncated: [],
    });
    // Subsequent calls to listUserPlugins (inside reloadUserPlugins) return the
    // file so the first reload call registers it.
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ files: [], truncated: [] })           // loadPlugins call
      .mockResolvedValue({ files: ["plugin-a.js"], truncated: [] }); // all reload calls

    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: VALID_UNIFIED_SOURCE,
    });

    const mgr = new PluginManager();
    // Initial load — no user plugins discovered yet.
    await mgr.loadPlugins(makeSettings(), makeZones());

    // First reload discovers "plugin-a.js" and evaluates it.
    await mgr.reloadUserPlugins(makeSettings(), makeZones());
    const callsAfterFirst = (bridge.readPluginFile as ReturnType<typeof vi.fn>).mock.calls.length;
    // readPluginFile must have been called exactly once so far.
    expect(callsAfterFirst).toBe(1);

    // Second reload — same file list. The filename is already in _records so
    // readPluginFile must NOT be called again (EC-23).
    await mgr.reloadUserPlugins(makeSettings(), makeZones());
    const callsAfterSecond = (bridge.readPluginFile as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});
