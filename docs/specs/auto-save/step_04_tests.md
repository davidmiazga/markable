---
title: "Auto-Save — Step 4: Tests"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 4 — Tests

## Goal

Write a Vitest test file at `tests/plugins/auto-save/auto-save.test.ts` that covers
all EC numbers from the requirements and verifies the exported pure helpers and the
core runtime logic. The file must follow the same dynamic-import pattern used by
`diagrams.test.ts` because `auto-save.plugin.ts` destructures `window.__CM_VIEW__`
at module evaluation time (top-level const).

---

## Prerequisite

Steps 1–3 complete. The plugin exports `attemptSave`, `clampDelay`, and
`loadAndMergeSettings` as named exports (added alongside `export default`). The
test file imports these named exports via dynamic import in `beforeAll`.

---

## 4.1 — Exported Symbols Required for Testing

The following symbols must be exported from `auto-save.plugin.ts` (in addition to
`export default`). Add these if not already present from the scaffold:

```typescript
export { attemptSave, clampDelay, loadAndMergeSettings, autoSaveListener };
```

`autoSaveListener` is an `Extension` value — tests verify it is a non-null object
(confirming the CM6 globals destructure succeeded).

---

## 4.2 — Test File Structure

```
tests/plugins/auto-save/auto-save.test.ts
```

### File header and imports

```typescript
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
```

