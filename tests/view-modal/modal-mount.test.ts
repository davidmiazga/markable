/**
 * tests/view-modal/modal-mount.test.ts (step_04)
 *
 * Mount tests for `openViewModal` — verify the modal opens with the
 * correct default state, the title bar reflects the mode (Q-1), the
 * action button label switches per mode, Cancel closes without
 * dispatching, and the DOM uses the existing `cbm-*` modal-chrome
 * classes (C-2 / NFR-5).
 *
 * EC mapping: EC-4 (default path), EC-11 (Cancel discards),
 * EC-12 (modal stacking — placeholder; full coverage lands in step_06),
 * EC-17 (default toggles ON).
 *
 * FR mapping: FR-2, FR-6, FR-10, FR-13, FR-31, FR-40, FR-41, FR-42,
 * FR-45, FR-46, FR-47.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openViewModal,
  VIEW_MODAL_OVERLAY_ID,
} from "../../src/lib/codeblock-modal";

function modalOverlay(): HTMLElement | null {
  return document.getElementById(VIEW_MODAL_OVERLAY_ID);
}

function panel(): HTMLElement {
  const p = modalOverlay()?.querySelector<HTMLElement>(".cbm-panel");
  if (!p) throw new Error("modal panel not mounted");
  return p;
}

function closeModalIfOpen(): void {
  modalOverlay()?.remove();
}

beforeEach(() => closeModalIfOpen());
afterEach(() => closeModalIfOpen());

describe("openViewModal — mount and default state (step_04)", () => {
  it("opens with default state in create mode (FR-2 / EC-17)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const p = panel();
    // Tab strip has six tabs; Cards is active.
    const tabs = Array.from(p.querySelectorAll<HTMLElement>(".vm-tab"));
    expect(tabs.length).toBe(6);
    const active = tabs.find((t) => t.classList.contains("is-active"));
    expect(active?.dataset.slug).toBe("cards");

    // Path field defaults to "./".
    const pathInput = p.querySelector<HTMLInputElement>('input[data-vm-field="path"]');
    expect(pathInput?.value).toBe("./");

    // Filter status reads "Show all files".
    expect(p.querySelector('[data-vm-field="filter-status"]')?.textContent).toMatch(/show all files/i);

    // Sort dropdown defaults to name-asc.
    const sortSel = p.querySelector<HTMLSelectElement>('select[data-vm-field="sort"]');
    expect(sortSel?.value).toBe("name-asc");

    // All three toggle inputs default checked (Q-2 / FR-31 / EC-17).
    const toggles = Array.from(p.querySelectorAll<HTMLInputElement>('input[data-vm-toggle]'));
    expect(toggles.length).toBe(3);
    for (const t of toggles) expect(t.checked).toBe(true);

    // Content Width default is "normal" (leftmost pill active).
    const widthPills = Array.from(p.querySelectorAll<HTMLElement>('[data-vm-width]'));
    const activeWidth = widthPills.find((el) => el.classList.contains("is-active"));
    expect(activeWidth?.dataset.vmWidth).toBe("normal");
  });

  it("title bar text reflects the mode (Q-1)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(panel().querySelector(".cbm-title")?.textContent).toBe("New Folder View");
    closeModalIfOpen();

    openViewModal("insert", {});
    expect(panel().querySelector(".cbm-title")?.textContent).toBe("Insert Codeblock");
    closeModalIfOpen();

    openViewModal("edit", { folderPath: "/v/Foo", initial: {} });
    expect(panel().querySelector(".cbm-title")?.textContent).toBe("Edit Folder View");
    closeModalIfOpen();

    openViewModal("edit", { initial: {} });
    expect(panel().querySelector(".cbm-title")?.textContent).toBe("Edit Codeblock");
  });

  it("action button label reflects the mode (FR-40)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(panel().querySelector<HTMLButtonElement>(".cbm-btn-primary")?.textContent).toBe("Create");
    closeModalIfOpen();

    openViewModal("insert", {});
    expect(panel().querySelector<HTMLButtonElement>(".cbm-btn-primary")?.textContent).toBe("Insert");
    closeModalIfOpen();

    openViewModal("edit", { folderPath: "/v/Foo", initial: {} });
    expect(panel().querySelector<HTMLButtonElement>(".cbm-btn-primary")?.textContent).toBe("Save");
  });

  it("Cancel discards changes and closes the modal (EC-11)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const p = panel();
    const pathInput = p.querySelector<HTMLInputElement>('input[data-vm-field="path"]')!;
    pathInput.value = "Foo";
    pathInput.dispatchEvent(new Event("input"));

    const cancelBtn = Array.from(p.querySelectorAll<HTMLButtonElement>(".cbm-btn"))
      .find((b) => b.textContent === "Cancel");
    expect(cancelBtn).toBeTruthy();
    cancelBtn!.click();

    expect(modalOverlay()).toBeNull();
  });

  it("preview area shows the SVG for the active tab (FR-46)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const previewHost = panel().querySelector<HTMLElement>(".vm-preview");
    // The browser normalises whitespace and self-closing tags when
    // it parses the SVG string, so we compare by a stable accessibility
    // marker rather than the literal innerHTML string.
    expect(previewHost?.querySelector("svg")?.getAttribute("aria-label")).toBe("Cards layout");
  });

  it("two-column config row layout (FR-30 / mockup pin)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const p = panel();
    expect(p.querySelector(".vm-config-row")).toBeTruthy();
    const left = p.querySelector(".vm-col-left");
    const right = p.querySelector(".vm-col-right");
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    // Path + Filter + Sort live in the left column.
    expect(left!.querySelector('input[data-vm-field="path"]')).toBeTruthy();
    expect(left!.querySelector('[data-vm-field="filter-status"]')).toBeTruthy();
    expect(left!.querySelector('select[data-vm-field="sort"]')).toBeTruthy();
    // Three toggles and three width pills live in the right column.
    expect(right!.querySelectorAll('input[data-vm-toggle]').length).toBe(3);
    expect(right!.querySelectorAll('[data-vm-width]').length).toBe(3);
  });

  it("modal reuses existing cbm-* modal-chrome classes (C-2 / NFR-5)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const overlay = modalOverlay()!;
    expect(overlay.classList.contains("cbm-overlay")).toBe(true);
    expect(overlay.querySelector(".cbm-panel")).toBeTruthy();
    expect(overlay.querySelector(".cbm-header")).toBeTruthy();
    expect(overlay.querySelector(".cbm-footer")).toBeTruthy();
  });

  it("only one modal opens at a time (idempotent on double-open)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    openViewModal("create", { folderPath: "/v/Foo" });
    const overlays = document.querySelectorAll(`#${VIEW_MODAL_OVERLAY_ID}`);
    expect(overlays.length).toBe(1);
  });
});
