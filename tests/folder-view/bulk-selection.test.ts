/**
 * tests/folder-view/bulk-selection.test.ts
 *
 * Unit tests for SelectionState helpers.
 * Covers FR-1, FR-2, and checkbox propagation behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSelectionState,
  buildCheckboxTd,
  buildMasterCheckboxTh,
  updateMasterCheckboxState,
} from "../../src/plugins/file-browser/folder-view/bulk-selection";
import type { FolderCard } from "../../src/plugins/file-browser/folder-view/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCard(name: string, path?: string, kind: "file" | "directory" = "file"): FolderCard {
  return {
    path: path ?? `/vault/${name}.md`,
    name,
    kind,
    ext: kind === "file" ? ".md" : "",
    modified: 0,
  };
}

function makeTr(): HTMLTableRowElement {
  return document.createElement("tr");
}

// ── createSelectionState ──────────────────────────────────────────────────────

describe("createSelectionState", () => {
  it("SS-01: returns object with empty Set and empty Map", () => {
    const state = createSelectionState();
    expect(state.paths).toBeInstanceOf(Set);
    expect(state.paths.size).toBe(0);
    expect(state.kindMap).toBeInstanceOf(Map);
    expect(state.kindMap.size).toBe(0);
  });
});

// ── buildCheckboxTd ───────────────────────────────────────────────────────────

describe("buildCheckboxTd", () => {
  let state: ReturnType<typeof createSelectionState>;
  let syncToolbarSpy: ReturnType<typeof vi.fn>;
  let syncToolbar: () => void;
  let masterInput: HTMLInputElement;
  let card: FolderCard;
  let tr: HTMLTableRowElement;
  let sectionPaths: string[];

  beforeEach(() => {
    state = createSelectionState();
    syncToolbarSpy = vi.fn();
    syncToolbar = syncToolbarSpy as unknown as () => void;
    masterInput = document.createElement("input");
    masterInput.type = "checkbox";
    card = makeCard("note");
    tr = makeTr();
    sectionPaths = [card.path];
  });

  it("SS-02: returns a <td> with classes fv-td and fv-td-checkbox", () => {
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    expect(td.tagName).toBe("TD");
    expect(td.classList.contains("fv-td")).toBe(true);
    expect(td.classList.contains("fv-td-checkbox")).toBe(true);
  });

  it("SS-03: contains an <input type=checkbox> with aria-label", () => {
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const input = td.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(input).not.toBeNull();
    expect(input!.getAttribute("aria-label")).toBe("Select note");
  });

  it("SS-04: checking the input adds the path to selectionState.paths", () => {
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const input = td.querySelector<HTMLInputElement>("input")!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(state.paths.has(card.path)).toBe(true);
  });

  it("SS-05: unchecking the input removes the path from selectionState.paths", () => {
    state.paths.add(card.path);
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const input = td.querySelector<HTMLInputElement>("input")!;
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(state.paths.has(card.path)).toBe(false);
  });

  it("SS-06: checking adds fv-row--selected to the <tr>", () => {
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const input = td.querySelector<HTMLInputElement>("input")!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(tr.classList.contains("fv-row--selected")).toBe(true);
  });

  it("SS-07: unchecking removes fv-row--selected from the <tr>", () => {
    tr.classList.add("fv-row--selected");
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const input = td.querySelector<HTMLInputElement>("input")!;
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(tr.classList.contains("fv-row--selected")).toBe(false);
  });

  it("SS-08: checking calls updateToolbar()", () => {
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const input = td.querySelector<HTMLInputElement>("input")!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(syncToolbarSpy).toHaveBeenCalledOnce();
  });

  it("SS-09: click event on the <td> does NOT propagate (stopPropagation)", () => {
    const td = buildCheckboxTd(card, tr, state, syncToolbar, masterInput, sectionPaths);
    const parentSpy = vi.fn();
    const parent = document.createElement("div");
    parent.addEventListener("click", parentSpy);
    parent.appendChild(td);
    td.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("SS-10: buildCheckboxTd registers card.kind in selectionState.kindMap", () => {
    const dirCard = makeCard("myFolder", "/vault/myFolder", "directory");
    buildCheckboxTd(dirCard, tr, state, syncToolbar, masterInput, [dirCard.path]);
    expect(state.kindMap.get(dirCard.path)).toBe("directory");
  });
});

// ── buildMasterCheckboxTh ─────────────────────────────────────────────────────

describe("buildMasterCheckboxTh", () => {
  let state: ReturnType<typeof createSelectionState>;
  let syncToolbarSpy: ReturnType<typeof vi.fn>;
  let syncToolbar: () => void;
  let sectionPaths: string[];
  let rowCheckboxes: HTMLInputElement[];
  let rows: HTMLTableRowElement[];

  beforeEach(() => {
    state = createSelectionState();
    syncToolbarSpy = vi.fn();
    syncToolbar = syncToolbarSpy as unknown as () => void;
    sectionPaths = ["/vault/a.md", "/vault/b.md"];
    rowCheckboxes = sectionPaths.map(() => {
      const i = document.createElement("input");
      i.type = "checkbox";
      return i;
    });
    rows = sectionPaths.map(() => document.createElement("tr"));
  });

  it("SS-11: returns th with classes fv-th and fv-th-checkbox", () => {
    const { th } = buildMasterCheckboxTh("Folders", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    expect(th.tagName).toBe("TH");
    expect(th.classList.contains("fv-th")).toBe(true);
    expect(th.classList.contains("fv-th-checkbox")).toBe(true);
  });

  it("SS-12: checking master adds all sectionPaths to selectionState.paths", () => {
    const { masterInput } = buildMasterCheckboxTh("Files", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    masterInput.checked = true;
    masterInput.dispatchEvent(new Event("change"));
    for (const p of sectionPaths) {
      expect(state.paths.has(p)).toBe(true);
    }
  });

  it("SS-13: unchecking master removes all sectionPaths from selectionState.paths", () => {
    for (const p of sectionPaths) state.paths.add(p);
    const { masterInput } = buildMasterCheckboxTh("Files", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    masterInput.checked = false;
    masterInput.dispatchEvent(new Event("change"));
    for (const p of sectionPaths) {
      expect(state.paths.has(p)).toBe(false);
    }
  });

  it("SS-14: checking master sets all rowCheckboxes to checked=true", () => {
    const { masterInput } = buildMasterCheckboxTh("Files", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    masterInput.checked = true;
    masterInput.dispatchEvent(new Event("change"));
    for (const cb of rowCheckboxes) {
      expect(cb.checked).toBe(true);
    }
  });

  it("SS-15: unchecking master sets all rowCheckboxes to checked=false", () => {
    for (const cb of rowCheckboxes) cb.checked = true;
    const { masterInput } = buildMasterCheckboxTh("Files", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    masterInput.checked = false;
    masterInput.dispatchEvent(new Event("change"));
    for (const cb of rowCheckboxes) {
      expect(cb.checked).toBe(false);
    }
  });

  it("SS-16: checking master adds fv-row--selected to all rows", () => {
    const { masterInput } = buildMasterCheckboxTh("Files", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    masterInput.checked = true;
    masterInput.dispatchEvent(new Event("change"));
    for (const row of rows) {
      expect(row.classList.contains("fv-row--selected")).toBe(true);
    }
  });

  it("SS-17: checking master calls updateToolbar()", () => {
    const { masterInput } = buildMasterCheckboxTh("Files", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    masterInput.checked = true;
    masterInput.dispatchEvent(new Event("change"));
    expect(syncToolbarSpy).toHaveBeenCalledOnce();
  });

  it("SS-18: masterInput has aria-label 'Select all Folders' when sectionLabel is Folders", () => {
    const { masterInput } = buildMasterCheckboxTh("Folders", sectionPaths, state, syncToolbar, rowCheckboxes, rows);
    expect(masterInput.getAttribute("aria-label")).toBe("Select all Folders");
  });
});

// ── updateMasterCheckboxState ─────────────────────────────────────────────────

describe("updateMasterCheckboxState", () => {
  it("SS-19: 0 of N selected → checked=false, indeterminate=false", () => {
    const state = createSelectionState();
    const master = document.createElement("input");
    master.type = "checkbox";
    master.checked = true;
    master.indeterminate = true;
    updateMasterCheckboxState(master, ["/a", "/b"], state);
    expect(master.checked).toBe(false);
    expect(master.indeterminate).toBe(false);
  });

  it("SS-20: N of N selected → checked=true, indeterminate=false", () => {
    const state = createSelectionState();
    state.paths.add("/a");
    state.paths.add("/b");
    const master = document.createElement("input");
    master.type = "checkbox";
    updateMasterCheckboxState(master, ["/a", "/b"], state);
    expect(master.checked).toBe(true);
    expect(master.indeterminate).toBe(false);
  });

  it("SS-21: k of N selected (0 < k < N) → checked=false, indeterminate=true", () => {
    const state = createSelectionState();
    state.paths.add("/a");
    const master = document.createElement("input");
    master.type = "checkbox";
    updateMasterCheckboxState(master, ["/a", "/b"], state);
    expect(master.checked).toBe(false);
    expect(master.indeterminate).toBe(true);
  });
});
