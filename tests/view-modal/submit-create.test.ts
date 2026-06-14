/**
 * tests/view-modal/submit-create.test.ts (step_05)
 *
 * Submit-create end-to-end tests. Verifies that clicking Create / Save
 * writes `_folder.md` via `writeFolderMdCodeblock()` (step_02) with the
 * codeblock shape, that emit output mirrors the user's choices, and
 * that the Collection tab writes the `collection-home` slug.
 *
 * EC mapping: EC-1, EC-14, EC-17, FR-3, FR-4, FR-50, FR-80.
 *
 * The end-to-end test wires `ctx.onSubmit` (step_04 surface) and
 * dispatches the write through the bridge spy. The right-click /
 * main.ts integration is intentionally light — `ctx.onSubmit` is the
 * stable seam.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  openViewModal,
  VIEW_MODAL_OVERLAY_ID,
  getViewModalState,
  emitViewModalFence,
} from "../../src/lib/codeblock-modal";
import { writeFolderMdCodeblock } from "../../src/plugins/file-browser/folder-view/codeblock-writer";

function panel(): HTMLElement {
  return document.getElementById(VIEW_MODAL_OVERLAY_ID)!.querySelector<HTMLElement>(".cbm-panel")!;
}

function clickPrimary(): void {
  const btn = panel().querySelector<HTMLButtonElement>(".cbm-btn-primary");
  if (!btn) throw new Error("primary button not found");
  btn.click();
}

beforeEach(() => {
  document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove();
  vi.restoreAllMocks();
});
afterEach(() => document.getElementById(VIEW_MODAL_OVERLAY_ID)?.remove());

describe("openViewModal — submit-create end-to-end (step_05)", () => {
  it("EC-1 / FR-3 — Create writes _folder.md with codeblock shape via writeFolderMdCodeblock", async () => {
    const writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    const readSpy = vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: false,
      error: { kind: "NotFound", message: "" } as never,
    });

    // Use the test seam ctx.onSubmit (stable since step_04) to invoke
    // the writer ourselves — the production wire-up (file-browser
    // plugin handler) calls this same path.
    openViewModal("create", {
      folderPath: "/v/Foo",
      onSubmit: async (state) => {
        await writeFolderMdCodeblock("/v/Foo", state);
      },
    });
    clickPrimary();

    // Allow microtasks to flush so the async submit resolves.
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(readSpy).toHaveBeenCalledWith("/v/Foo/_folder.md");
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [, content] = writeSpy.mock.calls[0]!;
    expect(content).toContain("```select");
    expect(content).toContain("display: cards");
    expect(content).toContain("path: ./");
  });

  it("EC-14 / FR-80 — Collection tab submit writes `display: collection-home`", async () => {
    const writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: false,
      error: { kind: "NotFound", message: "" } as never,
    });

    openViewModal("create", {
      folderPath: "/v/Coll",
      onSubmit: async (state) => {
        await writeFolderMdCodeblock("/v/Coll", state);
      },
    });

    // Switch to the Collection tab.
    panel().querySelector<HTMLElement>('.vm-tab[data-slug="collection-home"]')!.click();
    clickPrimary();
    await new Promise<void>((r) => setTimeout(r, 0));

    const content = writeSpy.mock.calls[0]?.[1] ?? "";
    expect(content).toContain("display: collection-home");
  });

  it("EC-4 — empty Path on submit emits `path: ./`", async () => {
    const writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: false,
      error: { kind: "NotFound", message: "" } as never,
    });

    openViewModal("create", {
      folderPath: "/v/Foo",
      onSubmit: async (state) => {
        await writeFolderMdCodeblock("/v/Foo", state);
      },
    });
    const input = panel().querySelector<HTMLInputElement>('input[data-vm-field="path"]')!;
    input.value = "";
    input.dispatchEvent(new Event("input"));
    clickPrimary();
    await new Promise<void>((r) => setTimeout(r, 0));

    const content = writeSpy.mock.calls[0]?.[1] ?? "";
    expect(content).toContain("path: ./");
  });

  it("EC-17 — default toggles ON produce a codeblock that contains `preview-pane: true`", async () => {
    const writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: false,
      error: { kind: "NotFound", message: "" } as never,
    });

    openViewModal("create", {
      folderPath: "/v/Foo",
      onSubmit: async (state) => {
        await writeFolderMdCodeblock("/v/Foo", state);
      },
    });
    clickPrimary();
    await new Promise<void>((r) => setTimeout(r, 0));

    const content = writeSpy.mock.calls[0]?.[1] ?? "";
    // Q-2 / FR-31 default is ON; the writer emits `preview-pane: true`
    // when non-default (legacy default was `false`).
    expect(content).toContain("preview-pane: true");
    // show-modified ON is the writer's default — no line emitted.
    expect(content).not.toContain("show-modified: false");
    expect(content).not.toContain("show-extensions: false");
  });

  it("FR-2 / EC-21 — emit shows the active tab's display slug", async () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    panel().querySelector<HTMLElement>('.vm-tab[data-slug="kanban"]')!.click();
    const fence = emitViewModalFence();
    expect(fence).toContain("display: kanban");
  });

  it("Edit-mode prefill from initial.display selects the matching tab", () => {
    openViewModal("edit", {
      folderPath: "/v/Foo",
      initial: { display: "bookshelf", path: "Books" },
    });
    const active = panel().querySelector<HTMLElement>(".vm-tab.is-active");
    expect(active?.dataset.slug).toBe("bookshelf");
    const pathInput = panel().querySelector<HTMLInputElement>('input[data-vm-field="path"]');
    expect(pathInput?.value).toBe("Books");
    // Action button label is "Save" in edit mode.
    expect(panel().querySelector<HTMLButtonElement>(".cbm-btn-primary")?.textContent).toBe("Save");
  });

  it("getViewModalState mirrors the active tab's display slug after click", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    panel().querySelector<HTMLElement>('.vm-tab[data-slug="timeline"]')!.click();
    expect(getViewModalState().display).toBe("timeline");
  });
});
