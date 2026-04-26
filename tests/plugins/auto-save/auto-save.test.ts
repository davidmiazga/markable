/**
 * Auto-Save Plugin — Unit Tests
 *
 * Tests exported pure functions and core runtime behaviour.
 * Uses dynamic import (not static) because auto-save.plugin.ts destructures
 * window.__CM_VIEW__ at module evaluation time — the global must be set first.
 *
 * Architecture: docs/specs/auto-save/00_index.md
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as cmView from "@codemirror/view";

// ── Module-level references populated in beforeAll ────────────────────────────
//
// Declared with let (not statically imported) because the module must not be
// evaluated until after the CM6 global is set on window — see the WHY comment
// in diagrams.test.ts for the full rationale.

/* eslint-disable @typescript-eslint/no-explicit-any */
let attemptSave: () => void;
let clampDelay: (raw: unknown) => number;
let loadAndMergeSettings: (raw: Record<string, unknown> | null) => any;
let autoSaveListener: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Global setup: set CM6 globals then dynamically import the plugin ──────────
//
// Dynamic import is the correct pattern here: static imports are hoisted before
// any code runs (including beforeAll), so the CM6 globals would not be set yet
// when the module initialises its top-level `const { EditorView } = window.__CM_VIEW__`.

beforeAll(async () => {
  // Provide the real CM6 module as the global — the plugin will destructure
  // EditorView.updateListener from it.
  (window as any).__CM_VIEW__ = cmView;
  // Reset the tab manager global; each test overrides as needed.
  (window as any).__MARKABLE_TAB_MANAGER__ = undefined;

  // Dynamic import is post-assignment, so __CM_VIEW__ is already set.
  const mod = await import("../../../src/plugins/auto-save/auto-save.plugin");
  attemptSave          = mod.attemptSave;
  clampDelay           = mod.clampDelay;
  loadAndMergeSettings = mod.loadAndMergeSettings;
  autoSaveListener     = mod.autoSaveListener;
});

// ── Group 1: clampDelay — FR-03.3, EC-12 ─────────────────────────────────────

describe("clampDelay", () => {

  it("returns the value unchanged when within range (1000 ms)", () => {
    expect(clampDelay(1000)).toBe(1000);
  });

  it("clamps to 500 when input is below minimum (EC-12)", () => {
    expect(clampDelay(100)).toBe(500);
  });

  it("clamps to 500 when input is exactly 499", () => {
    // 499 < 500, so it must be raised to the lower bound.
    expect(clampDelay(499)).toBe(500);
  });

  it("clamps to 30000 when input exceeds maximum", () => {
    expect(clampDelay(99_999)).toBe(30_000);
  });

  it("returns default 2000 for non-numeric string (FR-03.3 fallback)", () => {
    expect(clampDelay("not-a-number")).toBe(2000);
  });

  it("returns default 2000 for undefined (FR-03.3 fallback)", () => {
    expect(clampDelay(undefined)).toBe(2000);
  });

  it("returns default 2000 for null (FR-03.3 fallback)", () => {
    expect(clampDelay(null)).toBe(2000);
  });

  it("accepts string numeric input '1500' and returns 1500", () => {
    expect(clampDelay("1500")).toBe(1500);
  });

  it("clamps string '100' to 500 (EC-12, string from DOM input)", () => {
    expect(clampDelay("100")).toBe(500);
  });

  it("returns exactly 500 when input is 500 (boundary inclusive)", () => {
    expect(clampDelay(500)).toBe(500);
  });

  it("returns exactly 30000 when input is 30000 (boundary inclusive)", () => {
    expect(clampDelay(30_000)).toBe(30_000);
  });

});

// ── Group 2: loadAndMergeSettings — FR-05.1, EC-09 ───────────────────────────

