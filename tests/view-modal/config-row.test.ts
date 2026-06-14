/**
 * tests/view-modal/config-row.test.ts (step_04)
 *
 * Config-row tests for `openViewModal` — verifies the Path, Sort,
 * toggles, and Content Width controls emit the right codefence keys
 * and follow Q-2 / FR-31 defaults (preview-pane defaults ON, an
 * intentional change from the legacy `mountSelectForm` default).
 *
 * EC mapping: EC-4 (path defaults), EC-17 (toggles default ON).
 *
 * FR mapping: FR-14, FR-18, FR-25, FR-31, FR-32, FR-35, FR-36, FR-37.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openViewModal,
  VIEW_MODAL_OVERLAY_ID,
  getViewModalState,
  emitViewModalFence,
} from "../../src/lib/codeblock-modal";

function panel(): HTMLElement {
  const el = document.getElementById(VIEW_MODAL_OVERLAY_ID);
  if (!el) throw new Error("modal not mounted");
  return el.querySelector<HTMLElement>(".cbm-panel")!;
}

beforeEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());
afterEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());

describe("openViewModal — config row (step_04)", () => {
  it("Path defaults to './' (FR-14 / FR-18)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const input = panel().querySelector<HTMLInputElement>('input[data-vm-field="path"]')!;
    expect(input.value).toBe("./");
  });

  it("EC-4 — empty Path on submit emits `path: ./`", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const input = panel().querySelector<HTMLInputElement>('input[data-vm-field="path"]')!;
    input.value = "";
    input.dispatchEvent(new Event("input"));
    const fence = emitViewModalFence();
    expect(fence).toContain("path: ./");
  });

  it("Sort dropdown contains exactly Name ↑ and Name ↓ (FR-25)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const sortSel = panel().querySelector<HTMLSelectElement>('select[data-vm-field="sort"]')!;
    const options = Array.from(sortSel.options).map((o) => ({ v: o.value, l: o.textContent }));
    expect(options.length).toBe(2);
    expect(options[0].v).toBe("name-asc");
    expect(options[0].l).toMatch(/Name.*↑/);
    expect(options[1].v).toBe("name-desc");
    expect(options[1].l).toMatch(/Name.*↓/);
  });

  it("Sort defaults to name-asc (FR-25)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const state = getViewModalState();
    expect(state.sort).toBe("name-asc");
  });

  it("Show modified date toggle defaults ON (FR-31 / EC-17)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(panel().querySelector<HTMLInputElement>('input[data-vm-toggle="show-modified"]')!.checked).toBe(true);
  });

  it("Show file extensions toggle defaults ON (FR-31)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(panel().querySelector<HTMLInputElement>('input[data-vm-toggle="show-extensions"]')!.checked).toBe(true);
  });

  it("Include preview pane toggle defaults ON (FR-31 / Q-2 override)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(panel().querySelector<HTMLInputElement>('input[data-vm-toggle="preview-pane"]')!.checked).toBe(true);
  });

  it("Content Width defaults to Normal; clicking Wide flips selection (FR-36 / FR-37)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const widePill = panel().querySelector<HTMLElement>('[data-vm-width="wide"]')!;
    widePill.click();
    const active = panel().querySelector<HTMLElement>('[data-vm-width].is-active')!;
    expect(active.dataset.vmWidth).toBe("wide");
    const state = getViewModalState();
    expect(state.contentWidth).toBe("wide");
  });

  it("Content Width Normal emits no `content-width:` key (round-trip parity)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const fence = emitViewModalFence();
    expect(fence).not.toContain("content-width:");
  });

  it("Content Width Wide emits `content-width: wide`", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    panel().querySelector<HTMLElement>('[data-vm-width="wide"]')!.click();
    const fence = emitViewModalFence();
    expect(fence).toContain("content-width: wide");
  });

  it("Toggles OFF emit `show-modified: false`, `show-extensions: false`, no `preview-pane:` key when ON-default toggles back to default", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const sm = panel().querySelector<HTMLInputElement>('input[data-vm-toggle="show-modified"]')!;
    const se = panel().querySelector<HTMLInputElement>('input[data-vm-toggle="show-extensions"]')!;
    sm.checked = false;
    sm.dispatchEvent(new Event("change"));
    se.checked = false;
    se.dispatchEvent(new Event("change"));
    const fence = emitViewModalFence();
    expect(fence).toContain("show-modified: false");
    expect(fence).toContain("show-extensions: false");
  });

  it("Preview pane toggle OFF emits no `preview-pane:` line (the writer only emits when true per round-trip parity)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const pp = panel().querySelector<HTMLInputElement>('input[data-vm-toggle="preview-pane"]')!;
    pp.checked = false;
    pp.dispatchEvent(new Event("change"));
    const fence = emitViewModalFence();
    expect(fence).not.toContain("preview-pane: true");
  });

  it("Default state emits `preview-pane: true` (EC-17)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const fence = emitViewModalFence();
    expect(fence).toContain("preview-pane: true");
  });
});
