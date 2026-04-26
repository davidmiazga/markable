/**
 * Tests for the "List Style" dropdown in the Settings panel (Step 4).
 *
 * Verifies that the settings panel renders the list style dropdown, syncs it
 * to the persisted listStyle value on open, defaults to "standard" when the
 * field is absent (EC-13), persists changes on selection, and resets correctly.
 *
 * These tests exercise the DOM output of createSettingsPanel() and simulate
 * user interactions (change events, clicks) to confirm wiring is correct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Tauri mocks ─────────────────────────────────────────────────────────────
// Must be declared before importing the module under test so vi.mock hoists
// correctly. The settings module transitively imports Tauri APIs.

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    maximize: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
    center: vi.fn(),
    setFullscreen: vi.fn(),
  })),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the bridge module so updateSettings does not hit the Rust backend.
// saveSettings is called internally by updateSettings — we mock it to resolve
// successfully so the settings in-memory singleton updates without errors.
vi.mock("../src/lib/bridge", () => ({
  getSettings: vi.fn(() => ({ ok: true, value: {} })),
  saveSettings: vi.fn(() => ({ ok: true })),
  updateRecentFilesMenu: vi.fn(),
}));

// Mock the tabs facade so the Tab mode segmented control wiring does not
// throw when tabManager is accessed.
vi.mock("../src/tabs", () => ({
  tabManager: {
    setMode: vi.fn(),
  },
}));

import {
  createSettingsPanel,
  openSettingsPanel,
  closeSettingsPanel,
} from "../src/settings/settings-panel";
import { getCurrentSettings, updateSettings } from "../src/lib/settings";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the list style <select> element from the DOM.
 * Returns null if the dropdown has not been rendered.
 */
function getListStyleSelect(): HTMLSelectElement | null {
  return document.querySelector("#settings-list-style") as HTMLSelectElement | null;
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  // Clean any previous panel DOM so each test starts fresh.
  const existing = document.querySelector("#settings-overlay");
  if (existing) existing.remove();
});