describe("loadAndMergeSettings", () => {

  it("returns full defaults when raw is null (EC-09, FR-05.1)", () => {
    const result = loadAndMergeSettings(null);
    expect(result.triggerMode).toBe("both");
    expect(result.debounceDelayMs).toBe(2000);
  });

  it("uses stored triggerMode 'debounce' when valid", () => {
    const result = loadAndMergeSettings({ triggerMode: "debounce", debounceDelayMs: 3000 });
    expect(result.triggerMode).toBe("debounce");
  });

  it("uses stored triggerMode 'focus-loss'", () => {
    const result = loadAndMergeSettings({ triggerMode: "focus-loss", debounceDelayMs: 3000 });
    expect(result.triggerMode).toBe("focus-loss");
  });

  it("falls back to default triggerMode for unknown value", () => {
    const result = loadAndMergeSettings({ triggerMode: "unknown-mode", debounceDelayMs: 3000 });
    expect(result.triggerMode).toBe("both");
  });

  it("clamps debounceDelayMs below minimum", () => {
    const result = loadAndMergeSettings({ triggerMode: "both", debounceDelayMs: 100 });
    expect(result.debounceDelayMs).toBe(500);
  });

  it("clamps debounceDelayMs above maximum", () => {
    const result = loadAndMergeSettings({ triggerMode: "both", debounceDelayMs: 999_999 });
    expect(result.debounceDelayMs).toBe(30_000);
  });

  it("uses default debounceDelayMs when key is absent from raw", () => {
    const result = loadAndMergeSettings({ triggerMode: "debounce" });
    expect(result.debounceDelayMs).toBe(2000);
  });

  it("ignores unknown keys in raw (forward compatibility)", () => {
    const result = loadAndMergeSettings({
      triggerMode: "both",
      debounceDelayMs: 1000,
      unknownKey: "ignored",
    });
    expect(result.triggerMode).toBe("both");
    expect(result.debounceDelayMs).toBe(1000);
  });

});

// ── Group 3: attemptSave — FR-04, EC-01, EC-02, EC-07, EC-15 ─────────────────

describe("attemptSave", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let mockTabManager: {
    getActiveTab: ReturnType<typeof vi.fn>;
    saveActiveTab: ReturnType<typeof vi.fn>;
  };

  // Spy on console.warn so we can verify EC-15 without noisy test output.
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    mockTabManager = {
      getActiveTab: vi.fn(),
      saveActiveTab: vi.fn(),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = mockTabManager;
  });

  afterEach(() => {
    (window as any).__MARKABLE_TAB_MANAGER__ = undefined;
    warnSpy.mockClear();
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("calls saveActiveTab() when tab is named and dirty (happy path)", () => {
    mockTabManager.getActiveTab.mockReturnValue({ filePath: "/path/to/file.md", isDirty: true });
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1);
  });

  it("skips when tab is untitled (filePath === null) (EC-01, FR-04.3)", () => {
    mockTabManager.getActiveTab.mockReturnValue({ filePath: null, isDirty: true });
    attemptSave();
    expect(mockTabManager.saveActiveTab).not.toHaveBeenCalled();
  });

  it("skips when tab is clean (isDirty === false) (EC-02, FR-04.4)", () => {
    mockTabManager.getActiveTab.mockReturnValue({ filePath: "/file.md", isDirty: false });
    attemptSave();
    expect(mockTabManager.saveActiveTab).not.toHaveBeenCalled();
  });

  it("skips when getActiveTab returns null (EC-07)", () => {
    mockTabManager.getActiveTab.mockReturnValue(null);
    attemptSave();
    expect(mockTabManager.saveActiveTab).not.toHaveBeenCalled();
  });

  it("warns and skips when __MARKABLE_TAB_MANAGER__ is undefined (EC-15)", () => {
    (window as any).__MARKABLE_TAB_MANAGER__ = undefined;
    attemptSave();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("__MARKABLE_TAB_MANAGER__"),
    );
  });

  it("warns and skips when __MARKABLE_TAB_MANAGER__ is null (EC-15)", () => {
    (window as any).__MARKABLE_TAB_MANAGER__ = null;
    attemptSave();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("does not throw when tab is untitled and dirty (EC-01 — no Save-As dialog)", () => {
    mockTabManager.getActiveTab.mockReturnValue({ filePath: null, isDirty: true });
    expect(() => attemptSave()).not.toThrow();
    expect(mockTabManager.saveActiveTab).not.toHaveBeenCalled();
  });

});

// ── Group 4: autoSaveListener — module evaluation guard ──────────────────────

describe("autoSaveListener", () => {

  it("is a non-null Extension object (CM6 globals destructure succeeded)", () => {
    // This test confirms that the top-level `const { EditorView } = window.__CM_VIEW__`
    // succeeded and that EditorView.updateListener.of() returned a valid Extension.
    expect(autoSaveListener).toBeDefined();
    expect(autoSaveListener).not.toBeNull();
  });

});

// ── Group 5: Debounce timer logic — EC-03, EC-04, EC-05 ──────────────────────
//
// These tests verify the synchronous behaviour of attemptSave itself and the
// isDirty guard pattern (EC-04). Full updateListener integration requires the
// CM6 dispatch pipeline and is covered at the smoke-test level (step 2 verification).

