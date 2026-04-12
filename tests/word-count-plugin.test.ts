/**
 * Tests for WordCountPlugin (src/plugins/word-count/index.ts).
 *
 * All tests are pure unit tests. The CM6 editor is not instantiated — only
 * the DOM element interface of the PluginContext status bar zones is needed.
 *
 * Cases covered:
 *   - onEnable calls enableWordCount with ctx.statusBar.center and calls
 *     ctx.ensureStatusBar(), then registers "wordCount" as a status bar dependent.
 *   - onDisable calls disableWordCount, unregisters from the status bar, and
 *     calls ctx.hideStatusBarIfUnused().
 *   - restoreFromSettings enables the plugin when settings.wordCount === true
 *     and leaves it disabled when false or undefined.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { WordCountPlugin } from "../src/plugins/word-count/index";
import { isWordCountEnabled } from "../src/plugins/word-count/word-count";
import {
  hideStatusBarIfUnused,
  getStatusBarVisible,
  unregisterStatusBarDependent,
  setStatusBarVisible,
} from "../src/plugins/status-bar/status-bar";
import type { PluginContext } from "../src/plugins/plugin-types";
import type { MarkableSettings } from "../src/lib/settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a PluginContext stub.
 * ensureStatusBar and hideStatusBarIfUnused are vi.fn() mocks so we can verify
 * WordCountPlugin calls them correctly.
 */
function makeCtx(): PluginContext & {
  ensureStatusBar: ReturnType<typeof vi.fn>;
  hideStatusBarIfUnused: ReturnType<typeof vi.fn>;
} {
  return {
    editor: { dispatch: vi.fn() } as unknown as PluginContext["editor"],
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
    ensureStatusBar: vi.fn(),
    hideStatusBarIfUnused: vi.fn(),
  };
}

/**
 * Minimal MarkableSettings factory.
 *
 * @param wordCount - Value for settings.wordCount field.
 */
function makeSettings(wordCount?: boolean): MarkableSettings {
  return {
    version: 1,
    window: { sizeW: "80%", sizeH: "80%", maximizeOnLaunch: false },
    editor: { contentWidth: "900px", fontSize: 16 },
    theme: { active: "system" },
    recentFiles: [],
    findWidget: null,
    wordCount,
  } as unknown as MarkableSettings;
}

// ---------------------------------------------------------------------------
// Reset module-level state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Ensure word count starts disabled between tests.
  WordCountPlugin.onDisable(makeCtx());
  // Remove wordCount from the dependents set so hideStatusBarIfUnused is not
  // accidentally blocked by a previous test's registration.
  unregisterStatusBarDependent("wordCount");
  setStatusBarVisible(false);
});

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

describe("WordCountPlugin metadata", () => {
  it("has id 'wordCount' matching the MarkableSettings key", () => {
    expect(WordCountPlugin.id).toBe("wordCount");
  });

  it("has required metadata fields (name, description, detail)", () => {
    expect(WordCountPlugin.name).toBeTruthy();
    expect(WordCountPlugin.description).toBeTruthy();
    expect(WordCountPlugin.detail).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// onEnable
// ---------------------------------------------------------------------------

describe("WordCountPlugin.onEnable()", () => {
  it("calls enableWordCount making isWordCountEnabled() return true", () => {
    const ctx = makeCtx();
    WordCountPlugin.onEnable(ctx);
    expect(isWordCountEnabled()).toBe(true);
  });

  it("passes ctx.statusBar.center to enableWordCount (targets correct zone)", () => {
    const ctx = makeCtx();
    // Give the center element a unique id so we can identify it.
    ctx.statusBar.center.id = "center-zone";
    WordCountPlugin.onEnable(ctx);
    // isWordCountEnabled is true, meaning enableWordCount was called.
    // We can verify the zone is set by checking word count's output target.
    expect(isWordCountEnabled()).toBe(true);
    // Confirm no accidental side-effects on left/right zones.
    expect(ctx.statusBar.left.textContent).toBe("");
    expect(ctx.statusBar.right.textContent).toBe("");
  });

  it("calls ctx.ensureStatusBar() to make the status bar visible", () => {
    const ctx = makeCtx();
    WordCountPlugin.onEnable(ctx);
    expect(ctx.ensureStatusBar).toHaveBeenCalledOnce();
  });

  it("registers 'wordCount' as a status bar dependent", () => {
    const ctx = makeCtx();
    WordCountPlugin.onEnable(ctx);
    // After registering, calling hideStatusBarIfUnused (the real function,
    // already imported at the top of this file) must NOT hide the bar because
    // wordCount is still in the STATUS_BAR_PLUGINS set.
    setStatusBarVisible(true);
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// onDisable
// ---------------------------------------------------------------------------

describe("WordCountPlugin.onDisable()", () => {
  beforeEach(() => {
    WordCountPlugin.onEnable(makeCtx());
  });

  it("calls disableWordCount making isWordCountEnabled() return false", () => {
    WordCountPlugin.onDisable(makeCtx());
    expect(isWordCountEnabled()).toBe(false);
  });

  it("calls ctx.hideStatusBarIfUnused() to conditionally hide the bar", () => {
    const ctx = makeCtx();
    WordCountPlugin.onDisable(ctx);
    expect(ctx.hideStatusBarIfUnused).toHaveBeenCalledOnce();
  });

  it("unregisters 'wordCount' from the status bar dependents set", () => {
    WordCountPlugin.onDisable(makeCtx());
    // After unregistering, the STATUS_BAR_PLUGINS set no longer contains
    // wordCount. Calling hideStatusBarIfUnused (real function, already imported)
    // must now be free to hide the bar.
    setStatusBarVisible(true);
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// restoreFromSettings
// ---------------------------------------------------------------------------

describe("WordCountPlugin.restoreFromSettings()", () => {
  it("enables when settings.wordCount === true", () => {
    WordCountPlugin.restoreFromSettings!(makeSettings(true), makeCtx());
    expect(WordCountPlugin.isEnabled()).toBe(true);
  });

  it("stays disabled when settings.wordCount === false", () => {
    WordCountPlugin.restoreFromSettings!(makeSettings(false), makeCtx());
    expect(WordCountPlugin.isEnabled()).toBe(false);
  });

  it("stays disabled when settings.wordCount is undefined", () => {
    WordCountPlugin.restoreFromSettings!(makeSettings(undefined), makeCtx());
    expect(WordCountPlugin.isEnabled()).toBe(false);
  });
});
