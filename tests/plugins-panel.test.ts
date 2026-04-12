/**
 * Tests for the plugins panel (src/plugins/plugins-panel/plugins-panel.ts).
 *
 * Most panel behavior is DOM-interactive and is tested by visual inspection
 * during development. This file covers:
 *   - Guard conditions that protect against calling panel functions before
 *     the panel DOM exists (EC-10).
 *   - Section rendering assertions added in step_04a: Core section with
 *     version badges, User section with Reload button, Overridden badge.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPluginsPanel,
  openPluginsPanel,
  updatePluginStates,
  updateUserPluginDefs,
} from "../src/plugins/plugins-panel/plugins-panel";
import type { UnifiedPluginDef } from "../src/plugins/index";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a minimal loaded UnifiedPluginDef for test use.
 * All required fields are present; optional ones default sensibly.
 */
function makeCoreDef(id: string, version = "1.0.0"): UnifiedPluginDef {
  return {
    id,
    name: `Plugin ${id}`,
    description: "A test plugin.",
    detail: "Detail text.",
    version,
    // filename is the on-disk basename; for core plugins it matches the id
    // pattern (kebab-case + .js).
    filename: `${id}.js`,
    kind: "core",
    status: "loaded",
  };
}

function makeUserDef(id: string): UnifiedPluginDef {
  return {
    id,
    name: `User Plugin ${id}`,
    description: "A user test plugin.",
    detail: "User detail text.",
    version: "2.0.0",
    filename: `${id}.js`,
    kind: "user",
    status: "loaded",
  };
}

/**
 * Create an overridden core-slot def whose filename matches the given string.
 * The filename is what the panel uses in the badge tooltip (FR-9).
 *
 * @param filename  The on-disk basename (e.g. "focus-mode.js").
 */
function makeOverriddenDef(filename: string): UnifiedPluginDef {
  return {
    id: `__overridden__${filename}`,
    name: filename,
    description: "Core plugin overridden by user file.",
    detail: "",
    version: "",
    filename,
    kind: "core",
    status: "overridden",
  };
}

// ── pre-init guard (EC-10) ────────────────────────────────────────────────────

describe("plugins-panel — pre-init guard (EC-10)", () => {
  it("updatePluginStates does not throw before createPluginsPanel is called", () => {
    // panelElement is null on initial module load (it is set only by
    // createPluginsPanel). Calling updatePluginStates before the panel exists
    // must be a safe no-op — the early-return on `!panelElement` handles this.
    //
    // Cast to satisfy the Record<string, boolean> type expected by the function.
    // The settings type is not relevant here; we pass any boolean map.
    const partial: Record<string, boolean> = { statusBar: true };
    expect(() => updatePluginStates(partial)).not.toThrow();
  });

  it("updatePluginStates does not throw with an empty partial object", () => {
    // Edge: an empty update must also be safe before panel creation.
    expect(() => updatePluginStates({})).not.toThrow();
  });
});

describe("plugins-panel — updateUserPluginDefs guard", () => {
  it("updateUserPluginDefs does not throw before createPluginsPanel is called", () => {
    // The panel module may be imported before createPluginsPanel() runs (e.g.
    // during tests or if wiring order changes). This must be a safe no-op.
    expect(() => updateUserPluginDefs([], {})).not.toThrow();
  });
});

// ── Section rendering tests (step_04a) ────────────────────────────────────────

/**
 * These tests exercise the two-section list view introduced in step_04a.
 * Each test creates a fresh panel (appended to document.body by createPluginsPanel)
 * and then opens it to trigger the sectioned list render.
 *
 * Cleanup: the panel overlay is removed from document.body after each test
 * to prevent cross-test DOM pollution.
 */
