/**
 * Tests for migratePluginSettings() — step_03c.
 *
 * Verifies that old flat boolean settings keys are migrated to the unified
 * `plugins` map introduced in Chunk 3. All tests are pure (no Tauri runtime
 * required) because migratePluginSettings is a pure function.
 *
 * EC coverage: EC-26 (idempotency), EC-27 (statusBar shape), EC-28 (userPlugins).
 */

import { describe, it, expect } from "vitest";
import { migratePluginSettings } from "../src/plugins/settings-migration";
import type { MarkableSettings } from "../src/lib/settings";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal MarkableSettings object with required fields only.
 * Optional plugin-related fields are omitted so each test can add exactly
 * the fields it wants to test.
 *
 * @param overrides  Fields to merge onto the base.
 */
function makeSettings(overrides: Record<string, unknown> = {}): MarkableSettings {
  return {
    version: 1,
    window: {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
      fullscreen: false,
      maximized: false,
    },
    editor: { contentMaxWidth: 900, contentPadding: "responsive", baseFontSize: 16 },
    theme: { active: "system", fallback: "default-dark" },
    recentFiles: [],
    findWidget: null,
    ...overrides,
  } as unknown as MarkableSettings;
}

// ── EC-26: Idempotency ────────────────────────────────────────────────────────

describe("migratePluginSettings — EC-26 idempotency", () => {
  it("returns the same object reference when plugins is already non-empty", () => {
    const settings = makeSettings({
      plugins: {
        "focus-mode": { enabled: true, kind: "core" },
      },
    });
    const result = migratePluginSettings(settings);
    expect(result).toBe(settings);
  });

  it("calling twice produces the same result as calling once", () => {
    const base = makeSettings({ focusMode: true });
    const once = migratePluginSettings(base);
    const twice = migratePluginSettings(once);
    // Second call returns same reference (no further mutation).
    expect(twice).toBe(once);
    // The plugins map is identical either way.
    expect(twice.plugins).toEqual(once.plugins);
  });

  it("runs migration when plugins is absent", () => {
    const settings = makeSettings();
    const result = migratePluginSettings(settings);
    // A fresh run must produce a plugins map.
    expect(result.plugins).toBeDefined();
  });

  it("runs migration when plugins is an empty object", () => {
    const settings = makeSettings({ plugins: {} });
    const result = migratePluginSettings(settings);
    // Empty map triggers migration (treated as 'not yet migrated').
    expect(result.plugins).toBeDefined();
    expect(Object.keys(result.plugins!).length).toBeGreaterThan(0);
  });
});

// ── Flat boolean fields ───────────────────────────────────────────────────────

describe("migratePluginSettings — flat boolean fields", () => {
  it("focusMode: true → plugins['focus-mode'].enabled = true, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ focusMode: true }));
    expect(result.plugins?.["focus-mode"]).toEqual({ enabled: true, kind: "core" });
  });

  it("focusMode: false → plugins['focus-mode'].enabled = false, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ focusMode: false }));
    expect(result.plugins?.["focus-mode"]).toEqual({ enabled: false, kind: "core" });
  });

  it("focusMode absent → plugins['focus-mode'].enabled = false, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings());
    expect(result.plugins?.["focus-mode"]).toEqual({ enabled: false, kind: "core" });
  });

  it("typewriterMode: true → plugins['typewriter-mode'].enabled = true, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ typewriterMode: true }));
    expect(result.plugins?.["typewriter-mode"]).toEqual({ enabled: true, kind: "core" });
  });

  it("typewriterMode: false → plugins['typewriter-mode'].enabled = false, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ typewriterMode: false }));
    expect(result.plugins?.["typewriter-mode"]).toEqual({ enabled: false, kind: "core" });
  });

  it("wordCount: true → plugins['word-count'].enabled = true, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ wordCount: true }));
    expect(result.plugins?.["word-count"]).toEqual({ enabled: true, kind: "core" });
  });

  it("wordCount: false → plugins['word-count'].enabled = false, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ wordCount: false }));
    expect(result.plugins?.["word-count"]).toEqual({ enabled: false, kind: "core" });
  });
});

// ── EC-27: statusBar migration ────────────────────────────────────────────────

describe("migratePluginSettings — EC-27 statusBar migration", () => {
  it("statusBar: { visible: true } → plugins['status-bar'].enabled = true, kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings({ statusBar: { visible: true } }));
    expect(result.plugins?.["status-bar"]).toEqual({ enabled: true, kind: "core" });
  });

  it("statusBar: { visible: false } → plugins['status-bar'].enabled = false", () => {
    const result = migratePluginSettings(makeSettings({ statusBar: { visible: false } }));
    expect(result.plugins?.["status-bar"]).toEqual({ enabled: false, kind: "core" });
  });

  it("statusBar absent → plugins['status-bar'].enabled = false", () => {
    const result = migratePluginSettings(makeSettings());
    expect(result.plugins?.["status-bar"]).toEqual({ enabled: false, kind: "core" });
  });

  it("statusBar: true (malformed) → plugins['status-bar'].enabled = false (no .visible)", () => {
    // Guard against corrupted settings where statusBar is not an object.
    const settings = makeSettings({ statusBar: true as unknown as { visible: boolean } });
    const result = migratePluginSettings(settings);
    // .visible is undefined on a boolean → evaluates to false.
    expect(result.plugins?.["status-bar"]?.enabled).toBe(false);
  });
});