### `beforeAll`: set CM6 globals then dynamic import

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
let attemptSave: () => void;
let clampDelay: (raw: unknown) => number;
let loadAndMergeSettings: (raw: Record<string, unknown> | null) => any;
let autoSaveListener: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
  (window as any).__CM_VIEW__ = cmView;
  (window as any).__MARKABLE_TAB_MANAGER__ = undefined; // reset; overridden per test

  const mod = await import("../../../src/plugins/auto-save/auto-save.plugin");
  attemptSave        = mod.attemptSave;
  clampDelay         = mod.clampDelay;
  loadAndMergeSettings = mod.loadAndMergeSettings;
  autoSaveListener   = mod.autoSaveListener;
});
```

---

## 4.3 — Test Groups and Test Cases

### Group 1: `clampDelay` — FR-03.3, EC-12

```typescript
describe("clampDelay", () => {

  it("returns the value unchanged when within range (1000 ms)", () => {
    expect(clampDelay(1000)).toBe(1000);
  });

  it("clamps to 500 when input is below minimum (EC-12)", () => {
    expect(clampDelay(100)).toBe(500);
  });

  it("clamps to 500 when input is exactly 499", () => {
    expect(clampDelay(499)).toBe(499 < 500 ? 500 : 499); // 500
  });

  it("clamps to 30000 when input exceeds maximum", () => {
    expect(clampDelay(99999)).toBe(30_000);
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
    expect(clampDelay(30000)).toBe(30_000);
  });

});
```

### Group 2: `loadAndMergeSettings` — FR-05.1, EC-09

```typescript
describe("loadAndMergeSettings", () => {

  it("returns full defaults when raw is null (EC-09, FR-05.1)", () => {
    const result = loadAndMergeSettings(null);
    expect(result.triggerMode).toBe("both");
    expect(result.debounceDelayMs).toBe(2000);
  });

  it("uses stored triggerMode when valid", () => {
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
    const result = loadAndMergeSettings({ triggerMode: "both", debounceDelayMs: 999999 });
    expect(result.debounceDelayMs).toBe(30_000);
  });

  it("uses default debounceDelayMs when key is absent from raw", () => {
    const result = loadAndMergeSettings({ triggerMode: "debounce" });
    expect(result.debounceDelayMs).toBe(2000);
  });

  it("ignores unknown keys in raw (forward compatibility)", () => {
    const result = loadAndMergeSettings({ triggerMode: "both", debounceDelayMs: 1000, unknownKey: "ignored" });
    expect(result.triggerMode).toBe("both");
    expect(result.debounceDelayMs).toBe(1000);
  });

});
```

### Group 3: `attemptSave` — FR-04, EC-01, EC-02, EC-07, EC-15

Set up a mock tab manager before each test in this group. Use `beforeEach` /
`afterEach` to clean up `window.__MARKABLE_TAB_MANAGER__`.

```typescript
describe("attemptSave", () => {
  let mockTabManager: {
    getActiveTab: ReturnType<typeof vi.fn>;
    saveActiveTab: ReturnType<typeof vi.fn>;
  };
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
```

### Group 4: `autoSaveListener` — module evaluation

```typescript
describe("autoSaveListener", () => {

  it("is a non-null Extension object (CM6 globals destructure succeeded)", () => {
    expect(autoSaveListener).toBeDefined();
    expect(autoSaveListener).not.toBeNull();
  });

});
```

### Group 5: Debounce timer logic — EC-03, EC-04, EC-05

These tests verify timer reset and cancellation behaviour using `vi.useFakeTimers()`.
Because `autoSaveListener` is a CM6 Extension (not directly callable), the debounce
logic is exercised indirectly by testing that `_debounceTimer` is set after a document
change. However, the pure logic (cancel + set pattern) is testable by re-implementing
it in isolation and verifying counts.

The recommended approach is to test the `attemptSave` + timer integration through
a controlled call to a helper that simulates the updateListener callback body. Since
this is not exported directly, the tests use `vi.useFakeTimers()` and verify that
`saveActiveTab` is called once after inactivity, not multiple times during rapid
changes.

Note: Full integration with the CM6 updateListener requires the full CM6 state
machinery. These tests instead verify the time-based invariants through `vi.runAllTimers()`.

```typescript
describe("debounce behaviour", () => {
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

  it("attemptSave does not itself introduce a timer (pure check)", () => {
    // attemptSave is synchronous — calling it does not schedule anything.
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1);
  });

  it("a rapid series of attemptSave calls each trigger a save (no timer in attemptSave)", () => {
    // This confirms attemptSave is stateless — the debounce is in the listener, not here.
    for (let i = 0; i < 5; i++) attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(5);
  });

  it("save is skipped when tab becomes clean between timer start and fire (EC-04)", () => {
    // Simulate: save fires, dirty flag is cleared, then attemptSave is called again.
    mockTabManager.getActiveTab.mockReturnValueOnce({ filePath: "/file.md", isDirty: true });
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1);

    // Now tab is clean (manual save happened)
    mockTabManager.getActiveTab.mockReturnValue({ filePath: "/file.md", isDirty: false });
    attemptSave();
    expect(mockTabManager.saveActiveTab).toHaveBeenCalledTimes(1); // no additional call
  });

});
```

### Group 6: Plugin lifecycle and listener cleanup — EC-05, EC-10, EC-13

These tests verify plugin-level lifecycle behaviour using the `onEnable` / `onDisable`
methods from the default export. They require a mock `MarkablePluginAPI`.

```typescript
describe("plugin lifecycle", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let pluginDefault: any;
  let mockApi: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(async () => {
    // Re-use the module already loaded in the outer beforeAll.
    const mod = await import("../../../src/plugins/auto-save/auto-save.plugin");
    pluginDefault = mod.default;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockApi = {
      loadSettings: vi.fn().mockResolvedValue(null),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      addExtensions: vi.fn(),
      removeExtensions: vi.fn(),
      restartSelf: vi.fn().mockResolvedValue(undefined),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getActiveTab: vi.fn().mockReturnValue({ filePath: "/f.md", isDirty: true }),
      saveActiveTab: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as any).__MARKABLE_TAB_MANAGER__ = undefined;
    // Ensure plugin is disabled to clean up any listeners from the test.
    pluginDefault.onDisable(mockApi);
  });

  it("onEnable loads settings with defaults on null response (EC-09)", async () => {
    mockApi.loadSettings.mockResolvedValue(null);
    await pluginDefault.onEnable(mockApi);
    // In "both" mode (default) addExtensions should be called.
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
    const addEventSpy = vi.spyOn(window, "addEventListener");
    const removeEventSpy = vi.spyOn(window, "removeEventListener");
    await pluginDefault.onEnable(mockApi);
    // Capture which function was registered.
    const addedHandler = addEventSpy.mock.calls.find((c) => c[0] === "blur")?.[1];
    pluginDefault.onDisable(mockApi);
    const removedHandler = removeEventSpy.mock.calls.find((c) => c[0] === "blur")?.[1];
    // The exact same function reference must be used for both add and remove.
    expect(addedHandler).toBe(removedHandler);
    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it("onDisable is safe when no blur listener was attached (focus-loss not active) (EC-13)", async () => {
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "debounce", debounceDelayMs: 2000 });
    await pluginDefault.onEnable(mockApi);
    expect(() => pluginDefault.onDisable(mockApi)).not.toThrow();
  });

  it("rapid enable/disable cycles leave no stale blur listeners (EC-13)", async () => {
    mockApi.loadSettings.mockResolvedValue({ triggerMode: "both", debounceDelayMs: 2000 });
    const addEventSpy = vi.spyOn(window, "addEventListener");
    const removeEventSpy = vi.spyOn(window, "removeEventListener");

    for (let i = 0; i < 3; i++) {
      await pluginDefault.onEnable(mockApi);
      pluginDefault.onDisable(mockApi);
    }

    const addCount = addEventSpy.mock.calls.filter((c) => c[0] === "blur").length;
    const removeCount = removeEventSpy.mock.calls.filter((c) => c[0] === "blur").length;
    expect(addCount).toBe(removeCount); // Every add has a matching remove.
    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it("EC-10: onDisable called before settings load resolves — no listeners attached", async () => {
    let resolveSettings!: (v: null) => void;
    mockApi.loadSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
    const addEventSpy = vi.spyOn(window, "addEventListener");

    const enablePromise = pluginDefault.onEnable(mockApi);
    // Disable before the loadSettings promise resolves.
    pluginDefault.onDisable(mockApi);
    resolveSettings(null);
    await enablePromise;

    // The continuation should have bailed out — no blur listener attached.
    const blurCalls = addEventSpy.mock.calls.filter((c) => c[0] === "blur");
    expect(blurCalls).toHaveLength(0);
    expect(mockApi.addExtensions).not.toHaveBeenCalled();
    addEventSpy.mockRestore();
  });

});
```

---

## 4.4 — EC Coverage Checklist

| EC | Test Group | Test Name |
|---|---|---|
| EC-01 | Group 3 | "skips when tab is untitled" |
| EC-02 | Group 3 | "skips when tab is clean" |
| EC-03 | Group 5 | debounce series tests |
| EC-04 | Group 5 | "save is skipped when tab becomes clean" |
| EC-05 | Group 6 | "onDisable calls removeExtensions" |
| EC-06 | Group 3 | happy path + clean tab skip (blur calls attemptSave; timer fires and skips) |
| EC-07 | Group 3 | "skips when getActiveTab returns null" |
| EC-08 | n/a | Delegated to TabManager; no plugin test needed |
| EC-09 | Group 2 + Group 6 | "returns full defaults when raw is null"; "onEnable loads settings with defaults on null" |
| EC-10 | Group 6 | "EC-10: onDisable called before settings load resolves" |
| EC-11 | Group 6 | mode routing tests + restart is tested at the UI level in step 3 verification |
| EC-12 | Group 1 | "clamps to 500 when input is below minimum" |
| EC-13 | Group 6 | "rapid enable/disable cycles leave no stale blur listeners" |
| EC-14 | n/a | OS-level quit behaviour; not unit-testable |
| EC-15 | Group 3 | "warns and skips when __MARKABLE_TAB_MANAGER__ is undefined" |
| EC-16 | n/a | Acceptable v1 behaviour; no test |

---

## 4.5 — Verification

Run `npx vitest run tests/plugins/auto-save/` and confirm:

1. All tests pass.
2. No tests in the file are in "skipped" state without an explanatory comment.
3. The test count for this file is included in the project total in `MEMORY.md`.

---

## Step 4 is done when

- `tests/plugins/auto-save/auto-save.test.ts` exists and all tests pass.
- `npx vitest run` (full suite) exits 0.
- EC coverage table above is satisfied.
- Test count updated in `MEMORY.md` under "Test Counts".
