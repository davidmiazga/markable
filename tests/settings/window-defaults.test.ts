/**
 * Regression guard: window launch size defaults.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The window launch size is defined in TWO separate locations that must always
 * agree:
 *
 *   1. src/lib/settings.ts  — DEFAULT_SETTINGS.window.sizeW / sizeH
 *      (used by the TypeScript frontend on every app launch)
 *
 *   2. src-tauri/src/lib.rs — the .setup() hook multipliers 0.5 and 0.8
 *      (used by the Rust backend to size the native window before JS runs)
 *
 * The correct values are sizeW = "50%" and sizeH = "80%".
 * The height is 80%, NOT 50% — this is the value that has regressed before.
 *
 * When an agent implements a settings-related feature and reconstructs
 * DEFAULT_SETTINGS from memory or a partial file read, it sometimes writes
 * "50%" for both axes. That produces a horizontally letterboxed window on
 * first launch (no persisted settings file) and creates a poor first-run UX.
 *
 * This test will catch that regression the moment `npm run test:run` is run.
 * It is intentionally narrow — it does not test behaviour, only the static
 * default values. That makes it fast and impossible to accidentally break
 * without someone explicitly changing the expected strings.
 *
 * Canonical invariant reference: docs/specs/invariants/window-size-defaults.md
 */

import { describe, it, expect, vi } from "vitest";

// DEFAULT_SETTINGS imports settings.ts which imports Tauri APIs at module
// scope. We must mock those before the import resolves.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { DEFAULT_SETTINGS } from "../../src/lib/settings";

describe("DEFAULT_SETTINGS.window — launch size invariants", () => {
  it("sizeW is 50% (50% of screen width)", () => {
    expect(DEFAULT_SETTINGS.window.sizeW).toBe("50%");
  });

  it("sizeH is 80% (80% of screen height — NOT 50%)", () => {
    // This is the value that has regressed before. The correct value is
    // "80%", not "50%". See docs/specs/invariants/window-size-defaults.md.
    expect(DEFAULT_SETTINGS.window.sizeH).toBe("80%");
  });

  it("x and y are -1 (sentinel: position not yet saved)", () => {
    expect(DEFAULT_SETTINGS.window.x).toBe(-1);
    expect(DEFAULT_SETTINGS.window.y).toBe(-1);
  });

  it("fullscreen defaults to false", () => {
    expect(DEFAULT_SETTINGS.window.fullscreen).toBe(false);
  });

  it("maximized defaults to false", () => {
    expect(DEFAULT_SETTINGS.window.maximized).toBe(false);
  });
});

// ── Fallback guard ────────────────────────────────────────────────────────────
//
// applyWindowSettings() uses `settings.sizeH ?? fallback`. The fallback must
// also be "80%" — a mismatch here would produce the wrong size for users
// whose settings file predates the sizeH field.
//
// We test this by importing the function and inspecting its behaviour when
// called with a WindowSettings object that omits sizeH.

import { applyWindowSettings } from "../../src/lib/settings";

describe("applyWindowSettings — sizeH fallback is 80%", () => {
  it("uses 80% height when sizeH is absent (old settings file)", async () => {
    // Provide a minimal WindowSettings with sizeH deliberately absent.
    const oldSettings = {
      x: -1, y: -1, width: 0, height: 0,
      fullscreen: false, maximized: false,
      sizeW: "50%" as const,
      // sizeH intentionally omitted
    };

    // Mock the Tauri window API so applyWindowSettings doesn't throw.
    const setSize = vi.fn().mockResolvedValue(undefined);
    const setPosition = vi.fn().mockResolvedValue(undefined);
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    vi.mocked(getCurrentWebviewWindow).mockReturnValue({
      setSize, setPosition, maximize: vi.fn(), setFullscreen: vi.fn(), center: vi.fn(),
    } as any);

    // Spy on screen dimensions so we get deterministic pixel values.
    Object.defineProperty(window, "screen", {
      value: { width: 2000, height: 1200 },
      configurable: true,
    });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });

    await applyWindowSettings(oldSettings as any);

    // With sizeH ?? "80%", height should be 1200 * 0.80 = 960.
    // With the old wrong fallback "50%", it would be 1200 * 0.50 = 600.
    const { PhysicalSize } = await import("@tauri-apps/api/dpi");
    const call = vi.mocked(PhysicalSize).mock.calls[0] as unknown as [number, number];
    const height = call[1];
    expect(height).toBe(960);
  });
});