// ── EC-28: userPlugins migration ──────────────────────────────────────────────

describe("migratePluginSettings — EC-28 userPlugins migration", () => {
  it("userPlugins: { 'my-plugin': { enabled: true } } → plugins['my-plugin'].enabled = true, kind = 'user'", () => {
    const result = migratePluginSettings(
      makeSettings({ userPlugins: { "my-plugin": { enabled: true } } }),
    );
    expect(result.plugins?.["my-plugin"]).toEqual({ enabled: true, kind: "user" });
  });

  it("userPlugins: { 'my-plugin': { enabled: false } } → plugins['my-plugin'].enabled = false, kind = 'user'", () => {
    const result = migratePluginSettings(
      makeSettings({ userPlugins: { "my-plugin": { enabled: false } } }),
    );
    expect(result.plugins?.["my-plugin"]).toEqual({ enabled: false, kind: "user" });
  });

  it("userPlugins: {} → no extra user entries in plugins map", () => {
    const result = migratePluginSettings(makeSettings({ userPlugins: {} }));
    // Only the 4 core entries should exist.
    const keys = Object.keys(result.plugins ?? {});
    expect(keys).toHaveLength(4);
    expect(keys).not.toContain("my-plugin");
  });

  it("userPlugins key matching a core id is skipped (EC-28: no overwrite)", () => {
    // A user plugin named 'focus-mode' must not overwrite the core entry.
    const result = migratePluginSettings(
      makeSettings({
        focusMode: true,
        userPlugins: { "focus-mode": { enabled: false } },
      }),
    );
    // Core entry (enabled: true from focusMode: true) must be preserved.
    expect(result.plugins?.["focus-mode"]).toEqual({ enabled: true, kind: "core" });
  });

  it("multiple user plugins all migrate correctly", () => {
    const result = migratePluginSettings(
      makeSettings({
        userPlugins: {
          "plugin-a": { enabled: true },
          "plugin-b": { enabled: false },
        },
      }),
    );
    expect(result.plugins?.["plugin-a"]).toEqual({ enabled: true, kind: "user" });
    expect(result.plugins?.["plugin-b"]).toEqual({ enabled: false, kind: "user" });
  });
});

// ── Non-mutation and spread ───────────────────────────────────────────────────

describe("migratePluginSettings — non-mutation and field preservation", () => {
  it("does not mutate the input settings object", () => {
    const settings = makeSettings({ focusMode: true });
    const pluginsBefore = settings.plugins;
    migratePluginSettings(settings);
    // Input must be unchanged.
    expect(settings.plugins).toBe(pluginsBefore);
  });

  it("returned object preserves all original top-level fields", () => {
    const settings = makeSettings({
      focusMode: true,
      keybindings: { "file-open": "Cmd-O" },
    });
    const result = migratePluginSettings(settings);
    // All original top-level fields must survive the spread.
    expect(result.version).toBe(settings.version);
    expect(result.window).toBe(settings.window);
    expect(result.editor).toBe(settings.editor);
    expect(result.theme).toBe(settings.theme);
    expect(result.recentFiles).toBe(settings.recentFiles);
    expect(result.keybindings).toBe(settings.keybindings);
    // focusMode is preserved (not deleted — backward compat).
    expect((result as unknown as Record<string, unknown>).focusMode).toBe(true);
  });
});

// ── All four core entries always present ─────────────────────────────────────

describe("migratePluginSettings — all four core plugin entries always present", () => {
  it("creates entries for all four core plugins even with no old fields set", () => {
    const result = migratePluginSettings(makeSettings());
    expect(result.plugins?.["focus-mode"]).toBeDefined();
    expect(result.plugins?.["typewriter-mode"]).toBeDefined();
    expect(result.plugins?.["word-count"]).toBeDefined();
    expect(result.plugins?.["status-bar"]).toBeDefined();
  });

  it("all four core entries have kind = 'core'", () => {
    const result = migratePluginSettings(makeSettings());
    expect(result.plugins?.["focus-mode"]?.kind).toBe("core");
    expect(result.plugins?.["typewriter-mode"]?.kind).toBe("core");
    expect(result.plugins?.["word-count"]?.kind).toBe("core");
    expect(result.plugins?.["status-bar"]?.kind).toBe("core");
  });

  it("four core entries present even when all old keys are true", () => {
    const result = migratePluginSettings(
      makeSettings({
        focusMode: true,
        typewriterMode: true,
        wordCount: true,
        statusBar: { visible: true },
      }),
    );
    const coreIds = ["focus-mode", "typewriter-mode", "word-count", "status-bar"];
    for (const id of coreIds) {
      expect(result.plugins?.[id]).toEqual({ enabled: true, kind: "core" });
    }
  });
});
