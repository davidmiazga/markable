/**
 * Footer trash icon for Data Protection.
 *
 * The checkbox persists showTrashIcon. When it is on, the footer shows a
 * closed can for an empty queue and an open can when notes are waiting.
 * Click reveals the folder. Command-click opens Data Protection settings.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recovered: { notes: unknown[] } = { notes: [] };

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
  invoke: vi.fn(async (command: string) => {
    if (command === "list_recovered_notes") return recovered.notes;
    return undefined;
  }),
}));
vi.mock("../src/lib/bridge", () => ({
  getSettings: vi.fn(() => ({ ok: true, value: {} })),
  saveSettings: vi.fn(() => ({ ok: true })),
  updateRecentFilesMenu: vi.fn(),
}));
vi.mock("../src/tabs", () => ({
  tabManager: { setMode: vi.fn() },
}));

import { invoke } from "@tauri-apps/api/core";
import {
  createSettingsPanel,
  openSettingsPanel,
  closeSettingsPanel,
  isSettingsPanelOpen,
} from "../src/settings/settings-panel";
import { getCurrentSettings, updateSettings } from "../src/lib/settings";
import { mountTrashFooter, syncTrashFooter } from "../src/lib/trash-footer";

function installFooter(): void {
  const bar = document.createElement("div");
  bar.id = "statusbar";
  bar.className = "hidden";
  const right = document.createElement("div");
  right.className = "statusbar-right";
  bar.append(right);
  document.body.append(bar);
}

function trashButton(): HTMLButtonElement | null {
  return document.querySelector("#trash-footer-btn");
}

beforeEach(async () => {
  recovered.notes = [];
  document.querySelector("#settings-overlay")?.remove();
  document.querySelector("#statusbar")?.remove();
  installFooter();
  await updateSettings((s) => ({
    ...s,
    dataProtection: {
      mode: "off",
      retention: "duration",
      retentionAmount: 7,
      retentionUnit: "days",
      showTrashIcon: false,
    },
  }));
  vi.mocked(invoke).mockClear();
  mountTrashFooter();
});

afterEach(() => {
  closeSettingsPanel();
  document.querySelector("#settings-overlay")?.remove();
  document.querySelector("#statusbar")?.remove();
  syncTrashFooter();
});

describe("footer trash icon", () => {
  it("stays hidden until Show trash icon is selected", async () => {
    createSettingsPanel();
    openSettingsPanel();
    const checkbox = document.querySelector("#settings-data-protection-trash-icon") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    syncTrashFooter();
    expect(trashButton()).toBeNull();

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(getCurrentSettings().dataProtection?.showTrashIcon).toBe(true);
    });
    await vi.waitFor(() => {
      expect(trashButton()?.dataset.trashState).toBe("empty");
    });
    expect(document.getElementById("statusbar")?.classList.contains("hidden")).toBe(false);
  });

  it("uses an open can when the queue has notes", async () => {
    recovered.notes = [{ id: "snap-1", name: "diary.md" }];
    await updateSettings((s) => ({
      ...s,
      dataProtection: { ...s.dataProtection!, showTrashIcon: true },
    }));
    syncTrashFooter();
    await vi.waitFor(() => {
      expect(trashButton()?.dataset.trashState).toBe("full");
    });
    expect(trashButton()?.getAttribute("aria-label")).toBe("Trash has notes");
  });

  it("click reveals the copies and Command-click opens Data Protection", async () => {
    await updateSettings((s) => ({
      ...s,
      dataProtection: { ...s.dataProtection!, showTrashIcon: true },
    }));
    createSettingsPanel();
    syncTrashFooter();
    await vi.waitFor(() => expect(trashButton()).toBeTruthy());
    vi.mocked(invoke).mockClear();

    trashButton()!.click();
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("reveal_recovered_notes");
    });

    vi.mocked(invoke).mockClear();
    trashButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    expect(isSettingsPanelOpen()).toBe(true);
    const mode = document.querySelector("#settings-data-protection-mode");
    expect(mode).toBeTruthy();
    const section = mode!.closest(".settings-section") as HTMLElement;
    expect(section.hidden).toBe(false);
    expect(
      document.querySelector('.settings-nav-btn[data-section="data-protection"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(invoke).not.toHaveBeenCalledWith("reveal_recovered_notes");
  });
});