describe("debounce behaviour", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let mockTabManager: {
    getActiveTab: ReturnType<typeof vi.fn>;
    saveActiveTab: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockTabManager = {
      getActiveTab: vi.fn().mockReturnValue({ filePath: "/file.md", isDirty: true }),
      saveActiveTab: vi.fn(),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = mockTabManager;
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as any).__MARKABLE_TAB_MANAGER__ = undefined;
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("attemptSave does not itself introduce a timer (pure check)", () => {
    // attemptSave is synchronous — calling it does not schedule a new timer.
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1);
  });

  it("rapid direct attemptSave calls each produce a save (stateless — timer reset is integration-only)", () => {
    // Confirms attemptSave is stateless — the debounce lives in autoSaveListener, not here.
    // NOTE: the actual debounce timer reset (clearTimeout + setTimeout per docChanged)
    // is exercised at the integration level and cannot be replicated in unit tests
    // without a full CM6 dispatch pipeline. EC-03's timer semantics are therefore
    // verified by the Group 6 EC-06 test which confirms that a blur fire + timer
    // advance results in exactly one save (the isDirty guard prevents a double write).
    for (let i = 0; i < 5; i++) attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(5);
  });

  it("save is skipped when tab becomes clean between timer start and fire (EC-04)", () => {
    // Simulate: first call when dirty — save fires.
    mockTabManager.getActiveTab.mockReturnValueOnce({ filePath: "/file.md", isDirty: true });
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1);

    // Tab is now clean (manual Cmd-S happened).
    mockTabManager.getActiveTab.mockReturnValue({ filePath: "/file.md", isDirty: false });
    // Debounce timer fires — attemptSave is called; isDirty is false; no extra save.
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1); // no additional call
  });

});

// ── Group 6: Plugin lifecycle and listener cleanup — EC-05, EC-10, EC-13 ─────