describe("plugins-panel — Core/User section rendering (step_04a)", () => {
  beforeEach(() => {
    // Remove any plugins-overlay left behind by a previous test.
    document.getElementById("plugins-overlay")?.remove();
  });

  it("renders a 'Core Plugins' section heading for core definitions", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("focus-mode")],
      { "focus-mode": false },
      toggle,
    );
    openPluginsPanel({ "focus-mode": false });

    const headings = document.querySelectorAll(".plugin-section-title");
    const labels = Array.from(headings).map((h) => h.textContent);
    expect(labels).toContain("Core Plugins");
  });

  it("renders a 'User Plugins' section heading for user definitions", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeUserDef("my-plugin")],
      { "my-plugin": false },
      toggle,
    );
    openPluginsPanel({ "my-plugin": false });

    const headings = document.querySelectorAll(".plugin-section-title");
    const labels = Array.from(headings).map((h) => h.textContent);
    expect(labels).toContain("User Plugins");
  });

  it("shows v{version} badge on a loaded core plugin row", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("focus-mode", "1.2.3")],
      { "focus-mode": false },
      toggle,
    );
    openPluginsPanel({ "focus-mode": false });

    const badges = document.querySelectorAll(".plugin-version-badge");
    expect(badges.length).toBeGreaterThan(0);
    // The badge text must match the version string prefixed with 'v'.
    const badgeTexts = Array.from(badges).map((b) => b.textContent);
    expect(badgeTexts).toContain("v1.2.3");
  });

  it("does NOT show a version badge on a user plugin row", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeUserDef("my-plugin")],
      { "my-plugin": false },
      toggle,
    );
    openPluginsPanel({ "my-plugin": false });

    // Version badges are core-only in the list view.
    const badges = document.querySelectorAll(".plugin-version-badge");
    expect(badges.length).toBe(0);
  });

  it("renders 'overridden' badge on an overridden core plugin row", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeOverriddenDef("focus-mode.js")],
      {},
      toggle,
    );
    openPluginsPanel({});

    const overriddenBadges = document.querySelectorAll(".plugin-status-overridden");
    expect(overriddenBadges.length).toBeGreaterThan(0);
    const badgeTexts = Array.from(overriddenBadges).map((b) => b.textContent);
    expect(badgeTexts).toContain("overridden");
  });

  it("renders the Reload button in the User Plugins section header", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeUserDef("my-plugin")],
      { "my-plugin": false },
      toggle,
      reload,
    );
    openPluginsPanel({ "my-plugin": false });

    const reloadBtns = document.querySelectorAll(".plugin-reload-btn");
    expect(reloadBtns.length).toBe(1);
  });

  it("Reload button is enabled when a reloadPlugins callback is provided", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeUserDef("my-plugin")],
      { "my-plugin": false },
      toggle,
      reload,
    );
    openPluginsPanel({ "my-plugin": false });

    const btn = document.querySelector(".plugin-reload-btn") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it("Reload button is disabled when no reloadPlugins callback is provided", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    // No reload callback passed.
    createPluginsPanel(
      [makeUserDef("my-plugin")],
      { "my-plugin": false },
      toggle,
    );
    openPluginsPanel({ "my-plugin": false });

    const btn = document.querySelector(".plugin-reload-btn") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it("FR-9: overridden badge tooltip includes the specific overriding filename", () => {
    // FR-9 requires the badge tooltip to name the exact user file shadowing the
    // core slot. The tooltip must not be generic ("A user plugin overrides this
    // slot") — it must identify the file by name so the user can find it on disk.
    const toggle = vi.fn().mockResolvedValue(undefined);
    // "focus-mode.js" is the filename that will appear in the tooltip.
    createPluginsPanel(
      [makeOverriddenDef("focus-mode.js")],
      {},
      toggle,
    );
    openPluginsPanel({});

    const badge = document.querySelector(".plugin-status-overridden") as HTMLElement;
    expect(badge).not.toBeNull();
    // The title attribute must contain the specific filename.
    expect(badge.title).toContain("focus-mode.js");
  });
});
