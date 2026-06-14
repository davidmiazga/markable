/**
 * tests/view-modal/tab-switch.test.ts (step_04)
 *
 * Tab-switch tests for `openViewModal` — verify the six tabs swap the
 * preview illustration, preserve config state (EC-6), and run
 * synchronously without async work (EC-18 / NFR-6).
 *
 * EC mapping: EC-6, EC-18.
 *
 * FR mapping: FR-10, FR-11, FR-12, FR-13, FR-46, FR-47, FR-80.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openViewModal,
  VIEW_MODAL_OVERLAY_ID,
} from "../../src/lib/codeblock-modal";
import { VIEW_MODAL_TAB_ORDER } from "../../src/lib/view-modal-illustrations";

function overlay(): HTMLElement {
  const el = document.getElementById(VIEW_MODAL_OVERLAY_ID);
  if (!el) throw new Error("modal overlay not mounted");
  return el;
}

function panel(): HTMLElement {
  return overlay().querySelector<HTMLElement>(".cbm-panel")!;
}

function clickTab(slug: string): HTMLElement {
  const tab = panel().querySelector<HTMLElement>(`.vm-tab[data-slug="${slug}"]`);
  if (!tab) throw new Error(`tab not found: ${slug}`);
  tab.click();
  return tab;
}

beforeEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());
afterEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());

describe("openViewModal — tab switching (step_04)", () => {
  it("renders exactly six tabs in the locked order (FR-10)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const tabs = Array.from(panel().querySelectorAll<HTMLElement>(".vm-tab"));
    expect(tabs.map((t) => t.dataset.slug)).toEqual(
      VIEW_MODAL_TAB_ORDER.map((t) => t.slug),
    );
  });

  it("clicking each tab makes exactly that one active (FR-13)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    for (const { slug } of VIEW_MODAL_TAB_ORDER) {
      clickTab(slug);
      const active = panel().querySelectorAll<HTMLElement>(".vm-tab.is-active");
      expect(active.length).toBe(1);
      expect(active[0].dataset.slug).toBe(slug);
    }
  });

  it("tab switch updates the preview illustration (FR-46)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const previewHost = panel().querySelector<HTMLElement>(".vm-preview")!;
    const ARIA_LABEL_BY_SLUG: Record<string, string> = {
      cards: "Cards layout",
      table: "Table layout",
      "collection-home": "Collection layout",
      timeline: "Timeline layout",
      kanban: "Kanban layout",
      bookshelf: "Bookshelf layout",
    };
    for (const { slug } of VIEW_MODAL_TAB_ORDER) {
      clickTab(slug);
      // Stable aria-label rather than raw innerHTML — the browser
      // normalises SVG whitespace and self-closing markers on parse.
      expect(previewHost.querySelector("svg")?.getAttribute("aria-label")).toBe(
        ARIA_LABEL_BY_SLUG[slug],
      );
    }
  });

  it("tab switch preserves Path value (EC-6)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const pathInput = panel().querySelector<HTMLInputElement>('input[data-vm-field="path"]')!;
    pathInput.value = "Projects/2026";
    pathInput.dispatchEvent(new Event("input"));
    clickTab("table");
    clickTab("cards");
    expect(panel().querySelector<HTMLInputElement>('input[data-vm-field="path"]')!.value).toBe("Projects/2026");
  });

  it("tab switch preserves Sort selection (EC-6)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const sortSel = panel().querySelector<HTMLSelectElement>('select[data-vm-field="sort"]')!;
    sortSel.value = "name-desc";
    sortSel.dispatchEvent(new Event("change"));
    clickTab("table");
    clickTab("cards");
    expect(panel().querySelector<HTMLSelectElement>('select[data-vm-field="sort"]')!.value).toBe("name-desc");
  });

  it("tab switch preserves toggle states (EC-6)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const showModified = panel().querySelector<HTMLInputElement>('input[data-vm-toggle="show-modified"]')!;
    showModified.checked = false;
    showModified.dispatchEvent(new Event("change"));
    clickTab("table");
    clickTab("cards");
    expect(panel().querySelector<HTMLInputElement>('input[data-vm-toggle="show-modified"]')!.checked).toBe(false);
  });

  it("tab switch preserves Content Width selection (EC-6)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const widePill = panel().querySelector<HTMLElement>('[data-vm-width="wide"]')!;
    widePill.click();
    clickTab("table");
    clickTab("cards");
    const active = panel().querySelector<HTMLElement>('[data-vm-width].is-active')!;
    expect(active.dataset.vmWidth).toBe("wide");
  });

  it("tab switch is synchronous (EC-18 / NFR-6)", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    const previewHost = panel().querySelector<HTMLElement>(".vm-preview")!;
    const start = performance.now();
    clickTab("table");
    // The illustration must have updated synchronously — no setTimeout,
    // no requestAnimationFrame, no await on the click handler.
    expect(previewHost.querySelector("svg")?.getAttribute("aria-label")).toBe("Table layout");
    const elapsed = performance.now() - start;
    // Generous bound: even in slow CI a synchronous DOM swap is well under 50ms.
    expect(elapsed).toBeLessThan(50);
  });
});
