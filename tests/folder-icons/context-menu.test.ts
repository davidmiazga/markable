/**
 * tests/folder-icons/context-menu.test.ts — step_07
 *
 * Asserts the directory right-click menu surfaces the new
 * "Set folder icon…" entry between Pin/Unpin and Reveal in Finder, and that
 * the entry's handler is a callable function (it wires the picker via
 * `openFolderIconPicker(path, { onChange: reloadVaultIndex })`).
 *
 * The handler invocation itself is exercised end-to-end by the manual
 * verification checklist; the unit test verifies positioning + wiring shape.
 */

import { describe, it, expect } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
}));

import { vi } from "vitest";
import { _testing } from "../../src/plugins/file-browser/file-browser.plugin";

describe("buildDirContextMenuItems — Set folder icon entry (step_07)", () => {
  it("contains a 'Set folder icon…' item", () => {
    const items = _testing.buildDirContextMenuItems(
      document.createElement("div"),
      "/v/A",
      "vault-1",
      false,
      false,
      false,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Set folder icon…");
  });

  it("is positioned between Pin/Unpin and Reveal in Finder", () => {
    const items = _testing.buildDirContextMenuItems(
      document.createElement("div"),
      "/v/A",
      "vault-1",
      false,
      false,
      false,
    );
    const labels = items.map((i) => i.label);
    const pinIdx = labels.findIndex((l) => l === "Pin" || l === "Unpin");
    const setIconIdx = labels.findIndex((l) => l === "Set folder icon…");
    const revealIdx = labels.findIndex((l) => l === "Reveal in Finder");
    expect(pinIdx).toBeGreaterThanOrEqual(0);
    expect(setIconIdx).toBeGreaterThan(pinIdx);
    expect(revealIdx).toBeGreaterThan(setIconIdx);
  });

  it("invoking the handler is a callable function (smoke)", () => {
    const items = _testing.buildDirContextMenuItems(
      document.createElement("div"),
      "/v/A",
      "vault-1",
      false,
      false,
      false,
    );
    const entry = items.find((i) => i.label === "Set folder icon…")!;
    expect(typeof entry.handler).toBe("function");
  });
});
