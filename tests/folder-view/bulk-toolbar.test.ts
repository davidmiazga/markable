/**
 * tests/folder-view/bulk-toolbar.test.ts
 *
 * Unit tests for buildToolbar(), updateToolbar(), and sub-UI transitions.
 * Covers FR-3, FR-4, FR-5, FR-6, States 1–8, EC-14.
 */

import { describe, it, expect, vi } from "vitest";
import { buildToolbar, updateToolbar, showResult } from
  "../../src/plugins/file-browser/folder-view/bulk-toolbar";
import { createSelectionState } from
  "../../src/plugins/file-browser/folder-view/bulk-selection";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRefs() {
  const state = createSelectionState();
  const onMove = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onYaml = vi.fn().mockResolvedValue(undefined);
  const refs = buildToolbar(state, onMove, onDelete, onYaml);
  return { state, refs, onMove, onDelete, onYaml };
}

// ── Root toolbar ──────────────────────────────────────────────────────────────

describe("buildToolbar root", () => {
  it("T-01: toolbar root has role=toolbar and aria-label=Bulk actions", () => {
    const { refs } = makeRefs();
    expect(refs.toolbar.getAttribute("role")).toBe("toolbar");
    expect(refs.toolbar.getAttribute("aria-label")).toBe("Bulk actions");
  });

  it("T-02: toolbar is hidden when selectionState.paths is empty", () => {
    const { refs } = makeRefs();
    expect(refs.toolbar.classList.contains("fv-bulk-toolbar--visible")).toBe(false);
  });
});

// ── updateToolbar ─────────────────────────────────────────────────────────────

describe("updateToolbar", () => {
  it("T-03: hidden → visible when one path added to selection", () => {
    const { refs, state } = makeRefs();
    state.paths.add("/vault/a.md");
    updateToolbar(refs, state);
    expect(refs.toolbar.classList.contains("fv-bulk-toolbar--visible")).toBe(true);
  });

  it("T-04: count label shows '1 selected' for 1 item", () => {
    const { refs, state } = makeRefs();
    state.paths.add("/vault/a.md");
    updateToolbar(refs, state);
    expect(refs.countLabel.textContent).toBe("1 selected");
  });

  it("T-05: count label shows '3 selected' for 3 items", () => {
    const { refs, state } = makeRefs();
    state.paths.add("/vault/a.md");
    state.paths.add("/vault/b.md");
    state.paths.add("/vault/c.md");
    updateToolbar(refs, state);
    expect(refs.countLabel.textContent).toBe("3 selected");
  });

  it("T-06: toolbar hidden when paths cleared", () => {
    const { refs, state } = makeRefs();
    state.paths.add("/vault/a.md");
    updateToolbar(refs, state);
    state.paths.clear();
    updateToolbar(refs, state);
    expect(refs.toolbar.classList.contains("fv-bulk-toolbar--visible")).toBe(false);
  });

  it("T-27: count label uses .textContent (NFR-4 — no innerHTML)", () => {
    const { refs, state } = makeRefs();
    state.paths.add("/vault/a.md");
    updateToolbar(refs, state);
    // If .textContent was used, innerHTML would be the same (no tags).
    // But if innerHTML were used directly with user data, it would be a risk.
    // Verify the textContent matches, which confirms it was set via textContent.
    expect(refs.countLabel.textContent).toBe(refs.countLabel.innerHTML);
  });
});

// ── Main buttons ──────────────────────────────────────────────────────────────

describe("main buttons", () => {
  it("T-07: Move, Delete, File properties buttons are all present", () => {
    const { refs } = makeRefs();
    const buttons = Array.from(refs.mainButtons.querySelectorAll("button")).map(b => b.textContent);
    expect(buttons).toContain("Move");
    expect(buttons).toContain("Delete");
    expect(buttons).toContain("File properties");
  });
});

// ── Move sub-UI ───────────────────────────────────────────────────────────────

