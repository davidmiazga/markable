/**
 * Tests for TypewriterModePlugin (src/plugins/typewriter-mode/index.ts).
 *
 * Mirrors the FocusModePlugin test pattern. Tests are pure unit tests that
 * exercise the MarkablePlugin interface implementation without a real CM6
 * editor. The EditorView is a minimal stub that captures dispatched effects.
 *
 * Cases covered:
 *   - onEnable dispatches a transaction with the setTypewriterMode effect = true
 *     and sets _enabled (isEnabled() returns true).
 *   - onDisable dispatches a transaction with the setTypewriterMode effect = false
 *     and sets _enabled = false.
 *   - restoreFromSettings enables when settings.typewriterMode === true.
 *   - restoreFromSettings does not enable when settings.typewriterMode is false
 *     or undefined.
 *   - getExtensions() returns a non-empty array without requiring an editor.
 *
 * EC-4: getExtensions() is called before editor creation (pure call, no DOM).
 * EC-15: restoreFromSettings sets _enabled via onEnable before returning so
 *        isEnabled() returns accurate state immediately after restore.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TypewriterModePlugin } from "../src/plugins/typewriter-mode/index";
import type { PluginContext } from "../src/plugins/plugin-types";
import type { MarkableSettings } from "../src/lib/settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a PluginContext stub that captures dispatched transactions.
 * Extends the return type so tests can inspect the `dispatched` array directly.
 */
function makeCtx(): PluginContext & { dispatched: unknown[] } {
  const dispatched: unknown[] = [];
  return {
    editor: {
      dispatch(tr: unknown) { dispatched.push(tr); },
    } as unknown as PluginContext["editor"],
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
    ensureStatusBar: vi.fn(),
    hideStatusBarIfUnused: vi.fn(),
    dispatched,
  };
}

/**
 * Minimal MarkableSettings factory.
 *
 * @param typewriterMode - Value for settings.typewriterMode field.
 */
function makeSettings(typewriterMode?: boolean): MarkableSettings {
  return {
    version: 1,
    window: { sizeW: "80%", sizeH: "80%", maximizeOnLaunch: false },
    editor: { contentWidth: "900px", fontSize: 16 },
    theme: { active: "system" },
    recentFiles: [],
    findWidget: null,
    typewriterMode,
  } as unknown as MarkableSettings;
}

// ---------------------------------------------------------------------------
// Reset shared module state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Drive the module-level _enabled flag to false before each test.
  // Using a no-op ctx avoids depending on side-effects from a shared editor.
  TypewriterModePlugin.onDisable(makeCtx());
});

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

describe("TypewriterModePlugin metadata", () => {
  it("has id 'typewriterMode' matching the MarkableSettings key", () => {
    expect(TypewriterModePlugin.id).toBe("typewriterMode");
  });

  it("has required metadata fields (name, description, detail)", () => {
    expect(TypewriterModePlugin.name).toBeTruthy();
    expect(TypewriterModePlugin.description).toBeTruthy();
    expect(TypewriterModePlugin.detail).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// isEnabled()
// ---------------------------------------------------------------------------

describe("TypewriterModePlugin.isEnabled()", () => {
  it("returns false by default (after beforeEach reset)", () => {
    // beforeEach calls onDisable to guarantee a known baseline.
    expect(TypewriterModePlugin.isEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onEnable()
// ---------------------------------------------------------------------------

describe("TypewriterModePlugin.onEnable()", () => {
  it("sets isEnabled() to true", () => {
    TypewriterModePlugin.onEnable(makeCtx());
    expect(TypewriterModePlugin.isEnabled()).toBe(true);
  });

  it("dispatches exactly one transaction to the editor (setTypewriterMode effect)", () => {
    const ctx = makeCtx();
    TypewriterModePlugin.onEnable(ctx);
    // One dispatch call must have been made.
    expect(ctx.dispatched.length).toBe(1);
    // The dispatched object must carry an effects property (CM6 transaction spec).
    const tr = ctx.dispatched[0] as { effects: unknown };
    expect(tr.effects).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// onDisable()
// ---------------------------------------------------------------------------

describe("TypewriterModePlugin.onDisable()", () => {
  beforeEach(() => {
    // Start in enabled state so disable has meaningful work to do.
    TypewriterModePlugin.onEnable(makeCtx());
  });

  it("sets isEnabled() to false", () => {
    TypewriterModePlugin.onDisable(makeCtx());
    expect(TypewriterModePlugin.isEnabled()).toBe(false);
  });

  it("dispatches exactly one transaction to the editor (setTypewriterMode effect)", () => {
    const ctx = makeCtx();
    TypewriterModePlugin.onDisable(ctx);
    expect(ctx.dispatched.length).toBe(1);
    const tr = ctx.dispatched[0] as { effects: unknown };
    expect(tr.effects).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// restoreFromSettings()
// ---------------------------------------------------------------------------

describe("TypewriterModePlugin.restoreFromSettings()", () => {
  it("enables when settings.typewriterMode is true", () => {
    TypewriterModePlugin.restoreFromSettings!(makeSettings(true), makeCtx());
    expect(TypewriterModePlugin.isEnabled()).toBe(true);
  });

  it("stays disabled when settings.typewriterMode is false", () => {
    TypewriterModePlugin.restoreFromSettings!(makeSettings(false), makeCtx());
    expect(TypewriterModePlugin.isEnabled()).toBe(false);
  });

  it("stays disabled when settings.typewriterMode is undefined", () => {
    TypewriterModePlugin.restoreFromSettings!(makeSettings(undefined), makeCtx());
    expect(TypewriterModePlugin.isEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getExtensions() — EC-4
// ---------------------------------------------------------------------------

describe("TypewriterModePlugin.getExtensions()", () => {
  it("is defined and returns a non-empty array (EC-4: pure call, no editor needed)", () => {
    // Must be callable before the editor exists — no DOM, no EditorView required.
    const exts = TypewriterModePlugin.getExtensions!();
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThan(0);
  });

  it("returns the same array on repeated calls (idempotent)", () => {
    const first = TypewriterModePlugin.getExtensions!();
    const second = TypewriterModePlugin.getExtensions!();
    expect(first).toEqual(second);
  });
});
