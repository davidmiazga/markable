/**
 * Tests for the plugins panel (src/plugins/plugins-panel/plugins-panel.ts).
 *
 * Most panel behavior is DOM-interactive and is tested by visual inspection
 * during development. This file covers:
 *   - Guard conditions that protect against calling panel functions before
 *     the panel DOM exists (EC-10).
 *   - Section rendering: pack headings, version badges, User Reload,
 *     Overridden badge, and pack master-switch state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  closePluginsPanel,
  createPluginsPanel,
  openPluginsPanel,
  updatePluginStates,
  updateUserPluginDefs,
} from "../src/plugins/plugins-panel/plugins-panel";
import type { UnifiedPluginDef } from "../src/plugins/index";
import * as flavor from "../src/lib/flavor";
import pkmManifest from "../flavors/pkm.json";

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
 * These tests exercise pack-section list rendering.
 * Each test creates a fresh panel (appended to document.body by createPluginsPanel)
 * and then opens it to trigger the sectioned list render.
 *
 * Cleanup: the panel overlay is removed from document.body after each test
 * to prevent cross-test DOM pollution.
 *
 * Default test flavor is Markable (`VITE_FLAVOR` unset). The sidebar lists
 * packs in flavor order, then User Plugins, and opens on Base editing.
 */