afterEach(() => {
  closeSettingsPanel();
  const overlay = document.querySelector("#settings-overlay");
  if (overlay) overlay.remove();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Settings Panel — List Style dropdown", () => {

  // ── Rendering ───────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders a <select> with id 'settings-list-style'", () => {
      createSettingsPanel();
      const select = getListStyleSelect();
      expect(select).not.toBeNull();
      expect(select!.tagName).toBe("SELECT");
    });

    it("contains exactly four <option> elements", () => {
      createSettingsPanel();
      const select = getListStyleSelect()!;
      expect(select.options).toHaveLength(4);
    });

    it("option values are 'standard', 'alphanumeric', 'decimal', 'steps'", () => {
      createSettingsPanel();
      const select = getListStyleSelect()!;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual(["standard", "alphanumeric", "decimal", "steps"]);
    });

    it("option labels match the spec display text", () => {
      createSettingsPanel();
      const select = getListStyleSelect()!;
      const labels = Array.from(select.options).map((o) => o.text);
      expect(labels).toEqual([
        "Standard (1. 2. 3.)",
        "Alphanumeric (I. A. 1. a. i.)",
        "Decimal Outline (1. 1.1.)",
        "Steps (1. a. -)",
      ]);
    });

    it("renders a description paragraph with the expected text", () => {
      createSettingsPanel();
      // The description is the <p> sibling after the <select> inside the
      // same .settings-section that contains #settings-list-style.
      const select = getListStyleSelect()!;
      const section = select.closest(".settings-section")!;
      const desc = section.querySelector(".settings-description");
      expect(desc).not.toBeNull();
      expect(desc!.textContent).toContain("Default style for new lists");
      expect(desc!.textContent).toContain("comment override");
    });

    it("renders the section label as 'List Style'", () => {
      createSettingsPanel();
      const select = getListStyleSelect()!;
      const section = select.closest(".settings-section")!;
      const label = section.querySelector(".settings-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("List Style");
    });
  });

  // ── Sync on open ──────────────────────────────────────────────────────

  describe("syncPanelToSettings()", () => {
    it("sets the dropdown value to the current listStyle setting", async () => {
      createSettingsPanel();

      // Set listStyle to "alphanumeric" in the in-memory settings.
      await updateSettings((s) => ({ ...s, listStyle: "alphanumeric" as const }));

      openSettingsPanel();
      const select = getListStyleSelect()!;
      expect(select.value).toBe("alphanumeric");
    });

    it("sets the dropdown value to 'decimal' when listStyle is 'decimal'", async () => {
      createSettingsPanel();
      await updateSettings((s) => ({ ...s, listStyle: "decimal" as const }));

      openSettingsPanel();
      expect(getListStyleSelect()!.value).toBe("decimal");
    });

    it("sets the dropdown value to 'steps' when listStyle is 'steps'", async () => {
      createSettingsPanel();
      await updateSettings((s) => ({ ...s, listStyle: "steps" as const }));

      openSettingsPanel();
      expect(getListStyleSelect()!.value).toBe("steps");
    });

    it("EC-13: defaults to 'standard' when listStyle is absent (undefined)", async () => {
      createSettingsPanel();

      // Simulate old settings file that lacks the listStyle field entirely.
      await updateSettings((s) => {
        const copy = { ...s };
        delete copy.listStyle;
        return copy;
      });

      openSettingsPanel();
      const select = getListStyleSelect()!;
      expect(select.value).toBe("standard");
    });
  });

  // ── Change event ──────────────────────────────────────────────────────

  describe("change event persists setting", () => {
    it("updates listStyle in settings when user selects a new value", async () => {
      createSettingsPanel();
      openSettingsPanel();

      const select = getListStyleSelect()!;
      select.value = "decimal";
      select.dispatchEvent(new Event("change"));

      // Allow the async updateSettings handler to complete.
      await vi.waitFor(() => {
        expect(getCurrentSettings().listStyle).toBe("decimal");
      });
    });

    it("updates listStyle to 'alphanumeric' on selection", async () => {
      createSettingsPanel();
      openSettingsPanel();

      const select = getListStyleSelect()!;
      select.value = "alphanumeric";
      select.dispatchEvent(new Event("change"));

      await vi.waitFor(() => {
        expect(getCurrentSettings().listStyle).toBe("alphanumeric");
      });
    });

    it("updates listStyle to 'steps' on selection", async () => {
      createSettingsPanel();
      openSettingsPanel();

      const select = getListStyleSelect()!;
      select.value = "steps";
      select.dispatchEvent(new Event("change"));

      await vi.waitFor(() => {
        expect(getCurrentSettings().listStyle).toBe("steps");
      });
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────

  describe("Reset All", () => {
    it("resets the dropdown to 'standard' after Reset All is clicked", async () => {
      createSettingsPanel();
      openSettingsPanel();

      // First set a non-default value.
      await updateSettings((s) => ({ ...s, listStyle: "decimal" as const }));

      // Click the reset button.
      const resetBtn = document.querySelector("#settings-reset-defaults") as HTMLButtonElement;
      expect(resetBtn).not.toBeNull();
      resetBtn.click();

      // After reset, syncPanelToSettings is called. The dropdown should
      // reflect "standard" because DEFAULT_SETTINGS has no listStyle field,
      // and the ?? "standard" fallback in syncPanelToSettings takes effect.
      await vi.waitFor(() => {
        expect(getListStyleSelect()!.value).toBe("standard");
      });
    });
  });

  // ── Placement ─────────────────────────────────────────────────────────

  describe("section placement", () => {
    it("the List Style section appears immediately after the Tabs section", () => {
      createSettingsPanel();

      // Collect all .settings-section elements in DOM order.
      const sections = Array.from(
        document.querySelectorAll(".settings-body .settings-section"),
      );
      const labels = sections.map(
        (s) => s.querySelector(".settings-label")?.textContent ?? "",
      );

      const tabsIndex = labels.indexOf("Tabs");
      const listStyleIndex = labels.indexOf("List Style");

      // Both sections must exist.
      expect(tabsIndex).toBeGreaterThanOrEqual(0);
      expect(listStyleIndex).toBeGreaterThanOrEqual(0);

      // List Style must appear directly after Tabs (adjacent sections).
      expect(listStyleIndex).toBe(tabsIndex + 1);
    });
  });
});