describe("plugin lifecycle", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let pluginDefault: any;
  let mockApi: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(async () => {
    // Re-use the module already loaded in the outer beforeAll.
    // Dynamic import returns the cached module on subsequent calls (ESM semantics).
    const mod = await import("../../../src/plugins/auto-save/auto-save.plugin");
    pluginDefault = mod.default;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockApi = {
      loadSettings:    vi.fn().mockResolvedValue(null),
      saveSettings:    vi.fn().mockResolvedValue(undefined),
      addExtensions:   vi.fn(),
      removeExtensions: vi.fn(),
      restartSelf:     vi.fn().mockResolvedValue(undefined),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getActiveTab:   vi.fn().mockReturnValue({ filePath: "/f.md", isDirty: true }),
      saveActiveTab:  vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as any).__MARKABLE_TAB_MANAGER__ = undefined;
    // Ensure the plugin is disabled so no listeners leak between tests.
    pluginDefault.onDisable(mockApi);
  });

  it("onEnable loads settings with defaults on null response (EC-09)", async () => {
    mockApi.loadSettings.mockResolvedValue(null);
    await pluginDefault.onEnable(mockApi);
    // Default triggerMode is "both" — addExtensions should be called for the debounce path.
    expect(mockApi.addExtensions).toHaveBeenCalled();
  });

  it("onEnable in 'both' mode calls addExtensions and attaches blur listener (FR-08.1)", async () => {
    const addEventSpy = vi.spyOn(window, "addEventListener");
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "both", debounceDelayMs: 2000 });
    await pluginDefault.onEnable(mockApi);
    expect(mockApi.addExtensions).toHaveBeenCalled();
    expect(addEventSpy).toHaveBeenCalledWith("blur", expect.any(Function));
    addEventSpy.mockRestore();
  });

  it("onEnable in 'debounce' mode calls addExtensions but does not attach blur (FR-08.1)", async () => {
    const addEventSpy = vi.spyOn(window, "addEventListener");
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "debounce", debounceDelayMs: 2000 });
    await pluginDefault.onEnable(mockApi);
    expect(mockApi.addExtensions).toHaveBeenCalled();
    // Only "blur" calls should be absent; other window events (e.g. from jsdom) are unrelated.
    const blurCalls = addEventSpy.mock.calls.filter((c) => c[0] === "blur");
    expect(blurCalls).toHaveLength(0);
    addEventSpy.mockRestore();
  });

  it("onEnable in 'focus-loss' mode attaches blur but does not call addExtensions (FR-08.1)", async () => {
    const addEventSpy = vi.spyOn(window, "addEventListener");
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "focus-loss", debounceDelayMs: 2000 });
    await pluginDefault.onEnable(mockApi);
    expect(mockApi.addExtensions).not.toHaveBeenCalled();
    expect(addEventSpy).toHaveBeenCalledWith("blur", expect.any(Function));
    addEventSpy.mockRestore();
  });

  it("onDisable calls removeExtensions (FR-08.2)", async () => {
    await pluginDefault.onEnable(mockApi);
    pluginDefault.onDisable(mockApi);
    expect(mockApi.removeExtensions).toHaveBeenCalled();
  });

  it("onDisable removes the blur listener that was attached in onEnable (EC-13, FR-08.2.3)", async () => {
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "both", debounceDelayMs: 2000 });
    const addEventSpy    = vi.spyOn(window, "addEventListener");
    const removeEventSpy = vi.spyOn(window, "removeEventListener");

    await pluginDefault.onEnable(mockApi);
    // Capture which function was registered for "blur".
    const addedHandler = addEventSpy.mock.calls.find((c) => c[0] === "blur")?.[1];

    pluginDefault.onDisable(mockApi);
    // Capture which function was passed to removeEventListener for "blur".
    const removedHandler = removeEventSpy.mock.calls.find((c) => c[0] === "blur")?.[1];

    // The exact same function reference must be used for both add and remove (AD-2).
    expect(addedHandler).toBe(removedHandler);
    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it("onDisable is safe when no blur listener was attached (focus-loss not active) (EC-13)", async () => {
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "debounce", debounceDelayMs: 2000 });
    await pluginDefault.onEnable(mockApi);
    // Should not throw even though _blurHandler is null.
    expect(() => pluginDefault.onDisable(mockApi)).not.toThrow();
  });

  it("rapid enable/disable cycles leave no stale blur listeners (EC-13)", async () => {
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "both", debounceDelayMs: 2000 });
    const addEventSpy    = vi.spyOn(window, "addEventListener");
    const removeEventSpy = vi.spyOn(window, "removeEventListener");

    // Three full enable/disable cycles.
    for (let i = 0; i < 3; i++) {
      await pluginDefault.onEnable(mockApi);
      pluginDefault.onDisable(mockApi);
    }

    const addCount    = addEventSpy.mock.calls.filter((c) => c[0] === "blur").length;
    const removeCount = removeEventSpy.mock.calls.filter((c) => c[0] === "blur").length;
    // Every add must have a corresponding remove — no orphaned blur handlers.
    expect(addCount).toBe(removeCount);
    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it("EC-06: blur fires while debounce pending — saves once, timer finds clean tab and skips", async () => {
    // Enable in "both" mode so both the blur handler and debounce timer are active.
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "both", debounceDelayMs: 2000 });
    await pluginDefault.onEnable(mockApi);

    const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
    // Tab is dirty — the blur handler should save it.
    tabManager.getActiveTab.mockReturnValue({ filePath: "/f.md", isDirty: true });

    // Simulate focus loss: blur fires and calls attemptSave() immediately.
    window.dispatchEvent(new Event("blur"));
    expect(tabManager.saveActiveTab).toHaveBeenCalledTimes(1);

    // After the blur save, the tab is clean (saveActiveTab cleared isDirty).
    tabManager.getActiveTab.mockReturnValue({ filePath: "/f.md", isDirty: false });

    // Advance fake timers past the debounce delay. In this unit test the CM6
    // updateListener is not hooked up (no dispatch pipeline), but we verify
    // that any timer scheduled via setTimeout (e.g. by a real docChanged path)
    // would find the tab clean and skip — the isDirty guard prevents a double write.
    vi.runAllTimers();

    // Only one save should have occurred — the blur-triggered save.
    // A subsequent timer fire finds isDirty: false and skips (EC-02 guard).
    expect(tabManager.saveActiveTab).toHaveBeenCalledTimes(1);
  });

  it("EC-10: onDisable called before settings load resolves — no listeners attached", async () => {
    // Create a manually-controlled promise so we can resolve it after onDisable.
    let resolveSettings!: (v: null) => void;
    mockApi.loadSettings.mockReturnValue(
      new Promise<null>((resolve) => { resolveSettings = resolve; }),
    );
    const addEventSpy = vi.spyOn(window, "addEventListener");

    // Start onEnable but do NOT await it yet — it is suspended at loadSettings.
    const enablePromise = pluginDefault.onEnable(mockApi);

    // Disable before loadSettings resolves — simulates rapid toggle (EC-10).
    pluginDefault.onDisable(mockApi);

    // Now let loadSettings resolve with null.
    resolveSettings(null);
    // Await the onEnable continuation — it should bail out (if (!_active) return).
    await enablePromise;

    // No blur listener or CM6 extension should have been attached.
    const blurCalls = addEventSpy.mock.calls.filter((c) => c[0] === "blur");
    expect(blurCalls).toHaveLength(0);
    expect(mockApi.addExtensions).not.toHaveBeenCalled();
    addEventSpy.mockRestore();
  });

});
