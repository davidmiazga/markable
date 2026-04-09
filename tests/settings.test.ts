import { describe, it, expect, vi } from "vitest";

// Mock Tauri APIs before importing settings
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

import { isWindowOffScreen, applyEditorSettings, EDITOR_CONSTRAINTS, DEFAULT_SETTINGS, getMostRecentFile } from "../src/lib/settings";

describe("isWindowOffScreen", () => {
  const screenW = 1920;
  const screenH = 1080;

  it("returns false for a window fully on screen", () => {
    expect(isWindowOffScreen(100, 100, 800, 600, screenW, screenH)).toBe(false);
  });

  it("returns true for a window entirely off right edge", () => {
    expect(isWindowOffScreen(2000, 100, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns true for a window entirely off bottom edge", () => {
    expect(isWindowOffScreen(100, 2000, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns true for a window entirely off left edge", () => {
    expect(isWindowOffScreen(-900, 100, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns false for partially visible window (>50px visible)", () => {
    expect(isWindowOffScreen(-700, 100, 800, 600, screenW, screenH)).toBe(false);
  });

  it("returns true for barely visible window (<50px visible)", () => {
    expect(isWindowOffScreen(-780, 100, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns true for sentinel values (width=0, height=0)", () => {
    expect(isWindowOffScreen(0, 0, 0, 0, screenW, screenH)).toBe(true);
  });

  it("returns true for window entirely above screen", () => {
    expect(isWindowOffScreen(100, -700, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns false for window at origin", () => {
    expect(isWindowOffScreen(0, 0, 800, 600, screenW, screenH)).toBe(false);
  });
});

describe("applyEditorSettings", () => {
  it("sets --settings-content-max-width CSS variable", () => {
    applyEditorSettings({ contentMaxWidth: 800, contentPadding: "responsive", baseFontSize: 16 });
    const value = document.documentElement.style.getPropertyValue("--settings-content-max-width");
    expect(value).toBe("800px");
  });

  it("sets --settings-base-font-size CSS variable", () => {
    applyEditorSettings({ contentMaxWidth: 900, contentPadding: "responsive", baseFontSize: 20 });
    const value = document.documentElement.style.getPropertyValue("--settings-base-font-size");
    expect(value).toBe("20px");
  });

  it("uses default content width of 900px", () => {
    applyEditorSettings(DEFAULT_SETTINGS.editor);
    const value = document.documentElement.style.getPropertyValue("--settings-content-max-width");
    expect(value).toBe("900px");
  });

  it("uses default font size of 16px", () => {
    applyEditorSettings(DEFAULT_SETTINGS.editor);
    const value = document.documentElement.style.getPropertyValue("--settings-base-font-size");
    expect(value).toBe("16px");
  });
});

describe("EDITOR_CONSTRAINTS", () => {
  it("has correct content width range", () => {
    expect(EDITOR_CONSTRAINTS.contentMaxWidth.min).toBe(500);
    expect(EDITOR_CONSTRAINTS.contentMaxWidth.max).toBe(1400);
  });

  it("has correct font size range", () => {
    expect(EDITOR_CONSTRAINTS.baseFontSize.min).toBe(10);
    expect(EDITOR_CONSTRAINTS.baseFontSize.max).toBe(28);
  });
});

describe("Recent Files", () => {
  it("getMostRecentFile returns null when list is empty", () => {
    expect(getMostRecentFile()).toBeNull();
  });
});