describe("plugins-panel — pack section rendering", () => {
  beforeEach(() => {
    // Remove any plugins-overlay left behind by a previous test.
    document.getElementById("plugins-overlay")?.remove();
  });

  it("lists nav buttons in flavor pack order and shows Base editing", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("focus-mode")],
      { "focus-mode": false },
      toggle,
    );
    openPluginsPanel({ "focus-mode": false });

    const nav = document.querySelector("nav.settings-nav");
    expect(nav?.getAttribute("role")).toBe("tablist");
    expect(nav?.getAttribute("aria-label")).toBe("Plugin sections");
    expect(document.querySelector(".settings-panel")?.classList.contains("settings-panel--nav")).toBe(true);
    const pane = document.querySelector("#plugins-body");
    expect(pane?.classList.contains("settings-nav-pane")).toBe(true);
    expect(pane?.getAttribute("role")).toBe("tabpanel");

    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button.settings-nav-btn"),
    );
    expect(buttons.map((btn) => btn.textContent)).toEqual([
      "Base editing",
      "PKM",
      "Project",
      "Quick note",
      "Diary",
      "Book",
      "User Plugins",
    ]);
    expect(buttons.map((btn) => btn.dataset.section)).toEqual([
      "base",
      "pkm",
      "project",
      "quicknote",
      "diary",
      "book",
      "user",
    ]);
    for (const btn of buttons) {
      expect(btn.type).toBe("button");
      expect(btn.getAttribute("role")).toBe("tab");
    }
    expect(buttons[0]?.getAttribute("aria-selected")).toBe("true");
    expect(buttons.slice(1).every((btn) => btn.getAttribute("aria-selected") === "false")).toBe(true);

    for (const id of ["base", "pkm", "project", "quicknote", "diary", "book", "user"]) {
      expect(document.querySelector(`[data-section-id="${id}"]`)?.hasAttribute("hidden")).toBe(false);
    }
    expect(document.querySelector(".plugin-section-chevron")).toBeNull();
    expect(document.querySelector(".plugin-section-body--collapsed")).toBeNull();
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

  it("jumps to Book when that nav button is clicked and keeps the other packs", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("auto-toc")],
      { "markdown-toolbar": false, "auto-toc": false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": false, "auto-toc": false });

    const baseBtn = document.querySelector(
      '.settings-nav-btn[data-section="base"]',
    ) as HTMLButtonElement;
    const bookBtn = document.querySelector(
      '.settings-nav-btn[data-section="book"]',
    ) as HTMLButtonElement;
    expect(baseBtn.getAttribute("aria-selected")).toBe("true");
    expect(bookBtn.textContent).toBe("Book");

    const pane = document.querySelector("#plugins-body") as HTMLElement;
    const scrollTo = vi.spyOn(pane, "scrollTo").mockImplementation(() => {});
    bookBtn.click();

    expect(bookBtn.getAttribute("aria-selected")).toBe("true");
    expect(baseBtn.getAttribute("aria-selected")).toBe("false");
    expect(baseBtn.disabled).toBe(false);
    expect(document.querySelector('[data-section-id="base"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="book"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="user"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="book"] .plugin-row')?.textContent).toContain("auto-toc");
    expect(scrollTo).toHaveBeenCalled();
  });

  it("remembers the selected section when the panel is reopened", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("auto-toc")],
      { "markdown-toolbar": false, "auto-toc": false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": false, "auto-toc": false });
    (document.querySelector('.settings-nav-btn[data-section="book"]') as HTMLButtonElement).click();

    closePluginsPanel();
    openPluginsPanel({ "markdown-toolbar": false, "auto-toc": false });

    expect(
      document.querySelector('.settings-nav-btn[data-section="book"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      document.querySelector('.settings-nav-btn[data-section="base"]')?.getAttribute("aria-selected"),
    ).toBe("false");
    expect(document.querySelector('[data-section-id="book"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="base"]')?.hasAttribute("hidden")).toBe(false);
  });

  it("places File Browser under Base, not PKM", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("file-browser")],
      { "file-browser": false },
      toggle,
    );
    openPluginsPanel({ "file-browser": false });

    const headings = Array.from(document.querySelectorAll(".plugin-section-title"))
      .map((h) => h.textContent);
    expect(headings).not.toContain("Organization System Plugins");
    expect(headings).not.toContain("Core Plugins");

    const baseRows = document.querySelectorAll('[data-section-id="base"] .plugin-row');
    expect(baseRows.length).toBe(1);
    expect(baseRows[0].textContent).toContain("Plugin file-browser");
    expect(document.querySelectorAll('[data-section-id="pkm"] .plugin-row').length).toBe(0);
  });

  it("puts Manage Vaults on the File Browser row, before the toggle", () => {
    const openVaults = vi.fn();
    (window as unknown as { __MARKABLE_OPEN_MANAGE_VAULTS__?: () => void }).__MARKABLE_OPEN_MANAGE_VAULTS__ = openVaults;
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("file-browser"), makeCoreDef("markdown-toolbar")],
      { "file-browser": true, "markdown-toolbar": true },
      toggle,
    );
    openPluginsPanel({ "file-browser": true, "markdown-toolbar": true });

    expect(document.querySelector(".plugin-panel-footer")).toBeNull();
    const rows = Array.from(document.querySelectorAll('[data-section-id="base"] .plugin-row'));
    const fileRow = rows.find((node) => node.textContent?.includes("file-browser")) as HTMLElement;
    const other = rows.find((node) => node.textContent?.includes("markdown-toolbar")) as HTMLElement;
    const action = fileRow.querySelector(".plugin-row-action") as HTMLButtonElement;
    expect(action.textContent).toBe("Manage Vaults");
    expect(other.querySelector(".plugin-row-action")).toBeNull();
    expect(action.compareDocumentPosition(fileRow.querySelector(".plugin-toggle")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    action.click();
    expect(openVaults).toHaveBeenCalledOnce();
    expect(document.getElementById("plugins-overlay")?.classList.contains("hidden")).toBe(true);
    (window as unknown as { __MARKABLE_OPEN_MANAGE_VAULTS__?: unknown }).__MARKABLE_OPEN_MANAGE_VAULTS__ = undefined;
  });

  it("omits Manage Vaults when File Browser has not registered an opener", () => {
    (window as unknown as { __MARKABLE_OPEN_MANAGE_VAULTS__?: unknown }).__MARKABLE_OPEN_MANAGE_VAULTS__ = undefined;
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("file-browser")],
      { "file-browser": true },
      toggle,
    );
    openPluginsPanel({ "file-browser": true });
    expect(document.querySelector(".plugin-row-action")).toBeNull();
    expect(document.querySelector(".plugin-panel-footer")).toBeNull();
  });

  it("lists File Browser second in Base, after Markdown Toolbar", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [
        makeCoreDef("command-bar"),
        makeCoreDef("file-browser"),
        makeCoreDef("markdown-toolbar"),
      ],
      { "command-bar": true, "file-browser": true, "markdown-toolbar": true },
      toggle,
    );
    openPluginsPanel({
      "command-bar": true,
      "file-browser": true,
      "markdown-toolbar": true,
    });

    const names = Array.from(
      document.querySelectorAll('[data-section-id="base"] .plugin-row'),
    ).map((row) => row.textContent ?? "");
    expect(names[0]).toContain("markdown-toolbar");
    expect(names[1]).toContain("file-browser");
  });

  it("appends an unlisted core plugin to Base", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("custom-extra")],
      { "custom-extra": false },
      toggle,
    );
    openPluginsPanel({ "custom-extra": false });

    const baseRows = document.querySelectorAll('[data-section-id="base"] .plugin-row');
    const names = Array.from(baseRows).map((row) => row.textContent);
    expect(names.some((text) => text?.includes("Plugin custom-extra"))).toBe(true);
  });

  it("places auto-toc under Book and former Added plugins under Base", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("auto-toc"), makeCoreDef("diagrams"), makeCoreDef("focus-mode")],
      { "auto-toc": false, diagrams: false, "focus-mode": false },
      toggle,
    );
    openPluginsPanel({ "auto-toc": false, diagrams: false, "focus-mode": false });

    const bookRows = Array.from(
      document.querySelectorAll('[data-section-id="book"] .plugin-row'),
    ).map((row) => row.textContent ?? "");
    expect(bookRows.some((text) => text.includes("auto-toc"))).toBe(true);

    const baseRows = Array.from(
      document.querySelectorAll('[data-section-id="base"] .plugin-row'),
    ).map((row) => row.textContent ?? "");
    expect(baseRows.some((text) => text.includes("diagrams"))).toBe(true);
    expect(baseRows.some((text) => text.includes("focus-mode"))).toBe(true);
  });

  it("places templates, auto-title, and insert-count under Base, not Quick note", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("templates"), makeCoreDef("auto-title"), makeCoreDef("insert-count"), makeCoreDef("sync")],
      { templates: false, "auto-title": true, "insert-count": true, sync: false },
      toggle,
    );
    openPluginsPanel({ templates: false, "auto-title": true, "insert-count": true, sync: false });

    const baseIds = Array.from(
      document.querySelectorAll('[data-section-id="base"] .plugin-row'),
    ).map((row) => row.textContent);
    expect(baseIds.some((text) => text?.includes("templates"))).toBe(true);
    expect(baseIds.some((text) => text?.includes("auto-title"))).toBe(true);
    expect(baseIds.some((text) => text?.includes("insert-count"))).toBe(true);

    const quickIds = Array.from(
      document.querySelectorAll('[data-section-id="quicknote"] .plugin-row'),
    ).map((row) => row.textContent);
    expect(quickIds.some((text) => text?.includes("sync"))).toBe(true);
    expect(quickIds.some((text) => text?.includes("templates"))).toBe(false);
  });

  it("lists word-count last in Base", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("word-count"), makeCoreDef("markdown-toolbar"), makeCoreDef("templates")],
      { "word-count": false, "markdown-toolbar": true, templates: false },
      toggle,
    );
    openPluginsPanel({ "word-count": false, "markdown-toolbar": true, templates: false });

    const names = Array.from(
      document.querySelectorAll('[data-section-id="base"] .plugin-row'),
    ).map((row) => row.textContent ?? "");
    expect(names[names.length - 1]).toContain("word-count");
  });

  it("renders Off / Default / All on pack sections and not on User", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeUserDef("my-plugin")],
      { "markdown-toolbar": false, "my-plugin": false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": false, "my-plugin": false });

    expect(document.querySelectorAll(".plugin-section-preset").length).toBe(6);
    expect(document.querySelector('[data-section-id="user"] .plugin-section-preset')).toBeNull();
    expect(document.querySelector('[data-section-id="user"] .plugin-reload-btn')).not.toBeNull();
  });

  it("marks Default when Base matches first-run (templates off, rest on)", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("templates")],
      { "markdown-toolbar": true, templates: false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": true, templates: false });

    const active = document.querySelector(
      '[data-section-id="base"] .plugin-section-preset-btn.active',
    );
    expect(active?.getAttribute("data-preset")).toBe("default");
  });

  it("marks no preset when the section is a custom mix", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("command-bar")],
      { "markdown-toolbar": true, "command-bar": false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": true, "command-bar": false });

    expect(
      document.querySelector('[data-section-id="base"] .plugin-section-preset-btn.active'),
    ).toBeNull();
  });

  it("turns every plugin in the section on when All is clicked", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("templates")],
      { "markdown-toolbar": true, templates: false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": true, templates: false });

    const allBtn = document.querySelector(
      '[data-section-id="base"] [data-preset="all"]',
    ) as HTMLButtonElement;
    allBtn.click();
    await vi.waitFor(() => {
      expect(toggle).toHaveBeenCalledWith("templates", true);
    });
    expect(toggle).not.toHaveBeenCalledWith("markdown-toolbar", false);
  });

  it("restores first-run defaults when Default is clicked", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("templates")],
      { "markdown-toolbar": true, templates: true },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": true, templates: true });

    const defaultBtn = document.querySelector(
      '[data-section-id="base"] [data-preset="default"]',
    ) as HTMLButtonElement;
    expect(
      document.querySelector('[data-section-id="base"] .plugin-section-preset-btn.active')
        ?.getAttribute("data-preset"),
    ).toBe("all");
    defaultBtn.click();
    await vi.waitFor(() => {
      expect(toggle).toHaveBeenCalledWith("templates", false);
    });
    expect(toggle).not.toHaveBeenCalledWith("markdown-toolbar", false);
  });

  it("updates a dependency row from the toggle result", async () => {
    const toggle = vi.fn(async (id: string, enabled: boolean) => {
      if (id === "calendar" && enabled) return { calendar: true, "daily-note": true };
      return { [id]: enabled };
    });
    createPluginsPanel(
      [makeCoreDef("daily-note"), makeCoreDef("calendar")],
      { "daily-note": false, calendar: false },
      toggle,
    );
    openPluginsPanel({ "daily-note": false, calendar: false });

    const calendarRow = [...document.querySelectorAll(".plugin-row")].find((row) =>
      row.textContent?.includes("Plugin calendar"),
    );
    calendarRow?.querySelector("input")?.click();
    await vi.waitFor(() => {
      const daily = [...document.querySelectorAll(".plugin-row")].find((row) =>
        row.textContent?.includes("Plugin daily-note"),
      );
      expect(daily?.querySelector("input")?.checked).toBe(true);
    });
  });

  it("turns the whole section off when Off is clicked", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("templates")],
      { "markdown-toolbar": true, templates: false },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": true, templates: false });

    const offBtn = document.querySelector(
      '[data-section-id="base"] [data-preset="off"]',
    ) as HTMLButtonElement;
    offBtn.click();
    await vi.waitFor(() => {
      expect(toggle).toHaveBeenCalledWith("markdown-toolbar", false);
    });
    expect(toggle).not.toHaveBeenCalledWith("templates", true);
  });
});

describe("plugins-panel — Markable PKM flavor", () => {
  const originalOrder = flavor.orderedPluginPackIds;

  beforeEach(() => {
    document.getElementById("plugins-overlay")?.remove();
    vi.spyOn(flavor, "getActiveFlavor").mockReturnValue(pkmManifest);
    vi.spyOn(flavor, "orderedPluginPackIds").mockImplementation(() =>
      originalOrder(pkmManifest),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists Base then PKM in the nav and still opens on Base", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    createPluginsPanel(
      [makeCoreDef("markdown-toolbar"), makeCoreDef("file-browser")],
      { "markdown-toolbar": true, "file-browser": true },
      toggle,
    );
    openPluginsPanel({ "markdown-toolbar": true, "file-browser": true });

    const labels = Array.from(document.querySelectorAll(".settings-nav-btn"))
      .map((btn) => btn.textContent);
    expect(labels.slice(0, 2)).toEqual(["Base editing", "PKM"]);
    expect(labels[labels.length - 1]).toBe("User Plugins");

    expect(
      document.querySelector('.settings-nav-btn[data-section="base"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.querySelector('[data-section-id="base"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="pkm"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="book"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-section-id="user"]')?.hasAttribute("hidden")).toBe(false);
  });
});