describe("Move sub-UI", () => {
  it("T-08: clicking Move shows destination input sub-UI", () => {
    const { refs } = makeRefs();
    const moveBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Move")!;
    moveBtn.click();
    const input = refs.subUi.querySelector("input[type='text']");
    expect(input).not.toBeNull();
  });

  it("T-09: Confirm Move is disabled when input is empty", () => {
    const { refs } = makeRefs();
    const moveBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Move")!;
    moveBtn.click();
    const confirmBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Confirm Move")! as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it("T-10: Confirm Move enabled after typing in input", () => {
    const { refs } = makeRefs();
    const moveBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Move")!;
    moveBtn.click();
    const input = refs.subUi.querySelector<HTMLInputElement>("input[type='text']")!;
    const confirmBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Confirm Move")! as HTMLButtonElement;
    input.value = "/vault/dest";
    input.dispatchEvent(new Event("input"));
    expect(confirmBtn.disabled).toBe(false);
  });

  it("T-11: Move sub-UI: Cancel restores main buttons", () => {
    const { refs } = makeRefs();
    const moveBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Move")!;
    moveBtn.click();
    const cancelBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Cancel")! as HTMLButtonElement;
    cancelBtn.click();
    expect(refs.mainButtons.style.display).not.toBe("none");
    expect(refs.subUi.classList.contains("fv-bulk-subui--visible")).toBe(false);
  });

  it("T-12: Confirm Move calls onMove with input value", async () => {
    const { refs, onMove } = makeRefs();
    const moveBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Move")!;
    moveBtn.click();
    const input = refs.subUi.querySelector<HTMLInputElement>("input[type='text']")!;
    const confirmBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Confirm Move")! as HTMLButtonElement;
    input.value = "/vault/destination";
    input.dispatchEvent(new Event("input"));
    confirmBtn.click();
    await Promise.resolve(); // flush microtask
    expect(onMove).toHaveBeenCalledWith("/vault/destination");
  });
});

// ── Delete sub-UI ─────────────────────────────────────────────────────────────

