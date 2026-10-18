/**
 * Settings sidebar jumps to a section. Every section stays in the scrolling pane.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("../src/lib/bridge", () => ({
  getSettings: vi.fn(() => ({ ok: true, value: {} })),
  saveSettings: vi.fn(() => ({ ok: true })),
  updateRecentFilesMenu: vi.fn(),
}));
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

const NAV_LABELS = [
  "Window & Content",
  "Appearance",
  "Editor",
  "Data Protection",
  "Recent Files",
  "Tabs",
  "List Style",
  "Quick Capture",
];

function navButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll(".settings-nav-btn"));
}

function sections(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".settings-nav-pane .settings-section"));
}

function sectionByLabel(label: string): HTMLElement {
  const found = sections().find(
    (section) => section.querySelector(".settings-label")?.textContent === label,
  );
  if (!found) throw new Error(`missing section ${label}`);
  return found;
}

beforeEach(() => {
  document.querySelector("#settings-overlay")?.remove();
});

afterEach(() => {
  closeSettingsPanel();
  document.querySelector("#settings-overlay")?.remove();
});

describe("Settings section nav", () => {
  it("lists the eight sections in sidebar order", () => {
    createSettingsPanel();
    expect(navButtons().map((btn) => btn.textContent)).toEqual(NAV_LABELS);
    expect(navButtons().map((btn) => btn.dataset.section)).toEqual([
      "window",
      "appearance",
      "editor",
      "data-protection",
      "recent",
      "tabs",
      "list-style",
      "quick-capture",
    ]);
    const nav = document.querySelector(".settings-nav");
    expect(nav?.getAttribute("role")).toBe("tablist");
    expect(nav?.getAttribute("aria-label")).toBe("Settings sections");
    for (const btn of navButtons()) {
      expect(btn.type).toBe("button");
      expect(btn.getAttribute("role")).toBe("tab");
    }
  });

  it("keeps every section in the pane after open", () => {
    createSettingsPanel();
    openSettingsPanel();
    expect(sections()).toHaveLength(8);
    expect(sections().every((section) => section.hidden === false)).toBe(true);
  });

  it("clicking List Style jumps there and dims the other sidebar items", () => {
    createSettingsPanel();
    openSettingsPanel("window");

    const windowSection = sectionByLabel("Window & Content");
    const listSection = sectionByLabel("List Style");
    const pane = document.querySelector(".settings-nav-pane") as HTMLElement;
    const scrollTo = vi.spyOn(pane, "scrollTo").mockImplementation(() => {});

    const listBtn = document.querySelector(
      '.settings-nav-btn[data-section="list-style"]',
    ) as HTMLButtonElement;
    const windowBtn = document.querySelector(
      '.settings-nav-btn[data-section="window"]',
    ) as HTMLButtonElement;
    listBtn.click();

    expect(windowSection.hidden).toBe(false);
    expect(listSection.hidden).toBe(false);
    expect(listBtn.disabled).toBe(false);
    expect(windowBtn.disabled).toBe(false);
    expect(listBtn.getAttribute("aria-selected")).toBe("true");
    expect(windowBtn.getAttribute("aria-selected")).toBe("false");
    expect(scrollTo).toHaveBeenCalled();
  });

  it("openSettingsPanel('data-protection') jumps to Data Protection", () => {
    createSettingsPanel();
    const pane = document.querySelector(".settings-nav-pane") as HTMLElement;
    const scrollTo = vi.spyOn(pane, "scrollTo").mockImplementation(() => {});
    openSettingsPanel("data-protection");

    const mode = document.querySelector("#settings-data-protection-mode") as HTMLElement;
    expect(mode).toBeTruthy();
    const section = mode.closest(".settings-section") as HTMLElement;
    expect(section.hidden).toBe(false);
    expect(section.querySelector(".settings-label")?.textContent).toBe("Data Protection");
    expect(sections().every((node) => node.hidden === false)).toBe(true);
    expect(
      document.querySelector('.settings-nav-btn[data-section="data-protection"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(scrollTo).toHaveBeenCalled();
  });

  it("remembers the last section when reopened without an id", () => {
    createSettingsPanel();
    openSettingsPanel("window");
    (document.querySelector(
      '.settings-nav-btn[data-section="list-style"]',
    ) as HTMLButtonElement).click();
    closeSettingsPanel();
    openSettingsPanel();
    expect(
      document.querySelector('.settings-nav-btn[data-section="list-style"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(sectionByLabel("List Style").hidden).toBe(false);
    expect(sectionByLabel("Window & Content").hidden).toBe(false);
  });
});
