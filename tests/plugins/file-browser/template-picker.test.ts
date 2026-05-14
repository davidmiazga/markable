/**
 * tests/plugins/file-browser/template-picker.test.ts
 *
 * Unit tests for openTemplatePicker().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { openTemplatePicker, type TemplateDefinition } from "../../../src/lib/template-picker";

function makeTemplates(count = 3): TemplateDefinition<string>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tpl-${i}`,
    name: `Template ${i}`,
    description: `Description ${i}`,
    previewSvg: `<svg><text>Preview ${i}</text></svg>`,
    data: `content-${i}`,
  }));
}

function getOverlay(): HTMLElement | null {
  return document.getElementById("__template-picker-overlay__");
}

beforeEach(() => {
  document.getElementById("__template-picker-overlay__")?.remove();
  document.getElementById("__tp-styles__")?.remove();
  document.body.innerHTML = "";
});

describe("openTemplatePicker", () => {
  it("renders the correct number of template items", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(4), onSelect: () => {} });
    const items = document.querySelectorAll(".tp-item");
    expect(items.length).toBe(4);
  });

  it("shows the picker title", () => {
    openTemplatePicker({ title: "New Folder View", templates: makeTemplates(2), onSelect: () => {} });
    const title = document.querySelector(".tp-title")!;
    expect(title.textContent).toBe("New Folder View");
  });

  it("first template is selected by default", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(3), onSelect: () => {} });
    const activeItems = document.querySelectorAll(".tp-item--active");
    expect(activeItems.length).toBe(1);
    expect(activeItems[0].querySelector(".tp-item-name")!.textContent).toBe("Template 0");
  });

  it("clicking an item selects it", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(3), onSelect: () => {} });
    const items = document.querySelectorAll<HTMLButtonElement>(".tp-item");
    items[2].click();
    expect(items[2].classList.contains("tp-item--active")).toBe(true);
    expect(items[0].classList.contains("tp-item--active")).toBe(false);
  });

  it("clicking Cancel closes the picker", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(2), onSelect: () => {} });
    expect(getOverlay()).not.toBeNull();
    document.querySelector<HTMLButtonElement>(".tp-btn--cancel")!.click();
    expect(getOverlay()).toBeNull();
  });

  it("Escape key closes the picker", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(2), onSelect: () => {} });
    const panel = document.querySelector<HTMLElement>(".tp-panel")!;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(getOverlay()).toBeNull();
  });

  it("ArrowDown moves selection down", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(3), onSelect: () => {} });
    const panel = document.querySelector<HTMLElement>(".tp-panel")!;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const activeItem = document.querySelector(".tp-item--active");
    expect(activeItem?.querySelector(".tp-item-name")?.textContent).toBe("Template 1");
  });

  it("ArrowUp does not go below index 0", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(3), onSelect: () => {} });
    const panel = document.querySelector<HTMLElement>(".tp-panel")!;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    const activeItem = document.querySelector(".tp-item--active");
    expect(activeItem?.querySelector(".tp-item-name")?.textContent).toBe("Template 0");
  });

  it("Enter key calls onSelect with the selected template", () => {
    const onSelect = vi.fn();
    openTemplatePicker({ title: "Pick", templates: makeTemplates(3), onSelect });
    // Select template 1 first
    document.querySelectorAll<HTMLButtonElement>(".tp-item")[1].click();
    const panel = document.querySelector<HTMLElement>(".tp-panel")!;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].id).toBe("tpl-1");
  });

  it("Create button calls onSelect and closes the picker", () => {
    const onSelect = vi.fn();
    openTemplatePicker({ title: "Pick", templates: makeTemplates(2), onSelect });
    document.querySelector<HTMLButtonElement>(".tp-btn--create")!.click();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(getOverlay()).toBeNull();
  });

  it("Create button uses custom createLabel when provided", () => {
    openTemplatePicker({ title: "Pick", createLabel: "Apply", templates: makeTemplates(1), onSelect: () => {} });
    const btn = document.querySelector<HTMLButtonElement>(".tp-btn--create")!;
    expect(btn.textContent).toBe("Apply");
  });

  it("SVG preview updates when selection changes", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(3), onSelect: () => {} });
    // Initially shows Template 0 preview
    expect(document.querySelector(".tp-preview-svg")!.innerHTML).toContain("Preview 0");
    // Select Template 2
    document.querySelectorAll<HTMLButtonElement>(".tp-item")[2].click();
    expect(document.querySelector(".tp-preview-svg")!.innerHTML).toContain("Preview 2");
  });

  it("double-open guard: second call is a no-op", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(2), onSelect: () => {} });
    openTemplatePicker({ title: "Second", templates: makeTemplates(2), onSelect: () => {} });
    // Only one overlay should exist
    expect(document.querySelectorAll("[id='__template-picker-overlay__']").length).toBe(1);
    // Title should still be from the first call
    expect(document.querySelector(".tp-title")?.textContent).toBe("Pick");
  });

  it("no-op when templates array is empty", () => {
    openTemplatePicker({ title: "Pick", templates: [], onSelect: () => {} });
    expect(getOverlay()).toBeNull();
  });

  it("backdrop click closes the picker", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(2), onSelect: () => {} });
    document.querySelector<HTMLElement>(".tp-backdrop")!.click();
    expect(getOverlay()).toBeNull();
  });

  it("injects styles only once across multiple opens", () => {
    openTemplatePicker({ title: "Pick", templates: makeTemplates(1), onSelect: () => {} });
    document.querySelector<HTMLButtonElement>(".tp-btn--cancel")!.click();
    openTemplatePicker({ title: "Pick2", templates: makeTemplates(1), onSelect: () => {} });
    expect(document.querySelectorAll("#__tp-styles__").length).toBe(1);
  });
});