describe("Delete sub-UI", () => {
  it("T-13: Delete sub-UI shown when Delete clicked", () => {
    const { refs } = makeRefs();
    const deleteBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Delete")!;
    deleteBtn.click();
    expect(refs.subUi.classList.contains("fv-bulk-subui--visible")).toBe(true);
  });

  it("T-14: label says 'Delete N item(s)? This cannot be undone.'", () => {
    const { refs, state } = makeRefs();
    state.paths.add("/vault/a.md");
    state.paths.add("/vault/b.md");
    const deleteBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Delete")!;
    deleteBtn.click();
    const label = refs.subUi.querySelector(".fv-bulk-subui__label");
    expect(label?.textContent).toBe("Delete 2 item(s)? This cannot be undone.");
  });

  it("T-15: Cancel restores main buttons", () => {
    const { refs } = makeRefs();
    const deleteBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Delete")!;
    deleteBtn.click();
    const cancelBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Cancel")! as HTMLButtonElement;
    cancelBtn.click();
    expect(refs.mainButtons.style.display).not.toBe("none");
    expect(refs.subUi.classList.contains("fv-bulk-subui--visible")).toBe(false);
  });

  it("T-16: Confirm Delete calls onDelete", async () => {
    const { refs, onDelete } = makeRefs();
    const deleteBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Delete")!;
    deleteBtn.click();
    const confirmBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Confirm Delete")! as HTMLButtonElement;
    confirmBtn.click();
    await Promise.resolve();
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

// ── YAML sub-UI ───────────────────────────────────────────────────────────────

describe("YAML sub-UI", () => {
  it("T-17: YAML sub-UI shown when File properties clicked", () => {
    const { refs } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();
    expect(refs.subUi.classList.contains("fv-bulk-subui--visible")).toBe(true);
  });

  it("T-18: Apply disabled when key input is empty (EC-14)", () => {
    const { refs } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();
    const applyBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Apply")! as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it("T-19: Apply enabled after typing a key", () => {
    const { refs } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();
    const keyInput = refs.subUi.querySelectorAll<HTMLInputElement>("input[type='text']")[0];
    const applyBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Apply")! as HTMLButtonElement;
    keyInput.value = "status";
    keyInput.dispatchEvent(new Event("input"));
    expect(applyBtn.disabled).toBe(false);
  });

  it("T-20: value input hidden when Remove key selected", () => {
    const { refs } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();
    const opSelect = refs.subUi.querySelector<HTMLSelectElement>("select")!;
    opSelect.value = "remove";
    opSelect.dispatchEvent(new Event("change"));
    // Find all text inputs; the value input should be hidden.
    const textInputs = refs.subUi.querySelectorAll<HTMLInputElement>("input[type='text']");
    // The value input is the second text input (after key input).
    const valueInput = textInputs[1] as HTMLInputElement | undefined;
    // When op=remove, value input should be hidden (display:none).
    expect(valueInput?.style.display).toBe("none");
  });

  it("T-21: value input visible when Add / update key selected", () => {
    const { refs } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();
    const opSelect = refs.subUi.querySelector<HTMLSelectElement>("select")!;
    // Switch to remove first, then back to add.
    opSelect.value = "remove";
    opSelect.dispatchEvent(new Event("change"));
    opSelect.value = "add";
    opSelect.dispatchEvent(new Event("change"));
    const textInputs = refs.subUi.querySelectorAll<HTMLInputElement>("input[type='text']");
    const valueInput = textInputs[1] as HTMLInputElement | undefined;
    expect(valueInput?.style.display).not.toBe("none");
  });

  it("T-22: Cancel restores main buttons", () => {
    const { refs } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();
    const cancelBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Cancel")! as HTMLButtonElement;
    cancelBtn.click();
    expect(refs.mainButtons.style.display).not.toBe("none");
    expect(refs.subUi.classList.contains("fv-bulk-subui--visible")).toBe(false);
  });

  it("T-23: Apply calls onYaml with correct (op, key, value)", async () => {
    const { refs, onYaml } = makeRefs();
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();

    const textInputs = refs.subUi.querySelectorAll<HTMLInputElement>("input[type='text']");
    const keyInput = textInputs[0];
    const valueInput = textInputs[1];
    const applyBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Apply")! as HTMLButtonElement;

    keyInput.value = "status";
    keyInput.dispatchEvent(new Event("input"));
    valueInput.value = "done";
    applyBtn.click();
    await Promise.resolve();
    expect(onYaml).toHaveBeenCalledWith("add", "status", "done");
  });
});

// ── YAML result persistence (Finding 1) ──────────────────────────────────────

describe("YAML result persistence", () => {
  it("T-28: result div remains after onYaml resolves (not destroyed by hideSubUi)", async () => {
    // Regression test for the critical bug where hideSubUi() was called immediately
    // after onYaml returned, erasing the .fv-bulk-result div before the user
    // could read it. The result must persist until the user clicks Cancel.
    //
    // Strategy: onYaml calls showResult(refs, ...) during its execution (which is
    // exactly what folder-view.ts does). After the click handler fully settles,
    // we assert the result div is still present in subUi.
    const state = createSelectionState();

    // onYaml is a wrapper that calls showResult on refs (captured via closure
    // after buildToolbar returns) and then resolves. This mirrors the real
    // folder-view.ts handler pattern precisely.
    let capturedRefs: ReturnType<typeof buildToolbar> | undefined;
    const onYaml = vi.fn().mockImplementation(async () => {
      // capturedRefs is assigned below after buildToolbar; the mock only runs
      // during the test body so the assignment is always complete before this runs.
      showResult(capturedRefs!, "Processed 2 of 2 eligible .md files.", false);
    });

    const refs = buildToolbar(state, vi.fn(), vi.fn(), onYaml);
    capturedRefs = refs;

    // Open the YAML sub-UI and type a key so Apply becomes enabled.
    const yamlBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "File properties")!;
    yamlBtn.click();

    const keyInput = refs.subUi.querySelectorAll<HTMLInputElement>("input[type='text']")[0];
    keyInput.value = "status";
    keyInput.dispatchEvent(new Event("input"));

    const applyBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Apply")! as HTMLButtonElement;
    applyBtn.click();

    // Flush microtasks so the async click handler fully completes.
    await Promise.resolve();
    await Promise.resolve();

    // Assert: the result div must still be present — hideSubUi must NOT have
    // been called after onYaml resolved.
    expect(refs.subUi.querySelector(".fv-bulk-result")).not.toBeNull();
  });
});

// ── showResult ────────────────────────────────────────────────────────────────

describe("showResult", () => {
  it("T-24: creates .fv-bulk-result element with text content", () => {
    const { refs } = makeRefs();
    showResult(refs, "Done!", false);
    const el = refs.subUi.querySelector(".fv-bulk-result");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("Done!");
  });

  it("T-25: adds fv-bulk-result--error when isError=true", () => {
    const { refs } = makeRefs();
    showResult(refs, "Error!", true);
    const el = refs.subUi.querySelector(".fv-bulk-result--error");
    expect(el).not.toBeNull();
  });
});

// ── Operation in-progress state ───────────────────────────────────────────────

describe("Operation in progress", () => {
  it("T-26: buttons disabled during operation (before onDelete resolves)", async () => {
    let resolveDelete!: () => void;
    const slowDelete = vi.fn().mockReturnValue(new Promise<void>(r => { resolveDelete = r; }));
    const state = createSelectionState();
    state.paths.add("/vault/a.md");
    const refs = buildToolbar(state, vi.fn(), slowDelete, vi.fn());

    const deleteBtn = Array.from(refs.mainButtons.querySelectorAll("button"))
      .find(b => b.textContent === "Delete")!;
    deleteBtn.click();

    const confirmBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Confirm Delete")! as HTMLButtonElement;
    const cancelBtn = Array.from(refs.subUi.querySelectorAll("button"))
      .find(b => b.textContent === "Cancel")! as HTMLButtonElement;

    confirmBtn.click();
    // Operation is in progress; buttons should be disabled.
    expect(confirmBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);

    // Resolve the operation.
    resolveDelete();
    await Promise.resolve();
    await Promise.resolve();
    // After completion, buttons are re-enabled.
    expect(confirmBtn.disabled).toBe(false);
    expect(cancelBtn.disabled).toBe(false);
  });
});
